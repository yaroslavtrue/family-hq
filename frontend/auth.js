// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Auth + Onboarding (extracted from app.js in v8.37.0)
// ═══════════════════════════════════════════════════════════════
// Login flow (rLogin → bot deep-link OR Telegram widget) + family
// onboarding (rOnb → Create / Join with invite code).
//
// Loaded BEFORE app.js. Functions are `var`/`function` declarations (true
// globals) so app.js can call them. Reads: iD, tr(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), load(), fS (all declared in app.js or
// theme.js / lang.js).
//
// Session-token helpers (_getSess / _setSess / _logoutPwa) also live here
// since they're auth-state plumbing — used by A() in app.js AND by the
// login flow.

// ─── Session token (PWA / browser auth via Telegram Login Widget) ──
// Persistent across reloads via localStorage.
function _getSess() {
  try { return localStorage.getItem("fhq_session") || "" } catch (e) { return "" }
}
function _setSess(token) {
  try { token ? localStorage.setItem("fhq_session", token) : localStorage.removeItem("fhq_session") } catch (e) {}
}

// Aggressive logout: clear localStorage + ServiceWorker registrations + caches,
// then hard reload bypassing browser cache. Used by "Sign out & try different
// account" button and the stale-session escape hatch on the login screen.
async function _logoutPwa() {
  try { localStorage.clear() } catch (e) {}
  try { sessionStorage.clear() } catch (e) {}
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) { await regs[i].unregister() }
    }
  } catch (e) {}
  try {
    if (window.caches) { var keys = await caches.keys(); for (var i = 0; i < keys.length; i++) { await caches.delete(keys[i]) } }
  } catch (e) {}
  location.replace(location.pathname + "?nocache=" + Date.now());
}

// ─── Login screen: bot-mediated (default) + Telegram widget (fallback) ──
// `_loginMode` toggles which method to show. `_botCode` is the one-time code
// from /api/auth/bot-login-init; `_botPollTimer` polls every 2s for completion.
var _loginMode = "bot";
var _botCode = null, _botPollTimer = null;

// Fetch bot-info with retries. The container has a brief startup window after a
// deploy where the API answers but bot_username may still be empty (or the whole
// request races the boot and fails). A single fetch that lands in that window
// would otherwise dead-end the login screen on "Bot not configured" with no
// recovery. Retry a few times with a short backoff before giving up.
async function _fetchBotInfo(attempts) {
  attempts = attempts || 4;
  for (var i = 0; i < attempts; i++) {
    try {
      var r = await fetch("/api/auth/bot-info", { cache: "no-store" });
      if (r.ok) {
        var info = await r.json();
        if (info && info.bot_username) return info.bot_username;
      }
    } catch (e) { /* network blip — fall through to retry */ }
    if (i < attempts - 1) await new Promise(function (res) { setTimeout(res, 800 + i * 700) });
  }
  return null;
}

// ═══ Login dispatcher: pick provider UI by /api/auth/config (mode) ═══════════
// telegram instance → the existing Telegram flow (unchanged). product instance
// (AUTH_MODE=accounts) → email/password + Google.
var _authCfg = null;       // cached /api/auth/config
var _authView = "login";   // login | register | forgot | reset
var _resetToken = null;

async function _fetchAuthCfg() {
  if (_authCfg) return _authCfg;
  try { var r = await fetch("/api/auth/config", { cache: "no-store" }); if (r.ok) _authCfg = await r.json(); } catch (e) {}
  if (!_authCfg) _authCfg = { mode: "telegram", providers: ["telegram"] };
  return _authCfg;
}

async function rLogin() {
  var cfg = await _fetchAuthCfg();
  if (cfg.mode === "accounts") return _renderAccountsLogin();
  return _renderTelegramLogin();
}

// ─── Accounts login (email/password + Google) ──
function _qp(n) { try { return new URLSearchParams(location.search).get(n); } catch (e) { return null; } }
function _val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
function _setAuthView(v) { _authView = v; _renderAccountsLogin(); }
function _authMsg(t, ok) { var e = document.getElementById("auth-msg"); if (e) { e.textContent = t; e.style.color = ok ? "var(--ok)" : "var(--ac)"; } }
function _inp(id, type, ph, ac) { return '<input class="inp" id="' + id + '" type="' + type + '" placeholder="' + ph + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + ' style="margin-bottom:10px">'; }

