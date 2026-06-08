// ═══════════════════════════════════════════════════════════════
// 🧪 Family HQ — DEMO MODE (design preview / no login)
// ═══════════════════════════════════════════════════════════════
// Activated ONLY with ?demo=1 in the URL. When active, the API helper A() in
// app.js short-circuits to _demoApi() below — NOTHING is fetched, NO auth is
// sent, the real backend is never touched, and no real data can be read or
// written. It's a pure client-side fixture so the whole UI renders populated for
// design review / sharing. Inert (zero effect) without the flag.
// Loaded BEFORE app.js so DEMO / _demoApi are global when A() runs.

var DEMO = false;
try { DEMO = /[?&]demo=1/.test(location.search || ""); } catch (e) {}

var _DEMO_MEMBERS = [
  { user_id: 425342813, user_name: "Yaroslav", emoji: "🦊", color: "#6B8FD4", photo_url: null, lang: "en", theme: null, custom_theme: null, learn_mode: "en_ru" },
  { user_id: 5063035495, user_name: "Ella",    emoji: "🦋", color: "#C77DBB", photo_url: null, lang: "en", theme: null, custom_theme: null, learn_mode: "en_ru" }
];
var _DEMO_ME = 425342813, _DEMO_FAM = 1, _DEMO_YM = (function(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); })();

var _DEMO_PERSONAL = [
  { id:"fun",     name:"Fun",         emoji:"🎉",  color:"#E8714A" },
  { id:"rest",    name:"Rest",        emoji:"🛋️", color:"#6BB0D4" },
  { id:"hobby",   name:"Hobby",       emoji:"🎨",  color:"#C77DBB" },
  { id:"friends", name:"Friends",     emoji:"👥",  color:"#E8A24A" },
  { id:"health",  name:"Health",      emoji:"🌿",  color:"#5FB37A" },
  { id:"selfdev", name:"Self-growth", emoji:"📈",  color:"#8B7BE8" },
  { id:"career",  name:"Career",      emoji:"💼",  color:"#6B8FD4" },
  { id:"family",  name:"Family",      emoji:"🏡",  color:"#E8C54A" }
];
var _DEMO_REL = [
  { id:"rel_time",      name:"Time Together", emoji:"🕯", color:"#E8A24A" },
  { id:"rel_comm",      name:"Communication", emoji:"💬", color:"#6B8FD4" },
  { id:"rel_affection", name:"Affection",     emoji:"❤️", color:"#E06A8A" },
  { id:"rel_goals",     name:"Shared Goals",  emoji:"🎯", color:"#8B7BE8" },
  { id:"rel_joy",       name:"Joy",           emoji:"✨", color:"#E8C54A" },
  { id:"rel_care",      name:"Care",          emoji:"🤝", color:"#5FB37A" }
];

// Mutable in-memory events keyed by "owner|area".
var _eid = 100;
function _ev(name, emoji, count, pinned){ return { id:_eid++, name:name, emoji:emoji, count:count||1, pinned:!!pinned, ym:_DEMO_YM }; }
var _DEMO_EVENTS = {};
_DEMO_EVENTS["425342813|health"]  = [_ev("Pushups","💪",3,true), _ev("Morning run","🏃",1), _ev("Yoga","🧘",2)];
_DEMO_EVENTS["425342813|fun"]     = [_ev("Met friends","🍻",2), _ev("Cinema","🎬",1)];
_DEMO_EVENTS["425342813|hobby"]   = [_ev("Painted","🖌️",4,true), _ev("Guitar","🎸",1)];
_DEMO_EVENTS["425342813|selfdev"] = [_ev("Read a book","📖",3)];
_DEMO_EVENTS["425342813|career"]  = [_ev("Shipped feature","🚀",2), _ev("Mentored","🧑‍🏫",1)];
_DEMO_EVENTS["425342813|rest"]    = [_ev("Long sleep","😴",2)];
_DEMO_EVENTS["family|rel_time"]   = [_ev("Phone-free dinner","🕯",3,true), _ev("Walk together","🚶",2)];
_DEMO_EVENTS["family|rel_joy"]    = [_ev("Danced in kitchen","💃",1)];

