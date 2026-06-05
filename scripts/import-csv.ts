import { initializeDatabase } from "../src/db";
import { readFileSync } from "fs";
import { resolve } from "path";

interface CSVRow {
  telegram_id: string;
  username: string;
  first_name: string;
  last_name: string;
  invited_by: string;
  joined_at: string;
  comment: string;
}

async function importCSV(csvPath: string) {
  const dbPath = process.env.DB_PATH || "./data/bot.sqlite";
  const db = initializeDatabase(dbPath);

  const csvContent = readFileSync(csvPath, "utf-8");
  const lines = csvContent.trim().split("\n");
  const header = lines[0].split(",");

  const rows: CSVRow[] = lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: any = {};
    header.forEach((key, i) => {
      row[key] = values[i];
    });
    return row;
  });

  console.log(`Importing ${rows.length} rows from ${csvPath}...`);

  // Track validation
  let rootCount = 0;
  const usernames = new Set<string>();
  const orphanErrors: string[] = [];
  const duplicateWarnings: string[] = [];

  // First pass: validation
  for (const row of rows) {
    const username = row.username.replace(/^@/, "").toLowerCase();

    if (!row.invited_by) {
      rootCount++;
    }

    if (usernames.has(username)) {
      duplicateWarnings.push(`Username @${username} appears multiple times`);
    }
    usernames.add(username);
  }

  // Check invited_by references
  const telegramIds = new Set(rows.map((r) => r.telegram_id));
  for (const row of rows) {
    if (row.invited_by && !telegramIds.has(row.invited_by)) {
      orphanErrors.push(`User ${row.telegram_id} references non-existent inviter ${row.invited_by}`);
    }
  }

  // Upsert all users
  const insertStmt = db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, invited_by, joined_at, karma, language, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      invited_by = excluded.invited_by,
      joined_at = excluded.joined_at,
      comment = excluded.comment
  `);

  const transaction = db.transaction(() => {
    for (const row of rows) {
      const username = row.username.replace(/^@/, "") || null;
      const lastName = row.last_name && row.last_name !== "?" ? row.last_name : null;
      const invitedBy = row.invited_by || null;
      const comment = row.comment || null;

      insertStmt.run(
        row.telegram_id,
        username,
        row.first_name || null,
        lastName,
        invitedBy,
        row.joined_at,
        0,
        "en",
        comment
      );
    }
  });

  transaction();

  // Report results
  console.log(`\n✓ Imported ${rows.length} members`);
  console.log(`✓ Found ${rootCount} root(s)`);
  console.log(`✓ Found ${orphanErrors.length} orphan(s)`);

  if (duplicateWarnings.length > 0) {
    console.warn("\n⚠ Duplicate username warnings:");
    duplicateWarnings.forEach((w) => console.warn(`  - ${w}`));
  }

  if (orphanErrors.length > 0) {
    console.error("\n✗ Orphan invited_by references:");
    orphanErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  if (rootCount !== 1) {
    console.error(`\n✗ Expected exactly 1 root, found ${rootCount}`);
    process.exit(1);
  }

  // Verify the import
  const count = db.query("SELECT COUNT(*) as count FROM users").get() as any;
  console.log(`\n✓ Total users in database: ${count.count}`);

  db.close();
}

const csvPath = process.argv[2] || "./public_telegram_users.csv";
importCSV(csvPath).catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
