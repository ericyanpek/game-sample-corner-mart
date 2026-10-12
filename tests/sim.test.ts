import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Shop,FixedClock,PRODUCT_IDS} from '../src/sim.ts';

function manage(s:Shop) {
  for(const p of PRODUCT_IDS)if(s.state.shelves[p].unlocked&&s.available(p)<=6)s.order(p);
  if(s.state.stats.sold>=5&&!s.state.upgrades.staff&&s.state.cash>=94)s.upgrade('staff');
  if(s.state.upgrades.staff&&!s.state.upgrades.checkout&&s.state.cash>=84)s.upgrade('checkout');
  if(s.state.upgrades.checkout&&!s.state.shelves.bread.unlocked&&s.state.cash>=140){s.unlock('bread');s.order('bread');}
}
test('A customer buys real stock; no timer-only revenue',()=>{
  const s=new Shop();s.state.nextArrival=100000;s.step(1000);assert.equal(s.state.cash,120);
  s.spawn();s.step(700);s.assertValid();
  assert.equal(s.state.stats.sold,1);assert.equal(s.state.cash,125);assert.equal(s.state.shelves.drinks.onHand,11);
});
test('Orders debit once, occupy capacity and complete exactly once',()=>{
  const s=new Shop();s.state.nextArrival=100000;
  assert.equal(s.order('drinks'),true);assert.equal(s.order('drinks'),false);assert.equal(s.state.cash,96);
  while(s.state.delivery?.phase!=='stocking'||s.state.delivery.timer>1)s.step();
  assert.equal(s.state.shelves.drinks.onHand,12);
  const saved=Shop.restore(s.snapshot());saved.step(1);saved.assertValid();
  assert.equal(saved.state.shelves.drinks.onHand,24);assert.equal(saved.order('drinks'),false);
  saved.step(200);assert.equal(saved.state.shelves.drinks.received,12);assert.equal(saved.state.cash,96);
});
test('Pickup reserves an item; only the final payment tick books one sale',()=>{
  const s=new Shop();s.state.nextArrival=100000;s.spawn();
  const customer=()=>s.state.customers[0];
  while(customer().state!=='pickup')s.step();
  assert.equal(s.state.shelves.drinks.reserved,1);assert.equal(s.onShelf('drinks'),12);
  s.step(6);assert.equal(s.onShelf('drinks'),11);assert.equal(s.state.cash,120);
  while(customer().state!=='pay'||customer().timer>1)s.step();
  assert.equal(s.state.cash,120);assert.equal(s.state.stats.sold,0);
  const copy=Shop.restore(s.snapshot());copy.step();assert.equal(copy.state.cash,125);assert.equal(copy.state.receipts.length,1);
  copy.step(700);copy.assertValid();assert.equal(copy.state.cash,125);assert.equal(copy.state.receipts.length,1);
});
test('Every delivery phase survives reload; goods become available only after stocking',()=>{
  const s=new Shop();s.state.nextArrival=100000;s.order('drinks');
  const phases=new Set<string>();
  const resumed:Shop[]=[];
  for(let i=0;i<220;i++){
    s.step();s.assertValid();const d=s.state.delivery;
    for(const copy of resumed){copy.step();assert.deepEqual(copy.snapshot(),s.snapshot());}
    if(d&&!phases.has(d.phase)){
      phases.add(d.phase);resumed.push(Shop.restore(s.snapshot()));
      if(d.phase!=='returning')assert.equal(s.state.shelves.drinks.received,0);
      else assert.equal(s.state.shelves.drinks.received,12);
    }
  }
  assert.equal(phases.size,4);assert.equal(s.state.cash,96);
});
test('Legacy v1 save keeps cash and finishes its already-paid shipment and payment once',()=>{
  const legacy=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-v1.json',import.meta.url),'utf8'));
  const s=Shop.restore(legacy);assert.equal(s.state.version,6);assert.equal(s.state.cash,legacy.cash);
  assert.deepEqual(s.state.ledger,legacy.ledger);
  const buyer=s.state.customers.find(c=>c.id===s.state.service)!;
  assert.equal(buyer.state,'pay');assert.equal(buyer.timer,8);
  s.step(7);assert.equal(s.state.stats.sold,legacy.stats.sold);
  s.step();assert.equal(s.state.stats.sold,legacy.stats.sold+1);
  const received=legacy.shelves.drinks.received,qty=legacy.orders[0].quantity;
  s.step(200);s.assertValid();assert.equal(s.state.shelves.drinks.received,received+qty);
});
test('Impatient shoppers return their reserved item before it becomes available again',()=>{
  const s=new Shop(1);s.state.nextArrival=100000;
  let found=false;
  for(let i=0;i<3000;i++){
    if(i<600&&i%15===0){const c=s.spawn();if(c)c.patience=20;}if(s.available('drinks')<=6)s.order('drinks');
    s.step();s.assertValid();
    const c=s.state.customers.find(c=>c.state==='putback'&&c.timer===1);
    if(!c)continue;
    found=true;assert.equal(c.reservation,true);assert.equal(s.hasItem(c),true);
    const copy=Shop.restore(s.snapshot());copy.step();copy.assertValid();
    const returned=copy.state.customers.find(x=>x.id===c.id)!;
    assert.equal(returned.reservation,false);assert.equal(copy.hasItem(returned),false);assert.equal(returned.state,'leave');break;
  }
  assert.equal(found,true);
});
test('Waiting bays are distinct and each shelf has at most one picker',()=>{
  const s=new Shop();s.state.nextArrival=100000;for(let i=0;i<20;i++)s.spawn();
  assert.equal(new Set(s.nav.waitPoints.map(p=>JSON.stringify(p))).size,s.nav.waitPoints.length);
  for(let i=0;i<1000;i++){
    s.step();
    assert.ok(s.state.customers.filter(c=>['browse','pickup'].includes(c.state)).length<=1);
  }
});
test('Multiple deterministic seeds conserve money, stock and reservations',()=>{
  for(const seed of [1,13,20260914,0xffffffff]){
    const s=new Shop(seed);
    for(let i=0;i<9000;i++){if(i%10===0)manage(s);s.step();s.assertValid();}
    assert.ok(s.state.stats.sold>=30);assert.ok(s.state.stats.goalAt!==null);
  }
});
test('Save and restore during queue/service/incoming order preserves the entire future',()=>{
  const s=new Shop(13);s.order('drinks');s.step(30);
  let copy=Shop.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<5000;i++){if(i%10===0){manage(s);manage(copy);}s.step();copy.step();}
  assert.deepEqual(copy.snapshot(),s.snapshot());
  copy=Shop.restore(s.snapshot());copy.step(300);s.step(300);assert.deepEqual(copy.snapshot(),s.snapshot());
});
test('30, 60 and 144 Hz render loops produce identical simulation states',()=>{
  const states=[];
  for(const hz of [30,60,144]){const s=new Shop(44),clock=new FixedClock();for(let i=0;i<hz*180;i++)clock.feed(s,1/hz);s.assertValid();states.push(s.snapshot());}
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[1],states[2]);
});
test('Timed-out customers release stock and queue positions',()=>{
  const s=new Shop();s.state.nextArrival=100000;
  for(let i=0;i<3000;i++){if(i<600&&i%15===0){const c=s.spawn();if(c)c.patience=20;}if(s.available('drinks')<=6)s.order('drinks');s.step();s.assertValid();}
  assert.ok(s.state.stats.impatient>0);assert.equal(s.state.queue.length,0);assert.equal(s.state.shelves.drinks.reserved,0);
  assert.equal(s.state.customers.length,0);
});
test('Upgrades are gated and cannot charge twice; invalid saves are rejected',()=>{
  const s=new Shop();assert.equal(s.upgrade('checkout'),false);
  for(let i=0;i<2500&&s.state.stats.sold<5;i++){if(i%10===0)manage(s);s.step();}
  const before=s.state.cash;assert.equal(s.upgrade('checkout'),true);assert.equal(s.upgrade('checkout'),false);
  assert.equal(s.state.cash,before-60);s.assertValid();
  const bad=s.snapshot();bad.cash++;assert.throws(()=>Shop.restore(bad));
});
