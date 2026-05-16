"""
Background schedulers: task reminders, birthday reminders, cleaning resets,
subscription reminders, recurring task generation, morning digest.
"""
import sqlite3, json, html
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import httpx, logging

from backend import weather as wx
from backend.words_of_day import WORDS as WORD_LIST

log = logging.getLogger("uvicorn.error")

DAILY_TIPS = [
    "💡 Review your budget once a week to stay on track.",
    "💡 Plan tomorrow's meals today — saves time and money.",
    "💡 Take 10 minutes to declutter one small area.",
    "💡 Batch similar errands together to save time.",
    "💡 Check your fridge before shopping to avoid buying duplicates.",
    "💡 Set aside 15 minutes for a quick family check-in.",
    "💡 Prep lunches the night before for a smoother morning.",
    "💡 Unsubscribe from one thing you no longer use.",
    "💡 Write down 3 things you're grateful for today.",
    "💡 Drink a glass of water first thing in the morning.",
    "💡 Try the 2-minute rule: if it takes less than 2 min, do it now.",
    "💡 Review upcoming birthdays and plan gifts early.",
    "💡 Sort your inbox — delete, reply, or archive.",
    "💡 Take a 5-minute walk to clear your mind.",
    "💡 Check if any subscriptions can be downgraded or cancelled.",
    "💡 Set a timer for cleaning — 15 minutes can do a lot.",
    "💡 Back up your important files and photos today.",
    "💡 Cook double portions and freeze half for busy days.",
    "💡 Review your goals for the month — adjust if needed.",
    "💡 End the day by writing tomorrow's top 3 priorities.",
    "💡 Compare prices before big purchases — a few minutes can save a lot.",
    "💡 Call or message someone you haven't talked to in a while.",
    "💡 Check expiration dates in your pantry and fridge.",
    "💡 Put your phone on Do Not Disturb for 1 hour of focus time.",
    "💡 Start a 30-day savings challenge — even small amounts add up.",
    "💡 Tidy up your workspace before starting work.",
    "💡 Plan one fun family activity for the weekend.",
    "💡 Review your cleaning schedule — is anything overdue?",
    "💡 Automate one recurring task or bill payment.",
    "💡 Stretch for 5 minutes — your body will thank you.",
    "💡 Track your spending today — awareness is the first step.",
]

# These get set by app.py on startup
BOT_TOKEN = ""
DB_PATH = ""
TIMEZONE = ""
TRELLO_API_KEY = ""
TRELLO_TOKEN = ""
TRELLO_BOARD_ID = ""
TRELLO_FAMILY_ID = 1

TRELLO_LISTS = ["Video Editing", "Монтаж видео", "Сайты", "Бренд", "Видеосъемка"]

WEATHER_LAT = "44.8"
WEATHER_LON = "20.46"

async def refresh_weather():
    """Hourly job: proactively refresh the weather cache so bundle responses
    never wait on an HTTP fetch. Logs success/failure but never raises."""
    try:
        await wx.refresh(WEATHER_LAT, WEATHER_LON, TIMEZONE)
    except Exception as e:
        log.warning(f"refresh_weather job error: {type(e).__name__}: {e}")

# Long-lived HTTP client (lazy init, reused across all jobs to avoid TCP/TLS handshakes)
_http_client = None
def _http():
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=30)
    return _http_client

def _con():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c

async def _send(chat_id, text, parse_mode="Markdown", reply_markup=None):
    try:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
        if parse_mode == "HTML":
            payload["disable_web_page_preview"] = True
        if reply_markup:
            payload["reply_markup"] = reply_markup
        await _http().post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json=payload, timeout=10)
    except Exception as e:
        log.error(f"Send error: {e}")

async def _notify_all(fid, msg, con=None):
    close = con is None
    if close: con = _con()
    for m in con.execute("SELECT tg_chat_id FROM family_members WHERE family_id=? AND tg_chat_id IS NOT NULL", (fid,)).fetchall():
        await _send(m["tg_chat_id"], msg)
    if close: con.close()

async def _notify_user(uid, msg, con=None):
    close = con is None
    if close: con = _con()
    m = con.execute("SELECT tg_chat_id FROM family_members WHERE user_id=?", (uid,)).fetchone()
    if m: await _send(m["tg_chat_id"], msg)
    if close: con.close()

