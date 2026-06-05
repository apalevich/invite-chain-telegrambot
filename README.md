# Telegram Exchange Bot

A private peer-to-peer currency exchange group bot that tracks invitation chains and automatic karma credits. Self-hosted, zero external dependencies (except Telegram API).

## Product Overview

### What It Does

The bot serves a private Telegram group of trusted traders. It solves two problems:

1. **Invitation Chain Lookup** — any member can query another member's provenance (who vouched for them, all the way back to the founder). This builds trust by proving the referral chain.

2. **Automatic Karma Tracking** — whenever two members complete an exchange and say "обменялись" (exchanged) in the group, the bot automatically credits +1 karma to both. The per-pair 24-hour cooldown prevents gaming.

### Key Features

- **4 lookup methods**: reply to a message, `/check @user` in group, `/check @user` in DM, forward a message in DM
- **Invitation chain display**: shows the path from any member back to the founder
- **Automatic karma credit**: monitors group messages for the trigger word "обменялись" (configurable)
- **Language support**: English and Russian, selectable per member
- **Member-only DM access**: non-members who DM the bot get a "I don't recognize you" reply
- **Admin CLI**: `set-karma.ts` script to manually adjust member karma
- **Idempotent CSV import**: seed from a Supabase export, safe to re-run
- **No external services**: everything in a single SQLite file on your server

### Example Usage

**In the group:**
```
User: /check (replying to someone's message)
Bot: User joined on January 16 2024
     Invitation chain: @user ⬅️ @johndoe ⬅️ @apalevich
     Karma: +5
     Contact @apalevich with issues
```

**In DM:**
```
User: /check @someone
Bot: (same profile as above)

User: /language
Bot: (shows language picker: EN, RU)
```

**In group (automatic):**
```
Alice: мы обменялись @bob (we exchanged with bob)
Bot: (silently tracks: alice +1, bob +1 in database)
     (or announces if KARMA_ANNOUNCE=true)
```

## Technical Overview

### Architecture

```
Telegram API
    ↓
grammY (bot framework) — long-polling
    ↓
Middleware (upsert seen users)
    ↓
Gate (non-member DM blocker)
    ↓
Handlers (lookup, karma, language)
    ↓
SQLite (single bot.sqlite file, WAL mode)
```

### Data Model

**users table:**
- `telegram_id` (PK): stable Telegram user ID
- `username`: mutable, nullable, stored without @
- `first_name`, `last_name`: display names
- `invited_by`: telegram_id of the inviter (NULL for founder)
- `joined_at`: ISO 8601 UTC timestamp
- `karma`: running karma balance (denormalized for speed)
- `language`: user's preferred language (en/ru, default en)
- `comment`: optional note field

**exchanges table (append-only audit log):**
- `id`: autoincrement
- `user_a`, `user_b`: normalized pair (min, max) for O(1) dedup lookups
- `chat_id`, `message_id`: context
- `created_at`: ISO 8601 UTC timestamp

Indices:
- `idx_users_username`: case-insensitive username lookup
- `idx_exchanges_pair_time`: 24h dedup window queries

### Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Bun | Fast, native SQLite support, TypeScript out of box |
| Bot framework | grammY | Lightweight, excellent Telegram API coverage |
| Database | SQLite + WAL | Zero setup, safe concurrent writes, single file |
| Config | Environment variables | No config files, secure |
| Deployment | pm2 + Bun interpreter | Works alongside existing Node apps |
| Language support | i18n (flat key→string maps) | Dead simple, extensible |

### File Structure

