# BUILD_PLAN.md

Sequenced build plan for the exchange bot. Work top to bottom; each phase has a **done gate** that must pass before moving on. Tick boxes as you go — this file doubles as the project's progress log. Full detail in `SPEC.md`; conventions in `CLAUDE.md`.

## Phase 0 — Scaffold
- [x] `bun init`; add grammY. Confirm `import { Database } from "bun:sqlite"` works.
- [x] `.gitignore` for `data/`, `.env`, `node_modules`. Add `.env.example` with every var from `SPEC.md` §9.
- [x] Folder structure per `CLAUDE.md` (`src/`, `repo/`, `features/`, `i18n/`, `scripts/`).
- **Done gate:** `bun run src/index.ts` boots, reads `BOT_TOKEN`, and connects to Telegram (even with no handlers yet).

## Phase 1 — Data layer & seed
- [x] `db.ts`: open SQLite (WAL on), run migration creating `users` + `exchanges` per `SPEC.md` §6.1.
- [x] `scripts/import-csv.ts`: idempotent upsert from the CSV; strip `@`, empty→NULL, karma 0, language `en`.
- [x] Import validation: exactly one root, no orphan `invited_by`, warn on dup usernames.
- **Done gate:** importing the provided CSV yields **62** members, **1** root (`@apalevich`), **0** orphans; re-running changes nothing.

## Phase 2 — Profile (chain + karma)
- [x] `repo/users.ts`: `getById`, `getByUsername` (case-insensitive, no `@`), `chain()` with cycle guard.
- [x] `features/profile.ts`: assemble the profile, karma sign rule (`+N` / `-N` / `0`), date via `Intl`.
- [x] i18n scaffolding (`i18n/index.ts`, `en.ts`, `ru.ts`) with the profile template + negative messages.
- **Done gate:** unit tests pass for founder chain (`[@apalevich]`), a depth-5 chain, cycle guard, and all three karma sign cases, in both locales.

## Phase 3 — Lookup (the 4 methods)
- [x] `features/lookup.ts`: resolve target from (1) reply, (2) `/check @user` in group, (3) `/check @user` in DM, (4) DM forward.
- [x] Negative path: unknown user → localized "no record".
- [x] Forward-privacy path: anonymized forward → distinct localized "hidden identity" message.
- [x] Middleware: upsert sender's username/name on every update (`repo/users.upsertSeenUser`).
- **Done gate:** all §5.2 acceptance criteria pass (mocked `Context`), including the forward-privacy sub-case.

## Phase 4 — Non-member DM gate
- [x] `features/gate.ts`: in private chats, if sender ∉ `users`, reply `I don't recognize you. Support: @apalevich` (localized, `DEFAULT_LANGUAGE`, `SUPPORT_CONTACT`) and stop.
- [x] Wire it to run **before** all other private-chat handlers.
- **Done gate:** §5.6 acceptance criteria pass — non-member gets only that reply; members unaffected.

## Phase 5 — Karma scanner
- [x] `features/exchange.ts`: whole-word, case-insensitive match of `KARMA_TRIGGERS` (default `обменялись`).
- [x] Counterparty resolution: reply → replied-to user; else first resolvable `@mention`.
- [x] Credit +1 to both **known members**; ignore self-exchange; ignore no-counterparty.
- [x] `repo/karma.ts`: `withinDedupWindow(pair)` against `exchanges` (per-pair `KARMA_DEDUP_HOURS`), `credit()` writes the audit row + bumps `users.karma`.
- [x] Optional `KARMA_ANNOUNCE` confirmation (default off).
- **Done gate:** all §5.3 acceptance criteria pass, especially the 24h per-pair window, case-insensitivity, whole-word, and self/no-counterparty skips.

## Phase 6 — Language command & admin script
- [ ] `features/language.ts`: `/language` (alias `/lang`) in DM lists languages, sets+persists per `telegram_id`.
- [ ] `scripts/set-karma.ts`: `<telegram_id> <+N|-N|=N>` adjusts karma from the shell.
- **Done gate:** language switch persists and group replies honor the invoker's language; `set-karma.ts` change shows on next lookup.

## Phase 7 — Telegram setup & deploy
- [ ] BotFather: disable group privacy; register `/check`, `/language` via `setMyCommands`; add bot to the group.
- [ ] Install Bun on the VPS (per-user); `ecosystem.config.cjs` with Bun interpreter; `pm2 start` + `pm2 save`.
- **Done gate:** `pm2 list` shows `exchange-bot` online beside existing Node apps; all four lookups + karma work live; survives `pm2 restart` and a reboot.

## Resolve before/while building (defaults already chosen — see SPEC §13)
- [ ] O-1 announce credits in-group? (default: silent)
- [ ] O-2 display timezone for join date? (default: UTC)
- [ ] O-3 also trigger on singular `обменялся/обменялась`? (default: no)
- [ ] O-4 show old username on change? (default: current only)
- [ ] O-5 multiple @mentions in one exchange message? (default: first only)
