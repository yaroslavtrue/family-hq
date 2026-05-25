// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Trainings tab (extracted from app.js in v8.42.0)
// ═══════════════════════════════════════════════════════════════
// Workout templates carousel, in-progress workout view, set entry with
// big steppers (v8.35.0), period stats (Day/Week/Month/Year), AI-art
// template image upload.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from earlier modules: D, fS, tr(), trn(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), ren(), mAv(), fD(), _downscaleImage(),
// iD, _wkTimer (timer state, see below).

// Trainings-specific state — `var` so app.js can reset it on tab switch
// (see `if(tabId==="trainings")_trainStats=null;` in go()).
var _trainMember, _trainStats=null, _trainView="recent", _curWorkout=null, _restTimer=null, _wkTimer=null;

// ═══════════════════════════════════════════════════════════
// TRAININGS — workouts, exercises, sets, tonnage
// ═══════════════════════════════════════════════════════════
function _trainMyId(){return fS&&fS.my_id?fS.my_id:0}
function _trainScopeMember(){return _trainMember===null?_trainMyId():_trainMember} // null = "Family", else specific member

function rTrain(){
var myId=_trainMyId();
if(_trainMember===undefined)_trainMember=myId;
var h='';
// ─── Greeting ─────────────────────────────────────
if(_trainMember!==null){
  var meMember=(D.members||[]).find(function(m){return m.user_id===_trainMember});
  var meName=meMember?meMember.user_name:'there';
  h+='<div class="tr-greet"><div><div class="tr-greet-hi">Hi, '+es(meName)+'!</div><div class="tr-greet-sub">Ready for a workout?</div></div></div>';
}
// ─── Member switcher pills ────────────────────────
h+='<div class="fb2" style="margin-bottom:18px">';
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

var memberWorkouts=(D.recentWorkouts||[]).filter(function(w){return w.member_id===_trainMember});
var today=td();
var todayW=memberWorkouts.find(function(w){return w.date===today});

// ─── Active workout banner (top priority if in progress) ──
if(todayW&&todayW.started_at&&!todayW.finished_at){
  h+='<div class="tr-active" onclick="openWorkout('+todayW.id+')">'+
    '<div class="tr-active-pulse"></div>'+
    '<div class="tr-active-bd"><div class="tr-active-l">● Active workout</div><div class="tr-active-n">'+(todayW.name?es(todayW.name):"In progress")+' · '+_fmtTon(todayW.tonnage||0)+'</div></div>'+
    '<span class="lc-chev">›</span></div>';
}

// ─── My Workouts carousel ─────────────────────────
var myTpls=(D.workoutTemplates||[]).filter(function(t){return!t.member_id||t.member_id===_trainMember});
h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("dumbbell",12,2.4)+'</span>My Workouts</span>'+
   (myTpls.length?'<button class="at" onclick="openNewTemplate()">+ New</button>':'')+'</div>';

if(myTpls.length===0){
  h+='<div class="tr-tpl-row"><button class="tr-tpl-add" onclick="openNewTemplate()"><span style="font-size:32px;line-height:1">+</span><span style="font-size:11px;margin-top:8px">'+tr("tr_create_template")+'</span></button>';
  h+='<button class="tr-tpl-add" onclick="startBlankWorkout()" style="border-style:solid;border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 8%,var(--cd));color:var(--ok)"><span style="font-size:30px;line-height:1">▶</span><span style="font-size:11px;margin-top:8px">'+tr("tr_empty_workout")+'</span></button>';
  h+='</div>';
}else{
  h+='<div class="tr-tpl-row">';
  h+='<button class="tr-tpl-add" onclick="openNewTemplate()"><span style="font-size:32px;line-height:1">+</span><span style="font-size:11px;margin-top:8px">Add</span></button>';
  myTpls.forEach(function(t){h+=_templateHeroCard(t)});
  h+='</div>';
}

// ─── Statistics with period tabs ───────────────────
h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("chart",12,2.4)+'</span>'+tr("tr_statistics")+'</span>'+
   '<button class="at" onclick="openTrainStats()">Details ›</button></div>';
h+=_trainStatsBlock();

// ─── Last workout ──────────────────────────────────
var last=memberWorkouts.filter(function(w){return w.date!==today})[0];
if(todayW&&!(todayW.started_at&&!todayW.finished_at)){
  // Today is finished — show it as "Today's workout"
  h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("calendar",12,2.4)+'</span>Today’s workout</span></div>';
  h+=_workoutCard(todayW,true);
}else if(last){
  h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("clock",12,2.4)+'</span>Last workout</span></div>';
  h+=_workoutCard(last,false);
}

// Trigger stats fetch (period defaults to "week") after first render
setTimeout(_trainStatsLoad,0);
return h;
}

