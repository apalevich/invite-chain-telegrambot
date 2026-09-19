import { Database } from "bun:sqlite";

export function initializeDatabase(dbPath: string): Database {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  // Migration: create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(lower(username));

    CREATE TABLE IF NOT EXISTS exchanges (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a    INTEGER NOT NULL,
      user_b    INTEGER NOT NULL,
      chat_id   INTEGER,
      message_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_exchanges_pair_time ON exchanges(user_a, user_b, created_at);
  `);

  // Migration: add undo-tracking columns to `exchanges`.
  // SQLite does not support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" syntax,
  // so we check which columns exist first and only add what's missing (idempotent).
  const exchangeColumns = new Set(
    (db.query("PRAGMA table_info(exchanges)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!exchangeColumns.has("announcement_message_id")) {
    db.exec("ALTER TABLE exchanges ADD COLUMN announcement_message_id INTEGER");
  }
  if (!exchangeColumns.has("undone_at")) {
    db.exec("ALTER TABLE exchanges ADD COLUMN undone_at TEXT");
  }

  return db;
}
