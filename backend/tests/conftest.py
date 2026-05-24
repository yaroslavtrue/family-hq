"""
Pytest fixtures for backend smoke tests.

Strategy:
- Each test gets a fresh temp SQLite via DB_PATH env var (set BEFORE importing app).
- `app.dependency_overrides` swaps `get_user` / `get_uf` so we don't need real HMAC
  validation — test code controls who the "current user" is.
- Scheduler is short-circuited (no real cron jobs, no telegram calls).
- `client_as(user_id, family_id)` helper returns a TestClient that authenticates as the given user.
"""
import os
import sys
import tempfile
import importlib
import sqlite3
import pytest


@pytest.fixture(scope="function")
def temp_db(monkeypatch):
    """Per-test temp SQLite. Each test gets a clean DB so they don't pollute each other."""
    fd, path = tempfile.mkstemp(suffix=".db", prefix="famhq_test_")
    os.close(fd)
    monkeypatch.setenv("DB_PATH", path)
    monkeypatch.setenv("BOT_TOKEN", "TEST_TOKEN_x" * 4)  # 44 chars — looks like a real token shape
    monkeypatch.setenv("TZ", "Europe/Belgrade")
    monkeypatch.setenv("WEBAPP_URL", "https://test.local")
    yield path
    try:
        os.remove(path)
    except OSError:
        pass


@pytest.fixture(scope="function")
def app_module(temp_db, monkeypatch):
    """Fresh import of backend.app with temp DB + scheduler disabled."""
    # Wipe cached modules so each test gets a clean import (DB_PATH env-baked-in at module load)
    for m in list(sys.modules):
        if m.startswith("backend.") or m == "backend":
            del sys.modules[m]

    # Patch the APScheduler before app.py imports it — keeps cron jobs from registering.
    import apscheduler.schedulers.asyncio as _aps_mod
    monkeypatch.setattr(_aps_mod.AsyncIOScheduler, "add_job", lambda self, *a, **kw: None)
    monkeypatch.setattr(_aps_mod.AsyncIOScheduler, "start", lambda self, *a, **kw: None)
    monkeypatch.setattr(_aps_mod.AsyncIOScheduler, "shutdown", lambda self, *a, **kw: None)

    # Now safe to import — migrations will run via lifespan when TestClient enters context.
    # We import migrate and run it manually here so tests can hit the DB without entering lifespan.
    from backend import migrate as _migrate
    _migrate.migrate(os.environ["DB_PATH"])

    from backend import app as _app
    yield _app


@pytest.fixture(scope="function")
def db_conn(temp_db):
    """Raw SQLite connection for tests that need to seed/inspect data directly."""
    con = sqlite3.connect(temp_db)
    con.row_factory = sqlite3.Row
    yield con
    con.close()


def _make_family_member(con: sqlite3.Connection, user_id: int, family_id: int, name: str = "Test"):
    """Helper: insert a (family, member) pair if missing. Used by client_as()."""
    fam = con.execute("SELECT id FROM families WHERE id=?", (family_id,)).fetchone()
    if not fam:
        con.execute("INSERT INTO families (id, name, invite_code) VALUES (?, ?, ?)",
                    (family_id, f"Fam{family_id}", f"INV{family_id:03d}"))
    mem = con.execute("SELECT user_id FROM family_members WHERE user_id=?", (user_id,)).fetchone()
    if not mem:
        con.execute("INSERT INTO family_members (user_id, family_id, user_name, tg_chat_id) VALUES (?, ?, ?, ?)",
                    (user_id, family_id, name, None))
    con.commit()


@pytest.fixture(scope="function")
def client_as(app_module, temp_db):
    """
    Factory: client_as(user_id, family_id) -> TestClient pre-authenticated as that user.
    Auto-creates the family + member rows in the temp DB so the user "exists".
    """
    from fastapi.testclient import TestClient

    def _factory(user_id: int, family_id: int = 1, name: str = "Test"):
        con = sqlite3.connect(temp_db)
        con.row_factory = sqlite3.Row
        try:
            _make_family_member(con, user_id, family_id, name)
        finally:
            con.close()

        # Override the auth dependencies. FastAPI inspects the OVERRIDE's signature for
        # dependency injection — *args/**kwargs would be parsed as request params (→ 422).
        # Parameterless async functions work cleanly.
        async def fake_get_user():
            return {"id": user_id, "first_name": name, "photo_url": None}

        async def fake_get_uf():
            return {"id": user_id, "first_name": name, "photo_url": None, "family_id": family_id}

        app_module.app.dependency_overrides[app_module.get_user] = fake_get_user
        app_module.app.dependency_overrides[app_module.get_uf] = fake_get_uf

        # TestClient with raise_server_exceptions=True (default) — bubbles up tracebacks.
        return TestClient(app_module.app)

    return _factory


@pytest.fixture(scope="function")
def anon_client(app_module):
    """A TestClient without auth overrides — used for endpoints that don't require auth (ping)."""
    from fastapi.testclient import TestClient
    return TestClient(app_module.app)
