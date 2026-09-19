import { Bot } from "grammy";
import { initializeDatabase } from "./db";
import { UserRepository } from "./repo/users";
import { KarmaRepository } from "./repo/karma";
import { createNonMemberGate } from "./features/gate";
import { resolveLookupTarget } from "./features/lookup";
import { createKarmaScannerHandler } from "./features/exchange";
import { createUndoHandler } from "./features/undo";
import { createLanguageCommand, createLanguageCallbackHandler } from "./features/language";
import { buildProfile } from "./features/profile";
import { t, type Language } from "./i18n";

// Load environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_PATH = process.env.DB_PATH || "./data/bot.sqlite";
const GROUP_CHAT_ID = parseInt(process.env.GROUP_CHAT_ID || "0");
const KARMA_TRIGGERS = process.env.KARMA_TRIGGERS || "обменялись";
const KARMA_DEDUP_HOURS = parseInt(process.env.KARMA_DEDUP_HOURS || "24");
const KARMA_ANNOUNCE = process.env.KARMA_ANNOUNCE === "true";
const ADMIN_TELEGRAM_ID = parseInt(process.env.ADMIN_TELEGRAM_ID || "0");
const DEFAULT_LANGUAGE = (process.env.DEFAULT_LANGUAGE || "en") as Language;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@apalevich";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

if (GROUP_CHAT_ID === 0) {
  console.warn("⚠ GROUP_CHAT_ID not set; karma scanner will not work");
}

if (ADMIN_TELEGRAM_ID === 0) {
  console.warn("⚠ ADMIN_TELEGRAM_ID not set; undo command will be disabled for everyone");
}

// Initialize database
const db = initializeDatabase(DB_PATH);
console.log(`✓ Database initialized at ${DB_PATH}`);

const userRepo = new UserRepository(db);
const karmaRepo = new KarmaRepository(db);

// Initialize bot
const bot = new Bot(BOT_TOKEN);

// Middleware: upsert sender on every message
bot.use((ctx, next) => {
  const from = ctx.from;
  if (from) {
    userRepo.upsertSeenUser(from.id, from.username, from.first_name, from.last_name);
  }
  return next();
});

// Middleware: non-member DM gate (before all other DM handlers)
bot.use(createNonMemberGate(userRepo, DEFAULT_LANGUAGE, SUPPORT_CONTACT));

// Command: /check (in group or DM)
bot.command("check", async (ctx) => {
  const userLanguage = (userRepo.getById(ctx.from?.id)?.language || DEFAULT_LANGUAGE) as Language;

  // Debug logging
  const replyTo = ctx.message?.reply_to_message;
  if (replyTo) {
    console.log(`[/check] reply lookup: reply_to.from.id=${replyTo.from?.id}, reply_to.from.username=@${replyTo.from?.username}, chat_type=${ctx.chat?.type}`);
    const found = replyTo.from ? userRepo.getById(replyTo.from.id) : null;
    console.log(`[/check] DB lookup result: ${found ? `found user @${found.username}` : "NOT FOUND"}`);
  } else if (ctx.message?.text) {
    const match = ctx.message.text.match(/@(\w+)/);
    console.log(`[/check] text lookup: username=${match?.[1] ?? "none"}, chat_type=${ctx.chat?.type}`);
  }

  const result = resolveLookupTarget(ctx, userRepo, SUPPORT_CONTACT, userLanguage);
  console.log(`[/check] result: type=${result.type}, found=${result.found}`);

  await ctx.reply(result.message || "");
});

// Command: /language and /lang
bot.command(["language", "lang"], createLanguageCommand(userRepo));

// Callback: language selection
bot.on("callback_query", createLanguageCallbackHandler(userRepo));

// Feature: karma scanner (group message handler)
bot.use(
  createKarmaScannerHandler(userRepo, karmaRepo, {
    groupChatId: GROUP_CHAT_ID,
    karmaTriggers: KARMA_TRIGGERS,
    karmaDedupeHours: KARMA_DEDUP_HOURS,
    karmaAnnounce: KARMA_ANNOUNCE,
    supportLanguage: DEFAULT_LANGUAGE,
  })
);

// Feature: undo karma (admin-only, reply to bot's announcement)
bot.use(
  createUndoHandler(userRepo, karmaRepo, {
    groupChatId: GROUP_CHAT_ID,
    adminTelegramId: ADMIN_TELEGRAM_ID,
    supportContact: SUPPORT_CONTACT,
    defaultLanguage: DEFAULT_LANGUAGE,
  })
);

// Handler for DM forwards and replies (in DMs)
bot.on("message", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  // Only process if it's a forward or reply (not a regular text message with /command)
  if (!ctx.message?.forward_from && !ctx.message?.reply_to_message) return;

  const userLanguage = (userRepo.getById(ctx.from?.id)?.language || DEFAULT_LANGUAGE) as Language;
  const result = resolveLookupTarget(ctx, userRepo, SUPPORT_CONTACT, userLanguage);

  await ctx.reply(result.message || "");
});

// Start the bot
console.log("Starting bot with long-polling...");
bot
  .start()
  .then(() => {
    console.log("✓ Bot connected to Telegram");
    console.log(`✓ Features enabled:`);
    console.log(`  - /check command (reply, @mention, DM)`);
    console.log(`  - /language command (DM)`);
    console.log(`  - Karma scanner (group: "${KARMA_TRIGGERS}")`);
    if (KARMA_ANNOUNCE) console.log(`  - Karma announcements enabled`);
  })
  .catch((err) => {
    console.error("Failed to connect to Telegram:", err);
    process.exit(1);
  });
