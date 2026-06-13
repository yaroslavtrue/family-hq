// ═══════════════════════════════════════════════════════════════
// 🏠 Family HQ — Money tab (extracted from app.js in v8.43.0)
// ═══════════════════════════════════════════════════════════════
// Transactions tab + Analytics tab + edit modals + chart + month nav.
// Receipt items, subscription handling within Money also live here.
//
// Loaded BEFORE app.js. All declarations are var/function (window-scope).
// Reads from earlier modules: D, fS, tr(), trn(), A(), hp(), toast(),
// es(), icon(), oMC(), cMo(), ren(), mAv(), mName(), fD(), assignPk(),
// _assign (global), _moneySummary, _anaCache (declared inside this file).

// Money sub-tab (was in app.js `let` block, now window-scope so money.js owns it).
var moneyTab = "transactions";

// ═══════════════════════════════════════════════════════════
// MONEY — Transactions | Subs | Analytics
// ═══════════════════════════════════════════════════════════
function rMoney(){
var h='<div class="tabs"><button class="tab '+(moneyTab==="transactions"?"a":"")+'" onclick="moneyTab=\'transactions\';ren()"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("arrowUpDown",13,2.2)+tr("m_transactions")+'</span></button><button class="tab '+(moneyTab==="analytics"?"a":"")+'" onclick="moneyTab=\'analytics\';ren()"><span style="display:inline-flex;align-items:center;gap:6px">'+icon("chart",13,2.2)+tr("m_analytics")+'</span></button></div>';
if(moneyTab==="analytics")return h+rAnalytics();
return h+rTransactions()}

function rTransactions(){
var txs=D.transactions;if(searchQ)txs=txs.filter(function(x){return matchQ(x.description)});
if(filt)txs=txs.filter(function(x){return x.member_id===filt});
var cats={};D.categories.forEach(function(c){cats[c.id]=c});
// Tiles always use server-aggregated CURRENT-MONTH totals so the Transactions tab
// agrees with Analytics. Frontend used to sum all 100 bundle rows (mixed months).
// Reads from the shared _anaCache keyed by month — current month entry stays valid
// regardless of where Analytics is navigated.
var _curM=_curYM();
if(!_anaCache[_curM])_loadCurMonthSummary();
var s=_anaCache[_curM]||null;
var loading=!s;
var tInc=loading?null:s.income, tExp=loading?null:s.expense, bal=loading?null:s.balance;
var monthLbl=s?new Date(s.month+"-01T00:00:00").toLocaleString("en-US",{month:"long",year:"numeric"}):"";
var h='';
if(monthLbl)h+='<div style="text-align:center;font-size:10px;color:var(--ht);font-weight:700;letter-spacing:.6px;text-transform:uppercase;margin-bottom:8px">'+monthLbl+'</div>';
function _tv(v){return v===null?'<span style="opacity:.4">…</span>':'€'+v.toFixed(0)}
// Balance is a running account total (v8.50.0) — show plain "€X", only a
// minus sign when overdrawn. The leading "+" that suited a per-month delta
// would read oddly for an account balance.
function _bv(v){if(v===null)return _tv(null);return (v<0?"−€":"€")+Math.abs(v).toFixed(0)}
h+='<div class="sts sts-3">';
h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("trendUp",16,2.2)+'</div><div class="st-lb">'+tr("m_income_label")+'</div><div class="st-vl pos">'+_tv(tInc)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-ac">'+icon("trendDown",16,2.2)+'</div><div class="st-lb">'+tr("m_expense_label")+'</div><div class="st-vl neg">'+_tv(tExp)+'</div></div>';
h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("wallet",16,2.2)+'</div><div class="st-lb">'+tr("m_balance_label")+'</div><div class="st-vl '+(bal===null?"":(bal>=0?"pos":"neg"))+'">'+_bv(bal)+'</div></div>';
h+='</div>';
if(!txs.length)return h+emCta(icon("wallet",48,1.8),tr("es_no_txs_t"),tr("es_no_txs_s"),"oMo()",tr("btn_add"));
// Member filter row — hidden in single mode (1 member).
if((D.members||[]).length>1){
h+='<div class="fb2"><button class="fi '+(!filt?"a":"")+'" onclick="filt=null;ren()">'+tr("g_filter_all")+'</button>';
D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';
}
// Transaction rows as .lc cards: category emoji on tinted gradient (green for income, coral for expense), description as title, date + member as meta, signed amount pill on the right
txs.forEach(function(tx){
  var cat=cats[tx.category_id];
  var isInc=tx.type==="income";
  var sign=isInc?"+":"−";
  var amtPillCls=isInc?"tone-ok":"tone-ac";
  var icoCls=isInc?"acc-ok":"acc-ac";
  var emoji=cat?cat.emoji:(isInc?"💰":"💸");
  var catName=cat?cat.name:(isInc?"Income":"Expense");
  var title=tx.description?es(tx.description):catName;
  var meta=fD(tx.date).full;
  var riCnt=(D.txItems||{})[tx.id]?D.txItems[tx.id].length:0;
  var riBadge=riCnt?' <span class="pdate" style="background:color-mix(in srgb,var(--pr) 14%,transparent);color:var(--pr)">'+icon("receipt",10,2)+riCnt+'</span>':"";
  h+='<div class="lc">';
  h+='<div class="lc-i '+icoCls+'">'+emoji+'</div>';
  h+='<div class="lc-bd"><div class="lc-tt">'+title+'</div><div class="lc-mt">'+(tx.description?catName+' · ':'')+meta+' '+mChip(tx.member_id,true)+riBadge+'</div></div>';
  h+='<span class="lc-rt '+amtPillCls+'">'+sign+tx.amount+' '+tx.currency+'</span>';
  h+='<button class="bi" onclick="openReceipt('+tx.id+')" title="Split receipt" style="margin-left:4px">'+icon("receipt",15,2)+'</button>';
  h+='<button class="bi" onclick="edTx('+tx.id+')">'+I.ed+'</button>';
  h+='<button class="bi" onclick="dlTx('+tx.id+')">'+I.tr+'</button>';
  h+='</div>';
});
return h}

