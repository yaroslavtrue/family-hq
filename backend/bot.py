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

RULES:
- Detect language (Russian or English) and respond in same language
- Always return valid JSON, nothing else
- For amounts, extract the number and currency. Default currency: RSD for dinars, USD for dollars, EUR for euros, RUB for rubles/рублей
- Match category by meaning (food/еда → Food, transport/такси → Transport, etc). Use category ID from the list.
- If user mentions a family member name, set assigned_to to their user_id
- For dates: "today"→{today}, "tomorrow"→{tomorrow}, "yesterday"→{yesterday}. If no date specified, use today.
- If you cannot understand the request, return {{"action": "unknown", "reply": "your helpful reply"}}

ACTIONS:

1. Expense: {{"action": "expense", "amount": 500, "currency": "RSD", "category_id": 1, "description": "groceries at Lidl", "date": "2026-04-02", "member_id": null}}

2. Income: {{"action": "income", "amount": 1000, "currency": "EUR", "category_id": 8, "description": "freelance project", "date": "2026-04-02", "member_id": null}}

3. Add task: {{"action": "task", "text": "Buy milk", "due_date": "2026-04-02", "priority": "normal", "assigned_to": null}}

4. Add shopping item: {{"action": "shopping", "items": ["Milk", "Bread"], "folder_id": null}}

5. Status request: {{"action": "status"}}

6. Unknown: {{"action": "unknown", "reply": "I can help with expenses, income, tasks, and shopping."}}"""


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

    system = SYSTEM_PROMPT.format(
        today=today, tomorrow=tomorrow, yesterday=yesterday,
        members=members_str, expense_cats=expense_cats, income_cats=income_cats
    )

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }, json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
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