// ─── Template hero card (replaces old _templateCard for main view) ─────
function _templateHeroCard(t){
  var n=t.exercise_count||(t.exercises_list||[]).length;
  var col1=t.color_from||"#6366f1", col2=t.color_to||"#4338ca";
  var muscle=t.primary_muscle||"mixed";
  var muscleEmoji=({legs:"🦵",lower:"🦵",arms:"💪",biceps:"💪",triceps:"💪",chest:"🫁",back:"🔙",shoulders:"🤸",core:"⚡",abs:"⚡",cardio:"🏃",glutes:"🍑",mixed:"🏋️"})[muscle]||"🏋️";
  var bgStyle;
  if(t.has_image){
    bgStyle='background-image:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.45) 100%),url(/static/workouts/'+t.id+'.jpg);background-size:cover;background-position:center';
  }else{
    bgStyle='background:linear-gradient(135deg,'+col1+','+col2+')';
  }
  return '<button class="tr-tpl" style="'+bgStyle+'" onclick="openTemplateDetail('+t.id+')">'+
    (t.has_image?'':'<div class="tr-tpl-emoji">'+muscleEmoji+'</div>')+
    '<div class="tr-tpl-name">'+es(t.name)+'</div>'+
    '<div class="tr-tpl-count">'+n+' exercises</div>'+
    '</button>';
}

// ─── Stats block with period tabs ──────────────────────────
var _trainStatsPeriod="week";
var _trainStatsData=null;
function _trainStatsBlock(){
  var d=_trainStatsData;
  var h='<div class="tr-tabs">';
  var periods=[["day","Day"],["week","Week"],["month","Month"],["year","Year"]];
  periods.forEach(function(p){
    h+='<button class="tr-tab '+(_trainStatsPeriod===p[0]?"a":"")+'" onclick="_trainSetPeriod(\''+p[0]+'\')">'+p[1]+'</button>';
  });
  h+='</div>';
  if(!d){
    h+='<div class="tr-stat-big"><div style="padding:30px;text-align:center;color:var(--ht);font-size:13px">⏳ Loading…</div></div>';
    return h;
  }
  var deltaPart='';
  if(d.delta_pct!==null&&d.delta_pct!==undefined){
    var col=d.delta_pct>=0?'var(--ok)':'var(--ac)';
    var arrow=d.delta_pct>=0?"▲":"▼";
    var prevLbl={day:"yesterday",week:"last week",month:"last month",year:"last year"}[d.period]||"previous";
    deltaPart='<div class="tr-delta" style="color:'+col+'">'+arrow+' '+Math.abs(d.delta_pct)+'% vs '+prevLbl+'</div>';
  }
  h+='<div class="tr-stat-big">';
  h+='<div class="tr-stat-lb">Tonnage · '+es(d.label)+'</div>';
  h+='<div class="tr-stat-vl">'+_fmtTon(d.current.tonnage)+'</div>';
  h+=deltaPart;
  // Bars
  if(d.bars&&d.bars.length){
    h+='<div class="tr-bars">';
    d.bars.forEach(function(b){
      var pct=d.max_bar?Math.max(2,b.tonnage/d.max_bar*100):0;
      var cls=b.is_current?'tr-bar tr-bar-cur':'tr-bar';
      var tip=b.is_current&&b.tonnage>0?'<span class="tr-bar-tooltip">'+_fmtTon(b.tonnage)+'</span>':'';
      h+='<div class="tr-bar-col">'+tip+'<div class="'+cls+'" style="height:'+pct+'%"></div><div class="tr-bar-lb">'+es(b.label)+'</div></div>';
    });
    h+='</div>';
  }
  h+='</div>';
  // Secondary metrics
  h+='<div class="tr-metrics">';
  h+='<div class="tr-metric"><div class="tr-metric-lb">Workouts</div><div class="tr-metric-vl">'+(d.current.workouts||0)+'</div></div>';
  h+='<div class="tr-metric"><div class="tr-metric-lb">Sets</div><div class="tr-metric-vl">'+(d.current.sets||0)+'</div></div>';
  h+='<div class="tr-metric"><div class="tr-metric-lb">Avg / workout</div><div class="tr-metric-vl">'+_fmtTon(d.avg_per_workout||0)+'</div></div>';
  h+='<div class="tr-metric"><div class="tr-metric-lb">Max day</div><div class="tr-metric-vl">'+_fmtTon(d.max_daily||0)+'</div></div>';
  h+='</div>';
  return h;
}
function _trainSetPeriod(p){_trainStatsPeriod=p;_trainStatsData=null;_trainStatsLoading=false;hp("sel");ren();_trainStatsLoad()}
var _trainStatsLoading=false;
async function _trainStatsLoad(){
  // Lazy guard: skip if already loaded or currently fetching. Prevents the
  // setTimeout(_trainStatsLoad,0) call in rTrain from looping (load→ren→load→…)
  if(_trainStatsData||_trainStatsLoading)return;
  _trainStatsLoading=true;
  var q="?period="+_trainStatsPeriod;
  if(_trainMember)q+="&member_id="+_trainMember;
  var d=await A("GET","/api/trainings/stats/period"+q);
  _trainStatsLoading=false;
  if(!d)return;
  _trainStatsData=d;
  if(tab==="trainings")ren();
}

