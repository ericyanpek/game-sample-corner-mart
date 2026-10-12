import {Shop,LAYOUT_SPEC,type LayoutId,type LayoutMetrics} from './sim.ts';
import START from '../assets/specs/layout-lab-start.json';
export const SEEDS=[1,13,20260914],DURATION=6000;
export interface Trial {layout:LayoutId;seed:number;arrivals:number;metrics:LayoutMetrics;cashChange:number;remaining:number;demandRng:number}
export function trial(layout:LayoutId,seed:number):Trial {
  const s=Shop.restore(START),cash=s.state.cash,arrived=s.state.stats.arrived;
  s.state.seed=seed;s.state.rng=seed;s.state.layoutId=layout;s.state.nextArrival=s.state.tick+15;
  for(let i=0;i<DURATION;i++)s.step();
  s.assertValid();
  return {layout,seed,arrivals:s.state.stats.arrived-arrived,metrics:s.state.layoutMetrics,cashChange:s.state.cash-cash,remaining:s.state.customers.length,demandRng:s.state.rng};
}
export function compare(progress?:(done:number)=>void){
  const trials:Trial[]=[];
  for(const id of ['aisle','supply'] as LayoutId[])for(const seed of SEEDS){trials.push(trial(id,seed));progress?.(trials.length);}
  const results=(['aisle','supply'] as LayoutId[]).map(id=>{
    const runs=trials.filter(r=>r.layout===id);
    const sum=(k:keyof LayoutMetrics)=>runs.reduce((n,r)=>n+r.metrics[k],0);
    return {id,name:LAYOUT_SPEC.presets[id].name,waitSeconds:sum('waitTicks')/10/(sum('waitCount')||1),waitCount:sum('waitCount'),
      deliverySeconds:sum('deliveryTicks')/10/(sum('deliveryCount')||1),deliveryCount:sum('deliveryCount'),
      lost:sum('lost'),sold:sum('sold'),arrived:runs.reduce((n,r)=>n+r.arrivals,0),workerMeters:sum('walkMeters')};
  });
  return {seeds:SEEDS,secondsPerRun:DURATION/10,startingCash:START.cash,startingStock:START.shelves.drinks.onHand,trials,results};
}
export type Comparison=ReturnType<typeof compare>;
