# Tech Spec — Telegram Invitation-Chain & Karma Bot

**Status:** Ready for implementation
**Owner:** @apalevich
**Runtime:** Bun + grammY + `bun:sqlite`, long-polling, hosted on Ubuntu VPS under pm2
**Audience:** Claude Code (this document is the build brief; pair it with the `CLAUDE.md` to be generated separately)

---

## 1. Problem Statement

A private Telegram group runs peer-to-peer currency exchange. Trust depends on knowing who vouched for whom (the invitation chain back to the group founder) and on each member's track record of completed exchanges. Today this lives in people's heads and a Supabase table; members cannot self-serve either fact inside Telegram. The bot exposes both — invitation provenance and a running "karma" reputation score — directly in the chat.

## 2. Goals

1. Any member can look up any member's **invitation chain** (newest → founder) and **karma** from inside Telegram, via four invocation methods.
2. Karma is maintained **automatically** by watching the group for completed exchanges (the word **"обменялись"**) and crediting both parties, with anti-gaming guards.
3. All member data is **self-hosted** alongside the bot in a single SQLite file — no external database, no third-party data processor.
4. Responses are **internationalized**; each member picks their language in DM (English default).
5. The project ships with a **`CLAUDE.md`** good enough that the founder can maintain and extend it entirely through Claude Code.

## 3. Non-Goals (v1)

1. **No new-member onboarding / invite tracking.** The group does not add outsiders in scope; the invitation graph is seeded once from the CSV and is otherwise static. Auto-detecting joins (which Telegram only partially supports anyway) is explicitly out.
2. **No resolving arbitrary @usernames the bot has never seen.** The Bot API cannot turn an unknown `@username` into a user. Username lookup is best-effort against a stored map (see §6.2). This is a platform limit, not a deferral.
3. **No karma *decrement* mechanism in the bot.** Negative karma is set by the admin editing the database directly (§5.4). No "negative trigger word" in v1.
4. **No web server, webhook, public domain, or TLS.** Long-polling only. Express/Cloudflare are dropped.
5. **No moderation, banning, or message deletion.** The bot reads and reacts; it does not police the group.

## 4. Users & Invocation

There is one role: **member** (every user already in the group). The admin (@apalevich) is a member with extra rights exercised via direct DB access, not special bot commands in v1.

A member can request another user's profile (chain + karma) four ways:

| # | Where | How | How the target is identified |
|---|-------|-----|------------------------------|
| 1 | Group | Bot command **as a reply** to a message (e.g. `/check`) | `reply_to_message.from` → reliable `user_id` |
| 2 | Group | Bot command **with a username arg** (`/check @user`) | username → `user_id` via stored map (§6.2) |
| 3 | DM | Command **with a username arg** (`/check @user`) | same stored map |
| 4 | DM | **Forwarding** the target's message to the bot | `forward_from` → `user_id`, *if* the original sender allows it |

The bot **replies in the language of the invoking member** (§7).

### Result shape

**Positive** (target is a known member) — matches the requested format:

```
User joined on January 16 2024

Invitation chain: @givenuser ⬅️ @johndoe ⬅️ @janedoe ⬅️ @apalevich

Karma: +5

Experience a problem? Contact @apalevich
```

Rules:
- Chain ordered **target → inviter → … → founder**, joined with ` ⬅️ `.
- Karma sign: `+N` when ≥ 1, `-N` when ≤ -1, plain `0` for zero.
- A node with no username falls back to its first name.
- Support-contact handle (`@apalevich`) is configurable via env.

**Negative** (not a known member, or username/forward unresolvable): a localized "I have no record of this user" message. Method 4 has a distinct sub-case: *forward privacy enabled*, where the bot cannot see who sent the original — localized "this person hides their forwarded-message identity, so I can't look them up."

## 5. Functional Requirements

### 5.1 Invitation chain (P0)
- Built by walking `invited_by` from target to the root.
- **Given** a known member, **when** queried, **then** return the ordered chain to the founder.
- **Given** the founder (no `invited_by`), **then** the chain is just `[@apalevich]`.
- Guard against cycles (defensive — seed data has none): stop if a node repeats.

