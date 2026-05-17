"""
Shared weather module — Open-Meteo (open-meteo.com).
Free, unlimited, no API key. Provides 16-day daily forecast (vs 9 for Met Norway).

- fetch_shaped(lat, lon, tz, force=False): frontend-friendly shape with 60-min TTL cache.
  Returns the same shape as the previous Met Norway version (so existing callers don't break):
    {now:int, feels:int, label:"<emoji> <desc>",
     days:[{date,max,min,code,label}, ...]}
  Up to 16 days when called from the extended forecast endpoint.
- refresh(lat, lon, tz): force-refresh ignoring TTL (used by hourly scheduler job).
- geocode(query): proxy to Open-Meteo Geocoding API. Returns list of suggestions.

Cache is keyed by (lat, lon) rounded to 2 decimals so two members in the same area
share the bucket. Stale-fallback up to 6 hours when network is unreachable.
"""
import httpx, logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("uvicorn.error")

USER_AGENT = "FamilyHQ/1.0 github.com/yaroslavtrue/family-hq"
TTL_SECONDS = 60 * 60         # 60 min hot cache
STALE_MAX = 6 * 3600          # serve stale cache up to 6h if API is down

# WMO weather code → (emoji, description). Source: https://open-meteo.com/en/docs
WMO = {
    0:  ("☀️", "Clear"),
    1:  ("🌤", "Mostly clear"),
    2:  ("⛅", "Partly cloudy"),
    3:  ("☁️", "Overcast"),
    45: ("🌫", "Fog"),
    48: ("🌫", "Rime fog"),
    51: ("🌦", "Light drizzle"),
    53: ("🌦", "Drizzle"),
    55: ("🌧", "Dense drizzle"),
    56: ("🌧", "Freezing drizzle"),
    57: ("🌧", "Freezing drizzle"),
    61: ("🌦", "Light rain"),
    63: ("🌧", "Rain"),
    65: ("🌧", "Heavy rain"),
    66: ("🌧", "Freezing rain"),
    67: ("🌧", "Freezing rain"),
    71: ("🌨", "Light snow"),
    73: ("🌨", "Snow"),
    75: ("❄️", "Heavy snow"),
    77: ("🌨", "Snow grains"),
    80: ("🌦", "Light showers"),
    81: ("🌧", "Showers"),
    82: ("⛈️", "Heavy showers"),
    85: ("🌨", "Snow showers"),
    86: ("❄️", "Heavy snow showers"),
    95: ("⛈️", "Thunderstorm"),
    96: ("⛈️", "Thunderstorm + hail"),
    99: ("⛈️", "Thunderstorm + hail"),
}

# Short emoji-only map — re-exported for any caller that wants just the icon (e.g. scheduler.py)
WMO_SHORT = {k: v[0] for k, v in WMO.items()}


def _wmo(code):
    """Lookup WMO code → (emoji, description). Returns ('🌤','') for unknown."""
    try:
        return WMO.get(int(code), ("🌤", ""))
    except Exception:
        return ("🌤", "")


# Module-level cache. Key: (round(lat,2), round(lon,2)) — sharing across nearby coords.
# Value: {"shaped": dict, "ts": datetime}
_cache = {}


def _now(tz):
    return datetime.now(ZoneInfo(tz)) if tz else datetime.now()


def _key(lat, lon):
    return (round(float(lat), 2), round(float(lon), 2))


