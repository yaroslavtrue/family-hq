"""
🤖 Family HQ Bot — AI-powered Telegram assistant.
Parses natural language via Claude Haiku to create expenses, income, tasks, shopping items.
"""
import os, json, logging, sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo
from telegram import Update, WebAppInfo, MenuButtonWebApp, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import httpx

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN_HERE")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://your-domain.com")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DB_PATH = os.environ.get("DB_PATH", "family.db")
TIMEZONE = os.environ.get("TZ", "Europe/Belgrade")

FX = {"EUR": 1.0, "USD": 0.92, "GBP": 1.16, "RUB": 0.0095, "RSD": 0.0085}

log = logging.getLogger("bot")
logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)


def _db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _get_family(user_id):
    """Get family_id and member info for a telegram user."""
    con = _db()
    row = con.execute("SELECT family_id, user_name FROM family_members WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        con.close()
        return None, None, None
    fid = row["family_id"]
    name = row["user_name"]
    con.close()
    return fid, name, user_id


def _get_categories(family_id):
    """Get all categories for the family."""
    con = _db()
    cats = con.execute("SELECT id, name, emoji, type FROM categories WHERE family_id=?", (family_id,)).fetchall()
    con.close()
    return [dict(c) for c in cats]


def _get_members(family_id):
    """Get family members."""
    con = _db()
    members = con.execute("SELECT user_id, user_name FROM family_members WHERE family_id=?", (family_id,)).fetchall()
    con.close()
    return [dict(m) for m in members]


def _get_existing_data(family_id):
    """Get recent items for Claude to match when editing."""
    con = _db()
    now = datetime.now(ZoneInfo(TIMEZONE))

    # Active tasks (last 50)
    tasks = con.execute(
        "SELECT id, text, due_date, priority, assigned_to FROM tasks WHERE family_id=? AND done=0 ORDER BY id DESC LIMIT 50",
        (family_id,)).fetchall()

    # Shopping (not bought, last 50)
    shop = con.execute(
        "SELECT id, item, quantity, price, currency FROM shopping WHERE family_id=? AND bought=0 ORDER BY id DESC LIMIT 50",
        (family_id,)).fetchall()

    # Recent transactions (last 30)
    txns = con.execute(
        "SELECT t.id, t.type, t.amount, t.currency, t.description, t.date, c.name as cat_name "
        "FROM transactions t LEFT JOIN categories c ON c.id=t.category_id "
        "WHERE t.family_id=? ORDER BY t.id DESC LIMIT 30",
        (family_id,)).fetchall()

    # Upcoming events
    events = con.execute(
        "SELECT id, text, event_date, end_date FROM events WHERE family_id=? AND event_date>=? ORDER BY event_date LIMIT 20",
        (family_id, now.strftime("%Y-%m-%d"))).fetchall()

    # Birthdays
    bdays = con.execute(
        "SELECT id, name, emoji, birth_date FROM birthdays WHERE family_id=?",
        (family_id,)).fetchall()

    # Subscriptions
    subs = con.execute(
        "SELECT id, name, emoji, amount, currency, billing_day FROM subscriptions WHERE family_id=?",
        (family_id,)).fetchall()

    con.close()

    def fmt_tasks(rows):
        return "\n".join(f"  id={r['id']}: \"{r['text']}\" due={r['due_date']} priority={r['priority']}" for r in rows) or "  (none)"

    def fmt_shop(rows):
        return "\n".join(f"  id={r['id']}: \"{r['item']}\" qty={r['quantity']} price={r['price']} {r['currency'] or 'RSD'}" for r in rows) or "  (none)"

    def fmt_txns(rows):
        return "\n".join(f"  id={r['id']}: {r['type']} {r['amount']} {r['currency']} \"{r['description'] or ''}\" cat={r['cat_name'] or '?'} date={r['date']}" for r in rows) or "  (none)"

    def fmt_events(rows):
        return "\n".join(f"  id={r['id']}: \"{r['text']}\" date={r['event_date']}" + (f" end={r['end_date']}" if r['end_date'] else "") for r in rows) or "  (none)"

    def fmt_bdays(rows):
        return "\n".join(f"  id={r['id']}: {r['emoji']} {r['name']} born={r['birth_date']}" for r in rows) or "  (none)"

    def fmt_subs(rows):
        return "\n".join(f"  id={r['id']}: {r['emoji']} {r['name']} {r['amount']} {r['currency']} day={r['billing_day']}" for r in rows) or "  (none)"

    return (
        f"ACTIVE TASKS:\n{fmt_tasks(tasks)}\n\n"
        f"SHOPPING LIST:\n{fmt_shop(shop)}\n\n"
        f"RECENT TRANSACTIONS:\n{fmt_txns(txns)}\n\n"
        f"UPCOMING EVENTS:\n{fmt_events(events)}\n\n"
        f"BIRTHDAYS:\n{fmt_bdays(bdays)}\n\n"
        f"SUBSCRIPTIONS:\n{fmt_subs(subs)}"
    )


async def _notify_other(family_id, exclude_chat_id, text):
    """Notify other family members."""
    con = _db()
    members = con.execute(
        "SELECT tg_chat_id FROM family_members WHERE family_id=? AND tg_chat_id IS NOT NULL AND tg_chat_id!=?",
        (family_id, exclude_chat_id)).fetchall()
    con.close()
    for m in members:
        try:
            async with httpx.AsyncClient() as c:
                await c.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                             json={"chat_id": m["tg_chat_id"], "text": text, "parse_mode": "Markdown"})
        except:
            pass


