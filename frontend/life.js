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
var _lifeDrag = null;           // {id, moved}
var _lifeLongTimer = null;
var _lifeSettleUntil = 0;

// ─── Entry: shell HTML (ren() injects this into #ct) ──────────
function rLife(){
  // life-mode (body class set by app.js go()) hides the global header; we render
  // our own top bar with the owner filter and an in-canvas back button.
  var h = '<div class="life-wrap">';
  h += '<div class="life-top" id="life-top"></div>';
  h += '<div class="life-stage"><svg id="life-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg></div>';
  h += '<div class="life-hint" id="life-hint"></div>';
  h += '</div>';
  setTimeout(lifeMount, 0);
  return h;
}

// Called by app.js after the shell is in the DOM (and on lazy-load completion).
function lifeMount(){
  if(tab !== "life") return;
  if(!_lifeOwner) _lifeOwner = String((fS && fS.my_id) || (D.members[0] && D.members[0].user_id) || "");
  _lifeRenderTopBar();
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeLoadSummary();
}

function lifeUnmount(){
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF = null; }
  if(_lifeLongTimer){ clearTimeout(_lifeLongTimer); _lifeLongTimer = null; }
  _lifeDrag = null;
}

// ─── Top bar: owner filter (Me / partner / Family) + back ─────
function _lifeRenderTopBar(){
  var el = document.getElementById("life-top"); if(!el) return;
  var h = '';
  if(_lifeView === "area"){
    h += '<button class="life-back" onclick="_lifeBack()" aria-label="Back">‹</button>';
    var a = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
    h += '<div class="life-title">'+(a?a.emoji+' '+es(a.name):tr("nav_life"))+'</div>';
    h += '<div style="width:34px"></div>';
  } else {
    h += '<div class="life-title">'+tr("nav_life")+'</div>';
    h += '<div class="life-chips">';
    (D.members||[]).forEach(function(m){
      var on = _lifeOwner === String(m.user_id);
      h += '<button class="life-chip'+(on?' on':'')+'" onclick="_lifeSetOwner(\''+m.user_id+'\')">'+mAv(m.user_id,22)+'</button>';
    });
    var famOn = _lifeOwner === "family";
    h += '<button class="life-chip life-chip-fam'+(famOn?' on':'')+'" onclick="_lifeSetOwner(\'family\')">❤️</button>';
    h += '</div>';
  }
  el.innerHTML = h;
}

function _lifeSetOwner(o){
  if(_lifeOwner === o) return;
  _lifeOwner = o; hp("sel");
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeRenderTopBar();
  _lifeLoadSummary();
}

function _lifeBack(){
  hp("light");
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeRenderTopBar();
  _lifeBuildConstellation();
}

// ─── Data ─────────────────────────────────────────────────────
async function _lifeLoadSummary(){
  var d = await A("GET","/api/life/summary?owner="+encodeURIComponent(_lifeOwner));
  if(!d || !d.areas){ return }
  _lifeData = d;
  if(tab==="life" && _lifeView==="constellation") _lifeBuildConstellation();
}

async function _lifeLoadArea(areaId){
  var d = await A("GET","/api/life/habits?owner="+encodeURIComponent(_lifeOwner)+"&area_id="+encodeURIComponent(areaId));
  _lifeAreaHabits = (d && d.habits) || [];
  if(tab==="life" && _lifeView==="area") _lifeBuildArea();
}

// ─── Layout helpers ───────────────────────────────────────────
// Radial layout in a 0..100 viewBox. Center hub at (50,50); satellites on a ring.
function _lifeRing(n, radius, startDeg){
  var out = [], start = (startDeg==null? -90 : startDeg) * Math.PI/180;
  for(var i=0;i<n;i++){
    var ang = start + i*(2*Math.PI/Math.max(1,n));
    out.push({x: 50 + radius*Math.cos(ang), y: 50 + radius*Math.sin(ang)});
  }
  return out;
}

// Node radius from brightness (0..1) + a gentle count bump.
function _lifeNodeR(brightness, count){
  var base = 5.2, glow = (brightness||0) * 3.4, bump = Math.min(1.6, Math.log((count||0)+1)*1.1);
  return base + glow + bump;
}

