# Family HQ — Claude Pointer

> **All knowledge lives in the Obsidian vault**, not here.
> Vault path: `D:\GitProjects\Family_hq_obsidian\`
> Primary entry point: `Home.md` — read it at the start of every conversation.

## ⚠️ MANDATORY — Update Obsidian on every change

After ANY code change you must update the relevant note(s) **before** reporting "done":

| Change type | Update |
|-------------|--------|
| New endpoint, schema column, or migration | `API Reference.md` / `Database Schema.md` |
| New feature or UX change | `Features.md` / `Frontend Guide.md` |
| New design pattern, helper, or convention | `Patterns.md` / `Architecture.md` |
| Bug fix | Add lesson to `Bugs & Fixes.md` |
| Architectural choice with trade-offs | `Decisions Log.md` |
| Any version bump or deploy | `Changelog.md` + cache buster in `Deployment.md` + version in `Home.md` + `Project Overview.md` |

Skipping this loses context next session. Updating Obsidian is part of "done", not optional polish. The user has explicitly flagged forgetting this as a recurring failure mode — be vigilant.

## Critical facts (rest in Obsidian)

- **VPS**: `ssh root@178.104.10.0` · Docker port 8100 · `/opt/family_hq` · DB at `/data/family.db`
- **GitHub**: `yaroslavtrue/family-hq` · branch `v6` · **MUST `git push` before deploy** (VPS pulls)
- **Deploy**: `ssh root@178.104.10.0 "cd /opt/family_hq && git pull origin v6 && docker compose build --no-cache && docker compose up -d"`
- **Cache busting**: every frontend change → bump `?v=N` in `index.html` AND rebuild with `--no-cache`
- **Auth**: Telegram `initData` validated via HMAC-SHA256. Header: `X-Telegram-Init-Data`.
- **Schema**: don't ever rely on `CREATE TABLE IF NOT EXISTS` to add columns — use `safe_add_col()` in `migrate.py`
- **`sqlite3.Row`** has no `.get()` — use bracket notation
- **Color hardcoding** (`rgba(24,24,42,...)`) breaks themes — always `color-mix()` against `var(--sf|cd|pr|...)`

## Vault navigation

```
Home.md              ← landing + index + critical facts + ⚠️ rule
Project Overview.md  ← what & why, version, currency
Features.md          ← per-tab catalog (Home/Tasks/Shop/Money/Profile + hamburger)
Architecture.md      ← file structure, backend/frontend/scheduler/weather, z-index, auth
Database Schema.md   ← tables, migrations v1–v11, FX rates
API Reference.md     ← every endpoint, request/response shape
Frontend Guide.md    ← UI system, 9 themes, calendar, modals, avatars
Patterns.md          ← conventions, helpers, common pitfalls (read before adding patterns)
AI Bot.md            ← Claude Haiku NL parser, receipt vision
Morning Digest.md    ← daily Telegram summary
Trello Integration.md
Deployment.md        ← VPS, Docker, deploy command, cache busting
Bugs & Fixes.md      ← past incidents + lessons
Decisions Log.md     ← why we built it this way
Changelog.md         ← version history (latest: v7.5)
```

When in doubt, search the vault before changing patterns or asking the user.
