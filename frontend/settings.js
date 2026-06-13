// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Settings page (extracted from app.js in v8.45.0)
// ═══════════════════════════════════════════════════════════════
// Settings hamburger page: Family info + invite, members, language picker,
// theme picker (catalog + custom editor), notifications/digest, money
// categories link, learning language, integrations, developer toggle.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from earlier modules: D, fS, tr(), trn(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), ren(), mAv(), I, iD, TH, cTheme, aT(),
// _lang, _wordsState.

// ═══════════════════════════════════════════════════════════
// SETTINGS (hamburger page)
// ═══════════════════════════════════════════════════════════
function rSet(){var h='';
function _setRow(opts){
  // opts: {ico, iconCustom, iconStyle, acc, title, subtitle, onclick, right, id, style}
  var hasIcon=opts.ico||opts.iconCustom;
  var iconInner=opts.iconCustom||(opts.ico?icon(opts.ico,20,2.2):'');
  var iconStyleAttr=opts.iconStyle?' style="'+opts.iconStyle+'"':'';
  var iconHtml=hasIcon?'<div class="lc-i '+(opts.acc||"")+'"'+iconStyleAttr+'>'+iconInner+'</div>':'';
  var ocl=opts.onclick?' onclick="'+opts.onclick+'"':"";
  var cls="lc lc-row"+(opts.onclick?" lc-tap":"");
  var sub=opts.subtitle?'<div class="lc-mt">'+opts.subtitle+'</div>':"";
  return '<div class="'+cls+'"'+ocl+(opts.id?' id="'+opts.id+'"':"")+(opts.style?' style="'+opts.style+'"':"")+'>'+iconHtml+'<div class="lc-bd"><div class="lc-tt">'+opts.title+'</div>'+sub+'</div>'+(opts.right||'')+(opts.onclick?'<span class="lc-chev">›</span>':"")+'</div>'
}
if(fS&&fS.joined){
  h+='<div class="sc"><span class="sc-l">'+tr("set_family")+'</span></div>';
  h+=_setRow({ico:"user",acc:"acc-ok",title:es(fS.name||"My Family"),subtitle:tr("set_family")});
  h+='<div class="invite-card"><div class="invite-lb">'+tr("set_invite_code")+'</div><div class="invite-cd">'+(fS.invite_code||"...")+'</div><div class="invite-hint">'+tr("set_share_hint")+'</div></div>';
  h+='<div class="sc"><span class="sc-l">'+tr("set_members")+'<span class="sc-cnt">'+(fS.members||[]).length+'</span></span></div>';
  (fS.members||[]).forEach(function(m){
    var right='<button class="bi" onclick="edMe('+m.user_id+',\''+es(m.user_name)+'\',\''+m.emoji+'\',\''+m.color+'\')">'+I.ed+'</button>';
    h+='<div class="lc lc-mem">'+mAv(m.user_id,44)+'<div class="lc-bd"><div class="lc-tt">'+es(m.user_name)+'</div><div class="lc-mem-strip" style="background:'+m.color+'"></div></div>'+right+'</div>';
  });
  h+='<div style="margin:14px 0 22px;display:flex;gap:8px"><button class="btn btn-s" style="font-size:13px;flex:1" onclick="if(confirm(\''+tr("set_leave_family")+'?\'))leaveFam()">'+tr("set_leave_family")+'</button>'+
  (!iD&&_getSess()?'<button class="btn btn-s" style="font-size:13px;flex:1;background:transparent;border:1.5px solid var(--bd);color:var(--tx)" onclick="_logoutPwa()">Log out</button>':'')+
  '</div>';
}
// ─── Language picker (per-member, v8.32.0) ─────────────────────────
// Two big buttons EN/RU; current one filled with theme primary, the other outlined.
h+='<div class="sc"><span class="sc-l">'+tr("set_language")+'</span></div>';
h+='<div style="display:flex;gap:8px;margin-bottom:18px">';
['en','ru'].forEach(function(code){
  var sel=(_lang===code);
  var label=(code==='en'?'🇬🇧 English':'🇷🇺 Русский');
  h+='<button class="btn btn-s" style="flex:1;font-size:14px;'+(sel?'':'background:transparent;border:1.5px solid var(--bd);color:var(--tx)')+'" onclick="setLang(\''+code+'\')">'+label+'</button>';
});
h+='</div>';
var curTh=TH[cTheme]||TH.midnight;
h+='<div class="sc"><span class="sc-l">'+tr("set_appearance")+'</span></div>';
var thAcc=curTh.pr;
var thStyle='background:linear-gradient(135deg,color-mix(in srgb,'+thAcc+' 38%,transparent),color-mix(in srgb,'+thAcc+' 10%,transparent));border-color:color-mix(in srgb,'+thAcc+' 48%,transparent);color:'+thAcc+';box-shadow:inset 0 1px 0 color-mix(in srgb,'+thAcc+' 20%,transparent),0 2px 12px color-mix(in srgb,'+thAcc+' 22%,transparent)';
h+=_setRow({ico:"palette",iconStyle:thStyle,title:tr("th_"+cTheme)||curTh.n,subtitle:tr("set_theme_sub")+" · "+Object.keys(TH).length+" · "+curTh.e,onclick:"openThemePicker()"});
// Bottom navigation picker (v8.47.0). Shows current nav as a small preview + count.
var navIds=_currentNavIds();
var navPreview=navIds.map(function(id){return tr("nav_"+id)}).join(" · ");
h+=_setRow({ico:"list",acc:"acc-pr",title:tr("set_bottom_nav"),subtitle:navPreview+" ("+navIds.length+")",onclick:"openNavPicker()"});
h+='<div class="sc"><span class="sc-l">'+tr("set_weather")+'</span></div>';
h+=_setRow({iconCustom:'<span style="font-size:20px">📍</span>',acc:"acc-pr",title:tr("set_weather_city"),subtitle:es((D.settings&&D.settings.weather_city)||"Belgrade"),onclick:"openWeatherCityCfg()"});
h+='<div class="sc"><span class="sc-l">'+tr("set_notifications")+'</span></div>';
// Push master toggle — native app only (FCM). Token presence = enabled.
if(typeof _isNativeApp==="function"&&_isNativeApp()){
  var _pon=(typeof _pushIsOn==="function"&&_pushIsOn());
  var _pcol=_pon?"pr":"ht";
  h+=_setRow({ico:"bl",acc:"acc-pr",title:tr("set_notifs_push"),subtitle:tr("set_notifs_push_sub"),onclick:"_pushToggle()",right:'<span class="lc-rt" style="background:color-mix(in srgb,var(--'+_pcol+') 16%,transparent);color:var(--'+_pcol+')">'+(_pon?tr("push_on"):tr("push_off"))+'</span>'});
}
h+=_setRow({ico:"bl",acc:"acc-wn",title:tr("set_morning_digest"),subtitle:(D.settings.digest_time||"09:00")+" · "+tr("set_morning_digest_sub"),onclick:"openDigestCfg()"});
var nExp=D.categories.filter(function(c){return c.type==="expense"}).length;
var nInc=D.categories.filter(function(c){return c.type==="income"}).length;
h+='<div class="sc"><span class="sc-l">'+tr("set_money")+'</span></div>';
h+=_setRow({ico:"list",acc:"acc-pr",title:tr("set_categories"),subtitle:nExp+" expense · "+nInc+" income",onclick:"openCatMgr()"});
h+='<div class="sc"><span class="sc-l">'+tr("set_learning")+'</span></div>';
var _curLearn=_wordsState&&_wordsState.mode==="ru"?"🇷🇺 Russian":"🇬🇧 English";
h+=_setRow({iconCustom:'<span style="font-size:22px">🎓</span>',acc:"acc-pr",title:tr("set_learning_lang"),subtitle:_curLearn,onclick:"openLearnModePicker()"});
h+=_setRow({ico:"book",acc:"acc-pr",title:tr("set_words_editor"),subtitle:tr("set_words_editor_sub"),onclick:"openWordsMgr()"});
h+=_setRow({iconCustom:'<span style="font-size:22px">🔄</span>',acc:"acc-ac",title:tr("set_reset_progress"),subtitle:tr("set_reset_progress_sub"),onclick:"_resetWordsProgress()"});
h+='<div class="sc"><span class="sc-l">'+tr("set_integrations")+'</span></div>';
h+=_setRow({iconCustom:'<span style="font-size:22px">🔵</span>',acc:"",title:"Trello Sync",subtitle:"Board: Работа",onclick:"syncTrello()",right:'<span id="trello-btn" class="lc-rt" style="background:color-mix(in srgb,var(--pr) 16%,transparent);color:var(--pr)">Sync Now</span>'});
if(_pwaPrompt){
  h+=_setRow({iconCustom:'<span style="font-size:22px">📱</span>',acc:"",title:"Install App",subtitle:"Add to home screen — works offline",onclick:"installPWA()",right:'<span class="lc-rt" style="background:color-mix(in srgb,var(--pr) 16%,transparent);color:var(--pr)">Install</span>'});
}else if(!iD && /iPhone|iPad|iPod/.test(navigator.userAgent||"")){
  h+='<div class="lc"><div class="lc-i acc-pr"><span style="font-size:22px">📱</span></div><div class="lc-bd"><div class="lc-tt">Install on iOS</div><div class="lc-mt">Tap <b>Share</b> ⬆ → <b>Add to Home Screen</b></div></div></div>';
}
// Tips & News (v8.49.0) — opens release timeline from /static/news.js.
h+='<div class="sc"><span class="sc-l">'+tr("set_about")+'</span></div>';
h+=_setRow({ico:"bolt",acc:"acc-pr",title:tr("set_tips_news"),subtitle:tr("set_tips_news_sub"),onclick:"showAllNews()"});
h+=_setRow({iconCustom:'<span style="font-size:20px">🧭</span>',acc:"acc-pr",title:tr("set_replay_tour"),subtitle:tr("set_replay_tour_sub"),onclick:"replayTour()"});
h+='<div class="sc"><span class="sc-l">'+tr("set_developer")+'</span></div>';
h+=_setRow({ico:"debug",acc:"acc-ac",title:tr("set_debug")+" "+(dbgOn?"ON":"OFF"),onclick:"dbgOn=!dbgOn;document.getElementById(\'dbg\').classList.toggle(\'hidden\',!dbgOn);ren()"});
h+='<div style="margin-top:18px;text-align:center;font-size:11px;color:var(--ht);letter-spacing:.3px">Moya 0.5</div>';return h}