# ─── Task Reminders (every minute) ──────────────────────────────────────
async def check_task_reminders():
    now = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d %H:%M")
    con = _con()
    rows = con.execute("""
        SELECT tr.id, tr.family_id, t.text, t.assigned_to
        FROM task_reminders tr JOIN tasks t ON t.id=tr.task_id
        WHERE tr.sent=0 AND t.done=0 AND tr.remind_at <= ?
    """, (now,)).fetchall()
    for r in rows:
        msg = f"🔔 *Task reminder:* {r['text']}"
        if r["assigned_to"]: await _notify_user(r["assigned_to"], msg, con)
        else: await _notify_all(r["family_id"], msg, con)
        con.execute("UPDATE task_reminders SET sent=1 WHERE id=?", (r["id"],))
    con.commit(); con.close()

# ─── Zone Reminders (every minute) ──────────────────────────────────────
async def check_zone_reminders():
    now = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d %H:%M")
    con = _con()
    rows = con.execute("""
        SELECT zr.id, zr.family_id, cz.name, cz.assigned_to
        FROM zone_reminders zr JOIN cleaning_zones cz ON cz.id=zr.zone_id
        WHERE zr.sent=0 AND zr.remind_at <= ?
    """, (now,)).fetchall()
    for r in rows:
        msg = f"🧹 *Cleaning reminder:* Time to clean *{r['name']}*!"
        if r["assigned_to"]: await _notify_user(r["assigned_to"], msg, con)
        else: await _notify_all(r["family_id"], msg, con)
        con.execute("UPDATE zone_reminders SET sent=1 WHERE id=?", (r["id"],))
    con.commit(); con.close()

# ─── Birthday Reminders (every hour) ────────────────────────────────────
async def check_birthday_reminders():
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today = now.date()
    yr = today.year
    ct = now.strftime("%H:%M")
    con = _con()
    for r in con.execute("""
        SELECT br.id, br.family_id, br.days_before, br.time, br.sent_year,
               b.name, b.emoji, b.birth_date
        FROM birthday_reminders br JOIN birthdays b ON b.id=br.birthday_id
    """).fetchall():
        if r["sent_year"] >= yr or r["time"] != ct: continue
        try:
            p = r["birth_date"].split("-")
            bd = datetime(yr, int(p[1]), int(p[2])).date()
        except: continue
        target = bd - timedelta(days=r["days_before"])
        if target == today:
            msg = f"🎂 *Happy Birthday to {r['emoji']} {r['name']}!* 🎉" if r["days_before"] == 0 else f"🎂 *{r['emoji']} {r['name']}*'s birthday is in *{r['days_before']}* day{'s' if r['days_before']>1 else ''}!"
            await _notify_all(r["family_id"], msg, con)
            con.execute("UPDATE birthday_reminders SET sent_year=? WHERE id=?", (yr, r["id"]))
    con.commit(); con.close()

# ─── Subscription Reminders (every hour) ─────────────────────────────────
async def check_subscription_reminders():
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today = now.date()
    ct = now.strftime("%H:%M")
    month_key = now.strftime("%Y-%m")
    con = _con()
    for r in con.execute("""
        SELECT sr.id, sr.sub_id, sr.family_id, sr.days_before, sr.time, sr.sent_month,
               s.name, s.emoji, s.amount, s.currency, s.billing_day, s.assigned_to
        FROM subscription_reminders sr JOIN subscriptions s ON s.id=sr.sub_id
    """).fetchall():
        if r["sent_month"] == month_key or r["time"] != ct: continue
        try:
            bill_date = datetime(today.year, today.month, min(r["billing_day"], 28)).date()
        except: continue
        target = bill_date - timedelta(days=r["days_before"])
        if target == today:
            days_b = r["days_before"]
            msg = f"💳 *{r['emoji']} {r['name']}* payment of *{r['amount']} {r['currency']}*"
            if days_b == 0: msg += " is due today!"
            else: msg += f" is in {days_b} days!"
            if r["assigned_to"]: await _notify_user(r["assigned_to"], msg, con)
            else: await _notify_all(r["family_id"], msg, con)
            con.execute("UPDATE subscription_reminders SET sent_month=? WHERE id=?", (month_key, r["id"]))
    con.commit(); con.close()

