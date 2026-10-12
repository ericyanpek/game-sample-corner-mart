/** Deterministic, renderer-independent shop simulation. Money is integer coins. */
import SHELF_SPEC from '../assets/specs/drink-shelves.json';
import SHOPPING_SPEC from '../assets/specs/shopping.json';
import ROOM_SPEC from '../assets/specs/room.json';
import {admissionFailure,type AdmissionFailure} from './admission.ts';
export {SHOPPING_SPEC};
import {navigation,LAYOUT_SPEC,CHECKOUT_SPEC,distance,freshMotion,SEPARATION,type LayoutId,type NavMotion,type CheckoutId} from './navigation.ts';
export {CHECKOUT_SPEC,type CheckoutId};
export {LAYOUT_SPEC,type LayoutId};
export {SHELF_SPEC};
export const SHELF_TIERS=SHELF_SPEC.tiers;
export const STEP = 0.1;
export const PICKUP_TICKS=16, PAY_TICKS=12, PUTBACK_TICKS=14, LOAD_TICKS=12, STOCK_TICKS=24;
export type Product = 'drinks' | 'bread' | 'fruit';
export const RESTOCK_POLICIES={shortage:'缺货优先',drinks:'饮料优先',bread:'面包优先'} as const;
export type RestockPolicy=keyof typeof RESTOCK_POLICIES;
export const isRestockPolicy=(value:unknown):value is RestockPolicy=>typeof value==='string'&&Object.hasOwn(RESTOCK_POLICIES,value);
export type Upgrade = 'checkout' | 'staff' | 'marketing';
export type Point = [number, number];
export const GOODS: Record<Product, {name:string; price:number; cost:number; unlock:number}> = {
  drinks: {...SHELF_SPEC.regular, unlock:0},
  bread: {name:'现烤面包', price:7, cost:3, unlock:100},
  fruit: {name:'时令水果', price:9, cost:4, unlock:150},
};
export const UPGRADE_COST: Record<Upgrade, number> = {checkout:60, staff:70, marketing:50};
export const PRODUCT_IDS = Object.keys(GOODS) as Product[];
export interface Layout { entrance:Point; aisle:Point; checkout:Point; delivery:Point; shelves:Record<Product,Point> }
export const DEFAULT_LAYOUT: Layout = {
  entrance:LAYOUT_SPEC.entrance as Point, aisle:[2.5,-.1], checkout:LAYOUT_SPEC.checkout as Point,delivery:LAYOUT_SPEC.delivery as Point,
  shelves:navigation('aisle',true).access,
};
export interface LayoutMetrics {since:number;waitTicks:number;waitCount:number;deliveryTicks:number;deliveryCount:number;lost:number;sold:number;blockedTicks:number;walkMeters:number}
const metrics=(since:number):LayoutMetrics=>({since,waitTicks:0,waitCount:0,deliveryTicks:0,deliveryCount:0,lost:0,sold:0,blockedTicks:0,walkMeters:0});
export interface Shelf {unlocked:boolean; onHand:number; reserved:number; received:number; sold:number; initial:number; premium:number; premiumReceived:number; premiumSold:number}
export interface ShoppingItem {product:Product;status:'wanted'|'reserved'|'missing'|'returned'|'purchased';premium:boolean}
export interface Customer {
  id:number; product:Product; state:'enter'|'shelfQueue'|'browse'|'pickup'|'toQueue'|'queue'|'service'|'pay'|'return'|'putback'|'leave';
  pos:Point; facing:number; path:Point[]; timer:number; queuedAt:number;
  reservation:boolean; happy:boolean; style:number; phaseStarted:number; serviceDuration:number; premium:boolean;
  nav:NavMotion; approach:boolean;
  kind:'quick'|'breakfast';shopping:ShoppingItem[];patience:number;
  checkout?:CheckoutId;
}
export interface Order { product:Product; quantity:number; duration:number; remaining:number; premium:boolean; unitCost:number;placedAt:number }
export interface Delivery {
  product:Product; quantity:number; phase:'loading'|'walking'|'stocking'|'returning';
  pos:Point; path:Point[]; facing:number; timer:number; phaseStarted:number; phaseDuration:number; premium:boolean;
  nav:NavMotion;approach:boolean;
}
export interface ReceiptLine {product:Product;premium:boolean;amount:number}
export interface Receipt {id:number; customer:number; product:Product; tick:number; amount:number; premium:boolean;lines:ReceiptLine[];requested:Product[];missing:Product[]}
export interface Arrival {kind:'quick'|'breakfast';products:Product[];style:number}
export interface StepOptions {arrivals?:boolean;restock?:boolean}
export interface ShopState {
  version:6; roomRevision?:number; tick:number; rng:number; seed:number; nextArrival:number; nextId:number; cash:number;
  /** Absent in legacy saves: retain FIFO and the original purchase order. */
  restockPolicy?:RestockPolicy;
  layoutId:LayoutId;layoutChange:{target:LayoutId;goals:Record<number,Point>}|null;layoutMetrics:LayoutMetrics;
  access:Record<Product,number|null>;
  drinksTier:number; drinksDoor:number;
  shelves:Record<Product,Shelf>; upgrades:Record<Upgrade,boolean>; customers:Customer[];
  queue:number[]; service:number|null; helperService:number|null; orders:Order[];
  ledger:{revenue:number; procurement:number; upgrades:number; unlocks:number};
  stats:{sold:number;unitsSold:number;multiSales:number;partialSales:number;missingItems:number; arrived:number; noStock:number; impatient:number; full:number; firstSale:number|null; goalAt:number|null};
  events:{tick:number; text:string; kind:'sale'|'info'|'loss'}[];
  delivery:Delivery|null; receipts:Receipt[];
}
export class Shop {
  state:ShopState;
  get nav(){return navigation(this.state.layoutId,true);}
  get layout():Layout{return {...DEFAULT_LAYOUT,shelves:this.nav.access};}
  constructor(seed=20260914) {
    this.state={
      version:6,roomRevision:ROOM_SPEC.revision,tick:0,rng:seed>>>0,seed:seed>>>0,nextArrival:15,nextId:1,cash:120,drinksTier:0,drinksDoor:0,
      layoutId:'aisle',layoutChange:null,layoutMetrics:metrics(0),access:{drinks:null,bread:null,fruit:null},
      shelves:Object.fromEntries(PRODUCT_IDS.map(p=>[p,{unlocked:p==='drinks',onHand:p==='drinks'?12:0,reserved:0,received:0,sold:0,initial:p==='drinks'?12:0,premium:0,premiumReceived:0,premiumSold:0}])) as Record<Product,Shelf>,
      upgrades:{checkout:false,staff:false,marketing:false},customers:[],queue:[],service:null,helperService:null,orders:[],
      ledger:{revenue:0,procurement:0,upgrades:0,unlocks:0},
      stats:{sold:0,unitsSold:0,multiSales:0,partialSales:0,missingItems:0,arrived:0,noStock:0,impatient:0,full:0,firstSale:null,goalAt:null},events:[],delivery:null,receipts:[],
    };
    this.event('新店开张！饮料架有 12 件开店库存。');
  }
  random() { const s=this.state; s.rng=(Math.imul(1664525,s.rng)+1013904223)>>>0; return s.rng/4294967296; }
  event(text:string,kind:'sale'|'info'|'loss'='info') {this.state.events.unshift({tick:this.state.tick,text,kind});this.state.events.length=Math.min(this.state.events.length,16);}
  snapshot():ShopState {return structuredClone(this.state);}
  static restore(data:unknown) {
    const raw=structuredClone(data) as Omit<ShopState,'version'> & {version:number};
    if(!raw||![1,2,3,4,5,6].includes(raw.version))throw Error('不支持的存档版本');
    const oldCheckouts=raw.version<6;
    const oldRoom=raw.roomRevision===undefined||raw.roomRevision<ROOM_SPEC.revision;
    if(raw.version===1){
      raw.version=2;raw.delivery=null;raw.receipts=[];
      for(const c of raw.customers){
        c.phaseStarted=raw.tick;c.serviceDuration=raw.upgrades.checkout?40:75;
        if(c.state==='service'){
          c.serviceDuration=Math.max(c.serviceDuration,c.timer);
          if(c.timer<=PAY_TICKS){c.state='pay';c.phaseStarted=raw.tick-(PAY_TICKS-c.timer);}
          else{c.timer-=PAY_TICKS;c.phaseStarted=raw.tick-(c.serviceDuration-PAY_TICKS-c.timer);}
        }
      }
      // Preserve the already-paid legacy shipment's remaining delivery deadline.
      const o=raw.orders[0];
      if(o)raw.delivery={product:o.product,quantity:o.quantity,phase:'stocking',
        pos:[DEFAULT_LAYOUT.shelves[o.product][0]+.36,-.85],path:[],facing:Math.PI,
        timer:o.remaining,phaseDuration:o.duration,phaseStarted:raw.tick-(o.duration-o.remaining),premium:false,
        nav:freshMotion(DEFAULT_LAYOUT.shelves[o.product]),approach:false};
    }
    if(raw.version===2){
      raw.version=3;raw.drinksTier=0;raw.drinksDoor=0;
      for(const shelf of Object.values(raw.shelves)){shelf.premium=0;shelf.premiumReceived=0;shelf.premiumSold=0;}
      for(const c of raw.customers)c.premium=false;
      for(const o of raw.orders){o.premium=false;o.unitCost=GOODS[o.product].cost;}
      for(const r of raw.receipts)r.premium=false;
      if(raw.delivery)raw.delivery.premium=false;
    }
    const old=raw.version<4;
    if(old){
      raw.version=4;raw.layoutId='aisle';raw.layoutChange=null;raw.layoutMetrics=metrics(raw.tick);raw.access={drinks:null,bread:null,fruit:null};
      for(const c of raw.customers){c.nav=freshMotion(c.pos);c.approach=['browse','pickup','putback','service','pay'].includes(c.state);c.path=[];}
      for(const o of raw.orders)o.placedAt=raw.tick;
      if(raw.delivery){raw.delivery.nav=freshMotion(raw.delivery.pos);raw.delivery.approach=['loading','stocking'].includes(raw.delivery.phase);raw.delivery.path=[];}
    }
    if(raw.version===4){
      raw.version=5;
      Object.assign(raw.stats,{unitsSold:raw.stats.sold,multiSales:0,partialSales:0,missingItems:0});
      for(const c of raw.customers){
        c.kind='quick';c.patience=SHOPPING_SPEC.quickPatience;
        c.shopping=[{product:c.product,premium:c.premium,status:c.reservation?'reserved':c.happy?'purchased':c.state==='leave'?'missing':'wanted'}];
      }
      for(const r of raw.receipts){
        r.lines=[{product:r.product,premium:r.premium,amount:r.amount}];r.requested=[r.product];r.missing=[];
      }
    }
    if(oldCheckouts){
      raw.version=6;raw.helperService=null;
      for(const c of raw.customers)if(raw.queue.includes(c.id))c.checkout='main';
    }
    const shop=new Shop();shop.state=raw as ShopState;
    if(oldCheckouts||oldRoom){
      raw.roomRevision=ROOM_SPEC.revision;
      shop.repairLegacyPositions();
      const change=raw.layoutChange;if(change){raw.layoutChange=null;shop.changeLayout(change.target);}
    }
    shop.assertValid();return shop;
  }
  capacity(p:Product) {return p==='drinks'?SHELF_TIERS[this.state.drinksTier].capacity:24;}
  get helperAvailable(){const s=this.state;return s.upgrades.staff&&!s.delivery&&!s.orders.length;}
  station(c:Customer){return CHECKOUT_SPEC.stations[c.checkout??'main'];}
  serviceAt(id:CheckoutId){return id==='main'?this.state.service:this.state.helperService;}
  queueAt(id:CheckoutId){return this.state.queue.filter(key=>(this.state.customers.find(c=>c.id===key)?.checkout??'main')===id);}
  checkoutStatus(id:CheckoutId){
    const s=this.state,service=this.serviceAt(id);
    if(id==='main')return {id,state:'open',text:'服务中',detail:service?'正在结账':'等待顾客',customer:service,waiting:this.queueAt(id).length};
    if(service!==null)return {id,state:s.orders.length?'finishing':'open',text:s.orders.length?'本单完成后暂停':'服务中',detail:s.orders.length?'先结完这一单，再去补货':'正在结账',customer:service,waiting:this.queueAt(id).length};
    if(s.delivery||s.orders.length)return {id,state:'paused',text:'暂停服务',detail:s.delivery?.phase==='returning'?'店员返回中':'店员补货中 · 请到1号台',customer:null,waiting:this.queueAt(id).length};
    return {id,state:s.upgrades.staff?'open':'unstaffed',text:s.upgrades.staff?'服务中':'暂停服务',detail:s.upgrades.staff?'兼岗店员在岗':'雇用兼岗店员后开放',customer:null,waiting:this.queueAt(id).length};
  }
  private chooseCheckout():CheckoutId{return this.helperAvailable&&this.queueAt('flex').length<this.queueAt('main').length?'flex':'main';}
  private redirectCheckoutQueue(){
    if(this.helperAvailable)return;
    let count=0;
    for(const c of this.state.customers)if(c.checkout==='flex'&&['toQueue','queue'].includes(c.state)){
      c.checkout='main';c.nav=freshMotion(c.pos);c.state='toQueue';count++;
    }
    if(count)this.event(`2号收银台暂停接待，${count} 位街坊转往1号台；保留原排队时间。`);
  }
  goodsFor(p:Product,premium=false) {return p==='drinks'&&premium?SHELF_SPEC.premium:GOODS[p];}
  restockGoods(p:Product) {return this.goodsFor(p,p==='drinks'&&this.state.drinksTier===2);}
  shelfUpgradeQuote(target=this.state.drinksTier+1){
    const t=SHELF_TIERS[target];
    const reason=this.state.layoutChange?'正在调整布局':!t?'已经是最高等级':target!==this.state.drinksTier+1?'请依次升级':
      this.state.stats.sold<t.requiredSales?`完成 ${t.requiredSales} 笔成交后开放`:this.state.cash<t.upgradeCost?'现金不足':'';
    return {target,tier:t,cost:t?.upgradeCost??0,reason,allowed:!reason};
  }
  upgradeShelf(target:number){
    const q=this.shelfUpgradeQuote(target);if(!q.allowed)return false;
    this.state.cash-=q.cost;this.state.ledger.upgrades+=q.cost;this.state.drinksTier=target;
    this.state.drinksDoor=this.wantsDoor()?1:0;
    this.event(`${q.tier.name}已就位 · 容量 ${q.tier.capacity} 件 · −${q.cost} 币`);
    return true;
  }
  wantsDoor(){
    const s=this.state;
    return !s.layoutChange&&s.drinksTier===2&&(s.customers.some(c=>!c.approach&&c.product==='drinks'&&['browse','pickup','putback'].includes(c.state))||
      s.delivery?.product==='drinks'&&s.delivery.phase==='stocking'&&!s.delivery.approach);
  }
  available(p:Product) {const x=this.state.shelves[p];return x.onHand-x.reserved;}
  setRestockPolicy(policy:RestockPolicy){
    if(!isRestockPolicy(policy)||this.state.restockPolicy===policy)return false;
    this.state.restockPolicy=policy;this.event(`补货安排：${RESTOCK_POLICIES[policy]}，手上这一箱先送完。`);return true;
  }
  private priority(a:Product,b:Product){
    const policy=this.state.restockPolicy;if(!policy)return 0;
    const preferred=(p:Product)=>policy!=='shortage'&&p===policy?0:1;
    // Use sellable units, including reservations, so a full-looking shelf can
    // still be urgent. Stable ties retain the paid order / product sequence.
    return preferred(a)-preferred(b)||this.available(a)-this.available(b);
  }
  pendingOrders(){
    const s=this.state,active=s.delivery&&s.delivery.phase!=='returning';
    return s.orders.slice(active?1:0).sort((a,b)=>this.priority(a.product,b.product));
  }
  itemVisible(c:Customer,item:ShoppingItem){
    return item.status==='purchased'||item.status==='reserved'&&
      !(c.state==='pickup'&&c.product===item.product&&this.state.tick-c.phaseStarted<6);
  }
  visibleItems(c:Customer){return c.shopping.filter(item=>this.itemVisible(c,item));}
  hasItem(c:Customer) {return this.visibleItems(c).length>0;}
  reservedItems(c:Customer){return c.shopping.filter(item=>item.status==='reserved');}
  basketTotal(c:Customer){return c.shopping.filter(item=>['reserved','purchased'].includes(item.status)).reduce((n,item)=>n+this.goodsFor(item.product,item.premium).price,0);}
  private reserved(p:Product,premium?:boolean){return this.state.customers.flatMap(c=>this.reservedItems(c)).filter(i=>i.product===p&&(premium===undefined||i.premium===premium)).length;}
  onShelf(p:Product) {return this.state.shelves[p].onHand-this.state.customers.flatMap(c=>this.visibleItems(c).filter(i=>i.status==='reserved')).filter(i=>i.product===p).length;}
  premiumOnShelf(p:Product) {return this.state.shelves[p].premium-this.state.customers.flatMap(c=>this.visibleItems(c).filter(i=>i.status==='reserved')).filter(i=>i.product===p&&i.premium).length;}
  orderQuote(p:Product) {
    const s=this.state,x=s.shelves[p];
    if(!x.unlocked)return {quantity:0,cost:0,reason:'先解锁货架'};
    if(s.orders.some(o=>o.product===p))return {quantity:0,cost:0,reason:'补货进行中'};
    const g=this.restockGoods(p),quantity=Math.min(12,this.capacity(p)-x.onHand,Math.floor(s.cash/g.cost));
    return {quantity,cost:quantity*g.cost,reason:quantity>0?'':x.onHand>=this.capacity(p)?'货架已满':'现金不足'};
  }
  order(p:Product) {
    const q=this.orderQuote(p);
    if(!q.quantity)return false;
    this.state.cash-=q.cost;this.state.ledger.procurement+=q.cost;
    const route=this.deliveryRoute(p);
    let distance=0,last=this.layout.delivery;
    for(const point of route){distance+=Math.hypot(point[0]-last[0],point[1]-last[1]);last=point;}
    const duration=LOAD_TICKS+Math.ceil(distance/(1.45*STEP))+STOCK_TICKS;
    const g=this.restockGoods(p);
    this.state.orders.push({product:p,quantity:q.quantity,duration,remaining:duration,premium:p==='drinks'&&this.state.drinksTier===2,unitCost:g.cost,placedAt:this.state.tick});
    this.event(`${g.name}补货 ${q.quantity} 件 · −${q.cost} 币`);
    return true;
  }
  upgrade(k:Upgrade) {
    const s=this.state,cost=UPGRADE_COST[k];
    if(s.stats.sold<5||s.upgrades[k]||s.cash<cost)return false;
    s.cash-=cost;s.ledger.upgrades+=cost;s.upgrades[k]=true;
    this.event({checkout:'收银升级：首件 4 秒，第二件加 0.8 秒',staff:'兼岗店员到岗：平时收银，低库存时补货',marketing:'街坊推荐：客流增加'}[k]);
    return true;
  }
  unlock(p:Product) {
    const s=this.state,g=GOODS[p];
    if(s.shelves[p].unlocked||s.cash<g.unlock||s.stats.sold<10)return false;
    if(p==='fruit'&&!s.shelves.bread.unlocked)return false;
    s.cash-=g.unlock;s.ledger.unlocks+=g.unlock;s.shelves[p].unlocked=true;
    this.event(`${g.name}货架已解锁，记得购买首批库存。`);
    this.checkGoal();return true;
  }
  checkGoal() {
    const s=this.state;
    if(s.stats.goalAt===null&&s.stats.sold>=30&&s.shelves.bread.unlocked){
      s.stats.goalAt=s.tick;this.event('开店目标达成！你已经完成 30 笔成交，并经营两类商品。');
    }
  }
  private bodies(except:number){
    const s=this.state;
    return [...s.customers.filter(c=>c.id!==except).map(c=>c.pos),...(except===0?[]:[s.delivery?.pos??this.layout.delivery])];
  }
  private repairLegacyPositions(){
    const used:Point[]=[];
    if(this.state.delivery){
      const d=this.state.delivery;
      const target=d.phase==='loading'?this.layout.delivery:d.phase==='stocking'?this.layout.shelves[d.product]:d.pos;
      d.pos=this.nav.free(target)?[...target]:this.nav.nearest(target,used);d.nav=freshMotion(d.pos);used.push(d.pos);
      d.approach=['loading','stocking'].includes(d.phase);
    }
    else used.push(this.layout.delivery);
    // Preserve transaction state; only old, overlapping render positions need repair.
    const ordered=[...this.state.customers].sort((a,b)=>Number(b.id===this.state.service)-Number(a.id===this.state.service));
    for(const c of ordered){
      const target=['service','pay'].includes(c.state)?this.station(c).customer as Point:['browse','pickup','putback'].includes(c.state)?this.layout.shelves[c.product]:c.pos;
      c.pos=this.nav.free(target)&&used.every(p=>distance(p,target)>=SEPARATION)?[...target]:this.nav.nearest(target,used);
      c.nav=freshMotion(c.pos);c.approach=['browse','pickup','putback','service','pay'].includes(c.state);used.push(c.pos);
    }
  }
  changeLayout(target:LayoutId){
    const s=this.state;if(!(target in LAYOUT_SPEC.presets)||s.layoutChange||target===s.layoutId)return false;
    const next=navigation(target,true),used:Point[]=[this.layout.delivery],goals:Record<number,Point>={};
    if(s.delivery){used.length=0;const p=this.nav.nearest(s.delivery.pos,used,next);goals[0]=p;used.push(p);}
    for(const c of s.customers){
      const p=next.free(c.pos)&&used.every(q=>distance(q,c.pos)>=SEPARATION+.025)?[...c.pos] as Point:this.nav.nearest(c.pos,used,next);
      goals[c.id]=p;used.push(p);c.nav.path=[];c.nav.goal=null;c.nav.waiting=null;
    }
    s.layoutChange={target,goals};this.event('先让出货架位置，再调整布局。库存和已付订单会保留。');return true;
  }
  private updateLayout(){
    const s=this.state,change=s.layoutChange;if(!change)return false;
    s.nextArrival++;
    let ready=true;
    for(const c of s.customers){
      c.phaseStarted++;if(c.queuedAt)c.queuedAt++;
      if(!this.move(c,change.goals[c.id],1.25,c.id))ready=false;
    }
    if(s.delivery){s.delivery.phaseStarted++;if(!this.move(s.delivery,change.goals[0],1.45,0))ready=false;}
    for(const o of s.orders)o.placedAt++;
    s.drinksDoor=Math.max(0,s.drinksDoor-.12);
    if(ready&&s.drinksDoor===0){
      s.layoutId=change.target;s.layoutChange=null;s.layoutMetrics=metrics(s.tick);s.access={drinks:null,bread:null,fruit:null};
      for(const c of s.customers){c.nav=freshMotion(c.pos);c.approach=['browse','pickup','putback','service','pay'].includes(c.state);}
      if(s.delivery){s.delivery.nav=freshMotion(s.delivery.pos);s.delivery.approach=['loading','stocking'].includes(s.delivery.phase);}
      this.event(`已切换「${LAYOUT_SPEC.presets[s.layoutId].name}」· 从现在开始重新统计动线表现`);
    }
    return true;
  }
  private assignAccess(){
    const s=this.state;
    for(const p of PRODUCT_IDS){
      const owner=s.access[p],d=s.delivery;
      const active=owner===0?d?.product===p&&['walking','stocking'].includes(d.phase):s.customers.some(c=>c.id===owner&&c.product===p&&['enter','shelfQueue','browse','pickup','return','putback'].includes(c.state));
      if(!active)s.access[p]=null;
      if(s.access[p]!==null)continue;
      const waiting=s.customers.filter(c=>c.product===p&&['enter','shelfQueue','browse','pickup','return','putback'].includes(c.state));
      const urgent=waiting.find(c=>['browse','pickup','putback'].includes(c.state));
      const returning=waiting.find(c=>c.state==='return');
      if(urgent)s.access[p]=urgent.id;
      else if(d?.product===p&&d.phase==='stocking')s.access[p]=0;
      else if(returning)s.access[p]=returning.id;
      else if(d?.product===p&&d.phase==='walking')s.access[p]=0;
      else if(waiting.length)s.access[p]=waiting[0].id;
      else if(d?.product===p&&d.phase==='walking')s.access[p]=0;
    }
    // Allocate distinct waiting bays, keeping them stable until a shopper advances.
    const occupied:Point[]=[];
    const candidates=[...s.customers].sort((a,b)=>{
      const ai=s.queue.indexOf(a.id),bi=s.queue.indexOf(b.id);return (ai<0?1000+a.id:ai)-(bi<0?1000+b.id:bi);
    });
    const wait=(agent:Customer|Delivery,near:Point)=>{
      let p=agent.nav.waiting;
      if(!p||occupied.some(q=>distance(q,p!)<SEPARATION))p=[...this.nav.waitPoints].filter(p=>occupied.every(q=>distance(q,p)>=SEPARATION)).sort((a,b)=>distance(a,near)-distance(b,near))[0]??this.nav.nearest(agent.pos,occupied);
      agent.nav.waiting=[...p];occupied.push(p);
    };
    for(const c of candidates){
      if(['toQueue','queue'].includes(c.state)&&this.queueAt(c.checkout??'main')[0]!==c.id)wait(c,this.station(c).customer as Point);
      else if(['enter','shelfQueue','return'].includes(c.state)&&s.access[c.product]!==c.id)wait(c,this.layout.shelves[c.product]);
      else c.nav.waiting=null;
    }
    const d=s.delivery;if(d?.phase==='walking'&&s.access[d.product]!==0)wait(d,this.layout.shelves[d.product]);
    else if(d)d.nav.waiting=null;
  }
  queuePosition(index:number):Point {
    const c=this.state.customers.find(c=>c.id===this.state.queue[index]);
    if(!c)return [...this.layout.checkout];
    if(c&&this.queueAt(c.checkout??'main')[0]===c.id)return [...this.station(c).customer] as Point;
    return c?.nav.waiting??this.nav.waitPoints[(index-1)%this.nav.waitPoints.length];
  }
  spawn(plan?:Arrival,onRejected?:(failure:AdmissionFailure)=>void) {
    const s=this.state;s.stats.arrived++;
    // Consume demand draws even when the entrance is blocked, so comparisons share a demand stream.
    const demand=plan?0:this.random(),style=plan?.style??Math.floor(this.random()*4);
    const kind=plan?.kind??(s.shelves.bread.unlocked&&demand<SHOPPING_SPEC.breakfastShare?'breakfast':'quick');
    const quick:Product[]=s.shelves.fruit.unlocked?['drinks','fruit']:['drinks'];
    const pick=s.shelves.bread.unlocked?(demand-SHOPPING_SPEC.breakfastShare)/(1-SHOPPING_SPEC.breakfastShare):demand;
    const products:Product[]=plan?.products??(kind==='breakfast'?['drinks','bread']:[quick[Math.min(quick.length-1,Math.max(0,Math.floor(pick*quick.length)))]]);
    const p=products[0];
    const entry:Point[]=Array.from({length:4},(_,i)=>[this.layout.entrance[0]-i*.6,this.layout.entrance[1]]);
    const pos=entry.find(p=>this.nav.free(p)&&this.bodies(-1).every(q=>distance(q,p)>=SEPARATION+.01));
    if(s.layoutChange||s.customers.length>=LAYOUT_SPEC.maxCustomers||!pos){
      s.stats.full++;s.layoutMetrics.lost++;
      onRejected?.(admissionFailure(s.layoutChange?'layout':s.customers.length>=LAYOUT_SPEC.maxCustomers?'capacity':'entrance',s.customers,LAYOUT_SPEC.maxCustomers));
      return null;
    }
    const customer:Customer={id:s.nextId++,product:p,state:'enter',pos:[...pos],facing:0,path:[],timer:0,queuedAt:0,reservation:false,happy:false,style,phaseStarted:s.tick,serviceDuration:75,premium:false,nav:freshMotion(pos),approach:false,
      kind,patience:kind==='breakfast'?SHOPPING_SPEC.breakfastPatience:SHOPPING_SPEC.quickPatience,
      shopping:products.map(product=>({product,status:'wanted',premium:false}))};
    s.customers.push(customer);return customer;
  }
  phase(c:Customer,state:Customer['state'],timer=0) {
    c.state=state;c.timer=timer;c.phaseStarted=this.state.tick;c.approach=false;c.nav.goal=null;c.nav.path=[];
  }
  leave(c:Customer,happy=false) {
    const s=this.state;
    if(this.reservedItems(c).length)throw Error('Reserved goods must be purchased or returned before leaving');
    c.reservation=false;
    s.queue=s.queue.filter(id=>id!==c.id);if(s.service===c.id)s.service=null;if(s.helperService===c.id)s.helperService=null;
    this.phase(c,'leave');c.happy=happy;c.path=[];
  }
  private targetItem(c:Customer,item:ShoppingItem,returning=false){
    if(this.state.access[c.product]===c.id)this.state.access[c.product]=null;
    c.product=item.product;c.premium=item.premium;c.nav.waiting=null;
    this.phase(c,returning?'return':'shelfQueue');
  }
  private nextPurchase(c:Customer){
    if(this.state.access[c.product]===c.id)this.state.access[c.product]=null;
    const next=c.shopping.find(item=>item.status==='wanted');
    if(next){this.targetItem(c,next);return;}
    if(this.reservedItems(c).length){c.queuedAt=this.state.tick;c.checkout=this.chooseCheckout();this.phase(c,'toQueue');this.state.queue.push(c.id);}
    else{
      this.state.stats.noStock++;this.state.layoutMetrics.lost++;
      this.event('清单里的商品都缺货，一位顾客空手离开。','loss');this.leave(c);
    }
  }
  private nextReturn(c:Customer){
    const item=this.reservedItems(c)[0];
    if(item)this.targetItem(c,item,true);
    else this.leave(c);
  }
  private payBasket(c:Customer){
    const s=this.state,items=this.reservedItems(c);
    if(!items.length)throw Error('Cannot pay for an empty basket');
    const lines=items.map(item=>({product:item.product,premium:item.premium,amount:this.goodsFor(item.product,item.premium).price}));
    const amount=lines.reduce((n,line)=>n+line.amount,0);
    for(const item of items){
      const shelf=s.shelves[item.product];shelf.onHand--;shelf.sold++;shelf.reserved--;
      if(item.premium){shelf.premium--;shelf.premiumSold++;}
      item.status='purchased';
    }
    c.reservation=false;s.cash+=amount;s.ledger.revenue+=amount;s.stats.sold++;s.stats.unitsSold+=items.length;s.layoutMetrics.sold++;
    if(items.length>1)s.stats.multiSales++;
    const missing=c.shopping.filter(item=>item.status==='missing').map(item=>item.product);
    if(missing.length)s.stats.partialSales++;
    if(s.stats.firstSale===null)s.stats.firstSale=s.tick;
    s.receipts.push({id:s.stats.sold,customer:c.id,product:lines[0].product,premium:lines[0].premium,tick:s.tick,amount,lines,
      requested:c.shopping.map(item=>item.product),missing});
    if(s.receipts.length>24)s.receipts.shift();
    this.event(`${lines.map(line=>this.goodsFor(line.product,line.premium).name).join('＋')} · ${items.length} 件一单${missing.length?'（部分买到）':''} · +${amount} 币`,'sale');
    this.leave(c,true);this.checkGoal();
  }
  move(c:{pos:Point;facing:number;nav:NavMotion},target:Point,speed=1.25,id=-1) {
    const n=c.nav,nav=this.nav;
    if(distance(c.pos,target)<1e-7){n.path=[];n.blocked=0;return true;}
    const others=this.bodies(id);
    if(!n.goal||distance(n.goal,target)>.01){n.goal=[...target];n.path=nav.route(c.pos,target);n.blocked=0;}
    if((!n.path.length||n.blocked>=3)&&this.state.tick%5===id%5){
      const detour=nav.route(c.pos,target,others);if(detour.length)n.path=detour;
    }
    const next=n.path[0];
    if(next){
      const d=distance(c.pos,next),step=Math.min(speed*STEP,d),p:Point=[c.pos[0]+(next[0]-c.pos[0])*step/d,c.pos[1]+(next[1]-c.pos[1])*step/d];
      if(d<1e-7){n.path.shift();return false;}
      if(nav.clear(c.pos,p,others)){
        c.facing=Math.atan2(p[0]-c.pos[0],p[1]-c.pos[1]);c.pos=p;n.moving=true;n.blocked=0;
        if(id===0)this.state.layoutMetrics.walkMeters+=step;
        if(d<=step+1e-7)n.path.shift();return distance(c.pos,target)<1e-7;
      }
    }
    n.blocked++;if(!this.state.layoutChange)this.state.layoutMetrics.blockedTicks++;
    // If two bodies meet head-on, make space before trying the planned route again.
    if(n.blocked>=8){
      const dx=target[0]-c.pos[0],dz=target[1]-c.pos[1],angle=Math.atan2(dx,dz);
      // Include lateral steps: 60-degree-only detours can trap two people
      // between the cabinet's door envelope and the shop boundary.
      const turns=[2,-2,3,-3,1,-1,4,-4,5,-5,6].map(turn=>id%2?turn:-turn);
      for(const turn of turns){
        const a=angle+turn*Math.PI/6,p:Point=[c.pos[0]+Math.sin(a)*speed*STEP,c.pos[1]+Math.cos(a)*speed*STEP];
        if(nav.clear(c.pos,p,others)){
          c.facing=a;c.pos=p;n.moving=true;n.path=[];n.blocked=3;return false;
        }
      }
    }
    return false;
  }
  step(count=1,options:StepOptions={}) {for(let n=0;n<count;n++)this.tick(options);}
  deliveryRoute(p:Product):Point[] {return this.nav.route(this.layout.delivery,this.layout.shelves[p]);}
  private updateDelivery(){
    const s=this.state;
    if(!s.delivery&&s.orders.length&&s.helperService===null){
      const next=this.pendingOrders()[0],index=s.orders.indexOf(next);
      s.orders.splice(index,1);s.orders.unshift(next);
      const o=s.orders[0];s.delivery={product:o.product,quantity:o.quantity,premium:o.premium,phase:'loading',pos:[...this.layout.delivery],path:[],facing:Math.PI/2,timer:LOAD_TICKS,phaseStarted:s.tick,phaseDuration:LOAD_TICKS,nav:freshMotion(this.layout.delivery),approach:false};
    }
    const d=s.delivery;if(!d)return;const o=s.orders[0];
    if(d.phase!=='returning'&&o)o.remaining=Math.max(1,o.remaining-1);
    if(d.approach&&d.phase==='stocking'&&s.access[d.product]!==0){d.phaseStarted++;return;}
    const target=d.phase==='loading'||d.phase==='returning'?this.layout.delivery:s.access[d.product]===0?this.layout.shelves[d.product]:d.nav.waiting??d.pos;
    if(d.approach||d.phase==='walking'||d.phase==='returning'){
      if(!this.move(d,target,1.45,0)){if(d.approach)d.phaseStarted++;return;}
      d.approach=false;
      if(d.phase==='returning'){s.delivery=null;return;}
      if(d.phase==='walking'){
        if(s.access[d.product]!==0)return;
        d.phase='stocking';d.timer=STOCK_TICKS;d.phaseDuration=STOCK_TICKS;d.phaseStarted=s.tick;
      }
    }
    d.facing=d.phase==='stocking'?this.nav.preset[d.product].yaw+Math.PI:Math.PI/2;
    if(d.phase==='loading'){
      if(--d.timer<=0){d.phase='walking';d.phaseStarted=s.tick;d.nav.goal=null;}
    }else if(d.phase==='stocking'){
      if(s.access[d.product]!==0)return;
      if(--d.timer<=0){
        if(!o||o.product!==d.product||o.quantity!==d.quantity)throw Error('Delivery/order mismatch');
        s.shelves[o.product].onHand+=o.quantity;s.shelves[o.product].received+=o.quantity;
        if(o.premium){s.shelves[o.product].premium+=o.quantity;s.shelves[o.product].premiumReceived+=o.quantity;}
        if(o.placedAt>=s.layoutMetrics.since){s.layoutMetrics.deliveryTicks+=s.tick-o.placedAt;s.layoutMetrics.deliveryCount++;}
        s.orders.shift();this.event(`${this.goodsFor(o.product,o.premium).name}已上架 ${o.quantity} 件`);
        d.phase='returning';d.phaseStarted=s.tick;d.nav.goal=null;s.access[d.product]=null;
      }
    }
  }
  private tick(options:StepOptions={}) {
    const s=this.state;s.tick++;
    for(const a of [...s.customers,...(s.delivery?[s.delivery]:[])]){a.nav.previous=[...a.pos];a.nav.moving=false;}
    if(this.updateLayout())return;
    this.redirectCheckoutQueue();this.assignAccess();this.updateDelivery();
    if(options.restock!==false&&s.upgrades.staff)for(const p of [...PRODUCT_IDS].sort((a,b)=>this.priority(a,b)))if(s.shelves[p].unlocked&&this.available(p)<=6)this.order(p);
    if(options.arrivals!==false&&s.tick>=s.nextArrival){this.spawn();const mean=s.upgrades.marketing?60:90;s.nextArrival=s.tick+Math.max(8,Math.round(-Math.log(1-this.random())*mean));}
    for(const c of [...s.customers]) {
      const shelf=this.layout.shelves[c.product],own=s.access[c.product]===c.id;
      if(c.approach&&['browse','pickup','putback','service','pay'].includes(c.state)){
        const checkout=['service','pay'].includes(c.state);
        if(!checkout&&!own||!this.move(c,checkout?this.station(c).customer as Point:shelf,1.25,c.id)){c.phaseStarted++;continue;}
        c.approach=false;
      }
      if(c.state==='enter'||c.state==='shelfQueue'||c.state==='return') {
        const target=own?shelf:c.nav.waiting??c.pos;
        const arrived=this.move(c,target,1.25,c.id);
        if(arrived&&own){this.phase(c,c.state==='return'?'putback':'browse',c.state==='return'?PUTBACK_TICKS:10);c.facing=this.nav.preset[c.product].yaw+Math.PI;}
        else if(c.state==='enter')this.phase(c,'shelfQueue');
      }else if(c.state==='leave'){
        // The entrance is a gate onto the pavement, not a single occupied destination.
        const gate=this.layout.entrance;
        if(c.pos[1]>=gate[1]-.25&&Math.abs(c.pos[0]-gate[0])<=.65||this.move(c,gate,1.25,c.id))
          s.customers=s.customers.filter(x=>x.id!==c.id);
      }else if(c.state==='browse') {
        c.facing=this.nav.preset[c.product].yaw+Math.PI;
        if(--c.timer<=0){
          if(this.available(c.product)>0){
            const x=s.shelves[c.product],regularReserved=this.reserved(c.product,false),item=c.shopping.find(i=>i.product===c.product)!;
            c.premium=x.onHand-x.premium-regularReserved===0;item.premium=c.premium;item.status='reserved';
            s.shelves[c.product].reserved++;c.reservation=true;this.phase(c,'pickup',PICKUP_TICKS);
          }else{
            c.shopping.find(i=>i.product===c.product)!.status='missing';s.stats.missingItems++;
            this.event(`${GOODS[c.product].name}缺货，已记在顾客清单上。`,'info');this.nextPurchase(c);
          }
        }
      }else if(c.state==='pickup'){
        c.facing=this.nav.preset[c.product].yaw+Math.PI;
        if(--c.timer<=0)this.nextPurchase(c);
      }else if(c.state==='toQueue'||c.state==='queue') {
        const index=s.queue.indexOf(c.id);if(index<0)throw Error('Queue membership lost');
        const arrived=this.move(c,this.queuePosition(index),1.25,c.id);
        c.state=arrived?'queue':'toQueue';if(arrived)c.facing=-Math.PI/2;
        if(s.tick-c.queuedAt>=c.patience){s.stats.impatient++;s.layoutMetrics.lost++;this.event('一位顾客等得太久，正逐件放回商品。','loss');s.queue=s.queue.filter(id=>id!==c.id);this.nextReturn(c);continue;}
        const desk=c.checkout??'main';
        if(arrived&&this.queueAt(desk)[0]===c.id&&this.serviceAt(desk)===null&&(desk==='main'||this.helperAvailable)){
          if(c.queuedAt>=s.layoutMetrics.since){s.layoutMetrics.waitTicks+=s.tick-c.queuedAt;s.layoutMetrics.waitCount++;}
          if(desk==='main')s.service=c.id;else s.helperService=c.id;
          c.serviceDuration=(s.upgrades.checkout?40:75)+(this.reservedItems(c).length-1)*SHOPPING_SPEC.extraScanTicks;this.phase(c,'service',c.serviceDuration-PAY_TICKS);c.facing=-Math.PI/2;
        }
      }else if(c.state==='service') {c.facing=-Math.PI/2;if(--c.timer<=0)this.phase(c,'pay',PAY_TICKS);
      }else if(c.state==='pay') {
        c.facing=-Math.PI/2;if(--c.timer<=0)this.payBasket(c);
      }else if(c.state==='putback'){
        c.facing=this.nav.preset[c.product].yaw+Math.PI;
        if(--c.timer<=0){
          c.shopping.find(i=>i.product===c.product)!.status='returned';s.shelves[c.product].reserved--;
          c.reservation=this.reservedItems(c).length>0;s.access[c.product]=null;this.nextReturn(c);
        }
      }
    }
    s.drinksDoor=this.wantsDoor()?Math.min(1,s.drinksDoor+.16):Math.max(0,s.drinksDoor-.12);
  }
  assertValid() {
    const s=this.state;
    const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
    if(s.version!==6||![0,1,2].includes(s.drinksTier)||!Number.isFinite(s.drinksDoor)||s.drinksDoor<0||s.drinksDoor>1)throw Error('Invalid shelf tier or door');
    if(s.roomRevision!==ROOM_SPEC.revision)throw Error('Invalid room revision');
    if(s.restockPolicy!==undefined&&!isRestockPolicy(s.restockPolicy))throw Error('Invalid restock policy');
    if(!['aisle','supply'].includes(s.layoutId)||!s.layoutMetrics||!Object.values(s.layoutMetrics).every(n=>Number.isFinite(n)&&n>=0))throw Error('Invalid layout');
    const point=(p:unknown):p is Point=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
    for(const a of [...s.customers,...(s.delivery?[s.delivery]:[])]){
      if(!a.nav||!point(a.nav.previous)||!Array.isArray(a.nav.path)||!a.nav.path.every(point)||a.nav.goal!==null&&!point(a.nav.goal)||typeof a.approach!=='boolean')throw Error('Invalid navigation');
      if(s.layoutChange&&!point(s.layoutChange.goals['id' in a?a.id:0]))throw Error('Missing staging destination');
    }
    if(s.layoutChange&&!['aisle','supply'].includes(s.layoutChange.target))throw Error('Invalid target layout');
    if(!integer(s.tick)||!integer(s.cash)||!integer(s.rng)||!integer(s.nextArrival)||!integer(s.nextId))throw Error('Invalid scalar state');
    if(!s.ledger||!Object.values(s.ledger).every(integer))throw Error('Invalid ledger');
    if(s.cash!==120+s.ledger.revenue-s.ledger.procurement-s.ledger.upgrades-s.ledger.unlocks)throw Error('Cash conservation failed');
    if(!Array.isArray(s.customers)||s.customers.length>20||!Array.isArray(s.queue)||!Array.isArray(s.orders))throw Error('Invalid collections');
    if(new Set(s.customers.map(c=>c.id)).size!==s.customers.length||new Set(s.queue).size!==s.queue.length)throw Error('Duplicate customer or queue slot');
    for(const p of PRODUCT_IDS) {
      const x=s.shelves[p];
      if(!x||![x.onHand,x.reserved,x.received,x.sold,x.initial].every(integer))throw Error('Invalid inventory');
      if(x.onHand!==x.initial+x.received-x.sold||x.reserved>x.onHand||x.onHand>this.capacity(p))throw Error('Inventory conservation failed');
      if(![x.premium,x.premiumReceived,x.premiumSold].every(integer)||x.premium!==x.premiumReceived-x.premiumSold||x.premium>x.onHand||x.premiumSold>x.sold||p!=='drinks'&&x.premiumReceived)throw Error('Premium inventory mismatch');
      const premiumReserved=this.reserved(p,true);
      if(premiumReserved>x.premium||x.reserved-premiumReserved>x.onHand-x.premium)throw Error('SKU reservation mismatch');
      if(x.reserved!==this.reserved(p))throw Error('Reservation mismatch');
      const incoming=s.orders.filter(o=>o.product===p);
      if(incoming.length>1||x.onHand+incoming.reduce((a,o)=>a+o.quantity,0)>this.capacity(p))throw Error('Incoming capacity exceeded');
    }
    for(const c of s.customers) {
      if(c.checkout!==undefined&&!['main','flex'].includes(c.checkout))throw Error('Invalid checkout');
      if(!integer(c.id)||!GOODS[c.product]||!['enter','shelfQueue','browse','pickup','toQueue','queue','service','pay','return','putback','leave'].includes(c.state)||
        !c.pos.every(Number.isFinite)||!c.path.every(p=>p.length===2&&p.every(Number.isFinite)))throw Error('Invalid customer');
      if(!integer(c.phaseStarted)||!integer(c.timer)||!integer(c.serviceDuration))throw Error('Invalid action phase');
      if(!['quick','breakfast'].includes(c.kind)||!integer(c.patience)||!c.patience||!Array.isArray(c.shopping)||c.shopping.length<1||c.shopping.length>2||
        new Set(c.shopping.map(i=>i.product)).size!==c.shopping.length||!c.shopping.some(i=>i.product===c.product)||
        c.shopping.some(i=>!GOODS[i.product]||!['wanted','reserved','missing','returned','purchased'].includes(i.status)||typeof i.premium!=='boolean'||i.premium&&i.product!=='drinks'))throw Error('Invalid shopping list');
      if(c.kind==='breakfast'&&(c.shopping.length!==2||c.shopping[0].product!=='drinks'||c.shopping[1].product!=='bread'))throw Error('Invalid breakfast list');
      if(c.kind==='quick'&&c.shopping.length!==1)throw Error('Invalid quick list');
      if(c.reservation!==(this.reservedItems(c).length>0))throw Error('Reservation state mismatch');
      const active=c.shopping.find(i=>i.product===c.product)!;
      if(c.premium!==active.premium||c.state==='browse'&&active.status!=='wanted'||
        ['pickup','return','putback'].includes(c.state)&&active.status!=='reserved'||
        ['toQueue','queue','service','pay'].includes(c.state)&&(!c.reservation||c.shopping.some(i=>i.status==='wanted'))||
        c.state==='leave'&&c.reservation||c.shopping.some(i=>i.status==='purchased')&&!c.happy)throw Error('Shopping phase mismatch');
      if(typeof c.premium!=='boolean'||c.premium&&c.product!=='drinks')throw Error('Invalid customer SKU');
    }
    const expected=s.customers.filter(c=>['toQueue','queue','service','pay'].includes(c.state)).map(c=>c.id);
    if(expected.length!==s.queue.length||s.queue.some(id=>!expected.includes(id)))throw Error('Queue mismatch');
    const services=s.customers.filter(c=>['service','pay'].includes(c.state));
    if(services.length>2||((services.find(c=>(c.checkout??'main')==='main')?.id??null)!==s.service)||
      ((services.find(c=>c.checkout==='flex')?.id??null)!==s.helperService)||
      services.filter(c=>(c.checkout??'main')==='main').length>1||services.filter(c=>c.checkout==='flex').length>1||
      s.helperService!==null&&(s.delivery!==null||!s.upgrades.staff))throw Error('Service mismatch');
    if(![s.stats.sold,s.stats.unitsSold,s.stats.multiSales,s.stats.partialSales,s.stats.missingItems].every(integer)||
      s.stats.unitsSold!==PRODUCT_IDS.reduce((n,p)=>n+s.shelves[p].sold,0)||s.stats.unitsSold!==s.stats.sold+s.stats.multiSales||
      s.stats.partialSales+s.stats.multiSales>s.stats.sold)throw Error('Sales mismatch');
    if(s.ledger.revenue!==PRODUCT_IDS.reduce((n,p)=>n+(s.shelves[p].sold-s.shelves[p].premiumSold)*GOODS[p].price+s.shelves[p].premiumSold*this.goodsFor(p,true).price,0))throw Error('Revenue mismatch');
    for(const o of s.orders)if(!GOODS[o.product]||!integer(o.quantity)||!o.quantity||!integer(o.remaining)||o.remaining>o.duration||o.remaining===0||
      typeof o.premium!=='boolean'||o.premium&&o.product!=='drinks'||o.unitCost!==this.goodsFor(o.product,o.premium).cost)throw Error('Invalid order');
    if(!Object.values(s.upgrades).every(v=>typeof v==='boolean'))throw Error('Invalid upgrades');
    if(!Array.isArray(s.receipts)||new Set(s.receipts.map(r=>r.id)).size!==s.receipts.length)throw Error('Invalid receipts');
    for(const r of s.receipts){
      if(!integer(r.id)||!r.id||r.id>s.stats.sold||!Array.isArray(r.lines)||!r.lines.length||r.lines.length>2||
        r.lines.some(line=>!GOODS[line.product]||typeof line.premium!=='boolean'||line.premium&&line.product!=='drinks'||line.amount!==this.goodsFor(line.product,line.premium).price)||
        new Set(r.lines.map(line=>line.product)).size!==r.lines.length||r.amount!==r.lines.reduce((n,line)=>n+line.amount,0)||
        r.product!==r.lines[0].product||r.premium!==r.lines[0].premium||!Array.isArray(r.requested)||!Array.isArray(r.missing)||
        r.requested.length!==r.lines.length+r.missing.length||new Set(r.requested).size!==r.requested.length||new Set([...r.lines.map(line=>line.product),...r.missing]).size!==r.requested.length||
        r.requested.some(p=>!GOODS[p]||!r.lines.some(line=>line.product===p)&&!r.missing.includes(p)))throw Error('Invalid receipt lines');
    }
    if(s.delivery){
      const d=s.delivery;
      if(!['loading','walking','stocking','returning'].includes(d.phase)||!d.pos.every(Number.isFinite)||!integer(d.timer)||!integer(d.phaseStarted)||!integer(d.phaseDuration))throw Error('Invalid delivery phase');
      if(d.phase!=='returning'&&(!s.orders[0]||d.product!==s.orders[0].product||d.quantity!==s.orders[0].quantity||d.premium!==s.orders[0].premium))throw Error('Delivery has no paid order');
    }
  }
}
/** Fractional wall-clock time is only an input adapter; rules always advance in 100 ms steps. */
export class FixedClock {
  accumulator=0;
  feed(shop:{step(count:number):void},seconds:number) {
    this.accumulator+=seconds;
    const ticks=Math.floor((this.accumulator+1e-9)/STEP);
    if(ticks>0){shop.step(ticks);this.accumulator-=ticks*STEP;}
  }
}
