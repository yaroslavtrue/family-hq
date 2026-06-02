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
    assert len(s["areas"]) == 8

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

    # Override the 'career' node name + emoji.
    r = client.put("/api/life/nodes/career", json={"name": "My Work", "emoji": "🛠"})
    assert r.status_code == 200, r.text

    s = client.get("/api/life/summary").json()
    career = next(a for a in s["areas"] if a["id"] == "career")
    assert career["name"] == "My Work"
    assert career["emoji"] == "🛠"
    assert career["customized"] is True

    # Clear override → falls back to code default (English for a user with no lang).
    r = client.put("/api/life/nodes/career", json={"name": "", "emoji": ""})
    assert r.json().get("cleared") is True
    s = client.get("/api/life/summary").json()
    career = next(a for a in s["areas"] if a["id"] == "career")
    assert career["name"] == "Career"
    assert career["customized"] is False


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


def test_add_and_delete_personal_sphere(client_as):
    client = client_as(user_id=810, family_id=1)

    # Add a custom sphere.
    r = client.post("/api/life/areas", json={"name": "Travel", "emoji": "✈️"})
    assert r.status_code == 200, r.text
    key = r.json()["id"]
    assert r.json()["is_custom"] is True

    s = client.get("/api/life/summary").json()
    assert len(s["areas"]) == 9
    travel = next(a for a in s["areas"] if a["id"] == key)
    assert travel["name"] == "Travel" and travel["is_custom"] is True

    # Plant a habit in it.
    h = client.post("/api/life/habits", json={"area_id": key, "name": "Plan a trip"})
    assert h.status_code == 200, h.text
    hid = h.json()["id"]

    # Delete the sphere → it + its habit are gone.
    d = client.delete(f"/api/life/areas/{key}")
    assert d.status_code == 200 and d.json()["deleted_habits"] == 1
    s = client.get("/api/life/summary").json()
    assert len(s["areas"]) == 8
    assert all(a["id"] != key for a in s["areas"])
    # The habit no longer lists.
    hl = client.get(f"/api/life/habits?area_id={key}").json()
    assert hl["habits"] == []


def test_delete_default_sphere(client_as):
    client = client_as(user_id=811, family_id=1)
    client.get("/api/life/summary")  # seed
    d = client.delete("/api/life/areas/fun")
    assert d.status_code == 200, d.text
    s = client.get("/api/life/summary").json()
    assert len(s["areas"]) == 7
    assert all(a["id"] != "fun" for a in s["areas"])


def test_family_spheres_are_editable(client_as):
    client = client_as(user_id=812, family_id=1)
    # Family scope starts seeded with the 6 relationship spheres.
    s = client.get("/api/life/summary?owner=family").json()
    assert len(s["areas"]) == 6 and any(a["id"] == "rel_time" for a in s["areas"])

    # Add a custom family sphere.
    r = client.post("/api/life/areas", json={"owner": "family", "name": "Travel Together", "emoji": "✈️"})
    assert r.status_code == 200, r.text
    key = r.json()["id"]
    s = client.get("/api/life/summary?owner=family").json()
    assert len(s["areas"]) == 7

    # Delete a default family sphere.
    d = client.delete("/api/life/areas/rel_time?owner=family")
    assert d.status_code == 200, d.text
    s = client.get("/api/life/summary?owner=family").json()
    assert len(s["areas"]) == 6
    assert all(a["id"] != "rel_time" for a in s["areas"])
    assert any(a["id"] == key for a in s["areas"])


def test_journey_stats(client_as):
    client = client_as(user_id=820, family_id=1)
    # One habit, logged today.
    hid = client.post("/api/life/habits", json={"area_id": "health", "name": "Walk"}).json()["id"]
    client.post(f"/api/life/habits/{hid}/log")

    j = client.get("/api/life/journey?days=14").json()
    assert j["scope"] == "personal"
    assert len(j["areas"]) == 8
    assert len(j["daily"]) == 14
    assert j["daily"][-1]["count"] == 1          # today has one completion
    assert j["stats"]["habits"] == 1
    assert j["stats"]["done_today"] == 1
    assert j["stats"]["completions_7d"] == 1
    assert j["stats"]["best_streak"] == 1
    health = next(a for a in j["areas"] if a["id"] == "health")
    assert health["brightness"] == 1.0


def test_suggest_validates_area_and_requires_ai(client_as, app_module):
    client = client_as(user_id=804, family_id=1)
    # Cross-scope area id is rejected before any AI call.
    bad = client.post("/api/life/suggest", json={"area_id": "rel_time"})
    assert bad.status_code == 400
    # Valid area but AI not configured → 503 (blank the key on the loaded module).
    app_module.ANTHROPIC_API_KEY = ""
    r = client.post("/api/life/suggest", json={"area_id": "health"})
    assert r.status_code == 503
