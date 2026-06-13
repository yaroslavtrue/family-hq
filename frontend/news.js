// ═══════════════════════════════════════════════════════════════
// 📣 Moya — What's New + release timeline (v8.49.0)
// ═══════════════════════════════════════════════════════════════
// Single source of truth for user-facing release notes. Loaded BEFORE app.js.
// On init, app.js calls maybeShowWhatsNew() — if the user has never seen the
// latest entry, we show a modal once and stamp localStorage.
//
// The same data backs the Settings → Tips & News timeline (showAllNews()).
//
// Localized inline (title/items per language) — simpler than wiring every
// release into lang.js. Edit this file when you ship a meaningful feature.
// "Meaningful" = the user should know about it; bugfix-only releases are
// intentionally skipped from this log.

var WHATS_NEW = [
  {
    version: "v8.58.0",
    date: "2026-06-03",
    icon: "💕",
    big: true,
    title_en: "Love Points",
    title_ru: "Очки любви",
    items_en: [
      "A monthly love scoreboard for the two of you, on your Profile.",
      "Tap + to give your partner a point — say what it’s for and pick an emoji.",
      "Points are tallied per month; whoever leads wears a 👑.",
      "Tap Stats to see who gave what, and when.",
    ],
    items_ru: [
      "Ежемесячное «табло любви» для вас двоих — в Профиле.",
      "Жми + чтобы дать партнёру очко — поясни за что и выбери эмодзи.",
      "Очки считаются за месяц; у лидера — 👑.",
      "Кнопка Stats покажет, кто за что и когда дал очко.",
    ],
  },
  {
    version: "v8.57.0",
    date: "2026-06-02",
    icon: "🌌",
    big: true,
    title_en: "Life — balance & habits",
    title_ru: "Life — баланс и привычки",
    items_en: [
      "A new Life tab: a living graph of your life spheres — health, rest, career, relationship and more.",
      "Add habits to each sphere; checking them in lights up the graph and builds streaks.",
      "Journey shows your stats; Challenges let you set goals — solo, shared, or a manual +/− scoreboard.",
      "Active challenges also appear as a scoreboard on Home and Profile.",
    ],
    items_ru: [
      "Новая вкладка Life: живой граф сфер жизни — здоровье, отдых, карьера, отношения и другие.",
      "Добавляй привычки в сферы; отмечая их, ты зажигаешь граф и копишь серии.",
      "Journey показывает статистику; Challenges — цели: соло, общие или ручное табло со счётом +/−.",
      "Активные челленджи видны как табло на Главной и в Профиле.",
    ],
  },
  {
    version: "v8.49.11",
    date: "2026-06-01",
    icon: "⭐",
    title_en: "Cooking: sort & favorites",
    title_ru: "Кухня: сортировка и избранное",
    items_en: [
      "Tap the ♥ on any dish to favorite it.",
      "Filter the list to favorites only with the heart chip.",
      "Sort by Recent, Name, Cheapest, or Priciest per serving.",
    ],
    items_ru: [
      "Нажми ♥ на блюде, чтобы добавить в избранное.",
      "Фильтруй список по избранному кнопкой-сердечком.",
      "Сортируй: Новые, По имени, Дешевле, Дороже за порцию.",
    ],
  },
  {
    version: "v8.49.8",
    date: "2026-05-31",
    icon: "🏠",
    title_en: "Smarter Home screen",
    title_ru: "Умнее главный экран",
    items_en: [
      "Tap any task in “Upcoming” to edit, mark done, or see details — no need to open Tasks.",
      "Upcoming now shows only YOUR tasks (and shared ones), not your partner’s.",
      "Tasks are sorted by date — nearest deadlines on top.",
    ],
    items_ru: [
      "Нажми на задачу в «Скоро», чтобы отредактировать, отметить или посмотреть детали — без перехода в Задачи.",
      "В «Скоро» теперь только ВАШИ задачи (и общие), без задач партнёра.",
      "Задачи отсортированы по дате — ближайшие сверху.",
    ],
  },
  {
    version: "v8.49.4",
    date: "2026-05-26",
    icon: "📷",
    title_en: "Plants: take photos in-app",
    title_ru: "Цветы: фото прямо в приложении",
    items_en: [
      "Tap Update → take a photo with the built-in camera (or pick from gallery).",
      "Your newest photo becomes the plant’s cover automatically.",
      "Swipe the photo strip to browse the full growth history with dates.",
      "Claude’s health advice now shows inline under each photo.",
    ],
    items_ru: [
      "Нажми Update → сделай фото встроенной камерой (или выбери из галереи).",
      "Самое свежее фото автоматически становится обложкой растения.",
      "Листай ленту фото, чтобы видеть всю историю роста с датами.",
      "Советы Claude по здоровью теперь показываются прямо под каждым фото.",
    ],
  },
  {
    version: "v8.48.0", big: true,
    date: "2026-05-25",
    icon: "🍳",
    title_en: "Cooking tab",
    title_ru: "Раздел «Кухня»",
    items_en: [
      "Add dishes with photos, ingredient lists, and per-serving cost.",
      "Ingredient prices auto-fill from your Shopping list as you type.",
      "One tap to add every ingredient of a dish to the shopping list.",
      "“Refresh prices” pulls the latest shopping prices into a saved dish.",
    ],
    items_ru: [
      "Добавляй блюда с фото, ингредиентами и стоимостью порции.",
      "Цены ингредиентов подтягиваются из «Покупок» автоматически.",
      "Один тап — все ингредиенты блюда уходят в список покупок.",
      "«Обновить цены» обновит блюдо текущими ценами из покупок.",
    ],
  },
  {
    version: "v8.47.0",
    date: "2026-05-25",
    icon: "🧭",
    title_en: "Customizable bottom navigation",
    title_ru: "Своё нижнее меню",
    items_en: [
      "Pick 3–5 tabs for your bottom bar from a catalog of 12.",
      "Per-member preference — you and your partner can have different setups.",
      "Tabs not in the bottom bar live in the hamburger menu instead.",
    ],
    items_ru: [
      "Выбери 3–5 вкладок для нижнего меню из 12 возможных.",
      "Настройка персональная — у каждого свой вариант.",
      "Вкладки, которых нет внизу, лежат в боковом меню.",
    ],
  },
  {
    version: "v8.46.0",
    date: "2026-05-24",
    icon: "🩺",
    title_en: "Plant health check",
    title_ru: "Проверка здоровья растений",
    items_en: [
      "Tap “Update” on a plant — snap a photo and Claude Sonnet diagnoses its condition.",
      "You get a status, plain-language summary, and concrete advice if something’s off.",
      "All update photos are saved to the growth timeline.",
    ],
    items_ru: [
      "Нажми «Update» — сфотографируй цветок, Claude Sonnet проверит его состояние.",
      "Получишь статус, краткое описание и советы, если что-то не так.",
      "Все фотографии остаются в таймлайне роста растения.",
    ],
  },
  {
    version: "v8.42.0", big: true,
    date: "2026-05-20",
    icon: "🪴",
    title_en: "Plants tab",
    title_ru: "Раздел «Цветы»",
    items_en: [
      "Family-shared plant care: avatar carousel, big card with watering log.",
      "AI species identification on photo upload (Claude Sonnet vision).",
      "Watering reminders, growth timeline, history graph.",
    ],
    items_ru: [
      "Уход за цветами для всей семьи: карусель аватаров, карточка с журналом полива.",
      "AI определяет вид растения по фото (Claude Sonnet).",
      "Напоминания о поливе, таймлайн роста, график истории.",
    ],
  },
  {
    version: "v8.39.0", big: true,
    date: "2026-05-15",
    icon: "📚",
    title_en: "Vocabulary tab",
    title_ru: "Раздел «Слова»",
    items_en: [
      "English ↔ Russian vocabulary trainer right inside Moya.",
      "Per-user progress (new / learning / learned) — independent for each direction.",
      "Add custom words via the Telegram bot.",
    ],
    items_ru: [
      "Учим English ↔ Русский прямо в Moya.",
      "Личный прогресс (new / learning / learned), отдельно для каждого направления.",
      "Добавляй свои слова через Telegram-бота.",
    ],
  },
  {
    version: "v8.34.0",
    date: "2026-05-10",
    icon: "🌐",
    title_en: "Russian language",
    title_ru: "Русский язык",
    items_en: [
      "Full interface translation. Switch in Settings → Language.",
      "Per-member preference; doesn’t affect your spouse.",
    ],
    items_ru: [
      "Интерфейс переведён полностью. Переключение в Settings → Language.",
      "Настройка персональная — не влияет на партнёра.",
    ],
  },
  {
    version: "v8.0.0", big: true,
    date: "2026-04-25",
    icon: "🏋️",
    title_en: "Trainings tab",
    title_ru: "Раздел «Тренировки»",
    items_en: [
      "Strength workouts: log sets/reps/weight, see tonnage and progress.",
      "Reusable templates per member or family-shared.",
      "Trainings replaced Shopping in the bottom nav (Shopping moved to the hamburger).",
    ],
    items_ru: [
      "Силовые тренировки: сеты/повторы/вес, тоннаж и прогресс.",
      "Шаблоны: личные или семейные.",
      "Тренировки заняли место «Покупок» в нижнем меню (покупки переехали в боковое).",
    ],
  },
];

