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
from backend import weather as wx

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN_HERE")
DB_PATH = os.environ.get("DB_PATH", "family.db")
TIMEZONE = os.environ.get("TZ", "Europe/Belgrade")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://your-domain.com")
TRELLO_API_KEY = os.environ.get("TRELLO_API_KEY", "")
TRELLO_TOKEN = os.environ.get("TRELLO_TOKEN", "")
TRELLO_BOARD_ID = os.environ.get("TRELLO_BOARD_ID", "")
TRELLO_FAMILY_ID = int(os.environ.get("TRELLO_FAMILY_ID", "1"))
# Belgrade coords (default); override via env if needed
WEATHER_LAT = float(os.environ.get("WEATHER_LAT", "44.8"))
WEATHER_LON = float(os.environ.get("WEATHER_LON", "20.46"))
log = logging.getLogger("uvicorn.error")

async def get_weather():
    """Returns the shaped weather forecast for the frontend.
    Implementation lives in backend/weather.py (shared with scheduler)."""
    return await wx.fetch_shaped(WEATHER_LAT, WEATHER_LON, TIMEZONE)

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

# ─── Generic partial-update helper ───────────────────────────────────────
# Coerce assigned_to / member_id / category_id / folder_id where 0 means "unassigned"
_zero_to_none = lambda v: v if v != 0 else None
_or_none = lambda v: v or None

def _update_fields(db, table, where, where_params, body, mapping):
    """
    Build & execute a partial UPDATE from a Pydantic body.
      mapping: {body_attr: column_name}  or  {body_attr: (column_name, transform_fn)}
    Skips attributes whose body value is None. Returns True if a row was touched.
    Caller is responsible for db.commit().
    """
    sets, params = [], []
    for attr, spec in mapping.items():
        val = getattr(body, attr, None)
        if val is None:
            continue
        if isinstance(spec, tuple):
            col, fn = spec
            val = fn(val)
        else:
            col = spec
        sets.append(f"{col}=?")
        params.append(val)
    if not sets:
        return False
    db.execute(f"UPDATE {table} SET {','.join(sets)} WHERE {where}", params + list(where_params))
    return True

# ─── Lifespan ────────────────────────────────────────────────────────────
aps = AsyncIOScheduler(timezone=TIMEZONE)

@asynccontextmanager
async def lifespan(app: FastAPI):
    migrate(DB_PATH)
    sched.BOT_TOKEN = BOT_TOKEN; sched.DB_PATH = DB_PATH; sched.TIMEZONE = TIMEZONE
    sched.TRELLO_API_KEY = TRELLO_API_KEY; sched.TRELLO_TOKEN = TRELLO_TOKEN
    sched.TRELLO_BOARD_ID = TRELLO_BOARD_ID; sched.TRELLO_FAMILY_ID = TRELLO_FAMILY_ID
    sched.WEATHER_LAT = str(WEATHER_LAT); sched.WEATHER_LON = str(WEATHER_LON)
    aps.add_job(sched.check_task_reminders, "interval", minutes=1)
    aps.add_job(sched.check_zone_reminders, "interval", minutes=1)
    aps.add_job(sched.check_birthday_reminders, "cron", minute=0)
    aps.add_job(sched.check_subscription_reminders, "cron", minute=0)
    aps.add_job(sched.check_event_reminders, "cron", hour=9, minute=0)
    aps.add_job(sched.check_cleaning_resets, "cron", hour=0, minute=5)
    aps.add_job(sched.generate_recurring_tasks, "cron", hour=0, minute=5)
    aps.add_job(sched.morning_digest, "cron", minute=0)
    aps.add_job(sched.refresh_weather, "interval", minutes=60, next_run_time=datetime.now(ZoneInfo(TIMEZONE)))
    aps.add_job(sched.sync_trello, "interval", minutes=30)
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
    theme: str | None = None; digest_time: str | None = None; digest_sections: str | None = None
class TransactionCreate(BaseModel):
    type: str = "expense"; amount: float; currency: str = "RSD"
    category_id: int | None = None; description: str = ""; date: str | None = None
    member_id: int | None = None
class TransactionEdit(BaseModel):
    type: str | None = None; amount: float | None = None; currency: str | None = None
    category_id: int | None = None; description: str | None = None; date: str | None = None
    member_id: int | None = None
class CategoryCreate(BaseModel):
    name: str; emoji: str = "📦"; type: str = "expense"
class CategoryEdit(BaseModel):
    name: str | None = None; emoji: str | None = None
class LimitSet(BaseModel):
    monthly_limit: float
class TxItemCreate(BaseModel):
    name: str; quantity: int = 1; amount: float = 0; currency: str = "RSD"
class TxItemEdit(BaseModel):
    name: str | None = None; quantity: int | None = None; amount: float | None = None; currency: str | None = None

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
    db.execute("INSERT INTO settings (family_id) VALUES (?)", (fid,))
    _ensure_categories(db, fid)
    db.commit()
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
    if _update_fields(db, "family_members", "user_id=?", (uid,), body,
                      {"user_name": "user_name", "emoji": "emoji", "color": "color"}):
        db.commit()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/dashboard")
