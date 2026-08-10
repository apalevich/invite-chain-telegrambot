import { Context, MiddlewareHandler } from "grammy";
import { UserRepository } from "../repo/users";
import { KarmaRepository } from "../repo/karma";
import { t, type Language } from "../i18n";

function parseKarmaTriggers(triggersEnv: string): string[] {
  return triggersEnv.split(",").map((t) => t.trim().toLowerCase());
}

function extractText(ctx: Context): string | undefined {
  const msg = ctx.message ?? ctx.editedMessage;
  return msg?.text ?? msg?.caption;
}

function triggerMatches(text: string, triggers: string[]): boolean {
  // Split on sentence-ending punctuation, keeping the delimiter to identify questions.
  const parts = text.split(/([.!?]+)/);
  // parts alternates: [segment, delimiter, segment, delimiter, ...]
  for (let i = 0; i < parts.length; i += 2) {
    const delimiter = parts[i + 1] || '';
    if (delimiter.includes('?')) continue; // this segment is a question — skip
    const words = parts[i].toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
    if (words.some((word) => triggers.includes(word))) return true;
  }
  return false;
}

function resolveCounterpartyUsername(ctx: Context, userRepo: UserRepository): number | null {
  const msg = ctx.message ?? ctx.editedMessage;
  const authorId = ctx.from?.id;

  // Method 1: Reply to a user (but skip if replying to self)
  const replyFromId = msg?.reply_to_message?.from?.id;
  if (replyFromId && replyFromId !== authorId) {
    return replyFromId;
  }

  // Method 2: First @mention that resolves to a known member
  const text = extractText(ctx);
  if (text) {
    const matches = text.match(/@(\w+)/g);
    if (matches) {
      for (const mention of matches) {
        const username = mention.slice(1); // Remove @
        const user = userRepo.getByUsername(username);
        if (user) {
          return user.telegram_id;
        }
      }
    }
  }

  return null;
}

export function createKarmaScannerHandler(
  userRepo: UserRepository,
  karmaRepo: KarmaRepository,
  config: {
    groupChatId: number;
    karmaTriggers: string;
    karmaDedupeHours: number;
    karmaAnnounce: boolean;
    supportLanguage?: Language;
  }
): MiddlewareHandler {
  const triggers = parseKarmaTriggers(config.karmaTriggers);

  return async (ctx, next) => {
    // Only process messages in the group
    if (ctx.chat?.id !== config.groupChatId) {
      const text = extractText(ctx);
      if (text) {
        console.log(`[karma] skipped: chat.id=${ctx.chat?.id} (configured groupChatId=${config.groupChatId})`);
      }
      return next();
    }

    const messageText = extractText(ctx);
    if (!messageText) {
      return next();
    }

    const author = ctx.from;
    if (!author) {
      return next();
    }

    // Check if trigger matches
    if (!triggerMatches(messageText, triggers)) {
      return next();
    }

    // Resolve counterparty
    const counterpartyId = resolveCounterpartyUsername(ctx, userRepo);
    console.log(`[karma] trigger matched: author=${ctx.from?.id}, counterparty=${counterpartyId}, text="${messageText.slice(0, 60)}"`);
    if (!counterpartyId) {
      console.log(`[karma] skipped: no counterparty resolved`);
      return next();
    }

    // Ignore self-exchange
    if (author.id === counterpartyId) {
      console.log(`[karma] skipped: self-exchange (author=${author.id})`);
      return next();
    }

    // Check if both are known members
    const authorUser = userRepo.getById(author.id);
    const counterpartyUser = userRepo.getById(counterpartyId);

    if (!authorUser || !counterpartyUser) {
      console.log(`[karma] skipped: unknown member (author=${author.id}, counterparty=${counterpartyId})`);
      return next();
    }

    // Check dedup window
    if (karmaRepo.withinDedupWindow(author.id, counterpartyId, config.karmaDedupeHours)) {
      console.log(`[karma] skipped: dedup window (pair=${author.id},${counterpartyId})`);
      return next();
    }

    // Credit karma
    const msg = ctx.message ?? ctx.editedMessage;
    karmaRepo.credit(author.id, counterpartyId, ctx.chat?.id, msg?.message_id);

    // Optionally announce
    if (config.karmaAnnounce) {
      const authorName = authorUser.username ? `@${authorUser.username}` : authorUser.first_name || `user${author.id}`;
      const counterpartyName = counterpartyUser.username ? `@${counterpartyUser.username}` : counterpartyUser.first_name || `user${counterpartyId}`;
      const announcement = t("karma.credited", config.supportLanguage || "en", {
        user1: authorName,
        user2: counterpartyName,
      });
      await ctx.reply(announcement);
    }

    // Emit the karma credited event and continue
    await next();
  };
}
