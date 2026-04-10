// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ v6.1 — Frontend Logic
// ═══════════════════════════════════════════════════════════════

const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();try{tg.enableClosingConfirmation()}catch(e){}}
const iD=tg?.initData||"";

// ─── Themes ─────────────────────────────────────────────────
const TH={
midnight:{n:"Midnight",e:"🌙",bg:"#0f0f1a",sf:"#1a1a2f",cd:"#212140",bd:"rgba(255,255,255,0.06)",tx:"#e8e6f0",ht:"#8785a2",pr:"#7c6aef",pg:"rgba(124,106,239,0.15)",ac:"#ef6a7a",ok:"#5cd6a0",wn:"#f0c45a",gd:"linear-gradient(135deg,#7c6aef,#a78bfa)",l:0},
dawn:{n:"Dawn",e:"🌅",bg:"#faf7f2",sf:"#fff8f0",cd:"#ffffff",bd:"rgba(0,0,0,0.06)",tx:"#2d2a24",ht:"#9e9585",pr:"#d4783c",pg:"rgba(212,120,60,0.12)",ac:"#c44d56",ok:"#4a9e6e",wn:"#c9982a",gd:"linear-gradient(135deg,#d4783c,#e8a46c)",l:1},
forest:{n:"Forest",e:"🌲",bg:"#0d1a14",sf:"#142420",cd:"#1c3329",bd:"rgba(255,255,255,0.06)",tx:"#d4e8dc",ht:"#6e9e82",pr:"#4ec98b",pg:"rgba(78,201,139,0.12)",ac:"#e87461",ok:"#4ec98b",wn:"#d4b84a",gd:"linear-gradient(135deg,#4ec98b,#82dbb0)",l:0},
ocean:{n:"Ocean",e:"🌊",bg:"#0a1628",sf:"#0f1f38",cd:"#162a48",bd:"rgba(255,255,255,0.06)",tx:"#d0e4f5",ht:"#5f8bb5",pr:"#38a2d4",pg:"rgba(56,162,212,0.15)",ac:"#ef7b5c",ok:"#4ac4a0",wn:"#e0b84c",gd:"linear-gradient(135deg,#38a2d4,#6cc0e8)",l:0},
rose:{n:"Rosé",e:"🌸",bg:"#1a0f15",sf:"#261822",cd:"#351f2e",bd:"rgba(255,255,255,0.06)",tx:"#f0dce4",ht:"#a07088",pr:"#e0689a",pg:"rgba(224,104,154,0.15)",ac:"#6ac4dc",ok:"#5cc4a2",wn:"#d8b44e",gd:"linear-gradient(135deg,#e0689a,#f0a0c0)",l:0},
chalk:{n:"Chalk",e:"🤍",bg:"#f5f3ef",sf:"#edeae4",cd:"#ffffff",bd:"rgba(0,0,0,0.08)",tx:"#1a1816",ht:"#8a857c",pr:"#444038",pg:"rgba(68,64,56,0.08)",ac:"#b8442a",ok:"#3a8a5a",wn:"#a8882a",gd:"linear-gradient(135deg,#444038,#6a645a)",l:1}
};
function aT(id){const t=TH[id];if(!t)return;const r=document.documentElement.style;
["bg","sf","cd","bd","tx","ht","pr","pg","ac","ok","wn","gd"].forEach(k=>r.setProperty("--"+k,t[k]));
document.body.classList.toggle("ls",!!t.l);cTheme=id;}

// ─── State ──────────────────────────────────────────────────
let tab="home",cTheme="midnight",filt=null,fS=null,ex={},dbgOn=false,dbgLog=[];
let taskTab="active",calTab="events",moneyTab="transactions",shopFold=null,searchQ="",searchOpen=false,menuOpen=false;
let D={tasks:[],recurring:[],shopping:[],folders:[],events:[],birthdays:[],subs:[],dashboard:{},members:[],zones:[],settings:{},weather:null,categories:[],transactions:[]};
let allSubs={task:{},event:{}};
let _assign=0,_pri="normal",_rems=[],_zRems=[],_bdRems=[],_subRems=[],zOpen={};

// ─── API ────────────────────────────────────────────────────
async function A(m,p,b){
const o={method:m,headers:{"Content-Type":"application/json","X-Telegram-Init-Data":iD}};
if(b)o.body=JSON.stringify(b);
try{const r=await fetch(p,o);const j=await r.json();
if(dbgOn){dbgLog.push(m+" "+p+" → "+r.status);if(dbgLog.length>50)dbgLog.shift();var el=document.getElementById("dbg");if(el)el.textContent=dbgLog.slice(-10).join("\n")}
if(!r.ok)return null;return j}catch(e){if(dbgOn){dbgLog.push("ERR "+m+" "+p+": "+e.message)}return null}}

// ─── Icons ──────────────────────────────────────────────────
const I={
ck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>',
tr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
ed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
fl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
bl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
pl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
};

