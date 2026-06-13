// ═══════════════════════════════════════════════════════════════
// 🧭 Family HQ / Moya — Coachmark tour engine (v8.67.0)
// ═══════════════════════════════════════════════════════════════
// A spotlight + arrow onboarding tour. Plays ONCE per page on the first
// visit (localStorage flag per view), then never again unless the user
// taps "Replay tour" in Settings (replayTour()).
//
// Two flavours, same engine:
//   • Passive coachmarks  — home: weather → calendar → plants → tasks/events
//                           → bottom nav → side menu. Pure highlight + arrow.
//   • Interactive walkthrough — subs: drives the real "Add" modal open and
//                           steps through every field (name → amount → day →
//                           assignee → reminders → save).
//
// Loaded BEFORE app.js (window-scope var/function). Reads: _lang, hp(), and
// (during a tour only) feature functions like oMoSub()/cMo(). The auto-start
// hook lives in app.js (init + go); the engine is idempotent and guards
// against double-starts, open modals, and missing targets.
//
// Adding a new page tour = add an entry to TOURS below. The engine, CSS
// (#tour-* in index.html) and the Settings replay button need no changes.

// ─── Per-view "seen" flags ──────────────────────────────────────────
function _tourSeen(id){ try{ return localStorage.getItem("fhq_tour_"+id)==="1" }catch(e){ return false } }
function _tourMarkSeen(id){ try{ localStorage.setItem("fhq_tour_"+id,"1") }catch(e){} }
function _tourClearAll(){
  try{
    var rm=[];
    for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf("fhq_tour_")===0) rm.push(k); }
    rm.forEach(function(k){ localStorage.removeItem(k) });
  }catch(e){}
}

// ─── Small helpers ──────────────────────────────────────────────────
function _tourL(o){ if(!o) return ""; return o[_lang]||o.en||"" }
function _tourQ(sel){ try{ return document.querySelector(sel) }catch(e){ return null } }
function _tourVisible(el){ if(!el) return false; var r=el.getBoundingClientRect(); return r.width>2 && r.height>2 }
function _tourClamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v) }
function _tourModalOpen(){ return !!_tourQ("#mo.op") }
function _tourEnsureSubModal(){ if(!_tourModalOpen() && typeof oMoSub==="function") oMoSub() }
// The global FAB add-modal, dispatched per-tab by oMo() (tasks/money/shop/cooking).
function _tourEnsureAddModal(){ if(!_tourModalOpen() && typeof oMo==="function") oMo() }
function _tourCloseModal(){ if(_tourModalOpen() && typeof cMo==="function") cMo() }

// UI chrome labels (kept here, not lang.js — the engine owns its own strings).
var TOUR_UI = {
  back: {en:"Back",  ru:"Назад"},
  next: {en:"Next",  ru:"Далее"},
  done: {en:"Done",  ru:"Готово"},
  skip: {en:"Skip",  ru:"Пропустить"},
};
function _tourTxt(k){ return _tourL(TOUR_UI[k]) }

