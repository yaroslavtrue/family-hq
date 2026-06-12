// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ v6.1 — Frontend Logic
// ═══════════════════════════════════════════════════════════════

// Telegram WebApp handle + initData. Declared as `var` (not const) so /static/auth.js
// can read them from window scope — see [[Patterns#multi-file frontend]].
var tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); try { tg.enableClosingConfirmation() } catch (e) {} }
var iD = tg?.initData || "";

// Auth helpers (_getSess, _setSess, _logoutPwa) moved to /static/auth.js in v8.37.0.

// ─── Themes ─────────────────────────────────────────────────
// ─── Theme engine moved to /static/theme.js in v8.36.0 ─────────
// TH (catalog), cTheme (current id), aT(id) (apply), and the color-math
// helpers live there as `var` globals — shared across <script> tags.
// Settings UI for picking themes (setTh, openThemePicker, _customEditorHtml)
// stays here in app.js since it threads into the global render pipeline.

// ─── State ──────────────────────────────────────────────────
// `fS` (family-status object) is declared as `var` so /static/auth.js can mutate it
// in doCr/doJn after successful Create/Join. Other state stays let-scoped to app.js.
var fS = null;
let tab="home",filt=null,ex={},dbgOn=false,dbgLog=[];
// ─── i18n (v8.34.0) ─────────────────────────────────────────────────
// _lang set from /api/family/status (per-member preference, schema v25).
// Dictionary lives in /static/lang.js (loaded before app.js); we read it via window.LANG
// here. Fallback empty objects keep tr() safe even if lang.js failed to load (worst case:
// keys show through; app still renders).
var _lang = "en";
var LANG = (typeof window !== "undefined" && window.LANG) ? window.LANG : { en: {}, ru: {} };
// Intl.PluralRules — drives the trn(key, n) helper for count-dependent strings.
// English: "one" (n==1) | "other"; Russian: "one" | "few" | "many" | "other".
var _pluralRules = {
  en: (typeof Intl !== "undefined" && Intl.PluralRules) ? new Intl.PluralRules("en-US") : null,
  ru: (typeof Intl !== "undefined" && Intl.PluralRules) ? new Intl.PluralRules("ru-RU") : null
};

// tr(key, vars) — plain string lookup with {var} substitution. Falls back lang→en→key.
// Logs missing keys to console when Debug Mode (dbgOn) is on — helps find untranslated strings.
function tr(k, vars) {
  var d = LANG[_lang] || LANG.en;
  var s = (d && d[k]);
  if (s === undefined) {
    s = LANG.en[k];
    if (s === undefined) {
      if (typeof dbgOn !== "undefined" && dbgOn) console.warn("[i18n] missing key:", k, "(lang:", _lang + ")");
      s = k;
    }
  }
  if (vars) Object.keys(vars).forEach(function (vk) { s = s.replace("{" + vk + "}", vars[vk]) });
  return s;
}

// trn(base_key, n, vars) — count-aware lookup. Selects <base>_one / _few / _many / _other
// based on Intl.PluralRules for the current locale. `n` is auto-substituted into {n}.
//
// Example: trn("g_in_days_full", 5)
//   - Russian → looks up "g_in_days_full_many" → "через 5 дней"
//   - English → looks up "g_in_days_full_other" → "in 5 days"
function trn(k, n, vars) {
  var rules = _pluralRules[_lang] || _pluralRules.en;
  var form = rules ? rules.select(Math.abs(n)) : (Math.abs(n) === 1 ? "one" : "other");
  var d = LANG[_lang] || LANG.en;
  // Resolution chain: lang+form → lang+other → en+form → en+other → base_key
  var s = (d && d[k + "_" + form]) || (d && d[k + "_other"])
       || LANG.en[k + "_" + form] || LANG.en[k + "_other"]
       || k;
  if (s === k && typeof dbgOn !== "undefined" && dbgOn) {
    console.warn("[i18n] missing plural:", k, "(form:", form + ", lang:", _lang + ")");
  }
  vars = vars || {};
  if (vars.n === undefined) vars.n = n;
  Object.keys(vars).forEach(function (vk) { s = s.replace("{" + vk + "}", vars[vk]) });
  return s;
}

// Persist language choice — POSTs to backend, updates _lang, re-renders nav + current tab.
async function setLang(newLang){
  if(newLang!=="en"&&newLang!=="ru")return;
  if(newLang===_lang)return;
  var r=await A("PATCH","/api/members/me/lang",{lang:newLang});
  if(!r||!r.ok){toast(tr("ts_save_failed"));return}
  _lang=newLang;_rebuildLocaleArrays();hp("ok");
  // Re-render bottom nav labels + current tab.
  if(typeof _buildNav==="function")_buildNav();
  ren();
}
// moneyTab moved to money.js (v8.43.0); taskTab moved to tasks.js (v8.44.0).
let calTab="events",shopFold=null,searchQ="",searchOpen=false,menuOpen=false;
// Main state object — `var` (not let) so extracted feature modules
// (plants.js, words.js, trainings.js, …) can read/mutate it from window scope.
var D = {tasks:[],recurring:[],shopping:[],folders:[],events:[],birthdays:[],subs:[],dashboard:{},members:[],zones:[],settings:{},weather:null,categories:[],transactions:[],exercises:[],recentWorkouts:[],workoutTemplates:[],plants:[],dishes:[]};
var allSubs = {task:{}, event:{}};
// Modal-shared state — `var` so feature modules (tasks.js, events, etc.) can read/mutate.
var _assign=0,_pri="normal",_rems=[],_zRems=[],_bdRems=[],_subRems=[],zOpen={};
// Trainings state moved to /static/trainings.js in v8.42.0.

// ─── API ────────────────────────────────────────────────────
// API base: "" (relative) in the Telegram web app; the product API origin inside the
// Capacitor native shell (Moya app). Backend CORS (allow_origins=*) + header auth
// (X-Session-Token, no cookies) make the cross-origin call safe. Static assets
// (/static/*, sw.js) stay local-bundled in the app — only A()'s /api/* calls get prefixed.
var API_BASE=(typeof window!=="undefined"&&window.Capacitor&&typeof window.Capacitor.isNativePlatform==="function"&&window.Capacitor.isNativePlatform())?"https://api.moyafamily.com":"";
function _apiUrl(p){return (typeof p==="string"&&p.charAt(0)==="/")?API_BASE+p:p;}
async function A(m,p,b){
// Demo mode (?demo=1): serve canned fixtures entirely client-side — no network,
// no auth, real backend untouched. See demo.js.
if(typeof DEMO!=="undefined" && DEMO) return _demoApi(m,p,b);
var h={"Content-Type":"application/json"};
if(iD)h["X-Telegram-Init-Data"]=iD;
var sess=_getSess();
if(sess)h["X-Session-Token"]=sess;
const o={method:m,headers:h};
if(b)o.body=JSON.stringify(b);
try{const r=await fetch(_apiUrl(p),o);
// On 401: only reload if we HAD a session (it expired). If no session/initData, we should
// already be on the login screen — reloading would cause an infinite loop.
if(r.status===401){var hadSess=!!sess;_setSess("");if(!iD&&hadSess){location.reload();return null}}
const j=await r.json();
if(dbgOn){dbgLog.push(m+" "+p+" → "+r.status);if(dbgLog.length>50)dbgLog.shift();var el=document.getElementById("dbg");if(el)el.textContent=dbgLog.slice(-10).join("\n")}
if(!r.ok)return null;return j}catch(e){if(dbgOn){dbgLog.push("ERR "+m+" "+p+": "+e.message)}return null}}

// ─── Icons (lucide-style line-art SVG, currentColor-tinted) ─────
// Glyph builder so we can request any size without rewriting markup.
function _svg(d,sz,sw){var s=sz||16,w=sw||2;return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+w+'" stroke-linecap="round" stroke-linejoin="round" width="'+s+'" height="'+s+'" style="vertical-align:-2px">'+d+'</svg>'}
// Glyph paths (raw inner SVG)
const G={
ck:'<polyline points="20 6 9 17 4 12"/>',
tr:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
ed:'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
fl:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
bl:'<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
pl:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
// Tab / page-header glyphs
home:'<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
clipboard:'<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
dumbbell:'<path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1"/><path d="M3 3l1 1"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/>',
dollar:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
user:'<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
cart:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>',
cog:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
broom:'<line x1="20" y1="4" x2="9" y2="15"/><line x1="7" y1="13" x2="13" y2="19"/><line x1="8" y1="14" x2="3" y2="20"/><line x1="10" y1="16" x2="6" y2="22"/><line x1="11" y1="17" x2="10" y2="22"/><line x1="12" y1="18" x2="14" y2="22"/><line x1="13" y1="19" x2="18" y2="22"/>',
clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
refresh:'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
cake:'<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>',
card:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
bolt:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
list:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
dot:'<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
debug:'<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2"/><path d="M5 7l3 2"/><path d="M19 21l-3-2"/><path d="M5 21l3-2"/><path d="M19 14h-3"/><path d="M8 14H5"/><path d="m8 3 1 3"/><path d="m16 3-1 3"/>',
arrowUpDown:'<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
chart:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>',
trendUp:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
trendDown:'<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
wallet:'<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"/><path d="M18 12h.01"/>',
receipt:'<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h6"/>',
palette:'<circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.92 0 1.65-.74 1.65-1.65 0-.43-.16-.83-.43-1.13-.27-.31-.43-.7-.43-1.13a1.65 1.65 0 0 1 1.65-1.65H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9Z"/>',
pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
book:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
speaker:'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
translate:'<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
flower:'<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="5.5" r="3"/><circle cx="18.5" cy="12" r="3"/><circle cx="12" cy="18.5" r="3"/><circle cx="5.5" cy="12" r="3"/>',
leaf:'<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
// chef = fork + knife (utensils). Used in the Cooking tab nav + hamburger.
chef:'<path d="M3 2v7c0 1.1.9 2 2 2h0v11"/><path d="M7 2v7c0 1.1-.9 2-2 2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-3 4.5V12h3Z"/><path d="M18 15v7"/>',
// camera = source-chooser modal icon for the Plants Update flow (v8.49.4)
camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
// life = constellation of connected nodes (Life tab, v8.51.0)
life:'<circle cx="12" cy="5" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><circle cx="12" cy="13" r="2.4"/><path d="M12 7.2v3.4M10.3 14.4 6.4 16.2M13.7 14.4l3.9 1.8"/>'
};
// Wrappers — pre-built default sizes for the most-used icons
const I={
ck:_svg(G.ck,14,3),tr:_svg(G.tr,15,2),ed:_svg(G.ed,15,2),
fl:_svg(G.fl,12,2.5),bl:_svg(G.bl,16,2),x:_svg(G.x,12,2.5),pl:_svg(G.pl,14,2.5)
};
// Returns an icon at any size: icon('home',22)
function icon(name,size,strokeW){return G[name]?_svg(G[name],size||16,strokeW||2):''}

// ─── Helpers ────────────────────────────────────────────────
function es(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}

// Client-side image downscale before upload. Modern phones shoot 5-12 MB JPEGs
// at 12 MP which can exceed our backend 5 MB cap (esp. via Telegram WebView). Pass
// any File/Blob; returns a File with the same name+type or a smaller JPEG version.
//
// v8.49.2: memory-safe rewrite. Telegram Android WebView has a ~150-200 MB heap
// budget on low-RAM devices — decoding a 12 MP photo to a full bitmap is ~48 MB
// of RGBA + a copy in canvas + a copy in toBlob, which OOMs WebView and surfaces
// as "Unable to perform last action due to low memory". Two fixes:
//   1. ALWAYS downscale (the old <1.5 MB skip was wrong — small files can still
//      have huge pixel dimensions, and Claude Vision caps at 1568 px anyway).
//   2. Prefer `createImageBitmap` with resize-during-decode — the scaled bitmap
//      is the only one in memory, instead of full + scaled + canvas.
// Default maxDim dropped 1920 → 1280 (still well above Claude Vision's effective
// resolution, and ~55% fewer pixels = ~55% less RAM).
async function _downscaleImage(file, maxDim, quality){
  if(!file)return file;
  maxDim=maxDim||1280;quality=quality||0.82;

  // ─── Path A: createImageBitmap with resize-during-decode (memory-safe) ──
  // Available on Android Chrome 73+ and modern iOS Safari. The decode-then-resize
  // option keeps the full-size bitmap from ever materializing in JS heap.
  if(typeof createImageBitmap==='function'){
    try{
      // Tiny probe to learn natural dimensions, then immediately close to free.
      // (createImageBitmap has no "max-side" option — only explicit w/h — so we
      // need the original aspect ratio to compute the scaled dims.)
      var probe=await createImageBitmap(file);
      var w=probe.width,h=probe.height;
      if(probe.close)probe.close();
      var scale=Math.min(1,maxDim/Math.max(w,h));
      var cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));

      // If the image is already at/below the target AND under 1 MB, recompression
      // usually hurts (re-encoding lossless never improves a compressed JPEG).
      if(scale===1 && file.size<1024*1024) return file;

      var bm=await createImageBitmap(file,{resizeWidth:cw,resizeHeight:ch,resizeQuality:'high'});
      var canvas=document.createElement('canvas');
      canvas.width=cw;canvas.height=ch;
      var ctx=canvas.getContext('2d');
      ctx.drawImage(bm,0,0);
      if(bm.close)bm.close();  // free GPU bitmap immediately

      var blob=await new Promise(function(res){canvas.toBlob(res,'image/jpeg',quality)});
      // Eagerly release canvas memory — important on Android low-RAM devices.
      canvas.width=0;canvas.height=0;
      if(!blob||blob.size>=file.size)return file;
      return new File([blob],'photo.jpg',{type:'image/jpeg',lastModified:Date.now()});
    }catch(e){
      console.warn('[img] createImageBitmap path failed, falling back to <img>:',e);
      // Fall through to legacy path below.
    }
  }

  // ─── Path B (legacy): <img>+canvas. Higher peak memory but works everywhere. ──
  return new Promise(function(resolve){
    var url;
    try{url=URL.createObjectURL(file)}catch(e){resolve(file);return}
    var img=new Image();
    img.onload=function(){
      try{
        var w=img.naturalWidth,h=img.naturalHeight;
        URL.revokeObjectURL(url);
        var scale=Math.min(1,maxDim/Math.max(w,h));
        var cw=Math.round(w*scale),ch=Math.round(h*scale);
        var canvas=document.createElement('canvas');
        canvas.width=cw;canvas.height=ch;
        var ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0,cw,ch);
        // Detach source bitmap before encode to lower peak memory.
        img.src=''; img=null;
        canvas.toBlob(function(blob){
          // Free canvas eagerly.
          canvas.width=0;canvas.height=0;
          if(!blob){resolve(file);return}
          if(blob.size>=file.size){resolve(file);return}
          resolve(new File([blob],'photo.jpg',{type:'image/jpeg',lastModified:Date.now()}));
        },'image/jpeg',quality);
      }catch(e){resolve(file)}
    };
    img.onerror=function(){try{URL.revokeObjectURL(url)}catch(e){}resolve(file)};
    img.src=url;
  });
}
// hp(kind) — haptic feedback via Telegram WebApp API. Free, no visual cost.
//   light/med/heavy → impactOccurred; ok/warn/err → notificationOccurred; sel → selectionChanged.
function hp(k){try{var h=tg&&tg.HapticFeedback;
if(!h){if(navigator.vibrate){navigator.vibrate(k==="heavy"?30:k==="med"||k==="warn"||k==="err"?15:k==="ok"?[10,40,10]:8)}return}
if(k==="ok")h.notificationOccurred("success");
else if(k==="warn")h.notificationOccurred("warning");
else if(k==="err")h.notificationOccurred("error");
else if(k==="sel")h.selectionChanged();
else h.impactOccurred(k==="med"?"medium":k==="heavy"?"heavy":"light")}catch(e){}}

