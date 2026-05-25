// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Plants tab (extracted from app.js in v8.41.0)
// ═══════════════════════════════════════════════════════════════
// Family-shared plant care: avatar carousel, watering log + history graph,
// AI species ID on photo upload, growth-timeline photos.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from earlier modules: D, fS, tr(), trn(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), ren(), _downscaleImage(), iD, mAv().
// ─── Plants — family-shared plant care with AI species identification ─────
var _plState={selectedId:null,histCache:{},photosCache:{}}; // histCache[plant_id] = {dates,water_days,count,avg_interval_days,target_interval_days}; photosCache[plant_id] = [{id,caption,taken_at,url}]
// Speech-bubble phrase bank, keyed to watering status. Selection is deterministic by
// (plant.id + day-of-year) so the phrase stays stable for a whole day instead of
// flickering on every re-render.
var PLANT_VOICE={
  thirsty:["I'm getting thirsty 💧","The soil's so dry...","A drink would be lovely","Please don't forget me","I could really use some water"],
  soon:["Could use a drink soon...","Almost time for water","Save me a sip for tomorrow"],
  ok:["Feeling great! ✨","Growing well 🌱","Thanks for the care","Loving the light here","All good — keep it up!"]
};
function _plVoice(p){
  // Per-plant override wins. voice_overrides may have any subset of {ok,soon,thirsty}.
  if(p.voice_overrides&&p.voice_overrides[p.status]){
    return p.voice_overrides[p.status];
  }
  var arr=PLANT_VOICE[p.status]||PLANT_VOICE.ok;
  var today=Math.floor(Date.now()/86400000);
  return arr[(Math.abs((p.id||0)+today))%arr.length];
}
function _plDate(iso){
  if(!iso)return"";
  try{var d=new Date(iso);var diff=Math.round((Date.now()-d.getTime())/86400000);
    if(diff===0)return"today";if(diff===1)return"yesterday";if(diff<7)return diff+" days ago";
    return d.toLocaleDateString();
  }catch(e){return""}
}
function _plStatusLabel(s){return s==="thirsty"?tr("pl_thirsty"):(s==="soon"?tr("pl_soon"):tr("pl_healthy"))}
function _plStatusColor(s){return s==="thirsty"?"var(--ac)":(s==="soon"?"var(--wn)":"var(--ok)")}

function _rPlantsWidget(){
  var list=D.plants||[];
  if(!list.length)return"";
  var thirstyN=list.filter(function(p){return p.status==="thirsty"}).length;
  var head='Plants';
  var subHead=thirstyN?'<span class="hpw-sub">'+thirstyN+(thirstyN===1?" wants":" want")+' water</span>':'';
  var h='<div class="sc"><span class="sc-l">'+head+subHead+'<span class="sc-cnt">'+list.length+'</span></span></div>';
  h+='<div class="hpw" onclick="go(\'plants\')">';
  h+='<div class="hpw-track">';
  list.forEach(function(p){
    var img=p.has_image?'<img src="/static/plants/'+p.id+'.jpg?t='+(p.last_watered?Date.parse(p.last_watered)||"":"x")+'" alt="" onerror="this.remove()">':'';
    var ph=img?"":'<span class="hpw-ph">🪴</span>';
    var dotColor=_plStatusColor(p.status);
    var statusLbl=_plStatusLabel(p.status);
    h+='<div class="hpw-item" onclick="event.stopPropagation();_plState.selectedId='+p.id+';go(\'plants\')">';
    h+='<div class="hpw-av">'+img+ph+'<span class="hpw-dot" style="background:'+dotColor+'"></span></div>';
    h+='<div class="hpw-name">'+es(p.custom_name||p.species||"Plant")+'</div>';
    h+='<div class="hpw-status" style="color:'+dotColor+'">'+statusLbl+'</div>';
    h+='</div>';
  });
  h+='</div></div>';
  return h;
}

