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

  return db;
}
