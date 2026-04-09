"""
Shared weather module — Met Norway Locationforecast 2.0 (yr.no).
Free, unlimited, no API key. Requires User-Agent per met.no Terms of Service.

- fetch_shaped(lat, lon, tz): frontend-friendly shape with 60-min TTL cache
  (hot cache hit = no HTTP request). Falls back to stale cache (≤6h) if API
  is unreachable. Shape kept backward-compatible with the old Open-Meteo
  version so app.js doesn't need changes:
    {now:int, feels:int, label:"<emoji> <desc>",
     days:[{date,max,min,code,label}, ...]}
- refresh(lat, lon, tz): force refresh bypassing TTL (hourly scheduler job)
"""
import httpx, logging, math
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("uvicorn.error")

USER_AGENT = "FamilyHQ/1.0 github.com/yaroslavtrue/family-hq"
TTL_SECONDS = 60 * 60         # 60 min hot cache
STALE_MAX = 6 * 3600          # serve stale cache up to 6h if API is down

# Met Norway symbol_code (with _day/_night stripped) -> (emoji, desc)
WX_SYMBOL = {
    "clearsky":       ("☀️", "Clear"),
    "fair":           ("🌤", "Fair"),
    "partlycloudy":   ("⛅", "Partly cloudy"),
    "cloudy":         ("☁️", "Cloudy"),
    "fog":            ("🌫", "Fog"),
    "lightrain":                    ("🌦", "Light rain"),
    "rain":                         ("🌧", "Rain"),
    "heavyrain":                    ("🌧", "Heavy rain"),
    "lightrainshowers":             ("🌦", "Light showers"),
    "rainshowers":                  ("🌧", "Showers"),
    "heavyrainshowers":             ("⛈", "Heavy showers"),
    "lightrainandthunder":          ("⛈", "Rain + thunder"),
    "rainandthunder":               ("⛈", "Rain + thunder"),
    "heavyrainandthunder":          ("⛈", "Heavy rain + thunder"),
    "lightrainshowersandthunder":   ("⛈", "Showers + thunder"),
    "rainshowersandthunder":        ("⛈", "Showers + thunder"),
    "heavyrainshowersandthunder":   ("⛈", "Heavy showers + thunder"),
    "lightsleet":                   ("🌨", "Light sleet"),
    "sleet":                        ("🌨", "Sleet"),
    "heavysleet":                   ("🌨", "Heavy sleet"),
    "lightsleetshowers":            ("🌨", "Light sleet"),
    "sleetshowers":                 ("🌨", "Sleet showers"),
    "heavysleetshowers":            ("🌨", "Heavy sleet showers"),
    "lightsleetandthunder":         ("⛈", "Sleet + thunder"),
    "sleetandthunder":              ("⛈", "Sleet + thunder"),
    "heavysleetandthunder":         ("⛈", "Heavy sleet + thunder"),
    "lightsleetshowersandthunder":  ("⛈", "Sleet + thunder"),
    "sleetshowersandthunder":       ("⛈", "Sleet + thunder"),
    "heavysleetshowersandthunder":  ("⛈", "Heavy sleet + thunder"),
    "lightsnow":                    ("🌨", "Light snow"),
    "snow":                         ("🌨", "Snow"),
    "heavysnow":                    ("❄️", "Heavy snow"),
    "lightsnowshowers":             ("🌨", "Light snow"),
    "snowshowers":                  ("🌨", "Snow showers"),
    "heavysnowshowers":             ("❄️", "Heavy snow showers"),
    "lightsnowandthunder":          ("⛈", "Snow + thunder"),
    "snowandthunder":               ("⛈", "Snow + thunder"),
    "heavysnowandthunder":          ("⛈", "Heavy snow + thunder"),
    "lightsnowshowersandthunder":   ("⛈", "Snow + thunder"),
    "snowshowersandthunder":        ("⛈", "Snow + thunder"),
    "heavysnowshowersandthunder":   ("⛈", "Heavy snow + thunder"),
}

# Short emoji-only map — re-exported for any caller that wants just the icon
WMO_SHORT = {k: v[0] for k, v in WX_SYMBOL.items()}


def _sym(code):
    """Strip _day/_night/_polartwilight variant and look up emoji+desc."""
    if not code:
        return ("🌤", "")
    base = code
    for suf in ("_day", "_night", "_polartwilight"):
        if base.endswith(suf):
            base = base[:-len(suf)]
            break
    return WX_SYMBOL.get(base, ("🌤", base.replace("_", " ").capitalize()))


def _apparent_temp(t, rh, ws):
    """Australian apparent temperature formula (°C). t=°C, rh=%, ws=m/s."""
    try:
        e = (rh / 100.0) * 6.105 * math.exp(17.27 * t / (237.7 + t))
        return t + 0.33 * e - 0.70 * ws - 4.00
    except Exception:
        return t