function rPlants(){
  var list=D.plants||[];
  var thirstyN=list.filter(function(p){return p.status==="thirsty"}).length;
  // Auto-select first plant on first render
  if(!_plState.selectedId&&list.length)_plState.selectedId=list[0].id;
  var cur=list.find(function(p){return p.id===_plState.selectedId});
  var h='<div class="pl-wrap">';
  // ─── Avatar carousel ─────────────────────────────
  h+='<div class="pl-avatars">';
  h+='<button class="pl-av pl-av-add" onclick="_plOpenAdd()" aria-label="Add plant"><div class="pl-av-pic pl-av-plus">'+icon("pl",22,2.5)+'</div><div class="pl-av-l">'+tr("pl_add")+'</div></button>';
  list.forEach(function(p){
    var sel=(p.id===_plState.selectedId)?"s":"";
    var img=p.has_image?'<img src="/static/plants/'+p.id+'.jpg?t='+(p.last_watered?Date.parse(p.last_watered)||"":"x")+'" alt="" onerror="this.remove()">':'';
    var ph=img?"":'<span class="pl-av-ph">🪴</span>';
    h+='<button class="pl-av '+sel+'" onclick="_plSelect('+p.id+')"><div class="pl-av-pic">'+img+ph+'<span class="pl-av-dot" style="background:'+_plStatusColor(p.status)+'"></span></div><div class="pl-av-l">'+es(p.custom_name||p.species||"Plant")+'</div></button>';
  });
  h+='</div>';
  // ─── Main card ────────────────────────────────────
  if(!cur){
    h+='<div class="emp" style="padding:50px 14px"><div class="emp-i" style="font-size:46px">🪴</div><div class="emp-t">'+tr("pl_no_plants_t")+'</div><div style="font-size:13px;color:var(--ht);margin-top:6px">'+tr("pl_no_plants_s")+'</div></div>';
  }else{
    var imgUrl=cur.has_image?'/static/plants/'+cur.id+'.jpg?t='+(cur.last_watered?Date.parse(cur.last_watered)||"":"x"):'';
    h+='<div class="pl-card">';
    h+='<div class="pl-card-bg" style="'+(imgUrl?'background-image:url(\''+imgUrl+'\')':'')+'"></div>';
    if(!imgUrl)h+='<div class="pl-card-noimg">🪴</div>';
    h+='<div class="pl-card-over">';
    h+='<div class="pl-card-top">';
    h+='<div class="pl-card-titles"><div class="pl-card-name"><span>'+es(cur.custom_name||cur.species||"Plant")+'</span><button class="bi" onclick="_plOpenEdit('+cur.id+')" aria-label="Edit" style="color:#fff;opacity:.8">'+I.ed+'</button></div><div class="pl-card-sub">'+es(cur.latin_name||cur.species||"")+'</div></div>';
    h+='<div class="pl-pill" style="background:'+_plStatusColor(cur.status)+'"><span class="pl-pill-dot"></span>'+_plStatusLabel(cur.status)+'</div>';
    h+='</div>';
    // Speech bubble (text only — no mascot)
    h+='<div class="pl-bubble"><span>'+es(_plVoice(cur))+'</span></div>';
    // Actions — Water (primary, once per day) toggles to "Thank you!" after pressing.
    // Re-tapping undoes (in case of accidental press).
    h+='<div class="pl-actions">';
    if(cur.watered_today){
      h+='<button class="pl-btn pl-btn-thanks" onclick="_plWater('+cur.id+')" title="Tap to undo">💚 '+tr("pl_thanks")+'</button>';
    }else{
      h+='<button class="pl-btn pl-btn-primary" onclick="_plWater('+cur.id+')">💧 '+tr("pl_water")+'</button>';
    }
    h+='<button class="pl-btn pl-btn-more" onclick="_plMoreMenu('+cur.id+')" aria-label="More">⋯</button>';
    h+='</div>';
    h+='</div></div>';
    // ─── Inline tips section (replaces the old Tips modal) ─────
    h+=_rPlantInlineTips(cur);
  }
  // ─── Summary ──────────────────────────────────────
  if(list.length){
    h+='<div class="pl-sum">';
    h+='<div class="pl-sum-h">📊 Today</div>';
    if(thirstyN){h+='<div class="pl-sum-row"><span style="color:'+_plStatusColor("thirsty")+'">🪴 '+thirstyN+(thirstyN===1?" plant wants":" plants want")+' water</span></div>'}
    else{h+='<div class="pl-sum-row"><span style="color:var(--ok)">✓ All plants happy</span></div>'}
    if(cur&&cur.last_watered)h+='<div class="pl-sum-row" style="color:var(--ht);font-size:12px">Last watered '+es(cur.custom_name||cur.species||"plant")+': '+_plDate(cur.last_watered)+'</div>';
    h+='</div>';
  }
  h+='</div>';
  // Attach swipe gesture after render + load history if needed
  setTimeout(function(){
    _plAttachSwipe();
    if(cur&&!_plState.histCache[cur.id])_plLoadHistory(cur.id);
    if(cur&&!_plState.photosCache[cur.id])_plLoadPhotos(cur.id);
  },80);
  return h;
}