async function dlTx(id){hp();await A("DELETE","/api/transactions/"+id);_moneySummary=null;_anaCache={};await load();toast("🗑 "+tr("ts_deleted"))}
function edTx(id){var tx=D.transactions.find(function(x){return x.id===id});if(!tx)return;_assign=tx.member_id||0;
var catOpts=D.categories.filter(function(c){return c.type===tx.type}).map(function(c){return '<button class="ob '+(tx.category_id===c.id?"s":"")+'" onclick="window._txCat='+c.id+';this.parentNode.querySelectorAll(\'.ob\').forEach(function(b){b.classList.remove(\'s\')});this.classList.add(\'s\')">'+c.emoji+" "+es(c.name)+'</button>'}).join("");
window._txCat=tx.category_id||0;window._txType=tx.type;
oMC(tr("m_edit_tx"),'<div class="dr"><div><div class="dl">'+tr("f_amount")+'</div><input class="inp" id="tx-a" type="number" step="0.01" value="'+tx.amount+'"></div><div><div class="dl">'+tr("f_currency")+'</div><select id="tx-c"><option value="RSD"'+(tx.currency==="RSD"?" selected":"")+'>din. RSD</option><option value="EUR"'+(tx.currency==="EUR"?" selected":"")+'>€ EUR</option><option value="USD"'+(tx.currency==="USD"?" selected":"")+'>$ USD</option><option value="GBP"'+(tx.currency==="GBP"?" selected":"")+'>£ GBP</option><option value="RUB"'+(tx.currency==="RUB"?" selected":"")+'>₽ RUB</option></select></div></div><div class="lb">'+tr("f_description")+'</div><input class="inp" id="tx-d" value="'+es(tx.description||"")+'"><div class="lb">'+tr("f_category")+'</div><div class="or">'+catOpts+'</div><div class="lb">'+tr("f_date")+'</div><input type="date" id="tx-dt" value="'+tx.date+'"><div class="lb">'+tr("g_who")+'</div>'+assignPk("txm",tx.member_id)+'<button class="btn" onclick="svTx('+id+')">Save</button>',{ic:"wallet"})}
async function svTx(id){var a=parseFloat(document.getElementById("tx-a").value);var c=document.getElementById("tx-c").value;var d=document.getElementById("tx-d").value.trim();var dt=document.getElementById("tx-dt").value;if(!a)return;await A("PUT","/api/transactions/"+id,{amount:a,currency:c,description:d,date:dt,category_id:window._txCat||null,member_id:_assign||null});cMo();hp();_moneySummary=null;_anaCache={};await load()}

// ─── Digest config modal ─────────────────────────────────────
var DIGEST_SECS=[
{id:"greeting",emoji:"☀️",name:"Greeting",color:"var(--wn)"},
{id:"weather",emoji:"🌤",name:"Weather Forecast",color:"#5bc0de"},
{id:"tasks_today",emoji:"📋",name:"Tasks Today",color:"var(--pr)"},
{id:"tasks_tomorrow",emoji:"📋",name:"Tasks Tomorrow",color:"var(--ok)"},
{id:"events",emoji:"📅",name:"Upcoming Events",color:"var(--ok)"},
{id:"subs",emoji:"💳",name:"Subscriptions",color:"var(--pr)"},
{id:"birthdays",emoji:"🎂",name:"Birthdays",color:"var(--wn)"},
{id:"plants",emoji:"🪴",name:"Plants to water",color:"var(--ok)"},
{id:"word_of_day",emoji:"📚",name:"Word of the Day (RU/EN)",color:"#a78bfa"},
{id:"tip",emoji:"💡",name:"Tip of the Day",color:"var(--ht)"}
];
var _dgOrder=null;

