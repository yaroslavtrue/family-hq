"""
🏠 Family HQ v5 — Backend API
"""
import os, sqlite3, hashlib, hmac, json, logging, random, re, time, secrets, shutil
from datetime import datetime, timedelta, date
from calendar import monthrange
from urllib.parse import parse_qs
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Depends, Request, UploadFile, File, Form
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
    aps.add_job(sched.cleanup_pending_words, "cron", hour=3, minute=30)
    aps.add_job(sched.check_plant_reminders, "interval", minutes=30)
    aps.add_job(sched.cleanup_old_reminders, "cron", hour=3, minute=45)
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
    row = db.execute("SELECT fm.family_id, fm.lang, fm.nav_tabs, f.name, f.invite_code FROM family_members fm JOIN families f ON f.id=fm.family_id WHERE fm.user_id=?", (user["id"],)).fetchone()
    if not row: return {"joined": False}
    members = [dict(m) for m in db.execute("SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?", (row["family_id"],)).fetchall()]
    # lang: per-member UI language ('en'|'ru'), drives the tr(key) helper in app.js.
    # nav_tabs: per-member bottom-nav preference, JSON array of tab ids; null = default.
    nav_tabs = None
    if row["nav_tabs"]:
        try: nav_tabs = _json_mod.loads(row["nav_tabs"])
        except Exception: nav_tabs = None
    return {"joined": True, "family_id": row["family_id"], "name": row["name"], "invite_code": row["invite_code"], "members": members, "my_id": user["id"], "lang": (row["lang"] or "en"), "nav_tabs": nav_tabs}


class LangUpdate(BaseModel):
    lang: str  # 'en' | 'ru'

@app.patch("/api/members/me/lang")
def update_my_lang(body: LangUpdate, user=Depends(get_uf), db=Depends(get_db)):
    if body.lang not in ("en", "ru"):
        raise HTTPException(400, "Invalid language")
    db.execute("UPDATE family_members SET lang=? WHERE user_id=?", (body.lang, user["id"]))
    db.commit()
    return {"ok": True, "lang": body.lang}


# Per-member bottom-navigation preference (v8.47.0).
# tabs: array of tab ids in display order, 3-5 items. null/empty resets to default.
_VALID_NAV_TABS = {"home", "tasks", "shop", "cooking", "life", "trainings",
                   "words", "plants", "money", "profile", "events",
                   "birthdays", "clean", "settings", "subs"}

class NavTabsUpdate(BaseModel):
    tabs: list[str] | None = None

