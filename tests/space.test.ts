import test from 'node:test';
import assert from 'node:assert/strict';
import {Shop,CHECKOUT_SPEC,LAYOUT_SPEC} from '../src/sim.ts';
import {BusinessDay} from '../src/day.ts';
import {navigation,distance,SEPARATION,type Point} from '../src/navigation.ts';

test('expanded counter gap passes a person while both customer positions are occupied',()=>{
  const {main,flex}=CHECKOUT_SPEC.stations;
  const gap=flex.position[1]-main.position[1]-CHECKOUT_SPEC.footprint[0];
  assert.ok(gap>=1,'counter gap must leave a full metre');
  assert.equal(LAYOUT_SPEC.maxCustomers,5);
  for(const id of ['aisle','supply'] as const){
    const nav=navigation(id,true),occupied=[main.customer,flex.customer] as Point[];
    for(const goal of Object.values(nav.access)){
      const path=nav.route(flex.cashier as Point,goal,occupied);
      assert.ok(path.length,`${id}: stocker trapped behind staffed counters`);
      let last=flex.cashier as Point;
      for(const p of path){assert.ok(nav.clear(last,p,occupied));last=p;}
    }
    for(const point of nav.waitPoints)for(const service of [...occupied,...Object.values(nav.access),flex.cashier as Point]){
      assert.ok(distance(point,service)>=SEPARATION,'waiting bay overlaps a service station');
    }
  }
});

test('room migration relocates a v6 cashier transaction without losing cash, goods or time',()=>{
  const shop=new BusinessDay().shop;shop.upgrade('staff');
  const c=shop.spawn({kind:'quick',products:['drinks'],style:0})!;
  c.state='service';c.checkout='flex';c.timer=32;c.reservation=true;c.shopping[0].status='reserved';
  shop.state.shelves.drinks.reserved++;shop.state.queue.push(c.id);shop.state.helperService=c.id;
  c.pos=[-1.2,2.1];
  const old=shop.snapshot();delete old.roomRevision;
  const migrated=Shop.restore(old);
  assert.equal(migrated.state.roomRevision,2);
  assert.deepEqual(migrated.state.customers[0].pos,CHECKOUT_SPEC.stations.flex.customer);
  assert.deepEqual(migrated.state.ledger,old.ledger);assert.equal(migrated.state.cash,old.cash);
  assert.deepEqual(migrated.state.shelves,old.shelves);
  assert.equal(migrated.state.customers[0].timer,32);
  assert.deepEqual(migrated.state.customers[0].shopping,old.customers[0].shopping);
  assert.deepEqual(Shop.restore(migrated.snapshot()).snapshot(),migrated.snapshot());
  migrated.step(3000,{arrivals:false,restock:false});
  assert.equal(migrated.state.customers.length,0);assert.equal(migrated.state.cash,old.cash+5);
});

test('expanded room preserves old settled reports but compares only its own repeat runs',()=>{
  const day=new BusinessDay();day.open();day.step(9000);day.assertValid();
  const old=day.snapshot();old.routingVersion=2;
  old.history=old.history.map(r=>({...r,conditions:r.conditions.replace('-room2','')}));
  delete old.shop.roomRevision;
  const migrated=BusinessDay.restore(old);
  assert.deepEqual(migrated.report(),old.history.at(-1));
  assert.equal(migrated.replay().previousComparable(),undefined);
  const next=migrated.replay();next.open();next.step(9000);next.assertValid();
  assert.deepEqual(next.replay().previousComparable(),next.report());
});
