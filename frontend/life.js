// ═══════════════════════════════════════════════════════════════
// 🌱 Family HQ — Life tab (v8.51.0) · Phase 1a
// ═══════════════════════════════════════════════════════════════
// A living balance network. Two levels:
//   L0 (constellation): "You" + 6 area nodes orbiting. Brightness/size = how
//      well-fed each life area is (avg consistency of its habits).
//   L1 (inside an area): the area becomes the hub, its habits orbit. Tap "+"
//      to plant a habit; tap a habit for streak detail + mark-done.
// Filter Me / <partner> / Family switches whose balance you see (Family uses
// the relationship area set from the backend).
//
// Rendering: SVG. Glow via radialGradient (no filter:blur). Idle "breathing"
// via CSS keyframes (no JS). Drag-coupling via a light spring sim that runs
// ONLY while dragging + a short settle — cheap on mobile WebView.
//
// Lazy-loaded by app.js on first Life visit. Reads: D, fS, tr(), A(), hp(),
// toast(), es(), icon(), oMC(), cMo(), ren(), mAv(), mName().

// ─── State ────────────────────────────────────────────────────
var _lifeOwner = null;          // '<user_id>' | 'family'
var _lifeView = "constellation"; // 'constellation' | 'area'
var _lifeAreaId = null;
var _lifeData = null;           // summary: {owner, scope, areas[], bond, members[]}
var _lifeAreaHabits = [];       // habits in the open area
var _lifeNodes = [];            // render nodes [{id,type,hx,hy,x,y,vx,vy,r,color,...}]
var _lifeRAF = null;
// Node lookup by id — rebuilt each draw; the sim + hit-test read it every frame.
var _lifeIndexMap = null;  // {id: node}
// Organic layout: a stable random jitter per node (breaks the rigid cross) and a
// continuous slow drift (nodes gently float, edges following from centre to centre).
var _lifeJitter = {};
var _lifeFloatOn = false;
var _lifeStepT = 0;        // last sim-step timestamp (for the ~30fps float throttle)
// The float DECAYS to rest: it animates for a few seconds after you arrive or
// interact, then the graph settles to a static frame (zero GPU paint at idle).
// Measured root cause of the mobile FPS drop: the JS sim is trivial (~0.085ms/
// frame), but a perpetual float = perpetual full-screen repaint, which a high-DPR
// phone GPU can't always sustain. Stopping at rest removes that cost entirely.
var _lifeFloatUntil = 0;
var _LIFE_FLOAT_MS = 4500;
function _lifeWakeFloat(){ _lifeFloatUntil = Date.now() + _LIFE_FLOAT_MS; if(_lifeFloatOn && !_lifeRAF) _lifeStartSim(); }
var _lifeDrag = null;           // {id, moved}
var _lifeLongTimer = null;
var _lifeSettleUntil = 0;
// iOS-style edit mode (v8.52.1): long-press the empty canvas → nodes wiggle and
// a tap edits the node (area → rename/emoji, habit → full edit). Tap background
// to finish.
var _lifeEditMode = false;
var _lifeBg = null;             // background press tracking
var _lifeBgTimer = null;
// Journey (v8.54.0 · Phase 2): a stats view over the same owner scope — balance,
// per-area bars, an activity sparkline, headline counters.
var _lifeJourney = false;
// Challenges (v8.55.0 · Phase 3): time-bound goals on a habit/sphere/any.
var _lifeChall = false;
var _lifeChallTab = "current";
var _lifeChallDraft = null;
var _lifeChallSugg = [];
// Event tracker (v8.62.0): the board is monthly. _lifeYM = selected month
// 'YYYY-MM' (null = current). Past months are read-only.
var _lifeYM = null;
var _lifeCurYMStr = null;        // current month, learned from the API responses
function _lifeYMv(){ return _lifeYM || _lifeCurYMStr || _lifeLocalYM(); }
function _lifeLocalYM(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function _lifeIsPast(){ return !!(_lifeYM && _lifeCurYMStr && _lifeYM !== _lifeCurYMStr); }
function _lifeYMLabel(ym){
  var p=String(ym||_lifeYMv()).split("-"), dt=new Date(+p[0],+p[1]-1,1);
  return dt.toLocaleDateString((_lang==="ru")?"ru-RU":"en-US",{month:"long",year:"numeric"});
}
function _lifeYMShift(delta){
  var p=String(_lifeYMv()).split("-"), y=+p[0], m=+p[1]-1+delta;
  var d=new Date(y, m, 1), ym=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  var cur=_lifeCurYMStr||_lifeLocalYM();
  if(ym>cur) return;                 // never go past the current month
  _lifeYM = (ym===cur)? null : ym;
  hp("light");
  _lifeRenderTopBar();
  if(_lifeView==="area" && _lifeAreaId) _lifeLoadArea(_lifeAreaId);
  else _lifeLoadSummary();
}

// ─── Entry: shell HTML (ren() injects this into #ct) ──────────
function rLife(){
  // life-mode (body class set by app.js go()) hides the global header; we render
  // our own top bar with the owner filter and an in-canvas back button.
  // Canvas fills the whole area below the header; the filter row and hint float
  // as absolute overlays ON the canvas (no separate black strips).
  var h = '<div class="life-wrap">';
  h += '<div class="life-stage"><canvas id="life-cv"></canvas>';
  h += '<div class="life-journey" id="life-journey" style="display:none"></div>';
  h += '<div class="life-journey" id="life-chall" style="display:none"></div></div>';
  h += '<div class="life-top" id="life-top"></div>';
  h += '<div class="life-hint" id="life-hint"></div>';
  h += '</div>';
  setTimeout(lifeMount, 0);
  return h;
}

// Called by app.js after the shell is in the DOM (and on lazy-load completion).
var _lifeAvatarsPreloaded = false;
function lifeMount(){
  if(tab !== "life") return;
  // Lock the page scroller (the documentElement, not just body) — Life is a fixed
  // full-screen canvas; any page scroll slides the absolute .life-top under the
  // sticky header. Overlays (Journey/Challenges) scroll internally, unaffected.
  try{ document.documentElement.style.overflow="hidden"; window.scrollTo(0,0); }catch(e){}
  if(!_lifeOwner) _lifeOwner = String((fS && fS.my_id) || (D.members[0] && D.members[0].user_id) || "");
  // Warm the avatar image cache once so the SVG <image> elements (which get
  // recreated whenever the graph redraws — edit toggle, month/owner switch) paint
  // instantly from cache instead of flashing while they re-decode.
  if(!_lifeAvatarsPreloaded){
    _lifeAvatarsPreloaded = true;
    (D.members||[]).forEach(function(m){ if(m && m.photo_url){ var im=new Image(); im.decoding="sync"; im.src=m.photo_url; } });
  }
  if(!_lifeResizeBound){ _lifeResizeBound = function(){ _lifeRelayout() }; window.addEventListener("resize", _lifeResizeBound); }
  _lifeRenderTopBar();
  _lifeSizeStage();
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeLoadSummary();
  // Telegram WebView can finalize its viewport a beat after mount — recompute
  // once it settles so the stage fills cleanly with no black gap at the bottom.
  setTimeout(function(){ if(tab==="life") _lifeRelayout() }, 280);
}

function lifeUnmount(){
  try{ document.documentElement.style.overflow=""; }catch(e){}   // restore page scroll
  _lifeEditMode = false; _lifeJourney = false; _lifeChall = false; _lifeFloatOn = false;
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF = null; }
  if(_lifeLongTimer){ clearTimeout(_lifeLongTimer); _lifeLongTimer = null; }
  if(_lifeBgTimer){ clearTimeout(_lifeBgTimer); _lifeBgTimer = null; }
  if(_lifeResizeBound){ window.removeEventListener("resize", _lifeResizeBound); _lifeResizeBound = null; }
  _lifeDrag = null;
}

// ─── Top bar: owner filter (Me / partner / Family) + back ─────
// The global app header is visible again (v8.51.1) — this is just the slim
// filter row beneath it, like the member-filter rows in Tasks/Money.
// The owner chips (avatars) live in their OWN persistent container that is built
// once and never re-rendered — recreating the <img> avatars on every month/mode
// switch made them re-decode and flash. Only the .on highlight toggles.
function _lifeChipsHTML(){
  var c = '';
  (D.members||[]).forEach(function(m){
    var on = _lifeOwner === String(m.user_id);
    c += '<button class="life-chip'+(on?' on':'')+'" data-o="'+m.user_id+'" onclick="_lifeSetOwner(\''+m.user_id+'\')">'+mAv(m.user_id,24)+'</button>';
  });
  c += '<button class="life-chip life-chip-fam'+(_lifeOwner==="family"?' on':'')+'" data-o="family" onclick="_lifeSetOwner(\'family\')">❤️</button>';
  return c;
}
function _lifeSyncChips(){
  var cc = document.getElementById("life-chips"); if(!cc) return;
  cc.querySelectorAll(".life-chip").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-o") === String(_lifeOwner));
  });
}
function _lifeRenderTopBar(){
  var el = document.getElementById("life-top"); if(!el) return;
  // First mount: split into a mutable main region + the persistent chips bar.
  if(!document.getElementById("life-chips")){
    el.innerHTML = '<div id="life-top-main"></div><div class="life-chips" id="life-chips">'+_lifeChipsHTML()+'</div>';
  }
  _lifeSyncChips();
  var cc = document.getElementById("life-chips");
  var main = document.getElementById("life-top-main");
  var h = '';
  if(_lifeJourney){
    h += '<button class="life-back" onclick="_lifeToggleJourney()" aria-label="Back">‹</button>';
    h += '<div class="life-areaname">'+tr("life_journey")+'</div><div style="flex:1"></div>';
  } else if(_lifeChall){
    h += '<button class="life-back" onclick="_lifeToggleChall()" aria-label="Back">‹</button>';
    h += '<div class="life-areaname">'+tr("life_challenges")+'</div><div style="flex:1"></div>';
  } else if(_lifeView === "area"){
    h += '<button class="life-back" onclick="_lifeBack()" aria-label="Back">‹</button>';
    var a = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
    h += '<div class="life-areaname">'+(a?a.emoji+' '+es(a.name):tr("nav_life"))+'</div>';
    h += '<div style="flex:1"></div>'+_lifeMonthNav();
  } else {
    h += '<button class="life-journey-btn" onclick="_lifeToggleJourney()" aria-label="Journey">📈</button>';
    h += '<button class="life-journey-btn" onclick="_lifeToggleChall()" aria-label="Challenges">🏆</button>';
    h += '<div style="flex:1"></div>'+_lifeMonthNav()+'<div style="flex:1"></div>';
  }
  if(main) main.innerHTML = h;
  // Chips hide in the area view (which shows its own month switcher instead).
  if(cc) cc.style.display = (_lifeView === "area" && !_lifeJourney && !_lifeChall) ? "none" : "";
  _lifeSizeStage();
}

// Calendar-style month switcher (centre). Next is disabled at the current month.
function _lifeMonthNav(){
  var atCur = !_lifeIsPast();
  return '<div class="life-mnav">'+
    '<button class="life-mnav-b" onclick="_lifeYMShift(-1)" aria-label="Prev">‹</button>'+
    '<span class="life-mnav-l">'+es(_lifeYMLabel())+'</span>'+
    '<button class="life-mnav-b'+(atCur?' off':'')+'" '+(atCur?'disabled':'')+' onclick="_lifeYMShift(1)" aria-label="Next">›</button>'+
    '</div>';
}