```
src/
  index.ts                 # Bot initialization, handler wiring
  db.ts                    # SQLite connection, schema migration
  repo/
    users.ts              # User queries: getById, getByUsername, chain()
    karma.ts              # Karma dedup & credit
  features/
    profile.ts            # Build profile string (chain + karma + date)
    lookup.ts             # Resolve target (4 methods), return profile or error
    gate.ts               # Non-member DM gate middleware
    exchange.ts           # Group message scanner: trigger match, counterparty, credit
    language.ts           # /language command (list + select via buttons)
    *.test.ts            # 36 unit tests (no mocks, in-memory SQLite)
  i18n/
    index.ts              # Translation function t()
    en.ts, ru.ts          # Locale strings

scripts/
  import-csv.ts           # One-time seed from Supabase CSV export
  set-karma.ts            # Admin: adjust karma from CLI

ecosystem.config.cjs      # pm2 app config (Bun interpreter)
.env.example              # All required env vars
package.json              # Bun deps (only grammy)
tsconfig.json             # TypeScript settings
```

### Test Coverage

36 tests, 0 failures:

- **Profile tests (10)**: founder chains, depth-5 chains, cycle guards, karma signs (+N/-N/0), date formatting, locales
- **Lookup tests (9)**: all 4 invocation methods, error cases (no record, forward privacy), username resolution, locale variants
- **Gate tests (6)**: non-member blocking, member pass-through, group/DM distinction, locale support
- **Exchange/Karma tests (11)**: trigger matching (Unicode whole-word), counterparty resolution (reply vs @mention), dedup window (24h), edge cases (self-exchange, unknown, no counterparty)

**Run tests:**
```bash
bun test
```

---

## Local Deployment (Mac)

### Prerequisites

- macOS 11+ (Intel or Apple Silicon)
- A valid Telegram bot token from BotFather
- The group chat ID (you can get it from @getidsbot after adding it to your group)

### Step 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Add Bun to PATH (if not automatic):
```bash
export PATH="$HOME/.bun/bin:$PATH"
```

Verify:
```bash
bun --version
```

### Step 2: Clone & Install

```bash
git clone <repo-url> obmen-bot
cd obmen-bot
bun install
```

### Step 3: Configure Environment

Copy the example and fill in your values:
```bash
cp .env.example .env
```

Edit `.env`:
```bash
BOT_TOKEN=<your-token-from-botfather>
GROUP_CHAT_ID=-1001234567890        # Get from @getidsbot in the group
DB_PATH=./data/bot.sqlite            # Or anywhere you like
KARMA_TRIGGERS=обменялись            # Comma-separated, case-insensitive
KARMA_DEDUP_HOURS=24                 # Per-pair cooldown
KARMA_ANNOUNCE=false                 # Silent by default
DEFAULT_LANGUAGE=en                  # Fallback for non-members
SUPPORT_CONTACT=@apalevich           # Your username
```

### Step 4: Create Data Directory

```bash
mkdir -p data
```

### Step 5: Import Members

Get the CSV export from Supabase (or create one with columns: `telegram_id, username, first_name, last_name, invited_by, joined_at, comment`).

```bash
bun run scripts/import-csv.ts ./public_telegram_users.csv
```

Output will confirm: `Imported 62 members ✓ Found 1 root(s) ✓ Found 0 orphan(s)`

### Step 6: BotFather Setup (One-time)

In Telegram, talk to @BotFather:

```
/setprivacy
Select your bot → Disable

/setcommands
Select your bot → 
check - Look up a member's chain and karma
language - Choose your language

/setdefaultcommands
check - Look up a member's chain and karma
language - Choose your language
```

Add your bot to the group. Make sure **group privacy is disabled** or the bot won't see messages.

### Step 7: Run Locally

```bash
bun run src/index.ts
```

You should see:
```
✓ Database initialized at ./data/bot.sqlite
Starting bot with long-polling...
✓ Bot connected to Telegram
✓ Features enabled:
  - /check command (reply, @mention, DM)
  - /language command (DM)
  - Karma scanner (group: "обменялись")
```

### Step 8: Test

1. **In the group**, reply to someone's message and `/check` → you get their profile
2. **In the group**, type `/check @username` → same
3. **In DM**, type `/check @username` → same
4. **In DM**, type `/language` → get language picker buttons
5. **In the group**, type `мы обменялись @someone` → the bot silently credits both

### Stopping