// Inline care section under the main card — replaces the old Tips modal.
function _rPlantInlineTips(cur){
  var hist=_plState.histCache[cur.id];
  var h='<div class="pl-inline">';
  // Header
  h+='<div class="pl-inline-h">'+tr("pl_care_for")+' <strong>'+es(cur.custom_name||cur.species||"plant")+'</strong></div>';
  // Meta row
  h+='<div class="pl-adv-meta" style="margin-bottom:12px">';
  h+='<div class="pl-adv-cell"><div class="pl-adv-cell-l">'+tr("pl_water_every")+'</div><div class="pl-adv-cell-v">'+(cur.water_interval_days||7)+' '+tr("pl_days_unit")+'</div></div>';
  if(cur.light)h+='<div class="pl-adv-cell"><div class="pl-adv-cell-l">'+tr("pl_light")+'</div><div class="pl-adv-cell-v">'+es(cur.light)+'</div></div>';
  h+='</div>';
  // History graph
  h+='<div class="lb" style="margin-top:4px">Watering — last 30 days</div>';
  if(hist){
    h+=_plHistHtml(hist,cur);
  }else{
    h+='<div class="pl-hist-host"><div class="emp" style="padding:10px;font-size:11px;color:var(--ht)">Loading history…</div></div>';
  }
  // Growth timeline — newest first horizontal scroll
  h+='<div class="lb" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between"><span>'+tr("pl_growth_timeline")+'</span><span style="font-size:10px;color:var(--ht);font-weight:600;letter-spacing:.3px;text-transform:uppercase">'+((_plState.photosCache[cur.id]||[]).length)+'</span></div>';
  h+=_plPhotoStripHtml(cur);
  // Tips list
  if(cur.care_tips&&cur.care_tips.length){
    h+='<div class="lb" style="margin-top:14px">'+tr("pl_care_tips")+'</div>';
    cur.care_tips.forEach(function(t){h+='<div class="pl-tip">• '+es(t)+'</div>'});
  }
  if(cur.last_watered)h+='<div style="font-size:11px;color:var(--ht);margin-top:12px;text-align:center">Last watered '+_plDate(cur.last_watered)+'</div>';
  h+='</div>';
  return h;
}

function _plPhotoStripHtml(cur){
  var photos=_plState.photosCache[cur.id];
  if(photos===undefined){
    return '<div class="pl-ph-strip"><button class="pl-ph-add" onclick="_plPhotoPick('+cur.id+')"><span style="font-size:22px;line-height:1">🩺</span><span style="font-size:10px;margin-top:4px;font-weight:600">'+tr("pl_update")+'</span></button><div class="emp" style="padding:14px 8px;font-size:11px;color:var(--ht);flex:1">'+tr("g_loading")+'</div></div>';
  }
  var h='<div class="pl-ph-strip">';
  h+='<button class="pl-ph-add" onclick="_plPhotoPick('+cur.id+')"><span style="font-size:22px;line-height:1">🩺</span><span style="font-size:10px;margin-top:4px;font-weight:600">'+tr("pl_update")+'</span></button>';
  if(!photos.length){
    h+='<div class="pl-ph-empty">No timeline photos yet. Snap one to track growth over time.</div>';
  }else{
    photos.forEach(function(p){
      var d=p.taken_at?new Date(p.taken_at):null;
      var dlbl=d?(d.getDate()+' '+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?" '"+String(d.getFullYear()).slice(-2):"")):"";
      h+='<button class="pl-ph-thumb" onclick="_plPhotoView('+p.id+','+cur.id+')"><img src="/static/plants/timeline/'+p.id+'.jpg" alt="" loading="lazy"><span class="pl-ph-date">'+es(dlbl)+'</span></button>';
    });
  }
  h+='</div>';
  return h;
}

async function _plLoadPhotos(pid){
  if(_plState.photosCache[pid]!==undefined)return;
  _plState.photosCache[pid]=null;
  var d=await A("GET","/api/plants/"+pid+"/photos");
  if(!d){delete _plState.photosCache[pid];return}
  _plState.photosCache[pid]=d.photos||[];
  if(tab==="plants"&&_plState.selectedId===pid)ren();
}

