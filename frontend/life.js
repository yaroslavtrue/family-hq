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
// iOS-style edit mode (v8.52.1): long-press the empty canvas → nodes wiggle and
// a tap edits the node (area → rename/emoji, habit → full edit). Tap background
// to finish.
var _lifeEditMode = false;
var _lifeBg = null;             // background press tracking
var _lifeBgTimer = null;

// ─── Entry: shell HTML (ren() injects this into #ct) ──────────
function rLife(){
  // life-mode (body class set by app.js go()) hides the global header; we render
  // our own top bar with the owner filter and an in-canvas back button.
  // Canvas fills the whole area below the header; the filter row and hint float
  // as absolute overlays ON the canvas (no separate black strips).
  var h = '<div class="life-wrap">';
  h += '<div class="life-stage"><svg id="life-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg></div>';
  h += '<div class="life-top" id="life-top"></div>';
  h += '<div class="life-hint" id="life-hint"></div>';
  h += '</div>';
  setTimeout(lifeMount, 0);
  return h;
}

// Called by app.js after the shell is in the DOM (and on lazy-load completion).
function lifeMount(){
  if(tab !== "life") return;
  if(!_lifeOwner) _lifeOwner = String((fS && fS.my_id) || (D.members[0] && D.members[0].user_id) || "");
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
  _lifeEditMode = false;
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF = null; }
  if(_lifeLongTimer){ clearTimeout(_lifeLongTimer); _lifeLongTimer = null; }
  if(_lifeBgTimer){ clearTimeout(_lifeBgTimer); _lifeBgTimer = null; }
  if(_lifeResizeBound){ window.removeEventListener("resize", _lifeResizeBound); _lifeResizeBound = null; }
  _lifeDrag = null;
}

// ─── Top bar: owner filter (Me / partner / Family) + back ─────
// The global app header is visible again (v8.51.1) — this is just the slim
// filter row beneath it, like the member-filter rows in Tasks/Money.
function _lifeRenderTopBar(){
  var el = document.getElementById("life-top"); if(!el) return;
  var h = '';
  if(_lifeView === "area"){
    h += '<button class="life-back" onclick="_lifeBack()" aria-label="Back">‹</button>';
    var a = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
    h += '<div class="life-areaname">'+(a?a.emoji+' '+es(a.name):tr("nav_life"))+'</div>';
    h += '<div style="flex:1"></div>';
  } else {
    h += '<div style="flex:1"></div>';
    h += '<div class="life-chips">';
    (D.members||[]).forEach(function(m){
      var on = _lifeOwner === String(m.user_id);
      h += '<button class="life-chip'+(on?' on':'')+'" onclick="_lifeSetOwner(\''+m.user_id+'\')">'+mAv(m.user_id,24)+'</button>';
    });
    var famOn = _lifeOwner === "family";
    h += '<button class="life-chip life-chip-fam'+(famOn?' on':'')+'" onclick="_lifeSetOwner(\'family\')">❤️</button>';
    h += '</div>';
  }
  el.innerHTML = h;
  _lifeSizeStage();
}

// Member lookup within the loaded summary.
function _lifeMember(uid){
  return ((_lifeData && _lifeData.members) || []).find(function(m){ return String(m.user_id) === String(uid) });
}

