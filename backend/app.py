"""
🏠 Family HQ v5 — Backend API
"""
import os, sqlite3, hashlib, hmac, json, logging, random, re, time, secrets
from datetime import datetime, timedelta, date
from calendar import monthrange
from urllib.parse import parse_qs
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import httpx

from backend.migrate import migrate, _seed_exercises
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

def _family_weather_coords(db, family_id):
    """Resolve (lat, lon, city) for a family: settings override → env default → Belgrade."""
    row = db.execute(
        "SELECT weather_lat, weather_lon, weather_city FROM settings WHERE family_id=?",
        (family_id,)).fetchone()
    if row and row["weather_lat"] is not None and row["weather_lon"] is not None:
        return float(row["weather_lat"]), float(row["weather_lon"]), (row["weather_city"] or "")
    return WEATHER_LAT, WEATHER_LON, "Belgrade"

async def get_weather(db=None, family_id=None, days=4, force=False):
    """Returns the shaped weather forecast for the frontend.
    Reads the family's saved city if db+family_id are provided, else falls back to env defaults.
    Implementation lives in backend/weather.py (shared with scheduler)."""
    if db is not None and family_id is not None:
        lat, lon, _city = _family_weather_coords(db, family_id)
    else:
        lat, lon = WEATHER_LAT, WEATHER_LON
    return await wx.fetch_shaped(lat, lon, TIMEZONE, days=days, force=force)

# Currency conversion rates to EUR (approximate, editable)
FX = {"EUR": 1.0, "USD": 0.92, "GBP": 1.16, "RUB": 0.0095, "RSD": 0.0085}

def get_db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False); con.row_factory = sqlite3.Row
    try: yield con
    finally: con.close()

def gen_code():
    return "".join(random.choices("ABCDEFGHJKMNPQRSTUVWXYZ23456789", k=6))

# ─── Auth ────────────────────────────────────────────────────────────────
SESSION_TTL = 30 * 86400  # 30 days

def validate_init(data):
    """Validate Telegram Mini App initData. Returns user dict or None."""
    if not data: return None
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

def make_session_token(user_id: int) -> str:
    """Stateless signed session token: <user_id>.<expires>.<sig>"""
    expires = int(time.time()) + SESSION_TTL
    payload = f"{user_id}.{expires}"
    sig = hmac.new(BOT_TOKEN.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}"

def validate_session_token(token: str):
    """Returns user_id (int) if token is valid + not expired, else None."""
    if not token: return None
    try:
        user_id_s, expires_s, sig = token.split(".")
        if int(expires_s) < time.time(): return None
        payload = f"{user_id_s}.{expires_s}"
        expected = hmac.new(BOT_TOKEN.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected): return None
        return int(user_id_s)
    except: return None

def _user_from_session(token: str, db) -> dict | None:
    """Return user dict for a valid session token, regardless of family membership.
    Family-less users land on the onboarding screen where they can join or log out."""
    uid = validate_session_token(token)
    if not uid: return None
    row = db.execute("SELECT user_id, user_name, photo_url FROM family_members WHERE user_id=?", (uid,)).fetchone()
    if row:
        return {"id": row["user_id"], "first_name": row["user_name"], "photo_url": row["photo_url"]}
    # Token is cryptographically valid but user isn't a family member.
    # Return a stub user — frontend will render onboarding (join/create or log out).
    return {"id": uid, "first_name": "User", "photo_url": None}

async def get_user(r: Request, db=Depends(get_db)):
    # 1. Session token (PWA / browser auth via Telegram Login Widget)
    tok = r.headers.get("X-Session-Token", "")
    if tok:
        u = _user_from_session(tok, db)
        if u: return u
        # Token was present but rejected — log why so we can debug
        uid = validate_session_token(tok)
        log.warning(f"Session token rejected: token_uid={uid}, member_exists={bool(uid and db.execute('SELECT 1 FROM family_members WHERE user_id=?', (uid,)).fetchone())}, path={r.url.path}")
    # 2. Telegram Mini App initData
    init = r.headers.get("X-Telegram-Init-Data", "")
    if init:
        u = validate_init(init)
        if u: return u
    # 3. Dev fallback — only when BOT_TOKEN is unconfigured
    if BOT_TOKEN == "YOUR_TOKEN_HERE":
        return {"id": 0, "first_name": "Dev", "photo_url": None}
    log.warning(f"401 no auth: has_token={bool(tok)}, has_init={bool(init)}, path={r.url.path}")
    raise HTTPException(401, "Authentication required")

async def get_uf(r: Request, db=Depends(get_db)):
    u = await get_user(r, db)
    row = db.execute("SELECT family_id, photo_url FROM family_members WHERE user_id=?", (u["id"],)).fetchone()
    if not row: raise HTTPException(404, "Not in a family")
    u["family_id"] = row["family_id"]
    new_photo = u.get("photo_url")
    if new_photo and new_photo != row["photo_url"]:
        db.execute("UPDATE family_members SET photo_url=? WHERE user_id=?", (new_photo, u["id"])); db.commit()
    return u

# ─── Notify ──────────────────────────────────────────────────────────────
async def notify_all(fid, msg, db):
    for m in db.execute("SELECT tg_chat_id FROM family_members WHERE family_id=? AND tg_chat_id IS NOT NULL", (fid,)).fetchall():
        await sched._send(m["tg_chat_id"], msg)

# ─── Generic partial-update helper ───────────────────────────────────────
# Coerce assigned_to / member_id / category_id / folder_id where 0 means "unassigned"
_zero_to_none = lambda v: v if v != 0 else None
_or_none = lambda v: v or None

def _group_by(rows, key):
    """Group sqlite Row objects into {key_value: [dict, ...]}."""
    out = {}
    for r in rows:
        out.setdefault(r[key], []).append(dict(r))
    return out

# ─── Cleaning-zone "dirty" computation (shared by /api/dashboard, /api/cleaning/zones, /api/bundle) ──
def _is_zone_dirty(tasks, today):
    """Is a cleaning zone overdue? Tasks come from `cleaning_tasks` rows (dict)."""
    for t in tasks:
        if not t["done"] and not t.get("last_done"):
            return True
        if t["done"] and t.get("last_done"):
            try:
                if (today - datetime.strptime(t["last_done"], "%Y-%m-%d").date()).days >= (t.get("reset_days") or 7):
                    return True
            except: return True
        elif not t["done"]:
            return True
    return False

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
    theme: str | None = None; custom_theme: str | None = None
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
class EventEdit(BaseModel):
    text: str | None = None; event_date: str | None = None; end_date: str | None = None
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
    weather_lat: float | None = None; weather_lon: float | None = None; weather_city: str | None = None
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
class TelegramLoginPayload(BaseModel):
    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str
class BotLoginComplete(BaseModel):
    code: str
    user_id: int
    first_name: str | None = None
class TxItemCreate(BaseModel):
    name: str; quantity: int = 1; amount: float = 0; currency: str = "RSD"
class TxItemEdit(BaseModel):
    name: str | None = None; quantity: int | None = None; amount: float | None = None; currency: str | None = None
class ExerciseCreate(BaseModel):
    name: str; emoji: str = "💪"; image_url: str | None = None
    muscle_group: str = "other"; description: str | None = None
    rest_seconds: int = 90
class ExerciseEdit(BaseModel):
    name: str | None = None; emoji: str | None = None; image_url: str | None = None
    muscle_group: str | None = None; description: str | None = None
    rest_seconds: int | None = None
class WorkoutCreate(BaseModel):
    date: str; name: str | None = None; member_id: int | None = None; notes: str | None = None
class WorkoutEdit(BaseModel):
    date: str | None = None; name: str | None = None; notes: str | None = None
class WorkoutExerciseCreate(BaseModel):
    exercise_id: int; notes: str | None = None
class WorkoutSetCreate(BaseModel):
    reps: int; weight: float = 0; weight_unit: str = "kg"; notes: str | None = None
class WorkoutSetEdit(BaseModel):
    reps: int | None = None; weight: float | None = None
    weight_unit: str | None = None; notes: str | None = None
class TemplateCreate(BaseModel):
    name: str; member_id: int | None = None; notes: str | None = None
    exercise_ids: list[int] = []
class TemplateEdit(BaseModel):
    name: str | None = None; member_id: int | None = None; notes: str | None = None
    exercise_ids: list[int] | None = None  # if provided, replaces existing list

# ═════════════════════════════════════════════════════════════════════════
# FAMILY
# ═════════════════════════════════════════════════════════════════════════
# ═════════════════════════════════════════════════════════════════════════
# AUTH — Telegram Login Widget (for PWA / browser, outside Telegram)
# ═════════════════════════════════════════════════════════════════════════
_BOT_USERNAME_CACHE = None

