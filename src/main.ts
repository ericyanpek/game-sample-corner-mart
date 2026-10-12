import './style.css';
import './restocking.css';
import './game-shell.css';
import './checkouts.css';
import './loading.css';
import ROOM_SPEC from '../assets/specs/room.json';
import {GameShell} from './game-shell.ts';
import {Shop,FixedClock,GOODS,PRODUCT_IDS,UPGRADE_COST,SHELF_TIERS,SHELF_SPEC,LAYOUT_SPEC,RESTOCK_POLICIES,isRestockPolicy,type LayoutId,type Product,type Upgrade} from './sim.ts';
import {renderRestocking} from './restocking-ui.ts';
import {ShopView} from './view.ts';
import {customerName,customerActivity,itemMark,PRODUCT_SHORT} from './shopping-ui.ts';
import {customerEmotion} from './emotions.ts';
import './emotions.css';
import type {Comparison} from './comparison.ts';
import {BusinessDay} from './day.ts';
import {renderDay,showDayReport,resetDayReport} from './day-ui.ts';
import {DAY_SEED} from './day.ts';
import {DAY_THEMES,dayStorageKey,isDayTheme,type DayThemeId} from './day-themes.ts';
import {GuidedTour} from './guided-tour.ts';
import {guidedStorageKey,freshGuide} from './guided-tour-state.ts';
import {resetVisitorSaves} from './visitor-reset.ts';
import './mobile.css';
import './camera.css';
import {setupCameraUI} from './camera-ui.ts';
import {setupFirstPersonUI} from './first-person-ui.ts';
import type {FirstPersonTarget} from './first-person.ts';
import './first-person.css';
import {setupShopAudio,ShopSoundEvents} from './sound.ts';
import './sound.css';
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
// The public build always runs the guided three-minute business day.
const params=new URLSearchParams(location.search),guidedMode=true,testMode=params.has('test'),dayMode=true;
const initialTheme=isDayTheme(params.get('theme'))?params.get('theme') as DayThemeId:'breakfast';
const themeKey=(theme:DayThemeId)=>guidedMode?guidedStorageKey(theme):dayStorageKey(theme);
let KEY=themeKey(initialTheme);
let guide:GuidedTour|null=null,savedGuide:unknown;
const startingShop=()=>{
  const fresh=new Shop();fresh.state.restockPolicy='shortage';return fresh;
};
let day=dayMode?new BusinessDay(undefined,DAY_SEED,initialTheme):null;
let shop=day?.shop??startingShop(),restored=false,paused=true,speed=guidedMode?2:1,selected:Product='drinks',wonDismissed=dayMode,storageWritable=true;
let noticeTimer=0,lastUI=-1,lastSave=0,lastEvent=-1;
try{
  const saved=localStorage.getItem(KEY);
  if(saved){
    const envelope=JSON.parse(saved);
    if(guidedMode)savedGuide=envelope.guide;
    if(((dayMode?envelope.businessDay?.shop?.roomRevision:envelope.state?.roomRevision)??1)<ROOM_SPEC.revision&&!localStorage.getItem(KEY+'-backup-before-room-expansion'))localStorage.setItem(KEY+'-backup-before-room-expansion',saved);
    if((dayMode?envelope.businessDay?.shop?.version:envelope.state?.version)<6&&!localStorage.getItem(KEY+'-backup-before-checkouts'))localStorage.setItem(KEY+'-backup-before-checkouts',saved);
    if(dayMode){
      const loaded=BusinessDay.restore(envelope.businessDay);
      if(loaded.theme!==initialTheme)throw Error('Saved theme does not match its slot');
      if(envelope.businessDay.version===1&&!localStorage.getItem(KEY+'-backup-before-day-themes'))localStorage.setItem(KEY+'-backup-before-day-themes',saved);
      if(!envelope.businessDay.restocking&&!localStorage.getItem(KEY+'-backup-before-dispatch'))localStorage.setItem(KEY+'-backup-before-dispatch',saved);
      day=loaded;shop=day.shop;
    }
    else{
    shop=Shop.restore(envelope.state);
    if(!envelope.state.restockPolicy&&!localStorage.getItem(KEY+'-backup-before-dispatch'))localStorage.setItem(KEY+'-backup-before-dispatch',saved);
    if(envelope.state.version===1&&!localStorage.getItem(KEY+'-backup-before-actions'))localStorage.setItem(KEY+'-backup-before-actions',saved);
    if(envelope.state.version<3&&!localStorage.getItem(KEY+'-backup-before-shelves'))localStorage.setItem(KEY+'-backup-before-shelves',saved);
    if(envelope.state.version<4&&!localStorage.getItem(KEY+'-backup-before-layouts'))localStorage.setItem(KEY+'-backup-before-layouts',saved);
    if(envelope.state.version<5&&!localStorage.getItem(KEY+'-backup-before-shopping-lists'))localStorage.setItem(KEY+'-backup-before-shopping-lists',saved);
    wonDismissed=Boolean(envelope.wonDismissed);
    }
    restored=true;
  }
}catch{storageWritable=false;$('#save-status').textContent='原存档已保留，本次临时游玩';}
if(day){
  document.body.classList.add('business-day');
  $('#day-panel').classList.remove('hidden');$('#day-invite').classList.add('hidden');$('#welcome').classList.add('hidden');
  $('#lab-banner').classList.remove('hidden');$('#lab-banner span').textContent='主题营业挑战 · 各主题独立保存 · 看需求，再开门';
  $('h1').textContent='今天的街坊，想买些什么？';$('#new-game').textContent='重置本主题的挑战与比较记录';
  paused=restored;
}
const shell=new GameShell();
const audio=setupShopAudio(),soundEvents=new ShopSoundEvents();
let soundShop=shop,soundHeld=true;
const view=new ShopView($('#world'),$('#stage'));const clock=new FixedClock();
setupCameraUI(direction=>view.turnCamera(direction),degrees=>view.setCameraElevation(degrees));
let speedBeforeFirstPerson:number|null=null;
const firstPersonUI=setupFirstPersonUI(view,shell,enterFirstPerson);
function enterFirstPerson(target:FirstPersonTarget){
  if(guide&&!guide.allowsFirstPerson(target))return false;
  if(!view.enterFirstPerson(target,shop)){toast('这位角色还没就位，稍后再试。');return false;}
  if(target.kind==='customer'){view.selectedCustomer=target.id;customerPinned=true;}
  shell.close();$('#camera-panel').hidden=true;$('#camera-toggle').setAttribute('aria-expanded','false');
  $('#world').focus({preventScroll:true});renderUI();return true;
}
view.onFirstPersonChange=(target,reason)=>{
  if(target){
    if(speedBeforeFirstPerson===null){speedBeforeFirstPerson=speed;speed=1;}
  }else{
    if(speedBeforeFirstPerson!==null){speed=speedBeforeFirstPerson;speedBeforeFirstPerson=null;}
    if(reason==='left')toast('这位街坊已离店，已返回全景。');
    else if(reason==='unavailable')toast('角色已离开岗位，已返回全景。');
  }
  firstPersonUI.update(shop,paused||!!guide?.holdsClock);
  $('#speed').textContent=`${speed}× 速度`;
};
if(day)view.setDayTheme(day.theme);
function toast(text:string){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(noticeTimer);noticeTimer=window.setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
shell.onGoalReached=()=>toast('目标达成！已有 20 位街坊买齐清单，继续招呼接下来的街坊吧。');
function save(){
  if(!storageWritable){$('#save-status').textContent='原存档已保留，本次临时游玩';return false;}
  try{localStorage.setItem(KEY,JSON.stringify(day?{businessDay:day.snapshot(),...(guide?{guide:guide.snapshot()}:{})}:{state:shop.snapshot(),wonDismissed}));$('#save-status').textContent='已保存在本机';return true;}
  catch{$('#save-status').textContent='保存失败';toast('无法写入本地存档，请检查浏览器存储权限。');return false;}
}
function select(p:Product){
  if(guide&&!guide.allowsControl(`[data-product="${p}"]`))return;
  if(day&&p==='fruit'){toast('本轮主题挑战只经营饮料和面包。');return;}
  selected=p;view.selected=p;renderUI();
}
function action(kind:string,key:string){
  if(guide&&!guide.allowsAction(kind,key))return false;
  if(!view.loaded)return false;
  if(day)return day.action(kind,key);
  if(kind==='restock')return isRestockPolicy(key)&&shop.setRestockPolicy(key);
  return kind==='layout'?shop.changeLayout(key as LayoutId):kind==='order'?shop.order(key as Product):kind==='upgrade'?shop.upgrade(key as Upgrade):kind==='shelf'?shop.upgradeShelf(Number(key)):shop.unlock(key as Product);
}
function replayDay(guided=false){
  if(guide?.locked)return false;
  if(!day||day.phase!=='settled')return false;
  day=day.replay();shop=day.shop;paused=false;clock.accumulator=0;view.selectedCustomer=null;customerPinned=false;
  selected='drinks';view.selected=selected;view.reset();resetDayReport();guide?.reset(guided?'guided':'free');save();renderUI();
  if(guidedMode&&!guided)toast('已恢复相同预算、库存和客流。按你的想法备货、升级或换布局，准备好后开门。');
  return true;
}
function chooseTheme(theme:DayThemeId){
  if(guide?.locked)return false;
  if(!day||day.theme===theme||!['preparing','settled'].includes(day.phase)||!view.loaded)return false;
  if(!save())return false;
  const key=themeKey(theme);let next=new BusinessDay(undefined,DAY_SEED,theme),found=false,writable=true;
  try{
    const saved=localStorage.getItem(key);
    if(saved){
      const envelope=JSON.parse(saved),loaded=BusinessDay.restore(envelope.businessDay);
      if((envelope.businessDay.shop.roomRevision??1)<ROOM_SPEC.revision&&!localStorage.getItem(key+'-backup-before-room-expansion'))localStorage.setItem(key+'-backup-before-room-expansion',saved);
      if(envelope.businessDay.shop.version<6&&!localStorage.getItem(key+'-backup-before-checkouts'))localStorage.setItem(key+'-backup-before-checkouts',saved);
      if(loaded.theme!==theme)throw Error('Saved theme does not match its slot');
      if(envelope.businessDay.version===1&&!localStorage.getItem(key+'-backup-before-day-themes'))localStorage.setItem(key+'-backup-before-day-themes',saved);
      if(!envelope.businessDay.restocking&&!localStorage.getItem(key+'-backup-before-dispatch'))localStorage.setItem(key+'-backup-before-dispatch',saved);
      next=loaded;found=true;
    }
  }catch{writable=false;toast('该主题原存档已保留，本次临时游玩。');}
  KEY=key;day=next;shop=day.shop;storageWritable=writable;paused=found;clock.accumulator=0;
  selected='drinks';view.selected=selected;view.selectedCustomer=null;customerPinned=false;lastEvent=-1;
  view.setDayTheme(theme);view.reset();resetDayReport();params.set('theme',theme);
  history.replaceState(null,'',location.pathname+'?'+params.toString()+location.hash);
  guide?.reset('theme');save();renderUI();return true;
}
document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b=>b.onclick=()=>{if(isDayTheme(b.dataset.theme))chooseTheme(b.dataset.theme);});
$('#open-day').onclick=()=>{if(guide&&!guide.allowsControl('#open-day'))return;if(day?.open()){paused=false;clock.accumulator=0;guide?.dismissBriefing();save();renderUI();toast(DAY_THEMES[day.theme].name+'开门了，街坊们很快就到。');}};
$('#show-day-report').onclick=()=>{if(day)showDayReport(day);};
$('#close-day-report').onclick=()=>$<HTMLDialogElement>('#day-report').close();
$('#replay-day').onclick=()=>replayDay();
$('#choose-next-theme').onclick=()=>{$<HTMLDialogElement>('#day-report').close();shell.open('day');};
view.onSelect=p=>{
  if(guide&&!guide.allowsInspect({kind:'shelf',product:p}))return;
  select(p);if(day&&p==='fruit')return;
  customerPinned=false;view.selectedCustomer=null;view.inspect({kind:'shelf',product:p});shell.open('shelves',true);
};
view.onSignSelect=()=>{if(guide&&!guide.allowsInspect({kind:'sign'}))return;view.focusDaySign();shell.open('day',true);};
view.onCheckoutSelect=station=>{if(guide&&!guide.allowsInspect({kind:'checkout',station}))return;view.inspect({kind:'checkout',station});shell.open('staff',true);renderUI();};
function time(tick:number){const seconds=Math.floor(tick/10);return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
const descriptions={drinks:'冰冰凉凉的街坊最爱。',bread:'刚出炉的香气，是新的好生意。',fruit:'把当季的新鲜，摆到街坊面前。'};
let customerPinned=false;
function selectCustomer(id:number){if(guide&&!guide.allowsInspect({kind:'customer',id}))return;view.selectedCustomer=id;customerPinned=true;view.inspect({kind:'customer',id});shell.open('guests',true);renderUI();}
view.onCustomerSelect=selectCustomer;
function inspectWorker(){
  if(guide&&!guide.allowsInspect({kind:'worker'}))return;
  customerPinned=false;view.selectedCustomer=null;view.inspect({kind:'worker'});shell.open('staff',true);renderUI();
}
view.onWorkerSelect=inspectWorker;
function returnToShop(){if(guide?.locked)return;view.reset();customerPinned=false;view.selectedCustomer=null;shell.close();renderUI();}
view.onEmptySelect=returnToShop;shell.onClose=returnToShop;
view.onFocusLost=()=>{customerPinned=false;view.selectedCustomer=null;};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();returnToShop();}
});
document.querySelectorAll<HTMLButtonElement>('[data-restock-policy]').forEach(b=>b.onclick=()=>{
  const policy=b.dataset.restockPolicy;if(!isRestockPolicy(policy))return;
  if(action('restock',policy)){save();renderUI();toast(`已安排${RESTOCK_POLICIES[policy]}，手上这一箱先送完。`);}
});
function renderShopping(){
  const s=shop.state;
  if(!s.customers.some(c=>c.id===view.selectedCustomer)){view.selectedCustomer=null;customerPinned=false;}
  if(!customerPinned)view.selectedCustomer=null;
  $('#shopping-hint').textContent=s.shelves.bread.unlocked?'早餐客找饮料＋面包；顺路客买一件。缺货时，买到的部分仍可结账。点顾客或卡片查看。':'顺路客先来买饮料。解锁并补好面包货架后，早餐客会带着两项清单来购物。';
  const roster=$('#shopping-roster');
  for(const button of Array.from(roster.querySelectorAll<HTMLButtonElement>('[data-customer]')))if(!s.customers.some(c=>c.id===Number(button.dataset.customer)))button.remove();
  for(const c of s.customers){
    let button=roster.querySelector<HTMLButtonElement>(`[data-customer="${c.id}"]`);
    if(!button){button=document.createElement('button');button.dataset.customer=String(c.id);button.onclick=()=>selectCustomer(c.id);roster.append(button);}
    const selected=c.id===view.selectedCustomer;button.className='customer-card '+c.kind+(selected?' selected':'');button.setAttribute('aria-pressed',String(selected));
    const feeling=customerEmotion(c,s.tick);
    const contents=`<div class="customer-card-heading"><strong>${customerName(c,day&&day.theme!=='breakfast'?'合购客':undefined)} <small>#${c.id}</small></strong><span>${c.happy?'实付':'待付'} ${shop.basketTotal(c)} 币</span></div><div class="customer-list">${c.shopping.map(item=>`<span class="list-item ${item.status} ${shop.itemVisible(c,item)?'held':''}"><b>${itemMark(shop,c,item)}</b>${item.premium?'冷饮':PRODUCT_SHORT[item.product]}${item.status==='missing'?'<em>缺货</em>':item.status==='returned'?'<em>已放回</em>':''}</span>`).join('')}</div><span class="customer-emotion ${feeling.emotion}" title="${feeling.detail}">${feeling.label}</span><small class="customer-activity">${customerActivity(shop,c)}</small>`;
    if(button.innerHTML!==contents)button.innerHTML=contents;
  }
  $('#shopping-empty').classList.toggle('hidden',s.customers.length>0);
  $('#multi-sales').textContent=s.stats.multiSales+' 单';$('#partial-sales').textContent=s.stats.partialSales+' 单';$('#missing-items').textContent=s.stats.missingItems+' 项次';
  const r=day&&s.stats.sold===day.baseline.stats.sold?undefined:s.receipts.at(-1);
  if(r){
    const contents=`<div><strong>最近成交 · ${r.lines.length} 件 / 1 单</strong><b>＋${r.amount} 币</b></div><p>${r.lines.map(line=>`${shop.goodsFor(line.product,line.premium).name} ${line.amount} 币`).join(' ＋ ')}</p>${r.missing.length?`<small>缺货：${r.missing.map(p=>PRODUCT_SHORT[p]).join('、')}；仅结算已拿到的商品。</small>`:''}`;
    if($('#shopping-receipt').innerHTML!==contents)$('#shopping-receipt').innerHTML=contents;
  }else $('#shopping-receipt').textContent='第一笔成交后，这里会列出买到的商品和实付金额。';
}

