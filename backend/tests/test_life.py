"""
Life tab — habit/balance network (v8.51.0).

Covers: create habit in a personal area, log toggles streak/consistency,
summary brightness reflects logging, node override + clear, family scope
uses the relationship area set, area validation rejects cross-scope ids.
"""


def test_create_event_and_node_fill(client_as):
    client = client_as(user_id=800, family_id=1)

    # Empty board: node_count 0, brightness 0.
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["event_count"] == 0 and health["brightness"] == 0.0
    assert s["scope"] == "personal" and len(s["areas"]) == 8

    # Log an event into 'health' → counter starts at 1.
    r = client.post("/api/life/events", json={"area_id": "health", "name": "Pushups", "emoji": "💪"})
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    assert r.json()["count"] == 1 and r.json()["area_id"] == "health"

    # Node fills gently: 1 distinct event → brightness 0.15 (+15%/event).
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["event_count"] == 1 and health["brightness"] == 0.15

    # Re-live it → counter grows; still ONE distinct event (node fill unchanged).
    assert client.post(f"/api/life/events/{eid}/bump", json={"delta": 1}).json()["count"] == 2
    assert client.post(f"/api/life/events/{eid}/bump", json={"delta": 1}).json()["count"] == 3
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["event_count"] == 1  # distinct count drives the node, not taps

    # Correct a mis-tap (−1), clamped at 1.
    assert client.post(f"/api/life/events/{eid}/bump", json={"delta": -1}).json()["count"] == 2
    for _ in range(5):
        client.post(f"/api/life/events/{eid}/bump", json={"delta": -1})
    assert client.get("/api/life/events?area_id=health").json()["events"][0]["count"] == 1

    # A second distinct event fills the node further (2/5 = 0.4).
    client.post("/api/life/events", json={"area_id": "health", "name": "Run"})
    s = client.get("/api/life/summary").json()
    health = next(a for a in s["areas"] if a["id"] == "health")
    assert health["event_count"] == 2 and health["brightness"] == 0.3


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

    # A relationship event must use a relationship area id.
    r = client.post("/api/life/events", json={
        "owner": "family", "area_id": "rel_time", "name": "Phone-free dinner",
    })
    assert r.status_code == 200, r.text

    # Cross-scope area id is rejected.
    bad = client.post("/api/life/events", json={
        "owner": "family", "area_id": "focus", "name": "nope",
    })
    assert bad.status_code == 400


def test_personal_scope_rejects_relationship_area(client_as):
    client = client_as(user_id=803, family_id=1)
    bad = client.post("/api/life/events", json={"area_id": "rel_time", "name": "nope"})
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

    # Log an event in it.
    h = client.post("/api/life/events", json={"area_id": key, "name": "Plan a trip"})
    assert h.status_code == 200, h.text

    # Delete the sphere → it + its events are gone.
    d = client.delete(f"/api/life/areas/{key}")
    assert d.status_code == 200 and d.json()["deleted_events"] == 1
    s = client.get("/api/life/summary").json()
    assert len(s["areas"]) == 8
    assert all(a["id"] != key for a in s["areas"])
    # The event no longer lists.
    el = client.get(f"/api/life/events?area_id={key}").json()
    assert el["events"] == []


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
    # Two events in 'health', one re-lived (count 3) → 2 distinct, 4 total taps.
    eid = client.post("/api/life/events", json={"area_id": "health", "name": "Walk"}).json()["id"]
    client.post(f"/api/life/events/{eid}/bump", json={"delta": 1})
    client.post(f"/api/life/events/{eid}/bump", json={"delta": 1})  # Walk count 3
    client.post("/api/life/events", json={"area_id": "health", "name": "Run"})  # count 1

    j = client.get("/api/life/journey").json()
    assert j["scope"] == "personal"
    assert len(j["areas"]) == 8
    assert j["stats"]["events"] == 2          # two distinct events
    assert j["stats"]["total_count"] == 4     # 3 + 1 taps
    assert j["stats"]["top_event"] == "Walk" and j["stats"]["top_count"] == 3
    health = next(a for a in j["areas"] if a["id"] == "health")
    assert health["event_count"] == 2 and health["brightness"] == 0.3