SYSTEM_PROMPT = """You are Family HQ assistant bot. Parse user messages and return a JSON action.

Today's date: {today}
Family members: {members}
Expense categories: {expense_cats}
Income categories: {income_cats}

{existing_data}

RULES:
- IMPORTANT: ALL data you create or edit (descriptions, task names, shopping items, event titles) MUST be in English, even if the user writes in Russian. Translate to English. But your "reply" in unknown action can match the user's language.
- Always return valid JSON, nothing else
- For amounts, extract the number and currency. Default currency: RSD for dinars, USD for dollars, EUR for euros, RUB for rubles/рублей
- Match category by meaning (food/еда → Food, transport/такси → Transport, etc). Use category ID from the list.
- If user mentions a family member name, set assigned_to to their user_id
- For dates: "today"→{today}, "tomorrow"→{tomorrow}, "yesterday"→{yesterday}. If no date specified, use today.
- When user asks to edit/change/update an item, find the matching item by name/description from the existing data above and use its ID. Only include fields that need to change.
- When user asks to delete/remove an item, find its ID from existing data.
- When user asks to complete/mark done a task, use toggle_task.
- If you cannot find a matching item, return {{"action": "unknown", "reply": "explain what you couldn't find"}}
- If you cannot understand the request, return {{"action": "unknown", "reply": "your helpful reply"}}

ACTIONS:

1. Expense: {{"action": "expense", "amount": 500, "currency": "RSD", "category_id": 1, "description": "groceries at Lidl", "date": "2026-04-02", "member_id": null}}

2. Income: {{"action": "income", "amount": 1000, "currency": "EUR", "category_id": 8, "description": "freelance project", "date": "2026-04-02", "member_id": null}}

3. Add task: {{"action": "task", "text": "Buy milk", "due_date": "2026-04-02", "priority": "normal", "assigned_to": null}}

4. Add shopping item: {{"action": "shopping", "items": ["Milk", "Bread"], "folder_id": null}}

5. Status request: {{"action": "status"}}

6. Edit task: {{"action": "edit_task", "id": 123, "text": "new text", "due_date": "2026-04-10", "priority": "high", "assigned_to": null}}
   Only include fields that change. "id" is required.

7. Edit transaction: {{"action": "edit_transaction", "id": 456, "amount": 300, "currency": "RSD", "category_id": 2, "description": "new desc", "date": "2026-04-05"}}
   Only include fields that change. "id" is required.

8. Edit shopping item: {{"action": "edit_shopping", "id": 789, "item": "new name", "quantity": "2", "price": 300}}
   Only include fields that change. "id" is required.

9. Edit event: {{"action": "edit_event", "id": 101, "text": "new title", "event_date": "2026-04-10", "end_date": "2026-04-11"}}
   Only include fields that change. "id" is required.

10. Edit subscription: {{"action": "edit_sub", "id": 55, "name": "Netflix", "amount": 15, "currency": "EUR", "billing_day": 10}}
    Only include fields that change. "id" is required.

11. Toggle task done: {{"action": "toggle_task", "id": 123}}

12. Delete item: {{"action": "delete", "type": "task|transaction|shopping|event|birthday|subscription", "id": 123}}

13. Unknown: {{"action": "unknown", "reply": "I can help with expenses, income, tasks, and shopping."}}"""


