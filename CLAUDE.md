# CLAUDE.md

Guidance for working in this repository with Claude Code. Read this before making changes. The full requirements live in `SPEC.md`; this file is the *how we build and maintain it* companion.

## What this is

A Telegram bot for a private peer-to-peer currency-exchange group. It does two things:
1. Reports any member's **invitation chain** (back to founder `@apalevich`) and **karma**, callable four ways (reply, `/check @user`, DM `/check @user`, DM forward).
2. Watches the group for completed exchanges (the word **обменялись**) and credits **+1 karma** to both parties, with a per-pair 24h cooldown.

It is a personal tool: correctness matters, scale does not. The member graph is static (seeded once from CSV); the bot does not onboard new members in v1.

## Stack

- **Runtime:** Bun (not Node). Use `bun`, `bun install`, `bun run`, `bun test`.
- **Bot framework:** grammY, **long-polling** (`bot.start()`). There is intentionally **no web server, webhook, domain, or TLS**.
- **Storage:** a single SQLite file via **`bun:sqlite`** (`import { Database } from "bun:sqlite"`). No ORM, no external DB.
- **Config:** environment variables (see `SPEC.md` §9). Load them in `src/index.ts`.

Do not reintroduce Express, a webhook server, or any cloud database — they were explicitly designed out.

## Repo layout

```
src/
  index.ts          # bootstrap: env, DB open+migrate, middleware, start long-poll
  db.ts             # bun:sqlite connection, schema migration, prepared statements
  repo/
    users.ts        # getById, getByUsername, chain(), upsertSeenUser()
    karma.ts        # credit(pair, ctx), withinDedupWindow(pair)
  features/
    profile.ts      # assemble chain + karma -> localized profile string
    lookup.ts       # resolve target user from each of the 4 invocation methods
    exchange.ts     # group message scanner: trigger match + counterparty + credit
    language.ts     # /language command
    gate.ts         # non-member DM gate (runs first in private chats)
  i18n/
    index.ts        # t(key, lang, vars)
    en.ts  ru.ts    # locale string maps
scripts/
  import-csv.ts     # one-time / idempotent seed from the Supabase CSV export
  set-karma.ts      # admin: adjust a user's karma from the shell
data/
  bot.sqlite        # gitignored — never commit member data
```

## Commands

```bash
bun install                                   # deps
bun run scripts/import-csv.ts ./members.csv   # seed DB (idempotent upsert)
bun run src/index.ts                           # run locally (long-poll)
bun test                                       # run tests
bun run scripts/set-karma.ts <telegram_id> <delta|=value>   # admin karma edit
```

Deploy is via pm2 with Bun as the interpreter (see `SPEC.md` §11). After code changes on the VPS: `git pull && bun install && pm2 restart exchange-bot`.

## Conventions — follow these

- **`telegram_id` is the only stable key.** Usernames are mutable and optional; never key logic on them.
- **Store usernames without the leading `@`**, lowercased for comparison. Add `@` only when rendering.
- **Timestamps are ISO 8601 UTC** in the DB. Format for display with `Intl.DateTimeFormat(locale, ...)`.
- **No user-facing string is hardcoded in a handler.** Every reply goes through `t(key, lang, vars)` with entries in both `en.ts` and `ru.ts`. Adding copy means adding the key to *both* locales.
- **The non-member DM gate (`features/gate.ts`) runs before any other private-chat handler.** Do not add a DM feature that bypasses it.
- **Every karma credit writes an `exchanges` row** (append-only audit) in addition to updating `users.karma`, so karma is always reconstructable.
- Keep handlers thin; put data access in `repo/` and copy in `i18n/`.

## Common changes (recipes)

**Add a supported language (e.g. `tr`):** create `src/i18n/tr.ts` mirroring every key in `en.ts`; register it in `i18n/index.ts` and in the `/language` menu. Nothing else changes.

**Add/adjust a karma trigger word:** it's data, not code — set `KARMA_TRIGGERS` (comma-separated) in the env. Matching is whole-word and case-insensitive. Only touch `exchange.ts` if you need to change *matching logic* (e.g. add singular forms with different counterparty rules).

**Change the cooldown window:** set `KARMA_DEDUP_HOURS`. It's a per-*pair* window enforced via the `exchanges` table.

**Manually change someone's karma:** `bun run scripts/set-karma.ts <telegram_id> +3` (or `-3`, or `=10` to set absolute). Don't edit the live DB by hand while the bot is running; the script uses the same connection settings.

**Add a member manually (rare, since onboarding is out of scope):** insert a `users` row with a valid `invited_by` that already exists; re-run nothing else. Validate the chain still resolves.

## Platform limits to keep in mind

- **The bot cannot resolve an `@username` it has never seen.** `/check @user` works only against the stored map (seeded from CSV, grown as the bot sees messages). A miss must return the localized "no record" reply — never attempt a nonexistent "get user by username" API.
- **Group privacy mode must be OFF** (BotFather `/setprivacy` → Disable) and the bot must be in the group, or it won't see the messages needed for trigger detection. If karma stops updating, check this first.
- **Forwarded-message lookup fails when the original sender hides forward identity.** Handle that as its own localized case, distinct from "no record".

## Testing

- Unit-test the pure logic without hitting Telegram: chain building (incl. founder and cycle guard), trigger matching (case/whole-word), counterparty resolution (reply vs first @mention), the 24h per-pair dedup, and karma sign formatting (`+N` / `-N` / `0`).
- For the seed importer, assert: 62 rows, exactly one root, no orphan `invited_by`.
- Mock grammY `Context` for handler tests; do not require a live bot token to run `bun test`.

## When in doubt

`SPEC.md` is the source of truth for *what* and *why* (including the open questions in §13 and their chosen defaults). This file is the source of truth for *how*. If they conflict, fix the conflict explicitly rather than guessing.