// Member lookup within the loaded summary.
function _lifeMember(uid){
  return ((_lifeData && _lifeData.members) || []).find(function(m){ return String(m.user_id) === String(uid) });
}


// Size the night-sky stage to fill from below the filter row to above the nav.
// Runs on mount + resize (header height varies by device, so measure, don't guess).
function _lifeSizeStage(){
  var st = document.querySelector(".life-stage"); if(!st) return;
  // Measure the ACTUAL rendered positions of the stage top and the nav top —
  // this avoids fragile --nh + safe-area math (Telegram WebView's dynamic
  // viewport makes window.innerHeight unreliable, leaving a black gap). The
  // stage fills exactly from its top down to where the nav begins.
  var stTop = st.getBoundingClientRect().top;
  var nav = document.querySelector(".nv");
  var navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
  var h = navTop - stTop;
  st.style.height = Math.max(300, h) + "px";
  // Resize the backing canvas to match (this clears it) → repaint the current graph.
  _lifeCanvasSetup();
  if(_lifeNodes && _lifeNodes.length) _lifeRender();
}
var _lifeResizeBound = null;

// Resize/rotate → recompute the viewBox aspect + relayout the current view so
// the ellipse keeps filling the stage and circles stay round.
function _lifeRelayout(){
  _lifeSizeStage();
  if(!_lifeData) return;
  if(_lifeView === "area") _lifeBuildArea(); else _lifeBuildConstellation();
}

function _lifeSetOwner(o){
  if(_lifeOwner === o) return;
  _lifeOwner = o; _lifeEditMode = false; hp("sel");
  _lifeRenderTopBar();
  if(_lifeJourney){ _lifeLoadJourney(); return; }  // stay in Journey, reload for the new owner
  if(_lifeChall){ _lifeChallTab="current"; _lifeLoadSummary(); _lifeLoadChall(); return; } // need areas for the picker + challenges
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeLoadSummary();
}