// ─── Template detail modal ──────────────────────────────────
async function openTemplateDetail(tid){
  hp("light");
  var t=(D.workoutTemplates||[]).find(function(x){return x.id===tid});
  if(!t){toast("Template not found");return}
  var ex=t.exercises_list||[];
  var col1=t.color_from||"#6366f1", col2=t.color_to||"#4338ca";
  var muscle=t.primary_muscle||"mixed";
  var muscleEmoji=({legs:"🦵",lower:"🦵",arms:"💪",biceps:"💪",triceps:"💪",chest:"🫁",back:"🔙",shoulders:"🤸",core:"⚡",abs:"⚡",cardio:"🏃",glutes:"🍑",mixed:"🏋️"})[muscle]||"🏋️";
  var bgStyle;
  if(t.has_image){
    bgStyle='background-image:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.55) 100%),url(/static/workouts/'+tid+'.jpg?t='+Date.now()+');background-size:cover;background-position:center';
  }else{
    bgStyle='background:linear-gradient(135deg,'+col1+','+col2+')';
  }
  var h='<div class="tr-detail-hero" style="'+bgStyle+'">';
  if(!t.has_image)h+='<div class="tr-detail-emoji">'+muscleEmoji+'</div>';
  h+='<div class="tr-detail-hero-bd"><div class="tr-detail-name">'+es(t.name)+'</div>';
  h+='<div class="tr-detail-count">'+ex.length+' exercises</div></div></div>';
  // Image upload row
  h+='<div class="tr-detail-actions">';
  h+='<label class="btn btn-s" style="margin:0;cursor:pointer;flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px"><input type="file" accept="image/*" style="display:none" onchange="_trImgUpload('+tid+',this)">📷 '+(t.has_image?'Replace':'Upload')+' image</label>';
  if(t.has_image)h+='<button class="btn btn-s" style="flex:0 0 auto;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_trImgDelete('+tid+')">🗑</button>';
  h+='</div>';
  // Exercise list
  if(!ex.length){
    h+='<div class="emp" style="padding:30px;font-size:13px;color:var(--ht)">No exercises yet. Tap Edit to add some.</div>';
  }else{
    ex.forEach(function(e){
      var img=e.image_url?'<img src="'+es(e.image_url)+'" alt="" onerror="this.remove()">':'';
      var ph=img?'':'<span style="font-size:22px">'+(e.emoji||"💪")+'</span>';
      var rest=e.rest_seconds?Math.round(e.rest_seconds)+'s rest':'';
      h+='<div class="tr-ex-row">'+
        '<div class="tr-ex-img">'+img+ph+'</div>'+
        '<div class="tr-ex-bd"><div class="tr-ex-n">'+es(e.name)+'</div>'+
        '<div class="tr-ex-mt">'+es(e.muscle_group||"")+(rest?' · '+rest:'')+'</div></div>'+
        '</div>';
    });
  }
  h+='<div class="tr-detail-cta">';
  h+='<button class="btn btn-s" style="background:transparent;color:var(--ht);border:1px solid var(--bd);flex:1" onclick="cMo();editTemplate('+tid+')">'+I.ed+' Edit</button>';
  h+='<button class="btn" style="flex:2" onclick="cMo();startFromTemplate('+tid+')">▶ Start workout</button>';
  h+='</div>';
  oMC(t.name||"Workout",h,{ic:"dumbbell"});
}