def dashboard(user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    # Count dirty zones
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    zones_all = db.execute("SELECT id FROM cleaning_zones WHERE family_id=?", (f,)).fetchall()
    cleaning_dirty = 0
    for z in zones_all:
        tasks = db.execute("SELECT done, last_done, reset_days FROM cleaning_tasks WHERE zone_id=? AND family_id=?", (z["id"], f)).fetchall()
        zd = False
        for t in tasks:
            if not t["done"] and not t.get("last_done"): zd = True
            elif t["done"] and t.get("last_done"):
                try:
                    if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t.get("reset_days") or 7): zd = True
                except: zd = True
            elif not t["done"]: zd = True
        if zd: cleaning_dirty += 1
    total_ct = len(zones_all)
    return {
        "tasks_pending": db.execute("SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0", (f,)).fetchone()["c"],
        "shop_pending": db.execute("SELECT COUNT(*) c FROM shopping WHERE family_id=? AND bought=0", (f,)).fetchone()["c"],
        "events_count": db.execute("SELECT COUNT(*) c FROM events WHERE family_id=?", (f,)).fetchone()["c"],
        "cleaning_dirty": cleaning_dirty, "cleaning_total": total_ct,
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
    fid = user["family_id"]
    _update_fields(db, "tasks", "id=? AND family_id=?", (tid, fid), body, {
        "text": "text",
        "assigned_to": ("assigned_to", _zero_to_none),
        "priority": "priority",
        "due_date": ("due_date", _or_none),
    })
    if body.reminders is not None:
        db.execute("DELETE FROM task_reminders WHERE task_id=? AND family_id=?", (tid, fid))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO task_reminders (task_id,family_id,remind_at) VALUES (?,?,?)", (tid, fid, r))
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
    if _update_fields(db, "recurring_tasks", "id=? AND family_id=?", (rid, user["family_id"]), body, {
        "text": "text",
        "assigned_to": ("assigned_to", _zero_to_none),
        "rrule": "rrule",
        "active": "active",
    }):
        db.commit()
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

class ShopEdit(BaseModel):
    item: str | None = None
    quantity: str | None = None
    price: float | None = None
    folder_id: int | None = None

@app.put("/api/shopping/{sid}")
def edit_shop(sid: int, body: ShopEdit, user=Depends(get_uf), db=Depends(get_db)):
    if _update_fields(db, "shopping", "id=? AND family_id=?", (sid, user["family_id"]), body, {
        "item": "item",
        "quantity": "quantity",
        "price": "price",
        "folder_id": ("folder_id", _zero_to_none),
    }):
        db.commit()
    return {"ok": True}

@app.get("/api/shopping/folder-totals")
def folder_totals(user=Depends(get_uf), db=Depends(get_db)):
    rows = db.execute("SELECT folder_id, SUM(COALESCE(price,0)*CASE WHEN bought=0 THEN 1 ELSE 0 END) as total FROM shopping WHERE family_id=? GROUP BY folder_id", (user["family_id"],)).fetchall()
    return {str(r["folder_id"] or "all"): round(r["total"], 2) for r in rows}

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

class FolderEdit(BaseModel):
    name: str | None = None; emoji: str | None = None

@app.put("/api/shopping/folders/{fid}")
def edit_folder(fid: int, body: FolderEdit, user=Depends(get_uf), db=Depends(get_db)):
    if _update_fields(db, "shopping_folders", "id=? AND family_id=?", (fid, user["family_id"]), body,
                      {"name": "name", "emoji": "emoji"}):
        db.commit()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# EVENTS
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/events")
def list_events(user=Depends(get_uf), db=Depends(get_db)):
    rows = [dict(r) for r in db.execute("SELECT * FROM events WHERE family_id=?", (user["family_id"],)).fetchall()]
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    def _inv(s):
        try:
            y, m, dd = s.split("-")
            return f"{9999 - int(y):04d}-{12 - int(m):02d}-{31 - int(dd):02d}"
        except:
            return "9999-99-99"
    def _key(e):
        try:
            d = datetime.strptime((e.get("end_date") or e["event_date"]), "%Y-%m-%d").date()
        except:
            return (2, "9999-99-99")
        if d >= today:
            return (0, e["event_date"])
        return (1, _inv(e["event_date"] or ""))
    rows.sort(key=_key)
    return rows

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
    fid = user["family_id"]
    _update_fields(db, "birthdays", "id=? AND family_id=?", (bid, fid), body,
                   {"name": "name", "emoji": "emoji"})
    if body.reminders is not None:
        db.execute("DELETE FROM birthday_reminders WHERE birthday_id=? AND family_id=?", (bid, fid))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO birthday_reminders (birthday_id,family_id,days_before,time) VALUES (?,?,?,?)",
                (bid, fid, r.get("days_before", 0), r.get("time", "09:00")))
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
    subs = [dict(r) for r in db.execute("SELECT * FROM subscriptions WHERE family_id=?", (user["family_id"],)).fetchall()]
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
    subs.sort(key=lambda x: x["days_until"])
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
    fid = user["family_id"]
    _update_fields(db, "subscriptions", "id=? AND family_id=?", (sid, fid), body, {
        "name": "name", "emoji": "emoji", "amount": "amount", "currency": "currency",
        "billing_day": "billing_day",
        "assigned_to": ("assigned_to", _zero_to_none),
    })
    # Recompute amount_eur if amount or currency changed
    if body.amount is not None or body.currency is not None:
        cur_row = db.execute("SELECT amount, currency FROM subscriptions WHERE id=?", (sid,)).fetchone()
        eur = round(cur_row["amount"] * FX.get(cur_row["currency"], 1.0), 2)
        db.execute("UPDATE subscriptions SET amount_eur=? WHERE id=? AND family_id=?", (eur, sid, fid))
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
    if pt != "transaction":
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
    if nd and s["parent_type"] != "transaction":
        await notify_all(user["family_id"], f"✅ *{user['first_name']}* completed step _{s['text']}_", db)
    return {"ok": True}