function _renderAccountsLogin() {
  document.getElementById("fab").classList.add("hidden");
  document.querySelectorAll(".ni").forEach(function (e) { e.style.opacity = ".3" });
  var ct = document.getElementById("ct");
  var rtok = _qp("reset"); if (rtok) { _authView = "reset"; _resetToken = rtok; }
  var banner = "";
  if (_qp("verified")) banner = '<div style="color:var(--ok);font-size:13px;margin:6px 0 2px">✓ Email verified — please sign in.</div>';
  else if (_qp("verify_error")) banner = '<div style="color:var(--ac);font-size:13px;margin:6px 0 2px">This verification link is invalid or expired.</div>';
  var h = '<div class="onb"><div class="onb-e">🏠</div><div class="onb-t">Family HQ</div>' + banner;
  if (_authView === "login") {
    h += '<div class="onb-s">Sign in to your account.</div>'
       + _inp("ae", "email", "Email", "email") + _inp("ap", "password", "Password", "current-password")
       + '<button class="btn" onclick="doEmailLogin()">Sign in</button>'
       + '<div id="g-btn" style="margin-top:14px;display:flex;justify-content:center"></div>'
       + '<div style="display:flex;justify-content:space-between;width:100%;margin-top:16px;font-size:13px">'
       + '<a style="color:var(--pr);cursor:pointer" onclick="_setAuthView(\'forgot\')">Forgot password?</a>'
       + '<a style="color:var(--pr);cursor:pointer" onclick="_setAuthView(\'register\')">Create account</a></div>';
  } else if (_authView === "register") {
    h += '<div class="onb-s">Create your Family HQ account.</div>'
       + _inp("an", "text", "Your name", "name") + _inp("ae", "email", "Email", "email") + _inp("ap", "password", "Password (min 8)", "new-password")
       + '<button class="btn" onclick="doEmailRegister()">Create account</button>'
       + '<div id="g-btn" style="margin-top:14px;display:flex;justify-content:center"></div>'
       + '<div style="margin-top:16px;font-size:13px;text-align:center"><a style="color:var(--pr);cursor:pointer" onclick="_setAuthView(\'login\')">← Back to sign in</a></div>';
  } else if (_authView === "forgot") {
    h += '<div class="onb-s">Enter your email and we’ll send a reset link.</div>'
       + _inp("ae", "email", "Email", "email")
       + '<button class="btn" onclick="doEmailForgot()">Send reset link</button>'
       + '<div style="margin-top:16px;font-size:13px;text-align:center"><a style="color:var(--pr);cursor:pointer" onclick="_setAuthView(\'login\')">← Back to sign in</a></div>';
  } else if (_authView === "reset") {
    h += '<div class="onb-s">Choose a new password.</div>'
       + _inp("ap", "password", "New password (min 8)", "new-password")
       + '<button class="btn" onclick="doEmailReset()">Set new password</button>';
  }
  h += '<div id="auth-msg" style="margin-top:12px;font-size:13px;min-height:18px;text-align:center"></div></div>';
  ct.innerHTML = h;
  if ((_authView === "login" || _authView === "register") && _authCfg && _authCfg.google_client_id) _renderGoogleButton(_authCfg.google_client_id);
}