// ─── Journey (stats over the owner scope) ─────────────────────
function _lifeToggleJourney(){
  _lifeJourney = !_lifeJourney;
  hp(_lifeJourney ? "med" : "light");
  var jv = document.getElementById("life-journey"), svg = document.getElementById("life-cv");
  if(_lifeJourney){
    _lifeFloatOn = false;
    if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF = null; }  // pause the graph
    _lifeEditMode = false; _lifeChall = false; _lifeView = "constellation"; _lifeAreaId = null;
    var cv0 = document.getElementById("life-chall"); if(cv0) cv0.style.display = "none";
    if(jv){ jv.style.display = "block"; jv.innerHTML = '<div class="life-jload">…</div>'; }
    if(svg) svg.style.display = "none";
    _lifeSetHint("");
    _lifeRenderTopBar();
    _lifeLoadJourney();
  } else {
    if(jv) jv.style.display = "none";
    if(svg) svg.style.display = "block";
    _lifeRenderTopBar();
    _lifeBuildConstellation();
    _lifeSetHint(_lifeData && _lifeData.scope==="family" ? tr("life_hint_family") : tr("life_hint_personal"));
  }
}
async function _lifeLoadJourney(){
  var j = await A("GET","/api/life/journey?owner="+encodeURIComponent(_lifeOwner)+"&ym="+_lifeYMv());
  if(!j || !_lifeJourney || tab!=="life") return;
  _lifeRenderJourney(j);
}
function _lifeSpark(daily, color){
  var n = daily.length; if(n < 2) return '';
  var mx = Math.max(1, daily.reduce(function(m,d){return Math.max(m,d.count)},0));
  var H = 30, pts = daily.map(function(d,i){ return ((i/(n-1))*100).toFixed(1)+','+(H-(d.count/mx)*H).toFixed(1) }).join(' ');
  return '<svg class="life-spark" viewBox="0 0 100 '+H+'" preserveAspectRatio="none">'+
    '<defs><linearGradient id="lspk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+color+'" stop-opacity="0.35"/><stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+
    '<polygon points="0,'+H+' '+pts+' 100,'+H+'" fill="url(#lspk)"/>'+
    '<polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'+
  '</svg>';
}
function _lifeRenderJourney(j){
  var jv = document.getElementById("life-journey"); if(!jv) return;
  var isFam = j.scope === "family";
  var accent = isFam ? "#E06A8A" : "#7FB069";
  var balPct = Math.round((j.balance||0)*100);
  var st = j.stats || {};
  var h = '';
  // Hero
  h += '<div class="life-jhero">';
  h += '<div class="life-jbal" style="color:'+accent+'">'+balPct+'%</div>';
  h += '<div class="life-jlabel">'+(isFam ? tr("life_connection") : tr("life_balance"))+'</div>';
  h += '</div>';
  // Activity sparkline
  if((j.stats||{}).events){
    h += '<div class="life-jsec">'+tr("life_j_activity")+'</div>';
    h += '<div class="life-jspark-wrap">'+_lifeSpark(j.daily||[], accent)+'</div>';
  }
  // Stat tiles
  h += '<div class="life-jstats">';
  [[st.events||0, tr("life_j_events")],[st.total_count||0, tr("life_j_total")],
   [st.completions_7d||0, tr("life_j_this_week")],[(st.top_event||"—"), tr("life_j_top")]
  ].forEach(function(t){
    h += '<div class="life-jstat"><div class="life-jstat-v" style="font-size:'+(typeof t[0]==="string"&&t[0].length>3?"15px":"22px")+'">'+es(String(t[0]))+'</div><div class="life-jstat-l">'+t[1]+'</div></div>';
  });
  h += '</div>';
  // Per-area bars
  if((j.areas||[]).length){
    h += '<div class="life-jsec">'+(isFam ? tr("nav_life") : tr("life_journey"))+'</div>';
    h += '<div class="life-jbars">';
    (j.areas||[]).slice().sort(function(a,b){return (b.brightness||0)-(a.brightness||0)}).forEach(function(a){
      var pct = Math.round((a.brightness||0)*100);
      h += '<div class="life-jbar">';
      h += '<div class="life-jbar-name">'+es(a.emoji)+' '+es(a.name)+'</div>';
      h += '<div class="life-jbar-track"><div class="life-jbar-fill" style="width:'+pct+'%;background:'+a.color+'"></div></div>';
      h += '<div class="life-jbar-pct">'+pct+'%</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  if(!(j.stats||{}).events){
    h += '<div class="life-jempty">'+tr("life_j_empty")+'</div>';
  }
  jv.innerHTML = h;
}

// ─── Challenges (time-bound goals) ────────────────────────────
function _lifeToggleChall(){
  _lifeChall = !_lifeChall;
  hp(_lifeChall ? "med" : "light");
  var cv = document.getElementById("life-chall"), svg = document.getElementById("life-cv");
  var jv = document.getElementById("life-journey");
  if(_lifeChall){
    _lifeFloatOn = false;
    if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF = null; }
    _lifeEditMode = false; _lifeJourney = false; _lifeView = "constellation"; _lifeAreaId = null;
    if(jv) jv.style.display = "none";
    if(cv){ cv.style.display = "block"; cv.innerHTML = '<div class="life-jload">…</div>'; }
    if(svg) svg.style.display = "none";
    _lifeSetHint("");
    _lifeRenderTopBar();
    _lifeLoadChall();
  } else {
    if(cv) cv.style.display = "none";
    if(svg) svg.style.display = "block";
    _lifeRenderTopBar();
    _lifeBuildConstellation();
    _lifeSetHint(_lifeData && _lifeData.scope==="family" ? tr("life_hint_family") : tr("life_hint_personal"));
  }
}
async function _lifeLoadChall(){
  var d = await A("GET","/api/life/challenges?owner="+encodeURIComponent(_lifeOwner));
  if(!d || !_lifeChall || tab!=="life") return;
  _lifeChallData = d;
  _lifeRenderChall();
}
var _lifeChallData = null;
function _lifeRenderChall(){
  var cv = document.getElementById("life-chall"); if(!cv || !_lifeChallData) return;
  var all = _lifeChallData.challenges || [];
  var current = all.filter(function(c){return c.status==="active"});
  var doneList = all.filter(function(c){return c.status!=="active"});
  var list = _lifeChallTab==="current" ? current : doneList;
  var h = '';
  // Tabs
  h += '<div class="life-chtabs">';
  h += '<button class="life-chtab'+(_lifeChallTab==="current"?" on":"")+'" onclick="_lifeChallTab=\'current\';_lifeRenderChall()">'+tr("life_ch_current")+' '+current.length+'</button>';
  h += '<button class="life-chtab'+(_lifeChallTab==="completed"?" on":"")+'" onclick="_lifeChallTab=\'completed\';_lifeRenderChall()">'+tr("life_ch_completed")+' '+doneList.length+'</button>';
  h += '</div>';
  // Action buttons
  h += '<div class="life-chacts">';
  h += '<button class="life-chbtn" onclick="_lifeOpenNewChall()">'+icon("pl",13,2.5)+' '+tr("life_ch_new")+'</button>';
  h += '<button class="life-chbtn life-chbtn-ai" onclick="_lifeSuggestChall()">✨ '+tr("life_ideas")+'</button>';
  h += '</div>';
  if(!list.length){
    h += '<div class="life-jempty">'+tr(_lifeChallTab==="current"?"life_ch_empty_current":"life_ch_empty_completed")+'</div>';
  } else {
    list.forEach(function(c){ h += _lifeChallCard(c); });
  }
  cv.innerHTML = h;
}
function _lifeChMemberColor(uid){
  var m=(D.members||[]).find(function(x){return x.user_id===uid}); return (m&&m.color)||"#8B7BE8";
}
function _lifeChallCard(c){
  var accent = _lifeChallData.scope==="family"?"#E06A8A":"#8B7BE8";
  var sub = c.subject ? es(c.subject) : tr("life_ch_anything");
  var kindTxt = c.kind==="score" ? tr("life_ch_kind_score")
    : (c.kind==="streak" ? (c.target+" "+tr("life_ch_days_row")) : (c.target+" "+tr("life_ch_times")));
  var right = '';
  if(c.status==="done") right = '<span class="life-chstate" style="color:#7FB069">'+(c.kind==="score"?'🏁 '+tr("life_ch_ended"):'✓ '+tr("life_ch_done"))+'</span>';
  else if(c.status==="failed") right = '<span class="life-chstate" style="color:#C77D7D">'+tr("life_ch_failed")+'</span>';
  else right = '<span class="life-chstate">'+trn("life_ch_days_left", c.days_left)+'</span>';
  var h = '<div class="life-chcard">';
  h += '<div class="life-chcard-top"><div class="life-chcard-em">'+es(c.emoji||"🏆")+'</div>';
  h += '<div class="life-chcard-bd"><div class="life-chcard-t">'+es(c.title)+'</div><div class="life-chcard-s">'+sub+' · '+kindTxt+'</div></div>';
  h += '<button class="life-chcard-x" onclick="_lifeDeleteChall('+c.id+')" aria-label="Delete">'+icon("tr",13,2)+'</button></div>';
  if(c.kind==="score" && c.participants && c.participants.length){
    // Manual scoreboard — each participant has +/- controls.
    h += '<div class="life-score">';
    c.participants.forEach(function(p){
      var col = _lifeChMemberColor(p.user_id);
      h += '<div class="life-score-row">'+mAv(p.user_id,26)+
           '<div class="life-score-name">'+es(mName(p.user_id))+'</div>'+
           '<button class="life-score-b" onclick="_lifeScore('+c.id+','+p.user_id+',-1)">−</button>'+
           '<div class="life-score-v" style="color:'+col+'">'+p.progress+'</div>'+
           '<button class="life-score-b" onclick="_lifeScore('+c.id+','+p.user_id+',1)">+</button></div>';
    });
    h += '</div>';
  } else if(c.participants && c.participants.length){
    // Per-person leaderboard (count/streak).
    h += '<div class="life-chparts">';
    c.participants.slice().sort(function(a,b){return b.progress-a.progress}).forEach(function(p){
      var pct = Math.min(100, Math.round((p.progress/Math.max(1,c.target))*100));
      var col = p.done ? "#7FB069" : accent;
      h += '<div class="life-chpart">'+mAv(p.user_id,22)+
           '<div class="life-chprog-track" style="flex:1"><div class="life-chprog-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'+
           '<div class="life-chprog-r">'+(p.done?'<span style="color:#7FB069">✓ </span>':'')+'<b>'+p.progress+'</b>/'+c.target+'</div></div>';
    });
    h += '</div>';
  } else {
    var pct = Math.min(100, Math.round((c.progress/Math.max(1,c.target))*100));
    var col = c.status==="done" ? "#7FB069" : (c.status==="failed" ? "#C77D7D" : accent);
    h += '<div class="life-chprog"><div class="life-chprog-track"><div class="life-chprog-fill" style="width:'+pct+'%;background:'+col+'"></div></div>';
    h += '<div class="life-chprog-r"><b>'+c.progress+'</b>/'+c.target+'</div></div>';
  }
  h += '<div class="life-chcard-foot">'+right+'</div>';
  h += '</div>';
  return h;
}
async function _lifeScore(cid, uid, delta){
  hp(delta>0?"ok":"light");
  var r = await A("POST","/api/life/challenges/"+cid+"/score", {user_id:uid, delta:delta});
  if(!r || !r.id){ toast(tr("ts_error")); return }
  // Patch the loaded list in place + re-render (no full reload flicker).
  if(_lifeChallData){ var i=(_lifeChallData.challenges||[]).findIndex(function(x){return x.id===cid}); if(i>=0) _lifeChallData.challenges[i]=r; }
  _lifeRenderChall();
}
async function _lifeDeleteChall(id){
  if(!confirm(tr("life_ch_delete_confirm"))) return;
  var r = await A("DELETE","/api/life/challenges/"+id);
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  hp("warn"); await _lifeLoadChall();
}
// Create modal — score-only scoreboard challenge: title/emoji, period, players.
function _lifeOpenNewChall(){
  // Score challenges default both partners in (a little scoreboard).
  var preParts = (D.members||[]).length>1 ? (D.members||[]).map(function(m){return m.user_id}) : [];
  _lifeChallDraft = {emoji:"🏆", kind:"score", target:0, period:7, participants:preParts.slice()};
  var h = '';
  h += '<div style="display:flex;gap:10px;align-items:flex-end">';
  h += '<div><div class="lb">'+tr("g_emoji")+'</div><input class="inp" id="ch-e" value="🏆" style="width:64px;text-align:center;font-size:20px"></div>';
  h += '<div style="flex:1"><div class="lb">'+tr("life_ch_name")+'</div><input class="inp" id="ch-t" placeholder="'+tr("life_ch_title_ph")+'"></div>';
  h += '</div>';
  h += '<div class="lb">'+tr("life_ch_period")+'</div><div class="or" id="ch-period">';
  [7,14,30].forEach(function(p){ h += '<button class="ob '+(p===7?"s":"")+'" onclick="_lifeChPeriod(this,'+p+')">'+p+' '+tr("life_ch_days")+'</button>'; });
  h += '<button class="ob" id="ch-p-custom" onclick="_lifeChPeriodCustom(this)">📅 '+tr("life_ch_until")+'</button>';
  h += '</div>';
  h += '<input type="date" class="inp" id="ch-date" style="display:none;margin-top:8px" onchange="_lifeChDate(this)">';
  // Participants — pick who's in; each keeps their own score.
  if((D.members||[]).length > 1){
    h += '<div class="lb">'+tr("life_ch_participants")+'</div><div class="or" id="ch-parts">';
    (D.members||[]).forEach(function(m){
      var on = preParts.indexOf(m.user_id) >= 0;
      h += '<button class="ob life-pchip'+(on?" s":"")+'" data-u="'+m.user_id+'" onclick="_lifeChToggleP(this,'+m.user_id+')">'+mAv(m.user_id,20)+'<span>'+es(m.user_name)+'</span></button>';
    });
    h += '</div><div style="font-size:11px;color:var(--ht);margin-top:5px">'+tr("life_ch_participants_hint")+'</div>';
  }
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveChall()">'+tr("life_ch_create")+'</button>';
  oMC(tr("life_ch_new"), h, {ic:"life"});
}
function _lifeChPeriodCustom(btn){
  document.querySelectorAll("#ch-period .ob").forEach(function(b){b.classList.remove("s")});
  btn.classList.add("s");
  var d=document.getElementById("ch-date"); if(d){ d.style.display="block"; d.min=td(); try{d.showPicker&&d.showPicker()}catch(e){} }
}
function _lifeChDate(inp){
  if(!inp.value) return;
  var ms = new Date(inp.value+"T23:59:59") - new Date();
  _lifeChallDraft.period = Math.max(1, Math.ceil(ms/86400000));
}
function _lifeChPeriod(btn, p){
  _lifeChallDraft.period = p;
  var d=document.getElementById("ch-date"); if(d) d.style.display="none";
  document.querySelectorAll("#ch-period .ob").forEach(function(b){b.classList.remove("s")});
  btn.classList.add("s");
}
function _lifeChToggleP(btn, uid){
  btn.classList.toggle("s");
  var arr = _lifeChallDraft.participants || [];
  var i = arr.indexOf(uid);
  if(i>=0) arr.splice(i,1); else arr.push(uid);
  _lifeChallDraft.participants = arr;
}
async function _lifeSaveChall(){
  var d = _lifeChallDraft;
  var title = ((document.getElementById("ch-t")||{}).value||"").trim();
  if(!title){ toast(tr("life_name_required")); return }
  var emoji = (document.getElementById("ch-e")||{}).value || "🏆";
  var body = {owner:_lifeOwner, title:title, emoji:emoji, kind:"score", target:0, period_days:d.period};
  var parts = d.participants||[];
  if(parts.length) body.participants = parts;
  var r = await A("POST","/api/life/challenges", body);
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); cMo(); _lifeChallTab="current";
  // Group challenges live under the Family scope — jump there so it's visible.
  if(parts.length && _lifeOwner!=="family"){ _lifeOwner="family"; _lifeLoadSummary(); _lifeRenderTopBar(); }
  await _lifeLoadChall();
}
// AI suggestions for challenges
async function _lifeSuggestChall(){
  hp("light");
  oMC(tr("life_challenges"), '<div class="life-thinking">✨ '+tr("life_thinking")+'</div>', {ic:"life"});
  var r;
  try{ r = await A("POST","/api/life/challenges/suggest", {owner:_lifeOwner}); }catch(e){ r=null; }
  var mb = document.getElementById("mb");
  if(!r || !r.suggestions || !r.suggestions.length){
    if(mb) mb.innerHTML = '<div style="text-align:center;color:var(--ht);padding:24px 12px">'+tr("life_no_ideas")+'</div><button class="btn btn-s" style="background:transparent;border:1px solid var(--bd);color:var(--tx)" onclick="cMo()">'+tr("btn_close")+'</button>';
    return;
  }
  _lifeChallSugg = r.suggestions.map(function(s){ s._added=false; return s; });
  _lifeRenderChallSugg();
}
function _lifeRenderChallSugg(){
  var mb = document.getElementById("mb"); if(!mb) return;
  var areas = (_lifeData && _lifeData.areas) || [];
  var aName = function(id){ var a=areas.find(function(x){return x.id===id}); return a?a.emoji+" "+a.name:""; };
  var h = '<div class="life-sugg-list">';
  _lifeChallSugg.forEach(function(s,i){
    var kindTxt = s.kind==="streak" ? (s.target+" "+tr("life_ch_days_row")) : (s.target+" "+tr("life_ch_times"));
    h += '<div class="life-sugg"><div class="life-sugg-em">'+es(s.emoji||"🏆")+'</div>';
    h += '<div class="life-sugg-bd"><div class="life-sugg-n">'+es(s.title)+'</div><div class="life-sugg-w">'+kindTxt+' · '+s.period_days+' '+tr("life_ch_days")+(s.area_id?' · '+es(aName(s.area_id)):'')+'</div></div>';
    if(s._added) h += '<span class="life-sugg-ok" style="color:var(--pr)">'+icon("ck",16,2.5)+'</span>';
    else h += '<button class="life-sugg-add" style="background:var(--pr)" onclick="_lifeAddSuggChall('+i+')">'+icon("pl",13,2.5)+'</button>';
    h += '</div>';
  });
  h += '</div><button class="btn btn-s" style="margin-top:12px;background:transparent;border:1px solid var(--bd);color:var(--tx)" onclick="cMo()">'+tr("btn_done")+'</button>';
  mb.innerHTML = h;
}
async function _lifeAddSuggChall(i){
  var s = _lifeChallSugg[i]; if(!s || s._added) return;
  var r = await A("POST","/api/life/challenges", {owner:_lifeOwner, title:s.title, emoji:s.emoji, kind:s.kind, target:s.target, period_days:s.period_days, area_id:s.area_id||null});
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); s._added=true; _lifeRenderChallSugg();
  _lifeChallTab="current"; _lifeLoadChall();
}

function _lifeBack(){
  hp("light");
  _lifeEditMode = false;
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeRenderTopBar();
  _lifeBuildConstellation();
}

// ─── Data ─────────────────────────────────────────────────────
// In-memory cache keyed by owner+month (summary) / owner+area+month (events).
// Revisiting a sphere or switching back to a month you've seen renders instantly
// with no request. Mutations keep it in sync (in-place) or invalidate it.
var _lifeCache = { sum:{}, ev:{} };
function _lifeSumKey(){ return _lifeOwner+"|"+_lifeYMv(); }
function _lifeEvKey(area){ return _lifeOwner+"|"+area+"|"+_lifeYMv(); }
function _lifeInvalidateSummary(){ _lifeCache.sum = {}; }   // event_count changed → bond/brightness stale