// ─── Tour registry ──────────────────────────────────────────────────
// step: { sel, ic, t:{en,ru}, b:{en,ru},
//         place:'auto'|'above'|'below'|'center',
//         scroll:false (skip scrollIntoView),
//         before:fn (run on show), after:fn (run on leave),
//         onNext:fn (run when advancing forward off this step),
//         delay:ms (wait after before() before measuring),
//         isLast:bool }
var TOURS = {
  home: { steps: [
    { sel:".wbg", ic:"🌤️",
      t:{en:"Weather",ru:"Погода"},
      b:{en:"Today's forecast and the days ahead. Tap it for the full week.",
         ru:"Прогноз на сегодня и ближайшие дни. Тап — полная неделя."} },
    { sel:"#cal-strip", ic:"🗓️",
      t:{en:"Your week",ru:"Календарь"},
      b:{en:"Tasks and events laid out by day. Tap any day for the full calendar.",
         ru:"Задачи и события по дням. Тапни день — откроется полный календарь."} },
    { sel:".hpw", ic:"🪴",
      t:{en:"Plants",ru:"Цветы"},
      b:{en:"Care for your plants together. Watering reminders and growth history live here.",
         ru:"Уход за растениями всей семьёй — напоминания о поливе и история роста."} },
    { sel:"[data-tour=up],.ghost-card", ic:"📋",
      t:{en:"Tasks & events",ru:"Задачи и события"},
      b:{en:"Your next 7 days at a glance. Tap an empty card to create your first one.",
         ru:"Ближайшие 7 дней одним взглядом. Тапни пустую карточку — создашь первую запись."} },
    { sel:".nv", ic:"🧭", place:"above", scroll:false,
      t:{en:"Bottom menu",ru:"Нижнее меню"},
      b:{en:"Switch between your main sections here.",
         ru:"Здесь переключаешься между основными разделами."} },
    { sel:'[onclick="toggleMenu()"]', ic:"☰", place:"below", scroll:false,
      t:{en:"More sections",ru:"Боковое меню"},
      b:{en:"Everything else lives here: money, cooking, workouts and more.",
         ru:"Всё остальное — финансы, кухня, тренировки и другое — в этом меню."} },
  ]},

  subs: { steps: [
    { sel:'[onclick="oMoSub()"]', ic:"➕", scroll:false,
      before:_tourCloseModal,
      onNext:function(){ if(typeof oMoSub==="function") oMoSub() },
      t:{en:"Add a subscription",ru:"Добавь подписку"},
      b:{en:"Let's create your first one together. Tap Next and the form will open.",
         ru:"Давай создадим первую вместе. Нажми «Далее» — откроется форма."} },
    { sel:"#su-n", ic:"✏️", delay:430, before:_tourEnsureSubModal,
      t:{en:"Name it",ru:"Название"},
      b:{en:"Type what you're paying for, e.g. Netflix or Spotify.",
         ru:"Впиши, за что платишь, например Netflix или Spotify."} },
    { sel:"#su-a", ic:"💶", before:_tourEnsureSubModal,
      t:{en:"Amount & currency",ru:"Сумма и валюта"},
      b:{en:"Enter the price and pick the currency. Totals are shown in euros too.",
         ru:"Укажи цену и выбери валюту. Итог считается ещё и в евро."} },
    { sel:"#su-d", ic:"📅", before:_tourEnsureSubModal,
      t:{en:"Billing day",ru:"День списания"},
      b:{en:"The day of the month you get charged. We count down to it on Home.",
         ru:"Число месяца, когда списывают деньги — на Главной появится отсчёт."} },
    { sel:"#sap", ic:"👤", before:_tourEnsureSubModal,
      t:{en:"Who pays",ru:"Кто платит"},
      b:{en:"Assign the subscription to you or your partner.",
         ru:"Назначь подписку на себя или партнёра."} },
    { sel:"#srl", ic:"🔔", before:_tourEnsureSubModal,
      t:{en:"Reminders",ru:"Напоминания"},
      b:{en:"Get a nudge a few days before. Add or remove reminders here.",
         ru:"Получишь напоминание за пару дней — добавляй или убирай их здесь."} },
    { sel:'[onclick="doNewSub()"]', ic:"💾", isLast:true, before:_tourEnsureSubModal,
      t:{en:"Save it",ru:"Сохрани"},
      b:{en:"Tap here and your subscription is tracked. That's the whole flow!",
         ru:"Нажми — и подписка под контролем. Вот и весь процесс!"} },
  ]},

  // ── Interactive create-flows (drive the FAB add-modal) ──────────────
  tasks: { steps: [
    { sel:"#fab", ic:"➕", scroll:false, before:_tourCloseModal,
      onNext:function(){ if(typeof oMo==="function") oMo() },
      t:{en:"Add a task",ru:"Добавь задачу"},
      b:{en:"Let's add your first task together. Tap Next to open the form.",
         ru:"Создадим первую задачу вместе. Нажми «Далее» — откроется форма."} },
    { sel:"#f-t", ic:"✏️", delay:430, before:_tourEnsureAddModal,
      t:{en:"What to do",ru:"Что сделать"},
      b:{en:"Name the task, e.g. \"Pay rent\".",
         ru:"Впиши задачу, например «Оплатить аренду»."} },
    { sel:".ob-pri-normal", ic:"⚡", before:_tourEnsureAddModal,
      t:{en:"Priority",ru:"Приоритет"},
      b:{en:"Low, normal or high. High tasks are flagged with a warning.",
         ru:"Низкий, обычный или высокий. Важные помечаются предупреждением."} },
    { sel:"#f-dd", ic:"📅", before:_tourEnsureAddModal,
      t:{en:"Due date",ru:"Срок"},
      b:{en:"Set a deadline. It shows up on Home and the calendar.",
         ru:"Поставь дедлайн — появится на Главной и в календаре."} },
    { sel:"#ap", ic:"👤", before:_tourEnsureAddModal,
      t:{en:"Who does it",ru:"Кто делает"},
      b:{en:"Assign it to yourself or your partner.",
         ru:"Назначь на себя или партнёра."} },
    { sel:'[onclick="doTk()"]', ic:"💾", isLast:true, before:_tourEnsureAddModal,
      t:{en:"Save it",ru:"Сохрани"},
      b:{en:"Tap to add the task. Done!",
         ru:"Нажми — задача добавлена. Готово!"} },
  ]},

  money: { steps: [
    { sel:"#fab", ic:"➕", scroll:false, before:_tourCloseModal,
      onNext:function(){ if(typeof oMo==="function") oMo() },
      t:{en:"Add a transaction",ru:"Добавь операцию"},
      b:{en:"Let's record your first expense or income. Tap Next.",
         ru:"Запишем первую трату или доход. Нажми «Далее»."} },
    { sel:"#tb-exp", ic:"🔁", delay:430, before:_tourEnsureAddModal,
      t:{en:"Expense or income",ru:"Расход или доход"},
      b:{en:"Toggle between spending and earning.",
         ru:"Переключай между тратой и доходом."} },
    { sel:"#tx-a", ic:"💶", before:_tourEnsureAddModal,
      t:{en:"Amount",ru:"Сумма"},
      b:{en:"Enter the amount and pick the currency on the right.",
         ru:"Укажи сумму и выбери валюту справа."} },
    { sel:"#tx-cats", ic:"🏷️", before:_tourEnsureAddModal,
      t:{en:"Category",ru:"Категория"},
      b:{en:"Tap a category so your analytics stay tidy.",
         ru:"Выбери категорию — аналитика будет аккуратной."} },
    { sel:"#tx-dt", ic:"📅", before:_tourEnsureAddModal,
      t:{en:"Date",ru:"Дата"},
      b:{en:"Defaults to today; change it if needed.",
         ru:"По умолчанию сегодня; поменяй при необходимости."} },
    { sel:'[onclick="doTx()"]', ic:"💾", isLast:true, before:_tourEnsureAddModal,
      t:{en:"Save it",ru:"Сохрани"},
      b:{en:"Tap to record it.",
         ru:"Нажми — операция записана."} },
  ]},

  shop: { steps: [
    { sel:"#fab", ic:"➕", scroll:false, before:_tourCloseModal,
      onNext:function(){ if(typeof oMo==="function") oMo() },
      t:{en:"Add an item",ru:"Добавь покупку"},
      b:{en:"Let's add your first shopping item. Tap Next.",
         ru:"Создадим первую запись в списке. Нажми «Далее»."} },
    { sel:"#ns-n", ic:"🛒", delay:430, before:_tourEnsureAddModal,
      t:{en:"Item name",ru:"Что купить"},
      b:{en:"What to buy, e.g. \"Milk\".",
         ru:"Название, например «Молоко»."} },
    { sel:"#ns-q", ic:"🔢", before:_tourEnsureAddModal,
      t:{en:"Quantity",ru:"Количество"},
      b:{en:"Optional, e.g. \"1kg\" or \"2\".",
         ru:"Необязательно, напр. «1кг» или «2»."} },
    { sel:"#ns-p", ic:"💶", before:_tourEnsureAddModal,
      t:{en:"Price",ru:"Цена"},
      b:{en:"Optional. The total adds up at the top of the list.",
         ru:"Необязательно. Сумма считается сверху списка."} },
    { sel:'[onclick="doShNew()"]', ic:"💾", isLast:true, before:_tourEnsureAddModal,
      t:{en:"Save it",ru:"Сохрани"},
      b:{en:"Tap to add it to the list.",
         ru:"Нажми — добавлено в список."} },
  ]},

  cooking: { steps: [
    { sel:"#fab", ic:"➕", scroll:false, before:_tourCloseModal,
      onNext:function(){ if(typeof oMo==="function") oMo() },
      t:{en:"Add a dish",ru:"Добавь блюдо"},
      b:{en:"Let's create your first recipe. Tap Next.",
         ru:"Создадим первый рецепт. Нажми «Далее»."} },
    { sel:".ck-e-imgpick", ic:"📷", delay:430, before:_tourEnsureAddModal,
      t:{en:"Photo",ru:"Фото"},
      b:{en:"Tap to add a photo of the dish.",
         ru:"Нажми, чтобы добавить фото блюда."} },
    { sel:"#ck-e-n", ic:"✏️", before:_tourEnsureAddModal,
      t:{en:"Name",ru:"Название"},
      b:{en:"What's the dish called?",
         ru:"Как называется блюдо?"} },
    { sel:"#ck-e-s", ic:"🍽️", before:_tourEnsureAddModal,
      t:{en:"Servings",ru:"Порции"},
      b:{en:"How many it feeds, used for per-serving cost.",
         ru:"На сколько человек — для расчёта цены за порцию."} },
    { sel:"#ck-e-ilist", ic:"🥕", before:_tourEnsureAddModal,
      t:{en:"Ingredients",ru:"Ингредиенты"},
      b:{en:"Add ingredients; prices auto-fill from your shopping list.",
         ru:"Добавляй ингредиенты; цены подтянутся из покупок."} },
    { sel:'[onclick="_ckSave()"]', ic:"💾", isLast:true, before:_tourEnsureAddModal,
      t:{en:"Save it",ru:"Сохрани"},
      b:{en:"Tap to save the dish.",
         ru:"Нажми — блюдо сохранено."} },
  ]},

  // ── Passive overviews (custom create flows: just point things out) ──
  profile: { steps: [
    { sel:".fb2", ic:"👥", scroll:false,
      t:{en:"Whose profile",ru:"Чей профиль"},
      b:{en:"See the whole family or one person's stats.",
         ru:"Смотри всю семью или статистику одного человека."} },
    { sel:"#love-prof", ic:"💕",
      t:{en:"Love Points",ru:"Очки любви"},
      b:{en:"Your monthly love scoreboard. Give a point with +.",
         ru:"Ваше табло любви за месяц. Дай очко кнопкой +."} },
    { sel:".prof-widget", ic:"📊",
      t:{en:"Your stats",ru:"Твоя статистика"},
      b:{en:"Tasks, words, workouts and more at a glance.",
         ru:"Задачи, слова, тренировки и другое — одним взглядом."} },
  ]},

  plants: { steps: [
    { sel:".pl-av-add", ic:"🪴", scroll:false,
      t:{en:"Add a plant",ru:"Добавь растение"},
      b:{en:"Snap a photo and we'll identify the species for you.",
         ru:"Сфотографируй — мы определим вид за тебя."} },
    { sel:".pl-card", ic:"🌿",
      t:{en:"Your plant",ru:"Твоё растение"},
      b:{en:"Watering status, growth stage and a bit of personality.",
         ru:"Полив, стадия роста и немного характера."} },
    { sel:'[onclick^="_plWater"]', ic:"💧",
      t:{en:"Water it",ru:"Полей"},
      b:{en:"One tap logs watering. We'll remind you when it's thirsty.",
         ru:"Один тап отмечает полив. Напомним, когда захочет пить."} },
  ]},

  life: { steps: [
    { sel:"#life-cv", ic:"🌌", scroll:false,
      t:{en:"Your life graph",ru:"Граф жизни"},
      b:{en:"Your spheres orbit you. Tap a node to tend its habits.",
         ru:"Сферы вращаются вокруг тебя. Тапни узел, чтобы отметить привычку."} },
    { sel:'[onclick="_lifeToggleJourney()"]', ic:"📈", scroll:false,
      t:{en:"Journey",ru:"Journey"},
      b:{en:"Your balance and streaks over time.",
         ru:"Твой баланс и серии во времени."} },
    { sel:'[onclick="_lifeToggleChall()"]', ic:"🏆", scroll:false,
      t:{en:"Challenges",ru:"Challenges"},
      b:{en:"Set goals: solo, shared, or a friendly scoreboard.",
         ru:"Ставь цели: соло, общие или дружеское табло."} },
  ]},
};

