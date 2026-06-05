import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UserRepository } from "../repo/users";
import { createNonMemberGate } from "./gate";

describe("Non-member DM gate", () => {
  let db: Database;
  let repo: UserRepository;

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
    `);
    repo = new UserRepository(db);

    // Set up test data - one known member
    const stmt = db.prepare(
      "INSERT INTO users (telegram_id, username, first_name, joined_at) VALUES (?, ?, ?, ?)"
    );
    stmt.run(1, "member", "Member", "2024-01-01T00:00:00Z");
  });

  afterEach(() => {
    db.close();
  });

  describe("Acceptance criteria from SPEC §5.6", () => {
    it("non-member DMing gets only 'I don't recognize you' reply and nothing else", async () => {
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "en", "@support");

      const ctx = {
        from: { id: 999 }, // Non-member
        chat: { type: "private" },
        message: { text: "/language" },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await gate(ctx, next);

      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("I don't recognize you");
      expect(nextCalled).toBe(false); // next should not be called
    });

    it("non-member forwarding a message also gets the gate message", async () => {
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "en", "@support");

      const ctx = {
        from: { id: 999 }, // Non-member
        chat: { type: "private" },
        message: {
          forward_from: { id: 1, first_name: "Member" },
        },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await gate(ctx, next);

      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("I don't recognize you");
      expect(nextCalled).toBe(false);
    });

    it("known member DMing is unaffected", async () => {
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "en", "@support");

      const ctx = {
        from: { id: 1 }, // Known member
        chat: { type: "private" },
        message: { text: "/language" },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await gate(ctx, next);

      expect(replies.length).toBe(0); // No reply from gate
      expect(nextCalled).toBe(true); // next should be called
    });

    it("gate fires regardless of whether bot has seen the user in group", async () => {
      // Create a second repo with the same data but simulate a user seen in group but not in members
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "en", "@support");

      const ctx = {
        from: { id: 888 }, // User seen in group but not in members table
        chat: { type: "private" },
        message: { text: "hello" },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await gate(ctx, next);

      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("I don't recognize you");
      expect(nextCalled).toBe(false);
    });
  });

  describe("Locale support", () => {
    it("returns localized error message in Russian", async () => {
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "ru", "@support");

      const ctx = {
        from: { id: 999 }, // Non-member
        chat: { type: "private" },
        message: { text: "/language" },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      const next = async () => {};
      await gate(ctx, next);

      expect(replies.length).toBe(1);
      expect(replies[0]).toContain("Я вас не знаю");
    });
  });

  describe("Edge cases", () => {
    it("doesn't gate group messages", async () => {
      const replies: string[] = [];
      const gate = createNonMemberGate(repo, "en", "@support");

      const ctx = {
        from: { id: 999 }, // Non-member
        chat: { type: "group" },
        message: { text: "hello" },
        reply: async (message: string) => {
          replies.push(message);
        },
      } as any;

      let nextCalled = false;
      const next = async () => {
        nextCalled = true;
      };

      await gate(ctx, next);

      expect(replies.length).toBe(0);
      expect(nextCalled).toBe(true); // next should be called for group
    });
  });
});