# ─── Cleaning Task Auto-Reset (daily 00:05) ─────────────────────────────
async def check_cleaning_resets():
    con = _con()
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    tasks = con.execute("SELECT id, zone_id, family_id, text, reset_days, last_done, assigned_to FROM cleaning_tasks WHERE done=1 AND last_done IS NOT NULL").fetchall()
    for t in tasks:
        try: done_date = datetime.strptime(t["last_done"], "%Y-%m-%d").date()
        except: continue
        if (today - done_date).days >= (t["reset_days"] or 7):
            con.execute("UPDATE cleaning_tasks SET done=0 WHERE id=?", (t["id"],))
            zone = con.execute("SELECT name FROM cleaning_zones WHERE id=?", (t["zone_id"],)).fetchone()
            zname = zone["name"] if zone else "Unknown"
            msg = f"🧹 *{zname}*: _{t['text']}_ needs doing again ({t['reset_days']}d since last)"
            if t["assigned_to"]: await _notify_user(t["assigned_to"], msg, con)
            else: await _notify_all(t["family_id"], msg, con)
    con.commit(); con.close()

# ─── Recurring Tasks Generator (daily 00:05) ────────────────────────────
async def generate_recurring_tasks():
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today = now.date()
    today_str = today.strftime("%Y-%m-%d")
    weekday = today.strftime("%a").lower()[:3]  # mon, tue, ...
    day_of_month = today.day
    con = _con()
    for r in con.execute("SELECT * FROM recurring_tasks WHERE active=1").fetchall():
        # Check if already generated today
        if r["last_generated"] == today_str: continue
        # Check if rrule matches today
        rrule = r["rrule"]  # "daily", "weekly:mon,wed,fri", "monthly:15"
        should_gen = False
        if rrule == "daily":
            should_gen = True
        elif rrule.startswith("weekly:"):
            days = rrule.split(":")[1].split(",")
            should_gen = weekday in days
        elif rrule.startswith("monthly:"):
            try: should_gen = day_of_month == int(rrule.split(":")[1])
            except: pass
        if should_gen:
            con.execute("INSERT INTO tasks (family_id,text,assigned_to,priority,due_date,created_by) VALUES (?,?,?,?,?,?)",
                (r["family_id"], r["text"], r["assigned_to"], r["priority"], today_str, "🔁 Auto"))
            con.execute("UPDATE recurring_tasks SET last_generated=? WHERE id=?", (today_str, r["id"]))
            if r["assigned_to"]:
                await _notify_user(r["assigned_to"], f"🔁 Recurring task: *{r['text']}*", con)
    con.commit(); con.close()

# ─── Event Reminders (daily 09:00) ───────────────────────────────────────
async def check_event_reminders():
    con = _con()
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    for ev in con.execute("SELECT id, family_id, text, event_date FROM events").fetchall():
        try: ed = datetime.strptime(ev["event_date"].split(" ")[0], "%Y-%m-%d").date()
        except: continue
        d = (ed - today).days
        if d in (1, 3):
            lbl = "tomorrow" if d == 1 else "in 3 days"
            await _notify_all(ev["family_id"], f"📅 *Event {lbl}:* {ev['text']}", con)
    con.close()

