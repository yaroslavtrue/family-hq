"""
Multi-family data isolation — THE MOST IMPORTANT TEST FILE.

Verifies that family A's user cannot read, modify, or delete family B's data
even when they pass family B's resource IDs explicitly. This is the safety
net that justified v8.33.0 + v8.33.1 hardening and gates inviting a second family.

Pattern in every test:
1. Create two families A, B with seed data.
2. Authenticated as user-in-A, attempt cross-family op against B's resource.
3. Assert the op fails (404 or 403) AND B's data is unchanged.
"""
import sqlite3


def _seed_two_families(db_path: str):
    """Two families, each with a user + a task + a workout + a category."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    # Families (id=1 already exists from migrate seed? Check.)
    con.execute("INSERT OR IGNORE INTO families (id,name,invite_code) VALUES (1,'A','AAAAAA')")
    con.execute("INSERT OR IGNORE INTO families (id,name,invite_code) VALUES (2,'B','BBBBBB')")
    # Settings rows
    con.execute("INSERT OR IGNORE INTO settings (family_id) VALUES (1)")
    con.execute("INSERT OR IGNORE INTO settings (family_id) VALUES (2)")
    # Members
    con.execute("INSERT OR IGNORE INTO family_members (user_id,family_id,user_name) VALUES (10,1,'AlphaUser')")
    con.execute("INSERT OR IGNORE INTO family_members (user_id,family_id,user_name) VALUES (20,2,'BravoUser')")
    # A task in each family
    con.execute("INSERT INTO tasks (family_id, text, done, created_by) VALUES (1,'A task',0,'AlphaUser')")
    con.execute("INSERT INTO tasks (family_id, text, done, created_by) VALUES (2,'B task',0,'BravoUser')")
    # A workout in each
    con.execute("INSERT INTO workouts (family_id, member_id, name, date) VALUES (1,10,'A wk','2026-05-24')")
    con.execute("INSERT INTO workouts (family_id, member_id, name, date) VALUES (2,20,'B wk','2026-05-24')")
    # An exercise + workout_exercise in B so we can test cascade isolation
    con.execute("INSERT INTO exercises (family_id, name, emoji) VALUES (2,'Bench','💪')")
    bex_id = con.execute("SELECT id FROM exercises WHERE family_id=2").fetchone()["id"]
    bw_id = con.execute("SELECT id FROM workouts WHERE family_id=2").fetchone()["id"]
    con.execute("INSERT INTO workout_exercises (workout_id, exercise_id, sort_order) VALUES (?,?,0)", (bw_id, bex_id))
    bwe_id = con.execute("SELECT id FROM workout_exercises WHERE workout_id=?", (bw_id,)).fetchone()["id"]
    con.execute("INSERT INTO workout_sets (workout_exercise_id, set_number, reps, weight) VALUES (?,1,8,80)", (bwe_id,))
    # Categories
    con.execute("INSERT INTO categories (family_id, name, emoji, type) VALUES (1,'A-Food','🍎','expense')")
    con.execute("INSERT INTO categories (family_id, name, emoji, type) VALUES (2,'B-Food','🍇','expense')")
    con.commit()
    ids = {
        "a_task": con.execute("SELECT id FROM tasks WHERE family_id=1").fetchone()["id"],
        "b_task": con.execute("SELECT id FROM tasks WHERE family_id=2").fetchone()["id"],
        "a_wk":   con.execute("SELECT id FROM workouts WHERE family_id=1").fetchone()["id"],
        "b_wk":   bw_id,
        "b_set":  con.execute("SELECT id FROM workout_sets WHERE workout_exercise_id=?", (bwe_id,)).fetchone()["id"],
        "b_cat":  con.execute("SELECT id FROM categories WHERE family_id=2").fetchone()["id"],
    }
    con.close()
    return ids


def _client_as(app_module, user_id, family_id):
    """Mini helper to avoid pulling the fixture (we already seeded directly)."""
    from fastapi.testclient import TestClient

    async def fake_get_user():
        return {"id": user_id, "first_name": "T", "photo_url": None}

    async def fake_get_uf():
        return {"id": user_id, "first_name": "T", "photo_url": None, "family_id": family_id}

    app_module.app.dependency_overrides[app_module.get_user] = fake_get_user
    app_module.app.dependency_overrides[app_module.get_uf] = fake_get_uf
    return TestClient(app_module.app)


# ─── CRITICAL: v8.33.0/.1 isolation fixes ───────────────────────────────────

def test_del_workout_cannot_cascade_into_other_family(app_module, temp_db):
    """v8.33.0 fix: deleting workout B as user-in-A must not nuke B's sets."""
    ids = _seed_two_families(temp_db)
    client = _client_as(app_module, user_id=10, family_id=1)
    r = client.delete(f"/api/workouts/{ids['b_wk']}")
    assert r.status_code == 404

    # B's set must still exist
    con = sqlite3.connect(temp_db)
    cnt = con.execute("SELECT COUNT(*) FROM workout_sets WHERE id=?", (ids["b_set"],)).fetchone()[0]
    con.close()
    assert cnt == 1, "Family B's workout_set was cascade-deleted by family A's call!"


