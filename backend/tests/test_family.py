"""
Family CRUD + multi-tenant onboarding flow.
- create -> status returns the new family
- join with invite code -> status reflects the joined family
- lang preference round-trips via PATCH /api/members/me/lang
"""


def test_create_family_returns_invite_code(app_module, temp_db):
    """Create a family for a freshly-onboarded user (no prior membership)."""
    import sqlite3
    from fastapi.testclient import TestClient

    user_id = 200

    async def fake_get_user():
        return {"id": user_id, "first_name": "Newbie", "photo_url": None}

    app_module.app.dependency_overrides[app_module.get_user] = fake_get_user

    client = TestClient(app_module.app)
    r = client.post("/api/family/create", json={"name": "Test Family"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Test Family"
    assert len(body["invite_code"]) >= 4
    assert body["family_id"] >= 1

    # Status should now reflect membership
    s = client.get("/api/family/status").json()
    assert s["joined"] is True
    assert s["name"] == "Test Family"
    assert s["my_id"] == user_id
    assert s["lang"] == "en"  # default


def test_join_family_via_invite(app_module, temp_db):
    """Two users: A creates, B joins via code -> both in same family."""
    from fastapi.testclient import TestClient

    state = {"current_uid": 300}

    async def fake_get_user():
        return {"id": state["current_uid"], "first_name": f"U{state['current_uid']}", "photo_url": None}

    app_module.app.dependency_overrides[app_module.get_user] = fake_get_user
    client = TestClient(app_module.app)

    # A creates
    state["current_uid"] = 300
    r = client.post("/api/family/create", json={"name": "Shared"})
    assert r.status_code == 200
    code = r.json()["invite_code"]
    fam_id = r.json()["family_id"]

    # B joins
    state["current_uid"] = 301
    r = client.post("/api/family/join", json={"code": code})
    assert r.status_code == 200
    assert r.json()["family_id"] == fam_id

    # B sees family
    s = client.get("/api/family/status").json()
    assert s["joined"] is True
    assert s["family_id"] == fam_id


def test_join_wrong_code_404(app_module, temp_db):
    from fastapi.testclient import TestClient

    async def fake_get_user():
        return {"id": 999, "first_name": "X", "photo_url": None}

    app_module.app.dependency_overrides[app_module.get_user] = fake_get_user
    client = TestClient(app_module.app)
    r = client.post("/api/family/join", json={"code": "ZZZZZZ"})
    assert r.status_code in (400, 404)


def test_lang_round_trip(client_as):
    """PATCH /api/members/me/lang persists, status reflects it."""
    client = client_as(user_id=400, family_id=1)

    # Default is 'en'
    s = client.get("/api/family/status").json()
    assert s["lang"] == "en"

    # Switch to ru
    r = client.patch("/api/members/me/lang", json={"lang": "ru"})
    assert r.status_code == 200
    assert r.json()["lang"] == "ru"

    s = client.get("/api/family/status").json()
    assert s["lang"] == "ru"


def test_lang_invalid_400(client_as):
    client = client_as(user_id=401, family_id=1)
    r = client.patch("/api/members/me/lang", json={"lang": "de"})
    assert r.status_code == 400
