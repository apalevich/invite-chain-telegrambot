import { UserRepository, type User } from "../repo/users";
import { t, type Language } from "../i18n";

export function formatKarmaSign(karma: number): string {
  if (karma >= 1) return `+${karma}`;
  if (karma <= -1) return `${karma}`;
  return "0";
}

export function buildChainString(repo: UserRepository, telegram_id: number): string {
  const chain = repo.chain(telegram_id);
  const names = chain.map((id) => {
    const user = repo.getById(id);
    if (!user) return `<${id}>`;
    return "@" + (user.username || user.first_name || `user${id}`);
  });
  return names.join(" ⬅️ ");
}

export function formatJoinedDate(iso8601: string, locale: Language): string {
  const date = new Date(iso8601);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru" : "en", {
    dateStyle: "long",
  }).format(date);
}

export function buildProfile(
  user: User,
  repo: UserRepository,
  language: Language,
  supportContact: string
): string {
  const joinedDate = formatJoinedDate(user.joined_at, language);
  const chain = buildChainString(repo, user.telegram_id);
  const karma = formatKarmaSign(user.karma);

  const lines = [
    t("profile.joined", language, { date: joinedDate }),
    "",
    t("profile.chain", language, { chain }),
    "",
    t("profile.karma", language, { karma }),
    "",
    t("profile.footer", language, { contact: supportContact }),
  ];

  return lines.join("\n");
}
