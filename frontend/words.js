// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Words / Vocabulary learning (extracted from app.js in v8.39.0)
// ═══════════════════════════════════════════════════════════════
// Full-screen vocabulary study UI (Words tab + Settings → Words editor).
// Per-member learn_mode ('en'/'ru' — what language they're learning).
// Backed by /api/words/* (static catalog + custom_words + word_overrides).
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from app.js / earlier modules: D, fS, tr(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), ren().
// ─── Words / Vocabulary learning ────────────────────────────────
var _wordsState={mode:"en",queue:[],cursor:0,sessionCorrect:0,loading:false,stats:{total:0,new:0,learning:0,learned:0},answered:null,lastAnswer:"",showSourceExample:false};
var _wordsFirstLoad=true;
function _myMember(){var uid=fS&&fS.my_id;return uid&&(D.members||[]).find(function(m){return m.user_id===uid})}
function _wordsInitMode(){var me=_myMember();if(me&&me.learn_mode)_wordsState.mode=me.learn_mode;else _wordsState.mode="en"}
async function loadWordsSession(){
  if(_wordsState.loading)return;
  _wordsState.loading=true;
  var d=await A("GET","/api/words/study?mode="+_wordsState.mode+"&limit=10");
  _wordsState.loading=false;
  if(!d||!d.words){_wordsState.queue=[];_wordsState.stats={total:0,new:0,learning:0,learned:0};if(tab==="words")ren();return}
  _wordsState.queue=d.words;_wordsState.cursor=0;_wordsState.sessionCorrect=0;_wordsState.stats=d.totals;
  if(tab==="words")ren();
}
function rWords(){
  if(_wordsFirstLoad){_wordsFirstLoad=false;_wordsInitMode();loadWordsSession()}
  var stats=_wordsState.stats||{learned:0,total:0};
  var modeLabel=_wordsState.mode==="en"?"Learning English":"Learning Russian";
  // Custom header: ✕ left, learned counter center (tap → stats). Settings moved to main Settings page.
  var h='<div class="wd-hd">';
  h+='<button class="wd-iconbtn" onclick="go(\'home\')" aria-label="Close">'+icon("x",20,2.5)+'</button>';
  h+='<button class="wd-counter" onclick="openWordsStats()"><span class="wd-counter-n">'+(stats.learned||0)+'</span><span class="wd-counter-lb">of '+(stats.total||0)+' learned · '+modeLabel+'</span></button>';
  h+='<span class="wd-iconbtn" style="visibility:hidden" aria-hidden="true"></span>';
  h+='</div>';
  // Loading
  if(_wordsState.loading||(_wordsState.queue.length===0&&_wordsFirstLoad===false&&stats.total===0)){h+='<div class="emp" style="padding-top:40px"><div class="emp-i" style="font-size:32px">⏳</div><div>Loading…</div></div>';return h}
  if(_wordsState.queue.length===0){h+='<div class="emp" style="padding-top:40px">'+icon("book",48,1.8)+'<div class="emp-t">'+tr("g_no_words_t")+'</div><div>'+tr("g_no_words_s")+'</div></div>';return h}
  // Session complete
  if(_wordsState.cursor>=_wordsState.queue.length){
    h+='<div class="wd-done"><div class="wd-done-emoji">🎉</div><div class="wd-done-t">'+tr("wd_session_complete")+'</div><div class="wd-done-s">'+tr("wd_correct_of",{n:_wordsState.sessionCorrect,total:_wordsState.queue.length})+'</div><button class="btn" style="max-width:240px;margin-top:18px" onclick="loadWordsSession()">'+tr("wd_next_session")+'</button></div>';
    return h;
  }
  // Current card
  var w=_wordsState.queue[_wordsState.cursor];
  var progress=_wordsState.cursor+1+' / '+_wordsState.queue.length;
  var ans=_wordsState.answered; // null | "correct" | "wrong"
  var targetLang=_wordsState.mode==="en"?"English":"Russian";
  var sourceLang=_wordsState.mode==="en"?"Russian":"English";
  h+='<div class="wd-progress">Card '+progress+'</div>';
  h+='<div class="wd-card" id="wd-card">';
  // Visual — emoji is the always-present base layer.
  // If a hand-uploaded image exists at /static/words/<image_key>.jpg, it fades in on top.
  // Missing files trigger img.onerror which silently removes the element — emoji stays.
  var emoji=w.emoji||"📖";
  h+='<div class="wd-visual"><span class="wd-emoji">'+emoji+'</span>';
  if(w.image_key)h+='<img class="wd-img" src="/static/words/'+es(w.image_key)+'.jpg?t='+_wdImgVer+'" alt="" onload="this.classList.add(\'loaded\')" onerror="this.remove()">';
  h+='</div>';
  // Reveal block (only after answer)
  if(ans){
    var revealCls=ans==="correct"?"wd-reveal wd-reveal-ok":"wd-reveal wd-reveal-wrong";
    var revealLb=ans==="correct"?"✓ Correct":"Answer";
    h+='<div class="'+revealCls+'">';
    h+='<div class="wd-reveal-lb">'+revealLb+'</div>';
    h+='<div class="wd-src-row"><div class="wd-src-word">'+es(w.target_word)+'</div><button class="wd-speak" onclick="_speakWord(true)" aria-label="Pronounce">'+icon("speaker",16,2)+'</button></div>';
    if(w.target_ipa)h+='<div class="wd-src-ipa">'+es(w.target_ipa)+'</div>';
    // Source word + IPA below — gives full pair confirmation in both languages
    if(w.source_word){
      h+='<div class="wd-rev-divider"></div>';
      h+='<div class="wd-src-row wd-rev-sub"><div class="wd-src-word">'+es(w.source_word)+'</div><button class="wd-speak wd-speak-sm" onclick="_speakWord(false)" aria-label="Pronounce">'+icon("speaker",14,2)+'</button></div>';
      if(w.source_ipa)h+='<div class="wd-rev-sub-ipa">'+es(w.source_ipa)+'</div>';
    }
    if(ans==="wrong"&&_wordsState.lastAnswer)h+='<div class="wd-your-ans">You typed: <span>'+es(_wordsState.lastAnswer)+'</span></div>';
    h+='</div>';
  }else{
    h+='<div class="wd-prompt">Guess the '+targetLang+' word</div>';
  }
  // Both definitions
  h+='<div class="wd-divider"></div>';
  h+='<div class="wd-def-lb">'+targetLang+' definition</div>';
  h+='<div class="wd-def">'+es(w.target_def)+'</div>';
  h+='<div class="wd-def-lb" style="margin-top:12px">'+sourceLang+' definition</div>';
  h+='<div class="wd-def wd-def-sub">'+es(w.source_def)+'</div>';
  // Example sentence — toggle between target/source language via translate button.
  // Target side is masked (until answered); source side is the translation, always visible.
  var hasTgtEx=!!w.target_example, hasSrcEx=!!w.source_example;
  if(hasTgtEx||hasSrcEx){
    var canTr=hasTgtEx&&hasSrcEx;
    var useSrcEx=(_wordsState.showSourceExample&&hasSrcEx)||!hasTgtEx;
    var exText=useSrcEx?w.source_example:w.target_example;
    var exLang=useSrcEx?sourceLang:targetLang;
    var exShown=useSrcEx?es(exText):(ans?_highlightWord(exText,w.target_word):_blankExample(exText,w.target_word));
    h+='<div class="wd-ex-hd"><span class="wd-ex-lb">Example · '+exLang+'</span>';
    if(canTr)h+='<button class="wd-tr-btn '+(useSrcEx?"wd-tr-active":"")+'" onclick="_wdToggleExampleLang()" aria-label="Translate">'+icon("translate",13,2.2)+'</button>';
    h+='</div>';
    h+='<div class="wd-example">'+exShown+'</div>';
  }
  // Action area
  if(!ans){
    h+='<form onsubmit="_wdSubmit(event);return false" style="margin-top:18px"><input type="text" class="wd-input" id="wd-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type the '+targetLang+' word..."></form>';
    h+='<div class="wd-actions"><button class="btn btn-s wd-btn-skip" onclick="_wdDontKnow()">← '+tr("wd_dont_know")+'</button><button class="btn wd-btn-submit" onclick="_wdSubmit()">'+tr("wd_check")+'</button></div>';
  }else{
    h+='<button class="btn wd-next-btn" onclick="_wdNext()">Next →</button>';
  }
  h+='</div>';
  setTimeout(function(){if(!ans){var i=document.getElementById("wd-input");if(i)i.focus()}_wdAttachSwipe()},80);
  return h;
}
// Image cache buster — bumped on session start so newly uploaded images appear
// without a hard reload. Browser still respects normal Cache-Control.
var _wdImgVer=Date.now().toString(36).slice(-4);
// Mask the target word (incl. inflected forms) inside the example with underscores.
// Strategy: strip common Russian/English endings → stem (min 3 chars) → match stem + any alpha tail.
// Notes:
//   • JS \b doesn't fire on Cyrillic boundaries (since \w is ASCII-only).
//     Instead use a non-letter prefix capture group: (^|[^а-яёa-zA-ZА-ЯЁ])(stem + alpha tail).
//   • Russian endings list includes -ство and many noun/verb suffixes so the stem is short enough
//     to catch all inflected forms (любопытство/любопытства/любопытству etc.).
var _WD_ENDINGS=["ствами","ствам","ством","ствах","ствa","стве","ству","ства","ство",
                 "остях","остей","остями","ости","остью","ость",
                 "ениями","ениях","ениям","ениях","ении","ением","ения","ение","ений",
                 "аниями","аниях","аниям","ании","анием","ания","ание",
                 "ться","иться","иваться","ываться",
                 "ивать","ывать","евать","овать",
                 "ательно","ительно","ательный","ительный","ательная","ательное","ательные",
                 "ный","ная","ное","ные","ного","ной","ным","ными","ных",
                 "ий","ия","ие","ого","ому","ыми","ыми","ыми","ого","ому","ому",
                 "али","али","ала","ало","али","ат","ят","ит","ет","ют",
                 "ала","ило","ыла","ыло","или","ыли","ил","ыл","ил","ыл",
                 "ать","ять","еть","ить","оть","уть","ыть",
                 "ями","ям","ях","ой","ою","ое","ый","ом","ах","ам","ов","ев","ей",
                 "ии","иях","иям","ии","ии","ии","ие","ия","ых","ых","ого",
                 "ия","ие","ое","ть","ся","сь","ей","ей","ёт","ёт",
                 "ing","tions","tion","ities","ity","ness","ments","ment","fully","fulness",
                 "ful","less","ous","ive","able","ible","ical","ally","ies","ied",
                 "ed","es","s"];
