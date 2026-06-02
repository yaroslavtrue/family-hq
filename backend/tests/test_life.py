"""
Life tab — habit/balance network (v8.51.0).

Covers: create habit in a personal area, log toggles streak/consistency,
summary brightness reflects logging, node override + clear, family scope
uses the relationship area set, area validation rejects cross-scope ids.
"""


def test_create_log_and_summary_brightness(client_as):
    client = client_as(user_id=800, family_id=1)

    # Default owner = me; create a daily habit feeding 'health'.
    r = client.post("/api/life/habits", json={
        "area_id": "health", "name": "Morning Walk", "emoji": "🚶", "frequency": "daily",
    })
    assert r.status_code == 200, r.text
    hid = r.json()["id"]
    assert r.json()["done_today"] is False
    assert r.json()["streak"] == 0

    # Brightness starts at 0 (no completions yet).
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["habit_count"] == 1
    assert health["brightness"] == 0.0
    assert s["scope"] == "personal"
    assert len(s["areas"]) == 6

    # Log today → done_today True, streak 1, consistency 1.0 (1 scheduled day, 1 done).
    r = client.post(f"/api/life/habits/{hid}/log").json()
    assert r["done_today"] is True
    assert r["streak"] == 1
    assert r["consistency"] == 1.0

    # Summary brightness now reflects the completion.
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["brightness"] == 1.0

    # Toggle off → back to not done.
    r = client.post(f"/api/life/habits/{hid}/log").json()
    assert r["done_today"] is False


def test_node_override_set_and_clear(client_as):
    client = client_as(user_id=801, family_id=1)

    # Override the 'focus' node name + emoji.
    r = client.put("/api/life/nodes/focus", json={"name": "Deep Work", "emoji": "🛠"})
    assert r.status_code == 200, r.text

    s = client.get("/api/life/summary").json()
    focus = next(a for a in s["areas"] if a["id"] == "focus")
    assert focus["name"] == "Deep Work"
    assert focus["emoji"] == "🛠"
    assert focus["customized"] is True

    # Clear override → falls back to code default.
    r = client.put("/api/life/nodes/focus", json={"name": "", "emoji": ""})
    assert r.json().get("cleared") is True
    s = client.get("/api/life/summary").json()
    focus = next(a for a in s["areas"] if a["id"] == "focus")
    assert focus["name"] == "Focus"
    assert focus["customized"] is False


def test_family_scope_uses_relationship_areas(client_as):
    client = client_as(user_id=802, family_id=1)

    s = client.get("/api/life/summary?owner=family").json()
    assert s["scope"] == "family"
    ids = {a["id"] for a in s["areas"]}
    assert "rel_time" in ids and "rel_affection" in ids
    assert "focus" not in ids  # personal ids excluded from family scope

    # A relationship habit must use a relationship area id.
    r = client.post("/api/life/habits", json={
        "owner": "family", "area_id": "rel_time", "name": "Phone-free dinner",
    })
    assert r.status_code == 200, r.text

    # Cross-scope area id is rejected.
    bad = client.post("/api/life/habits", json={
        "owner": "family", "area_id": "focus", "name": "nope",
    })
    assert bad.status_code == 400


def test_personal_scope_rejects_relationship_area(client_as):
    client = client_as(user_id=803, family_id=1)
    bad = client.post("/api/life/habits", json={"area_id": "rel_time", "name": "nope"})
    assert bad.status_code == 400


def test_suggest_validates_area_and_requires_ai(client_as, app_module):
    client = client_as(user_id=804, family_id=1)
    # Cross-scope area id is rejected before any AI call.
    bad = client.post("/api/life/suggest", json={"area_id": "rel_time"})
    assert bad.status_code == 400
    # Valid area but AI not configured → 503 (blank the key on the loaded module).
    app_module.ANTHROPIC_API_KEY = ""
    r = client.post("/api/life/suggest", json={"area_id": "health"})
    assert r.status_code == 503