// ─── Weather location (city for the weather widget) ──────────────────
// First launch (native app): offer to use the device location to set the family's
// weather city. Asked once (with a rationale before the OS prompt). A manual
// override lives in Settings → Weather. Backend already stores weather_lat/lon/city.
function _locMaybeAsk(){
  if(typeof _isNativeApp!=="function"||!_isNativeApp())return;
  if(!(typeof fS!=="undefined"&&fS&&fS.joined))return;
  try{ if(localStorage.getItem("moya_loc_asked")==="1")return; }catch(e){}
  if(D&&D.settings&&D.settings.weather_lat!=null)return;                 // already configured
  if(document.querySelector("#mo.op")||document.getElementById("tour-root"))return; // don't stack
  setTimeout(_locShowRationale,800);
}
function _locShowRationale(){
  if(document.querySelector("#mo.op")||document.getElementById("tour-root"))return;
  oMC(tr("loc_title"),
    '<div style="text-align:center;padding:2px 2px 0">'+
    '<div style="font-size:44px;margin-bottom:10px">📍</div>'+
    '<div style="font-size:14px;color:var(--ht);line-height:1.5;margin-bottom:18px">'+tr("loc_body")+'</div>'+
    '<button class="btn" onclick="_locAllow()">'+tr("loc_allow")+'</button>'+
    '<button class="btn btn-s" style="margin-top:8px" onclick="_locDismiss()">'+tr("loc_later")+'</button>'+
    '</div>',{ic:"pin"});
}
function _locDismiss(){ try{localStorage.setItem("moya_loc_asked","1")}catch(e){} cMo(); }
async function _locAllow(){ try{localStorage.setItem("moya_loc_asked","1")}catch(e){} cMo(); await _locDetect(true); }