function _demoAreas(owner){
  var defs = (owner==="family") ? _DEMO_REL : _DEMO_PERSONAL;
  return defs.map(function(a){
    var evs = _DEMO_EVENTS[owner+"|"+a.id] || [];
    var cnt = evs.length;
    return { id:a.id, name:a.name, emoji:a.emoji, color:a.color,
      brightness: Math.round(Math.min(1,0.15*cnt)*100)/100, event_count:cnt, habit_count:cnt,
      customized:false, is_custom:false };
  });
}
function _demoSummary(owner){
  var areas=_demoAreas(owner);
  var bond = owner==="family" ? Math.round((areas.reduce(function(s,a){return s+a.brightness},0)/areas.length)*100)/100 : 0;
  return { owner:owner, scope:(owner==="family"?"family":"personal"), ym:_DEMO_YM, cur_ym:_DEMO_YM,
    areas:areas, bond:bond, members:_DEMO_MEMBERS };
}

// ── Love Points ──
var _DEMO_LOVE_ENTRIES = [
  { id:5, from_user:5063035495, to_user:425342813, reason:"made coffee", emoji:"☕", created_at:new Date(Date.now()-3600e3).toISOString(), delta:1 },
  { id:4, from_user:425342813, to_user:5063035495, reason:"big hug", emoji:"🤗", created_at:new Date(Date.now()-2*3600e3).toISOString(), delta:1 },
  { id:3, from_user:425342813, to_user:5063035495, reason:"cooked dinner", emoji:"🍳", created_at:new Date(Date.now()-26*3600e3).toISOString(), delta:1 },
  { id:2, from_user:5063035495, to_user:425342813, reason:"left dishes", emoji:"😤", created_at:new Date(Date.now()-28*3600e3).toISOString(), delta:-1 },
  { id:1, from_user:5063035495, to_user:425342813, reason:"flowers", emoji:"🌹", created_at:new Date(Date.now()-50*3600e3).toISOString(), delta:1 }
];
function _demoLoveStatus(){
  var sc={}; _DEMO_LOVE_ENTRIES.forEach(function(e){ sc[String(e.to_user)]=(sc[String(e.to_user)]||0)+e.delta; });
  var d=new Date(), dim=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  var mx=Math.max.apply(null,[0].concat(Object.keys(sc).map(function(k){return sc[k]}))), leader=null;
  Object.keys(sc).forEach(function(k){ if(sc[k]===mx&&mx>0) leader=leader==null?parseInt(k):-1; });
  return { ym:_DEMO_YM, month:d.toLocaleDateString("en-US",{month:"long"}), days_left:dim-d.getDate(),
    days_in_month:dim, scores:sc, members:_DEMO_MEMBERS, leader:(leader>0?leader:425342813) };
}
function _demoLoveHistory(){
  var months=[]; var d=new Date();
  for(var i=5;i>=0;i--){ var dd=new Date(d.getFullYear(),d.getMonth()-i,1); var ym=dd.getFullYear()+"-"+String(dd.getMonth()+1).padStart(2,"0");
    var a=i===0?5:Math.round(Math.random()*6+1), b=i===0?4:Math.round(Math.random()*6+1);
    months.push({ ym:ym, scores: i===0 ? (function(){var s=_demoLoveStatus().scores;return s})() : {"425342813":a,"5063035495":b} }); }
  return { members:_DEMO_MEMBERS, months:months };
}