function _getDigestOrder(){
if(_dgOrder)return _dgOrder;
var saved=null;
try{saved=JSON.parse(D.settings.digest_sections||"null")}catch(e){}
// Each entry is {id: string, enabled: bool}. Backward compat: legacy format was bare strings.
var known={};DIGEST_SECS.forEach(function(s){known[s.id]=true});
if(saved&&Array.isArray(saved)){
  _dgOrder=saved
    .map(function(s){
      // Normalize: string → enabled by default; dict → preserve enabled
      if(typeof s==="string")return{id:s,enabled:true};
      return{id:s.id,enabled:s.enabled!==false};
    })
    .filter(function(o){return known[o.id]});
  // Auto-append any new sections (introduced after user last saved) at the end, enabled
  var present={};_dgOrder.forEach(function(o){present[o.id]=true});
  DIGEST_SECS.forEach(function(s){if(!present[s.id])_dgOrder.push({id:s.id,enabled:true})});
}
if(!_dgOrder||!_dgOrder.length)_dgOrder=DIGEST_SECS.map(function(s){return{id:s.id,enabled:true}});
return _dgOrder}

function openDigestCfg(){
// Deep copy so toggling/reordering inside the modal doesn't mutate the cached order before Save
_dgOrder=_getDigestOrder().map(function(o){return{id:o.id,enabled:o.enabled}});
oMC(tr("mt_morning_digest"),digestCfgHtml(),{ic:"bl"})}

function digestCfgHtml(){
var h='<div class="lb">Delivery Time</div><input type="time" id="dg-time" value="'+(D.settings.digest_time||"09:00")+'" step="60" style="margin-bottom:16px">';
h+='<div class="lb">Sections · tap toggle to disable</div>';
h+='<div id="dg-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">';
_dgOrder.forEach(function(entry,idx){
var sec=DIGEST_SECS.find(function(s){return s.id===entry.id});
if(!sec)return;
var en=entry.enabled!==false;
h+='<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--cd);border-radius:10px;border-left:3px solid '+sec.color+';opacity:'+(en?'1':'.45')+';transition:opacity .15s">';
h+='<span style="font-size:18px">'+sec.emoji+'</span>';
h+='<span style="flex:1;font-weight:500">'+sec.name+'</span>';
h+='<div class="tgs'+(en?' on':'')+'" onclick="dgToggle('+idx+')"><span class="tgs-knob"></span></div>';
if(idx>0)h+='<button class="bi" onclick="dgMove('+idx+',-1)" style="font-size:14px">▲</button>';
if(idx<_dgOrder.length-1)h+='<button class="bi" onclick="dgMove('+idx+',1)" style="font-size:14px">▼</button>';
h+='</div>'});
h+='</div>';
h+='<div class="lb">Test Send</div>';
h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
D.members.forEach(function(m){
h+='<button class="btn btn-s" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px" onclick="dgTest('+m.user_id+')">'+mAv(m.user_id,18)+es(m.user_name)+'</button>'});
h+='</div>';
h+='<button class="btn" onclick="dgSave()">Save</button>';
return h}

function dgMove(idx,dir){
var tmp=_dgOrder[idx];_dgOrder[idx]=_dgOrder[idx+dir];_dgOrder[idx+dir]=tmp;
document.getElementById("mb").innerHTML=digestCfgHtml()}

function dgToggle(idx){
_dgOrder[idx].enabled=!(_dgOrder[idx].enabled!==false);
hp("light");
document.getElementById("mb").innerHTML=digestCfgHtml()}

async function dgTest(uid){
var btn=event.target;btn.textContent="Sending...";btn.disabled=true;
// Save first
var tm=document.getElementById("dg-time").value;
await A("PATCH","/api/settings",{digest_time:tm,digest_sections:JSON.stringify(_dgOrder)});
D.settings.digest_time=tm;D.settings.digest_sections=JSON.stringify(_dgOrder);
await A("POST","/api/digest/test");
btn.textContent="Sent!";setTimeout(function(){openDigestCfg()},1000)}

async function dgSave(){
var tm=document.getElementById("dg-time").value;
await A("PATCH","/api/settings",{digest_time:tm,digest_sections:JSON.stringify(_dgOrder)});
D.settings.digest_time=tm;D.settings.digest_sections=JSON.stringify(_dgOrder);
cMo();toast("Digest saved");ren()}

// ─── Receipt / Split items ──────────────────────────────────
function openReceipt(txId){
var tx=D.transactions.find(function(x){return x.id===txId});if(!tx)return;
var sign=tx.type==="income"?"+":"−";
var title="📋 "+(tx.description?es(tx.description):"Receipt")+" — "+sign+tx.amount+" "+tx.currency;
oMC(title,receiptHtml(txId,tx))}