async function _trImgUpload(tid,input){
  var f=input.files&&input.files[0];if(!f)return;
  if(f.size>15*1024*1024){toast(tr("ts_too_large"));return}
  hp("light");
  f=await _downscaleImage(f);
  var fd=new FormData();fd.append("file",f);
  var headers={};
  if(iD)headers["X-Telegram-Init-Data"]=iD;
  var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
  try{
    var r=await fetch("/api/workout-templates/"+tid+"/image",{method:"POST",headers:headers,body:fd});
    if(!r.ok){toast(tr("ts_upload_failed"));return}
    hp("ok");toast(tr("ts_image_saved"));
    await load();
    cMo();openTemplateDetail(tid);
  }catch(e){toast(tr("ts_network"))}
}
async function _trImgDelete(tid){
  if(!confirm(tr("g_remove_image_confirm")))return;
  var r=await A("DELETE","/api/workout-templates/"+tid+"/image");
  if(!r)return;
  hp("ok");toast(tr("ts_image_removed"));
  await load();
  cMo();openTemplateDetail(tid);
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
function setTrainMember(uid){_trainMember=uid;_trainStats=null;_trainStatsData=null;_trainStatsLoading=false;hp("sel");ren()}

function _workoutCard(w,emphasized){
  var dateLbl=w.date===td()?tr("g_today"):fD(w.date).full;
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
  oMC(tr("mt_start_workout"),h,{ic:"dumbbell"});
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
  oMC(tr("mt_new_template"),_tplEditorHtml(),{ic:"list"});
}
function editTemplate(tid){
  var tpl=(D.workoutTemplates||[]).find(function(x){return x.id===tid});
  if(!tpl)return;
  _tplDraft={id:tid,name:tpl.name,exercise_ids:(tpl.exercises_list||[]).map(function(e){return e.exercise_id})};
  oMC(tr("mt_edit_template"),_tplEditorHtml(),{ic:"list"});
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
  oMC(tr("mt_add_exercise"),h,{ic:"dumbbell"});
}
function _tplAddEx(eid){
  _tplDraft.exercise_ids.push(eid);
  // Re-open editor (cMo + new modal)
  oMC(_tplDraft.id?tr("mt_edit_template"):tr("mt_new_template"),_tplEditorHtml(),{ic:"list"});
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
  var dateLbl=w.date===td()?tr("g_today"):fD(w.date).full;
  var inProgress=w.started_at&&!w.finished_at;
  var h='<div class="cday-overlay">';
  h+='<div class="cday-panel" style="padding-bottom:80px">';
  h+='<div class="cday-hd"><button class="cday-back" onclick="closeWorkout()">←</button>'+
    '<div class="cday-title">💪 '+(w.name?es(w.name):tr("mt_workout"))+'</div>'+
    '<button class="bi" onclick="editWorkoutMeta('+w.id+')" style="padding:4px;color:var(--ht)">'+I.ed+'</button>'+
    '</div>';
  // Live timer (if in progress)
  if(inProgress){
    h+='<div id="wk-timer" style="background:var(--pg);color:var(--pr);padding:8px 16px;text-align:center;font-weight:700;font-size:18px;border-bottom:1px solid var(--bd)">⏱ <span id="wk-elapsed">0:00</span> · '+tr("wx_in_progress")+'</div>';
  }else if(w.finished_at){
    var dur=_durationStr(w.started_at,w.finished_at);
    h+='<div style="background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok);padding:8px 16px;text-align:center;font-weight:700;font-size:14px;border-bottom:1px solid var(--bd)">✓ '+tr("wx_completed")+' · '+dur+'</div>';
  }
  // Summary card
  h+='<div style="padding:8px 16px"><div class="c" style="margin-bottom:8px"><div class="bd">'+
    '<div style="font-size:12px;color:var(--ht)">'+dateLbl+' · '+es(memberName)+'</div>'+
    '<div style="font-size:18px;font-weight:800;color:var(--pr);margin-top:4px">'+_fmtTon(w.tonnage||0)+'</div>'+
    '<div style="font-size:11px;color:var(--ht)">'+(w.exercises||0)+' '+tr("wx_exercises")+' · '+(w.sets||0)+' '+tr("wx_sets")+'</div>'+
    '</div></div></div>';
  // Exercises list
  h+='<div style="padding:0 16px">';
  (w.exercises_list||[]).forEach(function(wx){h+=_exerciseBlock(wx)});
  h+='<button class="btn btn-s" style="margin-top:8px;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="openExercisePicker('+w.id+')">+ '+tr("mt_add_exercise")+'</button>';
  // Finish (if in progress) or Re-open
  if(inProgress){
    h+='<button class="btn" style="margin-top:16px;background:var(--ok);color:#fff" onclick="finishWorkout('+w.id+')">✓ '+tr("wx_finish")+'</button>';
  }else if(w.finished_at){
    h+='<button class="btn btn-s" style="margin-top:16px;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="reopenWorkout('+w.id+')">↺ '+tr("wx_reopen")+'</button>';
  }else{
    // Workout exists but not yet started
    h+='<button class="btn" style="margin-top:16px;background:var(--ok);color:#fff" onclick="startThisWorkout('+w.id+')">▶ '+tr("mt_start_workout")+'</button>';
  }
  // Delete workout button at bottom
  h+='<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--bd)">'+
    '<button class="btn btn-s" style="color:var(--ac);background:transparent;border:1.5px solid var(--bd)" onclick="deleteWorkout('+w.id+')">'+tr("wx_delete_workout")+'</button>'+
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
    prefillHint='<div class="wx-last-hint">'+tr("wx_last_time")+' ('+(fD(wx.last_session.date).date||"")+'): '+wx.last_session.reps+' × '+wx.last_session.weight+' kg</div>';
  }else{
    lastReps=8;lastWeight=0;
  }
  // Big tap-friendly steppers + primary Add Set button (v8.35.0).
  // IDs preserved (set-reps-X / set-weight-X) — addSet() reads them by ID.
  if(prefillHint)h+=prefillHint;
  h+='<div class="wx-stp-wrap">';
  h+='<div class="wx-stp-row"><div class="wx-stp-lbl">'+tr("wx_reps")+'</div>';
  h+='<div class="wx-stp">';
  h+='<button class="wx-stp-b" onclick="_stpAdj(\'set-reps-'+wx.id+'\',-1,1)" aria-label="−1">−</button>';
  h+='<input class="wx-stp-v" type="number" inputmode="numeric" min="1" id="set-reps-'+wx.id+'" value="'+lastReps+'">';
  h+='<button class="wx-stp-b" onclick="_stpAdj(\'set-reps-'+wx.id+'\',1,1)" aria-label="+1">+</button>';
  h+='</div></div>';
  h+='<div class="wx-stp-row"><div class="wx-stp-lbl">'+tr("wx_weight")+'</div>';
  h+='<div class="wx-stp">';
  h+='<button class="wx-stp-b" onclick="_stpAdj(\'set-weight-'+wx.id+'\',-2.5,1)" aria-label="−2.5">−</button>';
  h+='<input class="wx-stp-v" type="number" inputmode="decimal" step="0.5" id="set-weight-'+wx.id+'" value="'+lastWeight+'">';
  h+='<button class="wx-stp-b" onclick="_stpAdj(\'set-weight-'+wx.id+'\',2.5,1)" aria-label="+2.5">+</button>';
  h+='</div><div class="wx-stp-unit">kg</div></div>';
  h+='<button class="wx-stp-add" onclick="addSet('+wx.id+','+(wx.rest_seconds||90)+')">'+tr("wx_add_set")+'</button>';
  h+='</div>';
  h+='</div>';
  return h;
}

