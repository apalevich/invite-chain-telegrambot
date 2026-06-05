import { en, type EnLocaleKey } from "./en";
import { ru, type RuLocaleKey } from "./ru";

export type Language = "en" | "ru";
type LocaleKey = EnLocaleKey & RuLocaleKey;

const locales: Record<Language, Record<LocaleKey, string>> = {
  en,
  ru,
};

export function t(key: LocaleKey, language: Language, vars?: Record<string, string>): string {
  const locale = locales[language] || locales.en;
  let text = locale[key] || key;

  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, v);
    });
  }

  return text;
}

export const SUPPORTED_LANGUAGES: Language[] = ["en", "ru"];