async function doEmailLogin() {
  var email = _val("ae"), pw = _val("ap");
  if (!email || !pw) { _authMsg("Enter your email and password"); return; }
  var r = await A("POST", "/api/auth/login", { email: email, password: pw });
  if (!r || !r.token) { _authMsg(r && r.detail ? r.detail : "Invalid email or password"); return; }
  _setSess(r.token);
  if (_getSess() !== r.token) { _authMsg("Cannot save login — try a non-private browser tab"); return; }
  location.reload();
}
async function doEmailRegister() {
  var email = _val("ae"), pw = _val("ap"), name = _val("an");
  if (!email || !pw) { _authMsg("Enter your email and password"); return; }
  if (pw.length < 8) { _authMsg("Password must be at least 8 characters"); return; }
  var r = await A("POST", "/api/auth/register", { email: email, password: pw, name: name });
  if (!r) { _authMsg("Something went wrong — try again"); return; }
  if (r.detail) { _authMsg(r.detail); return; }
  document.getElementById("ct").innerHTML =
    '<div class="onb"><div class="onb-e">📨</div><div class="onb-t">Check your email</div>'
    + '<div class="onb-s">We sent a verification link to <b>' + es(email) + '</b>. Open it, then come back and sign in.</div>'
    + '<button class="btn" onclick="_setAuthView(\'login\')">Back to sign in</button></div>';
}
async function doEmailForgot() {
  var email = _val("ae");
  if (!email) { _authMsg("Enter your email"); return; }
  await A("POST", "/api/auth/forgot", { email: email });
  _authMsg("If that email has an account, a reset link is on its way.", true);
}
async function doEmailReset() {
  var pw = _val("ap");
  if (!pw || pw.length < 8) { _authMsg("Password must be at least 8 characters"); return; }
  var r = await A("POST", "/api/auth/reset", { token: _resetToken, password: pw });
  if (!r || r.detail || !r.ok) { _authMsg(r && r.detail ? r.detail : "Invalid or expired link"); return; }
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  _authView = "login"; _renderAccountsLogin(); _authMsg("Password updated — please sign in.", true);
}

function _renderGoogleButton(clientId) {
  function go() {
    try {
      window.google.accounts.id.initialize({ client_id: clientId, callback: _onGoogleCredential });
      var el = document.getElementById("g-btn");
      if (el) window.google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", text: "continue_with", shape: "pill" });
    } catch (e) {}
  }
  if (window.google && window.google.accounts && window.google.accounts.id) { go(); return; }
  if (!document.getElementById("gis-script")) {
    var s = document.createElement("script"); s.id = "gis-script"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
    s.onload = go; document.head.appendChild(s);
  } else {
    var n = 0, iv = setInterval(function () { if (window.google && window.google.accounts && window.google.accounts.id) { clearInterval(iv); go(); } else if (++n > 50) clearInterval(iv); }, 100);
  }
}
async function _onGoogleCredential(resp) {
  if (!resp || !resp.credential) return;
  var r = await A("POST", "/api/auth/google", { credential: resp.credential });
  if (!r || !r.token) { _authMsg(r && r.detail ? r.detail : "Google sign-in failed"); return; }
  _setSess(r.token);
  if (_getSess() !== r.token) { _authMsg("Cannot save login — try a non-private browser tab"); return; }
  location.reload();
}

