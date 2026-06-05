import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UserRepository } from "../repo/users";
import { resolveLookupTarget } from "./lookup";

describe("Lookup", () => {
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

    // Set up test data
    const stmt = db.prepare(
      "INSERT INTO users (telegram_id, username, first_name, invited_by, joined_at) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(1, "founder", "Founder", null, "2024-01-01T00:00:00Z");
    stmt.run(2, "user2", "User2", 1, "2024-01-02T00:00:00Z");
  });

  afterEach(() => {
    db.close();
  });

  describe("Acceptance criteria from SPEC §5.2", () => {
    it("reply-based lookup in group returns replied-to user's profile", () => {
      const ctx = {
        message: {
          reply_to_message: {
            from: {
              id: 2,
              first_name: "User2",
            },
          },
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(true);
      expect(result.type).toBe("success");
      expect(result.message).toContain("Invitation chain: @user2");
      expect(result.message).toContain("@founder");
    });

    it("/check @user returns user's profile if username is in map", () => {
      const ctx = {
        message: {
          text: "/check @user2",
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(true);
      expect(result.type).toBe("success");
      expect(result.message).toContain("@user2");
    });

    it("/check @user returns 'no record' if username not in map", () => {
      const ctx = {
        message: {
          text: "/check @unknownuser",
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(false);
      expect(result.type).toBe("not_found");
      expect(result.message).toBe("I have no record of this user.");
    });

    it("/check @user works in DM", () => {
      const ctx = {
        message: {
          text: "/check @user2",
          chat: { type: "private" },
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(true);
      expect(result.type).toBe("success");
      expect(result.message).toContain("@user2");
    });

    it("forwarding a message in DM returns original sender's profile", () => {
      const ctx = {
        message: {
          forward_from: {
            id: 2,
            first_name: "User2",
          },
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(true);
      expect(result.type).toBe("success");
      expect(result.message).toContain("@user2");
    });

    it("forward with privacy enabled returns distinct 'hidden identity' message", () => {
      const ctx = {
        message: {
          forward_sender_name: "Anonymous User",
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(false);
      expect(result.type).toBe("forward_hidden");
      expect(result.message).toContain("hides their forwarded-message identity");
    });

    it("querying user not in members table returns 'no record' even if bot has seen them", () => {
      const ctx = {
        message: {
          reply_to_message: {
            from: {
              id: 999,
              first_name: "UnknownUser",
            },
          },
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "en");

      expect(result.found).toBe(false);
      expect(result.type).toBe("not_found");
      expect(result.message).toBe("I have no record of this user.");
    });
  });

  describe("Locale support", () => {
    it("returns localized error messages in Russian", () => {
      const ctx = {
        message: {
          text: "/check @unknown",
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "ru");

      expect(result.type).toBe("not_found");
      expect(result.message).toBe("У меня нет записи об этом пользователе.");
    });

    it("returns localized forward-hidden message in Russian", () => {
      const ctx = {
        message: {
          forward_sender_name: "Anonymous",
        },
      } as any;

      const result = resolveLookupTarget(ctx, repo, "@founder", "ru");

      expect(result.type).toBe("forward_hidden");
      expect(result.message).toContain("скрывает свою личность");
    });
  });
});