// "Update" flow (v8.46.0): take a photo → upload to timeline + Sonnet vision
// health check → show result modal with status pill + issues + advice.
// Same input element pattern as before — just no caption prompt and an
// analyze=1 form flag that triggers the AI assessment on the backend.
function _plPhotoPick(pid){
  hp("light");
  var input=document.createElement("input");
  input.type="file";input.accept="image/*";input.capture="environment";
  input.onchange=async function(){
    var f=input.files&&input.files[0];if(!f)return;
    if(f.size>15*1024*1024){toast(tr("ts_too_large"));return}
    f=await _downscaleImage(f);
    var fd=new FormData();
    fd.append("file",f);
    fd.append("caption","");           // no caption prompt — "Update" is photo-only
    fd.append("analyze","1");          // request Sonnet health check
    var headers={};
    if(iD)headers["X-Telegram-Init-Data"]=iD;
    var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
    // Show a non-blocking "Analyzing…" toast — Sonnet round-trip is ~3-6s.
    toast(tr("pl_analyzing"));
    try{
      var r=await fetch("/api/plants/"+pid+"/photos",{method:"POST",headers:headers,body:fd});
      if(!r.ok){toast(tr("ts_upload_failed"));return}
      var p=await r.json();
      hp("ok");
      // Prepend to local cache (newest first)
      var arr=_plState.photosCache[pid]||[];
      arr.unshift(p);
      _plState.photosCache[pid]=arr;
      ren();
      // Show health modal if Sonnet returned an assessment; otherwise just toast.
      if(p.ai_analysis){
        _plShowHealthModal(p.ai_analysis, pid);
      } else {
        toast(tr("ts_photo_added"));
      }
    }catch(e){toast(tr("ts_network"))}
  };
  input.click();
}

// Show Sonnet's health assessment in a modal (status pill + summary + issues + advice).
// Reused by _plPhotoView when tapping a historical photo that has stored ai_analysis.
function _plShowHealthModal(a, pid){
  if(!a||!a.status)return;
  var statusInfo = {
    healthy:  {emoji:"🟢", color:"var(--ok)", label:tr("pl_h_healthy")},
    concern:  {emoji:"🟡", color:"var(--wn)", label:tr("pl_h_concern")},
    critical: {emoji:"🔴", color:"var(--ac)", label:tr("pl_h_critical")}
  }[a.status] || {emoji:"🟢", color:"var(--ok)", label:a.status};
  var h='<div class="pl-h-pill" style="background:color-mix(in srgb,'+statusInfo.color+' 14%,transparent);color:'+statusInfo.color+';border:1px solid color-mix(in srgb,'+statusInfo.color+' 40%,transparent)">'+statusInfo.emoji+' '+statusInfo.label+'</div>';
  if(a.summary)h+='<div class="pl-h-summary">'+es(a.summary)+'</div>';
  if(a.issues&&a.issues.length){
    h+='<div class="lb" style="margin-top:14px">'+tr("pl_h_issues")+'</div>';
    a.issues.forEach(function(item){h+='<div class="pl-h-row">⚠️ '+es(item)+'</div>'});
  }
  if(a.advice&&a.advice.length){
    h+='<div class="lb" style="margin-top:14px">'+tr("pl_h_advice")+'</div>';
    a.advice.forEach(function(item){h+='<div class="pl-h-row pl-h-row-ok">💡 '+es(item)+'</div>'});
  }
  if((!a.issues||!a.issues.length)&&(!a.advice||!a.advice.length)&&a.status==="healthy"){
    h+='<div style="text-align:center;color:var(--ht);font-size:13px;margin-top:14px">'+tr("pl_h_no_issues")+'</div>';
  }
  oMC(tr("pl_h_title"),h,{ic:"flower"});
}