@app.delete("/api/subtasks/{sid}")
def del_subtask(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM subtasks WHERE id=? AND family_id=?", (sid, user["family_id"])); db.commit(); return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# TRANSACTION ITEMS (receipt breakdown)
# ═════════════════════════════════════════════════════════════════════════
@app.post("/api/transactions/{tid}/items")
def create_tx_item(tid: int, body: TxItemCreate, user=Depends(get_uf), db=Depends(get_db)):
    tx = db.execute("SELECT id FROM transactions WHERE id=? AND family_id=?", (tid, user["family_id"])).fetchone()
    if not tx: raise HTTPException(404)
    db.execute("INSERT INTO transaction_items (transaction_id,family_id,name,quantity,amount,currency) VALUES (?,?,?,?,?,?)",
        (tid, user["family_id"], body.name, body.quantity, body.amount, body.currency)); db.commit()
    return {"ok": True}

@app.put("/api/transactions/items/{iid}")
def edit_tx_item(iid: int, body: TxItemEdit, user=Depends(get_uf), db=Depends(get_db)):
    item = db.execute("SELECT id FROM transaction_items WHERE id=? AND family_id=?", (iid, user["family_id"])).fetchone()
    if not item: raise HTTPException(404)
    if _update_fields(db, "transaction_items", "id=? AND family_id=?", (iid, user["family_id"]), body, {
        "name": "name", "quantity": "quantity", "amount": "amount", "currency": "currency",
    }):
        db.commit()
    return {"ok": True}

@app.delete("/api/transactions/items/{iid}")
def del_tx_item(iid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM transaction_items WHERE id=? AND family_id=?", (iid, user["family_id"])); db.commit()
    return {"ok": True}

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
    fid = user["family_id"]
    _update_fields(db, "cleaning_zones", "id=? AND family_id=?", (zid, fid), body, {
        "name": "name", "icon": "icon",
        "assigned_to": ("assigned_to", _zero_to_none),
    })
    if body.reminders is not None:
        db.execute("DELETE FROM zone_reminders WHERE zone_id=? AND family_id=?", (zid, fid))
        for r in body.reminders[:5]:
            db.execute("INSERT INTO zone_reminders (zone_id,family_id,remind_at) VALUES (?,?,?)", (zid, fid, r))
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
    if _update_fields(db, "cleaning_tasks", "id=? AND family_id=?", (tid, user["family_id"]), body, {
        "text": "text", "icon": "icon",
        "assigned_to": ("assigned_to", _zero_to_none),
        "reset_days": "reset_days",
    }):
        db.commit()
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
    if body.digest_sections is not None: db.execute("UPDATE settings SET digest_sections=? WHERE family_id=?", (body.digest_sections, user["family_id"]))
    db.commit(); return {"ok": True}

@app.post("/api/digest/test")
async def test_digest(user=Depends(get_uf), db=Depends(get_db)):
    """Send a test digest to the requesting user only."""
    member = db.execute("SELECT tg_chat_id FROM family_members WHERE user_id=? AND family_id=?",
        (user["id"], user["family_id"])).fetchone()
    if not member or not member["tg_chat_id"]:
        raise HTTPException(400, "No Telegram chat linked")
    await sched.send_digest_to(user["family_id"], user["id"], is_test=True)
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# TRELLO
# ═════════════════════════════════════════════════════════════════════════
@app.post("/api/trello/sync")
async def manual_trello_sync(user=Depends(get_uf)):
    await sched.sync_trello()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# MONEY — Categories, Transactions, Limits
# ═════════════════════════════════════════════════════════════════════════
def _ensure_categories(db, fid):
    """Seed defaults if family has no categories yet."""
    if db.execute("SELECT COUNT(*) c FROM categories WHERE family_id=?", (fid,)).fetchone()["c"] > 0: return
    for i, (em, nm) in enumerate([("🍔","Food"),("🏠","Home / bills"),("🎉","Entertainment"),("🚕","Transport"),("🛒","Shopping"),("💊","Health"),("📦","Other")]):
        db.execute("INSERT INTO categories (family_id,name,emoji,type,is_default,sort_order) VALUES (?,?,?,'expense',1,?)", (fid, nm, em, i))
    for i, (em, nm) in enumerate([("💼","Salary"),("💻","Freelance"),("🎁","Gift"),("📦","Other")]):
        db.execute("INSERT INTO categories (family_id,name,emoji,type,is_default,sort_order) VALUES (?,?,?,'income',1,?)", (fid, nm, em, i))
    db.commit()

@app.get("/api/categories")
def list_categories(user=Depends(get_uf), db=Depends(get_db)):
    _ensure_categories(db, user["family_id"])
    return [dict(r) for r in db.execute("SELECT * FROM categories WHERE family_id=? ORDER BY type, sort_order", (user["family_id"],)).fetchall()]

@app.post("/api/categories")
def create_category(body: CategoryCreate, user=Depends(get_uf), db=Depends(get_db)):
    mx = db.execute("SELECT COALESCE(MAX(sort_order),0) m FROM categories WHERE family_id=? AND type=?", (user["family_id"], body.type)).fetchone()["m"]
    cid = db.execute("INSERT INTO categories (family_id,name,emoji,type,sort_order) VALUES (?,?,?,?,?)",
        (user["family_id"], body.name, body.emoji, body.type, mx+1)).lastrowid
    db.commit(); return {"id": cid}

@app.put("/api/categories/{cid}")
def edit_category(cid: int, body: CategoryEdit, user=Depends(get_uf), db=Depends(get_db)):
    if _update_fields(db, "categories", "id=? AND family_id=?", (cid, user["family_id"]), body,
                      {"name": "name", "emoji": "emoji"}):
        db.commit()
    return {"ok": True}

@app.delete("/api/categories/{cid}")
def del_category(cid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("UPDATE transactions SET category_id=NULL WHERE category_id=? AND family_id=?", (cid, user["family_id"]))
    db.execute("DELETE FROM category_limits WHERE category_id=? AND family_id=?", (cid, user["family_id"]))
    db.execute("DELETE FROM categories WHERE id=? AND family_id=? AND is_default=0", (cid, user["family_id"]))
    db.commit(); return {"ok": True}

# Transactions
@app.get("/api/transactions")
def list_transactions(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM transactions WHERE family_id=? ORDER BY date DESC, id DESC", (user["family_id"],)).fetchall()]

@app.post("/api/transactions")
async def create_transaction(body: TransactionCreate, user=Depends(get_uf), db=Depends(get_db)):
    eur = round(body.amount * FX.get(body.currency, 1.0), 2)
    dt = body.date or datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d")
    db.execute("INSERT INTO transactions (family_id,type,amount,currency,amount_eur,category_id,description,date,member_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (user["family_id"], body.type, body.amount, body.currency, eur, body.category_id, body.description, dt, body.member_id or user["id"]))
    db.commit()
    # Notify
    cat = ""
    if body.category_id:
        cr = db.execute("SELECT emoji, name FROM categories WHERE id=?", (body.category_id,)).fetchone()
        if cr: cat = f" {cr['emoji']} {cr['name']}"
    sign = "💸" if body.type == "expense" else "💰"
    await notify_all(user["family_id"], f"{sign} *{user['first_name']}*: {body.amount} {body.currency}{cat}", db)
    return {"ok": True}

@app.put("/api/transactions/{tid}")
def edit_transaction(tid: int, body: TransactionEdit, user=Depends(get_uf), db=Depends(get_db)):
    fid = user["family_id"]
    _update_fields(db, "transactions", "id=? AND family_id=?", (tid, fid), body, {
        "type": "type", "amount": "amount", "currency": "currency",
        "category_id": ("category_id", _zero_to_none),
        "description": "description", "date": "date",
        "member_id": ("member_id", _zero_to_none),
    })
    if body.amount is not None or body.currency is not None:
        cur_row = db.execute("SELECT amount, currency FROM transactions WHERE id=?", (tid,)).fetchone()
        eur = round(cur_row["amount"] * FX.get(cur_row["currency"], 1.0), 2)
        db.execute("UPDATE transactions SET amount_eur=? WHERE id=? AND family_id=?", (eur, tid, fid))
    db.commit()
    return {"ok": True}

@app.delete("/api/transactions/{tid}")
def del_transaction(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM transactions WHERE id=? AND family_id=?", (tid, user["family_id"])); db.commit(); return {"ok": True}

# Analytics — monthly summary
@app.get("/api/money/summary")
def money_summary(month: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    _ensure_categories(db, f)
    now = datetime.now(ZoneInfo(TIMEZONE))
    cur_month = now.strftime("%Y-%m")
    # Validate & resolve month (YYYY-MM). Falls back to current if invalid/missing.
    import re
    sel_month = cur_month
    if month and re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        sel_month = month
    sy, sm = int(sel_month[:4]), int(sel_month[5:7])
    is_current = (sel_month == cur_month)
    # Selected month totals
    inc = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='income' AND date LIKE ?", (f, sel_month+"%")).fetchone()["s"]
    exp = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date LIKE ?", (f, sel_month+"%")).fetchone()["s"]
    # Subs as monthly expense (flat, not month-dependent)
    subs_eur = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM subscriptions WHERE family_id=?", (f,)).fetchone()["s"]
    # By category (selected month)
    by_cat = [dict(r) for r in db.execute("""
        SELECT c.id, c.emoji, c.name, COALESCE(SUM(t.amount_eur),0) total
        FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.family_id=c.family_id AND t.type='expense' AND t.date LIKE ?
        WHERE c.family_id=? AND c.type='expense' GROUP BY c.id ORDER BY total DESC
    """, (sel_month+"%", f)).fetchall()]
    # Monthly chart: last 6 months ending on the selected month
    months = []
    for i in range(5, -1, -1):
        m = sm - i
        y = sy
        while m <= 0: m += 12; y -= 1
        mk = f"{y}-{m:02d}"
        mi = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='income' AND date LIKE ?", (f, mk+"%")).fetchone()["s"]
        me = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date LIKE ?", (f, mk+"%")).fetchone()["s"]
        months.append({"month": mk, "income": round(mi, 2), "expense": round(me, 2)})
    # Limits (selected month spend vs limit)
    limits = [dict(r) for r in db.execute("""
        SELECT cl.id, cl.category_id, cl.monthly_limit, c.emoji, c.name,
        COALESCE((SELECT SUM(t.amount_eur) FROM transactions t WHERE t.category_id=cl.category_id AND t.family_id=cl.family_id AND t.type='expense' AND t.date LIKE ?),0) spent
        FROM category_limits cl JOIN categories c ON c.id=cl.category_id WHERE cl.family_id=?
    """, (sel_month+"%", f)).fetchall()]
    # This week spend (only meaningful for current month view)
    from datetime import timedelta
    week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    week_exp = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date>=?", (f, week_start)).fetchone()["s"] if is_current else 0
    return {
        "month": sel_month, "is_current": is_current,
        "income": round(inc, 2), "expense": round(exp, 2),
        "subs_eur": round(subs_eur, 2), "balance": round(inc - exp, 2),
        "by_category": by_cat, "months": months, "limits": limits,
        "week_expense": round(week_exp, 2),
    }

# Category limits
@app.put("/api/money/limits/{cid}")
def set_limit(cid: int, body: LimitSet, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("INSERT INTO category_limits (family_id,category_id,monthly_limit) VALUES (?,?,?) ON CONFLICT(family_id,category_id) DO UPDATE SET monthly_limit=?",
        (user["family_id"], cid, body.monthly_limit, body.monthly_limit)); db.commit()
    return {"ok": True}

@app.delete("/api/money/limits/{cid}")
def del_limit(cid: int, user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM category_limits WHERE category_id=? AND family_id=?", (cid, user["family_id"])); db.commit()
    return {"ok": True}

# Profile stats
@app.get("/api/profile/stats")
def profile_stats(member_id: int | None = None, user=Depends(get_uf), db=Depends(get_db)):
    from datetime import timedelta
    f = user["family_id"]
    now = datetime.now(ZoneInfo(TIMEZONE))
    today_str = now.strftime("%Y-%m-%d")
    week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    month_prefix = now.strftime("%Y-%m")

    # Task stats (assigned_to is user_id int)
    tf = "AND assigned_to=?" if member_id else ""
    tx = (member_id,) if member_id else ()
    tasks_active = db.execute(f"SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0 {tf}", (f,) + tx).fetchone()["c"]
    tasks_done = db.execute(f"SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=1 {tf}", (f,) + tx).fetchone()["c"]
    tasks_high = db.execute(f"SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0 AND priority='high' {tf}", (f,) + tx).fetchone()["c"]
    tasks_overdue = db.execute(f"SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0 AND due_date IS NOT NULL AND due_date<? {tf}", (f, today_str) + tx).fetchone()["c"]

    # Money stats (member_id column — mx appended AFTER positional params)
    mf = "AND member_id=?" if member_id else ""
    mx = (member_id,) if member_id else ()
    spent_month = db.execute(f"SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date LIKE ? {mf}", (f, month_prefix+"%") + mx).fetchone()["s"]
    income_month = db.execute(f"SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='income' AND date LIKE ? {mf}", (f, month_prefix+"%") + mx).fetchone()["s"]
    spent_week = db.execute(f"SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date>=? {mf}", (f, week_start) + mx).fetchone()["s"]
    tx_count = db.execute(f"SELECT COUNT(*) c FROM transactions WHERE family_id=? AND date LIKE ? {mf}", (f, month_prefix+"%") + mx).fetchone()["c"]

    # Top spending category this month
    top_row = db.execute(f"""SELECT c.emoji, c.name, COALESCE(SUM(t.amount_eur),0) total
        FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
        WHERE t.family_id=? AND t.type='expense' AND t.date LIKE ? {mf}
        GROUP BY t.category_id ORDER BY total DESC LIMIT 1""", (f, month_prefix+"%") + mx).fetchone()
    top_cat = {"emoji": top_row["emoji"], "name": top_row["name"], "total": round(top_row["total"], 2)} if top_row and top_row["total"] > 0 else None

    # Shopping stats (added_by stores user_name string)
    sf, sp2 = "", (f,)
    if member_id:
        m_row = db.execute("SELECT user_name FROM family_members WHERE user_id=?", (member_id,)).fetchone()
        if m_row:
            sf = "AND added_by=?"
            sp2 = (f, m_row["user_name"])
    shop_total = db.execute(f"SELECT COUNT(*) c FROM shopping WHERE family_id=? {sf}", sp2).fetchone()["c"]
    shop_bought = db.execute(f"SELECT COUNT(*) c FROM shopping WHERE family_id=? AND bought=1 {sf}", sp2).fetchone()["c"]

    # Cleaning stats (assigned_to is user_id int)
    cf = "AND ct.assigned_to=?" if member_id else ""
    cp = (f, member_id) if member_id else (f,)
    clean_done = db.execute(f"SELECT COUNT(*) c FROM cleaning_tasks ct WHERE ct.family_id=? AND ct.done=1 {cf}", cp).fetchone()["c"]
    clean_total = db.execute(f"SELECT COUNT(*) c FROM cleaning_tasks ct WHERE ct.family_id=? {cf}", cp).fetchone()["c"]

    return {
        "member_id": member_id,
        "tasks_active": tasks_active, "tasks_done": tasks_done,
        "tasks_high": tasks_high, "tasks_overdue": tasks_overdue,
        "spent_month": round(spent_month, 2), "income_month": round(income_month, 2),
        "spent_week": round(spent_week, 2), "tx_count": tx_count,
        "top_category": top_cat,
        "shop_total": shop_total, "shop_bought": shop_bought,
        "clean_done": clean_done, "clean_total": clean_total,
    }

# Calendar — month view items
@app.get("/api/calendar")
def calendar_items(month: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    from datetime import timedelta
    f = user["family_id"]
    now = datetime.now(ZoneInfo(TIMEZONE))
    cur = now.strftime("%Y-%m")
    import re as _re
    sel = cur
    if month and _re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        sel = month
    y, m = int(sel[:4]), int(sel[5:7])
    # Visible range: first Monday ≤ 1st of month, last Sunday ≥ last of month
    from calendar import monthrange
    first_day = datetime(y, m, 1).date()
    _, mdays = monthrange(y, m)
    last_day = datetime(y, m, mdays).date()
    # Monday=0 in isoweekday()-1
    vis_start = first_day - timedelta(days=(first_day.weekday()))  # Monday
    vis_end = last_day + timedelta(days=(6 - last_day.weekday()))  # Sunday
    vs, ve = vis_start.isoformat(), vis_end.isoformat()

    items = []
    # Events (may span multiple days)
    for r in db.execute("SELECT id,text,event_date,end_date FROM events WHERE family_id=? AND event_date IS NOT NULL", (f,)).fetchall():
        s = (r["event_date"] or "").split(" ")[0]
        e = (r["end_date"] or s).split(" ")[0]
        if e >= vs and s <= ve:
            items.append({"id": r["id"], "type": "event", "title": r["text"], "start": s, "end": e, "color": "pr"})
    # Tasks with due_date
    for r in db.execute("SELECT id,text,due_date,done,assigned_to FROM tasks WHERE family_id=? AND due_date IS NOT NULL AND due_date>=? AND due_date<=?", (f, vs, ve)).fetchall():
        items.append({"id": r["id"], "type": "task", "title": r["text"], "start": r["due_date"], "end": r["due_date"],
                       "color": "ac" if not r["done"] else "ok", "done": bool(r["done"]), "assigned_to": r["assigned_to"]})
    # Birthdays (map to this year)
    for r in db.execute("SELECT id,name,emoji,birth_date FROM birthdays WHERE family_id=?", (f,)).fetchall():
        bd = r["birth_date"]
        if not bd:
            continue
        this_year = f"{y}-{bd[5:]}"
        if this_year >= vs and this_year <= ve:
            items.append({"id": r["id"], "type": "birthday", "title": f"{r['emoji']} {r['name']}", "start": this_year, "end": this_year, "color": "wn"})

    return {"month": sel, "vis_start": vs, "vis_end": ve, "items": items}

# ═════════════════════════════════════════════════════════════════════════
# BUNDLE (all data in one request)
# ═════════════════════════════════════════════════════════════════════════
def _calc_dirty(db, fid, tz):
    today = datetime.now(ZoneInfo(tz)).date()
    zones_all = db.execute("SELECT id FROM cleaning_zones WHERE family_id=?", (fid,)).fetchall()
    dirty = 0
    for z in zones_all:
        tasks = [dict(t) for t in db.execute("SELECT done, last_done, reset_days FROM cleaning_tasks WHERE zone_id=? AND family_id=?", (z["id"], fid)).fetchall()]
        zd = False
        for t in tasks:
            if not t["done"] and not t.get("last_done"): zd = True
            elif t["done"] and t.get("last_done"):
                try:
                    if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t.get("reset_days") or 7): zd = True
                except: zd = True
            elif not t["done"]: zd = True
        if zd: dirty += 1
    return dirty, len(zones_all)

def _group_by(rows, key):
    """Group sqlite Row objects into {key_value: [dict, ...]}."""
    out = {}
    for r in rows:
        k = r[key]
        out.setdefault(k, []).append(dict(r))
    return out


@app.get("/api/bundle")
async def bundle(user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    tz = TIMEZONE
    today = datetime.now(ZoneInfo(tz)).date()

    # ─── Tasks + reminders (single query per relation, then group in Python) ──
    tasks = [dict(r) for r in db.execute(
        "SELECT * FROM tasks WHERE family_id=? "
        "ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id DESC",
        (f,)).fetchall()]
    task_reminders = _group_by(db.execute(
        "SELECT id, task_id, remind_at, sent FROM task_reminders WHERE family_id=?", (f,)).fetchall(),
        "task_id")
    for t in tasks:
        t["reminders"] = task_reminders.get(t["id"], [])

    # Recurring
    recurring = [dict(r) for r in db.execute(
        "SELECT * FROM recurring_tasks WHERE family_id=? ORDER BY id DESC", (f,)).fetchall()]

    # Shopping
    shopping = [dict(r) for r in db.execute(
        "SELECT * FROM shopping WHERE family_id=? ORDER BY bought, id DESC", (f,)).fetchall()]
    folders = [dict(r) for r in db.execute(
        "SELECT * FROM shopping_folders WHERE family_id=? ORDER BY sort_order", (f,)).fetchall()]

    # Events — upcoming first (asc), then past (most-recent past first)
    events = [dict(r) for r in db.execute(
        "SELECT * FROM events WHERE family_id=?", (f,)).fetchall()]
    def _inv_date(s):
        # invert so recent past sorts before older past
        try:
            y, m, dd = s.split("-")
            return f"{9999 - int(y):04d}-{12 - int(m):02d}-{31 - int(dd):02d}"
        except:
            return "9999-99-99"
    def _ev_key(e):
        try:
            d = datetime.strptime((e.get("end_date") or e["event_date"]), "%Y-%m-%d").date()
        except:
            return (2, "9999-99-99")
        # bucket 0 = upcoming (incl. today) asc; bucket 1 = past desc
        if d >= today:
            return (0, e["event_date"])
        return (1, _inv_date(e["event_date"] or ""))
    events.sort(key=_ev_key)

    # ─── Birthdays + reminders ────────────────────────────────────────────────
    bdays = [dict(r) for r in db.execute(
        "SELECT * FROM birthdays WHERE family_id=?", (f,)).fetchall()]
    bday_reminders = _group_by(db.execute(
        "SELECT id, birthday_id, days_before, time FROM birthday_reminders WHERE family_id=?", (f,)).fetchall(),
        "birthday_id")
    for b in bdays:
        b["reminders"] = bday_reminders.get(b["id"], [])
        try:
            p = b["birth_date"].split("-")
            bd = datetime(today.year, int(p[1]), int(p[2])).date()
            diff = (bd - today).days
            if diff < 0:
                diff = (datetime(today.year + 1, int(p[1]), int(p[2])).date() - today).days
            b["days_until"] = diff
        except:
            b["days_until"] = 999
    bdays.sort(key=lambda x: x["days_until"])

    # ─── Subscriptions + reminders ────────────────────────────────────────────
    subs = [dict(r) for r in db.execute(
        "SELECT * FROM subscriptions WHERE family_id=?", (f,)).fetchall()]
    sub_reminders = _group_by(db.execute(
        "SELECT id, sub_id, days_before, time FROM subscription_reminders WHERE family_id=?", (f,)).fetchall(),
        "sub_id")
    for s in subs:
        s["reminders"] = sub_reminders.get(s["id"], [])
        try:
            bd2 = datetime(today.year, today.month, min(s["billing_day"], 28)).date()
            diff2 = (bd2 - today).days
            if diff2 < 0:
                if today.month == 12:
                    bd2 = datetime(today.year + 1, 1, min(s["billing_day"], 28)).date()
                else:
                    bd2 = datetime(today.year, today.month + 1, min(s["billing_day"], 28)).date()
                diff2 = (bd2 - today).days
            s["days_until"] = diff2
        except:
            s["days_until"] = 99
    subs.sort(key=lambda x: x["days_until"])

    # Members
    members = [dict(m) for m in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?",
        (f,)).fetchall()]

    # Settings
    srow = db.execute("SELECT * FROM settings WHERE family_id=?", (f,)).fetchone()
    if not srow:
        db.execute("INSERT INTO settings (family_id) VALUES (?)", (f,))
        db.commit()
        settings = {"family_id": f, "theme": "midnight", "digest_time": "09:00"}
    else:
        settings = dict(srow)

    # Family status
    frow = db.execute(
        "SELECT fm.family_id, f.name, f.invite_code FROM family_members fm "
        "JOIN families f ON f.id=fm.family_id WHERE fm.user_id=?", (user["id"],)).fetchone()
    family = {"joined": True, "family_id": frow["family_id"], "name": frow["name"],
              "invite_code": frow["invite_code"], "members": members, "my_id": user["id"]}

    # ─── Zones + tasks + reminders (3 queries total instead of 1+2N) ─────────
    zones = [dict(r) for r in db.execute(
        "SELECT * FROM cleaning_zones WHERE family_id=? ORDER BY sort_order", (f,)).fetchall()]
    zone_tasks_grouped = _group_by(db.execute(
        "SELECT * FROM cleaning_tasks WHERE family_id=? ORDER BY zone_id, id", (f,)).fetchall(),
        "zone_id")
    zone_reminders_grouped = _group_by(db.execute(
        "SELECT id, zone_id, remind_at, sent FROM zone_reminders WHERE family_id=?", (f,)).fetchall(),
        "zone_id")
    dirty_cnt = 0
    for z in zones:
        z["tasks"] = zone_tasks_grouped.get(z["id"], [])
        z["reminders"] = zone_reminders_grouped.get(z["id"], [])
        dirty_z = False
        for t in z["tasks"]:
            if not t["done"] and not t.get("last_done"):
                dirty_z = True
            elif t["done"] and t.get("last_done"):
                try:
                    if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t.get("reset_days") or 7):
                        dirty_z = True
                except:
                    dirty_z = True
            elif not t["done"]:
                dirty_z = True
        z["dirty"] = dirty_z
        if dirty_z:
            dirty_cnt += 1

    # ─── Subtasks (one query covers both task + event parents) ───────────────
    all_subs = db.execute(
        "SELECT * FROM subtasks WHERE family_id=? AND parent_type IN ('task','event') ORDER BY parent_type, parent_id, id",
        (f,)).fetchall()
    subtasks_task, subtasks_event = {}, {}
    for r in all_subs:
        bucket = subtasks_task if r["parent_type"] == "task" else subtasks_event
        bucket.setdefault(r["parent_id"], []).append(dict(r))

    # ─── Dashboard counts (single query via SUM/COUNT pattern keeps it 6 hits;
    #     each is now indexed after migration v11) ─────────────────────────────
    dashboard = {
        "tasks_pending": db.execute("SELECT COUNT(*) c FROM tasks WHERE family_id=? AND done=0", (f,)).fetchone()["c"],
        "shop_pending": db.execute("SELECT COUNT(*) c FROM shopping WHERE family_id=? AND bought=0", (f,)).fetchone()["c"],
        "events_count": len(events),
        "cleaning_dirty": dirty_cnt, "cleaning_total": len(zones),
        "birthdays_count": len(bdays),
        "subs_count": len(subs),
        "user": user["first_name"],
    }

    # Money data
    _ensure_categories(db, f)
    categories = [dict(r) for r in db.execute(
        "SELECT * FROM categories WHERE family_id=? ORDER BY type, sort_order", (f,)).fetchall()]
    transactions = [dict(r) for r in db.execute(
        "SELECT * FROM transactions WHERE family_id=? ORDER BY date DESC, id DESC LIMIT 100", (f,)).fetchall()]

    # Transaction items (receipt breakdown) — single query, grouped by tx
    tx_items = _group_by(db.execute(
        "SELECT * FROM transaction_items WHERE family_id=? ORDER BY transaction_id, id", (f,)).fetchall(),
        "transaction_id")

    # Weather (cached + retried inside weather.py)
    weather = await get_weather()

    return {
        "tasks": tasks, "recurring": recurring, "shopping": shopping, "folders": folders,
        "events": events, "birthdays": bdays, "subs": subs, "dashboard": dashboard,
        "members": members, "settings": settings, "family": family, "zones": zones,
        "subtasks_task": subtasks_task, "subtasks_event": subtasks_event,
        "weather": weather, "categories": categories, "transactions": transactions,
        "tx_items": tx_items,
    }

# ═════════════════════════════════════════════════════════════════════════
# WEATHER
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/weather")
async def weather_endpoint():
    w = await get_weather()
    if not w: return {"error": "unavailable"}
    return w

# ─── Debug & Serve ───────────────────────────────────────────────────────
@app.get("/api/debug/ping")
def ping(): return {"ok": True, "version": "v6.1", "time": datetime.now(ZoneInfo(TIMEZONE)).isoformat()}

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

@app.get("/")
def serve_index():
    r = FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r

@app.get("/static/{fn}")
def serve_static(fn: str):
    import mimetypes
    fp = os.path.join(FRONTEND_DIR, fn)
    if not os.path.isfile(fp): raise HTTPException(404)
    mt = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    r = FileResponse(fp, media_type=mt)
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r
