"""
🤖 Family HQ Bot — AI-powered Telegram assistant.
Parses natural language via Claude Haiku to create expenses, income, tasks, shopping items.
"""
import os, json, logging, sqlite3, base64
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

    # Recurring tasks
    recurring = con.execute(
        "SELECT id, text, rrule, assigned_to, active FROM recurring_tasks WHERE family_id=? ORDER BY id DESC LIMIT 30",
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

    def fmt_recurring(rows):
        return "\n".join(f"  id={r['id']}: \"{r['text']}\" rrule={r['rrule']} active={r['active']}" for r in rows) or "  (none)"

    return (
        f"ACTIVE TASKS:\n{fmt_tasks(tasks)}\n\n"
        f"RECURRING TASKS:\n{fmt_recurring(recurring)}\n\n"
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


SYSTEM_PROMPT = """You are Family HQ assistant bot. Parse user messages and return JSON.

Today: {today} ({weekday})
Tomorrow: {tomorrow}, Yesterday: {yesterday}

DATE REFERENCE (use these exact dates, do NOT compute yourself):
{date_ref}
Family members: {members}
Expense categories: {expense_cats}
Income categories: {income_cats}

{existing_data}

RULES:
- IMPORTANT: ALL data you create or edit (descriptions, task names, shopping items, event titles) MUST be in English, even if the user writes in Russian. Translate to English. But your "reply" field can match the user's language.
- ALWAYS return a JSON object with "actions" array: {{"actions": [...]}}
- A single message can contain MULTIPLE actions. Example: "spent 500 on taxi and 200 on bakery" = 2 expense actions.
- For amounts, extract the number and currency. Default currency: RSD for dinars/дин, USD for dollars, EUR for euros, RUB for rubles/рублей
- Match category by meaning (food/еда/пекарня/ресторан → Food, transport/такси/автобус → Transport, etc). Use category ID from the list.
- If user mentions a family member name, set assigned_to to their user_id
- DATES: Use the DATE REFERENCE table above — do NOT calculate dates yourself. "last Friday/в прошлую пятницу" → use "last Friday" from the table. "в понедельник/on Monday" → use "next Monday" from the table. If no date specified, use today ({today}).
- For recurring tasks: use rrule format "daily", "weekly:mon,wed,fri", or "monthly:15". Map Russian days: пн=mon, вт=tue, ср=wed, чт=thu, пт=fri, сб=sat, вс=sun.
- When user asks to edit/change/update, find the matching item by name/description from existing data and use its ID. Only include fields that need to change.
- When user asks to delete/remove, find its ID from existing data.
- When user asks to complete/mark done a task, use toggle_task.
- If the message is NOT about family management (not about expenses, tasks, shopping, events, etc.) — for example greetings, jokes, general questions — return a friendly conversational reply as unknown action. Reply in the same language as the user.

ACTIONS (inside "actions" array):

1. Expense: {{"action": "expense", "amount": 500, "currency": "RSD", "category_id": 1, "description": "taxi ride", "date": "2026-04-02", "member_id": null, "items": []}}
   Optional "items" field for receipt breakdown. Each item: {{"name": "Beer", "quantity": 4, "amount": 475}}
   "amount" = UNIT PRICE (price per 1 piece). Total = quantity × amount.
   If user mentions what they bought but NOT individual prices, split total evenly among items by total weight.
   E.g. total=3800, items: 4 beers + 1 dumplings = 5 units → unit_price = 3800/5 = 760, so beer amount=760, dumplings amount=760.
   Item names MUST be in English. "items" can be omitted or [] if no breakdown mentioned.

2. Income: {{"action": "income", "amount": 1000, "currency": "EUR", "category_id": 8, "description": "freelance project", "date": "2026-04-02", "member_id": null}}

3. Add task: {{"action": "task", "text": "Buy milk", "due_date": "2026-04-02", "priority": "normal", "assigned_to": null}}

4. Add recurring task: {{"action": "recurring_task", "text": "Study Russian", "rrule": "weekly:wed,thu", "assigned_to": null}}

5. Add shopping item: {{"action": "shopping", "items": ["Milk", "Bread"], "folder_id": null}}

6. Status request: {{"action": "status"}}

7. Edit task: {{"action": "edit_task", "id": 123, "text": "new text", "due_date": "2026-04-10", "priority": "high", "assigned_to": null}}
   Only include fields that change. "id" is required.

8. Edit transaction: {{"action": "edit_transaction", "id": 456, "amount": 300, "currency": "RSD", "category_id": 2, "description": "new desc", "date": "2026-04-05"}}
   Only include fields that change. "id" is required.

9. Edit shopping item: {{"action": "edit_shopping", "id": 789, "item": "new name", "quantity": "2", "price": 300}}
   Only include fields that change. "id" is required.

10. Edit event: {{"action": "edit_event", "id": 101, "text": "new title", "event_date": "2026-04-10", "end_date": "2026-04-11"}}
    Only include fields that change. "id" is required.

11. Edit subscription: {{"action": "edit_sub", "id": 55, "name": "Netflix", "amount": 15, "currency": "EUR", "billing_day": 10}}
    Only include fields that change. "id" is required.

12. Toggle task done: {{"action": "toggle_task", "id": 123}}

13. Delete item: {{"action": "delete", "type": "task|transaction|shopping|event|birthday|subscription", "id": 123}}

14. Unknown/chat: {{"action": "unknown", "reply": "friendly reply in user's language"}}

EXAMPLES:
User: "вчера потратил 500 на такси и 200 в пекарне"
→ {{"actions": [{{"action":"expense","amount":500,"currency":"RSD","category_id":4,"description":"taxi ride","date":"{yesterday}","member_id":null}},{{"action":"expense","amount":200,"currency":"RSD","category_id":1,"description":"bakery","date":"{yesterday}","member_id":null}}]}}

User: "мне нужно каждую среду и четверг учить русский"
→ {{"actions": [{{"action":"recurring_task","text":"Study Russian","rrule":"weekly:wed,thu","assigned_to":null}}]}}

User: "купи молоко и хлеб, и ещё задача — позвонить врачу завтра"
→ {{"actions": [{{"action":"shopping","items":["Milk","Bread"],"folder_id":null}},{{"action":"task","text":"Call the doctor","due_date":"{tomorrow}","priority":"normal","assigned_to":null}}]}}

User: "в прошлую пятницу потратил 3800 динар в баре Volna, купил 4 пива и жареные пельмени"
→ {{"actions": [{{"action":"expense","amount":3800,"currency":"RSD","category_id":3,"description":"bar Volna","date":"use last Friday from table","member_id":null,"items":[{{"name":"Beer","quantity":4,"amount":760}},{{"name":"Fried dumplings","quantity":1,"amount":760}}]}}]}}
(amount is UNIT price: 3800 / 5 total units = 760 each; Beer 4×760=3040, Dumplings 1×760=760, total=3800)

User: "привет, как дела?"
→ {{"actions": [{{"action":"unknown","reply":"Привет! 👋 Всё отлично, готов помочь! Могу записать расходы, добавить задачи, список покупок и многое другое. Что нужно?"}}]}}"""


async def _ask_claude(message: str, family_id: int) -> dict | None:
    """Send message to Claude Haiku and get parsed action."""
    if not ANTHROPIC_API_KEY:
        return None

    now = datetime.now(ZoneInfo(TIMEZONE))
    today = now.strftime("%Y-%m-%d")
    weekday = now.strftime("%A")  # e.g. "Sunday"
    from datetime import timedelta
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

    # Pre-compute date reference table so Haiku doesn't do date math wrong
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    today_idx = now.weekday()  # 0=Mon, 6=Sun
    date_ref_lines = []
    for i, dn in enumerate(day_names):
        # "last X" = most recent past occurrence (1-7 days ago)
        diff = (today_idx - i) % 7
        if diff == 0:
            diff = 7  # "last Monday" when today is Monday = 7 days ago
        last_date = (now - timedelta(days=diff)).strftime("%Y-%m-%d")
        # "next X" = upcoming occurrence (1-7 days ahead)
        diff_next = (i - today_idx) % 7
        if diff_next == 0:
            diff_next = 7
        next_date = (now + timedelta(days=diff_next)).strftime("%Y-%m-%d")
        date_ref_lines.append(f"  last {dn} = {last_date}, next {dn} = {next_date}")
    date_ref = "\n".join(date_ref_lines)

    cats = _get_categories(family_id)
    members = _get_members(family_id)
    expense_cats = ", ".join(f"{c['emoji']} {c['name']} (id={c['id']})" for c in cats if c['type'] == 'expense')
    income_cats = ", ".join(f"{c['emoji']} {c['name']} (id={c['id']})" for c in cats if c['type'] == 'income')
    members_str = ", ".join(f"{m['user_name']} (user_id={m['user_id']})" for m in members)

    existing = _get_existing_data(family_id)

    system = SYSTEM_PROMPT.format(
        today=today, weekday=weekday, tomorrow=tomorrow, yesterday=yesterday,
        date_ref=date_ref,
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
                "max_tokens": 1024,
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

    cur = con.execute(
        "INSERT INTO transactions (family_id,type,amount,currency,amount_eur,category_id,description,date,member_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (family_id, "expense", amount, currency, eur, cat_id, desc, date, member_id))
    con.commit()
    tx_id = cur.lastrowid

    # Create receipt items if provided
    items = data.get("items") or []
    items_str = ""
    if items:
        for it in items:
            con.execute(
                "INSERT INTO transaction_items (transaction_id,family_id,name,quantity,amount,currency) VALUES (?,?,?,?,?,?)",
                (tx_id, family_id, it.get("name", ""), it.get("quantity", 1), it.get("amount", 0), currency))
        con.commit()
        items_str = "\n🧾 *Receipt:*\n" + "\n".join(
            f"  • {it.get('name', '')} ×{it.get('quantity', 1)} — {it.get('quantity', 1) * it.get('amount', 0):.0f} {currency}" for it in items)

    # Format reply
    cat_str = ""
    if cat_id:
        cat = con.execute("SELECT emoji, name FROM categories WHERE id=?", (cat_id,)).fetchone()
        if cat:
            cat_str = f"\n📂 {cat['emoji']} {cat['name']}"
    con.close()

    reply = f"💸 *Expense: {amount} {currency}*{cat_str}\n🏷 {desc}\n📅 {date}{items_str}" if desc else f"💸 *Expense: {amount} {currency}*{cat_str}\n📅 {date}{items_str}"
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


async def _do_recurring_task(data: dict, family_id: int, user_name: str, chat_id: int) -> str:
    """Create a recurring task."""
    con = _db()
    text = data["text"]
    rrule = data.get("rrule", "daily")
    assigned = data.get("assigned_to")

    con.execute(
        "INSERT INTO recurring_tasks (family_id,text,assigned_to,priority,rrule) VALUES (?,?,?,?,?)",
        (family_id, text, assigned, "normal", rrule))
    con.commit()
    con.close()

    # Human-readable schedule
    if rrule == "daily":
        sched_str = "Every day"
    elif rrule.startswith("weekly:"):
        days = rrule.split(":")[1]
        sched_str = f"Weekly: {days}"
    elif rrule.startswith("monthly:"):
        sched_str = f"Monthly: day {rrule.split(':')[1]}"
    else:
        sched_str = rrule

    await _notify_other(family_id, chat_id, f"🔁 *{user_name}* added recurring: *{text}* ({sched_str})")
    return f"🔁 *Recurring task added: {text}*\n🗓 {sched_str}"


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
        "• _status_\n"
        "• 📷 Send a *receipt photo* to scan it!",
        reply_markup=kb, parse_mode="Markdown")


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 *How to use Family HQ Bot:*\n\n"
        "💸 *Expenses:* \"spent 500 din on food\"\n"
        "💰 *Income:* \"got paid 1500 eur\"\n"
        "🛒 *Shopping:* \"add milk, eggs to shopping\"\n"
        "📋 *Tasks:* \"task: call dentist tomorrow\"\n"
        "🔁 *Recurring:* \"every wed and thu study Russian\"\n"
        "📷 *Receipt:* send a photo of your receipt!\n"
        "📊 *Status:* \"status\"\n\n"
        "Works in English and Russian!",
        parse_mode="Markdown")


RECEIPT_PROMPT = """You are a receipt parser for a family in Belgrade, Serbia. Extract ALL items from this receipt/screenshot.

The receipt is most likely in SERBIAN (Latin script). Common Serbian grocery terms:
- Mleko/Mlijeko = Milk, Jogurt = Yogurt, Pavlaka = Sour cream, Sir = Cheese
- Krompir = Potato, Batat = Sweet potato, Krastavac = Cucumber, Paradajz = Tomato
- Banana = Banana, Mandarina = Tangerine, Jabuka = Apple, Kruška = Pear
- Kukuruz = Corn, Pečurka = Mushroom, Luk = Onion, Paprika = Bell pepper
- Hleb/Hljeb = Bread, Brašno = Flour, Šećer = Sugar, So = Salt, Ulje = Oil
- Piletina = Chicken, Svinjetina = Pork, Junetina = Beef, Riba = Fish
- Sveže = Fresh, Kisela = Sour, Beli/Bijeli = White, Organska = Organic
- Mreža = Mesh bag, Konzerva = Can/Canned, Čeri = Cherry (as in cherry tomato)
- Kinoko/Griva = varieties of mushroom (NOT chicken, NOT shrimp!)

Return valid JSON only:
{{
  "description": "store name in English (e.g. Wolt, Glovo, Maxi, Lidl, Idea)",
  "total": total amount as number,
  "currency": "RSD",
  "category_id": best match from [{expense_cats}],
  "items": [
    {{"name": "item name translated to English", "quantity": 1, "amount": unit_price_as_number}},
    ...
  ]
}}

RULES:
- Extract EVERY product item from the receipt. Do NOT skip any.
- Translate item names to short clear English. Keep brand names as-is (e.g. "Moja Kravica" stays).
  Example: "Sveže mleko 2.8% Moja Kravica 1.75l" → "Fresh milk 2.8% Moja Kravica 1.75l"
  Example: "Krompir beli mreža 2kg" → "White potato mesh bag 2kg"
  Example: "Pavlaka kisela 20%mm 400g" → "Sour cream 20% 400g"
  Example: "Organska pečurka lavlja griva kinoko 200g" → "Organic lion's mane mushroom 200g"
- "amount" = price per 1 unit. If qty=2 and line total=338, then amount=169
- Skip lines like: delivery, service fee, discounts, "reserved for weight-based items" — NOT product items
- Include service fee ONLY as a separate item if > 100 RSD
- currency: always "RSD" for Serbian receipts (dinars)
- Pick the best expense category ID (groceries → Food)
- If you can't read the receipt, return {{"error": "Could not parse receipt"}}
"""


async def _parse_receipt_image(image_bytes: bytes, family_id: int) -> dict | None:
    """Send receipt image to Claude Vision and get parsed items."""
    if not ANTHROPIC_API_KEY:
        return None

    cats = _get_categories(family_id)
    expense_cats = ", ".join(f"{c['emoji']} {c['name']} (id={c['id']})" for c in cats if c['type'] == 'expense')

    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=45) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }, json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 2048,
                "system": RECEIPT_PROMPT.format(expense_cats=expense_cats),
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": "Parse this receipt. Return JSON only."}
                ]}]
            })
            data = r.json()
            text = data.get("content", [{}])[0].get("text", "")
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            return json.loads(text)
    except Exception as e:
        log.error(f"Receipt parse error: {e}")
        return None


