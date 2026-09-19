import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UserRepository } from "../repo/users";
import { KarmaRepository } from "../repo/karma";
import { createUndoHandler } from "./undo";

describe("Undo Handler", () => {
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
        created_at TEXT NOT NULL,
        announcement_message_id INTEGER,
        undone_at TEXT
      );
      CREATE INDEX idx_exchanges_pair_time ON exchanges(user_a, user_b, created_at);
    `);

    userRepo = new UserRepository(db);
    karmaRepo = new KarmaRepository(db);

    // Set up test data: @apalevich (admin), @user2, @user3
    const stmt = db.prepare(
      "INSERT INTO users (telegram_id, username, first_name, joined_at) VALUES (?, ?, ?, ?)"
    );
    stmt.run(697027219, "apalevich", "Admin", "2024-01-01T00:00:00Z");
    stmt.run(2, "user2", "User2", "2024-01-02T00:00:00Z");
    stmt.run(3, "user3", "User3", "2024-01-03T00:00:00Z");
  });

  afterEach(() => {
    db.close();
  });

  describe("Admin undo", () => {
    it("successfully undoes an exchange and reverts karma", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      // First, create an exchange
      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);

      expect(userRepo.getById(2)?.karma).toBe(1);
      expect(userRepo.getById(3)?.karma).toBe(1);

      // Now undo it
      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 697027219 },
        message: {
          text: "Undo",
          reply_to_message: { message_id: 200, from: { id: 697027219 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true);
      expect(userRepo.getById(2)?.karma).toBe(0);
      expect(userRepo.getById(3)?.karma).toBe(0);
      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("reverted");
    });

    it("returns 'already done' when undoing the same exchange twice", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      // Create and undo an exchange once
      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);
      karmaRepo.undo(exchangeId);

      // Try to undo it again
      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 697027219 },
        message: {
          text: "Undo",
          reply_to_message: { message_id: 200, from: { id: 697027219 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      const next = async () => {};
      await handler(ctx, next);

      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("already");
    });
  });

  describe("Non-admin undo", () => {
    it("replies with forbidden message when non-admin tries to undo", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      // Create an exchange
      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);

      // Non-admin tries to undo
      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 2 }, // Not admin
        message: {
          text: "Undo",
          reply_to_message: { message_id: 200, from: { id: 697027219 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true);
      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("Only");
      // Karma should not change
      expect(userRepo.getById(2)?.karma).toBe(1);
      expect(userRepo.getById(3)?.karma).toBe(1);
    });
  });

  describe("Untracked reply", () => {
    it("silently ignores reply to message that is not a tracked exchange", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 697027219 },
        message: {
          text: "Undo",
          reply_to_message: { message_id: 999, from: { id: 697027219 } }, // Not a tracked exchange
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true);
      expect(replies.length).toBe(0); // No reply at all
    });
  });

  describe("Text matching", () => {
    it("matches case-insensitive and trimmed 'Undo'", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);

      const testCases = ["Undo", "UNDO", "undo", "  UnDo  "];

      for (const text of testCases) {
        const replies: string[] = [];
        const ctx = {
          chat: { id: -123 },
          from: { id: 697027219 },
          message: {
            text,
            reply_to_message: { message_id: 200, from: { id: 697027219 } },
          },
          reply: async (msg: string) => replies.push(msg),
        } as any;

        // Reset karma before each test
        karmaRepo.undo(exchangeId);
        const newExchangeId = karmaRepo.credit(2, 3, -123, 100);
        karmaRepo.setAnnouncementMessageId(newExchangeId, 200 + testCases.indexOf(text));

        await handler(ctx, async () => {});

        expect(replies.length).toBeGreaterThan(0);
      }
    });

    it("ignores message if text is not exactly 'Undo'", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);

      const testCases = ["Undo please", "Undo this", "I want to undo"];

      for (const text of testCases) {
        const replies: string[] = [];
        const ctx = {
          chat: { id: -123 },
          from: { id: 697027219 },
          message: {
            text,
            reply_to_message: { message_id: 200, from: { id: 697027219 } },
          },
          reply: async (msg: string) => replies.push(msg),
        } as any;

        await handler(ctx, async () => {});

        expect(replies.length).toBe(0);
      }
    });
  });

  describe("Wrong chat", () => {
    it("ignores undo command in wrong chat", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      const replies: string[] = [];
      const ctx = {
        chat: { id: -999 }, // Wrong chat
        from: { id: 697027219 },
        message: {
          text: "Undo",
          reply_to_message: { message_id: 200, from: { id: 697027219 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true);
      expect(replies.length).toBe(0);
    });
  });

  describe("No reply", () => {
    it("ignores message that is not a reply", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 697027219 },
        message: {
          text: "Undo",
          // No reply_to_message
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await handler(ctx, next);

      expect(nextCalled).toBe(true);
      expect(replies.length).toBe(0);
    });
  });

  describe("User language resolution", () => {
    it("uses user's stored language for reply", async () => {
      const handler = createUndoHandler(userRepo, karmaRepo, {
        groupChatId: -123,
        adminTelegramId: 697027219,
        supportContact: "@apalevich",
        defaultLanguage: "en",
      });

      // Set user2's language to Russian
      userRepo.setLanguage(2, "ru");

      const exchangeId = karmaRepo.credit(2, 3, -123, 100);
      karmaRepo.setAnnouncementMessageId(exchangeId, 200);

      // Admin tries to undo, but from user2's context (non-admin, so forbidden)
      const replies: string[] = [];
      const ctx = {
        chat: { id: -123 },
        from: { id: 2 }, // Not admin, language is Russian
        message: {
          text: "Undo",
          reply_to_message: { message_id: 200, from: { id: 697027219 } },
        },
        reply: async (msg: string) => replies.push(msg),
      } as any;

      await handler(ctx, async () => {});

      expect(replies.length).toBe(1);
      // Russian message should contain Cyrillic characters
      expect(replies[0]).toMatch(/[а-яА-Я]/);
    });
  });
});