### 5.2 Profile lookup, 4 methods (P0)
Acceptance criteria:
- [ ] Reply-based lookup in group returns the replied-to user's profile.
- [ ] `/check @user` returns that user's profile if the username is in the map; otherwise the negative "no record" message.
- [ ] Same `/check @user` works in DM.
- [ ] Forwarding a message in DM returns the original sender's profile.
- [ ] Forward with privacy enabled returns the distinct "hidden identity" message, not a generic error.
- [ ] Querying a user who is not in the members table returns the negative message even if the bot has otherwise seen them.

### 5.3 Karma auto-increment (P0)
Trigger detection on **every group message** the bot can read (privacy mode **off**, see §8):
- Match configured trigger word(s), default `["обменялись"]`, **case-insensitively** and accent-insensitively enough to catch `ОБМЕНЯЛИСЬ`, `Обменялись`, etc. Match as a **whole word**, not a substring, to avoid false positives inside longer tokens.
- Identify the **counterparty**:
  - if the message is a **reply**, the counterparty is `reply_to_message.from`;
  - else, the **first `@mention`** in the message text that resolves to a known member.
- Credit **+1 to the author and +1 to the counterparty** when **both are known members**.
- **Ignore self-exchange** (author == counterparty).
- **Ignore** if no resolvable counterparty.
- **Dedup window:** ignore a repeat between the *same unordered pair* within `KARMA_DEDUP_HOURS` (default **24**, env-configurable). The window is per-pair, not per-user.

Acceptance criteria:
- [ ] `"мы обменялись @user"` (author replies or @mentions a member) → both +1.
- [ ] Same pair triggering again within 24h → no change; outside 24h → both +1 again.
- [ ] `"обменялись"` with no counterparty → no change.
- [ ] Author "обменялись" mentioning themselves → no change.
- [ ] `ОБМЕНЯЛИСЬ` / mixed case → still triggers.
- [ ] A word containing the trigger as a substring does not trigger.
- [ ] Counterparty unknown to the members table → no change (and optionally a silent log entry).

**Open question (O-1):** should a successful credit post a short confirmation in the group, or stay silent? Default assumption: **silent**, toggleable via `KARMA_ANNOUNCE` (default `false`).

### 5.4 Manual karma adjustment by admin (P0, out-of-bot)
- Admin edits `users.karma` (or inserts an adjustment row, see §6.1) directly in SQLite.
- Spec ships a documented one-liner / tiny script for this; no bot command in v1.

### 5.5 Language selection (P0)
- `/language` (alias `/lang`) in DM lists supported languages and sets the caller's preference; persisted per `telegram_id`.
- Default **English**. Unknown/unset → English.
- Group replies use the **invoker's** stored language.

### 5.6 Non-member DM gate (P0)
- The bot is for members only. **Before** any DM feature handler runs (`/check`, `/language`, forwarded-message lookup, or any other DM message), check whether the sender's `telegram_id` exists in `users`.
- **Given** a private chat **when** the sender is not a known member **then** reply with the localized equivalent of: `I don't recognize you. Support: @apalevich` and run no further DM logic. The support handle comes from `SUPPORT_CONTACT`. Because non-members have no stored language, this uses `DEFAULT_LANGUAGE`.
- This gate applies to DMs only. The group is invite-only and treated as all-members; group handlers are not gated by this check.

Acceptance criteria:
- [ ] A user not in `users` who DMs the bot anything (text, command, or forward) gets exactly the "I don't recognize you" reply and nothing else.
- [ ] A known member DMing the bot is unaffected.
- [ ] The gate fires regardless of whether the bot has otherwise seen that user in the group.

### 5.7 Username-map upkeep (P0)
- The bot continuously learns/updates `username → telegram_id` from any message, reply, or forward it sees, because Telegram usernames are mutable and the CSV is only a snapshot. `telegram_id` is the stable key.

## 6. Data Model

Single SQLite file `data/bot.sqlite` (path via env), accessed through `bun:sqlite`. WAL mode on.

### 6.1 Schema (DDL intent)

