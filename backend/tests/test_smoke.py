"""
Most basic smoke tests — endpoints respond, bundle has expected shape.
If these fail, something fundamental broke; nothing else will work either.
"""


def test_ping_returns_version(anon_client):
    r = anon_client.get("/api/debug/ping")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "version" in body
    assert body["version"].startswith("v")


def test_serve_index(anon_client):
    r = anon_client.get("/")
    assert r.status_code == 200
    assert "Moya" in r.text  # title / header (rebranded from "Family HQ")


def test_bot_info_shape(anon_client):
    """Bot username is fetched lazily from Telegram; with our test BOT_TOKEN the call fails
    and we should still get a clean {bot_username: null} (not a 500)."""
    r = anon_client.get("/api/auth/bot-info")
    assert r.status_code == 200
    assert "bot_username" in r.json()


def test_migration_applied_to_latest(app_module, temp_db):
    """schema_version table should be at the latest migration after migrate() ran in conftest.
    Bumped to v42 (push_tokens for FCM push notifications)."""
    import sqlite3
    con = sqlite3.connect(temp_db)
    ver = con.execute("SELECT version FROM schema_version").fetchone()[0]
    con.close()
    assert ver == 42, f"Expected schema v42, got v{ver}"


def test_bundle_shape(client_as):
    """Bundle endpoint returns the expected top-level keys for a user in a family."""
    client = client_as(user_id=100, family_id=1)
    r = client.get("/api/bundle")
    assert r.status_code == 200, r.text
    body = r.json()
    expected = {"tasks", "recurring", "shopping", "folders", "events", "birthdays",
                "subs", "members", "settings", "categories", "transactions",
                "exercises", "recent_workouts", "workout_templates", "plants", "zones"}
    missing = expected - set(body.keys())
    assert not missing, f"Bundle missing keys: {missing}"


def test_bundle_no_auth_401(anon_client):
    """Without auth headers OR session token, bundle should reject."""
    r = anon_client.get("/api/bundle")
    assert r.status_code == 401
