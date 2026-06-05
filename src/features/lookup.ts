import { Context } from "grammy";
import { UserRepository } from "../repo/users";
import { buildProfile } from "./profile";
import { t, type Language } from "../i18n";

export interface LookupResult {
  found: boolean;
  type: "success" | "not_found" | "forward_hidden";
  message?: string;
}

export function resolveLookupTarget(
  ctx: Context,
  repo: UserRepository,
  supportContact: string,
  userLanguage: Language
): LookupResult {
  // Method 1: Reply-based lookup in group
  if (ctx.message?.reply_to_message) {
    const repliedToUser = ctx.message.reply_to_message.from;
    if (!repliedToUser) {
      return {
        found: false,
        type: "not_found",
        message: t("error.no_record", userLanguage),
      };
    }

    const user = repo.getById(repliedToUser.id);
    if (!user) {
      return {
        found: false,
        type: "not_found",
        message: t("error.no_record", userLanguage),
      };
    }

    return {
      found: true,
      type: "success",
      message: buildProfile(user, repo, userLanguage, supportContact),
    };
  }

  // Method 2 & 3: /check @user (in group or DM)
  if (ctx.message?.text) {
    const match = ctx.message.text.match(/@(\w+)/);
    if (match) {
      const username = match[1];
      const user = repo.getByUsername(username);
      if (!user) {
        return {
          found: false,
          type: "not_found",
          message: t("error.no_record", userLanguage),
        };
      }

      return {
        found: true,
        type: "success",
        message: buildProfile(user, repo, userLanguage, supportContact),
      };
    }
  }

  // Method 4: DM forward
  if (ctx.message?.forward_from) {
    const originalSender = ctx.message.forward_from;
    const user = repo.getById(originalSender.id);
    if (!user) {
      return {
        found: false,
        type: "not_found",
        message: t("error.no_record", userLanguage),
      };
    }

    return {
      found: true,
      type: "success",
      message: buildProfile(user, repo, userLanguage, supportContact),
    };
  }

  // Method 4 sub-case: forward with privacy enabled
  if (ctx.message?.forward_sender_name) {
    return {
      found: false,
      type: "forward_hidden",
      message: t("error.forward_hidden", userLanguage),
    };
  }

  return {
    found: false,
    type: "not_found",
    message: t("error.no_record", userLanguage),
  };
}
