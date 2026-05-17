// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ v6.1 — Frontend Logic
// ═══════════════════════════════════════════════════════════════

const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();try{tg.enableClosingConfirmation()}catch(e){}}
const iD=tg?.initData||"";
// Session token (PWA / browser auth via Telegram Login Widget). Persistent across reloads.
function _getSess(){try{return localStorage.getItem("fhq_session")||""}catch(e){return""}}
function _setSess(t){try{t?localStorage.setItem("fhq_session",t):localStorage.removeItem("fhq_session")}catch(e){}}
// Aggressive logout: clear localStorage + SW + caches, then hard reload.
async function _logoutPwa(){
  try{localStorage.clear()}catch(e){}
  try{sessionStorage.clear()}catch(e){}
  try{
    if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){
      var regs=await navigator.serviceWorker.getRegistrations();
      for(var i=0;i<regs.length;i++){await regs[i].unregister()}
    }
  }catch(e){}
  try{
    if(window.caches){var keys=await caches.keys();for(var i=0;i<keys.length;i++){await caches.delete(keys[i])}}
  }catch(e){}
  // Force a full reload bypassing browser cache
  location.replace(location.pathname+"?nocache="+Date.now());
}

// ─── Themes ─────────────────────────────────────────────────
const TH={
midnight:{n:"Midnight",e:"🌙",bg:"#0f0f1a",sf:"#1a1a2f",cd:"#212140",bd:"rgba(255,255,255,0.10)",tx:"#e8e6f0",ht:"#9f9dba",pr:"#7c6aef",pg:"rgba(124,106,239,0.15)",ac:"#ef6a7a",ok:"#5cd6a0",wn:"#f0c45a",gd:"linear-gradient(135deg,#5a4cd0,#7c6aef)",gtx:"#fff",l:0},
dawn:{n:"Dawn",e:"🌅",bg:"#faf7f2",sf:"#fff8f0",cd:"#ffffff",bd:"rgba(0,0,0,0.10)",tx:"#2d2a24",ht:"#7a7066",pr:"#d4783c",pg:"rgba(212,120,60,0.12)",ac:"#c44d56",ok:"#4a9e6e",wn:"#c9982a",gd:"linear-gradient(135deg,#b85e1e,#d4783c)",gtx:"#fff",l:1},
forest:{n:"Forest",e:"🌲",bg:"#0d1a14",sf:"#142420",cd:"#1c3329",bd:"rgba(255,255,255,0.10)",tx:"#d4e8dc",ht:"#85b59a",pr:"#4ec98b",pg:"rgba(78,201,139,0.12)",ac:"#e87461",ok:"#4ec98b",wn:"#d4b84a",gd:"linear-gradient(135deg,#2e9c63,#4ec98b)",gtx:"#fff",l:0},
ocean:{n:"Ocean",e:"🌊",bg:"#0a1628",sf:"#0f1f38",cd:"#162a48",bd:"rgba(255,255,255,0.10)",tx:"#d0e4f5",ht:"#7da8cc",pr:"#38a2d4",pg:"rgba(56,162,212,0.15)",ac:"#ef7b5c",ok:"#4ac4a0",wn:"#e0b84c",gd:"linear-gradient(135deg,#1f7eb8,#38a2d4)",gtx:"#fff",l:0},
rose:{n:"Rosé",e:"🌸",bg:"#1a0f15",sf:"#261822",cd:"#351f2e",bd:"rgba(255,255,255,0.10)",tx:"#f0dce4",ht:"#bb8aa0",pr:"#e0689a",pg:"rgba(224,104,154,0.15)",ac:"#6ac4dc",ok:"#5cc4a2",wn:"#d8b44e",gd:"linear-gradient(135deg,#c44680,#e0689a)",gtx:"#fff",l:0},
chalk:{n:"Chalk",e:"🤍",bg:"#f5f3ef",sf:"#edeae4",cd:"#ffffff",bd:"rgba(0,0,0,0.12)",tx:"#1a1816",ht:"#706b62",pr:"#444038",pg:"rgba(68,64,56,0.08)",ac:"#b8442a",ok:"#3a8a5a",wn:"#a8882a",gd:"linear-gradient(135deg,#2a2620,#444038)",gtx:"#fff",l:1},
onyx:{n:"Onyx",e:"🖤",bg:"#000000",sf:"#0a0a0a",cd:"#141414",bd:"rgba(212,175,55,0.18)",tx:"#f5f0e0",ht:"#b8a878",pr:"#d4af37",pg:"rgba(212,175,55,0.12)",ac:"#e85d75",ok:"#5cd6a0",wn:"#f0c45a",gd:"linear-gradient(135deg,#d4af37,#f4cd5a)",gtx:"#000000",l:0},
lavender:{n:"Lavender",e:"💜",bg:"#f8f5fb",sf:"#f1ecf6",cd:"#ffffff",bd:"rgba(60,30,90,0.12)",tx:"#2a1f3a",ht:"#6b5d80",pr:"#7c3aed",pg:"rgba(124,58,237,0.10)",ac:"#db2777",ok:"#059669",wn:"#d97706",gd:"linear-gradient(135deg,#5b1fc7,#7c3aed)",gtx:"#fff",l:1},
sunset:{n:"Sunset",e:"🌇",bg:"#1a0d0a",sf:"#251510",cd:"#2f1c16",bd:"rgba(255,180,120,0.14)",tx:"#f5dccd",ht:"#d4a890",pr:"#ff6b35",pg:"rgba(255,107,53,0.15)",ac:"#ffd166",ok:"#6dc36b",wn:"#ffd166",gd:"linear-gradient(135deg,#d04515,#ff6b35)",gtx:"#fff",l:0}
};
function aT(id){const t=TH[id];if(!t)return;const r=document.documentElement.style;
["bg","sf","cd","bd","tx","ht","pr","pg","ac","ok","wn","gd"].forEach(k=>r.setProperty("--"+k,t[k]));
r.setProperty("--gtx",t.gtx||"#fff");
document.body.classList.toggle("ls",!!t.l);cTheme=id;}

// ─── State ──────────────────────────────────────────────────
let tab="home",cTheme="midnight",filt=null,fS=null,ex={},dbgOn=false,dbgLog=[];
let taskTab="active",calTab="events",moneyTab="transactions",shopFold=null,searchQ="",searchOpen=false,menuOpen=false;
let D={tasks:[],recurring:[],shopping:[],folders:[],events:[],birthdays:[],subs:[],dashboard:{},members:[],zones:[],settings:{},weather:null,categories:[],transactions:[],exercises:[],recentWorkouts:[],workoutTemplates:[]};
let allSubs={task:{},event:{}};
let _assign=0,_pri="normal",_rems=[],_zRems=[],_bdRems=[],_subRems=[],zOpen={};
// Trainings state — _trainMember undefined means "not yet initialized" (first render → my_id)
var _trainMember,_trainStats=null,_trainView="recent",_curWorkout=null,_restTimer=null,_wkTimer=null;