// Full-screen photo view modal — delete button + caption edit
function _plPhotoView(photoId, plantId){
  hp("light");
  var photos=_plState.photosCache[plantId]||[];
  var p=photos.find(function(x){return x.id===photoId});
  if(!p)return;
  var d=p.taken_at?new Date(p.taken_at):null;
  var dlbl=d?d.toLocaleString("en-US",{day:"numeric",month:"long",year:"numeric"}):"";
  var h='<div class="pl-pview"><img src="/static/plants/timeline/'+p.id+'.jpg" alt=""></div>';
  h+='<div class="lb" style="margin-top:14px">'+tr("pl_caption")+'</div>';
  h+='<input class="inp" id="plv-cap" value="'+es(p.caption||"")+'" placeholder="(optional)" maxlength="120">';
  if(dlbl)h+='<div style="text-align:center;font-size:12px;color:var(--ht);margin-top:10px">📅 '+es(dlbl)+'</div>';
  // If this photo has a stored AI health check, offer to view it
  if(p.ai_analysis&&p.ai_analysis.status){
    var sCol = p.ai_analysis.status==="critical" ? "var(--ac)" : (p.ai_analysis.status==="concern" ? "var(--wn)" : "var(--ok)");
    var sEmoji = p.ai_analysis.status==="critical" ? "🔴" : (p.ai_analysis.status==="concern" ? "🟡" : "🟢");
    h+='<button class="btn btn-s" style="width:100%;margin-top:10px;background:color-mix(in srgb,'+sCol+' 12%,transparent);color:'+sCol+';border:1px solid color-mix(in srgb,'+sCol+' 35%,transparent)" onclick="_plShowHealthModal(_plState.photosCache['+plantId+'].find(function(x){return x.id==='+p.id+'}).ai_analysis,'+plantId+')">'+sEmoji+' '+tr("pl_h_view")+'</button>';
  }
  h+='<div style="display:flex;gap:8px;margin-top:18px">';
  h+='<button class="btn btn-s" style="flex:1;background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_plPhotoDelete('+p.id+','+plantId+')">🗑 '+tr("btn_delete")+'</button>';
  h+='<button class="btn" style="flex:1.5" onclick="_plPhotoSaveCaption('+p.id+','+plantId+')">'+tr("btn_save")+'</button>';
  h+='</div>';
  oMC(tr("mt_photo"),h,{ic:"flower"});
}

async function _plPhotoSaveCaption(photoId, plantId){
  var cap=(document.getElementById("plv-cap")||{}).value||"";
  var fd=new FormData();fd.append("caption",cap.trim());
  var headers={};
  if(iD)headers["X-Telegram-Init-Data"]=iD;
  var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
  try{
    var r=await fetch("/api/plants/photos/"+photoId,{method:"PATCH",headers:headers,body:fd});
    if(!r.ok){toast(tr("ts_save_failed"));return}
    // Update in cache
    var arr=_plState.photosCache[plantId]||[];
    var ph=arr.find(function(x){return x.id===photoId});
    if(ph)ph.caption=cap.trim();
    cMo();hp("ok");toast(tr("ts_caption_saved"));ren();
  }catch(e){toast(tr("ts_network"))}
}

async function _plPhotoDelete(photoId, plantId){
  if(!confirm(tr("pl_delete_photo_confirm")))return;
  var r=await A("DELETE","/api/plants/photos/"+photoId);
  if(!r)return;
  _plState.photosCache[plantId]=(_plState.photosCache[plantId]||[]).filter(function(x){return x.id!==photoId});
  cMo();hp("ok");toast(tr("ts_photo_deleted"));ren();
}