async function _locDetect(showFeedback){
  var G=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Geolocation;
  if(!G||typeof G.getCurrentPosition!=="function"){ if(showFeedback)toast(tr("loc_unavailable")); return; }
  if(showFeedback)toast("📍 …");
  try{
    try{ await G.requestPermissions({permissions:["location"]}); }catch(e){}
    var pos=await G.getCurrentPosition({enableHighAccuracy:false,timeout:12000,maximumAge:600000});
    var lat=pos&&pos.coords&&pos.coords.latitude, lon=pos&&pos.coords&&pos.coords.longitude;
    if(lat==null||lon==null){ if(showFeedback)toast(tr("loc_failed")); return; }
    var city=await _reverseGeocode(lat,lon);
    await A("PATCH","/api/settings",{weather_lat:lat,weather_lon:lon,weather_city:city||""});
    await load();
    if(showFeedback)toast("📍 "+(city||tr("loc_done")));
  }catch(e){ if(showFeedback)toast(tr("loc_failed")); }
}
// lat/lon → city name (free, no key, CORS-enabled).
async function _reverseGeocode(lat,lon){
  try{
    var lng=(_lang==="ru")?"ru":"en";
    var r=await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude="+lat+"&longitude="+lon+"&localityLanguage="+lng,{cache:"no-store"});
    if(r.ok){ var d=await r.json(); return d.city||d.locality||d.principalSubdivision||d.countryName||""; }
  }catch(e){}
  return "";
}

