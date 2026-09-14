import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UserRepository } from "../repo/users";
import { KarmaRepository } from "../repo/karma";
import { createKarmaScannerHandler } from "./exchange";

describe("Karma Scanner (Exchange)", () => {
  let db: Database;
  let userRepo: UserRepository;
  let karmaRepo: KarmaRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        telegram_id   INTEGER PRIMARY KEY,
        username      TEXT,
        first_name    TEXT,
        last_name     TEXT,
        invited_by    INTEGER REFERENCES users(telegram_id),
        joined_at     TEXT NOT NULL,
        karma         INTEGER NOT NULL DEFAULT 0,
        language      TEXT NOT NULL DEFAULT 'en',
        comment       TEXT
      );
      CREATE INDEX idx_users_username ON users(lower(username));

      CREATE TABLE exchanges (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a    INTEGER NOT NULL,
        user_b    INTEGER NOT NULL,
        chat_id   INTEGER,
        message_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_exchanges_pair_time ON exchanges(user_a, user_b, created_at);
    `);

    userRepo = new UserRepository(db);
    karmaRepo = new KarmaRepository(db);

    // Set up test data
    const stmt = db.prepare(
      "INSERT INTO users (telegram_id, username, first_name, joined_at) VALUES (?, ?, ?, ?)"
    );
    stmt.run(1, "founder", "Founder", "2024-01-01T00:00:00Z");
    stmt.run(2, "user2", "User2", "2024-01-02T00:00:00Z");
    stmt.run(3, "user3", "User3", "2024-01-03T00:00:00Z");
  });

  afterEach(() => {
    db.close();
  });

  describe("Trigger matching", () => {
    it("matches default trigger word in lowercase", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "мы обменялись @user2", message_id: 100 },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true); // Handler processes and calls next
      const founder = userRepo.getById(1);
      expect(founder?.karma).toBe(1); // Founder karma incremented
    });

    it("matches mixed-case trigger word", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "Мы ОБМЕНЯЛИСЬ @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const founder = userRepo.getById(1);
      expect(founder?.karma).toBe(1);
    });

    it("does not match substring containing the trigger", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "переобменялись @user2", message_id: 100 }, // substring
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const founder = userRepo.getById(1);
      expect(founder?.karma).toBe(0); // No karma credit
    });

    it("does not match Russian conditional mood (бы after trigger)", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: {
          text: "Тегай в следующий раз, а то я не увидел) Обменялись бы. С TB",
          message_id: 100,
          reply_to_message: { from: { id: 2 } },
        },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit for conditional
    });

    it("rejects trigger when бы immediately follows", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "Обменялись бы, но не сложилось @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit
    });

    it("matches when бы appears elsewhere in sentence", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "бы обменялись @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1); // Should credit (бы before trigger is OK)
      expect(user2?.karma).toBe(1);
    });

    it("does not match English conditional mood (would/could before trigger)", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "exchange",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      // Test "would"
      const ctx1 = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "we would exchange @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx1, next);

      let user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit for "would exchange"

      // Test "could"
      const ctx2 = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "we could exchange @user3", message_id: 101 },
      } as any;

      await handler(ctx2, next);

      user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit for "could exchange"
    });

    it("matches when would/could appears after trigger", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "exchange",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "exchange would happen @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1); // Should credit (would after trigger is OK)
      expect(user2?.karma).toBe(1);
    });
  });

  describe("Counterparty resolution", () => {
    it("resolves counterparty from reply", async () => {
      const replies: string[] = [];
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: true,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: {
          text: "мы обменялись",
          message_id: 100,
          reply_to_message: { from: { id: 2 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      const next = () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1);
      expect(user2?.karma).toBe(1);
    });

    it("resolves counterparty from first @mention", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @user2 и @user3", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      const user3 = userRepo.getById(3);
      expect(user1?.karma).toBe(1);
      expect(user2?.karma).toBe(1);
      expect(user3?.karma).toBe(0); // Not @mentioned (first mention only)
    });

    it("ignores no counterparty", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit
    });

    it("ignores self-exchange", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @founder", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit for self
    });

    it("ignores unknown counterparty", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @unknown", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit
    });

    it("resolves counterparty from @mention when replying to self", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: {
          text: "обменялись @user2",
          message_id: 100,
          reply_to_message: { from: { id: 1 } }, // Reply to self
        },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1); // Should credit despite self-reply
      expect(user2?.karma).toBe(1);
    });
  });

  describe("Message type handling (edited, caption)", () => {
    it("credits karma from edited message", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: undefined,
        editedMessage: { text: "обменялись @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1);
      expect(user2?.karma).toBe(1);
    });

    it("credits karma from media caption", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: {
          caption: "обменялись @user2",
          message_id: 100,
          // No .text property (simulating a photo/video message)
        },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1);
      expect(user2?.karma).toBe(1);
    });
  });

  describe("Dedup window", () => {
    it("ignores repeat within 24h window", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      // First exchange
      const ctx1 = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx1, next);

      let user1 = userRepo.getById(1);
      let user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1);
      expect(user2?.karma).toBe(1);

      // Second exchange within 24h
      const ctx2 = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @user2", message_id: 101 },
      } as any;

      await handler(ctx2, next);

      user1 = userRepo.getById(1);
      user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1); // No change
      expect(user2?.karma).toBe(1); // No change
    });

    it("allows credit outside 24h window", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      // Manually insert an old exchange to test the window
      const now = new Date();
      const past = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago

      const exchangeStmt = db.prepare(`
        INSERT INTO exchanges (user_a, user_b, chat_id, message_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      exchangeStmt.run(1, 2, -123, 99, past.toISOString());

      // Now try to exchange again (25h later)
      const ctx = {
        chat: { id: -123 },
        from: { id: 1 },
        message: { text: "обменялись @user2", message_id: 102 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      const user2 = userRepo.getById(2);
      expect(user1?.karma).toBe(1); // Should credit again
      expect(user2?.karma).toBe(1);
    });
  });

  describe("Group filtering", () => {
    it("only processes messages in group chat", async () => {
      const handler = createKarmaScannerHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        karmaTriggers: "обменялись",
        karmaDedupeHours: 24,
        karmaAnnounce: false,
      });

      const ctx = {
        chat: { id: -999 }, // Different group
        from: { id: 1 },
        message: { text: "обменялись @user2", message_id: 100 },
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      const user1 = userRepo.getById(1);
      expect(user1?.karma).toBe(0); // No credit in wrong group
    });
  });
});
