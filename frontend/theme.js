// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Theme system (extracted from app.js in v8.36.0)
// ═══════════════════════════════════════════════════════════════
// Loaded BEFORE app.js. Declares the global theme catalog `TH`,
// the current-theme state `cTheme`, color-math helpers, and aT()
// which applies a theme to CSS custom properties on <html>.
//
// All exports are `var` (not const/let) so they're true window-scope
// globals shared with app.js. The Settings theme picker UI (render +
// setTh) stays in app.js for now — it intertwines with the global ren()
// pipeline. Only the engine moves here.

var TH = {
  midnight: {n:"Midnight",e:"🌙",bg:"#0f0f1a",sf:"#1a1a2f",cd:"#212140",bd:"rgba(255,255,255,0.10)",tx:"#e8e6f0",ht:"#9f9dba",pr:"#7c6aef",pg:"rgba(124,106,239,0.15)",ac:"#ef6a7a",ok:"#5cd6a0",wn:"#f0c45a",gd:"linear-gradient(135deg,#5a4cd0,#7c6aef)",gtx:"#fff",l:0},
  dawn:     {n:"Dawn",e:"🌅",bg:"#faf7f2",sf:"#fff8f0",cd:"#ffffff",bd:"rgba(0,0,0,0.10)",tx:"#2d2a24",ht:"#7a7066",pr:"#d4783c",pg:"rgba(212,120,60,0.12)",ac:"#c44d56",ok:"#4a9e6e",wn:"#c9982a",gd:"linear-gradient(135deg,#b85e1e,#d4783c)",gtx:"#fff",l:1},
  forest:   {n:"Forest",e:"🌲",bg:"#0d1a14",sf:"#142420",cd:"#1c3329",bd:"rgba(255,255,255,0.10)",tx:"#d4e8dc",ht:"#85b59a",pr:"#4ec98b",pg:"rgba(78,201,139,0.12)",ac:"#e87461",ok:"#4ec98b",wn:"#d4b84a",gd:"linear-gradient(135deg,#2e9c63,#4ec98b)",gtx:"#fff",l:0},
  ocean:    {n:"Ocean",e:"🌊",bg:"#0a1628",sf:"#0f1f38",cd:"#162a48",bd:"rgba(255,255,255,0.10)",tx:"#d0e4f5",ht:"#7da8cc",pr:"#38a2d4",pg:"rgba(56,162,212,0.15)",ac:"#ef7b5c",ok:"#4ac4a0",wn:"#e0b84c",gd:"linear-gradient(135deg,#1f7eb8,#38a2d4)",gtx:"#fff",l:0},
  rose:     {n:"Rosé",e:"🌸",bg:"#1a0f15",sf:"#261822",cd:"#351f2e",bd:"rgba(255,255,255,0.10)",tx:"#f0dce4",ht:"#bb8aa0",pr:"#e0689a",pg:"rgba(224,104,154,0.15)",ac:"#6ac4dc",ok:"#5cc4a2",wn:"#d8b44e",gd:"linear-gradient(135deg,#c44680,#e0689a)",gtx:"#fff",l:0},
  chalk:    {n:"Chalk",e:"🤍",bg:"#f5f3ef",sf:"#edeae4",cd:"#ffffff",bd:"rgba(0,0,0,0.12)",tx:"#1a1816",ht:"#706b62",pr:"#444038",pg:"rgba(68,64,56,0.08)",ac:"#b8442a",ok:"#3a8a5a",wn:"#a8882a",gd:"linear-gradient(135deg,#2a2620,#444038)",gtx:"#fff",l:1},
  onyx:     {n:"Onyx",e:"🖤",bg:"#000000",sf:"#0a0a0a",cd:"#141414",bd:"rgba(212,175,55,0.18)",tx:"#f5f0e0",ht:"#b8a878",pr:"#d4af37",pg:"rgba(212,175,55,0.12)",ac:"#e85d75",ok:"#5cd6a0",wn:"#f0c45a",gd:"linear-gradient(135deg,#d4af37,#f4cd5a)",gtx:"#000000",l:0},
  lavender: {n:"Lavender",e:"💜",bg:"#f8f5fb",sf:"#f1ecf6",cd:"#ffffff",bd:"rgba(60,30,90,0.12)",tx:"#2a1f3a",ht:"#6b5d80",pr:"#7c3aed",pg:"rgba(124,58,237,0.10)",ac:"#db2777",ok:"#059669",wn:"#d97706",gd:"linear-gradient(135deg,#5b1fc7,#7c3aed)",gtx:"#fff",l:1},
  sunset:   {n:"Sunset",e:"🌇",bg:"#1a0d0a",sf:"#251510",cd:"#2f1c16",bd:"rgba(255,180,120,0.14)",tx:"#f5dccd",ht:"#d4a890",pr:"#ff6b35",pg:"rgba(255,107,53,0.15)",ac:"#ffd166",ok:"#6dc36b",wn:"#ffd166",gd:"linear-gradient(135deg,#d04515,#ff6b35)",gtx:"#fff",l:0},
  custom:   {n:"Custom",e:"🎨",bg:"#0f0f1a",sf:"#1a1a2f",pr:"#7c6aef",ac:"#ef6a7a",ok:"#5cd6a0",__editable:true}
};

