import { Context, MiddlewareHandler } from "grammy";
import { UserRepository } from "../repo/users";
import { KarmaRepository } from "../repo/karma";
import { formatDisplayName } from "./exchange";
import { t, type Language } from "../i18n";

export function createUndoHandler(
  userRepo: UserRepository,
  karmaRepo: KarmaRepository,
  config: {
    groupChatId: number;
    adminTelegramId: number;
    supportContact: string;
    defaultLanguage: Language;
  }
): MiddlewareHandler {
  return async (ctx, next) => {
    // Only process messages in the group
    if (ctx.chat?.id !== config.groupChatId) {
      return next();
    }

    // Check if the message is exactly "undo" (case-insensitive, trimmed)
    const messageText = ctx.message?.text;
    if (!messageText || messageText.trim().toLowerCase() !== "undo") {
      return next();
    }

    // Must be a reply to another message
    const replyTo = ctx.message?.reply_to_message;
    if (!replyTo) {
      return next();
    }

    // Look up the exchange by the announcement message id
    const exchange = karmaRepo.findByAnnouncement(ctx.chat.id, replyTo.message_id);
    if (!exchange) {
      // Silent no-op if no matching exchange found (e.g., reply to an unrelated message)
      return next();
    }

    // Resolve the replying user's language preference
    const userLanguage = (userRepo.getById(ctx.from?.id)?.language || config.defaultLanguage) as Language;

    // Check if the user is the admin
    if (ctx.from?.id !== config.adminTelegramId) {
      await ctx.reply(t("karma.undo_forbidden", userLanguage, { admin: config.supportContact }));
      return next();
    }

    // Attempt the undo
    const success = karmaRepo.undo(exchange.id);

    if (!success) {
      await ctx.reply(t("karma.undo_already_done", userLanguage));
      return next();
    }

    // Undo succeeded — look up the users and send confirmation
    const user_a = userRepo.getById(exchange.user_a);
    const user_b = userRepo.getById(exchange.user_b);

    const nameA = user_a ? formatDisplayName(user_a) : `user${exchange.user_a}`;
    const nameB = user_b ? formatDisplayName(user_b) : `user${exchange.user_b}`;

    await ctx.reply(t("karma.undo_success", userLanguage, { user1: nameA, user2: nameB }));

    return next();
  };
}