@app.patch("/api/members/me/nav_tabs")
def update_my_nav_tabs(body: NavTabsUpdate, user=Depends(get_uf), db=Depends(get_db)):
    tabs = body.tabs
    if tabs:
        # Validation: 3-5 items, all known ids, no duplicates.
        if not (3 <= len(tabs) <= 5):
            raise HTTPException(400, "Pick between 3 and 5 tabs")
        if len(set(tabs)) != len(tabs):
            raise HTTPException(400, "Duplicate tab ids")
        bad = [t for t in tabs if t not in _VALID_NAV_TABS]
        if bad:
            raise HTTPException(400, f"Unknown tab ids: {bad}")
        stored = _json_mod.dumps(tabs)
    else:
        stored = None  # NULL → default
    db.execute("UPDATE family_members SET nav_tabs=? WHERE user_id=?", (stored, user["id"]))
    db.commit()
    return {"ok": True, "tabs": tabs}


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
    # ISOLATION FIX (v8.33.0): verify the parent task/event belongs to the caller's family
    # before INSERT. Otherwise a forged pid would (a) pollute the caller's subtasks with
    # a row pointing at another family's task and (b) leak the parent's text via the
    # notify_all chat message that immediately follows.
    parent_tbl = {"task": "tasks", "event": "events", "transaction": "transactions"}.get(pt)
    if not parent_tbl: raise HTTPException(400, "Invalid parent type")
    if pt == "transaction":
        if not db.execute(f"SELECT 1 FROM {parent_tbl} WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone():
            raise HTTPException(404, "Parent not found")
        pn = ""
    else:
        parent = db.execute(f"SELECT text FROM {parent_tbl} WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
        if not parent: raise HTTPException(404, "Parent not found")
        pn = parent["text"]
    db.execute("INSERT INTO subtasks (parent_type,parent_id,family_id,text) VALUES (?,?,?,?)", (pt, pid, user["family_id"], body.text)); db.commit()
    if pt != "transaction":
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
        # ISOLATION FIX (v8.33.1): scope by family_id so a forged category_id can't make us echo
        # another family's category name to chat.
        cr = db.execute("SELECT emoji, name FROM categories WHERE id=? AND family_id=?", (body.category_id, user["family_id"])).fetchone()
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
    # Selected month totals (income & expense reset to 0 at the start of each month)
    inc = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='income' AND date LIKE ?", (f, sel_month+"%")).fetchone()["s"]
    exp = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date LIKE ?", (f, sel_month+"%")).fetchone()["s"]
    # v8.50.0: balance is a RUNNING account balance, not a per-month delta.
    # opening_balance = everything (income − expense) from BEFORE this month —
    # i.e. the money already on the account when the month started. Then the
    # closing balance = opening + this month's income − this month's expense.
    # Subscriptions are projected costs, not real transactions, so they stay out.
    month_start = f"{sy:04d}-{sm:02d}-01"
    opening_inc = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='income' AND date < ?", (f, month_start)).fetchone()["s"]
    opening_exp = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM transactions WHERE family_id=? AND type='expense' AND date < ?", (f, month_start)).fetchone()["s"]
    opening_balance = opening_inc - opening_exp
    closing_balance = opening_balance + inc - exp
    # Subs as monthly expense (flat, not month-dependent)
    subs_eur = db.execute("SELECT COALESCE(SUM(amount_eur),0) s FROM subscriptions WHERE family_id=?", (f,)).fetchone()["s"]
    # By category (selected month)
    by_cat = [dict(r) for r in db.execute("""
        SELECT c.id, c.emoji, c.name, COALESCE(SUM(t.amount_eur),0) total
        FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.family_id=c.family_id AND t.type='expense' AND t.date LIKE ?
        WHERE c.family_id=? AND c.type='expense' GROUP BY c.id ORDER BY total DESC
    """, (sel_month+"%", f)).fetchall()]
    # Monthly chart: last 24 months ending on CURRENT month (stable window —
    # selected month is just highlighted; scrolling navigates the chart, not the data).
    # Frontend can build year watermarks from this contiguous array.
    months = []
    cy, cm_now = now.year, now.month
    for i in range(23, -1, -1):
        m = cm_now - i
        y = cy
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
        "subs_eur": round(subs_eur, 2),
        # balance = running account balance through end of selected month.
        # opening_balance = carried over from previous months. net = this month's delta.
        "balance": round(closing_balance, 2),
        "opening_balance": round(opening_balance, 2),
        "net": round(inc - exp, 2),
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

    # ─── Words stats — per member in their own mode, or family aggregate ──
    words_total = _word_count(db)
    words_learned = 0; words_learning = 0; words_attempts = 0; words_correct = 0
    words_mode = None
    if member_id:
        mm = db.execute("SELECT learn_mode FROM family_members WHERE user_id=?", (member_id,)).fetchone()
        if mm: words_mode = (mm["learn_mode"] or "en")
        rs = db.execute(
            "SELECT status, COUNT(*) n FROM word_progress WHERE user_id=? AND mode=? GROUP BY status",
            (member_id, words_mode or "en")).fetchall()
        for r in rs:
            if r["status"] == "learned": words_learned = r["n"]
            elif r["status"] == "learning": words_learning = r["n"]
        ar = db.execute(
            "SELECT COALESCE(SUM(attempts),0) a, COALESCE(SUM(correct_count),0) c FROM word_progress WHERE user_id=? AND mode=?",
            (member_id, words_mode or "en")).fetchone()
        words_attempts = ar["a"] or 0; words_correct = ar["c"] or 0
    else:
        # Family aggregate: sum across all members in their own modes
        fam = db.execute("SELECT user_id, learn_mode FROM family_members WHERE family_id=?", (f,)).fetchall()
        for fm in fam:
            m_mode = (fm["learn_mode"] or "en")
            rs = db.execute(
                "SELECT status, COUNT(*) n FROM word_progress WHERE user_id=? AND mode=? GROUP BY status",
                (fm["user_id"], m_mode)).fetchall()
            for r in rs:
                if r["status"] == "learned": words_learned += r["n"]
                elif r["status"] == "learning": words_learning += r["n"]
            ar = db.execute(
                "SELECT COALESCE(SUM(attempts),0) a, COALESCE(SUM(correct_count),0) c FROM word_progress WHERE user_id=? AND mode=?",
                (fm["user_id"], m_mode)).fetchone()
            words_attempts += ar["a"] or 0; words_correct += ar["c"] or 0
    words_accuracy = round(words_correct / words_attempts * 100) if words_attempts else 0

    # ─── Trainings stats — this week tonnage + delta vs last week ──
    wk_start_d = now.date() - timedelta(days=now.weekday())
    wk_end_d = wk_start_d + timedelta(days=6)
    prev_start_d = wk_start_d - timedelta(days=7)
    prev_end_d = wk_start_d - timedelta(days=1)
    wf_member = "AND w.member_id=?" if member_id else ""
    wf_p = (member_id,) if member_id else ()
    def _train_window(d_from, d_to):
        r = db.execute(f"""
            SELECT COALESCE(SUM(ws.reps * ws.weight),0) tonnage,
                   COUNT(DISTINCT w.id) workouts
            FROM workouts w
            LEFT JOIN workout_exercises wx ON wx.workout_id=w.id
            LEFT JOIN workout_sets ws ON ws.workout_exercise_id=wx.id
            WHERE w.family_id=? AND w.date>=? AND w.date<=? {wf_member}
        """, (f, d_from, d_to) + wf_p).fetchone()
        return {"tonnage": round(r["tonnage"] or 0, 2), "workouts": r["workouts"] or 0}
    train_week = _train_window(wk_start_d.isoformat(), wk_end_d.isoformat())
    train_prev = _train_window(prev_start_d.isoformat(), prev_end_d.isoformat())
    train_delta_pct = None
    if train_prev["tonnage"] > 0:
        train_delta_pct = round((train_week["tonnage"] - train_prev["tonnage"]) / train_prev["tonnage"] * 100)

    return {
        "member_id": member_id,
        "tasks_active": tasks_active, "tasks_done": tasks_done,
        "tasks_high": tasks_high, "tasks_overdue": tasks_overdue,
        "spent_month": round(spent_month, 2), "income_month": round(income_month, 2),
        "spent_week": round(spent_week, 2), "tx_count": tx_count,
        "top_category": top_cat,
        "shop_total": shop_total, "shop_bought": shop_bought,
        "clean_done": clean_done, "clean_total": clean_total,
        "words_total": words_total, "words_learned": words_learned,
        "words_learning": words_learning, "words_accuracy": words_accuracy,
        "words_mode": words_mode,
        "train_week": train_week, "train_prev_week": train_prev,
        "train_delta_pct": train_delta_pct,
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
    # ISOLATION FIX (v8.33.1): ownership check first, then in-use check joined through workouts.
    # The original "SELECT 1 FROM workout_exercises WHERE exercise_id=?" was an existence
    # oracle — a forged eid would tell the caller "yes, that exercise is in use" even when
    # the workouts belonged to another family.
    if not db.execute("SELECT 1 FROM exercises WHERE id=? AND family_id=?", (eid, user["family_id"])).fetchone():
        raise HTTPException(404)
    used = db.execute("""SELECT 1 FROM workout_exercises we
                          JOIN workouts w ON w.id=we.workout_id
                          WHERE we.exercise_id=? AND w.family_id=? LIMIT 1""",
                       (eid, user["family_id"])).fetchone()
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
    # ISOLATION FIX (v8.33.0): pre-check ownership before cascade DELETEs touch children.
    # Without this, a forged wid would let family A wipe family B's workout_sets +
    # workout_exercises (only the workouts row itself was protected by the trailing AND family_id=?).
    if not db.execute("SELECT 1 FROM workouts WHERE id=? AND family_id=?", (wid, user["family_id"])).fetchone():
        raise HTTPException(404)
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
# ─── Workout template color theme — auto-derived from muscle groups ───
# Mapping: most common muscle_group across the template's exercises → color pair
# (used for gradient backgrounds on hero cards). Each pair = (lighter, darker).
WORKOUT_MUSCLE_COLORS = {
    "legs":      ("#10b981", "#047857"),  # emerald
    "lower":     ("#10b981", "#047857"),
    "arms":      ("#3b82f6", "#1d4ed8"),  # blue
    "biceps":    ("#3b82f6", "#1d4ed8"),
    "triceps":   ("#3b82f6", "#1d4ed8"),
    "back":      ("#8b5cf6", "#5b21b6"),  # purple
    "chest":     ("#a78bfa", "#6d28d9"),  # violet
    "shoulders": ("#06b6d4", "#0e7490"),  # cyan
    "core":      ("#f59e0b", "#b45309"),  # amber
    "abs":       ("#f59e0b", "#b45309"),
    "cardio":    ("#ef4444", "#b91c1c"),  # red
    "glutes":    ("#10b981", "#047857"),
}
WORKOUT_DEFAULT_COLOR = ("#6366f1", "#4338ca")  # indigo
WORKOUTS_IMG_DIR = os.environ.get("WORKOUTS_IMG_DIR", "/app/frontend/workouts")

def _workout_muscle_color(muscle_groups: list[str]) -> tuple[str, tuple[str, str]]:
    """Given a list of muscle_group strings (from exercises in a template), return
    (primary_muscle, (color_light, color_dark)). Picks the most common group."""
    if not muscle_groups:
        return ("mixed", WORKOUT_DEFAULT_COLOR)
    counts = {}
    for g in muscle_groups:
        if not g: continue
        k = g.strip().lower()
        counts[k] = counts.get(k, 0) + 1
    if not counts:
        return ("mixed", WORKOUT_DEFAULT_COLOR)
    primary = max(counts.items(), key=lambda kv: kv[1])[0]
    return (primary, WORKOUT_MUSCLE_COLORS.get(primary, WORKOUT_DEFAULT_COLOR))


def _template_meta(t: dict) -> dict:
    """Compute UI metadata (color, primary muscle, has_image, exercise count) for a template."""
    ex_list = t.get("exercises_list") or []
    muscles = [e.get("muscle_group", "") for e in ex_list]
    primary, (col_l, col_d) = _workout_muscle_color(muscles)
    has_image = os.path.isfile(os.path.join(WORKOUTS_IMG_DIR, f"{t['id']}.jpg"))
    return {
        "primary_muscle": primary,
        "color_from": col_l,
        "color_to": col_d,
        "has_image": has_image,
        "exercise_count": len(ex_list),
    }


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
            t.update(_template_meta(t))
    return templates


@app.post("/api/workout-templates/{tid}/image")
async def template_image_upload(tid: int, file: UploadFile = File(...), user=Depends(get_uf), db=Depends(get_db)):
    """Upload a hero image for a workout template. Saved as /app/frontend/workouts/<tid>.jpg.
    Replaces existing image."""
    row = db.execute("SELECT id FROM workout_templates WHERE id=? AND family_id=?",
                     (tid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    os.makedirs(WORKOUTS_IMG_DIR, exist_ok=True)
    with open(os.path.join(WORKOUTS_IMG_DIR, f"{tid}.jpg"), "wb") as f:
        f.write(data)
    return {"ok": True, "size": len(data)}


@app.delete("/api/workout-templates/{tid}/image")
def template_image_delete(tid: int, user=Depends(get_uf), db=Depends(get_db)):
    row = db.execute("SELECT id FROM workout_templates WHERE id=? AND family_id=?",
                     (tid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    fp = os.path.join(WORKOUTS_IMG_DIR, f"{tid}.jpg")
    if os.path.isfile(fp):
        try: os.remove(fp); return {"ok": True}
        except Exception as e: raise HTTPException(500, f"delete failed: {e}")
    return {"ok": True, "noop": True}

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


@app.get("/api/trainings/stats/period")
def trainings_stats_period(
    period: str = "week",
    member_id: int | None = None,
    user=Depends(get_uf), db=Depends(get_db),
):
    """Period-aggregated tonnage with comparison vs previous period + bar-chart buckets +
    secondary metrics. Drives the redesigned Stats page.

    period: 'day' | 'week' | 'month' | 'year'
      - day   → 7 daily bars ending today; compare today vs yesterday
      - week  → 7 daily bars Mon-Sun (or last 7 days); compare this vs last week
      - month → ~30 daily bars; compare this vs last month
      - year  → 12 monthly bars; compare this vs last year"""
    if period not in ("day", "week", "month", "year"):
        raise HTTPException(400, "invalid period")
    f = user["family_id"]
    where_member = "AND w.member_id=?" if member_id else ""
    params_member = [member_id] if member_id else []
    now = datetime.now(ZoneInfo(TIMEZONE))
    today = now.date()

    def _sum(date_from, date_to):
        r = db.execute(f"""
            SELECT COALESCE(SUM(ws.reps * ws.weight), 0) AS tonnage,
                   COUNT(DISTINCT w.id) AS workouts,
                   COUNT(ws.id) AS sets
            FROM workouts w
            LEFT JOIN workout_exercises wx ON wx.workout_id=w.id
            LEFT JOIN workout_sets ws ON ws.workout_exercise_id=wx.id
            WHERE w.family_id=? AND w.date>=? AND w.date<=? {where_member}
        """, [f, date_from, date_to] + params_member).fetchone()
        return {"tonnage": round(r["tonnage"] or 0, 2), "workouts": r["workouts"] or 0, "sets": r["sets"] or 0}

    # Period bounds + comparison
    if period == "day":
        cur_from = today; cur_to = today
        prev_from = today - timedelta(days=1); prev_to = prev_from
        label = "Today"
        # Bars: last 7 days
        bars = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            stat = _sum(d.isoformat(), d.isoformat())
            bars.append({"label": d.strftime("%a"), "date": d.isoformat(), "tonnage": stat["tonnage"], "is_current": i == 0})
    elif period == "week":
        wk_start = today - timedelta(days=today.weekday())
        cur_from = wk_start; cur_to = wk_start + timedelta(days=6)
        prev_from = wk_start - timedelta(days=7); prev_to = wk_start - timedelta(days=1)
        label = "This week"
        bars = []
        for i in range(7):
            d = wk_start + timedelta(days=i)
            stat = _sum(d.isoformat(), d.isoformat())
            bars.append({"label": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i], "date": d.isoformat(),
                         "tonnage": stat["tonnage"], "is_current": d == today})
    elif period == "month":
        m_start = today.replace(day=1)
        # Find last day of current month
        next_m = (m_start + timedelta(days=32)).replace(day=1)
        m_end = next_m - timedelta(days=1)
        cur_from = m_start; cur_to = m_end
        # Previous month
        prev_end = m_start - timedelta(days=1)
        prev_start = prev_end.replace(day=1)
        prev_from = prev_start; prev_to = prev_end
        label = m_start.strftime("%B")
        # Bars: every day of current month
        bars = []
        d = m_start
        while d <= m_end:
            stat = _sum(d.isoformat(), d.isoformat())
            bars.append({"label": str(d.day), "date": d.isoformat(),
                         "tonnage": stat["tonnage"], "is_current": d == today})
            d += timedelta(days=1)
    else:  # year
        y_start = today.replace(month=1, day=1)
        y_end = today.replace(month=12, day=31)
        cur_from = y_start; cur_to = y_end
        prev_from = y_start.replace(year=y_start.year - 1)
        prev_to = y_end.replace(year=y_end.year - 1)
        label = str(today.year)
        bars = []
        for m in range(1, 13):
            ms = today.replace(month=m, day=1)
            me = (ms.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            stat = _sum(ms.isoformat(), me.isoformat())
            bars.append({"label": ms.strftime("%b"), "date": ms.isoformat(),
                         "tonnage": stat["tonnage"], "is_current": ms.month == today.month})

    cur = _sum(cur_from.isoformat(), cur_to.isoformat())
    prev = _sum(prev_from.isoformat(), prev_to.isoformat())
    delta_pct = None
    if prev["tonnage"] > 0:
        delta_pct = round((cur["tonnage"] - prev["tonnage"]) / prev["tonnage"] * 100)

    # Secondary metrics — same window as current period
    avg_per_workout = round(cur["tonnage"] / cur["workouts"], 2) if cur["workouts"] else 0
    # Max daily tonnage in current period
    max_daily = max((b["tonnage"] for b in bars), default=0)
    max_bar = max((b["tonnage"] for b in bars), default=1) or 1

    return {
        "period": period,
        "label": label,
        "current": cur,
        "previous": prev,
        "delta_pct": delta_pct,
        "bars": bars,
        "max_bar": max_bar,
        "avg_per_workout": avg_per_workout,
        "max_daily": max_daily,
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

    plants = []
    try:
        plant_rows = db.execute("SELECT * FROM plants WHERE family_id=? ORDER BY id", (f,)).fetchall()
        plants = [_plant_view(dict(r)) for r in plant_rows]
    except Exception as e:
        log.warning(f"plants bundle: {e}")

    return {
        "tasks": tasks, "recurring": recurring, "shopping": shopping, "folders": folders,
        "events": events, "birthdays": bdays, "subs": subs, "dashboard": dashboard,
        "members": members, "settings": settings, "family": family, "zones": zones,
        "subtasks_task": subtasks_task, "subtasks_event": subtasks_event,
        "weather": weather, "categories": categories, "transactions": transactions,
        "tx_items": tx_items,
        "exercises": exercises, "recent_workouts": recent_workouts,
        "workout_templates": workout_templates,
        "plants": plants,
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
from backend.words_common import img_key as _img_key, CUSTOM_IDX_BASE as _CUSTOM_IDX_BASE
import unicodedata as _ucd

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
def words_stats(user=Depends(get_uf), db=Depends(get_db)):
    """Returns per-member stats — each row in THAT member's own learn_mode.
    The viewer sees their English progress AND the spouse's Russian progress on the
    same screen, instead of being filtered to a single mode."""
    total = _word_count(db)
    members = [dict(r) for r in db.execute(
        "SELECT user_id, user_name, learn_mode FROM family_members WHERE family_id=?",
        (user["family_id"],)).fetchall()]
    per_member = []
    for m in members:
        mode = (m.get("learn_mode") or "en").strip()
        if mode not in ("en", "ru"): mode = "en"
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
            "mode": mode,
            "counts": counts,
            "attempts": attempts_row["a"],
            "correct": attempts_row["c"],
            "accuracy": round(attempts_row["c"] / attempts_row["a"] * 100) if attempts_row["a"] else 0,
        })
    return {"total": total, "members": per_member, "my_id": user["id"]}

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
        # Custom word — ISOLATION FIX (v8.33.1): scoped to caller's family so families
        # can't rewrite each other's vocabulary by passing each other's idx.
        if not db.execute("SELECT 1 FROM custom_words WHERE idx=? AND family_id=?", (idx, user["family_id"])).fetchone():
            raise HTTPException(404, "word not found")
        sets, params = [], []
        for k, v in payload.items():
            sets.append(f"{k}=?"); params.append(v)
        params.extend([idx, user["family_id"]])
        db.execute(f"UPDATE custom_words SET {','.join(sets)} WHERE idx=? AND family_id=?", params)
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

# (UploadFile, File, Form imported at the top now)

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

# ═════════════════════════════════════════════════════════════════════════
# PLANTS — family-shared plant care with AI species identification
# ═════════════════════════════════════════════════════════════════════════
PLANTS_IMG_DIR = os.environ.get("PLANTS_IMG_DIR", "/app/frontend/plants")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
import base64 as _b64
import json as _json_mod

# Shared identification prompt + status helpers + species cache override —
# kept in backend/plants_common.py so app.py and bot.py can't drift.
from backend.plants_common import (
    PLANT_PROMPT as _PLANT_PROMPT,
    PLANT_MODEL as _PLANT_MODEL,
    plant_status as _plant_status_impl,
    watered_today as _watered_today_impl,
    apply_species_cache as _apply_species_cache_impl,
)


async def _identify_plant_image(image_bytes: bytes) -> dict | None:
    """Call Claude Haiku Vision to identify a plant. Returns dict or None on API failure."""
    if not ANTHROPIC_API_KEY: return None
    b64 = _b64.standard_b64encode(image_bytes).decode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }, json={
                "model": _PLANT_MODEL,
                "max_tokens": 1500,
                "system": _PLANT_PROMPT,
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": "Identify this plant. Return JSON only."},
                ]}],
            })
            data = r.json()
            text = (data.get("content", [{}])[0].get("text") or "").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            return _json_mod.loads(text)
    except Exception as e:
        log.error(f"plant identify failed: {e}")
        return None


# ─── Plant health check (v8.46.0) ──────────────────────────────────
# Vision-based plant condition assessment. Triggered by the "Update" button
# in the Plants tab — every timeline photo can ride along with a health check.
# Sonnet looks at the photo + knows the plant's species & watering schedule
# and returns a structured assessment so the frontend can show a status pill
# and actionable advice.

_HEALTH_PROMPT_TEMPLATE = """You are a plant-care advisor. The user just uploaded a new photo of their {species} (Latin: {latin_name}).
Their current care: watering interval every {water_interval_days} days, light preference: {light}.

Assess this plant's current health and condition from the photo. Look at:
- Leaf color (yellowing, browning, pale = trouble; rich green = healthy)
- Leaf posture (droopy = thirsty or overwatered, perky = OK, curled = stress)
- Soil if visible (cracked = bone dry, glossy = freshly watered, moldy = overwatered)
- Pest signs (webs, spots, holes, sticky residue)
- New growth signs (light-green new leaves, buds)
- Overall vigor

Return STRICT JSON only, no prose, no code fences. Schema:
{{
  "status": "healthy" | "concern" | "critical",
  "summary": "<one short sentence, plain language, what you see overall>",
  "issues": ["<observation 1>", "<observation 2>", ...],
  "advice": ["<actionable step 1>", "<actionable step 2>", ...]
}}

Rules:
- If the plant looks fine, set status="healthy", a positive 1-sentence summary, and BOTH "issues" and "advice" arrays EMPTY ([]). Don't invent problems.
- "concern" = noticeable issue, recoverable with care adjustments. "critical" = urgent, may not recover without immediate action.
- Each issue or advice item: short, specific, 5-15 words. No filler.
- Maximum 3 items in each array.
- Respond in {language} ("en" = English, "ru" = Russian). Keep the JSON keys in English.

Begin response with {{."""


async def _assess_plant_health(plant: dict, image_bytes: bytes, language: str = "en") -> dict | None:
    """Call Sonnet vision to assess plant health from a fresh photo.

    Returns dict with keys {status, summary, issues, advice} or None if AI unavailable.
    `language` controls the natural-language response (issue/advice strings) — 'en' or 'ru'.
    The JSON keys are always English so the frontend can render any language consistently.
    """
    if not ANTHROPIC_API_KEY:
        return None
    prompt = _HEALTH_PROMPT_TEMPLATE.format(
        species=plant.get("species") or plant.get("custom_name") or "plant",
        latin_name=plant.get("latin_name") or "unknown",
        water_interval_days=plant.get("water_interval_days") or 7,
        light=plant.get("light") or "not specified",
        language=language,
    )
    b64 = _b64.standard_b64encode(image_bytes).decode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }, json={
                "model": _PLANT_MODEL,
                "max_tokens": 800,
                "system": prompt,
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": "Assess this plant. JSON only."},
                ]}],
            })
            data = r.json()
            text = (data.get("content", [{}])[0].get("text") or "").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            parsed = _json_mod.loads(text)
            # Defensive normalization — Sonnet usually behaves but let's not trust user-facing data blindly.
            status = parsed.get("status")
            if status not in ("healthy", "concern", "critical"):
                status = "healthy"
            return {
                "status": status,
                "summary": str(parsed.get("summary") or "")[:200],
                "issues": [str(x)[:200] for x in (parsed.get("issues") or [])[:3]],
                "advice": [str(x)[:200] for x in (parsed.get("advice") or [])[:3]],
            }
    except Exception as e:
        log.error(f"plant health check failed: {e}")
        return None


# Thin wrappers that bake TIMEZONE into the shared helpers
def _plant_status(p: dict) -> str: return _plant_status_impl(p, TIMEZONE)
def _watered_today(p: dict) -> bool: return _watered_today_impl(p, TIMEZONE)