def test_challenges_are_score_only(client_as):
    """count/streak are retired — any non-score kind is coerced to a manual score
    scoreboard, with no habit/area binding."""
    client = client_as(user_id=830, family_id=1)
    r = client.post("/api/life/challenges", json={
        "title": "Old style", "kind": "count", "target": 3, "area_id": "health", "period_days": 7})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "score"


def test_pin_carry_over(client_as, db_conn):
    """A pinned event rolls into the current month (count reset, still pinned);
    the old row is demoted so it rolls exactly once."""
    client = client_as(user_id=845, family_id=1)
    eid = client.post("/api/life/events", json={"area_id": "health", "name": "Stretch"}).json()["id"]
    client.post(f"/api/life/events/{eid}/bump", json={"delta": 1})  # count 2
    p = client.post(f"/api/life/events/{eid}/pin", json={"pinned": True}).json()
    assert p["pinned"] is True

    # Simulate the month ending: shove this row into a past month.
    db_conn.execute("UPDATE life_events SET ym='2000-01' WHERE id=?", (eid,))
    db_conn.commit()

    # Opening the current month rolls the pinned event forward (fresh count 1).
    evs = client.get("/api/life/events?area_id=health").json()["events"]
    assert len(evs) == 1 and evs[0]["name"] == "Stretch"
    assert evs[0]["count"] == 1 and evs[0]["pinned"] is True
    assert evs[0]["id"] != eid  # a fresh current-month copy

    # Old row demoted → it won't roll again (no duplicate on re-open).
    assert db_conn.execute("SELECT pinned FROM life_events WHERE id=?", (eid,)).fetchone()[0] == 0
    again = client.get("/api/life/events?area_id=health").json()["events"]
    assert len(again) == 1


def test_month_isolation(client_as, db_conn):
    """An event logged this month is absent when querying another month, and
    bumping a past-month row is rejected (read-only)."""
    client = client_as(user_id=835, family_id=1)
    eid = client.post("/api/life/events", json={"area_id": "fun", "name": "Met friends"}).json()["id"]

    # Present this month, absent in a different month.
    assert len(client.get("/api/life/events?area_id=fun").json()["events"]) == 1
    assert client.get("/api/life/events?area_id=fun&ym=2099-01").json()["events"] == []
    s_other = client.get("/api/life/summary?ym=2099-01").json()
    assert next(a for a in s_other["areas"] if a["id"] == "fun")["event_count"] == 0

    # Current-month bump works.
    assert client.post(f"/api/life/events/{eid}/bump", json={"delta": 1}).json()["count"] == 2

    # Force the row into a past month → bumping is now rejected.
    db_conn.execute("UPDATE life_events SET ym='2000-01' WHERE id=?", (eid,))
    db_conn.commit()
    assert client.post(f"/api/life/events/{eid}/bump", json={"delta": 1}).status_code == 400


def test_score_challenge_bump(client_as):
    a = client_as(user_id=850, family_id=1)
    b = client_as(user_id=851, family_id=1)  # register second member
    a = client_as(user_id=850, family_id=1)
    r = a.post("/api/life/challenges", json={
        "title": "Love Points", "emoji": "💕", "kind": "score", "target": 0,
        "participants": [850, 851], "period_days": 30})
    assert r.status_code == 200, r.text
    ch = r.json()
    cid = ch["id"]
    assert ch["kind"] == "score" and ch["owner"] == "family"
    by = {p["user_id"]: p for p in ch["participants"]}
    assert by[850]["progress"] == 0 and by[851]["progress"] == 0

    # +2 for 850, +1 for 851, then -1 for 850.
    a.post(f"/api/life/challenges/{cid}/score", json={"user_id": 850, "delta": 1})
    a.post(f"/api/life/challenges/{cid}/score", json={"user_id": 850, "delta": 1})
    a.post(f"/api/life/challenges/{cid}/score", json={"user_id": 851, "delta": 1})
    res = a.post(f"/api/life/challenges/{cid}/score", json={"user_id": 850, "delta": -1}).json()
    by = {p["user_id"]: p for p in res["participants"]}
    assert by[850]["progress"] == 1 and by[851]["progress"] == 1

    # Clamps at 0.
    res = a.post(f"/api/life/challenges/{cid}/score", json={"user_id": 851, "delta": -5}).json()
    by = {p["user_id"]: p for p in res["participants"]}
    assert by[851]["progress"] == 0

    # Shows up in /active.
    act = a.get("/api/life/active").json()
    assert any(c["id"] == cid for c in act["challenges"])