// ─── Build: constellation (L0) ────────────────────────────────
function _lifeBuildConstellation(){
  if(!_lifeData) return;
  var areas = _lifeData.areas || [];
  var pts = _lifeRing(areas.length, 33, -90);
  _lifeNodes = [];
  // Center hub
  var isFam = _lifeData.scope === "family";
  _lifeNodes.push({
    id:"_hub", type:"hub", hx:50, hy:50, x:50, y:50, vx:0, vy:0,
    r: isFam ? 9.5 : 8.5,
    color: isFam ? "#E06A8A" : "#A9A48F",
    label: isFam ? tr("life_us") : tr("life_you"),
    emoji: "", bright: isFam ? (_lifeData.bond||0) : 0.5,
  });
  areas.forEach(function(a, i){
    _lifeNodes.push({
      id:a.id, type:"area", hx:pts[i].x, hy:pts[i].y, x:pts[i].x, y:pts[i].y, vx:0, vy:0,
      r:_lifeNodeR(a.brightness, a.habit_count), color:a.color,
      label:a.name, emoji:a.emoji, bright:a.brightness, count:a.habit_count,
    });
  });
  _lifeEdges = areas.map(function(a){ return ["_hub", a.id] });
  _lifeDraw();
  _lifeSetHint(isFam ? tr("life_hint_family") : tr("life_hint_personal"));
}

// ─── Build: inside an area (L1) ───────────────────────────────
function _lifeBuildArea(){
  var area = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  if(!area) return;
  var habits = _lifeAreaHabits || [];
  var n = habits.length + 1; // +1 for the Add node
  var pts = _lifeRing(n, 33, -90);
  _lifeNodes = [];
  _lifeNodes.push({
    id:"_hub", type:"areahub", hx:50, hy:50, x:50, y:50, vx:0, vy:0,
    r:10, color:area.color, label:area.name, emoji:area.emoji, bright:area.brightness,
  });
  habits.forEach(function(hb, i){
    var done = hb.done_today;
    _lifeNodes.push({
      id:"h"+hb.id, hid:hb.id, type:"habit", hx:pts[i].x, hy:pts[i].y, x:pts[i].x, y:pts[i].y, vx:0, vy:0,
      r: 5.0 + (hb.consistency||0)*2.6, color:area.color,
      label:hb.name, emoji:hb.emoji||"•", bright:hb.consistency, done:done, streak:hb.streak,
    });
  });
  // Add node (dashed) in the last slot
  var ap = pts[n-1];
  _lifeNodes.push({id:"_add", type:"add", hx:ap.x, hy:ap.y, x:ap.x, y:ap.y, vx:0, vy:0, r:5.4, color:area.color});
  _lifeEdges = _lifeNodes.filter(function(nd){return nd.id!=="_hub"}).map(function(nd){return ["_hub", nd.id]});
  _lifeDraw();
  _lifeSetHint(habits.length ? tr("life_hint_area") : tr("life_hint_area_empty"));
}

var _lifeEdges = [];

function _lifeSetHint(t){ var el=document.getElementById("life-hint"); if(el) el.textContent = t||""; }

// ─── SVG draw ─────────────────────────────────────────────────
function _lifeDraw(){
  var svg = document.getElementById("life-svg"); if(!svg) return;
  var NS = "http://www.w3.org/2000/svg";
  // defs: one radial gradient per distinct color for cheap glow
  var colors = {}; _lifeNodes.forEach(function(n){ colors[n.color]=1 });
  var defs = '<defs>';
  Object.keys(colors).forEach(function(c){
    defs += '<radialGradient id="'+_lifeGradId(c)+'"><stop offset="0%" stop-color="'+c+'" stop-opacity="0.55"/><stop offset="70%" stop-color="'+c+'" stop-opacity="0.10"/><stop offset="100%" stop-color="'+c+'" stop-opacity="0"/></radialGradient>';
  });
  defs += '</defs>';
  // edges
  var eh = '';
  _lifeEdges.forEach(function(e){
    var a=_lifeNodeById(e[0]), b=_lifeNodeById(e[1]); if(!a||!b) return;
    var strength = Math.max(a.bright||0, b.bright||0);
    eh += '<line class="life-edge" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke-opacity="'+(0.12+strength*0.4).toFixed(2)+'" data-a="'+e[0]+'" data-b="'+e[1]+'"/>';
  });
  // nodes
  var nh = '';
  _lifeNodes.forEach(function(n, i){
    nh += _lifeNodeSvg(n, i);
  });
  svg.innerHTML = defs + '<g id="life-edges">'+eh+'</g><g id="life-nodes">'+nh+'</g>';
  _lifeBindPointer(svg);
}