// Avatar rendered in SVG user units: clipped photo if available, else a colored
// disc with the member's emoji. Mirrors mAv()'s fallback logic.
function _lifeAvatarSvg(m, cx, cy, r){
  var col = (m && m.color) || "#A9A48F";
  var ring = '<circle cx="'+cx+'" cy="'+cy+'" r="'+(r+0.5)+'" fill="none" stroke="'+col+'" stroke-width="0.7" stroke-opacity="0.95"/>';
  if(m && m.photo_url){
    var clip = "avc_"+(m.user_id)+"_"+Math.round(cx*10)+"_"+Math.round(cy*10);
    return '<clipPath id="'+clip+'"><circle cx="'+cx+'" cy="'+cy+'" r="'+r+'"/></clipPath>'+
      '<image href="'+es(m.photo_url)+'" x="'+(cx-r)+'" y="'+(cy-r)+'" width="'+(2*r)+'" height="'+(2*r)+'" clip-path="url(#'+clip+')" preserveAspectRatio="xMidYMid slice"/>'+ring;
  }
  return '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+col+'" fill-opacity="0.22" stroke="'+col+'" stroke-width="0.7"/>'+
    '<text x="'+cx+'" y="'+(cy+0.2)+'" class="life-emoji" style="font-size:'+(r*1.05).toFixed(1)+'px">'+((m&&m.emoji)||"👤")+'</text>';
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
  _lifeView = "constellation"; _lifeAreaId = null;
  _lifeRenderTopBar();
  _lifeLoadSummary();
}

function _lifeBack(){
  hp("light");
  _lifeEditMode = false;
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

// Node radius from brightness (0..1) + a gentle count bump.
function _lifeNodeR(brightness, count){
  var base = 5.2, glow = (brightness||0) * 3.4, bump = Math.min(1.6, Math.log((count||0)+1)*1.1);
  return base + glow + bump;
}

// ─── Build: constellation (L0) ────────────────────────────────
function _lifeBuildConstellation(){
  if(!_lifeData) return;
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
    _lifeNodes.push({
      id:a.id, type:"area", hx:pts[i].x, hy:pts[i].y, x:pts[i].x, y:pts[i].y, vx:0, vy:0,
      r:_lifeNodeR(a.brightness, a.habit_count), color:a.color,
      label:a.name, emoji:a.emoji, bright:a.brightness, count:a.habit_count, is_custom:a.is_custom,
    });
  });
  if(addSphere){
    var sp = pts[n-1];
    _lifeNodes.push({id:"_addarea", type:"addarea", hx:sp.x, hy:sp.y, x:sp.x, y:sp.y, vx:0, vy:0, r:5.6, color:"#A9A48F"});
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
  _lifeDraw();
  _lifeSetHint(isFam ? tr("life_hint_family") : tr("life_hint_personal"));
  // Family runs a continuous (cheap) sim for the orbit + avatar springs.
  if(_lifeOrbiting) _lifeStartSim();
}