```sql
CREATE TABLE users (
  telegram_id   INTEGER PRIMARY KEY,        -- stable Telegram user id
  username      TEXT,                        -- WITHOUT leading '@', nullable, mutable
  first_name    TEXT,
  last_name     TEXT,
  invited_by    INTEGER REFERENCES users(telegram_id), -- NULL only for the founder
  joined_at     TEXT NOT NULL,               -- ISO 8601 UTC
  karma         INTEGER NOT NULL DEFAULT 0,
  language      TEXT NOT NULL DEFAULT 'en',
  comment       TEXT
);
CREATE INDEX idx_users_username ON users(lower(username));

-- Append-only audit + source of truth for the 24h dedup window.
CREATE TABLE exchanges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a    INTEGER NOT NULL,                -- min(author,counterparty)
  user_b    INTEGER NOT NULL,                -- max(author,counterparty)
  chat_id   INTEGER,
  message_id INTEGER,
  created_at TEXT NOT NULL                    -- ISO 8601 UTC
);
CREATE INDEX idx_exchanges_pair_time ON exchanges(user_a, user_b, created_at);
```

Notes:
- `karma` is stored denormalized for fast reads; every credit also writes an `exchanges` row, so karma is reconstructable and auditable. Manual admin adjustments edit `users.karma` directly (and may optionally note it in `comment`).
- Store usernames **without** the `@`; add it only at render time. Compare case-insensitively.

### 6.2 Username resolution
1. Look up `lower(@arg stripped of '@')` in `users.username`.
2. Hit → use that `telegram_id`.
3. Miss → negative "no record" response. (The bot never calls a nonexistent "get user by username" API.)

### 6.3 Seed migration from CSV
- One-time importer reads `db_cluster-…csv` (header: `telegram_id,username,first_name,last_name,invited_by,joined_at,comment`).
- Strip leading `@` from `username`; map empty strings to `NULL`; `karma` seeded to `0`; `language` to `'en'`.
- Idempotent: upsert on `telegram_id` so re-running is safe.
- Validate on import: exactly one row with `invited_by IS NULL`; every non-null `invited_by` exists; warn on duplicates.

## 7. Internationalization

- A `locales/` module: `en` and `ru` to start (ru because the user base and trigger word are Russian; English is the default UI). Structure as flat key→string maps with positional/named interpolation.
- All user-facing strings (profile template, negative cases, `/language` menu, errors) come from locale files — **no hardcoded copy** in handlers.
- Dates: format `joined_at` with `Intl.DateTimeFormat(locale, { dateStyle: 'long' })`. Source timestamps are UTC; render in UTC (note in O-2 whether a fixed display TZ is wanted).
- Adding a language = adding one file; document this in `CLAUDE.md`.

## 8. Telegram / Platform Setup (hard requirements)

1. **Disable group privacy** for the bot in BotFather (`/setprivacy` → Disable) so it receives all group messages — required for trigger detection and username-map upkeep.
2. Bot must be a **member (ideally admin)** of the group.
3. **Long-polling** (`bot.start()` in grammY). No public endpoint, domain, or TLS.
4. Commands registered via BotFather / `setMyCommands`: `/check`, `/language`.
5. Forwarded-message lookups depend on the original sender **not** having "forwarded-message privacy" enabled; handle the anonymized case explicitly (§4).

## 9. Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `BOT_TOKEN` | — | BotFather token (required) |
| `DB_PATH` | `./data/bot.sqlite` | SQLite file location |
| `GROUP_CHAT_ID` | — | The exchange group's chat id (scope karma watching to it) |
| `KARMA_TRIGGERS` | `обменялись` | Comma-separated trigger words (whole-word, case-insensitive) |
| `KARMA_DEDUP_HOURS` | `24` | Per-pair cooldown window |
| `KARMA_ANNOUNCE` | `false` | Post a confirmation on credit (O-1) |
| `DEFAULT_LANGUAGE` | `en` | Fallback UI language |
| `SUPPORT_CONTACT` | `@apalevich` | Handle shown in the footer |

## 10. Architecture