function renderUI(){
  renderShopping();
  renderRestocking(shop,day,view.loaded);
  const s=shop.state,x=s.shelves[selected],g=shop.restockGoods(selected),quote=shop.orderQuote(selected),capacity=shop.capacity(selected);
  $('#cash').innerHTML=`${s.cash.toLocaleString()}<span> 币</span>`;$('#sold').innerHTML=`${s.stats.sold}<span> 单</span>`;$('#clock').textContent=time(s.tick);
  $('#pause').textContent=paused?'继续':'暂停';$('#speed').textContent=`${speed}× 速度`;
  document.querySelectorAll<HTMLButtonElement>('[data-product]').forEach(b=>{b.classList.toggle('active',b.dataset.product===selected);b.setAttribute('aria-pressed',String(b.dataset.product===selected));});
  $('#product-name').textContent=g.name;$('#product-description').textContent=descriptions[selected];
  $('#selected-state').textContent=x.unlocked?'营业中':'待解锁';
  $('#stock-number').innerHTML=`${x.onHand}<small> / ${capacity} 件</small>`;$('#reserved').textContent=`预留 ${x.reserved} 件`;
  $('#stock-progress').style.width=`${x.onHand/capacity*100}%`;$('#buy-price').textContent=`${g.cost} 币`;$('#sell-price').textContent=`${g.price} 币`;
  $('#sku-note').classList.toggle('hidden',selected!=='drinks'||s.drinksTier!==2);
  $('#sku-note').textContent=`普通饮料 ${x.onHand-x.premium} 件 · 瓶装冷饮 ${x.premium} 件。普通饮料仍售 ${GOODS.drinks.price} 币，新进冷饮售 ${SHELF_SPEC.premium.price} 币。`;
  $('#shelf-upgrade-panel').classList.toggle('hidden',selected!=='drinks');
  const tier=SHELF_TIERS[s.drinksTier],upgrade=shop.shelfUpgradeQuote();
  $('#shelf-tier-name').textContent=tier.name;
  $('#shelf-tier-level').textContent=`Lv.${s.drinksTier+1} · ${tier.capacity} 件`;
  $('#shelf-tier-description').textContent=tier.description;
  document.querySelectorAll<HTMLElement>('[data-tier-step]').forEach(el=>{
    const index=Number(el.dataset.tierStep);el.classList.toggle('current',index===s.drinksTier);el.classList.toggle('owned',index<=s.drinksTier);
    el.setAttribute('aria-current',index===s.drinksTier?'step':'false');
    el.querySelector('small')!.textContent=`${SHELF_TIERS[index].capacity} 件`;
  });
  const shelfButton=$<HTMLButtonElement>('#upgrade-shelf');
  shelfButton.dataset.target=String(upgrade.target);shelfButton.disabled=!upgrade.allowed||!view.loaded;
  shelfButton.innerHTML=upgrade.tier?`升级为${upgrade.tier.name} <span>−${upgrade.cost} 币</span>`:'冷藏展示柜已就位 ✓';
  $('#shelf-upgrade-note').textContent=!upgrade.tier?'新订单采购瓶装冷饮，旧库存和在途商品保留原价。':upgrade.reason||
    `容量 ${tier.capacity} → ${upgrade.tier.capacity} 件，${upgrade.target===1?'增加展示灯带。':'柜门会随取货和补货开合。'}`;
  const btn=$<HTMLButtonElement>('#order');
  const o=s.orders.find(o=>o.product===selected);
  if(x.unlocked){
    btn.innerHTML=o?'补货途中…':quote.quantity?`补货 ${quote.quantity} 件 <span>−${quote.cost} 币</span>`:quote.reason;
    btn.disabled=quote.quantity===0;
    $('#order-note').textContent=s.upgrades.staff?'员工会自动进货，搬到货架并上架后可售。':'先付货款，员工抱箱送到货架，上架后可售。';
  }else{
    btn.innerHTML=`解锁这组货架 <span>−${GOODS[selected].unlock} 币</span>`;
    btn.disabled=s.cash<GOODS[selected].unlock||s.stats.sold<10||(selected==='fruit'&&!s.shelves.bread.unlocked);
    $('#order-note').textContent=s.stats.sold<10?'完成 10 笔成交后可以扩展货架。':selected==='fruit'&&!s.shelves.bread.unlocked?'先解锁面包货架，再扩展水果。':'解锁后需要另外购买第一批库存。';
  }
  $('#delivery').classList.toggle('hidden',!o);
  if(o){
    const d=s.delivery,active=s.orders[0]===o&&d&&d.phase!=='returning';
    $('#delivery-text').textContent=active?`${o.quantity} 件 · ${{loading:'正在抱箱',walking:'正在送往货架',stocking:'正在上架',returning:'已完成'}[d.phase]}`:`${o.quantity} 件已订购 · 等待员工`;
    $('#delivery-progress').style.width=(active?d.phase==='stocking'?75+(1-d.timer/d.phaseDuration)*25:Math.min(74,(1-o.remaining/o.duration)*100):0)+'%';
  }
  $('#upgrade-gate').textContent=s.stats.sold<5?`再成交 ${5-s.stats.sold} 单开启`:'每项升级一次';
  document.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach(b=>{
    const k=b.dataset.upgrade as Upgrade;b.disabled=s.stats.sold<5||s.upgrades[k]||s.cash<UPGRADE_COST[k];b.classList.toggle('owned',s.upgrades[k]);
    b.querySelector('b')!.textContent=s.upgrades[k]?'已升级':`${UPGRADE_COST[k]} ◈`;
  });
  $('#goal-value').textContent=`${Math.min(s.stats.sold,30)} / 30`;
  $('#goal-progress').style.width=`${(Math.min(s.stats.sold,30)/30*.75+(s.shelves.bread.unlocked?.25:0))*100}%`;
  $('#goal-title').textContent=s.stats.goalAt!==null?'开店目标已完成，接下来由你决定。':s.stats.sold>=30?'成交达标！再解锁面包货架。':'完成 30 笔成交，解锁面包货架';
  $('#queue-count').textContent=`${s.queue.length} 人排队`;
  document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach(b=>{
    const current=b.dataset.layout===s.layoutId;
    b.classList.toggle('active',current);b.setAttribute('aria-pressed',String(current));
    b.disabled=Boolean(s.layoutChange)||current||!view.loaded;
    b.querySelector('b')!.textContent=s.layoutChange?.target===b.dataset.layout?'调整中…':current?'使用中':'切换';
  });
  $('#layout-status').textContent=s.layoutChange?`正在让出货架位置，准备切换「${LAYOUT_SPEC.presets[s.layoutChange.target].name}」。${paused?'点击“继续”完成调整。':'购物与上架动作会在调整后接着完成。'}`:
    `${LAYOUT_SPEC.presets[s.layoutId].description} ${paused?'暂停中；切换后点击“继续”让人物让路。':'可以在营业中切换，库存、商品价格和已付订单保留。'}`;
  const lm=s.layoutMetrics;
  $('#layout-wait').textContent=lm.waitCount?`${(lm.waitTicks/lm.waitCount/10).toFixed(1)} 秒`:'—';
  $('#layout-delivery').textContent=lm.deliveryCount?`${(lm.deliveryTicks/lm.deliveryCount/10).toFixed(1)} 秒`:'—';
  $('#layout-wait-samples').textContent=lm.waitCount?`${lm.waitCount} 位顾客的平均值`:'等待首次开始收银';
  $('#layout-delivery-samples').textContent=lm.deliveryCount?`${lm.deliveryCount} 次补货的平均值`:'等待首批完整补货';
  $('#layout-loss').textContent=`${lm.lost} 人`;
  $('#layout-period').textContent=`本轮 ${time(s.tick-lm.since)} · 缺货 / 久等 / 满员`;
  const empty=PRODUCT_IDS.find(p=>s.shelves[p].unlocked&&shop.available(p)<=2);
  $('#insight').textContent=empty?`${GOODS[empty].name}快卖完了。先补货，别让顾客空手离开。`:s.queue.length>=3?'队伍正在变长。更快的收银台，可以让等待变短。':s.stats.sold<5?'先招呼好第一批顾客。完成 5 笔成交后，小店升级就会开放。':!s.shelves.bread.unlocked?'小店运转起来了。留一些进货钱，再考虑开一组面包货架。':'留意各个货架的库存。客流、补货与收银要一起跟上。';
  $('#losses').textContent=`缺货 ${s.stats.noStock} · 久等 ${s.stats.impatient} · 满员 ${s.stats.full}`;
  if(lastEvent!==s.events[0]?.tick||s.tick%10===0){
    $('#events').replaceChildren(...s.events.filter(e=>!day||e.tick>day.baseline.tick).slice(0,4).map(e=>{const div=document.createElement('div');div.className='event '+e.kind;const t=document.createElement('time');t.textContent=time(day?Math.max(0,e.tick-(day.openedAt??day.baseline.tick)):e.tick);const text=document.createElement('span');text.textContent=e.text;div.append(t,text);return div;}));
    lastEvent=s.events[0]?.tick??-1;
  }
  if(!day&&s.stats.goalAt!==null&&!wonDismissed){
    paused=true;$('#victory').classList.remove('hidden');$('#victory-copy').textContent=`营业 ${time(s.stats.goalAt)}，完成 ${s.stats.sold} 笔成交。街坊们已经记住了你的饮料与面包。`;
  }
  if(day){
    $('#losses').textContent=`缺货 ${s.stats.noStock-day.baseline.stats.noStock} · 久等 ${s.stats.impatient-day.baseline.stats.impatient} · 未入店 ${s.stats.full-day.baseline.stats.full}`;
    renderDay(day,view.loaded,paused||!!guide?.holdsClock);
  }
  guide?.update();
  const held=paused||!!guide?.holdsClock;
  if(soundShop!==shop||held&&!soundHeld)audio.stop();
  soundShop=shop;soundHeld=held;
  const cue=soundEvents.observe(shop,day?.phase);
  if(cue&&!document.hidden&&view.loaded)audio.play(cue);
  shell.update(shop,day,held);
  firstPersonUI.update(shop,held);
  if(guide?.locked){
    $('#scene-caption').textContent=view.firstPersonTarget?'第一视角观察 · 角色自动行动 · 镜头自动跟随':'引导中 · 只点发光目标 · Esc 退出引导';
    $('.window-foot>span').textContent=view.firstPersonTarget?'可回到全景继续看 · Esc 退出整段引导':'按提示经营 · 可随时退出引导，保留进度';
    $('#world').setAttribute('aria-label',view.firstPersonTarget?'引导第一视角：镜头自动跟随角色；用引导栏回到全景，或按 Escape 退出引导':'新手引导：仅高亮目标可点击；按 Escape 退出引导');
  }
  if(guide){$('#pause').textContent=guide.holdsClock?'引导暂停':paused?'继续':'暂停';$<HTMLButtonElement>('#pause').disabled=guide.holdsClock||day?.phase==='settled';}
}
document.querySelectorAll<HTMLButtonElement>('[data-product]').forEach(b=>b.onclick=()=>select(b.dataset.product as Product));
document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach(b=>b.onclick=()=>{
  if(action('layout',b.dataset.layout!)){toast(paused?'布局调整已安排，点击“继续”让人物让路。':'先让出位置，随后自动完成布局调整。');save();renderUI();}
});
$('#toggle-routes').onclick=()=>{
  view.showRoutes=!view.showRoutes;$('#toggle-routes').textContent=view.showRoutes?'隐藏动线':'显示动线';
  $('#toggle-routes').setAttribute('aria-pressed',String(view.showRoutes));
};
let comparison:Comparison|null=null;
$('#run-comparison').onclick=()=>{
  const button=$<HTMLButtonElement>('#run-comparison');button.disabled=true;
  $('#comparison-status').textContent='正在独立试营业…';$('#comparison-result').replaceChildren();
  const worker=new Worker(new URL('./comparison-worker.ts',import.meta.url),{type:'module'});
  const failed=(message:string)=>{button.disabled=false;$('#comparison-status').textContent='对照未完成：'+message;worker.terminate();};
  worker.onerror=error=>failed(error.message);
  worker.onmessage=({data})=>{
    if(data.error){failed(data.error);return;}
    if(data.done)$('#comparison-status').textContent=`已完成 ${data.done} / 6 轮试营业…`;
    if(data.report){
      comparison=data.report as Comparison;const r=comparison;
      $('#comparison-result').innerHTML=`<table><thead><tr><th>三组客流合计</th><th>通道优先</th><th>中岛陈列</th></tr></thead><tbody>${
        [['等到收银',...r.results.map(x=>x.waitSeconds.toFixed(1)+' 秒')],['下单到上架',...r.results.map(x=>x.deliverySeconds.toFixed(1)+' 秒')],
          ['流失人数',...r.results.map(x=>x.lost+' 人')],['完成成交',...r.results.map(x=>x.sold+' 单')],['补货样本',...r.results.map(x=>x.deliveryCount+' 次')]]
          .map(row=>`<tr><th>${row[0]}</th><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('')}</tbody></table><small>每轮初始 ${r.startingCash} 币、${r.startingStock} 件饮料，独立运行 ${r.secondsPerRun/60} 分钟。时间按已完成样本加权平均；未完成的排队与补货不计入均值。流失包括缺货、等待超时及满员。实时换布局的数据仅供观察，对照结果使用固定起点。</small>`;
      $('#comparison-status').textContent=`对照完成 · 每种布局均收到 ${r.results[0].arrived} 次入店需求 · 你的经营进度未被对照修改。`;
      button.disabled=false;button.textContent='再次运行相同对照';worker.terminate();
    }
  };
  worker.postMessage({run:true});
};
document.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach(b=>b.onclick=()=>{if(action('upgrade',b.dataset.upgrade!)){toast(shop.state.events[0].text);save();renderUI();}});
$('#order').onclick=()=>{const ok=action(shop.state.shelves[selected].unlocked?'order':'unlock',selected);if(ok){toast(shop.state.events[0].text);save();renderUI();}};
$('#upgrade-shelf').onclick=e=>{
  if(e.detail>1||!view.loaded)return;
  const target=Number($('#upgrade-shelf').dataset.target);
  if(!view.tierAssets.has(target))return;
  if(action('shelf',String(target))){view.activateTier(target);toast(shop.state.events[0].text);save();renderUI();}
};
let resumeAfterGallery=false;
const gallery=$<HTMLDialogElement>('#shelf-gallery');
$('#open-shelf-gallery').onclick=()=>{resumeAfterGallery=!paused;paused=true;gallery.showModal();renderUI();};
$('#close-shelf-gallery').onclick=()=>gallery.close();
gallery.addEventListener('close',()=>{if(resumeAfterGallery&&!document.hidden)paused=false;renderUI();});
$('#gallery-contract').textContent=`统一底座 ${SHELF_SPEC.contract.footprint.join(' × ')} m；交互标识 ${SHELF_SPEC.contract.interaction_id}；停留点随货架一起移动、旋转，运行时另外留出柜门操作间距。`;
document.querySelectorAll<HTMLElement>('.gallery-grid article').forEach((el,index)=>{
  const tier=SHELF_TIERS[index];el.querySelector('h3')!.textContent=tier.name;
  const paragraphs=el.querySelectorAll('p');
  paragraphs[0].textContent=`容量 ${tier.capacity} 件 · ${index===0?'开店自带':`升级 ${tier.upgradeCost} 币`}`;
  paragraphs[1].textContent=(index?`完成 ${tier.requiredSales} 笔成交开放；`:'')+tier.description;
});
$('#pause').onclick=()=>{if(!$('#welcome').classList.contains('hidden'))return;paused=!paused;save();renderUI();};
$('#save').onclick=()=>{if(save())toast('小店进度已保存。');};
$('#start').onclick=()=>{paused=false;$('#welcome').classList.add('hidden');renderUI();};
$('#continue').onclick=()=>{wonDismissed=true;paused=false;$('#victory').classList.add('hidden');save();renderUI();};
$('#speed').onclick=()=>{speed=speed===1?2:speed===2?4:1;renderUI();};
$('#reset-camera').onclick=returnToShop;
$('#new-game').onclick=()=>{
  if(guidedMode){requestNextVisitor();return;}
  if(!confirm('重新开店会替换这间小店的本地进度。要继续吗？'))return;
  view.reset();
  if(day){day=new BusinessDay(undefined,DAY_SEED,day.theme);shop=day.shop;storageWritable=true;paused=false;clock.accumulator=0;view.selectedCustomer=null;customerPinned=false;selected='drinks';view.selected=selected;resetDayReport();save();renderUI();return;}
  shop=startingShop();storageWritable=true;wonDismissed=false;view.selectedCustomer=null;customerPinned=false;paused=true;selected='drinks';view.selected=selected;clock.accumulator=0;$('#victory').classList.add('hidden');$('#welcome').classList.remove('hidden');$('#welcome-copy').innerHTML='12 件饮料已经上架。补货、招呼顾客，<br>把第一笔收入变成更好的小店。';$('#start').textContent='开门营业';save();renderUI();
};
function adoptGuidedDay(next:BusinessDay){
  view.exitFirstPerson();
  day=next;shop=day.shop;KEY=themeKey(day.theme);
  params.set('theme',day.theme);
  history.replaceState(null,'',location.pathname+'?'+params.toString());
  storageWritable=true;paused=false;speed=2;clock.accumulator=0;selected='drinks';view.selected='drinks';
  customerPinned=false;view.selectedCustomer=null;lastEvent=-1;view.setDayTheme(day.theme);view.reset();shell.close();
  resetDayReport();guide?.reset();save();renderUI();
}
const visitorDialog=$<HTMLDialogElement>('#visitor-reset-dialog');
let pausedBeforeVisitorDialog=false,visitorPending=false;
function requestNextVisitor(){
  if(!guidedMode||!day||visitorDialog.open||guide?.locked)return;
  pausedBeforeVisitorDialog=paused;paused=true;visitorPending=true;
  $('#visitor-reset-replay').hidden=day.phase!=='settled';$('#visitor-reset-error').hidden=true;
  visitorDialog.showModal();renderUI();
}
function finishVisitorDialog(){
  if(!visitorPending)return;
  visitorPending=false;paused=pausedBeforeVisitorDialog;clock.accumulator=0;
}
function closeVisitorDialog(){finishVisitorDialog();visitorDialog.close();renderUI();}
visitorDialog.addEventListener('close',()=>{if(!visitorDialog.open){finishVisitorDialog();renderUI();}});
$('#visitor-reset-cancel').onclick=closeVisitorDialog;
$('#visitor-reset-replay').onclick=()=>{closeVisitorDialog();replayDay();};
$('#visitor-reset-confirm').onclick=()=>{
  if(!day)return;
  const next=new BusinessDay(undefined,DAY_SEED,'breakfast');
  try{
    resetVisitorSaves(localStorage,JSON.stringify({businessDay:next.snapshot(),guide:freshGuide(next)}),
      {key:KEY,value:JSON.stringify({businessDay:day.snapshot(),guide:guide?.snapshot()})});
  }catch{
    $('#visitor-reset-error').hidden=false;
    $('#visitor-reset-error').textContent='浏览器未能保存重置操作，当前进度继续保留。请取消后检查本地存储权限或空间。';
    return;
  }
  closeVisitorDialog();adoptGuidedDay(next);
};
function restartGuidedTour(){
  if(!day)return;
  if(day.phase==='settled'){replayDay(true);return;}
  const next=new BusinessDay(day.baseline,day.seed,day.theme);
  next.baselineSignature=day.baselineSignature;next.attempt=day.attempt;next.history=structuredClone(day.history);
  adoptGuidedDay(next);
}
if(guidedMode){
  paused=restored;
  guide=new GuidedTour({
    day:()=>day!,selected:()=>selected,shell,view,save,resume:()=>{paused=false;},paused:()=>paused,
    togglePause:()=>{paused=!paused;clock.accumulator=0;renderUI();save();},
    restart:requestNextVisitor,restartGuide:restartGuidedTour,replay:()=>replayDay(),enterFirstPerson,
    inspect:target=>{
      if(target.kind==='customer')selectCustomer(target.id);
      else if(target.kind==='worker')inspectWorker();
      else if(target.kind==='shelf')view.onSelect(target.product);
      else if(target.kind==='checkout')view.onCheckoutSelect(target.station??'main');
      else view.onSignSelect();
    },
  },savedGuide);
}
let requestedVersion:'v1'|'v2'|'gray'=params.has('gray')?'gray':'v1',uiLoadId=0;
view.onLoadProgress=(done,total,label)=>{
  const progress=$<HTMLProgressElement>('#loading-progress');progress.max=total;progress.value=done;
  $('#loading-detail').textContent=done?`${label}已就绪 · ${done} / ${total} 组`:`正在准备 ${total} 组店铺资源…`;
};
async function load(version:'v1'|'v2'|'gray'){
  requestedVersion=version;const ticket=++uiLoadId;
  const before=JSON.stringify(shop.snapshot());$('#asset-status').textContent='正在载入资产…';
  $('#asset-loading').hidden=false;$('#loading-retry').hidden=true;
  $('#loading-title').textContent='小店正在准备中';
  $('#loading-progress').removeAttribute('value');
  $('#start').setAttribute('disabled','true');
  for(const id of ['v1','v2','gray'])$<HTMLButtonElement>('#asset-'+id).disabled=true;
  try{
    await view.load(version,shop.state.drinksTier);
    if(ticket!==uiLoadId)return;
    // Existing state remains owned by Shop. Asset loading never reinitializes the simulation.
    $('#asset-status').textContent=`已载入${version==='gray'?'灰盒':version==='v1'?'店铺底图 V1':'店铺底图 V2'}，饮料货架保持当前等级；库存、顾客与订单保留。`;
    if(paused&&JSON.stringify(shop.snapshot())!==before)throw Error('Paused simulation changed while loading assets');
    $('#asset-loading').hidden=true;
    $('#start').removeAttribute('disabled');$('#start').textContent=restored?'继续经营':'开门营业';
    if(restored)$('#welcome-copy').innerHTML='你的货架、现金和经营进度都在。<br>准备好了，就继续招呼街坊吧。';
  }catch(e){
    if(ticket===uiLoadId){
      view.loaded=false;$('#asset-status').textContent='资产载入失败：'+String(e);
      $('#loading-title').textContent='暂时没能准备好店铺';
      $('#loading-detail').textContent='请检查网络后重试，经营进度仍然保留。';
      $('#loading-retry').hidden=false;$('#start').textContent='等待重新加载';
    }
    throw e;
  }finally{
    if(ticket===uiLoadId){
      for(const id of ['v1','v2','gray'])$<HTMLButtonElement>('#asset-'+id).disabled=false;
      renderUI();
    }
  }
}
for(const version of ['v1','v2','gray'] as const)$('#asset-'+version).onclick=()=>{load(version).then(()=>toast('外观已更新，经营进度保留。')).catch(e=>toast(String(e)));};
$('#loading-retry').onclick=()=>{void load(requestedVersion).catch(e=>console.error(e));};
void load(requestedVersion).catch(e=>console.error(e));
document.addEventListener('visibilitychange',()=>{if(document.hidden){paused=true;save();renderUI();}});
addEventListener('beforeunload',save);
let previous=performance.now();
function frame(now:number) {
  requestAnimationFrame(frame);const raw=(now-previous)/1000;previous=now;
  const held=paused||!!guide?.holdsClock;
  if(!held&&view.loaded)clock.feed(day??shop,Math.min(raw,.25)*speed);
  view.update(shop,raw,held,speed,clock.accumulator/.1);
  guide?.position();
  if(now-lastUI>120){renderUI();lastUI=now;const m=view.metrics();$('#render-metrics').textContent=`${m.median.toFixed(1)} ms · ${m.render.calls} draws · ${m.render.triangles.toLocaleString()} tris`;}
  if(now-lastSave>5000&&!paused){save();lastSave=now;}
}
requestAnimationFrame(frame);renderUI();
const diagnostics={
  state:()=>shop.snapshot(),selectedCustomer:()=>view.selectedCustomer,metrics:()=>view.metrics(),paused:()=>paused,
  sound:()=>audio.status(),
  comparison:()=>comparison,nav:()=>({access:shop.nav.access,waiting:shop.nav.waitPoints}),
  ready:()=>view.loaded,assert:()=>day?day.assertValid():shop.assertValid(),
  day:()=>day?.snapshot()??null,dayReport:()=>day?.report()??null,
  shell:()=>({panel:shell.panel,customerDetail:shell.customerDetail}),
  guided:()=>guide?{...guide.snapshot(),...guide.describe(),holdsClock:guide.holdsClock,storageKey:KEY}:null,
  ...(testMode?{
    advance:(ticks:number)=>{(day??shop).step(ticks);(day??shop).assertValid();renderUI();},
    action:(kind:string,key:string)=>{const ok=action(kind,key);renderUI();return ok;},
    pause:()=>{paused=true;renderUI();},
    restore:(data:unknown)=>{if(day)throw Error('Use restoreDay for business-day fixtures');shop=Shop.restore(data);wonDismissed=true;clock.accumulator=0;renderUI();},
    restoreDay:(data:unknown)=>{if(!dayMode)throw Error('Business-day mode required');view.reset();day=BusinessDay.restore(data);KEY=themeKey(day.theme);shop=day.shop;paused=true;clock.accumulator=0;view.setDayTheme(day.theme);resetDayReport();renderUI();},
    replayDay,chooseTheme,
    spawn:(count:number)=>{if(day)throw Error('Business-day arrivals are fixed');for(let i=0;i<count;i++)shop.spawn();shop.assertValid();},
    resetFrames:()=>{view.frames=[];},
    pickAt:(x:number,y:number)=>view.pick(x,y),
    load,save
  }:{}),
};
(window as unknown as {__SHOP__:typeof diagnostics}).__SHOP__=diagnostics;