Press `Ctrl+C` in the terminal.

### Debugging

The bot logs every message it sees. If karma isn't crediting:
- Check `KARMA_TRIGGERS` matches what people are typing (case-insensitive, whole-word)
- Verify `GROUP_CHAT_ID` is correct (try @getidsbot)
- Make sure bot privacy is **disabled** in BotFather
- Check that both members are in the `users` table (CSV import)

### Manual Karma Adjustment

```bash
# Add 5 karma
bun run scripts/set-karma.ts 697027219 +5

# Subtract 2
bun run scripts/set-karma.ts 918410 -2

# Set to exactly 10
bun run scripts/set-karma.ts 430358659 =10
```

---

## VPS Deployment (Ubuntu + pm2)

### Prerequisites

- Ubuntu 20.04 LTS or newer (or any Linux with systemd)
- SSH access to the server
- pm2 already installed and running (optional; we'll install if needed)
- A valid Telegram bot token
- Group chat ID

### Step 1: SSH Into Your VPS

```bash
ssh user@your-vps-ip
```

### Step 2: Install Bun (Per-User, Safe)

```bash
curl -fsSL https://bun.sh/install | bash
```

Add to your shell profile:
```bash
export PATH="$HOME/.bun/bin:$PATH"
```

Reload shell:
```bash
source ~/.bashrc
```

or

```bash
source ~/.zshrc
```

Verify:
```bash
~/.bun/bin/bun --version
```

### Step 3: Clone the Repository

```bash
cd /path/to/projects  # wherever you host code
git clone <repo-url> obmen-bot
cd obmen-bot
```

### Step 4: Install Dependencies

```bash
~/.bun/bin/bun install
```

### Step 5: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your production values:
```bash
# Use a strong, unique token from BotFather
BOT_TOKEN=<your-production-token>

# Get from @getidsbot in your group
GROUP_CHAT_ID=-1001234567890

# Absolute path or relative to where pm2 runs
DB_PATH=/home/user/obmen-bot/data/bot.sqlite

# Keep defaults or customize
KARMA_TRIGGERS=обменялись
KARMA_DEDUP_HOURS=24
KARMA_ANNOUNCE=false
DEFAULT_LANGUAGE=en
SUPPORT_CONTACT=@apalevich
```

### Step 6: Create Data Directory

```bash
mkdir -p data
```

### Step 7: Import Members

```bash
~/.bun/bin/bun run scripts/import-csv.ts ./public_telegram_users.csv
```

Confirm the output shows correct member count and no orphans.

### Step 8: Install pm2 (If Not Already Installed)

```bash
npm install -g pm2
pm2 startup
```

Follow the on-screen instructions to enable pm2 startup on reboot.

### Step 9: Start the Bot with pm2

```bash
pm2 start ecosystem.config.cjs
```

The `ecosystem.config.cjs` already uses the Bun interpreter. You should see:

```
[PM2] Starting /home/user/obmen-bot/ecosystem.config.cjs in cluster mode...
[PM2] App [exchange-bot] started
```

Save pm2 state:
```bash
pm2 save
```

### Step 10: Verify It's Running

```bash
pm2 list
```

You should see `exchange-bot` with status `online`:
```
┌─────┬──────────────────┬──────┬──────┬───────────┐
│ id  │ name             │ mode │ pid  │ status    │
├─────┼──────────────────┼──────┼──────┼───────────┤
│ 0   │ exchange-bot     │ fork │ 1234 │ online    │
│ 1   │ your-other-app   │ fork │ 5678 │ online    │
└─────┴──────────────────┴──────┴──────┴───────────┘
```

### Step 11: Monitor Logs

```bash
# Tail real-time
pm2 logs exchange-bot

# Or check the log file directly
tail -f logs/out.log
```

### Step 12: BotFather Setup (One-time)

Same as local:
- `/setprivacy` → Disable
- `/setcommands` → register `/check` and `/language`
- Add bot to the group

### Step 13: Test

1. Test `/check` reply in the group
2. Test `/check @user` in group and DM
3. Test `/language` in DM
4. Test karma credit with "обменялись @user" in the group

### Ongoing Operations

#### Restart the Bot

```bash
pm2 restart exchange-bot
```

#### Stop the Bot

```bash
pm2 stop exchange-bot
```

#### Start the Bot

```bash
pm2 start exchange-bot
```

#### Reboot Survival

pm2 will auto-restart the bot on server reboot if you ran:
```bash
pm2 startup
```

Verify:
```bash
pm2 save
```

#### Update Code

```bash
cd /path/to/obmen-bot
git pull origin main
~/.bun/bin/bun install
pm2 restart exchange-bot
```

#### Adjust Karma

```bash
~/.bun/bin/bun run scripts/set-karma.ts <telegram_id> <+N|-N|=N>
```

#### Backup the Database

```bash
cp data/bot.sqlite data/bot.sqlite.backup-$(date +%Y%m%d)
```

### Troubleshooting on VPS

**Bot not connecting:**
- Check `BOT_TOKEN` is correct and active
- Verify `GROUP_CHAT_ID` is the group's actual ID (try `/start @getidsbot` in the group)
- Check network connectivity: `curl -s "https://api.telegram.org/bot<TOKEN>/getMe" | jq`

**Karma not crediting:**
- Verify group privacy is **disabled** in BotFather
- Check `KARMA_TRIGGERS` matches what members type (case-insensitive, whole-word match)
- Verify both members are in the database: check `sqlite3 data/bot.sqlite "SELECT telegram_id, username FROM users LIMIT 5;"`

**Database locked:**
- SQLite WAL mode is active; this is rare but check: `pm2 logs exchange-bot | grep -i lock`
- If stuck, restart: `pm2 restart exchange-bot`

**Out of disk space:**
- Check: `df -h`
- SQLite WAL files (`-wal`, `-shm`) are temporary; they're cleaned up after restarts
- The database itself grows slowly (only writes are exchanges and language changes)

---

## Configuration Reference

All config is via environment variables (no config files).

| Variable | Default | Purpose | Example |
|----------|---------|---------|---------|
| `BOT_TOKEN` | — | Telegram bot token from BotFather | `1234567890:ABCdef...` |
| `GROUP_CHAT_ID` | — | Chat ID of the exchange group | `-1001234567890` |
| `DB_PATH` | `./data/bot.sqlite` | Path to SQLite database | `/var/lib/exchange-bot/bot.sqlite` |
| `KARMA_TRIGGERS` | `обменялись` | Comma-separated trigger words | `обменялись,обменялась` |
| `KARMA_DEDUP_HOURS` | `24` | Per-pair cooldown window (hours) | `24` |
| `KARMA_ANNOUNCE` | `false` | Post in-group announcement on credit | `true` / `false` |
| `DEFAULT_LANGUAGE` | `en` | Language for non-members | `en` / `ru` |
| `SUPPORT_CONTACT` | `@apalevich` | Support handle in messages | `@yourhandle` |

---

## Adding a New Language

1. Create `src/i18n/xx.ts` (e.g., `de.ts` for German) with all keys from `en.ts`:

```typescript
export const de = {
  "profile.joined": "Benutzer beigetreten am {date}",
  "profile.chain": "Einladungskette: {chain}",
  // ... all other keys
} as const;

export type DeLocaleKey = keyof typeof de;
```

2. Register in `src/i18n/index.ts`:

```typescript
import { de } from "./de";

const locales: Record<Language, Record<LocaleKey, string>> = {
  en,
  ru,
  de,  // Add this
};

export type Language = "en" | "ru" | "de";  // Update type
export const SUPPORTED_LANGUAGES: Language[] = ["en", "ru", "de"];  // Add to list
```

3. Users can then `/language` and pick German.

---

## Security & Considerations

### What This Bot Does NOT Do

- **No new member onboarding** — members are seeded from CSV and the graph is static
- **No username resolution API** — only looks up names against the stored map (platform limit)
- **No external API calls** — everything is local
- **No karma decrement trigger** — admins edit the database directly

### Security Notes

1. **Database**: stored locally in SQLite. Encrypt your VPS disk or use full-disk encryption.
2. **Bot Token**: keep it in `.env` only, never commit to git. Use `.gitignore`.
3. **Group Privacy**: must be **disabled** in BotFather or the bot won't see messages.
4. **Member Table**: only people in the CSV import can use the bot in DM. Non-members get a "I don't recognize you" reply.
5. **Idempotent Import**: re-running the CSV import is safe; it upserts by `telegram_id`.

---

## Maintenance & Backup

### Daily

- Nothing required. The bot runs itself.
- Monitor logs occasionally: `pm2 logs exchange-bot`

### Weekly

- Backup the database:
  ```bash
  cp data/bot.sqlite data/bot.sqlite.backup-$(date +%Y%m%d-%H%M%S)
  ```

### When Adding Members

- Update the CSV in Supabase
- Export and re-run: `bun run scripts/import-csv.ts ./updated.csv`
- The script is idempotent; existing members won't be changed unless their username/name changed

### When Changing Trigger Words

- Update `KARMA_TRIGGERS` in `.env`
- Restart: `pm2 restart exchange-bot`
- No database migration needed; only future messages use the new trigger

---

## Development & Contributing

### Run Tests

```bash
bun test
```

Expected: 36 tests, 0 failures.

### Add a Feature

1. Write tests first in `src/features/your-feature.test.ts`
2. Implement in `src/features/your-feature.ts`
3. Wire it up in `src/index.ts`
4. Update i18n strings in `src/i18n/en.ts` and `src/i18n/ru.ts`
5. Run tests: `bun test`
6. Commit

### Code Style

- No comments unless the WHY is non-obvious
- Prefer explicit naming over DRY abstractions at small scales
- Test logic in isolation; mock nothing
- Use TypeScript; let the compiler catch errors

---

## FAQ

**Q: Can I add new members without re-importing the CSV?**

A: Not in v1. The graph is static. You'd need to manually insert into the `users` table or extend `import-csv.ts` to support incremental updates.

**Q: Why no negative trigger word?**

A: Out of scope for v1. Admins manually adjust karma with the `set-karma.ts` script.

**Q: What if the bot crashes?**

A: pm2 will restart it automatically (or it will restart on server reboot if `pm2 startup` was run).

**Q: Can I run this on Docker?**

A: Yes, but you'd need to handle Bun installation in a Dockerfile. The `ecosystem.config.cjs` assumes Bun is in `~/.bun/bin/bun`. Adjust the path for Docker.

**Q: What if someone changes their Telegram username?**

A: The bot discovers new usernames from messages. Next time they post, the `username` column is updated. Chain lookups always use `telegram_id` (stable), so changing usernames doesn't break anything.

**Q: How do I change the karma dedup window?**

A: Set `KARMA_DEDUP_HOURS` in `.env`, then restart: `pm2 restart exchange-bot`.

**Q: Can I see who credited whom?**

A: Yes, check the `exchanges` table: `sqlite3 data/bot.sqlite "SELECT * FROM exchanges LIMIT 10;"`

---

## License & Support

This bot is built for a private group and maintained by the founder. For questions, ask in the group or contact the support handle (default `@apalevich`).

---

## Changelog

### v1.0 (2024-06-05)

- ✅ Invitation chain lookup (4 methods)
- ✅ Automatic karma credit with 24h per-pair dedup
- ✅ Non-member DM gate
- ✅ Language selection (en, ru)
- ✅ Admin karma adjustment script
- ✅ CSV seeding from Supabase
- ✅ Comprehensive test suite (36 tests)
- ✅ pm2 + Bun deployment ready

---

**Ready to deploy.** Follow the local or VPS guide above. Questions? Check the logs: `pm2 logs exchange-bot`.