async function _lifeLoadSummary(){
  var key = _lifeSumKey();
  if(_lifeCache.sum[key]){
    _lifeData = _lifeCache.sum[key];
    if(_lifeData.cur_ym) _lifeCurYMStr = _lifeData.cur_ym;
    if(tab==="life" && _lifeView==="constellation") _lifeBuildConstellation();
    return;
  }
  var d = await A("GET","/api/life/summary?owner="+encodeURIComponent(_lifeOwner)+"&ym="+_lifeYMv());
  if(!d || !d.areas){ return }
  _lifeCache.sum[key] = d;
  _lifeData = d;
  if(d.cur_ym) _lifeCurYMStr = d.cur_ym;
  if(tab==="life" && _lifeView==="constellation") _lifeBuildConstellation();
}

async function _lifeLoadArea(areaId){
  var key = _lifeEvKey(areaId);
  if(_lifeCache.ev[key]){
    _lifeAreaHabits = _lifeCache.ev[key];   // same ref → in-place bumps/pins stay in sync
    if(tab==="life" && _lifeView==="area") _lifeBuildArea();
    return;
  }
  var d = await A("GET","/api/life/events?owner="+encodeURIComponent(_lifeOwner)+"&area_id="+encodeURIComponent(areaId)+"&ym="+_lifeYMv());
  if(d && d.cur_ym) _lifeCurYMStr = d.cur_ym;
  _lifeAreaHabits = (d && d.events) || [];
  _lifeCache.ev[key] = _lifeAreaHabits;
  if(tab==="life" && _lifeView==="area") _lifeBuildArea();
}

// ─── Layout helpers ───────────────────────────────────────────
// The viewBox width is fixed at 100 units; the HEIGHT adapts to the stage's
// pixel aspect ratio so 1 unit = same px in x and y (uniform scale → node
// circles stay round). Satellites sit on an ellipse that fills the portrait
// space, so there's no letterbox "air" above/below (v8.51.2).
var _lifeVbH = 130;
function _lifeComputeVb(){
  var st = document.querySelector(".life-stage");
  var w = st ? st.clientWidth : 360, h = st ? st.clientHeight : 520;
  _lifeVbH = Math.max(104, Math.min(210, Math.round(100 * h / Math.max(1, w))));
}
function _lifeCx(){ return 50; }
function _lifeCy(){ return _lifeVbH/2; }
// Ellipse ring around the centre. rx fills width, ry fills height (minus padding
// for node radius + caption).
function _lifeRing(n, startDeg){
  var cx = _lifeCx(), cy = _lifeCy();
  // True CIRCLE (rx == ry in user units → visually round since scale is uniform).
  // The constellation sits centred with symmetric air above/below instead of
  // stretching to the edges. Clamped so it never overflows a short stage.
  var R = Math.min(33, _lifeVbH/2 - 16);
  var rx = R, ry = R;
  var out = [], start = (startDeg==null? -90 : startDeg) * Math.PI/180;
  for(var i=0;i<n;i++){
    var ang = start + i*(2*Math.PI/Math.max(1,n));
    out.push({x: cx + rx*Math.cos(ang), y: cy + ry*Math.sin(ang)});
  }
  return out;
}

// Node radius: small base, +5% per distinct event (gentle growth), capped.
function _lifeNodeR(brightness, count){
  var base = 5.0;
  return base * Math.min(1.7, 1 + 0.05*(count||0));
}
// Stable per-node random jitter + drift phase → breaks the rigid cross layout and
// gives each node its own floating rhythm. Cached by id so it doesn't jump on redraw.
function _lifeJit(id){
  if(!_lifeJitter[id]) _lifeJitter[id] = {
    dx:(Math.random()-0.5)*5.2, dy:(Math.random()-0.5)*5.2,
    ph:Math.random()*6.283, amp:0.9+Math.random()*0.7
  };
  return _lifeJitter[id];
}
// Apply jitter + float fields to a freshly-built satellite node (in place).
function _lifeFloatify(nd){
  var j=_lifeJit(nd.id);
  nd.hx += j.dx; nd.hy += j.dy; nd.x = nd.hx; nd.y = nd.hy;
  nd.bhx = nd.hx; nd.bhy = nd.hy; nd.phase = j.ph; nd.driftA = j.amp;
  return nd;
}

// Capture/restore current node positions by id so a rebuild (e.g. the post-mount
// relayout, or add/delete) eases from where things were instead of snapping back
// to the ring — that snap was the "jerk on entering the Life tab".
function _lifeCapturePos(){ var p={}; (_lifeNodes||[]).forEach(function(n){ p[n.id]={x:n.x,y:n.y}; }); return p; }
function _lifeRestorePos(prev){ if(!prev) return; _lifeNodes.forEach(function(n){ var q=prev[n.id]; if(q){ n.x=q.x; n.y=q.y; } }); }

// ─── Build: constellation (L0) ────────────────────────────────
function _lifeBuildConstellation(){
  if(!_lifeData) return;
  var _prev = _lifeCapturePos();
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF=null; } // drop any stale loop
  _lifeComputeVb();
  var cx = _lifeCx(), cy = _lifeCy();
  var areas = _lifeData.areas || [];
  var isFam = _lifeData.scope === "family";
  // Spheres are editable in edit mode (personal AND family): a "+" seed grows
  // out of the centre to add a new one.
  var addSphere = _lifeEditMode;
  var n = areas.length + (addSphere ? 1 : 0);
  var pts = _lifeRing(n, -90);
  _lifeNodes = [];
  // Center hub
  _lifeNodes.push({
    id:"_hub", type:"hub", hx:cx, hy:cy, x:cx, y:cy, vx:0, vy:0,
    r: isFam ? 9.5 : 8.5,
    color: isFam ? "#E06A8A" : "#A9A48F",
    label: isFam ? tr("life_us") : tr("life_you"),
    emoji: "", bright: isFam ? (_lifeData.bond||0) : 0.5,
  });
  areas.forEach(function(a, i){
    _lifeNodes.push(_lifeFloatify({
      id:a.id, type:"area", hx:pts[i].x, hy:pts[i].y, x:pts[i].x, y:pts[i].y, vx:0, vy:0,
      r:_lifeNodeR(a.brightness, (a.event_count!=null?a.event_count:a.habit_count)), color:a.color,
      label:a.name, emoji:a.emoji, bright:a.brightness, count:(a.event_count!=null?a.event_count:a.habit_count), is_custom:a.is_custom,
    }));
  });
  if(addSphere){
    var sp = pts[n-1];
    _lifeNodes.push(_lifeFloatify({id:"_addarea", type:"addarea", hx:sp.x, hy:sp.y, x:sp.x, y:sp.y, vx:0, vy:0, r:5.6, color:"#A9A48F"}));
  }
  _lifeEdges = _lifeNodes.filter(function(nd){return nd.id!=="_hub" && nd.type!=="avatar"}).map(function(nd){return ["_hub", nd.id]});
  _lifeAvEdges = [];
  _lifeOrbiting = false;
  if(isFam){
    // Two avatars as real physics nodes: they orbit the centre AND spring toward
    // their moving anchor + toward each other, so dragging anything makes the
    // pair wobble elastically instead of staying rigidly locked.
    _lifeBond = Math.max(0, Math.min(1, _lifeData.bond || 0));
    _lifeOrbitR = 7.0 - _lifeBond*1.0;
    var mems = (_lifeData.members || []).slice(0, 2);
    var a0 = _lifeOrbitAngle, a1 = a0 + Math.PI;
    _lifeNodes.push({ id:"_av0", type:"avatar", member:mems[0],
      hx:cx+_lifeOrbitR*Math.cos(a0), hy:cy+_lifeOrbitR*Math.sin(a0),
      x:cx+_lifeOrbitR*Math.cos(a0), y:cy+_lifeOrbitR*Math.sin(a0),
      vx:0, vy:0, r:4.3, khome:0.10 });
    _lifeNodes.push({ id:"_av1", type:"avatar", member:mems[1]||mems[0],
      hx:cx+_lifeOrbitR*Math.cos(a1), hy:cy+_lifeOrbitR*Math.sin(a1),
      x:cx+_lifeOrbitR*Math.cos(a1), y:cy+_lifeOrbitR*Math.sin(a1),
      vx:0, vy:0, r:4.3, khome:0.10 });
    // Physics edges: each avatar to the hub, and the two avatars to each other
    // (the inter-avatar spring is what makes them feel connected).
    _lifeAvEdges = [["_hub","_av0"], ["_hub","_av1"], ["_av0","_av1"]];
    _lifeOrbiting = true;
  }
  _lifeRestorePos(_prev);   // keep existing nodes where they were → no snap on rebuild
  _lifeDraw();
  _lifeSetHint(isFam ? tr("life_hint_family") : tr("life_hint_personal"));
  // Continuous gentle float (organic drift) — also keeps edges centre-to-centre.
  _lifeFloatOn = (_lifeNodes.length <= 18); if(_lifeFloatOn) _lifeWakeFloat(); else _lifeStartSim();
}

// ─── Build: inside an area (L1) ───────────────────────────────
function _lifeBuildArea(){
  var area = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  if(!area) return;
  var _prev = _lifeCapturePos();
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF=null; }
  _lifeOrbiting = false; _lifeAvEdges = [];
  _lifeComputeVb();
  var cx = _lifeCx(), cy = _lifeCy();
  var events = _lifeAreaHabits || [];
  var past = _lifeIsPast();
  // The "+" Add and "✨ Ideas" seeds appear in edit mode (current month only —
  // past months are read-only). Re-living an event grows it; bigger counter →
  // bigger satellite (the mechanic the old streak occupied).
  var withSeeds = _lifeEditMode && !past;
  var n = events.length + (withSeeds ? 2 : 0);
  var pts = _lifeRing(n, -90);
  _lifeNodes = [];
  _lifeNodes.push({
    id:"_hub", type:"areahub", hx:cx, hy:cy, x:cx, y:cy, vx:0, vy:0,
    r:10, color:area.color, label:area.name, emoji:area.emoji, bright:area.brightness,
  });
  events.forEach(function(ev, i){
    var cnt = ev.count||1;
    _lifeNodes.push(_lifeFloatify({
      id:"h"+ev.id, hid:ev.id, type:"habit", hx:pts[i].x, hy:pts[i].y, x:pts[i].x, y:pts[i].y, vx:0, vy:0,
      r: 5.0 * Math.min(1.5, 1 + 0.06*(cnt-1)), color:area.color,
      label:ev.name, emoji:ev.emoji||"•", bright:Math.min(1,0.2+0.12*(cnt-1)), count:cnt, pinned:!!ev.pinned,
    }));
  });
  if(withSeeds){
    var ap = pts[n-2];
    _lifeNodes.push(_lifeFloatify({id:"_add", type:"add", hx:ap.x, hy:ap.y, x:ap.x, y:ap.y, vx:0, vy:0, r:5.4, color:area.color}));
    var ip = pts[n-1];
    _lifeNodes.push(_lifeFloatify({id:"_ideas", type:"ideas", hx:ip.x, hy:ip.y, x:ip.x, y:ip.y, vx:0, vy:0, r:5.4, color:area.color}));
  }
  _lifeEdges = _lifeNodes.filter(function(nd){return nd.id!=="_hub"}).map(function(nd){return ["_hub", nd.id]});
  _lifeRestorePos(_prev);   // keep existing nodes where they were → no snap on rebuild
  _lifeDraw();
  _lifeSetHint(past ? tr("life_past_ro") : (events.length ? tr("life_hint_events") : tr("life_hint_events_empty")));
  _lifeFloatOn = (_lifeNodes.length <= 18); if(_lifeFloatOn) _lifeWakeFloat(); else _lifeStartSim();   // gentle float + keeps edges synced
}

