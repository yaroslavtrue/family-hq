# Family HQ — Project Knowledge Base

## Overview
Family organizer Telegram Mini App for 2 people (Yaroslav + Ella). Full-stack app with AI-powered Telegram bot.

## Stack
- **Backend**: Python FastAPI, SQLite, APScheduler
- **Frontend**: Vanilla HTML/JS/CSS (single index.html + app.js)
- **Bot**: python-telegram-bot + Claude Haiku API for natural language parsing
- **Deploy**: Docker on Hetzner VPS, nginx reverse proxy, HTTPS via Let's Encrypt
- **Domain**: myfamilybusiness.duckdns.org (DuckDNS free subdomain)

## Infrastructure
- **VPS**: Ubuntu 24.04, 2 CPU, 4GB RAM, Hetzner (IP: 178.104.10.0)
- **SSH**: `ssh root@178.104.10.0` (key-based auth, key: ~/.ssh/id_ed25519)
- **Docker port**: 8100:8000, nginx reverse proxy on 443
- **DB path**: /data/family.db (Docker volume mount)
- **GitHub**: github.com/yaroslavtrue/family-hq (branch: v6)
- **Users**: Yaroslav (user_id=425342813), Ella (user_id=5063035495), family_id=1

## Project Structure
```
/opt/family_hq/
├── backend/
│   ├── __init__.py
│   ├── app.py          # FastAPI endpoints (~1000+ lines)
│   ├── bot.py           # Telegram bot with Claude AI parsing
│   ├── scheduler.py     # Background jobs (reminders, digest, Trello sync)
│   └── migrate.py       # DB migrations (schema_version: 6)
├── frontend/
│   ├── index.html       # HTML + CSS shell (~230 lines)
│   └── app.js           # All JS logic (~550+ lines)
├── data/family.db       # SQLite DB (preserved across deploys)
├── .env                 # BOT_TOKEN, WEBAPP_URL, TZ, TRELLO_*, ANTHROPIC_API_KEY
├── .claude/launch.json  # Dev server configs for preview
├── docker-compose.yml
├── Dockerfile
├── start.sh             # Runs uvicorn + bot
└── requirements.txt
```

## Current Version: v6.2

### Navigation
- **Bottom nav**: 4 tabs — Home | Tasks | Shop | Money
- **Hamburger menu ☰**: Events | Birthdays | Cleaning | Subscriptions | Settings
- **FAB (+)**: Context-aware add button per tab

### Features
- **Home**: Weather 3-day forecast (Open-Meteo API, cached 30min), stats grid (clickable), top 3 tasks (priority+date sorted), upcoming 7 days (events+birthdays+subs with day counter)
- **Tasks**: Active/Recurring tabs, assign to member, priority (low/normal/high), due dates, reminders (up to 5), subtasks
- **Shopping**: Folders (Lidl, etc), full add form (name+qty+price+folder), folder edit/delete, In Stock with totals, price in din.
- **Money**: Transactions tab (balance card showing total income/expense/balance in EUR across ALL transactions, expense/income with categories, multi-currency, member assignment), Analytics tab (6-month bar chart, category breakdown, limits with progress bars)
- **Cleaning**: Zones with per-task reset periods, collapsible, assign to member, dirty/clean status
- **Calendar** (in hamburger): Events with timeline, Birthdays sorted by nearest with reminders
- **Subscriptions** (in hamburger): Multi-currency, billing day, reminders, monthly total in EUR
- **Settings**: Family management, 6 themes (Midnight/Dawn/Forest/Ocean/Rosé/Chalk), morning digest time, category management (via modal with Expense/Income tabs), Trello Sync button (pill inside card), debug mode

### AI Bot
- Parses natural language via Claude Haiku API
- Commands: expenses, income, shopping, tasks, status
- Supports Russian and English
- Notifies family members of actions
- Example: "потратил 2000 в лидле" → creates expense transaction

### Trello Integration
- Syncs every 30 minutes from board "Работа"
- Manual sync via Settings → Trello Sync card (clickable, pill button "Sync Now")
- POST /api/trello/sync endpoint for manual trigger
- Only imports cards with due dates (not completed)
- Bi-directional: completion syncs both ways
- Auto-cleanup: completed Trello tasks removed after 7 days
- Lists: Монтаж видео, Сайты, Бренд, Видеосъемка
- Env vars: TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID, TRELLO_FAMILY_ID

