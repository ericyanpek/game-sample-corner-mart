import type {Customer} from './sim.ts';

export type AdmissionReason='capacity'|'entrance'|'layout';
export interface AdmissionFailure {
  reason:AdmissionReason;occupied:number;limit:number;
  stages:{shopping:number;checkout:number;leaving:number};
}
export interface AdmissionSummary {
  capacity:number;entrance:number;layout:number;unknown:number;
  periods:{start:number;capacity:number;entrance:number;layout:number;unknown:number}[];
}
export const admissionLabels={capacity:'店内满员',entrance:'入口暂时受阻',layout:'正在调整布局',unknown:'原因未记录'};
export function admissionFailure(reason:AdmissionReason,customers:Customer[],limit:number):AdmissionFailure{
  const stages={shopping:0,checkout:0,leaving:0};
  for(const c of customers){
    if(c.state==='leave')stages.leaving++;
    else if(['toQueue','queue','service','pay'].includes(c.state))stages.checkout++;
    else stages.shopping++;
  }
  return {reason,occupied:customers.length,limit,stages};
}
export function validAdmission(v:AdmissionFailure){
  const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  return v&&['capacity','entrance','layout'].includes(v.reason)&&
    integer(v.occupied)&&integer(v.limit)&&v.limit>0&&v.stages&&
    Object.values(v.stages).every(integer)&&
    ['shopping','checkout','leaving'].every(k=>integer(v.stages[k as keyof typeof v.stages]))&&
    v.stages.shopping+v.stages.checkout+v.stages.leaving===v.occupied&&
    (v.reason!=='capacity'||v.occupied>=v.limit);
}
export function summarizeAdmissions(visits:{at:number;outcome:string;blockedByLayout:boolean;rejection?:AdmissionFailure}[]):AdmissionSummary{
  const counts=()=>({capacity:0,entrance:0,layout:0,unknown:0});
  const result:AdmissionSummary={...counts(),periods:[0,600,1200].map(start=>({start,...counts()}))};
  for(const v of visits)if(v.outcome==='blocked'){
    // Legacy saves only knew whether a layout move was in progress.
    const reason=v.rejection?.reason??(v.blockedByLayout?'layout':'unknown');
    result[reason]++;
    result.periods[Math.min(2,Math.floor(v.at/600))][reason]++;
  }
  return result;
}
export function admissionPeriod(start:number){return `0${start/600}:00—0${start/600+1}:00`;}
export function admissionFeedback(summary:AdmissionSummary){
  const notes:string[]=[];
  for(const reason of ['capacity','entrance','layout'] as const){
    if(!summary[reason])continue;
    const peak=Math.max(...summary.periods.map(p=>p[reason]));
    const periods=summary.periods.filter(p=>p[reason]===peak).map(p=>admissionPeriod(p.start)).join('、');
    const next={capacity:'下一轮可只调整布局或收银升级，比较买齐人数和未入店人数。',
      entrance:'下一轮可在开门前调整摆放，观察入口与收银附近的通行。',
      layout:'下一轮可以在开门前完成布局调整。'}[reason];
    notes.push(`${summary[reason]} 位街坊因${admissionLabels[reason]}未能入店；${periods}${periods.includes('、')?'各':''}有 ${peak} 位。${next}`);
  }
  if(summary.unknown)notes.push(`${summary.unknown} 位未入店街坊来自旧存档，原因未记录。新到店的街坊会按实际情况记录。`);
  return notes;
}