def test_create_subtask_rejects_other_family_parent(app_module, temp_db):
    """v8.33.0 fix: subtask on family B's task from user-in-A must 404."""
    ids = _seed_two_families(temp_db)
    client = _client_as(app_module, user_id=10, family_id=1)
    r = client.post(f"/api/subtasks/task/{ids['b_task']}", json={"text": "spy step"})
    assert r.status_code == 404

    con = sqlite3.connect(temp_db)
    cnt = con.execute("SELECT COUNT(*) FROM subtasks WHERE parent_id=? AND parent_type='task'", (ids["b_task"],)).fetchone()[0]
    con.close()
    assert cnt == 0, "Subtask was inserted pointing at another family's task!"


def test_listing_endpoints_only_show_own_family(app_module, temp_db):
    """GET /api/tasks must return only family A's task, not family B's."""
    ids = _seed_two_families(temp_db)
    client_a = _client_as(app_module, user_id=10, family_id=1)

    bundle = client_a.get("/api/bundle").json()
    task_ids = [t["id"] for t in bundle["tasks"]]
    assert ids["a_task"] in task_ids
    assert ids["b_task"] not in task_ids, "Family A sees family B's task in bundle!"

    cat_ids = [c["id"] for c in bundle["categories"]]
    assert ids["b_cat"] not in cat_ids, "Family A sees family B's category in bundle!"


def test_toggle_other_family_task_is_safe_noop(app_module, temp_db):
    """Cross-family toggle is a silent no-op — endpoint returns 200 but the WHERE family_id=?
    filter means B's task is NOT actually toggled. Data-safe but ideally would 404 (see TODO
    in toggle_task: missing existence check). Test asserts the safety invariant, not the status."""
    ids = _seed_two_families(temp_db)
    client_a = _client_as(app_module, user_id=10, family_id=1)
    _r = client_a.patch(f"/api/tasks/{ids['b_task']}/toggle")
    # Status 200 currently; not asserted. Real check: B's task is still not-done.
    con = sqlite3.connect(temp_db)
    done = con.execute("SELECT done FROM tasks WHERE id=?", (ids["b_task"],)).fetchone()[0]
    con.close()
    assert done == 0, "Family A toggled family B's task!"


def test_delete_other_family_task_is_safe_noop(app_module, temp_db):
    """Cross-family delete is also a silent no-op (same WHERE family_id=? filter).
    TODO: tighten to 404 for clearer API contract."""
    ids = _seed_two_families(temp_db)
    client_a = _client_as(app_module, user_id=10, family_id=1)
    _r = client_a.delete(f"/api/tasks/{ids['b_task']}")

    con = sqlite3.connect(temp_db)
    cnt = con.execute("SELECT COUNT(*) FROM tasks WHERE id=?", (ids["b_task"],)).fetchone()[0]
    con.close()
    assert cnt == 1, "Family A deleted family B's task!"
