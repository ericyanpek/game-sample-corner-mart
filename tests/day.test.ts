import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessDay,DAY_TICKS,demandPlan} from '../src/day.ts';
import {FixedClock} from '../src/sim.ts';

function finish(d:BusinessDay){
  for(let i=0;i<8000&&d.phase!=='settled';i++){d.step();if(i%100===0)d.assertValid();}
  assert.equal(d.phase,'settled');d.assertValid();return d.report();
}
function prepare(d:BusinessDay,layout='aisle',cold=false){
  assert.ok(d.action('upgrade','staff'));if(!cold)assert.ok(d.action('upgrade','checkout'));
  if(cold){assert.ok(d.action('shelf','1'));assert.ok(d.action('shelf','2'));}
  if(layout==='supply')assert.ok(d.action('layout',layout));
  assert.ok(d.action('order','drinks'));if(!cold)assert.ok(d.action('order','bread'));
  d.step(900);assert.ok(d.canOpen);d.assertValid();assert.ok(d.open());
}
test('preparation spends actual cash without advancing demand or opening time',()=>{
  const d=new BusinessDay(),cash=d.shop.state.cash;
  assert.ok(d.action('order','bread'));assert.equal(d.canOpen,false);assert.equal(d.open(),false);
  d.step(900);d.assertValid();assert.equal(d.elapsed,0);assert.equal(d.shop.state.customers.length,0);
  assert.equal(d.report().procurement,cash-d.shop.state.cash);assert.ok(d.canOpen);
  assert.equal(d.action('upgrade','marketing'),false);assert.equal(d.action('unlock','fruit'),false);
});
test('closing finishes real customers and paid deliveries, then freezes the result',()=>{
  const d=new BusinessDay();prepare(d);d.step(DAY_TICKS);
  assert.equal(d.phase,'closing');assert.equal(d.elapsed,DAY_TICKS);
  const procurement=d.report().procurement;
  assert.equal(d.action('order','bread'),false);assert.equal(d.action('layout','supply'),false);
  const r=finish(d);assert.equal(r.procurement,procurement);
  assert.ok(r.closingSeconds>0);assert.ok(r.waitCount>0);
  assert.equal(r.demand,r.complete+r.partial+r.empty+r.impatient+r.blocked);
  assert.equal(r.cashChange,r.revenue-r.procurement-r.upgrades-r.unlocks);
  assert.equal(r.startInventory+r.procurement-r.cogs,r.endInventory);
  const snapshot=d.snapshot();d.step(1000);assert.deepEqual(d.snapshot(),snapshot);
});
test('automatic replenishment records paid order-to-shelf time during trading',()=>{
  const d=new BusinessDay();d.action('upgrade','staff');d.action('upgrade','checkout');d.action('layout','supply');
  d.step(900);d.open();const r=finish(d);
  assert.ok(r.deliveryCount>0);assert.ok(r.deliverySeconds!>0);assert.ok(r.procurement>0);assert.ok(r.complete>=20);
});
test('same-condition replay restores the original budget, facilities and every arrival',()=>{
  const d=new BusinessDay(),start=d.shop.snapshot(),plan=demandPlan(d.seed);
  prepare(d);const r=finish(d),next=d.replay();
  assert.deepEqual(next.shop.snapshot(),start);assert.deepEqual(next.visits,plan);assert.equal(next.attempt,2);
  assert.deepEqual(next.history,[r]);assert.equal(next.conditions,d.conditions);
  prepare(next);const r2=finish(next);assert.deepEqual({...r2,attempt:1},r);
});
test('waiting longer in preparation does not change the result for identical choices',()=>{
  const reports=[0,1,3,9,37].map(delay=>{
    const d=new BusinessDay();d.action('upgrade','staff');d.action('upgrade','checkout');
    d.action('layout','supply');d.step(300+delay);d.open();return finish(d);
  });
  for(const r of reports.slice(1))assert.deepEqual(r,reports[0]);
});
test('layout changes and shelf choices preserve demand and whole-day measurements',()=>{
  const a=new BusinessDay(),b=new BusinessDay();prepare(a);prepare(b,'supply',true);
  a.step(550);a.step(a.visits.find(v=>v.at>a.elapsed)!.at-a.elapsed-1);
  assert.ok(a.action('layout','supply'));a.step(200);a.assertValid();
  const r1=finish(a),r2=finish(b),tape=(d:BusinessDay)=>d.visits.map(({at,kind,products,style})=>({at,kind,products,style}));
  assert.deepEqual(tape(a),tape(b));assert.ok(r1.layoutBlocked>0);
  assert.ok(r1.waitCount>=a.shop.state.layoutMetrics.waitCount);
  assert.equal(r2.cogs,r2.byProduct.reduce((n,p)=>n+p.cogs,0));assert.ok(b.shop.state.shelves.drinks.premiumSold>0);
  assert.equal(r2.startInventory+r2.procurement-r2.cogs,r2.endInventory);
});
test('saving and reopening preserves preparation, active layout, trading, closing and settlement',()=>{
  let d=new BusinessDay();d.action('order','bread');d.step(25);
  d=BusinessDay.restore(d.snapshot());d.step(900);d.open();d.step(350);d.action('layout','supply');
  for(const count of [25,600,DAY_TICKS,5000]){
    const restored=BusinessDay.restore(d.snapshot());restored.step(count);d.step(count);
    d.assertValid();restored.assertValid();assert.deepEqual(restored.snapshot(),d.snapshot());
  }
  assert.equal(d.phase,'settled');assert.equal(BusinessDay.restore(d.snapshot()).phase,'settled');
});
test('missing goods produce partial/empty outcomes and evidence-based product feedback',()=>{
  const d=new BusinessDay();d.open();const r=finish(d);
  assert.ok(r.empty+r.partial>0);assert.ok(r.byProduct.some(p=>p.missing>0));
  assert.ok(r.feedback.some(s=>s.includes('缺货')));assert.equal(r.procurement,0);
});
test('invalid demand, broken accounting and altered settled reports are rejected',()=>{
  const d=new BusinessDay();d.open();finish(d);
  for(const mutate of [
    (s:any)=>s.visits[0].at++,
    (s:any)=>s.shop.cash++,
    (s:any)=>s.history.at(-1).grossProfit++,
    (s:any)=>s.elapsed=DAY_TICKS+1,
  ]){const s=d.snapshot();mutate(s);assert.throws(()=>BusinessDay.restore(s));}
});
test('fixed-step business day is independent of rendering frame rate',()=>{
  const snapshots=[30,60,144].map(fps=>{
    const d=new BusinessDay(),clock=new FixedClock();d.open();
    for(let frame=0;frame<fps*90;frame++)clock.feed(d,1/fps);
    d.assertValid();assert.equal(d.elapsed,900);return d.snapshot();
  });
  assert.deepEqual(snapshots[0],snapshots[1]);assert.deepEqual(snapshots[0],snapshots[2]);
});
test('both layouts close with conserved stock and cash across three demand streams',()=>{
  for(const seed of [20260915,42,910])for(const layout of ['aisle','supply']){
    const d=new BusinessDay(undefined,seed);prepare(d,layout);
    finish(d);
  }
});
