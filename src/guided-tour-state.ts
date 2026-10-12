import type {BusinessDay} from './day.ts';
import {DAY_THEMES} from './day-themes.ts';

export const GUIDE_STEPS=['welcome','forecast','hire','restock','upgrade','open','customer','checkout','layout','dispatch','finish','report','done','skipped','briefing'] as const;
export type GuideStep=typeof GUIDE_STEPS[number];
export type RoundGuidance='guided'|'free'|'theme';
export interface GuideProgress {
  version:2;step:GuideStep;conditions:string;attempt:number;
  receivedBefore:number;customerId:number|null;completed:GuideStep[];
  pov:{restock:boolean;checkout:boolean};
}
export function guidedStorageKey(theme:string){return `corner-mart-guided-v1-${theme}`;}
export function freshGuide(day:BusinessDay):GuideProgress {
  return {version:2,step:'welcome',conditions:day.conditions,attempt:day.attempt,receivedBefore:day.shop.state.shelves.bread.received,customerId:null,completed:[],pov:{restock:false,checkout:false}};
}
export function restoreGuide(value:unknown,day:BusinessDay):GuideProgress {
  const p=value as (Omit<Partial<GuideProgress>,'version'>&{version?:number})|null;
  if(!p||![1,2].includes(p.version!)||!GUIDE_STEPS.includes(p.step!)||p.conditions!==day.conditions||p.attempt!==day.attempt||
    !Number.isFinite(p.receivedBefore)||!Array.isArray(p.completed)||
    !p.completed.every(x=>GUIDE_STEPS.includes(x))||(p.customerId!==null&&!Number.isInteger(p.customerId))) {
    const next=freshGuide(day);if(day.phase!=='preparing')next.step=day.phase==='settled'?'report':'finish';return next;
  }
  // Retire the mandatory showcase steps without changing purchases or the business day.
  const step=({forecast:'hire',upgrade:'open',layout:'finish',dispatch:'finish'} as Partial<Record<GuideStep,GuideStep>>)[p.step!]??p.step!;
  return {...p,version:2,step,completed:[...p.completed],pov:{restock:p.pov?.restock===true,checkout:p.pov?.checkout===true}} as GuideProgress;
}
/** This changes only the guide: never the saved day, its purchases or demand. */
export function roundGuide(day:BusinessDay,mode:RoundGuidance):GuideProgress {
  const progress=restoreGuide(null,day);
  if(day.phase!=='settled'){
    if(mode==='free')progress.step='skipped';
    if(mode==='theme')progress.step='briefing';
  }
  return progress;
}
export function themeBriefing(day:BusinessDay){
  const drinks=day.visits.filter(v=>v.products.includes('drinks')).length;
  const bread=day.visits.filter(v=>v.products.includes('bread')).length;
  const demand=day.theme==='rush'?`第 2 分钟有 ${day.periods()[1].demand} 位街坊到店，提前备货，留意收银。`:
    `今天饮料需求 ${drinks} 件、面包 ${bread} 件。${DAY_THEMES[day.theme].description}`;
  return {title:`${DAY_THEMES[day.theme].name} · 这次留意什么？`,
    text:demand+(day.phase==='preparing'?'筹备不计时，准备好后再开门。':'已恢复上次进度，继续这一轮即可。')};
}
/** These gates read the simulation, never a click counter or a timeout. */
export function guideOutcome(step:GuideStep,day:BusinessDay,p:GuideProgress){
  const s=day.shop.state;
  switch(step){
    case 'hire':return s.upgrades.staff;
    case 'restock':return s.shelves.bread.received>p.receivedBefore;
    case 'upgrade':return s.drinksTier>=1;
    case 'open':return day.phase!=='preparing';
    case 'checkout':return day.visits.some(v=>v.customer===p.customerId&&['complete','partial','empty','impatient'].includes(v.outcome));
    case 'layout':return s.layoutId==='supply'&&!s.layoutChange;
    case 'dispatch':return s.restockPolicy==='bread';
    case 'finish':return day.phase==='settled';
    default:return false;
  }
}