function _lifeGradId(c){ return "grad_"+c.replace(/[^a-z0-9]/gi,""); }
function _lifeNodeById(id){ for(var i=0;i<_lifeNodes.length;i++) if(_lifeNodes[i].id===id) return _lifeNodes[i]; return null; }

function _lifeNodeSvg(n){
  var glowR = n.r * 2.5;
  var dash = n.type==="add" ? ' stroke-dasharray="2 2"' : '';
  var fillOpacity = n.type==="add" ? 0.04 : (0.18 + (n.bright||0)*0.5);
  var ringW = n.type==="add" ? 0.6 : 0.7;
  // breathing delay varies per node for an organic feel
  var delay = ((n.x*7+n.y*3)%40)/10;
  var label = '';
  if(n.type==="add"){
    label = '<text class="life-add-plus" x="'+n.x+'" y="'+(n.y+0.1)+'">+</text>';
  } else {
    var em = n.emoji ? '<text class="life-emoji" x="'+n.x+'" y="'+(n.y+0.2)+'">'+n.emoji+'</text>' : '';
    label = em;
  }
  // caption below node
  var cap = '';
  if(n.type!=="add"){
    var capY = n.y + n.r + 4.2;
    var nm = n.label || "";
    cap = '<text class="life-cap'+(n.type==="hub"||n.type==="areahub"?" life-cap-hub":"")+'" x="'+n.x+'" y="'+capY+'">'+es(nm.length>14?nm.slice(0,13)+"…":nm)+'</text>';
    if(n.type==="area"){
      cap += '<text class="life-sub" x="'+n.x+'" y="'+(capY+3.4)+'">'+Math.round((n.bright||0)*100)+'%</text>';
    }
    if(n.type==="habit"){
      cap += '<text class="life-sub" x="'+n.x+'" y="'+(capY+3.4)+'">'+(n.done?"✓ ":"")+(n.streak||0)+'🔥</text>';
    }
  }
  var doneRing = (n.type==="habit"&&n.done) ? '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+(n.r+1.2)+'" fill="none" stroke="'+n.color+'" stroke-width="0.6" stroke-opacity="0.9"/>' : '';
  var bd = 'style="animation-delay:-'+delay.toFixed(2)+'s"';
  return '<g class="life-node" data-id="'+n.id+'">'+
    '<circle class="life-glow life-breathe" '+bd+' cx="'+n.x+'" cy="'+n.y+'" r="'+glowR+'" fill="url(#'+_lifeGradId(n.color)+')"/>'+
    '<circle class="life-core life-breathe" '+bd+' cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="'+n.color+'" fill-opacity="'+fillOpacity.toFixed(2)+'" stroke="'+n.color+'" stroke-width="'+ringW+'"'+dash+'/>'+
    doneRing + label + cap +
  '</g>';
}