### Morning Digest (configurable time)
- Dedup protection: last_digest column in settings — max 1 per day per family
- Weather: current temp + 3-day forecast (Сегодня/Завтра/Послезавтра)
- Tasks: today + tomorrow (per-member, assigned or unassigned)
- Cleaning: overdue zones (up to 5)
- Events: next 3 days
- Subscriptions: next 5 days (per-member)
- Birthdays: next 7 days
- Single consolidated message per person

### Schedulers (in scheduler.py)
- check_task_reminders: every 1 min
- check_zone_reminders: every 1 min
- check_birthday_reminders: every hour
- check_subscription_reminders: every hour
- check_event_reminders: daily 09:00
- check_cleaning_resets: daily 00:05
- generate_recurring_tasks: daily 00:05
- morning_digest: every hour (checks per-family configured time, dedup via last_digest)
- sync_trello: every 30 min

## DB Schema
Tables: families, family_members, tasks, task_reminders, recurring_tasks, shopping, shopping_folders, events, birthdays, birthday_reminders, subscriptions, subscription_reminders, subtasks, cleaning_zones, cleaning_tasks, zone_reminders, settings, categories, transactions, category_limits, schema_version

Key columns:
- tasks: has trello_card_id (TEXT) for Trello sync
- transactions: type (expense/income), amount, currency, amount_eur (auto-converted), category_id, member_id, date
- categories: type (expense/income), emoji, name, is_default, family_id
- settings: theme, digest_time, last_digest (TEXT, dedup: stores date like "2026-04-02")

Migration history: v1 (base cols), v2 (zone reminders), v3 (shopping), v4 (categories seed), v5 (trello_card_id), v6 (last_digest)

## Currency
- Primary: RSD (Serbian dinars, displayed as "din.")
- Analytics: EUR
- Supported: EUR, USD, GBP, RUB, RSD
- FX rates hardcoded: FX = {"EUR": 1.0, "USD": 0.92, "GBP": 1.16, "RUB": 0.0095, "RSD": 0.0085}
- Weather coords: Belgrade (44.8, 20.46)

## Auth
- Telegram WebApp initData validation (HMAC-SHA256)
- Dev mode: no token → returns user_id=0, name="Dev"
- X-Telegram-Init-Data header on every API request

## API Design
- Bundle endpoint: GET /api/bundle — returns ALL data in one request (replaces 14 parallel fetches)
- POST /api/trello/sync — manual Trello sync trigger
- No-cache headers on all static files (Cache-Control: no-cache, no-store)
- Cache buster on app.js: ?v=61

## Deployment Commands
```bash
# Standard deploy (from local machine):
cd /opt/family_hq && git pull origin v6
docker compose build --no-cache && docker compose up -d

# Or via SSH from Windows dev machine:
ssh root@178.104.10.0 "cd /opt/family_hq && git pull origin v6 && docker compose build --no-cache && docker compose up -d"

# Check:
curl http://localhost:8100/api/debug/ping

# Logs:
docker compose logs --tail=30

# DB backup:
cp /opt/family_hq/data/family.db /opt/backups/family_$(date +%Y%m%d).db

# Auto-backup: crontab entry runs daily at 3am
```

## Known Patterns & Gotchas
- sqlite3.Row doesn't support .get() — always convert to dict() first
- Docker needs --no-cache when frontend files change (aggressive caching)
- Telegram Desktop WebApp caches JS aggressively — use ?v=XX cache busters
- start.sh runs uvicorn in background (&) then bot in foreground
- "Connection reset by peer" right after docker compose up -d is normal — uvicorn needs a few seconds
- Patching JS via sed/heredoc is unreliable — use python3 scripts or regenerate full files
- When editing on VPS directly, always test with: python3 -c "import ast; ast.parse(open('file.py').read())" and node -c file.js
- env vars must be in both .env AND docker-compose.yml environment section
- VPS may have local changes — always `git stash` before `git pull` if pull fails
- Local dev server (preview_start) shows onboarding only — no Telegram auth, can't test real data

## Frontend Architecture
- Single page app, no framework, vanilla JS
- State in global D object: D.tasks, D.shopping, D.transactions, etc.
- ren() function renders current tab
- go(tab) switches tab + resets filters
- A(method, path, body) — universal API caller with debug logging
- Toast system for undo on delete
- Hamburger menu: slide-out panel from right
- Theme system: CSS variables dynamically set by aT(themeId)
- All data loaded via single /api/bundle call
- Category management: modal with tabs (openCatMgr() → oMC with catMgrHtml())
- Balance card in rTransactions(): computed from all D.transactions (total income - expense in EUR)

## What's NOT Implemented Yet
- Weekly Report (Sunday evening summary)
- Goals / Wishlist with savings progress
- Receipt scanner (Claude Vision)
- Meal planner
- Geolocation
