import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Shop,SHELF_TIERS} from '../src/sim.ts';
const legacy=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-v2.json',import.meta.url),'utf8'));
function earn(s:Shop,coins:number){
  for(let i=0;i<30000;i++){
    if(s.available('drinks')<=6)s.order('drinks');
    if(s.state.cash>=coins&&s.state.stats.sold>=15)return;
    s.step();s.assertValid();
  }
  throw Error('Could not earn upgrade budget');
}
test('v2 migration preserves every active customer, paid order, balance and shelf count',()=>{
  const s=Shop.restore(legacy);assert.equal(s.state.version,6);assert.equal(s.state.drinksTier,0);
  assert.equal(s.state.cash,legacy.cash);assert.deepEqual(s.state.ledger,legacy.ledger);
  assert.deepEqual(s.state.queue,legacy.queue);
  for(const c of legacy.customers){const now=s.state.customers.find(x=>x.id===c.id)!;for(const k of ['id','product','state','timer','queuedAt','reservation','happy','style','phaseStarted','serviceDuration'] as const)assert.equal(now[k],c[k]);assert.equal(now.premium,false);}
  for(const o of legacy.orders)assert.ok(s.state.orders.some(x=>x.product===o.product&&x.quantity===o.quantity&&x.remaining===o.remaining&&!x.premium));
  for(const p of ['drinks','bread','fruit'] as const)assert.equal(s.state.shelves[p].onHand,legacy.shelves[p].onHand);
  s.step(400);s.assertValid();
});
test('Shelf upgrades charge once, are sequential, and retain live shopping and supply state',()=>{
  const s=new Shop();assert.equal(s.upgradeShelf(1),false);earn(s,350);
  const before=s.snapshot();
  assert.equal(s.upgradeShelf(2),false);assert.equal(s.upgradeShelf(1),true);assert.equal(s.upgradeShelf(1),false);
  assert.equal(s.state.cash,before.cash-80);assert.equal(s.capacity('drinks'),36);
  assert.deepEqual(s.state.customers,before.customers);assert.deepEqual(s.state.orders,before.orders);
  assert.deepEqual(s.state.shelves,before.shelves);assert.deepEqual(s.state.queue,before.queue);
  assert.equal(s.upgradeShelf(2),true);assert.equal(s.upgradeShelf(2),false);assert.equal(s.upgradeShelf(3),false);
  assert.equal(s.state.cash,before.cash-240);assert.equal(s.capacity('drinks'),48);
  assert.deepEqual(s.state.customers,before.customers);assert.deepEqual(s.state.orders,before.orders);s.assertValid();
});
test('Already-paid regular deliveries keep their SKU across the cold upgrade',()=>{
  const s=new Shop();earn(s,400);s.state.nextArrival=100000;
  while(s.state.orders.length)s.step();
  const before=s.state.shelves.drinks.premiumReceived;
  assert.equal(s.order('drinks'),true);
  const paid=s.snapshot().orders[0];assert.equal(paid.unitCost,2);
  s.upgradeShelf(1);s.upgradeShelf(2);
  const cash=s.state.cash;
  while(s.state.orders.length)s.step();
  assert.equal(s.state.shelves.drinks.premiumReceived,before);
  assert.ok(s.state.cash>=cash);s.assertValid();
  const q=s.orderQuote('drinks');
  if(q.quantity){s.order('drinks');assert.equal(s.state.orders[0].unitCost,4);assert.equal(s.state.orders[0].premium,true);}
});
test('Cold goods are separately stocked, picked, sold for nine coins, and conserved after restore',()=>{
  const s=new Shop();earn(s,400);s.upgradeShelf(1);s.upgradeShelf(2);
  let hadPremium=false;
  for(let i=0;i<5000;i++){
    if(s.available('drinks')<=10)s.order('drinks');s.step();s.assertValid();
    if(s.state.shelves.drinks.premium>0)hadPremium=true;
    if(s.state.shelves.drinks.premiumSold>=3)break;
  }
  assert.ok(hadPremium);assert.ok(s.state.shelves.drinks.premiumSold>=3);
  assert.ok(s.state.receipts.some(r=>r.premium&&r.amount===9));
  const x=s.state.shelves.drinks;
  assert.equal(s.state.ledger.revenue,(x.sold-x.premiumSold)*5+x.premiumSold*9);
  const copy=Shop.restore(s.snapshot());
  for(let i=0;i<300;i++){s.step();copy.step();assert.deepEqual(copy.snapshot(),s.snapshot());}
});
test('Capacity increases without granting free stock; all three tiers can be filled exactly',()=>{
  for(const tier of [0,1,2]){
    const s=new Shop();earn(s,550);s.state.nextArrival=100000;
    // Let existing customers finish before measuring a completely filled fixture.
    while(s.state.customers.length||s.state.orders.length)s.step();
    const stock=s.state.shelves.drinks.onHand;
    if(tier>=1)s.upgradeShelf(1);if(tier===2)s.upgradeShelf(2);
    assert.equal(s.state.shelves.drinks.onHand,stock);
    for(let i=0;i<8;i++){if(!s.order('drinks'))break;while(s.state.orders.length)s.step();s.assertValid();}
    assert.equal(s.state.shelves.drinks.onHand,SHELF_TIERS[tier].capacity);
    assert.equal(s.order('drinks'),false);
  }
});
test('Doors open for access, close when idle and resume at the same angle after reload',()=>{
  const s=new Shop();earn(s,400);s.upgradeShelf(1);s.upgradeShelf(2);
  let observed=false;
  for(let i=0;i<2000;i++){
    if(s.available('drinks')<=6)s.order('drinks');s.step();
    if(s.state.drinksDoor>0&&s.state.drinksDoor<1){
      const copy=Shop.restore(s.snapshot());copy.step(30);s.step(30);assert.deepEqual(copy.snapshot(),s.snapshot());observed=true;break;
    }
  }
  assert.ok(observed);
  s.state.nextArrival=100000;
  while(s.state.customers.length||s.state.orders.length)s.step();
  s.step(20);assert.equal(s.state.drinksDoor,0);
});
