"""
Core CRUD round-trips for the most-used resource types.
Sanity checks: POST creates, GET reads it back, PUT/PATCH updates, DELETE removes.
"""


def test_task_crud(client_as):
    client = client_as(user_id=500, family_id=1)

    # Create
    r = client.post("/api/tasks", json={"text": "buy milk", "priority": "normal"})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    # Read via bundle
    bundle = client.get("/api/bundle").json()
    found = next((t for t in bundle["tasks"] if t["id"] == tid), None)
    assert found is not None
    assert found["text"] == "buy milk"
    assert found["done"] == 0

    # Toggle
    r = client.patch(f"/api/tasks/{tid}/toggle")
    assert r.status_code == 200
    bundle = client.get("/api/bundle").json()
    found = next(t for t in bundle["tasks"] if t["id"] == tid)
    assert found["done"] == 1

    # Edit
    r = client.put(f"/api/tasks/{tid}", json={"text": "buy bread"})
    assert r.status_code == 200
    bundle = client.get("/api/bundle").json()
    found = next(t for t in bundle["tasks"] if t["id"] == tid)
    assert found["text"] == "buy bread"

    # Delete
    r = client.delete(f"/api/tasks/{tid}")
    assert r.status_code == 200
    bundle = client.get("/api/bundle").json()
    assert not any(t["id"] == tid for t in bundle["tasks"])


def test_transaction_amount_eur_computed(client_as, db_conn):
    """amount_eur should be auto-computed at insert via the FX table."""
    client = client_as(user_id=600, family_id=1)

    r = client.post("/api/transactions", json={
        "type": "expense", "amount": 100.0, "currency": "EUR",
        "description": "test", "date": "2026-05-24",
    })
    assert r.status_code == 200, r.text

    # EUR → EUR is 1:1
    bundle = client.get("/api/bundle").json()
    txs = bundle["transactions"]
    assert len(txs) >= 1
    assert any(abs(t["amount_eur"] - 100.0) < 0.01 for t in txs)


def test_transaction_currency_conversion(client_as):
    """USD/RSD inputs should land with correct amount_eur via FX table."""
    client = client_as(user_id=601, family_id=1)

    # Send a USD transaction
    r = client.post("/api/transactions", json={
        "type": "expense", "amount": 100.0, "currency": "USD",
        "description": "usd test", "date": "2026-05-24",
    })
    assert r.status_code == 200, r.text

    bundle = client.get("/api/bundle").json()
    usd_tx = next(t for t in bundle["transactions"] if t["currency"] == "USD")
    # FX["USD"] = 0.92 (hardcoded in app.py)
    assert abs(usd_tx["amount_eur"] - 92.0) < 0.01


def test_shopping_crud(client_as):
    client = client_as(user_id=700, family_id=1)

    r = client.post("/api/shopping", json={"items": ["milk", "bread"]})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 2

    sid = rows[0]["id"]
    r = client.patch(f"/api/shopping/{sid}/toggle")
    assert r.status_code == 200

    r = client.delete(f"/api/shopping/{sid}")
    assert r.status_code == 200


def test_event_crud(client_as):
    client = client_as(user_id=800, family_id=1)

    # POST /api/events returns {ok:true}; fetch id via bundle.
    r = client.post("/api/events", json={"text": "dinner", "event_date": "2026-06-01 18:00"})
    assert r.status_code == 200, r.text

    bundle = client.get("/api/bundle").json()
    ev = next((e for e in bundle["events"] if e["text"] == "dinner"), None)
    assert ev is not None
    eid = ev["id"]

    r = client.delete(f"/api/events/{eid}")
    assert r.status_code == 200
