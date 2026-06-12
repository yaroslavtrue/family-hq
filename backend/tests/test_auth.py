"""
Accounts-mode auth (AUTH_MODE=accounts): email/password + Google.

Each fixture wipes + reimports backend.app with the right AUTH_MODE in env (the
mode is read at import time), runs migrate on a fresh temp DB, patches the
scheduler, and (accounts) captures outgoing email instead of sending it.
"""
import os, sys, tempfile, sqlite3, re
import pytest
from fastapi.testclient import TestClient


def _fresh_app(monkeypatch, mode, **env):
    fd, path = tempfile.mkstemp(suffix=".db", prefix="famhq_auth_"); os.close(fd)
    monkeypatch.setenv("DB_PATH", path)
    monkeypatch.setenv("BOT_TOKEN", "TESTBOT_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxx")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret-123")
    monkeypatch.setenv("AUTH_MODE", mode)
    monkeypatch.setenv("TZ", "Europe/Belgrade")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    for m in list(sys.modules):
        if m == "backend" or m.startswith("backend."):
            del sys.modules[m]
    import apscheduler.schedulers.asyncio as _aps
    monkeypatch.setattr(_aps.AsyncIOScheduler, "add_job", lambda self, *a, **k: None)
    monkeypatch.setattr(_aps.AsyncIOScheduler, "start", lambda self, *a, **k: None)
    monkeypatch.setattr(_aps.AsyncIOScheduler, "shutdown", lambda self, *a, **k: None)
    from backend import migrate as _mig
    _mig.migrate(path)
    from backend import app as _app
    return _app, path


@pytest.fixture()
def acc(monkeypatch):
    app, path = _fresh_app(monkeypatch, "accounts", GOOGLE_CLIENT_ID="test-client.apps.googleusercontent.com")
    sent = []
    async def _cap(to, subject, html):
        sent.append({"to": to, "subject": subject, "html": html}); return True
    monkeypatch.setattr(app, "_send_email", _cap)
    app._sent, app._db = sent, path
    yield app
    try: os.remove(path)
    except OSError: pass


def _c(app): return TestClient(app.app)
def _tok(app, param):
    m = re.search(param + r"=([^\"&\s]+)", app._sent[-1]["html"]); return m.group(1)
def _count_users(app): return sqlite3.connect(app._db).execute("SELECT COUNT(*) FROM users").fetchone()[0]