var _lifeEdges = [];      // drawn gray spokes (hub → satellites)
var _lifeAvEdges = [];    // physics-only edges among the family avatars (hub↔av, av↔av)
// Family orbit state — the two avatars are real physics nodes that slowly orbit
// AND spring toward their moving orbit anchor + toward each other (v8.51.7).
var _lifeOrbiting = false;
var _lifeOrbitAngle = -Math.PI/2;
var _lifeOrbitR = 7;
var _lifeBond = 0;

function _lifeSetHint(t){ var el=document.getElementById("life-hint"); if(el) el.textContent = t||""; }

// ─── SVG draw ─────────────────────────────────────────────────
// Persistent skeleton: defs / edges / nodes / avatars live in their own groups.
// Only edges + nodes (+ defs) get rebuilt on a redraw; the avatar layer is kept
// so its <image>s never re-decode (no flicker on edit / month / add / delete).
function _lifeDraw(){
  var ctx = _lifeCanvasSetup(); if(!ctx) return;
  // Index for O(1) lookups in the sim + hit-test (no per-frame querySelector).
  _lifeIndexMap = {};
  _lifeNodes.forEach(function(n){ _lifeIndexMap[n.id] = n; });
  _lifeBindPointer(document.getElementById("life-cv"));
  _lifeRender();
  // Belt-and-suspenders: keep the page pinned to the top on every (re)build, so a
  // stray focus/programmatic scroll (e.g. the add-event input) can't leave the
  // .life-top bar tucked under the sticky header.
  try{ document.documentElement.scrollTop=0; document.body.scrollTop=0; }catch(e){}
}

// ── Canvas plumbing ───────────────────────────────────────────
var _lifeCtx = null, _lifeCvW = 0, _lifeCvH = 0;        // context + backing px size
var _lifeScale = 1, _lifeOffX = 0, _lifeOffY = 0;       // CSS-px per user unit + meet offsets
var _lifeGlowSprites = {};                              // color → baked radial-glow canvas
var _lifeRipples = [];                                  // active tap ripples {x,y,r,color,t0}
var _lifeAvImgCache = {};                               // photo_url → HTMLImageElement
var _LIFE_TAU = Math.PI*2;

// (Re)size the canvas to the stage, DPR-aware, and set a transform so we can draw
// in the SVG-era USER UNITS (0..100 x, 0.._lifeVbH y). xMidYMid-meet: uniform
// scale, centre any leftover — identical framing to the old <svg> viewBox.
function _lifeCanvasSetup(){
  var cv = document.getElementById("life-cv"); if(!cv) return null;
  var st = cv.parentNode; if(!st) return null;
  _lifeComputeVb();
  var wCss = st.clientWidth || 360;
  var hCss = st.clientHeight || parseInt(st.style.height,10) || 520;
  var dpr = window.devicePixelRatio || 1;
  var bw = Math.max(1, Math.round(wCss*dpr)), bh = Math.max(1, Math.round(hCss*dpr));
  if(cv.width !== bw)  cv.width = bw;
  if(cv.height !== bh) cv.height = bh;
  cv.style.width = wCss+"px"; cv.style.height = hCss+"px";
  _lifeCvW = bw; _lifeCvH = bh;
  var s = Math.min(wCss/100, hCss/_lifeVbH);
  _lifeScale = s; _lifeOffX = (wCss - 100*s)/2; _lifeOffY = (hCss - _lifeVbH*s)/2;
  var ctx = cv.getContext("2d");
  ctx.setTransform(s*dpr, 0, 0, s*dpr, _lifeOffX*dpr, _lifeOffY*dpr);
  _lifeCtx = ctx;
  return ctx;
}

// Mix a hex colour toward grey (sat 0..1 = how much of the real colour to keep).
function _lifeDesat(hex, sat){
  var c = String(hex||"").replace("#",""); if(c.length===3) c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  if(c.length<6) return hex;
  var r=parseInt(c.substr(0,2),16), g=parseInt(c.substr(2,2),16), b=parseInt(c.substr(4,2),16);
  var G=112; sat=Math.max(0,Math.min(1,sat));
  return 'rgb('+Math.round(r*sat+G*(1-sat))+','+Math.round(g*sat+G*(1-sat))+','+Math.round(b*sat+G*(1-sat))+')';
}
function _lifeNodeById(id){ if(_lifeIndexMap && _lifeIndexMap[id]) return _lifeIndexMap[id]; for(var i=0;i<_lifeNodes.length;i++) if(_lifeNodes[i].id===id) return _lifeNodes[i]; return null; }
function _lifeHex(c){ var n=String(c).replace("#",""); if(n.length===3)n=n[0]+n[0]+n[1]+n[1]+n[2]+n[2]; return [parseInt(n.substr(0,2),16)||0, parseInt(n.substr(2,2),16)||0, parseInt(n.substr(4,2),16)||0]; }

// Soft-glow sprite per colour: a radial-gradient disc baked ONCE, then stamped
// (drawImage) per node — the cheap-glow trick that makes many nodes free to paint.
// Stops mirror the old SVG gradient: 0%→0.50, 68%→0.08, 100%→0 alpha.
function _lifeGlowSprite(color){
  if(_lifeGlowSprites[color]) return _lifeGlowSprites[color];
  var S=128, oc=document.createElement("canvas"); oc.width=oc.height=S;
  var o=oc.getContext("2d"), rgb=_lifeHex(color);
  var g=o.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
  g.addColorStop(0,   'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.50)');
  g.addColorStop(0.68,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.08)');
  g.addColorStop(1,   'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0)');
  o.fillStyle=g; o.fillRect(0,0,S,S);
  _lifeGlowSprites[color]=oc; return oc;
}
function _lifeDrawGlow(ctx, n, glowR, alpha){
  ctx.globalAlpha = alpha;
  ctx.drawImage(_lifeGlowSprite(n.color), n.x-glowR, n.y-glowR, glowR*2, glowR*2);
  ctx.globalAlpha = 1;
}
// Centred text (replaces SVG text-anchor:middle + dominant-baseline:central).
function _lifeText(ctx, s, x, y, px, color, alpha, weight){
  ctx.globalAlpha = (alpha==null?1:alpha);
  ctx.fillStyle = color;
  ctx.font = (weight?weight+' ':'')+px+'px -apple-system,"Segoe UI",system-ui,sans-serif';
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}
// ── Per-frame paint — the whole graph in one pass, no DOM ──────
function _lifeRender(){
  var ctx = _lifeCtx || _lifeCanvasSetup(); if(!ctx) return;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,_lifeCvW,_lifeCvH); ctx.restore();
  _lifeDrawEdges(ctx);
  _lifeDrawBond(ctx);
  for(var i=0;i<_lifeNodes.length;i++) _lifeDrawNode(ctx, _lifeNodes[i]);
  _lifeDrawAvatars(ctx);
  _lifeDrawRipples(ctx);
}
// Gray spokes — always centre-to-centre, opacity grows with either end's brightness.
function _lifeDrawEdges(ctx){
  for(var i=0;i<_lifeEdges.length;i++){
    var a=_lifeIndexMap[_lifeEdges[i][0]], b=_lifeIndexMap[_lifeEdges[i][1]]; if(!a||!b) continue;
    var strength = Math.max(a.bright||0, b.bright||0);
    ctx.strokeStyle = 'rgba(155,150,168,'+(0.10+strength*0.35).toFixed(3)+')';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
}
// Family bond: a soft pink halo line + a brighter core line between the avatars.
function _lifeDrawBond(ctx){
  if(!_lifeOrbiting) return;
  var a0=_lifeIndexMap["_av0"], a1=_lifeIndexMap["_av1"]; if(!a0||!a1) return;
  var b=_lifeBond; ctx.lineCap="round";
  ctx.strokeStyle="rgba(224,106,138,"+(0.12+b*0.28).toFixed(3)+")"; ctx.lineWidth=(2.2+b*2.6);
  ctx.beginPath(); ctx.moveTo(a0.x,a0.y); ctx.lineTo(a1.x,a1.y); ctx.stroke();
  ctx.strokeStyle="rgba(224,106,138,"+(0.45+b*0.5).toFixed(3)+")"; ctx.lineWidth=(0.5+b*1.1);
  ctx.beginPath(); ctx.moveTo(a0.x,a0.y); ctx.lineTo(a1.x,a1.y); ctx.stroke();
  ctx.lineCap="butt";
}
// Transient tap ripples (expand + fade over 700ms). Kept alive by _lifeSettleUntil.
function _lifeDrawRipples(ctx){
  if(!_lifeRipples.length) return;
  var now=Date.now(), keep=[];
  for(var i=0;i<_lifeRipples.length;i++){
    var rp=_lifeRipples[i], p=(now-rp.t0)/700; if(p>=1) continue;
    keep.push(rp);
    ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r*(1+p*1.6), 0, _LIFE_TAU);
    ctx.lineWidth=0.8; ctx.strokeStyle=rp.color; ctx.globalAlpha=(1-p)*0.8; ctx.stroke(); ctx.globalAlpha=1;
  }
  _lifeRipples = keep;
}
// Member photo as an Image (cached); re-render once it decodes so it pops in.
function _lifeAvImg(url){
  var im=_lifeAvImgCache[url]; if(im) return im;
  im=new Image(); im.decoding="async"; im.onload=function(){ if(tab==="life") _lifeRender(); };
  im.src=url; _lifeAvImgCache[url]=im; return im;
}
// Avatars (hub owner / the two family members) drawn ON TOP of the graph.
function _lifeDrawAvatars(ctx){
  if(_lifeView==="area" || !_lifeData) return;
  var list=[];
  if(_lifeData.scope==="family"){
    var a0=_lifeIndexMap["_av0"], a1=_lifeIndexMap["_av1"];
    if(a0&&a0.member) list.push({n:a0,m:a0.member});
    if(a1&&a1.member) list.push({n:a1,m:a1.member});
  } else {
    var hub=_lifeIndexMap["_hub"]; if(hub) list.push({n:hub,m:_lifeMember(_lifeOwner)});
  }
  for(var i=0;i<list.length;i++){
    var n=list[i].n, m=list[i].m, r=n.r, col=(m&&m.color)||"#A9A48F";
    if(m && m.photo_url){
      var img=_lifeAvImg(m.photo_url);
      if(img.complete && img.naturalWidth){
        var iw=img.naturalWidth, ih=img.naturalHeight, side=Math.min(iw,ih);
        ctx.save(); ctx.beginPath(); ctx.arc(n.x,n.y,r,0,_LIFE_TAU); ctx.clip();
        ctx.drawImage(img,(iw-side)/2,(ih-side)/2,side,side, n.x-r,n.y-r,2*r,2*r);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(n.x,n.y,r,0,_LIFE_TAU); ctx.globalAlpha=0.22; ctx.fillStyle=col; ctx.fill(); ctx.globalAlpha=1;
      }
      ctx.beginPath(); ctx.arc(n.x,n.y,r+0.5,0,_LIFE_TAU); ctx.lineWidth=0.7; ctx.globalAlpha=0.95; ctx.strokeStyle=col; ctx.stroke(); ctx.globalAlpha=1;
    } else {
      ctx.beginPath(); ctx.arc(n.x,n.y,r,0,_LIFE_TAU); ctx.globalAlpha=0.22; ctx.fillStyle=col; ctx.fill(); ctx.globalAlpha=1;
      ctx.lineWidth=0.7; ctx.strokeStyle=col; ctx.stroke();
      _lifeText(ctx,(m&&m.emoji)||"👤", n.x, n.y, r*1.05, "#fff", 1);
    }
  }
}
// One node: glow → core → emoji/label → caption/sub → badges. (Avatars/hub handled apart.)
function _lifeDrawNode(ctx, n){
  if(n.type==="avatar") return;                 // image drawn in the avatar pass
  var glowR = n.r * 2.4;
  if(n.type==="hub"){
    if(_lifeData && _lifeData.scope==="family"){
      var bond=Math.max(0,Math.min(1,_lifeData.bond||0));
      _lifeDrawGlow(ctx, n, glowR*(0.85+bond*0.5), 0.5+bond*0.5);
    } else { _lifeDrawGlow(ctx, n, glowR, 1); }
    return;
  }
  var isSeed = (n.type==="add" || n.type==="ideas" || n.type==="addarea");
  var br = n.bright || 0;
  var fillOpacity = isSeed ? 0.04 : (0.05 + br*0.32);
  var glowOpacity = isSeed ? 0.5  : (0.18 + br*0.55);
  var coreCol = isSeed ? n.color : _lifeDesat(n.color, 0.32 + br*0.56);
  var ringW = isSeed ? 0.6 : 0.7;
  // glow
  _lifeDrawGlow(ctx, n, glowR, glowOpacity);
  // core (translucent fill + ring; dashed for the dotted "seed" placeholders)
  ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, _LIFE_TAU);
  ctx.globalAlpha = fillOpacity; ctx.fillStyle = coreCol; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = ringW; ctx.strokeStyle = coreCol;
  if(isSeed) ctx.setLineDash([2,2]);
  ctx.stroke();
  if(isSeed) ctx.setLineDash([]);
  // centre glyph
  if(n.type==="add" || n.type==="addarea"){ _lifeText(ctx,"+", n.x, n.y, 6, "#EDEAE0", 0.7, "700"); }
  else if(n.type==="ideas"){ _lifeText(ctx,"✨", n.x, n.y, 5, "#fff", 1); }
  else if(n.emoji){ _lifeText(ctx, n.emoji, n.x, n.y, 4.6, "#fff", 1); }
  // captions
  var capY = n.y + n.r + 4.2;
  if(n.type==="ideas"){ _lifeText(ctx, tr("life_ideas"), n.x, capY, 3.1, "#EDEAE0", 0.6, "700"); }
  else if(n.type==="addarea"){ _lifeText(ctx, tr("life_new_sphere"), n.x, capY, 3.1, "#EDEAE0", 0.6, "700"); }
  else if(n.type!=="add"){
    var nm = n.label || ""; if(nm.length>14) nm = nm.slice(0,13)+"…";
    var hubCap = (n.type==="hub" || n.type==="areahub");
    _lifeText(ctx, nm, n.x, capY, hubCap?3.4:3.1, "#EDEAE0", hubCap?0.95:0.9, "700");
    if(n.type==="area"){ _lifeText(ctx, Math.round(br*100)+"%", n.x, capY+3.4, 2.5, "#EDEAE0", 0.5); }
    if(n.type==="habit" && (n.count||1)>1){ _lifeText(ctx, "×"+(n.count||1), n.x, capY+3.4, 2.5, "#EDEAE0", 0.5); }
  }
  // count badge (re-lived events, top-right)
  if(n.type==="habit" && (n.count||1)>1){
    var bx=n.x+n.r*0.78, by=n.y-n.r*0.78;
    ctx.beginPath(); ctx.arc(bx,by,2.6,0,_LIFE_TAU); ctx.fillStyle=n.color; ctx.fill();
    ctx.lineWidth=0.5; ctx.strokeStyle="#0c0c18"; ctx.stroke();
    _lifeText(ctx, String(n.count||1), bx, by, 2.7, "#0c0c18", 1, "800");
  }
  // pin badge (carries to next month, top-left)
  if(n.type==="habit" && n.pinned){ _lifeText(ctx, "📌", n.x-n.r*0.82, n.y-n.r*0.78, 3.4, "#fff", 1); }
}

