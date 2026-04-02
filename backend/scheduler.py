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
TRELLO_API_KEY = ""
TRELLO_TOKEN = ""
TRELLO_BOARD_ID = ""
TRELLO_FAMILY_ID = 1

TRELLO_LISTS = ["Монтаж видео", "Сайты", "Бренд", "Видеосъемка"]

WEATHER_LAT = "44.8"
WEATHER_LON = "20.46"

WMO = {0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",51:"🌦",53:"🌦",55:"🌧",
       61:"🌧",63:"🌧",65:"🌧",66:"🌧",67:"🌧",71:"🌨",73:"🌨",75:"❄️",77:"❄️",
       80:"🌦",81:"🌧",82:"⛈",85:"🌨",86:"❄️",95:"⛈",96:"⛈",99:"⛈"}

async def _get_weather():
    try:
        url = (f"https://api.open-meteo.com/v1/forecast?"
               f"latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
               f"&daily=temperature_2m_max,temperature_2m_min,weathercode"
               f"&current=temperature_2m,weathercode"
               f"&timezone={TIMEZONE}&forecast_days=3")
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(url)
            return r.json()
    except:
        return None

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

# ─── Trello Sync (every 30 min) ─────────────────────────────────────────
async def sync_trello():
    if not TRELLO_API_KEY or not TRELLO_TOKEN or not TRELLO_BOARD_ID:
        log.info("Trello sync skipped: no credentials configured")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"https://api.trello.com/1/boards/{TRELLO_BOARD_ID}/lists",
                params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN, "fields": "id,name"})
            lists = r.json()
            target_ids = {l["id"] for l in lists if l["name"] in TRELLO_LISTS}

            r2 = await c.get(
                f"https://api.trello.com/1/boards/{TRELLO_BOARD_ID}/cards",
                params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN,
                        "fields": "id,name,due,dueComplete,idList", "filter": "open"})
            cards = r2.json()
    except Exception as e:
        log.error(f"Trello fetch error: {e}")
        return

    con = _con()
    today = datetime.now(ZoneInfo(TIMEZONE))
    relevant = [card for card in cards if card.get("due") and card["idList"] in target_ids]
    relevant_ids = {card["id"] for card in relevant}

    for card in relevant:
        cid = card["id"]
        text = card["name"]
        due = card["due"][:10] if card["due"] else None
        trello_done = 1 if card.get("dueComplete") else 0

        existing = con.execute(
            "SELECT id, done FROM tasks WHERE trello_card_id=?", (cid,)).fetchone()
        if existing:
            if dict(existing)["done"] != trello_done:
                con.execute(
                    "UPDATE tasks SET done=? WHERE trello_card_id=?", (trello_done, cid))
        else:
            con.execute(
                "INSERT INTO tasks (family_id, text, due_date, priority, created_by, trello_card_id)"
                " VALUES (?,?,?,?,?,?)",
                (TRELLO_FAMILY_ID, text, due, "normal", "🔵 Trello", cid))

    # Push local done → Trello (bi-directional)
    local_rows = con.execute(
        "SELECT trello_card_id, done FROM tasks WHERE trello_card_id IS NOT NULL").fetchall()
    for row in local_rows:
        row = dict(row)
        if row["trello_card_id"] not in relevant_ids or not row["done"]:
            continue
        card = next((c for c in cards if c["id"] == row["trello_card_id"]), None)
        if card and not card.get("dueComplete"):
            try:
                async with httpx.AsyncClient(timeout=5) as c:
                    await c.put(
                        f"https://api.trello.com/1/cards/{row['trello_card_id']}",
                        params={"key": TRELLO_API_KEY, "token": TRELLO_TOKEN,
                                "dueComplete": "true"})
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

