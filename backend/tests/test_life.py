"""
Life tab — habit/balance network (v8.51.0).

Covers: create habit in a personal area, log toggles streak/consistency,
summary brightness reflects logging, node override + clear, family scope
uses the relationship area set, area validation rejects cross-scope ids.
"""


def test_create_log_and_summary_brightness(client_as, freeze_now):
    client = client_as(user_id=800, family_id=1)

    # Default owner = me; create a daily habit feeding 'health'.
    r = client.post("/api/life/habits", json={
        "area_id": "health", "name": "Morning Walk", "emoji": "🚶", "frequency": "daily",
    })
    assert r.status_code == 200, r.text
    hid = r.json()["id"]
    assert r.json()["done_today"] is False
    assert r.json()["streak"] == 0

    # Pin created_at to the frozen day so consistency math doesn't depend on
    # wall-clock time (see Bugs & Fixes: life consistency flake).
    freeze_now.pin_created(hid)

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


def test_journey_stats(client_as, freeze_now):
    client = client_as(user_id=820, family_id=1)
    # One habit, logged today. Pin created_at to the frozen day so the
    # consistency/streak math is wall-clock independent (Bugs & Fixes: flake).
    hid = client.post("/api/life/habits", json={"area_id": "health", "name": "Walk"}).json()["id"]
    freeze_now.pin_created(hid)
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


def test_challenge_count_progress(client_as):
    client = client_as(user_id=830, family_id=1)
    hid = client.post("/api/life/habits", json={"area_id": "health", "name": "Walk"}).json()["id"]
    client.post(f"/api/life/habits/{hid}/log")  # 1 completion today

    # Count challenge: 3 completions in 7 days, bound to the habit.
    r = client.post("/api/life/challenges", json={
        "title": "Walk 3x", "kind": "count", "target": 3, "habit_id": hid, "period_days": 7})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json()["progress"] == 1 and r.json()["status"] == "active"
    assert r.json()["target"] == 3 and r.json()["subject"] == "Walk"

    lst = client.get("/api/life/challenges").json()
    assert len(lst["challenges"]) == 1 and lst["challenges"][0]["progress"] == 1

    # Area-bound challenge counts any habit in the sphere.
    r2 = client.post("/api/life/challenges", json={
        "title": "Health hustle", "kind": "count", "target": 5, "area_id": "health", "period_days": 14})
    assert r2.status_code == 200 and r2.json()["progress"] == 1

    d = client.delete(f"/api/life/challenges/{cid}")
    assert d.status_code == 200
    assert len(client.get("/api/life/challenges").json()["challenges"]) == 1


def test_challenge_done_when_target_met(client_as):
    client = client_as(user_id=831, family_id=1)
    hid = client.post("/api/life/habits", json={"area_id": "health", "name": "Walk"}).json()["id"]
    client.post(f"/api/life/habits/{hid}/log")
    r = client.post("/api/life/challenges", json={
        "title": "One walk", "kind": "count", "target": 1, "habit_id": hid, "period_days": 7})
    assert r.json()["status"] == "done" and r.json()["progress"] >= 1


def test_challenge_bad_area_rejected(client_as):
    client = client_as(user_id=832, family_id=1)
    bad = client.post("/api/life/challenges", json={"title": "x", "area_id": "rel_time", "target": 3})
    assert bad.status_code == 400


def test_challenge_participants_per_person(client_as):
    # Two members in family 1, each with a Health habit logged today.
    a = client_as(user_id=840, family_id=1)
    ha = a.post("/api/life/habits", json={"area_id": "health", "name": "Walk"}).json()["id"]
    a.post(f"/api/life/habits/{ha}/log")
    b = client_as(user_id=841, family_id=1)
    hb = b.post("/api/life/habits", json={"area_id": "health", "name": "Run"}).json()["id"]
    b.post(f"/api/life/habits/{hb}/log")

    # Group challenge created by 840 with both participants.
    a = client_as(user_id=840, family_id=1)
    r = a.post("/api/life/challenges", json={
        "title": "Both move", "area_id": "health", "target": 3, "participants": [840, 841]})
    assert r.status_code == 200, r.text
    ch = r.json()
    assert ch["owner"] == "family"
    assert ch["participants"] is not None and len(ch["participants"]) == 2
    by = {p["user_id"]: p for p in ch["participants"]}
    assert by[840]["progress"] == 1 and by[841]["progress"] == 1  # each counts their own habit
    assert ch["status"] == "active"

    # Lives under the Family scope (both see it).
    fam = a.get("/api/life/challenges?owner=family").json()
    assert any(c["id"] == ch["id"] for c in fam["challenges"])


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