// ─── FX: lightweight visual effects (vanilla CSS+JS, GPU-only) ──────
var FX={
_CF_COLORS:["#7c6aef","#ef6a7a","#5cd6a0","#f0c45a","#6ac4dc","#e0a0ff"],
// Confetti burst from an element's center. Used for "last task done" moments.
confetti:function(el){if(!el||!el.getBoundingClientRect)return;
var r=el.getBoundingClientRect();var host=document.createElement("div");host.className="cf";
host.style.left=(r.left+r.width/2)+"px";host.style.top=(r.top+r.height/2)+"px";
for(var i=0;i<22;i++){var p=document.createElement("i");var a=Math.random()*Math.PI*2;var d=55+Math.random()*55;
p.style.setProperty("--dx",(Math.cos(a)*d).toFixed(0)+"px");
p.style.setProperty("--dy",(Math.sin(a)*d-30).toFixed(0)+"px");
p.style.setProperty("--r",(Math.random()*720-360).toFixed(0)+"deg");
p.style.background=FX._CF_COLORS[i%FX._CF_COLORS.length];host.appendChild(p)}
document.body.appendChild(host);setTimeout(function(){host.remove()},950)},
// Animate integer count-up. Target element needs [data-count="N"] with initial text "0".
countUp:function(el,dur){var to=parseInt(el.getAttribute("data-count"),10);if(isNaN(to))return;
if(to===0){el.textContent="0";return}
var t0=0,from=0;function tick(t){if(!t0)t0=t;var p=Math.min(1,(t-t0)/dur);
var e=p===1?1:1-Math.pow(2,-9*p);el.textContent=Math.round(from+(to-from)*e);
if(p<1)requestAnimationFrame(tick)}requestAnimationFrame(tick)},
// Find all [data-count] in a container and animate once.
countStats:function(root){(root||document).querySelectorAll("[data-count]").forEach(function(el){FX.countUp(el,650)})},
// Derive ambient weather background category from label emoji + time of day.
wCat:function(lbl){var hr=new Date().getHours();var night=hr<6||hr>=20;
if(!lbl)return "cloud";
if(lbl.indexOf("⛈")>=0)return "storm";
if(lbl.indexOf("🌧")>=0||lbl.indexOf("🌦")>=0)return "rain";
if(lbl.indexOf("🌨")>=0)return "snow";
if(lbl.indexOf("☀")>=0)return night?"night":"clear";
if(lbl.indexOf("🌤")>=0)return night?"night":"clear";
return "cloud"}
};
function em(i,t,s){return '<div class="emp"><div class="emp-i">'+i+'</div><div class="emp-t">'+t+'</div><div>'+s+'</div></div>'}
function td(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
// Locale-aware date name arrays. Initially populated with English; rebuilt by
// _rebuildLocaleArrays() whenever _lang changes (called on boot after family/status
// loads + inside setLang()). All existing callsites use array-index access (dN[d.getDay()],
// mN[d.getMonth()].slice(0,3)), so we keep that API instead of converting to functions.
var dN, dF, mN, mNS;
function _rebuildLocaleArrays(){
  var dKeys=["sun","mon","tue","wed","thu","fri","sat"];
  dN=dKeys.map(function(k){return tr("dow_short_"+k)});
  dF=dKeys.map(function(k){return tr("dow_full_"+k)});
  mN=[]; mNS=[];
  for(var i=1;i<=12;i++){mN.push(tr("mo_full_"+i));mNS.push(tr("mo_short_"+i))}
}
_rebuildLocaleArrays();
function fD(ds){const p=(ds||"").split(" ")[0].split("-").map(Number);if(!p[0]||!p[1]||!p[2])return{day:"?",date:"?",full:"?"};const dt=new Date(p[0],p[1]-1,p[2]);return{day:dN[dt.getDay()],date:p[2]+" "+mNS[p[1]-1],full:dN[dt.getDay()]+" "+p[2]+" "+mNS[p[1]-1]}}



function matchQ(text){return !searchQ||(text||"").toLowerCase().indexOf(searchQ)>=0}

// ─── Toast ──────────────────────────────────────────────────
var _toastTimer=null;
function toast(msg,undoFn){var el=document.getElementById("toast");if(_toastTimer)clearTimeout(_toastTimer);
el.innerHTML=es(msg)+(undoFn?'<button class="toast-u" id="toast-undo">'+tr("g_undo")+'</button>':"");el.classList.add("show");
if(undoFn){document.getElementById("toast-undo").onclick=function(){undoFn();el.classList.remove("show")}}
_toastTimer=setTimeout(function(){el.classList.remove("show")},undoFn?5000:2500)}

// ─── Search ─────────────────────────────────────────────────
function toggleSearch(){searchOpen=!searchOpen;document.getElementById("sb").classList.toggle("open",searchOpen);
if(searchOpen)setTimeout(function(){document.getElementById("si").focus()},300);
else{document.getElementById("si").value="";searchQ="";ren()}}
function onSearch(v){searchQ=v.toLowerCase().trim();ren()}

// ─── Scroll bottom refresh ──────────────────────────────────
var _refreshing=false,_lastRefresh=0;
function checkBottomRefresh(){if(_refreshing)return;if(Date.now()-_lastRefresh<10000)return;
var el=document.documentElement;if((el.scrollTop+el.clientHeight)>=el.scrollHeight-2&&el.scrollHeight>el.clientHeight+100){
_refreshing=true;_lastRefresh=Date.now();var ptr=document.getElementById("ptr");
ptr.innerHTML='<span class="spin">↻</span> Refreshing...';ptr.classList.add("show");
_firstHomeRender=true;
load().then(function(){ptr.classList.remove("show");_refreshing=false;hp("ok");toast("✓ Refreshed")})}}
window.addEventListener("scroll",checkBottomRefresh,{passive:true});
setInterval(function(){load()},5*60*1000);

// ─── Members ────────────────────────────────────────────────
function mAv(uid,sz){const m=D.members.find(function(x){return x.user_id===uid});
if(!m)return '<span class="av-em" style="width:'+sz+'px;height:'+sz+'px;background:var(--cd)">👤</span>';
if(m.photo_url)return '<img class="av" src="'+m.photo_url+'" style="width:'+sz+'px;height:'+sz+'px" onerror="this.style.display=\'none\'">';
return '<span class="av-em" style="width:'+sz+'px;height:'+sz+'px;font-size:'+Math.round(sz*0.6)+'px;background:'+m.color+'22">'+m.emoji+'</span>'}
function mName(uid){const m=D.members.find(function(x){return x.user_id===uid});return m?m.user_name:"Everyone"}
function mChip(uid,sm){if(!uid)return '<span class="ch'+(sm?" ch-s":"")+'" style="background:var(--wn)22;color:var(--wn)">👨‍👩‍👧 Everyone</span>';
const m=D.members.find(function(x){return x.user_id===uid});if(!m)return "";
var sz=sm?16:18;return '<span class="ch'+(sm?" ch-s":"")+'" style="background:'+m.color+'22;color:'+m.color+';display:inline-flex;align-items:center;gap:5px">'+mAv(uid,sz)+es(m.user_name)+'</span>'}
function pri(p){const c={high:"var(--pri-hi)",normal:"var(--pri-md)",low:"var(--pri-lo)"};return '<span class="pr" style="color:'+c[p]+'">'+I.fl+" "+p+'</span>'}

// ─── Life active-challenge widget (Home + Profile) ────────────
// Lives in app.js (not life.js) so it works without the Life tab being opened.
// Score challenges render as a two-colour scoreboard with live +/- controls.
function _lifeMColor(uid){var m=(D.members||[]).find(function(x){return x.user_id===uid});return (m&&m.color)||"var(--pr)"}
async function _lifeWidget(hostId){
  var host=document.getElementById(hostId);if(!host)return;
  var d=null;try{d=await A("GET","/api/life/active")}catch(e){}
  if(!d||!d.challenges||!d.challenges.length){host.innerHTML="";return}
  var h='<div class="sc"><span class="sc-l">🏆 '+tr("life_challenges")+'<span class="sc-cnt">'+d.challenges.length+'</span></span></div>';
  d.challenges.forEach(function(c){h+=_lifeWGCard(c,hostId)});
  host.innerHTML=h;
}
function _lifeWGCard(c,hostId){
  if(c.kind==="score"&&c.participants&&c.participants.length>=2){
    var a=c.participants[0],b=c.participants[1];
    var ca=_lifeMColor(a.user_id),cb=_lifeMColor(b.user_id);
    var bg='linear-gradient(90deg, color-mix(in srgb,'+ca+' 18%,var(--cd)) 0%, var(--cd) 46%, var(--cd) 54%, color-mix(in srgb,'+cb+' 18%,var(--cd)) 100%)';
    var h='<div class="lcw" style="background:'+bg+'">';
    h+='<div class="lcw-title">'+es(c.emoji||"🏆")+' '+es(c.title)+'<span class="lcw-days">'+trn("life_ch_days_left",c.days_left)+'</span></div>';
    h+='<div class="lcw-board">';
    [[a,ca],[b,cb]].forEach(function(pp,idx){
      var p=pp[0],col=pp[1];
      h+='<div class="lcw-side">'+mAv(p.user_id,34)+'<div class="lcw-name">'+es(mName(p.user_id))+'</div>';
      h+='<div class="lcw-num" style="color:'+col+'">'+p.progress+'</div>';
      h+='<div class="lcw-ctrl"><button class="lcw-b" onclick="_lifeWGScore('+c.id+','+p.user_id+',-1,\''+hostId+'\')">−</button><button class="lcw-b" onclick="_lifeWGScore('+c.id+','+p.user_id+',1,\''+hostId+'\')">+</button></div></div>';
      if(idx===0)h+='<div class="lcw-vs">:</div>';
    });
    h+='</div></div>';
    return h;
  }
  var prog=c.progress,tgt=c.target;
  var pct=tgt>0?Math.min(100,Math.round(prog/tgt*100)):0;
  var h='<div class="lcw lcw-mini"><div class="lcw-mini-em">'+es(c.emoji||"🏆")+'</div><div class="lcw-mini-bd"><div class="lcw-mini-t">'+es(c.title)+'</div>';
  h+='<div class="lcw-mini-bar"><div style="width:'+pct+'%;background:var(--pr)"></div></div></div>';
  h+='<div class="lcw-mini-r">'+prog+(tgt>0?'/'+tgt:'')+'</div></div>';
  return h;
}
async function _lifeWGScore(cid,uid,delta,hostId){
  hp(delta>0?"ok":"light");
  try{await A("POST","/api/life/challenges/"+cid+"/score",{user_id:uid,delta:delta})}catch(e){}
  _lifeWidget(hostId);
}

// ─── Love Points — dedicated monthly couple scoreboard (Profile) ──────────
// Separate entity from challenges. Points given with a reason + emoji, tallied
// per calendar month; a faint Stats button reveals who gave what & when.
var _loveData=null,_loveEmoPick="❤️",_loveSign=1;
async function _loveCard(hostId){
  var host=document.getElementById(hostId);if(!host)return;
  var d=null;try{d=await A("GET","/api/love")}catch(e){}
  if(!d||!d.members||d.members.length<2){host.innerHTML="";return}
  _loveData=d;
  var m=d.members.slice(0,2),sc=d.scores||{};
  var bg='linear-gradient(90deg, color-mix(in srgb,'+(m[0].color||"var(--pr)")+' 18%,var(--cd)) 0%, var(--cd) 46%, var(--cd) 54%, color-mix(in srgb,'+(m[1].color||"var(--pr)")+' 18%,var(--cd)) 100%)';
  var h='<div class="love-card" style="background:'+bg+'">';
  h+='<div class="love-head">💕 '+tr("love_title")+'</div>';
  h+='<div class="love-days">'+trn("love_days_left",d.days_left)+'</div>';
  h+='<div class="love-board">';
  m.forEach(function(p,idx){
    var col=p.color||"var(--pr)",n=sc[String(p.user_id)]||0,win=d.leader===p.user_id;
    h+='<div class="love-side">'+mAv(p.user_id,38)+'<div class="love-name">'+es(p.user_name)+(win?' 👑':'')+'</div>';
    h+='<div class="love-num" style="color:'+col+'">'+n+'</div>';
    var nm=es(p.user_name).replace(/'/g,"\\'");
    h+='<div class="love-ctrl"><button class="love-b" onclick="_loveAward('+p.user_id+",'"+nm+"',-1)\">−</button>"+
       '<button class="love-b love-plus" style="border-color:'+col+'66" onclick="_loveAward('+p.user_id+",'"+nm+"',1)\">+</button></div></div>";
    if(idx===0)h+='<div class="love-vs">:</div>';
  });
  h+='</div>';
  h+='<button class="love-stats" onclick="_loveStats()">'+tr("love_stats")+'</button>';
  h+='</div>';
  host.innerHTML=h;
}
// sign: +1 award (give a point), -1 deduction (take a point) — both ask why.
function _loveAward(uid,name,sign){
  sign = (sign<0)?-1:1;
  _loveSign = sign;
  hp("light");
  var emos = sign>0 ? ["❤️","😘","🤗","☕","🍳","🌹","🧹","💪","🎁","😂","🙏","✨"]
                    : ["💔","😤","🙄","🗑️","😴","🤦","🙈","⏰","🧊","😅","🚱","💤"];
  var defEmo = emos[0];
  var titleTxt = sign>0 ? tr("love_award_to") : tr("love_deduct_to");
  var h='<div class="love-aw"><div class="love-aw-t'+(sign<0?' love-aw-neg':'')+'">'+titleTxt.replace("%s",es(name))+'</div>';
  h+='<input class="inp" id="love-rsn" placeholder="'+tr("love_reason_ph")+'" maxlength="120" autocomplete="off">';
  h+='<div class="love-emos" id="love-emos">';
  emos.forEach(function(e,i){h+='<button class="love-emo'+(i===0?" s":"")+'" onclick="_loveEmo(this,\''+e+'\')">'+e+'</button>'});
  h+='</div>';
  h+='<button class="btn'+(sign<0?' love-btn-neg':'')+'" style="width:100%;margin-top:6px" onclick="_loveDoAward('+uid+')">'+(sign>0?tr("love_give"):tr("love_take"))+'</button></div>';
  _loveEmoPick=defEmo;
  oMC(tr("love_title"),h);
}
function _loveEmo(btn,e){_loveEmoPick=e;document.querySelectorAll("#love-emos .love-emo").forEach(function(b){b.classList.remove("s")});btn.classList.add("s");hp("sel")}
async function _loveDoAward(uid){
  var rsn=((document.getElementById("love-rsn")||{}).value||"").trim();
  hp(_loveSign>0?"ok":"light");
  try{await A("POST","/api/love",{to_user:uid,reason:rsn,emoji:_loveEmoPick,delta:_loveSign})}catch(e){}
  cMo();_loveRefresh();
}
function _loveRefresh(){
  if(document.getElementById("love-prof"))_loveCard("love-prof");
  if(document.getElementById("love-home"))_loveCard("love-home");
}
// ── Love Points history — monthly bars (me=blue / partner=pink) + per-month log
var _loveHist=null,_loveHistYM=null;
// Per-person accent for this view: ME → blue, partner → pink (overrides avatar
// colours, as requested). The ±1 entry values stay green/red by sign.
function _loveColor(uid){ return (fS && uid===fS.my_id) ? "#5B9BFF" : "#FF7EB6"; }
function _loveCurYM(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function _loveMonShort(ym){
  var p=String(ym).split("-"), dt=new Date(+p[0],+p[1]-1,1);
  return dt.toLocaleDateString((_lang==="ru")?"ru-RU":"en-US",{month:"short"});
}
async function _loveStats(){
  hp("light");
  var hist=null;try{hist=await A("GET","/api/love/history?months=6")}catch(e){}
  _loveHist=hist;
  var months=(hist&&hist.months)||[];
  _loveHistYM=months.length?months[months.length-1].ym:_loveCurYM();
  oMC(tr("love_stats_title"), _loveHistHtml());
  _loveLoadMonth(_loveHistYM);
}
// Bar chart: one column-group per month, two bars (me blue / partner pink).
function _loveHistHtml(){
  var months=(_loveHist&&_loveHist.months)||[], mem=(_loveHist&&_loveHist.members)||[];
  var ids=mem.map(function(x){return x.user_id});
  var mx=1;
  months.forEach(function(mo){ ids.forEach(function(id){ mx=Math.max(mx,Math.abs((mo.scores||{})[String(id)]||0)) }) });
  var h='<div class="lh-chart">';
  months.forEach(function(mo){
    var sel=(mo.ym===_loveHistYM);
    h+='<div class="lh-mcol'+(sel?' a':'')+'" onclick="_loveHistPick(\''+mo.ym+'\')"><div class="lh-bars">';
    ids.forEach(function(id){
      var v=(mo.scores||{})[String(id)]||0, col=_loveColor(id);
      var hgt=Math.round(58*Math.max(0,v)/mx);
      h+='<div class="lh-barw"><div class="lh-bval" style="color:'+col+'">'+(v||"")+'</div><div class="lh-bar" style="height:'+hgt+'px;background:'+col+'"></div></div>';
    });
    h+='</div><div class="lh-mlbl">'+_loveMonShort(mo.ym)+'</div></div>';
  });
  h+='</div><div id="love-month-body"></div>';
  return h;
}
function _loveHistPick(ym){
  _loveHistYM=ym; hp("sel");
  var mb=document.getElementById("mb"); if(mb)mb.innerHTML=_loveHistHtml();
  _loveLoadMonth(ym);
}
// Selected month: per-person totals + the entry log (categories analog).
async function _loveLoadMonth(ym){
  var d=null;try{d=await A("GET","/api/love/stats?ym="+ym)}catch(e){}
  var el=document.getElementById("love-month-body"); if(!el)return;
  var ents=(d&&d.entries)||[];
  var mo=((_loveHist&&_loveHist.months)||[]).find(function(x){return x.ym===ym})||{scores:{}};
  var mem=(_loveHist&&_loveHist.members)||[];
  var h='<div class="lh-tot">';
  mem.forEach(function(m){
    var v=(mo.scores||{})[String(m.user_id)]||0, col=_loveColor(m.user_id);
    h+='<div class="lh-tot-c">'+mAv(m.user_id,32)+'<div class="lh-tot-n" style="color:'+col+'">'+v+'</div><div class="lh-tot-l">'+es(m.user_name)+'</div></div>';
  });
  h+='</div>';
  h+='<div class="love-log">';
  if(!ents.length)h+='<div class="love-log-empty">'+tr("love_no_points")+'</div>';
  ents.forEach(function(e){
    var neg=(e.delta||1)<0;
    h+='<div class="love-log-row'+(neg?' love-log-neg':'')+'">'+mAv(e.to_user,30)+
       '<div class="love-log-bd"><div class="love-log-r">'+es(e.emoji||"❤️")+' '+es(e.reason||tr("love_a_point"))+'</div>'+
       '<div class="love-log-m">'+tr("love_from").replace("%s",es(mName(e.from_user)))+' · '+_loveAgo(e.created_at)+'</div></div>'+
       '<div class="love-log-d">'+(neg?'−1':'+1')+'</div></div>';
  });
  h+='</div>';
  el.innerHTML=h;
}
function _loveAgo(iso){
  if(!iso)return"";
  var t=new Date(iso),s=Math.floor((new Date()-t)/1000);
  if(s<60)return tr("just_now");
  if(s<3600)return Math.floor(s/60)+tr("m_ago");
  if(s<86400)return Math.floor(s/3600)+tr("h_ago");
  return t.toLocaleDateString(undefined,{day:"numeric",month:"short"});
}

function assignPk(id,sel){
let h='<div class="or" id="'+id+'"><span class="ch'+((!sel)?" s":"")+'" style="background:var(--wn)22;color:var(--wn);cursor:pointer" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign=0">👨‍👩‍👧</span>';
D.members.forEach(function(m){h+='<span class="ch'+(sel===m.user_id?" s":"")+'" style="background:'+m.color+'22;color:'+m.color+';cursor:pointer;display:inline-flex;align-items:center;gap:6px" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign='+m.user_id+'">'+mAv(m.user_id,18)+es(m.user_name)+'</span>'});
return h+'</div>'}

// ─── Reminder pickers ───────────────────────────────────────
function remPk(){let h='';_rems.forEach(function(r,i){var p=(r||"").split(" ");
h+='<div class="ri"><input type="date" value="'+(p[0]||"")+'" onchange="_rems['+i+']=this.value+\' \'+(_rems['+i+']||\'\').split(\' \')[1]||\'09:00\'" style="flex:1"><input type="time" value="'+(p[1]||"09:00")+'" step="60" onchange="_rems['+i+']=(_rems['+i+']||\'\').split(\' \')[0]+\' \'+this.value" style="width:100px"><button class="bi" onclick="_rems.splice('+i+',1);document.getElementById(\'rw\').innerHTML=remPk()">'+I.x+'</button></div>'});
if(_rems.length<5)h+='<div class="or" style="margin-top:6px"><button class="ob" onclick="_rems.push(td()+\' 09:00\');document.getElementById(\'rw\').innerHTML=remPk()">+ Custom</button><button class="ob" onclick="addPresetRem(\'1d\')">+1d</button><button class="ob" onclick="addPresetRem(\'3d\')">+3d</button><button class="ob" onclick="addPresetRem(\'1w\')">+1w</button></div>';return h}
function addPresetRem(type){if(_rems.length>=5)return;var dd=document.getElementById("f-dd");var base=dd?dd.value:td();if(!base)base=td();var d=new Date(base);if(type==="1d")d.setDate(d.getDate()-1);else if(type==="3d")d.setDate(d.getDate()-3);else if(type==="1w")d.setDate(d.getDate()-7);_rems.push(d.toISOString().split("T")[0]+" 09:00");document.getElementById("rw").innerHTML=remPk()}
function bdRemPk(){var h="";_bdRems.forEach(function(r,i){h+='<div class="ri" style="margin-bottom:6px"><input type="number" value="'+r.days_before+'" min="0" max="30" onchange="_bdRems['+i+'].days_before=+this.value" style="width:60px;padding:6px;border-radius:8px;border:1px solid var(--bd);background:var(--cd);color:var(--tx);text-align:center"> days before <input type="time" value="'+r.time+'" step="60" onchange="_bdRems['+i+'].time=this.value" style="width:100px"><button class="bi" onclick="_bdRems.splice('+i+',1);document.getElementById(\'brl\').innerHTML=bdRemPk()">'+I.x+'</button></div>'});if(_bdRems.length<5)h+='<button class="ob" onclick="_bdRems.push({days_before:0,time:\'09:00\'});document.getElementById(\'brl\').innerHTML=bdRemPk()">+ Add</button>';return h}
function subRemPk(){var h="";_subRems.forEach(function(r,i){h+='<div class="ri" style="margin-bottom:6px"><input type="number" value="'+r.days_before+'" min="0" max="30" onchange="_subRems['+i+'].days_before=+this.value" style="width:60px;padding:6px;border-radius:8px;border:1px solid var(--bd);background:var(--cd);color:var(--tx);text-align:center"> days before <input type="time" value="'+r.time+'" step="60" onchange="_subRems['+i+'].time=this.value" style="width:100px"><button class="bi" onclick="_subRems.splice('+i+',1);document.getElementById(\'srl\').innerHTML=subRemPk()">'+I.x+'</button></div>'});if(_subRems.length<5)h+='<button class="ob" onclick="_subRems.push({days_before:1,time:\'09:00\'});document.getElementById(\'srl\').innerHTML=subRemPk()">+ Add</button>';return h}
function zRemPk(){var h='';_zRems.forEach(function(r,i){var p=(r||"").split(" ");h+='<div class="ri"><input type="date" value="'+(p[0]||"")+'" onchange="_zRems['+i+']=this.value+\' \'+(_zRems['+i+']||\'\').split(\' \')[1]||\'09:00\'" style="flex:1"><input type="time" value="'+(p[1]||"09:00")+'" step="60" onchange="_zRems['+i+']=(_zRems['+i+']||\'\').split(\' \')[0]+\' \'+this.value" style="width:100px"><button class="bi" onclick="_zRems.splice('+i+',1);document.getElementById(\'zrw\').innerHTML=zRemPk()">'+I.x+'</button></div>'});if(_zRems.length<5)h+='<button class="ob" onclick="_zRems.push(td()+\' 09:00\');document.getElementById(\'zrw\').innerHTML=zRemPk()">+ Add</button>';return h}

// ─── Subtask helpers ────────────────────────────────────────
function sC(t,id){var s=allSubs[t]&&allSubs[t][id]?allSubs[t][id]:[];if(!s.length)return "";var d=s.filter(function(x){return x.done}).length;return '<span style="font-size:11px;color:'+(d===s.length?"var(--ok)":"var(--ht)")+';font-weight:600">'+d+'/'+s.length+'</span>'}
// BUGFIX (v8.39.1): renamed param `t` -> `pt` (parent_type). Inside the body we call
// tr("su_add_step") + tr("su_add") for i18n — with a `t` param that would shadow the helper.
function rSu(pt,id){var k=pt+"_"+id;if(!ex[k])return "";var s=allSubs[pt]&&allSubs[pt][id]?allSubs[pt][id]:[];var h='<div class="sbs">';s.forEach(function(x){h+='<div class="si"><div class="cb cb-s '+(x.done?"cb-k":"cb-o")+'" onclick="tSu('+x.id+')">'+(x.done?I.ck:"")+'</div><span class="sx'+(x.done?" dn":"")+'">'+es(x.text)+'</span><button class="bi" onclick="dSu('+x.id+')">'+I.x+'</button></div>'});h+='</div><div class="sa"><input id="si-'+pt+'-'+id+'" placeholder="'+tr("su_add_step")+'" onkeydown="if(event.key===\'Enter\')aSu(\''+pt+'\','+id+')"><button onclick="aSu(\''+pt+'\','+id+')">'+tr("su_add")+'</button></div>';return h}
function tX(t,id){ex[t+"_"+id]=!ex[t+"_"+id];ren()}
async function tSu(sid){hp();await A("PATCH","/api/subtasks/"+sid+"/toggle");await load()}
async function dSu(sid){hp();await A("DELETE","/api/subtasks/"+sid);await load()}
async function aSu(t,pid){var i=document.getElementById("si-"+t+"-"+pid);if(!i||!i.value.trim())return;await A("POST","/api/subtasks/"+t+"/"+pid,{text:i.value.trim()});hp();await load()}

// ═══════════════════════════════════════════════════════════
// NAVIGATION — customizable per-member bottom nav (v8.47.0) + hamburger
// ═══════════════════════════════════════════════════════════
// TT — tab title/subtitle catalog. Used by go() to set the header per tab.
const TT={home:{i:"home",t:"Family HQ",s:"Everything at a glance"},tasks:{i:"clipboard",t:"Tasks",s:"Manage & assign"},shop:{i:"cart",t:"Shopping",s:"Shared list"},trainings:{i:"dumbbell",t:"Trainings",s:"Workouts & progress"},words:{i:"book",t:"Words",s:"Vocabulary learning"},plants:{i:"flower",t:"Plants",s:"Care & watering"},cooking:{i:"chef",t:"Cooking",s:"Dishes & ingredient costs"},
life:{i:"life",t:"Life",s:"Your living balance"},money:{i:"dollar",t:"Money",s:"Budget & subs"},profile:{i:"user",t:"Profile",s:"Personal stats"},events:{i:"clock",t:"Events",s:"Schedule"},birthdays:{i:"cake",t:"Birthdays",s:"Never forget"},clean:{i:"broom",t:"Cleaning",s:"Apartment zones"},settings:{i:"cog",t:"Settings",s:"Customize"},subs:{i:"card",t:"Subscriptions",s:"Monthly payments"}};

// NV_ALL — every tab that's eligible for the bottom nav. Per-icon `sv` field
// holds the same inline SVG as old NV; for new tabs we fall back to icon().
// Order here is the default order the picker UI presents.
const NV_ALL=[
  {id:"home",   sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'},
  {id:"tasks",  sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'},
  {id:"words",  sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'},
  {id:"money",  sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'},
  {id:"profile",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'},
  // Hamburger-page candidates that can be promoted to nav. Use icon() helper so we stay
  // consistent with the same glyphs the hamburger menu uses for these features.
  {id:"shop",       icon_name:"cart"},
  {id:"cooking",    icon_name:"chef"},
  {id:"life",       icon_name:"life"},
  {id:"trainings",  icon_name:"dumbbell"},
  {id:"plants",     icon_name:"flower"},
  {id:"birthdays",  icon_name:"cake"},
  {id:"clean",      icon_name:"broom"},
  {id:"subs",       icon_name:"card"},
  {id:"settings",   icon_name:"cog"},
];
const NV_DEFAULT_ORDER=["home","tasks","words","money","profile"];

// `_navTabs` is set from /api/family/status (null = use NV_DEFAULT_ORDER).
// Mutated by saveNavTabs() in settings.js after the picker modal commits.
var _navTabs=null;
function _currentNavIds(){
  var ids=(_navTabs&&_navTabs.length)?_navTabs:NV_DEFAULT_ORDER;
  // Safety filter — drop any unknown ids that drifted from older saves.
  var known={};NV_ALL.forEach(function(x){known[x.id]=x});
  return ids.filter(function(id){return known[id]});
}

// Rebuild the #nv element from the user's current preference. Called on boot
// (after family/status), after setLang() (so labels update), and after the
// picker saves a new layout.
function _buildNav(){
  var n=document.getElementById("nv");if(!n)return;
  var ids=_currentNavIds();
  n.innerHTML="";
  var byId={};NV_ALL.forEach(function(x){byId[x.id]=x});
  ids.forEach(function(id){
    var item=byId[id];if(!item)return;
    var glyph=item.sv||icon(item.icon_name||"cog",22,2);
    var b=document.createElement("button");
    b.className="ni"+(tab===id?" a":"");
    b.dataset.t=id;
    b.innerHTML='<span class="nb hidden" id="b-'+id+'"></span>'+glyph+'<span>'+tr("nav_"+id)+'</span>';
    b.onclick=function(){go(id)};
    n.appendChild(b);
  });
  // Keep the hamburger menu in sync — it shows everything NOT in the bottom nav.
  if(typeof rMenuItems==="function")rMenuItems();
}
_buildNav();

function go(tabId){
// Stop the Life graph RAF when leaving the tab (frees the animation loop).
if(tab==="life"&&tabId!=="life"&&typeof lifeUnmount==="function")lifeUnmount();
tab=tabId;filt=null;searchQ="";menuOpen=false;
document.getElementById("menu-overlay").classList.remove("open");
var si=document.getElementById("si");if(si)si.value="";
document.querySelectorAll(".ni").forEach(function(e){e.classList.toggle("a",e.dataset.t===tabId)});
var _tt=TT[tabId]||{i:""};
document.getElementById("hi").innerHTML=_tt.i?icon(_tt.i,22,2.2):"";
// Localized title + subtitle via tr(). Falls back to the static TT entry if no key found.
document.getElementById("ht").textContent=tr("tt_"+tabId+"_t")||_tt.t||"";
document.getElementById("hs").textContent=tr("tt_"+tabId+"_s")||_tt.s||"";
// When entering Tasks tab and the last-selected sub-tab isn't Active, override header to match the sub-tab
if(tabId==="tasks"&&taskTab&&taskTab!=="active"){
  var _hi=document.getElementById("hi");
  if(taskTab==="events"){_hi.innerHTML=icon("clock",22,2.2);document.getElementById("ht").textContent=tr("tt_events_t");document.getElementById("hs").textContent=tr("tt_events_s");_evtsFirstRender=true}
  else if(taskTab==="recurring"){_hi.innerHTML=icon("refresh",22,2.2);document.getElementById("ht").textContent=tr("tt_recurring_t");document.getElementById("hs").textContent=tr("tt_recurring_s")}
}
// BUGFIX (v8.39.1): these used to reference `t` when the function was `go(t)`.
// During the i18n rename to `go(tabId)`, these stayed as `t` — which now silently
// resolves to the global i18n helper function. noFab.indexOf(function) → -1 →
// FAB never hidden; t==="words" → false → `words-mode` class never set → Words
// tab loses its full-screen takeover and scrolls vertically.
var noFab=["home","settings","clean","events","birthdays","subs","profile","trainings","words","plants","life"];
var hideFab=noFab.indexOf(tabId)>=0||(tabId==="tasks"&&taskTab==="events");
document.getElementById("fab").classList.toggle("hidden",hideFab);
// Words mode renders its own header — hide the global one. Life does the same:
// full-bleed immersive graph canvas with its own in-canvas chrome.
document.body.classList.toggle("words-mode",tabId==="words");
document.body.classList.toggle("life-mode",tabId==="life");
if(tabId==="home")_firstHomeRender=true;
if(tabId==="events")_evtsFirstRender=true;
if(tabId==="profile")_profStats=null;
if(tabId==="words")_wordsFirstLoad=true;
if(tabId==="trainings")_trainStats=null;
if(tabId==="cooking"){
  // Lazy first-load: fetch dishes if we haven't yet (or after a saved edit cleared them).
  A("GET","/api/dishes").then(function(r){if(r&&r.dishes){D.dishes=r.dishes;if(tab==="cooking")ren()}});
}
if(tabId==="life"){
  // Lazy-load the graph engine on first Life visit — keeps initial app load light
  // (the SVG engine + physics shouldn't ship to users who never open Life).
  // `had` guards against a double-render: if life.js was already loaded, the
  // main ren() below handles it; the callback only fires the re-render on the
  // very first load (when rLife wasn't available during that ren()).
  var _hadLife=(typeof rLife==="function");
  _ensureLife(function(){ if(!_hadLife && tab==="life") ren(); });
}
ren();hp("sel")}

// Dynamic <script> loader for life.js — loaded once, on demand.
var _lifeLoading=false,_lifeReady=(typeof rLife==="function");
function _ensureLife(cb){
  if(_lifeReady||typeof rLife==="function"){_lifeReady=true;cb&&cb();return}
  if(_lifeLoading){var iv=setInterval(function(){if(typeof rLife==="function"){clearInterval(iv);_lifeReady=true;cb&&cb()}},60);return}
  _lifeLoading=true;
  // Reuse the cache-buster the page was loaded with so life.js stays in lockstep
  // with the rest of the bundle (derived from app.js's own <script src> ?v=N).
  var ver="1";
  try{var m=(document.querySelector('script[src*="/static/app.js"]')||{}).src||"";var mm=m.match(/[?&]v=([^&]+)/);if(mm)ver=mm[1]}catch(e){}
  var s=document.createElement("script");
  s.src="/static/life.js?v="+ver;
  s.onload=function(){_lifeReady=true;_lifeLoading=false;cb&&cb()};
  s.onerror=function(){_lifeLoading=false;console.error("[life] failed to load life.js")};
  document.head.appendChild(s);
}

// Hamburger menu
function toggleMenu(){menuOpen=!menuOpen;document.getElementById("menu-overlay").classList.toggle("open",menuOpen)}

// ─── Onboarding ─────────────────────────────────────────────
// "Browser mode" = no Telegram initData. We use iD (not tg) because the Telegram script
// creates window.Telegram.WebApp even outside Telegram — only initData is reliable.
async function init(){
if(!iD && !_getSess() && !(typeof DEMO!=="undefined" && DEMO)){rLogin();return}
try{var r=await A("GET","/api/family/status");if(!r){if(!iD)rLogin();return}fS=r;
// Restore user's preferred language so the first render is already localized.
if(r.lang){_lang=r.lang;_rebuildLocaleArrays()}
// Restore user's custom bottom-nav layout. _buildNav() reads _navTabs (null = default).
if(r.nav_tabs!==undefined)_navTabs=r.nav_tabs;
_buildNav();
if(r.joined){document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load();
  // What's New — show once after first paint if the user hasn't seen the latest release yet.
  if(typeof maybeShowWhatsNew==="function")maybeShowWhatsNew();
}else rOnb()}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+'</pre>'}}


// ─── Load (bundle) ──────────────────────────────────────────
async function load(){var b=await A("GET","/api/bundle");if(!b)return;
// Any CRUD that triggers load() may have changed tasks/events/etc that the calendar
// caches separately by month. Drop the cache so next strip/modal render fetches fresh
// — fixes "task still pending in Today after marking done in Tasks tab" class of bugs.
try{_calCache={}}catch(e){}
D.tasks=b.tasks||[];D.recurring=b.recurring||[];D.shopping=b.shopping||[];D.folders=b.folders||[];
D.events=b.events||[];D.birthdays=b.birthdays||[];D.subs=b.subs||[];
D.dashboard=b.dashboard||{};D.members=b.members||[];D.settings=b.settings||{};
if(b.family&&b.family.joined)fS=b.family;D.zones=b.zones||[];
allSubs.task=b.subtasks_task||{};allSubs.event=b.subtasks_event||{};D.txItems=b.tx_items||{};
D.weather=b.weather||null;D.categories=b.categories||[];D.transactions=b.transactions||[];
D.exercises=b.exercises||[];D.recentWorkouts=b.recent_workouts||[];D.workoutTemplates=b.workout_templates||[];
D.plants=b.plants||[];
// Dishes are loaded lazily on first Cooking-tab visit (rCooking pulls them).
if(D.dishes===undefined)D.dishes=[];
// Sync Words state from member data so Settings can read it without opening Words first.
try{_wordsInitMode()}catch(e){}
aT(D.settings.theme||"moya");ren()}

// ─── Render ─────────────────────────────────────────────────
var _firstHomeRender=true;
function ren(){var c=document.getElementById("ct");
var tp=D.tasks.filter(function(x){return!x.done}).length;
var sp=D.shopping.filter(function(x){return!x.bought}).length;
var ct=D.dashboard.cleaning_dirty||0;
sB("tasks",tp);
rMenuItems();
switch(tab){
case"home":c.innerHTML=rH();if(_firstHomeRender){_firstHomeRender=false;FX.countStats(c)}break;case"tasks":c.innerHTML=rT();break;
case"shop":c.innerHTML=rSh();break;case"money":c.innerHTML=rMoney();break;
case"trainings":c.innerHTML=rTrain();break;
case"events":c.innerHTML=rEvts();break;case"birthdays":c.innerHTML=rBdays();break;
case"clean":c.innerHTML=rC();break;case"settings":c.innerHTML=rSet();break;case"subs":c.innerHTML=rSubsList();break;case"profile":c.innerHTML=rProfile();break;case"words":c.innerHTML=rWords();break;case"plants":c.innerHTML=rPlants();break;case"cooking":c.innerHTML=rCooking();break;case"life":c.innerHTML=(typeof rLife==="function"?rLife():'');break}}
function sB(t,n){var e=document.getElementById("b-"+t);if(!e)return;if(n>0){e.textContent=n;e.classList.remove("hidden")}else e.classList.add("hidden")}

// Hamburger menu — dynamically rendered with counters.
// v8.47.1: shows EVERY navigable tab that isn't currently in the bottom nav. So
// if the user promotes e.g. `shop` to bottom nav, it disappears from here; if
// they demote e.g. `tasks` (default-nav) from bottom nav, it shows up here. The
// candidate order is fixed (HM_ORDER) so the menu doesn't reshuffle wildly.
function rMenuItems(){
var el=document.getElementById("menu-items");if(!el)return;
// Also localize the menu header ("Menu" / "Меню") — DOM-driven from index.html
var mh=document.querySelector('.menu-h');if(mh)mh.textContent=tr("g_menu");
// Compute "active" counts per section
var cnt={
shop: (D.shopping||[]).filter(function(s){return!s.bought}).length,
events: (D.events||[]).filter(function(e){var d=(e.event_date||"").split(" ")[0];if(!d)return false;var diff=Math.round((new Date(d)-new Date(td()))/86400000);return diff>=0&&diff<=7}).length,
birthdays: (D.birthdays||[]).filter(function(b){return b.days_until!=null&&b.days_until>=0&&b.days_until<=7}).length,
clean: (D.zones||[]).filter(function(z){return z.dirty}).length,
subs: (D.subs||[]).filter(function(s){return s.days_until!=null&&s.days_until>=0&&s.days_until<=5}).length,
plants: (D.plants||[]).filter(function(p){return p.status==="thirsty"}).length,
tasks: (D.tasks||[]).filter(function(x){return!x.done}).length,
};
// Catalog of hamburger candidates (icon + counter key). HM_CORE comes first in
// a stable order, HM_SETTINGS lives in a separate visual group at the bottom.
var ITEMS={
home:      {ic:"home"},
tasks:     {ic:"clipboard", cntKey:"tasks"},
words:     {ic:"book"},
money:     {ic:"dollar"},
profile:   {ic:"user"},
shop:      {ic:"cart",      cntKey:"shop"},
cooking:   {ic:"chef"},
life:      {ic:"life"},
trainings: {ic:"dumbbell"},
plants:    {ic:"flower",    cntKey:"plants"},
birthdays: {ic:"cake",      cntKey:"birthdays"},
clean:     {ic:"broom",     cntKey:"clean"},
subs:      {ic:"card",      cntKey:"subs"},
settings:  {ic:"cog"},
};
var HM_CORE=["shop","cooking","life","trainings","plants","birthdays","clean","subs","tasks","words","money","profile","home"];
// Tabs currently shown in the bottom nav — exclude them here so we don't duplicate.
var inNav={};_currentNavIds().forEach(function(id){inNav[id]=true});
var rendered=[];
HM_CORE.forEach(function(id){if(inNav[id])return;rendered.push(id)});
var h='';
rendered.forEach(function(id){
var it=ITEMS[id];if(!it)return;
var n=it.cntKey?(cnt[it.cntKey]||0):0;
var b=n>0?'<span class="mi-cnt">'+n+'</span>':'';
h+='<button class="menu-i" onclick="go(\''+id+'\')"><span class="mi-ico">'+icon(it.ic,20,2)+'</span><span class="mi-l">'+tr("nav_"+id)+'</span>'+b+'</button>';
});
// Settings sits in its own group at the bottom unless already promoted to bottom nav.
if(!inNav["settings"]){
if(rendered.length)h+='<div style="height:1px;background:var(--bd);margin:8px 0"></div>';
h+='<button class="menu-i" onclick="go(\'settings\')"><span class="mi-ico">'+icon("cog",20,2)+'</span><span class="mi-l">'+tr("nav_settings")+'</span></button>';
}
el.innerHTML=h;
// Show dot on hamburger icon if any visible section has active items
var totalActive=rendered.reduce(function(s,id){var k=ITEMS[id]&&ITEMS[id].cntKey;return s+(k?(cnt[k]||0):0)},0);
var dot=document.getElementById("hm-dot");if(dot)dot.classList.toggle("hidden",totalActive===0);
}

// ═══════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════
function rH(){var d=D.dashboard,n=new Date();
var h='<p style="color:var(--ht);font-size:14px;margin:0 0 4px;font-weight:500">'+dF[n.getDay()]+", "+mN[n.getMonth()]+" "+n.getDate()+'</p>';
// Weather (wrapped in ambient wbg container — CSS @keyframes handles the animation)
var w=D.weather;
if(w&&w.days){var cat=FX.wCat(w.label);
// Try a video background loop (in /static/weather/{cat}.mp4). Falls back silently to the CSS gradient + particle layers if file missing / 404 / offline-uncached.
var _vd='<video class="wbg-vd" autoplay muted loop playsinline webkit-playsinline disablepictureinpicture preload="metadata" onloadeddata="this.classList.add(\'loaded\');this.parentNode.classList.add(\'has-video\');this.play&&this.play().catch(function(){})" onpause="var v=this;setTimeout(function(){v.isConnected&&v.play&&v.play().catch(function(){})},60)" onerror="this.remove()"><source src="/static/weather/'+cat+'.mp4" type="video/mp4"></video><div class="wbg-vd-scrim"></div>';
// Skip today in the right-side mini-forecast (today is the big temperature on the left)
var _next=(w.days||[]).slice(1,4);
var _city=w.city||"Belgrade";
h+='<div class="wbg wbg-'+cat+'" onclick="openWeatherPage()" style="cursor:pointer">'+_vd+
  '<div style="display:flex;align-items:flex-start;gap:12px;text-shadow:0 1px 3px rgba(0,0,0,.5)">'+
    '<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));flex-shrink:0">'+wIconAnim(w.label,52,true)+'</div>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:30px;font-weight:800;color:#fff;line-height:1.05">'+w.now+'°</div>'+
      '<div style="font-size:13px;color:rgba(255,255,255,.88);font-weight:600;margin-top:3px;letter-spacing:.2px;display:flex;align-items:center;gap:4px">'+icon("pin",11,2)+es(_city)+'</div>'+
      '<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:1px">'+tr("g_feels")+' '+w.feels+'°</div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;align-self:flex-start">';
_next.forEach(function(dy,i){var lbl=i===0?tr("g_tomorrow"):wDayName(dy.date);h+='<div style="text-align:center;min-width:40px"><div style="font-size:9px;color:rgba(255,255,255,.65);font-weight:600">'+lbl+'</div><div style="margin:2px auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));display:flex;justify-content:center">'+wIconAnim(dy.label,24,false)+'</div><div style="font-size:11px;font-weight:700;color:#fff">'+dy.max+'°</div><div style="font-size:9px;color:rgba(255,255,255,.55)">'+dy.min+'°</div></div>'});
h+='</div></div></div>'}else h+='<div style="margin-bottom:16px"></div>';
// Calendar strip
h+='<div class="sc">'+tr("g_calendar")+'</div>';
h+='<div class="cal-strip" onclick="openCalModal()" id="cal-strip"></div>';
setTimeout(function(){loadCalStrip()},0);
// Plants widget — horizontal scroll of plants with status. Only renders if any exist.
h+=_rPlantsWidget();
// Active Life challenges — scoreboard widget (async; empties itself if none).
h+='<div id="life-wg-home"></div>';
setTimeout(function(){_lifeWidget("life-wg-home")},0);
// Upcoming 7d — grouped by type (Tasks / Events / Subscriptions / Birthdays)
var todayStr=td();
var upTasks=[],upEvents=[],upSubs=[],upBdays=[];
// v8.49.8: each upcoming row carries (type,id) so a tap can open the same
// detail popup the calendar uses (showCalEv) — edit, mark-done, more info.
// v8.49.10: filter tasks to MINE (assigned_to == me) + unassigned. Events /
// subs / birthdays stay family-wide. fS.my_id comes from /api/family/status.
var _meId=fS&&fS.my_id;
D.tasks.forEach(function(t){
  if(t.done) return;
  if(_meId&&t.assigned_to&&t.assigned_to!==_meId) return; // hide other members' tasks
  var dd=(t.due_date||"").split(" ")[0]; if(!dd) return;
  var diff=Math.round((new Date(dd)-new Date(todayStr))/86400000);
  if(diff<0||diff>7) return;
  var acc=t.priority==="high"?"acc-ac":"acc-pr";
  var ico=t.priority==="high"?"⚠️":"📋";
  upTasks.push({days:diff,icon:ico,title:es(t.text),sub:fD(t.due_date).full,accClass:acc,type:"task",id:t.id});
});
D.events.forEach(function(ev){
  var eDate=(ev.event_date||"").split(" ")[0]; if(!eDate) return;
  var diff=Math.round((new Date(eDate)-new Date(todayStr))/86400000);
  if(diff>=0&&diff<=7) upEvents.push({days:diff,icon:"📅",title:es(ev.text),sub:fD(ev.event_date).full,accClass:"acc-ok",type:"event",id:ev.id});
});
D.subs.forEach(function(s){
  if(s.days_until>=0&&s.days_until<=7) upSubs.push({days:s.days_until,icon:s.emoji,title:es(s.name),sub:s.amount+" "+s.currency,accClass:"",type:"subscription",id:s.id});
});
D.birthdays.forEach(function(b){
  if(b.days_until>=0&&b.days_until<=7) upBdays.push({days:b.days_until,icon:b.emoji,title:es(b.name),sub:b.days_until===0?tr("g_today_bday"):trn("g_in_days_full",b.days_until),accClass:"acc-wn",type:"birthday",id:b.id});
});
[upTasks,upEvents,upSubs,upBdays].forEach(function(arr){arr.sort(function(a,b){return a.days-b.days})});
var totalUp=upTasks.length+upEvents.length+upSubs.length+upBdays.length;
function _upRow(u){
  var _ud=new Date(Date.now()+u.days*86400000);
  var dayLabel=u.days===0?tr("g_today"):u.days===1?tr("g_tomorrow"):dN[_ud.getDay()]+" "+_ud.getDate()+" "+mNS[_ud.getMonth()];
  var tone=u.days===0?"tone-ac":u.days<=2?"tone-wn":"tone-ok";
  var rightPill=u.days===0?'<span class="lc-rt '+tone+'">'+tr("g_today")+'</span>':'<span class="lc-rt '+tone+'">'+trn("g_in_days_short",u.days)+'</span>';
  // Tap-handler reuses showCalEv — same detail popup as the calendar day view
  // (edit, mark-done for tasks, info for events/subs/birthdays).
  var click=(u.type&&u.id!=null)?' onclick="showCalEv(\''+u.type+'\','+u.id+')" style="cursor:pointer"':'';
  return '<div class="lc"'+click+'><div class="lc-i '+(u.accClass||"")+'">'+u.icon+'</div><div class="lc-bd"><div class="lc-tt">'+u.title+'</div><div class="lc-mt">'+dayLabel+' · '+u.sub+'</div></div>'+rightPill+'</div>';
}
function _upGroup(label,color,arr){
  if(!arr.length) return '';
  var out='<div class="sc-sub" style="--gc:'+color+'"><span class="sc-sub-l">'+label+'</span><span class="sc-sub-line"></span><span class="sc-sub-c">'+arr.length+'</span></div>';
  arr.forEach(function(u){out+=_upRow(u)});
  return out;
}
if(totalUp){
  h+='<div class="sc"><span class="sc-l">'+tr("g_upcoming_7")+'<span class="sc-cnt">'+totalUp+'</span></span></div>';
  h+=_upGroup('📋 '+tr("g_tasks"),'var(--pr)',upTasks);
  h+=_upGroup('📅 '+tr("g_events"),'var(--ok)',upEvents);
  h+=_upGroup('💳 '+tr("g_subscriptions"),'var(--pr)',upSubs);
  h+=_upGroup('🎂 '+tr("g_birthdays"),'var(--wn)',upBdays);
}
return h}
async function svRec(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var rr=document.getElementById("rr").value;if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});rr="weekly:"+days.join(",")}else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1")}await A("PUT","/api/recurring/"+id,{text:text,assigned_to:_assign||null,rrule:rr,active:window._recActive});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}

// ═══════════════════════════════════════════════════════════
// SHOPPING — enhanced add flow
// ═══════════════════════════════════════════════════════════
function rSh(){
var h='<div class="fb2"><button class="fi '+(shopFold===null?"a":"")+'" onclick="shopFold=null;ren()">'+tr("g_filter_all")+'</button><button class="fi '+(shopFold==="stock"?"a":"")+'" onclick="shopFold=\'stock\';ren()"><span style="display:inline-flex;align-items:center;gap:4px">📦 '+tr("sh_in_stock")+'</span></button>';
D.folders.forEach(function(f){h+='<button class="fi '+(shopFold===f.id?"a":"")+'" onclick="shopFold='+f.id+';ren()"><span style="display:inline-flex;align-items:center;gap:4px">'+f.emoji+es(f.name)+'</span></button><button class="bi" onclick="edFolder('+f.id+')" style="padding:2px;margin-left:-6px">'+I.ed+'</button>'});
h+='<button class="fi" onclick="shAddFolder()"><span style="display:inline-flex;align-items:center;gap:4px">'+I.pl+'Folder</span></button></div>';
function _scH3(ico,label,cnt,extra,color){var iconHtml=ico?'<span class="sc-ico"'+(color?' style="color:'+color+'"':'')+'>'+icon(ico,12,2.4)+'</span>':'';return '<div class="sc"'+(color?' style="color:'+color+'"':'')+'><span class="sc-l">'+iconHtml+label+(cnt?'<span class="sc-cnt"'+(color?' style="background:color-mix(in srgb,'+color+' 16%,transparent);color:'+color+'"':'')+'>'+cnt+'</span>':"")+'</span>'+(extra||'')+'</div>'}
var items=D.shopping;
if(shopFold==="stock")items=items.filter(function(x){return x.bought});
else if(shopFold!==null)items=items.filter(function(x){return x.folder_id===shopFold&&!x.bought});
else items=items.filter(function(x){return!x.bought});
if(searchQ)items=items.filter(function(x){return matchQ(x.item)});
var folderTotal=0;items.forEach(function(x){if(x.price&&(shopFold==="stock"||!x.bought))folderTotal+=x.price});
if(folderTotal>0)h+='<div class="cat-row" style="margin-bottom:14px"><div class="cat-row-h"><span class="nm">'+tr("sh_total")+'</span><span class="vl" style="color:var(--wn)">'+folderTotal.toFixed(0)+' din.</span></div></div>';
if(shopFold==="stock"){
  if(!items.length)return h+em(icon("cart",48,1.8),tr("es_no_stock_t"),tr("es_no_stock_s"));
  h+=_scH3("ck",tr("sh_in_stock"),items.length,'<button class="at" onclick="clSh()">'+tr("sh_clear")+'</button>',"var(--ok)");
  var fMap={};D.folders.forEach(function(f){fMap[f.id]=f});var grps={};items.forEach(function(s){var k=s.folder_id||0;if(!grps[k])grps[k]=[];grps[k].push(s)});var ks=D.folders.map(function(f){return f.id}).filter(function(id){return grps[id]});if(grps[0])ks.push(0);var multi=ks.length>1||(ks.length===1&&ks[0]!==0);
  ks.forEach(function(k){var g=grps[k];if(multi){var label=k&&fMap[k]?(fMap[k].emoji+" "+es(fMap[k].name)):"Other";h+='<div class="sc" style="font-size:12px;margin-top:12px"><span class="sc-l">'+label+'<span class="sc-cnt">'+g.length+'</span></span></div>'}
  g.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c c-stk"><div class="cb cb-k" onclick="tgSh('+s.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})});
  return h
}
var p=items.filter(function(x){return!x.bought}),b=items.filter(function(x){return x.bought});
if(!items.length)return h+em(icon("cart",48,1.8),tr("es_no_shop_t"),tr("es_no_shop_s"));
if(p.length){h+=_scH3("cart","To Buy",p.length);
  p.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c"><div class="cb cb-o" onclick="tgSh('+s.id+',this)"></div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})}
if(b.length){h+=_scH3("ck",tr("sh_bought"),b.length,'<button class="at" onclick="clSh()">'+tr("sh_clear")+'</button>',"var(--ok)");
  b.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";h+='<div class="c d"><div class="cb cb-k" onclick="tgSh('+s.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(s.item)+" "+qtyHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button></div>'})}
return h}
async function tgSh(id,cb){
var s=D.shopping.find(function(x){return x.id===id});
var doing=s&&!s.bought;
var card=cb&&cb.closest?cb.closest(".c"):null;
if(doing&&card){
  var isLast=D.shopping.filter(function(x){return!x.bought}).length===1;
  hp("ok");
  cb.classList.remove("cb-o");cb.classList.add("cb-k","cb-flash");cb.innerHTML=I.ck;
  card.classList.add("c-pop");
  if(isLast){var r=card.getBoundingClientRect();FX.confetti({getBoundingClientRect:function(){return r}})}
  var apiP=A("PATCH","/api/shopping/"+id+"/toggle");
  setTimeout(function(){card.classList.remove("c-pop");card.classList.add("c-go")},260);
  setTimeout(async function(){await apiP;await load()},700);
}else{
  hp("light");
  await A("PATCH","/api/shopping/"+id+"/toggle");
  await load();
}}
async function dSh(id){hp("warn");await A("DELETE","/api/shopping/"+id);await load();toast("🗑 "+tr("ts_deleted"))}
async function clSh(){hp();await A("DELETE","/api/shopping/clear-bought");await load();toast("✓ Cleared")}
function edShop(sid){var s=D.shopping.find(function(x){return x.id===sid});if(!s)return;var folderOpts='<button class="ob '+(!s.folder_id?"s":"")+'" onclick="window._sFold=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">None</button>';D.folders.forEach(function(f){folderOpts+='<button class="ob '+(s.folder_id===f.id?"s":"")+'" onclick="window._sFold='+f.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+f.emoji+" "+es(f.name)+'</button>'});window._sFold=s.folder_id||0;oMC(tr("sh_edit_item"),'<input class="inp" id="se-n" value="'+es(s.item)+'"><div class="dr"><div><div class="dl">'+tr("f_quantity")+'</div><input class="inp" id="se-q" value="'+(s.quantity||"")+'" placeholder="'+tr("g_quantity_hint")+'"></div><div><div class="dl">Price (din.)</div><input class="inp" id="se-p" type="number" value="'+(s.price||"")+'" placeholder="0"></div></div>'+(D.folders.length?'<div class="lb">'+tr("f_folder")+'</div><div class="or">'+folderOpts+'</div>':'')+'<button class="btn" onclick="svShop('+sid+')">Save</button>',{ic:"cart"})}
async function svShop(sid){var n=document.getElementById("se-n").value.trim();var q=document.getElementById("se-q").value.trim();var p=parseFloat(document.getElementById("se-p").value)||null;if(!n)return;await A("PUT","/api/shopping/"+sid,{item:n,quantity:q||null,price:p,folder_id:window._sFold||null});cMo();hp();await load()}
function shAddFolder(){oMC(tr("mt_new_folder"),'<input class="inp" id="ff-n" placeholder="'+tr("f_folder")+'"><input class="inp" id="ff-e" placeholder="📁" value="📁" style="width:80px"><button class="btn" onclick="doAddFolder()">'+tr("btn_create")+'</button>',{ic:"list"})}
async function doAddFolder(){var n=document.getElementById("ff-n").value.trim();var e=document.getElementById("ff-e").value.trim()||"📁";if(!n)return;await A("POST","/api/shopping/folders",{name:n,emoji:e});cMo();hp();await load()}
function edFolder(fid){var f=D.folders.find(function(x){return x.id===fid});if(!f)return;oMC(tr("sh_edit_folder"),'<input class="inp" id="ef-n" value="'+es(f.name)+'"><input class="inp" id="ef-e" value="'+f.emoji+'" style="width:80px"><button class="btn" onclick="svFolder('+fid+')">Save</button><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)"><button class="btn btn-s" style="color:var(--ac);font-size:13px" onclick="dlFolder('+fid+')">'+tr("sh_delete_folder")+'</button></div>',{ic:"list"})}
async function svFolder(fid){var n=document.getElementById("ef-n").value.trim();var e=document.getElementById("ef-e").value.trim();if(!n)return;await A("PUT","/api/shopping/folders/"+fid,{name:n,emoji:e});cMo();hp();await load()}
async function dlFolder(fid){await A("DELETE","/api/shopping/folders/"+fid);cMo();hp();shopFold=null;await load();toast("✓ Folder deleted")}


// ═══════════════════════════════════════════════════════════
// BIRTHDAYS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rBdays(){
if(!D.birthdays.length)return em(icon("cake",48,1.8),tr("es_no_birthdays_t"),tr("es_no_birthdays_s"))+rBdAddBtn();
var bdays=D.birthdays;if(searchQ)bdays=bdays.filter(function(b){return matchQ(b.name)});
var h=rBdAddBtn();bdays.forEach(function(b){
var rightTxt=b.days_until===0?"Today! 🎉":b.days_until===1?"Tomorrow":"in "+b.days_until+"d";
var tone=b.days_until===0?"tone-ok":b.days_until<=7?"tone-wn":"";
var dateTxt=b.birth_date.split("-").slice(1).reverse().join(".");
h+='<div class="lc"><div class="lc-i acc-wn">'+b.emoji+'</div><div class="lc-bd"><div class="lc-tt">'+es(b.name)+'</div><div class="lc-mt">🎂 '+dateTxt+'</div></div><span class="lc-rt '+tone+'">'+rightTxt+'</span><button class="bi" onclick="edBd('+b.id+')" style="margin-left:4px">'+I.ed+'</button><button class="bi" onclick="dlBd('+b.id+')">'+I.tr+'</button></div>'});return h}
function rBdAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoBd()">+ '+tr("mt_add_bday")+'</button>'}
async function dlBd(id){hp();await A("DELETE","/api/birthdays/"+id);await load();toast("🗑 "+tr("ts_deleted"))}
function edBd(id){var b=D.birthdays.find(function(x){return x.id===id});if(!b)return;_bdRems=(b.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});oMC(tr("mt_edit_bday"),'<input class="inp" id="bd-n" value="'+es(b.name)+'"><input class="inp" id="bd-e" value="'+b.emoji+'" style="width:80px"><div class="lb">'+tr("g_reminders")+'</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="svBd('+id+')">'+tr("btn_save")+'</button>',{ic:"cake"})}
async function svBd(id){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim();if(!n)return;await A("PUT","/api/birthdays/"+id,{name:n,emoji:e,reminders:_bdRems});cMo();hp();await load()}

// ═══════════════════════════════════════════════════════════
// CLEANING (hamburger page)
// ═══════════════════════════════════════════════════════════
function rC(){if(!D.zones.length)return em(icon("broom",48,1.8),tr("es_no_zones_t"),tr("es_no_zones_s"))+'<button class="btn" onclick="shAZ()">+ '+tr("mt_add_zone")+'</button>';
var dirty=D.zones.filter(function(z){return z.dirty}),clean=D.zones.filter(function(z){return!z.dirty});
if(searchQ){dirty=dirty.filter(function(z){return matchQ(z.name)});clean=clean.filter(function(z){return matchQ(z.name)})}
var h="";
function _scH2(ico,label,cnt,color){return '<div class="sc"'+(color?' style="color:'+color+'"':'')+'><span class="sc-l"><span class="sc-ico"'+(color?' style="color:'+color+'"':'')+'>'+icon(ico,12,2.4)+'</span>'+label+'<span class="sc-cnt"'+(color?' style="background:color-mix(in srgb,'+color+' 16%,transparent);color:'+color+'"':'')+'>'+cnt+'</span></span></div>'}
if(dirty.length){h+=_scH2("dot","Needs Cleaning",dirty.length,"var(--ac)");dirty.forEach(function(z){h+=rZn(z)})}
if(clean.length){h+=_scH2("ck","Clean",clean.length,"var(--ok)");clean.forEach(function(z){h+=rZn(z)})}
h+='<div style="margin-top:16px"><button class="btn btn-s" onclick="shAZ()">+ Add Zone</button></div>';return h}
function rZn(z){var isOpen=zOpen[z.id]!==false;var tasksDone=(z.tasks||[]).filter(function(t){return t.done}).length;var tasksTotal=(z.tasks||[]).length;
var pct=tasksTotal>0?Math.round(tasksDone/tasksTotal*100):0;
var stPill=z.dirty?'<span class="lc-rt tone-ac">Dirty</span>':'<span class="lc-rt tone-ok">Clean</span>';
var icoCls=z.dirty?"acc-ac":"acc-ok";
// Zone header in .lc style: emoji square + name + progress bar + status pill + chevron
var h='<div class="zn">';
h+='<div class="zh" style="cursor:pointer" onclick="zOpen['+z.id+']='+(!isOpen)+';ren()">';
h+='<div class="lc-i '+icoCls+'" style="font-size:24px">'+z.icon+'</div>';
h+='<div class="zn-bd"><div class="zn-nm">'+es(z.name)+'</div><div class="zn-mt">'+tasksDone+'/'+tasksTotal+' tasks · '+pct+'%</div><div class="progress" style="margin-top:6px;max-width:220px"><div class="progress-fill '+(z.dirty?"tone-ac":"tone-ok")+'" style="width:'+pct+'%"></div></div></div>';
h+=stPill;
h+='<button class="bi" onclick="event.stopPropagation();edZn('+z.id+')">'+I.ed+'</button>';
h+='<span class="zn-chev" style="font-size:14px;color:var(--ht);margin-left:2px">'+(isOpen?"▾":"▸")+'</span>';
h+='</div>';
if(!isOpen)return h+'</div>';
h+='<div class="zn-tasks">';
(z.tasks||[]).forEach(function(t){var resetInfo=t.reset_days?t.reset_days+"d":"7d";var daysInfo="";if(t.done&&t.last_done)daysInfo=" · "+fD(t.last_done).full;
h+='<div class="zt"><div class="cb cb-s '+(t.done?"cb-k":"cb-o")+'" onclick="tgZT('+t.id+')">'+(t.done?I.ck:"")+'</div><span class="zt-t'+(t.done?" dn":"")+'">'+es(t.text)+'</span><span class="zt-mt">'+resetInfo+daysInfo+'</span>'+(t.assigned_to?mAv(t.assigned_to,20):"")+'<button class="bi" onclick="edZT('+t.id+')" style="padding:3px">'+I.ed+'</button><button class="bi" onclick="dZT('+t.id+')">'+I.x+'</button></div>'});
h+='<div class="za"><input id="zti-'+z.id+'" placeholder="'+tr("cl_add_task")+'" onkeydown="if(event.key===\'Enter\')aZT('+z.id+')"><button onclick="aZT('+z.id+')">Add</button></div>';
h+='</div>';
h+='<button class="zn-del" onclick="dlZn('+z.id+')">Delete zone</button>';
h+='</div>';return h}
async function tgZT(id){hp();await A("PATCH","/api/cleaning/tasks/"+id+"/toggle");await load()}
async function dZT(id){hp();await A("DELETE","/api/cleaning/tasks/"+id);await load()}
async function aZT(zid){var i=document.getElementById("zti-"+zid);if(!i||!i.value.trim())return;await A("POST","/api/cleaning/zones/"+zid+"/tasks",{text:i.value.trim()});hp();await load()}
async function dlZn(id){if(!confirm("Delete zone?"))return;await A("DELETE","/api/cleaning/zones/"+id);hp();await load()}
function edZn(zid){var z=D.zones.find(function(x){return x.id===zid});if(!z)return;_assign=z.assigned_to||0;_zRems=(z.reminders||[]).map(function(r){return r.remind_at});oMC("Edit Zone",'<input class="inp" id="ez-n" value="'+es(z.name)+'"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ez-i" value="'+z.icon+'" style="text-align:center;font-size:24px"></div></div><div class="lb">'+tr("g_assigned_to")+'</div>'+assignPk("ezap",z.assigned_to)+'<div class="lb">'+tr("g_reminders")+'</div><div id="zrw">'+zRemPk()+'</div><button class="btn" onclick="svZn('+zid+')">Save</button>',{ic:"broom"})}
async function svZn(zid){var n=document.getElementById("ez-n").value.trim();var i=document.getElementById("ez-i").value.trim();if(!n)return;await A("PUT","/api/cleaning/zones/"+zid,{name:n,icon:i,assigned_to:_assign||null,reminders:_zRems});cMo();hp();await load()}
function edZT(tid){var zt=null;D.zones.forEach(function(z){(z.tasks||[]).forEach(function(x){if(x.id===tid)zt=x})});if(!zt)return;_assign=zt.assigned_to||0;oMC(tr("mt_edit_zone_task"),'<input class="inp" id="zt-t" value="'+es(zt.text)+'"><div class="dr"><div><div class="dl">'+tr("cl_reset_days")+'</div><input class="inp" id="zt-d" type="number" value="'+(zt.reset_days||7)+'" min="1" max="90"></div></div><div class="lb">'+tr("g_assigned_to")+'</div>'+assignPk("ztap",zt.assigned_to)+'<button class="btn" onclick="svZT('+tid+')">'+tr("btn_save")+'</button>',{ic:"broom"})}
async function svZT(tid){var text=document.getElementById("zt-t").value.trim();var rd=parseInt(document.getElementById("zt-d").value)||7;if(!text)return;await A("PUT","/api/cleaning/tasks/"+tid,{text:text,icon:"🧹",assigned_to:_assign||null,reset_days:rd});cMo();hp();await load()}
function shAZ(){_assign=0;oMC(tr("mt_add_zone"),'<input class="inp" id="zn" placeholder="'+tr("f_name")+'"><input class="inp" id="zic" placeholder="🍳" style="width:80px"><div class="lb">'+tr("f_assigned_to")+'</div>'+assignPk("zap",null)+'<button class="btn" onclick="doAZ()">'+tr("btn_add")+'</button>',{ic:"broom"})}
async function doAZ(){var n=document.getElementById("zn").value.trim();if(!n)return;var i=document.getElementById("zic").value.trim()||"🏠";await A("POST","/api/cleaning/zones",{name:n,icon:i,assigned_to:_assign||null});cMo();hp();await load()}

// ═══════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════
var _profMember=null,_profStats=null;
async function loadProfileStats(){
var q=_profMember?("?member_id="+_profMember):"";
var s=await A("GET","/api/profile/stats"+q);
_profStats=s;ren()
}
function setProfMember(uid){_profMember=uid;_profStats=null;hp("sel");ren()}
function rProfile(){
if(!_profStats){loadProfileStats();return '<div class="emp"><div class="emp-i" style="font-size:32px">⏳</div><div>Loading...</div></div>'}
var s=_profStats,h='';
// Member switcher
h+='<div class="fb2" style="margin-bottom:14px">';
h+='<button class="fi '+(!_profMember?"a":"")+'" onclick="setProfMember(null)" style="display:inline-flex;align-items:center;gap:5px">'+icon("user",14,2.2)+'Family</button>';
D.members.forEach(function(m){h+='<button class="fi '+(_profMember===m.user_id?"a":"")+'" style="display:inline-flex;align-items:center;gap:5px" onclick="setProfMember('+m.user_id+')">'+mAv(m.user_id,18)+es(m.user_name)+'</button>'});
h+='</div>';
// Selected-member hero block
if(_profMember){var m=D.members.find(function(x){return x.user_id===_profMember});
  if(m)h+='<div class="prof-hero">'+mAv(m.user_id,64)+'<div class="prof-hero-bd"><div class="prof-hero-nm">'+es(m.user_name)+'</div><div class="prof-hero-sub">Personal stats</div><div class="prof-hero-strip" style="background:'+m.color+'"></div></div></div>'}

// Love Points — dedicated monthly couple scoreboard (its own entity).
h+='<div id="love-prof"></div>';
setTimeout(function(){_loveCard("love-prof")},0);
// Active Life challenges — scoreboard widget (real challenges; empty if none).
h+='<div id="life-wg-prof"></div>';
setTimeout(function(){_lifeWidget("life-wg-prof")},0);

// ─── Tasks — single unified widget with 4 inline metrics ────────
h+='<div class="sc"><span class="sc-l">'+icon("clipboard",12,2.4)+'Tasks</span></div>';
h+='<div class="prof-widget">';
h+='<div class="prof-w-grid">';
h+='<div class="prof-w-cell"><div class="prof-w-vl" style="color:var(--pr)"><span class="cu" data-count="'+s.tasks_active+'">0</span></div><div class="prof-w-lb">Active</div></div>';
h+='<div class="prof-w-cell"><div class="prof-w-vl" style="color:var(--ok)"><span class="cu" data-count="'+s.tasks_done+'">0</span></div><div class="prof-w-lb">Completed</div></div>';
h+='<div class="prof-w-cell"><div class="prof-w-vl" style="color:var(--ac)"><span class="cu" data-count="'+s.tasks_overdue+'">0</span></div><div class="prof-w-lb">Overdue</div></div>';
h+='<div class="prof-w-cell"><div class="prof-w-vl" style="color:var(--wn)"><span class="cu" data-count="'+s.tasks_high+'">0</span></div><div class="prof-w-lb">High pri</div></div>';
h+='</div></div>';

// ─── Words widget ────────────────────────────────────────────
var wPct=s.words_total>0?Math.round(s.words_learned/s.words_total*100):0;
var wFlag=s.words_mode==="ru"?"🇷🇺":s.words_mode==="en"?"🇬🇧":"";
var wLabel=s.words_mode==="ru"?"Russian":s.words_mode==="en"?"English":"All languages";
h+='<div class="sc"><span class="sc-l">'+icon("book",12,2.4)+'Words</span><button class="at" onclick="go(\'words\')">Open ›</button></div>';
h+='<div class="prof-widget" onclick="go(\'words\')" style="cursor:pointer">';
h+='<div class="prof-w-hd"><div><div class="prof-w-big">'+s.words_learned+' <span style="font-size:14px;color:var(--ht);font-weight:600">/ '+s.words_total+'</span></div><div class="prof-w-sub">learned · '+wPct+'%</div></div><div class="prof-w-flag">'+wFlag+'<span style="font-size:10px;color:var(--ht);font-weight:600;letter-spacing:.3px;text-transform:uppercase;margin-left:6px">'+es(wLabel)+'</span></div></div>';
h+='<div class="progress" style="margin-top:8px"><div class="progress-fill tone-ok" style="width:'+wPct+'%"></div></div>';
h+='<div class="prof-w-meta"><span>'+s.words_learning+' learning</span><span>·</span><span>'+s.words_accuracy+'% accuracy</span></div>';
h+='</div>';

// ─── Trainings widget ────────────────────────────────────────
var tWk=s.train_week||{tonnage:0,workouts:0};
var tPrev=s.train_prev_week||{tonnage:0};
var dPct=s.train_delta_pct;
var deltaHtml='';
if(dPct!==null&&dPct!==undefined){
  var dCol=dPct>=0?'var(--ok)':'var(--ac)';
  var dArrow=dPct>=0?"▲":"▼";
  deltaHtml='<span class="prof-w-delta" style="color:'+dCol+'">'+dArrow+' '+Math.abs(dPct)+'%</span>';
}
h+='<div class="sc"><span class="sc-l">'+icon("dumbbell",12,2.4)+'Trainings</span><button class="at" onclick="go(\'trainings\')">Open ›</button></div>';
h+='<div class="prof-widget" onclick="go(\'trainings\')" style="cursor:pointer">';
h+='<div class="prof-w-hd"><div><div class="prof-w-big">'+_fmtTon(tWk.tonnage)+'</div><div class="prof-w-sub">this week · '+tWk.workouts+' workout'+(tWk.workouts===1?"":"s")+'</div></div>'+deltaHtml+'</div>';
if(tPrev.tonnage>0)h+='<div class="prof-w-meta"><span>Last week:</span><span style="color:var(--tx);font-weight:600">'+_fmtTon(tPrev.tonnage)+'</span></div>';
h+='</div>';

// ─── Cleaning progress (unchanged, at the bottom) ─────────────
var cPct=s.clean_total>0?Math.round(s.clean_done/s.clean_total*100):0;
h+='<div class="sc"><span class="sc-l">'+icon("broom",12,2.4)+'Cleaning</span></div>';
h+='<div class="cat-row"><div class="cat-row-h"><span class="nm">'+s.clean_done+'/'+s.clean_total+' tasks done</span><span class="vl" style="color:var(--ok)">'+cPct+'%</span></div><div class="progress"><div class="progress-fill tone-ok" style="width:'+cPct+'%"></div></div></div>';

setTimeout(function(){FX.countStats(document.getElementById("ct"))},50);
return h}

// ═══════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════
var _calData=null,_calMonth=null,_calCache={},_calDayIso=null,_calEditCb=null;
var _calFilters={event:true,task:true,recurring:true,birthday:true,subscription:true,member:null};
function _isoDate(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function _parseD(s){var p=s.split("-");return new Date(+p[0],+p[1]-1,+p[2])}
function _addD(d,n){var r=new Date(d);r.setDate(r.getDate()+n);return r}
function _curYMCal(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
function _daysBetween(a,b){return Math.round((_parseD(b)-_parseD(a))/864e5)}

// Lane assignment: greedy interval packing
function _assignLanes(items,wsISO,weISO){
var ws=_parseD(wsISO),we=_parseD(weISO);
var segs=[];
items.forEach(function(it){
var s=_parseD(it.start<wsISO?wsISO:it.start);
var e=_parseD(it.end>weISO?weISO:it.end);
var col=Math.round((s-ws)/864e5);
var span=Math.round((e-s)/864e5)+1;
if(col<0){span+=col;col=0}
if(col+span>7)span=7-col;
if(span<=0)return;
segs.push({col:col,span:span,title:it.title,color:it.color,startD:s,endD:e,done:it.done,id:it.id,type:it.type,origStart:it.start,origEnd:it.end,assigned_to:it.assigned_to})
});
segs.sort(function(a,b){return a.col-b.col||(b.span-a.span)});
var lanes=[],result=[];
segs.forEach(function(seg){
var lane=-1;
for(var i=0;i<lanes.length;i++){if(lanes[i]<=seg.col){lane=i;break}}
if(lane===-1){lane=lanes.length;lanes.push(0)}
lanes[lane]=seg.col+seg.span;
seg.lane=lane;
result.push(seg)
});
return{segs:result,maxLanes:lanes.length}
}

// Render bars HTML for a week
function _renderBars(items,wsISO,weISO,barH,maxLn){
// bh is the bar height. For the main month view we use a 2-line chip (~32px); strip uses single-line (18px).
var bh=barH||32;var ml=maxLn||5;
var twoLine=bh>=28;
var res=_assignLanes(items,wsISO,weISO);
if(!res.segs.length)return{html:'',height:0};
var h='',overflow=[0,0,0,0,0,0,0];
var visLanes=Math.min(res.maxLanes,ml);
res.segs.forEach(function(seg){
if(seg.lane>=ml){for(var c=seg.col;c<seg.col+seg.span&&c<7;c++)overflow[c]++;return}
var left=(seg.col/7*100).toFixed(2);
var width=(seg.span/7*100).toFixed(2);
var top=seg.lane*((bh)+2);
var mClr="";
if(seg.type==="task"&&!seg.done&&seg.assigned_to){var _m=D.members.find(function(x){return x.user_id===seg.assigned_to});if(_m)mClr=_m.color}
var cls="cal-ev ev-"+seg.color+(seg.done?" ev-done":"")+(seg.type==="recurring"?" ev-rec":"")+(seg.type==="subscription"?" ev-sub":"")+(twoLine?" ev-2l":"");
var inl=mClr?"background:"+mClr+";":"";
var icoMap={event:"calendar",task:seg.done?"ck":"clipboard",recurring:"refresh",birthday:"cake",subscription:"card"};
var icoH='<span class="ev-ico">'+icon(icoMap[seg.type]||"dot",11,2.2)+'</span>';
// 2-line chip: text wraps via line-clamp; max 15 chars-ish. Single-line: tight nowrap.
var inner=icoH+'<span class="ev-tx">'+es(seg.title)+'</span>';
var posStyle='left:'+left+'%;width:calc('+width+'% - 2px);top:'+top+'px;height:'+bh+'px;'+(twoLine?'':'line-height:'+bh+'px;')+inl;
h+='<div class="'+cls+'" onclick="showCalEv(\''+seg.type+'\','+seg.id+')" style="'+posStyle+'cursor:pointer">'+inner+'</div>'
});
// +N overflow badges
var oT=visLanes*(bh+2);
for(var i=0;i<7;i++){if(overflow[i]>0){
var ol=(i/7*100).toFixed(2);var ow=(1/7*100).toFixed(2);
h+='<div class="cal-more" style="left:'+ol+'%;width:'+ow+'%;top:'+oT+'px">+'+overflow[i]+'</div>'
}}
var hasOv=overflow.some(function(x){return x>0});
return{html:h,height:visLanes*(bh+2)+(hasOv?(bh-4):0)}
}

// Week strip for Home
async function loadCalStrip(){
var el=document.getElementById("cal-strip");if(!el)return;
var today=new Date();
var dow=today.getDay();var mondayOff=(dow===0)?-6:1-dow;
var ws=_addD(today,mondayOff);
var we=_addD(ws,6);
var wsISO=_isoDate(ws),weISO=_isoDate(we);
var month=ws.getFullYear()+"-"+String(ws.getMonth()+1).padStart(2,"0");
var data=_calCache[month];
if(!data){data=await A("GET","/api/calendar?month="+month);_calCache[month]=data}
if(!data)return;
var todayISO=_isoDate(today);
var wkItems=data.items.filter(function(it){return it.end>=wsISO&&it.start<=weISO});
// Build per-day map
var dm={};
wkItems.forEach(function(it){
var s=_parseD(it.start<wsISO?wsISO:it.start),e=_parseD(it.end>weISO?weISO:it.end);
for(var dd=new Date(s);dd<=e;dd.setDate(dd.getDate()+1)){
var k=_isoDate(dd);if(!dm[k])dm[k]={types:{},count:0,items:[]};
dm[k].types[it.type==="recurring"?"task":it.type]=true;
dm[k].count++;dm[k].items.push(it)
}});
// Week header with dots
var h='<div class="csh-week">';
for(var i=0;i<7;i++){
var d=_addD(ws,i);var iso=_isoDate(d);
var isToday=iso===todayISO;var isWkend=(d.getDay()===0||d.getDay()===6);
var di=dm[iso];var heat=di?Math.min(di.count,5):0;
var cls="csh-day"+(isToday?" csh-today":"")+(isWkend?" csh-wkend":"");
var dots="";
if(di){var dt=di.types;
if(dt.event)dots+='<i class="cd-dot" style="background:var(--pr)"></i>';
if(dt.task)dots+='<i class="cd-dot" style="background:var(--ac)"></i>';
if(dt.birthday)dots+='<i class="cd-dot" style="background:var(--wn)"></i>';
if(dt.subscription)dots+='<i class="cd-dot" style="background:var(--pr)"></i>'}
h+='<div class="'+cls+'">';
h+='<div class="csh-dn">'+["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]+'</div>';
h+='<div class="csh-num">'+(isToday?'<span class="csh-td">'+d.getDate()+'</span>':d.getDate())+'</div>';
if(dots)h+='<div class="cd-dots">'+dots+'</div>';
h+='</div>'}
h+='</div>';
// Mini agenda: today + tomorrow
var tmrISO=_isoDate(_addD(today,1));
var sections=[{label:"Today",iso:todayISO},{label:"Tomorrow",iso:tmrISO}];
var hasAgenda=false;
sections.forEach(function(sec){
var items=dm[sec.iso]?dm[sec.iso].items:[];
// Hide completed tasks (and any other items flagged done) from the agenda
items=items.filter(function(it){return !it.done});
if(!items.length)return;
hasAgenda=true;
// Deduplicate multi-day items by id+type
var seen={};var unique=[];
items.forEach(function(it){var k=it.type+"-"+it.id;if(!seen[k]){seen[k]=true;unique.push(it)}});
h+='<div class="csh-sec"><span class="csh-label">'+sec.label+'</span>';
var show=unique.slice(0,3);
show.forEach(function(it){
var icMap={event:"calendar",task:it.done?"ck":"clipboard",recurring:"refresh",birthday:"cake",subscription:"card"};
var ico=icon(icMap[it.type]||"dot",12,2.2);
var mClr="";
if((it.type==="task"||it.type==="recurring")&&!it.done&&it.assigned_to){var _m=D.members.find(function(x){return x.user_id===it.assigned_to});if(_m)mClr=_m.color}
var bc=mClr||{event:"var(--pr)",task:"var(--ac)",recurring:"var(--ac)",birthday:"var(--wn)",subscription:"var(--pr)"}[it.type]||"var(--bd)";
h+='<div class="csh-item"><span class="csh-ico" style="color:'+bc+';background:linear-gradient(135deg,color-mix(in srgb,'+bc+' 32%,transparent),color-mix(in srgb,'+bc+' 10%,transparent));border:1px solid color-mix(in srgb,'+bc+' 40%,transparent)">'+ico+'</span><span class="csh-txt">'+es(it.title)+'</span></div>'
});
if(unique.length>3)h+='<div class="csh-more">+'+( unique.length-3)+' more</div>';
h+='</div>'});
if(!hasAgenda)h+='<div class="csh-empty">Nothing planned today</div>';
// Week summary
var nT=0,nE=0;wkItems.forEach(function(it){if(it.type==="task"||it.type==="recurring")nT++;else if(it.type==="event")nE++});
var sum=[];if(nT)sum.push(nT+" task"+(nT>1?"s":""));if(nE)sum.push(nE+" event"+(nE>1?"s":""));
h+='<div class="csh-sum">'+(sum.length?sum.join(" · "):"Free week")+'</div>';
el.innerHTML=h}

// Full calendar modal
function openCalModal(){
_calMonth=_calMonth||_curYMCal();
document.getElementById("cal-mo").classList.add("open");
loadCalMonth()
}
function closeCalModal(){hp("light");document.getElementById("cal-mo").classList.remove("open")}
function calShift(delta){hp("sel");
var y=parseInt(_calMonth.slice(0,4),10),m=parseInt(_calMonth.slice(5,7),10)+delta;
while(m<=0){m+=12;y--}while(m>12){m-=12;y++}
_calMonth=y+"-"+String(m).padStart(2,"0");
var body=document.getElementById("cal-body");
if(body){var dir=delta>0?"cal-slide-l":"cal-slide-r";body.classList.add(dir);
setTimeout(function(){body.classList.remove(dir)},250)}
loadCalMonth()
}
function calToggleType(t){hp("sel");_calFilters[t]=!_calFilters[t];loadCalMonth()}
function calSetMember(uid){hp("sel");_calFilters.member=_calFilters.member===uid?null:uid;loadCalMonth()}
function _calFilterItems(items){
return items.filter(function(it){
var t=it.type==="recurring"?"recurring":it.type;
if(!_calFilters[t])return false;
if(_calFilters.member&&it.assigned_to&&it.assigned_to!==_calFilters.member)return false;
return true
})}
async function loadCalMonth(){
var data=_calCache[_calMonth];
if(!data){data=await A("GET","/api/calendar?month="+_calMonth);_calCache[_calMonth]=data}
if(!data)return;
_calData=data;
var y=parseInt(_calMonth.slice(0,4),10),m=parseInt(_calMonth.slice(5,7),10);
document.getElementById("cal-title").textContent=new Date(y,m-1,1).toLocaleString("en-US",{month:"long",year:"numeric"});
var body=document.getElementById("cal-body");
var vs=_parseD(data.vis_start),ve=_parseD(data.vis_end);
var todayISO=_isoDate(new Date());
// Filter chips (type filters only — member filters render at the bottom)
var h='<div class="cal-chips">';
var types=[{k:"event",l:"Events",c:"var(--pr)",i:"calendar"},{k:"task",l:"Tasks",c:"var(--ac)",i:"ck"},{k:"recurring",l:"Recurring",c:"var(--ac)",i:"refresh"},{k:"birthday",l:"Birthdays",c:"var(--wn)",i:"cake"},{k:"subscription",l:"Subs",c:"var(--ok)",i:"card"}];
types.forEach(function(t){var on=_calFilters[t.k];h+='<span class="cal-chip'+(on?" on":"")+'" style="--cc:'+t.c+'" onclick="calToggleType(\''+t.k+'\')"><span class="cal-chip-ico">'+icon(t.i,14,2.2)+'</span>'+t.l+'</span>'});
h+='</div>';
// Calendar grid card — weeks wrap in a rounded surface
h+='<div class="cal-grid-card">';
// Weekday header
h+='<div class="cal-dh"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div style="color:#e74c3c">Sat</div><div style="color:#e74c3c">Sun</div></div>';
// Filtered items
var filtered=_calFilterItems(data.items);
// Pre-compute per-day dot types and counts
var dayMap={};
filtered.forEach(function(it){
var s=_parseD(it.start),e=_parseD(it.end);
for(var dd=new Date(s);dd<=e;dd.setDate(dd.getDate()+1)){
var k=_isoDate(dd);
if(!dayMap[k])dayMap[k]={types:{},count:0};
dayMap[k].types[it.type==="recurring"?"task":it.type]=true;
dayMap[k].count++
}});
// Current week range for highlight
var _tw=new Date();var _twOff=(_tw.getDay()||7)-1;
var _twStart=_isoDate(_addD(_tw,-_twOff)),_twEnd=_isoDate(_addD(_tw,6-_twOff));
// Iterate week by week
var cur=new Date(vs);
while(cur<=ve){
var wsISO=_isoDate(cur);
var weD=_addD(cur,6);
var weISO=_isoDate(weD);
var isCurWk=(wsISO<=_twEnd&&weISO>=_twStart);
var wkItems=filtered.filter(function(it){return it.end>=wsISO&&it.start<=weISO});
var bars=_renderBars(wkItems,wsISO,weISO,34);
h+='<div class="cal-wk'+(isCurWk?" cal-wk-cur":"")+'">';
h+='<div class="cal-days">';
for(var i=0;i<7;i++){
var d=_addD(cur,i);var iso=_isoDate(d);
var inMonth=(d.getMonth()+1===m&&d.getFullYear()===y);
var isWkend=(d.getDay()===0||d.getDay()===6);
var dm=dayMap[iso];var heat=dm?Math.min(dm.count,5):0;
var cls="cal-dy"+(inMonth?" cur-m":"")+(iso===todayISO?" today":"")+(isWkend?" wkend":"");
// Dot indicators
var dots="";
if(dm&&inMonth){var dt=dm.types;
if(dt.event)dots+='<i class="cd-dot" style="background:var(--pr)"></i>';
if(dt.task)dots+='<i class="cd-dot" style="background:var(--ac)"></i>';
if(dt.birthday)dots+='<i class="cd-dot" style="background:var(--wn)"></i>';
if(dt.subscription)dots+='<i class="cd-dot" style="background:var(--pr)"></i>'}
h+='<div class="'+cls+'" onclick="openCalDay(\''+iso+'\')"><span class="dn">'+d.getDate()+'</span>'+(dots?'<div class="cd-dots">'+dots+'</div>':'')+'</div>'}
h+='</div>';
h+='<div class="cal-bars" style="height:'+Math.max(bars.height,4)+'px">'+bars.html+'</div>';
h+='</div>';
cur=_addD(cur,7)
}
h+='</div>'; // close .cal-grid-card
// Member filter row (bottom) — separate, full-width pill row
if((D.members||[]).length){h+='<div class="cal-members">';
(D.members||[]).forEach(function(m){var on=_calFilters.member===m.user_id;h+='<span class="cal-chip cal-chip-m'+(on?" on":"")+'" style="--cc:'+m.color+'" onclick="calSetMember('+m.user_id+')">'+mAv(m.user_id,20)+es(m.user_name)+'</span>'});
h+='</div>'}
body.innerHTML=h
}

// Calendar event detail card
function showCalEv(type,id){
var item=null,title="",_ico="",dateStr="",extra="";
if(type==="event"){
item=(D.events||[]).find(function(x){return x.id===id});
if(!item)return;
_ico=icon("calendar",14,2.2);title=item.text;
var s=fD(item.event_date),e=fD(item.end_date);
dateStr=s.full;if(item.end_date&&item.end_date.split(" ")[0]!==item.event_date.split(" ")[0])dateStr=s.full+" → "+e.full
}else if(type==="task"){
item=(D.tasks||[]).find(function(x){return x.id===id});
if(!item)return;
_ico=icon(item.done?"ck":"clipboard",14,2.2);title=item.text;
dateStr=fD(item.due_date).full;
var pr=item.priority||"normal";
extra='<div class="ced-row"><span class="ced-lbl">Priority</span><span class="ced-val pr-'+pr+'">'+pr+'</span></div>';
if(item.assigned_to)extra+='<div class="ced-row"><span class="ced-lbl">Assigned</span><span class="ced-val">'+mAv(item.assigned_to,20)+' '+es(mName(item.assigned_to))+'</span></div>';
if(item.done)extra+='<div class="ced-row"><span class="ced-lbl">Status</span><span class="ced-val" style="color:var(--ok)">Done '+icon("ck",12,2.5)+'</span></div>'
}else if(type==="recurring"){
item=(D.recurring||[]).find(function(x){return x.id===id});
if(!item){item={id:id,text:"Recurring task"}}
_ico=icon("refresh",14,2.2);title=item.text;
dateStr=item.rrule||"";
if(item.assigned_to)extra='<div class="ced-row"><span class="ced-lbl">Assigned</span><span class="ced-val">'+mAv(item.assigned_to,20)+' '+es(mName(item.assigned_to))+'</span></div>';
extra+='<div class="ced-row"><span class="ced-lbl">Schedule</span><span class="ced-val">'+es(item.rrule||"")+'</span></div>'
}else if(type==="birthday"){
item=(D.birthdays||[]).find(function(x){return x.id===id});
if(!item)return;
_ico=item.emoji||icon("cake",14,2.2);title=item.name;
dateStr=fD(item.birth_date).full;
if(item.days_until!=null)extra='<div class="ced-row"><span class="ced-lbl">Next</span><span class="ced-val">'+(item.days_until===0?"Today! 🎉":item.days_until+" days away")+'</span></div>'
}else if(type==="subscription"){
item=(D.subs||[]).find(function(x){return x.id===id});
if(!item)return;
_ico=item.emoji||icon("card",14,2.2);title=item.name;
dateStr="Every month on day "+item.billing_day;
extra='<div class="ced-row"><span class="ced-lbl">Amount</span><span class="ced-val">'+item.amount+' '+item.currency+'</span></div>'
}
if(!item)return;
var typeLabel={event:"Event",task:"Task",recurring:"Recurring Task",birthday:"Birthday",subscription:"Subscription"}[type]||type;
var editFn={task:"calEdTk",event:"calEdEv",recurring:"calEdRec"}[type];
var h='<div class="ced-overlay" onclick="closeCalEv(event)">';
h+='<div class="ced-card" onclick="event.stopPropagation()">';
h+='<div class="ced-type" style="display:flex;justify-content:space-between;align-items:center"><span style="display:inline-flex;align-items:center;gap:6px">'+_ico+' '+typeLabel+'</span>'+(editFn?'<button class="bi" style="padding:4px;color:var(--ht)" onclick="'+editFn+'('+id+')" title="Edit">'+I.ed+'</button>':'')+'</div>';
h+='<div class="ced-title">'+es(title)+'</div>';
h+='<div class="ced-row"><span class="ced-lbl">Date</span><span class="ced-val">'+dateStr+'</span></div>';
h+=extra;
h+='<div style="display:flex;gap:8px;margin-top:14px">';
if(type==="task"&&item){
var doneLbl=item.done?"↺ Reopen":"✓ Mark Done";
var doneStyle=item.done?"flex:1;background:transparent;border:1.5px solid var(--bd);color:var(--tx)":"flex:1;background:var(--ok);border:none;color:#fff";
h+='<button class="btn btn-s" style="'+doneStyle+'" onclick="calMarkDone('+id+')">'+doneLbl+'</button>';
h+='<button class="btn btn-s" style="flex:1;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="closeCalEv()">Close</button>';
}else{
h+='<button class="btn btn-s" style="flex:1" onclick="closeCalEv()">Close</button>';
}
h+='</div>';
h+='</div></div>';
var el=document.createElement("div");el.id="cal-ev-detail";el.innerHTML=h;
// v8.49.9: #cal-mo always exists (it's the calendar modal container in
// index.html) but is display:none unless `.open`. Earlier `|| document.body`
// fallback never triggered, so popups invoked from Home were silently
// inserted into a hidden subtree. Pick body unless the calendar is actually
// open.
var _calMo=document.getElementById("cal-mo");
var _ovParent=(_calMo&&_calMo.classList.contains("open"))?_calMo:document.body;
_ovParent.appendChild(el)
}
function closeCalEv(e){var el=document.getElementById("cal-ev-detail");if(el)el.remove()}

// Full-screen day view
function openCalDay(iso){
if(!_calData||!_calData.items)return;
_calDayIso=iso;
var dayItems=_calFilterItems(_calData.items).filter(function(it){return it.start<=iso&&it.end>=iso});
var dd=_parseD(iso);
var title=dF[dd.getDay()]+", "+dd.getDate()+" "+mN[dd.getMonth()]+" "+dd.getFullYear();
var h='<div class="cday-overlay">';
h+='<div class="cday-panel">';
h+='<div class="cday-hd"><button class="cday-back" onclick="closeCalDay()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="20" height="20"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button><div class="cday-title">'+title+'</div></div>';
h+='<div style="display:flex;gap:8px;padding:12px 16px 4px"><button class="btn btn-s" style="flex:1" onclick="oMoTkDay(\''+iso+'\')">+ Task</button><button class="btn btn-s" style="flex:1" onclick="oMoEvtDay(\''+iso+'\')">+ Event</button></div>';
if(!dayItems.length){
h+='<div style="text-align:center;padding:40px 20px;color:var(--ht)"><div style="font-size:32px;margin-bottom:8px">📭</div><div>No events this day</div><div style="font-size:12px;margin-top:6px;opacity:.7">Tap + above to add one</div></div>'
}else{
// Group: events first, then tasks, then birthdays
var order={event:0,task:1,recurring:2,birthday:3};
dayItems.sort(function(a,b){return(order[a.type]||9)-(order[b.type]||9)});
dayItems.forEach(function(it){
var _icoName={event:"calendar",task:it.done?"ck":"clipboard",recurring:"refresh",birthday:"cake"}[it.type]||"dot";
var _ico=icon(_icoName,18,2.2);
var mClr="";
if((it.type==="task"||it.type==="recurring")&&!it.done&&it.assigned_to){var _m=D.members.find(function(x){return x.user_id===it.assigned_to});if(_m)mClr=_m.color}
var borderC=mClr||{event:"var(--pr)",task:"var(--ac)",recurring:"var(--ac)",birthday:"var(--wn)",subscription:"var(--pr)"}[it.type]||"var(--bd)";
var sub="";
if(it.type==="event"){
var ev=(D.events||[]).find(function(x){return x.id===it.id});
if(ev){
var s=fD(ev.event_date),e=fD(ev.end_date);
sub=s.full;if(ev.end_date&&ev.end_date.split(" ")[0]!==ev.event_date.split(" ")[0])sub=s.full+" → "+e.full
}
}else if(it.type==="task"){
var tk=(D.tasks||[]).find(function(x){return x.id===it.id});
if(tk){
var parts=[];
if(tk.priority&&tk.priority!=="normal")parts.push(tk.priority);
if(tk.assigned_to)parts.push(mName(tk.assigned_to));
if(tk.done)parts.push("✓ Done");
sub=parts.join(" · ")
}
}else if(it.type==="recurring"){
var rc=(D.recurring||[]).find(function(x){return x.id===it.id});
if(rc){var parts2=[];if(rc.assigned_to)parts2.push(mName(rc.assigned_to));parts2.push(rc.rrule);sub=parts2.join(" · ")}
}else if(it.type==="birthday"){
var bd=(D.birthdays||[]).find(function(x){return x.id===it.id});
if(bd&&bd.days_until!=null)sub=bd.days_until===0?"Today! 🎉":"in "+bd.days_until+" days"
}
h+='<div class="cday-item" onclick="showCalEv(\''+it.type+'\','+it.id+')" style="border-left:3px solid '+borderC+'">';
h+='<span style="color:'+borderC+';display:inline-flex;align-items:center">'+_ico+'</span>';
h+='<div class="cday-bd"><div class="cday-tt">'+es(it.title)+'</div>';
if(sub)h+='<div class="cday-sub">'+sub+'</div>';
h+='</div></div>'
})
}
h+='</div></div>';
var el=document.createElement("div");el.id="cal-day-view";el.innerHTML=h;
document.getElementById("cal-mo").appendChild(el)
}
function closeCalDay(){var el=document.getElementById("cal-day-view");if(el)el.remove();_calDayIso=null}
function _calRefresh(){var iso=_calDayIso;_calCache={};if(_calMonth)loadCalMonth().then(function(){if(iso){closeCalDay();openCalDay(iso)}})}

// Add Task / Event from calendar day view (pre-fills the date)
function oMoTkDay(iso){
_assign=0;_pri="normal";_rems=[];
oMC("New Task",'<input class="inp" id="f-t" placeholder="What needs to be done?"><div class="lb">'+tr("g_assign_to")+'</div>'+assignPk("ap",null)+'<div class="lb">'+tr("f_priority")+'</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(p==="normal"?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">'+tr("g_due_date")+'</div><div class="dr"><div><input type="date" id="f-dd" value="'+iso+'"></div></div><div class="lb">'+tr("g_reminders")+'</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="doTkCal()">Add Task</button>',{ic:"clipboard"});
document.getElementById("mo").classList.add("op");
setTimeout(function(){var i=document.querySelector("#mb input.inp");if(i)i.focus()},300)
}
function oMoEvtDay(iso){
oMC("New Event",'<input class="inp" id="f-t" placeholder="Event name"><div class="lb">Start</div><div class="dr"><div><div class="dl">'+tr("f_date")+'</div><input type="date" id="f-d" value="'+iso+'"></div><div><div class="dl">'+tr("g_time")+'</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">End <span style="color:var(--ht);font-weight:400;font-size:11px">(extend for multi-day events)</span></div><div class="dr"><div><input type="date" id="f-ed" value="'+iso+'"></div><div><input type="time" id="f-et" value="13:00" step="60"></div></div><button class="btn" onclick="doEvCal()">Add Event</button>',{ic:"clock"});
document.getElementById("mo").classList.add("op");
setTimeout(function(){var i=document.querySelector("#mb input.inp");if(i)i.focus()},300)
}
async function doTkCal(){var t=document.getElementById("f-t").value.trim();if(!t)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("POST","/api/tasks",{text:t,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load();_calRefresh()}
async function doEvCal(){var t=document.getElementById("f-t").value.trim();var d=document.getElementById("f-d").value;var tm=document.getElementById("f-tm").value||"12:00";if(!t||!d)return;var ed=document.getElementById("f-ed")?document.getElementById("f-ed").value:"";var et=document.getElementById("f-et")?document.getElementById("f-et").value:"";var end=ed?ed+" "+(et||tm):null;await A("POST","/api/events",{text:t,event_date:d+" "+tm,end_date:end});cMo();hp();await load();_calRefresh()}
async function calMarkDone(id){await A("PATCH","/api/tasks/"+id+"/toggle");hp();closeCalEv();await load();_calRefresh()}

// Edit Event modal (no edEv existed before)
function edEv(id){
var e=(D.events||[]).find(function(x){return x.id===id});if(!e)return;
var sd=(e.event_date||"").split(" "),ed=(e.end_date||"").split(" ");
var sDate=sd[0]||"",sTime=((sd[1]||"12:00")+"").slice(0,5);
var eDate=ed[0]||sDate,eTime=((ed[1]||sTime)+"").slice(0,5);
oMC("Edit Event",'<input class="inp" id="f-t" value="'+es(e.text)+'"><div class="lb">Start</div><div class="dr"><div><div class="dl">'+tr("f_date")+'</div><input type="date" id="f-d" value="'+sDate+'"></div><div><div class="dl">'+tr("g_time")+'</div><input type="time" id="f-tm" value="'+sTime+'" step="60"></div></div><div class="lb">End <span style="color:var(--ht);font-weight:400;font-size:11px">(extend for multi-day)</span></div><div class="dr"><div><input type="date" id="f-ed" value="'+eDate+'"></div><div><input type="time" id="f-et" value="'+eTime+'" step="60"></div></div><button class="btn" onclick="svEv('+id+')">Save</button><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)"><button class="btn btn-s" style="color:var(--ac);background:transparent;border:1.5px solid var(--bd)" onclick="dEv('+id+');cMo();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}">Delete Event</button></div>',{ic:"clock"})
}
async function svEv(id){var t=document.getElementById("f-t").value.trim();var d=document.getElementById("f-d").value;var tm=document.getElementById("f-tm").value||"12:00";if(!t||!d)return;var ed=document.getElementById("f-ed")?document.getElementById("f-ed").value:"";var et=document.getElementById("f-et")?document.getElementById("f-et").value:"";var end=ed?ed+" "+(et||tm):null;await A("PUT","/api/events/"+id,{text:t,event_date:d+" "+tm,end_date:end});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}

// Calendar wrappers — close detail card, register refresh callback, open edit modal
function calEdTk(id){closeCalEv();_calEditCb=_calRefresh;edTk(id)}
function calEdEv(id){closeCalEv();_calEditCb=_calRefresh;edEv(id)}
function calEdRec(id){closeCalEv();_calEditCb=_calRefresh;edRec(id)}


// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════
function txCatRefresh(){var el=document.getElementById("tx-cats");if(!el)return;var cats=D.categories.filter(function(c){return c.type===window._txType});var h="";cats.forEach(function(c){h+='<button class="ob'+(window._txCat===c.id?" s":"")+'" onclick="window._txCat='+c.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+c.emoji+" "+es(c.name)+"</button>"});h+='<button class="ob" onclick="addCatInline()" style="border:1.5px dashed var(--ht)">+ New</button>';el.innerHTML=h;window._txCat=0}
function addCatInline(){var ty=window._txType;oMC(tr("mt_new_cat"),'<input class="inp" id="nc-n" placeholder="'+tr("f_name")+'"><input class="inp" id="nc-e" placeholder="📦" value="📦" style="width:80px"><button class="btn" onclick="doAddCatInline(\''+ty+'\')">'+tr("btn_create")+'</button>',{ic:"list"})}
async function doAddCatInline(type){var n=document.getElementById("nc-n").value.trim();var e=document.getElementById("nc-e").value.trim()||"📦";if(!n)return;await A("POST","/api/categories",{name:n,emoji:e,type:type});cMo();hp();await load();go("money");oMo()}
function addCat(type){oMC(tr("mt_new_cat"),'<input class="inp" id="nc-n" placeholder="'+tr("f_name")+'"><input class="inp" id="nc-e" placeholder="📦" value="📦" style="width:80px"><button class="btn" onclick="doAddCat(\''+type+'\')">'+tr("btn_create")+'</button>',{ic:"list"})}
async function doAddCat(type){var n=document.getElementById("nc-n").value.trim();var e=document.getElementById("nc-e").value.trim()||"📦";if(!n)return;await A("POST","/api/categories",{name:n,emoji:e,type:type});cMo();hp();await load()}
function edCat(cid){var c=D.categories.find(function(x){return x.id===cid});if(!c)return;oMC(tr("mt_edit_cat"),'<input class="inp" id="ec-n" value="'+es(c.name)+'"><input class="inp" id="ec-e" value="'+c.emoji+'" style="width:80px"><button class="btn" onclick="svCat('+cid+')">'+tr("btn_save")+'</button>',{ic:"list"})}
async function svCat(cid){var n=document.getElementById("ec-n").value.trim();var e=document.getElementById("ec-e").value.trim();if(!n)return;await A("PUT","/api/categories/"+cid,{name:n,emoji:e});cMo();hp();await load()}
async function dlCat(cid){if(!confirm("Delete category?"))return;await A("DELETE","/api/categories/"+cid);hp();await load();toast("Deleted")}
// oMC(title, body, opts?) — opts.ic = icon name to show in a tinted square left of the title
function oMC(t,h,opts){
  var ic=opts&&opts.ic?icon(opts.ic,18,2.2):'';
  var titleHtml=ic?'<span class="mt2-ico">'+ic+'</span><span>'+t+'</span>':t;
  document.getElementById("mt3").innerHTML=titleHtml;
  document.getElementById("mb").innerHTML=h;
  document.getElementById("mo").classList.add("op");
  document.body.classList.add("no-scroll"); // lock page scroll; only #mb (modal body) scrolls inside
  hp("light");
  setTimeout(function(){var i=document.querySelector("#mb input");if(i)i.focus()},300)
}
function cMo(){
  document.getElementById("mo").classList.remove("op");
  document.body.classList.remove("no-scroll");
}

// Event/Birthday add modals (from hamburger pages)
function oMoEvt(){var dy=td();oMC(tr("mt_add_event"),'<input class="inp" id="f-t" placeholder="'+tr("f_name")+'"><div class="lb">'+tr("g_start")+'</div><div class="dr"><div><div class="dl">'+tr("f_date")+'</div><input type="date" id="f-d" value="'+dy+'" min="'+dy+'"></div><div><div class="dl">'+tr("g_time")+'</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">'+tr("g_end_opt")+'</div><div class="dr"><div><input type="date" id="f-ed"></div><div><input type="time" id="f-et" step="60"></div></div><button class="btn" onclick="doEv()">'+tr("btn_add")+'</button>',{ic:"clock"})}
function oMoBd(){_bdRems=[{days_before:1,time:"09:00"},{days_before:0,time:"09:00"}];oMC(tr("mt_add_bday"),'<input class="inp" id="bd-n" placeholder="'+tr("f_name")+'"><input class="inp" id="bd-e" value="🎂" style="width:80px"><div class="lb">'+tr("g_date_of_birth")+'</div><div class="dr"><div><input type="date" id="bd-d"></div></div><div class="lb">'+tr("g_reminders")+'</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="doBd()">'+tr("btn_add")+'</button>',{ic:"cake"})}

// FAB handler
function oMo(){_assign=0;_pri="normal";_rems=[];var dy=td();
switch(tab){
case"tasks":
    if(taskTab==="recurring"){oMC(tr("mt_add_recur"),'<input class="inp" id="f-t" placeholder="'+tr("f_text")+'"><div class="lb">'+tr("g_assign_to")+'</div>'+assignPk("ap",null)+'<div class="lb">'+tr("g_schedule")+'</div><div class="or"><button class="ob s" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">'+tr("g_daily")+'</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">'+tr("g_weekly")+'</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">'+tr("g_monthly")+'</button></div><input type="hidden" id="rr" value="daily"><div id="wd" class="hidden"><div class="lb">'+tr("g_days")+'</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="hidden"><div class="lb">'+tr("g_day_of_month")+'</div><input class="inp" id="f-md" type="number" min="1" max="28" value="1"></div><button class="btn" onclick="doRec()">'+tr("btn_create")+'</button>',{ic:"refresh"})}
    else{oMC(tr("mt_add_task"),'<input class="inp" id="f-t" placeholder="'+tr("g_what_to_do")+'"><div class="lb">'+tr("g_assign_to")+'</div>'+assignPk("ap",null)+'<div class="lb">'+tr("f_priority")+'</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(p==="normal"?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+tr("p_"+p)+'</button>'}).join("")+'</div><div class="lb">'+tr("g_due_date")+'</div><div class="dr"><div><input type="date" id="f-dd" min="'+dy+'"></div></div><div class="lb">'+tr("g_reminders")+'</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="doTk()">'+tr("btn_add")+'</button>',{ic:"clipboard"})}break;
case"shop":
    // Enhanced: full form like edit
    var folderOpts='<button class="ob s" onclick="window._newShopFold=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">None</button>';
    D.folders.forEach(function(f){folderOpts+='<button class="ob" onclick="window._newShopFold='+f.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+f.emoji+" "+es(f.name)+'</button>'});
    window._newShopFold=0;
    oMC(tr("mt_add_shop"),'<input class="inp" id="ns-n" placeholder="'+tr("f_name")+'"><div class="dr"><div><div class="dl">'+tr("f_quantity")+'</div><input class="inp" id="ns-q" placeholder="1kg"></div><div><div class="dl">'+tr("f_price")+' (din.)</div><input class="inp" id="ns-p" type="number" placeholder="0"></div></div>'+(D.folders.length?'<div class="lb">'+tr("f_folder")+'</div><div class="or">'+folderOpts+'</div>':'')+'<button class="btn" onclick="doShNew()">'+tr("btn_add")+'</button>',{ic:"cart"});break;
case"cooking":
    // Cooking has its own opinionated add-modal with image picker + ingredient rows.
    // Defer to cooking.js — keeps that module self-contained.
    if(typeof _ckOpenAdd==="function")_ckOpenAdd();
    return;
case"money":{
    _assign=0;window._txType="expense";window._txCat=0;
    oMC(tr("mt_add_expense"),'<div class="or" style="margin-bottom:8px"><button class="ob s" id="tb-exp" onclick="window._txType=\'expense\';document.getElementById(\'tb-exp\').classList.add(\'s\');document.getElementById(\'tb-inc\').classList.remove(\'s\');txCatRefresh()">💸 '+tr("m_expense")+'</button><button class="ob" id="tb-inc" onclick="window._txType=\'income\';document.getElementById(\'tb-inc\').classList.add(\'s\');document.getElementById(\'tb-exp\').classList.remove(\'s\');txCatRefresh()">💰 '+tr("m_income")+'</button></div><div class="dr"><div><div class="dl">'+tr("f_amount")+'</div><input class="inp" id="tx-a" type="number" step="0.01" placeholder="0"></div><div><div class="dl">'+tr("f_currency")+'</div><select id="tx-c"><option value="RSD">din.</option><option value="EUR">€</option><option value="USD">$</option><option value="GBP">£</option><option value="RUB">₽</option></select></div></div><div class="lb">'+tr("f_description")+'</div><input class="inp" id="tx-d" placeholder=""><div class="lb">'+tr("f_category")+'</div><div class="or" id="tx-cats"></div><div class="lb">'+tr("f_date")+'</div><input type="date" id="tx-dt" value="'+dy+'"><div class="lb">'+tr("g_who")+'</div>'+assignPk("txm",null)+'<button class="btn" onclick="doTx()">'+tr("btn_add")+'</button>',{ic:"wallet"});setTimeout(txCatRefresh,50)}break}
document.getElementById("mo").classList.add("op");setTimeout(function(){var i=document.querySelector("#mb input[type=text],#mb input.inp");if(i)i.focus()},300)}

// Submit handlers
async function doTk(){var t=document.getElementById("f-t").value.trim();if(!t)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("POST","/api/tasks",{text:t,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load()}
async function doRec(){var t=document.getElementById("f-t").value.trim();if(!t)return;var rr=document.getElementById("rr").value;if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});if(!days.length){alert("Select at least one day");return}rr="weekly:"+days.join(",")}else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1")}await A("POST","/api/recurring",{text:t,assigned_to:_assign||null,priority:_pri,rrule:rr});cMo();hp();await load()}
async function doShNew(){var n=document.getElementById("ns-n").value.trim();if(!n)return;var q=document.getElementById("ns-q").value.trim();var p=parseFloat(document.getElementById("ns-p").value)||null;var fld=window._newShopFold||null;
// Create item then update with qty/price if provided
var r=await A("POST","/api/shopping",{items:[n+(q?" ["+q+"]":"")],folder_id:fld});
if(r&&r.length&&(p||q)){var sid=r[0].id;await A("PUT","/api/shopping/"+sid,{quantity:q||null,price:p,folder_id:fld})}
cMo();hp();await load()}
async function doEv(){var t=document.getElementById("f-t").value.trim();var d=document.getElementById("f-d").value;var tm=document.getElementById("f-tm").value||"12:00";if(!t||!d)return;var ed=document.getElementById("f-ed")?document.getElementById("f-ed").value:"";var et=document.getElementById("f-et")?document.getElementById("f-et").value:"";var end=ed?ed+" "+(et||tm):null;await A("POST","/api/events",{text:t,event_date:d+" "+tm,end_date:end});cMo();hp();await load()}
async function doBd(){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim()||"🎂";var d=document.getElementById("bd-d").value;if(!n||!d)return;await A("POST","/api/birthdays",{name:n,emoji:e,birth_date:d,reminders:_bdRems});cMo();hp();await load()}
async function doNewSub(){var n=document.getElementById("su-n").value.trim();var e=document.getElementById("su-e").value.trim()||"💳";var a=parseFloat(document.getElementById("su-a").value);var c=document.getElementById("su-c").value;var d=parseInt(document.getElementById("su-d").value)||1;if(!n||!a)return;await A("POST","/api/subscriptions",{name:n,emoji:e,amount:a,currency:c,billing_day:d,assigned_to:_assign||null,reminders:_subRems});cMo();hp();await load()}
async function doTx(){var a=parseFloat(document.getElementById("tx-a").value);if(!a)return;var c=document.getElementById("tx-c").value;var d=document.getElementById("tx-d").value.trim();var dt=document.getElementById("tx-dt").value;await A("POST","/api/transactions",{type:window._txType,amount:a,currency:c,description:d,date:dt,category_id:window._txCat||null,member_id:_assign||null});cMo();hp();_moneySummary=null;_anaCache={};await load()}

// ═══════════════════════════════════════════════════════════
// VIEWPORT FIX
// ═══════════════════════════════════════════════════════════
function fixVP(){var nav=document.getElementById("nv");var fab=document.getElementById("fab");if(!nav)return;
var tgB=0;try{tgB=window.Telegram.WebApp.safeAreaInset.bottom||0}catch(e){}
// PWA outside Telegram — read env(safe-area-inset-bottom) via a probe element (iPhone home indicator height)
if(!tgB && !iD){
  var probe=document.createElement("div");
  probe.style.cssText="position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  tgB=probe.offsetHeight||0;
  probe.remove();
}
var total=Math.max(82+tgB,82);document.body.style.paddingBottom=total+"px";
nav.style.paddingBottom=Math.max(tgB,8)+"px";nav.style.height="auto";nav.style.minHeight="62px";
if(fab)fab.style.bottom=(total+12)+"px"}
fixVP();window.addEventListener("resize",fixVP);
if(tg)try{tg.onEvent("viewportChanged",fixVP)}catch(e){}
setTimeout(fixVP,500);setTimeout(fixVP,1500);

// ─── PWA: register service worker (skip inside Telegram WebView — bot already handles updates) ──
(function(){
  if(!('serviceWorker' in navigator))return;
  // Only register on plain http(s) — Telegram WebView uses its own caching layer.
  // We still register; SW is no-op for /api/* and harmless inside Telegram.
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js').catch(function(e){
      // Silent fail — PWA install just won't work, but app still functions.
    });
  });
})();

// ─── "Install app" button — shows when browser fires beforeinstallprompt (Android Chrome).
// On iOS Safari there's no programmatic install; user must use Share → Add to Home Screen.
var _pwaPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();_pwaPrompt=e;
  // Add a small chip to Settings page when next rendered. ren() picks it up via _pwaPrompt check.
  if(tab==='settings')ren();
});
async function installPWA(){
  if(!_pwaPrompt)return;
  _pwaPrompt.prompt();
  try{await _pwaPrompt.userChoice}catch(e){}
  _pwaPrompt=null;ren();
}

// ─── Toggle click: haptic + one-shot spring pop on clicked element ──
// Uses setTimeout(0) so we run AFTER the synchronous onclick handler
// (which typically calls ren() and rebuilds the DOM). We then locate
// the corresponding newly-rendered element by {kind, text} and add .pop
// so the spring animation fires only on actual user presses — never on
// re-renders triggered by other controls.
document.addEventListener("click",function(e){
  var t=e.target.closest(".ob,.ch,.fi,.tab");if(!t)return;
  hp("sel");
  var kind=t.classList.contains("tab")?"tab":t.classList.contains("fi")?"fi":t.classList.contains("ch")?"ch":"ob";
  var txt=(t.textContent||"").trim().slice(0,40);
  setTimeout(function(){
    var sel="."+kind+((kind==="tab"||kind==="fi")?".a":".s");
    var els=document.querySelectorAll(sel),el=null;
    for(var i=0;i<els.length;i++){if(((els[i].textContent||"").trim().slice(0,40))===txt){el=els[i];break}}
    // Fallback: if nothing matched (e.g. opened a modal), try original element
    if(!el&&document.contains(t))el=t;
    if(!el)return;
    el.classList.remove("pop");void el.offsetWidth; // restart animation if already applied
    el.classList.add("pop");
    var cleanup=function(){if(el)el.classList.remove("pop")};
    var done=false;
    var onEnd=function(){if(done)return;done=true;cleanup();el.removeEventListener("animationend",onEnd)};
    el.addEventListener("animationend",onEnd);
    setTimeout(onEnd,450); // safety fallback if animationend never fires
  },0);
},true);

// ─── Init ───────────────────────────────────────────────────
try{init()}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+"\n"+e.stack+'</pre>'}
