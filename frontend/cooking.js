// ═══════════════════════════════════════════════════════════════
// 🍳 Family HQ — Cooking tab (v8.48.0)
// ═══════════════════════════════════════════════════════════════
// Family dish book — 2-col card grid (image on top, name + cost/serving),
// tap a card to open the detail modal with the full ingredient list and a
// "Add to Shopping List" CTA. Ingredient prices auto-pulled from the latest
// matching shopping row when the user blurs the name field.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from earlier modules: D, fS, tr(), A(), hp(), toast(), es(),
// icon(), oMC(), cMo(), ren(), _downscaleImage().

// ─── State ────────────────────────────────────────────────────
var _ckSearch = "";
// Edit-modal draft. Cleared on cMo() or save.
//   { id: int|null, name, description, servings, cook_time_min, ingredients: [{name,quantity,unit,price}] , pendingImage: Blob|null }
var _ckDraft = null;
// Currently-open detail dish id — so the after-edit reload knows what to re-open.
var _ckDetailId = null;

// ─── List render ──────────────────────────────────────────────
function rCooking(){
  var list = D.dishes || [];
  var totalAll = list.reduce(function(s,d){ return s + (d.total_cost||0) }, 0);
  var cur = fS && fS.currency || "EUR";
  var h = '';
  // Header — total cost summary + search bar (rendered once; search re-renders body only)
  h += '<div class="ck-head">';
  h += '<div class="ck-head-row"><span class="ck-head-l">'+tr("ck_total_all")+'</span><span class="ck-head-v">'+_fmtMoney(totalAll, cur)+'</span></div>';
  h += '<div class="ck-search-row"><div class="ck-search">'+icon("home",16,2)
       .replace('viewBox="0 0 24 24"','viewBox="0 0 24 24" style="opacity:.55"')+
       '<input type="text" id="ck-q" placeholder="'+tr("ck_search_ph")+'" value="'+es(_ckSearch)+'" oninput="_ckOnSearch(this.value)"></div></div>';
  h += '<div class="ck-sub" id="ck-sub"></div>';
  h += '</div>';
  // Body container — re-renders independently on search so the input keeps focus
  h += '<div id="ck-body">'+_ckBodyHtml()+'</div>';
  // Update sub-header counter after innerHTML hits the DOM
  setTimeout(_ckUpdateSub, 0);
  return h;
}

function _ckFiltered(){
  var list = D.dishes || [];
  var q = (_ckSearch || "").trim().toLowerCase();
  return q ? list.filter(function(d){ return (d.name||"").toLowerCase().indexOf(q) >= 0 }) : list;
}

function _ckUpdateSub(){
  var el = document.getElementById("ck-sub");
  if(!el) return;
  el.innerHTML = tr("ck_my_dishes")+'<span class="ck-cnt">'+_ckFiltered().length+'</span>';
}

function _ckBodyHtml(){
  var list = D.dishes || [];
  var filtered = _ckFiltered();
  var cur = fS && fS.currency || "EUR";
  if(!filtered.length){
    if(!list.length){
      return '<div class="emp" style="padding:50px 14px"><div class="emp-i" style="font-size:46px">🍜</div><div class="emp-t">'+tr("ck_no_dishes_t")+'</div><div style="font-size:13px;color:var(--ht);margin-top:6px">'+tr("ck_no_dishes_s")+'</div></div>';
    }
    return '<div class="emp" style="padding:30px 14px;color:var(--ht);text-align:center">'+tr("ck_no_match")+'</div>';
  }
  var h = '<div class="ck-grid">';
  filtered.forEach(function(d){
    var img = d.has_image ? '<img class="ck-c-img" src="/api/dishes/'+d.id+'/image?t='+(Date.parse(d.added_at)||"x")+'" alt="" onerror="this.style.display=\'none\'">' : '';
    var ph  = d.has_image ? '' : '<div class="ck-c-ph">🍽️</div>';
    var fav = d.favorite ? 'ck-c-fav-on' : '';
    h += '<button class="ck-c" onclick="openDish('+d.id+')">';
    h += '<div class="ck-c-imgwrap">'+img+ph+'<span class="ck-c-fav '+fav+'" onclick="event.stopPropagation();_ckToggleFav('+d.id+')" aria-label="Favorite">'+_ckHeart()+'</span></div>';
    h += '<div class="ck-c-body">';
    h += '<div class="ck-c-name">'+es(d.name||"")+'</div>';
    h += '<div class="ck-c-meta">';
    h += '<span class="ck-c-price">'+_fmtMoney(d.cost_per_serving||0,cur)+' <span class="ck-c-pu">/ '+tr("ck_serving")+'</span></span>';
    h += '<span class="ck-c-srv">'+icon("user",13,2)+' '+(d.servings||1)+'</span>';
    h += '</div>';
    h += '</div>';
    h += '</button>';
  });
  h += '</div>';
  return h;
}