# ─── Trello Sync (every 30 min) ─────────────────────────────────────────
async def sync_trello():
    if not TRELLO_API_KEY or not TRELLO_TOKEN or not TRELLO_BOARD_ID:
        log.info("Trello sync skipped: no credentials configured")
        return
    try:
        c = _http()
        r = await c.get(
            f"https://api.trello.com/1/boards/{TRELLO_BOARD_ID}/lists",
            params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN, "fields": "id,name"},
            timeout=10)
        lists = r.json()
        target_ids = {l["id"]: l["name"] for l in lists if l["name"] in TRELLO_LISTS}

        r2 = await c.get(
            f"https://api.trello.com/1/boards/{TRELLO_BOARD_ID}/cards",
            params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN,
                    "fields": "id,name,due,dueComplete,idList", "filter": "open"},
            timeout=10)
        cards = r2.json()
    except Exception as e:
        log.error(f"Trello fetch error: {e}")
        return

    con = _con()
    today = datetime.now(ZoneInfo(TIMEZONE))
    relevant = [card for card in cards if card.get("due") and card["idList"] in target_ids and not card.get("dueComplete")]
    list_names = target_ids  # dict: list_id -> list_name
    relevant_ids = {card["id"] for card in relevant}

    for card in relevant:
        cid = card["id"]
        list_name = list_names.get(card["idList"], "")
        text = f"{list_name}: {card['name']}" if list_name else card["name"]
        due = card["due"][:10] if card["due"] else None
        trello_done = 1 if card.get("dueComplete") else 0

        existing = con.execute(
            "SELECT id, done FROM tasks WHERE trello_card_id=?", (cid,)).fetchone()
        if existing:
            con.execute(
                "UPDATE tasks SET text=?, due_date=? WHERE trello_card_id=?", (text, due, cid))
            if dict(existing)["done"] != trello_done:
                con.execute(
                    "UPDATE tasks SET done=? WHERE trello_card_id=?", (trello_done, cid))
        else:
            owner = con.execute("SELECT user_id FROM family_members WHERE family_id=? ORDER BY user_id LIMIT 1", (TRELLO_FAMILY_ID,)).fetchone()
            owner_id = owner["user_id"] if owner else None
            con.execute(
                "INSERT INTO tasks (family_id, text, due_date, priority, created_by, assigned_to, trello_card_id)"
                " VALUES (?,?,?,?,?,?,?)",
                (TRELLO_FAMILY_ID, text, due, "normal", "🔵 Trello", owner_id, cid))

    # Push local done → Trello (bi-directional)
    all_card_ids = {card["id"] for card in cards if card["idList"] in list_names}
    local_rows = con.execute(
        "SELECT trello_card_id, done FROM tasks WHERE trello_card_id IS NOT NULL").fetchall()
    for row in local_rows:
        row = dict(row)
        if row["trello_card_id"] not in all_card_ids or not row["done"]:
            continue
        card = next((c for c in cards if c["id"] == row["trello_card_id"]), None)
        if card and not card.get("dueComplete"):
            try:
                await _http().put(
                    f"https://api.trello.com/1/cards/{row['trello_card_id']}",
                    params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN,
                            "dueComplete": "true"},
                    timeout=10)
            except Exception as e:
                log.error(f"Trello card update error: {e}")

    # Auto-cleanup: remove done Trello tasks older than 7 days
    cutoff = (today - timedelta(days=7)).strftime("%Y-%m-%d")
    con.execute(
        "DELETE FROM tasks WHERE trello_card_id IS NOT NULL AND done=1 AND created_at < ?",
        (cutoff,))

    con.commit()
    con.close()
    log.info(f"Trello sync done: {len(relevant)} cards processed")

DEFAULT_SECTIONS = ["greeting","weather","tasks_today","tasks_tomorrow","events","subs","birthdays","word_of_day","tip"]