# Module-level cache shared by fetch_shaped() and refresh()
_cache = {"shaped": None, "ts": None}


def _now(tz):
    return datetime.now(ZoneInfo(tz)) if tz else datetime.now()


async def _fetch_metno(lat, lon):
    """Raw Met Norway compact forecast. Caller handles retries/fallback."""
    url = (f"https://api.met.no/weatherapi/locationforecast/2.0/compact"
           f"?lat={lat}&lon={lon}")
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=15, headers=headers) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.json()


def _shape(data, tz):
    """Transform Met Norway response into frontend-friendly shape."""
    ts_list = (data or {}).get("properties", {}).get("timeseries", [])
    if not ts_list:
        return None
    tz_info = ZoneInfo(tz) if tz else None

    # ─ Current conditions (first entry)
    first = ts_list[0]
    cur = first.get("data", {}).get("instant", {}).get("details", {}) or {}
    cur_t = cur.get("air_temperature", 0) or 0
    cur_rh = cur.get("relative_humidity", 50) or 50
    cur_ws = cur.get("wind_speed", 0) or 0
    feels = _apparent_temp(cur_t, cur_rh, cur_ws)
    cur_sym = (first.get("data", {}).get("next_1_hours", {}).get("summary", {}).get("symbol_code")
               or first.get("data", {}).get("next_6_hours", {}).get("summary", {}).get("symbol_code")
               or "")
    cur_emoji, cur_desc = _sym(cur_sym)

    # ─ Group by local date to get min/max temp + representative symbol per day
    by_day = {}  # dkey -> {"min","max","sym","sym_diff"}
    for entry in ts_list:
        t_iso = entry.get("time")
        if not t_iso:
            continue
        try:
            t_utc = datetime.fromisoformat(t_iso.replace("Z", "+00:00"))
        except Exception:
            continue
        t_local = t_utc.astimezone(tz_info) if tz_info else t_utc
        dkey = t_local.date().isoformat()
        det = entry.get("data", {}).get("instant", {}).get("details", {}) or {}
        temp = det.get("air_temperature")
        if temp is None:
            continue
        d = by_day.setdefault(dkey, {"min": temp, "max": temp, "sym": "", "sym_diff": 999})
        if temp < d["min"]:
            d["min"] = temp
        if temp > d["max"]:
            d["max"] = temp
        # Pick the symbol from the timeseries entry closest to local noon
        sym = (entry.get("data", {}).get("next_6_hours", {}).get("summary", {}).get("symbol_code")
               or entry.get("data", {}).get("next_1_hours", {}).get("summary", {}).get("symbol_code")
               or "")
        if sym:
            diff = abs(t_local.hour - 12)
            if diff < d["sym_diff"]:
                d["sym"] = sym
                d["sym_diff"] = diff

    # ─ Build first 3 days, sorted by date
    days = []
    for dkey in sorted(by_day.keys())[:3]:
        d = by_day[dkey]
        emoji, desc = _sym(d["sym"])
        days.append({
            "date": dkey,
            "max": round(d["max"]),
            "min": round(d["min"]),
            "code": d["sym"],
            "label": (emoji + " " + desc).strip(),
        })

    return {
        "now": round(cur_t),
        "feels": round(feels),
        "label": (cur_emoji + " " + cur_desc).strip(),
        "days": days,
    }


async def fetch_shaped(lat, lon, tz):
    """
    Return shaped weather. 60-min TTL hot cache → HTTP fetch → stale cache
    fallback (≤6h) → None.
    """
    # Hot cache
    if _cache["shaped"] and _cache["ts"]:
        age = (_now(tz) - _cache["ts"]).total_seconds()
        if age < TTL_SECONDS:
            return _cache["shaped"]
    # Fresh fetch
    try:
        data = await _fetch_metno(lat, lon)
        shaped = _shape(data, tz)
        if shaped:
            _cache["shaped"] = shaped
            _cache["ts"] = _now(tz)
            return shaped
    except Exception as e:
        log.warning(f"Met Norway fetch failed: {type(e).__name__}: {e}")
    # Stale fallback
    if _cache["shaped"] and _cache["ts"]:
        age = (_now(tz) - _cache["ts"]).total_seconds()
        if age < STALE_MAX:
            log.warning(f"Weather: serving stale cache ({int(age)}s old)")
            return _cache["shaped"]
    log.error("Weather: fetch failed and no cached data available")
    return None


async def refresh(lat, lon, tz):
    """Force-refresh ignoring TTL. Returns True on success. Called by hourly job."""
    try:
        data = await _fetch_metno(lat, lon)
        shaped = _shape(data, tz)
        if shaped:
            _cache["shaped"] = shaped
            _cache["ts"] = _now(tz)
            log.info(f"Weather refreshed: {shaped['now']}°C {shaped['label']}")
            return True
    except Exception as e:
        log.warning(f"Weather refresh failed: {type(e).__name__}: {e}")
    return False