async def _ask_claude(message: str, family_id: int) -> dict | None:
    """Send message to Claude Haiku and get parsed action."""
    if not ANTHROPIC_API_KEY:
        return None

    now = datetime.now(ZoneInfo(TIMEZONE))
    today = now.strftime("%Y-%m-%d")
    from datetime import timedelta
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

    cats = _get_categories(family_id)
    members = _get_members(family_id)
    expense_cats = ", ".join(f"{c['emoji']} {c['name']} (id={c['id']})" for c in cats if c['type'] == 'expense')
    income_cats = ", ".join(f"{c['emoji']} {c['name']} (id={c['id']})" for c in cats if c['type'] == 'income')
    members_str = ", ".join(f"{m['user_name']} (user_id={m['user_id']})" for m in members)

    existing = _get_existing_data(family_id)

    system = SYSTEM_PROMPT.format(
        today=today, tomorrow=tomorrow, yesterday=yesterday,
        members=members_str, expense_cats=expense_cats, income_cats=income_cats,
        existing_data=existing
    )

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }, json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 500,
                "system": system,
                "messages": [{"role": "user", "content": message}]
            })
            data = r.json()
            text = data.get("content", [{}])[0].get("text", "")
            # Extract JSON from response (handle markdown code blocks)
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            return json.loads(text)
    except Exception as e:
        log.error(f"Claude API error: {e}")
        return None


