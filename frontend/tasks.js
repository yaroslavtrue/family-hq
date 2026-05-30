// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Tasks + Events (extracted from app.js in v8.44.0)
// ═══════════════════════════════════════════════════════════════
// Tasks tab with 3 sub-tabs: Active / Recurring / Events. Events is
// also reachable from the hamburger menu as its own page — shared rEvts.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads: D, tr(), A(), hp(), toast(), es(), icon(), oMC(), cMo(), ren(),
// load(), mChip(), assignPk(), em(), remPk(), matchQ(), fD(), _assign,
// _pri, _rems, _calEditCb, searchQ.

var taskTab = "active";


// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════
function rT(){var h='<div class="tabs"><button class="tab '+(taskTab==="active"?"a":"")+'" onclick="taskTabSet(\'active\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("clipboard",13,2.2)+tr("g_active")+'</span></button><button class="tab '+(taskTab==="recurring"?"a":"")+'" onclick="taskTabSet(\'recurring\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("refresh",13,2.2)+tr("g_recurring")+'</span></button><button class="tab '+(taskTab==="events"?"a":"")+'" onclick="taskTabSet(\'events\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("clock",13,2.2)+tr("g_events")+'</span></button></div>';
if(taskTab==="recurring")return h+rRecur();
if(taskTab==="events")return h+rEvts();
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">'+tr("g_filter_all")+'</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';
var all=D.tasks;if(filt)all=all.filter(function(x){return x.assigned_to===filt});
if(searchQ)all=all.filter(function(x){return matchQ(x.text)});
var pend=all.filter(function(x){return!x.done}),done=all.filter(function(x){return x.done});
if(!all.length)return h+em(icon("clipboard",48,1.8),tr("es_no_tasks_t"),tr("es_no_tasks_s"));
// Group pending tasks into sections
var todayStr=td();var _7d=new Date();_7d.setDate(_7d.getDate()+7);var weekStr=_7d.getFullYear()+"-"+String(_7d.getMonth()+1).padStart(2,"0")+"-"+String(_7d.getDate()).padStart(2,"0");
var overdue=[],high=[],week=[],rest=[];
pend.forEach(function(t){var dd=(t.due_date||"").split(" ")[0];if(dd&&dd<todayStr){overdue.push(t)}else if(t.priority==="high"){high.push(t)}else if(dd&&dd<=weekStr){week.push(t)}else{rest.push(t)}});
// v8.49.7: sort each group chronologically (nearest date on top, undated last).
// API can return tasks in arbitrary order; in-page sort makes the strip read
// like a real to-do list — today's tasks above tomorrow's above next week's.
function _tkSortByDate(a,b){
  var da=(a.due_date||"").split(" ")[0],db=(b.due_date||"").split(" ")[0];
  if(!da&&!db)return (a.id||0)-(b.id||0);   // stable fallback for equal undated rows
  if(!da)return 1; if(!db)return -1;        // undated sinks to the bottom of its bucket
  return da<db?-1:da>db?1:(a.id||0)-(b.id||0);
}
overdue.sort(_tkSortByDate);
high.sort(_tkSortByDate);
week.sort(_tkSortByDate);
rest.sort(_tkSortByDate);
function _tkCard(tk,overdueDate){var rmC=tk.reminders&&tk.reminders.length?'<span class="pdate">'+icon("bl",10,2)+tk.reminders.length+'</span>':"";
var priLabel=tk.priority==="high"?tr("p_high"):tk.priority==="low"?tr("p_low"):tr("p_normal");
var priCls=tk.priority==="high"?"hi":tk.priority==="low"?"lo":"md";
var priPill='<span class="ppri '+priCls+'">'+icon("fl",10,2.4)+priLabel+'</span>';
var dateTone=overdueDate?"tone-ac":"";
var datePill=tk.due_date?'<span class="pdate '+dateTone+'">'+icon("calendar",10,2.2)+fD(tk.due_date).full+'</span>':"";
return '<div style="margin-bottom:10px"><div class="c" style="margin-bottom:0"><div class="cb cb-o" onclick="tgTk('+tk.id+',this)"></div><div class="bd"><div class="tt">'+es(tk.text)+'</div><div class="mt">'+mChip(tk.assigned_to,true)+" "+priPill+" "+datePill+" "+rmC+" "+sC("task",tk.id)+' <button class="xb" onclick="tX(\'task\','+tk.id+')">'+(ex["task_"+tk.id]?"▾":"▸")+'</button></div></div><button class="bi" onclick="edTk('+tk.id+')">'+I.ed+'</button><button class="bi" onclick="dlTk('+tk.id+')">'+I.tr+'</button></div>'+rSu("task",tk.id)+'</div>'}
function _scH(ico,label,cnt,color){var iconHtml=ico?'<span class="sc-ico"'+(color?' style="color:'+color+'"':'')+'>'+icon(ico,12,2.4)+'</span>':'';return '<div class="sc"'+(color?' style="color:'+color+'"':'')+'><span class="sc-l">'+iconHtml+label+'<span class="sc-cnt"'+(color?' style="background:color-mix(in srgb,'+color+' 16%,transparent);color:'+color+'"':'')+'>'+cnt+'</span></span></div>'}
if(overdue.length){h+=_scH("dot",tr("tk_overdue"),overdue.length,"var(--ac)");overdue.forEach(function(tk){h+=_tkCard(tk,true)})}
if(high.length){h+=_scH("bolt",tr("tk_high_pri"),high.length,"var(--wn)");high.forEach(function(tk){h+=_tkCard(tk)})}
if(week.length){h+=_scH("calendar",tr("tk_this_week"),week.length);week.forEach(function(tk){h+=_tkCard(tk)})}
if(rest.length){h+=_scH("list",tr("tk_rest"),rest.length);rest.forEach(function(tk){h+=_tkCard(tk)})}
if(!pend.length)h+='<div style="text-align:center;padding:20px;color:var(--ht);font-size:13px">'+tr("tk_caught_up")+'</div>';
if(done.length){h+=_scH("ck",tr("g_done"),done.length,"var(--ok)");done.forEach(function(tk){h+='<div class="c d"><div class="cb cb-k" onclick="tgTk('+tk.id+',this)">'+I.ck+'</div><div class="bd"><div class="tt sk">'+es(tk.text)+'</div></div><button class="bi" onclick="dlTk('+tk.id+')">'+I.tr+'</button></div>'})}
return h}
function rRecur(){if(!D.recurring.length)return em(icon("refresh",48,1.8),tr("tk_no_recur_t"),tr("tk_no_recur_s"));var h='';D.recurring.forEach(function(r){if(searchQ&&!matchQ(r.text))return;var rrDesc=r.rrule==="daily"?tr("g_every_day"):r.rrule.startsWith("weekly:")?tr("g_weekly")+": "+r.rrule.split(":")[1]:tr("g_monthly")+": "+r.rrule.split(":")[1];var pausedPill=r.active?'':' <span class="pdate tone-ac">'+tr("g_paused")+'</span>';h+='<div class="c"><div class="bd"><div class="tt">'+es(r.text)+'</div><div class="mt">'+mChip(r.assigned_to,true)+' <span class="pdate" style="background:color-mix(in srgb,var(--pr) 14%,transparent);color:var(--pr)">'+icon("refresh",10,2.2)+rrDesc+'</span>'+pausedPill+'</div></div><button class="bi" onclick="edRec('+r.id+')">'+I.ed+'</button><button class="bi" onclick="dlRec('+r.id+')">'+I.tr+'</button></div>'});return h}

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
async function dlTk(id){var tk=D.tasks.find(function(x){return x.id===id});hp("warn");await A("DELETE","/api/tasks/"+id);await load();if(tk)toast("🗑 "+tr("ts_deleted"),function(){A("POST","/api/tasks",{text:tk.text,assigned_to:tk.assigned_to,priority:tk.priority,due_date:tk.due_date}).then(load)})}
async function dlRec(id){hp();await A("DELETE","/api/recurring/"+id);await load();toast("🗑 "+tr("ts_deleted"))}
function edTk(id){var tk=D.tasks.find(function(x){return x.id===id});if(!tk)return;_assign=tk.assigned_to||0;_pri=tk.priority;_rems=(tk.reminders||[]).map(function(r){return r.remind_at});oMC(tr("mt_edit_task"),'<input class="inp" id="f-t" value="'+es(tk.text)+'"><div class="lb">'+tr("g_assign_to")+'</div>'+assignPk("ap",tk.assigned_to)+'<div class="lb">'+tr("f_priority")+'</div><div class="or">'+["low","normal","high"].map(function(p){return '<button class="ob ob-pri-'+p+' '+(tk.priority===p?"s":"")+'" onclick="_pri=\''+p+'\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+tr("p_"+p)+'</button>'}).join("")+'</div><div class="lb">'+tr("g_due_date")+'</div><div class="dr"><div><input type="date" id="f-dd" value="'+(tk.due_date?(tk.due_date.split(" ")[0]):"")+'"></div></div><div class="lb">'+tr("g_reminders")+'</div><div id="rw">'+remPk()+'</div><button class="btn" onclick="svTk('+id+')">'+tr("btn_save")+'</button>',{ic:"clipboard"})}
async function svTk(id){var text=document.getElementById("f-t").value.trim();if(!text)return;var dd=document.getElementById("f-dd")?document.getElementById("f-dd").value:null;await A("PUT","/api/tasks/"+id,{text:text,assigned_to:_assign||null,priority:_pri,due_date:dd||null,reminders:_rems});cMo();hp();await load();if(_calEditCb){var cb=_calEditCb;_calEditCb=null;cb()}}
function edRec(id){var r=D.recurring.find(function(x){return x.id===id});if(!r)return;_assign=r.assigned_to||0;oMC(tr("tk_edit_recur"),'<input class="inp" id="f-t" value="'+es(r.text)+'"><div class="lb">'+tr("g_assign_to")+'</div>'+assignPk("ap",r.assigned_to)+'<div class="lb">'+tr("g_schedule")+'</div><div class="or"><button class="ob '+(r.rrule==="daily"?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'daily\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.add(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">'+tr("g_daily")+'</button><button class="ob '+(r.rrule.startsWith("weekly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'weekly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'wd\').classList.remove(\'hidden\');document.getElementById(\'md\').classList.add(\'hidden\')">'+tr("g_weekly")+'</button><button class="ob '+(r.rrule.startsWith("monthly")?"s":"")+'" onclick="document.getElementById(\'rr\').value=\'monthly:\';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\');document.getElementById(\'md\').classList.remove(\'hidden\');document.getElementById(\'wd\').classList.add(\'hidden\')">'+tr("g_monthly")+'</button></div><input type="hidden" id="rr" value="'+r.rrule+'"><div id="wd" class="'+(r.rrule.startsWith("weekly")?"":"hidden")+'"><div class="lb">'+tr("g_days")+'</div><div class="or">'+["mon","tue","wed","thu","fri","sat","sun"].map(function(d){return '<button class="ob '+(r.rrule.indexOf(d)>=0?"s":"")+'" onclick="this.classList.toggle(\'s\')">'+d+'</button>'}).join("")+'</div></div><div id="md" class="'+(r.rrule.startsWith("monthly")?"":"hidden")+'"><div class="lb">'+tr("g_day_of_month")+'</div><input class="inp" id="f-md" type="number" min="1" max="28" value="'+(r.rrule.startsWith("monthly:")?r.rrule.split(":")[1]:"1")+'"></div><div class="lb">'+tr("tk_status")+'</div><div class="or"><button class="ob '+(r.active?"s":"")+'" onclick="_recActive=1;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+tr("tk_active")+'</button><button class="ob '+(!r.active?"s":"")+'" onclick="_recActive=0;this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+tr("tk_paused")+'</button></div><button class="btn" onclick="svRec('+id+')">'+tr("btn_save")+'</button>',{ic:"refresh"});window._recActive=r.active}


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
// Countdown pill for an event row. Returns {text, cls} or null if dates are missing.
//   Future:  "Today" / "Tomorrow" / "in N days" / "in N weeks" / "in ~N months" / "in N years"
//   Ongoing: "Day X of N" (only for multi-day events)
//   Past:    "yesterday" / "N days ago" / "N weeks ago" / "N months ago" / "N years ago" (muted)
function _evtCountdown(ev, todayStr){
  var s=(ev.event_date||"").split(" ")[0]; if(!s) return null;
  var e=(ev.end_date||s).split(" ")[0];
  var sDate=new Date(s+"T00:00:00");
  var eDate=new Date(e+"T00:00:00");
  var today=new Date(todayStr+"T00:00:00");
  if(isNaN(sDate)||isNaN(today)) return null;
  var DAY=86400000;
  // Ongoing multi-day event
  if(sDate<=today && today<=eDate && s!==e){
    var total=Math.round((eDate-sDate)/DAY)+1;
    var cur=Math.round((today-sDate)/DAY)+1;
    return {text:"Day "+cur+" of "+total, cls:"evt-cd-now"};
  }
  var diff=Math.round((sDate-today)/DAY);
  if(diff===0) return {text:"Today", cls:"evt-cd-now"};
  if(diff===1) return {text:"Tomorrow", cls:"evt-cd-soon"};
  if(diff===-1) return {text:"yesterday", cls:"evt-cd-past"};
  function _humanize(d){
    if(d<7) return d+" days";
    if(d<30) return Math.round(d/7)+" week"+(Math.round(d/7)>1?"s":"");
    if(d<365) return "~"+Math.round(d/30)+" months";
    return "~"+Math.round(d/365)+" year"+(Math.round(d/365)>1?"s":"");
  }
  if(diff>0){
    var cls = diff<=7?"evt-cd-soon":(diff<=30?"evt-cd-far":"evt-cd-fafar");
    return {text:"in "+_humanize(diff), cls:cls};
  }
  // diff < -1
  return {text:_humanize(Math.abs(diff))+" ago", cls:"evt-cd-past"};
}

function rEvts(){
if(!D.events.length)return em(icon("clock",48,1.8),tr("es_no_events_t"),tr("es_no_events_s"))+rEvtAddBtn();
var evts=D.events;if(searchQ)evts=evts.filter(function(e){return matchQ(e.text)});
if(!evts.length)return rEvtAddBtn()+em(icon("clock",48,1.8),tr("es_no_match_t"),tr("es_no_match_s"));
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
  var cd=_evtCountdown(ev,todayStr);
  h+='<div class="'+rowCls+'" data-evt-id="'+ev.id+'">';
  h+='<div class="evt-dot" style="background:'+c+'"></div>';
  h+='<div class="c evt-card">';
  h+='<div class="bd"><div class="evt-tt-row"><div class="tt" style="font-weight:600;flex:1;min-width:0">'+es(ev.text)+'</div>'+(cd?'<span class="evt-cd '+cd.cls+'">'+cd.text+'</span>':'')+'</div>';
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
function rEvtAddBtn(){return '<button class="btn btn-s" style="margin:3px 0 16px" onclick="oMoEvt()">+ '+tr("mt_add_event")+'</button>'}
async function dEv(id){hp();await A("DELETE","/api/events/"+id);await load();toast("🗑 "+tr("ts_deleted"))}