// Current theme id. Mutated by aT(); read by render code in app.js.
var cTheme = "midnight";

// ─── Color math helpers (for custom-theme derivation) ────────────
function _hexToRgb(h){h=(h||"").replace('#','');if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];return [parseInt(h.substr(0,2),16)||0,parseInt(h.substr(2,2),16)||0,parseInt(h.substr(4,2),16)||0]}
function _rgbToHex(r,g,b){return '#'+[r,g,b].map(function(v){return Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')}).join('')}
function _mixHex(a,b,t){var A=_hexToRgb(a),B=_hexToRgb(b);return _rgbToHex(A[0]*(1-t)+B[0]*t,A[1]*(1-t)+B[1]*t,A[2]*(1-t)+B[2]*t)}
function _lum(h){var r=_hexToRgb(h);return (0.299*r[0]+0.587*r[1]+0.114*r[2])/255}
function _toRgba(h,a){var r=_hexToRgb(h);return 'rgba('+r[0]+','+r[1]+','+r[2]+','+a+')'}
function _wcagL(h){var r=_hexToRgb(h).map(function(v){v=v/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r[0]+0.7152*r[1]+0.0722*r[2]}
function _contrast(a,b){var la=_wcagL(a),lb=_wcagL(b);var hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05)}

// Derive full theme object from the user's 5 editable colors
function _deriveCustomTheme(c){
  c=c||{};
  var bg=c.bg||"#0f0f1a",sf=c.sf||"#1a1a2f",pr=c.pr||"#7c6aef",ac=c.ac||"#ef6a7a",ok=c.ok||"#5cd6a0";
  var isLight=_lum(bg)>0.55;
  var tx=isLight?"#1a1816":"#e8e6f0";
  var ht=_mixHex(tx,bg,0.45);
  var cd=_mixHex(bg,sf,0.55);
  var gtx=_lum(pr)>0.65?"#1a1a2f":"#fff";
  var darker=_mixHex(pr,"#000000",0.18);
  return {n:"Custom",e:"🎨",bg:bg,sf:sf,cd:cd,tx:tx,ht:ht,pr:pr,ac:ac,ok:ok,wn:"#f0c45a",
    bd:_toRgba(tx,isLight?0.12:0.10),pg:_toRgba(pr,0.15),
    gd:"linear-gradient(135deg,"+darker+","+pr+")",gtx:gtx,l:isLight?1:0}
}

// Read my custom palette from member data (or seed from current non-custom theme)
function _getMyCustomPalette(){
  var myId = (typeof fS !== "undefined" && fS) && fS.my_id;
  var members = (typeof D !== "undefined" && D && D.members) || [];
  var me = myId && members.find(function(m){return m.user_id===myId});
  if(me && me.custom_theme){try{var p=JSON.parse(me.custom_theme); if(p && p.bg) return p}catch(e){}}
  return null;
}

function _seedCustomFromTheme(themeId){
  var t = TH[themeId] || TH.midnight;
  return {bg:t.bg, sf:t.sf, pr:t.pr, ac:t.ac, ok:t.ok};
}

// Apply theme: write CSS variables to <html>, toggle .ls class for light themes,
// update cTheme. Called from init() + setTh() + Custom theme editor.
function aT(id){
  var t;
  if(id==="custom"){
    t = _deriveCustomTheme(_getMyCustomPalette() || _seedCustomFromTheme(cTheme==="custom" ? "midnight" : cTheme));
  } else {
    t = TH[id];
    if(!t) return;
  }
  const r = document.documentElement.style;
  ["bg","sf","cd","bd","tx","ht","pr","pg","ac","ok","wn","gd"].forEach(function(k){r.setProperty("--"+k, t[k])});
  r.setProperty("--gtx", t.gtx || "#fff");
  document.body.classList.toggle("ls", !!t.l);
  cTheme = id;
}
