import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { UserRepository } from "../repo/users";
import { formatKarmaSign, buildChainString, formatJoinedDate, buildProfile } from "./profile";

describe("Profile", () => {
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
  });

  afterEach(() => {
    db.close();
  });

  describe("Karma sign formatting", () => {
    it("formats positive karma with + sign", () => {
      expect(formatKarmaSign(5)).toBe("+5");
      expect(formatKarmaSign(1)).toBe("+1");
    });

    it("formats negative karma with - sign", () => {
      expect(formatKarmaSign(-5)).toBe("-5");
      expect(formatKarmaSign(-1)).toBe("-1");
    });

    it("formats zero karma as plain 0", () => {
      expect(formatKarmaSign(0)).toBe("0");
    });
  });

  describe("Chain building", () => {
    it("builds founder chain (single user)", () => {
      const stmt = db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, joined_at) VALUES (?, ?, ?, ?)"
      );
      stmt.run(1, "apalevich", "Artem", "2024-01-01T00:00:00Z");

      const chain = buildChainString(repo, 1);
      expect(chain).toBe("@apalevich");
    });

    it("builds depth-5 chain", () => {
      const stmt = db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, invited_by, joined_at) VALUES (?, ?, ?, ?, ?)"
      );

      // Create chain: 5 <- 4 <- 3 <- 2 <- 1 (founder)
      stmt.run(1, "founder", "Founder", null, "2024-01-01T00:00:00Z");
      stmt.run(2, "user2", "User2", 1, "2024-01-02T00:00:00Z");
      stmt.run(3, "user3", "User3", 2, "2024-01-03T00:00:00Z");
      stmt.run(4, "user4", "User4", 3, "2024-01-04T00:00:00Z");
      stmt.run(5, "user5", "User5", 4, "2024-01-05T00:00:00Z");

      const chain = buildChainString(repo, 5);
      expect(chain).toBe("@user5 ⬅️ @user4 ⬅️ @user3 ⬅️ @user2 ⬅️ @founder");
    });

    it("guards against cycles", () => {
      const stmt = db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, invited_by, joined_at) VALUES (?, ?, ?, ?, ?)"
      );

      stmt.run(1, "user1", "User1", 2, "2024-01-01T00:00:00Z");
      stmt.run(2, "user2", "User2", 1, "2024-01-02T00:00:00Z");

      // This should not hang; cycle guard should stop it
      const chain = buildChainString(repo, 1);
      expect(chain).toContain("@user1");
      expect(chain).toContain("@user2");
    });

    it("falls back to first_name when username is missing", () => {
      const stmt = db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, invited_by, joined_at) VALUES (?, ?, ?, ?, ?)"
      );

      stmt.run(1, null, "Artem", null, "2024-01-01T00:00:00Z");
      stmt.run(2, null, "John", 1, "2024-01-02T00:00:00Z");

      const chain = buildChainString(repo, 2);
      expect(chain).toBe("@John ⬅️ @Artem");
    });
  });

  describe("Date formatting", () => {
    it("formats dates in English locale", () => {
      const date = formatJoinedDate("2024-01-15T00:00:00Z", "en");
      expect(date).toMatch(/January 15, 2024/);
    });

    it("formats dates in Russian locale", () => {
      const date = formatJoinedDate("2024-01-15T00:00:00Z", "ru");
      expect(date).toMatch(/15.*2024/);
    });
  });

  describe("Full profile", () => {
    it("builds profile for founder in English", () => {
      const stmt = db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, joined_at) VALUES (?, ?, ?, ?)"
      );
      stmt.run(1, "apalevich", "Artem", "2024-01-01T00:00:00Z");

      const user = {
        telegram_id: 1,
        username: "apalevich",
        first_name: "Artem",
        last_name: null,
        invited_by: null,
        joined_at: "2024-01-01T00:00:00Z",
        karma: 0,
        language: "en",
        comment: null,
      };

      const profile = buildProfile(user, repo, "en", "@apalevich");
      expect(profile).toContain("User joined on");
      expect(profile).toContain("Invitation chain: @apalevich");
      expect(profile).toContain("Karma: 0");
    });
  });
});
