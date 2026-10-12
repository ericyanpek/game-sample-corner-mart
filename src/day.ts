import {Shop,GOODS,PRODUCT_IDS,SHELF_SPEC,isRestockPolicy,type RestockPolicy,type Arrival,type Product,type ShopState,type Upgrade,type LayoutId} from './sim.ts';
import START from '../assets/specs/day-start.json';
import {DAY_THEMES,isDayTheme,type DayThemeId} from './day-themes.ts';
import {summarizeAdmissions,admissionFeedback,validAdmission,type AdmissionFailure,type AdmissionSummary} from './admission.ts';

export const DAY_TICKS=1800,DAY_SEED=20260915,DAY_TARGET=20;
export type DayPhase='preparing'|'open'|'closing'|'settled';
type Outcome='planned'|'shopping'|'complete'|'partial'|'empty'|'impatient'|'blocked';
export interface Visit extends Arrival {at:number;customer:number|null;outcome:Outcome;missing:Product[];blockedByLayout:boolean;rejection?:AdmissionFailure}
export interface RestockingStats {
  since:number;observedTicks:number;stockoutTicks:Record<Product,number>;
  initialPolicy:RestockPolicy|'fifo';changes:{at:number;policy:RestockPolicy}[];
}
export interface DayReport {
  attempt:number;conditions:string;demand:number;admitted:number;complete:number;partial:number;empty:number;impatient:number;blocked:number;layoutBlocked:number;
  completion:number;orders:number;units:number;revenue:number;cogs:number;grossProfit:number;
  procurement:number;upgrades:number;unlocks:number;startCash:number;endCash:number;cashChange:number;
  startInventory:number;endInventory:number;closingSeconds:number;waitSeconds:number|null;waitCount:number;deliverySeconds:number|null;deliveryCount:number;
  byProduct:{product:Product;wanted:number;missing:number;sold:number;revenue:number;cogs:number}[];
  layout:LayoutId;tier:number;staff:boolean;fastCheckout:boolean;feedback:string[];
  restocking?:RestockingStats;
  admission?:AdmissionSummary;
}
interface SavedDay {
  version:2;theme:DayThemeId;baseline:ShopState;shop:ShopState;seed:number;attempt:number;phase:DayPhase;elapsed:number;closingTicks:number;
  openedAt:number|null;visits:Visit[];history:DayReport[];waitTicks:number;waitCount:number;deliveryTicks:number;deliveryCount:number;
  restocking?:RestockingStats;
  routingVersion?:1|2|3;routingChangedAt?:number;
  baselineSignature?:string;
}
function signature(value:unknown){let n=2166136261;for(const c of JSON.stringify(value))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16);}
export function demandPlan(seed=DAY_SEED,theme:DayThemeId='breakfast'):Visit[]{
  let rng=seed>>>0;
  const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const visits:Visit[]=[];
  for(let at=20;at<DAY_TICKS;at+=42+Math.floor(random()*23)){
    const kind=random()<DAY_THEMES[theme].breakfastShare?'breakfast':'quick';
    const arrival=theme==='rush'?Math.round(at<300?at*2:at<1500?600+(at-300)*.5:1200+(at-1500)*2):at;
    visits.push({at:arrival,kind,products:kind==='breakfast'?['drinks','bread']:['drinks'],style:Math.floor(random()*4),customer:null,outcome:'planned',missing:[],blockedByLayout:false});
  }
  return visits;
}
function inventory(s:ShopState){return PRODUCT_IDS.reduce((n,p)=>n+(s.shelves[p].onHand-s.shelves[p].premium)*GOODS[p].cost+s.shelves[p].premium*SHELF_SPEC.premium.cost,0);}
export class BusinessDay {
  shop:Shop;baseline:ShopState;seed:number;attempt=1;phase:DayPhase='preparing';elapsed=0;closingTicks=0;openedAt:number|null=null;
  visits:Visit[];history:DayReport[]=[];waitTicks=0;waitCount=0;deliveryTicks=0;deliveryCount=0;
  restocking?:RestockingStats;
  routingVersion:1|2|3=3;routingChangedAt=0;
  baselineSignature:string;
  constructor(baseline?:ShopState,seed=DAY_SEED,public theme:DayThemeId='breakfast'){
    if(!isDayTheme(theme))throw Error('Unknown business-day theme');
    this.baselineSignature=signature(baseline??START);
    this.baseline=Shop.restore(baseline??START).snapshot();
    if(!baseline)this.baseline.restockPolicy='shortage';
    this.shop=Shop.restore(this.baseline);this.seed=seed;this.visits=demandPlan(seed,theme);
    this.beginRestockingStats();
  }
  private beginRestockingStats(){
    this.restocking={since:this.elapsed,observedTicks:0,stockoutTicks:{drinks:0,bread:0,fruit:0},initialPolicy:this.shop.state.restockPolicy??'fifo',changes:[]};
  }
  private get originalConditions(){return `${this.theme}-v1-${this.seed}-${this.baselineSignature}`;}
  get conditions(){return this.originalConditions+(this.routingVersion===1?'':`-checkouts2${this.routingVersion===3?'-room2':''}${this.routingChangedAt?'-from'+this.routingChangedAt:''}`);}
  previousComparable(){return this.history.filter(r=>r.attempt<this.attempt&&r.conditions===this.conditions).at(-1);}
  periods(){
    return [0,600,1200].map(start=>{
      const visits=this.visits.filter(v=>v.at>=start&&v.at<start+600);
      return {start,end:start+600,demand:visits.length,complete:visits.filter(v=>v.outcome==='complete').length,
        blocked:visits.filter(v=>v.outcome==='blocked').length,impatient:visits.filter(v=>v.outcome==='impatient').length,
        missing:visits.filter(v=>v.missing.length>0).length};
    });
  }
  get canOpen(){const s=this.shop.state;return this.phase==='preparing'&&!s.customers.length&&!s.orders.length&&!s.delivery&&!s.layoutChange;}
  get canEdit(){return this.phase==='preparing'||this.phase==='open';}
  open(){
    if(!this.canOpen)return false;
    // Navigation staggers replanning on a five-tick cadence. Align idle opening
    // so waiting longer in preparation cannot change the same shopping routes.
    this.shop.step((5-this.shop.state.tick%5)%5,{arrivals:false,restock:false});
    this.openedAt=this.shop.state.tick;this.phase='open';return true;
  }
  action(kind:string,key:string){
    if(!this.canEdit||key==='fruit'||key==='marketing')return false;
    if(kind==='restock'&&isRestockPolicy(key)){
      if(!this.restocking)this.beginRestockingStats();
      if(!this.shop.setRestockPolicy(key))return false;
      this.restocking!.changes.push({at:this.elapsed,policy:key});return true;
    }
    if(kind==='order'&&PRODUCT_IDS.includes(key as Product))return this.shop.order(key as Product);
    if(kind==='upgrade'&&['checkout','staff'].includes(key))return this.shop.upgrade(key as Upgrade);
    if(kind==='shelf')return this.shop.upgradeShelf(Number(key));
    if(kind==='layout'&&['aisle','supply'].includes(key))return this.shop.changeLayout(key as LayoutId);
    return false;
  }
  step(count=1){
    for(let i=0;i<count;i++){
      if(this.phase==='settled')return;
      const phase=this.phase;
      if(phase==='open'){
        if(this.restocking){
          this.restocking.observedTicks++;
          for(const p of PRODUCT_IDS)if(this.shop.state.shelves[p].unlocked&&this.shop.available(p)===0)this.restocking.stockoutTicks[p]++;
        }
        this.elapsed++;
        for(const v of this.visits)if(v.outcome==='planned'&&v.at<=this.elapsed){
          v.blockedByLayout=Boolean(this.shop.state.layoutChange);
          const c=this.shop.spawn(v,failure=>{v.rejection=failure;});v.customer=c?.id??null;v.outcome=c?'shopping':'blocked';
        }
        if(this.elapsed>=DAY_TICKS)this.phase='closing';
      }else if(phase==='closing')this.closingTicks++;
      const before=this.shop.state.customers.map(c=>({id:c.id,state:c.state,queuedAt:c.queuedAt}));
      const deliveryPhase=this.shop.state.delivery?.phase,order=this.shop.state.orders[0];
      const deliveredBefore=this.shop.state.shelves.drinks.received+this.shop.state.shelves.bread.received;
      this.shop.step(1,{arrivals:false,restock:this.phase==='open'});
      if(phase!=='preparing'){
        for(const c of this.shop.state.customers){
          const v=this.visits.find(v=>v.customer===c.id);if(!v)throw Error('Unexpected visitor in business day');
          v.missing=[...new Set([...v.missing,...c.shopping.filter(i=>i.status==='missing').map(i=>i.product)])];
          const prior=before.find(p=>p.id===c.id);
          if(c.state==='service'&&prior?.state!=='service'){
            this.waitCount++;this.waitTicks+=this.shop.state.tick-c.queuedAt;
          }
          if(c.state==='leave')v.outcome=c.happy?(v.missing.length?'partial':'complete'):c.shopping.some(i=>i.status==='returned')?'impatient':'empty';
        }
        const deliveredAfter=this.shop.state.shelves.drinks.received+this.shop.state.shelves.bread.received;
        if(deliveryPhase==='stocking'&&order&&deliveredAfter>deliveredBefore&&order.placedAt>=this.openedAt!){
          this.deliveryCount++;this.deliveryTicks+=this.shop.state.tick-order.placedAt;
        }
      }
      const s=this.shop.state;
      if(this.phase==='closing'&&!s.customers.length&&!s.orders.length&&!s.delivery&&!s.layoutChange){
        this.phase='settled';this.history.push(this.report());this.history=this.history.slice(-5);
      }
    }
  }
  report():DayReport {
    const s=this.shop.state,b=this.baseline,delta=(key:keyof ShopState['ledger'])=>s.ledger[key]-b.ledger[key];
    const count=(outcome:Outcome)=>this.visits.filter(v=>v.outcome===outcome).length;
    const byProduct=PRODUCT_IDS.map(product=>{
      const x=s.shelves[product],old=b.shelves[product],sold=x.sold-old.sold,premium=x.premiumSold-old.premiumSold;
      return {product,wanted:this.visits.filter(v=>v.products.includes(product)).length,missing:this.visits.filter(v=>v.missing.includes(product)).length,sold,
        revenue:(sold-premium)*GOODS[product].price+premium*SHELF_SPEC.premium.price,cogs:(sold-premium)*GOODS[product].cost+premium*SHELF_SPEC.premium.cost};
    });
    const revenue=delta('revenue'),cogs=byProduct.reduce((n,p)=>n+p.cogs,0),complete=count('complete');
    const report:DayReport={
      attempt:this.attempt,conditions:this.conditions,demand:this.visits.length,admitted:this.visits.filter(v=>v.customer!==null).length,
      complete,partial:count('partial'),empty:count('empty'),impatient:s.stats.impatient-b.stats.impatient,blocked:count('blocked'),
      layoutBlocked:this.visits.filter(v=>v.outcome==='blocked'&&v.blockedByLayout).length,
      completion:complete/this.visits.length,orders:s.stats.sold-b.stats.sold,units:s.stats.unitsSold-b.stats.unitsSold,revenue,cogs,grossProfit:revenue-cogs,
      procurement:delta('procurement'),upgrades:delta('upgrades'),unlocks:delta('unlocks'),startCash:b.cash,endCash:s.cash,cashChange:s.cash-b.cash,
      startInventory:inventory(b),endInventory:inventory(s),closingSeconds:this.closingTicks/10,
      waitSeconds:this.waitCount?this.waitTicks/this.waitCount/10:null,waitCount:this.waitCount,
      deliverySeconds:this.deliveryCount?this.deliveryTicks/this.deliveryCount/10:null,deliveryCount:this.deliveryCount,
      byProduct,layout:s.layoutId,tier:s.drinksTier,staff:s.upgrades.staff,fastCheckout:s.upgrades.checkout,feedback:[],
      admission:summarizeAdmissions(this.visits),
    };
    if(this.restocking)report.restocking=structuredClone(this.restocking);
    for(const p of byProduct.filter(p=>p.missing).sort((a,b)=>b.missing-a.missing)){
      report.feedback.push(`${{drinks:'饮料',bread:'面包',fruit:'水果'}[p.product]}被 ${p.missing} 位顾客标记缺货。下一次可以提前备货，或更早安排补货。`);
    }
    if(report.impatient)report.feedback.push(`${report.impatient} 位顾客因排队超时放回商品。${report.fastCheckout?'可以试着缩短购物到收银的路线。':'可以试试升级收银台。'}`);
    report.feedback.push(...admissionFeedback(report.admission!));
    if(this.theme==='hot'){
      const drink=byProduct.find(p=>p.product==='drinks')!,bread=byProduct.find(p=>p.product==='bread')!;
      report.feedback.push(`今天有 ${drink.wanted} 位街坊想买饮料，${bread.wanted} 位还想买面包。${drink.missing?'饮料出现缺货，下次可在开门前多备一批。':s.shelves.bread.onHand?'面包还剩 '+s.shelves.bread.onHand+' 件，下一轮可优先把预算留给饮料和收银。':'可以比较增加饮料备货后，完整购物和期末库存怎样变化。'}`);
    }
    if(this.theme==='rush'){
      const peak=this.periods()[1];
      report.feedback.push(`01:00—02:00 到店的 ${peak.demand} 位顾客中，${peak.complete} 位买齐、${peak.blocked} 位未入店、${peak.impatient} 位排队超时。${peak.missing?'其中 '+peak.missing+' 位遇到缺货，可提前备货。':peak.blocked+peak.impatient?'下一次可试收银升级或在开门前调整布局。':'这一段没有缺货，可结合等待和入店情况继续调整。'}`);
    }
    if(!report.feedback.length)report.feedback.push('这一轮没有缺货或顾客流失。试着用更少的采购和升级支出，维持完整购物体验。');
    return report;
  }
  replay(){
    if(this.phase!=='settled')throw Error('Finish the current day before replay');
    const next=new BusinessDay(this.baseline,this.seed,this.theme);next.baselineSignature=this.baselineSignature;next.attempt=this.attempt+1;next.history=structuredClone(this.history);return next;
  }
  snapshot():SavedDay {
    return structuredClone({version:2,theme:this.theme,baseline:this.baseline,shop:this.shop.snapshot(),seed:this.seed,attempt:this.attempt,phase:this.phase,
      elapsed:this.elapsed,closingTicks:this.closingTicks,openedAt:this.openedAt,visits:this.visits,history:this.history,
      waitTicks:this.waitTicks,waitCount:this.waitCount,deliveryTicks:this.deliveryTicks,deliveryCount:this.deliveryCount,
      ...(this.restocking?{restocking:this.restocking}:{}),routingVersion:this.routingVersion,routingChangedAt:this.routingChangedAt,baselineSignature:this.baselineSignature});
  }
  static restore(data:unknown){
    const raw=structuredClone(data) as Omit<SavedDay,'version'|'theme'>&{version:number;theme?:DayThemeId};
    if(!raw||![1,2].includes(raw.version)||raw.version===2&&!isDayTheme(raw.theme))throw Error('Unsupported business day save');
    const day=new BusinessDay(raw.baseline,raw.seed,raw.version===1?'breakfast':raw.theme);day.shop=Shop.restore(raw.shop);
    day.restocking=raw.restocking;
    day.baselineSignature=raw.baselineSignature??signature(raw.baseline);
    // Preserve finished reports. A day resumed during relocation is a mixed-route run,
    // so it must not be advertised as an identical-condition replay.
    const oldRoutes=raw.routingVersion!==3&&raw.phase!=='settled';
    day.routingVersion=oldRoutes?3:raw.routingVersion??1;
    day.routingChangedAt=oldRoutes?(['open','closing'].includes(raw.phase)?raw.elapsed:0):raw.routingChangedAt??0;
    if(day.routingVersion===1)day.routingChangedAt=0;
    for(const k of ['attempt','phase','elapsed','closingTicks','openedAt','visits','history','waitTicks','waitCount','deliveryTicks','deliveryCount'] as const)
      Object.assign(day,{[k]:raw[k]});
    day.assertValid();return day;
  }
  assertValid(){
    this.shop.assertValid();Shop.restore(this.baseline);
    const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
    if(!/^[0-9a-f]{1,8}$/.test(this.baselineSignature))throw Error('Invalid condition identity');
    if(![1,2,3].includes(this.routingVersion)||!integer(this.routingChangedAt)||this.routingChangedAt>this.elapsed)throw Error('Invalid route revision');
    if(!['preparing','open','closing','settled'].includes(this.phase)||![this.seed,this.attempt,this.elapsed,this.closingTicks,this.waitTicks,this.waitCount,this.deliveryTicks,this.deliveryCount].every(integer)||this.attempt<1||this.elapsed>DAY_TICKS)throw Error('Invalid business day counters');
    const rs=this.restocking;
    if(rs){
      if(!integer(rs.since)||!integer(rs.observedTicks)||rs.since+rs.observedTicks!==this.elapsed||
        !rs.stockoutTicks||PRODUCT_IDS.some(p=>!integer(rs.stockoutTicks[p])||rs.stockoutTicks[p]>rs.observedTicks)||
        rs.initialPolicy!=='fifo'&&!isRestockPolicy(rs.initialPolicy)||!Array.isArray(rs.changes)||
        rs.changes.some((c,i)=>!integer(c.at)||c.at<rs.since||c.at>this.elapsed||i>0&&c.at<rs.changes[i-1].at||!isRestockPolicy(c.policy))||
        (rs.changes.at(-1)?.policy??rs.initialPolicy)!==(this.shop.state.restockPolicy??'fifo'))throw Error('Invalid restocking record');
    }
    if(this.phase==='preparing'&&(this.elapsed!==0||this.openedAt!==null)||this.phase!=='preparing'&&(!integer(this.openedAt)||this.openedAt!>this.shop.state.tick)||['closing','settled'].includes(this.phase)&&this.elapsed!==DAY_TICKS)throw Error('Invalid business day phase');
    const plan=demandPlan(this.seed,this.theme),outcomes=['planned','shopping','complete','partial','empty','impatient','blocked'];
    if(!Array.isArray(this.visits)||this.visits.length!==plan.length)throw Error('Invalid demand tape');
    const ids=new Set<number>();
    this.visits.forEach((v,i)=>{
      const expected=plan[i];
      if(v.at!==expected.at||v.kind!==expected.kind||v.style!==expected.style||JSON.stringify(v.products)!==JSON.stringify(expected.products)||
        !outcomes.includes(v.outcome)||!Array.isArray(v.missing)||v.missing.some(p=>!v.products.includes(p))||new Set(v.missing).size!==v.missing.length||
        typeof v.blockedByLayout!=='boolean'||(v.outcome==='planned')!==(v.at>this.elapsed)||
        (['planned','blocked'].includes(v.outcome)?v.customer!==null:!integer(v.customer)||v.customer===0))throw Error('Invalid demand outcome');
      if(v.customer!==null){if(ids.has(v.customer))throw Error('Duplicate demand visitor');ids.add(v.customer);}
      if(v.rejection&&(v.outcome!=='blocked'||!validAdmission(v.rejection)||
        (v.rejection.reason==='layout')!==v.blockedByLayout))throw Error('Invalid admission record');
    });
    const s=this.shop.state,r=this.report();
    if(s.customers.some(c=>!ids.has(c.id))||s.upgrades.marketing!==this.baseline.upgrades.marketing||r.orders!==r.complete+r.partial||
      r.cashChange!==r.revenue-r.procurement-r.upgrades-r.unlocks)throw Error('Inconsistent day accounting');
    const validConditions=(c:string)=>{
      if(c===this.originalConditions)return true;
      return ['-checkouts2','-checkouts2-room2'].some(revision=>{
        const base=this.originalConditions+revision;if(c===base)return true;
        const prefix=base+'-from',suffix=c.startsWith(prefix)?c.slice(prefix.length):'';
        return /^[1-9]\d*$/.test(suffix)&&Number(suffix)<=DAY_TICKS;
      });
    };
    if(!Array.isArray(this.history)||this.history.length>5||this.history.some(r=>!validConditions(r.conditions)||!integer(r.attempt)||r.attempt>this.attempt))throw Error('Invalid replay history');
    if(this.phase==='settled'){
      // Historical wording may change; financial and outcome facts must still match.
      const facts=(report:DayReport|undefined)=>{
        if(!report)return null;
        const {feedback,admission,...rest}=report;return rest;
      };
      const last=this.history.at(-1);
      if(s.customers.length||s.orders.length||s.delivery||s.layoutChange||this.visits.some(v=>['planned','shopping'].includes(v.outcome))||
        r.demand!==r.complete+r.partial+r.empty+r.impatient+r.blocked||r.startInventory+r.procurement-r.cogs!==r.endInventory||
        JSON.stringify(facts(last))!==JSON.stringify(facts(r))||
        last?.admission&&JSON.stringify(last.admission)!==JSON.stringify(r.admission))throw Error('Unfinished or inconsistent day settlement');
    }
  }
}
