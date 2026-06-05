import { Context, MiddlewareHandler } from "grammy";
import { UserRepository } from "../repo/users";
import { t, type Language } from "../i18n";

export function createNonMemberGate(
  repo: UserRepository,
  defaultLanguage: Language,
  supportContact: string
): MiddlewareHandler {
  return async (ctx, next) => {
    // Only apply to private chats
    if (ctx.chat?.type !== "private") {
      return next();
    }

    const senderId = ctx.from?.id;
    if (!senderId) {
      return next();
    }

    // Check if sender is a known member
    const user = repo.getById(senderId);
    if (!user) {
      // Non-member: send the gate message and stop
      const message = t("error.not_member", defaultLanguage, {
        contact: supportContact,
      });
      await ctx.reply(message);
      return;
    }

    // Member: continue to next handler
    return next();
  };
}
