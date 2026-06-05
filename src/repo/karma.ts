import { Database } from "bun:sqlite";

export class KarmaRepository {
  constructor(private db: Database) {}

  withinDedupWindow(user_a: number, user_b: number, dedupHours: number): boolean {
    // Normalize pair order (min, max) for consistent lookup
    const [minId, maxId] = user_a < user_b ? [user_a, user_b] : [user_b, user_a];

    const cutoffTime = new Date(Date.now() - dedupHours * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      SELECT 1 FROM exchanges
      WHERE user_a = ? AND user_b = ? AND created_at > ?
      LIMIT 1
    `);

    const result = stmt.get(minId, maxId, cutoffTime);
    return !!result;
  }

  credit(user_a: number, user_b: number, chatId?: number, messageId?: number): void {
    const [minId, maxId] = user_a < user_b ? [user_a, user_b] : [user_b, user_a];
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      // Insert audit row
      const exchangeStmt = this.db.prepare(`
        INSERT INTO exchanges (user_a, user_b, chat_id, message_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      exchangeStmt.run(minId, maxId, chatId || null, messageId || null, now);

      // Increment karma for both users
      const karmaStmt = this.db.prepare(`
        UPDATE users SET karma = karma + 1 WHERE telegram_id = ?
      `);
      karmaStmt.run(user_a);
      karmaStmt.run(user_b);
    });

    transaction();
  }
}
