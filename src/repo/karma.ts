import { Database } from "bun:sqlite";

export interface ExchangeRecord {
  id: number;
  user_a: number;
  user_b: number;
  undone_at: string | null;
}

export class KarmaRepository {
  constructor(private db: Database) {}

  withinDedupWindow(user_a: number, user_b: number, dedupHours: number): boolean {
    // Normalize pair order (min, max) for consistent lookup
    const [minId, maxId] = user_a < user_b ? [user_a, user_b] : [user_b, user_a];

    const cutoffTime = new Date(Date.now() - dedupHours * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      SELECT 1 FROM exchanges
      WHERE user_a = ? AND user_b = ? AND created_at > ? AND undone_at IS NULL
      LIMIT 1
    `);

    const result = stmt.get(minId, maxId, cutoffTime);
    return !!result;
  }

  credit(user_a: number, user_b: number, chatId?: number, messageId?: number): number {
    const [minId, maxId] = user_a < user_b ? [user_a, user_b] : [user_b, user_a];
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      // Insert audit row
      const exchangeStmt = this.db.prepare(`
        INSERT INTO exchanges (user_a, user_b, chat_id, message_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = exchangeStmt.run(minId, maxId, chatId || null, messageId || null, now);

      // Increment karma for both users
      const karmaStmt = this.db.prepare(`
        UPDATE users SET karma = karma + 1 WHERE telegram_id = ?
      `);
      karmaStmt.run(user_a);
      karmaStmt.run(user_b);

      return Number(result.lastInsertRowid);
    });

    return transaction();
  }

  setAnnouncementMessageId(exchangeId: number, messageId: number): void {
    const stmt = this.db.prepare(`
      UPDATE exchanges SET announcement_message_id = ? WHERE id = ?
    `);
    stmt.run(messageId, exchangeId);
  }

  findByAnnouncement(chatId: number, announcementMessageId: number): ExchangeRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, user_a, user_b, undone_at FROM exchanges
      WHERE chat_id = ? AND announcement_message_id = ?
      LIMIT 1
    `);
    const result = stmt.get(chatId, announcementMessageId) as ExchangeRecord | undefined;
    return result || null;
  }

  undo(exchangeId: number): boolean {
    const transaction = this.db.transaction(() => {
      const selectStmt = this.db.prepare(`
        SELECT user_a, user_b, undone_at FROM exchanges WHERE id = ?
      `);
      const exchange = selectStmt.get(exchangeId) as { user_a: number; user_b: number; undone_at: string | null } | undefined;

      if (!exchange || exchange.undone_at) {
        return false;
      }

      const now = new Date().toISOString();
      const updateStmt = this.db.prepare(`
        UPDATE exchanges SET undone_at = ? WHERE id = ?
      `);
      updateStmt.run(now, exchangeId);

      // Decrement karma for both users. Note: exchange.user_a/user_b are normalized
      // (min, max) pair order, but since credit() applies +1 symmetrically to both,
      // decrementing them is equivalent to reverting the original author/counterparty.
      const karmaStmt = this.db.prepare(`
        UPDATE users SET karma = karma - 1 WHERE telegram_id = ?
      `);
      karmaStmt.run(exchange.user_a);
      karmaStmt.run(exchange.user_b);

      return true;
    });

    return transaction();
  }
}