// ─── Pointer: bg long-press (edit mode) · node tap / drag / long-press ──
function _lifeBindPointer(svg){
  svg.onpointerdown = function(ev){
    _lifeWakeFloat();   // any touch re-wakes the float (and restarts the sim if it had rested)
    var p = _lifeToSvg(svg, ev.clientX, ev.clientY);
    var id = _lifeCanvasHit(p.x, p.y);
    if(!id){
      // Empty canvas: a long-press toggles edit mode.
      _lifeBg = {sx:p.x, sy:p.y, moved:false};
      _lifeBgTimer = setTimeout(function(){
        _lifeBgTimer = null;
        if(_lifeBg && !_lifeBg.moved){ _lifeBg.fired = true; _lifeSetEdit(!_lifeEditMode); }
      }, 650);
      return;
    }
    var node = _lifeNodeById(id); if(!node) return;
    _lifeDrag = {id:id, moved:false, sx:p.x, sy:p.y, t:Date.now()};
    try{ svg.setPointerCapture(ev.pointerId) }catch(e){}
    // In edit mode a node tap edits it — no drag, no per-node long-press.
    if(_lifeEditMode) return;
    // Normal mode long-press: area node → rename; event node → event detail
    // (count / +/- / rename / delete). Events use a snappier 550ms.
    if(node.type==="area"){
      _lifeLongTimer = setTimeout(function(){
        _lifeLongTimer = null;
        if(_lifeDrag && !_lifeDrag.moved){ _lifeDrag = null; hp("med"); _lifeOpenNodeEdit(id); }
      }, 1000);
    } else if(node.type==="habit"){
      _lifeLongTimer = setTimeout(function(){
        _lifeLongTimer = null;
        if(_lifeDrag && !_lifeDrag.moved){ _lifeDrag = null; hp("med"); _lifeOpenEvent(node.hid); }
      }, 550);
    }
  };
  svg.onpointermove = function(ev){
    var p = _lifeToSvg(svg, ev.clientX, ev.clientY);
    if(_lifeBg){
      var bdx=p.x-_lifeBg.sx, bdy=p.y-_lifeBg.sy;
      if(bdx*bdx+bdy*bdy > 6){ _lifeBg.moved = true; if(_lifeBgTimer){clearTimeout(_lifeBgTimer);_lifeBgTimer=null;} }
      return;
    }
    if(!_lifeDrag) return;
    if(_lifeEditMode) return;  // no dragging in edit mode
    if(!_lifeDrag.moved){
      var dx=p.x-_lifeDrag.sx, dy=p.y-_lifeDrag.sy;
      if(dx*dx+dy*dy > 4){
        _lifeDrag.moved = true;
        if(_lifeLongTimer){clearTimeout(_lifeLongTimer);_lifeLongTimer=null;}
        _lifeStartSim();
      }
    }
    if(_lifeDrag.moved){
      var nd = _lifeNodeById(_lifeDrag.id);
      if(nd){
        nd.x = p.x; nd.y = p.y; nd.vx=0; nd.vy=0;
        // Reflect THIS node's position this event (1:1 with the finger) instead
        // of waiting for the next RAF tick — kills the "trails my finger" lag.
        // Only the dragged node + its edges; the RAF handles everyone else.
        _lifeMoveDragged(nd);
      }
    }
  };
  svg.onpointerup = function(ev){
    if(_lifeBgTimer){ clearTimeout(_lifeBgTimer); _lifeBgTimer=null; }
    if(_lifeBg){
      var bg=_lifeBg; _lifeBg=null;
      // Short tap on the background while editing → finish edit mode.
      if(!bg.fired && !bg.moved && _lifeEditMode) _lifeSetEdit(false);
      return;
    }
    if(_lifeLongTimer){ clearTimeout(_lifeLongTimer); _lifeLongTimer=null; }
    if(!_lifeDrag) return;
    var d = _lifeDrag; _lifeDrag = null;
    if(_lifeEditMode){ _lifeEditNode(d.id); return; }
    if(d.moved){ _lifeSettleUntil = Date.now()+450; _lifeStartSim(); }
    else { _lifeTapNode(d.id); }
  };
  svg.onpointercancel = function(){
    if(_lifeLongTimer){clearTimeout(_lifeLongTimer);_lifeLongTimer=null;}
    if(_lifeBgTimer){clearTimeout(_lifeBgTimer);_lifeBgTimer=null;}
    _lifeDrag=null; _lifeBg=null;
  };
}

// Toggle edit mode — rebuild, then ANIMATE the relayout: existing nodes start
// from where they were, brand-new seeds start at the hub centre, and the spring
// sim eases everything to the new homes. So the circles glide aside and the "+"
// grows out of the centre with its spoke instead of everything snapping.
function _lifeSetEdit(on){
  if(_lifeEditMode === on) return;
  var prev = {}; _lifeNodes.forEach(function(n){ prev[n.id] = {x:n.x, y:n.y}; });
  _lifeEditMode = on;
  hp(on ? "med" : "light");
  if(_lifeView==="area") _lifeBuildArea(); else _lifeBuildConstellation();
  var cx = _lifeCx(), cy = _lifeCy();
  _lifeNodes.forEach(function(n){
    if(n.id==="_hub" || n.type==="avatar") return; // hub/avatars keep their own motion
    var p = prev[n.id];
    if(p){ n.x = p.x; n.y = p.y; }   // existing → start from old spot, ease to new
    else { n.x = cx; n.y = cy; }     // new seed → grow/spring out of the centre
    n.vx = 0; n.vy = 0;
  });
  _lifeApplyPositions();             // paint the start frame (no snap/flash)
  _lifeSettleUntil = Date.now() + 700;
  _lifeStartSim();
  if(on) _lifeSetHint(tr("life_edit_on"));
}

// In edit mode, tapping a node opens its editor.
function _lifeEditNode(id){
  var n = _lifeNodeById(id); if(!n) return;
  hp("light");
  if(n.type==="area"){ _lifeOpenNodeEdit(n.id); }
  else if(n.type==="habit"){ _lifeOpenEvent(n.hid); }
  else if(n.type==="add"){ _lifeOpenAddEvent(); }
  else if(n.type==="ideas"){ _lifeSuggest(); }
  else if(n.type==="addarea"){ _lifeOpenAddArea(); }
}

