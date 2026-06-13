"""
Firebase Cloud Messaging (HTTP v1) — push delivery for the product/accounts instance.

Mirrors the codebase's "no heavy SDK" style (the same way Google ID tokens are
verified with plain httpx in app.py): the service-account access token is minted
locally with PyJWT[crypto] and exchanged for an OAuth2 token, then messages are
POSTed to the FCM v1 endpoint over the shared httpx client.

Inert by design: when FCM_SA_JSON / FCM_PROJECT_ID are unset (the Telegram
instance), configured() is False and send() is a no-op — so importing this module
and calling it from the scheduler never affects the Telegram delivery path.
"""
import os, json, time, re, logging
import httpx

try:
    import jwt  # PyJWT[crypto]
except Exception:  # pragma: no cover - dependency missing in a stripped env
    jwt = None

log = logging.getLogger("uvicorn.error")

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Lazily-parsed service account + cached OAuth2 access token.
_sa = None            # parsed service-account dict, or False once we know it's bad
_tok_cache = None     # (access_token, expires_at_epoch)
_http_client = None


def _project_id():
    return (os.environ.get("FCM_PROJECT_ID", "") or "").strip()


def _service_account():
    """Parse FCM_SA_JSON (raw JSON content) once. Returns dict or None."""
    global _sa
    if _sa is not None:
        return _sa or None
    raw = (os.environ.get("FCM_SA_JSON", "") or "").strip()
    if not raw:
        _sa = False
        return None
    try:
        _sa = json.loads(raw)
        if not _sa.get("client_email") or not _sa.get("private_key"):
            log.error("FCM_SA_JSON missing client_email/private_key")
            _sa = False
            return None
    except Exception as e:
        log.error(f"FCM_SA_JSON parse error: {e}")
        _sa = False
        return None
    return _sa


def configured() -> bool:
    """True only when both the project id and a usable service account are present
    and PyJWT is importable. The Telegram instance returns False → full no-op."""
    return bool(jwt and _project_id() and _service_account())


def _http():
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=15)
    return _http_client


async def _access_token():
    """Mint+cache a short-lived OAuth2 access token for the service account."""
    global _tok_cache
    now = time.time()
    if _tok_cache and _tok_cache[1] - 60 > now:
        return _tok_cache[0]
    sa = _service_account()
    if not sa:
        return None
    iat = int(now)
    claim = {
        "iss": sa["client_email"],
        "scope": _SCOPE,
        "aud": _TOKEN_URL,
        "iat": iat,
        "exp": iat + 3600,
    }
    try:
        assertion = jwt.encode(claim, sa["private_key"], algorithm="RS256")
        resp = await _http().post(_TOKEN_URL, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        })
        if resp.status_code != 200:
            log.error(f"FCM token exchange {resp.status_code}: {resp.text[:200]}")
            return None
        body = resp.json()
        tok = body.get("access_token")
        ttl = int(body.get("expires_in", 3600))
        if tok:
            _tok_cache = (tok, now + ttl)
        return tok
    except Exception as e:
        log.error(f"FCM token mint error: {type(e).__name__}: {e}")
        return None


_MD = re.compile(r"[*_`#]+")


def strip_md(msg: str) -> str:
    """Telegram messages are Markdown; push notifications want plain text."""
    return _MD.sub("", msg or "").strip()


def split_title_body(msg: str):
    """Derive (title, body) from a single reminder string. If the first line is a
    short label we use it as the title; otherwise fall back to the brand name."""
    text = strip_md(msg)
    first, _, rest = text.partition("\n")
    if rest.strip() and len(first) <= 64:
        return (first.strip(), rest.strip())
    return ("Moya Family", text)


async def send(token: str, title: str, body: str, data: dict | None = None) -> str:
    """Send one FCM message. Returns:
      "ok"      — delivered (accepted by FCM)
      "dead"    — token is unregistered/invalid → caller should prune it
      "skip"    — not configured (no-op)
      "error"   — transient failure (kept for retry on the next reminder)
    Never raises."""
    if not configured():
        return "skip"
    at = await _access_token()
    if not at:
        return "error"
    payload = {"message": {
        "token": token,
        "notification": {"title": title, "body": body},
        "android": {"priority": "high"},
    }}
    if data:
        # FCM data values must all be strings.
        payload["message"]["data"] = {str(k): str(v) for k, v in data.items()}
    url = f"https://fcm.googleapis.com/v1/projects/{_project_id()}/messages:send"
    try:
        resp = await _http().post(url, headers={"Authorization": f"Bearer {at}"}, json=payload)
        if resp.status_code == 200:
            return "ok"
        # 404 NOT_FOUND or 400/403 with UNREGISTERED → token is dead.
        txt = resp.text or ""
        if resp.status_code == 404 or "UNREGISTERED" in txt or "registration-token-not-registered" in txt:
            return "dead"
        log.error(f"FCM send {resp.status_code}: {txt[:200]}")
        return "error"
    except Exception as e:
        log.error(f"FCM send error: {type(e).__name__}: {e}")
        return "error"
