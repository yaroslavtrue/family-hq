"""
Push notifications (FCM) — product/accounts instance.

Covers:
- /api/push/register upsert + /api/push/unregister (needs a session).
- The scheduler's parallel push channel: Telegram-only when FCM is unconfigured
  (Telegram-instance regression), and dead-token pruning when it is.
- fcm.send() payload shape + UNREGISTERED → "dead".
"""
import sqlite3, asyncio
import pytest


def _seed_member(con, uid, fid=1, tg=None, name="T"):
    if not con.execute("SELECT 1 FROM families WHERE id=?", (fid,)).fetchone():
        con.execute("INSERT INTO families (id, name, invite_code) VALUES (?,?,?)", (fid, "Fam", f"INV{fid:03d}"))
    con.execute("INSERT INTO family_members (user_id, family_id, user_name, tg_chat_id) VALUES (?,?,?,?)",
                (uid, fid, name, tg))
    con.commit()


# ─── Endpoints ────────────────────────────────────────────────────────────
def test_push_register_upsert_and_unregister(client_as, db_conn):
    c = client_as(7, 1)
    r = c.post("/api/push/register", json={"token": "tok-abc", "platform": "android"})
    assert r.status_code == 200 and r.json()["ok"] is True
    rows = db_conn.execute("SELECT user_id, token, platform FROM push_tokens").fetchall()
    assert len(rows) == 1 and rows[0]["token"] == "tok-abc" and rows[0]["user_id"] == 7

    # Re-registering the same token (ON CONFLICT) keeps a single row.
    c.post("/api/push/register", json={"token": "tok-abc"})
    assert db_conn.execute("SELECT COUNT(*) n FROM push_tokens").fetchone()["n"] == 1

    # Unregister removes it (master toggle off / logout).
    assert c.post("/api/push/unregister", json={"token": "tok-abc"}).status_code == 200
    assert db_conn.execute("SELECT COUNT(*) n FROM push_tokens").fetchone()["n"] == 0


def test_push_register_requires_session(app_module):
    from fastapi.testclient import TestClient
    # No dependency override → real get_user runs → 401 (BOT_TOKEN is set in tests).
    app_module.app.dependency_overrides.clear()
    r = TestClient(app_module.app).post("/api/push/register", json={"token": "x"})
    assert r.status_code == 401


# ─── Scheduler delivery branching ─────────────────────────────────────────
def test_notify_user_telegram_only_when_fcm_off(app_module, temp_db, db_conn, monkeypatch):
    sched = app_module.sched
    sched.DB_PATH = temp_db
    _seed_member(db_conn, 5, 1, tg=999)
    db_conn.execute("INSERT INTO push_tokens (user_id, token) VALUES (5, 'tk5')"); db_conn.commit()

    sent = []
    async def fake_send(chat, text, *a, **k): sent.append((chat, text))
    monkeypatch.setattr(sched, "_send", fake_send)
    assert sched.fcm.configured() is False  # no FCM env in tests

    con = sqlite3.connect(temp_db); con.row_factory = sqlite3.Row
    asyncio.run(sched._notify_user(5, "🔔 hi", con)); con.close()

    assert sent == [(999, "🔔 hi")]
    # Push channel was a no-op → token untouched.
    assert db_conn.execute("SELECT COUNT(*) n FROM push_tokens").fetchone()["n"] == 1


def test_push_prunes_dead_tokens(app_module, temp_db, db_conn, monkeypatch):
    sched = app_module.sched
    sched.DB_PATH = temp_db
    _seed_member(db_conn, 8, 1, tg=None)  # accounts user: no Telegram chat
    db_conn.executemany("INSERT INTO push_tokens (user_id, token) VALUES (?,?)",
                        [(8, "live"), (8, "dead")]); db_conn.commit()

    monkeypatch.setattr(sched.fcm, "configured", lambda: True)
    calls = []
    async def fake_send(token, title, body, data=None):
        calls.append((token, title, body))
        return "dead" if token == "dead" else "ok"
    monkeypatch.setattr(sched.fcm, "send", fake_send)
    async def boom(*a, **k): raise AssertionError("Telegram send must not run for a tg-less user")
    monkeypatch.setattr(sched, "_send", boom)

    con = sqlite3.connect(temp_db); con.row_factory = sqlite3.Row
    asyncio.run(sched._notify_user(8, "🔔 *Task reminder:* Buy milk\nDue today", con)); con.close()

    assert {c[0] for c in calls} == {"live", "dead"}
    left = [r["token"] for r in db_conn.execute("SELECT token FROM push_tokens").fetchall()]
    assert left == ["live"]
    # Title/body derived from the markdown reminder (first line → title).
    assert calls[0][1] and calls[0][2] and "*" not in calls[0][1]


# ─── fcm.send payload + dead-token signal ─────────────────────────────────
def _force_configured(monkeypatch):
    from backend import fcm
    monkeypatch.setenv("FCM_PROJECT_ID", "proj-x")
    monkeypatch.setattr(fcm, "jwt", object())  # truthy → passes configured() gate
    monkeypatch.setattr(fcm, "_service_account", lambda: {"client_email": "x@y", "private_key": "k"})
    async def fake_at(): return "AT"
    monkeypatch.setattr(fcm, "_access_token", fake_at)
    return fcm


class _Resp:
    def __init__(self, code, text="OK"): self.status_code = code; self.text = text


def test_fcm_send_payload_shape(monkeypatch):
    fcm = _force_configured(monkeypatch)
    captured = {}
    class _Client:
        async def post(self, url, headers=None, json=None):
            captured.update(url=url, headers=headers, json=json); return _Resp(200)
    monkeypatch.setattr(fcm, "_http", lambda: _Client())

    res = asyncio.run(fcm.send("TKN", "Title", "Body", {"id": 5, "type": "task"}))
    assert res == "ok"
    msg = captured["json"]["message"]
    assert msg["token"] == "TKN"
    assert msg["notification"] == {"title": "Title", "body": "Body"}
    assert msg["android"]["priority"] == "high"
    assert msg["data"] == {"id": "5", "type": "task"}  # all values stringified
    assert "proj-x" in captured["url"] and captured["headers"]["Authorization"] == "Bearer AT"


def test_fcm_send_dead_on_unregistered(monkeypatch):
    fcm = _force_configured(monkeypatch)
    class _Client:
        async def post(self, *a, **k): return _Resp(404, "NOT_FOUND")
    monkeypatch.setattr(fcm, "_http", lambda: _Client())
    assert asyncio.run(fcm.send("TKN", "T", "B")) == "dead"


def test_fcm_send_dead_on_invalid_token(monkeypatch):
    fcm = _force_configured(monkeypatch)
    class _Client:
        async def post(self, *a, **k):
            return _Resp(400, '{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}')
    monkeypatch.setattr(fcm, "_http", lambda: _Client())
    assert asyncio.run(fcm.send("garbage", "T", "B")) == "dead"


def test_fcm_send_skip_when_unconfigured(monkeypatch):
    from backend import fcm
    monkeypatch.delenv("FCM_PROJECT_ID", raising=False)
    monkeypatch.setattr(fcm, "_service_account", lambda: None)
    assert asyncio.run(fcm.send("x", "t", "b")) == "skip"