function _curSel(id,def){var curs=[["RSD","din."],["EUR","€"],["USD","$"],["GBP","£"],["RUB","₽"]];
var h='<select id="'+id+'" style="padding:10px 8px;background:var(--sf);color:var(--tx);border:1px solid var(--bd);border-radius:10px;font-size:14px;min-width:64px;height:44px">';
curs.forEach(function(c){h+='<option value="'+c[0]+'"'+(c[0]===def?' selected':'')+'>'+c[1]+'</option>'});
return h+'</select>'}

function receiptHtml(txId,tx){
var items=(D.txItems||{})[txId]||[];
var h='';
// Allocation progress
var alloc=0;items.forEach(function(it){alloc+=(it.quantity||1)*(parseFloat(it.amount)||0)});
var rem=tx.amount-alloc;var pct=tx.amount>0?Math.min(100,Math.round(alloc/tx.amount*100)):0;
var full=rem<=0&&items.length>0;
h+='<div style="margin-bottom:16px">';
h+='<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">';
h+='<span style="color:var(--ht)">Allocated: '+alloc.toFixed(0)+' '+tx.currency+'</span>';
h+='<span style="color:'+(full?'var(--ok)':'var(--wn)')+';font-weight:600">'+(full?'✓ Fully split':'Left: '+rem.toFixed(0)+' '+tx.currency)+'</span></div>';
h+='<div style="height:4px;background:var(--bd);border-radius:2px;overflow:hidden">';
h+='<div style="height:100%;width:'+pct+'%;background:'+(full?'var(--ok)':'var(--pr)')+';border-radius:2px;transition:width .3s"></div></div></div>';
// Item list (scrollable)
if(!items.length)h+='<div style="text-align:center;padding:20px 0;color:var(--ht);font-size:13px">No items yet. Break down this receipt.</div>';
else{h+='<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;padding-right:4px">';
items.forEach(function(it){
var qty=it.quantity||1;var qtyStr=qty>1?' x'+qty:'';var lineTotal=qty*parseFloat(it.amount||0);
h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--cd);border-radius:10px">';
h+='<span style="flex:1;font-size:14px">'+es(it.name)+qtyStr+'</span>';
h+='<span style="font-size:13px;color:var(--pr);font-weight:600;white-space:nowrap">'+lineTotal.toFixed(0)+' '+(it.currency||tx.currency)+'</span>';
h+='<button class="bi" style="padding:2px" onclick="edRi('+it.id+','+txId+')">'+I.ed+'</button>';
h+='<button class="bi" style="padding:2px" onclick="dRi('+it.id+','+txId+')">'+I.x+'</button>';
h+='</div>'});h+='</div>'}
// Add form — 3 rows: Name, Qty+Price+Currency, Add
h+='<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">';
h+='<input class="inp" id="ri-name" placeholder="Item name" onkeydown="if(event.key===\'Enter\')document.getElementById(\'ri-qty\').focus()">';
h+='<div class="dr"><div><div class="dl">'+tr("f_quantity")+'</div><input class="inp" id="ri-qty" type="number" min="1" value="1" placeholder="1"></div><div><div class="dl">'+tr("g_price_hint")+'</div><input class="inp" id="ri-amt" type="number" step="0.01" placeholder="0.00" onkeydown="if(event.key===\'Enter\')addRi('+txId+')"></div><div><div class="dl">'+tr("f_currency")+'</div>'+_curSel("ri-cur",tx.currency)+'</div></div>';
h+='<button class="btn" onclick="addRi('+txId+')">Add</button>';
h+='</div>';
return h}

async function addRi(txId){var n=document.getElementById("ri-name");if(!n||!n.value.trim())return;
var qty=parseInt(document.getElementById("ri-qty").value)||1;
var amt=parseFloat(document.getElementById("ri-amt").value)||0;
var cur=document.getElementById("ri-cur").value;
await A("POST","/api/transactions/"+txId+"/items",{name:n.value.trim(),quantity:qty,amount:amt,currency:cur});
await load();openReceipt(txId)}

async function dRi(iid,txId){await A("DELETE","/api/transactions/items/"+iid);await load();openReceipt(txId)}

function edRi(iid,txId){
var items=(D.txItems||{})[txId]||[];
var it=items.find(function(x){return x.id===iid});if(!it)return;
var tx=D.transactions.find(function(x){return x.id===txId});
oMC(tr("m_edit_receipt_item"),'<div class="dl">'+tr("m_item_name")+'</div><input class="inp" id="ei-name" value="'+es(it.name)+'"><div class="dr"><div><div class="dl">'+tr("f_quantity")+'</div><input class="inp" id="ei-qty" type="number" min="1" value="'+(it.quantity||1)+'"></div><div><div class="dl">'+tr("g_price_hint")+'</div><input class="inp" id="ei-amt" type="number" step="0.01" value="'+it.amount+'"></div><div><div class="dl">'+tr("f_currency")+'</div>'+_curSel("ei-cur",it.currency||(tx?tx.currency:"RSD"))+'</div></div><button class="btn" onclick="svRi('+iid+','+txId+')">Save</button>',{ic:"receipt"})}

