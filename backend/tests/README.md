# Backend smoke tests

Quick sanity-check suite for the most-trafficked endpoints + the data-isolation guarantees that v8.33.0/.1 promised. **Goal: catch regressions before they hit prod**, not exhaustive coverage.

## Run

```bash
# from repo root
python -m pytest backend/tests -v
```

Expected: ~21 tests pass in ~25 seconds. Each test gets a fresh temporary SQLite (DB_PATH points at a tempfile that's deleted after).

## What's covered

| File | Focus |
|------|-------|
| `test_smoke.py` | `/api/debug/ping`, `/`, `/api/auth/bot-info`, bundle shape, migration ended at v25, bundle 401 without auth |
| `test_family.py` | Create family → status, join via invite code, invalid code, lang preference round-trip |
| `test_crud.py` | Task CRUD, transaction CRUD + amount_eur FX conversion (USD → EUR), shopping CRUD, event CRUD |
| `test_isolation.py` | **Most important**: family A cannot delete/modify family B's workouts, subtasks, categories. Bundle GET only shows own family. Cross-family toggle/delete are documented safe no-ops. |

## How auth is bypassed

The real `get_user` / `get_uf` dependencies do HMAC validation of Telegram initData. In tests we override them via `app.dependency_overrides`:

```python
async def fake_get_user(): return {"id": 123, "first_name": "T", "photo_url": None}
app_module.app.dependency_overrides[app_module.get_user] = fake_get_user
```

The `client_as(user_id, family_id)` fixture wraps this — auto-seeds the family row + member row in the temp DB and returns a pre-authenticated TestClient.

## Adding tests

For a new feature:
1. Use `client_as(user_id=N, family_id=1)` to get an authenticated TestClient
2. Use `db_conn` fixture for raw SQLite access (seed/inspect)
3. For multi-family tests, see `_seed_two_families()` helper in `test_isolation.py`

Follow the pattern: `assert r.status_code == 200, r.text` — including `r.text` in the assertion gives you the full error response if it fails.

## CI / pre-deploy

Run before every push that touches `backend/`:

```bash
python -m pytest backend/tests && git push origin v6
```

Single regression caught here saves ~30 min of "deploy and rollback and debug". The v8.32.0 silent-failure regression would have been caught by `test_bundle_shape` if these had existed.