// ── Bundle (Home / Tasks / Money / Profile) ──
function _demoDate(off){ var d=new Date(); d.setDate(d.getDate()+off); return d.toISOString().slice(0,10); }
function _demoBundle(){
  return {
    family: { joined:true, my_id:_DEMO_ME, name:"Demo Family", invite_code:"DEMO", lang:"en" },
    members: _DEMO_MEMBERS,
    settings: { theme:"onyx" },
    dashboard: { cleaning_dirty:1, balance_eur: 1240.5, month_spent_eur: 410.2 },
    weather: { label:"Clear", now:21, feels:20, city:"Belgrade",
      days:[ {date:_demoDate(0),label:"Clear",max:24,min:14}, {date:_demoDate(1),label:"Partly",max:23,min:13},
             {date:_demoDate(2),label:"Rain",max:19,min:12}, {date:_demoDate(3),label:"Clear",max:25,min:15} ] },
    tasks: [
      { id:1, text:"Pay rent", done:false, due_date:_demoDate(1), assigned_to:425342813, priority:"high" },
      { id:2, text:"Buy groceries", done:false, due_date:_demoDate(0), assigned_to:425342813, priority:"normal" },
      { id:3, text:"Call plumber", done:false, due_date:_demoDate(3), assigned_to:425342813, priority:"low" },
      { id:5, text:"Book vacation", done:false, due_date:_demoDate(2), assigned_to:425342813, priority:"normal" },
      { id:4, text:"Water the plants", done:true, due_date:_demoDate(-1), assigned_to:425342813, priority:"normal" }
    ],
    recurring: [], shopping:[{id:1,name:"Milk",bought:false,qty:"2"},{id:2,name:"Bread",bought:false,qty:"1"}],
    folders: [], events:[{id:1,text:"Dentist",event_date:_demoDate(2)+" 10:00"},{id:2,text:"Movie night",event_date:_demoDate(0)+" 20:00"}],
    birthdays:[{id:1,name:"Mom",days_until:5,emoji:"🎂"}], subs:[{id:1,name:"Netflix",amount:12,currency:"EUR",days_until:6,emoji:"🎬"}],
    zones:[], subtasks_task:{}, subtasks_event:{}, tx_items:{},
    categories:[{id:"food",name:"Food",emoji:"🍔"},{id:"transport",name:"Transport",emoji:"🚕"},{id:"fun",name:"Fun",emoji:"🎉"}],
    transactions:[
      {id:1,amount:1200,currency:"RSD",category:"food",note:"Lunch",date:_demoDate(0),user_id:425342813,kind:"expense"},
      {id:2,amount:800,currency:"RSD",category:"transport",note:"Taxi",date:_demoDate(-1),user_id:5063035495,kind:"expense"}
    ],
    exercises:[], recent_workouts:[], workout_templates:[], plants:[], dishes:[]
  };
}
function _demoProfileStats(){
  return {
    tasks_active:3, tasks_done:5, tasks_overdue:1, tasks_high:2,
    words_total:540, words_learned:312, words_mode:"en", words_learning:48, words_accuracy:86,
    train_week:{ tonnage:12400, workouts:3 }, train_prev_week:{ tonnage:10800 }, train_delta_pct:15,
    clean_total:6, clean_done:4
  };
}

// ── Router ──
function _demoMatch(m, p){
  var path = (p||"").split("?")[0];
  var qs = (p||"").split("?")[1] || "";
  function qp(k){ var mm=qs.match(new RegExp("(?:^|&)"+k+"=([^&]*)")); return mm?decodeURIComponent(mm[1]):null; }

  if(path==="/api/family/status") return { joined:true, my_id:_DEMO_ME, name:"Demo Family", invite_code:"DEMO", lang:"en", nav_tabs:null, members:_DEMO_MEMBERS };
  if(path==="/api/bundle") return _demoBundle();
  if(path==="/api/profile/stats") return _demoProfileStats();
  if(path==="/api/members") return _DEMO_MEMBERS;
  if(path==="/api/calendar") return { events:[], tasks:[], birthdays:[], subs:[] };

  // ── Life ──
  if(path==="/api/life/summary"){ return _demoSummary(qp("owner")||String(_DEMO_ME)); }
  if(path==="/api/life/events"){
    var owner=qp("owner")||String(_DEMO_ME), area=qp("area_id");
    var evs=area ? (_DEMO_EVENTS[owner+"|"+area]||[]) : [];
    return { owner:owner, area_id:area, ym:_DEMO_YM, cur_ym:_DEMO_YM, events:evs.map(function(e){return e}) };
  }
  if(path==="/api/life/active"){ return { challenges:[], members:_DEMO_MEMBERS }; }
  if(path==="/api/life/journey"){
    var owner2=qp("owner")||String(_DEMO_ME), areas=_demoAreas(owner2);
    var evs2=[]; Object.keys(_DEMO_EVENTS).forEach(function(k){ if(k.indexOf(owner2+"|")===0) evs2=evs2.concat(_DEMO_EVENTS[k]); });
    var total=evs2.reduce(function(s,e){return s+(e.count||1)},0);
    var top=evs2.slice().sort(function(a,b){return (b.count||1)-(a.count||1)})[0]||{name:"—",count:0};
    var daily=[]; for(var i=0;i<30;i++) daily.push({date:i, count: i>22?Math.round(Math.random()*2):0});
    return { owner:owner2, scope:(owner2==="family"?"family":"personal"), ym:_DEMO_YM, cur_ym:_DEMO_YM,
      balance: Math.round((areas.reduce(function(s,a){return s+a.brightness},0)/areas.length)*100)/100,
      areas:areas, daily:daily, stats:{ events:evs2.length, total_count:total, completions_7d:Math.min(total,6), top_event:top.name, top_count:top.count||0 } };
  }

  // ── Love ──
  if(path==="/api/love") return _demoLoveStatus();
  if(path==="/api/love/history") return _demoLoveHistory();
  if(path==="/api/love/stats") return { ym:_DEMO_YM, entries:_DEMO_LOVE_ENTRIES.map(function(e){return e}) };

  return {};  // safe default — never null (avoids "bails to login" paths)
}

