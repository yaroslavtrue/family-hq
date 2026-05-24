// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Weather subsystem (extracted from app.js in v8.38.0)
// ═══════════════════════════════════════════════════════════════
// Home weather card → tap → full forecast overlay (14-day grid + animated
// SVG icons from basmilius/weather-icons CDN). City search modal saves
// the family's coordinates to /api/settings.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from app.js: A(), tr(), icon(), es(), hp(), oMC(), cMo(), load(),
// FX.wCat, dN (locale-aware day names from _rebuildLocaleArrays).

function wIcon(lbl) { return (lbl || "🌤").split(" ")[0] }

// ─── Forecast page (full overlay) ────────────────────────
var _wxForecast = null, _wxLoading = false;

function openWeatherPage() {
  hp("light");
  document.getElementById("wx-mo").classList.add("open");
  if (!_wxForecast) loadWeatherForecast(); else renderWeatherPage()
}
function closeWeatherPage() {
  hp("light");
  document.getElementById("wx-mo").classList.remove("open")
}

async function loadWeatherForecast(force) {
  if (_wxLoading) return;
  _wxLoading = true;
  var url = "/api/weather/forecast?days=14" + (force ? "&refresh=1" : "");
  var d = await A("GET", url);
  _wxLoading = false;
  if (!d || d.error) { _wxForecast = { error: true }; renderWeatherPage(); return }
  _wxForecast = d; renderWeatherPage()
}

function renderWeatherPage() {
  var lbl = document.getElementById("wx-city-label");
  var body = document.getElementById("wx-body");
  var w = _wxForecast;
  if (!w) { body.innerHTML = '<div class="emp"><div class="emp-i" style="font-size:32px">⏳</div><div>' + tr("g_loading") + '</div></div>'; return }
  if (w.error) {
    lbl.textContent = tr("wx_no_location");
    body.innerHTML = '<div class="emp"><div class="emp-i" style="font-size:32px">🌍</div><div>' + tr("wx_set_city") + '</div><div style="margin-top:14px"><button class="btn" style="max-width:240px" onclick="openCitySearch()">' + tr("wx_choose_city") + '</button></div></div>';
    return;
  }
  lbl.textContent = w.city || "Belgrade";
  var days = (w.days || []).slice(0, 14);
  if (!days.length) { body.innerHTML = '<div class="emp"><div>' + tr("wx_no_forecast") + '</div></div>'; return }
  // Hero — today (big). Uses current weather (w.label) to stay in sync with the home card.
  // Today's daily summary (days[0]) covers the whole day's dominant weather and may differ from "now".
  var today = days[0];
  var cat = FX.wCat(w.label);
  var vdHtml = '<video class="wbg-vd" autoplay muted loop playsinline preload="metadata" onloadeddata="this.classList.add(\'loaded\');this.parentNode.classList.add(\'has-video\')" onerror="this.remove()"><source src="/static/weather/' + cat + '.mp4" type="video/mp4"></video><div class="wbg-vd-scrim"></div>';
  var h = '<div class="wx-hero wbg wbg-' + cat + '">' + vdHtml;
  h += '<div class="wx-hero-ico" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">' + wIconAnim(w.label, 72, true) + '</div>';
  h += '<div class="wx-hero-tx" style="text-shadow:0 1px 3px rgba(0,0,0,.5)"><div class="wx-hero-lb" style="color:rgba(255,255,255,.7)">' + tr("g_today") + '</div>';
  h += '<div class="wx-hero-temp" style="color:#fff">' + w.now + '°</div>';
  h += '<div class="wx-hero-sub" style="color:rgba(255,255,255,.88)">' + es(w.label || "") + ' · ' + tr("g_feels") + ' ' + w.feels + '°</div>';
  h += '<div class="wx-hero-range"><span class="hi" style="color:#fff">↑ ' + today.max + '°</span><span style="color:rgba(255,255,255,.75)">↓ ' + today.min + '°</span></div></div></div>';
  // 14-day grid (2 rows of 7)
  h += '<div class="wx-grid-lb">Next 2 weeks</div>';
  h += '<div class="wx-grid">';
  days.forEach(function (d, i) {
    var dt = new Date(d.date + "T12:00:00");
    var dow = dN[dt.getDay()];
    var dom = dt.getDate();
    var isToday = i === 0;
    h += '<div class="wx-day' + (isToday ? ' wx-today' : '') + '">';
    h += '<div class="wx-dow">' + dow + '</div>';
    h += '<div class="wx-dom">' + dom + '</div>';
    h += '<div class="wx-ico">' + wIconAnim(d.label, 26, false) + '</div>';
    h += '<div class="wx-max">' + d.max + '°</div>';
    h += '<div class="wx-min">' + d.min + '°</div>';
    h += '</div>';
  });
  h += '</div>';
  body.innerHTML = h;
}

