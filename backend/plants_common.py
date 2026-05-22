# -*- coding: utf-8 -*-
"""
Plant helpers shared between backend modules.

Both backend/app.py and backend/bot.py need to:
  • Call Claude Sonnet vision with the same identification prompt
  • Compute current watering status from last_watered + interval
  • Decide whether the plant was "watered today"
  • Apply the species cache override on identified data

Keeping these in one place prevents drift (e.g. one side stripping
diacritics differently from the other or returning slightly different
status thresholds).
"""
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

# ─── Unified AI identification prompt ───────────────────────────────────
# Three response branches:
#   (A) confident → single answer (used by app.py and bot.py)
#   (B) uncertain → candidates list (only handled by app.py in-app picker)
#   (C) not-a-plant / unreadable → {"error": "..."}
# bot.py treats branch (B) as a rejection (low confidence → ask user to retake).
PLANT_PROMPT = """You are an expert botanist identifying houseplants and garden plants from photos.

Return STRICT JSON only, no prose, no code fences. Choose ONE of three response formats:

(A) CONFIDENT — when you're confident (>= 0.7) about a single species:
{
  "species": "<English common name, capitalized>",
  "latin_name": "<Latin binomial, e.g. Monstera deliciosa>",
  "water_interval_days": <integer 1-30, typical days between waterings indoors>,
  "light": "<one of: bright direct, bright indirect, medium, low>",
  "care_tips": ["<tip1>", "<tip2>", "<tip3>", "<tip4>", "<tip5>"],
  "confidence": <0.7-1.0>
}

(B) UNCERTAIN — when you see a plant but can't pick one species with > 0.7 confidence, list 2-3 plausible candidates:
{
  "candidates": [
    {"species": "...", "latin_name": "...", "water_interval_days": ..., "light": "...", "care_tips": [...], "confidence": 0.0-0.7},
    {"species": "...", "latin_name": "...", "water_interval_days": ..., "light": "...", "care_tips": [...], "confidence": 0.0-0.7}
  ]
}
Each candidate must have ALL the fields (full plant data, not just name) so the user can pick directly.

(C) NOT A PLANT — when the photo isn't a plant, is too dark/blurry/cropped to identify, or you have no plausible guess:
{"error": "<one short English sentence: what's wrong>"}

care_tips style: 5 short, actionable, practical sentences in English (8-15 words each). Cover watering nuance, light preferences, humidity, common mistakes, signs of trouble.

Begin response with {."""


PLANT_MODEL = "claude-sonnet-4-5"


def plant_status(p: dict, tz_name: str) -> str:
    """Compute current watering status based on last_watered + interval.
    Returns 'ok' (well-watered), 'soon' (one day before due), or 'thirsty' (overdue).
    Never-watered plants base off `added_at` so brand-new plants don't immediately scream."""
    interval = p.get("water_interval_days") or 7
    last = p.get("last_watered") or p.get("added_at")
    if not last:
        return "ok"
    try:
        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00").split(".")[0])
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=ZoneInfo(tz_name))
    except Exception:
        return "ok"
    now_dt = datetime.now(ZoneInfo(tz_name))
    days = (now_dt - last_dt).total_seconds() / 86400
    if days >= interval:
        return "thirsty"
    if days >= interval - 1:
        return "soon"
    return "ok"


def watered_today(p: dict, tz_name: str) -> bool:
    """True if the plant was watered at any point today in our local TZ."""
    last = p.get("last_watered")
    if not last:
        return False
    try:
        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00").split(".")[0])
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=ZoneInfo(tz_name))
    except Exception:
        return False
    return last_dt.date() == datetime.now(ZoneInfo(tz_name)).date()


def apply_species_cache(con, candidate: dict) -> dict:
    """If we've seen this latin_name before, override candidate's tips/interval/light
    with the cached canonical values. Otherwise insert candidate's data into cache.

    Mutates AND returns the candidate dict for caller convenience. Caller is
    responsible for con.commit() after this returns.

    Works with both FastAPI's `db` dependency and the bot's `_db()` helper —
    both are sqlite3.Connection instances with row_factory = sqlite3.Row."""
    latin_key = (candidate.get("latin_name") or "").strip().lower()
    if not latin_key:
        return candidate
    row = con.execute(
        "SELECT * FROM plant_species_cache WHERE latin_name=?",
        (latin_key,),
    ).fetchone()
    if row:
        # Cache hit — override the variable fields, leave species name as-is
        candidate["water_interval_days"] = row["water_interval_days"] or candidate.get("water_interval_days") or 7
        candidate["light"] = row["light"] or candidate.get("light", "")
        try:
            candidate["care_tips"] = (
                json.loads(row["care_tips"])
                if row["care_tips"]
                else candidate.get("care_tips", [])
            )
        except Exception:
            pass
    else:
        # Cache miss — store candidate's data for next time
        try:
            con.execute(
                "INSERT OR REPLACE INTO plant_species_cache (latin_name, species, water_interval_days, light, care_tips) VALUES (?, ?, ?, ?, ?)",
                (latin_key,
                 (candidate.get("species") or "").strip(),
                 int(candidate.get("water_interval_days") or 7),
                 (candidate.get("light") or "").strip(),
                 json.dumps(candidate.get("care_tips") or [], ensure_ascii=False)),
            )
        except Exception as ex:
            log.warning(f"species cache insert failed: {ex}")
    return candidate
