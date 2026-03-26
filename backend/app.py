"""
🏠 Family HQ v5 — Backend API
"""
import os, sqlite3, hashlib, hmac, json, logging, random, re
from datetime import datetime
from urllib.parse import parse_qs
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.migrate import migrate
from backend import scheduler as sched

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN_HERE")
DB_PATH = os.environ.get("DB_PATH", "family.db")
TIMEZONE = os.environ.get("TZ", "Europe/Belgrade")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://your-domain.com")
log = logging.getLogger("uvicorn.error")

# Currency conversion rates to EUR (approximate, editable)
FX = {"EUR": 1.0, "USD": 0.92, "GBP": 1.16, "RUB": 0.0095, "RSD": 0.0085}

def get_db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False); con.row_factory = sqlite3.Row
    try: yield con
    finally: con.close()

def gen_code():
    return "".join(random.choices("ABCDEFGHJKMNPQRSTUVWXYZ23456789", k=6))

# ─── Auth ────────────────────────────────────────────────────────────────
def validate_init(data):
    if not data or BOT_TOKEN == "YOUR_TOKEN_HERE":
        return {"id": 0, "first_name": "Dev", "photo_url": None}
    try:
        p = parse_qs(data); parts, hv = [], None
        for k in sorted(p.keys()):
            if k == "hash": hv = p[k][0]
            else: parts.append(f"{k}={p[k][0]}")
        if not hv: return None
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        if hmac.new(secret, "\n".join(parts).encode(), hashlib.sha256).hexdigest() != hv: return None
        u = json.loads(p.get("user", ["{}"])[0])
        return {"id": u.get("id", 0), "first_name": u.get("first_name", "User"), "photo_url": u.get("photo_url")}
    except: return None

async def get_user(r: Request):
    u = validate_init(r.headers.get("X-Telegram-Init-Data", ""))
    if not u: raise HTTPException(401)
    return u

async def get_uf(r: Request, db=Depends(get_db)):
    u = await get_user(r)
    row = db.execute("SELECT family_id FROM family_members WHERE user_id=?", (u["id"],)).fetchone()
    if not row: raise HTTPException(404, "Not in a family")
    u["family_id"] = row["family_id"]
    if u.get("photo_url"):
        db.execute("UPDATE family_members SET photo_url=? WHERE user_id=?", (u["photo_url"], u["id"])); db.commit()
    return u

# ─── Notify ──────────────────────────────────────────────────────────────
async def notify_all(fid, msg, db):
    for m in db.execute("SELECT tg_chat_id FROM family_members WHERE family_id=? AND tg_chat_id IS NOT NULL", (fid,)).fetchall():
        await sched._send(m["tg_chat_id"], msg)

# ─── Lifespan ────────────────────────────────────────────────────────────
aps = AsyncIOScheduler(timezone=TIMEZONE)

@asynccontextmanager
async def lifespan(app: FastAPI):
    migrate(DB_PATH)
    sched.BOT_TOKEN = BOT_TOKEN; sched.DB_PATH = DB_PATH; sched.TIMEZONE = TIMEZONE
    aps.add_job(sched.check_task_reminders, "interval", minutes=1)
    aps.add_job(sched.check_zone_reminders, "interval", minutes=1)
    aps.add_job(sched.check_birthday_reminders, "cron", minute=0)
    aps.add_job(sched.check_subscription_reminders, "cron", minute=0)
    aps.add_job(sched.check_event_reminders, "cron", hour=9, minute=0)
    aps.add_job(sched.check_cleaning_resets, "cron", hour=0, minute=5)
    aps.add_job(sched.generate_recurring_tasks, "cron", hour=0, minute=5)
    aps.add_job(sched.morning_digest, "cron", minute=0)
    aps.start(); log.info("✅ Family HQ v5"); yield; aps.shutdown()

