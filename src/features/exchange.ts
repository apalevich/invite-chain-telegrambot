import { Context, MiddlewareHandler } from "grammy";
import { UserRepository } from "../repo/users";
import { KarmaRepository } from "../repo/karma";
import { t, type Language } from "../i18n";

function parseKarmaTriggers(triggersEnv: string): string[] {
  return triggersEnv.split(",").map((t) => t.trim().toLowerCase());
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

function resolveCounterparty(ctx: Context): number | null {
  // Method 1: Reply to a user
  if (ctx.message?.reply_to_message?.from?.id) {
    return ctx.message.reply_to_message.from.id;
  }

  // Method 2: First @mention
  if (ctx.message?.text) {
    const matches = ctx.message.text.match(/@(\w+)/g);
    if (matches && matches.length > 0) {
      // Extract usernames and try to resolve (would need repo access)
      return null; // Will be resolved in the handler with repo
    }
  }

  return null;
}

function resolveCounterpartyUsername(ctx: Context, userRepo: UserRepository): number | null {
  // Method 1: Reply to a user
  if (ctx.message?.reply_to_message?.from?.id) {
    return ctx.message.reply_to_message.from.id;
  }

  // Method 2: First @mention that resolves to a known member
  if (ctx.message?.text) {
    const matches = ctx.message.text.match(/@(\w+)/g);
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
      if (ctx.message?.text) {
        console.log(`[karma] skipped: chat.id=${ctx.chat?.id} (configured groupChatId=${config.groupChatId})`);
      }
      return next();
    }

    const messageText = ctx.message?.text;
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
      return next();
    }

    // Check if both are known members
    const authorUser = userRepo.getById(author.id);
    const counterpartyUser = userRepo.getById(counterpartyId);

    if (!authorUser || !counterpartyUser) {
      return next();
    }

    // Check dedup window
    if (karmaRepo.withinDedupWindow(author.id, counterpartyId, config.karmaDedupeHours)) {
      return next();
    }

    // Credit karma
    karmaRepo.credit(author.id, counterpartyId, ctx.chat?.id, ctx.message?.message_id);

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