def _build_digest_sections(con, fid, uid, user_name, now, section_order=None):
    """Build digest sections (HTML parse_mode). Each builder returns list of HTML lines."""
    today_str = now.strftime("%Y-%m-%d")
    tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    order = section_order or DEFAULT_SECTIONS
    e = html.escape  # short alias for user-data escaping

    # Pretty date label for an event/task — Today / Tomorrow / Sun 11
    def _date_label(ds):
        if ds == today_str: return "Today"
        if ds == tomorrow_str: return "Tomorrow"
        try:
            d = datetime.strptime(ds, "%Y-%m-%d").date()
            return d.strftime("%a %-d")  # Sun 11
        except: return ds

    builders = {}

    # ─── Greeting — bold name + date in blockquote
    def _greeting():
        date_line = now.strftime("%A, %B %-d")
        return [
            f"☀️ <b>Good morning, {e(user_name)}!</b>",
            f"<blockquote>{date_line}</blockquote>",
        ]
    builders["greeting"] = _greeting

    # ─── Weather — header + 3-day forecast, monospace temperature ranges
    async def _weather_lines():
        w = await wx.fetch_shaped(WEATHER_LAT, WEATHER_LON, TIMEZONE)
        if not w: return []
        def _icon(lbl): return (lbl or "🌤").split(" ")[0]
        lines = ["🌤 <b>WEATHER</b>"]
        days_names = ["Today", "Tomorrow"]
        for i, dy in enumerate(w.get("days", [])[:3]):
            if i < 2:
                lbl = days_names[i]
            else:
                # 3rd day — actual weekday short
                try:
                    d = datetime.strptime(dy.get("date"), "%Y-%m-%d").date()
                    lbl = d.strftime("%a")
                except: lbl = "Day after"
            lines.append(f"{_icon(dy.get('label'))} {lbl} <code>{dy.get('min')}° – {dy.get('max')}°</code>")
        return lines
    builders["weather"] = _weather_lines

    # ─── Tasks today — colored priority circles (🔴🟡⚪)
    def _tasks_today():
        rows = con.execute(
            "SELECT text, priority FROM tasks WHERE family_id=? AND done=0 AND (assigned_to=? OR assigned_to IS NULL) AND due_date<=? ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END",
            (fid, uid, today_str + " 23:59")).fetchall()
        if not rows: return []
        pri_dot = {"high": "🔴", "normal": "🟡", "low": "⚪"}
        lines = [f"📋 <b>TASKS TODAY · {len(rows)}</b>"]
        for t in rows:
            dot = pri_dot.get(t["priority"] or "normal", "🟡")
            lines.append(f"{dot} {e(t['text'])}")
        return lines
    builders["tasks_today"] = _tasks_today

    # ─── Tasks tomorrow — bullet style, distinct from Today
    def _tasks_tomorrow():
        rows = con.execute(
            "SELECT text FROM tasks WHERE family_id=? AND done=0 AND (assigned_to=? OR assigned_to IS NULL) AND due_date LIKE ?",
            (fid, uid, tomorrow_str + "%")).fetchall()
        if not rows: return []
        lines = [f"↗️ <b>TOMORROW · {len(rows)}</b>"]
        for t in rows:
            lines.append(f"• {e(t['text'])}")
        return lines
    builders["tasks_tomorrow"] = _tasks_tomorrow

    # ─── Events — bold date label · text
    def _events():
        future = (now + timedelta(days=3)).strftime("%Y-%m-%d 23:59")
        evts = con.execute(
            "SELECT text, event_date FROM events WHERE family_id=? AND event_date>=? AND event_date<=? ORDER BY event_date",
            (fid, today_str, future)).fetchall()
        if not evts: return []
        lines = ["📅 <b>EVENTS · next 3 days</b>"]
        for ev in evts:
            ed = ev["event_date"].split(" ")[0]
            lines.append(f"<b>{_date_label(ed)}</b> · {e(ev['text'])}")
        return lines
    builders["events"] = _events

    # ─── Subscriptions — emoji name · amount · italic time
    def _subs():
        subs = con.execute(
            "SELECT name, emoji, amount, currency, billing_day, assigned_to FROM subscriptions WHERE family_id=?",
            (fid,)).fetchall()
        upcoming = []
        for s2 in subs:
            if s2["assigned_to"] and s2["assigned_to"] != uid: continue
            try:
                bill_date = now.date().replace(day=min(s2["billing_day"], 28))
                diff = (bill_date - now.date()).days
                if diff < 0: diff += 30
                if 0 <= diff <= 5:
                    lbl = "today" if diff == 0 else f"in {diff}d"
                    upcoming.append((diff, f"{s2['emoji']} {e(s2['name'])} · {s2['amount']} {e(s2['currency'])} · <i>{lbl}</i>"))
            except: pass
        if not upcoming: return []
        upcoming.sort()
        return ["💳 <b>BILLING SOON</b>"] + [l for _, l in upcoming]
    builders["subs"] = _subs

    # ─── Birthdays — emoji bold-name · italic time, "today!" highlighted
    def _birthdays():
        bdays = con.execute("SELECT name, emoji, birth_date FROM birthdays WHERE family_id=?", (fid,)).fetchall()
        upcoming = []
        for b in bdays:
            try:
                p = b["birth_date"].split("-")
                bd = datetime(now.date().year, int(p[1]), int(p[2])).date()
                diff = (bd - now.date()).days
                if 0 <= diff <= 7:
                    w = "🎉 <b>today!</b>" if diff == 0 else f"<i>in {diff}d</i>"
                    upcoming.append((diff, f"{b['emoji']} <b>{e(b['name'])}</b> · {w}"))
            except: pass
        upcoming.sort()
        if not upcoming: return []
        return ["🎂 <b>BIRTHDAYS</b>"] + [l for _, l in upcoming]
    builders["birthdays"] = _birthdays

    # ─── Word of the day — bilingual (RU + EN) for daily language learning.
    # Each language is a single blockquote: flag + word on the first line, definition on the second.
    def _word_of_day():
        if not WORD_LIST: return []
        w = WORD_LIST[now.timetuple().tm_yday % len(WORD_LIST)]
        return [
            "📚 <b>WORD OF THE DAY</b>",
            f"<blockquote>🇷🇺 <b>{e(w['ru_word'])}</b>\n{e(w['ru_def'])}</blockquote>",
            "",  # blank line between the two quotes for visual spacing
            f"<blockquote>🇬🇧 <b>{e(w['en_word'])}</b>\n{e(w['en_def'])}</blockquote>",
        ]
    builders["word_of_day"] = _word_of_day

    # ─── Tip of the day — blockquote (Telegram renders with vertical accent line)
    def _tip():
        raw = DAILY_TIPS[now.timetuple().tm_yday % len(DAILY_TIPS)]
        # strip leading "💡 " from the tip body (header has its own emoji)
        body = raw[2:].strip() if raw.startswith("💡") else raw
        return [
            "💡 <b>Tip of the day</b>",
            f"<blockquote>{e(body)}</blockquote>",
        ]
    builders["tip"] = _tip

    return builders, order