// Read/write of the "last seen" version. localStorage isn't critical here —
// worst case the modal shows once more, no big deal.
// Key bumped to _v2 with the carousel (v8.59.0) so the new multi-slide tour of
// big features shows once for everyone, even users who'd seen the old single card.
function _newsSeenVersion(){
  try { return localStorage.getItem("fhq_seen_news_v2") || "" } catch(e){ return "" }
}
function _newsSetSeen(v){
  try { localStorage.setItem("fhq_seen_news_v2", v||"") } catch(e){}
}

// Entries the user hasn't seen yet (newer than their last-seen version),
// ordered OLDEST→NEWEST so the carousel progresses chronologically and ends on
// the latest release. For a brand-new user (no seen marker) we show only the
// marquee features (big:true) to avoid a 12-slide wall. Capped at 6.
function _newsUnseenEntries(){
  if(!WHATS_NEW.length) return [];
  var seen = _newsSeenVersion();
  var unseen = [];
  for(var i=0;i<WHATS_NEW.length;i++){
    if(WHATS_NEW[i].version === seen) break;  // reached what they've seen
    unseen.push(WHATS_NEW[i]);
  }
  if(!seen){                                   // brand-new user → big ones only
    var big = unseen.filter(function(e){ return e.big });
    if(big.length) unseen = big;
  }
  return unseen.slice(0, 6).reverse();         // oldest → newest
}