def test_love_points(client_as):
    # NOTE: dependency override is global — the LAST client_as() call sets the
    # active user. Re-create the client whenever the acting user changes.
    client_as(user_id=861, family_id=1)        # register second member
    a = client_as(user_id=860, family_id=1)    # active = 860

    # Empty to start.
    st = a.get("/api/love").json()
    assert st["scores"] == {} and st["leader"] is None
    assert st["days_left"] >= 0 and st["days_in_month"] in (28, 29, 30, 31)

    # 860 gives 861 two points (with reason+emoji).
    a.post("/api/love", json={"to_user": 861, "reason": "made coffee", "emoji": "☕"})
    st = a.post("/api/love", json={"to_user": 861, "reason": "hug", "emoji": "🤗"}).json()
    assert st["scores"]["861"] == 2 and st["leader"] == 861

    # Switch to 861 → gives 860 one point.
    b = client_as(user_id=861, family_id=1)
    b.post("/api/love", json={"to_user": 860, "reason": "dishes", "emoji": "🍽"})
    st = b.get("/api/love").json()
    assert st["scores"]["860"] == 1 and st["scores"]["861"] == 2

    # Stats log shows newest first, with reason + giver.
    stats = b.get("/api/love/stats").json()
    assert len(stats["entries"]) == 3
    assert stats["entries"][0]["from_user"] == 861 and stats["entries"][0]["to_user"] == 860
    assert stats["entries"][0]["reason"] == "dishes"

    # Switch back to 860, undo latest point for 861 → back to 1.
    a = client_as(user_id=860, family_id=1)
    st = a.delete("/api/love/latest?to_user=861").json()
    assert st["scores"]["861"] == 1

    # Deduction (-1) with a reason: 861 goes 1 → 0, and the log records the minus.
    st = a.post("/api/love", json={"to_user": 861, "reason": "ate my snack", "emoji": "😤", "delta": -1}).json()
    assert st["scores"]["861"] == 0
    stats = a.get("/api/love/stats").json()
    assert stats["entries"][0]["delta"] == -1 and stats["entries"][0]["reason"] == "ate my snack"
    # Net can go below zero (deliberate deduction, not clamped).
    st = a.post("/api/love", json={"to_user": 861, "reason": "again", "delta": -1}).json()
    assert st["scores"]["861"] == -1

    # Unknown recipient rejected.
    assert a.post("/api/love", json={"to_user": 99999, "reason": "x"}).status_code == 400

    # History: current month carries the net per member, oldest→newest, members present.
    hist = a.get("/api/love/history?months=6").json()
    assert len(hist["months"]) == 6
    assert len(hist["members"]) == 2
    cur = hist["months"][-1]  # newest = current month
    assert cur["scores"]["860"] == 1 and cur["scores"]["861"] == -1


def test_suggest_validates_area_and_requires_ai(client_as, app_module):
    client = client_as(user_id=804, family_id=1)
    # Cross-scope area id is rejected before any AI call.
    bad = client.post("/api/life/suggest", json={"area_id": "rel_time"})
    assert bad.status_code == 400
    # Valid area but AI not configured → 503 (blank the key on the loaded module).
    app_module.ANTHROPIC_API_KEY = ""
    r = client.post("/api/life/suggest", json={"area_id": "health"})
    assert r.status_code == 503
