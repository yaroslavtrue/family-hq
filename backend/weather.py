"""
Shared weather module — single source of truth for Open-Meteo fetches.
Used by both app.py (frontend endpoint) and scheduler.py (morning digest).

- fetch_raw() returns the raw API response with retry + 6h fallback cache
- fetch_shaped() returns the frontend-friendly shape ({now, feels, label, days})
"""
import httpx, logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("uvicorn.error")

# WMO weather code → emoji + label (full set, used by frontend shape)
WMO_FULL = {
    0: "☀️ Clear", 1: "🌤 Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Cloudy",
    45: "🌫 Fog", 48: "🌫 Rime fog",
    51: "🌦 Light drizzle", 53: "🌦 Drizzle", 55: "🌧 Heavy drizzle",
    61: "🌧 Light rain", 63: "🌧 Rain", 65: "🌧 Heavy rain",
    66: "🌧 Freezing rain", 67: "🌧 Heavy freezing rain",
    71: "🌨 Light snow", 73: "🌨 Snow", 75: "❄️ Heavy snow", 77: "❄️ Snow grains",
    80: "🌦 Light showers", 81: "🌧 Showers", 82: "⛈ Heavy showers",
    85: "🌨 Snow showers", 86: "❄️ Heavy snow showers",
    95: "⛈ Thunderstorm", 96: "⛈ Thunderstorm + hail", 99: "⛈ Heavy hail",
}

# Compact emoji-only map (used by digest)
WMO_SHORT = {
    0: "☀️", 1: "🌤", 2: "⛅", 3: "☁️", 45: "🌫", 48: "🌫",
    51: "🌦", 53: "🌦", 55: "🌧", 61: "🌧", 63: "🌧", 65: "🌧",
    66: "🌧", 67: "🌧", 71: "🌨", 73: "🌨", 75: "❄️", 77: "❄️",
    80: "🌦", 81: "🌧", 82: "⛈", 85: "🌨", 86: "❄️",
    95: "⛈", 96: "⛈", 99: "⛈",
}

# In-memory cache shared between callers
_cache = {"data": None, "ts": None}


def _now(tz):
    return datetime.now(ZoneInfo(tz)) if tz else datetime.now()


async def fetch_raw(lat, lon, tz):
    """
    Fetch raw Open-Meteo response. Retries 3× (10/15/20s timeouts).
    Falls back to cached data up to 6h old. Returns None if everything fails.
    """
    url = (f"https://api.open-meteo.com/v1/forecast?"
           f"latitude={lat}&longitude={lon}"
           f"&daily=temperature_2m_max,temperature_2m_min,weathercode"
           f"&current=temperature_2m,weathercode,apparent_temperature"
           f"&timezone={tz}&forecast_days=3")
    for attempt, timeout in enumerate([10, 15, 20], 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as c:
                r = await c.get(url)
                r.raise_for_status()
                data = r.json()
            _cache["data"] = data
            _cache["ts"] = _now(tz)
            return data
        except Exception as e:
            log.warning(f"Weather fetch attempt {attempt}/3 failed: {type(e).__name__}: {e}")
    if _cache["data"] and _cache["ts"]:
        age = (_now(tz) - _cache["ts"]).total_seconds()
        if age < 6 * 3600:
            log.warning(f"Weather API unreachable — using cached data ({int(age)}s old)")
            return _cache["data"]
    log.error("Weather fetch failed and no cached data available")
    return None


async def fetch_shaped(lat, lon, tz):
    """
    Fetch and reshape into the structure the frontend consumes:
    {now, feels, label, days: [{date, max, min, code, label}, ...]}
    Returns None if fetch fails entirely.
    """
    d = await fetch_raw(lat, lon, tz)
    if not d:
        return None
    current = d.get("current", {})
    daily = d.get("daily", {})
    days = []
    for i in range(len(daily.get("time", []))):
        wc = daily["weathercode"][i]
        days.append({
            "date": daily["time"][i],
            "max": round(daily["temperature_2m_max"][i]),
            "min": round(daily["temperature_2m_min"][i]),
            "code": wc,
            "label": WMO_FULL.get(wc, "🌤 " + str(wc)),
        })
    cur_wc = current.get("weathercode", 0)
    return {
        "now": round(current.get("temperature_2m", 0)),
        "feels": round(current.get("apparent_temperature", 0)),
        "label": WMO_FULL.get(cur_wc, "🌤"),
        "days": days,
    }
