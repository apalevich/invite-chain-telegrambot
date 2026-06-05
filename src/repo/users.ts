import { Database } from "bun:sqlite";

export interface User {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  invited_by: number | null;
  joined_at: string;
  karma: number;
  language: string;
  comment: string | null;
}

export class UserRepository {
  constructor(private db: Database) {}

  getById(telegram_id: number): User | null {
    const stmt = this.db.prepare("SELECT * FROM users WHERE telegram_id = ?");
    return (stmt.get(telegram_id) as User) || null;
  }

  getByUsername(username: string): User | null {
    const normalized = username.replace(/^@/, "").toLowerCase();
    const stmt = this.db.prepare("SELECT * FROM users WHERE lower(username) = ?");
    return (stmt.get(normalized) as User) || null;
  }

  chain(telegram_id: number): number[] {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current = telegram_id;

    while (current !== null && !seen.has(current)) {
      chain.push(current);
      seen.add(current);

      const user = this.getById(current);
      if (!user) break;
      current = user.invited_by;
    }

    return chain;
  }

  upsertSeenUser(
    telegram_id: number,
    username: string | null,
    first_name: string | null,
    last_name: string | null
  ): void {
    const normalized_username = username ? username.replace(/^@/, "") : null;

    const stmt = this.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, joined_at, karma, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = COALESCE(excluded.username, username),
        first_name = COALESCE(excluded.first_name, first_name),
        last_name = COALESCE(excluded.last_name, last_name)
    `);

    stmt.run(
      telegram_id,
      normalized_username,
      first_name,
      last_name,
      new Date().toISOString(),
      0,
      "en"
    );
  }

  setLanguage(telegram_id: number, language: string): void {
    const stmt = this.db.prepare("UPDATE users SET language = ? WHERE telegram_id = ?");
    stmt.run(language, telegram_id);
  }
}