// ─── Pointer: tap / drag / long-press(1s) + spring coupling ──
function _lifeBindPointer(svg){
  svg.onpointerdown = function(ev){
    var g = ev.target.closest && ev.target.closest(".life-node"); if(!g) return;
    var id = g.getAttribute("data-id");
    var node = _lifeNodeById(id); if(!node) return;
    var p = _lifeToSvg(svg, ev.clientX, ev.clientY);
    _lifeDrag = {id:id, moved:false, sx:p.x, sy:p.y, t:Date.now()};
    try{ svg.setPointerCapture(ev.pointerId) }catch(e){}
    // long-press (1s) → edit, only for area nodes in constellation
    if(node.type==="area"){
      _lifeLongTimer = setTimeout(function(){
        _lifeLongTimer = null;
        if(_lifeDrag && !_lifeDrag.moved){ _lifeDrag = null; hp("med"); _lifeOpenNodeEdit(id); }
      }, 1000);
    }
  };
  svg.onpointermove = function(ev){
    if(!_lifeDrag) return;
    var p = _lifeToSvg(svg, ev.clientX, ev.clientY);
    if(!_lifeDrag.moved){
      var dx=p.x-_lifeDrag.sx, dy=p.y-_lifeDrag.sy;
      if(dx*dx+dy*dy > 4){ _lifeDrag.moved = true; if(_lifeLongTimer){clearTimeout(_lifeLongTimer);_lifeLongTimer=null;} _lifeStartSim(); }
    }
    if(_lifeDrag.moved){
      var nd = _lifeNodeById(_lifeDrag.id);
      if(nd){ nd.x = p.x; nd.y = p.y; nd.vx=0; nd.vy=0; }
    }
  };
  svg.onpointerup = function(ev){
    if(_lifeLongTimer){ clearTimeout(_lifeLongTimer); _lifeLongTimer=null; }
    if(!_lifeDrag) return;
    var d = _lifeDrag; _lifeDrag = null;
    if(d.moved){ _lifeSettleUntil = Date.now()+450; _lifeStartSim(); }
    else { _lifeTapNode(d.id); }
  };
  svg.onpointercancel = function(){ if(_lifeLongTimer){clearTimeout(_lifeLongTimer);_lifeLongTimer=null;} _lifeDrag=null; };
}

// Convert client coords → SVG user units via the inverse CTM.
function _lifeToSvg(svg, cx, cy){
  var pt = svg.createSVGPoint(); pt.x=cx; pt.y=cy;
  var m = svg.getScreenCTM(); if(!m) return {x:50,y:50};
  var r = pt.matrixTransform(m.inverse());
  return {x:r.x, y:r.y};
}

function _lifeTapNode(id){
  var n = _lifeNodeById(id); if(!n) return;
  if(_lifeView==="constellation"){
    if(n.type==="area"){ hp("light"); _lifeOpenArea(n.id); }
  } else {
    if(n.type==="add"){ hp("light"); _lifeOpenAddHabit(); }
    else if(n.type==="habit"){ hp("light"); _lifeOpenHabit(n.hid); }
  }
}

function _lifeOpenArea(areaId){
  _lifeView = "area"; _lifeAreaId = areaId; _lifeAreaHabits = [];
  _lifeRenderTopBar();
  _lifeBuildArea();          // renders Add node immediately
  _lifeLoadArea(areaId);     // fills habits
}

