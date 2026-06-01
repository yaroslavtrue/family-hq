"""
Money summary balance semantics (v8.50.0).

Balance is a RUNNING account total — income minus expense across all months
up to and including the selected one. Per-month `income`/`expense` reset to 0
each month, but the balance carries the previous months' leftover forward.
"""


def _tx(client, type_, amount, date, currency="EUR"):
    r = client.post("/api/transactions", json={
        "type": type_, "amount": amount, "currency": currency, "date": date,
    })
    assert r.status_code == 200, r.text


def test_balance_carries_over_between_months(client_as):
    client = client_as(user_id=700, family_id=1)

    # April: +1000 income, -300 expense  → net +700
    _tx(client, "income", 1000, "2026-04-10")
    _tx(client, "expense", 300, "2026-04-20")
    # May: -200 expense only             → net -200
    _tx(client, "expense", 200, "2026-05-05")

    # April view: income 1000, expense 300, balance 700 (nothing before it)
    apr = client.get("/api/money/summary?month=2026-04").json()
    assert apr["income"] == 1000
    assert apr["expense"] == 300
    assert apr["opening_balance"] == 0
    assert apr["net"] == 700
    assert apr["balance"] == 700

    # May view: income 0, expense 200 — but balance carries April's 700 forward
    # → opening 700, net -200, closing balance 500.
    may = client.get("/api/money/summary?month=2026-05").json()
    assert may["income"] == 0
    assert may["expense"] == 200
    assert may["opening_balance"] == 700
    assert may["net"] == -200
    assert may["balance"] == 500


def test_balance_can_go_negative(client_as):
    client = client_as(user_id=701, family_id=1)
    _tx(client, "income", 100, "2026-01-10")
    _tx(client, "expense", 250, "2026-02-10")

    feb = client.get("/api/money/summary?month=2026-02").json()
    assert feb["opening_balance"] == 100   # January leftover
    assert feb["net"] == -250
    assert feb["balance"] == -150          # overdrawn — allowed