async function svRi(iid,txId){var n=document.getElementById("ei-name").value.trim();
var q=parseInt(document.getElementById("ei-qty").value)||1;
var a=parseFloat(document.getElementById("ei-amt").value)||0;var c=document.getElementById("ei-cur").value;
if(!n)return;await A("PUT","/api/transactions/items/"+iid,{name:n,quantity:q,amount:a,currency:c});
cMo();await load();openReceipt(txId)}

// Subs (moved from Calendar)
function rSubAddBtn(){return '<button class="btn btn-s" style="margin-bottom:16px" onclick="oMoSub()">+ '+tr("mt_add_sub")+'</button>'}
function oMoSub(){_assign=0;_subRems=[{days_before:3,time:"09:00"},{days_before:0,time:"09:00"}];oMC("Add Subscription",'<input class="inp" id="su-n" placeholder="Subscription name"><input class="inp" id="su-e" value="💳" style="width:80px"><div class="dr"><div><div class="dl">'+tr("f_amount")+'</div><input class="inp" id="su-a" type="number" step="0.01" placeholder="9.99"></div><div><div class="dl">'+tr("f_currency")+'</div><select id="su-c"><option value="EUR">€</option><option value="USD">$</option><option value="GBP">£</option><option value="RUB">₽</option><option value="RSD">din.</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="1"></div></div><div class="lb">'+tr("g_assigned_to")+'</div>'+assignPk("sap",null)+'<div class="lb">'+tr("g_reminders")+'</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="doNewSub()">Add Subscription</button>',{ic:"card"})}
function rSubsList(){
if(!D.subs.length)return em(icon("card",48,1.8),tr("es_no_subs_t"),tr("es_no_subs_s"))+rSubAddBtn();
var items=D.subs;if(searchQ)items=items.filter(function(s){return matchQ(s.name)});
var totalEur=0;items.forEach(function(s){totalEur+=(s.amount_eur||0)});
var h=rSubAddBtn()+'<div class="c" style="border-left:3px solid var(--wn)"><div class="bd"><div class="tt" style="font-weight:700">'+tr("m_monthly_total")+'</div><div class="mt" style="font-size:16px;color:var(--wn);font-weight:800">€'+totalEur.toFixed(2)+'</div></div></div>';
if((D.members||[]).length>1){h+='<div class="fb2"><button class="fi '+(filt===null?"a":"")+'" onclick="filt=null;ren()">'+tr("g_filter_all")+'</button>';D.members.forEach(function(m){h+='<button class="fi '+(filt===m.user_id?"a":"")+'" style="padding:3px 6px;display:inline-flex;align-items:center" onclick="filt='+m.user_id+';ren()">'+mAv(m.user_id,22)+'</button>'});h+='</div>';}
if(filt)items=items.filter(function(s){return s.assigned_to===filt});
items.forEach(function(s){var daysTxt=s.days_until===0?"Today":s.days_until===1?"Tomorrow":"in "+s.days_until+"d";
var tone=s.days_until===0?"tone-ac":s.days_until<=2?"tone-wn":"";
var amountTxt=s.amount+" "+s.currency+(s.currency!=="EUR"?" · €"+(s.amount_eur||0).toFixed(2):"");
h+='<div class="lc"><div class="lc-i">'+s.emoji+'</div><div class="lc-bd"><div class="lc-tt">'+es(s.name)+'</div><div class="lc-mt">Day '+s.billing_day+' · '+amountTxt+'</div></div><span class="lc-rt '+tone+'">'+daysTxt+'</span><button class="bi" onclick="edSub('+s.id+')" style="margin-left:4px">'+I.ed+'</button><button class="bi" onclick="dlSub('+s.id+')">'+I.tr+'</button></div>'});return h}
async function dlSub(id){hp();await A("DELETE","/api/subscriptions/"+id);await load();toast("🗑 "+tr("ts_deleted"))}
function edSub(id){var s=D.subs.find(function(x){return x.id===id});if(!s)return;_assign=s.assigned_to||0;_subRems=(s.reminders||[]).map(function(r){return{days_before:r.days_before,time:r.time||"09:00"}});oMC(tr("mt_edit_sub"),'<input class="inp" id="su-n" value="'+es(s.name)+'"><input class="inp" id="su-e" value="'+s.emoji+'" style="width:80px"><div class="dr"><div><div class="dl">'+tr("f_amount")+'</div><input class="inp" id="su-a" type="number" step="0.01" value="'+s.amount+'"></div><div><div class="dl">'+tr("f_currency")+'</div><select id="su-c" style="width:100%"><option value="EUR"'+(s.currency==="EUR"?" selected":"")+'>€</option><option value="USD"'+(s.currency==="USD"?" selected":"")+'>$</option><option value="GBP"'+(s.currency==="GBP"?" selected":"")+'>£</option><option value="RUB"'+(s.currency==="RUB"?" selected":"")+'>₽</option><option value="RSD"'+(s.currency==="RSD"?" selected":"")+'>din.</option></select></div></div><div class="dr"><div><div class="dl">Billing day</div><input class="inp" id="su-d" type="number" min="1" max="28" value="'+s.billing_day+'"></div></div><div class="lb">'+tr("g_assigned_to")+'</div>'+assignPk("sap",s.assigned_to)+'<div class="lb">'+tr("g_reminders")+'</div><div id="srl">'+subRemPk()+'</div><button class="btn" onclick="svSub('+id+')">Save</button>',{ic:"card"})}
async function svSub(id){var n=document.getElementById("su-n").value.trim();var e=document.getElementById("su-e").value.trim();var a=parseFloat(document.getElementById("su-a").value);var c=document.getElementById("su-c").value;var d=parseInt(document.getElementById("su-d").value)||1;if(!n||!a)return;await A("PUT","/api/subscriptions/"+id,{name:n,emoji:e,amount:a,currency:c,billing_day:d,assigned_to:_assign||null,reminders:_subRems});cMo();hp();await load()}

