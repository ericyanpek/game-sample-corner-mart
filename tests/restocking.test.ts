import test from 'node:test';
import assert from 'node:assert/strict';
import {Shop,PRODUCT_IDS,type RestockPolicy} from '../src/sim.ts';
import {BusinessDay,DAY_TICKS} from '../src/day.ts';
import LEGACY from './fixtures/day-v1-open.json';
import SETTLED from './fixtures/day-v1-settled.json';

function shopWithStock(drinks=0,bread=0,fruit=0){
  const shop=new Shop();
  for(const [i,p] of PRODUCT_IDS.entries()){
    shop.state.shelves[p].unlocked=true;shop.state.shelves[p].onHand=[drinks,bread,fruit][i];
    shop.state.shelves[p].initial=shop.state.shelves[p].onHand;
  }
  shop.assertValid();return shop;
}
const quiet={arrivals:false,restock:false};
test('priority reorders paid waiting shipments without altering their amounts or cash',()=>{
  const s=shopWithStock(5,0,3);s.order('drinks');s.order('fruit');s.order('bread');
  const paid=s.snapshot(),orders=structuredClone(paid.orders);
  s.setRestockPolicy('bread');
  assert.deepEqual(s.pendingOrders().map(o=>o.product),['bread','fruit','drinks']);
  assert.equal(s.state.cash,paid.cash);assert.deepEqual(s.state.orders,orders);
  s.step(1,quiet);assert.equal(s.state.delivery?.product,'bread');
  s.step(1200,quiet);s.assertValid();assert.equal(s.state.orders.length,0);
  for(const p of PRODUCT_IDS)assert.equal(s.state.shelves[p].received,12);
  assert.equal(s.state.ledger.procurement,paid.ledger.procurement);
});
test('switching policy never interrupts loading, walking or stocking a paid box',()=>{
  for(const phase of ['loading','walking','stocking']){
    const s=shopWithStock();s.order('drinks');s.step(1,quiet);
    for(let n=0;s.state.delivery?.phase!==phase&&n<500;n++)s.step(1,quiet);
    assert.equal(s.state.delivery?.phase,phase);
    s.order('fruit');s.order('bread');const before=structuredClone(s.state.delivery),cash=s.state.cash;
    s.setRestockPolicy('bread');
    assert.deepEqual(s.state.delivery,before);assert.equal(s.state.orders[0].product,'drinks');
    assert.equal(s.state.cash,cash);assert.equal(s.pendingOrders()[0].product,'bread');
    let restored=Shop.restore(s.snapshot());
    for(let n=0;s.state.delivery?.product!=='bread'&&n<900;n++){s.step(1,quiet);restored.step(1,quiet);}
    assert.equal(s.state.delivery?.product,'bread');assert.deepEqual(s.snapshot(),restored.snapshot());
    s.step(1000,quiet);s.assertValid();
  }
});
test('shortage priority uses sellable inventory and never silently buys another shipment',()=>{
  const s=shopWithStock(5,1,3);s.setRestockPolicy('shortage');s.order('drinks');s.order('fruit');s.order('bread');
  assert.deepEqual(s.pendingOrders().map(o=>o.product),['bread','fruit','drinks']);
  const cash=s.state.cash;s.step(1400,quiet);s.assertValid();assert.equal(s.state.cash,cash);
  assert.equal(s.state.orders.length,0);assert.equal(s.state.delivery,null);
});
test('a reserved last item counts as unavailable even before the pickup animation ends',()=>{
  const s=shopWithStock(1,2,3);s.setRestockPolicy('shortage');
  const c=s.spawn({kind:'quick',products:['drinks'],style:0})!;
  for(let i=0;c.state!=='pickup'&&i<400;i++)s.step(1,quiet);
  assert.equal(c.state,'pickup');assert.equal(s.state.shelves.drinks.onHand,1);
  assert.equal(s.available('drinks'),0);s.order('bread');s.order('drinks');
  assert.equal(s.pendingOrders()[0].product,'drinks');s.assertValid();
});
test('limited auto-purchase budget follows the chosen product priority without overdraft',()=>{
  for(const policy of ['drinks','bread'] as RestockPolicy[]){
    const s=shopWithStock();s.state.cash=10;s.state.ledger.upgrades=110;s.state.upgrades.staff=true;
    s.setRestockPolicy(policy);s.step(1,{arrivals:false});s.assertValid();
    assert.equal(s.state.orders.length,1);assert.equal(s.state.orders[0].product,policy);
    assert.equal(s.state.orders[0].quantity,policy==='bread'?3:5);assert.ok(s.state.cash>=0);
    assert.equal(s.state.cash+s.state.ledger.procurement,10);
  }
});
test('legacy saves retain FIFO and paid transactions; new routing is identified separately',()=>{
  const d=BusinessDay.restore(LEGACY);assert.equal(d.restocking,undefined);assert.deepEqual(d.shop.state.orders,LEGACY.shop.orders);
  assert.deepEqual(d.shop.state.ledger,LEGACY.shop.ledger);assert.deepEqual(d.shop.state.shelves,LEGACY.shop.shelves);
  d.step(9000);d.assertValid();assert.equal(d.phase,'settled');assert.notEqual(d.report().conditions,SETTLED.history.at(-1)!.conditions);
  const s=shopWithStock(0,0,0);s.order('fruit');s.order('bread');s.step(1,quiet);
  assert.equal(s.state.delivery?.product,'fruit');
});
test('outage timing excludes preparation and closing and survives mid-shipment restoration',()=>{
  const d=new BusinessDay();
  for(const s of [d.shop.state,d.baseline]){
    s.shelves.bread.initial=0;s.shelves.bread.onHand=0;s.shelves.bread.received=0;
  }
  d.step(60);assert.equal(d.restocking!.observedTicks,0);
  d.open();d.step(10);assert.equal(d.restocking!.stockoutTicks.bread,10);assert.equal(d.restocking!.stockoutTicks.drinks,0);
  d.action('order','bread');d.step(20);d.action('restock','bread');
  const reloaded=BusinessDay.restore(d.snapshot());
  d.step(DAY_TICKS);reloaded.step(DAY_TICKS);assert.deepEqual(reloaded.snapshot(),d.snapshot());
  assert.equal(d.restocking!.observedTicks,DAY_TICKS);const counters=structuredClone(d.restocking);
  d.step(9000);d.assertValid();assert.equal(d.phase,'settled');assert.deepEqual(d.restocking,counters);
  assert.equal(BusinessDay.restore(d.snapshot()).phase,'settled');
});
test('joining a legacy day marks partial coverage and never invents earlier outage time',()=>{
  const d=BusinessDay.restore(LEGACY),since=d.elapsed;
  d.action('restock','bread');assert.equal(d.restocking!.since,since);
  d.step(9000);d.assertValid();assert.equal(d.restocking!.observedTicks,DAY_TICKS-since);
  const replay=d.replay();assert.equal(replay.restocking!.since,0);assert.equal(replay.restocking!.observedTicks,0);
});
test('same priority and choices replay exactly; all themes/layouts conserve stock and money',()=>{
  for(const theme of ['breakfast','hot','rush'] as const)for(const layout of ['aisle','supply'])for(const policy of ['shortage','drinks','bread'] as const){
    const prepare=(d:BusinessDay)=>{
      d.action('restock',policy);d.action('upgrade','staff');d.action('upgrade','checkout');d.action('layout',layout);
      d.step(300);d.open();d.step(9000);d.assertValid();assert.equal(d.phase,'settled');
    };
    const d=new BusinessDay(undefined,20260915,theme);prepare(d);const next=d.replay();prepare(next);
    assert.deepEqual({...next.report(),attempt:1},d.report());
    assert.equal(d.report().startInventory+d.report().procurement-d.report().cogs,d.report().endInventory);
    assert.equal(d.restocking!.observedTicks,DAY_TICKS);
  }
});
test('invalid policies and fabricated outage counters are rejected; closed days lock changes',()=>{
  const d=new BusinessDay();assert.equal(d.action('restock','magic'),false);
  let snap=d.snapshot();snap.shop.restockPolicy='magic' as RestockPolicy;assert.throws(()=>BusinessDay.restore(snap));
  snap=d.snapshot();snap.restocking!.stockoutTicks.bread=1;assert.throws(()=>BusinessDay.restore(snap));
  d.open();d.step(1800);assert.equal(d.action('restock','bread'),false);d.step(9000);
  assert.equal(d.action('restock','drinks'),false);d.assertValid();
});
test('competing restocks produce measurable differences under identical late-hire conditions',()=>{
  const days=(['drinks','bread'] as const).map(policy=>{
    const d=new BusinessDay(undefined,20260915,'rush');
    d.action('restock',policy);d.action('upgrade','checkout');d.action('layout','supply');
    d.step(300);d.open();d.step(1200);d.action('upgrade','staff');d.step(9000);d.assertValid();return d;
  });
  assert.deepEqual(days[0].baseline,days[1].baseline);
  assert.deepEqual(days[0].visits.map(v=>[v.at,v.kind,v.products]),days[1].visits.map(v=>[v.at,v.kind,v.products]));
  for(const d of days){const r=d.report();assert.equal(r.cashChange,r.revenue-r.procurement-r.upgrades-r.unlocks);}
  assert.notDeepEqual(days[0].restocking!.stockoutTicks,days[1].restocking!.stockoutTicks);
});