async function refreshWeather() {
  hp("light");
  var btn = document.getElementById("wx-refresh-btn");
  if (btn) btn.classList.add("spinning");
  await loadWeatherForecast(true);
  await load();
  setTimeout(function () { if (btn) btn.classList.remove("spinning") }, 700);
}

// ─── City search modal — debounced geocode lookup ─────────────────
var _citySearchT = null;

function openCitySearch() {
  oMC(tr("mt_choose_city"),
    '<input class="inp" id="wx-q" placeholder="..." oninput="_searchCityDebounced(this.value)" autocomplete="off">' +
    '<div id="wx-results" style="margin-top:10px"></div>',
    { ic: "pin" });
}

function _searchCityDebounced(q) {
  if (_citySearchT) clearTimeout(_citySearchT);
  _citySearchT = setTimeout(function () { _doCitySearch(q) }, 280);
}

async function _doCitySearch(q) {
  q = (q || "").trim();
  var el = document.getElementById("wx-results");
  if (!el) return;
  if (q.length < 2) {
    el.innerHTML = '<div style="font-size:12px;color:var(--ht);text-align:center;padding:14px 8px">Type at least 2 characters</div>';
    return;
  }
  el.innerHTML = '<div style="font-size:12px;color:var(--ht);text-align:center;padding:14px 8px">' + tr("g_loading") + '</div>';
  var d = await A("GET", "/api/weather/geocode?q=" + encodeURIComponent(q));
  var results = (d && d.results) || [];
  if (!results.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--ht);text-align:center;padding:14px 8px">' + tr("wx_no_results") + '</div>';
    return;
  }
  var h = '';
  results.forEach(function (r) {
    var sub = [r.admin1, r.country].filter(Boolean).join(" · ");
    h += '<div class="wx-cs-row" data-name="' + es(r.name || "") + '" data-lat="' + r.lat + '" data-lon="' + r.lon + '" onclick="_selectCityEvt(this)"><div class="wx-cs-pin">' + icon("pin", 18, 2) + '</div><div class="wx-cs-bd"><div class="wx-cs-nm">' + es(r.name || "") + '</div><div class="wx-cs-mt">' + es(sub) + '</div></div></div>';
  });
  el.innerHTML = h;
}

function _selectCityEvt(el) {
  _selectCity(el.dataset.name, parseFloat(el.dataset.lat), parseFloat(el.dataset.lon));
}

async function _selectCity(name, lat, lon) {
  hp("ok");
  await A("PATCH", "/api/settings", { weather_city: name, weather_lat: lat, weather_lon: lon });
  cMo();
  _wxForecast = null;       // drop cache so next load fetches new city
  await load();              // refresh bundle (home card updates)
  await loadWeatherForecast(true); // force server-side weather cache refresh
}

// ─── Animated SVG icons (basmilius/weather-icons CDN) ─────────────
// Map a weather emoji to an animated SVG name; returns <img> tag with
// emoji fallback if CDN fails (offline / 404 / browser blocked).
function _wIconName(emoji, nightAware) {
  var hr = new Date().getHours();
  var night = nightAware && (hr < 6 || hr >= 20);
  var m = {
    "☀️": night ? "clear-night" : "clear-day", "☀": night ? "clear-night" : "clear-day",
    "🌤": night ? "partly-cloudy-night" : "partly-cloudy-day", "🌤️": night ? "partly-cloudy-night" : "partly-cloudy-day",
    "⛅": night ? "partly-cloudy-night" : "partly-cloudy-day", "☁": "cloudy", "☁️": "cloudy",
    "🌥": night ? "overcast-night" : "overcast-day", "🌥️": night ? "overcast-night" : "overcast-day",
    "🌦": "partly-cloudy-day-rain", "🌦️": "partly-cloudy-day-rain", "🌧": "rain", "🌧️": "rain",
    "⛈": "thunderstorms-rain", "⛈️": "thunderstorms-rain",
    "🌨": "snow", "🌨️": "snow", "❄": "snow", "❄️": "snow",
    "🌫": "fog", "🌫️": "fog", "🌙": "clear-night"
  };
  return m[emoji] || null;
}

function wIconAnim(lbl, size, nightAware) {
  var emoji = wIcon(lbl);
  var name = _wIconName(emoji, nightAware);
  var s = size || 40;
  if (!name) return '<span style="font-size:' + Math.round(s * .75) + 'px;line-height:1">' + emoji + '</span>';
  var fb = emoji.replace(/'/g, "&#39;");
  return '<img src="https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all/' + name + '.svg" width="' + s + '" height="' + s + '" loading="lazy" style="display:block" onerror="this.outerHTML=\'<span style=&quot;font-size:' + Math.round(s * .75) + 'px;line-height:1&quot;>' + fb + '</span>\'">';
}

function wDayName(ds) {
  var d = new Date(ds + "T12:00:00");
  return dN[d.getDay()];
}