// Convert client coords → graph user units (inverse of the canvas transform).
function _lifeToSvg(cv, cx, cy){
  if(!cv || !cv.getBoundingClientRect) return {x:50, y:_lifeVbH/2};
  var r = cv.getBoundingClientRect(), s = _lifeScale || 1;
  return { x:((cx - r.left) - _lifeOffX)/s, y:((cy - r.top) - _lifeOffY)/s };
}
// Nearest node whose disc contains (ux,uy). Generous touch radius for small seeds.
function _lifeCanvasHit(ux, uy){
  var best=null, bestD=Infinity;
  for(var i=0;i<_lifeNodes.length;i++){
    var n=_lifeNodes[i], hitR=Math.max(n.r+2.0, 5.0);
    var dx=ux-n.x, dy=uy-n.y, d=dx*dx+dy*dy;
    if(d <= hitR*hitR && d < bestD){ bestD=d; best=n.id; }
  }
  return best;
}

function _lifeTapNode(id){
  var n = _lifeNodeById(id); if(!n) return;
  if(_lifeView==="constellation"){
    if(n.type==="area"){ hp("light"); _lifeOpenArea(n.id); }
  } else {
    if(n.type==="add"){ hp("light"); _lifeOpenAddEvent(); }
    else if(n.type==="ideas"){ hp("light"); _lifeSuggest(); }
    else if(n.type==="habit"){
      // Tap an event → re-live it (grow + counter). Past months are read-only
      // → just open the detail card.
      if(_lifeIsPast()) _lifeOpenEvent(n.hid);
      else _lifeBumpEvent(n.hid);
    }
  }
}

function _lifeOpenArea(areaId){
  _lifeView = "area"; _lifeAreaId = areaId; _lifeAreaHabits = [];
  _lifeRenderTopBar();
  _lifeBuildArea();          // renders Add node immediately
  _lifeLoadArea(areaId);     // fills habits
}

// ─── Spring sim — runs continuously for a gentle "floating" feel ──────────
function _lifeStartSim(){
  if(_lifeRAF) return;
  var step = function(){
    var dragging = !!(_lifeDrag && _lifeDrag.moved);
    var settling = Date.now() < _lifeSettleUntil;
    // Throttle the ambient float to ~30fps. The continuous sim translates every
    // node (each with a radial-gradient glow → a repaint), so halving the cadence
    // halves that cost; the slow drift looks identical at 30fps. The dragged node
    // still tracks the finger at full rate via _lifeMoveDragged on pointermove.
    var t = Date.now();
    if((t - _lifeStepT) < 31){ _lifeRAF = requestAnimationFrame(step); return; }
    _lifeStepT = t;
    // Floating is "awake" only for a short window after arrival/interaction.
    var floating = _lifeFloatOn && (t < _lifeFloatUntil);
    // Soft springs + high damping → nodes drift toward home and glide elastically
    // when you pull one, like they're floating in water (no rigid snap).
    var kHome = 0.026, kEdge = 0.015, damp = 0.88, dt = 1;
    var energy = 0;
    // Family orbit: advance the angle and move the two avatars' home anchors
    // around the hub's CURRENT position, so the spring sim makes them chase the
    // orbit (and the dragged hub) with a little elastic lag.
    if(_lifeOrbiting && floating){
      _lifeOrbitAngle += 0.005;  // ~21s per turn (spring lag makes it feel calmer)
      var hub = _lifeNodeById("_hub");
      var av0 = _lifeNodeById("_av0"), av1 = _lifeNodeById("_av1");
      if(hub && av0){ av0.bhx = hub.x + _lifeOrbitR*Math.cos(_lifeOrbitAngle);        av0.bhy = hub.y + _lifeOrbitR*Math.sin(_lifeOrbitAngle); }
      if(hub && av1){ av1.bhx = hub.x + _lifeOrbitR*Math.cos(_lifeOrbitAngle+Math.PI); av1.bhy = hub.y + _lifeOrbitR*Math.sin(_lifeOrbitAngle+Math.PI); }
    }
    // Slow drift while awake; once the window passes, homes hold at their base so
    // the nodes ease to a static rest (then the loop below stops painting).
    _lifeNodes.forEach(function(n){
      if(n.bhx==null){ n.bhx=n.hx; n.bhy=n.hy; }
      if(n.id==="_hub"){ n.hx=n.bhx; n.hy=n.bhy; return; }  // centre stays put
      if(!floating){ n.hx=n.bhx; n.hy=n.bhy; return; }      // settle to base when asleep
      var ph = n.phase || 0, amp = (n.driftA!=null? n.driftA : 1.1);
      n.hx = n.bhx + Math.sin(t*0.00045 + ph)*amp;
      n.hy = n.bhy + Math.cos(t*0.00038 + ph*1.3)*amp;
    });
    // forces
    _lifeNodes.forEach(function(n){ n.fx=0; n.fy=0; });
    _lifeNodes.forEach(function(n){
      if(_lifeDrag && _lifeDrag.id===n.id && dragging) return; // dragged is pinned
      var k = n.khome || kHome;
      n.fx += (n.hx - n.x)*k;
      n.fy += (n.hy - n.y)*k;
    });
    // spring edges — gray spokes + (family) the avatar coupling springs
    var allEdges = _lifeAvEdges.length ? _lifeEdges.concat(_lifeAvEdges) : _lifeEdges;
    allEdges.forEach(function(e){
      var a=_lifeNodeById(e[0]), b=_lifeNodeById(e[1]); if(!a||!b) return;
      var dx=b.x-a.x, dy=b.y-a.y;
      var rest = Math.hypot(a.hx-b.hx, a.hy-b.hy) || 1;
      var dist = Math.hypot(dx,dy) || 0.001;
      var diff = (dist-rest)/dist * kEdge;
      var fx = dx*diff, fy = dy*diff;
      if(!(_lifeDrag&&_lifeDrag.id===a.id&&dragging)){ a.fx += fx; a.fy += fy; }
      if(!(_lifeDrag&&_lifeDrag.id===b.id&&dragging)){ b.fx -= fx; b.fy -= fy; }
    });
    _lifeNodes.forEach(function(n){
      if(_lifeDrag && _lifeDrag.id===n.id && dragging) return;
      n.vx=(n.vx+n.fx)*damp; n.vy=(n.vy+n.fy)*damp;
      n.x += n.vx*dt; n.y += n.vy*dt;
      energy += Math.abs(n.vx)+Math.abs(n.vy);
    });
    _lifeApplyPositions();
    // Keep running while floating, interacting, or still settling. Once asleep AND
    // the graph has come to rest, STOP — a static frame costs zero GPU paint.
    if(floating || dragging || settling || energy > 0.04){
      _lifeRAF = requestAnimationFrame(step);
    } else {
      _lifeRAF = null;
    }
  };
  _lifeRAF = requestAnimationFrame(step);
}

// Move existing SVG elements instead of re-rendering — cheap per frame.
// Translate is relative to each node's DRAW anchor (ox,oy), not its (possibly
// moving) home, so orbiting avatars track correctly and stay upright.
// On canvas the entire frame is repainted in one cheap pass, so the sim's
// per-frame update AND the 1:1 dragged-node update are the same call.
function _lifeApplyPositions(){ _lifeRender(); }
function _lifeMoveDragged(nd){ _lifeRender(); }

// ─── Add / edit habit (inside an area) ────────────────────────
// ─── Add a new event (current month) ──────────────────────────
var _lifeEventDraft = null;
function _lifeOpenAddEvent(){
  if(_lifeIsPast()){ toast(tr("life_past_ro")); return }
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  _lifeEventDraft = {id:null, emoji:"🌱", name:""};
  oMC(tr("life_new_event")+(area?" · "+area.emoji+" "+es(area.name):""), _lifeEventFormHtml(), {ic:"life"});
}
function _lifeEventFormHtml(){
  var d = _lifeEventDraft;
  var h = '';
  h += '<div style="display:flex;gap:10px;align-items:flex-end">';
  h += '<div><div class="lb">'+tr("g_emoji")+'</div><input class="inp" id="lf-e" value="'+es(d.emoji)+'" style="width:64px;text-align:center;font-size:20px"></div>';
  h += '<div style="flex:1"><div class="lb">'+tr("life_event_name")+'</div><input class="inp" id="lf-n" placeholder="'+tr("life_event_ph")+'" value="'+es(d.name)+'"></div>';
  h += '</div>';
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveEvent()">'+(d.id?tr("btn_save"):tr("btn_add"))+'</button>';
  return h;
}
async function _lifeSaveEvent(){
  var d = _lifeEventDraft;
  d.emoji = (document.getElementById("lf-e")||{}).value || d.emoji;
  d.name = ((document.getElementById("lf-n")||{}).value||"").trim();
  if(!d.name){ toast(tr("life_name_required")); return }
  var r;
  if(d.id){
    r = await A("PATCH","/api/life/events/"+d.id, {name:d.name, emoji:d.emoji});
  } else {
    r = await A("POST","/api/life/events", {owner:_lifeOwner, area_id:_lifeAreaId, name:d.name, emoji:d.emoji});
  }
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); cMo(); _lifeEventDraft=null;
  delete _lifeCache.ev[_lifeEvKey(_lifeAreaId)]; _lifeInvalidateSummary();  // refetch w/ server id
  await _lifeLoadArea(_lifeAreaId);
  _lifeLoadSummary(); // refresh node fill for when we go back
}

// Quick tap → re-live the event: bump its counter and grow the satellite.
async function _lifeBumpEvent(eid){
  var r = await A("POST","/api/life/events/"+eid+"/bump", {delta:1});
  if(!r || !r.id){ toast(tr("ts_error")); return }
  hp("ok");
  var ev = _lifeAreaHabits.find(function(x){return x.id===eid}); if(ev){ ev.count = r.count; }
  _lifeBuildArea();
  _lifeRipple("h"+eid);
}