// ─── Engine state ───────────────────────────────────────────────────
var TOUR = { active:false, id:null, steps:[], i:0, dir:1, _root:null };

// Build the overlay DOM once per run.
function _tourEnsureDom(){
  if(TOUR._root) return;
  var root=document.createElement("div"); root.id="tour-root";
  root.innerHTML =
    '<div id="tour-catch"></div>'+
    '<div id="tour-hole"></div>'+
    '<div id="tour-arrow">'+
      '<svg viewBox="0 0 40 50" fill="none" aria-hidden="true">'+
        '<path d="M20 46 C 8 36, 11 19, 20 8" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>'+
        '<path d="M11 16 L20 6 L29 16" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'+
      '</svg>'+
    '</div>'+
    '<div id="tour-card"></div>';
  document.body.appendChild(root);
  // Swallow taps outside the card so the user follows the guided steps and
  // can't accidentally dismiss the underlying modal.
  root.querySelector("#tour-catch").addEventListener("click", function(e){ e.stopPropagation(); });
  TOUR._root=root;
  window.addEventListener("resize", _tourReposition);
  window.addEventListener("orientationchange", _tourReposition);
}

function _tourTeardown(){
  if(TOUR._root){ try{ TOUR._root.remove() }catch(e){} TOUR._root=null; }
  window.removeEventListener("resize", _tourReposition);
  window.removeEventListener("orientationchange", _tourReposition);
}