function _ckOnSearch(v){
  _ckSearch = v;
  var b = document.getElementById("ck-body");
  if(b) b.innerHTML = _ckBodyHtml();
  _ckUpdateSub();
}
function _ckHeart(){ return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' }

// Locale-aware money formatter — uses fS.currency if known, falls back to plain "$X.XX".
function _fmtMoney(n, cur){
  cur = cur || "EUR";
  var symbols = {EUR:"€", USD:"$", GBP:"£", RUB:"₽", RSD:"din."};
  var s = symbols[cur] || cur+" ";
  var v = (Number(n)||0).toFixed(2);
  if(cur === "RSD") return v + " " + s;
  return s + v;
}

// ─── Detail view (modal) ──────────────────────────────────────
async function openDish(did){
  var d = await A("GET","/api/dishes/"+did);
  if(!d || !d.id){ toast(tr("ts_error")); return }
  _ckDetailId = did;
  oMC(d.name||"", _ckDetailHtml(d), {ic:"home"});
  // Override the modal icon spot with a dish icon via DOM (chef hat fallback emoji).
  var ic = document.querySelector("#mt3 .mt2-ico");
  if(ic) ic.innerHTML = '🍽️';
}

function _ckDetailHtml(d){
  var cur = fS && fS.currency || "EUR";
  var img = d.has_image ? '<img class="ck-d-img" src="/api/dishes/'+d.id+'/image?t='+(Date.parse(d.added_at)||"x")+'" alt="">' : '<div class="ck-d-ph">🍽️</div>';
  var h = '';
  h += '<div class="ck-d-hero">'+img+'<button class="ck-d-fav '+(d.favorite?'ck-c-fav-on':'')+'" onclick="_ckToggleFav('+d.id+',true)" aria-label="Favorite">'+_ckHeart()+'</button></div>';
  h += '<div class="ck-d-titlerow">';
  h += '<div><div class="ck-d-name">'+es(d.name||"")+'</div>';
  h += '<div class="ck-d-price">'+_fmtMoney(d.cost_per_serving,cur)+' <span style="color:var(--ht);font-weight:500">/ '+tr("ck_serving")+'</span></div></div>';
  h += '<div class="ck-d-srv">'+icon("user",14,2)+' '+(d.servings||1)+' '+tr("ck_servings_short")+'</div>';
  h += '</div>';
  if(d.description) h += '<div class="ck-d-desc">'+es(d.description)+'</div>';
  // Cost + cook time pills
  h += '<div class="ck-d-stats">';
  h += '<div class="ck-d-stat"><div class="ck-d-stat-l">'+tr("ck_total_cost")+'</div><div class="ck-d-stat-v">'+_fmtMoney(d.total_cost,cur)+'</div></div>';
  if(d.cook_time_min){
    h += '<div class="ck-d-sep"></div>';
    h += '<div class="ck-d-stat"><div class="ck-d-stat-l">'+icon("clock",13,2)+' '+tr("ck_cook_time")+'</div><div class="ck-d-stat-v">'+d.cook_time_min+' min</div></div>';
  }
  h += '</div>';
  // Ingredients header + refresh-prices button
  h += '<div class="ck-d-ihead"><span>'+tr("ck_ingredients")+'</span><button class="ck-d-refresh" onclick="_ckRefreshPrices('+d.id+')">'+tr("ck_prices_from")+' '+icon("refresh",12,2)+'</button></div>';
  // Ingredient rows
  h += '<div class="ck-d-list">';
  (d.ingredients||[]).forEach(function(ing){
    var qty = (ing.quantity!=null?ing.quantity:'') + (ing.unit?' '+ing.unit:'');
    var price = ing.price!=null ? _fmtMoney(ing.price,cur) : '—';
    h += '<div class="ck-d-i">';
    h += '<div class="ck-d-i-info"><div class="ck-d-i-n">'+es(ing.name||"")+'</div><div class="ck-d-i-q">'+es(qty)+'</div></div>';
    h += '<div class="ck-d-i-p">'+price+'</div>';
    h += '</div>';
  });
  h += '</div>';
  // Edit / Delete actions
  h += '<div class="ck-d-actions">';
  h += '<button class="btn-sec" onclick="_ckOpenEdit('+d.id+')">'+icon("ed",14,2)+' '+tr("btn_edit")+'</button>';
  h += '<button class="btn-sec" style="color:var(--ac)" onclick="_ckDelete('+d.id+')">'+icon("tr",14,2)+' '+tr("btn_delete")+'</button>';
  h += '</div>';
  // Big CTA
  h += '<button class="ck-d-cta" onclick="_ckToShopping('+d.id+')"><span>'+tr("ck_add_to_shop")+'</span><span>'+_fmtMoney(d.total_cost,cur)+'</span></button>';
  return h;
}

async function _ckToShopping(did){
  var r = await A("POST","/api/dishes/"+did+"/add-to-shopping",{folder_id:null});
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  hp("ok");
  toast(trn("ck_added_n", r.count));
  // Refresh shopping list silently for next tab visit
  A("GET","/api/shopping").then(function(s){ if(s) D.shopping = s });
}

async function _ckToggleFav(did, fromDetail){
  var d = (D.dishes||[]).find(function(x){return x.id===did});
  var newVal = d ? !d.favorite : true;
  var r = await A("PATCH","/api/dishes/"+did,{favorite:newVal});
  if(!r || !r.id){ toast(tr("ts_error")); return }
  if(d) d.favorite = newVal;
  hp("sel");
  // Re-render the part we're in
  if(fromDetail){
    // Update the icon state in the open modal
    var b = document.querySelector(".ck-d-fav");
    if(b) b.classList.toggle("ck-c-fav-on", !!newVal);
  } else {
    var c = document.getElementById("ct"); if(c) c.innerHTML = rCooking();
  }
}

async function _ckDelete(did){
  if(!confirm(tr("ck_delete_confirm"))) return;
  var r = await A("DELETE","/api/dishes/"+did);
  if(!r || !r.ok){ toast(tr("ts_error")); return }
  D.dishes = (D.dishes||[]).filter(function(x){return x.id!==did});
  cMo(); hp("warn"); toast(tr("ts_deleted"));
  var c = document.getElementById("ct"); if(c) c.innerHTML = rCooking();
}

// ─── Edit / Add modal ─────────────────────────────────────────
function _ckOpenAdd(){
  _ckDraft = { id:null, name:"", description:"", servings:2, cook_time_min:null,
               ingredients:[], pendingImage:null };
  oMC(tr("ck_add_dish"), _ckEditHtml(), {ic:"home"});
  var ic = document.querySelector("#mt3 .mt2-ico");
  if(ic) ic.innerHTML = '➕';
}

async function _ckOpenEdit(did){
  var d = await A("GET","/api/dishes/"+did);
  if(!d || !d.id){ toast(tr("ts_error")); return }
  _ckDraft = {
    id: d.id, name: d.name||"", description: d.description||"",
    servings: d.servings||2, cook_time_min: d.cook_time_min||null,
    ingredients: (d.ingredients||[]).map(function(i){
      return {name:i.name||"", quantity:i.quantity, unit:i.unit||"", price:i.price};
    }),
    pendingImage: null,
    has_image: !!d.has_image,
  };
  oMC(tr("ck_edit_dish"), _ckEditHtml(), {ic:"home"});
  var ic = document.querySelector("#mt3 .mt2-ico");
  if(ic) ic.innerHTML = '✏️';
}

function _ckEditHtml(){
  var d = _ckDraft || {};
  var cur = fS && fS.currency || "EUR";
  var imgPreview = '';
  if(d.pendingImage){
    imgPreview = '<img id="ck-e-imgprev" src="" alt="">';
    // Async URL injection (FileReader)
    setTimeout(function(){
      try{
        var r = new FileReader();
        r.onload = function(e){ var el=document.getElementById("ck-e-imgprev"); if(el) el.src = e.target.result };
        r.readAsDataURL(d.pendingImage);
      }catch(e){}
    }, 0);
  } else if(d.id && d.has_image){
    imgPreview = '<img id="ck-e-imgprev" src="/api/dishes/'+d.id+'/image?t='+Date.now()+'" alt="">';
  } else {
    imgPreview = '<div class="ck-e-img-plus">+</div>';
  }
  var h = '';
  // Image picker
  h += '<div class="ck-e-imgpick" onclick="_ckPickImage()">'+imgPreview+'</div>';
  // Name + servings + cook time
  h += '<div class="lb">'+tr("ck_dish_name")+'</div>';
  h += '<input class="inp" id="ck-e-n" placeholder="'+tr("ck_dish_name_ph")+'" value="'+es(d.name||"")+'" oninput="_ckDraft.name=this.value">';
  h += '<div class="dr">';
  h += '<div><div class="dl">'+tr("ck_servings")+'</div><input class="inp" id="ck-e-s" type="number" min="1" max="20" value="'+(d.servings||2)+'" oninput="_ckDraft.servings=parseInt(this.value||\'1\')"></div>';
  h += '<div><div class="dl">'+tr("ck_cook_time_min")+'</div><input class="inp" id="ck-e-ct" type="number" min="0" max="600" placeholder="'+tr("ck_optional")+'" value="'+(d.cook_time_min||"")+'" oninput="_ckDraft.cook_time_min=this.value?parseInt(this.value):null"></div>';
  h += '</div>';
  // Description
  h += '<div class="lb">'+tr("ck_description")+' <span style="color:var(--ht);font-weight:400">('+tr("ck_optional")+')</span></div>';
  h += '<textarea class="inp" id="ck-e-d" rows="2" oninput="_ckDraft.description=this.value" placeholder="'+tr("ck_desc_ph")+'">'+es(d.description||"")+'</textarea>';
  // Ingredients
  h += '<div class="ck-e-ihead"><span>'+tr("ck_ingredients")+'</span><span style="color:var(--ht);font-size:12px">'+tr("ck_prices_from")+'</span></div>';
  h += '<div id="ck-e-ilist">' + _ckIngsHtml() + '</div>';
  h += '<button class="ck-e-iadd" onclick="_ckAddIng()">'+icon("pl",14,2)+' '+tr("ck_add_ingredient")+'</button>';
  // Estimated cost preview
  h += '<div class="ck-e-est"><span>'+tr("ck_est_cost")+'</span><span id="ck-e-est-v">'+_fmtMoney(_ckEstTotal(),cur)+'</span></div>';
  // Save
  h += '<button class="btn" style="margin-top:14px" onclick="_ckSave()">'+tr("btn_save")+'</button>';
  return h;
}

function _ckEstTotal(){
  var d = _ckDraft || {};
  return (d.ingredients||[]).reduce(function(s,i){return s+(Number(i.price)||0)},0);
}

function _ckIngsHtml(){
  var d = _ckDraft || {};
  var cur = fS && fS.currency || "EUR";
  if(!d.ingredients || !d.ingredients.length){
    return '<div class="ck-e-iempty">'+tr("ck_no_ings")+'</div>';
  }
  return d.ingredients.map(function(ing,idx){
    return '<div class="ck-e-i">'+
      '<input class="ck-e-i-n" placeholder="'+tr("ck_ing_name")+'" value="'+es(ing.name||"")+'" oninput="_ckIngEdit('+idx+',\'name\',this.value)" onblur="_ckLookupPrice('+idx+')">'+
      '<input class="ck-e-i-q" placeholder="'+tr("ck_qty")+'" type="number" step="0.01" min="0" value="'+(ing.quantity!=null?ing.quantity:'')+'" oninput="_ckIngEdit('+idx+',\'quantity\',this.value)">'+
      '<input class="ck-e-i-u" placeholder="'+tr("ck_unit")+'" value="'+es(ing.unit||"")+'" oninput="_ckIngEdit('+idx+',\'unit\',this.value)">'+
      '<input class="ck-e-i-p" placeholder="'+_fmtMoney(0,cur)+'" type="number" step="0.01" min="0" value="'+(ing.price!=null?ing.price:'')+'" oninput="_ckIngEdit('+idx+',\'price\',this.value)">'+
      '<button class="ck-e-i-x" onclick="_ckRemIng('+idx+')" aria-label="Remove">'+icon("x",13,2)+'</button>'+
    '</div>';
  }).join("");
}

function _ckIngEdit(idx, field, val){
  if(!_ckDraft || !_ckDraft.ingredients[idx]) return;
  if(field === "quantity" || field === "price"){
    _ckDraft.ingredients[idx][field] = val === "" ? null : Number(val);
  } else {
    _ckDraft.ingredients[idx][field] = val;
  }
  // Update est total cheaply (only price field changes affect it)
  if(field === "price"){
    var el = document.getElementById("ck-e-est-v");
    if(el) el.textContent = _fmtMoney(_ckEstTotal(), fS && fS.currency || "EUR");
  }
}

function _ckAddIng(){
  if(!_ckDraft) return;
  _ckDraft.ingredients.push({name:"",quantity:null,unit:"",price:null});
  var el = document.getElementById("ck-e-ilist");
  if(el) el.innerHTML = _ckIngsHtml();
}

function _ckRemIng(idx){
  if(!_ckDraft) return;
  _ckDraft.ingredients.splice(idx,1);
  var el = document.getElementById("ck-e-ilist");
  if(el) el.innerHTML = _ckIngsHtml();
  var ev = document.getElementById("ck-e-est-v");
  if(ev) ev.textContent = _fmtMoney(_ckEstTotal(), fS && fS.currency || "EUR");
}

// Auto-fill price from shopping when the user blurs the name field. We only overwrite
// the price when it's currently empty — never clobber an explicit user value.
async function _ckLookupPrice(idx){
  if(!_ckDraft || !_ckDraft.ingredients[idx]) return;
  var ing = _ckDraft.ingredients[idx];
  if(!ing.name || !ing.name.trim()) return;
  if(ing.price != null) return;  // don't overwrite explicit price
  var r = await A("GET","/api/dishes/price-lookup?name="+encodeURIComponent(ing.name));
  if(!r || r.price == null) return;
  ing.price = r.price;
  // Re-render the row's price input only
  var rows = document.querySelectorAll(".ck-e-i");
  if(rows[idx]){
    var pInput = rows[idx].querySelector(".ck-e-i-p");
    if(pInput) pInput.value = r.price;
  }
  var ev = document.getElementById("ck-e-est-v");
  if(ev) ev.textContent = _fmtMoney(_ckEstTotal(), fS && fS.currency || "EUR");
  hp("sel");
}

// "Refresh prices" inside the detail view — pulls latest shopping prices for each
// ingredient and patches the dish so the new cost sticks.
async function _ckRefreshPrices(did){
  var d = await A("GET","/api/dishes/"+did);
  if(!d) return;
  var ings = d.ingredients || [];
  var changed = 0;
  for(var i=0; i<ings.length; i++){
    var ing = ings[i];
    if(!ing.name) continue;
    var r = await A("GET","/api/dishes/price-lookup?name="+encodeURIComponent(ing.name));
    if(r && r.price != null && r.price !== ing.price){
      ings[i] = {name:ing.name, quantity:ing.quantity, unit:ing.unit, price:r.price};
      changed++;
    } else {
      ings[i] = {name:ing.name, quantity:ing.quantity, unit:ing.unit, price:ing.price};
    }
  }
  if(!changed){ toast(tr("ck_prices_unchanged")); return }
  await A("PATCH","/api/dishes/"+did, {ingredients: ings});
  toast(trn("ck_prices_updated", changed));
  hp("ok");
  // Re-open detail with fresh data
  var fresh = await A("GET","/api/dishes/"+did);
  if(fresh) document.getElementById("mb").innerHTML = _ckDetailHtml(fresh);
  // Update background list too
  var newList = await A("GET","/api/dishes");
  if(newList && newList.dishes){ D.dishes = newList.dishes }
}

// File picker — append <input> to DOM before .click() so iOS Telegram WebView
// reliably fires `change`. Same pattern as plants Update fix (v8.46.1).
function _ckPickImage(){
  var input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0";
  var done = false;
  var handle = async function(){
    if(done) return; done = true;
    try{
      var f = input.files && input.files[0];
      if(!f) return;
      f = await _downscaleImage(f);
      _ckDraft.pendingImage = f;
      // Re-render only the image preview
      var prev = document.querySelector(".ck-e-imgpick");
      if(prev){
        var r = new FileReader();
        r.onload = function(e){
          prev.innerHTML = '<img id="ck-e-imgprev" src="'+e.target.result+'" alt="">';
        };
        r.readAsDataURL(f);
      }
    } catch(e){
      console.error("[cooking] image pick error:", e);
    } finally {
      try{ input.remove() }catch(e){}
    }
  };
  input.addEventListener("change", handle);
  document.body.appendChild(input);
  input.click();
}

async function _ckSave(){
  var d = _ckDraft;
  if(!d){ return }
  if(!d.name || !d.name.trim()){ toast(tr("ck_name_required")); return }
  // Strip blank ingredient rows.
  var ings = (d.ingredients||[]).filter(function(i){ return (i.name||"").trim() });
  var body = {
    name: d.name.trim(),
    description: d.description || "",
    servings: d.servings || 1,
    cook_time_min: d.cook_time_min || null,
    ingredients: ings,
  };
  var saved;
  if(d.id){
    saved = await A("PATCH","/api/dishes/"+d.id, body);
  } else {
    saved = await A("POST","/api/dishes", body);
  }
  if(!saved || !saved.id){ toast(tr("ts_save_failed")); return }
  // Image upload (if any) — separate multipart endpoint
  if(d.pendingImage){
    var fd = new FormData();
    fd.append("file", d.pendingImage);
    try{
      var h = {};
      if(iD) h["X-Telegram-Init-Data"] = iD;
      var s = _getSess(); if(s) h["X-Session-Token"] = s;
      await fetch("/api/dishes/"+saved.id+"/image", {method:"POST", headers:h, body:fd});
    }catch(e){
      toast(tr("ck_img_upload_failed"));
    }
  }
  // Refresh list
  var newList = await A("GET","/api/dishes");
  if(newList && newList.dishes){ D.dishes = newList.dishes }
  hp("ok"); toast(tr("ts_saved"));
  _ckDraft = null;
  cMo();
  var c = document.getElementById("ct"); if(c) c.innerHTML = rCooking();
}