async def _do_expense(data: dict, family_id: int, user_id: int, user_name: str, chat_id: int) -> str:
    """Create an expense transaction."""
    con = _db()
    amount = data["amount"]
    currency = data.get("currency", "RSD")
    eur = round(amount * FX.get(currency, 1.0), 2)
    cat_id = data.get("category_id")
    desc = data.get("description", "")
    date = data.get("date", datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d"))
    member_id = data.get("member_id") or user_id

    con.execute(
        "INSERT INTO transactions (family_id,type,amount,currency,amount_eur,category_id,description,date,member_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (family_id, "expense", amount, currency, eur, cat_id, desc, date, member_id))
    con.commit()

    # Format reply
    cat_str = ""
    if cat_id:
        cat = con.execute("SELECT emoji, name FROM categories WHERE id=?", (cat_id,)).fetchone()
        if cat:
            cat_str = f"\n📂 {cat['emoji']} {cat['name']}"
    con.close()

    reply = f"💸 *Expense: {amount} {currency}*{cat_str}\n🏷 {desc}\n📅 {date}" if desc else f"💸 *Expense: {amount} {currency}*{cat_str}\n📅 {date}"
    await _notify_other(family_id, chat_id, f"💸 *{user_name}*: {amount} {currency}{(' — ' + desc) if desc else ''}")
    return reply


async def _do_income(data: dict, family_id: int, user_id: int, user_name: str, chat_id: int) -> str:
    """Create an income transaction."""
    con = _db()
    amount = data["amount"]
    currency = data.get("currency", "RSD")
    eur = round(amount * FX.get(currency, 1.0), 2)
    cat_id = data.get("category_id")
    desc = data.get("description", "")
    date = data.get("date", datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d"))
    member_id = data.get("member_id") or user_id

    con.execute(
        "INSERT INTO transactions (family_id,type,amount,currency,amount_eur,category_id,description,date,member_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (family_id, "income", amount, currency, eur, cat_id, desc, date, member_id))
    con.commit()

    cat_str = ""
    if cat_id:
        cat = con.execute("SELECT emoji, name FROM categories WHERE id=?", (cat_id,)).fetchone()
        if cat:
            cat_str = f"\n📂 {cat['emoji']} {cat['name']}"
    con.close()

    reply = f"💰 *Income: {amount} {currency}*{cat_str}\n🏷 {desc}\n📅 {date}" if desc else f"💰 *Income: {amount} {currency}*{cat_str}\n📅 {date}"
    await _notify_other(family_id, chat_id, f"💰 *{user_name}*: {amount} {currency}{(' — ' + desc) if desc else ''}")
    return reply


async def _do_task(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    """Create a task."""
    con = _db()
    text = data["text"]
    due = data.get("due_date")
    priority = data.get("priority", "normal")
    assigned = data.get("assigned_to")

    con.execute(
        "INSERT INTO tasks (family_id,text,assigned_to,priority,due_date,created_by) VALUES (?,?,?,?,?,?)",
        (family_id, text, assigned, priority, due, user_name))
    con.commit()
    con.close()

    parts = [f"📋 *Task added: {text}*"]
    if due:
        parts.append(f"📅 {due}")
    if priority != "normal":
        parts.append(f"⚡ {priority}")

    await _notify_other(family_id, chat_id, f"📋 *{user_name}* added task: *{text}*")
    return "\n".join(parts)


async def _do_shopping(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    """Add shopping items."""
    con = _db()
    items = data.get("items", [])
    folder_id = data.get("folder_id")

    for item in items:
        con.execute(
            "INSERT INTO shopping (family_id,item,added_by,folder_id) VALUES (?,?,?,?)",
            (family_id, item, user_name, folder_id))
    con.commit()
    con.close()

    names = ", ".join(items)
    await _notify_other(family_id, chat_id, f"🛒 *{user_name}* added: *{names}*")
    return f"🛒 *Added to shopping:*\n" + "\n".join(f"  • {i}" for i in items)


async def _do_edit_task(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    tid = data["id"]
    task = con.execute("SELECT text FROM tasks WHERE id=? AND family_id=?", (tid, family_id)).fetchone()
    if not task:
        con.close()
        return "Task not found."

    ups, ps = [], []
    if "text" in data and data["text"]: ups.append("text=?"); ps.append(data["text"])
    if "due_date" in data: ups.append("due_date=?"); ps.append(data["due_date"])
    if "priority" in data: ups.append("priority=?"); ps.append(data["priority"])
    if "assigned_to" in data: ups.append("assigned_to=?"); ps.append(data["assigned_to"])

    if ups:
        ps.extend([tid, family_id])
        con.execute(f"UPDATE tasks SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
        con.commit()

    old_name = task["text"]
    new_task = con.execute("SELECT text, due_date, priority FROM tasks WHERE id=?", (tid,)).fetchone()
    con.close()

    parts = [f"✏️ *Task updated: {new_task['text']}*"]
    if new_task["due_date"]: parts.append(f"📅 {new_task['due_date']}")
    if new_task["priority"] != "normal": parts.append(f"⚡ {new_task['priority']}")
    await _notify_other(family_id, chat_id, f"✏️ *{user_name}* updated task: *{new_task['text']}*")
    return "\n".join(parts)


async def _do_toggle_task(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    tid = data["id"]
    task = con.execute("SELECT text, done FROM tasks WHERE id=? AND family_id=?", (tid, family_id)).fetchone()
    if not task:
        con.close()
        return "Task not found."
    new_done = 0 if task["done"] else 1
    con.execute("UPDATE tasks SET done=? WHERE id=? AND family_id=?", (new_done, tid, family_id))
    con.commit()
    con.close()

    if new_done:
        await _notify_other(family_id, chat_id, f"✅ *{user_name}* completed: *{task['text']}*")
        return f"✅ *Completed: {task['text']}*"
    else:
        return f"🔄 *Reopened: {task['text']}*"


async def _do_edit_transaction(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    tid = data["id"]
    txn = con.execute("SELECT * FROM transactions WHERE id=? AND family_id=?", (tid, family_id)).fetchone()
    if not txn:
        con.close()
        return "Transaction not found."

    ups, ps = [], []
    if "amount" in data: ups.append("amount=?"); ps.append(data["amount"])
    if "currency" in data: ups.append("currency=?"); ps.append(data["currency"])
    if "category_id" in data: ups.append("category_id=?"); ps.append(data["category_id"])
    if "description" in data: ups.append("description=?"); ps.append(data["description"])
    if "date" in data: ups.append("date=?"); ps.append(data["date"])
    if "type" in data: ups.append("type=?"); ps.append(data["type"])

    # Recalc EUR
    amt = data.get("amount", txn["amount"])
    cur = data.get("currency", txn["currency"])
    ups.append("amount_eur=?"); ps.append(round(amt * FX.get(cur, 1.0), 2))

    if ups:
        ps.extend([tid, family_id])
        con.execute(f"UPDATE transactions SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
        con.commit()

    updated = con.execute(
        "SELECT t.*, c.emoji, c.name as cat_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=?",
        (tid,)).fetchone()
    con.close()

    cat_str = f"\n📂 {updated['emoji']} {updated['cat_name']}" if updated["cat_name"] else ""
    desc_str = f"\n🏷 {updated['description']}" if updated["description"] else ""
    sign = "💸" if updated["type"] == "expense" else "💰"
    return f"✏️ *Transaction updated:*\n{sign} {updated['amount']} {updated['currency']}{cat_str}{desc_str}\n📅 {updated['date']}"


async def _do_edit_shopping(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    sid = data["id"]
    item = con.execute("SELECT item FROM shopping WHERE id=? AND family_id=?", (sid, family_id)).fetchone()
    if not item:
        con.close()
        return "Shopping item not found."

    ups, ps = [], []
    if "item" in data and data["item"]: ups.append("item=?"); ps.append(data["item"])
    if "quantity" in data: ups.append("quantity=?"); ps.append(data["quantity"])
    if "price" in data: ups.append("price=?"); ps.append(data["price"])
    if "folder_id" in data: ups.append("folder_id=?"); ps.append(data["folder_id"])

    if ups:
        ps.extend([sid, family_id])
        con.execute(f"UPDATE shopping SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
        con.commit()

    updated = con.execute("SELECT * FROM shopping WHERE id=?", (sid,)).fetchone()
    con.close()

    price_str = f" — {updated['price']} {updated['currency'] or 'RSD'}" if updated["price"] else ""
    qty_str = f" x{updated['quantity']}" if updated["quantity"] else ""
    return f"✏️ *Shopping updated: {updated['item']}*{qty_str}{price_str}"


async def _do_edit_event(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    eid = data["id"]
    ev = con.execute("SELECT text FROM events WHERE id=? AND family_id=?", (eid, family_id)).fetchone()
    if not ev:
        con.close()
        return "Event not found."

    ups, ps = [], []
    if "text" in data and data["text"]: ups.append("text=?"); ps.append(data["text"])
    if "event_date" in data: ups.append("event_date=?"); ps.append(data["event_date"])
    if "end_date" in data: ups.append("end_date=?"); ps.append(data["end_date"])

    if ups:
        ps.extend([eid, family_id])
        con.execute(f"UPDATE events SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
        con.commit()

    updated = con.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
    con.close()

    end_str = f" → {updated['end_date']}" if updated["end_date"] else ""
    await _notify_other(family_id, chat_id, f"✏️ *{user_name}* updated event: *{updated['text']}*")
    return f"✏️ *Event updated: {updated['text']}*\n📅 {updated['event_date']}{end_str}"


async def _do_edit_sub(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    sid = data["id"]
    sub = con.execute("SELECT name FROM subscriptions WHERE id=? AND family_id=?", (sid, family_id)).fetchone()
    if not sub:
        con.close()
        return "Subscription not found."

    ups, ps = [], []
    if "name" in data and data["name"]: ups.append("name=?"); ps.append(data["name"])
    if "amount" in data: ups.append("amount=?"); ps.append(data["amount"])
    if "currency" in data: ups.append("currency=?"); ps.append(data["currency"])
    if "billing_day" in data: ups.append("billing_day=?"); ps.append(data["billing_day"])
    if "emoji" in data: ups.append("emoji=?"); ps.append(data["emoji"])

    # Recalc EUR
    if "amount" in data or "currency" in data:
        amt = data.get("amount", sub["amount"] if "amount" in dict(sub).keys() else 0)
        cur = data.get("currency", "EUR")
        ups.append("amount_eur=?"); ps.append(round(amt * FX.get(cur, 1.0), 2))

    if ups:
        ps.extend([sid, family_id])
        con.execute(f"UPDATE subscriptions SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
        con.commit()

    updated = con.execute("SELECT * FROM subscriptions WHERE id=?", (sid,)).fetchone()
    con.close()
    return f"✏️ *Subscription updated: {updated['emoji']} {updated['name']}*\n💰 {updated['amount']} {updated['currency']} — day {updated['billing_day']}"


async def _do_delete(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    con = _db()
    item_type = data.get("type")
    item_id = data.get("id")

    table_map = {
        "task": ("tasks", "text"),
        "transaction": ("transactions", "description"),
        "shopping": ("shopping", "item"),
        "event": ("events", "text"),
        "birthday": ("birthdays", "name"),
        "subscription": ("subscriptions", "name"),
    }

    if item_type not in table_map:
        con.close()
        return "Unknown item type."

    table, name_col = table_map[item_type]
    row = con.execute(f"SELECT {name_col} FROM {table} WHERE id=? AND family_id=?", (item_id, family_id)).fetchone()
    if not row:
        con.close()
        return f"{item_type.title()} not found."

    name = row[name_col] or f"#{item_id}"

    # Cleanup related data
    if item_type == "task":
        con.execute("DELETE FROM task_reminders WHERE task_id=? AND family_id=?", (item_id, family_id))
        con.execute("DELETE FROM subtasks WHERE parent_type='task' AND parent_id=? AND family_id=?", (item_id, family_id))
    elif item_type == "birthday":
        con.execute("DELETE FROM birthday_reminders WHERE birthday_id=? AND family_id=?", (item_id, family_id))
    elif item_type == "subscription":
        con.execute("DELETE FROM subscription_reminders WHERE sub_id=? AND family_id=?", (item_id, family_id))

    con.execute(f"DELETE FROM {table} WHERE id=? AND family_id=?", (item_id, family_id))
    con.commit()
    con.close()

    emoji_map = {"task": "📋", "transaction": "💸", "shopping": "🛒", "event": "📅", "birthday": "🎂", "subscription": "💳"}
    e = emoji_map.get(item_type, "🗑")
    await _notify_other(family_id, chat_id, f"🗑 *{user_name}* deleted {item_type}: *{name}*")
    return f"🗑 *Deleted {item_type}: {name}*"


def _get_status(family_id: int) -> str:
    """Get family status summary."""
    con = _db()
    tasks = con.execute("SELECT COUNT(*) as c FROM tasks WHERE family_id=? AND done=0", (family_id,)).fetchone()["c"]
    shop = con.execute("SELECT COUNT(*) as c FROM shopping WHERE family_id=? AND bought=0", (family_id,)).fetchone()["c"]

    now = datetime.now(ZoneInfo(TIMEZONE))
    month_start = now.strftime("%Y-%m-01")
    expenses = con.execute(
        "SELECT COALESCE(SUM(amount_eur),0) as s FROM transactions WHERE family_id=? AND type='expense' AND date>=?",
        (family_id, month_start)).fetchone()["s"]
    income = con.execute(
        "SELECT COALESCE(SUM(amount_eur),0) as s FROM transactions WHERE family_id=? AND type='income' AND date>=?",
        (family_id, month_start)).fetchone()["s"]
    con.close()

    return (
        f"📊 *Family Status*\n\n"
        f"📋 Active tasks: *{tasks}*\n"
        f"🛒 Shopping items: *{shop}*\n"
        f"💸 Expenses (this month): *€{expenses:.2f}*\n"
        f"💰 Income (this month): *€{income:.2f}*\n"
        f"💎 Balance: *€{income - expenses:.2f}*"
    )


# ─── Handlers ────────────────────────────────────────────────────────────

async def post_init(app: Application):
    await app.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="🏠 Family HQ", web_app=WebAppInfo(url=WEBAPP_URL)))
    await app.bot.set_my_commands([("start", "Open Family HQ"), ("help", "How to use")])


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id

    # Save chat_id for notifications
    con = _db()
    con.execute("UPDATE family_members SET tg_chat_id=? WHERE user_id=?", (chat_id, user_id))
    con.commit()
    con.close()

    kb = InlineKeyboardMarkup([[InlineKeyboardButton("🏠 Open Family HQ", web_app=WebAppInfo(url=WEBAPP_URL))]])
    await update.message.reply_text(
        "👋 Hi! I'm your Family HQ assistant. I can help you with:\n\n"
        "💰 Expenses and income\n"
        "🛒 Shopping lists\n"
        "✅ Tasks and reminders\n"
        "📊 Budget status\n\n"
        "Just type naturally! For example:\n"
        "• _spent 2000 din at Lidl_\n"
        "• _add milk and bread to shopping_\n"
        "• _salary 1500 eur_\n"
        "• _task: buy birthday gift_\n"
        "• _status_",
        reply_markup=kb, parse_mode="Markdown")


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 *How to use Family HQ Bot:*\n\n"
        "💸 *Expenses:* \"spent 500 din on food\"\n"
        "💰 *Income:* \"got paid 1500 eur\"\n"
        "🛒 *Shopping:* \"add milk, eggs to shopping\"\n"
        "📋 *Tasks:* \"task: call dentist tomorrow\"\n"
        "📊 *Status:* \"status\"\n\n"
        "Works in English and Russian!",
        parse_mode="Markdown")


async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handle all text messages — parse with Claude AI."""
    if not update.message or not update.message.text:
        return

    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    text = update.message.text.strip()

    # Save chat_id
    con = _db()
    con.execute("UPDATE family_members SET tg_chat_id=? WHERE user_id=?", (chat_id, user_id))
    con.commit()
    con.close()

    fid, user_name, uid = _get_family(user_id)
    if not fid:
        await update.message.reply_text("You're not in a family yet. Open the app and create or join one first!")
        return

    if not ANTHROPIC_API_KEY:
        await update.message.reply_text("AI assistant is not configured. Ask admin to set ANTHROPIC_API_KEY.")
        return

    # Show typing indicator
    await update.effective_chat.send_action("typing")

    result = await _ask_claude(text, fid)
    if not result:
        await update.message.reply_text("Sorry, I couldn't understand that. Try again!")
        return

    action = result.get("action", "unknown")

    try:
        if action == "expense":
            reply = await _do_expense(result, fid, uid, user_name, chat_id)
        elif action == "income":
            reply = await _do_income(result, fid, uid, user_name, chat_id)
        elif action == "task":
            reply = await _do_task(result, fid, user_name, chat_id)
        elif action == "shopping":
            reply = await _do_shopping(result, fid, user_name, chat_id)
        elif action == "status":
            reply = _get_status(fid)
        elif action == "edit_task":
            reply = await _do_edit_task(result, fid, user_name, chat_id)
        elif action == "toggle_task":
            reply = await _do_toggle_task(result, fid, user_name, chat_id)
        elif action == "edit_transaction":
            reply = await _do_edit_transaction(result, fid, user_name, chat_id)
        elif action == "edit_shopping":
            reply = await _do_edit_shopping(result, fid, user_name, chat_id)
        elif action == "edit_event":
            reply = await _do_edit_event(result, fid, user_name, chat_id)
        elif action == "edit_sub":
            reply = await _do_edit_sub(result, fid, user_name, chat_id)
        elif action == "delete":
            reply = await _do_delete(result, fid, user_name, chat_id)
        else:
            reply = result.get("reply", "I can help with expenses, income, tasks, and shopping. Just type naturally!")

        await update.message.reply_text(reply, parse_mode="Markdown")
    except Exception as e:
        log.error(f"Action {action} failed: {e}")
        await update.message.reply_text(f"Something went wrong: {e}")


def main():
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    log.info("🤖 Family HQ Bot started with AI!")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