// Settings → Weather city: auto-detect button (native) + free city search.
function openWeatherCityCfg(){
  var cur=(D.settings&&D.settings.weather_city)||"Belgrade";
  var detectBtn=(typeof _isNativeApp==="function"&&_isNativeApp())
    ? '<button class="btn btn-s" style="margin-bottom:12px" onclick="cMo();_locDetect(true)">📍 '+tr("loc_detect")+'</button>' : '';
  oMC(tr("set_weather_city"),
    '<div class="lc" style="margin-bottom:14px"><div class="lc-i acc-pr"><span style="font-size:20px">📍</span></div><div class="lc-bd"><div class="lc-tt">'+es(cur)+'</div><div class="lc-mt">'+tr("set_weather_city_cur")+'</div></div></div>'+
    detectBtn+
    '<input class="inp" id="wc-q" placeholder="'+tr("set_weather_city_ph")+'" oninput="_wcSearch(this.value)" autocomplete="off">'+
    '<div id="wc-res" style="margin-top:6px"></div>',{ic:"pin"});
}
var _wcT=null;
function _wcSearch(q){
  q=(q||"").trim(); if(_wcT)clearTimeout(_wcT);
  var el=document.getElementById("wc-res"); if(!el)return;
  if(q.length<2){ el.innerHTML=""; return; }
  _wcT=setTimeout(async function(){
    try{
      var r=await fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language="+(_lang==="ru"?"ru":"en")+"&name="+encodeURIComponent(q));
      var d=await r.json(); var list=(d&&d.results)||[];
      var el2=document.getElementById("wc-res"); if(!el2)return;
      el2.innerHTML=list.map(function(c){
        var sub=[c.admin1,c.country].filter(Boolean).map(es).join(" · ");
        var nm=es(c.name).replace(/\\/g,"").replace(/'/g,"’");
        return '<div class="lc lc-tap" onclick="_wcPick('+c.latitude+','+c.longitude+',\''+nm+'\')"><div class="lc-i"><span style="font-size:18px">📍</span></div><div class="lc-bd"><div class="lc-tt">'+es(c.name)+'</div><div class="lc-mt">'+sub+'</div></div></div>';
      }).join("");
    }catch(e){}
  },300);
}
async function _wcPick(lat,lon,name){
  await A("PATCH","/api/settings",{weather_lat:lat,weather_lon:lon,weather_city:name});
  cMo(); if(typeof hp==="function")hp(); await load(); toast("📍 "+name);
}
async function setTh(id){
  if(id==="custom"){
    // Tapping Custom in the picker opens the editor (saves happen there). Also apply right away.
    aT("custom");
    await A("PATCH","/api/settings",{theme:"custom"});
    cMo();openCustomThemeEditor();return
  }
  aT(id);hp();await A("PATCH","/api/settings",{theme:id});ren()
}
function openThemePicker(){
  var h='<div class="tg">';
  // Custom always first — its preview shows the user's saved palette (or seeded from current theme)
  var p=_getMyCustomPalette()||_seedCustomFromTheme(cTheme==="custom"?"midnight":cTheme);
  var dt=_deriveCustomTheme(p);
  var sel=cTheme==="custom";
  h+='<div class="tc" onclick="setTh(\'custom\')" style="background:'+dt.cd+';border:2px solid '+(sel?dt.pr:dt.bd)+'"><div class="te" style="color:'+dt.pr+'">'+icon("palette",24,2.2)+'</div><div class="tn" style="color:'+dt.tx+'">Custom</div><div class="td">'+[dt.pr,dt.ac,dt.ok,dt.wn].map(function(c){return '<div class="tdd" style="background:'+c+'"></div>'}).join("")+'</div></div>';
  Object.keys(TH).forEach(function(id){
    if(id==="custom")return; // already rendered above
    var th=TH[id];var sl=cTheme===id;var thName=tr("th_"+id)||th.n;
    h+='<div class="tc" onclick="setTh(\''+id+'\');cMo()" style="background:'+th.cd+';border:2px solid '+(sl?th.pr:th.bd)+'"><div class="te">'+th.e+'</div><div class="tn" style="color:'+th.tx+'">'+thName+'</div><div class="td">'+[th.pr,th.ac,th.ok,th.wn].map(function(c){return '<div class="tdd" style="background:'+c+'"></div>'}).join("")+'</div></div>'
  });
  h+='</div>';
  oMC(tr("mt_choose_theme"),h,{ic:"palette"})
}

// ─── Custom theme editor ─────────────────────────────────────────
var _customSnapshot=null,_customDraft=null;
function openCustomThemeEditor(){
  // Snapshot current applied theme (so Cancel reverts cleanly)
  _customSnapshot={theme:cTheme,palette:_getMyCustomPalette()};
  // Draft starts from saved palette OR a seed from the previous non-custom theme
  var seedFrom=_customSnapshot.theme==="custom"?"midnight":_customSnapshot.theme;
  _customDraft=_getMyCustomPalette()||_seedCustomFromTheme(seedFrom);
  // Apply draft immediately so user sees live preview
  aT("custom");
  oMC(tr("mt_custom_theme"),_customEditorHtml(),{ic:"palette"})
}
function _customEditorHtml(){
  var p=_customDraft;
  var dt=_deriveCustomTheme(p);
  // Contrast checks (WCAG)
  var warns=[];
  var c1=_contrast(dt.tx,p.bg);if(c1<3.5)warns.push("Text on background contrast is low ("+c1.toFixed(1)+":1)");
  var c2=_contrast(p.pr,p.bg);if(c2<2.8)warns.push("Primary accent vs background contrast is low ("+c2.toFixed(1)+":1)");
  var c3=_contrast(p.bg,p.sf);if(c3<1.06)warns.push("Background and Surface are too similar — cards won't stand out");
  var c4=_contrast(p.ac,p.bg);if(c4<2.5)warns.push("Alert accent vs background contrast is low");
  var c5=_contrast(p.ok,p.bg);if(c5<2.5)warns.push("Success accent vs background contrast is low");
  var warnHtml=warns.length?'<div class="ct-warn">'+warns.map(function(w){return '<div class="ct-warn-row">⚠ '+w+'</div>'}).join('')+'</div>':'';
  // Preview tile
  var prev='<div class="ct-prev" style="background:'+p.bg+';color:'+dt.tx+';border-color:'+dt.bd+'">'+
    '<div class="ct-prev-h">Moya</div>'+
    '<div class="ct-prev-s" style="color:'+dt.ht+'">Live preview of your palette</div>'+
    '<div class="ct-prev-card" style="background:'+dt.cd+'"><div class="ct-prev-row"><span class="ct-prev-ico" style="background:linear-gradient(135deg,'+_toRgba(p.pr,0.38)+','+_toRgba(p.pr,0.10)+');border:1px solid '+_toRgba(p.pr,0.45)+';color:'+p.pr+'">'+icon("clipboard",16,2.2)+'</span><span class="ct-prev-tt">Task title</span><span class="ct-prev-pill" style="background:'+_toRgba(p.pr,0.18)+';color:'+p.pr+'">High</span></div></div>'+
    '<div class="ct-prev-chips"><span class="ct-prev-chip" style="background:'+_toRgba(p.pr,0.16)+';color:'+p.pr+';border:1px solid '+_toRgba(p.pr,0.5)+'">Primary</span><span class="ct-prev-chip" style="background:'+_toRgba(p.ac,0.16)+';color:'+p.ac+';border:1px solid '+_toRgba(p.ac,0.5)+'">Alert</span><span class="ct-prev-chip" style="background:'+_toRgba(p.ok,0.16)+';color:'+p.ok+';border:1px solid '+_toRgba(p.ok,0.5)+'">Success</span></div>'+
    '<button class="ct-prev-btn" style="background:'+dt.gd+';color:'+dt.gtx+'">Primary Button</button>'+
    '</div>';
  // Color rows
  function row(key,label,val){
    return '<div class="ct-row"><div class="ct-row-lb">'+label+'</div><div class="ct-row-val"><input type="color" value="'+val+'" oninput="_customColorChange(\''+key+'\',this.value)"><span class="ct-row-hex">'+val.toUpperCase()+'</span></div></div>'
  }
  var h='';
  h+=prev;
  h+=warnHtml;
  h+='<div class="lb" style="margin-top:18px">Surfaces</div>';
  h+=row("bg","Background",p.bg);
  h+=row("sf","Surface",p.sf);
  h+='<div class="lb" style="margin-top:14px">Accents</div>';
  h+=row("pr","Primary",p.pr);
  h+=row("ac","Alert",p.ac);
  h+=row("ok","Success",p.ok);
  h+='<div style="display:flex;gap:8px;margin-top:18px"><button class="btn btn-s" style="flex:1" onclick="_resetCustomTheme()">Reset</button><button class="btn btn-s" style="flex:1" onclick="_cancelCustomTheme()">Cancel</button><button class="btn" style="flex:2" onclick="_saveCustomTheme()">Save</button></div>';
  return h
}
function _customColorChange(key,val){
  _customDraft[key]=val;
  aT("custom"); // re-derive and apply — but aT reads _getMyCustomPalette which doesn't know about the draft
  // Workaround: temporarily stuff the draft into member data so _getMyCustomPalette sees it
  var myId=fS&&fS.my_id;
  var me=myId&&(D.members||[]).find(function(m){return m.user_id===myId});
  if(me){me.custom_theme=JSON.stringify(_customDraft);aT("custom")}
  // Re-render the editor (preview tile + hex labels + warnings update)
  document.getElementById("mb").innerHTML=_customEditorHtml()
}
function _resetCustomTheme(){
  var seed=_customSnapshot&&_customSnapshot.theme&&_customSnapshot.theme!=="custom"?_customSnapshot.theme:"midnight";
  _customDraft=_seedCustomFromTheme(seed);
  _customColorChange("__reset",null); // force re-render
}
function _cancelCustomTheme(){
  // Restore: original palette in member, original theme applied
  var myId=fS&&fS.my_id;
  var me=myId&&(D.members||[]).find(function(m){return m.user_id===myId});
  if(me)me.custom_theme=_customSnapshot.palette?JSON.stringify(_customSnapshot.palette):null;
  if(_customSnapshot.theme)aT(_customSnapshot.theme);
  // Also revert family theme setting since setTh("custom") already patched it
  A("PATCH","/api/settings",{theme:_customSnapshot.theme});
  cMo();hp();ren()
}
async function _saveCustomTheme(){
  var myId=fS&&fS.my_id;if(!myId)return;
  var json=JSON.stringify(_customDraft);
  // Persist locally + on server
  var me=(D.members||[]).find(function(m){return m.user_id===myId});if(me)me.custom_theme=json;
  await A("PATCH","/api/members/"+myId,{custom_theme:json});
  // Family theme is already "custom" from setTh — no extra save needed
  aT("custom");hp("ok");cMo();ren()
}
async function setDg(v){await A("PATCH","/api/settings",{digest_time:v});hp()}
var _catTab="expense";
function openCatMgr(){_catTab="expense";oMC(tr("mt_categories"),catMgrHtml(),{ic:"list"})}
function catMgrHtml(){
var h='<div class="tabs" style="margin-bottom:16px"><button class="tab '+(_catTab==="expense"?"a":"")+'" onclick="_catTab=\'expense\';document.getElementById(\'mb\').innerHTML=catMgrHtml()">💸 Expense</button><button class="tab '+(_catTab==="income"?"a":"")+'" onclick="_catTab=\'income\';document.getElementById(\'mb\').innerHTML=catMgrHtml()">💰 Income</button></div>';
D.categories.filter(function(c){return c.type===_catTab}).forEach(function(c){
h+='<div class="c"><span style="font-size:20px">'+c.emoji+'</span><div class="bd"><div class="tt">'+es(c.name)+'</div></div><button class="bi" onclick="cMo();edCat('+c.id+')">'+I.ed+'</button><button class="bi" onclick="dlCat('+c.id+');openCatMgr()">'+I.tr+'</button></div>'});
h+='<button class="btn btn-s" onclick="cMo();addCat(\''+_catTab+'\')">+ Add Category</button>';
return h}
async function syncTrello(){var btn=document.getElementById("trello-btn");if(btn)btn.textContent="Syncing...";try{await A("POST","/api/trello/sync");await load();toast("✓ Trello synced")}catch(e){toast("Trello sync failed")}if(btn)btn.textContent="Sync Now"}
async function leaveFam(){await A("POST","/api/family/leave");location.reload()}
function edMe(uid,name,emoji,color){oMC("Edit Profile",'<input class="inp" id="me-n" value="'+name+'" placeholder="Name"><div class="dr"><div><div class="dl">Emoji</div><input class="inp" id="me-e" value="'+emoji+'" style="text-align:center;font-size:24px"></div><div><div class="dl">Color</div><input type="color" id="me-c" value="'+color+'" style="width:100%;height:48px;border-radius:12px;border:none;cursor:pointer"></div></div><button class="btn" onclick="svMe('+uid+')">Save</button>',{ic:"user"})}
async function svMe(uid){var n=document.getElementById("me-n").value.trim();var e=document.getElementById("me-e").value.trim();var c=document.getElementById("me-c").value;if(!n)return;await A("PATCH","/api/members/"+uid,{user_name:n,emoji:e,color:c});cMo();hp();await load()}


// ─── Bottom-nav picker (v8.47.0) ─────────────────────────────────
// Pick 3-5 features to show in the bottom nav. Tap a tile to toggle it on/off.
// Selection order = display order in the nav. Footer shows count + Save button.
// `_navDraft` is the working list while modal is open; saved by saveNavTabs().
var _navDraft = null;

function openNavPicker(){
  _navDraft = _currentNavIds().slice();
  oMC(tr("set_bottom_nav"), _navPickerHtml(), {ic:"list"});
}

function _navPickerHtml(){
  var ids = _navDraft || [];
  var inDraft = {}; ids.forEach(function(id, i){ inDraft[id] = i+1 });  // 1-based position
  var h = '<div class="np-hint">' + tr("nav_pick_hint") + '</div>';
  h += '<div class="np-grid">';
  NV_ALL.forEach(function(item){
    var pos = inDraft[item.id];
    var sel = !!pos;
    var disabled = !sel && ids.length >= 5;
    var glyph = item.sv || icon(item.icon_name || "cog", 22, 2);
    h += '<button class="np-tile' + (sel ? ' np-on' : '') + (disabled ? ' np-disabled' : '') +
         '" onclick="toggleNavTab(\'' + item.id + '\')">' +
         (sel ? '<span class="np-num">' + pos + '</span>' : '') +
         '<span class="np-ico">' + glyph + '</span>' +
         '<span class="np-l">' + tr("nav_" + item.id) + '</span>' +
         '</button>';
  });
  h += '</div>';
  h += '<div class="np-foot"><span class="np-cnt">' + ids.length + '/5</span>' +
       '<button class="btn btn-s" style="background:transparent;color:var(--ht);border:1px solid var(--bd)" onclick="resetNavTabs()">' + tr("btn_reset") + '</button>' +
       '<button class="btn" onclick="saveNavTabs()"' + (ids.length < 3 ? ' disabled style="opacity:.4"' : '') + '>' + tr("btn_save") + '</button>' +
       '</div>';
  return h;
}

function toggleNavTab(id){
  if(!_navDraft) return;
  var idx = _navDraft.indexOf(id);
  if(idx >= 0){
    _navDraft.splice(idx, 1);
  } else {
    if(_navDraft.length >= 5){ toast(tr("nav_max_warning")); return; }
    _navDraft.push(id);
  }
  hp("sel");
  // Re-render modal body inline (preserve scroll position).
  var mb = document.getElementById("mb");
  if(mb) mb.innerHTML = _navPickerHtml();
}

function resetNavTabs(){
  _navDraft = NV_DEFAULT_ORDER.slice();
  hp("warn");
  var mb = document.getElementById("mb");
  if(mb) mb.innerHTML = _navPickerHtml();
}

async function saveNavTabs(){
  if(!_navDraft || _navDraft.length < 3){ toast(tr("nav_min_warning")); return; }
  // Send null when user picked the default — saves space and keeps a clean DB row.
  var sameAsDefault = _navDraft.length === NV_DEFAULT_ORDER.length &&
                      _navDraft.every(function(id, i){ return id === NV_DEFAULT_ORDER[i] });
  var body = { tabs: sameAsDefault ? null : _navDraft.slice() };
  var r = await A("PATCH", "/api/members/me/nav_tabs", body);
  if(!r || !r.ok){ toast(tr("ts_save_failed")); return; }
  hp("ok");
  _navTabs = body.tabs;       // local sync
  _navDraft = null;
  cMo();
  _buildNav();                // rebuild bottom nav with new layout
  ren();                       // refresh Settings row preview
  toast(tr("ts_saved"));
}