// Analytics
var _moneySummary=null,_anaMonth=null,_anaCache={};
// Chart scroll choreography: instant centering on initial render, smooth on subsequent.
var _anaFirstScroll=true;
// Separate cache for Transactions tab tiles (always current month, independent of
// Analytics-tab navigation). Invalidated on every tx CRUD alongside _moneySummary.
// Fire-and-forget loader for the Transactions tab tiles. Writes into the shared
// _anaCache so a single source of truth feeds both Analytics and Transactions.
var _curMonthLoading=false;
async function _loadCurMonthSummary(){
  var mk=_curYM();
  if(_anaCache[mk]||_curMonthLoading)return;
  _curMonthLoading=true;
  var s=await A("GET","/api/money/summary"); // no month param → current
  _curMonthLoading=false;
  if(!s)return;
  _anaCache[s.month]=s;
  if(tab==="money"&&moneyTab==="transactions")ren();
}
function _anaShift(delta){
  var cur=_anaMonth||_curYM();
  var y=parseInt(cur.slice(0,4),10),m=parseInt(cur.slice(5,7),10)+delta;
  while(m<=0){m+=12;y--}while(m>12){m-=12;y++}
  var next=y+"-"+String(m).padStart(2,"0");
  if(next>_curYM())return;
  _anaSetMonth(next);
}
// Direct month selection — clicked from a bar (or arrow nav).
// Uses partial DOM update: chart strip stays alive (year watermarks don't blink,
// scroll position preserved), only tiles/header/extras swap with a fade.
var _anaSavedScroll=null;
function _anaSetMonth(mk){
  var cur=(_moneySummary&&_moneySummary.month)||_curYM();
  if(mk===cur)return;
  if(mk>_curYM())return; // future blocked
  _anaMonth=(mk===_curYM())?null:mk;
  hp("sel");
  // 1. Instant: shift bar highlight + smooth scroll to centre
  _anaUpdateChartHighlight(mk);
  // 2. Apply data update (from cache or via fetch) with fade-swap of tiles/extras
  if(_anaCache[mk]){
    _moneySummary=_anaCache[mk];
    _anaApplyPartial();
  }else{
    _anaFetchAndApply(mk);
  }
}
function _curYM(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
async function loadMoneySummary(){
  var q=_anaMonth?("?month="+_anaMonth):"";
  var s=await A("GET","/api/money/summary"+q);
  _moneySummary=s;_anaCache[s.month]=s;
  ren()
}
// Analytics is split into named-container sections so month switches can do
// surgical DOM updates (no chart rebuild → year watermark stays put, scroll
// preserved, only tile values + category bars fade-swap).
function _anaHeaderHtml(){
  var s=_moneySummary;
  var monthLabel=s&&s.month?new Date(s.month+"-01T00:00:00").toLocaleString("en-US",{month:"long",year:"numeric"}):"";
  var fwdDis=s&&s.is_current?' style="opacity:.3;pointer-events:none"':"";
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px"><button class="bi" onclick="_anaShift(-1)" style="padding:6px 10px;font-size:16px">◀</button><div style="font-weight:700;font-size:16px;letter-spacing:-.2px">'+monthLabel+'</div><button class="bi" onclick="_anaShift(1)"'+fwdDis+' style="padding:6px 10px;font-size:16px">▶</button></div>';
}
function _anaTilesHtml(){
  var s=_moneySummary;if(!s)return'';
  var h='<div class="sts sts-3">';
  h+='<div class="st st-mn"><div class="st-ico tone-ok">'+icon("trendUp",16,2.2)+'</div><div class="st-lb">'+tr("m_income_label")+'</div><div class="st-vl pos">€'+s.income.toFixed(0)+'</div></div>';
  h+='<div class="st st-mn"><div class="st-ico tone-ac">'+icon("trendDown",16,2.2)+'</div><div class="st-lb">'+tr("m_expense_label")+'</div><div class="st-vl neg">€'+s.expense.toFixed(0)+'</div></div>';
  h+='<div class="st st-mn"><div class="st-ico tone-pr">'+icon("wallet",16,2.2)+'</div><div class="st-lb">'+tr("m_balance_label")+'</div><div class="st-vl '+(s.balance>=0?"pos":"neg")+'">'+(s.balance<0?"−€":"€")+Math.abs(s.balance).toFixed(0)+'</div></div>';
  h+='</div>';
  // v8.50.0: show the carried-over opening balance + this month's net delta so
  // it's clear the balance is a running account total, not a monthly figure.
  if(s.opening_balance!=null){
    var net=s.net!=null?s.net:(s.income-s.expense);
    var netStr=(net>=0?"+€":"−€")+Math.abs(net).toFixed(0);
    h+='<div class="cat-row" style="margin-bottom:14px;margin-top:6px"><div class="cat-row-h"><span class="nm">'+icon("wallet",14,2.2)+' '+tr("m_carried_over")+'</span><span class="vl" style="color:var(--ht)">'+(s.opening_balance<0?"−€":"€")+Math.abs(s.opening_balance).toFixed(0)+' <span style="opacity:.6">·</span> '+tr("m_this_month")+' '+netStr+'</span></div></div>';
  }
  if(s.subs_eur)h+='<div class="cat-row" style="margin-bottom:14px;margin-top:6px"><div class="cat-row-h"><span class="nm">'+icon("card",14,2.2)+' Subscriptions this month</span><span class="vl" style="color:var(--pr)">€'+s.subs_eur.toFixed(0)+'</span></div></div>';
  return h;
}
function _anaExtrasHtml(){
  var s=_moneySummary;if(!s)return'';
  var h='';
  if(s.by_category&&s.by_category.length){
    var maxC=s.by_category[0]?s.by_category[0].total:1;
    h+='<div class="sc"><span class="sc-l">'+tr("g_by_category")+'</span></div>';
    s.by_category.forEach(function(c){if(!c.total)return;var pct=Math.max(2,c.total/maxC*100);
      h+='<div class="cat-row"><div class="cat-row-h"><span class="nm"><span class="em">'+c.emoji+'</span>'+es(c.name)+'</span><span class="vl">€'+c.total.toFixed(0)+'</span></div><div class="progress"><div class="progress-fill" style="width:'+pct+'%"></div></div></div>';
    });
  }
  if(s.limits&&s.limits.length){
    h+='<div class="sc" style="margin-top:12px"><span class="sc-l">'+tr("g_limits")+'</span></div>';
    s.limits.forEach(function(l){var pct=Math.min(100,l.spent/l.monthly_limit*100);var over=l.spent>l.monthly_limit;
      h+='<div class="cat-row"><div class="cat-row-h"><span class="nm"><span class="em">'+l.emoji+'</span>'+es(l.name)+'</span><span class="vl" style="color:'+(over?"var(--ac)":"var(--tx)")+'">€'+l.spent.toFixed(0)+' / €'+l.monthly_limit.toFixed(0)+'</span></div><div class="progress"><div class="progress-fill '+(over?"tone-ac":"tone-ok")+'" style="width:'+pct+'%"></div></div></div>';
    });
  }
  h+='<button class="btn btn-s" style="margin-top:14px" onclick="_anaCache={};_moneySummary=null;loadMoneySummary()">'+icon("refresh",13,2.2)+' Refresh Analytics</button>';
  return h;
}
// In-place innerHTML swap with retriggered fade animation
function _anaFadeSwap(el, html){
  if(!el)return;
  el.innerHTML=html;
  el.classList.remove('ana-soft');
  void el.offsetWidth; // force reflow so animation restarts
  el.classList.add('ana-soft');
}
// Move .cbar-sel to the clicked bar + smooth scroll without re-rendering chart
function _anaUpdateChartHighlight(mk){
  document.querySelectorAll('.cbar.cbar-sel').forEach(function(el){el.classList.remove('cbar-sel')});
  var b=document.querySelector('.cbar[data-month="'+mk+'"]');
  if(!b)return;
  b.classList.add('cbar-sel');
  var wrap=document.getElementById('ana-chart');
  if(!wrap)return;
  var sr=b.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
  var target=wrap.scrollLeft+sr.left-wr.left-(wr.width/2)+(sr.width/2);
  if(Math.abs(target-wrap.scrollLeft)<4)return;
  wrap.scrollTo({left:target,behavior:'smooth'});
}
// Apply month change WITHOUT touching the chart DOM (kept alive across updates)
function _anaApplyPartial(){
  if(tab!=="money"||moneyTab!=="analytics"){ren();return}
  _anaFadeSwap(document.getElementById('ana-header'),_anaHeaderHtml());
  _anaFadeSwap(document.getElementById('ana-tiles'),_anaTilesHtml());
  _anaFadeSwap(document.getElementById('ana-extras'),_anaExtrasHtml());
}
async function _anaFetchAndApply(mk){
  var s=await A("GET","/api/money/summary?month="+mk);
  if(!s)return;
  _moneySummary=s;_anaCache[s.month]=s;
  _anaApplyPartial();
}

function rAnalytics(){
if(!_moneySummary){loadMoneySummary();return '<div class="emp"><div class="emp-i" style="font-size:32px">⏳</div><div>Loading...</div></div>'}
var s=_moneySummary;
var h='<div id="ana-header" style="margin-bottom:12px">'+_anaHeaderHtml()+'</div>';
h+='<div id="ana-tiles">'+_anaTilesHtml()+'</div>';
// Monthly chart — horizontally-scrollable strip of last 24 months with year
// watermarks behind bars. Tap a bar to navigate to that month.
if(s.months&&s.months.length){
var maxM=1;s.months.forEach(function(m){maxM=Math.max(maxM,m.income,m.expense)});
h+='<div class="sc"><span class="sc-l"><span class="sc-ico">'+icon("chart",12,2.4)+'</span>'+tr("m_monthly")+'</span></div>';
// Compute contiguous year groups (assumes months are sorted oldest → newest)
var yGroups=[],curG=null;
s.months.forEach(function(m,i){
  var y=m.month.substring(0,4);
  if(!curG||curG.year!==y){curG={year:y,start:i,end:i};yGroups.push(curG)}
  else curG.end=i;
});
var total=s.months.length;
h+='<div class="chart-wrap" id="ana-chart"><div class="chart-strip">';
// Year watermarks (positioned absolute behind bars)
yGroups.forEach(function(g){
  var leftPct=(g.start/total*100).toFixed(2);
  var widthPct=((g.end-g.start+1)/total*100).toFixed(2);
  h+='<div class="chart-yr-wm" style="left:'+leftPct+'%;width:'+widthPct+'%">'+g.year+'</div>';
});
// Bars (clickable)
var monNames=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
s.months.forEach(function(m){
  var ih=Math.max(3,m.income/maxM*74);
  var eh=Math.max(3,m.expense/maxM*74);
  var sel=m.month===s.month?' cbar-sel':'';
  var mi=parseInt(m.month.split("-")[1],10)-1;
  var lbl=monNames[mi]||m.month.split("-")[1];
  h+='<div class="cbar'+sel+'" data-month="'+m.month+'" onclick="_anaSetMonth(\''+m.month+'\')"><div class="cbar-pair"><div class="cbar-b b-in" style="height:'+ih+'px"></div><div class="cbar-b b-ex" style="height:'+eh+'px"></div></div><div class="cbar-lb">'+lbl+'</div></div>';
});
h+='</div></div>';
h+='<div class="chart-legend"><span><span class="dotk" style="background:var(--ok)"></span>'+tr("m_income_label")+'</span><span><span class="dotk" style="background:var(--ac)"></span>'+tr("m_expense_label")+'</span></div>';
// Two-step scroll: instantly restore saved scroll (no jump to 0), then smoothly
// animate to centered-on-selected. On first render _anaSavedScroll is null →
// start centred immediately without animation.
setTimeout(function(){
  var wrap=document.getElementById('ana-chart');
  if(!wrap)return;
  if(_anaSavedScroll!=null){
    wrap.scrollLeft=_anaSavedScroll;
    _anaSavedScroll=null;
  }
  var sel=document.querySelector('.cbar-sel');
  if(!sel)return;
  var sr=sel.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
  var target=wrap.scrollLeft+sr.left-wr.left-(wr.width/2)+(sr.width/2);
  if(Math.abs(target-wrap.scrollLeft)<4)return; // already centred
  // Smooth animation when triggered by month change; instant on first paint.
  if(_anaFirstScroll){wrap.scrollLeft=target;_anaFirstScroll=false}
  else wrap.scrollTo({left:target,behavior:'smooth'});
},30);
}
// By Category + Limits + Refresh button — swappable on month change
h+='<div id="ana-extras">'+_anaExtrasHtml()+'</div>';
return h}