async function _renderTelegramLogin() {
  document.getElementById("fab").classList.add("hidden");
  document.querySelectorAll(".ni").forEach(function (e) { e.style.opacity = ".3" });
  var ct = document.getElementById("ct");
  // Show a brief connecting state while we (re)try bot-info, so the user doesn't
  // see a flash of the scary error during the normal startup window.
  ct.innerHTML = '<div class="onb"><div class="onb-e">🔐</div>' +
    '<div class="onb-t">Sign in with Telegram</div>' +
    '<div class="onb-s" style="opacity:.7">' + tr("auth_connecting") + '</div></div>';
  var bot = await _fetchBotInfo();
  var h = '<div class="onb"><div class="onb-e">🔐</div>' +
    '<div class="onb-t">Sign in with Telegram</div>' +
    '<div class="onb-s">Family HQ uses your Telegram account so all data stays in sync.</div>';
  if (!bot) {
    h += '<div style="color:var(--ac);font-size:13px;text-align:center;padding:16px">⚠️ ' + tr("auth_bot_not_configured") + '. Try opening this app from inside Telegram.</div>';
    h += '<button class="onb-b s2" style="margin-top:6px" onclick="rLogin()">↻ ' + tr("btn_retry") + '</button>';
  } else {
    h += '<div style="display:flex;gap:8px;margin:16px 0 10px">';
    h += '<button class="ob ' + (_loginMode === "bot" ? "s" : "") + '" style="flex:1" onclick="_loginMode=\'bot\';rLogin()">📨 Via Bot (recommended)</button>';
    h += '<button class="ob ' + (_loginMode === "widget" ? "s" : "") + '" style="flex:1" onclick="_loginMode=\'widget\';rLogin()">🌐 Web</button>';
    h += '</div>';
    if (_loginMode === "bot") {
      h += '<div id="bot-login-host" style="margin-top:10px"></div>';
      h += '<div style="font-size:11px;color:var(--ht);margin-top:14px;text-align:center;max-width:300px">Works with whichever Telegram account is logged in on your phone — no cookie tricks.</div>';
    } else {
      h += '<div id="tg-widget-host" style="margin-top:20px;display:flex;justify-content:center"></div>';
      h += '<div style="font-size:11px;color:var(--ht);margin-top:14px;text-align:center;max-width:300px">' + tr("auth_widget_session_note") + '</div>';
    }
  }
  h += '</div>';
  ct.innerHTML = h;
  if (bot) {
    if (_loginMode === "bot") { _renderBotLogin(bot) } else { _renderWidget(bot) }
    // Stale-session escape hatch
    if (_getSess()) {
      var clear = document.createElement("button");
      clear.className = "onb-b s2";
      clear.style.cssText = "margin-top:14px;background:transparent;border:1.5px solid var(--ac);color:var(--ac);font-size:12px";
      clear.textContent = tr("auth_clear_session");
      clear.onclick = function () { _logoutPwa() };
      document.querySelector(".onb").appendChild(clear);
    }
  }
}

function _renderWidget(bot) {
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", bot);
  s.setAttribute("data-size", "large");
  s.setAttribute("data-radius", "12");
  s.setAttribute("data-onauth", "onTelegramAuth(user)");
  s.setAttribute("data-request-access", "write");
  document.getElementById("tg-widget-host").appendChild(s);
  // Stop any bot-polling left over
  if (_botPollTimer) { clearInterval(_botPollTimer); _botPollTimer = null }
  _botCode = null;
}

async function _renderBotLogin(bot) {
  var host = document.getElementById("bot-login-host"); if (!host) return;
  host.innerHTML = '<div style="text-align:center;padding:20px;color:var(--ht)">Generating link…</div>';
  var r = await A("POST", "/api/auth/bot-login-init");
  if (!r || !r.deep_link) { host.innerHTML = '<div style="color:var(--ac);text-align:center;padding:16px">' + tr("auth_bot_not_configured") + '</div>'; return }
  _botCode = r.code;
  host.innerHTML =
    '<a href="' + r.deep_link + '" target="_blank" class="btn" style="display:block;text-align:center;text-decoration:none;background:#0088cc;color:#fff;margin-bottom:10px">📨 Open @' + bot + ' in Telegram</a>' +
    '<div style="font-size:12px;color:var(--ht);text-align:center;margin-top:8px">' + tr("auth_bot_steps") + '</div>' +
    '<div id="bot-poll-status" style="text-align:center;margin-top:14px;font-size:12px;color:var(--ht)">Waiting for confirmation…</div>';
  if (_botPollTimer) clearInterval(_botPollTimer);
  _botPollTimer = setInterval(_pollBotLogin, 2000);
}

async function _pollBotLogin() {
  if (!_botCode) return;
  var r = await A("GET", "/api/auth/bot-login-poll?code=" + encodeURIComponent(_botCode));
  if (!r) return;
  var st = document.getElementById("bot-poll-status");
  if (r.status === "complete" && r.token) {
    if (_botPollTimer) { clearInterval(_botPollTimer); _botPollTimer = null }
    if (st) st.innerHTML = '<span style="color:var(--ok)">✓ Logged in as ' + es(r.first_name || "User") + ' — loading…</span>';
    _setSess(r.token);
    setTimeout(function () { location.reload() }, 500);
  } else if (r.status === "expired") {
    if (_botPollTimer) { clearInterval(_botPollTimer); _botPollTimer = null }
    if (st) st.innerHTML = '<span style="color:var(--ac)">' + tr("auth_code_expired") + '</span>';
  }
}