// Mutations (POST/PATCH/DELETE) — mutate the in-memory fixtures so clicking feels live.
function _demoMutate(m, p, b){
  var path=(p||"").split("?")[0], qs=(p||"").split("?")[1]||"";
  function qp(k){ var mm=qs.match(new RegExp("(?:^|&)"+k+"=([^&]*)")); return mm?decodeURIComponent(mm[1]):null; }
  var mm;

  // Life event bump
  if((mm=path.match(/^\/api\/life\/events\/(\d+)\/bump$/))){
    var id=+mm[1]; for(var k in _DEMO_EVENTS){ var e=_DEMO_EVENTS[k].find(function(x){return x.id===id}); if(e){ e.count=Math.max(1,(e.count||1)+((b&&b.delta<0)?-1:1)); return e; } }
    return {};
  }
  if((mm=path.match(/^\/api\/life\/events\/(\d+)\/pin$/))){
    var id2=+mm[1]; for(var k2 in _DEMO_EVENTS){ var e2=_DEMO_EVENTS[k2].find(function(x){return x.id===id2}); if(e2){ e2.pinned=!!(b&&b.pinned); return e2; } } return {};
  }
  if(path==="/api/life/events" && m==="POST"){
    var owner=(b&&b.owner)||String(_DEMO_ME), area=(b&&b.area_id); var key=owner+"|"+area;
    var ne=_ev((b&&b.name)||"Event",(b&&b.emoji)||"🌱",1,false); (_DEMO_EVENTS[key]=_DEMO_EVENTS[key]||[]).push(ne); return ne;
  }
  if((mm=path.match(/^\/api\/life\/events\/(\d+)$/)) && m==="DELETE"){
    var id3=+mm[1]; for(var k3 in _DEMO_EVENTS){ _DEMO_EVENTS[k3]=_DEMO_EVENTS[k3].filter(function(x){return x.id!==id3}); } return {ok:true};
  }
  // Love award / deduct
  if(path==="/api/love" && m==="POST"){
    _DEMO_LOVE_ENTRIES.unshift({ id:Date.now()%100000, from_user:_DEMO_ME, to_user:(b&&b.to_user), reason:(b&&b.reason)||"", emoji:(b&&b.emoji)||"❤️", created_at:new Date().toISOString(), delta:(b&&b.delta<0)?-1:1 });
    return _demoLoveStatus();
  }
  if(path==="/api/love/latest" && m==="DELETE"){ return _demoLoveStatus(); }

  return {};  // generic OK
}

function _demoApi(m, p, b){
  var data = (m==="GET") ? _demoMatch(m, p) : _demoMutate(m, p, b);
  // small async delay so spinners/transitions behave like the real thing
  return new Promise(function(res){ setTimeout(function(){ res(data); }, 40); });
}