```
src/
  index.ts            # bootstrap: load env, open DB, start grammY long-poll
  db.ts               # bun:sqlite connection, migrations, prepared statements
  repo/
    users.ts          # getByUsername, getById, chain(), upsertFromUpdate()
    karma.ts          # credit(pair), withinDedupWindow(pair)
  features/
    profile.ts        # build profile (chain + karma) -> localized string
    lookup.ts         # the 4 invocation methods -> resolve target user
    exchange.ts       # message scanner: trigger match + counterparty + credit
    language.ts       # /language command
  i18n/
    index.ts          # t(key, lang, vars)
    en.ts  ru.ts
scripts/
  import-csv.ts       # one-time seed (§6.3)
  set-karma.ts        # admin helper for manual adjustment (§5.4)
data/
  bot.sqlite          # gitignored
```

- **No web server.** grammY's long-poll loop is the only listener.
- Every inbound update passes through a lightweight middleware that upserts the sender's `username/first_name/last_name` into the map before feature handlers run.

## 11. Deployment — Bun + pm2 alongside Node apps

Because you already run Node apps under pm2 on this VPS, the goal is to add Bun without disturbing them. pm2 can launch a Bun process by pointing its `interpreter` at the Bun binary.

**Install Bun (per-user, does not touch system Node):**
```bash
curl -fsSL https://bun.sh/install | bash
# adds ~/.bun/bin to PATH; reload shell or: export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

**Project setup:**
```bash
cd /path/to/project
bun install
bun run scripts/import-csv.ts ./db_cluster-…csv   # one-time seed
```

**pm2 via an ecosystem file** (keeps Node apps untouched; this entry uses Bun as the interpreter):
```js
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "exchange-bot",
    script: "src/index.ts",
    interpreter: process.env.HOME + "/.bun/bin/bun",
    env: { /* or use a .env file loaded in index.ts */ }
  }]
};
```
```bash
pm2 start ecosystem.config.cjs
pm2 save          # persist across reboots (you likely already have pm2 startup configured)
pm2 logs exchange-bot
```

Validation: `pm2 list` shows `exchange-bot` online next to existing Node apps; existing apps keep their own interpreters and are unaffected.

## 12. Success / Acceptance

This is a personal tool, so success = correctness, not adoption metrics. The build is "done" when:
- [ ] CSV import produces 62 members, one root, no orphan `invited_by`.
- [ ] All four lookup methods pass §5.2 acceptance criteria, in both `en` and `ru`.
- [ ] Karma trigger passes all §5.3 criteria including the 24h per-pair window and case-insensitivity.
- [ ] `/language` switches and persists per user; group replies honor the invoker's language.
- [ ] A non-member DMing the bot gets only the "I don't recognize you" reply (§5.6).
- [ ] Manual karma edit via the admin script is reflected on next lookup.
- [ ] Runs under pm2 with Bun without affecting existing Node apps; survives a reboot.

## 13. Open Questions

| ID | Question | Owner | Blocking? |
|----|----------|-------|-----------|
| O-1 | Announce karma credits in-group, or stay silent? (default: silent, env-toggled) | @apalevich | No |
| O-2 | Render `joined_at` in UTC or a fixed display timezone (e.g. Europe/…)? | @apalevich | No |
| O-3 | Should the trigger also fire on singular forms (`обменялся`/`обменялась`)? Easy to add to `KARMA_TRIGGERS`. | @apalevich | No |
| O-4 | When `/check @user` matches a member who has since changed their username, show current stored username or also note the old one? (default: current) | @apalevich | No |
| O-5 | Counterparty resolution when a message @mentions several members — first mention only, or all pairs? (default: first only) | @apalevich | No |

## 14. Future Considerations (P2 — design-compatible, not built)

- Re-introduce invitation tracking for genuinely new members (would lean on the `new_chat_members` join event + an inviter-confirm command, given Telegram's limits).
- Admin bot commands for karma adjustment (wraps §5.4 so no shell access needed).
- Karma history view (the `exchanges` table already supports it).
- A negative trigger word / dispute flow to lower karma in-bot.
