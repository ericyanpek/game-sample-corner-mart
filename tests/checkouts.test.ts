import test from 'node:test';
import assert from 'node:assert/strict';
import {Shop,CHECKOUT_SPEC,LAYOUT_SPEC} from '../src/sim.ts';
import {BusinessDay} from '../src/day.ts';
import {navigation,distance,freshMotion,SEPARATION,type Point} from '../src/navigation.ts';
import {characterLook,CHARACTER_SPEC} from '../src/appearance.ts';
import OLD from './fixtures/day-v1-open.json';
import CLOSED from './fixtures/day-v1-settled.json';
const quiet={arrivals:false,restock:false};
function setup(){
  const s=new BusinessDay().shop;s.upgrade('staff');s.state.nextArrival=1e9;return s;
}
function buyer(s:Shop,checkout:'main'|'flex',timer=1){
  const c=s.spawn({kind:'quick',products:['drinks'],style:0})!;
  c.checkout=checkout;c.state='pay';c.timer=timer;c.phaseStarted=s.state.tick;
  c.reservation=true;c.shopping[0].status='reserved';s.state.shelves.drinks.reserved++;
  c.pos=[...CHECKOUT_SPEC.stations[checkout].customer] as Point;c.nav=freshMotion(c.pos);
  s.state.queue.push(c.id);if(checkout==='main')s.state.service=c.id;else s.state.helperService=c.id;
  return c;
}
test('window-wall counters leave reachable customer stations, employee exits and entrance',()=>{
  const {main,flex}=CHECKOUT_SPEC.stations;
  assert.equal(main.position[0],flex.position[0]);assert.equal(main.yaw,Math.PI/2);
  for(const id of ['aisle','supply'] as const){
    const nav=navigation(id,true);
    assert.ok(distance(flex.cashier as Point,[2.35,3])>4);
    for(const target of [main.customer,flex.customer,...Object.values(nav.access)]){
      assert.ok(nav.route([2.35,3],target as Point).length,`${id} entrance → ${target}`);
      assert.ok(nav.route(flex.cashier as Point,target as Point).length,`${id} employee → ${target}`);
    }
    for(const p of nav.waitPoints)assert.ok(distance(p,flex.cashier as Point)>SEPARATION);
  }
});
test('two cashiers can book two separate baskets in the same tick exactly once',()=>{
  const s=setup();buyer(s,'main');buyer(s,'flex');s.assertValid();const cash=s.state.cash,sold=s.state.stats.sold;
  s.step(1,quiet);s.assertValid();assert.equal(s.state.cash,cash+10);assert.equal(s.state.stats.sold,sold+2);
  assert.equal(s.state.service,null);assert.equal(s.state.helperService,null);
  s.step(600,quiet);s.assertValid();assert.equal(s.state.stats.sold,sold+2);assert.equal(s.state.shelves.drinks.reserved,0);
});
test('a restock closes intake, reroutes waiting shoppers, and lets the current payment finish',()=>{
  const s=setup(),paid=buyer(s,'flex',4),waiter=s.spawn({kind:'quick',products:['drinks'],style:1})!;
  waiter.checkout='flex';waiter.state='toQueue';waiter.queuedAt=s.state.tick;
  waiter.reservation=true;waiter.shopping[0].status='reserved';s.state.shelves.drinks.reserved++;s.state.queue.push(waiter.id);
  const waitedAt=waiter.queuedAt,held=structuredClone(waiter.shopping);
  assert.ok(s.order('drinks'));const cash=s.state.cash,ledger=structuredClone(s.state.ledger);
  assert.equal(s.checkoutStatus('flex').state,'finishing');
  s.step(3,quiet);s.assertValid();
  assert.equal(s.state.delivery,null);assert.equal(s.state.helperService,paid.id);
  assert.equal(waiter.checkout,'main');assert.equal(waiter.queuedAt,waitedAt);assert.deepEqual(waiter.shopping,held);
  assert.equal(s.state.cash,cash);assert.deepEqual(s.state.ledger,ledger);
  s.step(1,quiet);assert.equal(s.state.cash,cash+5);assert.equal(s.state.helperService,null);
  s.step(1,quiet);assert.equal(s.snapshot().delivery?.phase,'loading');assert.equal(s.checkoutStatus('flex').state,'paused');
  assert.deepEqual(s.snapshot().delivery?.pos,CHECKOUT_SPEC.stations.flex.cashier);
  for(let i=0;i<1500&&s.state.delivery;i++)s.step(1,quiet);
  assert.equal(s.state.delivery,null);assert.equal(s.checkoutStatus('flex').state,'open');s.assertValid();
});
test('pausing for restock never resets customer patience or frees held goods',()=>{
  const s=setup(),c=buyer(s,'main',75),w=s.spawn({kind:'quick',products:['drinks'],style:0})!;
  w.checkout='flex';w.state='toQueue';w.reservation=true;w.shopping[0].status='reserved';w.patience=2;s.state.queue.push(w.id);s.state.shelves.drinks.reserved++;
  s.order('bread');s.step(3,quiet);assert.equal(w.checkout,'main');assert.equal(w.state,'return');
  assert.equal(w.shopping[0].status,'reserved');assert.ok(s.state.shelves.drinks.reserved>=1);s.assertValid();
});
test('save and restore through finishing, loading, stocking and return keeps exact future',()=>{
  const s=setup();buyer(s,'flex',5);s.order('drinks');const phases=new Set<string>(),copies:Shop[]=[];
  for(let i=0;i<1600;i++){
    s.step(1,quiet);s.assertValid();for(const copy of copies){copy.step(1,quiet);assert.deepEqual(copy.snapshot(),s.snapshot());}
    const phase=s.checkoutStatus('flex').state+':'+(s.state.delivery?.phase??'desk');
    if(!phases.has(phase)){phases.add(phase);copies.push(Shop.restore(s.snapshot()));}
  }
  assert.ok(phases.has('finishing:desk'));assert.ok(phases.has('paused:loading'));assert.ok(phases.has('paused:stocking'));assert.ok(phases.has('paused:returning'));assert.ok(phases.has('open:desk'));
});
test('old stores retain every transaction and held item while adopting the wall layout',()=>{
  const s=Shop.restore(OLD.shop);
  assert.equal(s.state.version,6);assert.deepEqual(s.state.ledger,OLD.shop.ledger);assert.deepEqual(s.state.shelves,OLD.shop.shelves);assert.equal(s.state.cash,OLD.shop.cash);
  assert.deepEqual(s.state.customers.map(c=>[c.id,c.state,c.timer,c.shopping]),OLD.shop.customers.map(c=>[c.id,c.state,c.timer,c.shopping]));
  s.step(3000,quiet);s.assertValid();assert.equal(s.state.customers.length,0);
});
test('old completed reports remain intact and different checkout layouts are not compared',()=>{
  const old=BusinessDay.restore(CLOSED);assert.deepEqual(old.history,CLOSED.history);
  const {feedback,admission,...facts}=old.report(),{feedback:oldFeedback,...oldFacts}=CLOSED.history.at(-1)!;
  assert.deepEqual(facts,oldFacts);assert.equal(admission!.unknown,oldFacts.blocked);
  const next=old.replay();assert.equal(next.previousComparable(),undefined);assert.notEqual(next.conditions,old.conditions);
  next.open();next.step(9000);next.assertValid();
  const again=next.replay();assert.deepEqual(again.previousComparable(),next.report());
  const active=BusinessDay.restore(OLD);assert.equal(active.routingChangedAt,OLD.elapsed);
  active.step(9000);active.assertValid();assert.equal(active.replay().previousComparable(),undefined);
});
test('a cashier cannot collect a payment and carry a box at the same time',()=>{
  const s=setup();s.order('bread');s.step(1,quiet);buyer(s,'flex');
  assert.throws(()=>s.assertValid(),/Service mismatch/);
});
test('customer appearance is stable, varied and independent of shopping demand draws',()=>{
  const s=setup(),before=s.snapshot();
  const looks=Array.from({length:8},(_,i)=>characterLook('customer',i+1));
  assert.equal(new Set(looks.map(x=>x.id)).size,8);assert.ok(new Set(looks.map(x=>x.skin)).size>=6);
  assert.equal(new Set(looks.map(x=>x.hair)).size,6);assert.equal(new Set(looks.map(x=>x.outfit)).size,4);
  assert.deepEqual(characterLook('customer',3),characterLook('customer',3));
  assert.equal(characterLook('worker',0).outfit,'uniform');assert.equal(characterLook('cashier',0).outfit,'uniform');
  assert.notEqual(CHARACTER_SPEC.staff.worker.cap,CHARACTER_SPEC.staff.cashier.cap);assert.deepEqual(s.snapshot(),before);
});