// ─── Build: inside an area (L1) ───────────────────────────────
function _lifeBuildArea(){
  var area = _lifeData && (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  if(!area) return;
  if(_lifeRAF){ cancelAnimationFrame(_lifeRAF); _lifeRAF=null; }
  _lifeOrbiting = false; _lifeAvEdges = [];
  _lifeComputeVb();
  var cx = _lifeCx(), cy = _lifeCy();
  var habits = _lifeAreaHabits || [];
  // The "+" Add and "✨ Ideas" seeds only appear in edit mode (they grow out of
  // the centre). In normal mode the area just shows its habits.
  var withSeeds = _lifeEditMode;
  var n = habits.length + (withSeeds ? 2 : 0);
  var pts = _lifeRing(n, -90);
  _lifeNodes = [];
  _lifeNodes.push({
    id:"_hub", type:"areahub", hx:cx, hy:cy, x:cx, y:cy, vx:0, vy:0,
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
  if(withSeeds){
    var ap = pts[n-2];
    _lifeNodes.push({id:"_add", type:"add", hx:ap.x, hy:ap.y, x:ap.x, y:ap.y, vx:0, vy:0, r:5.4, color:area.color});
    var ip = pts[n-1];
    _lifeNodes.push({id:"_ideas", type:"ideas", hx:ip.x, hy:ip.y, x:ip.x, y:ip.y, vx:0, vy:0, r:5.4, color:area.color});
  }
  _lifeEdges = _lifeNodes.filter(function(nd){return nd.id!=="_hub"}).map(function(nd){return ["_hub", nd.id]});
  _lifeDraw();
  _lifeSetHint(habits.length ? tr("life_hint_area") : tr("life_hint_area_empty"));
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
function _lifeDraw(){
  var svg = document.getElementById("life-svg"); if(!svg) return;
  svg.setAttribute("viewBox", "0 0 100 "+_lifeVbH);
  var NS = "http://www.w3.org/2000/svg";
  // defs: one radial gradient per distinct color for cheap glow
  var colors = {}; _lifeNodes.forEach(function(n){ colors[n.color]=1 });
  var defs = '<defs>';
  Object.keys(colors).forEach(function(c){
    defs += '<radialGradient id="'+_lifeGradId(c)+'"><stop offset="0%" stop-color="'+c+'" stop-opacity="0.55"/><stop offset="70%" stop-color="'+c+'" stop-opacity="0.10"/><stop offset="100%" stop-color="'+c+'" stop-opacity="0"/></radialGradient>';
  });
  defs += '</defs>';
  // Anchor each node's DRAW position (the sim translates the <g> by current −
  // anchor; for orbiting avatars the home moves, so we must remember where the
  // element was actually rendered).
  _lifeNodes.forEach(function(n){ n.ox = n.x; n.oy = n.y; });
  // edges (gray spokes)
  var eh = '';
  _lifeEdges.forEach(function(e){
    var a=_lifeNodeById(e[0]), b=_lifeNodeById(e[1]); if(!a||!b) return;
    var strength = Math.max(a.bright||0, b.bright||0);
    eh += '<line class="life-edge" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke-opacity="'+(0.12+strength*0.4).toFixed(2)+'" data-a="'+e[0]+'" data-b="'+e[1]+'"/>';
  });
  // bond line between the two family avatars (glow + core), updated each frame.
  if(_lifeOrbiting){
    var a0=_lifeNodeById("_av0"), a1=_lifeNodeById("_av1");
    if(a0&&a1){
      var b = _lifeBond;
      eh += '<line id="life-bondglow" x1="'+a0.x+'" y1="'+a0.y+'" x2="'+a1.x+'" y2="'+a1.y+'" stroke="#E06A8A" stroke-width="'+(2.2+b*2.6).toFixed(2)+'" stroke-opacity="'+(0.12+b*0.28).toFixed(2)+'" stroke-linecap="round"/>';
      eh += '<line id="life-bondcore" x1="'+a0.x+'" y1="'+a0.y+'" x2="'+a1.x+'" y2="'+a1.y+'" stroke="#E06A8A" stroke-width="'+(0.5+b*1.1).toFixed(2)+'" stroke-opacity="'+(0.45+b*0.5).toFixed(2)+'" stroke-linecap="round"/>';
    }
  }
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
  // ─── Family avatar satellites (v8.51.7) — real physics nodes. The avatar is
  // drawn at the node's own position; the spring sim moves the <g> via translate
  // (pure translation → stays upright, no counter-rotation needed). ───
  if(n.type==="avatar"){
    return '<g class="life-node" data-id="'+n.id+'">'+_lifeAvatarSvg(n.member, n.x, n.y, n.r)+'</g>';
  }
  // ─── Center hub: personal → owner avatar; family → bond-scaled glow only
  // (the two avatars are separate physics nodes; the bond line is drawn in
  // _lifeDraw and updated each frame). ───
  if(n.type==="hub"){
    if(_lifeData && _lifeData.scope === "family"){
      var bond = Math.max(0, Math.min(1, _lifeData.bond || 0));
      var gC = '<circle class="life-glow life-breathe" cx="'+n.x+'" cy="'+n.y+'" r="'+(glowR*(0.85+bond*0.5))+'" fill="url(#'+_lifeGradId(n.color)+')" opacity="'+(0.5+bond*0.5).toFixed(2)+'"/>';
      return '<g class="life-node" data-id="'+n.id+'">'+gC+'</g>';
    }
    var glow = '<circle class="life-glow life-breathe" cx="'+n.x+'" cy="'+n.y+'" r="'+glowR+'" fill="url(#'+_lifeGradId(n.color)+')"/>';
    var av = _lifeAvatarSvg(_lifeMember(_lifeOwner), n.x, n.y, n.r);
    return '<g class="life-node" data-id="'+n.id+'">'+glow+av+'</g>';
  }
  var isSeed = (n.type==="add" || n.type==="ideas" || n.type==="addarea");  // dashed placeholders
  var dash = isSeed ? ' stroke-dasharray="2 2"' : '';
  var fillOpacity = isSeed ? 0.04 : (0.18 + (n.bright||0)*0.5);
  var ringW = isSeed ? 0.6 : 0.7;
  // breathing delay varies per node for an organic feel
  var delay = ((n.x*7+n.y*3)%40)/10;
  var label = '';
  if(n.type==="add" || n.type==="addarea"){
    label = '<text class="life-add-plus" x="'+n.x+'" y="'+(n.y+0.1)+'">+</text>';
  } else if(n.type==="ideas"){
    label = '<text class="life-emoji" x="'+n.x+'" y="'+(n.y+0.2)+'" style="font-size:5px">✨</text>';
  } else {
    var em = n.emoji ? '<text class="life-emoji" x="'+n.x+'" y="'+(n.y+0.2)+'">'+n.emoji+'</text>' : '';
    label = em;
  }
  // caption below node
  var cap = '';
  if(n.type==="ideas"){
    cap = '<text class="life-cap" x="'+n.x+'" y="'+(n.y+n.r+4.2)+'" style="opacity:.6">'+tr("life_ideas")+'</text>';
  } else if(n.type==="addarea"){
    cap = '<text class="life-cap" x="'+n.x+'" y="'+(n.y+n.r+4.2)+'" style="opacity:.6">'+tr("life_new_sphere")+'</text>';
  } else if(n.type!=="add"){
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
  var content =
    '<circle class="life-glow life-breathe" '+bd+' cx="'+n.x+'" cy="'+n.y+'" r="'+glowR+'" fill="url(#'+_lifeGradId(n.color)+')"/>'+
    '<circle class="life-core life-breathe" '+bd+' cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="'+n.color+'" fill-opacity="'+fillOpacity.toFixed(2)+'" stroke="'+n.color+'" stroke-width="'+ringW+'"'+dash+'/>'+
    doneRing + label + cap;
  // Wiggle lives on an INNER group so it never fights the outer group's translate
  // (drag/orbit). Editable nodes wiggle gently at rest (.life-idle) and harder
  // in edit mode (.life-wiggle); per-node delay desyncs them; transform-origin
  // at the node centre keeps it in place.
  var editable = (n.type==="area" || n.type==="habit");
  if(editable){
    var wcls = _lifeEditMode ? "life-wiggle" : "life-idle";
    content = '<g class="'+wcls+'" style="animation-delay:-'+(delay*0.5).toFixed(2)+'s;transform-origin:'+n.x+'px '+n.y+'px">'+content+'</g>';
  }
  // Seeds grow out of the hub centre (outer group — they never drag).
  var outerCls = "life-node", outerStyle = "";
  if(isSeed){
    outerCls += " life-grow";
    outerStyle = ' style="transform-box:view-box;transform-origin:'+_lifeCx()+'px '+_lifeCy()+'px"';
  }
  return '<g class="'+outerCls+'"'+outerStyle+' data-id="'+n.id+'">'+content+'</g>';
}

// ─── Pointer: bg long-press (edit mode) · node tap / drag / long-press ──
function _lifeBindPointer(svg){
  svg.onpointerdown = function(ev){
    var g = ev.target.closest && ev.target.closest(".life-node");
    var p = _lifeToSvg(svg, ev.clientX, ev.clientY);
    if(!g){
      // Empty canvas: a long-press toggles edit mode.
      _lifeBg = {sx:p.x, sy:p.y, moved:false};
      _lifeBgTimer = setTimeout(function(){
        _lifeBgTimer = null;
        if(_lifeBg && !_lifeBg.moved){ _lifeBg.fired = true; _lifeSetEdit(!_lifeEditMode); }
      }, 650);
      return;
    }
    var id = g.getAttribute("data-id");
    var node = _lifeNodeById(id); if(!node) return;
    _lifeDrag = {id:id, moved:false, sx:p.x, sy:p.y, t:Date.now()};
    try{ svg.setPointerCapture(ev.pointerId) }catch(e){}
    // In edit mode a node tap edits it — no drag, no per-node long-press.
    if(_lifeEditMode) return;
    // Normal mode: long-press (1s) on an area node → quick rename.
    if(node.type==="area"){
      _lifeLongTimer = setTimeout(function(){
        _lifeLongTimer = null;
        if(_lifeDrag && !_lifeDrag.moved){ _lifeDrag = null; hp("med"); _lifeOpenNodeEdit(id); }
      }, 1000);
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
      if(nd){ nd.x = p.x; nd.y = p.y; nd.vx=0; nd.vy=0; }
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

// Toggle edit mode — rebuild so nodes get/lose the wiggle, refresh the hint.
function _lifeSetEdit(on){
  if(_lifeEditMode === on) return;
  _lifeEditMode = on;
  hp(on ? "med" : "light");
  if(_lifeView==="area") _lifeBuildArea(); else _lifeBuildConstellation();
  if(on) _lifeSetHint(tr("life_edit_on"));
}

// In edit mode, tapping a node opens its editor.
function _lifeEditNode(id){
  var n = _lifeNodeById(id); if(!n) return;
  hp("light");
  if(n.type==="area"){ _lifeOpenNodeEdit(n.id); }
  else if(n.type==="habit"){ _lifeOpenHabitEdit(n.hid); }
  else if(n.type==="add"){ _lifeOpenAddHabit(); }
  else if(n.type==="ideas"){ _lifeSuggest(); }
  else if(n.type==="addarea"){ _lifeOpenAddArea(); }
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
    else if(n.type==="ideas"){ hp("light"); _lifeSuggest(); }
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
    // Family orbit: advance the angle and move the two avatars' home anchors
    // around the hub's CURRENT position, so the spring sim makes them chase the
    // orbit (and the dragged hub) with a little elastic lag.
    if(_lifeOrbiting){
      _lifeOrbitAngle += 0.005;  // ~21s per turn (spring lag makes it feel calmer)
      var hub = _lifeNodeById("_hub");
      var av0 = _lifeNodeById("_av0"), av1 = _lifeNodeById("_av1");
      if(hub && av0){ av0.hx = hub.x + _lifeOrbitR*Math.cos(_lifeOrbitAngle);        av0.hy = hub.y + _lifeOrbitR*Math.sin(_lifeOrbitAngle); }
      if(hub && av1){ av1.hx = hub.x + _lifeOrbitR*Math.cos(_lifeOrbitAngle+Math.PI); av1.hy = hub.y + _lifeOrbitR*Math.sin(_lifeOrbitAngle+Math.PI); }
    }
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
    if(dragging || settling || _lifeOrbiting || energy > 0.04){
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
function _lifeApplyPositions(){
  var svg = document.getElementById("life-svg"); if(!svg) return;
  _lifeNodes.forEach(function(n){
    var g = svg.querySelector('.life-node[data-id="'+n.id+'"]'); if(!g) return;
    var ax = (n.ox==null?n.hx:n.ox), ay = (n.oy==null?n.hy:n.oy);
    g.setAttribute("transform","translate("+(n.x-ax).toFixed(2)+" "+(n.y-ay).toFixed(2)+")");
  });
  // gray spoke edges follow their endpoints
  var lines = svg.querySelectorAll(".life-edge");
  lines.forEach(function(ln){
    var a=_lifeNodeById(ln.getAttribute("data-a")), b=_lifeNodeById(ln.getAttribute("data-b"));
    if(a){ ln.setAttribute("x1",a.x.toFixed(2)); ln.setAttribute("y1",a.y.toFixed(2)); }
    if(b){ ln.setAttribute("x2",b.x.toFixed(2)); ln.setAttribute("y2",b.y.toFixed(2)); }
  });
  // bond line tracks the two avatars
  if(_lifeOrbiting){
    var a0=_lifeNodeById("_av0"), a1=_lifeNodeById("_av1");
    if(a0&&a1){
      ["life-bondglow","life-bondcore"].forEach(function(id){
        var ln=document.getElementById(id); if(!ln) return;
        ln.setAttribute("x1",a0.x.toFixed(2)); ln.setAttribute("y1",a0.y.toFixed(2));
        ln.setAttribute("x2",a1.x.toFixed(2)); ln.setAttribute("y2",a1.y.toFixed(2));
      });
    }
  }
}

// ─── Add / edit habit (inside an area) ────────────────────────
var _lifeHabitDraft = null;
function _lifeOpenAddHabit(){
  var area = (_lifeData.areas||[]).find(function(x){return x.id===_lifeAreaId});
  _lifeHabitDraft = {id:null, emoji:"🌱", name:"", type:"build", freq:"daily", intent:""};
  oMC(tr("life_new_habit")+(area?" · "+area.emoji+" "+es(area.name):""), _lifeHabitFormHtml(), {ic:"life"});
}
function _lifeOpenHabitEdit(hid){
  var hb = _lifeAreaHabits.find(function(x){return x.id===hid}); if(!hb) return;
  _lifeHabitDraft = {
    id: hb.id, emoji: hb.emoji||"🌱", name: hb.name||"", type: hb.type||"build",
    freq: (Array.isArray(hb.frequency)? hb.frequency.slice() : "daily"),
    intent: hb.intent||"",
  };
  oMC(tr("life_edit_habit"), _lifeHabitFormHtml(), {ic:"life"});
}
function _lifeHabitFormHtml(){
  var d = _lifeHabitDraft;
  var isDays = Array.isArray(d.freq);
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
  h += '<button class="ob '+(!isDays?"s":"")+'" onclick="_lifeFreqDaily(this)">'+tr("life_daily")+'</button>';
  // data-d uses Python weekday() convention: 0=Mon .. 6=Sun (matches backend).
  ["mon","tue","wed","thu","fri","sat","sun"].forEach(function(dn,i){
    var on = isDays && d.freq.indexOf(i)>=0;
    h += '<button class="ob lf-day'+(on?" s":"")+'" data-d="'+i+'" onclick="_lifeFreqToggle(this)">'+tr("dow_short_"+dn)+'</button>';
  });
  h += '</div>';
  h += '<button class="btn" style="margin-top:14px" onclick="_lifeSaveHabit()">'+(d.id?tr("btn_save"):tr("btn_add"))+'</button>';
  if(d.id){
    h += '<button class="btn btn-s" style="margin-top:8px;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_lifeDeleteHabit('+d.id+')">🗑 '+tr("btn_delete")+'</button>';
  }
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
  var r;
  if(d.id){
    r = await A("PATCH","/api/life/habits/"+d.id, {name:d.name, emoji:d.emoji, type:d.type, frequency:d.freq});
  } else {
    r = await A("POST","/api/life/habits", {owner:_lifeOwner, area_id:_lifeAreaId, name:d.name, emoji:d.emoji, type:d.type, frequency:d.freq, intent:d.intent||""});
  }
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
  var r = await A("POST","/api/life/habits", {owner:_lifeOwner, area_id:_lifeAreaId, name:s.name, emoji:s.emoji, type:s.type, frequency:"daily"});
  if(!r || !r.id){ toast(tr("ts_save_failed")); return }
  hp("ok"); s._added = true;
  _lifeRenderSuggestions();
  await _lifeLoadArea(_lifeAreaId);   // node appears under the modal
  _lifeLoadSummary();
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