// ─── Public: maybe auto-start a per-view tour ───────────────────────
// Returns true if a tour was (or will be) started, so callers can avoid
// stacking other first-run popups (e.g. What's New) on top of it.
function tourMaybe(view){
  if(TOUR.active) return false;
  if(!TOURS[view] || !TOURS[view].steps.length) return false;
  if(_tourSeen(view)) return false;
  if(_tourModalOpen()) return false;       // don't fight an already-open modal
  // let async widgets / view paint settle (Life builds its canvas + chrome lazily)
  var d = (view==="home") ? 500 : (view==="life" ? 800 : 250);
  setTimeout(function(){ startTour(view); }, d);
  return true;
}

// ─── Public: start (or replay) a tour for a view ────────────────────
function startTour(view){
  var t=TOURS[view];
  if(!t || !t.steps.length) return;
  if(TOUR.active) return;                   // already running — ignore
  TOUR.active=true; TOUR.id=view; TOUR.steps=t.steps; TOUR.i=0; TOUR.dir=1;
  _tourMarkSeen(view);                      // stamp up-front so it won't re-pop
  _tourEnsureDom();
  _tourShow();
}

// ─── Public: replay from Settings ───────────────────────────────────
function replayTour(){
  _tourClearAll();
  if(TOUR.active) _tourEnd(false);
  if(typeof cMo==="function") cMo();
  // Jump to Home and let the go() hook restart the home tour from scratch.
  if(typeof go==="function") go("home");
  else tourMaybe("home");
}