// ─── API ────────────────────────────────────────────────────
async function A(m,p,b){
var h={"Content-Type":"application/json"};
if(iD)h["X-Telegram-Init-Data"]=iD;
var sess=_getSess();
if(sess)h["X-Session-Token"]=sess;
const o={method:m,headers:h};
if(b)o.body=JSON.stringify(b);
try{const r=await fetch(p,o);
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
palette:'<circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.92 0 1.65-.74 1.65-1.65 0-.43-.16-.83-.43-1.13-.27-.31-.43-.7-.43-1.13a1.65 1.65 0 0 1 1.65-1.65H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9Z"/>'
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
const dN=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],dF=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const mN=["January","February","March","April","May","June","July","August","September","October","November","December"];
function fD(ds){const p=(ds||"").split(" ")[0].split("-").map(Number);if(!p[0]||!p[1]||!p[2])return{day:"?",date:"?",full:"?"};const dt=new Date(p[0],p[1]-1,p[2]);return{day:dN[dt.getDay()],date:p[2]+" "+mN[p[1]-1].slice(0,3),full:dN[dt.getDay()]+" "+p[2]+" "+mN[p[1]-1].slice(0,3)}}
function wIcon(lbl){return (lbl||"🌤").split(" ")[0]}
// Map a weather emoji to an animated SVG name from basmilius/weather-icons (MIT).
// Returns <img> tag; if CDN fails (offline / 404), inline onerror swaps to the emoji.
function _wIconName(emoji,nightAware){var hr=new Date().getHours();var night=nightAware&&(hr<6||hr>=20);
var m={"☀️":night?"clear-night":"clear-day","☀":night?"clear-night":"clear-day",
"🌤":night?"partly-cloudy-night":"partly-cloudy-day","🌤️":night?"partly-cloudy-night":"partly-cloudy-day",
"⛅":night?"partly-cloudy-night":"partly-cloudy-day","☁":"cloudy","☁️":"cloudy",
"🌥":night?"overcast-night":"overcast-day","🌥️":night?"overcast-night":"overcast-day",
"🌦":"partly-cloudy-day-rain","🌦️":"partly-cloudy-day-rain","🌧":"rain","🌧️":"rain",
"⛈":"thunderstorms-rain","⛈️":"thunderstorms-rain",
"🌨":"snow","🌨️":"snow","❄":"snow","❄️":"snow","🌫":"fog","🌫️":"fog","🌙":"clear-night"};
return m[emoji]||null}
function wIconAnim(lbl,size,nightAware){var emoji=wIcon(lbl);var name=_wIconName(emoji,nightAware);var s=size||40;
if(!name)return '<span style="font-size:'+Math.round(s*.75)+'px;line-height:1">'+emoji+'</span>';
var fb=emoji.replace(/'/g,"&#39;");
return '<img src="https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all/'+name+'.svg" width="'+s+'" height="'+s+'" loading="lazy" style="display:block" onerror="this.outerHTML=\'<span style=&quot;font-size:'+Math.round(s*.75)+'px;line-height:1&quot;>'+fb+'</span>\'">'}
function wDayName(ds){var d=new Date(ds+"T12:00:00");return dN[d.getDay()]}
function matchQ(text){return !searchQ||(text||"").toLowerCase().indexOf(searchQ)>=0}

// ─── Toast ──────────────────────────────────────────────────
var _toastTimer=null;
function toast(msg,undoFn){var el=document.getElementById("toast");if(_toastTimer)clearTimeout(_toastTimer);
el.innerHTML=es(msg)+(undoFn?'<button class="toast-u" id="toast-undo">Undo</button>':"");el.classList.add("show");
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
function rSu(t,id){var k=t+"_"+id;if(!ex[k])return "";var s=allSubs[t]&&allSubs[t][id]?allSubs[t][id]:[];var h='<div class="sbs">';s.forEach(function(x){h+='<div class="si"><div class="cb cb-s '+(x.done?"cb-k":"cb-o")+'" onclick="tSu('+x.id+')">'+(x.done?I.ck:"")+'</div><span class="sx'+(x.done?" dn":"")+'">'+es(x.text)+'</span><button class="bi" onclick="dSu('+x.id+')">'+I.x+'</button></div>'});h+='</div><div class="sa"><input id="si-'+t+'-'+id+'" placeholder="Add step..." onkeydown="if(event.key===\'Enter\')aSu(\''+t+'\','+id+')"><button onclick="aSu(\''+t+'\','+id+')">Add</button></div>';return h}
function tX(t,id){ex[t+"_"+id]=!ex[t+"_"+id];ren()}
async function tSu(sid){hp();await A("PATCH","/api/subtasks/"+sid+"/toggle");await load()}
async function dSu(sid){hp();await A("DELETE","/api/subtasks/"+sid);await load()}
async function aSu(t,pid){var i=document.getElementById("si-"+t+"-"+pid);if(!i||!i.value.trim())return;await A("POST","/api/subtasks/"+t+"/"+pid,{text:i.value.trim()});hp();await load()}

// ═══════════════════════════════════════════════════════════
// NAVIGATION — 4 tabs + hamburger
// ═══════════════════════════════════════════════════════════
const NV=[
{id:"home",l:"Home",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'},
{id:"tasks",l:"Tasks",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'},
{id:"trainings",l:"Train",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1"/><path d="M3 3l1 1"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/></svg>'},
{id:"money",l:"Money",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'},
{id:"profile",l:"Profile",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
];
const TT={home:{i:"home",t:"Family HQ",s:"Everything at a glance"},tasks:{i:"clipboard",t:"Tasks",s:"Manage & assign"},shop:{i:"cart",t:"Shopping",s:"Shared list"},trainings:{i:"dumbbell",t:"Trainings",s:"Workouts & progress"},money:{i:"dollar",t:"Money",s:"Budget & subs"},profile:{i:"user",t:"Profile",s:"Personal stats"},events:{i:"clock",t:"Events",s:"Schedule"},birthdays:{i:"cake",t:"Birthdays",s:"Never forget"},clean:{i:"broom",t:"Cleaning",s:"Apartment zones"},settings:{i:"cog",t:"Settings",s:"Customize"},subs:{i:"card",t:"Subscriptions",s:"Monthly payments"}};

(function(){var n=document.getElementById("nv");NV.forEach(function(t){var b=document.createElement("button");b.className="ni"+(t.id==="home"?" a":"");b.dataset.t=t.id;b.innerHTML='<span class="nb hidden" id="b-'+t.id+'"></span>'+t.sv+'<span>'+t.l+'</span>';b.onclick=function(){go(t.id)};n.appendChild(b)})})();

function go(t){tab=t;filt=null;searchQ="";menuOpen=false;
document.getElementById("menu-overlay").classList.remove("open");
var si=document.getElementById("si");if(si)si.value="";
document.querySelectorAll(".ni").forEach(function(e){e.classList.toggle("a",e.dataset.t===t)});
var _tt=TT[t]||{i:"",t:"",s:""};
document.getElementById("hi").innerHTML=_tt.i?icon(_tt.i,22,2.2):"";
document.getElementById("ht").textContent=_tt.t;
document.getElementById("hs").textContent=_tt.s;
// When entering Tasks tab and the last-selected sub-tab isn't Active, override header to match the sub-tab
if(t==="tasks"&&taskTab&&taskTab!=="active"){
  var _hi=document.getElementById("hi");
  if(taskTab==="events"){_hi.innerHTML=icon("clock",22,2.2);document.getElementById("ht").textContent="Events";document.getElementById("hs").textContent="Schedule";_evtsFirstRender=true}
  else if(taskTab==="recurring"){_hi.innerHTML=icon("refresh",22,2.2);document.getElementById("ht").textContent="Recurring";document.getElementById("hs").textContent="Repeating tasks"}
}
var noFab=["home","settings","clean","events","birthdays","subs","profile","trainings"];
var hideFab=noFab.indexOf(t)>=0||(t==="tasks"&&taskTab==="events");
document.getElementById("fab").classList.toggle("hidden",hideFab);
if(t==="home")_firstHomeRender=true;
if(t==="events")_evtsFirstRender=true;
if(t==="profile")_profStats=null;
if(t==="trainings")_trainStats=null;
ren();hp("sel")}

// Hamburger menu
function toggleMenu(){menuOpen=!menuOpen;document.getElementById("menu-overlay").classList.toggle("open",menuOpen)}

// ─── Onboarding ─────────────────────────────────────────────
// "Browser mode" = no Telegram initData. We use iD (not tg) because the Telegram script
// creates window.Telegram.WebApp even outside Telegram — only initData is reliable.
async function init(){
if(!iD && !_getSess()){rLogin();return}
try{var r=await A("GET","/api/family/status");if(!r){if(!iD)rLogin();return}fS=r;
if(r.joined){document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load()}else rOnb()}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+'</pre>'}}

// ─── Login screen with TWO methods: widget (web auth) + bot deep link ──────
var _loginMode="bot";  // bot is the default — works with any Telegram account
var _botCode=null,_botPollTimer=null;

async function rLogin(){
document.getElementById("fab").classList.add("hidden");
document.querySelectorAll(".ni").forEach(function(e){e.style.opacity=".3"});
var info=null;
try{var r=await fetch("/api/auth/bot-info");info=await r.json()}catch(e){}
var bot=info&&info.bot_username;
var ct=document.getElementById("ct");
var h='<div class="onb"><div class="onb-e">🔐</div>'+
  '<div class="onb-t">Sign in with Telegram</div>'+
  '<div class="onb-s">Family HQ uses your Telegram account so all data stays in sync.</div>';
if(!bot){
  h+='<div style="color:var(--ac);font-size:13px;text-align:center;padding:16px">⚠️ Bot not configured. Try opening this app from inside Telegram.</div>';
}else{
  // Tab switch — recommend bot mode as primary (no telegram.org cookie issues)
  h+='<div style="display:flex;gap:8px;margin:16px 0 10px">';
  h+='<button class="ob '+(_loginMode==="bot"?"s":"")+'" style="flex:1" onclick="_loginMode=\'bot\';rLogin()">📨 Via Bot (recommended)</button>';
  h+='<button class="ob '+(_loginMode==="widget"?"s":"")+'" style="flex:1" onclick="_loginMode=\'widget\';rLogin()">🌐 Web</button>';
  h+='</div>';
  if(_loginMode==="bot"){
    h+='<div id="bot-login-host" style="margin-top:10px"></div>';
    h+='<div style="font-size:11px;color:var(--ht);margin-top:14px;text-align:center;max-width:300px">Works with whichever Telegram account is logged in on your phone — no cookie tricks.</div>';
  }else{
    h+='<div id="tg-widget-host" style="margin-top:20px;display:flex;justify-content:center"></div>';
    h+='<div style="font-size:11px;color:var(--ht);margin-top:14px;text-align:center;max-width:300px">Uses your <b>web.telegram.org</b> session. If you log in with the wrong account, sign out at web.telegram.org first.</div>';
  }
}
h+='</div>';
ct.innerHTML=h;
if(bot){
  if(_loginMode==="bot"){_renderBotLogin(bot)}
  else{_renderWidget(bot)}
  // Stale session escape hatch
  if(_getSess()){
    var clear=document.createElement("button");
    clear.className="onb-b s2";
    clear.style.cssText="margin-top:14px;background:transparent;border:1.5px solid var(--ac);color:var(--ac);font-size:12px";
    clear.textContent="Clear stored session";
    clear.onclick=function(){_logoutPwa()};
    document.querySelector(".onb").appendChild(clear);
  }
}
}

function _renderWidget(bot){
var s=document.createElement("script");
s.async=true;
s.src="https://telegram.org/js/telegram-widget.js?22";
s.setAttribute("data-telegram-login",bot);
s.setAttribute("data-size","large");
s.setAttribute("data-radius","12");
s.setAttribute("data-onauth","onTelegramAuth(user)");
s.setAttribute("data-request-access","write");
document.getElementById("tg-widget-host").appendChild(s);
// Stop any bot-polling left over
if(_botPollTimer){clearInterval(_botPollTimer);_botPollTimer=null}
_botCode=null;
}

async function _renderBotLogin(bot){
var host=document.getElementById("bot-login-host");if(!host)return;
host.innerHTML='<div style="text-align:center;padding:20px;color:var(--ht)">Generating link…</div>';
var r=await A("POST","/api/auth/bot-login-init");
if(!r||!r.deep_link){host.innerHTML='<div style="color:var(--ac);text-align:center;padding:16px">Bot not configured</div>';return}
_botCode=r.code;
host.innerHTML=
  '<a href="'+r.deep_link+'" target="_blank" class="btn" style="display:block;text-align:center;text-decoration:none;background:#0088cc;color:#fff;margin-bottom:10px">📨 Open @'+bot+' in Telegram</a>'+
  '<div style="font-size:12px;color:var(--ht);text-align:center;margin-top:8px">1. Tap the blue button above<br>2. In Telegram, tap <b>Start</b> on the bot<br>3. Come back here — auto-logs in</div>'+
  '<div id="bot-poll-status" style="text-align:center;margin-top:14px;font-size:12px;color:var(--ht)">Waiting for confirmation…</div>';
// Start polling
if(_botPollTimer)clearInterval(_botPollTimer);
_botPollTimer=setInterval(_pollBotLogin,2000);
}

async function _pollBotLogin(){
if(!_botCode)return;
var r=await A("GET","/api/auth/bot-login-poll?code="+encodeURIComponent(_botCode));
if(!r)return;
var st=document.getElementById("bot-poll-status");
if(r.status==="complete"&&r.token){
  if(_botPollTimer){clearInterval(_botPollTimer);_botPollTimer=null}
  if(st)st.innerHTML='<span style="color:var(--ok)">✓ Logged in as '+es(r.first_name||"User")+' — loading…</span>';
  _setSess(r.token);
  setTimeout(function(){location.reload()},500);
}else if(r.status==="expired"){
  if(_botPollTimer){clearInterval(_botPollTimer);_botPollTimer=null}
  if(st)st.innerHTML='<span style="color:var(--ac)">Code expired. Tap "Via Bot" again for a new link.</span>';
}
}

// Called by Telegram widget after successful login
async function onTelegramAuth(user){
hp("ok");
var r=await A("POST","/api/auth/telegram-login",user);
if(!r||!r.token){
  toast("Login failed — domain not set in BotFather, or browser blocked.");
  return;
}
_setSess(r.token);
// Verify localStorage actually persisted (iOS Private/Incognito mode rejects writes silently)
if(_getSess()!==r.token){
  toast("Cannot save login — try a non-private browser tab.");
  return;
}
// Reload — init() will see the session and route correctly (app if in family, onboarding if not)
location.reload();
}
function rOnb(){
document.getElementById("fab").classList.add("hidden");
document.querySelectorAll(".ni").forEach(function(e){e.style.opacity=".3"});
// Show currently authenticated user_id (from session token) so user can see who they're logged in as
var currentUid="";
if(!iD&&_getSess()){
  try{var parts=_getSess().split(".");if(parts.length>=2)currentUid='<div style="font-size:11px;color:var(--ht);margin-top:8px;font-family:monospace">Logged in as Telegram user '+parts[0]+'</div>'}catch(e){}
}
var pwaLogout=(!iD&&_getSess())?'<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--bd);text-align:center"><div style="font-size:12px;color:var(--ht);margin-bottom:10px">Wrong Telegram account?</div><button class="onb-b s2" style="background:transparent;border:1.5px solid var(--ac);color:var(--ac)" onclick="_logoutPwa()">Sign out & try different account</button></div>':'';
document.getElementById("ct").innerHTML='<div class="onb"><div class="onb-ico">'+icon("user",44,2)+'</div><div class="onb-t">Welcome to Family HQ</div><div class="onb-s">Create a new family or join an existing one with an invite code.</div>'+currentUid+'<div style="height:18px"></div><button class="onb-b p" onclick="shCr()">'+icon("pl",16,2.5)+'<span style="margin-left:6px">Create Family</span></button><div style="color:var(--ht);font-size:13px;margin:10px 0;letter-spacing:.5px;text-transform:uppercase;font-weight:600">or</div><button class="onb-b s2" onclick="shJn()"><span style="margin-right:4px">Join with Code</span></button>'+pwaLogout+'</div>'
}
function shCr(){oMC("Create Family",'<input class="inp" id="fn" placeholder="Family name" value="Our Family"><button class="btn" onclick="doCr()">Create</button>')}
function shJn(){oMC("Join Family",'<div style="text-align:center;margin-bottom:16px"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">Enter 6-character code</div><input class="ci2" id="fc" placeholder="ABC123" maxlength="6"></div><button class="btn" onclick="doJn()">Join</button>')}
async function doCr(){var n=document.getElementById("fn").value.trim()||"Our Family";var r=await A("POST","/api/family/create",{name:n});if(!r||r.detail){alert(r?r.detail:"Error");return}cMo();hp();fS={joined:true,invite_code:r.invite_code,name:r.name,members:[]};document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});oMC("Family Created! 🎉",'<div style="text-align:center"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">Share this code:</div><div class="cd2"><div class="ct2">'+r.invite_code+'</div><div class="cl2">Invite Code</div></div><button class="btn" onclick="cMo();load()">Got it!</button></div>')}
async function doJn(){var c=document.getElementById("fc").value.trim();if(c.length<4){alert("Enter code");return}var r=await A("POST","/api/family/join",{code:c});if(!r||r.detail){alert(r?r.detail:"Invalid");return}cMo();hp();fS={joined:true,name:r.name};document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load()}

// ─── Load (bundle) ──────────────────────────────────────────
async function load(){var b=await A("GET","/api/bundle");if(!b)return;
D.tasks=b.tasks||[];D.recurring=b.recurring||[];D.shopping=b.shopping||[];D.folders=b.folders||[];
D.events=b.events||[];D.birthdays=b.birthdays||[];D.subs=b.subs||[];
D.dashboard=b.dashboard||{};D.members=b.members||[];D.settings=b.settings||{};
if(b.family&&b.family.joined)fS=b.family;D.zones=b.zones||[];
allSubs.task=b.subtasks_task||{};allSubs.event=b.subtasks_event||{};D.txItems=b.tx_items||{};
D.weather=b.weather||null;D.categories=b.categories||[];D.transactions=b.transactions||[];
D.exercises=b.exercises||[];D.recentWorkouts=b.recent_workouts||[];D.workoutTemplates=b.workout_templates||[];
if(D.settings.theme)aT(D.settings.theme);ren()}

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
case"clean":c.innerHTML=rC();break;case"settings":c.innerHTML=rSet();break;case"subs":c.innerHTML=rSubsList();break;case"profile":c.innerHTML=rProfile();break}}
function sB(t,n){var e=document.getElementById("b-"+t);if(!e)return;if(n>0){e.textContent=n;e.classList.remove("hidden")}else e.classList.add("hidden")}

// Hamburger menu — dynamically rendered with counters
function rMenuItems(){
var el=document.getElementById("menu-items");if(!el)return;
// Compute "active" counts per section
var cnt={
shop: (D.shopping||[]).filter(function(s){return!s.bought}).length,
events: (D.events||[]).filter(function(e){var d=(e.event_date||"").split(" ")[0];if(!d)return false;var diff=Math.round((new Date(d)-new Date(td()))/86400000);return diff>=0&&diff<=7}).length,
birthdays: (D.birthdays||[]).filter(function(b){return b.days_until!=null&&b.days_until>=0&&b.days_until<=7}).length,
clean: (D.zones||[]).filter(function(z){return z.dirty}).length,
subs: (D.subs||[]).filter(function(s){return s.days_until!=null&&s.days_until>=0&&s.days_until<=5}).length,
};
var items=[
{id:"shop",ic:"cart",label:"Shopping",cnt:cnt.shop},
{id:"birthdays",ic:"cake",label:"Birthdays",cnt:cnt.birthdays},
{id:"clean",ic:"broom",label:"Cleaning",cnt:cnt.clean},
{id:"subs",ic:"card",label:"Subscriptions",cnt:cnt.subs},
];
var h='';
items.forEach(function(it){
var b=it.cnt>0?'<span class="mi-cnt">'+it.cnt+'</span>':'';
h+='<button class="menu-i" onclick="go(\''+it.id+'\')"><span class="mi-ico">'+icon(it.ic,20,2)+'</span><span class="mi-l">'+it.label+'</span>'+b+'</button>';
});
h+='<div style="height:1px;background:var(--bd);margin:8px 0"></div>';
h+='<button class="menu-i" onclick="go(\'settings\')"><span class="mi-ico">'+icon("cog",20,2)+'</span><span class="mi-l">Settings</span></button>';
el.innerHTML=h;
// Show dot on hamburger icon if any section has active items
var totalActive=Object.values(cnt).reduce(function(a,b){return a+b},0);
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
var _vd='<video class="wbg-vd" autoplay muted loop playsinline preload="metadata" onloadeddata="this.classList.add(\'loaded\');this.parentNode.classList.add(\'has-video\')" onerror="this.remove()"><source src="/static/weather/'+cat+'.mp4" type="video/mp4"></video><div class="wbg-vd-scrim"></div>';
h+='<div class="wbg wbg-'+cat+'">'+_vd+'<div style="display:flex;align-items:center;gap:10px;text-shadow:0 1px 3px rgba(0,0,0,.5)"><div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));flex-shrink:0">'+wIconAnim(w.label,46,true)+'</div><div><span style="font-size:24px;font-weight:800;color:#fff">'+w.now+'°</span><span style="font-size:12px;color:rgba(255,255,255,.65);margin-left:6px">feels '+w.feels+'°</span></div><div style="display:flex;gap:8px;margin-left:auto">';
w.days.forEach(function(dy,i){var label=i===0?"Today":wDayName(dy.date);h+='<div style="text-align:center;min-width:44px"><div style="font-size:10px;color:rgba(255,255,255,.6);font-weight:600">'+label+'</div><div style="margin:2px auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));display:flex;justify-content:center">'+wIconAnim(dy.label,26,false)+'</div><div style="font-size:12px;font-weight:700;color:#fff">'+dy.max+'°</div><div style="font-size:10px;color:rgba(255,255,255,.55)">'+dy.min+'°</div></div>'});h+='</div></div></div>'}else h+='<div style="margin-bottom:16px"></div>';
// Calendar strip
h+='<div class="sc">Calendar</div>';
h+='<div class="cal-strip" onclick="openCalModal()" id="cal-strip"></div>';
setTimeout(function(){loadCalStrip()},0);
// Upcoming 7d
var upcoming=[];var todayStr=td();
D.events.forEach(function(ev){var eDate=(ev.event_date||"").split(" ")[0];if(!eDate)return;var diff=Math.round((new Date(eDate)-new Date(todayStr))/86400000);if(diff>=0&&diff<=7)upcoming.push({type:"event",days:diff,icon:"📅",title:es(ev.text),sub:fD(ev.event_date).full,color:"var(--ok)"})});
D.birthdays.forEach(function(b){if(b.days_until>=0&&b.days_until<=7)upcoming.push({type:"birthday",days:b.days_until,icon:b.emoji,title:es(b.name),sub:b.days_until===0?"Today! 🎉":"in "+b.days_until+" days",color:"var(--wn)"})});
D.subs.forEach(function(s){if(s.days_until>=0&&s.days_until<=7)upcoming.push({type:"sub",days:s.days_until,icon:s.emoji,title:es(s.name),sub:s.amount+" "+s.currency,color:"var(--pr)"})});
upcoming.sort(function(a,b){return a.days-b.days});
if(upcoming.length){h+='<div class="sc"><span class="sc-l">Upcoming 7 Days<span class="sc-cnt">'+upcoming.length+'</span></span></div>';upcoming.forEach(function(u){
var _ud=new Date(Date.now()+u.days*86400000);var dayLabel=u.days===0?"Today":u.days===1?"Tomorrow":dN[_ud.getDay()]+" "+_ud.getDate()+" "+mN[_ud.getMonth()].slice(0,3);
var tone=u.days===0?"tone-ac":u.days<=2?"tone-wn":"tone-ok";
var rightPill=u.days===0?'<span class="lc-rt '+tone+'">Today</span>':'<span class="lc-rt '+tone+'">in '+u.days+'d</span>';
var accClass=u.type==="birthday"?"acc-wn":u.type==="event"?"acc-ok":"";
h+='<div class="lc"><div class="lc-i '+accClass+'">'+u.icon+'</div><div class="lc-bd"><div class="lc-tt">'+u.title+'</div><div class="lc-mt">'+dayLabel+' · '+u.sub+'</div></div>'+rightPill+'</div>'})}
return h}

// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════
function rT(){var h='<div class="tabs"><button class="tab '+(taskTab==="active"?"a":"")+'" onclick="taskTabSet(\'active\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("clipboard",13,2.2)+'Active</span></button><button class="tab '+(taskTab==="recurring"?"a":"")+'" onclick="taskTabSet(\'recurring\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("refresh",13,2.2)+'Recurring</span></button><button class="tab '+(taskTab==="events"?"a":"")+'" onclick="taskTabSet(\'events\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("clock",13,2.2)+'Events</span></button></div>';
if(taskTab==="recurring")return h+rRecur();
if(taskTab==="events")return h+rEvts();
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';
var all=D.tasks;if(filt)all=all.filter(function(x){return x.assigned_to===filt});
if(searchQ)all=all.filter(function(x){return matchQ(x.text)});
var pend=all.filter(function(x){return!x.done}),done=all.filter(function(x){return x.done});
if(!all.length)return h+em("📋","No tasks yet","Tap + to add one");
// Group pending tasks into sections
var todayStr=td();var _7d=new Date();_7d.setDate(_7d.getDate()+7);var weekStr=_7d.getFullYear()+"-"+String(_7d.getMonth()+1).padStart(2,"0")+"-"+String(_7d.getDate()).padStart(2,"0");
var overdue=[],high=[],week=[],rest=[];
pend.forEach(function(t){var dd=(t.due_date||"").split(" ")[0];if(dd&&dd<todayStr){overdue.push(t)}else if(t.priority==="high"){high.push(t)}else if(dd&&dd<=weekStr){week.push(t)}else{rest.push(t)}});
function _tkCard(t,overdueDate){var rmC=t.reminders&&t.reminders.length?'<span class="pdate">'+icon("bl",10,2)+t.reminders.length+'</span>':"";
var priLabel=t.priority==="high"?"High":t.priority==="low"?"Low":"Normal";
var priCls=t.priority==="high"?"hi":t.priority==="low"?"lo":"md";
var priPill='<span class="ppri '+priCls+'">'+icon("fl",10,2.4)+priLabel+'</span>';
var dateTone=overdueDate?"tone-ac":"";
var datePill=t.due_date?'<span class="pdate '+dateTone+'">'+icon("calendar",10,2.2)+fD(t.due_date).full+'</span>':"";
return '<div style="margin-bottom:10px"><div class="c" style="margin-bottom:0"><div class="cb cb-o" onclick="tgTk('+t.id+',this)"></div><div class="bd"><div class="tt">'+es(t.text)+'</div><div class="mt">'+mChip(t.assigned_to,true)+" "+priPill+" "+datePill+" "+rmC+" "+sC("task",t.id)+' <button class="xb" onclick="tX(\'task\','+t.id+')">'+(ex["task_"+t.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="edTk('+t.id+')">'+I.ed+'</button><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>'+rSu("task",t.id)+'</div>'}
function _scH(ico,label,cnt,color){var iconHtml=ico?'<span class="sc-ico"'+(color?' style="color:'+color+'"':'')+'>'+icon(ico,12,2.4)+'</span>':'';return '<div class="sc"'+(color?' style="color:'+color+'"':'')+'><span class="sc-l">'+iconHtml+label+'<span class="sc-cnt"'+(color?' style="background:color-mix(in srgb,'+color+' 16%,transparent);color:'+color+'"':'')+'>'+cnt+'</span></span></div>'}
if(overdue.length){h+=_scH("dot","Overdue",overdue.length,"var(--ac)");overdue.forEach(function(t){h+=_tkCard(t,true)})}
if(high.length){h+=_scH("bolt","High Priority",high.length,"var(--wn)");high.forEach(function(t){h+=_tkCard(t)})}
if(week.length){h+=_scH("calendar","This Week",week.length);week.forEach(function(t){h+=_tkCard(t)})}
if(rest.length){h+=_scH("list","Rest",rest.length);rest.forEach(function(t){h+=_tkCard(t)})}
if(!pend.length)h+='<div style="text-align:center;padding:20px;color:var(--ht);font-size:13px">All caught up! 🎉</div>';
if(done.length){h+=_scH("ck","Done",done.length,"var(--ok)");done.forEach(function(t){h+='<div class="c d"><div class="cb cb-k" onclick="tgTk('+t.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(t.text)+'</div></div><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>'})}
return h}
function rRecur(){if(!D.recurring.length)return em(icon("refresh",48,1.8),"No recurring tasks","Tap + to create");var h='';D.recurring.forEach(function(r){if(searchQ&&!matchQ(r.text))return;var rrDesc=r.rrule==="daily"?"Every day":r.rrule.startsWith("weekly:")?"Weekly: "+r.rrule.split(":")[1]:"Monthly: "+r.rrule.split(":")[1]+"th";var pausedPill=r.active?'':' <span class="pdate tone-ac">Paused</span>';h+='<div class="c"><div class="bd"><div class="tt">'+es(r.text)+'</div><div class="mt">'+mChip(r.assigned_to,true)+' <span class="pdate" style="background:color-mix(in srgb,var(--pr) 14%,transparent);color:var(--pr)">'+icon("refresh",10,2.2)+rrDesc+'</span>'+pausedPill+'</div></div><button class="bi" onclick="edRec('+r.id+')">'+I.ed+'</button><button class="bi" onclick="dlRec('+r.id+')">'+I.tr+'</button></div>'});return h}

async function tgTk(id,cb){
var t=D.tasks.find(function(x){return x.id===id});
var doing=t&&!t.done;
var card=cb&&cb.closest?cb.closest(".c"):null;
if(doing&&card){
  // spring pop, flash check, maybe confetti, then slide out — API in parallel
  var isLast=D.tasks.filter(function(x){return!x.done}).length===1;
  hp("ok");
  cb.classList.remove("cb-o");cb.classList.add("cb-k","cb-flash");cb.innerHTML=I.ck;
  card.classList.add("c-pop");
  if(isLast){var r=card.getBoundingClientRect();FX.confetti({getBoundingClientRect:function(){return r}})}
  var apiP=A("PATCH","/api/tasks/"+id+"/toggle");
  setTimeout(function(){card.classList.remove("c-pop");card.classList.add("c-go")},260);
  setTimeout(async function(){await apiP;await load()},700);
}else{
  hp("light");
  await A("PATCH","/api/tasks/"+id+"/toggle");
  await load();
}}
async function dlTk(id){var t=D.tasks.find(function(x){return x.id===id});hp("warn");await A("DELETE","/api/tasks/"+id);await load();if(t)toast("🗑 Deleted",function(){A("POST","/api/tasks",{text:t.text,assigned_to:t.assigned_to,priority:t.priority,due_date:t.due_date}).then(load)})}
async function dlRec(id){hp();await A("DELETE","/api/recurring/"+id);await load();toast("🗑 Deleted")}
function edTk(id){var t=D.tasks.find(function(x){return x.id===id});if(!t)return;_assign=t.assigned_to||0;_pri=t.priority;_rems=(t.reminders||[]).map(function(r){return r.remind_at});oMC("Edit Task",'<input class="inp" id="f-t" value="'+es(t.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",t.assigned_to)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(t.priority===p?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" value="'+(t.due_date?(t.due_date.split(" ")[0]):"")+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="svTk('+id+')">Save</button>',{ic:"clipboard"})}
async function svTk(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("PUT","/api/tasks/"+id,{text:text,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}
function edRec(id){var r=D.recurring.find(function(x){return x.id===id});if(!r)return;_assign=r.assigned_to||0;oMC("Edit Recurring",'<input class="inp" id="f-t" value="'+es(r.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",r.assigned_to)+'<div class="lb">Schedule</div><div class="or"><button class="ob '+(r.rrule==="daily"?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Daily</button><button class="ob '+(r.rrule.startsWith("weekly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Weekly</button><button class="ob '+(r.rrule.startsWith("monthly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">Monthly</button></div><input type="hidden" id="rr" value="'+r.rrule+'"><div id="wd" class="'+(r.rrule.startsWith("weekly")?"":"hidden")+'"><div class="lb">Days</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob '+(r.rrule.indexOf(d)>=0?"s":"")+'" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="'+(r.rrule.startsWith("monthly")?"":"hidden")+'"><div class="lb">Day of month</div><input class="inp" id="f-md" type="number" min="1" max="28" value="'+(r.rrule.startsWith("monthly:")?r.rrule.split(":")[1]:"1")+'"></div><div class="lb">Status</div><div class="or"><button class="ob '+(r.active?"s":"")+'" onclick="_recActive=1;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Active</button><button class="ob '+(!r.active?"s":"")+'" onclick="_recActive=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Paused</button></div><button class="btn" onclick="svRec('+id+')">Save</button>',{ic:"refresh"});window._recActive=r.active}
async function svRec(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var rr=document.getElementById("rr").value;if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});rr="weekly:"+days.join(",")}else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1")}await A("PUT","/api/recurring/"+id,{text:text,assigned_to:_assign||null,rrule:rr,active:window._recActive});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}

// ═══════════════════════════════════════════════════════════
// SHOPPING — enhanced add flow
// ═══════════════════════════════════════════════════════════
function rSh(){
var h='<div class="fb2"><button class="fi '+(shopFold===null?"a":"")+'" onclick="shopFold=null;ren()">All</button><button class="fi '+(shopFold==="stock"?"a":"")+'" onclick="shopFold=\'stock\';ren()"><span style="display:inline-flex;align-items:center;gap:4px">📦 In Stock</span></button>';
D.folders.forEach(function(f){h+='<button class="fi '+(shopFold===f.id?"a":"")+'" onclick="shopFold='+f.id+';ren()"><span style="display:inline-flex;align-items:center;gap:4px">'+f.emoji+es(f.name)+'</span></button><button class="bi" onclick="edFolder('+f.id+')" style="padding:2px;margin-left:-6px">'+I.ed+'</button>'});
h+='<button class="fi" onclick="shAddFolder()"><span style="display:inline-flex;align-items:center;gap:4px">'+I.pl+'Folder</span></button></div>';
function _scH3(ico,label,cnt,extra,color){var iconHtml=ico?'<span class="sc-ico"'+(color?' style="color:'+color+'"':'')+'>'+icon(ico,12,2.4)+'</span>':'';return '<div class="sc"'+(color?' style="color:'+color+'"':'')+'><span class="sc-l">'+iconHtml+label+(cnt?'<span class="sc-cnt"'+(color?' style="background:color-mix(in srgb,'+color+' 16%,transparent);color:'+color+'"':'')+'>'+cnt+'</span>':"")+'</span>'+(extra||'')+'</div>'}
var items=D.shopping;
if(shopFold==="stock")items=items.filter(function(x){return x.bought});
else if(shopFold!==null)items=items.filter(function(x){return x.folder_id===shopFold&&!x.bought});
else items=items.filter(function(x){return!x.bought});
if(searchQ)items=items.filter(function(x){return matchQ(x.item)});
var folderTotal=0;items.forEach(function(x){if(x.price&&(shopFold==="stock"||!x.bought))folderTotal+=x.price});
if(folderTotal>0)h+='<div class="cat-row" style="margin-bottom:14px"><div class="cat-row-h"><span class="nm">Total</span><span class="vl" style="color:var(--wn)">'+folderTotal.toFixed(0)+' din.</span></div></div>';
if(shopFold==="stock"){
  if(!items.length)return h+em(icon("cart",48,1.8),"Nothing in stock","Buy items to see them here");
  h+=_scH3("ck","In Stock",items.length,'<button class="at" onclick="clSh()">Clear</button>',"var(--ok)");
  var fMap={};D.folders.forEach(function(f){fMap[f.id]=f});var grps={};items.forEach(function(s){var k=s.folder_id||0;if(!grps[k])grps[k]=[];grps[k].push(s)});var ks=D.folders.map(function(f){return f.id}).filter(function(id){return grps[id]});if(grps[0])ks.push(0);var multi=ks.length>1||(ks.length===1&&ks[0]!==0);
  ks.forEach(function(k){var g=grps[k];if(multi){var label=k&&fMap[k]?(fMap[k].emoji+" "+es(fMap[k].name)):"Other";h+='<div class="sc" style="font-size:12px;margin-top:12px"><span class="sc-l">'+label+'<span class="sc-cnt">'+g.length+'</span></span></div>'}
  g.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c c-stk"><div class="cb cb-k" onclick="tgSh('+s.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})});
  return h
}
var p=items.filter(function(x){return!x.bought}),b=items.filter(function(x){return x.bought});
if(!items.length)return h+em(icon("cart",48,1.8),"List is empty","Tap + to add");
if(p.length){h+=_scH3("cart","To Buy",p.length);
  p.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c"><div class="cb cb-o" onclick="tgSh('+s.id+',this)"></div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})}
if(b.length){h+=_scH3("ck","Bought",b.length,'<button class="at" onclick="clSh()">Clear</button>',"var(--ok)");
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
async function dSh(id){hp("warn");await A("DELETE","/api/shopping/"+id);await load();toast("🗑 Deleted")}
async function clSh(){hp();await A("DELETE","/api/shopping/clear-bought");await load();toast("✓ Cleared")}
function edShop(sid){var s=D.shopping.find(function(x){return x.id===sid});if(!s)return;var folderOpts='<button class="ob '+(!s.folder_id?"s":"")+'" onclick="window._sFold=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">None</button>';D.folders.forEach(function(f){folderOpts+='<button class="ob '+(s.folder_id===f.id?"s":"")+'" onclick="window._sFold='+f.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+f.emoji+" "+es(f.name)+'</button>'});window._sFold=s.folder_id||0;oMC("Edit Item",'<input class="inp" id="se-n" value="'+es(s.item)+'"><div class="dr"><div><div class="dl">Quantity</div><input class="inp" id="se-q" value="'+(s.quantity||"")+'" placeholder="e.g. 1kg"></div><div><div class="dl">Price (din.)</div><input class="inp" id="se-p" type="number" value="'+(s.price||"")+'" placeholder="0"></div></div>'+(D.folders.length?'<div class="lb">Folder</div><div class="or">'+folderOpts+'</div>':'')+'<button class="btn" onclick="svShop('+sid+')">Save</button>')}
async function svShop(sid){var n=document.getElementById("se-n").value.trim();var q=document.getElementById("se-q").value.trim();var p=parseFloat(document.getElementById("se-p").value)||null;if(!n)return;await A("PUT","/api/shopping/"+sid,{item:n,quantity:q||null,price:p,folder_id:window._sFold||null});cMo();hp();await load()}
function shAddFolder(){oMC("New Folder",'<input class="inp" id="ff-n" placeholder="Folder name"><input class="inp" id="ff-e" placeholder="📁" value="📁" style="width:80px"><button class="btn" onclick="doAddFolder()">Create</button>')}
async function doAddFolder(){var n=document.getElementById("ff-n").value.trim();var e=document.getElementById("ff-e").value.trim()||"📁";if(!n)return;await A("POST","/api/shopping/folders",{name:n,emoji:e});cMo();hp();await load()}
function edFolder(fid){var f=D.folders.find(function(x){return x.id===fid});if(!f)return;oMC("Edit Folder",'<input class="inp" id="ef-n" value="'+es(f.name)+'"><input class="inp" id="ef-e" value="'+f.emoji+'" style="width:80px"><button class="btn" onclick="svFolder('+fid+')">Save</button><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)"><button class="btn btn-s" style="color:var(--ac);font-size:13px" onclick="dlFolder('+fid+')">Delete Folder</button></div>')}
async function svFolder(fid){var n=document.getElementById("ef-n").value.trim();var e=document.getElementById("ef-e").value.trim();if(!n)return;await A("PUT","/api/shopping/folders/"+fid,{name:n,emoji:e});cMo();hp();await load()}
async function dlFolder(fid){await A("DELETE","/api/shopping/folders/"+fid);cMo();hp();shopFold=null;await load();toast("✓ Folder deleted")}

// ═══════════════════════════════════════════════════════════
// MONEY — Transactions | Subs | Analytics
// ═══════════════════════════════════════════════════════════
function rMoney(){
var h='<div class="tabs"><button class="tab '+(moneyTab==="transactions"?"a":"")+'" onclick="moneyTab=\'transactions\';ren()"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("arrowUpDown",13,2.2)+'Transactions</span></button><button class="tab '+(moneyTab==="analytics"?"a":"")+'" onclick="moneyTab=\'analytics\';ren()"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("chart",13,2.2)+'Analytics</span></button></div>';
if(moneyTab==="analytics")return h+rAnalytics();
return h+rTransactions()}

function rTransactions(){
var txs=D.transactions;if(searchQ)txs=txs.filter(function(x){return matchQ(x.description)});
if(filt)txs=txs.filter(function(x){return x.member_id===filt});
var cats={};D.categories.forEach(function(c){cats[c.id]=c});
// Top: 3 stat tiles (Income / Expense / Balance)
var tInc=0,tExp=0;
D.transactions.forEach(function(tx){if(tx.type==="income")tInc+=(tx.amount_eur||0);else tExp+=(tx.amount_eur||0)});
var bal=tInc-tExp;
var h='<div class="sts sts-3">';
h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("trendUp",16,2.2)+'</div><div class="st-lb">Income</div><div class="st-vl pos">€'+tInc.toFixed(0)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ac">'+icon("trendDown",16,2.2)+'</div><div class="st-lb">Expense</div><div class="st-vl neg">€'+tExp.toFixed(0)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("wallet",16,2.2)+'</div><div class="st-lb">Balance</div><div class="st-vl '+(bal>=0?"pos":"neg")+'">'+(bal>=0?"+":"−")+'€'+Math.abs(bal).toFixed(0)+'</div></div>';
h+='</div>';
if(!txs.length)return h+em(icon("wallet",48,1.8),"No transactions","Tap + to add");
// Member filter row
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';
// Transaction rows as .lc cards: category emoji on tinted gradient (green for income, coral for expense), description as title, date + member as meta, signed amount pill on the right
txs.forEach(function(tx){
  var cat=cats[tx.category_id];
  var isInc=tx.type==="income";
  var sign=isInc?"+":"−";
  var amtPillCls=isInc?"tone-ok":"tone-ac";
  var icoCls=isInc?"acc-ok":"acc-ac";
  var emoji=cat?cat.emoji:(isInc?"💰":"💸");
  var catName=cat?cat.name:(isInc?"Income":"Expense");
  var title=tx.description?es(tx.description):catName;
  var meta=fD(tx.date).full;
  var riCnt=(D.txItems||{})[tx.id]?D.txItems[tx.id].length:0;
  var riBadge=riCnt?' <span class="pdate" style="background:color-mix(in srgb,var(--pr) 14%,transparent);color:var(--pr)">'+icon("receipt",10,2)+riCnt+'</span>':"";
  h+='<div class="lc">';
  h+='<div class="lc-i '+icoCls+'">'+emoji+'</div>';
  h+='<div class="lc-bd"><div class="lc-tt">'+title+'</div><div class="lc-mt">'+(tx.description?catName+' · ':'')+meta+' '+mChip(tx.member_id,true)+riBadge+'</div></div>';
  h+='<span class="lc-rt '+amtPillCls+'">'+sign+tx.amount+' '+tx.currency+'</span>';
  h+='<button class="bi" onclick="openReceipt('+tx.id+')" title="Split receipt" style="margin-left:4px">'+icon("receipt",15,2)+'</button>';
  h+='<button class="bi" onclick="edTx('+tx.id+')">'+I.ed+'</button>';
  h+='<button class="bi" onclick="dlTx('+tx.id+')">'+I.tr+'</button>';
  h+='</div>';
});
return h}

async function dlTx(id){hp();await A("DELETE","/api/transactions/"+id);_moneySummary=null;_anaCache={};await load();toast("🗑 Deleted")}
function edTx(id){var tx=D.transactions.find(function(x){return x.id===id});if(!tx)return;_assign=tx.member_id||0;
var catOpts=D.categories.filter(function(c){return c.type===tx.type}).map(function(c){return '<button class="ob '+(tx.category_id===c.id?"s":"")+'" onclick="window._txCat='+c.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+c.emoji+" "+es(c.name)+'</button>'}).join("");
window._txCat=tx.category_id||0;window._txType=tx.type;
oMC("Edit Transaction",'<div class="dr"><div><div class="dl">Amount</div><input class="inp" id="tx-a" type="number" step="0.01" value="'+tx.amount+'"></div><div><div class="dl">Currency</div><select id="tx-c"><option value="RSD"'+(tx.currency==="RSD"?" selected":"")+'>din. RSD</option><option value="EUR"'+(tx.currency==="EUR"?" selected":"")+'>€ EUR</option><option value="USD"'+(tx.currency==="USD"?" selected":"")+'>$ USD</option><option value="GBP"'+(tx.currency==="GBP"?" selected":"")+'>£ GBP</option><option value="RUB"'+(tx.currency==="RUB"?" selected":"")+'>₽ RUB</option></select></div></div><div class="lb">Description</div><input class="inp" id="tx-d" value="'+es(tx.description||"")+'"><div class="lb">Category</div><div class="or">'+catOpts+'</div><div class="lb">Date</div><input type="date" id="tx-dt" value="'+tx.date+'"><div class="lb">Who</div>'+assignPk("txm",tx.member_id)+'<button class="btn" onclick="svTx('+id+')">Save</button>')}
async function svTx(id){var a=parseFloat(document.getElementById("tx-a").value);var c=document.getElementById("tx-c").value;var d=document.getElementById("tx-d").value.trim();var dt=document.getElementById("tx-dt").value;if(!a)return;await A("PUT","/api/transactions/"+id,{amount:a,currency:c,description:d,date:dt,category_id:window._txCat||null,member_id:_assign||null});cMo();hp();_moneySummary=null;_anaCache={};await load()}

// ─── Digest config modal ─────────────────────────────────────
var DIGEST_SECS=[
{id:"greeting",emoji:"☀️",name:"Greeting",color:"var(--wn)"},
{id:"weather",emoji:"🌤",name:"Weather Forecast",color:"#5bc0de"},
{id:"tasks_today",emoji:"📋",name:"Tasks Today",color:"var(--pr)"},
{id:"tasks_tomorrow",emoji:"📋",name:"Tasks Tomorrow",color:"var(--ok)"},
{id:"events",emoji:"📅",name:"Upcoming Events",color:"var(--ok)"},
{id:"subs",emoji:"💳",name:"Subscriptions",color:"var(--pr)"},
{id:"birthdays",emoji:"🎂",name:"Birthdays",color:"var(--wn)"},
{id:"word_of_day",emoji:"📚",name:"Word of the Day (RU/EN)",color:"#a78bfa"},
{id:"tip",emoji:"💡",name:"Tip of the Day",color:"var(--ht)"}
];
var _dgOrder=null;

function _getDigestOrder(){
if(_dgOrder)return _dgOrder;
var saved=null;
try{saved=JSON.parse(D.settings.digest_sections||"null")}catch(e){}
// Each entry is {id: string, enabled: bool}. Backward compat: legacy format was bare strings.
var known={};DIGEST_SECS.forEach(function(s){known[s.id]=true});
if(saved&&Array.isArray(saved)){
  _dgOrder=saved
    .map(function(s){
      // Normalize: string → enabled by default; dict → preserve enabled
      if(typeof s==="string")return{id:s,enabled:true};
      return{id:s.id,enabled:s.enabled!==false};
    })
    .filter(function(o){return known[o.id]});
  // Auto-append any new sections (introduced after user last saved) at the end, enabled
  var present={};_dgOrder.forEach(function(o){present[o.id]=true});
  DIGEST_SECS.forEach(function(s){if(!present[s.id])_dgOrder.push({id:s.id,enabled:true})});
}
if(!_dgOrder||!_dgOrder.length)_dgOrder=DIGEST_SECS.map(function(s){return{id:s.id,enabled:true}});
return _dgOrder}

function openDigestCfg(){
// Deep copy so toggling/reordering inside the modal doesn't mutate the cached order before Save
_dgOrder=_getDigestOrder().map(function(o){return{id:o.id,enabled:o.enabled}});
oMC("📨 Morning Digest",digestCfgHtml())}

function digestCfgHtml(){
var h='<div class="lb">Delivery Time</div><input type="time" id="dg-time" value="'+(D.settings.digest_time||"09:00")+'" step="60" style="margin-bottom:16px">';
h+='<div class="lb">Sections · tap toggle to disable</div>';
h+='<div id="dg-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">';
_dgOrder.forEach(function(entry,idx){
var sec=DIGEST_SECS.find(function(s){return s.id===entry.id});
if(!sec)return;
var en=entry.enabled!==false;
h+='<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--cd);border-radius:10px;border-left:3px solid '+sec.color+';opacity:'+(en?'1':'.45')+';transition:opacity .15s">';
h+='<span style="font-size:18px">'+sec.emoji+'</span>';
h+='<span style="flex:1;font-weight:500">'+sec.name+'</span>';
h+='<div class="tgs'+(en?' on':'')+'" onclick="dgToggle('+idx+')"><span class="tgs-knob"></span></div>';
if(idx>0)h+='<button class="bi" onclick="dgMove('+idx+',-1)" style="font-size:14px">▲</button>';
if(idx<_dgOrder.length-1)h+='<button class="bi" onclick="dgMove('+idx+',1)" style="font-size:14px">▼</button>';
h+='</div>'});
h+='</div>';
h+='<div class="lb">Test Send</div>';
h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
D.members.forEach(function(m){
h+='<button class="btn btn-s" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px" onclick="dgTest('+m.user_id+')">'+mAv(m.user_id,18)+es(m.user_name)+'</button>'});
h+='</div>';
h+='<button class="btn" onclick="dgSave()">Save</button>';
return h}

function dgMove(idx,dir){
var tmp=_dgOrder[idx];_dgOrder[idx]=_dgOrder[idx+dir];_dgOrder[idx+dir]=tmp;
document.getElementById("mb").innerHTML=digestCfgHtml()}

function dgToggle(idx){
_dgOrder[idx].enabled=!(_dgOrder[idx].enabled!==false);
hp("light");
document.getElementById("mb").innerHTML=digestCfgHtml()}

async function dgTest(uid){
var btn=event.target;btn.textContent="Sending...";btn.disabled=true;
// Save first
var tm=document.getElementById("dg-time").value;
await A("PATCH","/api/settings",{digest_time:tm,digest_sections:JSON.stringify(_dgOrder)});
D.settings.digest_time=tm;D.settings.digest_sections=JSON.stringify(_dgOrder);
await A("POST","/api/digest/test");
btn.textContent="Sent!";setTimeout(function(){openDigestCfg()},1000)}

async function dgSave(){
var tm=document.getElementById("dg-time").value;
await A("PATCH","/api/settings",{digest_time:tm,digest_sections:JSON.stringify(_dgOrder)});
D.settings.digest_time=tm;D.settings.digest_sections=JSON.stringify(_dgOrder);
cMo();toast("Digest saved");ren()}

// ─── Receipt / Split items ──────────────────────────────────
function openReceipt(txId){
var tx=D.transactions.find(function(x){return x.id===txId});if(!tx)return;
var sign=tx.type==="income"?"+":"−";
var title="📋 "+(tx.description?es(tx.description):"Receipt")+" — "+sign+tx.amount+" "+tx.currency;
oMC(title,receiptHtml(txId,tx))}

function _curSel(id,def){var curs=[["RSD","din."],["EUR","€"],["USD","$"],["GBP","£"],["RUB","₽"]];
var h='<select id="'+id+'" style="padding:10px 8px;background:var(--sf);color:var(--tx);border:1px solid var(--bd);border-radius:10px;font-size:14px;min-width:64px;height:44px">';
curs.forEach(function(c){h+='<option value="'+c[0]+'"'+(c[0]===def?' selected':'')+'>'+c[1]+'</option>'});
return h+'</select>'}

function receiptHtml(txId,tx){
var items=(D.txItems||{})[txId]||[];
var h='';
// Allocation progress
var alloc=0;items.forEach(function(it){alloc+=(it.quantity||1)*(parseFloat(it.amount)||0)});
var rem=tx.amount-alloc;var pct=tx.amount>0?Math.min(100,Math.round(alloc/tx.amount*100)):0;
var full=rem<=0&&items.length>0;
h+='<div style="margin-bottom:16px">';
h+='<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">';
h+='<span style="color:var(--ht)">Allocated: '+alloc.toFixed(0)+' '+tx.currency+'</span>';
h+='<span style="color:'+(full?'var(--ok)':'var(--wn)')+';font-weight:600">'+(full?'✓ Fully split':'Left: '+rem.toFixed(0)+' '+tx.currency)+'</span></div>';
h+='<div style="height:4px;background:var(--bd);border-radius:2px;overflow:hidden">';
h+='<div style="height:100%;width:'+pct+'%;background:'+(full?'var(--ok)':'var(--pr)')+';border-radius:2px;transition:width .3s"></div></div></div>';
// Item list (scrollable)
if(!items.length)h+='<div style="text-align:center;padding:20px 0;color:var(--ht);font-size:13px">No items yet. Break down this receipt.</div>';
else{h+='<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;padding-right:4px">';
items.forEach(function(it){
var qty=it.quantity||1;var qtyStr=qty>1?' x'+qty:'';var lineTotal=qty*parseFloat(it.amount||0);
h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--cd);border-radius:10px">';
h+='<span style="flex:1;font-size:14px">'+es(it.name)+qtyStr+'</span>';
h+='<span style="font-size:13px;color:var(--pr);font-weight:600;white-space:nowrap">'+lineTotal.toFixed(0)+' '+(it.currency||tx.currency)+'</span>';
h+='<button class="bi" style="padding:2px" onclick="edRi('+it.id+','+txId+')">'+I.ed+'</button>';
h+='<button class="bi" style="padding:2px" onclick="dRi('+it.id+','+txId+')">'+I.x+'</button>';
h+='</div>'});h+='</div>'}
// Add form — 3 rows: Name, Qty+Price+Currency, Add
h+='<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">';
h+='<input class="inp" id="ri-name" placeholder="Item name" onkeydown="if(event.key===\'Enter\')document.getElementById(\'ri-qty\').focus()">';
h+='<div class="dr"><div><div class="dl">Quantity</div><input class="inp" id="ri-qty" type="number" min="1" value="1" placeholder="1"></div><div><div class="dl">Price</div><input class="inp" id="ri-amt" type="number" step="0.01" placeholder="0.00" onkeydown="if(event.key===\'Enter\')addRi('+txId+')"></div><div><div class="dl">Currency</div>'+_curSel("ri-cur",tx.currency)+'</div></div>';
h+='<button class="btn" onclick="addRi('+txId+')">Add</button>';
h+='</div>';
return h}

async function addRi(txId){var n=document.getElementById("ri-name");if(!n||!n.value.trim())return;
var qty=parseInt(document.getElementById("ri-qty").value)||1;
var amt=parseFloat(document.getElementById("ri-amt").value)||0;
var cur=document.getElementById("ri-cur").value;
await A("POST","/api/transactions/"+txId+"/items",{name:n.value.trim(),quantity:qty,amount:amt,currency:cur});
await load();openReceipt(txId)}

async function dRi(iid,txId){await A("DELETE","/api/transactions/items/"+iid);await load();openReceipt(txId)}

function edRi(iid,txId){
var items=(D.txItems||{})[txId]||[];
var it=items.find(function(x){return x.id===iid});if(!it)return;
var tx=D.transactions.find(function(x){return x.id===txId});
oMC("Edit Item",'<div class="dl">Item name</div><input class="inp" id="ei-name" value="'+es(it.name)+'"><div class="dr"><div><div class="dl">Quantity</div><input class="inp" id="ei-qty" type="number" min="1" value="'+(it.quantity||1)+'"></div><div><div class="dl">Price</div><input class="inp" id="ei-amt" type="number" step="0.01" value="'+it.amount+'"></div><div><div class="dl">Currency</div>'+_curSel("ei-cur",it.currency||(tx?tx.currency:"RSD"))+'</div></div><button class="btn" onclick="svRi('+iid+','+txId+')">Save</button>')}

async function svRi(iid,txId){var n=document.getElementById("ei-name").value.trim();
var q=parseInt(document.getElementById("ei-qty").value)||1;
var a=parseFloat(document.getElementById("ei-amt").value)||0;var c=document.getElementById("ei-cur").value;
if(!n)return;await A("PUT","/api/transactions/items/"+iid,{name:n,quantity:q,amount:a,currency:c});
cMo();await load();openReceipt(txId)}

// Subs (moved from Calendar)
function rSubAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoSub()">+ Add Subscription</button>'}
function oMoSub(){_assign=0;_subRems=[{days_before:3,time:"09:00"},{days_before:0,time:"09:00"}];oMC("Add Subscription",'<input class="inp" id="su-n" placeholder="Subscription name"><input class="inp" id="su-e" value="💳" style="width:80px"><div class="dr"><div><div class="dl">Amount</div><input class="inp" id="su-a" type="number" step="0.01" placeholder="9.99"></div><div><div class="dl">Currency</div><select id="su-c"><option value="EUR">€</option><option value="USD">$</option><option value="GBP">£</option><option value="RUB">₽</option><option value="RSD">din.</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="1"></div></div><div class="lb">Assigned to</div>'+assignPk("sap",null)+'<div class="lb">Reminders</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="doNewSub()">Add Subscription</button>')}
function rSubsList(){
if(!D.subs.length)return em("💳","No subscriptions","Add below")+rSubAddBtn();
var items=D.subs;if(searchQ)items=items.filter(function(s){return matchQ(s.name)});
var totalEur=0;items.forEach(function(s){totalEur+=(s.amount_eur||0)});
var h=rSubAddBtn()+'<div class="c" style="border-left:3px solid var(--wn)"><div class="bd"><div class="tt" style="font-weight:700">Monthly total</div><div class="mt" style="font-size:16px;color:var(--wn);font-weight:800">€'+totalEur.toFixed(2)+'</div></div></div>';
h+='<div class="fb2"><button class="fi '+(filt===null?"a":"")+'" onclick="filt=null;ren()">All</button>';D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';
if(filt)items=items.filter(function(s){return s.assigned_to===filt});
items.forEach(function(s){var daysTxt=s.days_until===0?"Today":s.days_until===1?"Tomorrow":"in "+s.days_until+"d";
var tone=s.days_until===0?"tone-ac":s.days_until<=2?"tone-wn":"";
var amountTxt=s.amount+" "+s.currency+(s.currency!=="EUR"?" · €"+(s.amount_eur||0).toFixed(2):"");
h+='<div class="lc"><div class="lc-i">'+s.emoji+'</div><div class="lc-bd"><div class="lc-tt">'+es(s.name)+'</div><div class="lc-mt">Day '+s.billing_day+' · '+amountTxt+'</div></div><span class="lc-rt '+tone+'">'+daysTxt+'</span><button class="bi" onclick="edSub('+s.id+')" style="margin-left:4px">'+I.ed+'</button><button class="bi" onclick="dlSub('+s.id+')">'+I.tr+'</button></div>'});return h}
async function dlSub(id){hp();await A("DELETE","/api/subscriptions/"+id);await load();toast("🗑 Deleted")}
function edSub(id){var s=D.subs.find(function(x){return x.id===id});if(!s)return;_assign=s.assigned_to||0;_subRems=(s.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});oMC("Edit Subscription",'<input class="inp" id="su-n" value="'+es(s.name)+'"><input class="inp" id="su-e" value="'+s.emoji+'" style="width:80px"><div class="dr"><div><div class="dl">Amount</div><input class="inp" id="su-a" type="number" step="0.01" value="'+s.amount+'"></div><div><div class="dl">Currency</div><select id="su-c" style="width:100%"><option value="EUR"'+(s.currency==="EUR"?" selected":"")+'>€</option><option value="USD"'+(s.currency==="USD"?" selected":"")+'>$</option><option value="GBP"'+(s.currency==="GBP"?" selected":"")+'>£</option><option value="RUB"'+(s.currency==="RUB"?" selected":"")+'>₽</option><option value="RSD"'+(s.currency==="RSD"?" selected":"")+'>din.</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="'+s.billing_day+'"></div></div><div class="lb">Assigned to</div>'+assignPk("sap",s.assigned_to)+'<div class="lb">Reminders</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="svSub('+id+')">Save</button>')}
async function svSub(id){var n=document.getElementById("su-n").value.trim();var e=document.getElementById("su-e").value.trim();var a=parseFloat(document.getElementById("su-a").value);var c=document.getElementById("su-c").value;var d=parseInt(document.getElementById("su-d").value)||1;if(!n||!a)return;await A("PUT","/api/subscriptions/"+id,{name:n,emoji:e,amount:a,currency:c,billing_day:d,assigned_to:_assign||null,reminders:_subRems});cMo();hp();await load()}

// Analytics
var _moneySummary=null,_anaMonth=null,_anaCache={};
function _anaShift(delta){
  var cur=_anaMonth||_curYM();
  var y=parseInt(cur.slice(0,4),10),m=parseInt(cur.slice(5,7),10)+delta;
  while(m<=0){m+=12;y--}while(m>12){m-=12;y++}
  var next=y+"-"+String(m).padStart(2,"0");
  // Block going beyond current month
  if(next>_curYM())return;
  _anaMonth=(next===_curYM())?null:next;
  hp("sel");
  if(_anaCache[next]){_moneySummary=_anaCache[next];ren()}
  else{_moneySummary=null;loadMoneySummary()}
}
function _curYM(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
async function loadMoneySummary(){
  var q=_anaMonth?("?month="+_anaMonth):"";
  var s=await A("GET","/api/money/summary"+q);
  _moneySummary=s;_anaCache[s.month]=s;
  ren()
}
function rAnalytics(){
if(!_moneySummary){loadMoneySummary();return '<div class="emp"><div class="emp-i" style="font-size:32px">⏳</div><div>Loading...</div></div>'}
var s=_moneySummary;
var monthLabel=s.month?new Date(s.month+"-01T00:00:00").toLocaleString("en-US",{month:"long",year:"numeric"}):"";
var fwdDis=s.is_current?' style="opacity:.3;pointer-events:none"':"";
// Month nav (←  Month YYYY  →)
var h='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;padding:0 4px"><button class="bi" onclick="_anaShift(-1)" style="padding:6px 10px;font-size:16px">◀</button><div style="font-weight:700;font-size:16px;letter-spacing:-.2px">'+monthLabel+'</div><button class="bi" onclick="_anaShift(1)"'+fwdDis+' style="padding:6px 10px;font-size:16px">▶</button></div>';
// 3 stat tiles for the selected month
h+='<div class="sts sts-3">';
h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("trendUp",16,2.2)+'</div><div class="st-lb">Income</div><div class="st-vl pos">€'+s.income.toFixed(0)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ac">'+icon("trendDown",16,2.2)+'</div><div class="st-lb">Expense</div><div class="st-vl neg">€'+s.expense.toFixed(0)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("wallet",16,2.2)+'</div><div class="st-lb">Balance</div><div class="st-vl '+(s.balance>=0?"pos":"neg")+'">'+(s.balance>=0?"+":"−")+'€'+Math.abs(s.balance).toFixed(0)+'</div></div>';
h+='</div>';
// Optional Subs row as a single full-width tile
if(s.subs_eur)h+='<div class="cat-row" style="margin-bottom:14px"><div class="cat-row-h"><span class="nm">'+icon("card",14,2.2)+' Subscriptions this month</span><span class="vl" style="color:var(--pr)">€'+s.subs_eur.toFixed(0)+'</span></div></div>';
// Monthly chart (bars)
if(s.months&&s.months.length){
var maxM=1;s.months.forEach(function(m){maxM=Math.max(maxM,m.income,m.expense)});
h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("chart",12,2.4)+'</span>Last 6 Months</span></div>';
h+='<div class="chart-bars">';
s.months.forEach(function(m){var ih=Math.max(3,m.income/maxM*74);var eh=Math.max(3,m.expense/maxM*74);
h+='<div class="cbar"><div class="cbar-pair"><div class="cbar-b b-in" style="height:'+ih+'px"></div><div class="cbar-b b-ex" style="height:'+eh+'px"></div></div><div class="cbar-lb">'+m.month.split("-")[1]+'</div></div>'});
h+='</div>';
h+='<div class="chart-legend"><span><span class="dotk" style="background:var(--ok)"></span>Income</span><span><span class="dotk" style="background:var(--ac)"></span>Expense</span></div>'}
// By category — polished progress rows
if(s.by_category&&s.by_category.length){var maxC=s.by_category[0]?s.by_category[0].total:1;
h+='<div class="sc"><span class="sc-l">By Category</span></div>';
s.by_category.forEach(function(c){if(!c.total)return;var pct=Math.max(2,c.total/maxC*100);
h+='<div class="cat-row"><div class="cat-row-h"><span class="nm"><span class="em">'+c.emoji+'</span>'+es(c.name)+'</span><span class="vl">€'+c.total.toFixed(0)+'</span></div><div class="progress"><div class="progress-fill" style="width:'+pct+'%"></div></div></div>'})}
// Limits
if(s.limits&&s.limits.length){h+='<div class="sc" style="margin-top:12px"><span class="sc-l">Limits</span></div>';
s.limits.forEach(function(l){var pct=Math.min(100,l.spent/l.monthly_limit*100);var over=l.spent>l.monthly_limit;
h+='<div class="cat-row"><div class="cat-row-h"><span class="nm"><span class="em">'+l.emoji+'</span>'+es(l.name)+'</span><span class="vl" style="color:'+(over?"var(--ac)":"var(--tx)")+'">€'+l.spent.toFixed(0)+' / €'+l.monthly_limit.toFixed(0)+'</span></div><div class="progress"><div class="progress-fill '+(over?"tone-ac":"tone-ok")+'" style="width:'+pct+'%"></div></div></div>'})}
h+='<button class="btn btn-s" style="margin-top:14px" onclick="_anaCache={};_moneySummary=null;loadMoneySummary()">'+icon("refresh",13,2.2)+' Refresh Analytics</button>';
return h}

// ═══════════════════════════════════════════════════════════
// TRAININGS — workouts, exercises, sets, tonnage
// ═══════════════════════════════════════════════════════════
function _trainMyId(){return fS&&fS.my_id?fS.my_id:0}
function _trainScopeMember(){return _trainMember===null?_trainMyId():_trainMember} // null = "Family", else specific member

function rTrain(){
var myId=_trainMyId();
// Default to "my" view on first load (until user toggles)
if(_trainMember===undefined)_trainMember=myId;
var h='';
// Member switcher pills: Yaroslav | Ella | Family
h+='<div class="fb2">';
D.members.forEach(function(m){
  h+='<button class="fi '+(_trainMember===m.user_id?"a":"")+'" style="display:inline-flex;align-items:center;gap:5px" onclick="setTrainMember('+m.user_id+')">'+mAv(m.user_id,18)+es(m.user_name)+'</button>';
});
h+='<button class="fi '+(_trainMember===null?"a":"")+'" onclick="setTrainMember(null)" style="display:inline-flex;align-items:center;gap:5px">'+icon("user",14,2.2)+'Family</button>';
h+='</div>';

// Family compare view: 2 columns showing each member's week
if(_trainMember===null){
  h+=rTrainFamily();
  setTimeout(function(){loadTrainStatsAll()},0);
  return h;
}

// Per-member view: weekly summary + templates + today's workout + recent
var memberWorkouts=(D.recentWorkouts||[]).filter(function(w){return w.member_id===_trainMember});
var today=td();var weekStart=_weekStartISO();
var tdayT=0,tdaySets=0,wkT=0,wkSets=0,wkCount=0;
memberWorkouts.forEach(function(w){
  if(w.date===today){tdayT+=w.tonnage||0;tdaySets+=w.sets||0}
  if(w.date>=weekStart){wkT+=w.tonnage||0;wkSets+=w.sets||0;wkCount++}
});

// Stats tiles (2 col)
h+='<div class="sts" style="margin-bottom:14px">';
h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("dumbbell",16,2.2)+'</div><div class="st-lb">Today</div><div class="st-vl" style="color:var(--pr)">'+_fmtTon(tdayT)+'</div><div style="font-size:11px;color:var(--ht);margin-top:2px">'+tdaySets+' sets</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("chart",16,2.2)+'</div><div class="st-lb">This Week</div><div class="st-vl pos">'+_fmtTon(wkT)+'</div><div style="font-size:11px;color:var(--ht);margin-top:2px">'+wkCount+' workouts · '+wkSets+' sets</div></div>';
h+='</div>';

// Progress button (outlined gradient)
h+='<button class="btn btn-s" style="margin-bottom:16px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px" onclick="openTrainStats()">'+icon("chart",15,2.2)+'<span>Progress & PRs</span></button>';

// Today's workout (or Start CTA)
var todayW=memberWorkouts.find(function(w){return w.date===today});
if(todayW){
  var inProg=todayW.started_at&&!todayW.finished_at;
  h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("calendar",12,2.4)+'</span>Today'+(inProg?'<span class="sc-cnt" style="background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok);text-transform:uppercase;font-size:9px;letter-spacing:.3px;padding:0 7px">in progress</span>':'')+'</span></div>';
  h+=_workoutCard(todayW,true);
}else if(_trainMember===myId){
  // Start Workout button (uses template picker if templates exist)
  if((D.workoutTemplates||[]).length>0){
    h+='<button class="btn" style="margin-bottom:8px;display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%" onclick="openStartWorkoutPicker()"><span style="font-size:16px;line-height:1">▶</span><span>Start Workout</span></button>';
    h+='<button class="btn btn-s" style="margin-bottom:18px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px" onclick="startBlankWorkout()">'+icon("pl",14,2.5)+'<span>Empty workout</span></button>';
  }else{
    h+='<button class="btn" style="margin-bottom:8px;display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%" onclick="startBlankWorkout()"><span style="font-size:16px;line-height:1">▶</span><span>Start Empty Workout</span></button>';
    h+='<div style="font-size:12px;color:var(--ht);margin-bottom:16px;text-align:center">Or create a template below to reuse a program</div>';
  }
}

// Templates section
if(_trainMember===myId){
  var myTpls=(D.workoutTemplates||[]).filter(function(t){return!t.member_id||t.member_id===myId});
  h+='<div class="sc" style="display:flex;justify-content:space-between;align-items:center"><span class="sc-l"><span class="sc-ico">'+icon("list",12,2.4)+'</span>My Templates<span class="sc-cnt">'+myTpls.length+'</span></span><button class="at" onclick="openNewTemplate()">+ New</button></div>';
  if(myTpls.length===0){
    h+='<div style="font-size:12px;color:var(--ht);padding:12px 14px;border:1.5px dashed var(--bd);border-radius:14px;margin-bottom:14px;text-align:center">No templates yet · tap + New to create your first program</div>';
  }else{
    myTpls.forEach(function(t){h+=_templateCard(t)});
  }
}

// Recent workouts (excluding today)
var others=memberWorkouts.filter(function(w){return w.date!==today});
if(others.length){
  h+='<div class="sc" style="margin-top:14px"><span class="sc-l"><span class="sc-ico">'+icon("clock",12,2.4)+'</span>Recent<span class="sc-cnt">'+others.length+'</span></span></div>';
  others.forEach(function(w){h+=_workoutCard(w,false)});
}
return h
}

function _templateCard(t){
  var exs=t.exercises_list||[];
  var preview=exs.slice(0,3).map(function(e){return (e.emoji||"")+" "+es(e.name)}).join(" · ");
  if(exs.length>3)preview+=" · +"+(exs.length-3);
  return '<div class="lc" style="cursor:pointer" onclick="startFromTemplate('+t.id+')">'+
    '<div class="lc-i acc-pr">'+icon("list",20,2.2)+'</div>'+
    '<div class="lc-bd"><div class="lc-tt">'+es(t.name)+'</div>'+
    (preview?'<div class="lc-mt">'+preview+'</div>':'<div class="lc-mt" style="font-style:italic">No exercises yet</div>')+
    '</div>'+
    '<span class="lc-rt" style="background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok);font-weight:700"><span style="font-size:11px;margin-right:3px">▶</span>Start</span>'+
    '<button class="bi" onclick="event.stopPropagation();editTemplate('+t.id+')" style="margin-left:4px">'+I.ed+'</button>'+
    '</div>';
}

function _fmtTon(t){
  // 1234 → "1,234 kg" ; 12345 → "12.3K kg"
  if(t>=10000)return (t/1000).toFixed(1)+'K kg';
  return Math.round(t).toLocaleString()+' kg';
}
function _weekStartISO(){var d=new Date();var dow=d.getDay();var off=(dow===0)?-6:1-dow;d.setDate(d.getDate()+off);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function setTrainMember(uid){_trainMember=uid;_trainStats=null;hp("sel");ren()}

function _workoutCard(w,emphasized){
  var dateLbl=w.date===td()?"Today":fD(w.date).full;
  var nameTxt=w.name?es(w.name):"Workout";
  var acc=emphasized?"acc-pr":"";
  var extraStyle=emphasized?'style="border-color:color-mix(in srgb,var(--pr) 40%,var(--bd));box-shadow:0 4px 18px color-mix(in srgb,var(--pr) 16%,transparent),var(--shadow-1)"':"";
  return '<div class="lc lc-tap" '+extraStyle+' onclick="openWorkout('+w.id+')">'+
    '<div class="lc-i '+(acc||"acc-pr")+'">'+icon("dumbbell",20,2.2)+'</div>'+
    '<div class="lc-bd"><div class="lc-tt">'+nameTxt+'</div>'+
    '<div class="lc-mt">'+dateLbl+' · <span style="color:var(--ok);font-weight:700">'+_fmtTon(w.tonnage)+'</span> · '+(w.exercises||0)+' ex · '+(w.sets||0)+' sets</div></div>'+
    '<span class="lc-chev">›</span>'+
    '</div>';
}

// Family compare view — 2 columns of weekly stats
function rTrainFamily(){
  var weekStart=_weekStartISO();var today=td();
  var h='<div class="sc">This Week</div>';
  h+='<div class="dr" style="margin-bottom:14px;gap:8px">';
  D.members.forEach(function(m){
    var ws=(D.recentWorkouts||[]).filter(function(w){return w.member_id===m.user_id&&w.date>=weekStart});
    var ton=ws.reduce(function(a,w){return a+(w.tonnage||0)},0);
    var setsN=ws.reduce(function(a,w){return a+(w.sets||0)},0);
    var clr=m.color||"var(--pr)";
    h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid '+clr+'">'+
      '<div class="bd" style="text-align:center">'+
      '<div style="margin-bottom:8px">'+mAv(m.user_id,40)+'</div>'+
      '<div style="font-weight:700;margin-bottom:4px">'+es(m.user_name)+'</div>'+
      '<div style="font-size:18px;font-weight:800;color:'+clr+'">'+_fmtTon(ton)+'</div>'+
      '<div style="font-size:11px;color:var(--ht);margin-top:2px">'+ws.length+' workouts · '+setsN+' sets</div>'+
      '</div></div>';
  });
  h+='</div>';
  // Recent workouts from both — combined timeline
  var all=(D.recentWorkouts||[]).slice().sort(function(a,b){return b.date.localeCompare(a.date)||b.id-a.id});
  if(all.length){
    h+='<div class="sc">Recent (everyone)</div>';
    all.forEach(function(w){
      var m=D.members.find(function(x){return x.user_id===w.member_id});
      var nameTxt=w.name?es(w.name):"<i>Workout</i>";
      var dateLbl=w.date===today?"Today":fD(w.date).full;
      h+='<div class="c" style="cursor:pointer" onclick="openWorkout('+w.id+')">'+
        (m?mAv(m.user_id,28):'')+
        '<div class="bd">'+
        '<div class="tt" style="font-weight:600">'+nameTxt+'</div>'+
        '<div class="mt"><span style="color:var(--ht)">'+dateLbl+'</span> · <span style="color:var(--ok);font-weight:600">'+_fmtTon(w.tonnage)+'</span> · '+(w.sets||0)+' sets</div>'+
        '</div></div>';
    });
  }
  return h;
}

async function loadTrainStatsAll(){
  // Family view doesn't need detailed stats; recent_workouts in bundle covers it
}

// Start a new workout for today (current member)
async function startTodayWorkout(){
  var name=prompt("Workout name (optional, e.g. 'Push Day'):","");
  var r=await A("POST","/api/workouts",{date:td(),name:name||null,member_id:_trainMember});
  if(!r||!r.id)return;
  hp("ok");await load();openWorkout(r.id)
}

// Open a workout for editing — full-screen overlay similar to calendar day view
async function openWorkout(wid){
  var w=await A("GET","/api/workouts/"+wid);if(!w)return;
  _curWorkout=w;hp("sel");
  var html=_workoutDetailHtml(w);
  var el=document.getElementById("workout-view");
  if(el){el.remove()}
  el=document.createElement("div");el.id="workout-view";el.innerHTML=html;
  document.body.appendChild(el);
  if(w.started_at&&!w.finished_at)_startWkTimer(w.started_at);
}
function closeWorkout(){var el=document.getElementById("workout-view");if(el)el.remove();_curWorkout=null;_clearRestTimer();_stopWkTimer();load()}

// Re-render the open workout (used after add/delete set)
async function _refreshWorkoutView(wid){
  var w=await A("GET","/api/workouts/"+wid);if(!w)return;
  _curWorkout=w;
  var view=document.getElementById("workout-view");if(!view)return;
  view.innerHTML=_workoutDetailHtml(w);
  if(w.started_at&&!w.finished_at)_startWkTimer(w.started_at);else _stopWkTimer();
}

// Start an ad-hoc workout (no template)
async function startBlankWorkout(){
  var name=prompt("Workout name (optional):","");
  var r=await A("POST","/api/workouts",{date:td(),name:name||null,member_id:_trainMember});
  if(!r||!r.id)return;
  // Mark as started
  await A("POST","/api/workouts/"+r.id+"/start");
  hp("ok");await load();openWorkout(r.id);
}
// Backwards compat: old callers
function startTodayWorkout(){startBlankWorkout()}

// Pick a template to start a workout from
function openStartWorkoutPicker(){
  var myId=_trainMyId();
  var tpls=(D.workoutTemplates||[]).filter(function(t){return!t.member_id||t.member_id===myId});
  var h='<div style="margin-bottom:8px;font-size:13px;color:var(--ht)">Pick a program to start:</div>';
  if(!tpls.length){
    h+='<div style="padding:20px;text-align:center;color:var(--ht);font-size:13px">No templates yet</div>';
  }else{
    tpls.forEach(function(t){
      var preview=(t.exercises_list||[]).slice(0,4).map(function(e){return (e.emoji||"💪")+" "+es(e.name)}).join(" · ");
      if((t.exercises_list||[]).length>4)preview+=" · +"+((t.exercises_list||[]).length-4);
      h+='<div class="c" style="cursor:pointer" onclick="cMo();startFromTemplate('+t.id+')">'+
        '<div class="bd"><div class="tt" style="font-weight:700">📋 '+es(t.name)+'</div>'+
        (preview?'<div class="mt" style="font-size:11px">'+preview+'</div>':'')+
        '</div><span class="btn btn-s" style="padding:4px 12px;width:auto">▶</span></div>';
    });
  }
  h+='<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">'+
    '<button class="btn btn-s" style="background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="cMo();startBlankWorkout()">+ Empty workout (no template)</button></div>';
  oMC("Start Workout",h);
}

async function startFromTemplate(tid){
  var r=await A("POST","/api/workout-templates/"+tid+"/start");
  if(!r||!r.id)return;
  hp("ok");await load();openWorkout(r.id);
}

async function startThisWorkout(wid){
  await A("POST","/api/workouts/"+wid+"/start");hp("ok");
  _refreshWorkoutView(wid);
}

async function finishWorkout(wid){
  var r=await A("POST","/api/workouts/"+wid+"/finish");
  if(!r)return;
  hp("ok");_stopWkTimer();_clearRestTimer();
  toast("✓ Workout done · "+r.sets+" sets · "+_fmtTon(r.tonnage||0));
  await load();
  // Refresh detail view to show finished state
  _refreshWorkoutView(wid);
}

async function reopenWorkout(wid){
  toast("Workout finished. Start a new one for next session.");
}

// ─── Workout templates editor ───────────────────────────────────────────
var _tplDraft=null; // {id?, name, exercise_ids: []}

function openNewTemplate(){
  _tplDraft={id:null,name:"",exercise_ids:[]};
  oMC("New Template",_tplEditorHtml());
}
function editTemplate(tid){
  var t=(D.workoutTemplates||[]).find(function(x){return x.id===tid});
  if(!t)return;
  _tplDraft={id:tid,name:t.name,exercise_ids:(t.exercises_list||[]).map(function(e){return e.exercise_id})};
  oMC("Edit Template",_tplEditorHtml());
}
function _tplEditorHtml(){
  var t=_tplDraft;
  var h='<div class="lb">Name</div><input class="inp" id="tpl-n" value="'+es(t.name||"")+'" placeholder="e.g. Push Day">';
  h+='<div class="lb" style="margin-top:14px">Exercises · '+t.exercise_ids.length+'</div>';
  h+='<div id="tpl-ex-list" style="margin-bottom:10px">';
  if(!t.exercise_ids.length){
    h+='<div style="font-size:12px;color:var(--ht);padding:10px;text-align:center;border:1.5px dashed var(--bd);border-radius:10px">No exercises yet</div>';
  }else{
    t.exercise_ids.forEach(function(eid,i){
      var e=(D.exercises||[]).find(function(x){return x.id===eid});
      if(!e)return;
      h+='<div class="c" style="padding:10px 12px;margin-bottom:4px">'+
        '<span style="font-size:20px">'+(e.emoji||"💪")+'</span>'+
        '<div class="bd"><div class="tt">'+es(e.name)+'</div></div>'+
        (i>0?'<button class="bi" onclick="_tplMove('+i+',-1)">▲</button>':'')+
        (i<t.exercise_ids.length-1?'<button class="bi" onclick="_tplMove('+i+',1)">▼</button>':'')+
        '<button class="bi" onclick="_tplRemove('+i+')" style="color:var(--ac)">'+I.x+'</button>'+
        '</div>';
    });
  }
  h+='</div>';
  h+='<button class="btn btn-s" style="background:transparent;border:1.5px solid var(--bd);color:var(--tx);margin-bottom:14px" onclick="_tplPickExercise()">+ Add exercise</button>';
  h+='<button class="btn" onclick="saveTemplate()">'+(t.id?"Save":"Create template")+'</button>';
  if(t.id){
    h+='<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">'+
      '<button class="btn btn-s" style="color:var(--ac);background:transparent;border:1.5px solid var(--bd)" onclick="deleteTemplate('+t.id+')">Delete template</button></div>';
  }
  return h;
}
function _tplRefresh(){document.getElementById("mb").innerHTML=_tplEditorHtml()}
function _tplMove(i,d){var arr=_tplDraft.exercise_ids;var tmp=arr[i];arr[i]=arr[i+d];arr[i+d]=tmp;_tplRefresh()}
function _tplRemove(i){_tplDraft.exercise_ids.splice(i,1);_tplRefresh()}
function _tplPickExercise(){
  // Save name from current input before re-render
  var nameI=document.getElementById("tpl-n");if(nameI)_tplDraft.name=nameI.value;
  // Show picker that adds to draft
  var byGroup={};
  (D.exercises||[]).forEach(function(e){var g=e.muscle_group||"other";if(!byGroup[g])byGroup[g]=[];byGroup[g].push(e)});
  var groupOrder=["chest","back","legs","shoulders","arms","core","other"];
  var h='<input class="inp" id="ex-search" placeholder="Search exercise..." oninput="_filterExercises(this.value)">';
  h+='<div id="ex-list" style="max-height:50vh;overflow-y:auto;margin-top:10px">';
  groupOrder.forEach(function(g){
    if(!byGroup[g])return;
    h+='<div class="ex-grp"><div class="lb" style="margin-top:8px">'+g.toUpperCase()+'</div>';
    byGroup[g].forEach(function(e){
      h+='<div class="c ex-item" data-name="'+es(e.name).toLowerCase()+'" style="cursor:pointer;margin-bottom:4px;padding:10px 12px" onclick="_tplAddEx('+e.id+')">'+
        '<span style="font-size:22px">'+(e.emoji||"💪")+'</span>'+
        '<div class="bd"><div class="tt">'+es(e.name)+'</div></div></div>';
    });
    h+='</div>';
  });
  h+='</div>';
  oMC("Add exercise to template",h);
}
function _tplAddEx(eid){
  _tplDraft.exercise_ids.push(eid);
  // Re-open editor (cMo + new modal)
  oMC(_tplDraft.id?"Edit Template":"New Template",_tplEditorHtml());
}
async function saveTemplate(){
  var nameI=document.getElementById("tpl-n");
  var name=nameI?nameI.value.trim():_tplDraft.name;
  if(!name){toast("Name required");return}
  var body={name:name,member_id:_trainMyId(),exercise_ids:_tplDraft.exercise_ids};
  if(_tplDraft.id){
    await A("PUT","/api/workout-templates/"+_tplDraft.id,body);
  }else{
    await A("POST","/api/workout-templates",body);
  }
  cMo();hp("ok");_tplDraft=null;await load();
}
async function deleteTemplate(tid){
  if(!confirm("Delete template? (Workouts created from it stay intact)"))return;
  await A("DELETE","/api/workout-templates/"+tid);
  cMo();hp("warn");_tplDraft=null;await load();
}

function _workoutDetailHtml(w){
  var memberName=mName(w.member_id);
  var dateLbl=w.date===td()?"Today":fD(w.date).full;
  var inProgress=w.started_at&&!w.finished_at;
  var h='<div class="cday-overlay">';
  h+='<div class="cday-panel" style="padding-bottom:80px">';
  h+='<div class="cday-hd"><button class="cday-back" onclick="closeWorkout()">←</button>'+
    '<div class="cday-title">💪 '+(w.name?es(w.name):"Workout")+'</div>'+
    '<button class="bi" onclick="editWorkoutMeta('+w.id+')" style="padding:4px;color:var(--ht)">'+I.ed+'</button>'+
    '</div>';
  // Live timer (if in progress)
  if(inProgress){
    h+='<div id="wk-timer" style="background:var(--pg);color:var(--pr);padding:8px 16px;text-align:center;font-weight:700;font-size:18px;border-bottom:1px solid var(--bd)">⏱ <span id="wk-elapsed">0:00</span> · in progress</div>';
  }else if(w.finished_at){
    var dur=_durationStr(w.started_at,w.finished_at);
    h+='<div style="background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok);padding:8px 16px;text-align:center;font-weight:700;font-size:14px;border-bottom:1px solid var(--bd)">✓ Completed · '+dur+'</div>';
  }
  // Summary card
  h+='<div style="padding:8px 16px"><div class="c" style="margin-bottom:8px"><div class="bd">'+
    '<div style="font-size:12px;color:var(--ht)">'+dateLbl+' · '+es(memberName)+'</div>'+
    '<div style="font-size:18px;font-weight:800;color:var(--pr);margin-top:4px">'+_fmtTon(w.tonnage||0)+'</div>'+
    '<div style="font-size:11px;color:var(--ht)">'+(w.exercises||0)+' exercises · '+(w.sets||0)+' sets</div>'+
    '</div></div></div>';
  // Exercises list
  h+='<div style="padding:0 16px">';
  (w.exercises_list||[]).forEach(function(wx){h+=_exerciseBlock(wx)});
  h+='<button class="btn btn-s" style="margin-top:8px;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="openExercisePicker('+w.id+')">+ Add exercise</button>';
  // Finish (if in progress) or Re-open
  if(inProgress){
    h+='<button class="btn" style="margin-top:16px;background:var(--ok);color:#fff" onclick="finishWorkout('+w.id+')">✓ Finish Workout</button>';
  }else if(w.finished_at){
    h+='<button class="btn btn-s" style="margin-top:16px;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="reopenWorkout('+w.id+')">↺ Reopen workout</button>';
  }else{
    // Workout exists but not yet started
    h+='<button class="btn" style="margin-top:16px;background:var(--ok);color:#fff" onclick="startThisWorkout('+w.id+')">▶ Start Workout</button>';
  }
  // Delete workout button at bottom
  h+='<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--bd)">'+
    '<button class="btn btn-s" style="color:var(--ac);background:transparent;border:1.5px solid var(--bd)" onclick="deleteWorkout('+w.id+')">Delete workout</button>'+
    '</div>';
  h+='</div>';
  // Rest timer overlay (initially hidden)
  h+='<div id="rest-banner" style="position:fixed;bottom:0;left:0;right:0;background:var(--pr);color:#fff;padding:12px 16px;display:none;align-items:center;justify-content:space-between;font-weight:700;z-index:90;box-shadow:0 -4px 16px rgba(0,0,0,.3)"></div>';
  h+='</div></div>';
  return h;
}

// Live workout timer (counts up from started_at)
function _startWkTimer(startedAtIso){
  _stopWkTimer();
  var t0=new Date(startedAtIso).getTime();
  function tick(){
    var el=document.getElementById("wk-elapsed");if(!el){_stopWkTimer();return}
    var sec=Math.floor((Date.now()-t0)/1000);
    var hh=Math.floor(sec/3600),mm=Math.floor((sec%3600)/60),ss=sec%60;
    el.textContent=(hh>0?hh+":"+String(mm).padStart(2,"0"):mm)+":"+String(ss).padStart(2,"0");
  }
  tick();
  _wkTimer=setInterval(tick,1000);
}
function _stopWkTimer(){if(_wkTimer){clearInterval(_wkTimer);_wkTimer=null}}
function _durationStr(startedAt,finishedAt){
  if(!startedAt||!finishedAt)return "";
  var sec=Math.floor((new Date(finishedAt).getTime()-new Date(startedAt).getTime())/1000);
  if(sec<60)return sec+"s";
  var mm=Math.floor(sec/60);
  if(mm<60)return mm+" min";
  return Math.floor(mm/60)+"h "+(mm%60)+"m";
}

function _exerciseBlock(wx){
  var sets=wx.sets||[];
  var ton=sets.reduce(function(a,s){return a+(s.reps*s.weight)},0);
  var summary='';
  if(sets.length){
    // Group by reps×weight to compact "4×8 @ 80kg" format if all sets equal
    var allSame=sets.every(function(s){return s.reps===sets[0].reps&&s.weight===sets[0].weight});
    if(allSame){summary=sets.length+'×'+sets[0].reps+' @ '+sets[0].weight+'kg'}
    else{summary=sets.length+' sets · '+sets.reduce(function(a,s){return a+s.reps},0)+' reps'}
  }
  var h='<div class="c" style="display:block;padding:12px 14px;margin-bottom:8px">';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
  if(wx.image_url){h+='<img src="'+wx.image_url+'" style="width:40px;height:40px;border-radius:8px;object-fit:cover" onerror="this.style.display=\'none\'">'}
  h+='<span style="font-size:24px">'+(wx.emoji||"💪")+'</span>';
  h+='<div style="flex:1"><div style="font-weight:700">'+es(wx.name)+'</div>';
  if(summary)h+='<div style="font-size:12px;color:var(--ht)">'+summary+(ton?' · <span style="color:var(--ok);font-weight:600">'+_fmtTon(ton)+'</span>':'')+'</div>';
  h+='</div>';
  h+='<button class="bi" onclick="removeExercise('+wx.id+')" style="color:var(--ac)">'+I.tr+'</button>';
  h+='</div>';
  // Sets table
  if(sets.length){
    h+='<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">';
    sets.forEach(function(s){
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:color-mix(in srgb,var(--tx) 5%,transparent);border-radius:8px;font-size:13px">';
      h+='<span style="color:var(--ht);min-width:20px">'+s.set_number+'.</span>';
      h+='<span style="flex:1">'+s.reps+' × '+s.weight+' '+(s.weight_unit||"kg")+'</span>';
      h+='<span style="color:var(--pr);font-weight:600">'+Math.round(s.reps*s.weight)+'</span>';
      h+='<button class="bi" onclick="editSet('+s.id+','+wx.id+','+s.reps+','+s.weight+',\''+(s.weight_unit||"kg")+'\')" style="padding:2px">'+I.ed+'</button>';
      h+='<button class="bi" onclick="deleteSet('+s.id+')" style="padding:2px">'+I.x+'</button>';
      h+='</div>';
    });
    h+='</div>';
  }
  // Add set form (inline) — pre-fill priority: last set in current → last_session (prior workout) → defaults
  var lastReps,lastWeight,prefillHint='';
  if(sets.length){
    lastReps=sets[sets.length-1].reps;lastWeight=sets[sets.length-1].weight;
  }else if(wx.last_session){
    lastReps=wx.last_session.reps;lastWeight=wx.last_session.weight;
    prefillHint='<div style="font-size:10px;color:var(--ht);margin-bottom:4px">Last time ('+(fD(wx.last_session.date).date||"")+'): '+wx.last_session.reps+' × '+wx.last_session.weight+' kg</div>';
  }else{
    lastReps=8;lastWeight=0;
  }
  h+=prefillHint;
  h+='<div style="display:flex;gap:6px;align-items:center">';
  h+='<input class="inp" type="number" min="1" id="set-reps-'+wx.id+'" value="'+lastReps+'" placeholder="reps" style="flex:1;padding:8px;font-size:13px">';
  h+='<span style="color:var(--ht);font-size:11px">×</span>';
  h+='<input class="inp" type="number" step="0.5" id="set-weight-'+wx.id+'" value="'+lastWeight+'" placeholder="kg" style="flex:1;padding:8px;font-size:13px">';
  h+='<button class="btn btn-s" style="padding:8px 14px;width:auto" onclick="addSet('+wx.id+','+(wx.rest_seconds||90)+')">+</button>';
  h+='</div>';
  h+='</div>';
  return h;
}

async function addSet(wxid,restSec){
  var r=parseInt(document.getElementById("set-reps-"+wxid).value)||0;
  var w=parseFloat(document.getElementById("set-weight-"+wxid).value)||0;
  if(r<=0)return;
  await A("POST","/api/workout-exercises/"+wxid+"/sets",{reps:r,weight:w,weight_unit:"kg"});
  hp("ok");
  if(_curWorkout)await _refreshWorkoutView(_curWorkout.id);
  startRestTimer(restSec);
}

async function deleteSet(sid){
  if(!confirm("Delete set?"))return;
  await A("DELETE","/api/workout-sets/"+sid);hp("warn");
  if(_curWorkout)await _refreshWorkoutView(_curWorkout.id);
}

function editSet(sid,wxid,reps,weight,unit){
  oMC("Edit Set",
    '<div class="dr"><div><div class="dl">Reps</div><input class="inp" id="es-r" type="number" min="1" value="'+reps+'"></div>'+
    '<div><div class="dl">Weight</div><input class="inp" id="es-w" type="number" step="0.5" value="'+weight+'"></div></div>'+
    '<button class="btn" onclick="svSet('+sid+')">Save</button>');
}
async function svSet(sid){
  var r=parseInt(document.getElementById("es-r").value)||0;
  var w=parseFloat(document.getElementById("es-w").value)||0;
  if(r<=0)return;
  await A("PUT","/api/workout-sets/"+sid,{reps:r,weight:w});cMo();hp();
  if(_curWorkout)await _refreshWorkoutView(_curWorkout.id);
}

async function removeExercise(wxid){
  if(!confirm("Remove exercise from this workout?"))return;
  await A("DELETE","/api/workout-exercises/"+wxid);hp("warn");
  if(_curWorkout)await _refreshWorkoutView(_curWorkout.id);
}

async function deleteWorkout(wid){
  if(!confirm("Delete entire workout? This removes all exercises and sets."))return;
  await A("DELETE","/api/workouts/"+wid);hp("warn");
  closeWorkout();
}

function editWorkoutMeta(wid){
  var w=_curWorkout;if(!w)return;
  oMC("Edit Workout",
    '<div class="lb">Name</div><input class="inp" id="ew-n" value="'+es(w.name||"")+'" placeholder="e.g. Push Day">'+
    '<div class="lb">Date</div><input type="date" id="ew-d" value="'+w.date+'">'+
    '<div class="lb">Notes</div><input class="inp" id="ew-notes" value="'+es(w.notes||"")+'">'+
    '<button class="btn" onclick="svWorkoutMeta('+wid+')">Save</button>');
}
async function svWorkoutMeta(wid){
  var n=document.getElementById("ew-n").value.trim();
  var d=document.getElementById("ew-d").value;
  var notes=document.getElementById("ew-notes").value.trim();
  await A("PUT","/api/workouts/"+wid,{name:n||null,date:d,notes:notes||null});
  cMo();hp();
  await _refreshWorkoutView(wid);
}

// Exercise picker — choose from catalog or create new
function openExercisePicker(wid){
  var byGroup={};
  (D.exercises||[]).forEach(function(e){var g=e.muscle_group||"other";if(!byGroup[g])byGroup[g]=[];byGroup[g].push(e)});
  var groupOrder=["chest","back","legs","shoulders","arms","core","other"];
  var h='<input class="inp" id="ex-search" placeholder="Search exercise..." oninput="_filterExercises(this.value)">';
  h+='<div id="ex-list" style="max-height:50vh;overflow-y:auto;margin-top:10px">';
  groupOrder.forEach(function(g){
    if(!byGroup[g])return;
    h+='<div class="ex-grp" data-grp="'+g+'"><div class="lb" style="margin-top:8px">'+g.toUpperCase()+'</div>';
    byGroup[g].forEach(function(e){
      h+='<div class="c ex-item" data-name="'+es(e.name).toLowerCase()+'" style="cursor:pointer;margin-bottom:4px;padding:10px 12px" onclick="addExToWorkout('+wid+','+e.id+')">'+
        (e.image_url?'<img src="'+e.image_url+'" style="width:32px;height:32px;border-radius:6px;object-fit:cover" onerror="this.style.display=\'none\'">':'<span style="font-size:22px">'+(e.emoji||"💪")+'</span>')+
        '<div class="bd"><div class="tt">'+es(e.name)+'</div></div></div>';
    });
    h+='</div>';
  });
  h+='</div>';
  h+='<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)">'+
    '<button class="btn btn-s" onclick="newExercise('+wid+')">+ New exercise</button></div>';
  oMC("Add exercise",h);
}
function _filterExercises(q){
  q=q.toLowerCase().trim();
  document.querySelectorAll(".ex-item").forEach(function(el){
    var match=!q||(el.dataset.name||"").indexOf(q)>=0;
    el.style.display=match?"":"none";
  });
}
async function addExToWorkout(wid,exId){
  await A("POST","/api/workouts/"+wid+"/exercises",{exercise_id:exId});
  cMo();hp("ok");
  await _refreshWorkoutView(wid);
}
function newExercise(wid){
  oMC("New exercise",
    '<div class="lb">Name</div><input class="inp" id="ne-n" placeholder="e.g. Lateral Raise">'+
    '<div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ne-e" value="💪" style="text-align:center;font-size:20px"></div>'+
    '<div><div class="dl">Muscle</div><select id="ne-mg" class="inp"><option value="chest">Chest</option><option value="back">Back</option><option value="legs">Legs</option><option value="shoulders">Shoulders</option><option value="arms">Arms</option><option value="core">Core</option><option value="other">Other</option></select></div></div>'+
    '<div class="lb">Image URL <span style="color:var(--ht);font-weight:400;font-size:11px">(optional)</span></div><input class="inp" id="ne-img" placeholder="https://...">'+
    '<div class="dr"><div><div class="dl">Rest (sec)</div><input class="inp" id="ne-rs" type="number" value="90" min="0"></div></div>'+
    '<button class="btn" onclick="svNewExercise('+wid+')">Create & add</button>');
}
async function svNewExercise(wid){
  var n=document.getElementById("ne-n").value.trim();if(!n)return;
  var emoji=document.getElementById("ne-e").value.trim()||"💪";
  var mg=document.getElementById("ne-mg").value;
  var img=document.getElementById("ne-img").value.trim()||null;
  var rs=parseInt(document.getElementById("ne-rs").value)||90;
  var r=await A("POST","/api/exercises",{name:n,emoji:emoji,muscle_group:mg,image_url:img,rest_seconds:rs});
  if(!r||!r.id){toast("Failed");return}
  // Reload bundle to get new exercise into D.exercises
  await load();
  // Then add it to workout
  await addExToWorkout(wid,r.id);
}

// Rest timer — countdown banner at bottom of workout view
function startRestTimer(seconds){
  _clearRestTimer();
  var el=document.getElementById("rest-banner");if(!el)return;
  var remaining=seconds;
  el.style.display="flex";
  function tick(){
    if(remaining<=0){
      el.innerHTML='<span>✓ Rest complete!</span><button onclick="_clearRestTimer()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:4px 12px;border-radius:8px;cursor:pointer;font-weight:700">×</button>';
      hp("ok");
      setTimeout(_clearRestTimer,3000);
      return;
    }
    var mm=Math.floor(remaining/60),ss=remaining%60;
    var time=mm+":"+String(ss).padStart(2,"0");
    el.innerHTML='<span>⏱ Rest: '+time+'</span><button onclick="_clearRestTimer()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:4px 12px;border-radius:8px;cursor:pointer;font-weight:700">Skip</button>';
    remaining--;
  }
  tick();
  _restTimer=setInterval(tick,1000);
}
function _clearRestTimer(){
  if(_restTimer){clearInterval(_restTimer);_restTimer=null}
  var el=document.getElementById("rest-banner");if(el)el.style.display="none";
}

// Stats / Progress view
async function openTrainStats(){
  var q=_trainMember?("?member_id="+_trainMember):"";
  var s=await A("GET","/api/trainings/stats"+q);
  if(!s)return;
  var h='';
  // Tonnage cards
  h+='<div class="dr" style="margin-bottom:10px">';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--pr)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Today</div><div style="font-size:18px;font-weight:800;color:var(--pr)">'+_fmtTon(s.today.tonnage)+'</div></div></div>';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--ok)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Week</div><div style="font-size:18px;font-weight:800;color:var(--ok)">'+_fmtTon(s.week.tonnage)+'</div></div></div>';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--wn)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Month</div><div style="font-size:18px;font-weight:800;color:var(--wn)">'+_fmtTon(s.month.tonnage)+'</div></div></div>';
  h+='</div>';
  // 8-week chart
  if(s.weeks&&s.weeks.length){
    var maxW=Math.max.apply(null,s.weeks.map(function(w){return w.tonnage}))||1;
    h+='<div class="sc">Last 8 Weeks</div><div style="display:flex;gap:5px;align-items:flex-end;height:90px;margin-bottom:14px">';
    s.weeks.forEach(function(wk,i){
      var ph=Math.max(2,wk.tonnage/maxW*80);
      var lbl=i===s.weeks.length-1?"Now":"";
      h+='<div style="flex:1;text-align:center"><div style="height:80px;display:flex;align-items:flex-end;justify-content:center"><div style="width:14px;height:'+ph+'px;background:var(--pr);border-radius:3px 3px 0 0"></div></div><div style="font-size:9px;color:var(--ht);margin-top:3px">'+lbl+'</div></div>';
    });
    h+='</div>';
  }
  // Top exercises (tappable → progression chart)
  if(s.top_exercises&&s.top_exercises.length){
    h+='<div class="sc">Top this month <span style="font-weight:400;color:var(--ht);font-size:11px">· tap for progression</span></div>';
    var maxT=s.top_exercises[0].tonnage||1;
    s.top_exercises.forEach(function(t){
      var pct=Math.max(2,t.tonnage/maxT*100);
      h+='<div style="margin-bottom:8px;cursor:pointer" onclick="openExerciseProgression('+t.id+')"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>'+t.emoji+' '+es(t.name)+'</span><span style="font-weight:700">'+_fmtTon(t.tonnage)+'</span></div><div style="height:6px;background:var(--bd);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:var(--pr);border-radius:3px"></div></div></div>';
    });
  }
  // Personal records
  if(s.personal_records&&s.personal_records.length){
    h+='<div class="sc" style="margin-top:14px">Personal Records</div>';
    s.personal_records.forEach(function(p){
      var oneRm=Math.round(p.weight*36/Math.max(1,(37-p.reps)));
      h+='<div class="c"><span style="font-size:24px">'+p.emoji+'</span><div class="bd"><div class="tt" style="font-weight:600">'+es(p.name)+'</div><div class="mt">'+p.weight+'kg × '+p.reps+' · <span style="color:var(--ht)">est 1RM '+oneRm+'kg</span> · '+fD(p.date).date+'</div></div></div>';
    });
  }
  oMC("📊 Progress",h);
}

// Per-exercise progression chart
async function openExerciseProgression(eid){
  var q=_trainMember?("?member_id="+_trainMember):"";
  var r=await A("GET","/api/exercises/"+eid+"/progression"+q);
  if(!r||!r.points){toast("No data");return}
  var ex=r.exercise,pts=r.points;
  var h='';
  // Header card
  if(ex.image_url)h+='<div style="text-align:center;margin-bottom:12px"><img src="'+ex.image_url+'" style="max-width:100%;max-height:180px;border-radius:12px;object-fit:cover" onerror="this.style.display=\'none\'"></div>';
  if(!pts.length){
    h+='<div style="text-align:center;padding:30px;color:var(--ht)">No sessions logged yet</div>';
    oMC((ex.emoji||"💪")+" "+es(ex.name),h);return;
  }
  // Latest stats
  var latest=pts[pts.length-1];
  h+='<div class="dr" style="margin-bottom:14px">';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--pr)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Latest top</div><div style="font-size:16px;font-weight:800;color:var(--pr)">'+latest.top_weight+' kg</div></div></div>';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--ok)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Est 1RM</div><div style="font-size:16px;font-weight:800;color:var(--ok)">'+Math.round(latest.one_rm_est)+' kg</div></div></div>';
  h+='<div class="c" style="margin-bottom:0;flex:1;border-left:3px solid var(--wn)"><div class="bd"><div style="font-size:11px;color:var(--ht)">Sessions</div><div style="font-size:16px;font-weight:800;color:var(--wn)">'+pts.length+'</div></div></div>';
  h+='</div>';
  // Bar chart of top_weight over time
  var maxW=Math.max.apply(null,pts.map(function(p){return p.top_weight}))||1;
  h+='<div class="sc">Top set (kg) over time</div>';
  h+='<div style="display:flex;gap:3px;align-items:flex-end;height:120px;margin-bottom:8px;padding-bottom:18px;position:relative">';
  pts.forEach(function(p,i){
    var ph=Math.max(3,p.top_weight/maxW*110);
    var label=fD(p.date).date.replace(/\s/," ");
    var lbl=(i===pts.length-1||i===0||i===Math.floor(pts.length/2))?label:"";
    h+='<div style="flex:1;text-align:center;min-width:14px">'+
       '<div style="height:110px;display:flex;align-items:flex-end;justify-content:center"><div style="width:100%;max-width:24px;height:'+ph+'px;background:var(--pr);border-radius:3px 3px 0 0" title="'+label+': '+p.top_weight+'kg"></div></div>'+
       '<div style="font-size:9px;color:var(--ht);margin-top:3px;white-space:nowrap;overflow:hidden">'+lbl+'</div>'+
       '</div>';
  });
  h+='</div>';
  // Tonnage line
  var maxT=Math.max.apply(null,pts.map(function(p){return p.tonnage}))||1;
  h+='<div class="sc" style="margin-top:14px">Tonnage per session</div>';
  h+='<div style="display:flex;gap:3px;align-items:flex-end;height:80px;margin-bottom:14px">';
  pts.forEach(function(p){
    var ph=Math.max(3,p.tonnage/maxT*70);
    h+='<div style="flex:1;text-align:center;min-width:14px"><div style="height:70px;display:flex;align-items:flex-end;justify-content:center"><div style="width:100%;max-width:24px;height:'+ph+'px;background:var(--ok);border-radius:3px 3px 0 0"></div></div></div>';
  });
  h+='</div>';
  // Recent sessions list
  h+='<div class="sc">Recent sessions</div>';
  pts.slice().reverse().slice(0,6).forEach(function(p){
    h+='<div class="c" style="padding:10px 12px;margin-bottom:4px"><div class="bd"><div class="tt" style="font-weight:600">'+fD(p.date).full+'</div><div class="mt"><span style="color:var(--pr);font-weight:600">'+p.top_weight+' kg</span> · '+p.sets+' sets · '+_fmtTon(p.tonnage)+' · est 1RM '+Math.round(p.one_rm_est)+'kg</div></div></div>';
  });
  oMC((ex.emoji||"💪")+" "+es(ex.name),h);
}

// ═══════════════════════════════════════════════════════════
// EVENTS (hamburger page)
// ═══════════════════════════════════════════════════════════
var _evtsFirstRender=true;
// Switch between Tasks sub-tabs (Active/Recurring/Events). Manages FAB visibility and page header label.
function taskTabSet(t){
  taskTab=t;hp("sel");
  // Hide FAB only on Events (it has its own inline "+ Add Event" button). Active + Recurring both use FAB.
  document.getElementById("fab").classList.toggle("hidden",t==="events");
  var hi=document.getElementById("hi"),ht=document.getElementById("ht"),hs=document.getElementById("hs");
  if(t==="events"){hi.innerHTML=icon("clock",22,2.2);ht.textContent="Events";hs.textContent="Schedule";_evtsFirstRender=true}
  else if(t==="recurring"){hi.innerHTML=icon("refresh",22,2.2);ht.textContent="Recurring";hs.textContent="Repeating tasks"}
  else{hi.innerHTML=icon("clipboard",22,2.2);ht.textContent="Tasks";hs.textContent="Manage & assign"}
  ren()
}
function rEvts(){
if(!D.events.length)return em(icon("clock",48,1.8),"No events","Tap + Add Event to start")+rEvtAddBtn();
var evts=D.events;if(searchQ)evts=evts.filter(function(e){return matchQ(e.text)});
if(!evts.length)return rEvtAddBtn()+em(icon("clock",48,1.8),"No matches","Try a different search");
// Categorize: ongoing (today between start and end), upcoming (start > today), past (end < today)
var todayStr=td();
var current=[],future=[],past=[];
evts.forEach(function(ev){
  var s=(ev.event_date||"").split(" ")[0];
  var e=(ev.end_date||s).split(" ")[0];
  if(s&&s<=todayStr&&todayStr<=e)current.push(ev);
  else if(s&&s>todayStr)future.push(ev);
  else past.push(ev);
});
// Sort: future ASC (nearest at end of future block), past DESC (recent at top of past block)
function _cmpAsc(a,b){return(a.event_date||"").localeCompare(b.event_date||"")}
function _cmpDesc(a,b){return(b.event_date||"").localeCompare(a.event_date||"")}
future.sort(_cmpAsc);current.sort(_cmpAsc);past.sort(_cmpDesc);
// DOM order top→bottom: furthest future first, then nearer future, then current(s), then recent past, then older past
var ordered=future.slice().reverse().concat(current).concat(past);
// Highlight: current[0] || nearest future || most-recent past
var highId=current.length?current[0].id:future.length?future[0].id:past.length?past[0].id:null;
var pastSet={};past.forEach(function(p){pastSet[p.id]=true});
var colors=["var(--ok)","var(--pr)","var(--ac)","var(--wn)"];
var h=rEvtAddBtn();
h+='<div class="evts-scroll" id="evts-scroll"><div class="evts-timeline">';
ordered.forEach(function(ev){
  var c=colors[ev.id%colors.length];
  var isHigh=ev.id===highId;
  var isPast=!!pastSet[ev.id];
  var fd=fD(ev.event_date);
  var st=(ev.event_date||"").split(" ")[1]||"";
  var ep=ev.end_date?(" → "+fD(ev.end_date).date+" "+(ev.end_date.split(" ")[1]||"")):"";
  var rowCls="evt-row"+(isHigh?" evt-high":"")+(isPast?" evt-past":"");
  h+='<div class="'+rowCls+'" data-evt-id="'+ev.id+'">';
  h+='<div class="evt-dot" style="background:'+c+'"></div>';
  h+='<div class="c evt-card">';
  h+='<div class="bd"><div class="tt" style="font-weight:600">'+es(ev.text)+'</div>';
  h+='<div class="mt" style="margin-top:6px"><span class="bg" style="background:color-mix(in srgb,'+c+',transparent 85%);color:'+c+'">'+fd.day+" "+fd.date+'</span><span>'+st+ep+'</span> '+sC("event",ev.id)+' <button class="xb" onclick="tX(\'event\','+ev.id+')">'+(ex["event_"+ev.id]?"▾":"▸")+'</button></div></div>';
  h+='<button class="bi" onclick="dEv('+ev.id+')">'+I.tr+'</button>';
  h+='</div>'+rSu("event",ev.id)+'</div>';
});
h+='</div></div>';
// Auto-scroll highlighted to .evts-scroll viewport center on first open (only if no active search).
// We manipulate scrollTop directly instead of scrollIntoView — that prevents body/page scroll
// from propagating, which would push the segmented tabs above the visible area.
if(_evtsFirstRender&&highId&&!searchQ){
  _evtsFirstRender=false;
  requestAnimationFrame(function(){
    var el=document.querySelector('[data-evt-id="'+highId+'"]');
    var sc=document.getElementById("evts-scroll");
    if(el&&sc){
      var er=el.getBoundingClientRect(),sr=sc.getBoundingClientRect();
      sc.scrollTop=er.top-sr.top+sc.scrollTop-(sc.clientHeight/2)+(el.offsetHeight/2);
    }
  });
}
return h}
function rEvtAddBtn(){return '<button class="btn btn-s" style="margin:3px 0 16px" onclick="oMoEvt()">+ Add Event</button>'}
async function dEv(id){hp();await A("DELETE","/api/events/"+id);await load();toast("🗑 Deleted")}

// ═══════════════════════════════════════════════════════════
// BIRTHDAYS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rBdays(){
if(!D.birthdays.length)return em("🎂","No birthdays","Add below")+rBdAddBtn();
var bdays=D.birthdays;if(searchQ)bdays=bdays.filter(function(b){return matchQ(b.name)});
var h=rBdAddBtn();bdays.forEach(function(b){
var rightTxt=b.days_until===0?"Today! 🎉":b.days_until===1?"Tomorrow":"in "+b.days_until+"d";
var tone=b.days_until===0?"tone-ok":b.days_until<=7?"tone-wn":"";
var dateTxt=b.birth_date.split("-").slice(1).reverse().join(".");
h+='<div class="lc"><div class="lc-i acc-wn">'+b.emoji+'</div><div class="lc-bd"><div class="lc-tt">'+es(b.name)+'</div><div class="lc-mt">🎂 '+dateTxt+'</div></div><span class="lc-rt '+tone+'">'+rightTxt+'</span><button class="bi" onclick="edBd('+b.id+')" style="margin-left:4px">'+I.ed+'</button><button class="bi" onclick="dlBd('+b.id+')">'+I.tr+'</button></div>'});return h}
function rBdAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoBd()">+ Add Birthday</button>'}
async function dlBd(id){hp();await A("DELETE","/api/birthdays/"+id);await load();toast("🗑 Deleted")}
function edBd(id){var b=D.birthdays.find(function(x){return x.id===id});if(!b)return;_bdRems=(b.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});oMC("Edit Birthday",'<input class="inp" id="bd-n" value="'+es(b.name)+'"><input class="inp" id="bd-e" value="'+b.emoji+'" style="width:80px"><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="svBd('+id+')">Save</button>',{ic:"cake"})}
async function svBd(id){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim();if(!n)return;await A("PUT","/api/birthdays/"+id,{name:n,emoji:e,reminders:_bdRems});cMo();hp();await load()}

// ═══════════════════════════════════════════════════════════
// CLEANING (hamburger page)
// ═══════════════════════════════════════════════════════════
function rC(){if(!D.zones.length)return em(icon("broom",48,1.8),"No zones yet","Add zones below")+'<button class="btn" onclick="shAZ()">+ Add Zone</button>';
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
h+='<div class="za"><input id="zti-'+z.id+'" placeholder="Add task..." onkeydown="if(event.key===\'Enter\')aZT('+z.id+')"><button onclick="aZT('+z.id+')">Add</button></div>';
h+='</div>';
h+='<button class="zn-del" onclick="dlZn('+z.id+')">Delete zone</button>';
h+='</div>';return h}
async function tgZT(id){hp();await A("PATCH","/api/cleaning/tasks/"+id+"/toggle");await load()}
async function dZT(id){hp();await A("DELETE","/api/cleaning/tasks/"+id);await load()}
async function aZT(zid){var i=document.getElementById("zti-"+zid);if(!i||!i.value.trim())return;await A("POST","/api/cleaning/zones/"+zid+"/tasks",{text:i.value.trim()});hp();await load()}
async function dlZn(id){if(!confirm("Delete zone?"))return;await A("DELETE","/api/cleaning/zones/"+id);hp();await load()}
function edZn(zid){var z=D.zones.find(function(x){return x.id===zid});if(!z)return;_assign=z.assigned_to||0;_zRems=(z.reminders||[]).map(function(r){return r.remind_at});oMC("Edit Zone",'<input class="inp" id="ez-n" value="'+es(z.name)+'"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ez-i" value="'+z.icon+'" style="text-align:center;font-size:24px"></div></div><div class="lb">Assigned to</div>'+assignPk("ezap",z.assigned_to)+'<div class="lb">Reminders</div><div id="zrw">'+zRemPk()+'</div><button class="btn" onclick="svZn('+zid+')">Save</button>')}
async function svZn(zid){var n=document.getElementById("ez-n").value.trim();var i=document.getElementById("ez-i").value.trim();if(!n)return;await A("PUT","/api/cleaning/zones/"+zid,{name:n,icon:i,assigned_to:_assign||null,reminders:_zRems});cMo();hp();await load()}
function edZT(tid){var t=null;D.zones.forEach(function(z){(z.tasks||[]).forEach(function(tk){if(tk.id===tid)t=tk})});if(!t)return;_assign=t.assigned_to||0;oMC("Edit Cleaning Task",'<input class="inp" id="zt-t" value="'+es(t.text)+'"><div class="dr"><div><div class="dl">Reset (days)</div><input class="inp" id="zt-d" type="number" value="'+(t.reset_days||7)+'" min="1" max="90"></div></div><div class="lb">Assigned to</div>'+assignPk("ztap",t.assigned_to)+'<button class="btn" onclick="svZT('+tid+')">Save</button>')}
async function svZT(tid){var text=document.getElementById("zt-t").value.trim();var rd=parseInt(document.getElementById("zt-d").value)||7;if(!text)return;await A("PUT","/api/cleaning/tasks/"+tid,{text:text,icon:"🧹",assigned_to:_assign||null,reset_days:rd});cMo();hp();await load()}
function shAZ(){_assign=0;oMC("Add Zone",'<input class="inp" id="zn" placeholder="Zone name"><input class="inp" id="zic" placeholder="🍳" style="width:80px"><div class="lb">Assigned to</div>'+assignPk("zap",null)+'<button class="btn" onclick="doAZ()">Add Zone</button>',{ic:"broom"})}
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
// Tasks — 4 stat tiles
h+='<div class="sc"><span class="sc-l">'+icon("clipboard",12,2.4)+'Tasks</span></div>';
h+='<div class="sts">';
h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("list",16,2.2)+'</div><div class="st-lb">Active</div><div class="st-vl" style="color:var(--pr)"><span class="cu" data-count="'+s.tasks_active+'">0</span></div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("ck",16,2.6)+'</div><div class="st-lb">Completed</div><div class="st-vl pos"><span class="cu" data-count="'+s.tasks_done+'">0</span></div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ac">'+icon("dot",14,0)+'</div><div class="st-lb">Overdue</div><div class="st-vl neg"><span class="cu" data-count="'+s.tasks_overdue+'">0</span></div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-pr" style="color:var(--wn);border-color:color-mix(in srgb,var(--wn) 42%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--wn) 38%,transparent),color-mix(in srgb,var(--wn) 8%,transparent))">'+icon("bolt",16,2.2)+'</div><div class="st-lb">High Priority</div><div class="st-vl" style="color:var(--wn)"><span class="cu" data-count="'+s.tasks_high+'">0</span></div></div>';
h+='</div>';
// Cleaning progress
var cPct=s.clean_total>0?Math.round(s.clean_done/s.clean_total*100):0;
h+='<div class="sc"><span class="sc-l">'+icon("broom",12,2.4)+'Cleaning</span></div>';
h+='<div class="cat-row"><div class="cat-row-h"><span class="nm">'+s.clean_done+'/'+s.clean_total+' tasks done</span><span class="vl" style="color:var(--ok)">'+cPct+'%</span></div><div class="progress"><div class="progress-fill tone-ok" style="width:'+cPct+'%"></div></div></div>';
// Count-up animation
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
document.getElementById("cal-mo").appendChild(el)
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
oMC("New Task",'<input class="inp" id="f-t" placeholder="What needs to be done?"><div class="lb">Assign to</div>'+assignPk("ap",null)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(p==="normal"?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" value="'+iso+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="doTkCal()">Add Task</button>');
document.getElementById("mo").classList.add("op");
setTimeout(function(){var i=document.querySelector("#mb input.inp");if(i)i.focus()},300)
}
function oMoEvtDay(iso){
oMC("New Event",'<input class="inp" id="f-t" placeholder="Event name"><div class="lb">Start</div><div class="dr"><div><div class="dl">Date</div><input type="date" id="f-d" value="'+iso+'"></div><div><div class="dl">Time</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">End <span style="color:var(--ht);font-weight:400;font-size:11px">(extend for multi-day events)</span></div><div class="dr"><div><input type="date" id="f-ed" value="'+iso+'"></div><div><input type="time" id="f-et" value="13:00" step="60"></div></div><button class="btn" onclick="doEvCal()">Add Event</button>');
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
oMC("Edit Event",'<input class="inp" id="f-t" value="'+es(e.text)+'"><div class="lb">Start</div><div class="dr"><div><div class="dl">Date</div><input type="date" id="f-d" value="'+sDate+'"></div><div><div class="dl">Time</div><input type="time" id="f-tm" value="'+sTime+'" step="60"></div></div><div class="lb">End <span style="color:var(--ht);font-weight:400;font-size:11px">(extend for multi-day)</span></div><div class="dr"><div><input type="date" id="f-ed" value="'+eDate+'"></div><div><input type="time" id="f-et" value="'+eTime+'" step="60"></div></div><button class="btn" onclick="svEv('+id+')">Save</button><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bd)"><button class="btn btn-s" style="color:var(--ac);background:transparent;border:1.5px solid var(--bd)" onclick="dEv('+id+');cMo();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}">Delete Event</button></div>')
}
async function svEv(id){var t=document.getElementById("f-t").value.trim();var d=document.getElementById("f-d").value;var tm=document.getElementById("f-tm").value||"12:00";if(!t||!d)return;var ed=document.getElementById("f-ed")?document.getElementById("f-ed").value:"";var et=document.getElementById("f-et")?document.getElementById("f-et").value:"";var end=ed?ed+" "+(et||tm):null;await A("PUT","/api/events/"+id,{text:t,event_date:d+" "+tm,end_date:end});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}

// Calendar wrappers — close detail card, register refresh callback, open edit modal
function calEdTk(id){closeCalEv();_calEditCb=_calRefresh;edTk(id)}
function calEdEv(id){closeCalEv();_calEditCb=_calRefresh;edEv(id)}
function calEdRec(id){closeCalEv();_calEditCb=_calRefresh;edRec(id)}

// ═══════════════════════════════════════════════════════════
// SETTINGS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rSet(){var h='';
function _setRow(opts){
  // opts: {ico, iconCustom, iconStyle, acc, title, subtitle, onclick, right, id, style}
  var hasIcon=opts.ico||opts.iconCustom;
  var iconInner=opts.iconCustom||(opts.ico?icon(opts.ico,20,2.2):'');
  var iconStyleAttr=opts.iconStyle?' style="'+opts.iconStyle+'"':'';
  var iconHtml=hasIcon?'<div class="lc-i '+(opts.acc||"")+'"'+iconStyleAttr+'>'+iconInner+'</div>':'';
  var ocl=opts.onclick?' onclick="'+opts.onclick+'"':"";
  var cls="lc lc-row"+(opts.onclick?" lc-tap":"");
  var sub=opts.subtitle?'<div class="lc-mt">'+opts.subtitle+'</div>':"";
  return '<div class="'+cls+'"'+ocl+(opts.id?' id="'+opts.id+'"':"")+(opts.style?' style="'+opts.style+'"':"")+'>'+iconHtml+'<div class="lc-bd"><div class="lc-tt">'+opts.title+'</div>'+sub+'</div>'+(opts.right||'')+(opts.onclick?'<span class="lc-chev">›</span>':"")+'</div>'
}
if(fS&&fS.joined){
  h+='<div class="sc"><span class="sc-l">Family</span></div>';
  h+=_setRow({ico:"user",acc:"acc-ok",title:es(fS.name||"My Family"),subtitle:"Family workspace"});
  h+='<div class="invite-card"><div class="invite-lb">Invite Code</div><div class="invite-cd">'+(fS.invite_code||"...")+'</div><div class="invite-hint">Share this with new members</div></div>';
  h+='<div class="sc"><span class="sc-l">Members<span class="sc-cnt">'+(fS.members||[]).length+'</span></span></div>';
  (fS.members||[]).forEach(function(m){
    var right='<button class="bi" onclick="edMe('+m.user_id+',\''+es(m.user_name)+'\',\''+m.emoji+'\',\''+m.color+'\')">'+I.ed+'</button>';
    h+='<div class="lc lc-mem">'+mAv(m.user_id,44)+'<div class="lc-bd"><div class="lc-tt">'+es(m.user_name)+'</div><div class="lc-mem-strip" style="background:'+m.color+'"></div></div>'+right+'</div>';
  });
  h+='<div style="margin:14px 0 22px;display:flex;gap:8px"><button class="btn btn-s" style="font-size:13px;flex:1" onclick="if(confirm(\'Leave family?\'))leaveFam()">Leave Family</button>'+
  (!iD&&_getSess()?'<button class="btn btn-s" style="font-size:13px;flex:1;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="_logoutPwa()">Log out</button>':'')+
  '</div>';
}
var curTh=TH[cTheme]||TH.midnight;
h+='<div class="sc"><span class="sc-l">Appearance</span></div>';
var thAcc=curTh.pr;
var thStyle='background:linear-gradient(135deg,color-mix(in srgb,'+thAcc+' 38%,transparent),color-mix(in srgb,'+thAcc+' 10%,transparent));border-color:color-mix(in srgb,'+thAcc+' 48%,transparent);color:'+thAcc+';box-shadow:inset 0 1px 0 color-mix(in srgb,'+thAcc+' 20%,transparent),0 2px 12px color-mix(in srgb,'+thAcc+' 22%,transparent)';
h+=_setRow({ico:"palette",iconStyle:thStyle,title:curTh.n,subtitle:"Tap to change · "+Object.keys(TH).length+" themes · "+curTh.e,onclick:"openThemePicker()"});
h+='<div class="sc"><span class="sc-l">Notifications</span></div>';
h+=_setRow({ico:"bl",acc:"acc-wn",title:"Morning Digest",subtitle:"Time: "+(D.settings.digest_time||"09:00")+" · Sections & order",onclick:"openDigestCfg()"});
var nExp=D.categories.filter(function(c){return c.type==="expense"}).length;
var nInc=D.categories.filter(function(c){return c.type==="income"}).length;
h+='<div class="sc"><span class="sc-l">Money</span></div>';
h+=_setRow({ico:"list",acc:"acc-pr",title:"Categories",subtitle:nExp+" expense · "+nInc+" income",onclick:"openCatMgr()"});
h+='<div class="sc"><span class="sc-l">Integrations</span></div>';
h+=_setRow({iconCustom:'<span style="font-size:22px">🔵</span>',acc:"",title:"Trello Sync",subtitle:"Board: Работа",onclick:"syncTrello()",right:'<span id="trello-btn" class="lc-rt" style="background:color-mix(in srgb,var(--pr) 16%,transparent);color:var(--pr)">Sync Now</span>'});
if(_pwaPrompt){
  h+=_setRow({iconCustom:'<span style="font-size:22px">📱</span>',acc:"",title:"Install App",subtitle:"Add to home screen — works offline",onclick:"installPWA()",right:'<span class="lc-rt" style="background:color-mix(in srgb,var(--pr) 16%,transparent);color:var(--pr)">Install</span>'});
}else if(!iD && /iPhone|iPad|iPod/.test(navigator.userAgent||"")){
  h+='<div class="lc"><div class="lc-i acc-pr"><span style="font-size:22px">📱</span></div><div class="lc-bd"><div class="lc-tt">Install on iOS</div><div class="lc-mt">Tap <b>Share</b> ⬆ → <b>Add to Home Screen</b></div></div></div>';
}
h+='<div class="sc"><span class="sc-l">Developer</span></div>';
h+=_setRow({ico:"debug",acc:"acc-ac",title:"Debug Mode "+(dbgOn?"ON":"OFF"),onclick:"dbgOn=!dbgOn;document.getElementById(\'dbg\').classList.toggle(\'hidden\',!dbgOn);ren()"});
h+='<div style="margin-top:18px;text-align:center;font-size:11px;color:var(--ht);letter-spacing:.3px">Family HQ v8.17.1</div>';return h}
async function setTh(id){aT(id);hp();await A("PATCH","/api/settings",{theme:id});ren()}
function openThemePicker(){var h='<div class="tg">';Object.keys(TH).forEach(function(id){var t=TH[id];var sel=cTheme===id;h+='<div class="tc" onclick="setTh(\''+id+'\');cMo()" style="background:'+t.cd+';border:2px solid '+(sel?t.pr:t.bd)+'"><div class="te">'+t.e+'</div><div class="tn" style="color:'+t.tx+'">'+t.n+'</div><div class="td">'+[t.pr,t.ac,t.ok,t.wn].map(function(c){return '<div class="tdd" style="background:'+c+'"></div>'}).join("")+'</div></div>'});h+='</div>';oMC("Choose theme",h)}
async function setDg(v){await A("PATCH","/api/settings",{digest_time:v});hp()}
var _catTab="expense";
function openCatMgr(){_catTab="expense";oMC("Categories",catMgrHtml())}
function catMgrHtml(){
var h='<div class="tabs" style="margin-bottom:16px"><button class="tab '+(_catTab==="expense"?"a":"")+'" onclick="_catTab=\'expense\';document.getElementById(\'mb\').innerHTML=catMgrHtml()">💸 Expense</button><button class="tab '+(_catTab==="income"?"a":"")+'" onclick="_catTab=\'income\';document.getElementById(\'mb\').innerHTML=catMgrHtml()">💰 Income</button></div>';
D.categories.filter(function(c){return c.type===_catTab}).forEach(function(c){
h+='<div class="c"><span style="font-size:20px">'+c.emoji+'</span><div class="bd"><div class="tt">'+es(c.name)+'</div></div><button class="bi" onclick="cMo();edCat('+c.id+')">'+I.ed+'</button><button class="bi" onclick="dlCat('+c.id+');openCatMgr()">'+I.tr+'</button></div>'});
h+='<button class="btn btn-s" onclick="cMo();addCat(\''+_catTab+'\')">+ Add Category</button>';
return h}
async function syncTrello(){var btn=document.getElementById("trello-btn");if(btn)btn.textContent="Syncing...";try{await A("POST","/api/trello/sync");await load();toast("✓ Trello synced")}catch(e){toast("Trello sync failed")}if(btn)btn.textContent="Sync Now"}
async function leaveFam(){await A("POST","/api/family/leave");location.reload()}
function edMe(uid,name,emoji,color){oMC("Edit Profile",'<input class="inp" id="me-n" value="'+name+'" placeholder="Name"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="me-e" value="'+emoji+'" style="text-align:center;font-size:24px"></div><div><div class="dl">Color</div><input type="color" id="me-c" value="'+color+'" style="width:100%;height:48px;border-radius:12px;border:none;cursor:pointer"></div></div><button class="btn" onclick="svMe('+uid+')">Save</button>',{ic:"user"})}
async function svMe(uid){var n=document.getElementById("me-n").value.trim();var e=document.getElementById("me-e").value.trim();var c=document.getElementById("me-c").value;if(!n)return;await A("PATCH","/api/members/"+uid,{user_name:n,emoji:e,color:c});cMo();hp();await load()}


// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════
function txCatRefresh(){var el=document.getElementById("tx-cats");if(!el)return;var cats=D.categories.filter(function(c){return c.type===window._txType});var h="";cats.forEach(function(c){h+='<button class="ob'+(window._txCat===c.id?" s":"")+'" onclick="window._txCat='+c.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+c.emoji+" "+es(c.name)+"</button>"});h+='<button class="ob" onclick="addCatInline()" style="border:1.5px dashed var(--ht)">+ New</button>';el.innerHTML=h;window._txCat=0}
function addCatInline(){var t=window._txType;oMC("New Category",'<input class="inp" id="nc-n" placeholder="Category name"><input class="inp" id="nc-e" placeholder="📦" value="📦" style="width:80px"><button class="btn" onclick="doAddCatInline(\''+t+'\')">Create</button>')}
async function doAddCatInline(type){var n=document.getElementById("nc-n").value.trim();var e=document.getElementById("nc-e").value.trim()||"📦";if(!n)return;await A("POST","/api/categories",{name:n,emoji:e,type:type});cMo();hp();await load();go("money");oMo()}
function addCat(type){oMC("New Category",'<input class="inp" id="nc-n" placeholder="Category name"><input class="inp" id="nc-e" placeholder="📦" value="📦" style="width:80px"><button class="btn" onclick="doAddCat(\''+type+'\')">Create</button>')}
async function doAddCat(type){var n=document.getElementById("nc-n").value.trim();var e=document.getElementById("nc-e").value.trim()||"📦";if(!n)return;await A("POST","/api/categories",{name:n,emoji:e,type:type});cMo();hp();await load()}
function edCat(cid){var c=D.categories.find(function(x){return x.id===cid});if(!c)return;oMC("Edit Category",'<input class="inp" id="ec-n" value="'+es(c.name)+'"><input class="inp" id="ec-e" value="'+c.emoji+'" style="width:80px"><button class="btn" onclick="svCat('+cid+')">Save</button>')}
async function svCat(cid){var n=document.getElementById("ec-n").value.trim();var e=document.getElementById("ec-e").value.trim();if(!n)return;await A("PUT","/api/categories/"+cid,{name:n,emoji:e});cMo();hp();await load()}
async function dlCat(cid){if(!confirm("Delete category?"))return;await A("DELETE","/api/categories/"+cid);hp();await load();toast("Deleted")}
// oMC(title, body, opts?) — opts.ic = icon name to show in a tinted square left of the title
function oMC(t,h,opts){
  var ic=opts&&opts.ic?icon(opts.ic,18,2.2):'';
  var titleHtml=ic?'<span class="mt2-ico">'+ic+'</span><span>'+t+'</span>':t;
  document.getElementById("mt3").innerHTML=titleHtml;
  document.getElementById("mb").innerHTML=h;
  document.getElementById("mo").classList.add("op");
  hp("light");
  setTimeout(function(){var i=document.querySelector("#mb input");if(i)i.focus()},300)
}
function cMo(){document.getElementById("mo").classList.remove("op")}

// Event/Birthday add modals (from hamburger pages)
function oMoEvt(){var dy=td();oMC("New Event",'<input class="inp" id="f-t" placeholder="Event name"><div class="lb">Start</div><div class="dr"><div><div class="dl">Date</div><input type="date" id="f-d" value="'+dy+'" min="'+dy+'"></div><div><div class="dl">Time</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">End (optional)</div><div class="dr"><div><input type="date" id="f-ed"></div><div><input type="time" id="f-et" step="60"></div></div><button class="btn" onclick="doEv()">Add Event</button>')}
function oMoBd(){_bdRems=[{days_before:1,time:"09:00"},{days_before:0,time:"09:00"}];oMC("Add Birthday",'<input class="inp" id="bd-n" placeholder="Name"><input class="inp" id="bd-e" value="🎂" style="width:80px"><div class="lb">Date of Birth</div><div class="dr"><div><input type="date" id="bd-d"></div></div><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="doBd()">Add Birthday</button>',{ic:"cake"})}

// FAB handler
function oMo(){_assign=0;_pri="normal";_rems=[];var dy=td();
switch(tab){
case"tasks":
    if(taskTab==="recurring"){oMC("New Recurring Task",'<input class="inp" id="f-t" placeholder="Task name"><div class="lb">Assign to</div>'+assignPk("ap",null)+'<div class="lb">Schedule</div><div class="or"><button class="ob s" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Daily</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Weekly</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">Monthly</button></div><input type="hidden" id="rr" value="daily"><div id="wd" class="hidden"><div class="lb">Days</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="hidden"><div class="lb">Day of month</div><input class="inp" id="f-md" type="number" min="1" max="28" value="1"></div><button class="btn" onclick="doRec()">Create</button>')}
    else{oMC("New Task",'<input class="inp" id="f-t" placeholder="What needs to be done?"><div class="lb">Assign to</div>'+assignPk("ap",null)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(p==="normal"?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" min="'+dy+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="doTk()">Add Task</button>')}break;
case"shop":
    // Enhanced: full form like edit
    var folderOpts='<button class="ob s" onclick="window._newShopFold=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">None</button>';
    D.folders.forEach(function(f){folderOpts+='<button class="ob" onclick="window._newShopFold='+f.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+f.emoji+" "+es(f.name)+'</button>'});
    window._newShopFold=0;
    oMC("Add Item",'<input class="inp" id="ns-n" placeholder="Item name"><div class="dr"><div><div class="dl">Quantity</div><input class="inp" id="ns-q" placeholder="e.g. 1kg"></div><div><div class="dl">Price (din.)</div><input class="inp" id="ns-p" type="number" placeholder="0"></div></div>'+(D.folders.length?'<div class="lb">Folder</div><div class="or">'+folderOpts+'</div>':'')+'<button class="btn" onclick="doShNew()">Add</button>');break;
case"money":{
    _assign=0;window._txType="expense";window._txCat=0;
    oMC("Add Transaction",'<div class="or" style="margin-bottom:8px"><button class="ob s" id="tb-exp" onclick="window._txType=\'expense\';document.getElementById(\'tb-exp\').classList.add(\'s\');document.getElementById(\'tb-inc\').classList.remove(\'s\');txCatRefresh()">💸 Expense</button><button class="ob" id="tb-inc" onclick="window._txType=\'income\';document.getElementById(\'tb-inc\').classList.add(\'s\');document.getElementById(\'tb-exp\').classList.remove(\'s\');txCatRefresh()">💰 Income</button></div><div class="dr"><div><div class="dl">Amount</div><input class="inp" id="tx-a" type="number" step="0.01" placeholder="0"></div><div><div class="dl">Currency</div><select id="tx-c"><option value="RSD">din.</option><option value="EUR">€</option><option value="USD">$</option><option value="GBP">£</option><option value="RUB">₽</option></select></div></div><div class="lb">Description</div><input class="inp" id="tx-d" placeholder="What for?"><div class="lb">Category</div><div class="or" id="tx-cats"></div><div class="lb">Date</div><input type="date" id="tx-dt" value="'+dy+'"><div class="lb">Who</div>'+assignPk("txm",null)+'<button class="btn" onclick="doTx()">Add</button>');setTimeout(txCatRefresh,50)}break}
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
