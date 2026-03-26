// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ v5 — Frontend Logic
// ═══════════════════════════════════════════════════════════════

// ─── Telegram Init ──────────────────────────────────────────
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
let taskTab="active",calTab="events",shopFold=null;
let D={tasks:[],recurring:[],shopping:[],folders:[],events:[],birthdays:[],subs:[],dashboard:{},members:[],zones:[],settings:{}};
let allSubs={task:{},event:{}};
// Modal state
let _assign=0,_pri="normal",_rems=[],_zRems=[],_bdRems=[],_subRems=[];

// ─── API ────────────────────────────────────────────────────
async function A(m,p,b){
const o={method:m,headers:{"Content-Type":"application/json","X-Telegram-Init-Data":iD}};
if(b)o.body=JSON.stringify(b);
try{const r=await fetch(p,o);const j=await r.json();
if(dbgOn){dbgLog.push(m+" "+p+" → "+r.status);if(dbgLog.length>50)dbgLog.shift();document.getElementById("dbg").textContent=dbgLog.slice(-10).join("\n")}
if(!r.ok)return null;return j}catch(e){if(dbgOn){dbgLog.push("ERR "+m+" "+p+": "+e.message);document.getElementById("dbg").textContent=dbgLog.slice(-10).join("\n")}return null}}

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
function hp(){try{tg?.HapticFeedback?.impactOccurred("light")}catch(e){}}
function em(i,t,s){return '<div class="emp"><div class="emp-i">'+i+'</div><div class="emp-t">'+t+'</div><div>'+s+'</div></div>'}
function td(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
const dN=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const dF=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const mN=["January","February","March","April","May","June","July","August","September","October","November","December"];
function fD(ds){const p=(ds||"").split(" ")[0];const pts=p.split("-").map(Number);if(!pts[0]||!pts[1]||!pts[2])return{day:"?",date:"?"};const dt=new Date(pts[0],pts[1]-1,pts[2]);return{day:dN[dt.getDay()],date:pts[2]+" "+mN[pts[1]-1].slice(0,3)}}

// Member helpers
function mAv(uid,sz){const m=D.members.find(function(x){return x.user_id===uid});
if(!m)return '<span class="av-em" style="width:'+sz+'px;height:'+sz+'px;background:var(--cd)">👤</span>';
if(m.photo_url)return '<img class="av" src="'+m.photo_url+'" style="width:'+sz+'px;height:'+sz+'px" onerror="this.style.display=\'none\'">';
return '<span class="av-em" style="width:'+sz+'px;height:'+sz+'px;font-size:'+Math.round(sz*0.6)+'px;background:'+m.color+'22">'+m.emoji+'</span>';}
function mName(uid){const m=D.members.find(function(x){return x.user_id===uid});return m?m.user_name:"Everyone"}
function mChip(uid,sm){
if(!uid)return '<span class="ch'+(sm?" ch-s":"")+'" style="background:var(--wn)22;color:var(--wn)">👨‍👩‍👧 Everyone</span>';
const m=D.members.find(function(x){return x.user_id===uid});if(!m)return "";
return '<span class="ch'+(sm?" ch-s":"")+'" style="background:'+m.color+'22;color:'+m.color+'">'+m.emoji+" "+es(m.user_name)+'</span>';}
function pri(p){const c={high:"var(--ac)",normal:"var(--pr)",low:"var(--ht)"};return '<span class="pr" style="color:'+c[p]+'">'+I.fl+" "+p+'</span>';}

// Assign picker
function assignPk(id,sel){
let h='<div class="or" id="'+id+'"><span class="ch'+((!sel)?" s":"")+'" style="background:var(--wn)22;color:var(--wn);cursor:pointer" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign=0">👨‍👩‍👧 Everyone</span>';
D.members.forEach(function(m){h+='<span class="ch'+(sel===m.user_id?" s":"")+'" style="background:'+m.color+'22;color:'+m.color+';cursor:pointer" onclick="document.querySelectorAll(\'#'+id+' .ch\').forEach(function(c){c.classList.remove(\'s\')});this.classList.add(\'s\');_assign='+m.user_id+'">'+m.emoji+" "+es(m.user_name)+'</span>';});
return h+'</div>';}

// Reminder picker for tasks
function remPk(){
let h='';
_rems.forEach(function(r,i){
var p=(r||"").split(" ");
h+='<div class="ri"><input type="date" value="'+(p[0]||"")+'" onchange="_rems['+i+']=this.value+\' \'+(_rems['+i+']||\'\').split(\' \')[1]||\'09:00\'" style="flex:1"><input type="time" value="'+(p[1]||"09:00")+'" step="60" onchange="_rems['+i+']=(_rems['+i+']||\'\').split(\' \')[0]+\' \'+this.value" style="width:100px"><button class="bi" onclick="_rems.splice('+i+',1);document.getElementById(\'rw\').innerHTML=remPk()">'+I.x+'</button></div>';});
if(_rems.length<5)h+='<div class="or" style="margin-top:6px"><button class="ob" onclick="_rems.push(td()+\' 09:00\');document.getElementById(\'rw\').innerHTML=remPk()">+ Custom</button><button class="ob" onclick="addPresetRem(\'1d\')">+1 day</button><button class="ob" onclick="addPresetRem(\'3d\')">+3 days</button><button class="ob" onclick="addPresetRem(\'1w\')">+1 week</button></div>';
return h;}
function addPresetRem(type){
if(_rems.length>=5)return;
var dd=document.getElementById("f-dd");
var base=dd?dd.value:td();
if(!base)base=td();
var d=new Date(base);
if(type==="1d")d.setDate(d.getDate()-1);
else if(type==="3d")d.setDate(d.getDate()-3);
else if(type==="1w")d.setDate(d.getDate()-7);
_rems.push(d.toISOString().split("T")[0]+" 09:00");
document.getElementById("rw").innerHTML=remPk();}

// Subtask helpers
function sC(t,id){var s=allSubs[t]&&allSubs[t][id]?allSubs[t][id]:[];if(!s.length)return "";var d=s.filter(function(x){return x.done}).length;return '<span style="font-size:11px;color:'+(d===s.length?"var(--ok)":"var(--ht)")+';font-weight:600">'+d+'/'+s.length+'</span>';}
function rSu(t,id){
var k=t+"_"+id;if(!ex[k])return "";
var s=allSubs[t]&&allSubs[t][id]?allSubs[t][id]:[];
var h='<div class="sbs">';
s.forEach(function(x){h+='<div class="si"><div class="cb cb-s '+(x.done?"cb-k":"cb-o")+'" onclick="tSu('+x.id+')">'+(x.done?I.ck:"")+'</div><span class="sx'+(x.done?" dn":"")+'">'+es(x.text)+'</span><button class="bi" onclick="dSu('+x.id+')">'+I.x+'</button></div>';});
h+='</div><div class="sa"><input id="si-'+t+'-'+id+'" placeholder="Add step..." onkeydown="if(event.key===\'Enter\')aSu(\''+t+'\','+id+')"><button onclick="aSu(\''+t+'\','+id+')">Add</button></div>';
return h;}
function tX(t,id){ex[t+"_"+id]=!ex[t+"_"+id];ren();}
async function tSu(sid){hp();await A("PATCH","/api/subtasks/"+sid+"/toggle");await load();}
async function dSu(sid){hp();await A("DELETE","/api/subtasks/"+sid);await load();}
async function aSu(t,pid){var i=document.getElementById("si-"+t+"-"+pid);if(!i||!i.value.trim())return;await A("POST","/api/subtasks/"+t+"/"+pid,{text:i.value.trim()});hp();await load();}

// ─── Nav Setup ──────────────────────────────────────────────
const NV=[
{id:"home",l:"Home",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'},
{id:"tasks",l:"Tasks",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'},
{id:"shop",l:"Shop",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>'},
{id:"clean",l:"Clean",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'},
{id:"cal",l:"Calendar",sv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'}
];
const TT={home:["🏠 Family HQ","Everything at a glance"],tasks:["📋 Tasks","Manage & assign"],shop:["🛒 Shopping","Shared list"],clean:["🧹 Cleaning","Apartment zones"],cal:["📅 Calendar","Events & more"],settings:["⚙️ Settings","Customize"]};

(function(){var n=document.getElementById("nv");NV.forEach(function(t){
var b=document.createElement("button");b.className="ni"+(t.id==="home"?" a":"");b.dataset.t=t.id;
b.innerHTML='<span class="nb hidden" id="b-'+t.id+'"></span>'+t.sv+'<span>'+t.l+'</span>';
b.onclick=function(){go(t.id)};n.appendChild(b);});})();

function go(t){tab=t;filt=null;
document.querySelectorAll(".ni").forEach(function(e){e.classList.toggle("a",e.dataset.t===t)});
document.getElementById("ht").textContent=(TT[t]||["",""])[0];
document.getElementById("hs").textContent=(TT[t]||["",""])[1];
var noFab=["home","settings","clean"];
document.getElementById("fab").classList.toggle("hidden",noFab.indexOf(t)>=0);
ren();hp();}

// ─── Family Onboarding ─────────────────────────────────────
async function init(){
try{
var r=await A("GET","/api/family/status");
if(!r)return;fS=r;
if(r.joined){document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load();}
else rOnb();
}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+'</pre>';}}

function rOnb(){
document.getElementById("fab").classList.add("hidden");
document.querySelectorAll(".ni").forEach(function(e){e.style.opacity=".3"});
document.getElementById("ct").innerHTML='<div class="onb"><div class="onb-e">👨‍👩‍👧‍👦</div><div class="onb-t">Welcome to Family HQ</div><div class="onb-s">Create a family or join with a code.</div><button class="onb-b p" onclick="shCr()">Create Family</button><div style="color:var(--ht);font-size:13px;margin:8px 0 20px">— or —</div><button class="onb-b s2" onclick="shJn()">Join with Code</button></div>';}

function shCr(){oMC("Create Family",'<input class="inp" id="fn" placeholder="Family name" value="Our Family"><button class="btn" onclick="doCr()">Create</button>');}
function shJn(){oMC("Join Family",'<div style="text-align:center;margin-bottom:16px"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">Enter 6-character code</div><input class="ci2" id="fc" placeholder="ABC123" maxlength="6"></div><button class="btn" onclick="doJn()">Join</button>');}
async function doCr(){var n=document.getElementById("fn").value.trim()||"Our Family";var r=await A("POST","/api/family/create",{name:n});if(!r||r.detail){alert(r?r.detail:"Error");return}cMo();hp();fS={joined:true,invite_code:r.invite_code,name:r.name,members:[]};document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});oMC("Family Created! 🎉",'<div style="text-align:center"><div style="font-size:14px;color:var(--ht);margin-bottom:12px">Share this code:</div><div class="cd2"><div class="ct2">'+r.invite_code+'</div><div class="cl2">Invite Code</div></div><button class="btn" onclick="cMo();load()">Got it!</button></div>');}
async function doJn(){var c=document.getElementById("fc").value.trim();if(c.length<4){alert("Enter code");return}var r=await A("POST","/api/family/join",{code:c});if(!r||r.detail){alert(r?r.detail:"Invalid");return}cMo();hp();fS={joined:true,name:r.name};document.querySelectorAll(".ni").forEach(function(e){e.style.opacity="1"});await load();}

// ─── Load Data ──────────────────────────────────────────────
async function load(){
var results=await Promise.all([
A("GET","/api/tasks"),A("GET","/api/recurring"),A("GET","/api/shopping"),A("GET","/api/shopping/folders"),
A("GET","/api/events"),A("GET","/api/birthdays"),A("GET","/api/subscriptions"),
A("GET","/api/dashboard"),A("GET","/api/members"),A("GET","/api/settings"),
A("GET","/api/family/status"),A("GET","/api/cleaning/zones"),
A("GET","/api/subtasks/all/task"),A("GET","/api/subtasks/all/event")]);
D.tasks=results[0]||[];D.recurring=results[1]||[];D.shopping=results[2]||[];D.folders=results[3]||[];
D.events=results[4]||[];D.birthdays=results[5]||[];D.subs=results[6]||[];
D.dashboard=results[7]||{};D.members=results[8]||[];D.settings=results[9]||{};
if(results[10]&&results[10].joined)fS=results[10];
D.zones=results[11]||[];
allSubs.task=results[12]||{};allSubs.event=results[13]||{};
if(D.settings.theme)aT(D.settings.theme);
ren();}

// ─── Render Router ──────────────────────────────────────────
function ren(){
var c=document.getElementById("ct");
var tp=D.tasks.filter(function(x){return!x.done}).length;
var sp=D.shopping.filter(function(x){return!x.bought}).length;
var ct=D.dashboard.cleaning_todo||0;
sB("tasks",tp);sB("shop",sp);sB("clean",ct);
switch(tab){
case"home":c.innerHTML=rH();break;case"tasks":c.innerHTML=rT();break;
case"shop":c.innerHTML=rSh();break;case"clean":c.innerHTML=rC();break;
case"cal":c.innerHTML=rCal();break;case"settings":c.innerHTML=rSet();break;}}

function sB(t,n){var e=document.getElementById("b-"+t);if(!e)return;if(n>0&&tab!==t){e.textContent=n;e.classList.remove("hidden")}else e.classList.add("hidden");}

// ═══════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════
function rH(){
var d=D.dashboard,n=new Date();
var h='<p style="color:var(--ht);font-size:14px;margin:0 0 16px;font-weight:500">'+dF[n.getDay()]+", "+mN[n.getMonth()]+" "+n.getDate()+'</p>';
h+='<div class="sts"><div class="st" onclick="go(\'tasks\')" style="border-left:3px solid var(--pr)"><div class="sn" style="color:var(--pr)">'+(d.tasks_pending||0)+'</div><div class="sl">Tasks</div></div>';
h+='<div class="st" onclick="go(\'shop\')" style="border-left:3px solid var(--ac)"><div class="sn" style="color:var(--ac)">'+(d.shop_pending||0)+'</div><div class="sl">Shopping</div></div>';
h+='<div class="st" onclick="go(\'clean\')" style="border-left:3px solid var(--wn)"><div class="sn" style="color:var(--wn)">'+(d.cleaning_todo||0)+"/"+(d.cleaning_total||0)+'</div><div class="sl">Cleaning</div></div>';
h+='<div class="st" onclick="go(\'cal\')" style="border-left:3px solid var(--ok)"><div class="sn" style="color:var(--ok)">'+(d.events_count||0)+'</div><div class="sl">Events</div></div></div>';
// Upcoming tasks
var pt=D.tasks.filter(function(x){return!x.done}).slice(0,3);
if(pt.length){h+='<div class="sc">Upcoming Tasks</div>';pt.forEach(function(t){
h+='<div class="c"><div class="cb cb-o" onclick="tgTk('+t.id+')"></div><div class="bd"><div class="tt">'+es(t.text)+'</div><div class="mt">'+mChip(t.assigned_to,true)+(t.due_date?' <span style="font-size:11px;color:var(--wn)">📅 '+t.due_date.split(" ")[0]+'</span>':"")+'</div></div></div>';});}
// Birthdays soon
var ub=D.birthdays.filter(function(b){return b.days_until<=7}).slice(0,2);
if(ub.length){h+='<div class="sc" style="margin-top:16px">🎂 Birthdays Soon</div>';ub.forEach(function(b){
h+='<div class="c"><span style="font-size:24px">'+b.emoji+'</span><div class="bd"><div class="tt">'+es(b.name)+'</div><div class="mt">'+(b.days_until===0?'<span style="color:var(--ok);font-weight:700">Today! 🎉</span>':'in '+b.days_until+' days')+'</div></div></div>';});}
return h;}

// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════
function rT(){
var h='<div class="tabs"><button class="tab '+(taskTab==="active"?"a":"")+'" onclick="taskTab=\'active\';ren()">📋 Active</button><button class="tab '+(taskTab==="recurring"?"a":"")+'" onclick="taskTab=\'recurring\';ren()">🔁 Recurring</button></div>';
if(taskTab==="recurring")return h+rRecur();
// Filter bar
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" onclick="filt='+m.user_id+';ren()">'+m.emoji+" "+es(m.user_name)+'</button>';});
h+='<button class="fi '+(filt==="ev"?"a":"")+'" onclick="filt=\'ev\';ren()">👨‍👩‍👧</button></div>';
var all=D.tasks;
if(filt==="ev")all=all.filter(function(x){return!x.assigned_to});
else if(filt)all=all.filter(function(x){return x.assigned_to===filt});
var pend=all.filter(function(x){return!x.done}),done=all.filter(function(x){return x.done});
if(!all.length)return h+em("📋","No tasks yet","Tap + to add one");
if(pend.length){h+='<div class="sc">Active · '+pend.length+'</div>';pend.forEach(function(t){
var rmC=t.reminders&&t.reminders.length?'<span class="bg" style="background:color-mix(in srgb,var(--wn),transparent 85%);color:var(--wn)">'+I.bl+" "+t.reminders.length+'</span>':"";
h+='<div style="margin-bottom:10px"><div class="c" style="margin-bottom:0"><div class="cb cb-o" onclick="tgTk('+t.id+')"></div><div class="bd"><div class="tt">'+es(t.text)+'</div><div class="mt">'+mChip(t.assigned_to,true)+" "+pri(t.priority)+(t.due_date?' <span style="font-size:11px;color:var(--wn)">📅 '+t.due_date.split(" ")[0]+'</span>':"")+" "+rmC+" "+sC("task",t.id)+' <button class="xb" onclick="tX(\'task\','+t.id+')">'+(ex["task_"+t.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="edTk('+t.id+')">'+I.ed+'</button><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>'+rSu("task",t.id)+'</div>';});}
if(done.length){h+='<div class="sc" style="margin-top:16px">Done · '+done.length+'</div>';done.forEach(function(t){
h+='<div class="c d"><div class="cb cb-k" onclick="tgTk('+t.id+')">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(t.text)+'</div></div><button class="bi" onclick="dlTk('+t.id+')">'+I.tr+'</button></div>';});}
return h;}

function rRecur(){
if(!D.recurring.length)return em("🔁","No recurring tasks","Tap + to create");
var h='';D.recurring.forEach(function(r){
var rrDesc=r.rrule==="daily"?"Every day":r.rrule.startsWith("weekly:")?"Weekly: "+r.rrule.split(":")[1]:"Monthly: "+r.rrule.split(":")[1]+"th";
h+='<div class="c"><div class="bd"><div class="tt">'+es(r.text)+'</div><div class="mt">'+mChip(r.assigned_to,true)+' <span class="bg" style="background:color-mix(in srgb,var(--pr),transparent 85%);color:var(--pr)">🔁 '+rrDesc+'</span>'+(r.active?'':' <span class="bg" style="background:color-mix(in srgb,var(--ac),transparent 85%);color:var(--ac)">Paused</span>')+'</div></div><button class="bi" onclick="edRec('+r.id+')">'+I.ed+'</button><button class="bi" onclick="dlRec('+r.id+')">'+I.tr+'</button></div>';});
return h;}

async function tgTk(id){hp();await A("PATCH","/api/tasks/"+id+"/toggle");await load();}
async function dlTk(id){hp();await A("DELETE","/api/tasks/"+id);await load();}
async function dlRec(id){hp();await A("DELETE","/api/recurring/"+id);await load();}

function edTk(id){
var t=D.tasks.find(function(x){return x.id===id});if(!t)return;
_assign=t.assigned_to||0;_pri=t.priority;_rems=(t.reminders||[]).map(function(r){return r.remind_at});
oMC("Edit Task",'<input class="inp" id="f-t" value="'+es(t.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",t.assigned_to)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob '+(t.priority===p?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" value="'+(t.due_date?t.due_date.split(" ")[0]:"")+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="svTk('+id+')">Save</button>');}
async function svTk(id){
var text=document.getElementById("f-t").value.trim();if(!text)return;
var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;
await A("PUT","/api/tasks/"+id,{text:text,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});
cMo();hp();await load();}

function edRec(id){
var r=D.recurring.find(function(x){return x.id===id});if(!r)return;
_assign=r.assigned_to||0;
oMC("Edit Recurring",'<input class="inp" id="f-t" value="'+es(r.text)+'"><div class="lb">Assign to</div>'+assignPk("ap",r.assigned_to)+'<div class="lb">Schedule</div><div class="or"><button class="ob '+(r.rrule==="daily"?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Daily</button><button class="ob '+(r.rrule.startsWith("weekly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\')">Weekly</button><button class="ob '+(r.rrule.startsWith("monthly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\')">Monthly</button></div><input type="hidden" id="rr" value="'+r.rrule+'"><div id="wd" class="'+(r.rrule.startsWith("weekly")?"":"hidden")+'"><div class="lb">Days</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){var sel=r.rrule.indexOf(d)>=0;return '<button class="ob '+(sel?"s":"")+'" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="'+(r.rrule.startsWith("monthly")?"":"hidden")+'"><div class="lb">Day of month</div><input class="inp" id="f-md" type="number" min="1" max="28" value="'+(r.rrule.startsWith("monthly:")?r.rrule.split(":")[1]:"1")+'"></div><div class="lb">Status</div><div class="or"><button class="ob '+(r.active?"s":"")+'" onclick="_recActive=1;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Active</button><button class="ob '+(!r.active?"s":"")+'" onclick="_recActive=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">Paused</button></div><button class="btn" onclick="svRec('+id+')">Save</button>');
window._recActive=r.active;}
async function svRec(id){
var text=document.getElementById("f-t").value.trim();if(!text)return;
var rr=document.getElementById("rr").value;
if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});rr="weekly:"+days.join(",");}
else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1");}
await A("PUT","/api/recurring/"+id,{text:text,assigned_to:_assign||null,rrule:rr,active:window._recActive});
cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// SHOPPING
// ═══════════════════════════════════════════════════════════
function rSh(){
// Folder tabs
var h='<div class="fb2"><button class="fi '+(shopFold===null?"a":"")+'" onclick="shopFold=null;ren()">All</button>';
D.folders.forEach(function(f){h+='<button class="fi '+(shopFold===f.id?"a":"")+'" onclick="shopFold='+f.id+';ren()">'+f.emoji+" "+es(f.name)+'</button>';});
h+='<button class="fi" onclick="shAddFolder()">'+I.pl+' Folder</button></div>';
var items=D.shopping;
if(shopFold!==null)items=items.filter(function(x){return x.folder_id===shopFold});
var p=items.filter(function(x){return!x.bought}),b=items.filter(function(x){return x.bought});
if(!items.length)return h+em("🛒","List is empty","Tap + to add");
if(p.length){h+='<div class="sc">To Buy · '+p.length+'</div>';p.forEach(function(s){
var qtyHtml=s.quantity?'<span class="qty">'+es(s.quantity)+'</span>':"";
h+='<div class="c"><div class="cb cb-o" onclick="tgSh('+s.id+')"></div><div class="bd"><div class="tt">'+es(s.item)+" "+qtyHtml+'</div><div class="mt">'+es(s.added_by||"")+'</div></div><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>';});}
if(b.length){h+='<div class="sc" style="margin-top:16px"><span>Bought · '+b.length+'</span><button class="at" onclick="clSh()">Clear</button></div>';b.forEach(function(s){
h+='<div class="c d"><div class="cb cb-k" onclick="tgSh('+s.id+')">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(s.item)+'</div></div><button class="bi" onclick="dSh('+s.id+')">'+I.tr+'</button></div>';});}
return h;}
async function tgSh(id){hp();await A("PATCH","/api/shopping/"+id+"/toggle");await load();}
async function dSh(id){hp();await A("DELETE","/api/shopping/"+id);await load();}
async function clSh(){hp();await A("DELETE","/api/shopping/clear-bought");await load();}
function shAddFolder(){oMC("New Folder",'<input class="inp" id="ff-n" placeholder="Folder name"><input class="inp" id="ff-e" placeholder="Emoji 📁" value="📁" style="width:80px"><button class="btn" onclick="doAddFolder()">Create</button>');}
async function doAddFolder(){var n=document.getElementById("ff-n").value.trim();var e=document.getElementById("ff-e").value.trim()||"📁";if(!n)return;await A("POST","/api/shopping/folders",{name:n,emoji:e});cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// CLEANING
// ═══════════════════════════════════════════════════════════
function rC(){
if(!D.zones.length)return em("🧹","No zones yet","Add zones below")+'<button class="btn" onclick="shAZ()">+ Add Zone</button>';
var dirty=D.zones.filter(function(z){return z.dirty}),clean=D.zones.filter(function(z){return!z.dirty});
var h="";
if(dirty.length){h+='<div class="sc" style="color:var(--ac)">Needs Cleaning · '+dirty.length+'</div>';dirty.forEach(function(z){h+=rZn(z)});}
if(clean.length){h+='<div class="sc" style="color:var(--ok)">Clean · '+clean.length+'</div>';clean.forEach(function(z){h+=rZn(z)});}
h+='<div style="margin-top:16px"><button class="btn btn-s" onclick="shAZ()">+ Add Zone</button></div>';
return h;}

function rZn(z){
var st=z.dirty?'<span class="zs no">Dirty</span>':'<span class="zs ok">Clean</span>';
var asn=z.assigned_to?" · "+mName(z.assigned_to):"";
var rmC=z.reminders&&z.reminders.length?'<span class="bg" style="background:color-mix(in srgb,var(--wn),transparent 85%);color:var(--wn)">'+I.bl+" "+z.reminders.length+'</span>':"";
var h='<div class="zn"><div class="zh"><span class="zi">'+z.icon+'</span><span class="zn2">'+es(z.name)+'</span><button class="bi" onclick="edZn('+z.id+')" style="margin-right:4px">'+I.ed+'</button>'+st+'</div><div class="zm">'+asn+' '+rmC+'</div><div style="border-top:1px solid var(--bd);padding-top:8px">';
(z.tasks||[]).forEach(function(t){
var resetInfo=t.reset_days?t.reset_days+"d":"7d";
var daysInfo="";
if(t.done&&t.last_done){daysInfo=" · done "+t.last_done;}
h+='<div class="zt"><div class="cb cb-s '+(t.done?"cb-k":"cb-o")+'" onclick="tgZT('+t.id+')">'+(t.done?I.ck:"")+'</div><span class="zt-t'+(t.done?" dn":"")+'">'+es(t.text)+'</span><span style="font-size:10px;color:var(--ht)">'+resetInfo+daysInfo+'</span>'+(t.assigned_to?mAv(t.assigned_to,20):"")+'<button class="bi" onclick="edZT('+t.id+')" style="padding:3px">'+I.ed+'</button><button class="bi" onclick="dZT('+t.id+')">'+I.x+'</button></div>';});
h+='<div class="za"><input id="zti-'+z.id+'" placeholder="Add task..." onkeydown="if(event.key===\'Enter\')aZT('+z.id+')"><button onclick="aZT('+z.id+')">Add</button></div></div>';
h+='<button style="margin-top:8px;margin-left:8px;background:none;border:none;color:var(--ac);font-size:12px;cursor:pointer;font-family:inherit" onclick="dlZn('+z.id+')">Delete zone</button></div>';
return h;}

async function tgZT(id){hp();await A("PATCH","/api/cleaning/tasks/"+id+"/toggle");await load();}
async function dZT(id){hp();await A("DELETE","/api/cleaning/tasks/"+id);await load();}
async function aZT(zid){var i=document.getElementById("zti-"+zid);if(!i||!i.value.trim())return;await A("POST","/api/cleaning/zones/"+zid+"/tasks",{text:i.value.trim()});hp();await load();}
async function dlZn(id){if(!confirm("Delete zone?"))return;await A("DELETE","/api/cleaning/zones/"+id);hp();await load();}

function edZn(zid){
var z=D.zones.find(function(x){return x.id===zid});if(!z)return;
_assign=z.assigned_to||0;
_zRems=(z.reminders||[]).map(function(r){return r.remind_at});
oMC("Edit Zone",'<input class="inp" id="ez-n" value="'+es(z.name)+'"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ez-i" value="'+z.icon+'" style="text-align:center;font-size:24px"></div></div><div class="lb">Assigned to</div>'+assignPk("ezap",z.assigned_to)+'<div class="lb">Reminders</div><div id="zrw">'+zRemPk()+'</div><button class="btn" onclick="svZn('+zid+')">Save</button>');}

function zRemPk(){
var h='';_zRems.forEach(function(r,i){
var p=(r||"").split(" ");
h+='<div class="ri"><input type="date" value="'+(p[0]||"")+'" onchange="_zRems['+i+']=this.value+\' \'+(_zRems['+i+']||\'\').split(\' \')[1]||\'09:00\'" style="flex:1"><input type="time" value="'+(p[1]||"09:00")+'" step="60" onchange="_zRems['+i+']=(_zRems['+i+']||\'\').split(\' \')[0]+\' \'+this.value" style="width:100px"><button class="bi" onclick="_zRems.splice('+i+',1);document.getElementById(\'zrw\').innerHTML=zRemPk()">'+I.x+'</button></div>';});
if(_zRems.length<5)h+='<button class="ob" onclick="_zRems.push(td()+\' 09:00\');document.getElementById(\'zrw\').innerHTML=zRemPk()">+ Add</button>';
return h;}

async function svZn(zid){
var n=document.getElementById("ez-n").value.trim();var i=document.getElementById("ez-i").value.trim();
if(!n)return;
await A("PUT","/api/cleaning/zones/"+zid,{name:n,icon:i,assigned_to:_assign||null,reminders:_zRems});
cMo();hp();await load();}

function edZT(tid){
var t=null;D.zones.forEach(function(z){(z.tasks||[]).forEach(function(tk){if(tk.id===tid)t=tk})});
if(!t)return;_assign=t.assigned_to||0;
oMC("Edit Cleaning Task",'<input class="inp" id="zt-t" value="'+es(t.text)+'"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="zt-i" value="'+(t.icon||"🧹")+'" style="text-align:center;font-size:24px"></div><div><div class="dl">Reset (days)</div><input class="inp" id="zt-d" type="number" value="'+(t.reset_days||7)+'" min="1" max="90"></div></div><div class="lb">Assigned to</div>'+assignPk("ztap",t.assigned_to)+'<button class="btn" onclick="svZT('+tid+')">Save</button>');}
async function svZT(tid){
var text=document.getElementById("zt-t").value.trim();var icon=document.getElementById("zt-i").value.trim();
var rd=parseInt(document.getElementById("zt-d").value)||7;
if(!text)return;
await A("PUT","/api/cleaning/tasks/"+tid,{text:text,icon:icon,assigned_to:_assign||null,reset_days:rd});
cMo();hp();await load();}

function shAZ(){_assign=0;oMC("Add Zone",'<input class="inp" id="zn" placeholder="Zone name"><input class="inp" id="zic" placeholder="Emoji 🍳" style="width:80px"><div class="lb">Assigned to</div>'+assignPk("zap",null)+'<button class="btn" onclick="doAZ()">Add Zone</button>');}
async function doAZ(){var n=document.getElementById("zn").value.trim();if(!n)return;var i=document.getElementById("zic").value.trim()||"🏠";await A("POST","/api/cleaning/zones",{name:n,icon:i,assigned_to:_assign||null});cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════
function rCal(){
var h='<div class="tabs"><button class="tab '+(calTab==="events"?"a":"")+'" onclick="calTab=\'events\';ren()">📅 Events</button><button class="tab '+(calTab==="birthdays"?"a":"")+'" onclick="calTab=\'birthdays\';ren()">🎂 Birthdays</button><button class="tab '+(calTab==="subs"?"a":"")+'" onclick="calTab=\'subs\';ren()">💳 Subs</button></div>';
if(calTab==="events")return h+rEvts();
if(calTab==="birthdays")return h+rBdays();
return h+rSubsList();}

function rEvts(){
if(!D.events.length)return em("📅","No events","Tap + to schedule");
var colors=["var(--ok)","var(--pr)","var(--ac)","var(--wn)"];
var h='<div style="padding-left:22px;border-left:2px solid var(--bd);margin-left:10px">';
D.events.forEach(function(ev,i){var c=colors[i%colors.length];var fd=fD(ev.event_date);var st=(ev.event_date||"").split(" ")[1]||"";
var ep=ev.end_date?(" → "+fD(ev.end_date).date+" "+(ev.end_date.split(" ")[1]||"")):"";
h+='<div style="margin-bottom:12px;position:relative;margin-left:10px"><div class="c" style="margin-bottom:0"><div style="position:absolute;left:-39px;top:16px;width:14px;height:14px;border-radius:50%;background:'+c+';border:2.5px solid var(--bg)"></div><div class="bd"><div class="tt" style="font-weight:600">'+es(ev.text)+'</div><div class="mt" style="margin-top:6px"><span class="bg" style="background:color-mix(in srgb,'+c+',transparent 85%);color:'+c+'">'+fd.day+" "+fd.date+'</span><span>'+st+ep+'</span> '+sC("event",ev.id)+' <button class="xb" onclick="tX(\'event\','+ev.id+')">'+(ex["event_"+ev.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="dEv('+ev.id+')">'+I.tr+'</button></div>'+rSu("event",ev.id)+'</div>';});
return h+'</div>';}
async function dEv(id){hp();await A("DELETE","/api/events/"+id);await load();}

function rBdays(){
if(!D.birthdays.length)return em("🎂","No birthdays","Tap + to add");
var h='';D.birthdays.forEach(function(b){
var dd=b.days_until===0?'<span style="color:var(--ok);font-weight:700">Today! 🎉</span>':b.days_until===1?'<span style="color:var(--wn)">Tomorrow</span>':"in "+b.days_until+" days";
h+='<div class="c"><span style="font-size:32px">'+b.emoji+'</span><div class="bd"><div class="tt" style="font-weight:700">'+es(b.name)+'</div><div class="mt">'+b.birth_date.split("-").slice(1).reverse().join(".")+" · "+dd+'</div></div><button class="bi" onclick="edBd('+b.id+')">'+I.ed+'</button><button class="bi" onclick="dlBd('+b.id+')">'+I.tr+'</button></div>';});
return h;}
async function dlBd(id){hp();await A("DELETE","/api/birthdays/"+id);await load();}
function edBd(id){
var b=D.birthdays.find(function(x){return x.id===id});if(!b)return;
_bdRems=(b.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});
oMC("Edit Birthday",'<input class="inp" id="bd-n" value="'+es(b.name)+'"><input class="inp" id="bd-e" value="'+b.emoji+'" style="width:80px"><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="svBd('+id+')">Save</button>');}
function bdRemPk(){var h="";_bdRems.forEach(function(r,i){
h+='<div class="ri" style="margin-bottom:6px"><input type="number" value="'+r.days_before+'" min="0" max="30" onchange="_bdRems['+i+'].days_before=+this.value" style="width:60px;padding:6px;border-radius:8px;border:1px solid var(--bd);background:var(--cd);color:var(--tx);text-align:center"> days before <input type="time" value="'+r.time+'" step="60" onchange="_bdRems['+i+'].time=this.value" style="width:100px"><button class="bi" onclick="_bdRems.splice('+i+',1);document.getElementById(\'brl\').innerHTML=bdRemPk()">'+I.x+'</button></div>';});
if(_bdRems.length<5)h+='<button class="ob" onclick="_bdRems.push({days_before:0,time:\'09:00\'});document.getElementById(\'brl\').innerHTML=bdRemPk()">+ Add</button>';
return h;}
async function svBd(id){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim();if(!n)return;await A("PUT","/api/birthdays/"+id,{name:n,emoji:e,reminders:_bdRems});cMo();hp();await load();}

// Subscriptions
function rSubsList(){
if(!D.subs.length)return em("💳","No subscriptions","Tap + to add");
// Total
var totalEur=0;D.subs.forEach(function(s){totalEur+=(s.amount_eur||0)});
var h='<div class="c" style="border-left:3px solid var(--wn)"><div class="bd"><div class="tt" style="font-weight:700">Monthly total</div><div class="mt" style="font-size:16px;color:var(--wn);font-weight:800">€'+totalEur.toFixed(2)+'</div></div></div>';
// Filter by member
h+='<div class="fb2"><button class="fi '+(filt===null?"a":"")+'" onclick="filt=null;ren()">All</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" onclick="filt='+m.user_id+';ren()">'+m.emoji+'</button>';});h+='</div>';
var items=D.subs;
if(filt)items=items.filter(function(s){return s.assigned_to===filt});
items.forEach(function(s){
var daysTxt=s.days_until===0?"Due today":s.days_until===1?"Tomorrow":"in "+s.days_until+"d";
h+='<div class="c"><span style="font-size:28px">'+s.emoji+'</span><div class="bd"><div class="tt" style="font-weight:700">'+es(s.name)+'</div><div class="mt">'+s.amount+" "+s.currency+(s.currency!=="EUR"?" (€"+((s.amount_eur||0).toFixed(2))+")":"")+" · Day "+s.billing_day+" · "+daysTxt+" "+mChip(s.assigned_to,true)+'</div></div><button class="bi" onclick="edSub('+s.id+')">'+I.ed+'</button><button class="bi" onclick="dlSub('+s.id+')">'+I.tr+'</button></div>';});
return h;}
async function dlSub(id){hp();await A("DELETE","/api/subscriptions/"+id);await load();}
function edSub(id){
var s=D.subs.find(function(x){return x.id===id});if(!s)return;
_assign=s.assigned_to||0;
_subRems=(s.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});
oMC("Edit Subscription",'<input class="inp" id="su-n" value="'+es(s.name)+'"><input class="inp" id="su-e" value="'+s.emoji+'" style="width:80px"><div class="dr"><div><div class="dl">Amount</div><input class="inp" id="su-a" type="number" step="0.01" value="'+s.amount+'"></div><div><div class="dl">Currency</div><select id="su-c" style="width:100%"><option value="EUR"'+(s.currency==="EUR"?" selected":"")+'>€ EUR</option><option value="USD"'+(s.currency==="USD"?" selected":"")+'>$ USD</option><option value="GBP"'+(s.currency==="GBP"?" selected":"")+'>£ GBP</option><option value="RUB"'+(s.currency==="RUB"?" selected":"")+'>₽ RUB</option><option value="RSD"'+(s.currency==="RSD"?" selected":"")+'>дин. RSD</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="'+s.billing_day+'"></div></div><div class="lb">Assigned to</div>'+assignPk("sap",s.assigned_to)+'<div class="lb">Reminders</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="svSub('+id+')">Save</button>');}
function subRemPk(){var h="";_subRems.forEach(function(r,i){
h+='<div class="ri" style="margin-bottom:6px"><input type="number" value="'+r.days_before+'" min="0" max="30" onchange="_subRems['+i+'].days_before=+this.value" style="width:60px;padding:6px;border-radius:8px;border:1px solid var(--bd);background:var(--cd);color:var(--tx);text-align:center"> days before <input type="time" value="'+r.time+'" step="60" onchange="_subRems['+i+'].time=this.value" style="width:100px"><button class="bi" onclick="_subRems.splice('+i+',1);document.getElementById(\'srl\').innerHTML=subRemPk()">'+I.x+'</button></div>';});
if(_subRems.length<5)h+='<button class="ob" onclick="_subRems.push({days_before:1,time:\'09:00\'});document.getElementById(\'srl\').innerHTML=subRemPk()">+ Add</button>';
return h;}
async function svSub(id){var n=document.getElementById("su-n").value.trim();var e=document.getElementById("su-e").value.trim();var a=parseFloat(document.getElementById("su-a").value);var c=document.getElementById("su-c").value;var d=parseInt(document.getElementById("su-d").value)||1;if(!n||!a)return;await A("PUT","/api/subscriptions/"+id,{name:n,emoji:e,amount:a,currency:c,billing_day:d,assigned_to:_assign||null,reminders:_subRems});cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function rSet(){
var h='';
if(fS&&fS.joined){
h+='<div class="sc">Family</div><div class="c"><span style="font-size:28px">👨‍👩‍👧</span><div class="bd"><div class="tt" style="font-weight:600">'+es(fS.name||"My Family")+'</div></div></div><div class="cd2" style="margin-bottom:16px"><div class="ct2">'+(fS.invite_code||"...")+'</div><div class="cl2">Share this code</div></div>';
h+='<div class="sc">Members</div>';
(fS.members||[]).forEach(function(m){
h+='<div class="c">'+mAv(m.user_id,40)+'<div class="bd"><div class="tt" style="font-weight:600">'+es(m.user_name)+'</div><div style="width:24px;height:4px;border-radius:2px;background:'+m.color+';margin-top:3px"></div></div><button class="bi" onclick="edMe('+m.user_id+',\''+es(m.user_name)+'\',\''+m.emoji+'\',\''+m.color+'\')">'+I.ed+'</button></div>';});
h+='<div style="margin-bottom:20px"><button class="btn btn-s" style="font-size:13px" onclick="if(confirm(\'Leave family?\'))leaveFam()">Leave Family</button></div>';}
h+='<div class="sc">Theme</div><div class="tg">';
Object.keys(TH).forEach(function(id){var t=TH[id];var sel=cTheme===id;
h+='<div class="tc" onclick="setTh(\''+id+'\')" style="background:'+t.cd+';border:2px solid '+(sel?t.pr:t.bd)+'"><div class="te">'+t.e+'</div><div class="tn" style="color:'+t.tx+'">'+t.n+'</div><div class="td">'+[t.pr,t.ac,t.ok,t.wn].map(function(c){return '<div class="tdd" style="background:'+c+'"></div>'}).join("")+'</div></div>';});
h+='</div>';
h+='<div class="sc">Morning Digest</div><div style="margin-bottom:24px"><input type="time" id="dgt" value="'+(D.settings.digest_time||"09:00")+'" step="60" onchange="setDg(this.value)"></div>';
h+='<div class="sc">Debug</div><div class="c" style="cursor:pointer" onclick="dbgOn=!dbgOn;document.getElementById(\'dbg\').classList.toggle(\'hidden\',!dbgOn);ren()"><span style="font-size:20px">🐛</span><div class="bd"><div class="tt">Debug Mode '+(dbgOn?"ON":"OFF")+'</div></div></div>';
return h;}

async function setTh(id){aT(id);hp();await A("PATCH","/api/settings",{theme:id});ren();}
async function setDg(v){await A("PATCH","/api/settings",{digest_time:v});hp();}
async function leaveFam(){await A("POST","/api/family/leave");location.reload();}
function edMe(uid,name,emoji,color){
oMC("Edit Profile",'<input class="inp" id="me-n" value="'+name+'" placeholder="Name"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="me-e" value="'+emoji+'" style="text-align:center;font-size:24px"></div><div><div class="dl">Color</div><input type="color" id="me-c" value="'+color+'" style="width:100%;height:48px;border-radius:12px;border:none;cursor:pointer"></div></div><button class="btn" onclick="svMe('+uid+')">Save</button>');}
async function svMe(uid){var n=document.getElementById("me-n").value.trim();var e=document.getElementById("me-e").value.trim();var c=document.getElementById("me-c").value;if(!n)return;await A("PATCH","/api/members/"+uid,{user_name:n,emoji:e,color:c});cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════
function oMC(t,h){document.getElementById("mt3").textContent=t;document.getElementById("mb").innerHTML=h;document.getElementById("mo").classList.add("op");setTimeout(function(){var i=document.querySelector("#mb input");if(i)i.focus()},300);}
function cMo(){document.getElementById("mo").classList.remove("op");}

function oMo(){
_assign=0;_pri="normal";_rems=[];var dy=td();
switch(tab){
case"tasks":
    if(taskTab==="recurring"){
        oMC("New Recurring Task",'<input class="inp" id="f-t" placeholder="Task name"><div class="lb">Assign to</div>'+assignPk("ap",null)+'<div class="lb">Schedule</div><div class="or"><button class="ob s" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Daily</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">Weekly</button><button class="ob" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">Monthly</button></div><input type="hidden" id="rr" value="daily"><div id="wd" class="hidden"><div class="lb">Days</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="hidden"><div class="lb">Day of month</div><input class="inp" id="f-md" type="number" min="1" max="28" value="1"></div><button class="btn" onclick="doRec()">Create</button>');
    } else {
        oMC("New Task",'<input class="inp" id="f-t" placeholder="What needs to be done?"><div class="lb">Assign to</div>'+assignPk("ap",null)+'<div class="lb">Priority</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob '+(p==="normal"?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+p[0].toUpperCase()+p.slice(1)+'</button>'}).join("")+'</div><div class="lb">Due Date</div><div class="dr"><div><input type="date" id="f-dd" min="'+dy+'"></div></div><div class="lb">Reminders</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="doTk()">Add Task</button>');
    }break;
case"shop":
    oMC("Add Items",'<input class="inp" id="f-it" placeholder="Milk [1L], bread, eggs [12]..."><div style="font-size:12px;color:var(--ht);margin:-4px 0 14px">Use [qty] for amounts. Comma-separated.</div>'+(D.folders.length?'<div class="lb">Folder</div><div class="or"><button class="ob s" onclick="shopFold=null;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">None</button>'+D.folders.map(function(f){return '<button class="ob" onclick="shopFold='+f.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+f.emoji+" "+es(f.name)+'</button>'}).join("")+'</div>':"")+'<button class="btn" onclick="doSh()">Add to List</button>');
    break;
case"cal":
    if(calTab==="events"){
        oMC("New Event",'<input class="inp" id="f-t" placeholder="Event name"><div class="lb">Start</div><div class="dr"><div><div class="dl">Date</div><input type="date" id="f-d" value="'+dy+'" min="'+dy+'"></div><div><div class="dl">Time</div><input type="time" id="f-tm" value="12:00" step="60"></div></div><div class="lb">End (optional)</div><div class="dr"><div><input type="date" id="f-ed"></div><div><input type="time" id="f-et" step="60"></div></div><button class="btn" onclick="doEv()">Add Event</button>');
    } else if(calTab==="birthdays"){
        _bdRems=[{days_before:1,time:"09:00"},{days_before:0,time:"09:00"}];
        oMC("Add Birthday",'<input class="inp" id="bd-n" placeholder="Name"><input class="inp" id="bd-e" value="🎂" style="width:80px"><div class="lb">Date of Birth</div><div class="dr"><div><input type="date" id="bd-d"></div></div><div class="lb">Reminders</div><div id="brl">'+bdRemPk()+'</div><button class="btn" onclick="doBd()">Add Birthday</button>');
    } else {
        _assign=0;_subRems=[{days_before:3,time:"09:00"},{days_before:0,time:"09:00"}];
        oMC("Add Subscription",'<input class="inp" id="su-n" placeholder="Subscription name"><input class="inp" id="su-e" value="💳" style="width:80px"><div class="dr"><div><div class="dl">Amount</div><input class="inp" id="su-a" type="number" step="0.01" placeholder="9.99"></div><div><div class="dl">Currency</div><select id="su-c"><option value="EUR">€ EUR</option><option value="USD">$ USD</option><option value="GBP">£ GBP</option><option value="RUB">₽ RUB</option><option value="RSD">дин. RSD</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="1"></div></div><div class="lb">Assigned to</div>'+assignPk("sap",null)+'<div class="lb">Reminders</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="doNewSub()">Add Subscription</button>');
    }break;}
document.getElementById("mo").classList.add("op");
setTimeout(function(){var i=document.querySelector("#mb input[type=text],#mb input.inp");if(i)i.focus()},300);}

// Modal submit handlers
async function doTk(){var t=document.getElementById("f-t").value.trim();if(!t)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("POST","/api/tasks",{text:t,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load();}
async function doRec(){var t=document.getElementById("f-t").value.trim();if(!t)return;var rr=document.getElementById("rr").value;if(rr==="weekly:"){var days=[];document.querySelectorAll("#wd .ob.s").forEach(function(b){days.push(b.textContent)});if(!days.length){alert("Select at least one day");return}rr="weekly:"+days.join(",");}else if(rr==="monthly:"){rr="monthly:"+(document.getElementById("f-md")?document.getElementById("f-md").value:"1");}await A("POST","/api/recurring",{text:t,assigned_to:_assign||null,priority:_pri,rrule:rr});cMo();hp();await load();}
async function doSh(){var r=document.getElementById("f-it").value;var items=r.split(",").map(function(s){return s.trim()}).filter(Boolean);if(!items.length)return;await A("POST","/api/shopping",{items:items,folder_id:shopFold});cMo();hp();await load();}
async function doEv(){var t=document.getElementById("f-t").value.trim();var d=document.getElementById("f-d").value;var tm=document.getElementById("f-tm").value||"12:00";if(!t||!d)return;var ed=document.getElementById("f-ed")?document.getElementById("f-ed").value:"";var et=document.getElementById("f-et")?document.getElementById("f-et").value:"";var end=ed?ed+" "+(et||tm):null;await A("POST","/api/events",{text:t,event_date:d+" "+tm,end_date:end});cMo();hp();await load();}
async function doBd(){var n=document.getElementById("bd-n").value.trim();var e=document.getElementById("bd-e").value.trim()||"🎂";var d=document.getElementById("bd-d").value;if(!n||!d)return;await A("POST","/api/birthdays",{name:n,emoji:e,birth_date:d,reminders:_bdRems});cMo();hp();await load();}
async function doNewSub(){var n=document.getElementById("su-n").value.trim();var e=document.getElementById("su-e").value.trim()||"💳";var a=parseFloat(document.getElementById("su-a").value);var c=document.getElementById("su-c").value;var d=parseInt(document.getElementById("su-d").value)||1;if(!n||!a)return;await A("POST","/api/subscriptions",{name:n,emoji:e,amount:a,currency:c,billing_day:d,assigned_to:_assign||null,reminders:_subRems});cMo();hp();await load();}

// ═══════════════════════════════════════════════════════════
// VIEWPORT FIX
// ═══════════════════════════════════════════════════════════
function fixVP(){
var nav=document.getElementById("nv");var fab=document.getElementById("fab");if(!nav)return;
var rect=nav.getBoundingClientRect();var vh=window.innerHeight;
var tgB=0;try{tgB=window.Telegram.WebApp.safeAreaInset.bottom||0}catch(e){}
var total=Math.max(rect.height+20+tgB,82+tgB);
document.body.style.paddingBottom=total+"px";
nav.style.paddingBottom=Math.max(tgB,8)+"px";nav.style.height="auto";nav.style.minHeight="62px";
if(fab)fab.style.bottom=(total+12)+"px";}
fixVP();window.addEventListener("resize",fixVP);
if(tg)try{tg.onEvent("viewportChanged",fixVP)}catch(e){}
setTimeout(fixVP,500);setTimeout(fixVP,1500);

// ─── Init ───────────────────────────────────────────────────
try{init()}catch(e){document.getElementById("ct").innerHTML='<pre style="color:red">'+e.message+"\n"+e.stack+'</pre>';}