@app.get("/api/auth/bot-info")
async def bot_info():
    """Return bot @username so the frontend can embed the Telegram Login Widget."""
    global _BOT_USERNAME_CACHE
    if _BOT_USERNAME_CACHE:
        return {"bot_username": _BOT_USERNAME_CACHE}
    if BOT_TOKEN == "YOUR_TOKEN_HERE":
        return {"bot_username": None}
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getMe")
            data = r.json()
            if data.get("ok"):
                _BOT_USERNAME_CACHE = data["result"]["username"]
                return {"bot_username": _BOT_USERNAME_CACHE}
    except Exception as e:
        log.error(f"getMe failed: {e}")
    return {"bot_username": None}

# ─── Bot-mediated login (alternative to widget; works with any Telegram account) ──
_login_codes = {}  # code → {"user_id": int|None, "first_name": str, "expires": int}

def _cleanup_login_codes():
    now = int(time.time())
    for k in list(_login_codes.keys()):
        if _login_codes[k]["expires"] < now: del _login_codes[k]

@app.post("/api/auth/bot-login-init")
async def bot_login_init():
    """Generate a one-time code. Frontend shows it + deep link; user opens bot, runs
    /start login_<code>; bot calls bot-login-complete; frontend polls bot-login-poll."""
    _cleanup_login_codes()
    code = secrets.token_urlsafe(6)
    _login_codes[code] = {"user_id": None, "first_name": "", "expires": int(time.time()) + 300}
    # Resolve bot username
    bot = _BOT_USERNAME_CACHE
    if not bot and BOT_TOKEN != "YOUR_TOKEN_HERE":
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getMe")
                data = r.json()
                if data.get("ok"):
                    bot = data["result"]["username"]
                    globals()["_BOT_USERNAME_CACHE"] = bot
        except Exception as e:
            log.error(f"getMe in bot-login-init: {e}")
    return {
        "code": code,
        "deep_link": f"https://t.me/{bot}?start=login_{code}" if bot else None,
        "bot_username": bot,
    }

@app.get("/api/auth/bot-login-poll")
def bot_login_poll(code: str):
    """Frontend polls this; returns 'complete' with session token once the bot confirmed."""
    _cleanup_login_codes()
    entry = _login_codes.get(code)
    if not entry: return {"status": "expired"}
    if entry["user_id"] is None: return {"status": "pending"}
    uid = entry["user_id"]
    del _login_codes[code]  # one-time use
    return {"status": "complete", "token": make_session_token(uid), "user_id": uid,
            "first_name": entry.get("first_name", "")}

@app.post("/api/auth/bot-login-complete")
def bot_login_complete(body: BotLoginComplete, r: Request):
    """Called by the bot when the user runs /start login_<code>. Internal auth via BOT_TOKEN."""
    if r.headers.get("X-Internal-Auth") != BOT_TOKEN:
        raise HTTPException(401)
    _cleanup_login_codes()
    entry = _login_codes.get(body.code)
    if not entry: raise HTTPException(404, "code not found or expired")
    entry["user_id"] = body.user_id
    if body.first_name: entry["first_name"] = body.first_name
    return {"ok": True}

@app.post("/api/auth/telegram-login")
def telegram_login(body: TelegramLoginPayload, db=Depends(get_db)):
    """
    Validate a Telegram Login Widget payload per the spec:
    https://core.telegram.org/widgets/login#checking-authorization
    Returns a session token if hash + auth_date are valid.
    """
    if BOT_TOKEN == "YOUR_TOKEN_HERE":
        raise HTTPException(500, "BOT_TOKEN not configured")
    # 1. Verify auth_date is recent (<24h)
    if int(time.time()) - body.auth_date > 86400:
        raise HTTPException(401, "Auth data expired — sign in again")
    # 2. Build data_check_string per Telegram spec
    fields = body.model_dump()
    received_hash = fields.pop("hash")
    pairs = []
    for k in sorted(fields.keys()):
        v = fields[k]
        if v is None: continue
        pairs.append(f"{k}={v}")
    data_check = "\n".join(pairs)
    # 3. Compute expected hash: HMAC-SHA256(data_check) with key=SHA256(bot_token)
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    expected = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(received_hash, expected):
        raise HTTPException(401, "Invalid Telegram signature")
    # 4. Refresh photo_url + first_name in DB if user already exists (member of some family)
    row = db.execute("SELECT user_id, family_id FROM family_members WHERE user_id=?", (body.id,)).fetchone()
    if row:
        if body.photo_url:
            db.execute("UPDATE family_members SET photo_url=? WHERE user_id=?", (body.photo_url, body.id))
        db.commit()
    # 5. Issue session token (works even if user isn't in a family yet — they can join/create after)
    token = make_session_token(body.id)
    return {
        "token": token, "user_id": body.id,
        "first_name": body.first_name, "photo_url": body.photo_url,
        "joined": bool(row),
    }

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
    _seed_exercises(db, fid)
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
    return [dict(r) for r in db.execute("SELECT user_id, user_name, emoji, color, photo_url, theme, custom_theme, learn_mode FROM family_members WHERE family_id=?", (user["family_id"],)).fetchall()]

@app.patch("/api/members/{uid}")
def update_member(uid: int, body: MemberUpdate, user=Depends(get_uf), db=Depends(get_db)):
    if uid != user["id"]: raise HTTPException(403)
    if _update_fields(db, "family_members", "user_id=?", (uid,), body,
                      {"user_name": "user_name", "emoji": "emoji", "color": "color",
                       "theme": "theme", "custom_theme": "custom_theme"}):
        db.commit()
    return {"ok": True}