// ─── Spring sim (runs only while dragging / settling) ─────────
function _lifeStartSim(){
  if(_lifeRAF) return;
  var step = function(){
    var dragging = !!(_lifeDrag && _lifeDrag.moved);
    var settling = Date.now() < _lifeSettleUntil;
    var kHome = 0.018, kEdge = 0.010, damp = 0.86, dt = 1;
    var energy = 0;
    // forces
    _lifeNodes.forEach(function(n){ n.fx=0; n.fy=0; });
    _lifeNodes.forEach(function(n){
      if(_lifeDrag && _lifeDrag.id===n.id && dragging) return; // dragged is pinned
      n.fx += (n.hx - n.x)*kHome;
      n.fy += (n.hy - n.y)*kHome;
    });
    _lifeEdges.forEach(function(e){
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
    if(dragging || settling || energy > 0.04){
      _lifeRAF = requestAnimationFrame(step);
    } else {
      _lifeRAF = null;
    }
  };
  _lifeRAF = requestAnimationFrame(step);
}

// Move existing SVG elements instead of re-rendering — cheap per frame.
function _lifeApplyPositions(){
  var svg = document.getElementById("life-svg"); if(!svg) return;
  _lifeNodes.forEach(function(n){
    var g = svg.querySelector('.life-node[data-id="'+n.id+'"]'); if(!g) return;
    var dx = n.x - n.hx, dy = n.y - n.hy;
    g.setAttribute("transform","translate("+dx.toFixed(2)+" "+dy.toFixed(2)+")");
  });
  // edges follow
  var lines = svg.querySelectorAll(".life-edge");
  lines.forEach(function(ln){
    var a=_lifeNodeById(ln.getAttribute("data-a")), b=_lifeNodeById(ln.getAttribute("data-b"));
    if(a){ ln.setAttribute("x1",a.x.toFixed(2)); ln.setAttribute("y1",a.y.toFixed(2)); }
    if(b){ ln.setAttribute("x2",b.x.toFixed(2)); ln.setAttribute("y2",b.y.toFixed(2)); }
  });
}

// ─── Add habit (inside an area) ───────────────────────────────
var _lifeHabitDraft = null;
function _lifeOpenAddHabit(){
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  _lifeHabitDraft = {emoji:"🌱", name:"", type:"build", freq:"daily", intent:""};
  oMC(tr("life_new_habit")+(area?" · "+area.emoji+" "+es(area.name):""), _lifeHabitFormHtml(), {ic:"life"});
}
function _lifeHabitFormHtml(){
  var d = _lifeHabitDraft;
  var h = '';
  h += '<div style="display:flex;gap:10px;align-items:flex-end">';
  h += '<div><div class="lb">'+tr("g_emoji")+'</div><input class="inp" id="lf-e" value="'+es(d.emoji)+'" style="width:64px;text-align:center;font-size:20px"></div>';
  h += '<div style="flex:1"><div class="lb">'+tr("life_habit_name")+'</div><input class="inp" id="lf-n" placeholder="'+tr("life_habit_ph")+'" value="'+es(d.name)+'"></div>';
  h += '</div>';
  h += '<div class="lb">'+tr("life_type")+'</div><div class="or">';
  ["build","maintain","reduce"].forEach(function(t){
    h += '<button class="ob '+(d.type===t?"s":"")+'" onclick="_lifeHabitDraft.type=\''+t+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+tr("life_type_"+t)+'</button>';
  });
  h += '</div>';
  h += '<div class="lb">'+tr("life_frequency")+'</div><div class="or" id="lf-days">';
  h += '<button class="ob '+(d.freq==="daily"?"s":"")+'" onclick="_lifeFreqDaily(this)">'+tr("life_daily")+'</button>';
  // data-d uses Python weekday() convention: 0=Mon .. 6=Sun (matches backend).
  ["mon","tue","wed","thu","fri","sat","sun"].forEach(function(dn,i){
    h += '<button class="ob lf-day" data-d="'+i+'" onclick="_lifeFreqToggle(this)">'+tr("dow_short_"+dn)+'</button>';
  });
  h += '</div>';
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveHabit()">'+tr("btn_add")+'</button>';
  return h;
}
function _lifeFreqDaily(btn){
  _lifeHabitDraft.freq="daily";
  document.querySelectorAll("#lf-days .lf-day").forEach(function(b){b.classList.remove("s")});
  btn.classList.add("s");
}
function _lifeFreqToggle(btn){
  btn.classList.toggle("s");
  var days = []; document.querySelectorAll("#lf-days .lf-day.s").forEach(function(b){days.push(parseInt(b.dataset.d))});
  var daily = document.querySelector("#lf-days .ob:not(.lf-day)");
  if(days.length){ if(daily)daily.classList.remove("s"); _lifeHabitDraft.freq=days; }
  else { if(daily)daily.classList.add("s"); _lifeHabitDraft.freq="daily"; }
}
async function _lifeSaveHabit(){
  var d = _lifeHabitDraft;
  d.emoji = (document.getElementById("lf-e")||{}).value || d.emoji;
  d.name = ((document.getElementById("lf-n")||{}).value||"").trim();
  if(!d.name){ toast(tr("life_name_required")); return }
  var r = await A("POST","/api/life/habits",{
    owner:_lifeOwner, area_id:_lifeAreaId, name:d.name, emoji:d.emoji,
    type:d.type, frequency:d.freq, intent:d.intent||""
  });
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); cMo(); _lifeHabitDraft=null;
  await _lifeLoadArea(_lifeAreaId);
  _lifeLoadSummary(); // refresh area brightness for when we go back
}

// ─── Habit detail (streak / consistency / mark done) ──────────
async function _lifeOpenHabit(hid){
  var hb = _lifeAreaHabits.find(function(x){return x.id===hid}); if(!hb) return;
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  var col = area ? area.color : "var(--pr)";
  var h = '<div class="life-d">';
  h += '<div class="life-d-emoji" style="background:color-mix(in srgb,'+col+' 18%,transparent);border:1px solid color-mix(in srgb,'+col+' 40%,transparent)">'+(hb.emoji||"🌱")+'</div>';
  h += '<div class="life-d-name">'+es(hb.name)+'</div>';
  h += '<div class="life-d-type">'+tr("life_type_"+(hb.type||"build"))+'</div>';
  h += '<div class="life-d-stats">';
  h += '<div class="life-d-stat"><div class="life-d-v" style="color:'+col+'">'+(hb.streak||0)+'</div><div class="life-d-l">'+tr("life_streak")+'</div></div>';
  h += '<div class="life-d-stat"><div class="life-d-v">'+Math.round((hb.consistency||0)*100)+'%</div><div class="life-d-l">'+tr("life_consistency")+'</div></div>';
  h += '</div>';
  var doneLbl = hb.done_today ? "✓ "+tr("life_done_today") : tr("life_mark_done");
  var doneStyle = hb.done_today ? "background:transparent;border:1.5px solid "+col+";color:"+col : "background:"+col+";border:none;color:#fff";
  h += '<button class="btn" style="'+doneStyle+';margin-top:4px" onclick="_lifeToggleDone('+hid+')">'+doneLbl+'</button>';
  h += '<div style="display:flex;gap:8px;margin-top:10px">';
  h += '<button class="btn btn-s" style="flex:1;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_lifeDeleteHabit('+hid+')">🗑 '+tr("btn_delete")+'</button>';
  h += '</div>';
  h += '</div>';
  oMC(tr("life_habit"), h, {ic:"life"});
}
async function _lifeToggleDone(hid){
  var r = await A("POST","/api/life/habits/"+hid+"/log");
  if(!r || !r.id){ toast(tr("ts_error")); return }
  hp(r.done_today?"ok":"light");
  // update local + ripple: pulse the node + its hub
  var hb = _lifeAreaHabits.find(function(x){return x.id===hid}); if(hb){ hb.done_today=r.done_today; hb.streak=r.streak; hb.consistency=r.consistency; }
  cMo();
  _lifeBuildArea();
  _lifeRipple("h"+hid);
  _lifeLoadSummary();
}
async function _lifeDeleteHabit(hid){
  if(!confirm(tr("life_delete_confirm"))) return;
  var r = await A("DELETE","/api/life/habits/"+hid);
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  hp("warn"); cMo();
  _lifeAreaHabits = _lifeAreaHabits.filter(function(x){return x.id!==hid});
  _lifeBuildArea(); _lifeLoadSummary();
}

// One-shot ripple ring expanding from a node — reinforces "system impact".
function _lifeRipple(nodeId){
  var svg = document.getElementById("life-svg"); var n=_lifeNodeById(nodeId); if(!svg||!n) return;
  var NS="http://www.w3.org/2000/svg";
  var c = document.createElementNS(NS,"circle");
  c.setAttribute("cx",n.x); c.setAttribute("cy",n.y); c.setAttribute("r",n.r);
  c.setAttribute("fill","none"); c.setAttribute("stroke",n.color); c.setAttribute("stroke-width","0.8");
  c.setAttribute("class","life-ripple");
  svg.appendChild(c);
  setTimeout(function(){ if(c.parentNode) c.parentNode.removeChild(c) }, 700);
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
  oMC(tr("life_edit_node"), h, {ic:"life"});
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