function _wdStem(word){
  if(!word)return"";
  var s=word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  for(var i=0;i<_WD_ENDINGS.length;i++){
    var e=_WD_ENDINGS[i];
    if(s.length-e.length>=3&&s.endsWith(e)){s=s.slice(0,-e.length);break}
  }
  return s.length>=3?s:word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").slice(0,Math.min(4,word.length))
}
// Build a regex that matches the word stem at a position not preceded by a letter.
function _wdMatchRe(stem){
  var stemEsc=stem.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  // Group 1: boundary (start of string or any non-letter, including punctuation/space).
  // Group 2: the word itself (stem + alpha tail).
  return new RegExp("(^|[^а-яёa-zА-ЯЁA-Z])("+stemEsc+"[а-яёa-z']*)","gi");
}
function _blankExample(text,word){
  if(!text)return"";
  var stem=_wdStem(word);if(!stem)return es(text);
  var re=_wdMatchRe(stem);
  var stripText=text.normalize("NFD").replace(/[̀-ͯ]/g,"");
  var out="";var lastEnd=0;var m;
  while((m=re.exec(stripText))!==null){
    var matchStart=m.index+m[1].length;
    // Use the matched word's letter count for the number of underscores so the blank
    // visually matches the hidden word's length.
    var wordLen=m[2].length;
    var blanks=new Array(wordLen+1).join("_");
    out+=es(text.slice(lastEnd,matchStart))+'<span class="wd-blank">'+blanks+'</span>';
    lastEnd=matchStart+wordLen;
  }
  out+=es(text.slice(lastEnd));
  return out||es(text);
}
function _highlightWord(text,word){
  if(!text)return"";
  var stem=_wdStem(word);if(!stem)return es(text);
  var re=_wdMatchRe(stem);
  var stripText=text.normalize("NFD").replace(/[̀-ͯ]/g,"");
  var out="";var lastEnd=0;var m;
  while((m=re.exec(stripText))!==null){
    var matchStart=m.index+m[1].length;
    var matchEnd=matchStart+m[2].length;
    out+=es(text.slice(lastEnd,matchStart))+'<span class="wd-hl">'+es(text.slice(matchStart,matchEnd))+'</span>';
    lastEnd=matchEnd;
  }
  out+=es(text.slice(lastEnd));
  return out||es(text);
}
function _normWord(s){return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[ё]/g,"е").trim()}
function _wdSubmit(e){
  if(e&&e.preventDefault)e.preventDefault();
  var input=document.getElementById("wd-input");if(!input)return;
  var val=(input.value||"").trim();if(!val)return;
  var w=_wordsState.queue[_wordsState.cursor];if(!w)return;
  var correct=_normWord(val)===_normWord(w.target_word);
  hp(correct?"ok":"err");
  if(!correct){var card=document.getElementById("wd-card");if(card)card.classList.add("wd-shake")}
  _wordsState.answered=correct?"correct":"wrong";
  _wordsState.lastAnswer=val;
  // Update server. Counter increment only for first-time-correct
  A("POST","/api/words/answer",{idx:w.idx,mode:_wordsState.mode,correct:correct,answer:val});
  if(correct){_wordsState.sessionCorrect++;if(w.status!=="learned")_wordsState.stats.learned=(_wordsState.stats.learned||0)+1}
  // Re-render to show reveal block + Next button
  if(tab==="words")ren();
}
function _wdDontKnow(){
  var w=_wordsState.queue[_wordsState.cursor];if(!w)return;
  hp("warn");
  _wordsState.answered="wrong";
  _wordsState.lastAnswer="";
  A("POST","/api/words/answer",{idx:w.idx,mode:_wordsState.mode,correct:false});
  if(tab==="words")ren();
}
function _wdNext(){
  hp("light");
  _wordsState.answered=null;
  _wordsState.lastAnswer="";
  _wordsState.showSourceExample=false; // reset translation toggle per card
  _wordsState.cursor++;
  if(tab==="words")ren();
}
function _wdToggleExampleLang(){
  _wordsState.showSourceExample=!_wordsState.showSourceExample;
  hp("light");
  if(tab==="words")ren();
}
// _speakWord(useTarget) — when true, speaks the target word (reveal). Otherwise source.
function _speakWord(useTarget){
  if(!('speechSynthesis' in window)){hp("warn");return}
  var w=_wordsState.queue[_wordsState.cursor];if(!w)return;
  var raw=useTarget?w.target_word:w.source_word;
  var txt=(raw||"").normalize("NFD").replace(/[̀-ͯ]/g,"");
  // Lang: speak in the language of the spoken word
  var lang;
  if(_wordsState.mode==="en"){ lang=useTarget?"en-US":"ru-RU" }
  else                       { lang=useTarget?"ru-RU":"en-US" }
  try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(txt);u.lang=lang;u.rate=0.9;speechSynthesis.speak(u);hp("light")}catch(e){hp("warn")}
}
// Swipe gesture — left = don't know
function _wdAttachSwipe(){
  var card=document.getElementById("wd-card");if(!card||card._swipe)return;card._swipe=true;
  var start=null;
  card.addEventListener("touchstart",function(e){if(e.target&&e.target.tagName==="INPUT")return;start={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
  card.addEventListener("touchmove",function(e){if(!start)return;
    var dx=e.touches[0].clientX-start.x;var dy=e.touches[0].clientY-start.y;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>10){card.style.transform="translateX("+Math.min(0,dx)+"px) rotate("+(dx/50)+"deg)";card.style.opacity=1-Math.min(0.5,Math.abs(dx)/400)}
  },{passive:true});
  card.addEventListener("touchend",function(e){if(!start)return;var dx=e.changedTouches[0].clientX-start.x;start=null;
    if(dx<-80){card.style.transition="transform .3s,opacity .3s";card.style.transform="translateX(-120%) rotate(-15deg)";card.style.opacity=0;setTimeout(_wdDontKnow,260)}
    else{card.style.transition="transform .25s,opacity .25s";card.style.transform="";card.style.opacity="";setTimeout(function(){card.style.transition=""},250)}
  },{passive:true});
}
// Open the learning-language picker from main Settings → Learning section.
// Each family member picks their own language; stats then show every member in
// their own mode side-by-side.
async function openLearnModePicker(){
  hp("light");
  var curEn=_wordsState.mode==="en";
  var h='<div style="font-size:12px;color:var(--ht);text-align:center;margin-bottom:14px;line-height:1.4">Pick the language YOU want to learn.<br>Each family member can choose differently.</div>';
  h+='<div class="or">';
  h+='<button class="ob '+(curEn?"s":"")+'" onclick="_setLearnMode(\'en\')">🇬🇧 Learn English</button>';
  h+='<button class="ob '+(!curEn?"s":"")+'" onclick="_setLearnMode(\'ru\')">🇷🇺 Learn Russian</button>';
  h+='</div>';
  oMC(tr("mt_learning_lang"),h,{ic:"book"});
}
async function _setLearnMode(m){
  _wordsState.mode=m;hp("ok");
  await A("PATCH","/api/words/learn-mode",{mode:m});
  var me=_myMember();if(me)me.learn_mode=m;
  // Wipe in-memory session queue so the next Words open re-fetches in the new mode.
  _wordsState.cursor=0;_wordsState.queue=[];_wordsFirstLoad=true;
  cMo();
  // Re-render whichever tab we're on (Settings shows updated language label).
  ren();
  toast((m==="en"?"🇬🇧":"🇷🇺")+" "+(m==="en"?tr("wd_now_learning_en"):tr("wd_now_learning_ru")));
}
async function _resetWordsProgress(){
  var lang=_wordsState.mode==="en"?"English":"Russian";
  if(!confirm(tr("wd_reset_confirm",{lang:lang})))return;
  await A("POST","/api/words/reset?mode="+_wordsState.mode);
  hp("ok");toast("Progress reset for "+lang);
  loadWordsSession();
  // Refresh whichever tab we're on (Settings subtitle may change indirectly).
  ren();
}
async function openWordsStats(){
  hp("light");
  var d=await A("GET","/api/words/stats");
  if(!d){oMC(tr("mt_stats"),"<div>"+tr("wd_load_failed")+"</div>",{ic:"chart"});return}
  var h='<div style="font-size:11px;color:var(--ht);margin-bottom:10px;text-align:center">Each member’s progress in their own learning language</div>';
  d.members.forEach(function(m){
    var c=m.counts||{};
    var pct=d.total?Math.round((c.learned||0)/d.total*100):0;
    var isMe=m.user_id===d.my_id;
    var langFlag=m.mode==="en"?"🇬🇧":"🇷🇺";
    var langLabel=m.mode==="en"?"Learning English":"Learning Russian";
    h+='<div class="cat-row wd-stats-row" onclick="openMemberDetail('+m.user_id+',\''+m.mode+'\')"'+(isMe?' style="border:1.5px solid color-mix(in srgb,var(--pr) 45%,transparent);background:color-mix(in srgb,var(--pr) 8%,var(--cd))"':'')+'>';
    h+='<div class="cat-row-h"><span class="nm">'+mAv(m.user_id,22)+es(m.user_name)+(isMe?" (you)":"")+'</span><span class="vl">'+(c.learned||0)+' / '+d.total+'</span></div>';
    h+='<div style="font-size:11px;font-weight:600;color:var(--ht);margin:2px 0 6px;letter-spacing:.2px">'+langFlag+' '+langLabel+'</div>';
    h+='<div class="progress"><div class="progress-fill tone-ok" style="width:'+pct+'%"></div></div>';
    h+='<div style="font-size:11px;color:var(--ht);margin-top:6px;display:flex;justify-content:space-between;align-items:center"><span>'+(c.learning||0)+' learning · '+m.attempts+' attempts · '+m.accuracy+'% accuracy</span><span style="opacity:.6;font-size:14px">›</span></div>';
    h+='</div>';
  });
  oMC(tr("mt_stats"),h,{ic:"chart"});
}
// Member detail — Learned/Mistakes tabs. Mode is now passed from the stats row
// (each member can be on a different mode), with fallback to the viewer's mode.
var _wdDetailState={tab:"learned",data:null,name:"",uid:0,mode:"en"};
async function openMemberDetail(uid,mode){
  hp("light");
  var m=mode||_wordsState.mode;
  var d=await A("GET","/api/words/member-detail?user_id="+uid+"&mode="+m);
  if(!d)return;
  var member=(D.members||[]).find(function(x){return x.user_id===uid});
  _wdDetailState.data=d;_wdDetailState.tab="learned";_wdDetailState.uid=uid;_wdDetailState.mode=m;_wdDetailState.name=member?member.user_name:"";
  oMC(_wdDetailState.name||"Member",_wdDetailHtml(),{ic:"user"});
}
function _wdDetailHtml(){
  var s=_wdDetailState;var d=s.data;
  var nL=d.learned.length,nM=d.mistakes.length;
  var h='<div class="tabs"><button class="tab '+(s.tab==="learned"?"a":"")+'" onclick="_wdDetailSet(\'learned\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("ck",12,2.4)+'Learned · '+nL+'</span></button><button class="tab '+(s.tab==="mistakes"?"a":"")+'" onclick="_wdDetailSet(\'mistakes\')"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("bolt",12,2.4)+'Mistakes · '+nM+'</span></button></div>';
  var list=s.tab==="learned"?d.learned:d.mistakes;
  if(!list.length){
    h+='<div class="emp" style="padding:24px 14px">'+icon(s.tab==="learned"?"ck":"bolt",36,1.8)+'<div class="emp-t">'+(s.tab==="learned"?tr("wd_no_learned_t"):tr("wd_no_mistakes_t"))+'</div><div style="font-size:12px">'+(s.tab==="learned"?tr("wd_no_learned_s"):tr("wd_no_mistakes_s"))+'</div></div>';
    return h;
  }
  list.forEach(function(w){
    h+='<div class="wd-detail-row">';
    h+='<div class="wd-detail-words"><span class="wd-detail-tgt">'+es(w.target_word)+'</span><span class="wd-detail-sep"> · </span><span class="wd-detail-src">'+es(w.source_word)+'</span></div>';
    if(w.target_ipa)h+='<div class="wd-detail-ipa">'+es(w.target_ipa)+'</div>';
    h+='<div class="wd-detail-stat">'+w.correct_count+' / '+w.attempts+' · '+w.accuracy+'% accuracy</div>';
    h+='</div>';
  });
  return h;
}
function _wdDetailSet(tab){_wdDetailState.tab=tab;hp("sel");document.getElementById("mb").innerHTML=_wdDetailHtml()}

// ─── Words manager (Settings → Words modal) ──────────────────────────
var _wmState={all:[],query:""};
async function openWordsMgr(){
  hp("light");
  oMC(tr("mt_words"),"<div class=\"emp\" style=\"padding:30px 14px\"><div class=\"emp-i\" style=\"font-size:28px\">⏳</div><div>"+tr("g_loading")+"</div></div>",{ic:"book"});
  var d=await A("GET","/api/words/all");
  if(!d||!d.words){document.getElementById("mb").innerHTML="<div class=\"emp\" style=\"padding:30px\">Failed to load.</div>";return}
  _wmState.all=d.words;_wmState.query="";
  document.getElementById("mb").innerHTML=_wmListHtml();
}
function _wmListHtml(){
  var q=(_wmState.query||"").toLowerCase().trim();
  var list=_wmState.all;
  if(q){list=list.filter(function(w){return (w.en_word||"").toLowerCase().indexOf(q)>=0||(w.ru_word||"").toLowerCase().indexOf(q)>=0})}
  var h='<input class="inp" id="wm-q" placeholder="🔍 Search…" oninput="_wmSearch(this.value)" style="margin-bottom:14px" value="'+es(_wmState.query)+'">';
  h+='<div style="font-size:11px;color:var(--ht);text-align:center;margin-bottom:10px">'+list.length+' / '+_wmState.all.length+' words</div>';
  if(!list.length){h+='<div class="emp" style="padding:24px">'+tr("g_no_matches")+'</div>';return h}
  list.forEach(function(w){
    var imgHtml=w.image_key?'<img class="wm-thumb" src="/static/words/'+es(w.image_key)+'.jpg?t='+_wdImgVer+'" alt="" onerror="this.remove()">':'';
    h+='<div class="wm-row" onclick="openWordEdit('+w.idx+')">'+imgHtml+'<div class="wm-pair"><div class="wm-en">'+es(w.en_word||"—")+'</div><div class="wm-ru">'+es(w.ru_word||"—")+'</div></div><button class="bi" aria-label="Edit">'+I.ed+'</button></div>';
  });
  return h;
}
function _wmSearch(v){_wmState.query=v;var i=document.getElementById("wm-q");var sel=i?i.selectionStart:null;document.getElementById("mb").innerHTML=_wmListHtml();var i2=document.getElementById("wm-q");if(i2){i2.focus();if(sel!==null)i2.setSelectionRange(sel,sel)}}

// Editor modal — full card editing for one word
var _weState={idx:null,data:null};
async function openWordEdit(idx){
  hp("light");
  oMC(tr("mt_edit_word"),"<div class=\"emp\" style=\"padding:30px\"><div class=\"emp-i\">⏳</div><div>"+tr("g_loading")+"</div></div>",{ic:"book"});
  var d=await A("GET","/api/words/one/"+idx);
  if(!d){document.getElementById("mb").innerHTML="<div class=\"emp\" style=\"padding:30px\">Failed to load.</div>";return}
  _weState.idx=idx;_weState.data=d;
  document.getElementById("mb").innerHTML=_weEditorHtml();
}
function _weEditorHtml(){
  var d=_weState.data;
  var hasImg=!!d.image_key;
  var imgSrc=hasImg?'/static/words/'+es(d.image_key)+'.jpg?t='+Date.now().toString(36):'';
  var h='';
  // Image block
  h+='<div class="we-img-wrap">';
  h+='<div class="we-img" id="we-img-prev">';
  if(hasImg)h+='<img src="'+imgSrc+'" alt="" onerror="this.parentNode.classList.add(\'we-img-empty\');this.remove()" onload="this.parentNode.classList.remove(\'we-img-empty\')">';
  else h+='<span class="we-img-ph">'+es(d.emoji||"📖")+'</span>';
  h+='</div>';
  h+='<div class="we-img-actions">';
  h+='<label class="btn btn-s" style="margin:0;cursor:pointer"><input type="file" id="we-file" accept="image/*" style="display:none" onchange="_weUpload(this)">📷 Upload image</label>';
  h+='<button class="btn btn-s" style="background:transparent;color:var(--ac);border:1px solid color-mix(in srgb,var(--ac) 40%,transparent)" onclick="_weDeleteImg()">🗑 Remove</button>';
  h+='</div>';
  h+='</div>';
  // English block
  h+='<div class="lb">'+tr("wd_english")+'</div>';
  h+='<input class="inp" id="we-en-word" placeholder="Word" value="'+es(d.en_word||"")+'">';
  h+='<input class="inp" id="we-en-ipa" placeholder="IPA, e.g. /ˈɒmlət/" value="'+es(d.en_ipa||"")+'">';
  h+='<input class="inp" id="we-en-def" placeholder="Definition" value="'+es(d.en_def||"")+'">';
  h+='<input class="inp" id="we-en-ex" placeholder="Example sentence" value="'+es(d.en_example||"")+'">';
  // Russian block
  h+='<div class="lb" style="margin-top:14px">Русский</div>';
  h+='<input class="inp" id="we-ru-word" placeholder="Слово" value="'+es(d.ru_word||"")+'">';
  h+='<input class="inp" id="we-ru-ipa" placeholder="Транскрипция, [ам\'л\'э́т]" value="'+es(d.ru_ipa||"")+'">';
  h+='<input class="inp" id="we-ru-def" placeholder="Определение" value="'+es(d.ru_def||"")+'">';
  h+='<input class="inp" id="we-ru-ex" placeholder="Пример предложения" value="'+es(d.ru_example||"")+'">';
  // Emoji
  h+='<div class="lb" style="margin-top:14px">'+tr("g_emoji")+'</div>';
  h+='<input class="inp" id="we-emoji" value="'+es(d.emoji||"📖")+'" style="width:80px;text-align:center;font-size:22px">';
  h+='<div class="we-actions"><button class="btn btn-s" onclick="openWordsMgr()" style="background:transparent;color:var(--ht);border:1px solid var(--bd)">← '+tr("btn_back")+'</button><button class="btn" onclick="_weSave()">'+tr("btn_save")+'</button></div>';
  return h;
}
async function _weUpload(input){
  var f=input.files&&input.files[0];if(!f)return;
  if(f.size>15*1024*1024){toast(tr("ts_too_large"));return}
  hp("light");
  f=await _downscaleImage(f);
  var fd=new FormData();fd.append("file",f);
  var headers={};
  if(iD)headers["X-Telegram-Init-Data"]=iD;
  var sess=_getSess();if(sess)headers["X-Session-Token"]=sess;
  try{
    var r=await fetch("/api/words/one/"+_weState.idx+"/image",{method:"POST",headers:headers,body:fd});
    if(!r.ok){toast(tr("ts_upload_failed"));return}
    var d=await r.json();
    _weState.data.image_key=d.image_key;
    hp("ok");toast(tr("ts_image_saved"));
    // Refresh preview with cache-bust
    var prev=document.getElementById("we-img-prev");
    if(prev){prev.classList.remove("we-img-empty");prev.innerHTML='<img src="/static/words/'+es(d.image_key)+'.jpg?t='+Date.now()+'" alt="">'}
    // Bump global session-bust so card view also refreshes
    _wdImgVer=Date.now().toString(36).slice(-4);
  }catch(e){toast(tr("ts_upload_error"))}
}
async function _weDeleteImg(){
  if(!confirm(tr("g_remove_image_confirm")))return;
  var r=await A("DELETE","/api/words/one/"+_weState.idx+"/image");
  if(!r){toast(tr("ts_failed"));return}
  hp("ok");toast(tr("ts_image_removed"));
  var prev=document.getElementById("we-img-prev");
  if(prev){prev.classList.add("we-img-empty");prev.innerHTML='<span class="we-img-ph">'+es(_weState.data.emoji||"📖")+'</span>'}
  _wdImgVer=Date.now().toString(36).slice(-4);
}
async function _weSave(){
  var v=function(id){return (document.getElementById(id)||{}).value||""};
  var payload={
    en_word:v("we-en-word").trim(),
    ru_word:v("we-ru-word").trim(),
    en_ipa:v("we-en-ipa").trim(),
    ru_ipa:v("we-ru-ipa").trim(),
    en_def:v("we-en-def").trim(),
    ru_def:v("we-ru-def").trim(),
    en_example:v("we-en-ex").trim(),
    ru_example:v("we-ru-ex").trim(),
    emoji:v("we-emoji").trim()||"📖"
  };
  if(!payload.en_word||!payload.ru_word){toast(tr("ts_word_required"));return}
  hp("light");
  var r=await A("PATCH","/api/words/one/"+_weState.idx,payload);
  if(!r){toast(tr("ts_save_failed"));return}
  hp("ok");toast(tr("ts_saved"));
  // Refresh the local list so en/ru changes show
  var found=_wmState.all.find(function(w){return w.idx===_weState.idx});
  if(found){found.en_word=payload.en_word;found.ru_word=payload.ru_word;if(r.image_key)found.image_key=r.image_key}
  // Bust image cache for the card view
  _wdImgVer=Date.now().toString(36).slice(-4);
  openWordsMgr();
}