def _plant_view(p: dict) -> dict:
    """Shape a plant row for the frontend."""
    tips = []
    if p.get("care_tips"):
        try: tips = _json_mod.loads(p["care_tips"])
        except Exception: tips = []
    voice_ov = None
    if p.get("voice_overrides"):
        try: voice_ov = _json_mod.loads(p["voice_overrides"])
        except Exception: voice_ov = None
    next_water = None
    if p.get("last_watered") and p.get("water_interval_days"):
        try:
            last = datetime.fromisoformat(p["last_watered"].replace("Z", "+00:00").split(".")[0])
            if last.tzinfo is None: last = last.replace(tzinfo=ZoneInfo(TIMEZONE))
            next_water = (last + timedelta(days=p["water_interval_days"])).isoformat()
        except Exception: pass
    return {
        "id": p["id"],
        "custom_name": p.get("custom_name") or "",
        "species": p.get("species") or "",
        "latin_name": p.get("latin_name") or "",
        "water_interval_days": p.get("water_interval_days") or 7,
        "light": p.get("light") or "",
        "care_tips": tips,
        "notes": p.get("notes") or "",
        "last_watered": p.get("last_watered"),
        "next_water": next_water,
        "added_at": p.get("added_at"),
        "added_by": p.get("added_by"),
        "status": _plant_status(p),
        "watered_today": _watered_today(p),
        "voice_overrides": voice_ov,
        "stage": p.get("stage") or None,
        "has_image": os.path.isfile(os.path.join(PLANTS_IMG_DIR, f"{p['id']}.jpg")),
    }


@app.get("/api/plants")
def plants_list(user=Depends(get_uf), db=Depends(get_db)):
    """All plants in the family, with computed status."""
    rows = db.execute("SELECT * FROM plants WHERE family_id=? ORDER BY id", (user["family_id"],)).fetchall()
    plants = [_plant_view(dict(r)) for r in rows]
    return {"plants": plants, "thirsty_count": sum(1 for p in plants if p["status"] == "thirsty")}


def _schedule_first_reminder(db, plant_id: int, family_id: int, interval_days: int):
    """Schedule the first watering reminder for a freshly-added plant."""
    remind_at = (datetime.now(ZoneInfo(TIMEZONE)) + timedelta(days=interval_days)).strftime("%Y-%m-%d %H:%M")
    db.execute("INSERT INTO plant_reminders (plant_id, family_id, remind_at) VALUES (?, ?, ?)",
               (plant_id, family_id, remind_at))


# Aliased to the shared helper — body lives in backend/plants_common.py
_apply_species_cache = _apply_species_cache_impl