// ─── Event detail — counter, +/- (re-live / correct), rename, delete ──
async function _lifeOpenEvent(eid){
  var ev = _lifeAreaHabits.find(function(x){return x.id===eid}); if(!ev) return;
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  var col = area ? area.color : "var(--pr)";
  var past = _lifeIsPast();
  var h = '<div class="life-d">';
  h += '<div class="life-d-emoji" style="background:color-mix(in srgb,'+col+' 18%,transparent);border:1px solid color-mix(in srgb,'+col+' 40%,transparent)">'+(ev.emoji||"🌱")+'</div>';
  h += '<div class="life-d-name">'+es(ev.name)+'</div>';
  if(past) h += '<div class="life-d-type">'+es(_lifeYMLabel())+'</div>';
  // Counter with - / + (re-live). Hidden controls in read-only past months.
  h += '<div class="life-count">';
  if(!past) h += '<button class="life-count-b" onclick="_lifeEventDelta('+eid+',-1)">−</button>';
  h += '<div class="life-count-v" id="life-cv" style="color:'+col+'">'+(ev.count||1)+'</div>';
  if(!past) h += '<button class="life-count-b" onclick="_lifeEventDelta('+eid+',1)">+</button>';
  h += '</div>';
  h += '<div class="life-d-l" style="text-align:center;margin-top:-4px">'+tr("life_count_lbl")+'</div>';
  if(!past){
    var pinOn = !!ev.pinned;
    h += '<button class="btn btn-s" id="life-pin-btn" style="margin-top:14px;background:'+(pinOn?col:'transparent')+';color:'+(pinOn?'#fff':'var(--tx)')+';border:1px solid '+(pinOn?col:'var(--bd)')+'" onclick="_lifeTogglePin('+eid+')">📌 '+(pinOn?tr("life_pinned"):tr("life_pin"))+'</button>';
    h += '<div class="life-d-l" style="text-align:center;margin-top:6px">'+tr("life_pin_hint")+'</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px">';
    h += '<button class="btn btn-s" style="flex:1;background:transparent;color:var(--tx);border:1px solid var(--bd)" onclick="_lifeEditEvent('+eid+')">✏️ '+tr("btn_edit")+'</button>';
    h += '<button class="btn btn-s" style="flex:1;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_lifeDeleteEvent('+eid+')">🗑 '+tr("btn_delete")+'</button>';
    h += '</div>';
  }
  h += '</div>';
  oMC(tr("life_event"), h, {ic:"life"});
}
async function _lifeTogglePin(eid){
  var ev = _lifeAreaHabits.find(function(x){return x.id===eid}); if(!ev) return;
  var want = !ev.pinned;
  hp("light");
  var r = await A("POST","/api/life/events/"+eid+"/pin", {pinned:want});
  if(!r || r.id==null){ toast(tr("ts_error")); return }
  ev.pinned = r.pinned;
  var b=document.getElementById("life-pin-btn");
  var area=(_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId}); var col=area?area.color:"var(--pr)";
  if(b){ b.style.background=r.pinned?col:"transparent"; b.style.color=r.pinned?"#fff":"var(--tx)"; b.style.borderColor=r.pinned?col:"var(--bd)"; b.innerHTML='📌 '+(r.pinned?tr("life_pinned"):tr("life_pin")); }
  _lifeBuildArea();   // refresh the pin badge on the node
}
async function _lifeEventDelta(eid, delta){
  var r = await A("POST","/api/life/events/"+eid+"/bump", {delta:delta});
  if(!r || !r.id){ toast(tr("ts_error")); return }
  hp(delta>0?"ok":"light");
  var ev = _lifeAreaHabits.find(function(x){return x.id===eid}); if(ev){ ev.count = r.count; }
  var cv = document.getElementById("life-cv"); if(cv) cv.textContent = r.count;
  _lifeBuildArea();
}
function _lifeEditEvent(eid){
  var ev = _lifeAreaHabits.find(function(x){return x.id===eid}); if(!ev) return;
  _lifeEventDraft = {id:ev.id, emoji:ev.emoji||"🌱", name:ev.name||""};
  oMC(tr("life_edit_event"), _lifeEventFormHtml(), {ic:"life"});
}
async function _lifeDeleteEvent(eid){
  if(!confirm(tr("life_delete_confirm"))) return;
  var r = await A("DELETE","/api/life/events/"+eid);
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  hp("warn"); cMo();
  _lifeAreaHabits = _lifeAreaHabits.filter(function(x){return x.id!==eid});
  _lifeCache.ev[_lifeEvKey(_lifeAreaId)] = _lifeAreaHabits;  // re-point cache to the new array
  _lifeInvalidateSummary();
  _lifeBuildArea(); _lifeLoadSummary();
}

// ─── AI suggestions (v8.52.0 · Phase 2) ───────────────────────
// Tap ✨ inside an area → Claude suggests new habits to grow that sphere,
// each one tap away from becoming a real node.
var _lifeSuggestions = [];
async function _lifeSuggest(){
  if(!_lifeAreaId) return;
  hp("light");
  oMC(tr("life_ideas"), '<div class="life-thinking">✨ '+tr("life_thinking")+'</div>', {ic:"life"});
  var r;
  try{ r = await A("POST","/api/life/suggest", {owner:_lifeOwner, area_id:_lifeAreaId}); }
  catch(e){ r = null; }
  var mb = document.getElementById("mb");
  if(!r || !r.suggestions || !r.suggestions.length){
    if(mb) mb.innerHTML = '<div style="text-align:center;color:var(--ht);padding:24px 12px">'+tr("life_no_ideas")+'</div><button class="btn btn-s" style="background:transparent;border:1px solid var(--bd);color:var(--tx)" onclick="cMo()">'+tr("btn_close")+'</button>';
    return;
  }
  _lifeSuggestions = r.suggestions.map(function(s){ s._added=false; return s });
  _lifeRenderSuggestions();
}
function _lifeRenderSuggestions(){
  var mb = document.getElementById("mb"); if(!mb) return;
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  var col = area ? area.color : "var(--pr)";
  var h = '<div class="life-sugg-sub">'+tr("life_ideas_sub")+'</div><div class="life-sugg-list">';
  _lifeSuggestions.forEach(function(s,i){
    h += '<div class="life-sugg">';
    h += '<div class="life-sugg-em" style="background:color-mix(in srgb,'+col+' 16%,transparent);border:1px solid color-mix(in srgb,'+col+' 35%,transparent)">'+es(s.emoji||"🌱")+'</div>';
    h += '<div class="life-sugg-bd"><div class="life-sugg-n">'+es(s.name)+'</div>'+(s.why?'<div class="life-sugg-w">'+es(s.why)+'</div>':'')+'</div>';
    if(s._added) h += '<span class="life-sugg-ok" style="color:'+col+'">'+icon("ck",16,2.5)+'</span>';
    else h += '<button class="life-sugg-add" style="background:'+col+'" onclick="_lifeAddSuggested('+i+')">'+icon("pl",13,2.5)+'</button>';
    h += '</div>';
  });
  h += '</div>';
  h += '<button class="btn btn-s" style="margin-top:12px;background:transparent;border:1px solid var(--bd);color:var(--tx)" onclick="cMo()">'+tr("btn_done")+'</button>';
  mb.innerHTML = h;
}
async function _lifeAddSuggested(i){
  var s = _lifeSuggestions[i]; if(!s || s._added) return;
  var r = await A("POST","/api/life/events", {owner:_lifeOwner, area_id:_lifeAreaId, name:s.name, emoji:s.emoji});
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); s._added = true;
  _lifeRenderSuggestions();
  await _lifeLoadArea(_lifeAreaId);   // node appears under the modal
  _lifeLoadSummary();
}

// One-shot ripple ring expanding from a node — reinforces "system impact".
function _lifeRipple(nodeId){
  var n=_lifeNodeById(nodeId); if(!n) return;
  _lifeRipples.push({x:n.x, y:n.y, r:n.r, color:n.color, t0:Date.now()});
  // Keep the sim painting until the ripple finishes (it expands + fades over 700ms).
  _lifeSettleUntil = Math.max(_lifeSettleUntil, Date.now()+760);
  _lifeStartSim();
}

// ─── Node edit (long-press) — name + emoji override ───────────
var _lifeNodeDraft = null;
function _lifeOpenNodeEdit(areaId){
  var a = (_lifeData.areas||[]).find(function(x){return x.id===areaId}); if(!a) return;
  _lifeNodeDraft = {area_id:areaId, name:a.name, emoji:a.emoji, customized:a.customized};
  var h = '';
  h += '<div style="display:flex;gap:10px;align-items:flex-end">';
  h += '<div><div class="lb">'+tr("g_emoji")+'</div><input class="inp" id="ln-e" value="'+es(a.emoji)+'" style="width:64px;text-align:center;font-size:20px"></div>';
  h += '<div style="flex:1"><div class="lb">'+tr("life_node_name")+'</div><input class="inp" id="ln-n" value="'+es(a.name)+'"></div>';
  h += '</div>';
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveNode()">'+tr("btn_save")+'</button>';
  if(a.customized) h += '<button class="btn btn-s" style="margin-top:8px;background:transparent;color:var(--ht);border:1px solid var(--bd)" onclick="_lifeResetNode()">'+tr("life_node_reset")+'</button>';
  // Any sphere can be deleted (with its habits) — personal or family.
  h += '<button class="btn btn-s" style="margin-top:8px;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_lifeDeleteArea(\''+areaId+'\')">🗑 '+tr("life_delete_sphere")+'</button>';
  oMC(tr("life_edit_node"), h, {ic:"life"});
}
async function _lifeDeleteArea(areaId){
  if(!confirm(tr("life_delete_sphere_confirm"))) return;
  var r = await A("DELETE","/api/life/areas/"+encodeURIComponent(areaId)+"?owner="+encodeURIComponent(_lifeOwner));
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  hp("warn"); cMo(); await _lifeLoadSummary();
}

// ─── Add a new personal sphere (L0 edit "+") ──────────────────
var _lifeAreaDraft = null;
var LIFE_AREA_COLORS = ["#8B7BE8","#E8A24A","#5FB37A","#6B8FD4","#C77DBB","#E8C54A","#E8714A","#6BB0D4","#E06A8A","#7FB069"];
function _lifeOpenAddArea(){
  _lifeAreaDraft = {emoji:"🌱", name:"", color:LIFE_AREA_COLORS[0]};
  var h = '';
  h += '<div style="display:flex;gap:10px;align-items:flex-end">';
  h += '<div><div class="lb">'+tr("g_emoji")+'</div><input class="inp" id="la-e" value="🌱" style="width:64px;text-align:center;font-size:20px"></div>';
  h += '<div style="flex:1"><div class="lb">'+tr("life_node_name")+'</div><input class="inp" id="la-n" placeholder="'+tr("life_sphere_ph")+'"></div>';
  h += '</div>';
  h += '<div class="lb">'+tr("life_color")+'</div><div class="life-colors" id="la-colors">';
  LIFE_AREA_COLORS.forEach(function(c,i){
    h += '<button class="life-color'+(i===0?" on":"")+'" data-c="'+c+'" style="background:'+c+'" onclick="_lifeAreaDraft.color=\''+c+'\';document.querySelectorAll(\'#la-colors .life-color\').forEach(function(b){b.classList.remove(\'on\')});this.classList.add(\'on\')"></button>';
  });
  h += '</div>';
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveArea()">'+tr("life_add_sphere")+'</button>';
  oMC(tr("life_new_sphere"), h, {ic:"life"});
}
async function _lifeSaveArea(){
  var d = _lifeAreaDraft;
  d.emoji = (document.getElementById("la-e")||{}).value || d.emoji;
  d.name = ((document.getElementById("la-n")||{}).value||"").trim();
  if(!d.name){ toast(tr("life_name_required")); return }
  var r = await A("POST","/api/life/areas",{owner:_lifeOwner, name:d.name, emoji:d.emoji, color:d.color});
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); cMo(); _lifeAreaDraft=null;
  await _lifeLoadSummary();  // stays in edit mode → new sphere + the "+" both show
}
async function _lifeSaveNode(){
  var name=((document.getElementById("ln-n")||{}).value||"").trim();
  var emoji=((document.getElementById("ln-e")||{}).value||"").trim();
  var r = await A("PUT","/api/life/nodes/"+_lifeNodeDraft.area_id+"?owner="+encodeURIComponent(_lifeOwner),{name:name,emoji:emoji});
  if(!r || !r.ok){ toast(tr("ts_save_failed")); return }
  hp("ok"); cMo(); await _lifeLoadSummary();
}
async function _lifeResetNode(){
  var r = await A("PUT","/api/life/nodes/"+_lifeNodeDraft.area_id+"?owner="+encodeURIComponent(_lifeOwner),{name:"",emoji:""});
  if(r&&r.ok){ hp("warn"); cMo(); await _lifeLoadSummary(); }
}