async function _plLoadHistory(pid){
  var d=await A("GET","/api/plants/"+pid+"/history?days=30");
  if(!d||!d.dates)return;
  _plState.histCache[pid]=d;
  // Re-render only if user is still on this plant
  if(tab==="plants"&&_plState.selectedId===pid)ren();
}
function _plSelect(id){_plState.selectedId=id;hp("sel");ren()}
function _plAttachSwipe(){
  var card=document.querySelector(".pl-card");if(!card||card._sw)return;card._sw=true;
  var start=null;
  card.addEventListener("touchstart",function(e){if(e.target&&e.target.closest("button"))return;start={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
  card.addEventListener("touchend",function(e){
    if(!start)return;var dx=e.changedTouches[0].clientX-start.x;var dy=e.changedTouches[0].clientY-start.y;start=null;
    if(Math.abs(dy)>40||Math.abs(dx)<60)return;
    var list=D.plants||[];if(list.length<2)return;
    var i=list.findIndex(function(p){return p.id===_plState.selectedId});
    if(i<0)return;
    var next=dx<0?(i+1)%list.length:(i-1+list.length)%list.length;
    _plSelect(list[next].id);
  },{passive:true});
}

// ─── Add flow: pick photo → upload → AI identify → server creates ──
function _plOpenAdd(){
  hp("light");
  var h='<div class="lb">'+tr("pl_snap_photo")+'</div>';
  h+='<div style="font-size:12px;color:var(--ht);margin-bottom:14px;line-height:1.4">AI will identify the plant, set a watering schedule, and write care tips. ~3 seconds.</div>';
  h+='<label class="pl-photo-pick" id="pl-photo-pick"><input type="file" id="pl-file" accept="image/*" capture="environment" style="display:none" onchange="_plOnPhotoPicked(this)"><div class="pl-photo-icon">📷</div><div class="pl-photo-l">'+tr("pl_pick_photo")+'</div></label>';
  h+='<div class="lb" style="margin-top:14px">Nickname (optional)</div>';
  h+='<input class="inp" id="pl-name" placeholder="e.g. Yuki, Momi, Hana…" maxlength="40">';
  h+='<div id="pl-add-msg" style="margin-top:10px;font-size:12px;color:var(--ht);text-align:center;min-height:18px"></div>';
  h+='<button class="btn" id="pl-add-go" onclick="_plDoAdd()" disabled style="opacity:.5">Identify & add</button>';
  oMC(tr("mt_add_plant"),h,{ic:"flower"});
}
var _plPhotoData=null;
function _plOnPhotoPicked(input){
  var f=input.files&&input.files[0];if(!f)return;
  if(f.size>15*1024*1024){document.getElementById("pl-add-msg").textContent="Photo > 15 MB — pick a smaller one";return}
  _plPhotoData=f;
  // Preview
  var url=URL.createObjectURL(f);
  var p=document.getElementById("pl-photo-pick");
  if(p){p.style.backgroundImage='url('+url+')';p.classList.add("pl-photo-set");p.querySelector(".pl-photo-icon").style.opacity=0;p.querySelector(".pl-photo-l").textContent=tr("pl_tap_to_change")}
  var go=document.getElementById("pl-add-go");if(go){go.disabled=false;go.style.opacity=1}
}
async function _plDoAdd(){
  if(!_plPhotoData)return;
  var name=(document.getElementById("pl-name")||{}).value||"";
  var msg=document.getElementById("pl-add-msg");
  if(msg)msg.textContent="🤖 Identifying plant…";
  var btn=document.getElementById("pl-add-go");if(btn){btn.disabled=true;btn.textContent="Working…"}
  var __fdat=await _downscaleImage(_plPhotoData);
  var fd=new FormData();fd.append("file",__fdat);fd.append("custom_name",name.trim());
  var headers={};
  if(iD)headers["X-Telegram-Init-Data"]=iD;
  var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
  try{
    var r=await fetch("/api/plants",{method:"POST",headers:headers,body:fd});
    if(!r.ok){
      var err="";try{var j=await r.json();err=j.detail||""}catch(e){}
      if(msg)msg.textContent="❌ "+(err||"Upload failed");
      if(btn){btn.disabled=false;btn.textContent="Identify & add"}
      return;
    }
    var p=await r.json();
    // Branch: AI returned candidates (uncertain) — show picker
    if(p&&p.candidates&&p.candidates.length){
      _plShowCandidates(p.candidates,name.trim());
      return;
    }
    // Branch: AI confidently created the plant
    _plPhotoData=null;
    hp("ok");toast("Added "+(p.custom_name||p.species||"plant"));
    await load();
    _plState.selectedId=p.id;
    cMo();
    if(tab!=="plants")go("plants"); else ren();
  }catch(e){
    if(msg)msg.textContent="❌ Network error";
    if(btn){btn.disabled=false;btn.textContent="Identify & add"}
  }
}

// AI returned multiple candidates — let user pick. Photo is kept in _plPhotoData and
// re-uploaded with the chosen candidate to /api/plants/finalize.
function _plShowCandidates(candidates,customName){
  hp("light");
  var h='<div style="text-align:center;margin-bottom:14px"><div style="font-size:13px;color:var(--ht);line-height:1.4">AI isn\'t sure — pick the closest match:</div></div>';
  candidates.forEach(function(c,i){
    var pct=Math.round((c.confidence||0)*100);
    h+='<button class="pl-cand" onclick="_plPickCandidate('+i+')">';
    h+='<div class="pl-cand-i">🪴</div>';
    h+='<div class="pl-cand-bd"><div class="pl-cand-n">'+es(c.species||"")+'</div><div class="pl-cand-s">'+es(c.latin_name||"")+'</div></div>';
    h+='<div class="pl-cand-c">'+pct+'%</div>';
    h+='</button>';
  });
  h+='<button class="btn btn-s" style="margin-top:14px;background:transparent;color:var(--ht);border:1px solid var(--bd)" onclick="cMo()">'+tr("btn_cancel")+'</button>';
  // Stash for picker
  _plState._candidates=candidates;
  _plState._candCustomName=customName||"";
  oMC(tr("mt_which_one"),h,{ic:"flower"});
}

async function _plPickCandidate(idx){
  var cand=(_plState._candidates||[])[idx];
  if(!cand||!_plPhotoData)return;
  hp("ok");
  // Show inline progress
  document.getElementById("mb").innerHTML='<div class="emp" style="padding:30px"><div class="emp-i">⏳</div><div>Adding…</div></div>';
  var __fdat=await _downscaleImage(_plPhotoData);
  var fd=new FormData();
  fd.append("file",__fdat);
  fd.append("candidate",JSON.stringify(cand));
  fd.append("custom_name",_plState._candCustomName||"");
  var headers={};
  if(iD)headers["X-Telegram-Init-Data"]=iD;
  var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
  try{
    var r=await fetch("/api/plants/finalize",{method:"POST",headers:headers,body:fd});
    if(!r.ok){
      var err="";try{var j=await r.json();err=j.detail||""}catch(e){}
      document.getElementById("mb").innerHTML='<div class="emp" style="padding:30px;color:var(--ac)">❌ '+(err||"Failed")+'</div>';
      return;
    }
    var p=await r.json();
    _plPhotoData=null;
    _plState._candidates=null;
    toast("Added "+(p.custom_name||p.species||"plant"));
    await load();
    _plState.selectedId=p.id;
    cMo();
    if(tab!=="plants")go("plants"); else ren();
  }catch(e){
    document.getElementById("mb").innerHTML='<div class="emp" style="padding:30px;color:var(--ac)">❌ Network error</div>';
  }
}

async function _plWater(pid){
  hp("light");
  // Toggle endpoint: server decides water-vs-undo based on whether already watered today
  var r=await A("POST","/api/plants/"+pid+"/water");
  if(!r)return;
  var i=(D.plants||[]).findIndex(function(p){return p.id===pid});
  if(i>=0)D.plants[i]=r;
  hp("ok");
  if(r.watered_today){
    toast("💧 Watered "+(r.custom_name||r.species||"plant"));
  }else{
    toast(tr("ts_watering_undone"));
  }
  // History cache is stale after watering — drop so it reloads
  delete _plState.histCache[pid];
  ren();
}

// Care details are now shown inline below the main card (see _rPlantInlineTips).
// Keep this function as a thin redirect so any stale onclick references still work.
function _plOpenAdvice(pid){
  _plState.selectedId=pid;
  if(tab!=="plants")go("plants"); else ren();
  // Scroll to the inline tips section
  setTimeout(function(){var el=document.querySelector(".pl-inline");if(el)el.scrollIntoView({behavior:"smooth",block:"start"})},120);
}
function _plHistHtml(d,p){
  var watered={};(d.water_days||[]).forEach(function(x){watered[x]=true});
  var bars='';
  d.dates.forEach(function(ds){
    var hit=watered[ds];
    bars+='<div class="pl-hist-bar '+(hit?"on":"")+'" title="'+ds+'"></div>';
  });
  var stats='';
  if(d.count){
    var avgPart=d.avg_interval_days?' · avg every '+d.avg_interval_days+'d':'';
    stats='<div class="pl-hist-stats">'+d.count+' waterings'+avgPart+' · target '+d.target_interval_days+'d</div>';
  }else{
    stats='<div class="pl-hist-stats">'+tr("pl_no_waterings_window")+'</div>';
  }
  return '<div class="pl-hist-bars">'+bars+'</div>'+stats;
}

function _plMoreMenu(pid){
  hp("light");
  var p=(D.plants||[]).find(function(x){return x.id===pid});if(!p)return;
  var h='<button class="menu-i" onclick="cMo();_plOpenEdit('+pid+')"><span class="mi-ico">'+I.ed+'</span><span class="mi-l">'+tr("pl_edit_details")+'</span></button>';
  h+='<button class="menu-i" onclick="cMo();_plReplacePhoto('+pid+')"><span class="mi-ico">📷</span><span class="mi-l">'+tr("pl_replace_photo")+'</span></button>';
  h+='<div style="height:1px;background:var(--bd);margin:6px 0"></div>';
  h+='<button class="menu-i" onclick="cMo();_plDelete('+pid+')" style="color:var(--ac)"><span class="mi-ico">🗑</span><span class="mi-l">'+tr("pl_delete_plant")+'</span></button>';
  oMC(tr("mt_more"),h,{ic:"flower"});
}

function _plOpenEdit(pid){
  var p=(D.plants||[]).find(function(x){return x.id===pid});if(!p)return;
  hp("light");
  var h='<div class="lb">'+tr("pl_nickname")+'</div><input class="inp" id="ple-name" value="'+es(p.custom_name||"")+'" placeholder="'+tr("pl_nickname_placeholder")+'" maxlength="40">';
  h+='<div class="lb" style="margin-top:12px">'+tr("pl_species")+'</div><input class="inp" id="ple-species" value="'+es(p.species||"")+'">';
  h+='<div class="lb" style="margin-top:12px">'+tr("pl_latin")+'</div><input class="inp" id="ple-latin" value="'+es(p.latin_name||"")+'">';
  h+='<div class="dr"><div><div class="dl">'+tr("pl_water_every_days")+'</div><input class="inp" type="number" min="1" max="60" id="ple-int" value="'+(p.water_interval_days||7)+'"></div><div><div class="dl">'+tr("pl_light")+'</div><input class="inp" id="ple-light" value="'+es(p.light||"")+'"></div></div>';
  h+='<div class="lb" style="margin-top:12px">'+tr("f_notes")+'</div><input class="inp" id="ple-notes" value="'+es(p.notes||"")+'" placeholder="'+tr("pl_notes_placeholder")+'">';
  // Custom voice — speech bubble phrases per status. Any field left empty falls back to bank.
  var vo=p.voice_overrides||{};
  h+='<div class="lb" style="margin-top:14px">Personality (optional)</div>';
  h+='<div style="font-size:11px;color:var(--ht);margin-bottom:8px;line-height:1.4">Override the speech bubble phrase for each status. Leave empty to use defaults.</div>';
  h+='<div class="dl" style="margin-top:6px">🟢 When healthy</div><input class="inp" id="ple-v-ok" value="'+es(vo.ok||"")+'" placeholder="Feeling great! ✨" maxlength="120">';
  h+='<div class="dl" style="margin-top:6px">🟡 When water due soon</div><input class="inp" id="ple-v-soon" value="'+es(vo.soon||"")+'" placeholder="Could use a drink soon…" maxlength="120">';
  h+='<div class="dl" style="margin-top:6px">🔴 When thirsty</div><input class="inp" id="ple-v-thirsty" value="'+es(vo.thirsty||"")+'" placeholder="I’m getting thirsty 💧" maxlength="120">';
  h+='<button class="btn" style="margin-top:18px" onclick="_plSaveEdit('+pid+')">'+tr("btn_save")+'</button>';
  oMC(tr("mt_edit_plant"),h,{ic:"flower"});
}
async function _plSaveEdit(pid){
  var v=function(id){return (document.getElementById(id)||{}).value||""};
  var body={
    custom_name:v("ple-name").trim(),
    species:v("ple-species").trim(),
    latin_name:v("ple-latin").trim(),
    water_interval_days:parseInt(v("ple-int"))||7,
    light:v("ple-light").trim(),
    notes:v("ple-notes").trim(),
    voice_overrides:{ok:v("ple-v-ok").trim(),soon:v("ple-v-soon").trim(),thirsty:v("ple-v-thirsty").trim()}
  };
  if(!body.species||!body.latin_name){toast("Species & Latin name required");return}
  var r=await A("PATCH","/api/plants/"+pid,body);
  if(!r)return;
  var i=(D.plants||[]).findIndex(function(p){return p.id===pid});
  if(i>=0)D.plants[i]=r;
  cMo();hp("ok");toast(tr("ts_saved"));ren();
}

function _plReplacePhoto(pid){
  // Trigger native file picker, upload, refresh
  var input=document.createElement("input");
  input.type="file";input.accept="image/*";input.capture="environment";
  input.onchange=async function(){
    var f=input.files&&input.files[0];if(!f)return;
    if(f.size>15*1024*1024){toast(tr("ts_too_large"));return}
    hp("light");
    f=await _downscaleImage(f);
    var fd=new FormData();fd.append("file",f);
    var headers={};
    if(iD)headers["X-Telegram-Init-Data"]=iD;
    var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
    try{
      var r=await fetch("/api/plants/"+pid+"/image",{method:"POST",headers:headers,body:fd});
      if(!r.ok){toast(tr("ts_upload_failed"));return}
      hp("ok");toast("Photo updated");
      // Mark has_image true and force re-render
      var i=(D.plants||[]).findIndex(function(p){return p.id===pid});
      if(i>=0)D.plants[i].has_image=true;
      ren();
    }catch(e){toast(tr("ts_network"))}
  };
  input.click();
}

async function _plDelete(pid){
  var p=(D.plants||[]).find(function(x){return x.id===pid});if(!p)return;
  if(!confirm(tr("pl_delete_plant_confirm",{name:(p.custom_name||p.species||"plant")})))return;
  var r=await A("DELETE","/api/plants/"+pid);
  if(!r)return;
  hp("ok");toast("Deleted");
  D.plants=(D.plants||[]).filter(function(x){return x.id!==pid});
  if(_plState.selectedId===pid)_plState.selectedId=(D.plants[0]||{}).id||null;
  ren();
}