// Called by Telegram widget after successful login. Name exposed on window so
// the inline `data-onauth="onTelegramAuth(user)"` attribute can find it.
async function onTelegramAuth(user) {
  hp("ok");
  var r = await A("POST", "/api/auth/telegram-login", user);
  if (!r || !r.token) {
    toast("Login failed — domain not set in BotFather, or browser blocked.");
    return;
  }
  _setSess(r.token);
  // Verify localStorage actually persisted (iOS Private/Incognito mode rejects writes silently)
  if (_getSess() !== r.token) {
    toast("Cannot save login — try a non-private browser tab.");
    return;
  }
  location.reload();
}

// ─── Onboarding: user is authenticated but not in a family yet ──
function rOnb() {
  document.getElementById("fab").classList.add("hidden");
  document.querySelectorAll(".ni").forEach(function (e) { e.style.opacity = ".3" });
  // Show currently authenticated user_id (from session token) so user can see who they're logged in as
  var currentUid = "";
  if (!iD && _getSess()) {
    try { var parts = _getSess().split("."); if (parts.length >= 2) currentUid = '<div style="font-size:11px;color:var(--ht);margin-top:8px;font-family:monospace">Signed in (#' + parts[0] + ')</div>' } catch (e) {}
  }
  var pwaLogout = (!iD && _getSess()) ? '<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--bd);text-align:center"><div style="font-size:12px;color:var(--ht);margin-bottom:10px">Wrong account?</div><button class="onb-b s2" style="background:transparent;border:1.5px solid var(--ac);color:var(--ac)" onclick="_logoutPwa()">Sign out & try different account</button></div>' : '';
  document.getElementById("ct").innerHTML = '<div class="onb"><div class="onb-ico">' + icon("user", 44, 2) + '</div><div class="onb-t">Welcome to Family HQ</div><div class="onb-s">Create a new family or join an existing one with an invite code.</div>' + currentUid + '<div style="height:18px"></div><button class="onb-b p" onclick="shCr()">' + icon("pl", 16, 2.5) + '<span style="margin-left:6px">Create Family</span></button><div style="color:var(--ht);font-size:13px;margin:10px 0;letter-spacing:.5px;text-transform:uppercase;font-weight:600">or</div><button class="onb-b s2" onclick="shJn()"><span style="margin-right:4px">Join with Code</span></button>' + pwaLogout + '</div>'
}

function shCr() {
  oMC(tr("mt_create_family"), '<input class="inp" id="fn" placeholder="' + tr("f_name") + '" value="Our Family"><button class="btn" onclick="doCr()">' + tr("btn_create") + '</button>', { ic: "user" })
}
function shJn() {
  oMC(tr("mt_join_family"), '<div style="text-align:center;margin-bottom:16px"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">' + tr("g_enter_code") + '</div><input class="ci2" id="fc" placeholder="ABC123" maxlength="6"></div><button class="btn" onclick="doJn()">' + tr("btn_join") + '</button>', { ic: "user" })
}

async function doCr() {
  var n = document.getElementById("fn").value.trim() || "Our Family";
  var r = await A("POST", "/api/family/create", { name: n });
  if (!r || r.detail) { alert(r ? r.detail : "Error"); return }
  cMo(); hp();
  fS = { joined: true, invite_code: r.invite_code, name: r.name, members: [] };
  document.querySelectorAll(".ni").forEach(function (e) { e.style.opacity = "1" });
  oMC("Family Created! 🎉", '<div style="text-align:center"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">Share this code:</div><div class="cd2"><div class="ct2">' + r.invite_code + '</div><div class="cl2">Invite Code</div></div><button class="btn" onclick="cMo();load()">Got it!</button></div>', { ic: "user" })
}

async function doJn() {
  var c = document.getElementById("fc").value.trim();
  if (c.length < 4) { alert("Enter code"); return }
  var r = await A("POST", "/api/family/join", { code: c });
  if (!r || r.detail) { alert(r ? r.detail : "Invalid"); return }
  cMo(); hp();
  fS = { joined: true, name: r.name };
  document.querySelectorAll(".ni").forEach(function (e) { e.style.opacity = "1" });
  await load();
}