// ─── Navigation ─────────────────────────────────────────────────────
function _tourNav(delta){
  var cur=TOUR.steps[TOUR.i];
  if(cur){
    if(cur.after){ try{ cur.after() }catch(e){} }
    if(delta>0 && cur.onNext){ try{ cur.onNext() }catch(e){} }
  }
  TOUR.dir = delta<0 ? -1 : 1;
  var ni=TOUR.i+delta;
  if(ni>=TOUR.steps.length){ return _tourEnd(true); }
  if(ni<0) ni=0;
  TOUR.i=ni;
  _tourShow();
}

// Target missing/hidden → keep moving in the current direction.
function _tourSkipMissing(){
  var ni=TOUR.i+TOUR.dir;
  if(ni<0 || ni>=TOUR.steps.length) return _tourEnd(true);
  TOUR.i=ni;
  _tourShow();
}

function _tourShow(){
  _tourEnsureDom();
  var st=TOUR.steps[TOUR.i];
  if(!st) return _tourEnd(true);
  if(st.before){ try{ st.before() }catch(e){} }
  setTimeout(function(){
    if(!TOUR.active) return;
    var st2=TOUR.steps[TOUR.i]; if(!st2) return;
    var el = st2.sel ? _tourQ(st2.sel) : null;
    if(st2.sel && !_tourVisible(el)) return _tourSkipMissing();
    if(el && st2.scroll!==false){ try{ el.scrollIntoView({block:"center",inline:"nearest"}); }catch(e){} }
    // Render text first so the card has its real height before we place it.
    _tourRenderCard(st2);
    requestAnimationFrame(function(){
      setTimeout(function(){
        if(!TOUR.active) return;
        _tourReposition();
        if(typeof hp==="function") hp("sel");
      }, (el && st2.scroll!==false) ? 110 : 0);
    });
  }, st.delay||0);
}

