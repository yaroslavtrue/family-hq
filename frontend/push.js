// ─── Push notifications (FCM) — native Android only ───────────────────────
// Delivers the same reminders the Telegram bot sends (tasks, events, birthdays,
// subscriptions, plants) to accounts-mode users via Firebase Cloud Messaging.
// Asked once at first launch (rationale before the OS prompt), toggled from
// Settings. Full no-op on web/PWA — the plugin only exists inside the app.

function _pushPlugin(){
  try{ return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; }
  catch(e){ return null; }
}
function _pushIsOn(){ try{ return localStorage.getItem("moya_push_on")==="1"; }catch(e){ return false; } }
function _pushSetFlag(v){ try{ localStorage.setItem("moya_push_on", v?"1":"0"); }catch(e){} }

var _pushWired=false;
function _pushWireListeners(){
  var P=_pushPlugin(); if(!P || _pushWired) return; _pushWired=true;
  try{
    P.addListener("registration", function(t){
      var tok = t && t.value; if(!tok) return;
      _pushSetFlag(true);
      try{ localStorage.setItem("moya_push_token", tok); }catch(e){}
      try{ A("POST","/api/push/register",{token:tok, platform:"android"}); }catch(e){}
    });
    // Keep silent on errors — the user can retry from the Settings toggle.
    P.addListener("registrationError", function(){});
    P.addListener("pushNotificationActionPerformed", function(a){
      // Tapping a reminder opens the relevant item when the payload carries a target.
      try{
        var d=(a && a.notification && a.notification.data) || {};
        if(d.type && d.id && typeof showCalEv==="function"){ showCalEv(d.type, parseInt(d.id,10)); return; }
        if(typeof go==="function") go("home");
      }catch(e){}
    });
  }catch(e){}
}

// First launch: re-register silently if already granted, else offer once.
function _pushMaybeInit(){
  if(typeof _isNativeApp!=="function" || !_isNativeApp()) return;
  var P=_pushPlugin(); if(!P) return;
  _pushWireListeners();
  try{
    P.checkPermissions().then(function(p){
      if(p && p.receive==="granted"){ _pushSetFlag(true); try{ P.register(); }catch(e){} return; }
      if(_pushIsOn()) return;                                              // user turned it off — respect that
      if(!(typeof fS!=="undefined" && fS && fS.joined)) return;           // wait until onboarded
      try{ if(localStorage.getItem("moya_push_asked")==="1") return; }catch(e){}
      if(document.querySelector("#mo.op") || document.getElementById("tour-root")) return; // don't stack
      setTimeout(_pushShowRationale, 1400);
    }).catch(function(){});
  }catch(e){}
}
function _pushShowRationale(){
  if(document.querySelector("#mo.op") || document.getElementById("tour-root")) return;
  oMC(tr("push_title"),
    '<div style="text-align:center;padding:2px 2px 0">'+
    '<div style="font-size:44px;margin-bottom:10px">🔔</div>'+
    '<div style="font-size:14px;color:var(--ht);line-height:1.5;margin-bottom:18px">'+tr("push_body")+'</div>'+
    '<button class="btn" onclick="_pushAllow()">'+tr("push_allow")+'</button>'+
    '<button class="btn btn-s" style="margin-top:8px" onclick="_pushDismiss()">'+tr("push_later")+'</button>'+
    '</div>',{ic:"bl"});
}
function _pushDismiss(){ try{localStorage.setItem("moya_push_asked","1")}catch(e){} cMo(); }
async function _pushAllow(){ try{localStorage.setItem("moya_push_asked","1")}catch(e){} cMo(); await _pushSetEnabled(true,true); }

// Enable/disable from the rationale or the Settings master toggle.
async function _pushSetEnabled(on, showFeedback){
  var P=_pushPlugin();
  if(!P){ if(showFeedback)toast(tr("push_unavailable")); return; }
  if(on){
    _pushWireListeners();
    try{
      var perm=await P.requestPermissions();
      if(!perm || perm.receive!=="granted"){ _pushSetFlag(false); if(showFeedback)toast(tr("push_denied")); if(typeof ren==="function")ren(); return; }
      await P.register();                       // → 'registration' listener POSTs the token + sets the flag
      _pushSetFlag(true);
      if(showFeedback)toast("🔔 "+tr("push_on"));
    }catch(e){ if(showFeedback)toast(tr("push_unavailable")); }
  }else{
    _pushSetFlag(false);
    try{ await P.unregister(); }catch(e){}      // stop this device from receiving
    try{
      var old=localStorage.getItem("moya_push_token");
      if(old){ A("POST","/api/push/unregister",{token:old}); localStorage.removeItem("moya_push_token"); }
    }catch(e){}
    if(showFeedback)toast("🔕 "+tr("push_off"));
  }
  if(typeof ren==="function")ren();
}
function _pushToggle(){ _pushSetEnabled(!_pushIsOn(), true); }
