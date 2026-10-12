import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessDay} from '../src/day.ts';
import {Shop,LAYOUT_SPEC} from '../src/sim.ts';
import {summarizeAdmissions,type AdmissionFailure} from '../src/admission.ts';
import {resetVisitorSaves,PREVIOUS_VISITOR_KEY} from '../src/visitor-reset.ts';
import {guidedStorageKey} from '../src/guided-tour-state.ts';

test('admission records distinguish actual capacity, entry and layout limits',()=>{
  const shop=new Shop();
  const customer=shop.spawn()!;
  shop.state.customers=Array.from({length:LAYOUT_SPEC.maxCustomers},(_,i)=>({...structuredClone(customer),id:i+1}));
  let record:AdmissionFailure|undefined;
  assert.equal(shop.spawn(undefined,r=>{record=r;}),null);
  assert.equal(record!.reason,'capacity');assert.equal(record!.occupied,5);
  assert.equal(record!.stages.shopping,5);
  shop.state.customers=[];
  const free=shop.nav.free;shop.nav.free=()=>false;
  assert.equal(shop.spawn(undefined,r=>{record=r;}),null);
  assert.equal(record!.reason,'entrance');assert.equal(record!.occupied,0);
  shop.nav.free=free;
  assert.ok(shop.changeLayout('supply'));
  assert.equal(shop.spawn(undefined,r=>{record=r;}),null);
  assert.equal(record!.reason,'layout');
});
test('admission reasons and periods persist through an entire saved day',()=>{
  let day=new BusinessDay();day.open();day.step(800);
  day=BusinessDay.restore(day.snapshot());
  for(let i=0;i<8000&&day.phase!=='settled';i++)day.step();
  day.assertValid();
  const r=day.report(),a=r.admission!;
  assert.ok(r.blocked>0);assert.equal(a.capacity+a.entrance+a.layout+a.unknown,r.blocked);
  assert.equal(a.unknown,0);
  for(const reason of ['capacity','entrance','layout'] as const)
    assert.equal(a[reason],a.periods.reduce((n,p)=>n+p[reason],0));
  assert.deepEqual(BusinessDay.restore(day.snapshot()).report(),r);
  const bad=day.snapshot();bad.visits.find(v=>v.rejection)!.rejection!.occupied++;
  assert.throws(()=>BusinessDay.restore(bad),/admission/);
});
test('legacy rejection records stay unknown, while recorded layout moves remain known',()=>{
  const a=summarizeAdmissions([
    {at:20,outcome:'blocked',blockedByLayout:false},
    {at:600,outcome:'blocked',blockedByLayout:true},
    {at:1200,outcome:'complete',blockedByLayout:false},
  ]);
  assert.equal(a.unknown,1);assert.equal(a.layout,1);assert.equal(a.capacity,0);
  assert.equal(a.periods[0].unknown,1);assert.equal(a.periods[1].layout,1);
  const day=new BusinessDay();day.open();day.step(8000);
  const old=day.snapshot();
  old.visits.forEach(v=>delete v.rejection);delete old.history[0].admission;
  old.history[0].feedback=['Legacy wording'];
  const loaded=BusinessDay.restore(old);
  assert.equal(loaded.report().admission!.unknown,loaded.report().blocked);
  assert.deepEqual(loaded.history,old.history);
});
function storage(){
  const data=new Map<string,string>(['breakfast','hot','rush'].map(t=>[guidedStorageKey(t),t+'-save']));
  data.set('corner-mart-v1','free-play');data.set('corner-mart-business-day-v1','normal-day');
  return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
}
test('confirmed restart clears exactly three guided slots and preserves a backup',()=>{
  const s=storage(),key=guidedStorageKey('hot');
  resetVisitorSaves(s,'fresh-breakfast',{key,value:'latest-hot'});
  assert.equal(s.getItem(guidedStorageKey('breakfast')),'fresh-breakfast');
  assert.equal(s.getItem(key),null);assert.equal(s.getItem(guidedStorageKey('rush')),null);
  assert.equal(s.getItem('corner-mart-v1'),'free-play');assert.equal(s.getItem('corner-mart-business-day-v1'),'normal-day');
  assert.equal(JSON.parse(s.getItem(PREVIOUS_VISITOR_KEY)!)[key],'latest-hot');
});
test('storage failures abort reset and keep original slots recoverable',()=>{
  for(const failure of ['backup','write','remove']){
    const s=storage(),before=new Map(s.data),set=s.setItem,remove=s.removeItem;
    let thrown=false;
    s.setItem=(k,v)=>{
      if(!thrown&&(failure==='backup'&&k===PREVIOUS_VISITOR_KEY||failure==='write'&&k===guidedStorageKey('breakfast'))){thrown=true;throw Error('Quota');}
      set(k,v);
    };
    s.removeItem=k=>{if(failure==='remove'&&!thrown){thrown=true;throw Error('Storage unavailable');}remove(k);};
    assert.throws(()=>resetVisitorSaves(s,'new',{key:guidedStorageKey('breakfast'),value:'active'}));
    for(const [key,value] of before)assert.equal(s.getItem(key),value);
  }
});