// Carousel state.
var _nwSlides = [], _nwIdx = 0;

// Show the "What's New" carousel for unseen releases. Called from app.js init()
// once family/status loaded. Skips if everything's already been seen.
function maybeShowWhatsNew(){
  setTimeout(function(){
    var list = _newsUnseenEntries();
    if(!list.length) return;
    _nwSlides = list; _nwIdx = 0;
    // Stamp the latest as seen up-front so it won't re-pop even if closed early.
    _newsSetSeen(WHATS_NEW[0].version);
    oMC(tr("news_whatsnew"), _newsSlideHtml(), {ic:"bolt"});
  }, 600);
}

// Render the current slide (body only — reused on every navigation).
function _newsSlideHtml(){
  var entry = _nwSlides[_nwIdx], n = _nwSlides.length, last = (_nwIdx === n-1);
  var lang = (_lang === "ru") ? "ru" : "en";
  var title = entry["title_"+lang] || entry.title_en || "";
  var items = entry["items_"+lang] || entry.items_en || [];
  var h = '<div class="nw-slide">';
  h += '<div class="nw-hero"><div class="nw-icon">'+(entry.icon||"✨")+'</div>';
  h += '<div class="nw-eyebrow">'+tr("news_whatsnew")+' · '+es(entry.version)+'</div>';
  h += '<div class="nw-title">'+es(title)+'</div>';
  h += '<div class="nw-date">'+_newsFmtDate(entry.date)+'</div>';
  h += '</div>';
  h += '<ul class="nw-list">';
  items.forEach(function(it){ h += '<li>'+es(it)+'</li>' });
  h += '</ul>';
  h += '</div>';
  // Dots — one per slide, current highlighted, tappable.
  if(n > 1){
    h += '<div class="nw-dots">';
    for(var i=0;i<n;i++) h += '<span class="nw-dot'+(i===_nwIdx?' a':'')+'" onclick="_newsGoto('+i+')"></span>';
    h += '</div>';
  }
  h += '<div class="nw-actions">';
  if(_nwIdx > 0) h += '<button class="btn-sec" onclick="_newsGoto('+(_nwIdx-1)+')">'+tr("news_back")+'</button>';
  else h += '<button class="btn-sec" onclick="showAllNews()">'+tr("news_see_all")+'</button>';
  if(last) h += '<button class="btn" onclick="_newsDismiss()">'+tr("news_got_it")+'</button>';
  else h += '<button class="btn" onclick="_newsGoto('+(_nwIdx+1)+')">'+tr("news_next")+'</button>';
  h += '</div>';
  return h;
}

// Navigate to slide i (re-renders just the modal body).
function _newsGoto(i){
  if(i < 0 || i >= _nwSlides.length) return;
  _nwIdx = i;
  if(typeof hp === "function") hp("sel");
  var mb = document.getElementById("mb");
  if(mb) mb.innerHTML = _newsSlideHtml();
}

// Settings → Tips & News opens this — full release history (newest first).
function showAllNews(){
  var lang = (_lang === "ru") ? "ru" : "en";
  var h = '<div class="nw-tl">';
  WHATS_NEW.forEach(function(entry){
    var title = entry["title_"+lang] || entry.title_en || "";
    var items = entry["items_"+lang] || entry.items_en || [];
    h += '<div class="nw-tl-row">';
    h += '<div class="nw-tl-spine"><div class="nw-tl-dot">'+(entry.icon||"✨")+'</div></div>';
    h += '<div class="nw-tl-body">';
    h += '<div class="nw-tl-head"><span class="nw-tl-v">'+es(entry.version)+'</span><span class="nw-tl-d">'+_newsFmtDate(entry.date)+'</span></div>';
    h += '<div class="nw-tl-t">'+es(title)+'</div>';
    h += '<ul class="nw-tl-l">';
    items.forEach(function(it){ h += '<li>'+es(it)+'</li>' });
    h += '</ul>';
    h += '</div>';
    h += '</div>';
  });
  h += '</div>';
  oMC(tr("news_timeline_title"), h, {ic:"bolt"});
}

function _newsDismiss(version){
  _newsSetSeen(version || (WHATS_NEW[0] && WHATS_NEW[0].version) || "");
  cMo();
}

function _newsFmtDate(iso){
  if(!iso) return "";
  try {
    var d = new Date(iso + "T12:00:00");
    var lang = (_lang === "ru") ? "ru-RU" : "en-US";
    return d.toLocaleDateString(lang, {year:"numeric", month:"short", day:"numeric"});
  } catch(e) { return iso }
}
