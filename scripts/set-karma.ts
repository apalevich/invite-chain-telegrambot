import { initializeDatabase } from "../src/db";
import { UserRepository } from "../src/repo/users";

async function setKarma() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: bun run scripts/set-karma.ts <telegram_id> <+N|-N|=N>");
    console.error("  Examples:");
    console.error("    bun run scripts/set-karma.ts 697027219 +5    # Add 5 karma");
    console.error("    bun run scripts/set-karma.ts 697027219 -3    # Subtract 3 karma");
    console.error("    bun run scripts/set-karma.ts 697027219 =10   # Set to 10 karma");
    process.exit(1);
  }

  const telegramId = parseInt(args[0]);
  const deltaStr = args[1];

  if (isNaN(telegramId)) {
    console.error("Invalid telegram_id:", args[0]);
    process.exit(1);
  }

  const dbPath = process.env.DB_PATH || "./data/bot.sqlite";
  const db = initializeDatabase(dbPath);
  const repo = new UserRepository(db);

  const user = repo.getById(telegramId);
  if (!user) {
    console.error(`User ${telegramId} not found`);
    process.exit(1);
  }

  let newKarma: number;

  if (deltaStr.startsWith("=")) {
    // Set absolute value
    newKarma = parseInt(deltaStr.slice(1));
    if (isNaN(newKarma)) {
      console.error("Invalid karma value:", deltaStr);
      process.exit(1);
    }
  } else if (deltaStr.startsWith("+")) {
    // Add
    const delta = parseInt(deltaStr.slice(1));
    if (isNaN(delta)) {
      console.error("Invalid delta:", deltaStr);
      process.exit(1);
    }
    newKarma = user.karma + delta;
  } else if (deltaStr.startsWith("-")) {
    // Subtract
    const delta = parseInt(deltaStr.slice(1));
    if (isNaN(delta)) {
      console.error("Invalid delta:", deltaStr);
      process.exit(1);
    }
    newKarma = user.karma - delta;
  } else {
    console.error("Invalid format. Use +N, -N, or =N");
    process.exit(1);
  }

  const stmt = db.prepare("UPDATE users SET karma = ? WHERE telegram_id = ?");
  stmt.run(newKarma, telegramId);

  console.log(`✓ Updated @${user.username || user.first_name || `user${telegramId}`} karma: ${user.karma} → ${newKarma}`);

  db.close();
}

setKarma().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