async def _render_digest(con, fid, uid, user_name, now, section_order=None):
    builders, order = _build_digest_sections(con, fid, uid, user_name, now, section_order)
    blocks = []  # list of joined-lines per section
    for sec in order:
        # Support two formats:
        #   - legacy: section_id string
        #   - new:    {"id": <str>, "enabled": <bool>}  (per-section toggle, v8.9+)
        if isinstance(sec, dict):
            if not sec.get("enabled", True): continue
            sec_id = sec.get("id")
        else:
            sec_id = sec
        if not sec_id: continue
        fn = builders.get(sec_id)
        if not fn: continue
        import asyncio
        result = fn()
        if asyncio.iscoroutine(result):
            result = await result
        if result:
            blocks.append("\n".join(result))
    # Just blank line between sections — no divider
    return "\n\n".join(blocks)


async def send_digest_to(family_id, user_id, is_test=False):
    """Send digest to a single user (for test button)."""
    con = _con()
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    member = con.execute("SELECT user_name, tg_chat_id FROM family_members WHERE user_id=? AND family_id=?",
        (user_id, family_id)).fetchone()
    if not member or not member["tg_chat_id"]:
        con.close()
        return

    s = con.execute("SELECT digest_sections FROM settings WHERE family_id=?", (family_id,)).fetchone()
    section_order = None
    if s and s["digest_sections"]:
        try: section_order = json.loads(s["digest_sections"])
        except: pass

    text = await _render_digest(con, family_id, user_id, member["user_name"], now, section_order)
    if is_test:
        if not text.strip():
            text = "💤 Your digest is empty — all sections are disabled.\nEnable some in <b>Settings → Configure Digest</b>."
        text = "🧪 <b>TEST DIGEST</b>\n\n" + text
    elif not text.strip():
        # Scheduled digest with all sections disabled — skip silently
        con.close()
        return
    await _send(member["tg_chat_id"], text, parse_mode="HTML")
    con.close()


# ─── Morning Digest (every hour, checks per-family time) ────────────────
async def morning_digest():
    con = _con()
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    ct = now.strftime("%H:%M")

    for fam in con.execute("SELECT DISTINCT family_id FROM family_members").fetchall():
        fid = fam["family_id"]
        s = con.execute("SELECT digest_time, last_digest, digest_sections FROM settings WHERE family_id=?", (fid,)).fetchone()
        dt = s["digest_time"] if s and s["digest_time"] else "09:00"
        if ct != dt: continue
        if s and s["last_digest"] == today_str: continue
        con.execute("UPDATE settings SET last_digest=? WHERE family_id=?", (today_str, fid))
        con.commit()

        section_order = None
        if s and s["digest_sections"]:
            try: section_order = json.loads(s["digest_sections"])
            except: pass

        members = con.execute("SELECT user_id, user_name, tg_chat_id FROM family_members WHERE family_id=?", (fid,)).fetchall()
        for member in members:
            if not member["tg_chat_id"]: continue
            text = await _render_digest(con, fid, member["user_id"], member["user_name"], now, section_order)
            if not text.strip(): continue  # all sections disabled — skip silently
            await _send(member["tg_chat_id"], text, parse_mode="HTML")
    con.close()