app = FastAPI(title="Family HQ v5", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Models ──────────────────────────────────────────────────────────────
class FamilyCreate(BaseModel):
    name: str = "My Family"
class FamilyJoin(BaseModel):
    code: str
class MemberUpdate(BaseModel):
    user_name: str | None = None; emoji: str | None = None; color: str | None = None
class TaskCreate(BaseModel):
    text: str; assigned_to: int | None = None; priority: str = "normal"
    due_date: str | None = None; reminders: list[str] = []
class TaskEdit(BaseModel):
    text: str | None = None; assigned_to: int | None = None; priority: str | None = None
    due_date: str | None = None; reminders: list[str] | None = None
class RecurringCreate(BaseModel):
    text: str; assigned_to: int | None = None; priority: str = "normal"; rrule: str
class RecurringEdit(BaseModel):
    text: str | None = None; assigned_to: int | None = None; rrule: str | None = None
    active: int | None = None
class ShopCreate(BaseModel):
    items: list[str]; folder_id: int | None = None
class FolderCreate(BaseModel):
    name: str; emoji: str = "📁"
class EventCreate(BaseModel):
    text: str; event_date: str; end_date: str | None = None
class BirthdayCreate(BaseModel):
    name: str; emoji: str = "🎂"; birth_date: str; reminders: list[dict] = []
class BirthdayEdit(BaseModel):
    name: str | None = None; emoji: str | None = None; reminders: list[dict] | None = None
class SubCreate(BaseModel):
    text: str
class SubscriptionCreate(BaseModel):
    name: str; emoji: str = "💳"; amount: float; currency: str = "EUR"
    billing_day: int = 1; assigned_to: int | None = None; reminders: list[dict] = []
class SubscriptionEdit(BaseModel):
    name: str | None = None; emoji: str | None = None; amount: float | None = None
    currency: str | None = None; billing_day: int | None = None
    assigned_to: int | None = None; reminders: list[dict] | None = None
class ZoneCreate(BaseModel):
    name: str; icon: str = "🏠"; assigned_to: int | None = None
class ZoneEdit(BaseModel):
    name: str | None = None; icon: str | None = None; assigned_to: int | None = None
    reminders: list[str] | None = None
class ZoneTaskCreate(BaseModel):
    text: str; icon: str = "🧹"; assigned_to: int | None = None; reset_days: int = 7
class ZoneTaskEdit(BaseModel):
    text: str | None = None; icon: str | None = None; assigned_to: int | None = None; reset_days: int | None = None
class SettingsUpdate(BaseModel):
    theme: str | None = None; digest_time: str | None = None

# ═════════════════════════════════════════════════════════════════════════
# FAMILY
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/family/status")
def family_status(user=Depends(get_user), db=Depends(get_db)):
    row = db.execute("SELECT fm.family_id, f.name, f.invite_code FROM family_members fm JOIN families f ON f.id=fm.family_id WHERE fm.user_id=?", (user["id"],)).fetchone()
    if not row: return {"joined": False}
    members = [dict(m) for m in db.execute("SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?", (row["family_id"],)).fetchall()]
    return {"joined": True, "family_id": row["family_id"], "name": row["name"], "invite_code": row["invite_code"], "members": members, "my_id": user["id"]}

@app.post("/api/family/create")
def create_family(body: FamilyCreate, user=Depends(get_user), db=Depends(get_db)):
    if db.execute("SELECT 1 FROM family_members WHERE user_id=?", (user["id"],)).fetchone():
        raise HTTPException(400, "Already in a family")
    code = gen_code()
    while db.execute("SELECT 1 FROM families WHERE invite_code=?", (code,)).fetchone(): code = gen_code()
    fid = db.execute("INSERT INTO families (invite_code, name) VALUES (?, ?)", (code, body.name)).lastrowid
    db.execute("INSERT INTO family_members (user_id,family_id,user_name,emoji,color,photo_url,tg_chat_id) VALUES (?,?,?,?,?,?,?)",
        (user["id"], fid, user["first_name"], "👤", "#7c6aef", user.get("photo_url"), user["id"]))
    for i, (n, ic) in enumerate([("Kitchen","🍳"),("Bathroom","🚿"),("Bedroom","🛏"),("Living Room","🛋"),("Balcony","🌿"),("Office","💻")]):
        zid = db.execute("INSERT INTO cleaning_zones (family_id,name,icon,sort_order) VALUES (?,?,?,?)", (fid, n, ic, i)).lastrowid
        for t in ["Dust surfaces", "Vacuum/sweep", "Mop floor", "Clean mirrors"]:
            db.execute("INSERT INTO cleaning_tasks (zone_id,family_id,text) VALUES (?,?,?)", (zid, fid, t))
    db.execute("INSERT INTO settings (family_id) VALUES (?)", (fid,)); db.commit()
    return {"family_id": fid, "invite_code": code, "name": body.name}

@app.post("/api/family/join")
def join_family(body: FamilyJoin, user=Depends(get_user), db=Depends(get_db)):
    if db.execute("SELECT 1 FROM family_members WHERE user_id=?", (user["id"],)).fetchone():
        raise HTTPException(400, "Already in a family")
    fam = db.execute("SELECT id, name FROM families WHERE invite_code=?", (body.code.strip().upper(),)).fetchone()
    if not fam: raise HTTPException(404, "Invalid code")
    db.execute("INSERT INTO family_members (user_id,family_id,user_name,emoji,color,photo_url,tg_chat_id) VALUES (?,?,?,?,?,?,?)",
        (user["id"], fam["id"], user["first_name"], "😊", "#e0689a", user.get("photo_url"), user["id"]))
    db.commit(); return {"family_id": fam["id"], "name": fam["name"]}

@app.post("/api/family/leave")
def leave_family(user=Depends(get_user), db=Depends(get_db)):
    db.execute("DELETE FROM family_members WHERE user_id=?", (user["id"],)); db.commit()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# MEMBERS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/members")
def list_members(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?", (user["family_id"],)).fetchall()]

@app.patch("/api/members/{uid}")
def update_member(uid: int, body: MemberUpdate, user=Depends(get_uf), db=Depends(get_db)):
    if uid != user["id"]: raise HTTPException(403)
    ups, ps = [], []
    if body.user_name is not None: ups.append("user_name=?"); ps.append(body.user_name)
    if body.emoji is not None: ups.append("emoji=?"); ps.append(body.emoji)
    if body.color is not None: ups.append("color=?"); ps.append(body.color)
    if ups: ps.append(uid); db.execute(f"UPDATE family_members SET {','.join(ups)} WHERE user_id=?", ps); db.commit()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/dashboard")
def dashboard(user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    # Count cleaning tasks that are overdue or never done
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    cleaning_todo = 0
    for t in db.execute("SELECT done, last_done, reset_days FROM cleaning_tasks WHERE family_id=?", (f,)).fetchall():
        if not t["done"] and not t["last_done"]: cleaning_todo += 1
        elif t["done"] and t["last_done"]:
            try:
                if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t["reset_days"] or 7): cleaning_todo += 1
            except: pass
    total_ct = db.execute("SELECT COUNT(*) c FROM cleaning_tasks WHERE family_id=?", (f,)).fetchone()["c"]
    return {
        "tasks_pending": db.execute("SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0", (f,)).fetchone()["c"],
        "shop_pending": db.execute("SELECT COUNT(*) c FROM shopping WHERE family_id=? AND bought=0", (f,)).fetchone()["c"],
        "events_count": db.execute("SELECT COUNT(*) c FROM events WHERE family_id=?", (f,)).fetchone()["c"],
        "cleaning_todo": cleaning_todo, "cleaning_total": total_ct,
        "birthdays_count": db.execute("SELECT COUNT(*) c FROM birthdays WHERE family_id=?", (f,)).fetchone()["c"],
        "subs_count": db.execute("SELECT COUNT(*) c FROM subscriptions WHERE family_id=?", (f,)).fetchone()["c"],
        "user": user["first_name"],
    }

# ═════════════════════════════════════════════════════════════════════════
# TASKS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/tasks")
def list_tasks(user=Depends(get_uf), db=Depends(get_db)):
    tasks = [dict(r) for r in db.execute("SELECT * FROM tasks WHERE family_id=? ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id DESC", (user["family_id"],)).fetchall()]
    for t in tasks:
        t["reminders"] = [dict(r) for r in db.execute("SELECT id, remind_at, sent FROM task_reminders WHERE task_id=?", (t["id"],)).fetchall()]
    return tasks

@app.post("/api/tasks")
async def create_task(body: TaskCreate, user=Depends(get_uf), db=Depends(get_db)):
    tid = db.execute("INSERT INTO tasks (family_id,text,assigned_to,priority,due_date,created_by) VALUES (?,?,?,?,?,?)",
        (user["family_id"], body.text, body.assigned_to, body.priority, body.due_date, user["first_name"])).lastrowid
    for r in body.reminders[:5]:
        db.execute("INSERT INTO task_reminders (task_id,family_id,remind_at) VALUES (?,?,?)", (tid, user["family_id"], r))
    db.commit()
    await notify_all(user["family_id"], f"📋 *{user['first_name']}* added task: *{body.text}*", db)
    return {"id": tid}

@app.put("/api/tasks/{tid}")
def edit_task(tid: int, body: TaskEdit, user=Depends(get_uf), db=Depends(get_db)):
    ups, ps = [], []
    if body.text is not None: ups.append("text=?"); ps.append(body.text)
    if body.assigned_to is not None: ups.append("assigned_to=?"); ps.append(body.assigned_to if body.assigned_to != 0 else None)
    if body.priority is not None: ups.append("priority=?"); ps.append(body.priority)
    if body.due_date is not None: ups.append("due_date=?"); ps.append(body.due_date or None)
    if ups: ps.extend([tid, user["family_id"]]); db.execute(f"UPDATE tasks SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
    if body.reminders is not None:
        db.execute("DELETE FROM task_reminders WHERE task_id=? AND family_id=?", (tid, user["family_id"]))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO task_reminders (task_id,family_id,remind_at) VALUES (?,?,?)", (tid, user["family_id"], r))
    db.commit(); return {"ok": True}

@app.patch("/api/tasks/{tid}/toggle")
async def toggle_task(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    t = db.execute("SELECT text, done FROM tasks WHERE id=? AND family_id=?", (tid, user["family_id"])).fetchone()
    db.execute("UPDATE tasks SET done=CASE WHEN done=0 THEN 1 ELSE 0 END WHERE id=? AND family_id=?", (tid, user["family_id"])); db.commit()
    if t and not t["done"]: await notify_all(user["family_id"], f"✅ *{user['first_name']}* completed: *{t['text']}*", db)
    return {"ok": True}

@app.delete("/api/tasks/{tid}")
def del_task(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM task_reminders WHERE task_id=? AND family_id=?", (tid, user["family_id"]))
    db.execute("DELETE FROM tasks WHERE id=? AND family_id=?", (tid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# RECURRING TASKS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/recurring")
def list_recurring(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM recurring_tasks WHERE family_id=? ORDER BY id DESC", (user["family_id"],)).fetchall()]

@app.post("/api/recurring")
async def create_recurring(body: RecurringCreate, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT INTO recurring_tasks (family_id,text,assigned_to,priority,rrule) VALUES (?,?,?,?,?)",
        (user["family_id"], body.text, body.assigned_to, body.priority, body.rrule)); db.commit()
    await notify_all(user["family_id"], f"🔁 *{user['first_name']}* added recurring task: *{body.text}* ({body.rrule})", db)
    return {"ok": True}

@app.put("/api/recurring/{rid}")
def edit_recurring(rid: int, body: RecurringEdit, user=Depends(get_uf), db=Depends(get_db)):
    ups, ps = [], []
    if body.text is not None: ups.append("text=?"); ps.append(body.text)
    if body.assigned_to is not None: ups.append("assigned_to=?"); ps.append(body.assigned_to if body.assigned_to != 0 else None)
    if body.rrule is not None: ups.append("rrule=?"); ps.append(body.rrule)
    if body.active is not None: ups.append("active=?"); ps.append(body.active)
    if ups: ps.extend([rid, user["family_id"]]); db.execute(f"UPDATE recurring_tasks SET {','.join(ups)} WHERE id=? AND family_id=?", ps); db.commit()
    return {"ok": True}

@app.delete("/api/recurring/{rid}")
def del_recurring(rid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM recurring_tasks WHERE id=? AND family_id=?", (rid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# SHOPPING
# ═════════════════════════════════════════════════════════════════════════
def parse_quantity(text):
    """Parse 'Огурец [1кг]' → ('Огурец', '1кг')"""
    m = re.match(r'^(.*?)\s*\[(.+?)\]\s*$', text)
    if m: return m.group(1).strip(), m.group(2).strip()
    return text.strip(), None

@app.get("/api/shopping")
def list_shopping(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM shopping WHERE family_id=? ORDER BY bought, id DESC", (user["family_id"],)).fetchall()]

@app.post("/api/shopping")
async def add_shopping(body: ShopCreate, user=Depends(get_uf), db=Depends(get_db)):
    added = []
    for raw in body.items:
        raw = raw.strip()
        if not raw: continue
        item, qty = parse_quantity(raw)
        cur = db.execute("INSERT INTO shopping (family_id,item,quantity,added_by,folder_id) VALUES (?,?,?,?,?)",
            (user["family_id"], item, qty, user["first_name"], body.folder_id))
        added.append({"id": cur.lastrowid, "item": item, "quantity": qty})
    db.commit()
    names = ", ".join(a["item"] for a in added)
    await notify_all(user["family_id"], f"🛒 *{user['first_name']}* added: *{names}*", db)
    return added

@app.patch("/api/shopping/{sid}/toggle")
def toggle_shop(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("UPDATE shopping SET bought=CASE WHEN bought=0 THEN 1 ELSE 0 END WHERE id=? AND family_id=?", (sid, user["family_id"])); db.commit(); return {"ok": True}

@app.delete("/api/shopping/{sid}")
def del_shop(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM shopping WHERE id=? AND family_id=?", (sid, user["family_id"])); db.commit(); return {"ok": True}

@app.delete("/api/shopping/clear-bought")
def clear_bought(user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM shopping WHERE family_id=? AND bought=1", (user["family_id"],)); db.commit(); return {"ok": True}

# Shopping Folders
@app.get("/api/shopping/folders")
def list_folders(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM shopping_folders WHERE family_id=? ORDER BY sort_order", (user["family_id"],)).fetchall()]

@app.post("/api/shopping/folders")
def create_folder(body: FolderCreate, user=Depends(get_uf), db=Depends(get_db)):
    mx = db.execute("SELECT COALESCE(MAX(sort_order),0) m FROM shopping_folders WHERE family_id=?", (user["family_id"],)).fetchone()["m"]
    fid = db.execute("INSERT INTO shopping_folders (family_id,name,emoji,sort_order) VALUES (?,?,?,?)",
        (user["family_id"], body.name, body.emoji, mx+1)).lastrowid
    db.commit(); return {"id": fid}

@app.delete("/api/shopping/folders/{fid}")
def del_folder(fid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("UPDATE shopping SET folder_id=NULL WHERE folder_id=? AND family_id=?", (fid, user["family_id"]))
    db.execute("DELETE FROM shopping_folders WHERE id=? AND family_id=?", (fid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# EVENTS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/events")
def list_events(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM events WHERE family_id=? ORDER BY event_date", (user["family_id"],)).fetchall()]

@app.post("/api/events")
async def create_event(body: EventCreate, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT INTO events (family_id,text,event_date,end_date,created_by) VALUES (?,?,?,?,?)",
        (user["family_id"], body.text, body.event_date, body.end_date, user["first_name"])); db.commit()
    await notify_all(user["family_id"], f"📅 *{user['first_name']}* added event: *{body.text}*", db)
    return {"ok": True}

@app.delete("/api/events/{eid}")
def del_event(eid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM events WHERE id=? AND family_id=?", (eid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# BIRTHDAYS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/birthdays")
def list_birthdays(user=Depends(get_uf), db=Depends(get_db)):
    bdays = [dict(r) for r in db.execute("SELECT * FROM birthdays WHERE family_id=?", (user["family_id"],)).fetchall()]
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    for b in bdays:
        b["reminders"] = [dict(r) for r in db.execute("SELECT id, days_before, time FROM birthday_reminders WHERE birthday_id=?", (b["id"],)).fetchall()]
        try:
            p = b["birth_date"].split("-")
            bd = datetime(today.year, int(p[1]), int(p[2])).date()
            diff = (bd - today).days
            if diff < 0: diff = (datetime(today.year + 1, int(p[1]), int(p[2])).date() - today).days
            b["days_until"] = diff
        except: b["days_until"] = 999
    bdays.sort(key=lambda x: x["days_until"])
    return bdays

@app.post("/api/birthdays")
async def create_bday(body: BirthdayCreate, user=Depends(get_uf), db=Depends(get_db)):
    bid = db.execute("INSERT INTO birthdays (family_id,name,emoji,birth_date) VALUES (?,?,?,?)",
        (user["family_id"], body.name, body.emoji, body.birth_date)).lastrowid
    rems = body.reminders if body.reminders else [{"days_before": 1, "time": "09:00"}, {"days_before": 0, "time": "09:00"}]
    for r in rems[:5]:
        db.execute("INSERT INTO birthday_reminders (birthday_id,family_id,days_before,time) VALUES (?,?,?,?)",
            (bid, user["family_id"], r.get("days_before", 0), r.get("time", "09:00")))
    db.commit()
    await notify_all(user["family_id"], f"🎂 *{user['first_name']}* added birthday: *{body.emoji} {body.name}*", db)
    return {"id": bid}

@app.put("/api/birthdays/{bid}")
def edit_bday(bid: int, body: BirthdayEdit, user=Depends(get_uf), db=Depends(get_db)):
    if body.name is not None: db.execute("UPDATE birthdays SET name=? WHERE id=? AND family_id=?", (body.name, bid, user["family_id"]))
    if body.emoji is not None: db.execute("UPDATE birthdays SET emoji=? WHERE id=? AND family_id=?", (body.emoji, bid, user["family_id"]))
    if body.reminders is not None:
        db.execute("DELETE FROM birthday_reminders WHERE birthday_id=? AND family_id=?", (bid, user["family_id"]))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO birthday_reminders (birthday_id,family_id,days_before,time) VALUES (?,?,?,?)",
                (bid, user["family_id"], r.get("days_before", 0), r.get("time", "09:00")))
    db.commit(); return {"ok": True}

@app.delete("/api/birthdays/{bid}")
def del_bday(bid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM birthday_reminders WHERE birthday_id=? AND family_id=?", (bid, user["family_id"]))
    db.execute("DELETE FROM birthdays WHERE id=? AND family_id=?", (bid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# SUBSCRIPTIONS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/subscriptions")
def list_subs(user=Depends(get_uf), db=Depends(get_db)):
    subs = [dict(r) for r in db.execute("SELECT * FROM subscriptions WHERE family_id=? ORDER BY billing_day", (user["family_id"],)).fetchall()]
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    for s in subs:
        s["reminders"] = [dict(r) for r in db.execute("SELECT id, days_before, time FROM subscription_reminders WHERE sub_id=?", (s["id"],)).fetchall()]
        try:
            bd = datetime(today.year, today.month, min(s["billing_day"], 28)).date()
            diff = (bd - today).days
            if diff < 0:
                if today.month == 12: bd = datetime(today.year + 1, 1, min(s["billing_day"], 28)).date()
                else: bd = datetime(today.year, today.month + 1, min(s["billing_day"], 28)).date()
                diff = (bd - today).days
            s["days_until"] = diff
        except: s["days_until"] = 99
    return subs

@app.post("/api/subscriptions")
async def create_sub(body: SubscriptionCreate, user=Depends(get_uf), db=Depends(get_db)):
    eur = round(body.amount * FX.get(body.currency, 1.0), 2)
    sid = db.execute("INSERT INTO subscriptions (family_id,name,emoji,amount,currency,amount_eur,billing_day,assigned_to) VALUES (?,?,?,?,?,?,?,?)",
        (user["family_id"], body.name, body.emoji, body.amount, body.currency, eur, body.billing_day, body.assigned_to)).lastrowid
    rems = body.reminders if body.reminders else [{"days_before": 3, "time": "09:00"}, {"days_before": 0, "time": "09:00"}]
    for r in rems[:5]:
        db.execute("INSERT INTO subscription_reminders (sub_id,family_id,days_before,time) VALUES (?,?,?,?)",
            (sid, user["family_id"], r.get("days_before", 0), r.get("time", "09:00")))
    db.commit()
    await notify_all(user["family_id"], f"💳 *{user['first_name']}* added subscription: *{body.emoji} {body.name}* ({body.amount} {body.currency})", db)
    return {"id": sid}

@app.put("/api/subscriptions/{sid}")
def edit_sub(sid: int, body: SubscriptionEdit, user=Depends(get_uf), db=Depends(get_db)):
    ups, ps = [], []
    if body.name is not None: ups.append("name=?"); ps.append(body.name)
    if body.emoji is not None: ups.append("emoji=?"); ps.append(body.emoji)
    if body.amount is not None: ups.append("amount=?"); ps.append(body.amount)
    if body.currency is not None: ups.append("currency=?"); ps.append(body.currency)
    if body.billing_day is not None: ups.append("billing_day=?"); ps.append(body.billing_day)
    if body.assigned_to is not None: ups.append("assigned_to=?"); ps.append(body.assigned_to if body.assigned_to != 0 else None)
    if body.amount is not None or body.currency is not None:
        amt = body.amount or db.execute("SELECT amount FROM subscriptions WHERE id=?", (sid,)).fetchone()["amount"]
        cur = body.currency or db.execute("SELECT currency FROM subscriptions WHERE id=?", (sid,)).fetchone()["currency"]
        ups.append("amount_eur=?"); ps.append(round(amt * FX.get(cur, 1.0), 2))
    if ups: ps.extend([sid, user["family_id"]]); db.execute(f"UPDATE subscriptions SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
    if body.reminders is not None:
        db.execute("DELETE FROM subscription_reminders WHERE sub_id=? AND family_id=?", (sid, user["family_id"]))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO subscription_reminders (sub_id,family_id,days_before,time) VALUES (?,?,?,?)",
                (sid, user["family_id"], r.get("days_before", 0), r.get("time", "09:00")))
    db.commit(); return {"ok": True}

@app.delete("/api/subscriptions/{sid}")
def del_sub(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM subscription_reminders WHERE sub_id=? AND family_id=?", (sid, user["family_id"]))
    db.execute("DELETE FROM subscriptions WHERE id=? AND family_id=?", (sid, user["family_id"])); db.commit(); return {"ok": True}

@app.get("/api/subscriptions/total")
def subs_total(user=Depends(get_uf), db=Depends(get_db)):
    total = db.execute("SELECT COALESCE(SUM(amount_eur),0) t FROM subscriptions WHERE family_id=?", (user["family_id"],)).fetchone()["t"]
    return {"total_eur": round(total, 2)}

# ═════════════════════════════════════════════════════════════════════════
# SUBTASKS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/subtasks/all/{pt}")
def list_subs_all(pt: str, user=Depends(get_uf), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM subtasks WHERE parent_type=? AND family_id=? ORDER BY parent_id, id", (pt, user["family_id"])).fetchall()
    result = {}
    for r in rows:
        pid = r["parent_id"]
        if pid not in result: result[pid] = []
        result[pid].append(dict(r))
    return result

@app.post("/api/subtasks/{pt}/{pid}")
async def create_subtask(pt: str, pid: int, body: SubCreate, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT INTO subtasks (parent_type,parent_id,family_id,text) VALUES (?,?,?,?)", (pt, pid, user["family_id"], body.text)); db.commit()
    tbl = {"task": "tasks", "event": "events"}.get(pt)
    pn = ""
    if tbl:
        row = db.execute(f"SELECT text FROM {tbl} WHERE id=?", (pid,)).fetchone()
        if row: pn = row["text"]
    await notify_all(user["family_id"], f"📝 *{user['first_name']}* added step _{body.text}_ to *{pn}*", db)
    return {"ok": True}

@app.patch("/api/subtasks/{sid}/toggle")
async def toggle_subtask(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    s = db.execute("SELECT * FROM subtasks WHERE id=? AND family_id=?", (sid, user["family_id"])).fetchone()
    if not s: raise HTTPException(404)
    nd = 0 if s["done"] else 1
    db.execute("UPDATE subtasks SET done=? WHERE id=?", (nd, sid)); db.commit()
    if nd: await notify_all(user["family_id"], f"✅ *{user['first_name']}* completed step _{s['text']}_", db)
    return {"ok": True}

@app.delete("/api/subtasks/{sid}")
def del_subtask(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM subtasks WHERE id=? AND family_id=?", (sid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# CLEANING
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/cleaning/zones")
def list_zones(user=Depends(get_uf), db=Depends(get_db)):
    zones = [dict(r) for r in db.execute("SELECT * FROM cleaning_zones WHERE family_id=? ORDER BY sort_order", (user["family_id"],)).fetchall()]
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    for z in zones:
        z["tasks"] = [dict(r) for r in db.execute("SELECT * FROM cleaning_tasks WHERE zone_id=? AND family_id=? ORDER BY id", (z["id"], user["family_id"])).fetchall()]
        z["reminders"] = [dict(r) for r in db.execute("SELECT id, remind_at, sent FROM zone_reminders WHERE zone_id=? AND family_id=?", (z["id"], user["family_id"])).fetchall()]
        # Zone is dirty if any task is overdue or never done
        dirty = False
        for t in z["tasks"]:
            if not t["done"] and not t.get("last_done"): dirty = True
            elif t["done"] and t.get("last_done"):
                try:
                    if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t.get("reset_days") or 7): dirty = True
                except: dirty = True
            elif not t["done"]: dirty = True
        z["dirty"] = dirty
    return zones

@app.post("/api/cleaning/zones")
def create_zone(body: ZoneCreate, user=Depends(get_uf), db=Depends(get_db)):
    mx = db.execute("SELECT COALESCE(MAX(sort_order),0) m FROM cleaning_zones WHERE family_id=?", (user["family_id"],)).fetchone()["m"]
    zid = db.execute("INSERT INTO cleaning_zones (family_id,name,icon,assigned_to,sort_order) VALUES (?,?,?,?,?)",
        (user["family_id"], body.name, body.icon, body.assigned_to, mx+1)).lastrowid
    db.commit(); return {"id": zid}

@app.put("/api/cleaning/zones/{zid}")
def edit_zone(zid: int, body: ZoneEdit, user=Depends(get_uf), db=Depends(get_db)):
    ups, ps = [], []
    if body.name is not None: ups.append("name=?"); ps.append(body.name)
    if body.icon is not None: ups.append("icon=?"); ps.append(body.icon)
    if body.assigned_to is not None: ups.append("assigned_to=?"); ps.append(body.assigned_to if body.assigned_to != 0 else None)
    if ups: ps.extend([zid, user["family_id"]]); db.execute(f"UPDATE cleaning_zones SET {','.join(ups)} WHERE id=? AND family_id=?", ps)
    if body.reminders is not None:
        db.execute("DELETE FROM zone_reminders WHERE zone_id=? AND family_id=?", (zid, user["family_id"]))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO zone_reminders (zone_id,family_id,remind_at) VALUES (?,?,?)", (zid, user["family_id"], r))
    db.commit(); return {"ok": True}

@app.delete("/api/cleaning/zones/{zid}")
def del_zone(zid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM cleaning_tasks WHERE zone_id=? AND family_id=?", (zid, user["family_id"]))
    db.execute("DELETE FROM zone_reminders WHERE zone_id=? AND family_id=?", (zid, user["family_id"]))
    db.execute("DELETE FROM cleaning_zones WHERE id=? AND family_id=?", (zid, user["family_id"])); db.commit(); return {"ok": True}

@app.post("/api/cleaning/zones/{zid}/tasks")
def add_zone_task(zid: int, body: ZoneTaskCreate, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT INTO cleaning_tasks (zone_id,family_id,text,icon,assigned_to,reset_days) VALUES (?,?,?,?,?,?)",
        (zid, user["family_id"], body.text, body.icon, body.assigned_to, body.reset_days)); db.commit(); return {"ok": True}

@app.put("/api/cleaning/tasks/{tid}")
def edit_zone_task(tid: int, body: ZoneTaskEdit, user=Depends(get_uf), db=Depends(get_db)):
    ups, ps = [], []
    if body.text is not None: ups.append("text=?"); ps.append(body.text)
    if body.icon is not None: ups.append("icon=?"); ps.append(body.icon)
    if body.assigned_to is not None: ups.append("assigned_to=?"); ps.append(body.assigned_to if body.assigned_to != 0 else None)
    if body.reset_days is not None: ups.append("reset_days=?"); ps.append(body.reset_days)
    if ups: ps.extend([tid, user["family_id"]]); db.execute(f"UPDATE cleaning_tasks SET {','.join(ups)} WHERE id=? AND family_id=?", ps); db.commit()
    return {"ok": True}

@app.patch("/api/cleaning/tasks/{tid}/toggle")
async def toggle_zt(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    t = db.execute("SELECT ct.*, cz.name as zn FROM cleaning_tasks ct JOIN cleaning_zones cz ON cz.id=ct.zone_id WHERE ct.id=? AND ct.family_id=?", (tid, user["family_id"])).fetchone()
    if not t: raise HTTPException(404)
    nd = 0 if t["done"] else 1
    if nd:
        db.execute("UPDATE cleaning_tasks SET done=1, last_done=? WHERE id=?", (datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d"), tid))
        await notify_all(user["family_id"], f"🧹 *{user['first_name']}* cleaned _{t['text']}_ in *{t['zn']}*", db)
    else:
        db.execute("UPDATE cleaning_tasks SET done=0 WHERE id=?", (tid,))
    db.commit(); return {"ok": True}

@app.delete("/api/cleaning/tasks/{tid}")
def del_zt(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM cleaning_tasks WHERE id=? AND family_id=?", (tid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/settings")
def get_settings(user=Depends(get_uf), db=Depends(get_db)):
    row = db.execute("SELECT * FROM settings WHERE family_id=?", (user["family_id"],)).fetchone()
    if not row:
        db.execute("INSERT INTO settings (family_id) VALUES (?)", (user["family_id"],)); db.commit()
        return {"family_id": user["family_id"], "theme": "midnight", "digest_time": "09:00"}
    return dict(row)

@app.patch("/api/settings")
def update_settings(body: SettingsUpdate, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT OR IGNORE INTO settings (family_id) VALUES (?)", (user["family_id"],))
    if body.theme: db.execute("UPDATE settings SET theme=? WHERE family_id=?", (body.theme, user["family_id"]))
    if body.digest_time: db.execute("UPDATE settings SET digest_time=? WHERE family_id=?", (body.digest_time, user["family_id"]))
    db.commit(); return {"ok": True}

# ─── Debug & Serve ───────────────────────────────────────────────────────
@app.get("/api/debug/ping")
def ping(): return {"ok": True, "version": "v5", "time": datetime.now(ZoneInfo(TIMEZONE)).isoformat()}

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

@app.get("/")
def serve_index(): return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