# ─── Morning Digest (every hour, checks per-family time) ────────────────
async def morning_digest():
    con = _con()
    tz = ZoneInfo(TIMEZONE)
    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    ct = now.strftime("%H:%M")

    for fam in con.execute("SELECT DISTINCT family_id FROM family_members").fetchall():
        fid = fam["family_id"]
        s = con.execute("SELECT digest_time, last_digest FROM settings WHERE family_id=?", (fid,)).fetchone()
        dt = s["digest_time"] if s and s["digest_time"] else "09:00"
        if ct != dt: continue
        # Dedup: skip if already sent today
        if s and s["last_digest"] == today_str: continue
        con.execute("UPDATE settings SET last_digest=? WHERE family_id=?", (today_str, fid))
        con.commit()

        # Fetch weather once for the family
        weather = await _get_weather()
        w_lines = []
        if weather:
            cur = weather.get("current", {})
            daily = weather.get("daily", {})
            wc = cur.get("weathercode", 0)
            w_lines.append(f"{WMO.get(wc, '🌤')} *{round(cur.get('temperature_2m', 0))}°C* сейчас")
            days_names = ["Сегодня", "Завтра", "Послезавтра"]
            for i in range(min(3, len(daily.get("time", [])))):
                dwc = daily["weathercode"][i]
                hi = round(daily["temperature_2m_max"][i])
                lo = round(daily["temperature_2m_min"][i])
                w_lines.append(f"  {days_names[i] if i < 3 else daily['time'][i]}: {WMO.get(dwc, '🌤')} {lo}°..{hi}°")

        members = con.execute("SELECT user_id, user_name, tg_chat_id FROM family_members WHERE family_id=?", (fid,)).fetchall()
        for member in members:
            if not member["tg_chat_id"]: continue
            uid = member["user_id"]
            lines = [f"☀️ *Доброе утро, {member['user_name']}!*"]

            # Weather
            if w_lines:
                lines.append("")
                lines.extend(w_lines)

            # Tasks today
            tasks_today = con.execute(
                "SELECT text FROM tasks WHERE family_id=? AND done=0 AND (assigned_to=? OR assigned_to IS NULL) AND due_date LIKE ?",
                (fid, uid, today_str + "%")).fetchall()
            if tasks_today:
                lines.append("")
                lines.append("📋 *Задачи на сегодня:*")
                for t in tasks_today: lines.append(f"  • {t['text']}")

            # Tasks tomorrow
            tasks_tmrw = con.execute(
                "SELECT text FROM tasks WHERE family_id=? AND done=0 AND (assigned_to=? OR assigned_to IS NULL) AND due_date LIKE ?",
                (fid, uid, tomorrow_str + "%")).fetchall()
            if tasks_tmrw:
                lines.append("")
                lines.append("📋 *Задачи на завтра:*")
                for t in tasks_tmrw: lines.append(f"  • {t['text']}")

            # Cleaning needed
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
            never = con.execute("""
                SELECT ct.text, cz.name FROM cleaning_tasks ct JOIN cleaning_zones cz ON cz.id=ct.zone_id
                WHERE ct.family_id=? AND ct.done=0
                AND (ct.assigned_to=? OR ct.assigned_to IS NULL OR cz.assigned_to=? OR cz.assigned_to IS NULL)
            """, (fid, uid, uid)).fetchall()
            for n in never: overdue.append(f"{n['name']}: {n['text']}")
            if overdue:
                lines.append("")
                lines.append("🧹 *Уборка:*")
                for o in overdue[:5]: lines.append(f"  • {o}")

            # Events next 3 days
            future = (now + timedelta(days=3)).strftime("%Y-%m-%d 23:59")
            evts = con.execute("SELECT text, event_date FROM events WHERE family_id=? AND event_date>=? AND event_date<=? ORDER BY event_date",
                (fid, today_str, future)).fetchall()
            if evts:
                lines.append("")
                lines.append("📅 *Ближайшие события:*")
                for e in evts:
                    ed = e["event_date"].split(" ")[0]
                    lbl = "сегодня" if ed == today_str else ("завтра" if ed == tomorrow_str else ed)
                    lines.append(f"  • {e['text']} — {lbl}")

            # Subscriptions next 5 days
            subs = con.execute("SELECT name, emoji, amount, currency, billing_day, assigned_to FROM subscriptions WHERE family_id=?", (fid,)).fetchall()
            upcoming_subs = []
            for s2 in subs:
                if s2["assigned_to"] and s2["assigned_to"] != uid: continue
                try:
                    bill_date = now.date().replace(day=min(s2["billing_day"], 28))
                    diff = (bill_date - now.date()).days
                    if diff < 0: diff += 30  # next month
                    if 0 <= diff <= 5:
                        lbl = "сегодня" if diff == 0 else (f"через {diff}д")
                        upcoming_subs.append(f"{s2['emoji']} {s2['name']} — {s2['amount']} {s2['currency']} ({lbl})")
                except: pass
            if upcoming_subs:
                lines.append("")
                lines.append("💳 *Подписки:*")
                for s2 in upcoming_subs: lines.append(f"  • {s2}")

            # Birthdays next 7 days
            bdays = con.execute("SELECT name, emoji, birth_date FROM birthdays WHERE family_id=?", (fid,)).fetchall()
            upcoming_bd = []
            for b in bdays:
                try:
                    p = b["birth_date"].split("-")
                    bd = datetime(now.date().year, int(p[1]), int(p[2])).date()
                    diff = (bd - now.date()).days
                    if 0 <= diff <= 7:
                        w = "сегодня! 🎉" if diff == 0 else f"через {diff}д"
                        upcoming_bd.append((diff, f"{b['emoji']} {b['name']} — {w}"))
                except: pass
            upcoming_bd.sort()
            if upcoming_bd:
                lines.append("")
                lines.append("🎂 *Дни рождения:*")
                for _, l in upcoming_bd: lines.append(f"  • {l}")

            await _send(member["tg_chat_id"], "\n".join(lines))
    con.close()