# ═════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/dashboard")
def dashboard(user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    # Count dirty zones (single query + Python grouping — no N+1)
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    zones_all = db.execute("SELECT id FROM cleaning_zones WHERE family_id=?", (f,)).fetchall()
    by_zone = _group_by(db.execute(
        "SELECT zone_id, done, last_done, reset_days FROM cleaning_tasks WHERE family_id=?", (f,)).fetchall(),
        "zone_id")
    cleaning_dirty = sum(1 for z in zones_all if _is_zone_dirty(by_zone.get(z["id"], []), today))
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

@app.put("/api/events/{eid}")
def edit_event(eid: int, body: EventEdit, user=Depends(get_uf), db=Depends(get_db)):
    sets, vals = [], []
    for f in ("text", "event_date", "end_date"):
        v = getattr(body, f)
        if v is not None or f == "end_date":
            sets.append(f + "=?"); vals.append(v)
    if not sets: return {"ok": True}
    vals += [eid, user["family_id"]]
    db.execute("UPDATE events SET " + ",".join(sets) + " WHERE id=? AND family_id=?", vals); db.commit()
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
    f = user["family_id"]
    zones = [dict(r) for r in db.execute("SELECT * FROM cleaning_zones WHERE family_id=? ORDER BY sort_order", (f,)).fetchall()]
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    # Single query each, group in Python (no N+1)
    by_zone_tasks = _group_by(db.execute("SELECT * FROM cleaning_tasks WHERE family_id=? ORDER BY zone_id, id", (f,)).fetchall(), "zone_id")
    by_zone_rems = _group_by(db.execute("SELECT id, zone_id, remind_at, sent FROM zone_reminders WHERE family_id=?", (f,)).fetchall(), "zone_id")
    for z in zones:
        z["tasks"] = by_zone_tasks.get(z["id"], [])
        z["reminders"] = by_zone_rems.get(z["id"], [])
        z["dirty"] = _is_zone_dirty(z["tasks"], today)
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
    # Theme is per-member (each user picks their own)
    if body.theme: db.execute("UPDATE family_members SET theme=? WHERE user_id=?", (body.theme, user["id"]))
    # Digest settings are family-wide
    if body.digest_time: db.execute("UPDATE settings SET digest_time=? WHERE family_id=?", (body.digest_time, user["family_id"]))
    if body.digest_sections is not None: db.execute("UPDATE settings SET digest_sections=? WHERE family_id=?", (body.digest_sections, user["family_id"]))
    # Weather location (lat+lon+display name). Setting any one updates that field.
    if body.weather_lat is not None: db.execute("UPDATE settings SET weather_lat=? WHERE family_id=?", (body.weather_lat, user["family_id"]))
    if body.weather_lon is not None: db.execute("UPDATE settings SET weather_lon=? WHERE family_id=?", (body.weather_lon, user["family_id"]))
    if body.weather_city is not None: db.execute("UPDATE settings SET weather_city=? WHERE family_id=?", (body.weather_city, user["family_id"]))
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

# ═════════════════════════════════════════════════════════════════════════
# TRAININGS — exercises catalog + workouts + sets
# ═════════════════════════════════════════════════════════════════════════
def _workout_summary_row(db, fid, wid):
    """Return tonnage + sets count for a single workout."""
    r = db.execute("""
        SELECT COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
               COUNT(ws.id) AS sets,
               COUNT(DISTINCT wx.id) AS exercises
        FROM workouts w
        LEFT JOIN workout_exercises wx ON wx.workout_id = w.id
        LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
        WHERE w.id = ? AND w.family_id = ?
    """, (wid, fid)).fetchone()
    return {"tonnage": round(r["tonnage"] or 0, 2), "sets": r["sets"] or 0, "exercises": r["exercises"] or 0}

@app.get("/api/exercises")
def list_exercises(user=Depends(get_uf), db=Depends(get_db)):
    return [dict(r) for r in db.execute(
        "SELECT * FROM exercises WHERE family_id=? ORDER BY muscle_group, name",
        (user["family_id"],)).fetchall()]

@app.post("/api/exercises")
def create_exercise(body: ExerciseCreate, user=Depends(get_uf), db=Depends(get_db)):
    eid = db.execute(
        "INSERT INTO exercises (family_id,name,emoji,image_url,muscle_group,description,rest_seconds) VALUES (?,?,?,?,?,?,?)",
        (user["family_id"], body.name, body.emoji, body.image_url, body.muscle_group, body.description, body.rest_seconds)).lastrowid
    db.commit()
    return {"id": eid}

@app.put("/api/exercises/{eid}")
def edit_exercise(eid: int, body: ExerciseEdit, user=Depends(get_uf), db=Depends(get_db)):
    if _update_fields(db, "exercises", "id=? AND family_id=?", (eid, user["family_id"]), body, {
        "name": "name", "emoji": "emoji", "image_url": "image_url",
        "muscle_group": "muscle_group", "description": "description",
        "rest_seconds": "rest_seconds",
    }):
        db.commit()
    return {"ok": True}

@app.delete("/api/exercises/{eid}")
def del_exercise(eid: int, user=Depends(get_uf), db=Depends(get_db)):
    used = db.execute("SELECT 1 FROM workout_exercises WHERE exercise_id=? LIMIT 1", (eid,)).fetchone()
    if used:
        raise HTTPException(400, "Exercise is used in workouts; remove those first")
    db.execute("DELETE FROM exercises WHERE id=? AND family_id=?", (eid, user["family_id"]))
    db.commit()
    return {"ok": True}

@app.get("/api/workouts")
def list_workouts(member_id: int | None = None, frm: str | None = None, to: str | None = None,
                  user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    where = ["w.family_id=?"]; params = [f]
    if member_id: where.append("w.member_id=?"); params.append(member_id)
    if frm: where.append("w.date>=?"); params.append(frm)
    if to: where.append("w.date<=?"); params.append(to)
    rows = db.execute(f"""
        SELECT w.id, w.date, w.name, w.member_id, w.notes,
               COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
               COUNT(DISTINCT wx.id) AS exercises,
               COUNT(ws.id) AS sets
        FROM workouts w
        LEFT JOIN workout_exercises wx ON wx.workout_id = w.id
        LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
        WHERE {' AND '.join(where)}
        GROUP BY w.id ORDER BY w.date DESC, w.id DESC
    """, params).fetchall()
    return [dict(r) | {"tonnage": round(r["tonnage"] or 0, 2)} for r in rows]

@app.get("/api/workouts/{wid}")
def get_workout(wid: int, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    w = db.execute("SELECT * FROM workouts WHERE id=? AND family_id=?", (wid, f)).fetchone()
    if not w: raise HTTPException(404)
    workout = dict(w)
    workout.update(_workout_summary_row(db, f, wid))
    # Load all exercises in this workout, then their sets
    wxs = [dict(r) for r in db.execute("""
        SELECT wx.id, wx.exercise_id, wx.sort_order, wx.notes,
               e.name, e.emoji, e.image_url, e.muscle_group, e.rest_seconds
        FROM workout_exercises wx JOIN exercises e ON e.id = wx.exercise_id
        WHERE wx.workout_id = ? ORDER BY wx.sort_order, wx.id
    """, (wid,)).fetchall()]
    sets_by_wx = _group_by(db.execute("""
        SELECT ws.* FROM workout_sets ws
        JOIN workout_exercises wx ON wx.id = ws.workout_exercise_id
        WHERE wx.workout_id = ? ORDER BY ws.workout_exercise_id, ws.set_number
    """, (wid,)).fetchall(), "workout_exercise_id")
    # last_session per exercise — most recent set from a *prior* workout of the same member
    last_session = {}
    if wxs:
        ex_ids = list({wx["exercise_id"] for wx in wxs})
        rows = db.execute(f"""
            SELECT exercise_id, reps, weight, weight_unit, date FROM (
                SELECT wx.exercise_id, ws.reps, ws.weight, ws.weight_unit, w.date,
                       ROW_NUMBER() OVER (PARTITION BY wx.exercise_id
                                          ORDER BY w.date DESC, ws.set_number DESC) AS rn
                FROM workout_sets ws
                JOIN workout_exercises wx ON wx.id = ws.workout_exercise_id
                JOIN workouts w ON w.id = wx.workout_id
                WHERE w.family_id=? AND w.member_id=? AND w.id<>?
                  AND wx.exercise_id IN ({','.join('?'*len(ex_ids))})
            ) WHERE rn = 1
        """, [f, w["member_id"], wid] + ex_ids).fetchall()
        for r in rows:
            last_session[r["exercise_id"]] = {"reps": r["reps"], "weight": r["weight"],
                                               "weight_unit": r["weight_unit"], "date": r["date"]}
    for wx in wxs:
        sets = sets_by_wx.get(wx["id"], [])
        wx["sets"] = sets
        wx["tonnage"] = round(sum(s["reps"] * s["weight"] for s in sets), 2)
        wx["last_session"] = last_session.get(wx["exercise_id"])
    workout["exercises_list"] = wxs
    return workout

@app.get("/api/exercises/{eid}/progression")
def exercise_progression(eid: int, member_id: int | None = None, limit: int = 20,
                          user=Depends(get_uf), db=Depends(get_db)):
    """Per-exercise progression: top set per workout for the last N workouts."""
    f = user["family_id"]
    ex = db.execute("SELECT * FROM exercises WHERE id=? AND family_id=?", (eid, f)).fetchone()
    if not ex: raise HTTPException(404)
    where_member = "AND w.member_id=?" if member_id else ""
    params = [f, eid]
    if member_id: params.append(member_id)
    params.append(limit)
    rows = db.execute(f"""
        SELECT w.id AS workout_id, w.date, w.member_id,
               COALESCE(MAX(ws.weight), 0) AS top_weight,
               COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
               COUNT(ws.id) AS sets,
               COALESCE(MAX(ws.weight * 36.0 / NULLIF(37 - ws.reps, 0)), 0) AS one_rm_est
        FROM workouts w
        JOIN workout_exercises wx ON wx.workout_id=w.id
        LEFT JOIN workout_sets ws ON ws.workout_exercise_id=wx.id
        WHERE w.family_id=? AND wx.exercise_id=? {where_member}
        GROUP BY w.id HAVING COUNT(ws.id) > 0
        ORDER BY w.date DESC LIMIT ?
    """, params).fetchall()
    points = [dict(r) | {
        "top_weight": round(r["top_weight"] or 0, 1),
        "tonnage": round(r["tonnage"] or 0, 2),
        "one_rm_est": round(r["one_rm_est"] or 0, 1),
    } for r in rows]
    points.reverse()  # oldest → newest for chart
    return {"exercise": dict(ex), "points": points}

@app.post("/api/workouts")
def create_workout(body: WorkoutCreate, user=Depends(get_uf), db=Depends(get_db)):
    mid = body.member_id or user["id"]
    # One-workout-per-member-per-day enforcement (return existing if any)
    existing = db.execute("SELECT id FROM workouts WHERE family_id=? AND member_id=? AND date=?",
                           (user["family_id"], mid, body.date)).fetchone()
    if existing:
        return {"id": existing["id"], "existing": True}
    wid = db.execute("INSERT INTO workouts (family_id,member_id,date,name,notes) VALUES (?,?,?,?,?)",
                      (user["family_id"], mid, body.date, body.name, body.notes)).lastrowid
    db.commit()
    return {"id": wid, "existing": False}

@app.put("/api/workouts/{wid}")
def edit_workout(wid: int, body: WorkoutEdit, user=Depends(get_uf), db=Depends(get_db)):
    if _update_fields(db, "workouts", "id=? AND family_id=?", (wid, user["family_id"]), body,
                       {"date": "date", "name": "name", "notes": "notes"}):
        db.commit()
    return {"ok": True}

@app.delete("/api/workouts/{wid}")
def del_workout(wid: int, user=Depends(get_uf), db=Depends(get_db)):
    # Cascade
    db.execute("""DELETE FROM workout_sets WHERE workout_exercise_id IN
                   (SELECT id FROM workout_exercises WHERE workout_id=?)""", (wid,))
    db.execute("DELETE FROM workout_exercises WHERE workout_id=?", (wid,))
    db.execute("DELETE FROM workouts WHERE id=? AND family_id=?", (wid, user["family_id"]))
    db.commit()
    return {"ok": True}

@app.post("/api/workouts/{wid}/exercises")
def add_workout_exercise(wid: int, body: WorkoutExerciseCreate, user=Depends(get_uf), db=Depends(get_db)):
    # Verify ownership
    if not db.execute("SELECT 1 FROM workouts WHERE id=? AND family_id=?", (wid, user["family_id"])).fetchone():
        raise HTTPException(404)
    mx = db.execute("SELECT COALESCE(MAX(sort_order),0) m FROM workout_exercises WHERE workout_id=?",
                     (wid,)).fetchone()["m"]
    wxid = db.execute("INSERT INTO workout_exercises (workout_id,exercise_id,sort_order,notes) VALUES (?,?,?,?)",
                       (wid, body.exercise_id, mx + 1, body.notes)).lastrowid
    db.commit()
    return {"id": wxid}

@app.delete("/api/workout-exercises/{wxid}")
def del_workout_exercise(wxid: int, user=Depends(get_uf), db=Depends(get_db)):
    # Verify ownership via join
    own = db.execute("""SELECT 1 FROM workout_exercises wx
                       JOIN workouts w ON w.id = wx.workout_id
                       WHERE wx.id=? AND w.family_id=?""", (wxid, user["family_id"])).fetchone()
    if not own: raise HTTPException(404)
    db.execute("DELETE FROM workout_sets WHERE workout_exercise_id=?", (wxid,))
    db.execute("DELETE FROM workout_exercises WHERE id=?", (wxid,))
    db.commit()
    return {"ok": True}

@app.post("/api/workout-exercises/{wxid}/sets")
def add_set(wxid: int, body: WorkoutSetCreate, user=Depends(get_uf), db=Depends(get_db)):
    own = db.execute("""SELECT 1 FROM workout_exercises wx
                       JOIN workouts w ON w.id = wx.workout_id
                       WHERE wx.id=? AND w.family_id=?""", (wxid, user["family_id"])).fetchone()
    if not own: raise HTTPException(404)
    n = db.execute("SELECT COALESCE(MAX(set_number),0)+1 AS n FROM workout_sets WHERE workout_exercise_id=?",
                    (wxid,)).fetchone()["n"]
    sid = db.execute("INSERT INTO workout_sets (workout_exercise_id,set_number,reps,weight,weight_unit,notes) VALUES (?,?,?,?,?,?)",
                      (wxid, n, body.reps, body.weight, body.weight_unit, body.notes)).lastrowid
    db.commit()
    return {"id": sid, "set_number": n}

@app.put("/api/workout-sets/{sid}")
def edit_set(sid: int, body: WorkoutSetEdit, user=Depends(get_uf), db=Depends(get_db)):
    own = db.execute("""SELECT 1 FROM workout_sets ws
                       JOIN workout_exercises wx ON wx.id = ws.workout_exercise_id
                       JOIN workouts w ON w.id = wx.workout_id
                       WHERE ws.id=? AND w.family_id=?""", (sid, user["family_id"])).fetchone()
    if not own: raise HTTPException(404)
    if _update_fields(db, "workout_sets", "id=?", (sid,), body, {
        "reps": "reps", "weight": "weight", "weight_unit": "weight_unit", "notes": "notes",
    }):
        db.commit()
    return {"ok": True}

@app.delete("/api/workout-sets/{sid}")
def del_set(sid: int, user=Depends(get_uf), db=Depends(get_db)):
    own = db.execute("""SELECT 1 FROM workout_sets ws
                       JOIN workout_exercises wx ON wx.id = ws.workout_exercise_id
                       JOIN workouts w ON w.id = wx.workout_id
                       WHERE ws.id=? AND w.family_id=?""", (sid, user["family_id"])).fetchone()
    if not own: raise HTTPException(404)
    db.execute("DELETE FROM workout_sets WHERE id=?", (sid,))
    db.commit()
    return {"ok": True}

# ─── Workout templates ────────────────────────────────────────────────────
@app.get("/api/workout-templates")
def list_templates(member_id: int | None = None, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    where = "family_id=?"
    params = [f]
    if member_id is not None:
        where += " AND (member_id=? OR member_id IS NULL)"
        params.append(member_id)
    templates = [dict(r) for r in db.execute(
        f"SELECT * FROM workout_templates WHERE {where} ORDER BY created_at DESC", params).fetchall()]
    # Attach exercises for each template (single grouped query)
    if templates:
        ids = [t["id"] for t in templates]
        rows = db.execute(f"""
            SELECT te.id, te.template_id, te.exercise_id, te.sort_order, te.notes,
                   e.name, e.emoji, e.image_url, e.muscle_group, e.rest_seconds
            FROM template_exercises te JOIN exercises e ON e.id=te.exercise_id
            WHERE te.template_id IN ({','.join('?'*len(ids))})
            ORDER BY te.template_id, te.sort_order, te.id
        """, ids).fetchall()
        by_t = _group_by(rows, "template_id")
        for t in templates:
            t["exercises_list"] = by_t.get(t["id"], [])
    return templates

@app.post("/api/workout-templates")
def create_template(body: TemplateCreate, user=Depends(get_uf), db=Depends(get_db)):
    tid = db.execute(
        "INSERT INTO workout_templates (family_id,member_id,name,notes) VALUES (?,?,?,?)",
        (user["family_id"], body.member_id, body.name, body.notes)).lastrowid
    for i, eid in enumerate(body.exercise_ids):
        db.execute("INSERT INTO template_exercises (template_id,exercise_id,sort_order) VALUES (?,?,?)",
                    (tid, eid, i))
    db.commit()
    return {"id": tid}

@app.put("/api/workout-templates/{tid}")
def edit_template(tid: int, body: TemplateEdit, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    if not db.execute("SELECT 1 FROM workout_templates WHERE id=? AND family_id=?", (tid, f)).fetchone():
        raise HTTPException(404)
    _update_fields(db, "workout_templates", "id=? AND family_id=?", (tid, f), body, {
        "name": "name", "member_id": "member_id", "notes": "notes",
    })
    if body.exercise_ids is not None:
        db.execute("DELETE FROM template_exercises WHERE template_id=?", (tid,))
        for i, eid in enumerate(body.exercise_ids):
            db.execute("INSERT INTO template_exercises (template_id,exercise_id,sort_order) VALUES (?,?,?)",
                        (tid, eid, i))
    db.commit()
    return {"ok": True}

@app.delete("/api/workout-templates/{tid}")
def del_template(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    if not db.execute("SELECT 1 FROM workout_templates WHERE id=? AND family_id=?", (tid, user["family_id"])).fetchone():
        raise HTTPException(404)
    db.execute("DELETE FROM template_exercises WHERE template_id=?", (tid,))
    db.execute("DELETE FROM workout_templates WHERE id=?", (tid,))
    db.commit()
    return {"ok": True}

@app.post("/api/workout-templates/{tid}/start")
def start_workout_from_template(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Create a fresh workout from template, copying exercises (no sets), set started_at=now."""
    f = user["family_id"]
    t = db.execute("SELECT * FROM workout_templates WHERE id=? AND family_id=?", (tid, f)).fetchone()
    if not t: raise HTTPException(404)
    today = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d")
    now_iso = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    # Reuse existing workout for today if any (idempotent)
    existing = db.execute("SELECT id FROM workouts WHERE family_id=? AND member_id=? AND date=?",
                          (f, user["id"], today)).fetchone()
    if existing:
        # Set started_at if not already started
        db.execute("UPDATE workouts SET started_at=COALESCE(started_at, ?) WHERE id=?",
                    (now_iso, existing["id"]))
        db.commit()
        return {"id": existing["id"], "existing": True}
    wid = db.execute(
        "INSERT INTO workouts (family_id,member_id,date,name,started_at) VALUES (?,?,?,?,?)",
        (f, user["id"], today, t["name"], now_iso)).lastrowid
    # Copy template_exercises into workout_exercises (preserving order, no sets)
    for i, te in enumerate(db.execute(
        "SELECT exercise_id, notes FROM template_exercises WHERE template_id=? ORDER BY sort_order, id",
        (tid,)).fetchall()):
        db.execute(
            "INSERT INTO workout_exercises (workout_id,exercise_id,sort_order,notes) VALUES (?,?,?,?)",
            (wid, te["exercise_id"], i, te["notes"]))
    db.commit()
    return {"id": wid, "existing": False}

@app.post("/api/workouts/{wid}/start")
def start_workout(wid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Mark a workout as started (sets started_at if null). For ad-hoc workouts."""
    if not db.execute("SELECT 1 FROM workouts WHERE id=? AND family_id=?", (wid, user["family_id"])).fetchone():
        raise HTTPException(404)
    now_iso = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    db.execute("UPDATE workouts SET started_at=COALESCE(started_at, ?) WHERE id=?", (now_iso, wid))
    db.commit()
    return {"ok": True, "started_at": now_iso}

@app.post("/api/workouts/{wid}/finish")
def finish_workout(wid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Mark a workout as finished. Returns summary."""
    f = user["family_id"]
    if not db.execute("SELECT 1 FROM workouts WHERE id=? AND family_id=?", (wid, f)).fetchone():
        raise HTTPException(404)
    now_iso = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    db.execute("UPDATE workouts SET finished_at=? WHERE id=?", (now_iso, wid))
    db.commit()
    summary = _workout_summary_row(db, f, wid)
    return {"ok": True, "finished_at": now_iso, **summary}

@app.get("/api/trainings/stats")
def trainings_stats(member_id: int | None = None, user=Depends(get_uf), db=Depends(get_db)):
    """Tonnage today/week/month + last 8 weeks bar chart + top 5 exercises + PRs.
    If member_id is None, returns family aggregates."""
    f = user["family_id"]
    now = datetime.now(ZoneInfo(TIMEZONE))
    today = now.date()
    week_start = today - timedelta(days=today.weekday())  # Monday
    month_start = today.replace(day=1)

    where_member = "AND w.member_id=?" if member_id else ""
    params_member = [member_id] if member_id else []

    def _ton(date_from):
        r = db.execute(f"""
            SELECT COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
                   COUNT(DISTINCT w.id) AS workouts,
                   COUNT(ws.id) AS sets
            FROM workouts w
            LEFT JOIN workout_exercises wx ON wx.workout_id = w.id
            LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
            WHERE w.family_id=? AND w.date>=? {where_member}
        """, [f, date_from] + params_member).fetchone()
        return {"tonnage": round(r["tonnage"] or 0, 2), "workouts": r["workouts"] or 0, "sets": r["sets"] or 0}

    today_stats = _ton(today.isoformat())
    week_stats = _ton(week_start.isoformat())
    month_stats = _ton(month_start.isoformat())

    # Last 8 weeks weekly tonnage bars
    weeks = []
    for i in range(7, -1, -1):
        ws = week_start - timedelta(weeks=i)
        we = ws + timedelta(days=6)
        r = db.execute(f"""
            SELECT COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage
            FROM workouts w
            LEFT JOIN workout_exercises wx ON wx.workout_id = w.id
            LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
            WHERE w.family_id=? AND w.date>=? AND w.date<=? {where_member}
        """, [f, ws.isoformat(), we.isoformat()] + params_member).fetchone()
        weeks.append({"week_start": ws.isoformat(), "tonnage": round(r["tonnage"] or 0, 2)})

    # Top 5 exercises by total tonnage this month
    top = db.execute(f"""
        SELECT e.id, e.name, e.emoji,
               COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
               COUNT(DISTINCT w.id) AS sessions
        FROM exercises e
        JOIN workout_exercises wx ON wx.exercise_id = e.id
        JOIN workouts w ON w.id = wx.workout_id
        LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
        WHERE e.family_id=? AND w.date>=? {where_member}
        GROUP BY e.id ORDER BY tonnage DESC LIMIT 5
    """, [f, month_start.isoformat()] + params_member).fetchall()
    top_exercises = [dict(r) | {"tonnage": round(r["tonnage"] or 0, 2)} for r in top]

    # Personal records — heaviest single set per exercise (for member or family)
    prs = db.execute(f"""
        SELECT e.name, e.emoji, ws.reps, ws.weight, w.date
        FROM workout_sets ws
        JOIN workout_exercises wx ON wx.id = ws.workout_exercise_id
        JOIN workouts w ON w.id = wx.workout_id
        JOIN exercises e ON e.id = wx.exercise_id
        WHERE w.family_id=? {where_member}
            AND ws.weight = (
                SELECT MAX(ws2.weight) FROM workout_sets ws2
                JOIN workout_exercises wx2 ON wx2.id = ws2.workout_exercise_id
                JOIN workouts w2 ON w2.id = wx2.workout_id
                WHERE wx2.exercise_id = wx.exercise_id AND w2.family_id = w.family_id
                {where_member.replace('w.', 'w2.')}
            )
        GROUP BY e.id ORDER BY ws.weight DESC LIMIT 10
    """, [f] + params_member + params_member).fetchall()
    personal_records = [dict(r) for r in prs]

    return {
        "member_id": member_id,
        "today": today_stats, "week": week_stats, "month": month_stats,
        "weeks": weeks, "top_exercises": top_exercises, "personal_records": personal_records,
    }

# Calendar — month view items
@app.get("/api/calendar")
def calendar_items(month: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    now = datetime.now(ZoneInfo(TIMEZONE))
    cur = now.strftime("%Y-%m")
    sel = cur
    if month and re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        sel = month
    y, m = int(sel[:4]), int(sel[5:7])
    # Visible range: first Monday ≤ 1st of month, last Sunday ≥ last of month
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
            items.append({"id": r["id"], "type": "birthday", "title": r["name"], "start": this_year, "end": this_year, "color": "wn"})

    # Recurring tasks — expand rrule into occurrences within visible range
    day_map = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
    for r in db.execute("SELECT id,text,rrule,assigned_to FROM recurring_tasks WHERE family_id=? AND active=1", (f,)).fetchall():
        rrule = r["rrule"]
        d = vis_start
        while d <= vis_end:
            match = False
            if rrule == "daily":
                match = True
            elif rrule.startswith("weekly:"):
                days = rrule.split(":")[1].split(",")
                match = d.weekday() in [day_map.get(x.strip(), -1) for x in days]
            elif rrule.startswith("monthly:"):
                try:
                    match = d.day == int(rrule.split(":")[1])
                except:
                    pass
            if match:
                ds = d.isoformat()
                items.append({"id": r["id"], "type": "recurring", "title": r["text"], "start": ds, "end": ds,
                               "color": "ac", "assigned_to": r["assigned_to"], "done": False})
            d += timedelta(days=1)

    # Subscriptions — billing_day mapped to each month in visible range
    for r in db.execute("SELECT id,name,emoji,amount,currency,billing_day FROM subscriptions WHERE family_id=?", (f,)).fetchall():
        bd = r["billing_day"] or 1
        # Check each month in visible range
        for check_y, check_m in set([(vis_start.year, vis_start.month), (y, m), (vis_end.year, vis_end.month)]):
            _, mx = monthrange(check_y, check_m)
            day = min(bd, mx)
            ds = f"{check_y}-{check_m:02d}-{day:02d}"
            if vs <= ds <= ve:
                items.append({"id": r["id"], "type": "subscription", "title": r["name"], "start": ds, "end": ds,
                               "color": "sub", "amount": r["amount"], "currency": r["currency"]})

    return {"month": sel, "vis_start": vs, "vis_end": ve, "items": items}

# ═════════════════════════════════════════════════════════════════════════
# BUNDLE (all data in one request)
# ═════════════════════════════════════════════════════════════════════════
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

    # Members (include theme + custom_theme + learn_mode so frontend can apply per-member appearance)
    members = [dict(m) for m in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url, theme, custom_theme, learn_mode FROM family_members WHERE family_id=?",
        (f,)).fetchall()]

    # Settings
    srow = db.execute("SELECT * FROM settings WHERE family_id=?", (f,)).fetchone()
    if not srow:
        db.execute("INSERT INTO settings (family_id) VALUES (?)", (f,))
        db.commit()
        settings = {"family_id": f, "theme": "midnight", "digest_time": "09:00"}
    else:
        settings = dict(srow)
    # Per-member theme override (theme is per-user, not family-shared)
    m_theme_row = db.execute("SELECT theme FROM family_members WHERE user_id=?", (user["id"],)).fetchone()
    if m_theme_row and m_theme_row["theme"]:
        settings["theme"] = m_theme_row["theme"]
    elif not settings.get("theme"):
        settings["theme"] = "midnight"

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
        z["dirty"] = _is_zone_dirty(z["tasks"], today)
        if z["dirty"]:
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

    # Weather (cached + retried inside weather.py). Uses family's saved city if set.
    weather = await get_weather(db=db, family_id=f, days=4)
    # Attach city name so frontend can show it under the temperature
    if weather:
        _, _, _city = _family_weather_coords(db, f)
        weather["city"] = _city or "Belgrade"

    # Trainings — exercise catalog + recent workouts (last 14 days, summary only) + templates
    exercises = [dict(r) for r in db.execute(
        "SELECT * FROM exercises WHERE family_id=? ORDER BY muscle_group, name", (f,)).fetchall()]
    recent_cutoff = (today - timedelta(days=14)).isoformat()
    recent_workouts = [dict(r) | {"tonnage": round(r["tonnage"] or 0, 2)} for r in db.execute("""
        SELECT w.id, w.date, w.name, w.member_id, w.notes, w.started_at, w.finished_at,
               COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
               COUNT(DISTINCT wx.id) AS exercises,
               COUNT(ws.id) AS sets
        FROM workouts w
        LEFT JOIN workout_exercises wx ON wx.workout_id = w.id
        LEFT JOIN workout_sets ws ON ws.workout_exercise_id = wx.id
        WHERE w.family_id=? AND w.date >= ?
        GROUP BY w.id ORDER BY w.date DESC, w.id DESC
    """, (f, recent_cutoff)).fetchall()]
    workout_templates = [dict(r) for r in db.execute(
        "SELECT * FROM workout_templates WHERE family_id=? ORDER BY created_at DESC", (f,)).fetchall()]
    if workout_templates:
        ids = [t["id"] for t in workout_templates]
        rows = db.execute(f"""
            SELECT te.template_id, te.exercise_id, te.sort_order,
                   e.name, e.emoji, e.muscle_group
            FROM template_exercises te JOIN exercises e ON e.id=te.exercise_id
            WHERE te.template_id IN ({','.join('?'*len(ids))})
            ORDER BY te.template_id, te.sort_order, te.id
        """, ids).fetchall()
        by_t = _group_by(rows, "template_id")
        for t in workout_templates:
            t["exercises_list"] = by_t.get(t["id"], [])

    return {
        "tasks": tasks, "recurring": recurring, "shopping": shopping, "folders": folders,
        "events": events, "birthdays": bdays, "subs": subs, "dashboard": dashboard,
        "members": members, "settings": settings, "family": family, "zones": zones,
        "subtasks_task": subtasks_task, "subtasks_event": subtasks_event,
        "weather": weather, "categories": categories, "transactions": transactions,
        "tx_items": tx_items,
        "exercises": exercises, "recent_workouts": recent_workouts,
        "workout_templates": workout_templates,
    }

# ═════════════════════════════════════════════════════════════════════════
# WEATHER
# ═════════════════════════════════════════════════════════════════════════
@app.get("/api/weather")
async def weather_endpoint(refresh: int = 0, user=Depends(get_uf), db=Depends(get_db)):
    """Current + short forecast (4 days). Pass ?refresh=1 to bypass cache."""
    w = await get_weather(db=db, family_id=user["family_id"], days=4, force=bool(refresh))
    if not w: return {"error": "unavailable"}
    _, _, _city = _family_weather_coords(db, user["family_id"])
    w["city"] = _city or "Belgrade"
    return w

@app.get("/api/weather/forecast")
async def weather_forecast(days: int = 14, refresh: int = 0, user=Depends(get_uf), db=Depends(get_db)):
    """Extended daily forecast (up to 16 days). Used by the full forecast page."""
    days = max(1, min(int(days), 16))
    w = await get_weather(db=db, family_id=user["family_id"], days=days, force=bool(refresh))
    if not w: return {"error": "unavailable"}
    lat, lon, _city = _family_weather_coords(db, user["family_id"])
    w["city"] = _city or "Belgrade"
    w["lat"] = lat; w["lon"] = lon
    return w

@app.get("/api/weather/geocode")
async def weather_geocode(q: str = "", user=Depends(get_uf)):
    """Search city by name. Returns list of {name, country, admin1, lat, lon}."""
    results = await wx.geocode(q)
    return {"results": results}

# ═════════════════════════════════════════════════════════════════════════
# VOCABULARY — word learning (study sessions, per-member progress)
# ═════════════════════════════════════════════════════════════════════════
from backend.words_of_day import WORDS as _STATIC_VOCAB
import unicodedata as _ucd

# Custom words (added via bot) live in custom_words table with idx >= 10000.
# Static catalog occupies idx 0..len(_STATIC_VOCAB)-1. The 10000 gap lets us grow
# the static list without colliding with progress records that reference custom idx.
_CUSTOM_IDX_BASE = 10000

def _word_get(idx, db):
    """Return word dict for any idx, or None. Static words may be overridden via word_overrides."""
    if 0 <= idx < len(_STATIC_VOCAB):
        ov = db.execute("SELECT * FROM word_overrides WHERE idx=?", (idx,)).fetchone()
        if ov:
            # Override row may have NULL columns — fall back to static for those.
            base = dict(_STATIC_VOCAB[idx])
            for k in ("en_word", "ru_word", "en_ipa", "ru_ipa", "en_def", "ru_def", "en_example", "ru_example", "emoji"):
                v = ov[k] if k in ov.keys() else None
                if v is not None and v != "":
                    base[k] = v
            return base
        return _STATIC_VOCAB[idx]
    if idx >= _CUSTOM_IDX_BASE:
        row = db.execute("SELECT * FROM custom_words WHERE idx=? AND status='active'", (idx,)).fetchone()
        return dict(row) if row else None
    return None

def _word_indices(db):
    """Return list of all active word indices: static 0..N-1 then sorted custom."""
    rows = db.execute("SELECT idx FROM custom_words WHERE status='active' ORDER BY idx").fetchall()
    return list(range(len(_STATIC_VOCAB))) + [r["idx"] for r in rows]

def _word_count(db):
    """Total active words across static + custom catalogs."""
    n = db.execute("SELECT COUNT(*) AS n FROM custom_words WHERE status='active'").fetchone()
    return len(_STATIC_VOCAB) + (n["n"] if n else 0)

def _strip_accent(s):
    """Strip combining marks (e.g. U+0301 acute) so user input can match stress-marked word."""
    return "".join(c for c in _ucd.normalize("NFD", s or "") if not _ucd.combining(c))

import re as _wre
def _img_key(en_word: str) -> str:
    """Normalize en_word to a safe filename key.
    'Ice Cream' → 'ice_cream', "Don't" → 'dont'. Used as image filename (no extension).
    Stable: lowercase, alnum+underscore only, hyphens/spaces→underscore."""
    if not en_word: return ""
    s = en_word.lower().strip()
    s = _wre.sub(r"[\s\-]+", "_", s)
    s = _wre.sub(r"[^a-z0-9_]", "", s)
    return s

def _word_view(idx, mode, w, prog=None):
    """Build the card payload for a single word in a given learning mode. Caller provides `w`.
    mode='en' → user is learning English: card shows Russian source, user types English.
    mode='ru' → user is learning Russian: card shows English source, user types Russian."""
    if mode == "en":
        return {
            "idx": idx,
            "source_word": w["ru_word"], "source_ipa": w.get("ru_ipa", ""),
            "source_def": w["ru_def"], "source_example": w.get("ru_example", ""),
            "target_word": w["en_word"], "target_ipa": w.get("en_ipa", ""),
            "target_def": w["en_def"], "target_example": w.get("en_example", ""),
            "emoji": w.get("emoji", "📖"),
            "image_key": _img_key(w.get("en_word", "")),
            "status": (prog or {}).get("status", "new"),
            "attempts": (prog or {}).get("attempts", 0),
        }
    return {
        "idx": idx,
        "source_word": w["en_word"], "source_ipa": w.get("en_ipa", ""),
        "source_def": w["en_def"], "source_example": w.get("en_example", ""),
        "target_word": w["ru_word"], "target_ipa": w.get("ru_ipa", ""),
        "target_def": w["ru_def"], "target_example": w.get("ru_example", ""),
        "emoji": w.get("emoji", "📖"),
        "image_key": _img_key(w.get("en_word", "")),
        "status": (prog or {}).get("status", "new"),
        "attempts": (prog or {}).get("attempts", 0),
    }

@app.get("/api/words/study")
def words_study(mode: str = "en", limit: int = 10, user=Depends(get_uf), db=Depends(get_db)):
    """Returns a batch for the current learning session.
    Strategy: prioritise 'learning' (failed-before) words, fill with 'new' (never-seen), then 'learned' for review."""
    uid = user["id"]
    rows = {r["word_idx"]: dict(r) for r in db.execute(
        "SELECT word_idx, status, attempts, correct_count, last_seen FROM word_progress WHERE user_id=? AND mode=?",
        (uid, mode)).fetchall()}
    # Bucket all word indices (static + custom-active)
    all_idx = _word_indices(db)
    total = len(all_idx)
    learning, new, learned = [], [], []
    for i in all_idx:
        st = rows.get(i, {}).get("status", "new")
        if st == "learning": learning.append(i)
        elif st == "learned": learned.append(i)
        else: new.append(i)
    # Pick ~60% learning, fill with new, fill with learned (random)
    import random
    random.shuffle(learning); random.shuffle(new); random.shuffle(learned)
    take_l = min(len(learning), max(1, int(limit * 0.6)))
    pick = learning[:take_l]
    while len(pick) < limit and new:
        pick.append(new.pop())
    while len(pick) < limit and learned:
        pick.append(learned.pop())
    # Build response — fetch each word once
    words = []
    for i in pick[:limit]:
        w = _word_get(i, db)
        if w: words.append(_word_view(i, mode, w, rows.get(i)))
    return {
        "mode": mode,
        "words": words,
        "totals": {
            "total": total,
            "new": sum(1 for i in all_idx if rows.get(i, {}).get("status", "new") == "new"),
            "learning": len([i for i in rows if rows[i]["status"] == "learning"]),
            "learned": len([i for i in rows if rows[i]["status"] == "learned"]),
        }
    }

class WordAnswer(BaseModel):
    idx: int
    mode: str = "en"
    correct: bool
    answer: str | None = None  # the actual text the user typed (for stats, optional)

@app.post("/api/words/answer")
def words_answer(body: WordAnswer, user=Depends(get_uf), db=Depends(get_db)):
    """Record an answer. correct=True → status 'learned' (if first try) or 'learning'+counted.
    correct=False → status 'learning'."""
    if _word_get(body.idx, db) is None:
        raise HTTPException(400, "invalid word idx")
    if body.mode not in ("en", "ru"):
        raise HTTPException(400, "invalid mode")
    uid = user["id"]
    row = db.execute("SELECT * FROM word_progress WHERE user_id=? AND word_idx=? AND mode=?",
                     (uid, body.idx, body.mode)).fetchone()
    now = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    if row:
        attempts = row["attempts"] + 1
        correct_count = row["correct_count"] + (1 if body.correct else 0)
        # Learned: ≥1 correct AND no failures in last attempt sequence (simple heuristic: correct on this try)
        new_status = "learned" if body.correct and correct_count >= 1 else "learning"
        # If was already learned and missed it — drop to learning
        if row["status"] == "learned" and not body.correct:
            new_status = "learning"
        db.execute(
            "UPDATE word_progress SET status=?, attempts=?, correct_count=?, last_seen=? WHERE user_id=? AND word_idx=? AND mode=?",
            (new_status, attempts, correct_count, now, uid, body.idx, body.mode))
    else:
        new_status = "learned" if body.correct else "learning"
        db.execute(
            "INSERT INTO word_progress (user_id, word_idx, mode, status, attempts, correct_count, last_seen) VALUES (?,?,?,?,?,?,?)",
            (uid, body.idx, body.mode, new_status, 1, 1 if body.correct else 0, now))
    db.commit()
    return {"ok": True, "status": new_status}

@app.get("/api/words/stats")
def words_stats(mode: str = "en", user=Depends(get_uf), db=Depends(get_db)):
    """Returns per-member stats for the given mode + family comparison."""
    total = _word_count(db)
    members = [dict(r) for r in db.execute(
        "SELECT user_id, user_name FROM family_members WHERE family_id=?", (user["family_id"],)).fetchall()]
    per_member = []
    for m in members:
        rows = db.execute(
            "SELECT status, COUNT(*) AS n FROM word_progress WHERE user_id=? AND mode=? GROUP BY status",
            (m["user_id"], mode)).fetchall()
        counts = {"new": total, "learning": 0, "learned": 0}
        seen = 0
        for r in rows:
            counts[r["status"]] = r["n"]; seen += r["n"]
        counts["new"] = total - seen
        attempts_row = db.execute(
            "SELECT COALESCE(SUM(attempts),0) AS a, COALESCE(SUM(correct_count),0) AS c FROM word_progress WHERE user_id=? AND mode=?",
            (m["user_id"], mode)).fetchone()
        per_member.append({
            "user_id": m["user_id"],
            "user_name": m["user_name"],
            "counts": counts,
            "attempts": attempts_row["a"],
            "correct": attempts_row["c"],
            "accuracy": round(attempts_row["c"] / attempts_row["a"] * 100) if attempts_row["a"] else 0,
        })
    return {"mode": mode, "total": total, "members": per_member, "my_id": user["id"]}

@app.post("/api/words/reset")
def words_reset(mode: str = "en", user=Depends(get_uf), db=Depends(get_db)):
    db.execute("DELETE FROM word_progress WHERE user_id=? AND mode=?", (user["id"], mode)); db.commit()
    return {"ok": True}

# ─── Word editor (Settings → Words modal) ─────────────────────────────────
# Image dir matches the docker volume mount in docker-compose.yml.
WORDS_IMG_DIR = os.environ.get("WORDS_IMG_DIR", "/app/frontend/words")

@app.get("/api/words/all")
def words_all(user=Depends(get_uf), db=Depends(get_db)):
    """Flat list of every word (static + custom, after overrides), for the editor.
    Sorted alphabetically by en_word."""
    out = []
    # Static + overrides
    for i in range(len(_STATIC_VOCAB)):
        w = _word_get(i, db)
        if not w: continue
        out.append({
            "idx": i, "source": "static",
            "en_word": w.get("en_word", ""), "ru_word": w.get("ru_word", ""),
            "image_key": _img_key(w.get("en_word", "")),
        })
    # Custom (active)
    for r in db.execute("SELECT idx, en_word, ru_word FROM custom_words WHERE status='active' ORDER BY idx").fetchall():
        out.append({
            "idx": r["idx"], "source": "custom",
            "en_word": r["en_word"], "ru_word": r["ru_word"],
            "image_key": _img_key(r["en_word"]),
        })
    out.sort(key=lambda x: (x.get("en_word") or "").lower())
    return {"words": out, "total": len(out)}

@app.get("/api/words/one/{idx}")
def word_one(idx: int, user=Depends(get_uf), db=Depends(get_db)):
    """Full word payload for the editor (all fields)."""
    w = _word_get(idx, db)
    if not w: raise HTTPException(404, "word not found")
    src = "static" if idx < len(_STATIC_VOCAB) else "custom"
    return {
        "idx": idx, "source": src,
        "en_word": w.get("en_word", ""), "ru_word": w.get("ru_word", ""),
        "en_ipa": w.get("en_ipa", ""),   "ru_ipa": w.get("ru_ipa", ""),
        "en_def": w.get("en_def", ""),   "ru_def": w.get("ru_def", ""),
        "en_example": w.get("en_example", ""), "ru_example": w.get("ru_example", ""),
        "emoji": w.get("emoji", "📖"),
        "image_key": _img_key(w.get("en_word", "")),
    }

class WordEdit(BaseModel):
    en_word: str | None = None
    ru_word: str | None = None
    en_ipa: str | None = None
    ru_ipa: str | None = None
    en_def: str | None = None
    ru_def: str | None = None
    en_example: str | None = None
    ru_example: str | None = None
    emoji: str | None = None

@app.patch("/api/words/one/{idx}")
def word_update(idx: int, body: WordEdit, user=Depends(get_uf), db=Depends(get_db)):
    """Update word fields. Static idx → upsert into word_overrides. Custom idx → update custom_words.
    On en_word rename, also rename the on-disk image so the card keeps its visual."""
    w = _word_get(idx, db)
    if not w: raise HTTPException(404, "word not found")
    old_en = w.get("en_word", "")
    # Coerce/clean values: only keep fields the client sent (not None)
    payload = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.dict().items() if v is not None}
    if not payload: return {"ok": True, "noop": True}
    # Basic validation: word fields can't be empty if explicitly set
    for k in ("en_word", "ru_word"):
        if k in payload and not payload[k]:
            raise HTTPException(400, f"{k} cannot be empty")
    if idx < len(_STATIC_VOCAB):
        # Static word — write to word_overrides
        cur = db.execute("SELECT * FROM word_overrides WHERE idx=?", (idx,)).fetchone()
        if cur:
            sets, params = [], []
            for k, v in payload.items():
                sets.append(f"{k}=?"); params.append(v)
            sets.append("updated_at=datetime('now')"); sets.append("updated_by=?"); params.extend([user["id"], idx])
            db.execute(f"UPDATE word_overrides SET {','.join(sets)} WHERE idx=?", params)
        else:
            cols = ["idx"] + list(payload.keys()) + ["updated_by"]
            vals = [idx] + list(payload.values()) + [user["id"]]
            db.execute(f"INSERT INTO word_overrides ({','.join(cols)}) VALUES ({','.join(['?']*len(vals))})", vals)
    else:
        # Custom word
        sets, params = [], []
        for k, v in payload.items():
            sets.append(f"{k}=?"); params.append(v)
        params.append(idx)
        db.execute(f"UPDATE custom_words SET {','.join(sets)} WHERE idx=?", params)
    db.commit()
    # Image rename on en_word change
    if "en_word" in payload and payload["en_word"] != old_en:
        old_key = _img_key(old_en); new_key = _img_key(payload["en_word"])
        if old_key and new_key and old_key != new_key:
            old_fp = os.path.join(WORDS_IMG_DIR, f"{old_key}.jpg")
            new_fp = os.path.join(WORDS_IMG_DIR, f"{new_key}.jpg")
            if os.path.isfile(old_fp) and not os.path.isfile(new_fp):
                try: os.rename(old_fp, new_fp)
                except Exception as e: log.warning(f"Image rename failed {old_key}→{new_key}: {e}")
    return {"ok": True, "image_key": _img_key((payload.get("en_word") or old_en))}

from fastapi import UploadFile, File

@app.post("/api/words/one/{idx}/image")
async def word_image_upload(idx: int, file: UploadFile = File(...), user=Depends(get_uf), db=Depends(get_db)):
    """Upload an image for a word. Saved as /app/frontend/words/<image_key>.jpg.
    Max 2 MB. Accepts JPEG/PNG/WebP — re-encoding not performed (Telegram MA browsers handle all)."""
    w = _word_get(idx, db)
    if not w: raise HTTPException(404, "word not found")
    key = _img_key(w.get("en_word", ""))
    if not key: raise HTTPException(400, "no image_key for this word")
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 2 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 2 MB)")
    os.makedirs(WORDS_IMG_DIR, exist_ok=True)
    fp = os.path.join(WORDS_IMG_DIR, f"{key}.jpg")
    with open(fp, "wb") as f:
        f.write(data)
    return {"ok": True, "image_key": key, "size": len(data)}

@app.delete("/api/words/one/{idx}/image")
def word_image_delete(idx: int, user=Depends(get_uf), db=Depends(get_db)):
    """Delete the on-disk image for a word (card reverts to emoji)."""
    w = _word_get(idx, db)
    if not w: raise HTTPException(404, "word not found")
    key = _img_key(w.get("en_word", ""))
    if not key: return {"ok": True, "noop": True}
    fp = os.path.join(WORDS_IMG_DIR, f"{key}.jpg")
    if os.path.isfile(fp):
        try: os.remove(fp); return {"ok": True}
        except Exception as e: raise HTTPException(500, f"delete failed: {e}")
    return {"ok": True, "noop": True}

# Word images: served as static files from /static/words/<image_key>.jpg
# (mounted volume frontend/words/ on host). Files are added manually via bot
# (photo with caption "Картинка: омлет") or scp. No API endpoint needed — the
# frontend just tries the URL and silently hides the <img> on 404.

@app.get("/api/words/member-detail")
def words_member_detail(user_id: int, mode: str = "en", user=Depends(get_uf), db=Depends(get_db)):
    """Detailed word lists for one member — used by the stats drill-down page."""
    if mode not in ("en", "ru"): raise HTTPException(400)
    target = db.execute("SELECT 1 FROM family_members WHERE user_id=? AND family_id=?",
                        (user_id, user["family_id"])).fetchone()
    if not target: raise HTTPException(403, "not in same family")
    rows = db.execute(
        "SELECT word_idx, status, attempts, correct_count, last_seen FROM word_progress WHERE user_id=? AND mode=? ORDER BY last_seen DESC NULLS LAST",
        (user_id, mode)).fetchall()
    learned, mistakes = [], []
    for r in rows:
        idx = r["word_idx"]
        w = _word_get(idx, db)
        if w is None: continue
        if mode == "en":
            src_w, tgt_w, tgt_ipa = w["ru_word"], w["en_word"], w.get("en_ipa", "")
        else:
            src_w, tgt_w, tgt_ipa = w["en_word"], w["ru_word"], w.get("ru_ipa", "")
        entry = {
            "idx": idx,
            "source_word": src_w,
            "target_word": tgt_w,
            "target_ipa": tgt_ipa,
            "attempts": r["attempts"],
            "correct_count": r["correct_count"],
            "accuracy": round(r["correct_count"] / r["attempts"] * 100) if r["attempts"] else 0,
            "last_seen": r["last_seen"],
        }
        if r["status"] == "learned":
            learned.append(entry)
        elif r["status"] == "learning":
            mistakes.append(entry)
    return {"user_id": user_id, "mode": mode, "learned": learned, "mistakes": mistakes}

class LearnMode(BaseModel):
    mode: str  # "en" | "ru"

@app.patch("/api/words/learn-mode")
def set_learn_mode(body: LearnMode, user=Depends(get_uf), db=Depends(get_db)):
    if body.mode not in ("en", "ru"): raise HTTPException(400)
    db.execute("UPDATE family_members SET learn_mode=? WHERE user_id=?", (body.mode, user["id"])); db.commit()
    return {"ok": True}

# ─── Exercise images (uploaded via Telegram bot, served from Docker volume) ──
EXERCISE_IMG_DIR = os.environ.get("EXERCISE_IMG_DIR", "/data/exercise_images")

@app.get("/api/exercise-images/{fn}")
def serve_exercise_image(fn: str):
    # Hardened against path traversal
    if "/" in fn or "\\" in fn or ".." in fn:
        raise HTTPException(400)
    fp = os.path.join(EXERCISE_IMG_DIR, fn)
    if not os.path.isfile(fp): raise HTTPException(404)
    r = FileResponse(fp, media_type="image/jpeg")
    r.headers["Cache-Control"] = "public, max-age=86400"
    return r

# ─── Debug & Serve ───────────────────────────────────────────────────────
APP_VERSION = "v8.24.0"

@app.get("/api/debug/ping")
def ping(): return {"ok": True, "version": APP_VERSION, "time": datetime.now(ZoneInfo(TIMEZONE)).isoformat()}

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/")
def serve_index():
    r = FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r

# PWA manifest at /manifest.json (preferred by spec) — also accessible via /static/manifest.json
@app.get("/manifest.json")
def serve_manifest():
    fp = os.path.join(FRONTEND_DIR, "manifest.json")
    if not os.path.isfile(fp): raise HTTPException(404)
    r = FileResponse(fp, media_type="application/manifest+json")
    r.headers["Cache-Control"] = "public, max-age=3600"
    return r

# Service worker MUST be served from origin root for max scope
@app.get("/sw.js")
def serve_sw():
    fp = os.path.join(FRONTEND_DIR, "sw.js")
    if not os.path.isfile(fp): raise HTTPException(404)
    r = FileResponse(fp, media_type="application/javascript")
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Service-Worker-Allowed"] = "/"
    return r

@app.get("/static/{path:path}")
def serve_static(path: str):
    import mimetypes
    # Path-traversal guard: resolve, ensure under FRONTEND_DIR
    fp = os.path.abspath(os.path.join(FRONTEND_DIR, path))
    if not fp.startswith(FRONTEND_DIR + os.sep) and fp != FRONTEND_DIR:
        raise HTTPException(400)
    if not os.path.isfile(fp): raise HTTPException(404)
    mt = mimetypes.guess_type(fp)[0] or "application/octet-stream"
    r = FileResponse(fp, media_type=mt)
    # Icons & manifest: cacheable. app.js / index.html: still no-cache (uses ?v= for busting)
    if path.startswith("icons/") or path.endswith((".png", ".jpg", ".webp", ".svg", ".ico")):
        r.headers["Cache-Control"] = "public, max-age=86400"
    elif path.startswith("weather/") or path.endswith((".mp4", ".webm")):
        # Weather video loops: aggressive long-term caching (file names are immutable)
        r.headers["Cache-Control"] = "public, max-age=2592000, immutable"
    else:
        r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r