def test_register_verify_login(acc):
    c = _c(acc)
    r = c.post("/api/auth/register", json={"email": "  Alice@Example.com ", "password": "secret12", "name": "Al"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(acc._sent) == 1 and "Verify" in acc._sent[0]["subject"]
    # email normalised (lower + trim)
    assert sqlite3.connect(acc._db).execute("SELECT email_norm FROM users").fetchone()[0] == "alice@example.com"
    # login works pre-verify, but not verified
    r = c.post("/api/auth/login", json={"email": "alice@example.com", "password": "secret12"})
    assert r.status_code == 200 and r.json()["token"] and r.json()["email_verified"] is False
    # verify → 303 redirect, then verified
    r = c.get(f"/api/auth/verify?token={_tok(acc,'token')}", follow_redirects=False)
    assert r.status_code == 303 and "verified=1" in r.headers["location"]
    assert c.post("/api/auth/login", json={"email": "alice@example.com", "password": "secret12"}).json()["email_verified"] is True


def test_non_enumerating_and_wrong_password(acc):
    c = _c(acc)
    c.post("/api/auth/register", json={"email": "x@y.com", "password": "secret12"})
    assert c.post("/api/auth/login", json={"email": "x@y.com", "password": "WRONGpass"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "nobody@z.com", "password": "whatever8"}).status_code == 401
    n = _count_users(acc)
    assert c.post("/api/auth/register", json={"email": "x@y.com", "password": "another8"}).status_code == 200
    assert _count_users(acc) == n  # duplicate register: generic ok, no 2nd user


def test_reset_is_single_use(acc):
    c = _c(acc)
    c.post("/api/auth/register", json={"email": "r@s.com", "password": "secret12"})
    c.post("/api/auth/forgot", json={"email": "r@s.com"})
    rtok = _tok(acc, "reset")
    assert c.post("/api/auth/reset", json={"token": rtok, "password": "newpass99"}).json() == {"ok": True}
    assert c.post("/api/auth/login", json={"email": "r@s.com", "password": "newpass99"}).status_code == 200
    assert c.post("/api/auth/login", json={"email": "r@s.com", "password": "secret12"}).status_code == 401
    # reuse the old reset token → rejected (binding to the old password hash)
    assert c.post("/api/auth/reset", json={"token": rtok, "password": "hacker99"}).status_code == 400


def test_verified_gate_and_tg_chat_id_null(acc):
    c = _c(acc)
    c.post("/api/auth/register", json={"email": "f@g.com", "password": "secret12", "name": "Fam"})
    sess = c.post("/api/auth/login", json={"email": "f@g.com", "password": "secret12"}).json()
    hdr = {"X-Session-Token": sess["token"]}
    # create family before verifying → 403
    assert c.post("/api/family/create", json={"name": "My Fam"}, headers=hdr).status_code == 403
    c.get(f"/api/auth/verify?token={_tok(acc,'token')}", follow_redirects=False)
    r = c.post("/api/family/create", json={"name": "My Fam"}, headers=hdr)
    assert r.status_code == 200 and r.json()["invite_code"]
    tg = sqlite3.connect(acc._db).execute("SELECT tg_chat_id FROM family_members WHERE user_id=?", (sess["user_id"],)).fetchone()[0]
    assert tg is None  # accounts users have no Telegram chat


def test_google_create_link_and_audience(acc, monkeypatch):
    c = _c(acc); CID = "test-client.apps.googleusercontent.com"; claims = {}
    class FR:
        status_code = 200
        def json(self): return claims
    class FC:
        def __init__(self, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None): return FR()
    monkeypatch.setattr(acc.httpx, "AsyncClient", FC)
    claims.update({"aud": CID, "iss": "accounts.google.com", "sub": "S1", "email": "g@h.com", "email_verified": "true", "name": "G"})
    r = c.post("/api/auth/google", json={"credential": "x"})
    assert r.status_code == 200 and r.json()["email_verified"] is True
    uid1 = r.json()["user_id"]
    assert c.post("/api/auth/google", json={"credential": "x"}).json()["user_id"] == uid1  # repeat → same account
    # link Google to an existing verified-email account
    c.post("/api/auth/register", json={"email": "link@me.com", "password": "secret12"})
    claims.clear(); claims.update({"aud": CID, "iss": "accounts.google.com", "sub": "S2", "email": "link@me.com", "email_verified": "true"})
    c.post("/api/auth/google", json={"credential": "x"})
    assert sqlite3.connect(acc._db).execute("SELECT google_sub FROM users WHERE email_norm='link@me.com'").fetchone()[0] == "S2"
    # wrong audience (token minted for a different client) → 401
    claims.clear(); claims.update({"aud": "other-app", "iss": "accounts.google.com", "sub": "S3", "email": "e@e.com", "email_verified": "true"})
    assert c.post("/api/auth/google", json={"credential": "x"}).status_code == 401


def test_rate_limit_login(acc):
    c = _c(acc)
    statuses = [c.post("/api/auth/login", json={"email": "same@e.com", "password": "zzzzzzzz"}).status_code for _ in range(12)]
    assert 429 in statuses  # per-email limit (7) trips before the per-IP limit


def test_accounts_endpoints_404_in_telegram_mode(monkeypatch):
    app, path = _fresh_app(monkeypatch, "telegram")
    try:
        c = TestClient(app.app)
        assert c.get("/api/auth/config").json()["mode"] == "telegram"
        assert c.post("/api/auth/login", json={"email": "a@b.com", "password": "zzzzzzzz"}).status_code == 404
        assert c.post("/api/auth/register", json={"email": "a@b.com", "password": "zzzzzzzz"}).status_code == 404
    finally:
        try: os.remove(path)
        except OSError: pass
