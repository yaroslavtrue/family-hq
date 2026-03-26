"""
Background schedulers: task reminders, birthday reminders, cleaning resets,
subscription reminders, recurring task generation, morning digest.
"""
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import httpx, logging

log = logging.getLogger("uvicorn.error")

# These get set by app.py on startup
BOT_TOKEN = ""
DB_PATH = ""
TIMEZONE = ""

def _con():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c

async def _send(chat_id, text):
    try:
        async with httpx.AsyncClient() as c:
            await c.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
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

# ─── Morning Digest (every hour, checks per-family time) ────────────────
async def morning_digest():
    con = _con()
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    ct = now.strftime("%H:%M")
    
    for fam in con.execute("SELECT DISTINCT family_id FROM family_members").fetchall():
        fid = fam["family_id"]
        s = con.execute("SELECT digest_time FROM settings WHERE family_id=?", (fid,)).fetchone()
        dt = s["digest_time"] if s and s["digest_time"] else "09:00"
        if ct != dt: continue
        
        members = con.execute("SELECT user_id, user_name, tg_chat_id FROM family_members WHERE family_id=?", (fid,)).fetchall()
        for member in members:
            if not member["tg_chat_id"]: continue
            uid = member["user_id"]
            lines = [f"☀️ *Good morning, {member['user_name']}!*\n"]
            has = False
            
            # Tasks
            tasks = con.execute("SELECT text, due_date FROM tasks WHERE family_id=? AND done=0 AND (assigned_to=? OR assigned_to IS NULL) AND due_date LIKE ?",
                (fid, uid, today_str + "%")).fetchall()
            if tasks:
                has = True; lines.append("📋 *Your tasks today:*")
                for t in tasks: lines.append(f"  • {t['text']}")
                lines.append("")
            
            # Overdue cleaning
            ct_tasks = con.execute("""
                SELECT ct.text, cz.name, ct.last_done, ct.reset_days
                FROM cleaning_tasks ct JOIN cleaning_zones cz ON cz.id=ct.zone_id
                WHERE ct.family_id=? AND ct.done=1 AND ct.last_done IS NOT NULL
                AND (ct.assigned_to=? OR ct.assigned_to IS NULL OR cz.assigned_to=? OR cz.assigned_to IS NULL)
            """, (fid, uid, uid)).fetchall()
            overdue = []
            for ct2 in ct_tasks:
                try:
                    d = (now.date() - datetime.strptime(ct2["last_done"], "%Y-%m-%d").date()).days
                    if d >= (ct2["reset_days"] or 7): overdue.append(f"{ct2['name']}: {ct2['text']}")
                except: pass
            # Also tasks never done
            never = con.execute("""
                SELECT ct.text, cz.name FROM cleaning_tasks ct JOIN cleaning_zones cz ON cz.id=ct.zone_id
                WHERE ct.family_id=? AND ct.done=0
                AND (ct.assigned_to=? OR ct.assigned_to IS NULL OR cz.assigned_to=? OR cz.assigned_to IS NULL)
            """, (fid, uid, uid)).fetchall()
            for n in never: overdue.append(f"{n['name']}: {n['text']}")
            if overdue:
                has = True; lines.append("🧹 *Cleaning needed:*")
                for o in overdue[:5]: lines.append(f"  • {o}")
                lines.append("")
            
            # Events next 3 days
            future = (now + timedelta(days=3)).strftime("%Y-%m-%d 23:59")
            evts = con.execute("SELECT text, event_date FROM events WHERE family_id=? AND event_date>=? AND event_date<=? ORDER BY event_date",
                (fid, today_str, future)).fetchall()
            if evts:
                has = True; lines.append("📅 *Coming up:*")
                for e in evts: lines.append(f"  • {e['text']} — {e['event_date']}")
                lines.append("")
            
            # Birthdays next 7 days
            bdays = con.execute("SELECT name, emoji, birth_date FROM birthdays WHERE family_id=?", (fid,)).fetchall()
            upcoming = []
            for b in bdays:
                try:
                    p = b["birth_date"].split("-")
                    bd = datetime(now.date().year, int(p[1]), int(p[2])).date()
                    diff = (bd - now.date()).days
                    if 0 <= diff <= 7: upcoming.append((diff, b))
                except: pass
            upcoming.sort()
            if upcoming:
                has = True; lines.append("🎂 *Birthdays:*")
                for diff, b in upcoming:
                    w = "Today!" if diff == 0 else f"in {diff}d"
                    lines.append(f"  • {b['emoji']} {b['name']} — {w}")
            
            if has: await _send(member["tg_chat_id"], "\n".join(lines))
    con.close()