async def handle_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handle photo messages — parse receipts with Claude Vision."""
    if not update.message or not update.message.photo:
        return

    user_id = update.effective_user.id
    chat_id = update.effective_chat.id

    # Save chat_id
    con = _db()
    con.execute("UPDATE family_members SET tg_chat_id=? WHERE user_id=?", (chat_id, user_id))
    con.commit()
    con.close()

    fid, user_name, uid = _get_family(user_id)
    if not fid:
        await update.message.reply_text("You're not in a family yet. Open the app first!")
        return

    if not ANTHROPIC_API_KEY:
        await update.message.reply_text("AI assistant is not configured.")
        return

    await update.effective_chat.send_action("typing")
    await update.message.reply_text("🧾 Scanning receipt...")

    # Download the largest photo
    photo = update.message.photo[-1]  # highest resolution
    file = await ctx.bot.get_file(photo.file_id)
    image_bytes = await file.download_as_bytearray()

    result = await _parse_receipt_image(bytes(image_bytes), fid)
    if not result or "error" in result:
        err = result.get("error", "Unknown error") if result else "Could not parse image"
        await update.message.reply_text(f"❌ {err}")
        return

    # Create expense
    total = result.get("total", 0)
    currency = result.get("currency", "RSD")
    desc = result.get("description", "Receipt")
    cat_id = result.get("category_id")
    items = result.get("items", [])
    today = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d")
    caption = (update.message.caption or "").strip()

    # If user added a caption, use it as description
    if caption:
        desc = caption

    eur = round(total * FX.get(currency, 1.0), 2)

    con = _db()
    cur = con.execute(
        "INSERT INTO transactions (family_id,type,amount,currency,amount_eur,category_id,description,date,member_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (fid, "expense", total, currency, eur, cat_id, desc, today, user_id))
    con.commit()
    tx_id = cur.lastrowid

    # Create receipt items
    for it in items:
        con.execute(
            "INSERT INTO transaction_items (transaction_id,family_id,name,quantity,amount,currency) VALUES (?,?,?,?,?,?)",
            (tx_id, fid, it.get("name", ""), it.get("quantity", 1), it.get("amount", 0), currency))
    con.commit()

    # Format reply
    cat_str = ""
    if cat_id:
        cat = con.execute("SELECT emoji, name FROM categories WHERE id=?", (cat_id,)).fetchone()
        if cat:
            cat_str = f"\n📂 {cat['emoji']} {cat['name']}"
    con.close()

    items_str = ""
    if items:
        lines = []
        for it in items:
            qty = it.get("quantity", 1)
            amt = it.get("amount", 0)
            line_total = qty * amt
            qty_str = f" ×{qty}" if qty > 1 else ""
            lines.append(f"  • {it.get('name', '')}{qty_str} — {line_total:.0f} {currency}")
        items_str = "\n🧾 *Receipt:*\n" + "\n".join(lines)

    reply = f"💸 *Expense: {total} {currency}*{cat_str}\n🏷 {desc}\n📅 {today}{items_str}"
    await _notify_other(fid, chat_id, f"💸 *{user_name}*: {total} {currency}{(' — ' + desc) if desc else ''}")
    await update.message.reply_text(reply, parse_mode="Markdown")


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

    # Support both old format {"action": ...} and new format {"actions": [...]}
    actions = result.get("actions", [result] if "action" in result else [])
    if not actions:
        await update.message.reply_text("Sorry, I couldn't understand that. Try again!")
        return

    replies = []
    for item in actions:
        action = item.get("action", "unknown")
        try:
            if action == "expense":
                replies.append(await _do_expense(item, fid, uid, user_name, chat_id))
            elif action == "income":
                replies.append(await _do_income(item, fid, uid, user_name, chat_id))
            elif action == "task":
                replies.append(await _do_task(item, fid, user_name, chat_id))
            elif action == "recurring_task":
                replies.append(await _do_recurring_task(item, fid, user_name, chat_id))
            elif action == "shopping":
                replies.append(await _do_shopping(item, fid, user_name, chat_id))
            elif action == "status":
                replies.append(_get_status(fid))
            elif action == "edit_task":
                replies.append(await _do_edit_task(item, fid, user_name, chat_id))
            elif action == "toggle_task":
                replies.append(await _do_toggle_task(item, fid, user_name, chat_id))
            elif action == "edit_transaction":
                replies.append(await _do_edit_transaction(item, fid, user_name, chat_id))
            elif action == "edit_shopping":
                replies.append(await _do_edit_shopping(item, fid, user_name, chat_id))
            elif action == "edit_event":
                replies.append(await _do_edit_event(item, fid, user_name, chat_id))
            elif action == "edit_sub":
                replies.append(await _do_edit_sub(item, fid, user_name, chat_id))
            elif action == "delete":
                replies.append(await _do_delete(item, fid, user_name, chat_id))
            else:
                replies.append(item.get("reply", "Я могу помочь с расходами, задачами, покупками и событиями. Просто напиши!"))
        except Exception as e:
            log.error(f"Action {action} failed: {e}")
            replies.append(f"⚠️ Error: {e}")

    await update.message.reply_text("\n\n".join(replies), parse_mode="Markdown")


def main():
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    log.info("🤖 Family HQ Bot started with AI!")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