// Stepper adjustment helper — clamps reps to >=1, weight to >=0. `decimals`
// determines display precision (1 for weight, 0 for reps). Called from inline
// onclick in the active-workout stepper buttons.
function _stpAdj(inputId, delta, decimals){
  var el=document.getElementById(inputId);if(!el)return;
  var v=parseFloat(el.value)||0;
  v=Math.round((v+delta)*100)/100;
  // Reps must stay positive; weight can be 0
  var isReps=inputId.indexOf("set-reps-")===0;
  if(isReps&&v<1)v=1;
  if(!isReps&&v<0)v=0;
  el.value=decimals?String(v):String(Math.round(v));
  // Subtle haptic on adjust (Telegram WebApp API)
  try{if(window.tg&&tg.HapticFeedback)tg.HapticFeedback.selectionChanged()}catch(e){}
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
  if(!confirm(tr("wx_delete_set_confirm")))return;
  await A("DELETE","/api/workout-sets/"+sid);hp("warn");
  if(_curWorkout)await _refreshWorkoutView(_curWorkout.id);
}

function editSet(sid,wxid,reps,weight,unit){
  oMC(tr("mt_edit_set"),
    '<div class="dr"><div><div class="dl">'+tr("wx_reps")+'</div><input class="inp" id="es-r" type="number" min="1" value="'+reps+'"></div>'+
    '<div><div class="dl">'+tr("wx_weight")+'</div><input class="inp" id="es-w" type="number" step="0.5" value="'+weight+'"></div></div>'+
    '<button class="btn" onclick="svSet('+sid+')">'+tr("btn_save")+'</button>',{ic:"dumbbell"});
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
  oMC(tr("mt_edit_workout"),
    '<div class="lb">Name</div><input class="inp" id="ew-n" value="'+es(w.name||"")+'" placeholder="e.g. Push Day">'+
    '<div class="lb">'+tr("f_date")+'</div><input type="date" id="ew-d" value="'+w.date+'">'+
    '<div class="lb">Notes</div><input class="inp" id="ew-notes" value="'+es(w.notes||"")+'">'+
    '<button class="btn" onclick="svWorkoutMeta('+wid+')">Save</button>',{ic:"dumbbell"});
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
  oMC(tr("mt_add_exercise"),h,{ic:"dumbbell"});
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
  oMC(tr("mt_new_exercise"),
    '<div class="lb">Name</div><input class="inp" id="ne-n" placeholder="e.g. Lateral Raise">'+
    '<div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="ne-e" value="💪" style="text-align:center;font-size:20px"></div>'+
    '<div><div class="dl">Muscle</div><select id="ne-mg" class="inp"><option value="chest">Chest</option><option value="back">Back</option><option value="legs">Legs</option><option value="shoulders">Shoulders</option><option value="arms">Arms</option><option value="core">Core</option><option value="other">Other</option></select></div></div>'+
    '<div class="lb">Image URL <span style="color:var(--ht);font-weight:400;font-size:11px">(optional)</span></div><input class="inp" id="ne-img" placeholder="https://...">'+
    '<div class="dr"><div><div class="dl">Rest (sec)</div><input class="inp" id="ne-rs" type="number" value="90" min="0"></div></div>'+
    '<button class="btn" onclick="svNewExercise('+wid+')">Create & add</button>',{ic:"dumbbell"});
}
async function svNewExercise(wid){
  var n=document.getElementById("ne-n").value.trim();if(!n)return;
  var emoji=document.getElementById("ne-e").value.trim()||"💪";
  var mg=document.getElementById("ne-mg").value;
  var img=document.getElementById("ne-img").value.trim()||null;
  var rs=parseInt(document.getElementById("ne-rs").value)||90;
  var r=await A("POST","/api/exercises",{name:n,emoji:emoji,muscle_group:mg,image_url:img,rest_seconds:rs});
  if(!r||!r.id){toast(tr("ts_failed"));return}
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
      el.innerHTML='<span>✓ '+tr("wx_rest_done")+'</span><button onclick="_clearRestTimer()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:4px 12px;border-radius:8px;cursor:pointer;font-weight:700">×</button>';
      hp("ok");
      setTimeout(_clearRestTimer,3000);
      return;
    }
    var mm=Math.floor(remaining/60),ss=remaining%60;
    var time=mm+":"+String(ss).padStart(2,"0");
    el.innerHTML='<span>⏱ '+tr("wx_rest")+': '+time+'</span><button onclick="_clearRestTimer()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:4px 12px;border-radius:8px;cursor:pointer;font-weight:700">'+tr("wx_skip")+'</button>';
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
  oMC(tr("mt_progress"),h,{ic:"chart"});
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