def _create_plant_from_info(db, family_id: int, user_id: int, info: dict, custom_name: str, image_bytes: bytes) -> dict:
    """Common path: cache-merge, INSERT plant row, save image, schedule first reminder.
    Returns the freshly-created plant view."""
    info = _apply_species_cache(db, info)
    tips_json = _json_mod.dumps(info.get("care_tips") or [], ensure_ascii=False)
    stage = info.get("stage") if info.get("stage") in ("seed", "sprout", "young", "mature") else None
    cur = db.execute(
        """INSERT INTO plants (family_id, custom_name, species, latin_name, water_interval_days, light, care_tips, added_by, stage)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (family_id, (custom_name or "").strip(),
         info["species"].strip(), info["latin_name"].strip(),
         int(info.get("water_interval_days") or 7),
         (info.get("light") or "").strip(),
         tips_json, user_id, stage))
    pid = cur.lastrowid
    os.makedirs(PLANTS_IMG_DIR, exist_ok=True)
    with open(os.path.join(PLANTS_IMG_DIR, f"{pid}.jpg"), "wb") as f:
        f.write(image_bytes)
    # v8.49.3: also drop the creation photo into the timeline so it shows up as
    # the first chronological entry alongside future "Update" snaps. The cover
    # may later be overwritten by Updates (latest = cover); the timeline keeps
    # the original.
    try:
        os.makedirs(PLANTS_TIMELINE_DIR, exist_ok=True)
        orig_cur = db.execute(
            "INSERT INTO plant_photos (plant_id, caption, added_by) VALUES (?, ?, ?)",
            (pid, "", user_id)
        )
        orig_phid = orig_cur.lastrowid
        with open(os.path.join(PLANTS_TIMELINE_DIR, f"{orig_phid}.jpg"), "wb") as f:
            f.write(image_bytes)
    except Exception as e:
        log.warning(f"plant initial timeline photo failed for {pid}: {e}")
    _schedule_first_reminder(db, pid, family_id, int(info.get("water_interval_days") or 7))
    db.commit()
    row = db.execute("SELECT * FROM plants WHERE id=?", (pid,)).fetchone()
    return _plant_view(dict(row))


@app.post("/api/plants")
async def plants_create(
    file: UploadFile = File(...),
    custom_name: str = Form(""),
    user=Depends(get_uf), db=Depends(get_db),
):
    """Create a new plant from a photo. AI identifies the species + watering schedule + tips,
    then we save the row, the image, and schedule the first reminder. If the AI is uncertain
    (returns `candidates` array), we return them to the client for user selection — the
    finalize endpoint then creates the plant from the chosen candidate."""
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "AI not configured")
    info = await _identify_plant_image(data)
    if not info:
        raise HTTPException(502, "AI request failed")
    # Branch 1: AI provided candidates (uncertain) — return them, don't create yet
    if isinstance(info.get("candidates"), list) and info["candidates"]:
        # Validate each has the required fields
        valid = [c for c in info["candidates"] if c.get("species") and c.get("latin_name")]
        if valid:
            return {"candidates": valid[:3]}
        # Fall through to error if candidates were malformed
    # Branch 2: AI gave up
    if info.get("error"):
        raise HTTPException(400, info["error"])
    # Branch 3: confident answer
    if info.get("confidence", 0) < 0.4:
        raise HTTPException(400, "Couldn't identify the plant — try another photo with better lighting")
    if not (info.get("species") and info.get("latin_name")):
        raise HTTPException(400, "AI returned incomplete data — try again")
    return _create_plant_from_info(db, user["family_id"], user["id"], info, custom_name, data)


class PlantFinalize(BaseModel):
    species: str
    latin_name: str
    water_interval_days: int = 7
    light: str = ""
    care_tips: list[str] = []
    custom_name: str = ""


@app.post("/api/plants/finalize")
async def plants_finalize(
    file: UploadFile = File(...),
    candidate: str = Form(""),
    custom_name: str = Form(""),
    user=Depends(get_uf), db=Depends(get_db),
):
    """Create a plant from a user-chosen candidate (when AI returned multiple options).
    Frontend re-uploads the photo here along with the chosen candidate as a JSON string."""
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    try:
        cand = _json_mod.loads(candidate) if candidate else {}
    except Exception:
        raise HTTPException(400, "invalid candidate JSON")
    if not (cand.get("species") and cand.get("latin_name")):
        raise HTTPException(400, "candidate is missing species/latin_name")
    return _create_plant_from_info(db, user["family_id"], user["id"], cand, custom_name, data)


class PlantEdit(BaseModel):
    custom_name: str | None = None
    species: str | None = None
    latin_name: str | None = None
    water_interval_days: int | None = None
    light: str | None = None
    care_tips: list[str] | None = None
    notes: str | None = None
    stage: str | None = None  # seed | sprout | young | mature
    voice_overrides: dict | None = None  # {ok?, soon?, thirsty?} — any subset


@app.patch("/api/plants/{pid}")
def plants_update(pid: int, body: PlantEdit, user=Depends(get_uf), db=Depends(get_db)):
    """Edit a plant. Changing water_interval_days re-schedules the next reminder."""
    row = db.execute("SELECT * FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    payload = body.dict(exclude_unset=True)
    if "stage" in payload and payload["stage"] not in ("seed", "sprout", "young", "mature", None):
        del payload["stage"]
    if "care_tips" in payload and payload["care_tips"] is not None:
        payload["care_tips"] = _json_mod.dumps(payload["care_tips"], ensure_ascii=False)
    if "voice_overrides" in payload:
        # Strip empties: if all three values are blank, store NULL so client falls back to bank
        vo = payload["voice_overrides"] or {}
        cleaned = {k: v.strip() for k, v in vo.items() if isinstance(v, str) and v.strip()}
        payload["voice_overrides"] = _json_mod.dumps(cleaned, ensure_ascii=False) if cleaned else None
    interval_changed = "water_interval_days" in payload and payload["water_interval_days"] != row["water_interval_days"]
    if payload:
        sets, params = [], []
        for k, v in payload.items():
            sets.append(f"{k}=?"); params.append(v)
        params.append(pid)
        db.execute(f"UPDATE plants SET {','.join(sets)} WHERE id=?", params)
    if interval_changed:
        # Reschedule pending reminders to reflect the new interval
        db.execute("UPDATE plant_reminders SET sent=1 WHERE plant_id=? AND sent=0", (pid,))
        base = row["last_watered"] or row["added_at"]
        try:
            base_dt = datetime.fromisoformat(base.replace("Z", "+00:00").split(".")[0])
            if base_dt.tzinfo is None: base_dt = base_dt.replace(tzinfo=ZoneInfo(TIMEZONE))
        except Exception:
            base_dt = datetime.now(ZoneInfo(TIMEZONE))
        remind_at = (base_dt + timedelta(days=payload["water_interval_days"])).strftime("%Y-%m-%d %H:%M")
        db.execute("INSERT INTO plant_reminders (plant_id, family_id, remind_at) VALUES (?, ?, ?)",
                   (pid, user["family_id"], remind_at))
    db.commit()
    fresh = db.execute("SELECT * FROM plants WHERE id=?", (pid,)).fetchone()
    return _plant_view(dict(fresh))


@app.post("/api/plants/{pid}/water")
def plants_water(pid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Toggle today's watering. If already watered today → UNDO (delete today's log,
    reset last_watered to the previous max, re-schedule next reminder from that base).
    Otherwise → WATER (log, mark pending reminder sent, schedule next reminder)."""
    row = db.execute("SELECT * FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    row_d = dict(row)
    interval = row_d.get("water_interval_days") or 7
    now_dt = datetime.now(ZoneInfo(TIMEZONE))

    if _watered_today(row_d):
        # ─── UNDO ────────────────────────────────────────
        today_iso = now_dt.date().isoformat()
        db.execute("DELETE FROM plant_waterings WHERE plant_id=? AND date(watered_at)=?", (pid, today_iso))
        prev = db.execute("SELECT MAX(watered_at) AS m FROM plant_waterings WHERE plant_id=?", (pid,)).fetchone()
        new_last = prev["m"] if prev and prev["m"] else None
        db.execute("UPDATE plants SET last_watered=? WHERE id=?", (new_last, pid))
        # Reset reminder queue: drop pending, schedule a fresh one based on the new base
        db.execute("DELETE FROM plant_reminders WHERE plant_id=? AND sent=0", (pid,))
        base_dt = now_dt
        if new_last:
            try:
                bdt = datetime.fromisoformat(str(new_last).replace("Z", "+00:00").split(".")[0])
                if bdt.tzinfo is None: bdt = bdt.replace(tzinfo=ZoneInfo(TIMEZONE))
                base_dt = bdt
            except Exception:
                pass
        remind_at = (base_dt + timedelta(days=interval)).strftime("%Y-%m-%d %H:%M")
        db.execute("INSERT INTO plant_reminders (plant_id, family_id, remind_at) VALUES (?, ?, ?)",
                   (pid, user["family_id"], remind_at))
        db.commit()
        fresh = db.execute("SELECT * FROM plants WHERE id=?", (pid,)).fetchone()
        return _plant_view(dict(fresh))

    # ─── WATER (normal path) ───────────────────────────
    now_iso = now_dt.isoformat()
    db.execute("UPDATE plants SET last_watered=? WHERE id=?", (now_iso, pid))
    db.execute("INSERT INTO plant_waterings (plant_id, watered_by) VALUES (?, ?)", (pid, user["id"]))
    db.execute("UPDATE plant_reminders SET sent=1 WHERE plant_id=? AND sent=0", (pid,))
    remind_at = (now_dt + timedelta(days=interval)).strftime("%Y-%m-%d %H:%M")
    db.execute("INSERT INTO plant_reminders (plant_id, family_id, remind_at) VALUES (?, ?, ?)",
               (pid, user["family_id"], remind_at))
    db.commit()
    fresh = db.execute("SELECT * FROM plants WHERE id=?", (pid,)).fetchone()
    return _plant_view(dict(fresh))


@app.post("/api/plants/{pid}/image")
async def plants_image_upload(pid: int, file: UploadFile = File(...), user=Depends(get_uf), db=Depends(get_db)):
    """Replace a plant's photo without re-identifying."""
    row = db.execute("SELECT id FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    os.makedirs(PLANTS_IMG_DIR, exist_ok=True)
    with open(os.path.join(PLANTS_IMG_DIR, f"{pid}.jpg"), "wb") as f:
        f.write(data)
    return {"ok": True, "size": len(data)}


@app.get("/api/plants/{pid}/history")
def plants_history(pid: int, days: int = 30, user=Depends(get_uf), db=Depends(get_db)):
    """Watering history for the last N days. Returns:
       - dates: list of ISO dates (YYYY-MM-DD) within window
       - water_days: subset of `dates` that had at least one watering
       - count: total waterings in window
       - avg_interval_days: rolling average between consecutive waterings (or null if <2)"""
    row = db.execute("SELECT id, water_interval_days FROM plants WHERE id=? AND family_id=?",
                     (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    days = max(7, min(120, days))
    since = (datetime.now(ZoneInfo(TIMEZONE)) - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = db.execute(
        "SELECT watered_at FROM plant_waterings WHERE plant_id=? AND watered_at>=? ORDER BY watered_at",
        (pid, since)).fetchall()
    water_days = sorted({(r["watered_at"] or "").split("T")[0].split(" ")[0] for r in rows if r["watered_at"]})
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    # Average interval
    avg = None
    if len(water_days) >= 2:
        parsed = sorted(datetime.fromisoformat(d).date() for d in water_days)
        gaps = [(parsed[i] - parsed[i-1]).days for i in range(1, len(parsed))]
        if gaps: avg = round(sum(gaps) / len(gaps), 1)
    return {
        "plant_id": pid,
        "days": days,
        "dates": dates,
        "water_days": water_days,
        "count": len(water_days),
        "avg_interval_days": avg,
        "target_interval_days": row["water_interval_days"],
    }


# ─── Growth timeline (v8.31.1) ──────────────────────────────────────
# Multiple dated photos per plant, stored at /app/frontend/plants/timeline/<id>.jpg
PLANTS_TIMELINE_DIR = os.path.join(PLANTS_IMG_DIR, "timeline")

@app.get("/api/plants/{pid}/photos")
def plants_photos_list(pid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Chronological photos for one plant — NEWEST first (v8.49.5).
    The Update button is pinned on the left of the strip; newest photos sit
    right next to it and the strip scrolls horizontally toward older entries.
    (v8.49.3 had this ASC — UX feedback in v8.49.5 reverted to DESC.)"""
    row = db.execute("SELECT id FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    rows = db.execute(
        "SELECT id, caption, taken_at, added_by, ai_analysis FROM plant_photos WHERE plant_id=? ORDER BY taken_at DESC, id DESC",
        (pid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        # Parse stored ai_analysis JSON so the frontend doesn't have to.
        if d.get("ai_analysis"):
            try: d["ai_analysis"] = _json_mod.loads(d["ai_analysis"])
            except Exception: d["ai_analysis"] = None
        out.append(d)
    return {"photos": out}


@app.post("/api/plants/{pid}/photos")
async def plants_photos_add(
    pid: int,
    file: UploadFile = File(...),
    caption: str = Form(""),
    analyze: str = Form(""),   # "1" triggers the Sonnet health-check (v8.46.0)
    user=Depends(get_uf), db=Depends(get_db),
):
    """Add a new timeline photo. Stored at /app/frontend/plants/timeline/<photo_id>.jpg.

    When `analyze=1` (sent by the "Update" button in the Plants tab), the photo
    is also passed to Claude Sonnet vision which returns a structured health
    assessment {status, summary, issues, advice}. Saved as JSON in `ai_analysis`
    and returned in the response so the frontend can immediately show a result
    modal without a second round-trip.
    """
    row = db.execute("SELECT * FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    row_d = dict(row)

    # ─── v8.49.3: latest-becomes-cover, original-preserved-in-timeline ────────
    # Behaviour: the plant's hero image (/static/plants/<pid>.jpg) is overwritten
    # with the newly-uploaded photo so the carousel/big-card always shows the
    # most recent state. The previous cover is preserved as a timeline entry
    # tagged with the plant's added_at, so the timeline strip can show "first by
    # chronology" with the original date.
    #
    # On first Update for a pre-v8.49.3 plant, plant_photos is empty but a cover
    # file exists from creation — we migrate that cover into a timeline row
    # (copy file, INSERT row with taken_at = plant.added_at) BEFORE overwriting.
    cover_path = os.path.join(PLANTS_IMG_DIR, f"{pid}.jpg")
    os.makedirs(PLANTS_TIMELINE_DIR, exist_ok=True)

    photo_count = db.execute(
        "SELECT COUNT(*) AS n FROM plant_photos WHERE plant_id=?", (pid,)
    ).fetchone()["n"]
    if photo_count == 0 and os.path.isfile(cover_path):
        # Backfill the original cover as the very first timeline entry.
        orig_cur = db.execute(
            "INSERT INTO plant_photos (plant_id, caption, taken_at, added_by) VALUES (?, ?, ?, ?)",
            (pid, "", row_d.get("added_at") or None, row_d.get("added_by"))
        )
        orig_pid = orig_cur.lastrowid
        try:
            shutil.copyfile(cover_path, os.path.join(PLANTS_TIMELINE_DIR, f"{orig_pid}.jpg"))
        except Exception as e:
            log.warning(f"cover-to-timeline backfill failed for plant {pid}: {e}")

    # Run Sonnet check on the NEW photo (before INSERT) — if it fails we still save the photo.
    analysis = None
    if analyze == "1":
        lang_row = db.execute("SELECT lang FROM family_members WHERE user_id=?", (user["id"],)).fetchone()
        ulang = (lang_row["lang"] if lang_row and lang_row["lang"] else "en")
        analysis = await _assess_plant_health(row_d, data, language=ulang)

    # Save NEW photo: timeline row + file
    cur = db.execute(
        "INSERT INTO plant_photos (plant_id, caption, added_by, ai_analysis) VALUES (?, ?, ?, ?)",
        (pid, (caption or "").strip(), user["id"], _json_mod.dumps(analysis) if analysis else None))
    photo_id = cur.lastrowid
    with open(os.path.join(PLANTS_TIMELINE_DIR, f"{photo_id}.jpg"), "wb") as f:
        f.write(data)
    # Promote new photo to cover. Best-effort — if write fails, the timeline row
    # is still saved so the user doesn't lose the upload.
    try:
        with open(cover_path, "wb") as f:
            f.write(data)
    except Exception as e:
        log.warning(f"cover overwrite failed for plant {pid}: {e}")

    db.commit()
    fresh = db.execute("SELECT id, caption, taken_at, added_by FROM plant_photos WHERE id=?", (photo_id,)).fetchone()
    out = dict(fresh)
    out["ai_analysis"] = analysis
    out["cover_updated"] = True  # frontend uses this to bust cover image cache
    return out


@app.patch("/api/plants/photos/{photo_id}")
def plants_photos_edit(photo_id: int, caption: str = Form(""), user=Depends(get_uf), db=Depends(get_db)):
    """Edit caption only (photo file is immutable)."""
    row = db.execute(
        """SELECT pp.id FROM plant_photos pp JOIN plants p ON p.id=pp.plant_id
           WHERE pp.id=? AND p.family_id=?""", (photo_id, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    db.execute("UPDATE plant_photos SET caption=? WHERE id=?", ((caption or "").strip(), photo_id))
    db.commit()
    return {"ok": True}


@app.delete("/api/plants/photos/{photo_id}")
def plants_photos_delete(photo_id: int, user=Depends(get_uf), db=Depends(get_db)):
    """Delete a timeline photo (row + file)."""
    row = db.execute(
        """SELECT pp.id FROM plant_photos pp JOIN plants p ON p.id=pp.plant_id
           WHERE pp.id=? AND p.family_id=?""", (photo_id, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    db.execute("DELETE FROM plant_photos WHERE id=?", (photo_id,))
    db.commit()
    fp = os.path.join(PLANTS_TIMELINE_DIR, f"{photo_id}.jpg")
    if os.path.isfile(fp):
        try: os.remove(fp)
        except Exception as e: log.warning(f"plant timeline photo delete failed: {e}")
    return {"ok": True}


@app.delete("/api/plants/{pid}")
def plants_delete(pid: int, user=Depends(get_uf), db=Depends(get_db)):
    """Hard-delete plant + waterings + reminders + photos + on-disk images."""
    row = db.execute("SELECT id FROM plants WHERE id=? AND family_id=?", (pid, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    # Cascade-delete timeline photos (DB rows + files)
    photo_ids = [r["id"] for r in db.execute("SELECT id FROM plant_photos WHERE plant_id=?", (pid,)).fetchall()]
    db.execute("DELETE FROM plant_photos WHERE plant_id=?", (pid,))
    db.execute("DELETE FROM plant_reminders WHERE plant_id=?", (pid,))
    db.execute("DELETE FROM plant_waterings WHERE plant_id=?", (pid,))
    db.execute("DELETE FROM plants WHERE id=?", (pid,))
    db.commit()
    for phid in photo_ids:
        ph_fp = os.path.join(PLANTS_TIMELINE_DIR, f"{phid}.jpg")
        if os.path.isfile(ph_fp):
            try: os.remove(ph_fp)
            except Exception: pass
    fp = os.path.join(PLANTS_IMG_DIR, f"{pid}.jpg")
    if os.path.isfile(fp):
        try: os.remove(fp)
        except Exception as e: log.warning(f"plant image delete failed: {e}")
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

# ═════════════════════════════════════════════════════════════════════════
# 🍳 COOKING (v8.48.0)
# ═════════════════════════════════════════════════════════════════════════
# Family-shared dish book. Each dish has an image, name, servings, optional
# cook time + description, and an ordered ingredient list. Ingredient prices
# are captured at save time but the picker can also auto-fetch the latest
# price for a name from the shopping table (price-lookup endpoint).
#
# Cost per serving = sum(ingredient.price) / servings. We send both the total
# and the per-serving figure in the dish view so the frontend can render the
# reference design without doing arithmetic.

DISHES_IMG_DIR = os.environ.get("DISHES_IMG_DIR", "/app/frontend/dishes")


def _dish_total(ings: list[dict]) -> float:
    """Sum of per-line prices. Missing/null prices count as 0."""
    return round(sum(float(i.get("price") or 0) for i in ings), 2)


def _dish_view(d: dict, ingredients: list[dict]) -> dict:
    """Return the shape the frontend renders."""
    servings = int(d.get("servings") or 1) or 1
    total = _dish_total(ingredients)
    return {
        "id": d["id"],
        "name": d.get("name") or "",
        "description": d.get("description") or "",
        "servings": servings,
        "cook_time_min": d.get("cook_time_min"),
        "favorite": int(d.get("favorite") or 0) == 1,
        "added_by": d.get("added_by"),
        "added_at": d.get("added_at"),
        "ingredients": ingredients,
        "total_cost": total,
        "cost_per_serving": round(total / servings, 2) if servings else 0,
        "has_image": os.path.isfile(os.path.join(DISHES_IMG_DIR, f"{d['id']}.jpg")),
    }


def _dish_ingredients(db, did: int) -> list[dict]:
    rows = db.execute(
        "SELECT id, name, quantity, unit, price, sort_order FROM dish_ingredients "
        "WHERE dish_id=? ORDER BY sort_order, id", (did,)
    ).fetchall()
    return [dict(r) for r in rows]


def _shopping_price_for(db, family_id: int, name: str) -> dict | None:
    """Look up the most recent shopping row matching `name` (case-insensitive,
    trimmed). Returns {price, quantity, unit, item} or None if no match.

    Strategy: exact lowered match first (most precise), then fall back to a
    LIKE for partial matches. Latest row wins so newer prices take priority."""
    if not name or not name.strip():
        return None
    nm = name.strip().lower()
    # Exact match first
    row = db.execute(
        "SELECT item, quantity, price FROM shopping "
        "WHERE family_id=? AND LOWER(TRIM(item))=? AND price IS NOT NULL "
        "ORDER BY id DESC LIMIT 1", (family_id, nm)
    ).fetchone()
    if not row:
        # Loose LIKE fallback — helps "Eggs" find "Eggs (large)" if it exists
        row = db.execute(
            "SELECT item, quantity, price FROM shopping "
            "WHERE family_id=? AND LOWER(item) LIKE ? AND price IS NOT NULL "
            "ORDER BY id DESC LIMIT 1", (family_id, f"%{nm}%")
        ).fetchone()
    if not row:
        return None
    return {
        "item": row["item"],
        "quantity": row["quantity"],
        "price": float(row["price"] or 0),
    }


@app.get("/api/dishes")
def dishes_list(user=Depends(get_uf), db=Depends(get_db)):
    """Cards-grid summary — fetches each dish + its ingredients (joined) so the
    list view can show cost-per-serving without N+1 round trips."""
    rows = db.execute(
        "SELECT * FROM dishes WHERE family_id=? ORDER BY favorite DESC, id DESC",
        (user["family_id"],)
    ).fetchall()
    dishes = []
    total_all = 0.0
    for r in rows:
        d = dict(r)
        ings = _dish_ingredients(db, d["id"])
        view = _dish_view(d, ings)
        # Trim ingredient detail for the list endpoint (only need totals + count).
        view["ingredient_count"] = len(ings)
        del view["ingredients"]
        dishes.append(view)
        total_all += view["total_cost"]
    return {"dishes": dishes, "total_cost_all": round(total_all, 2)}


@app.get("/api/dishes/price-lookup")
def dishes_price_lookup_early(name: str, user=Depends(get_uf), db=Depends(get_db)):
    """Resolve the latest known shopping price for an ingredient name.
    Declared BEFORE /api/dishes/{did} so the literal "price-lookup" segment
    isn't first parsed as an int (which would yield 422 before our handler ran).
    The actual implementation lives at this single endpoint."""
    hit = _shopping_price_for(db, user["family_id"], name)
    return hit or {"price": None}


@app.get("/api/dishes/{did}")
def dishes_detail(did: int, user=Depends(get_uf), db=Depends(get_db)):
    row = db.execute("SELECT * FROM dishes WHERE id=? AND family_id=?", (did, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    return _dish_view(dict(row), _dish_ingredients(db, did))


class DishIngredientIn(BaseModel):
    name: str
    quantity: float | None = None
    unit: str | None = None
    price: float | None = None


class DishCreate(BaseModel):
    name: str
    description: str | None = ""
    servings: int = 2
    cook_time_min: int | None = None
    ingredients: list[DishIngredientIn] = []


def _save_ingredients(db, did: int, ingredients: list[dict]):
    """Replace the full ingredient list atomically — easier semantics than diff/merge
    for the frontend (it always sends the canonical state)."""
    db.execute("DELETE FROM dish_ingredients WHERE dish_id=?", (did,))
    for i, ing in enumerate(ingredients):
        name = (ing.get("name") or "").strip()
        if not name: continue
        db.execute(
            "INSERT INTO dish_ingredients (dish_id, name, quantity, unit, price, sort_order) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (did, name,
             float(ing["quantity"]) if ing.get("quantity") not in (None, "") else None,
             (ing.get("unit") or "").strip() or None,
             float(ing["price"]) if ing.get("price") not in (None, "") else None,
             i)
        )


@app.post("/api/dishes")
def dishes_create(body: DishCreate, user=Depends(get_uf), db=Depends(get_db)):
    """Create a dish (sans image — upload separately via /api/dishes/{id}/image)."""
    name = (body.name or "").strip()
    if not name: raise HTTPException(400, "name required")
    servings = max(1, int(body.servings or 1))
    cur = db.execute(
        "INSERT INTO dishes (family_id, name, description, servings, cook_time_min, added_by) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user["family_id"], name, (body.description or "").strip(), servings,
         body.cook_time_min, user["id"])
    )
    did = cur.lastrowid
    _save_ingredients(db, did, [i.dict() for i in body.ingredients])
    db.commit()
    row = db.execute("SELECT * FROM dishes WHERE id=?", (did,)).fetchone()
    return _dish_view(dict(row), _dish_ingredients(db, did))


class DishEdit(BaseModel):
    name: str | None = None
    description: str | None = None
    servings: int | None = None
    cook_time_min: int | None = None
    favorite: bool | None = None
    ingredients: list[DishIngredientIn] | None = None  # full replacement when present


@app.patch("/api/dishes/{did}")
def dishes_update(did: int, body: DishEdit, user=Depends(get_uf), db=Depends(get_db)):
    row = db.execute("SELECT * FROM dishes WHERE id=? AND family_id=?", (did, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    payload = body.dict(exclude_unset=True)
    ings = payload.pop("ingredients", None)
    if "favorite" in payload:
        payload["favorite"] = 1 if payload["favorite"] else 0
    if "servings" in payload and payload["servings"] is not None:
        payload["servings"] = max(1, int(payload["servings"]))
    if payload:
        sets, params = [], []
        for k, v in payload.items():
            sets.append(f"{k}=?"); params.append(v)
        params.append(did)
        db.execute(f"UPDATE dishes SET {','.join(sets)} WHERE id=?", params)
    if ings is not None:
        _save_ingredients(db, did, [i if isinstance(i, dict) else i.dict() for i in ings])
    db.commit()
    fresh = db.execute("SELECT * FROM dishes WHERE id=?", (did,)).fetchone()
    return _dish_view(dict(fresh), _dish_ingredients(db, did))


@app.delete("/api/dishes/{did}")
def dishes_delete(did: int, user=Depends(get_uf), db=Depends(get_db)):
    row = db.execute("SELECT id FROM dishes WHERE id=? AND family_id=?", (did, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    db.execute("DELETE FROM dish_ingredients WHERE dish_id=?", (did,))
    db.execute("DELETE FROM dishes WHERE id=?", (did,))
    db.commit()
    # Best-effort image cleanup
    try:
        fp = os.path.join(DISHES_IMG_DIR, f"{did}.jpg")
        if os.path.isfile(fp): os.remove(fp)
    except Exception:
        pass
    return {"ok": True}


@app.post("/api/dishes/{did}/image")
async def dishes_image_upload(did: int, file: UploadFile = File(...), user=Depends(get_uf), db=Depends(get_db)):
    """Upload or replace a dish photo."""
    row = db.execute("SELECT id FROM dishes WHERE id=? AND family_id=?", (did, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    if (file.content_type or "").split("/")[0] != "image":
        raise HTTPException(400, "not an image")
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "empty or too large (max 5 MB)")
    os.makedirs(DISHES_IMG_DIR, exist_ok=True)
    with open(os.path.join(DISHES_IMG_DIR, f"{did}.jpg"), "wb") as f:
        f.write(data)
    return {"ok": True, "size": len(data)}


class DishToShoppingBody(BaseModel):
    folder_id: int | None = None


@app.post("/api/dishes/{did}/add-to-shopping")
def dishes_to_shopping(did: int, body: DishToShoppingBody, user=Depends(get_uf), db=Depends(get_db)):
    """Push every ingredient of the dish onto the family shopping list as
    individual rows. Quantity comes from the dish ingredient ("200 g", "2 pcs",
    etc.) so the shopper sees how much to buy."""
    row = db.execute("SELECT id FROM dishes WHERE id=? AND family_id=?", (did, user["family_id"])).fetchone()
    if not row: raise HTTPException(404)
    ings = _dish_ingredients(db, did)
    added = []
    for ing in ings:
        nm = (ing.get("name") or "").strip()
        if not nm: continue
        qty_parts = []
        if ing.get("quantity") not in (None, ""): qty_parts.append(str(ing["quantity"]).rstrip("0").rstrip("."))
        if ing.get("unit"): qty_parts.append(str(ing["unit"]))
        qty_str = " ".join(p for p in qty_parts if p) or None
        cur = db.execute(
            "INSERT INTO shopping (family_id, item, quantity, price, added_by, folder_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user["family_id"], nm, qty_str, ing.get("price"),
             user["first_name"], body.folder_id)
        )
        added.append({"id": cur.lastrowid, "item": nm, "quantity": qty_str})
    db.commit()
    return {"ok": True, "added": added, "count": len(added)}


@app.get("/api/dishes/{did}/image")
def dishes_image_get(did: int):
    """Serve the dish photo. Public-ish (anyone with the dish id) — same
    pattern as plant images. Cache for 24h."""
    fp = os.path.join(DISHES_IMG_DIR, f"{did}.jpg")
    if not os.path.isfile(fp): raise HTTPException(404)
    r = FileResponse(fp, media_type="image/jpeg")
    r.headers["Cache-Control"] = "public, max-age=86400"
    return r


# ═════════════════════════════════════════════════════════════════════════
# 🌱 LIFE — habit / balance network (v8.51.0)
# ═════════════════════════════════════════════════════════════════════════
# Two area sets live here as code constants (no `areas` table). Each habit
# feeds exactly one area and belongs to an owner: a member's user_id (personal
# growth) or the literal 'family' (relationship layer). Node name/emoji can be
# customized per (owner, area) via node_overrides (long-press edit) — defaults
# below are the fallback.
#
# To re-theme the six nodes later, edit these constants — nothing else depends
# on the specific ids beyond the override/habit rows that reference them.

# Personal life areas (v8.52.3). Bilingual names — the display name follows the
# VIEWER's UI language (name_en / name_ru). `health` keeps its id so any habits
# created under the old set survive.
PERSONAL_AREAS = [
    {"id": "fun",      "name_en": "Fun",         "name_ru": "Развлечения",  "emoji": "🎉",  "color": "#E8714A"},
    {"id": "rest",     "name_en": "Rest",        "name_ru": "Отдых",        "emoji": "🛋️", "color": "#6BB0D4"},
    {"id": "hobby",    "name_en": "Hobby",       "name_ru": "Хобби",        "emoji": "🎨",  "color": "#C77DBB"},
    {"id": "friends",  "name_en": "Friends",     "name_ru": "Друзья",       "emoji": "👥",  "color": "#E8A24A"},
    {"id": "health",   "name_en": "Health",      "name_ru": "Здоровье",     "emoji": "🌿",  "color": "#5FB37A"},
    {"id": "selfdev",  "name_en": "Self-growth", "name_ru": "Саморазвитие", "emoji": "📈",  "color": "#8B7BE8"},
    {"id": "career",   "name_en": "Career",      "name_ru": "Карьера",      "emoji": "💼",  "color": "#6B8FD4"},
    {"id": "family",   "name_en": "Family",      "name_ru": "Семья",        "emoji": "🏡",  "color": "#E8C54A"},
]
RELATIONSHIP_AREAS = [
    {"id": "rel_time",      "name": "Time Together", "emoji": "🕯", "color": "#E8A24A"},
    {"id": "rel_comm",      "name": "Communication", "emoji": "💬", "color": "#6B8FD4"},
    {"id": "rel_affection", "name": "Affection",     "emoji": "❤️", "color": "#E06A8A"},
    {"id": "rel_goals",     "name": "Shared Goals",  "emoji": "🎯", "color": "#8B7BE8"},
    {"id": "rel_joy",       "name": "Joy",           "emoji": "✨", "color": "#E8C54A"},
    {"id": "rel_care",      "name": "Care",          "emoji": "🤝", "color": "#5FB37A"},
]
_PERSONAL_IDS = {a["id"] for a in PERSONAL_AREAS}
_PERSONAL_BY_ID = {a["id"]: a for a in PERSONAL_AREAS}
_REL_IDS = {a["id"] for a in RELATIONSHIP_AREAS}
_REL_BY_ID = {a["id"]: a for a in RELATIONSHIP_AREAS}
_VALID_HABIT_TYPES = {"build", "maintain", "reduce"}


def _life_default_areas_for(owner: str) -> list[dict]:
    """The seed/default constant set for a scope."""
    return RELATIONSHIP_AREAS if owner == "family" else PERSONAL_AREAS


def _life_const_by_id(owner: str) -> dict:
    return _REL_BY_ID if owner == "family" else _PERSONAL_BY_ID
# Palette offered for custom spheres (must be a hex the frontend picker also shows).
_LIFE_AREA_COLORS = ["#8B7BE8", "#E8A24A", "#5FB37A", "#6B8FD4", "#C77DBB",
                     "#E8C54A", "#E8714A", "#6BB0D4", "#E06A8A", "#7FB069"]


def _life_seed_areas(db, family_id: int, owner: str):
    """Seed an owner's area set from the scope defaults on first access (personal
    → PERSONAL_AREAS, family → RELATIONSHIP_AREAS). Default rows carry NULL
    name/emoji/color so they keep resolving from the constants."""
    has = db.execute("SELECT 1 FROM life_areas WHERE family_id=? AND owner=? LIMIT 1",
                     (family_id, owner)).fetchone()
    if has:
        return
    for i, a in enumerate(_life_default_areas_for(owner)):
        db.execute(
            "INSERT OR IGNORE INTO life_areas (family_id, owner, area_key, is_custom, sort_order) "
            "VALUES (?, ?, ?, 0, ?)", (family_id, owner, a["id"], i))
    db.commit()


def _life_effective_areas(db, family_id: int, owner: str, lang: str = "en") -> list[dict]:
    """The owner's area set with display name/emoji/color resolved. Both scopes
    are data-backed (life_areas, seeded from constants). Renames ride on
    node_overrides; default rows fall back to the scope constant."""
    ov = {r["area_id"]: r for r in db.execute(
        "SELECT area_id, name, emoji FROM node_overrides WHERE family_id=? AND owner=?",
        (family_id, owner)).fetchall()}
    _life_seed_areas(db, family_id, owner)
    const_by_id = _life_const_by_id(owner)
    out = []
    rows = db.execute(
        "SELECT area_key, name, emoji, color, is_custom FROM life_areas "
        "WHERE family_id=? AND owner=? ORDER BY sort_order, id", (family_id, owner)).fetchall()
    for r in rows:
        key = r["area_key"]
        const = const_by_id.get(key)
        if r["is_custom"] or not const:
            base_name, base_emoji, base_color = (r["name"] or key), (r["emoji"] or "🌱"), (r["color"] or "#8B7BE8")
        else:
            base_name, base_emoji, base_color = _life_area_name(const, lang), const["emoji"], const["color"]
        o = ov.get(key)
        out.append({
            "id": key,
            "name": (o["name"] if o and o["name"] else base_name),
            "emoji": (o["emoji"] if o and o["emoji"] else base_emoji),
            "color": base_color,
            "customized": bool(o), "is_custom": bool(r["is_custom"]),
        })
    return out


def _life_valid_area_ids(db, family_id: int, owner: str) -> set:
    return {a["id"] for a in _life_effective_areas(db, family_id, owner)}


def _life_resolve_owner(owner: str | None, user: dict, db) -> str:
    """Normalize the owner param. Defaults to the current user. 'family' is
    allowed as-is. A numeric owner must be a real member of this family."""
    if not owner:
        return str(user["id"])
    if owner == "family":
        return "family"
    if not owner.isdigit():
        raise HTTPException(400, "bad owner")
    row = db.execute("SELECT user_id FROM family_members WHERE user_id=? AND family_id=?",
                     (int(owner), user["family_id"])).fetchone()
    if not row:
        raise HTTPException(404, "owner not in family")
    return owner


def _life_areas_for(owner: str) -> list[dict]:
    return RELATIONSHIP_AREAS if owner == "family" else PERSONAL_AREAS


def _life_area_name(area: dict, lang: str = "en") -> str:
    """Display name for an area in the viewer's language. Personal areas carry
    name_en/name_ru; relationship areas (untouched) still use a single `name`."""
    if lang == "ru" and area.get("name_ru"):
        return area["name_ru"]
    if area.get("name_en"):
        return area["name_en"]
    return area.get("name") or area["id"]


def _life_user_lang(db, user_id: int) -> str:
    row = db.execute("SELECT lang FROM family_members WHERE user_id=?", (user_id,)).fetchone()
    return (row["lang"] if row and row["lang"] else "en")


def _life_due_on(freq, d) -> bool:
    """Is the habit scheduled on date d? freq is None/'daily' → every day,
    or a list of weekday ints (0=Mon..6=Sun, matching date.weekday())."""
    if not freq or freq == "daily":
        return True
    if isinstance(freq, list):
        return d.weekday() in freq
    return True


def _life_local_date(ts: str | None):
    """Convert a stored timestamp into a calendar date in the app timezone.

    Habit `created_at` is written by SQLite `datetime('now')`, i.e. UTC. The
    consistency/streak math compares it against `today` computed in TIMEZONE.
    Between 22:00–24:00 UTC the Belgrade date is already "tomorrow", so a naive
    `.date()` on the UTC string lands a day-0 habit one calendar day early and
    inflates the scheduled-day count (consistency 0.5 instead of 1.0). Localise
    both sides to the same zone first. See Bugs & Fixes (life consistency flake)."""
    raw = (ts or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("T", " "))
    except ValueError:
        try:
            return date.fromisoformat(raw.split(" ")[0].split("T")[0])
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(ZoneInfo(TIMEZONE)).date()


def _life_cur_ym() -> str:
    """Current month bucket ('YYYY-MM') in the app timezone."""
    return datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m")


def _life_event_view(ev: dict) -> dict:
    """Shape one life_events row for the client. `count` is how many times the
    event was re-lived this month (the mechanic the old streak occupied)."""
    return {
        "id": ev["id"],
        "owner": ev["owner"],
        "area_id": ev["area_id"],
        "name": ev.get("name") or "",
        "emoji": ev.get("emoji") or "",
        "count": int(ev.get("count") or 1),
        "pinned": bool(ev.get("pinned") or 0),
        "ym": ev.get("ym"),
        "created_at": ev.get("created_at"),
        "last_at": ev.get("last_at"),
    }


def _life_roll_pinned(db, family_id: int, owner: str, ym: str):
    """Carry pinned events forward into the current month. A pinned event from a
    previous month is copied into `ym` (count reset to 1, still pinned) unless an
    event with the same name already exists there; the old row is then demoted
    (pinned=0) so it rolls exactly once — deleting the new copy won't resurrect it.
    Only ever rolls INTO the live current month."""
    if ym != _life_cur_ym():
        return
    try:
        rows = db.execute(
            "SELECT * FROM life_events WHERE family_id=? AND owner=? AND pinned=1 AND ym!=?",
            (family_id, owner, ym)).fetchall()
    except Exception:
        return
    if not rows:
        return
    now = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    changed = False
    for r in rows:
        exists = db.execute(
            "SELECT 1 FROM life_events WHERE family_id=? AND owner=? AND ym=? AND area_id=? AND name=?",
            (family_id, owner, ym, r["area_id"], r["name"])).fetchone()
        if not exists:
            db.execute(
                "INSERT INTO life_events (family_id, owner, area_id, name, emoji, ym, count, created_at, last_at, pinned) "
                "VALUES (?,?,?,?,?,?,1,?,?,1)",
                (family_id, owner, r["area_id"], r["name"], r["emoji"], ym, now, now))
        db.execute("UPDATE life_events SET pinned=0 WHERE id=?", (r["id"],))
        changed = True
    if changed:
        db.commit()


@app.get("/api/life/summary")
def life_summary(owner: str | None = None, ym: str | None = None,
                 user=Depends(get_uf), db=Depends(get_db)):
    """Constellation for one scope (a member's user_id, or 'family') and a month.
    Each area node reports `event_count` (distinct events logged that month) and a
    derived `brightness` (0..1) that fills/glows the node as more events land."""
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    ym = ym or _life_cur_ym()
    _life_roll_pinned(db, f, owner, ym)
    ulang = _life_user_lang(db, user["id"])  # display names follow the viewer's language
    areas = _life_effective_areas(db, f, owner, ulang)
    out = []
    for a in areas:
        cnt = db.execute(
            "SELECT COUNT(*) c FROM life_events WHERE family_id=? AND owner=? AND area_id=? AND ym=?",
            (f, owner, a["id"], ym)).fetchone()["c"]
        brightness = round(min(1.0, 0.15 * cnt), 2)  # +15% per distinct event (gentle fill)
        out.append({
            "id": a["id"],
            "name": a["name"], "emoji": a["emoji"], "color": a["color"],
            "brightness": brightness,
            "event_count": cnt,
            "habit_count": cnt,  # back-compat alias for the node sizer
            "customized": a["customized"], "is_custom": a["is_custom"],
        })
    # Family scope also reports overall bond strength = avg of area brightness.
    bond = round(sum(a["brightness"] for a in out) / len(out), 2) if out else 0.0
    members = [dict(m) for m in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?",
        (f,)).fetchall()]
    return {"owner": owner, "scope": ("family" if owner == "family" else "personal"),
            "ym": ym, "cur_ym": _life_cur_ym(),
            "areas": out, "bond": bond, "members": members}


def _life_validate_area(db, family_id: int, owner: str, area_id: str):
    if area_id not in _life_valid_area_ids(db, family_id, owner):
        raise HTTPException(400, f"area_id '{area_id}' not valid for this scope")


@app.get("/api/life/events")
def life_events_list(owner: str | None = None, area_id: str | None = None, ym: str | None = None,
                     user=Depends(get_uf), db=Depends(get_db)):
    """Events inside one area for one owner + month, each with its counter."""
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    ym = ym or _life_cur_ym()
    _life_roll_pinned(db, f, owner, ym)
    q = "SELECT * FROM life_events WHERE family_id=? AND owner=? AND ym=?"
    params = [f, owner, ym]
    if area_id:
        q += " AND area_id=?"
        params.append(area_id)
    rows = [dict(r) for r in db.execute(q + " ORDER BY id", params).fetchall()]
    return {"owner": owner, "area_id": area_id, "ym": ym, "cur_ym": _life_cur_ym(),
            "events": [_life_event_view(r) for r in rows]}


class EventCreate(BaseModel):
    owner: str | None = None         # '<user_id>' | 'family' | None (→ me)
    area_id: str
    name: str
    emoji: str | None = ""


@app.post("/api/life/events")
def life_event_create(body: EventCreate, user=Depends(get_uf), db=Depends(get_db)):
    """Log a new event into a sphere for the current month (counter starts at 1)."""
    f = user["family_id"]
    owner = _life_resolve_owner(body.owner, user, db)
    _life_validate_area(db, f, owner, body.area_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    ym = _life_cur_ym()
    now = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    cur = db.execute(
        """INSERT INTO life_events (family_id, owner, area_id, name, emoji, ym, count, created_at, last_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
        (f, owner, body.area_id, name, (body.emoji or "").strip(), ym, now, now))
    db.commit()
    row = dict(db.execute("SELECT * FROM life_events WHERE id=?", (cur.lastrowid,)).fetchone())
    return _life_event_view(row)


class EventBump(BaseModel):
    delta: int = 1  # +1 re-live / -1 correct a mis-tap (counter clamped ≥ 1)


@app.post("/api/life/events/{eid}/bump")
def life_event_bump(eid: int, body: EventBump, user=Depends(get_uf), db=Depends(get_db)):
    """Re-live an event → grow its counter. Current month only (past is read-only)."""
    f = user["family_id"]
    row = db.execute("SELECT * FROM life_events WHERE id=? AND family_id=?", (eid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    if row["ym"] != _life_cur_ym():
        raise HTTPException(400, "past month is read-only")
    new_count = max(1, int(row["count"] or 1) + (1 if body.delta >= 0 else -1))
    now = datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    db.execute("UPDATE life_events SET count=?, last_at=? WHERE id=?", (new_count, now, eid))
    db.commit()
    return _life_event_view(dict(db.execute("SELECT * FROM life_events WHERE id=?", (eid,)).fetchone()))


class EventEdit(BaseModel):
    name: str | None = None
    emoji: str | None = None


@app.patch("/api/life/events/{eid}")
def life_event_edit(eid: int, body: EventEdit, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    row = db.execute("SELECT * FROM life_events WHERE id=? AND family_id=?", (eid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    payload = body.dict(exclude_unset=True)
    sets, params = [], []
    for k in ("name", "emoji"):
        if k in payload and isinstance(payload[k], str):
            sets.append(f"{k}=?"); params.append(payload[k].strip())
    if sets:
        params.append(eid)
        db.execute(f"UPDATE life_events SET {','.join(sets)} WHERE id=?", params)
        db.commit()
    return _life_event_view(dict(db.execute("SELECT * FROM life_events WHERE id=?", (eid,)).fetchone()))


@app.delete("/api/life/events/{eid}")
def life_event_delete(eid: int, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    row = db.execute("SELECT id FROM life_events WHERE id=? AND family_id=?", (eid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    db.execute("DELETE FROM life_events WHERE id=?", (eid,))
    db.commit()
    return {"ok": True}


class EventPin(BaseModel):
    pinned: bool = True


@app.post("/api/life/events/{eid}/pin")
def life_event_pin(eid: int, body: EventPin, user=Depends(get_uf), db=Depends(get_db)):
    """Pin/unpin an event → pinned events carry over into next month."""
    f = user["family_id"]
    row = db.execute("SELECT * FROM life_events WHERE id=? AND family_id=?", (eid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    db.execute("UPDATE life_events SET pinned=? WHERE id=?", (1 if body.pinned else 0, eid))
    db.commit()
    return _life_event_view(dict(db.execute("SELECT * FROM life_events WHERE id=?", (eid,)).fetchone()))


class NodeOverride(BaseModel):
    name: str | None = None
    emoji: str | None = None


@app.put("/api/life/nodes/{area_id}")
def life_node_override(area_id: str, body: NodeOverride, owner: str | None = None,
                       user=Depends(get_uf), db=Depends(get_db)):
    """Long-press edit of a node's name/emoji. Empty name+emoji clears the override
    (falls back to the code default)."""
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    _life_validate_area(db, f, owner, area_id)
    name = (body.name or "").strip()
    emoji = (body.emoji or "").strip()
    if not name and not emoji:
        db.execute("DELETE FROM node_overrides WHERE family_id=? AND owner=? AND area_id=?",
                   (f, owner, area_id))
        db.commit()
        return {"ok": True, "cleared": True}
    db.execute(
        """INSERT INTO node_overrides (family_id, owner, area_id, name, emoji)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(family_id, owner, area_id) DO UPDATE SET name=?, emoji=?""",
        (f, owner, area_id, name or None, emoji or None, name or None, emoji or None))
    db.commit()
    return {"ok": True, "name": name, "emoji": emoji}


# ─── Add / delete personal spheres (v8.52.5) ─────────────────────────────
# Personal areas are editable per member: add a custom sphere or delete any.
# Relationship (family) areas stay fixed constants.

class AreaCreate(BaseModel):
    owner: str | None = None
    name: str
    emoji: str | None = "🌱"
    color: str | None = None


@app.post("/api/life/areas")
def life_area_create(body: AreaCreate, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(body.owner, user, db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    _life_seed_areas(db, f, owner)
    color = body.color if (body.color in _LIFE_AREA_COLORS) else _LIFE_AREA_COLORS[0]
    key = "u" + secrets.token_hex(4)  # stable, collision-safe custom key
    mx = db.execute("SELECT COALESCE(MAX(sort_order),0) m FROM life_areas WHERE family_id=? AND owner=?",
                    (f, owner)).fetchone()["m"]
    db.execute(
        "INSERT INTO life_areas (family_id, owner, area_key, name, emoji, color, is_custom, sort_order) "
        "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        (f, owner, key, name, (body.emoji or "🌱").strip(), color, mx + 1))
    db.commit()
    return {"ok": True, "id": key, "name": name, "emoji": (body.emoji or "🌱"), "color": color, "is_custom": True}


@app.delete("/api/life/areas/{area_key}")
def life_area_delete(area_key: str, owner: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    _life_seed_areas(db, f, owner)
    row = db.execute("SELECT id FROM life_areas WHERE family_id=? AND owner=? AND area_key=?",
                     (f, owner, area_key)).fetchone()
    if not row:
        raise HTTPException(404)
    # Cascade: drop the sphere, its rename-override, and all its events (all
    # months). Legacy habits/logs in the sphere are cleared too.
    n_ev = db.execute("SELECT COUNT(*) c FROM life_events WHERE family_id=? AND owner=? AND area_id=?",
                      (f, owner, area_key)).fetchone()["c"]
    db.execute("DELETE FROM life_events WHERE family_id=? AND owner=? AND area_id=?", (f, owner, area_key))
    hids = [r["id"] for r in db.execute(
        "SELECT id FROM habits WHERE family_id=? AND owner=? AND area_id=?", (f, owner, area_key)).fetchall()]
    for hid in hids:
        db.execute("DELETE FROM habit_logs WHERE habit_id=?", (hid,))
    db.execute("DELETE FROM habits WHERE family_id=? AND owner=? AND area_id=?", (f, owner, area_key))
    db.execute("DELETE FROM node_overrides WHERE family_id=? AND owner=? AND area_id=?", (f, owner, area_key))
    db.execute("DELETE FROM life_areas WHERE family_id=? AND owner=? AND area_key=?", (f, owner, area_key))
    db.commit()
    return {"ok": True, "deleted_events": n_ev, "deleted_habits": len(hids)}


# ─── AI habit suggestions (v8.52.0 · Phase 2) ────────────────────────────
# Tap "✨ Ideas" inside an area → Claude Haiku suggests a few NEW, concrete
# habits/rituals tailored to that sphere, aware of what's already there and
# whether it's a personal-growth area or a relationship dimension. Each
# suggestion is one tap away from becoming a real node.
_LIFE_SUGGEST_MODEL = "claude-haiku-4-5-20251001"


def _life_resolved_area_name(db, family_id: int, owner: str, area: dict, lang: str = "en") -> str:
    row = db.execute(
        "SELECT name FROM node_overrides WHERE family_id=? AND owner=? AND area_id=?",
        (family_id, owner, area["id"])).fetchone()
    return (row["name"] if row and row["name"] else _life_area_name(area, lang))


class LifeSuggestBody(BaseModel):
    owner: str | None = None
    area_id: str


@app.post("/api/life/suggest")
async def life_suggest(body: LifeSuggestBody, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(body.owner, user, db)
    _life_validate_area(db, f, owner, body.area_id)
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "AI not configured")
    is_family = (owner == "family")
    ulang = _life_user_lang(db, user["id"])
    area = next((a for a in _life_effective_areas(db, f, owner, ulang) if a["id"] == body.area_id), None)
    if not area:
        raise HTTPException(404)
    area_name = area["name"]
    existing = [r["name"] for r in db.execute(
        "SELECT name FROM habits WHERE family_id=? AND owner=? AND area_id=? AND archived=0",
        (f, owner, body.area_id)).fetchall()]
    lang_name = "Russian" if ulang == "ru" else "English"

    scope_desc = (
        "a dimension of their romantic relationship with their partner (suggest shared rituals the couple can do together)"
        if is_family else
        "a personal life area they want to grow"
    )
    existing_str = ", ".join(existing) if existing else "(none yet)"
    system = (
        f"You are a warm, practical habits coach. The user wants to strengthen \"{area_name}\", which is {scope_desc}. "
        f"They already have these habits there: {existing_str}. "
        f"Suggest 4 NEW, small, concrete, actionable habits or rituals that genuinely nurture this area. "
        f"Do NOT repeat existing ones. Keep each name short (max 4 words), specific, and doable. "
        f"Write the name and the one-line reason in {lang_name}. "
        f"Reply with ONLY a JSON array, each item: "
        f'{{"emoji": "<single emoji>", "name": "<short name>", "type": "build|maintain|reduce", "why": "<one short line>"}}'
    )
    try:
        async with httpx.AsyncClient(timeout=40) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }, json={
                "model": _LIFE_SUGGEST_MODEL,
                "max_tokens": 600,
                "system": system,
                "messages": [{"role": "user", "content": "Suggest habits. JSON array only."}],
            })
            data = r.json()
            text = (data.get("content", [{}])[0].get("text") or "").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            parsed = _json_mod.loads(text)
            out = []
            seen = {e.lower() for e in existing}
            for it in (parsed or [])[:5]:
                name = str(it.get("name") or "").strip()[:40]
                if not name or name.lower() in seen:
                    continue
                seen.add(name.lower())
                out.append({
                    "emoji": (str(it.get("emoji") or "🌱").strip() or "🌱")[:4],
                    "name": name,
                    "why": str(it.get("why") or "").strip()[:120],
                })
            if not out:
                raise HTTPException(502, "no suggestions")
            return {"area_id": body.area_id, "area_name": area_name, "suggestions": out[:4]}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"life suggest failed: {e}")
        raise HTTPException(502, "AI request failed")


# ─── Journey — balance/bond trend over time (v8.54.0 · Phase 2) ───────────
@app.get("/api/life/journey")
def life_journey(owner: str | None = None, ym: str | None = None, days: int = 30,
                 user=Depends(get_uf), db=Depends(get_db)):
    """Stats view for one scope + month: per-area event counts (balance bars), a
    per-day event sparkline, and headline counters (events / total taps / busiest)."""
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    ym = ym or _life_cur_ym()
    ulang = _life_user_lang(db, user["id"])

    _life_roll_pinned(db, f, owner, ym)
    events = [dict(e) for e in db.execute(
        "SELECT * FROM life_events WHERE family_id=? AND owner=? AND ym=?", (f, owner, ym)).fetchall()]

    areas = _life_effective_areas(db, f, owner, ulang)
    out_areas = []
    for a in areas:
        cnt = sum(1 for e in events if e["area_id"] == a["id"])
        bright = round(min(1.0, 0.15 * cnt), 2)
        out_areas.append({"id": a["id"], "name": a["name"], "emoji": a["emoji"],
                          "color": a["color"], "brightness": bright,
                          "habit_count": cnt, "event_count": cnt})
    balance = round(sum(x["brightness"] for x in out_areas) / len(out_areas), 2) if out_areas else 0.0

    # Per-day sparkline: events logged this month, bucketed by created_at local date.
    try:
        y, mo = int(ym.split("-")[0]), int(ym.split("-")[1])
        ndays = monthrange(y, mo)[1]
    except Exception:
        y, mo, ndays = datetime.now(ZoneInfo(TIMEZONE)).year, datetime.now(ZoneInfo(TIMEZONE)).month, 30
    day_map = {}
    for e in events:
        d = (e.get("created_at") or "")[:10]
        if d.startswith(ym):
            day_map[d] = day_map.get(d, 0) + 1
    daily = [{"date": f"{y:04d}-{mo:02d}-{i+1:02d}",
              "count": day_map.get(f"{y:04d}-{mo:02d}-{i+1:02d}", 0)} for i in range(ndays)]

    total_count = sum(int(e["count"] or 1) for e in events)
    top = max(events, key=lambda e: int(e["count"] or 1), default=None)
    return {
        "owner": owner, "scope": ("family" if owner == "family" else "personal"),
        "ym": ym, "cur_ym": _life_cur_ym(),
        "balance": balance, "areas": out_areas, "daily": daily,
        "stats": {
            "events": len(events),
            "total_count": total_count,
            "completions_7d": sum(x["count"] for x in daily[-7:]),
            "completions_30d": total_count,
            "top_event": (top["name"] if top else ""),
            "top_count": (int(top["count"] or 1) if top else 0),
        },
    }


# ─── Challenges — time-bound goals (v8.55.0 · Phase 3) ───────────────────
# v8.62.0: Life is now an event tracker; count/streak (which bound to habits)
# are retired. Only the manual 'score' scoreboard remains. Legacy count/streak
# rows still render via the helpers below, but new challenges are score-only.
_VALID_CHALLENGE_KINDS = {"score"}
_CHALLENGE_SUGGEST_MODEL = "claude-haiku-4-5-20251001"


def _life_challenge_habit_ids(db, ch: dict, family_id: int, owner: str) -> list[int]:
    """Habits a challenge counts: a specific habit, any in an area, or all."""
    if ch.get("habit_id"):
        r = db.execute("SELECT id FROM habits WHERE id=? AND family_id=? AND owner=?",
                       (ch["habit_id"], family_id, owner)).fetchone()
        return [r["id"]] if r else []
    q = "SELECT id FROM habits WHERE family_id=? AND owner=? AND archived=0"
    p = [family_id, owner]
    if ch.get("area_id"):
        q += " AND area_id=?"; p.append(ch["area_id"])
    return [r["id"] for r in db.execute(q, p).fetchall()]


def _life_challenge_progress(db, ch: dict, family_id: int, owner_str: str, start, window_end) -> int:
    """Progress for one owner: completions (count) or longest run (streak)."""
    hids = _life_challenge_habit_ids(db, ch, family_id, owner_str)
    if not hids or window_end <= start:
        return 0
    qmarks = ",".join("?" * len(hids))
    rows = db.execute(
        f"SELECT date FROM habit_logs WHERE done=1 AND habit_id IN ({qmarks}) AND date>=? AND date<?",
        hids + [start.isoformat(), window_end.isoformat()]).fetchall()
    dates = [r["date"] for r in rows]
    if ch.get("kind") == "streak":
        best = run = 0; prev = None
        for d in sorted(set(dates)):
            dd = datetime.fromisoformat(d).date()
            run = run + 1 if (prev and (dd - prev).days == 1) else 1
            best = max(best, run); prev = dd
        return best
    return len(dates)


def _life_challenge_view(db, ch: dict, family_id: int, owner: str, lang: str) -> dict:
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    try:
        start = datetime.fromisoformat(ch["start_date"]).date()
    except Exception:
        start = today
    period = int(ch.get("period_days") or 7)
    end = start + timedelta(days=period)
    window_end = min(end, today + timedelta(days=1))
    target = int(ch.get("target") or 1)
    closed = today >= end

    # Participants (per-person leaderboard) — JSON array of user_ids; None = solo.
    parts = None
    if ch.get("participants"):
        try: parts = [int(x) for x in _json_mod.loads(ch["participants"])]
        except Exception: parts = None

    # Resolve subject label (the area for personal areas; falls back across scopes)
    subject = None
    if ch.get("habit_id"):
        hr = db.execute("SELECT name FROM habits WHERE id=?", (ch["habit_id"],)).fetchone()
        subject = (hr["name"] if hr else None)
    elif ch.get("area_id"):
        const = _PERSONAL_BY_ID.get(ch["area_id"]) or _REL_BY_ID.get(ch["area_id"])
        subject = _life_area_name(const, lang) if const else ch["area_id"]

    base = {
        "id": ch["id"], "owner": owner, "title": ch.get("title") or "",
        "emoji": ch.get("emoji") or "🏆", "kind": ch.get("kind") or "count",
        "target": target, "habit_id": ch.get("habit_id"), "area_id": ch.get("area_id"),
        "subject": subject, "period_days": period, "start_date": ch.get("start_date"),
        "days_left": max(0, (end - today).days),
    }

    is_score = (ch.get("kind") == "score")
    scores = {}
    if is_score and ch.get("scores"):
        try: scores = {str(k): int(v) for k, v in _json_mod.loads(ch["scores"]).items()}
        except Exception: scores = {}

    if parts:
        rows = []
        for uid in parts:
            prog = scores.get(str(uid), 0) if is_score else _life_challenge_progress(db, ch, family_id, str(uid), start, window_end)
            rows.append({"user_id": uid, "progress": prog, "done": (target > 0 and prog >= target)})
        if is_score:
            status = "active" if not closed else "done"     # a tally: runs until the date
        else:
            all_done = bool(rows) and all(r["done"] for r in rows)
            status = "done" if all_done else ("failed" if closed else "active")
        base.update({
            "participants": rows,
            "progress": max([r["progress"] for r in rows], default=0),
            "status": status,
        })
        return base

    if is_score:
        # Solo score challenge: a single manual tally under the owner.
        prog = scores.get(str(owner) if not str(owner).isalpha() else owner, 0)
        if not prog and scores:
            prog = next(iter(scores.values()), 0)
        base.update({"participants": None, "progress": prog,
                     "status": ("active" if not closed else "done")})
        return base

    progress = _life_challenge_progress(db, ch, family_id, owner, start, window_end)
    done = progress >= target
    base.update({
        "participants": None,
        "progress": progress,
        "status": ("done" if done else ("failed" if closed else "active")),
    })
    return base


@app.get("/api/life/challenges")
def life_challenges_list(owner: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(owner, user, db)
    lang = _life_user_lang(db, user["id"])
    rows = db.execute("SELECT * FROM life_challenges WHERE family_id=? AND owner=? ORDER BY id DESC",
                      (f, owner)).fetchall()
    return {"owner": owner, "scope": ("family" if owner == "family" else "personal"),
            "challenges": [_life_challenge_view(db, dict(r), f, owner, lang) for r in rows]}


class ChallengeCreate(BaseModel):
    owner: str | None = None
    title: str
    emoji: str | None = "🏆"
    kind: str = "score"
    target: int = 5
    habit_id: int | None = None
    area_id: str | None = None
    period_days: int = 7
    participants: list[int] | None = None  # group challenge → per-person tracking


@app.post("/api/life/challenges")
def life_challenge_create(body: ChallengeCreate, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(body.owner, user, db)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "title required")
    kind = body.kind if body.kind in _VALID_CHALLENGE_KINDS else "score"
    target = max(1, min(366, int(body.target or 1)))
    period = max(1, min(366, int(body.period_days or 7)))

    # Participants → a per-person group challenge. Validate they're family members;
    # it lives under owner='family' (both see it); per-person progress counts each
    # member's OWN habits, so we drop the specific-habit binding.
    participants_json = None
    valid_members = {m["user_id"] for m in db.execute(
        "SELECT user_id FROM family_members WHERE family_id=?", (f,)).fetchall()}
    parts = [p for p in (body.participants or []) if p in valid_members]
    if parts:
        owner = "family"
        participants_json = _json_mod.dumps(sorted(set(parts)))

    area_id = None
    if body.area_id:
        # For group challenges, validate against personal areas (per-person tracking);
        # else against the challenge owner's scope.
        valid_owner = str(user["id"]) if parts else owner
        if body.area_id not in _life_valid_area_ids(db, f, valid_owner):
            raise HTTPException(400, "bad area_id")
        area_id = body.area_id
    habit_id = None
    if body.habit_id and not parts:
        r = db.execute("SELECT id FROM habits WHERE id=? AND family_id=? AND owner=?",
                       (body.habit_id, f, owner)).fetchone()
        if not r:
            raise HTTPException(400, "bad habit_id")
        habit_id = body.habit_id
    # Score (manual tally) starts every participant at 0. No habit/area binding.
    scores_json = None
    if kind == "score":
        habit_id = None; area_id = None
        keys = parts if parts else [user["id"]]
        scores_json = _json_mod.dumps({str(k): 0 for k in keys})
    today = datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()
    cur = db.execute(
        """INSERT INTO life_challenges (family_id, owner, title, emoji, kind, target, habit_id, area_id, period_days, start_date, participants, scores)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (f, owner, title, (body.emoji or "🏆").strip(), kind, target, habit_id, area_id, period, today, participants_json, scores_json))
    db.commit()
    row = dict(db.execute("SELECT * FROM life_challenges WHERE id=?", (cur.lastrowid,)).fetchone())
    return _life_challenge_view(db, row, f, owner, _life_user_lang(db, user["id"]))


@app.delete("/api/life/challenges/{cid}")
def life_challenge_delete(cid: int, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    row = db.execute("SELECT id FROM life_challenges WHERE id=? AND family_id=?", (cid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    db.execute("DELETE FROM life_challenges WHERE id=?", (cid,))
    db.commit()
    return {"ok": True}


class ScoreBump(BaseModel):
    user_id: int
    delta: int = 1


@app.post("/api/life/challenges/{cid}/score")
def life_challenge_score(cid: int, body: ScoreBump, user=Depends(get_uf), db=Depends(get_db)):
    """+/- a participant's manual score on a 'score' challenge (clamped ≥ 0)."""
    f = user["family_id"]
    row = db.execute("SELECT * FROM life_challenges WHERE id=? AND family_id=?", (cid, f)).fetchone()
    if not row:
        raise HTTPException(404)
    ch = dict(row)
    if ch.get("kind") != "score":
        raise HTTPException(400, "not a score challenge")
    try:
        scores = {str(k): int(v) for k, v in _json_mod.loads(ch.get("scores") or "{}").items()}
    except Exception:
        scores = {}
    key = str(body.user_id)
    scores[key] = max(0, scores.get(key, 0) + int(body.delta))
    db.execute("UPDATE life_challenges SET scores=? WHERE id=?", (_json_mod.dumps(scores), cid))
    db.commit()
    fresh = dict(db.execute("SELECT * FROM life_challenges WHERE id=?", (cid,)).fetchone())
    return _life_challenge_view(db, fresh, f, ch["owner"], _life_user_lang(db, user["id"]))


@app.get("/api/life/active")
def life_active_challenges(user=Depends(get_uf), db=Depends(get_db)):
    """Active challenges relevant to the caller — their personal ones + the
    family's — for the Home / Profile scoreboard widget."""
    f = user["family_id"]
    me = str(user["id"])
    lang = _life_user_lang(db, me)
    rows = db.execute(
        "SELECT * FROM life_challenges WHERE family_id=? AND owner IN (?, 'family') ORDER BY id DESC",
        (f, me)).fetchall()
    out = []
    for r in rows:
        v = _life_challenge_view(db, dict(r), f, r["owner"], lang)
        if v["status"] == "active":
            out.append(v)
    members = [dict(m) for m in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=?",
        (f,)).fetchall()]
    return {"challenges": out, "members": members}


# ─── Love Points — a dedicated monthly couple scoreboard ──────────────────
# Separate from challenges. Each point is given by one member to another, with a
# reason + emoji. Tallied per calendar month; a winner emerges at month end.
def _love_status(db, f: int):
    now = datetime.now(ZoneInfo(TIMEZONE))
    ym = now.strftime("%Y-%m")
    days_in_month = monthrange(now.year, now.month)[1]
    days_left = days_in_month - now.day  # remaining full days until month end
    rows = db.execute(
        "SELECT to_user, COALESCE(SUM(delta),0) c FROM love_points WHERE family_id=? AND ym=? GROUP BY to_user",
        (f, ym)).fetchall()
    scores = {str(r["to_user"]): r["c"] for r in rows}
    members = [dict(m) for m in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url FROM family_members WHERE family_id=? ORDER BY user_id",
        (f,)).fetchall()]
    leader = None
    if scores:
        mx = max(scores.values())
        tops = [int(k) for k, v in scores.items() if v == mx and mx > 0]
        leader = tops[0] if len(tops) == 1 else None
    return {"ym": ym, "month": now.strftime("%B"), "days_left": days_left,
            "days_in_month": days_in_month, "scores": scores, "members": members,
            "leader": leader}


@app.get("/api/love")
def love_status(user=Depends(get_uf), db=Depends(get_db)):
    return _love_status(db, user["family_id"])


class LovePointBody(BaseModel):
    to_user: int
    reason: str | None = ""
    emoji: str | None = "❤️"
    delta: int = 1  # +1 award, -1 deduction (sign only; magnitude is clamped to 1)


@app.post("/api/love")
def love_award(body: LovePointBody, user=Depends(get_uf), db=Depends(get_db)):
    """Award (+1) or deduct (-1) a point for a member, with a reason + emoji."""
    f = user["family_id"]
    if not db.execute("SELECT 1 FROM family_members WHERE family_id=? AND user_id=?",
                      (f, body.to_user)).fetchone():
        raise HTTPException(400, "unknown recipient")
    delta = -1 if body.delta < 0 else 1
    now = datetime.now(ZoneInfo(TIMEZONE))
    db.execute(
        "INSERT INTO love_points (family_id, from_user, to_user, reason, emoji, ym, created_at, delta) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (f, user["id"], body.to_user, (body.reason or "").strip()[:120],
         (body.emoji or "❤️").strip()[:8], now.strftime("%Y-%m"), now.isoformat(), delta))
    db.commit()
    return _love_status(db, f)


@app.delete("/api/love/latest")
def love_remove_latest(to_user: int, user=Depends(get_uf), db=Depends(get_db)):
    """Undo: drop a member's most recent point this month."""
    f = user["family_id"]
    ym = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m")
    row = db.execute(
        "SELECT id FROM love_points WHERE family_id=? AND to_user=? AND ym=? ORDER BY id DESC LIMIT 1",
        (f, to_user, ym)).fetchone()
    if row:
        db.execute("DELETE FROM love_points WHERE id=?", (row["id"],))
        db.commit()
    return _love_status(db, f)


@app.get("/api/love/stats")
def love_stats(ym: str | None = None, user=Depends(get_uf), db=Depends(get_db)):
    """Log of all points for a month: who gave what to whom, when."""
    f = user["family_id"]
    if not ym:
        ym = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m")
    rows = db.execute(
        "SELECT id, from_user, to_user, reason, emoji, created_at, COALESCE(delta,1) delta FROM love_points "
        "WHERE family_id=? AND ym=? ORDER BY id DESC", (f, ym)).fetchall()
    return {"ym": ym, "entries": [dict(r) for r in rows]}


@app.delete("/api/love/{pid}")
def love_delete(pid: int, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    db.execute("DELETE FROM love_points WHERE id=? AND family_id=?", (pid, f))
    db.commit()
    return {"ok": True}


@app.get("/api/love/history")
def love_history(months: int = 6, user=Depends(get_uf), db=Depends(get_db)):
    """Per-month net points per member, oldest→newest, for the history bars."""
    f = user["family_id"]
    months = max(1, min(24, months))
    now = datetime.now(ZoneInfo(TIMEZONE))
    yms, y, m = [], now.year, now.month
    for _ in range(months):
        yms.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12; y -= 1
    yms.reverse()  # oldest → newest
    ph = ",".join("?" * len(yms))
    rows = db.execute(
        f"SELECT ym, to_user, COALESCE(SUM(delta),0) c FROM love_points "
        f"WHERE family_id=? AND ym IN ({ph}) GROUP BY ym, to_user",
        (f, *yms)).fetchall()
    bucket = {ym: {} for ym in yms}
    for r in rows:
        bucket[r["ym"]][str(r["to_user"])] = r["c"]
    members = [dict(mm) for mm in db.execute(
        "SELECT user_id, user_name, emoji, color, photo_url FROM family_members "
        "WHERE family_id=? ORDER BY user_id", (f,)).fetchall()]
    return {"members": members, "months": [{"ym": ym, "scores": bucket[ym]} for ym in yms]}


class ChallengeSuggestBody(BaseModel):
    owner: str | None = None


@app.post("/api/life/challenges/suggest")
async def life_challenge_suggest(body: ChallengeSuggestBody, user=Depends(get_uf), db=Depends(get_db)):
    f = user["family_id"]
    owner = _life_resolve_owner(body.owner, user, db)
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "AI not configured")
    is_family = (owner == "family")
    ulang = _life_user_lang(db, user["id"])
    lang_name = "Russian" if ulang == "ru" else "English"
    areas = _life_effective_areas(db, f, owner, ulang)
    area_list = ", ".join(f'{a["name"]} (id={a["id"]})' for a in areas)
    scope_desc = ("the couple's relationship (joint challenges they do together)"
                  if is_family else "the person's life areas")
    system = (
        f"You design short, motivating habit challenges for {scope_desc}. "
        f"Available spheres: {area_list}. "
        f"Suggest 3 challenges. Each: a catchy title (<=4 words), an emoji, a kind "
        f"('count' = do it N times in the window, or 'streak' = N days in a row), a "
        f"realistic target (integer), a period_days (7, 14, or 30), and the area_id it "
        f"belongs to (one from the list). Title in {lang_name}. "
        f"Reply with ONLY a JSON array: "
        f'[{{"title":"...","emoji":"<one emoji>","kind":"count|streak","target":<int>,"period_days":<int>,"area_id":"<id>"}}]'
    )
    try:
        async with httpx.AsyncClient(timeout=40) as c:
            r = await c.post("https://api.anthropic.com/v1/messages", headers={
                "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }, json={
                "model": _CHALLENGE_SUGGEST_MODEL, "max_tokens": 600, "system": system,
                "messages": [{"role": "user", "content": "Suggest challenges. JSON array only."}],
            })
            data = r.json()
            text = (data.get("content", [{}])[0].get("text") or "").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            parsed = _json_mod.loads(text)
            valid_ids = _life_valid_area_ids(db, f, owner)
            out = []
            for it in (parsed or [])[:4]:
                title = str(it.get("title") or "").strip()[:40]
                if not title:
                    continue
                kind = it.get("kind") if it.get("kind") in _VALID_CHALLENGE_KINDS else "count"
                aid = it.get("area_id") if it.get("area_id") in valid_ids else None
                out.append({
                    "title": title, "emoji": (str(it.get("emoji") or "🏆").strip() or "🏆")[:4],
                    "kind": kind, "target": max(1, min(60, int(it.get("target") or 5))),
                    "period_days": int(it.get("period_days") if it.get("period_days") in (7, 14, 30) else 7),
                    "area_id": aid,
                })
            if not out:
                raise HTTPException(502, "no suggestions")
            return {"suggestions": out[:3]}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"challenge suggest failed: {e}")
        raise HTTPException(502, "AI request failed")


# ─── Debug & Serve ───────────────────────────────────────────────────────
APP_VERSION = "v8.63.2"
# v8.63.2 — Life: avatars draggable again (persistent avatar groups now carry the
#           .life-node hit target + track the finger 1:1, incl. the bond line).
#           (Journey already pauses the sim — it's not a perf cost.)
# v8.63.1 — Life perf #3: the continuous float sim was re-rastering every node's
#           radial-gradient glow every frame. Throttle the ambient sim to ~30fps
#           (drag stays 60fps via the pointer handler), GPU-composite node/avatar
#           groups (will-change:transform) so a move re-composites the cached glow
#           instead of repainting it, and precompute the desaturated core colour in
#           JS (no per-paint color-mix()).
# v8.63.0 — Life: pinned events (carry over to next month, schema v41 + roll-
#           forward), gentler node fill (brightness +15%/event, size +5%/event,
#           dimmer/desaturated baseline), persistent SVG avatars (no flicker),
#           floaty springs + organic chaos/drift, edges always centre-to-centre.
# v8.62.3 — Life perf pass #2: the big radial-gradient GLOW circles are now static
#           (only the small solid core breathes) — re-rasterising scaling gradients
#           per node every frame was the real FPS sink. Avatar images preloaded so
#           SVG <image> recreation (edit/month/owner) paints from cache, no flash.
#           Breathing restored during drag (no more pause).
# v8.62.2 — Life perf pass: persistent top-bar avatar chips (no re-decode/flash on
#           month/mode switch), pause ambient breathing during drag (the main
#           repaint cost), cache DOM node/edge refs for the sim loop (no per-frame
#           querySelector), lighter single-node drag updates.
# v8.62.1 — Life graph perf: dragged node tracks the finger 1:1 (apply position
#           on pointermove, not next RAF) + stiffer springs (kHome .018→.045,
#           kEdge .010→.024, damp .86→.82) so the constellation follows briskly.
# v8.62.0 — Life redesign: habit tracker → monthly EVENT tracker. New life_events
#           table (schema v40, month-bucketed, counter per event); existing habits
#           converted to current-month events. Endpoints /api/life/events (+bump/
#           edit/delete); summary/journey now event-based with ?ym= month switch.
#           Challenges are score-only (count/streak retired). habits/habit_logs
#           kept dormant.
# v8.61.1 — Fix: Life habit day-0 consistency/brightness glowed 0.5 instead of
#           1.0 at the 22:00–24:00 UTC boundary (UTC created_at vs Belgrade
#           today). New _life_local_date() localises created_at before the date
#           diff; corrects existing rows, no migration. Tests pinned/frozen.
# v8.61.0 — Love Points: monthly history view (Money-style). Bars per month
#           (me=blue / partner=pink), tap to switch month, per-month entry log
#           below with +1/−1 green/red. New GET /api/love/history.
# v8.60.0 — Love Points: "−" now also asks why — deductions carry a reason +
#           emoji, just like awards. Signed entries (delta ±1), score = SUM(delta),
#           stats log shows +1/−1. Schema v39 (love_points.delta).
# v8.59.0 — What's New is now a multi-slide carousel (Next + dots) instead of a
#           single card. Added slides for Life and Love Points; marquee features
#           flagged big:true. Frontend-only (news.js/lang.js/index.html); seen-key
#           bumped to _v2 so the tour shows once for everyone.
# v8.58.0 — Love Points: dedicated monthly couple scoreboard (its own entity in
#           Profile), separate from challenges. Points given with reason + emoji,
#           tallied per calendar month, Stats log (who/what/when). Schema v37
#           (drop seeded example challenge) + v38 (love_points table). The
#           Home/Profile challenge widget now syncs with real challenges only.
# v8.57.0 — Life: 'score' challenges (manual +/- scoreboard), custom period via
#           date picker, Home/Profile scoreboard widget, example couple seed.
#           Schema v35 (scores) + v36 (example). POST .../score, GET /life/active.
# v8.56.1 — Life: participant chips in the create-challenge modal are flex now
#           (avatar + name aligned, no baseline skew).
# v8.56.0 — Life Challenges: participants — pick members, each tracked separately
#           (per-person leaderboard). Stored under owner='family'. Schema v34.
# v8.55.1 — Life: Journey/Challenges overlay padding-top clears the floating
#           filter row (tabs no longer hide under it).
# v8.55.0 — Life Phase 3: Challenges — time-bound goals (count|streak) on a
#           habit/sphere/any, Current/Completed tabs, manual + AI suggestions.
#           Schema v33 (life_challenges). 🏆 toggle in Life.
# v8.54.1 — Life Journey: clip the activity sparkline + spacing so it no longer
#           overlaps the stat tiles below.
# v8.54.0 — Life Phase 2: Journey — balance/bond %, activity sparkline, per-area
#           bars, headline counters. GET /api/life/journey. 📈 toggle in Life.
# v8.53.0 — Plants: AI now identifies SEEDS/pits/cuttings/sprouts (avocado pit in
#           water etc.) instead of rejecting them, with grow-from-stage tips.
#           Schema v32 (plants.stage) + stage badge + editable stage.
# v8.52.8 — Life: idle wiggle now actually visible (±1.5°); smooth edit-mode
#           transition — nodes spring from old spots to new, "+" grows from centre.
# v8.52.7 — Life: gentle idle wiggle on area/habit nodes (much subtler than edit
#           mode). Wiggle moved to an inner group so it never fights drag/orbit.
# v8.52.6 — Life: family spheres are now editable too (add/delete), same as
#           personal. Both scopes seed from constants into life_areas.
# v8.52.5 — Life: editable personal spheres — add a custom sphere via the growing
#           "+" at L0 (edit mode), delete any sphere (+ its habits). Schema v31
#           (life_areas). Relationship spheres stay fixed.
# v8.52.4 — Life: disable text selection / iOS long-press callout on the canvas
#           so holding a node no longer selects the emoji glyph as text.
# v8.52.3 — Life: new default personal areas (8): Fun/Rest/Hobby/Friends/Health/
#           Self-growth/Career/Family. Bilingual names (follow viewer's lang).
# v8.52.2 — Life: Add/Ideas seeds hidden by default — they grow out of the hub
#           centre only in edit mode. Area shows just its habits otherwise.
# v8.52.1 — Life: iOS-style edit mode (long-press canvas → nodes wiggle → tap to
#           edit). Adds full habit editing (name/emoji/type/frequency/delete).
# v8.52.0 — Life Phase 2: AI habit suggestions per area (Claude Haiku). A dashed
#           ✨ node inside each area asks Claude for tailored new habits; tap to
#           plant any of them. POST /api/life/suggest.
# v8.51.7 — Life family hub: avatars are now real physics nodes (orbit + springs
#           to the hub and to each other) instead of a rigid SMIL pair — they
#           wobble elastically and tug each other when dragged.
# v8.51.6 — Life family hub: two avatars now clearly separated (read as two
#           objects joined by the bond line); orbit freezes (SMIL pause) during
#           drag so the pair moves as one rigid object with the centre.
# v8.51.5 — Life: node ring is now a true circle (rx==ry) centred with symmetric
#           air top/bottom, instead of a vertically-stretched ellipse.
# v8.51.4 — Life: filter chips overlay the canvas (no top black strip); more air
#           around edge nodes; Phase 1b — glowing BOND line between the two
#           family avatars (brightness + closeness scale with bond strength).
# v8.51.3 — Life: stage height measured from the real nav position (no black gap
#           at the bottom on Telegram WebView's dynamic viewport).
# v8.51.2 — Life: full-bleed canvas (dropped the inner panel frame) + elliptical
#           node layout that fills the portrait stage (no more letterbox air).
# v8.51.1 — Life polish: avatar in personal hub, two orbiting avatars for family,
#           restored the global app header (graph now in a night-sky panel below it).
# v8.50.1 — Login: retry bot-info (4× backoff) + Retry button. Fixes transient
#           "Bot not configured" when PWA opens during the post-deploy boot window.
# v8.50.0 — Money: balance is now a RUNNING account total (carries over between
#           months); income/expense still reset to 0 each month. opening_balance + net added.
# v8.49.11 — Cooking: sort (recent/name/cost) + favorites-only filter. What's New refreshed.
# v8.49.10 — Home Upcoming: show only my tasks (+ unassigned). Other types stay family-wide.
# v8.49.9 — Hotfix: showCalEv popup from Home was inserted into hidden #cal-mo.
# v8.49.8 — Home: upcoming rows tap into the calendar detail popup.
# v8.49.7 — Tasks: in-bucket chronological sort (nearest date first).
# v8.49.6 — Schema v29: one-time backfill of original plant cover photo into
#           the timeline for plants that pre-date v8.49.3 (so their original
#           shows as the first chronological entry with the creation date).
# v8.49.5 — Plant strip: newest-first, horizontal-scroll with pinned Update button,
#           AI health tip rendered inline in photo view, cover-bust survives /api/plants reloads.
# v8.49.4 — Plant Update: in-app camera via getUserMedia + source-chooser modal.
#           Bypasses Telegram Android's missing-Camera-option chooser gap.
# v8.49.3 — Plant Update: latest photo becomes cover; original kept as first
#           timeline entry. Removed camera-capture intent (Android Telegram crash).
#           Timeline order ASC. Downscale target 1024px.
# v8.49.2 — frontend-only: memory-safe image downscale (Telegram Android WebView OOM).
#           Uses createImageBitmap with resize-during-decode; default maxDim 1920→1280.
# v8.49.1 — hotfix: added "cooking" to _VALID_NAV_TABS so nav-picker Save works.
# v8.49.0 — What's New + Tips timeline (frontend-only). Removed cooking total-cost-all header.
# v8.48.0 — Cooking tab. Schema v28 (dishes + dish_ingredients). Endpoints:
# GET /api/dishes, GET/PATCH/DELETE /api/dishes/{id}, POST /api/dishes (json create),
# POST /api/dishes/{id}/image (multipart), GET /api/dishes/{id}/image,
# GET /api/dishes/price-lookup?name=…, POST /api/dishes/{id}/add-to-shopping.

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