async def _fetch_openmeteo(lat, lon, tz, days=16):
    """Raw Open-Meteo daily + current. Caller handles retries / fallback."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,apparent_temperature,weather_code,is_day"
        "&daily=temperature_2m_max,temperature_2m_min,weather_code"
        f"&timezone={tz or 'auto'}"
        f"&forecast_days={min(max(int(days), 1), 16)}"
    )
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=15, headers=headers) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.json()


def _shape(data):
    """Transform Open-Meteo response into the frontend shape (matches old Met Norway shape)."""
    if not data:
        return None
    cur = data.get("current") or {}
    daily = data.get("daily") or {}
    times = daily.get("time") or []
    maxes = daily.get("temperature_2m_max") or []
    mins = daily.get("temperature_2m_min") or []
    codes = daily.get("weather_code") or []

    cur_code = cur.get("weather_code")
    cur_emoji, cur_desc = _wmo(cur_code)

    days = []
    n = min(len(times), len(maxes), len(mins), len(codes))
    for i in range(n):
        e, d = _wmo(codes[i])
        days.append({
            "date": times[i],
            "max": round(maxes[i] if maxes[i] is not None else 0),
            "min": round(mins[i] if mins[i] is not None else 0),
            "code": codes[i],
            "label": (e + " " + d).strip(),
        })

    return {
        "now": round(cur.get("temperature_2m") or 0),
        "feels": round(cur.get("apparent_temperature") or cur.get("temperature_2m") or 0),
        "label": (cur_emoji + " " + cur_desc).strip(),
        "days": days,
    }


async def fetch_shaped(lat, lon, tz, days=4, force=False):
    """
    Return shaped weather for the given coords. `days` controls how many daily entries to keep.
    Default 4 (today + 3 ahead, enough for the home card). Pass 16 for the full forecast page.

    Strategy: hot cache (60min) → HTTP fetch → stale cache (≤6h) → None.
    `force=True` bypasses the hot cache (used by ?refresh=1 and the hourly scheduler).
    """
    key = _key(lat, lon)
    bucket = _cache.get(key)
    # Hot cache
    if not force and bucket and bucket.get("shaped") and bucket.get("ts"):
        age = (_now(tz) - bucket["ts"]).total_seconds()
        if age < TTL_SECONDS:
            return _trim(bucket["shaped"], days)
    # Fresh fetch — always request 16 days so any caller (home card, full page) can slice
    try:
        raw = await _fetch_openmeteo(lat, lon, tz, days=16)
        shaped = _shape(raw)
        if shaped:
            _cache[key] = {"shaped": shaped, "ts": _now(tz)}
            return _trim(shaped, days)
    except Exception as e:
        log.warning(f"Open-Meteo fetch failed: {type(e).__name__}: {e}")
    # Stale fallback
    if bucket and bucket.get("shaped") and bucket.get("ts"):
        age = (_now(tz) - bucket["ts"]).total_seconds()
        if age < STALE_MAX:
            log.warning(f"Weather: serving stale cache ({int(age)}s old)")
            return _trim(bucket["shaped"], days)
    log.error("Weather: fetch failed and no cached data available")
    return None


def _trim(shaped, days):
    """Return a copy of shaped with daily list trimmed to N entries."""
    if not shaped:
        return None
    if days >= len(shaped.get("days", [])):
        return shaped
    out = dict(shaped)
    out["days"] = shaped["days"][:days]
    return out


async def refresh(lat, lon, tz):
    """Force-refresh ignoring TTL. Returns True on success. Used by hourly scheduler job."""
    shaped = await fetch_shaped(lat, lon, tz, days=16, force=True)
    if shaped:
        log.info(f"Weather refreshed: {shaped['now']}°C {shaped['label']}")
        return True
    return False


async def geocode(query, lang="en", count=8):
    """
    Search city by name. Proxies to Open-Meteo's free geocoding endpoint.
    Returns list of {name, country, admin1, lat, lon, population} suggestions.
    """
    if not query or len(query.strip()) < 2:
        return []
    url = (
        "https://geocoding-api.open-meteo.com/v1/search"
        f"?name={httpx.QueryParams({'q': query.strip()})['q']}"
        f"&count={count}&language={lang}&format=json"
    )
    # Build url manually since httpx QueryParams urlencode is overkill above
    from urllib.parse import quote
    url = f"https://geocoding-api.open-meteo.com/v1/search?name={quote(query.strip())}&count={count}&language={lang}&format=json"
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get(url)
            r.raise_for_status()
            data = r.json()
            results = data.get("results") or []
            out = []
            for r0 in results:
                out.append({
                    "name": r0.get("name"),
                    "country": r0.get("country"),
                    "admin1": r0.get("admin1"),
                    "lat": r0.get("latitude"),
                    "lon": r0.get("longitude"),
                    "population": r0.get("population", 0),
                    "timezone": r0.get("timezone"),
                })
            return out
    except Exception as e:
        log.warning(f"Geocode failed: {type(e).__name__}: {e}")
        return []
