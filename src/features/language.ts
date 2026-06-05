import { Context, MiddlewareHandler } from "grammy";
import { UserRepository } from "../repo/users";
import { t, SUPPORTED_LANGUAGES, type Language } from "../i18n";

export function createLanguageCommand(repo: UserRepository): MiddlewareHandler {
  return async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return;
    }

    const userId = ctx.from?.id;
    if (!userId) return;

    // Check if sender is a known member
    const user = repo.getById(userId);
    if (!user) return;

    // List languages
    const buttons = SUPPORTED_LANGUAGES.map((lang) => ({
      text: lang.toUpperCase(),
      callback_data: `lang_${lang}`,
    }));

    const userLang = (user.language as Language) || "en";
    const message = t("language.select", userLang);

    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [buttons],
      },
    });
  };
}

export function createLanguageCallbackHandler(repo: UserRepository): MiddlewareHandler {
  return async (ctx) => {
    const match = ctx.callbackQuery?.data?.match(/^lang_(.+)$/);
    if (!match) return;

    const language = match[1] as Language;
    if (!SUPPORTED_LANGUAGES.includes(language)) return;

    const userId = ctx.from?.id;
    if (!userId) return;

    repo.setLanguage(userId, language);

    const message = t("language.changed", language, { language: language.toUpperCase() });
    await ctx.answerCallbackQuery({ text: message });
  };
}