// Re-measure the current target and lay out hole + card + arrow.
function _tourReposition(){
  if(!TOUR.active || !TOUR._root) return;
  var st=TOUR.steps[TOUR.i]; if(!st) return;
  var hole=TOUR._root.querySelector("#tour-hole");
  var card=TOUR._root.querySelector("#tour-card");
  var arrow=TOUR._root.querySelector("#tour-arrow");
  var vw=window.innerWidth, vh=window.innerHeight;
  var el = st.sel ? _tourQ(st.sel) : null;
  var hasEl = _tourVisible(el);
  var rect = hasEl ? el.getBoundingClientRect()
                   : {left:vw/2-90, top:vh*0.42, width:180, height:64, bottom:vh*0.42+64, right:vw/2+90};

  // Spotlight hole.
  var pad = (st.pad!=null) ? st.pad : 8;
  if(hasEl && st.place!=="center"){
    var hx=_tourClamp(rect.left-pad, 4, vw-12);
    var hy=_tourClamp(rect.top-pad, 4, vh-12);
    var hw=Math.min(rect.width+pad*2, vw-8-hx);
    var hh=Math.min(rect.height+pad*2, vh-8-hy);
    hole.style.display="block";
    hole.style.left=hx+"px"; hole.style.top=hy+"px";
    hole.style.width=hw+"px"; hole.style.height=hh+"px";
  } else {
    hole.style.display="none";
  }

  // Card placement.
  var cw=card.offsetWidth, ch=card.offsetHeight, gap=18;
  var place=st.place||"auto";
  var below, cardTop;
  if(place==="center" || !hasEl){
    below=true;
    cardTop=_tourClamp(vh*0.5 - ch/2, 12, vh-ch-12);
  } else if(place==="above"){
    below=false; cardTop=rect.top-pad-gap-ch;
  } else if(place==="below"){
    below=true;  cardTop=rect.bottom+pad+gap;
  } else {
    below = (rect.bottom+gap+ch <= vh-12) || (rect.top-gap-ch < 12);
    cardTop = below ? rect.bottom+pad+gap : rect.top-pad-gap-ch;
  }
  cardTop=_tourClamp(cardTop, 10, vh-ch-10);
  var cardLeft=_tourClamp(rect.left+rect.width/2 - cw/2, 12, vw-cw-12);
  card.style.left=cardLeft+"px"; card.style.top=cardTop+"px";

  // Arrow in the gap between card and hole.
  if(place==="center" || !hasEl){
    arrow.style.display="none";
  } else {
    arrow.style.display="block";
    arrow.className = below ? "" : "down";
    var ax=_tourClamp(rect.left+rect.width/2 - 19, cardLeft+12, cardLeft+cw-50);
    var ay;
    if(below){ ay=(rect.bottom + cardTop)/2 - 23; }
    else     { ay=(cardTop+ch + rect.top)/2 - 23; }
    ay=_tourClamp(ay, 2, vh-50);
    arrow.style.left=ax+"px"; arrow.style.top=ay+"px";
  }
}

// Render the card body (icon, title, copy, dots, controls).
function _tourRenderCard(st){
  var card=TOUR._root.querySelector("#tour-card"); if(!card) return;
  var n=TOUR.steps.length, i=TOUR.i, last=(i===n-1)||st.isLast;
  var dots=""; for(var k=0;k<n;k++) dots+='<span class="tour-dot'+(k===i?" a":"")+'"></span>';
  var back = i>0 ? '<button class="tour-bk" onclick="_tourNav(-1)">'+_tourTxt("back")+'</button>' : "";
  var nextLbl = last ? _tourTxt("done") : _tourTxt("next");
  card.innerHTML =
    '<button class="tour-skip" onclick="_tourEnd(false)">'+_tourTxt("skip")+'</button>'+
    (st.ic ? '<div class="tour-ic">'+st.ic+'</div>' : '')+
    '<div class="tour-t">'+_tourL(st.t)+'</div>'+
    '<div class="tour-b">'+_tourL(st.b)+'</div>'+
    '<div class="tour-ft"><div class="tour-dots">'+dots+'</div>'+back+
    '<button class="tour-nx" onclick="_tourNav(1)">'+nextLbl+'</button></div>';
}

function _tourEnd(){
  var cur=TOUR.steps[TOUR.i];
  if(cur && cur.after){ try{ cur.after() }catch(e){} }
  TOUR.active=false; TOUR.id=null; TOUR.steps=[]; TOUR.i=0;
  _tourTeardown();
}