// ─── Helpers ────────────────────────────────────────────────
function es(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
// hp(kind) — haptic feedback via Telegram WebApp API. Free, no visual cost.
//   light/med/heavy → impactOccurred; ok/warn/err → notificationOccurred; sel → selectionChanged.
function hp(k){try{var h=tg&&tg.HapticFeedback;if(!h)return;
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
return '<span class="ch'+(sm?" ch-s":"")+'" style="background:'+m.color+'22;color:'+m.color+'">'+m.emoji+" "+es(m.user_name)+'</span>'}
function pri(p){const c={high:"var(--pri-hi)",normal:"var(--pri-md)",low:"var(--pri-lo)"};return '<span class="pr" style="color:'+c[p]+'">'+I.fl+" "+p+'</span>'}

function assignPk(id,sel){
let h='<div class="or" id="'+id+'"><span class="ch'+((!sel)?" s":"")+'" style="background:var(--wn)22;color:var(--wn);cursor:pointer" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign=0">👨‍👩‍👧</span>';
D.members.forEach(function(m){h+='<span class="ch'+(sel===m.user_id?" s":"")+'" style="background:'+m.color+'22;color:'+m.color+';cursor:pointer" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign='+m.user_id+'">'+m.emoji+" "+es(m.user_name)+'</span>'});
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
{id:"shop",l:"Shop",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>'},
{id:"money",l:"Money",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'},
{id:"profile",l:"Profile",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
];
const TT={home:["🏠 Family HQ","Everything at a glance"],tasks:["📋 Tasks","Manage & assign"],shop:["🛒 Shopping","Shared list"],money:["💰 Money","Budget & subs"],profile:["👤 Profile","Personal stats"],events:["📅 Events","Schedule"],birthdays:["🎂 Birthdays","Never forget"],clean:["🧹 Cleaning","Apartment zones"],settings:["⚙️ Settings","Customize"],subs:["💳 Subscriptions","Monthly payments"]};

(function(){var n=document.getElementById("nv");NV.forEach(function(t){var b=document.createElement("button");b.className="ni"+(t.id==="home"?" a":"");b.dataset.t=t.id;b.innerHTML='<span class="nb hidden" id="b-'+t.id+'"></span>'+t.sv+'<span>'+t.l+'</span>';b.onclick=function(){go(t.id)};n.appendChild(b)})})();

function go(t){tab=t;filt=null;searchQ="";menuOpen=false;
document.getElementById("menu-overlay").classList.remove("open");
var si=document.getElementById("si");if(si)si.value="";
document.querySelectorAll(".ni").forEach(function(e){e.classList.toggle("a",e.dataset.t===t)});
document.getElementById("ht").textContent=(TT[t]||["",""])[0];
document.getElementById("hs").textContent=(TT[t]||["",""])[1];
var noFab=["home","settings","clean","events","birthdays","subs","profile"];
document.getElementById("fab").classList.toggle("hidden",noFab.indexOf(t)>=0);
if(t==="home")_firstHomeRender=true;
if(t==="profile")_profStats=null;
ren();hp("sel")}

// Hamburger menu
function toggleMenu(){menuOpen=!menuOpen;document.getElementById("menu-overlay").classList.toggle("open",menuOpen)}

// ─── Onboarding ─────────────────────────────────────────────
async function init(){try{var r=await A("GET","/api/family/status");if(!r)return;fS=r;
if(r.joined){document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load()}else rOnb()}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+'</pre>'}}
function rOnb(){document.getElementById("fab").classList.add("hidden");document.querySelectorAll(".ni").forEach(function(e){e.style.opacity=".3"});document.getElementById("ct").innerHTML='<div class="onb"><div class="onb-e">👨‍👩‍👧‍👦</div><div class="onb-t">Welcome to Family HQ</div><div class="onb-s">Create a family or join with a code.</div><button class="onb-b p" onclick="shCr()">Create Family</button><div style="color:var(--ht);font-size:13px;margin:8px 0 20px">— or —</div><button class="onb-b s2" onclick="shJn()">Join with Code</button></div>'}
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
if(D.settings.theme)aT(D.settings.theme);ren()}

// ─── Render ─────────────────────────────────────────────────
var _firstHomeRender=true;
function ren(){var c=document.getElementById("ct");
var tp=D.tasks.filter(function(x){return!x.done}).length;
var sp=D.shopping.filter(function(x){return!x.bought}).length;
var ct=D.dashboard.cleaning_dirty||0;
sB("tasks",tp);sB("shop",sp);
switch(tab){
case"home":c.innerHTML=rH();if(_firstHomeRender){_firstHomeRender=false;FX.countStats(c)}break;case"tasks":c.innerHTML=rT();break;
case"shop":c.innerHTML=rSh();break;case"money":c.innerHTML=rMoney();break;
case"events":c.innerHTML=rEvts();break;case"birthdays":c.innerHTML=rBdays();break;
case"clean":c.innerHTML=rC();break;case"settings":c.innerHTML=rSet();break;case"subs":c.innerHTML=rSubsList();break;case"profile":c.innerHTML=rProfile();break}}
function sB(t,n){var e=document.getElementById("b-"+t);if(!e)return;if(n>0&&tab!==t){e.textContent=n;e.classList.remove("hidden")}else e.classList.add("hidden")}

// ═══════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════
function rH(){var d=D.dashboard,n=new Date();
var h='<p style="color:var(--ht);font-size:14px;margin:0 0 4px;font-weight:500">'+dF[n.getDay()]+", "+mN[n.getMonth()]+" "+n.getDate()+'</p>';
// Weather (wrapped in ambient wbg container — CSS @keyframes handles the animation)
var w=D.weather;
if(w&&w.days){var cat=FX.wCat(w.label);
h+='<div class="wbg wbg-'+cat+'"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:28px">'+wIcon(w.label)+'</span><div><span style="font-size:22px;font-weight:800">'+w.now+'°</span><span style="font-size:12px;color:var(--ht);margin-left:6px">feels '+w.feels+'°</span></div><div style="display:flex;gap:8px;margin-left:auto">';
w.days.forEach(function(dy,i){var label=i===0?"Today":wDayName(dy.date);h+='<div style="text-align:center;min-width:44px"><div style="font-size:10px;color:var(--ht);font-weight:600">'+label+'</div><div style="font-size:18px;margin:2px 0">'+wIcon(dy.label)+'</div><div style="font-size:11px;font-weight:700">'+dy.max+'°</div><div style="font-size:10px;color:var(--ht)">'+dy.min+'°</div></div>'});h+='</div></div></div>'}else h+='<div style="margin-bottom:16px"></div>';
// Stats — numbers wrapped in <span class="cu" data-count="N">0</span> so FX.countStats() can animate them
h+='<div class="sts"><div class="st" onclick="go(\'tasks\')" style="border-left:3px solid var(--pr)"><div class="sn" style="color:var(--pr)"><span class="cu" data-count="'+(d.tasks_pending||0)+'">0</span></div><div class="sl">Tasks</div></div>';
h+='<div class="st" onclick="go(\'shop\')" style="border-left:3px solid var(--ac)"><div class="sn" style="color:var(--ac)"><span class="cu" data-count="'+(d.shop_pending||0)+'">0</span></div><div class="sl">Shopping</div></div>';
h+='<div class="st" onclick="go(\'clean\')" style="border-left:3px solid var(--wn);cursor:pointer"><div class="sn" style="color:var(--wn)"><span class="cu" data-count="'+(d.cleaning_dirty||0)+'">0</span>/'+(d.cleaning_total||0)+'</div><div class="sl">Cleaning</div></div>';
var _aInc=0,_aExp=0;D.transactions.forEach(function(tx){if(tx.type==="income")_aInc+=(tx.amount_eur||0);else _aExp+=(tx.amount_eur||0)});var _bal=_aInc-_aExp;var _balC=_bal>=0?"var(--ok)":"var(--ac)";
var _cm=n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0");var _mInc=0,_mExp=0;D.transactions.forEach(function(tx){if(tx.date&&tx.date.startsWith(_cm)){if(tx.type==="income")_mInc+=(tx.amount_eur||0);else _mExp+=(tx.amount_eur||0)}});
h+='<div class="st" onclick="go(\'money\')" style="border-left:3px solid '+_balC+'"><div class="sn" style="color:'+_balC+';font-size:20px">'+(_bal>=0?"+":"")+"€"+_bal.toFixed(0)+'</div><div class="sl" style="font-size:11px;line-height:1.3;color:var(--ht)">+€'+_mInc.toFixed(0)+' / −€'+_mExp.toFixed(0)+'</div></div></div>';
// Top 3 tasks
var pt=D.tasks.filter(function(x){return!x.done});var priV={high:0,normal:1,low:2};
pt.sort(function(a,b){var pa=priV[a.priority]||1,pb=priV[b.priority]||1;if(pa!==pb)return pa-pb;var da=a.due_date||"9999",db2=b.due_date||"9999";return da<db2?-1:da>db2?1:0});
pt=pt.slice(0,3);
if(pt.length){h+='<div class="sc">Top Tasks</div>';pt.forEach(function(t){
var priDot=t.priority==="high"?'<span style="width:8px;height:8px;border-radius:50%;background:var(--ac);display:inline-block;margin-right:4px"></span>':"";
h+='<div class="c"><div class="cb cb-o" onclick="tgTk('+t.id+',this)"></div><div class="bd"><div class="tt">'+priDot+es(t.text)+'</div><div class="mt">'+mChip(t.assigned_to,true)+(t.due_date?' <span style="font-size:11px;color:var(--wn)">📅 '+fD(t.due_date).full+'</span>':"")+'</div></div></div>'})}
// Upcoming 7d
var upcoming=[];var todayStr=td();
D.events.forEach(function(ev){var eDate=(ev.event_date||"").split(" ")[0];if(!eDate)return;var diff=Math.round((new Date(eDate)-new Date(todayStr))/86400000);if(diff>=0&&diff<=7)upcoming.push({type:"event",days:diff,icon:"📅",title:es(ev.text),sub:fD(ev.event_date).full,color:"var(--ok)"})});
D.birthdays.forEach(function(b){if(b.days_until>=0&&b.days_until<=7)upcoming.push({type:"birthday",days:b.days_until,icon:b.emoji,title:es(b.name),sub:b.days_until===0?"Today! 🎉":"in "+b.days_until+" days",color:"var(--wn)"})});
D.subs.forEach(function(s){if(s.days_until>=0&&s.days_until<=7)upcoming.push({type:"sub",days:s.days_until,icon:s.emoji,title:es(s.name),sub:s.amount+" "+s.currency,color:"var(--pr)"})});
upcoming.sort(function(a,b){return a.days-b.days});
if(upcoming.length){h+='<div class="sc" style="margin-top:16px">Upcoming 7 Days</div>';upcoming.forEach(function(u){
var _ud=new Date(Date.now()+u.days*86400000);var dayLabel=u.days===0?"Today":u.days===1?"Tomorrow":dN[_ud.getDay()]+" "+_ud.getDate()+" "+mN[_ud.getMonth()].slice(0,3);
var dayBadge=u.days===0?'':'<span style="font-size:11px;color:var(--ht);margin-left:auto;white-space:nowrap">in '+u.days+'d</span>';
h+='<div class="c"><span style="font-size:24px">'+u.icon+'</span><div class="bd"><div class="tt">'+u.title+'</div><div class="mt"><span class="bg" style="background:color-mix(in srgb,'+u.color+',transparent 85%);color:'+u.color+'">'+dayLabel+'</span> <span style="font-size:11px;color:var(--ht)">'+u.sub+'</span></div></div>'+dayBadge+'</div>'})}
return h}

// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════
function rT(){var h='<div class="tabs"><button class="tab '+(taskTab==="active"?"a":"")+'" onclick="taskTab=\'active\';ren()">📋 Active</button><button class="tab '+(taskTab==="recurring"?"a":"")+'" onclick="taskTab=\'recurring\';ren()">🔁 Recurring</button></div>';
if(taskTab==="recurring")return h+rRecur();
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" onclick="filt='+m.user_id+';ren()">'+m.emoji+'</button>'});h+='</div>';
var all=D.tasks;if(filt)all=all.filter(function(x){return x.assigned_to===filt});
if(searchQ)all=all.filter(function(x){return matchQ(x.text)});
var pend=all.filter(function(x){return!x.done}),done=all.filter(function(x){return x.done});
if(!all.length)return h+em("📋","No tasks yet","Tap + to add one");
// Group pending tasks into sections
var todayStr=td();var _7d=new Date();_7d.setDate(_7d.getDate()+7);var weekStr=_7d.getFullYear()+"-"+String(_7d.getMonth()+1).padStart(2,"0")+"-"+String(_7d.getDate()).padStart(2,"0");
var overdue=[],high=[],week=[],rest=[];
pend.forEach(function(t){var dd=(t.due_date||"").split(" ")[0];if(dd&&dd<todayStr){overdue.push(t)}else if(t.priority==="high"){high.push(t)}else if(dd&&dd<=weekStr){week.push(t)}else{rest.push(t)}});
function _tkCard(t){var rmC=t.reminders&&t.reminders.length?'<span class="bg" style="background:color-mix(in srgb,var(--wn),transparent 85%);color:var(--wn)">'+I.bl+" "+t.reminders.length+'</span>':"";
return '<div style="margin-bottom:10px"><div class="c" style="margin-bottom:0"><div class="cb cb-o" onclick="tgTk('+t.id+',this)"></div><div class="bd"><div class="tt">'+es(t.text)+'</div><div class="mt">'+mChip(t.assigned_to,true)+" "+pri(t.priority)+(t.due_date?' <span style="font-size:11px;color:var(--wn)">📅 '+fD(t.due_date).full+'</span>':"")+" "+rmC+" "+sC("task",t.id)+' <button class="xb" onclick="tX(\'task\','+t.id+')">'+(ex["task_"+t.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="edTk('+t.id+')">'+I.ed+'</button><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>'+rSu("task",t.id)+'</div>'}
if(overdue.length){h+='<div class="sc" style="color:var(--ac)">🔴 Overdue · '+overdue.length+'</div>';overdue.forEach(function(t){h+=_tkCard(t)})}
if(high.length){h+='<div class="sc" style="color:var(--wn)">⚡ High Priority · '+high.length+'</div>';high.forEach(function(t){h+=_tkCard(t)})}
if(week.length){h+='<div class="sc">📅 This Week · '+week.length+'</div>';week.forEach(function(t){h+=_tkCard(t)})}
if(rest.length){h+='<div class="sc">📋 Rest · '+rest.length+'</div>';rest.forEach(function(t){h+=_tkCard(t)})}
if(!pend.length)h+='<div style="text-align:center;padding:20px;color:var(--ht);font-size:13px">All caught up! 🎉</div>';
if(done.length){h+='<div class="sc" style="margin-top:16px">✅ Done · '+done.length+'</div>';done.forEach(function(t){h+='<div class="c d"><div class="cb cb-k" onclick="tgTk('+t.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(t.text)+'</div></div><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>'})}
return h}
function rRecur(){if(!D.recurring.length)return em("🔁","No recurring tasks","Tap + to create");var h='';D.recurring.forEach(function(r){if(searchQ&&!matchQ(r.text))return;var rrDesc=r.rrule==="daily"?"Every day":r.rrule.startsWith("weekly:")?"Weekly: "+r.rrule.split(":")[1]:"Monthly: "+r.rrule.split(":")[1]+"th";h+='<div class="c"><div class="bd"><div class="tt">'+es(r.text)+'</div><div class="mt">'+mChip(r.assigned_to,true)+' <span class="bg" style="background:color-mix(in srgb,var(--pr),transparent 85%);color:var(--pr)">🔁 '+rrDesc+'</span>'+(r.active?'':' <span class="bg" style="background:color-mix(in srgb,var(--ac),transparent 85%);color:var(--ac)">Paused</span>')+'</div></div><button class="bi" onclick="edRec('+r.id+')">'+I.ed+'</button><button class="bi" onclick="dlRec('+r.id+')">'+I.tr+'</button></div>'});return h}

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
function edTk(id){var t=D.tasks.find(function(x){return x.id===id});if(!t)return;_assign=t.assigned_to||0;_pri=t.priority;_rems=(t.reminders||[]).map(function(r){return r.remind_at});oMC("Edit Task",'<input class="inp" id="f-t" value="'+es(t.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",t.assigned_to)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(t.priority===p?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" value="'+(t.due_date?(t.due_date.split(" ")[0]):"")+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="svTk('+id+')">Save</button>')}
async function svTk(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("PUT","/api/tasks/"+id,{text:text,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load()}
function edRec(id){var r=D.recurring.find(function(x){return x.id===id});if(!r)return;_assign=r.assigned_to||0;oMC("Edit Recurring",'<input class="inp" id="f-t" value="'+es(r.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",r.assigned_to)+'<div class="lb">Schedule</div><div class="or"><button class="ob '+(r.rrule==="daily"?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Daily</button><button class="ob '+(r.rrule.startsWith("weekly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Weekly</button><button class="ob '+(r.rrule.startsWith("monthly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">Monthly</button></div><input type="hidden" id="rr" value="'+r.rrule+'"><div id="wd" class="'+(r.rrule.startsWith("weekly")?"":"hidden")+'"><div class="lb">Days</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob '+(r.rrule.indexOf(d)>=0?"s":"")+'" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="'+(r.rrule.startsWith("monthly")?"":"hidden")+'"><div class="lb">Day of month</div><input class="inp" id="f-md" type="number" min="1" max="28" value="'+(r.rrule.startsWith("monthly:")?r.rrule.split(":")[1]:"1")+'"></div><div class="lb">Status</div><div class="or"><button class="ob '+(r.active?"s":"")+'" onclick="_recActive=1;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Active</button><button class="ob '+(!r.active?"s":"")+'" onclick="_recActive=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Paused</button></div><button class="btn" onclick="svRec('+id+')">Save</button>');window._recActive=r.active}
async function svRec(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var rr=document.getElementById("rr").value;if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});rr="weekly:"+days.join(",")}else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1")}await A("PUT","/api/recurring/"+id,{text:text,assigned_to:_assign||null,rrule:rr,active:window._recActive});cMo();hp();await load()}

// ═══════════════════════════════════════════════════════════
// SHOPPING — enhanced add flow
// ═══════════════════════════════════════════════════════════
function rSh(){var h='<div class="fb2"><button class="fi '+(shopFold===null?"a":"")+'" onclick="shopFold=null;ren()">All</button><button class="fi '+(shopFold==="stock"?"a":"")+'" onclick="shopFold=\'stock\';ren()">📦 In Stock</button>';
D.folders.forEach(function(f){h+='<button class="fi '+(shopFold===f.id?"a":"")+'" onclick="shopFold='+f.id+';ren()">'+f.emoji+" "+es(f.name)+'</button><button class="bi" onclick="edFolder('+f.id+')" style="padding:2px;margin-left:-6px">'+I.ed+'</button>'});
h+='<button class="fi" onclick="shAddFolder()">'+I.pl+' Folder</button></div>';
var items=D.shopping;
if(shopFold==="stock")items=items.filter(function(x){return x.bought});
else if(shopFold!==null)items=items.filter(function(x){return x.folder_id===shopFold&&!x.bought});
else items=items.filter(function(x){return!x.bought});
if(searchQ)items=items.filter(function(x){return matchQ(x.item)});
var folderTotal=0;items.forEach(function(x){if(x.price&&(shopFold==="stock"||!x.bought))folderTotal+=x.price});
if(folderTotal>0)h+='<div class="c" style="border-left:3px solid var(--wn);padding:10px 16px"><div class="bd"><div class="mt" style="font-size:14px;color:var(--wn);font-weight:700">Total: '+folderTotal.toFixed(0)+' din.</div></div></div>';
if(shopFold==="stock"){if(!items.length)return h+em("📦","Nothing in stock","Buy items to see them here");h+='<div class="sc" style="margin-top:16px"><span>In Stock · '+items.length+'</span><button class="at" onclick="clSh()">Clear</button></div>';var fMap={};D.folders.forEach(function(f){fMap[f.id]=f});var grps={};items.forEach(function(s){var k=s.folder_id||0;if(!grps[k])grps[k]=[];grps[k].push(s)});var ks=D.folders.map(function(f){return f.id}).filter(function(id){return grps[id]});if(grps[0])ks.push(0);var multi=ks.length>1||(ks.length===1&&ks[0]!==0);ks.forEach(function(k){var g=grps[k];if(multi){if(k&&fMap[k])h+='<div class="sc" style="font-size:13px;margin-top:12px">'+fMap[k].emoji+" "+es(fMap[k].name)+' · '+g.length+'</div>';else h+='<div class="sc" style="font-size:13px;margin-top:12px">Other · '+g.length+'</div>'}g.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c c-stk"><div class="cb cb-k" onclick="tgSh('+s.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})});return h}
var p=items.filter(function(x){return!x.bought}),b=items.filter(function(x){return x.bought});
if(!items.length)return h+em("🛒","List is empty","Tap + to add");
if(p.length){h+='<div class="sc">To Buy · '+p.length+'</div>';p.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";var prHtml=s.price?'<span style="font-size:11px;color:var(--wn);font-weight:600">'+s.price+' din.</span>':"";h+='<div class="c"><div class="cb cb-o" onclick="tgSh('+s.id+',this)"></div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+" "+prHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>'})}
if(b.length){h+='<div class="sc" style="margin-top:16px"><span>Bought · '+b.length+'</span><button class="at" onclick="clSh()">Clear</button></div>';b.forEach(function(s){var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";h+='<div class="c d"><div class="cb cb-k" onclick="tgSh('+s.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(s.item)+" "+qtyHtml+'</div></div><button class="bi" onclick="edShop('+s.id+')">'+I.ed+'</button></div>'})}
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
var h='<div class="tabs"><button class="tab '+(moneyTab==="transactions"?"a":"")+'" onclick="moneyTab=\'transactions\';ren()">💸 Transactions</button><button class="tab '+(moneyTab==="analytics"?"a":"")+'" onclick="moneyTab=\'analytics\';ren()">📊 Analytics</button></div>';
if(moneyTab==="analytics")return h+rAnalytics();
return h+rTransactions()}

function rTransactions(){
var txs=D.transactions;if(searchQ)txs=txs.filter(function(x){return matchQ(x.description)});
if(filt)txs=txs.filter(function(x){return x.member_id===filt});
var cats={};D.categories.forEach(function(c){cats[c.id]=c});
// Balance card — all transactions
var tInc=0,tExp=0;
D.transactions.forEach(function(tx){if(tx.type==="income")tInc+=(tx.amount_eur||0);else tExp+=(tx.amount_eur||0)});
var bal=tInc-tExp;var balC=bal>=0?"var(--ok)":"var(--ac)";
var h='<div class="c" style="border-left:3px solid '+balC+'"><div class="bd"><div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:12px;color:var(--ht)">Balance</div><div style="font-size:20px;font-weight:800;color:'+balC+'">'+(bal>=0?"+":"")+'€'+bal.toFixed(2)+'</div></div><div class="mt" style="gap:16px;margin-top:4px"><span style="color:var(--ok)">+€'+tInc.toFixed(2)+'</span><span style="color:var(--ac)">−€'+tExp.toFixed(2)+'</span></div></div></div>';
if(!txs.length)return h+em("💸","No transactions","Tap + to add");
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" onclick="filt='+m.user_id+';ren()">'+m.emoji+'</button>'});h+='</div>';
txs.forEach(function(tx){
var cat=cats[tx.category_id];var catLabel=cat?(cat.emoji+" "+cat.name):"";
var isInc=tx.type==="income";
var amtColor=isInc?"var(--ok)":"var(--ac)";
var sign=isInc?"+":"−";
var riCnt=(D.txItems||{})[tx.id]?D.txItems[tx.id].length:0;
var riBadge=riCnt?'<span style="font-size:10px;background:var(--pg);color:var(--pr);border-radius:8px;padding:1px 5px;font-weight:700;margin-left:2px">'+riCnt+'</span>':"";
h+='<div class="c"><div class="bd"><div class="tt" style="font-weight:600"><span style="color:'+amtColor+'">'+sign+tx.amount+' '+tx.currency+'</span>'+(tx.description?' <span style="font-weight:400;color:var(--ht)">'+es(tx.description)+'</span>':"")+'</div><div class="mt">'+catLabel+' · '+fD(tx.date).full+" "+mChip(tx.member_id,true)+'</div></div><button class="bi" onclick="openReceipt('+tx.id+')" title="Split receipt" style="font-size:12px;opacity:.7">📋'+riBadge+'</button><button class="bi" onclick="edTx('+tx.id+')">'+I.ed+'</button><button class="bi" onclick="dlTx('+tx.id+')">'+I.tr+'</button></div>'});
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
{id:"cleaning",emoji:"🧹",name:"Cleaning",color:"#a78bfa"},
{id:"events",emoji:"📅",name:"Upcoming Events",color:"var(--ok)"},
{id:"subs",emoji:"💳",name:"Subscriptions",color:"var(--pr)"},
{id:"birthdays",emoji:"🎂",name:"Birthdays",color:"var(--wn)"},
{id:"tip",emoji:"💡",name:"Tip of the Day",color:"var(--ht)"}
];
var _dgOrder=null;

function _getDigestOrder(){
if(_dgOrder)return _dgOrder;
try{_dgOrder=JSON.parse(D.settings.digest_sections||"null")}catch(e){}
if(!_dgOrder)_dgOrder=DIGEST_SECS.map(function(s){return s.id});
return _dgOrder}

function openDigestCfg(){
_dgOrder=_getDigestOrder().slice();
oMC("📨 Morning Digest",digestCfgHtml())}

function digestCfgHtml(){
var h='<div class="lb">Delivery Time</div><input type="time" id="dg-time" value="'+(D.settings.digest_time||"09:00")+'" step="60" style="margin-bottom:16px">';
h+='<div class="lb">Sections (drag to reorder)</div>';
h+='<div id="dg-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">';
_dgOrder.forEach(function(secId,idx){
var sec=DIGEST_SECS.find(function(s){return s.id===secId});
if(!sec)return;
h+='<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--cd);border-radius:10px;border-left:3px solid '+sec.color+'">';
h+='<span style="font-size:18px">'+sec.emoji+'</span>';
h+='<span style="flex:1;font-weight:500">'+sec.name+'</span>';
if(idx>0)h+='<button class="bi" onclick="dgMove('+idx+',-1)" style="font-size:14px">▲</button>';
if(idx<_dgOrder.length-1)h+='<button class="bi" onclick="dgMove('+idx+',1)" style="font-size:14px">▼</button>';
h+='</div>'});
h+='</div>';
h+='<div class="lb">Test Send</div>';
h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
D.members.forEach(function(m){
h+='<button class="btn btn-s" style="flex:1" onclick="dgTest('+m.user_id+')">'+m.emoji+' '+es(m.user_name)+'</button>'});
h+='</div>';
h+='<button class="btn" onclick="dgSave()">Save</button>';
return h}

function dgMove(idx,dir){
var tmp=_dgOrder[idx];_dgOrder[idx]=_dgOrder[idx+dir];_dgOrder[idx+dir]=tmp;
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
h+='<div class="fb2"><button class="fi '+(filt===null?"a":"")+'" onclick="filt=null;ren()">All</button>';D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" onclick="filt='+m.user_id+';ren()">'+m.emoji+'</button>'});h+='</div>';
if(filt)items=items.filter(function(s){return s.assigned_to===filt});
items.forEach(function(s){var daysTxt=s.days_until===0?"Due today":s.days_until===1?"Tomorrow":"in "+s.days_until+"d";
h+='<div class="c"><span style="font-size:28px">'+s.emoji+'</span><div class="bd"><div class="tt" style="font-weight:700">'+es(s.name)+'</div><div class="mt">'+s.amount+" "+s.currency+(s.currency!=="EUR"?" (€"+(s.amount_eur||0).toFixed(2)+")":"")+" · Day "+s.billing_day+" · "+daysTxt+" "+mChip(s.assigned_to,true)+'</div></div><button class="bi" onclick="edSub('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dlSub('+s.id+')">'+I.tr+'</button></div>'});return h}
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
if(!_moneySummary){loadMoneySummary();return '<div class="emp"><div class="emp-i">⏳</div><div>Loading...</div></div>'}
var s=_moneySummary;
var monthLabel=s.month?new Date(s.month+"-01T00:00:00").toLocaleString("en-US",{month:"long",year:"numeric"}):"";
var fwdDis=s.is_current?' style="opacity:.3;pointer-events:none"':"";
var nav='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px"><button class="bi" onclick="_anaShift(-1)" style="padding:4px 10px;font-size:16px">◀</button><div style="font-weight:700;font-size:15px">'+monthLabel+'</div><button class="bi" onclick="_anaShift(1)"'+fwdDis+' style="padding:4px 10px;font-size:16px">▶</button></div>';
var h='<div class="c" style="border-left:3px solid var(--ok)"><div class="bd">'+nav+'<div class="mt" style="gap:16px"><span style="color:var(--ok);font-weight:700">Income €'+s.income.toFixed(0)+'</span><span style="color:var(--ac);font-weight:700">Expenses €'+s.expense.toFixed(0)+'</span><span style="color:var(--pr);font-weight:700">Subs €'+s.subs_eur.toFixed(0)+'</span></div><div style="font-size:18px;font-weight:800;margin-top:8px;color:'+(s.balance>=0?"var(--ok)":"var(--ac)")+'">'+(s.balance>=0?"+":"")+"€"+s.balance.toFixed(0)+'</div></div></div>';
// Monthly chart (bars)
if(s.months&&s.months.length){
var maxM=1;s.months.forEach(function(m){maxM=Math.max(maxM,m.income,m.expense)});
h+='<div class="sc">Last 6 Months</div><div style="display:flex;gap:6px;align-items:flex-end;height:100px;margin-bottom:16px">';
s.months.forEach(function(m){var ih=Math.max(2,m.income/maxM*80);var eh=Math.max(2,m.expense/maxM*80);
h+='<div style="flex:1;text-align:center"><div style="display:flex;gap:2px;align-items:flex-end;justify-content:center;height:80px"><div style="width:8px;height:'+ih+'px;background:var(--ok);border-radius:3px 3px 0 0"></div><div style="width:8px;height:'+eh+'px;background:var(--ac);border-radius:3px 3px 0 0"></div></div><div style="font-size:9px;color:var(--ht);margin-top:4px">'+m.month.split("-")[1]+'</div></div>'});
h+='</div><div style="display:flex;gap:12px;font-size:11px;color:var(--ht);margin-bottom:16px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--ok)"></span> Income</span><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--ac)"></span> Expense</span></div>'}
// By category (pie-like bars)
if(s.by_category&&s.by_category.length){var maxC=s.by_category[0]?s.by_category[0].total:1;
h+='<div class="sc">By Category</div>';s.by_category.forEach(function(c){if(!c.total)return;var pct=Math.max(2,c.total/maxC*100);
h+='<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>'+c.emoji+" "+c.name+'</span><span style="font-weight:700">€'+c.total.toFixed(0)+'</span></div><div style="height:6px;background:var(--bd);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:var(--pr);border-radius:3px"></div></div></div>'})}
// Limits
if(s.limits&&s.limits.length){h+='<div class="sc" style="margin-top:12px">Limits</div>';s.limits.forEach(function(l){var pct=Math.min(100,l.spent/l.monthly_limit*100);var over=l.spent>l.monthly_limit;
h+='<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>'+l.emoji+" "+l.name+'</span><span style="font-weight:700;color:'+(over?"var(--ac)":"var(--tx)")+'">€'+l.spent.toFixed(0)+' / €'+l.monthly_limit.toFixed(0)+'</span></div><div style="height:6px;background:var(--bd);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:'+(over?"var(--ac)":"var(--ok)")+';border-radius:3px"></div></div></div>'})}
h+='<button class="btn btn-s" style="margin-top:12px" onclick="_anaCache={};_moneySummary=null;loadMoneySummary()">↻ Refresh Analytics</button>';
return h}

// ═══════════════════════════════════════════════════════════
// EVENTS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rEvts(){
if(!D.events.length)return em("📅","No events","Use + on Tasks tab")+rEvtAddBtn();
var evts=D.events;if(searchQ)evts=evts.filter(function(e){return matchQ(e.text)});
var colors=["var(--ok)","var(--pr)","var(--ac)","var(--wn)"];
var h=rEvtAddBtn()+'<div style="padding-left:22px;border-left:2px solid var(--bd);margin-left:10px">';
evts.forEach(function(ev,i){var c=colors[i%colors.length];var fd=fD(ev.event_date);var st=(ev.event_date||"").split(" ")[1]||"";
var ep=ev.end_date?(" → "+fD(ev.end_date).date+" "+(ev.end_date.split(" ")[1]||"")):"";
h+='<div style="margin-bottom:12px;position:relative;margin-left:10px"><div class="c" style="margin-bottom:0"><div style="position:absolute;left:-39px;top:16px;width:14px;height:14px;border-radius:50%;background:'+c+';border:2.5px solid var(--bg)"></div><div class="bd"><div class="tt" style="font-weight:600">'+es(ev.text)+'</div><div class="mt" style="margin-top:6px"><span class="bg" style="background:color-mix(in srgb,'+c+',transparent 85%);color:'+c+'">'+fd.day+" "+fd.date+'</span><span>'+st+ep+'</span> '+sC("event",ev.id)+' <button class="xb" onclick="tX(\'event\','+ev.id+')">'+(ex["event_"+ev.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="dEv('+ev.id+')">'+I.tr+'</button></div>'+rSu("event",ev.id)+'</div>'});
return h+'</div>'}
function rEvtAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoEvt()">+ Add Event</button>'}
async function dEv(id){hp();await A("DELETE","/api/events/"+id);await load();toast("🗑 Deleted")}

// ═══════════════════════════════════════════════════════════
// BIRTHDAYS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rBdays(){
if(!D.birthdays.length)return em("🎂","No birthdays","Add below")+rBdAddBtn();
var bdays=D.birthdays;if(searchQ)bdays=bdays.filter(function(b){return matchQ(b.name)});
var h=rBdAddBtn();bdays.forEach(function(b){var dd=b.days_until===0?'<span style="color:var(--ok);font-weight:700">Today! 🎉</span>':b.days_until===1?'<span style="color:var(--wn)">Tomorrow</span>':"in "+b.days_until+" days";
h+='<div class="c"><span style="font-size:32px">'+b.emoji+'</span><div class="bd"><div class="tt" style="font-weight:700">'+es(b.name)+'</div><div class="mt">'+b.birth_date.split("-").slice(1).reverse().join(".")+" · "+dd+'</div></div><button class="bi" onclick="edBd('+b.id+')">'+I.ed+'</button><button class="bi" onclick="dlBd('+b.id+')">'+I.tr+'</button></div>'});return h}
function rBdAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoBd()">+ Add Birthday</button>'}
async function dlBd(id){hp();await A("DELETE","/api/birthdays/"+id);await load();toast("🗑 Deleted")}
function edBd(id){var b=D.birthdays.find(function(x){return x.id===id});if(!b)return;_bdRems=(b.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});oMC("Edit Birthday",'<input class="inp" id="bd-n" value="'+es(b.name)+'"><input class="inp" id="bd-e" value="'+b.emoji+'" style="width:80px"><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="svBd('+id+')">Save</button>')}
async function svBd(id){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim();if(!n)return;await A("PUT","/api/birthdays/"+id,{name:n,emoji:e,reminders:_bdRems});cMo();hp();await load()}

// ═══════════════════════════════════════════════════════════
// CLEANING (hamburger page)
// ═══════════════════════════════════════════════════════════
function rC(){if(!D.zones.length)return em("🧹","No zones yet","Add zones below")+'<button class="btn" onclick="shAZ()">+ Add Zone</button>';
var dirty=D.zones.filter(function(z){return z.dirty}),clean=D.zones.filter(function(z){return!z.dirty});
if(searchQ){dirty=dirty.filter(function(z){return matchQ(z.name)});clean=clean.filter(function(z){return matchQ(z.name)})}
var h="";
if(dirty.length){h+='<div class="sc" style="color:var(--ac)">Needs Cleaning · '+dirty.length+'</div>';dirty.forEach(function(z){h+=rZn(z)})}
if(clean.length){h+='<div class="sc" style="color:var(--ok)">Clean · '+clean.length+'</div>';clean.forEach(function(z){h+=rZn(z)})}
h+='<div style="margin-top:16px"><button class="btn btn-s" onclick="shAZ()">+ Add Zone</button></div>';return h}
function rZn(z){var st=z.dirty?'<span class="zs no">Dirty</span>':'<span class="zs ok">Clean</span>';var isOpen=zOpen[z.id]!==false;var tasksDone=(z.tasks||[]).filter(function(t){return t.done}).length;var tasksTotal=(z.tasks||[]).length;
var h='<div class="zn"><div class="zh" style="cursor:pointer" onclick="zOpen['+z.id+']='+(!isOpen)+';ren()"><span class="zi">'+z.icon+'</span><span class="zn2">'+es(z.name)+' <span style="font-size:12px;color:var(--ht)">'+tasksDone+"/"+tasksTotal+'</span></span><button class="bi" onclick="event.stopPropagation();edZn('+z.id+')" style="margin-right:4px">'+I.ed+'</button>'+st+'<span style="font-size:14px;color:var(--ht)">'+(isOpen?"▾":"▸")+'</span></div>';
if(!isOpen)return h+'</div>';
h+='<div style="border-top:1px solid var(--bd);padding-top:8px">';
(z.tasks||[]).forEach(function(t){var resetInfo=t.reset_days?t.reset_days+"d":"7d";var daysInfo="";if(t.done&&t.last_done)daysInfo=" · "+fD(t.last_done).full;
h+='<div class="zt"><div class="cb cb-s '+(t.done?"cb-k":"cb-o")+'" onclick="tgZT('+t.id+')">'+(t.done?I.ck:"")+'</div><span class="zt-t'+(t.done?" dn":"")+'">'+es(t.text)+'</span><span style="font-size:10px;color:var(--ht)">'+resetInfo+daysInfo+'</span>'+(t.assigned_to?mAv(t.assigned_to,20):"")+'<button class="bi" onclick="edZT('+t.id+')" style="padding:3px">'+I.ed+'</button><button class="bi" onclick="dZT('+t.id+')">'+I.x+'</button></div>'});
h+='<div class="za"><input id="zti-'+z.id+'" placeholder="Add task..." onkeydown="if(event.key===\'Enter\')aZT('+z.id+')"><button onclick="aZT('+z.id+')">Add</button></div></div>';
h+='<button style="margin-top:8px;margin-left:8px;background:none;border:none;color:var(--ac);font-size:12px;cursor:pointer;font-family:inherit" onclick="dlZn('+z.id+')">Delete zone</button></div>';return h}
async function tgZT(id){hp();await A("PATCH","/api/cleaning/tasks/"+id+"/toggle");await load()}
async function dZT(id){hp();await A("DELETE","/api/cleaning/tasks/"+id);await load()}
async function aZT(zid){var i=document.getElementById("zti-"+zid);if(!i||!i.value.trim())return;await A("POST","/api/cleaning/zones/"+zid+"/tasks",{text:i.value.trim()});hp();await load()}
async function dlZn(id){if(!confirm("Delete zone?"))return;await A("DELETE","/api/cleaning/zones/"+id);hp();await load()}
function edZn(zid){var z=D.zones.find(function(x){return x.id===zid});if(!z)return;_assign=z.assigned_to||0;_zRems=(z.reminders||[]).map(function(r){return r.remind_at});oMC("Edit Zone",'<input class="inp" id="ez-n" value="'+es(z.name)+'"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ez-i" value="'+z.icon+'" style="text-align:center;font-size:24px"></div></div><div class="lb">Assigned to</div>'+assignPk("ezap",z.assigned_to)+'<div class="lb">Reminders</div><div id="zrw">'+zRemPk()+'</div><button class="btn" onclick="svZn('+zid+')">Save</button>')}
async function svZn(zid){var n=document.getElementById("ez-n").value.trim();var i=document.getElementById("ez-i").value.trim();if(!n)return;await A("PUT","/api/cleaning/zones/"+zid,{name:n,icon:i,assigned_to:_assign||null,reminders:_zRems});cMo();hp();await load()}
function edZT(tid){var t=null;D.zones.forEach(function(z){(z.tasks||[]).forEach(function(tk){if(tk.id===tid)t=tk})});if(!t)return;_assign=t.assigned_to||0;oMC("Edit Cleaning Task",'<input class="inp" id="zt-t" value="'+es(t.text)+'"><div class="dr"><div><div class="dl">Reset (days)</div><input class="inp" id="zt-d" type="number" value="'+(t.reset_days||7)+'" min="1" max="90"></div></div><div class="lb">Assigned to</div>'+assignPk("ztap",t.assigned_to)+'<button class="btn" onclick="svZT('+tid+')">Save</button>')}
async function svZT(tid){var text=document.getElementById("zt-t").value.trim();var rd=parseInt(document.getElementById("zt-d").value)||7;if(!text)return;await A("PUT","/api/cleaning/tasks/"+tid,{text:text,icon:"🧹",assigned_to:_assign||null,reset_days:rd});cMo();hp();await load()}
function shAZ(){_assign=0;oMC("Add Zone",'<input class="inp" id="zn" placeholder="Zone name"><input class="inp" id="zic" placeholder="🍳" style="width:80px"><div class="lb">Assigned to</div>'+assignPk("zap",null)+'<button class="btn" onclick="doAZ()">Add Zone</button>')}
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
if(!_profStats){loadProfileStats();return '<div class="emp"><div class="emp-i">⏳</div><div>Loading...</div></div>'}
var s=_profStats,h='';
// Member switcher
h+='<div class="fb2" style="margin-bottom:16px">';
h+='<button class="fi '+(!_profMember?"a":"")+'" onclick="setProfMember(null)">👨‍👩‍👧 Family</button>';
D.members.forEach(function(m){h+='<button class="fi '+(_profMember===m.user_id?"a":"")+'" onclick="setProfMember('+m.user_id+')">'+m.emoji+' '+es(m.user_name)+'</button>'});
h+='</div>';
// Header with avatar
if(_profMember){var m=D.members.find(function(x){return x.user_id===_profMember});if(m)h+='<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+mAv(m.user_id,48)+'<div><div style="font-size:18px;font-weight:700">'+es(m.user_name)+'</div><div style="font-size:12px;color:var(--ht)">Personal stats</div></div></div>'}
// Tasks
h+='<div class="sc">Tasks</div><div class="sts">';
h+='<div class="st" style="border-left:3px solid var(--pr)"><div class="sn" style="color:var(--pr)"><span class="cu" data-count="'+s.tasks_active+'">0</span></div><div class="sl">Active</div></div>';
h+='<div class="st" style="border-left:3px solid var(--ok)"><div class="sn" style="color:var(--ok)"><span class="cu" data-count="'+s.tasks_done+'">0</span></div><div class="sl">Completed</div></div>';
h+='<div class="st" style="border-left:3px solid var(--ac)"><div class="sn" style="color:var(--ac)"><span class="cu" data-count="'+s.tasks_overdue+'">0</span></div><div class="sl">Overdue</div></div>';
h+='<div class="st" style="border-left:3px solid var(--wn)"><div class="sn" style="color:var(--wn)"><span class="cu" data-count="'+s.tasks_high+'">0</span></div><div class="sl">High Priority</div></div>';
h+='</div>';
// Cleaning
var cPct=s.clean_total>0?Math.round(s.clean_done/s.clean_total*100):0;
h+='<div class="sc">Cleaning</div>';
h+='<div class="c" style="border-left:3px solid var(--ok)"><div class="bd"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="tt" style="font-weight:600">'+s.clean_done+'/'+s.clean_total+' tasks done</div><span style="font-size:13px;font-weight:700;color:var(--ok)">'+cPct+'%</span></div><div style="height:6px;background:var(--bd);border-radius:3px"><div style="height:100%;width:'+cPct+'%;background:var(--ok);border-radius:3px;transition:width .3s"></div></div></div></div>';
// Count-up animation
setTimeout(function(){FX.countStats(document.getElementById("ct"))},50);
return h}

// ═══════════════════════════════════════════════════════════
// SETTINGS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rSet(){var h='';
if(fS&&fS.joined){h+='<div class="sc">Family</div><div class="c"><span style="font-size:28px">👨‍👩‍👧</span><div class="bd"><div class="tt" style="font-weight:600">'+es(fS.name||"My Family")+'</div></div></div><div class="cd2" style="margin-bottom:16px"><div class="ct2">'+(fS.invite_code||"...")+'</div><div class="cl2">Share this code</div></div>';
h+='<div class="sc">Members</div>';(fS.members||[]).forEach(function(m){h+='<div class="c">'+mAv(m.user_id,40)+'<div class="bd"><div class="tt" style="font-weight:600">'+es(m.user_name)+'</div><div style="width:24px;height:4px;border-radius:2px;background:'+m.color+';margin-top:3px"></div></div><button class="bi" onclick="edMe('+m.user_id+',\''+es(m.user_name)+'\',\''+m.emoji+'\',\''+m.color+'\')">'+I.ed+'</button></div>'});
h+='<div style="margin-bottom:20px"><button class="btn btn-s" style="font-size:13px" onclick="if(confirm(\'Leave family?\'))leaveFam()">Leave Family</button></div>'}
h+='<div class="sc">Theme</div><div class="tg">';Object.keys(TH).forEach(function(id){var t=TH[id];var sel=cTheme===id;h+='<div class="tc" onclick="setTh(\''+id+'\')" style="background:'+t.cd+';border:2px solid '+(sel?t.pr:t.bd)+'"><div class="te">'+t.e+'</div><div class="tn" style="color:'+t.tx+'">'+t.n+'</div><div class="td">'+[t.pr,t.ac,t.ok,t.wn].map(function(c){return '<div class="tdd" style="background:'+c+'"></div>'}).join("")+'</div></div>'});h+='</div>';
h+='<div class="sc">Morning Digest</div><div class="c" onclick="openDigestCfg()" style="cursor:pointer"><span style="font-size:20px">📨</span><div class="bd"><div class="tt">Configure Digest</div><div style="font-size:12px;color:var(--ht)">Time: '+(D.settings.digest_time||"09:00")+' · Sections & order</div></div><span style="color:var(--ht);font-size:18px">›</span></div>';
var nExp=D.categories.filter(function(c){return c.type==="expense"}).length;
var nInc=D.categories.filter(function(c){return c.type==="income"}).length;
h+='<div class="sc">Categories</div><div class="c" onclick="openCatMgr()" style="cursor:pointer"><span style="font-size:20px">📂</span><div class="bd"><div class="tt">Manage Categories</div><div style="font-size:12px;color:var(--ht)">'+nExp+' expense · '+nInc+' income</div></div><span style="color:var(--ht);font-size:18px">›</span></div>';
h+='<div class="sc">Integrations</div><div class="c" onclick="syncTrello()" style="cursor:pointer"><span style="font-size:20px">🔵</span><div class="bd"><div class="tt">Trello Sync</div><div style="font-size:12px;color:var(--ht)">Board: Работа</div></div><span id="trello-btn" style="padding:6px 14px;border-radius:10px;font-size:12px;font-weight:600;background:var(--pg);color:var(--pr);white-space:nowrap">Sync Now</span></div>';
h+='<div class="sc">Debug</div><div class="c" style="cursor:pointer" onclick="dbgOn=!dbgOn;document.getElementById(\'dbg\').classList.toggle(\'hidden\',!dbgOn);ren()"><span style="font-size:20px">🐛</span><div class="bd"><div class="tt">Debug Mode '+(dbgOn?"ON":"OFF")+'</div></div></div>';
h+='<div style="margin-top:8px;text-align:center;font-size:11px;color:var(--ht)">Family HQ v6.1</div>';return h}
async function setTh(id){aT(id);hp();await A("PATCH","/api/settings",{theme:id});ren()}
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
function edMe(uid,name,emoji,color){oMC("Edit Profile",'<input class="inp" id="me-n" value="'+name+'" placeholder="Name"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="me-e" value="'+emoji+'" style="text-align:center;font-size:24px"></div><div><div class="dl">Color</div><input type="color" id="me-c" value="'+color+'" style="width:100%;height:48px;border-radius:12px;border:none;cursor:pointer"></div></div><button class="btn" onclick="svMe('+uid+')">Save</button>')}
async function svMe(uid){var n=document.getElementById("me-n").value.trim();var e=document.getElementById("me-e").value.trim();var c=document.getElementById("me-c").value;if(!n)return;await A("PATCH","/api/members/"+uid,{user_name:n,emoji:e,color:c});cMo();hp();await load()}


// Category management
function addCat(type){oMC("New Category",'<input class="inp" id="nc-n" placeholder="Category name"><input class="inp" id="nc-e" placeholder="📦" value="📦" style="width:80px"><button class="btn" onclick="doAddCat(\''+type+'\')">Create</button>')}
async function doAddCat(type){var n=document.getElementById("nc-n").value.trim();var e=document.getElementById("nc-e").value.trim()||"📦";if(!n)return;await A("POST","/api/categories",{name:n,emoji:e,type:type});cMo();hp();await load()}
function edCat(cid){var c=D.categories.find(function(x){return x.id===cid});if(!c)return;oMC("Edit Category",'<input class="inp" id="ec-n" value="'+es(c.name)+'"><input class="inp" id="ec-e" value="'+c.emoji+'" style="width:80px"><button class="btn" onclick="svCat('+cid+')">Save</button>')}
async function svCat(cid){var n=document.getElementById("ec-n").value.trim();var e=document.getElementById("ec-e").value.trim();if(!n)return;await A("PUT","/api/categories/"+cid,{name:n,emoji:e});cMo();hp();await load()}
async function dlCat(cid){if(!confirm("Delete category?"))return;await A("DELETE","/api/categories/"+cid);hp();await load();toast("✓ Category deleted")}

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
function oMC(t,h){document.getElementById("mt3").textContent=t;document.getElementById("mb").innerHTML=h;document.getElementById("mo").classList.add("op");hp("light");setTimeout(function(){var i=document.querySelector("#mb input");if(i)i.focus()},300)}
function cMo(){document.getElementById("mo").classList.remove("op")}

// Event/Birthday add modals (from hamburger pages)
function oMoEvt(){var dy=td();oMC("New Event",'<input class="inp" id="f-t" placeholder="Event name"><div class="lb">Start</div><div class="dr"><div><div class="dl">Date</div><input type="date" id="f-d" value="'+dy+'" min="'+dy+'"></div><div><div class="dl">Time</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">End (optional)</div><div class="dr"><div><input type="date" id="f-ed"></div><div><input type="time" id="f-et" step="60"></div></div><button class="btn" onclick="doEv()">Add Event</button>')}
function oMoBd(){_bdRems=[{days_before:1,time:"09:00"},{days_before:0,time:"09:00"}];oMC("Add Birthday",'<input class="inp" id="bd-n" placeholder="Name"><input class="inp" id="bd-e" value="🎂" style="width:80px"><div class="lb">Date of Birth</div><div class="dr"><div><input type="date" id="bd-d"></div></div><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="doBd()">Add Birthday</button>')}

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
var total=Math.max(82+tgB,82);document.body.style.paddingBottom=total+"px";
nav.style.paddingBottom=Math.max(tgB,8)+"px";nav.style.height="auto";nav.style.minHeight="62px";
if(fab)fab.style.bottom=(total+12)+"px"}
fixVP();window.addEventListener("resize",fixVP);
if(tg)try{tg.onEvent("viewportChanged",fixVP)}catch(e){}
setTimeout(fixVP,500);setTimeout(fixVP,1500);

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
