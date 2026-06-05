import { Bot } from "grammy";
import { initializeDatabase } from "./db";

// Load environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_PATH = process.env.DB_PATH || "./data/bot.sqlite";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

// Initialize database
const db = initializeDatabase(DB_PATH);
console.log(`✓ Database initialized at ${DB_PATH}`);

// Initialize bot
const bot = new Bot(BOT_TOKEN);

// Basic middleware to log messages
bot.on("message", (ctx) => {
  console.log(`Message from ${ctx.from?.username || ctx.from?.first_name}: ${ctx.message?.text || "(non-text)"}`);
});

// Start the bot
console.log("Starting bot with long-polling...");
bot.start()
  .then(() => console.log("✓ Bot connected to Telegram"))
  .catch((err) => {
    console.error("Failed to connect to Telegram:", err);
    process.exit(1);
  });
