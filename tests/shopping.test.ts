import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Shop,PRODUCT_IDS,SHOPPING_SPEC,FixedClock,type Customer,type Product} from '../src/sim.ts';
import {distance,SEPARATION} from '../src/navigation.ts';
import START from '../assets/specs/shopping-lab-start.json';
function setup(){const s=Shop.restore(START);s.state.upgrades.staff=false;s.state.nextArrival=1e9;return s;}
function reach(s:Shop,until:()=>boolean,max=3000){for(let i=0;i<max;i++){if(until())return;s.step();s.assertValid();}throw Error('Condition not reached: '+JSON.stringify(s.state.customers.map(c=>[c.id,c.state,c.shopping,c.nav.blocked])));}
function drain(s:Shop){reach(s,()=>!s.state.customers.length&&!s.state.orders.length&&!s.state.delivery,4000);}
function spawn(s:Shop,kind:'breakfast'|'quick'='breakfast'){
  s.state.rng=kind==='breakfast'?1:1000;const id=s.state.nextId;s.spawn();
  const c=s.state.customers.find(c=>c.id===id)!;assert.ok(c);assert.equal(c.kind,kind);return c;
}
function deplete(s:Shop,p:Product,remaining=0){
  for(let i=0;i<50&&s.state.shelves[p].onHand>remaining;i++){spawn(s,p==='bread'?'breakfast':'quick');drain(s);}
  assert.equal(s.state.shelves[p].onHand,remaining);
}
function refillDrink(s:Shop){if(s.available('drinks')<2){assert.ok(s.order('drinks'));drain(s);}}
function geometry(s:Shop){const bodies=[...s.state.customers,...(s.state.delivery?[s.state.delivery]:[])];for(let i=0;i<bodies.length;i++){assert.ok(s.nav.free(bodies[i].pos));for(let j=0;j<i;j++)assert.ok(distance(bodies[i].pos,bodies[j].pos)>=SEPARATION-1e-5);}}
test('One breakfast visit keeps the first item reserved while visiting the second shelf',()=>{
  const s=setup(),initial=s.snapshot(),c=spawn(s);
  reach(s,()=>c.product==='bread'&&c.state==='shelfQueue');
  assert.equal(c.shopping[0].status,'reserved');assert.equal(s.hasItem(c),true);
  assert.equal(s.onShelf('drinks'),initial.shelves.drinks.onHand-1);assert.equal(s.state.shelves.drinks.reserved,1);
  assert.equal(s.state.shelves.drinks.onHand,initial.shelves.drinks.onHand);assert.equal(s.state.cash,initial.cash);
  reach(s,()=>c.state==='toQueue');assert.equal(s.reservedItems(c).length,2);assert.equal(s.state.shelves.bread.reserved,1);
  const amount=s.basketTotal(c);reach(s,()=>c.state==='pay'&&c.timer===1);
  const copy=Shop.restore(s.snapshot());copy.step();copy.assertValid();
  const r=copy.state.receipts.at(-1)!;
  assert.equal(copy.state.cash,initial.cash+amount);assert.equal(copy.state.stats.sold,initial.stats.sold+1);
  assert.equal(copy.state.stats.unitsSold,initial.stats.unitsSold+2);assert.equal(copy.state.stats.multiSales,initial.stats.multiSales+1);
  assert.equal(r.lines.length,2);assert.equal(r.amount,r.lines.reduce((n,l)=>n+l.amount,0));assert.equal(copy.state.shelves.drinks.reserved,0);assert.equal(copy.state.shelves.bread.reserved,0);
  copy.step(600);assert.equal(copy.state.cash,initial.cash+amount);assert.equal(copy.state.receipts.at(-1)!.id,r.id);
});
test('Missing bread yields one paid drink, one transaction, and no empty-basket loss',()=>{
  const s=setup();deplete(s,'bread');refillDrink(s);const before=s.snapshot(),c=spawn(s);
  reach(s,()=>c.state==='pay'&&c.timer===1);assert.equal(c.shopping[1].status,'missing');assert.equal(s.reservedItems(c).length,1);
  const price=s.basketTotal(c);s.step();s.assertValid();const r=s.state.receipts.at(-1)!;
  assert.deepEqual(r.missing,['bread']);assert.equal(r.lines.length,1);assert.equal(r.amount,price);
  assert.equal(s.state.cash,before.cash+price);assert.equal(s.state.stats.partialSales,before.stats.partialSales+1);
  assert.equal(s.state.stats.noStock,before.stats.noStock);assert.equal(s.state.stats.missingItems,before.stats.missingItems+1);
});
test('Missing drinks does not stop the customer finding and paying for bread',()=>{
  const s=setup();deplete(s,'drinks');const before=s.snapshot(),c=spawn(s);
  reach(s,()=>c.state==='leave');const r=s.state.receipts.at(-1)!;
  assert.deepEqual(r.lines.map(l=>l.product),['bread']);assert.deepEqual(r.missing,['drinks']);assert.equal(r.amount,7);
  assert.equal(s.state.cash,before.cash+7);assert.equal(s.state.stats.noStock,before.stats.noStock);
});
test('Two missing items produce one lost customer and no phantom transaction',()=>{
  const s=setup();deplete(s,'bread');deplete(s,'drinks');const before=s.snapshot(),c=spawn(s);
  reach(s,()=>c.state==='leave');assert.ok(c.shopping.every(i=>i.status==='missing'));
  assert.equal(s.state.cash,before.cash);assert.equal(s.state.stats.sold,before.stats.sold);assert.deepEqual(s.state.receipts,before.receipts);
  assert.equal(s.state.stats.noStock,before.stats.noStock+1);assert.equal(s.state.stats.missingItems,before.stats.missingItems+2);assert.equal(s.state.layoutMetrics.lost,before.layoutMetrics.lost+1);
});
test('A late restock cannot silently add a previously missing item to the bill',()=>{
  const s=setup();deplete(s,'bread');refillDrink(s);const c=spawn(s);
  reach(s,()=>c.state==='toQueue');assert.equal(c.shopping[1].status,'missing');assert.ok(s.order('bread'));
  reach(s,()=>c.state==='leave');assert.equal(s.state.receipts.at(-1)!.lines.length,1);assert.deepEqual(s.state.receipts.at(-1)!.missing,['bread']);
  drain(s);assert.ok(s.state.shelves.bread.onHand>0);
});
test('Two breakfast customers compete for the final loaf without double reservations',()=>{
  const s=setup();deplete(s,'bread',1);refillDrink(s);const before=s.snapshot();spawn(s);spawn(s);
  for(let i=0;i<2000&&s.state.customers.length;i++){s.step();s.assertValid();geometry(s);assert.ok(s.state.shelves.bread.reserved<=1);}
  assert.equal(s.state.stats.sold,before.stats.sold+2);assert.equal(s.state.shelves.bread.sold,before.shelves.bread.sold+1);
  const receipts=s.state.receipts.slice(-2);assert.equal(receipts.reduce((n,r)=>n+r.lines.length,0),3);assert.equal(receipts.filter(r=>r.missing.includes('bread')).length,1);
});
test('Timeout returns each reserved SKU to its own shelf and releases only after putback',()=>{
  const s=setup(),before=s.snapshot(),c=spawn(s);reach(s,()=>c.state==='toQueue');
  c.queuedAt=s.state.tick-c.patience;s.step();assert.equal(c.state,'return');assert.equal(s.reservedItems(c).length,2);
  reach(s,()=>c.state==='putback'&&c.timer===1);const first=c.product,onShelf=s.onShelf(first);s.step();s.assertValid();
  assert.equal(s.onShelf(first),onShelf+1);assert.equal(c.shopping.find(i=>i.product===first)!.status,'returned');assert.equal(s.reservedItems(c).length,1);assert.equal(c.reservation,true);
  const copy=Shop.restore(s.snapshot());drain(copy);assert.equal(copy.state.shelves.drinks.reserved,0);assert.equal(copy.state.shelves.bread.reserved,0);
  assert.equal(copy.state.cash,before.cash);assert.equal(copy.state.stats.sold,before.stats.sold);assert.equal(copy.state.stats.impatient,before.stats.impatient+1);
  assert.equal(copy.state.shelves.drinks.onHand,before.shelves.drinks.onHand);assert.equal(copy.state.shelves.bread.onHand,before.shelves.bread.onHand);
});
test('Save, layout change and room-independent simulation keep the same two-item future',()=>{
  const s=setup(),c=spawn(s);reach(s,()=>c.shopping.every(i=>i.status==='reserved'));
  const items=structuredClone(c.shopping),money=s.state.cash;s.changeLayout('supply');s.step();
  const copy=Shop.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<1500;i++){s.step();copy.step();s.assertValid();geometry(s);assert.deepEqual(copy.snapshot(),s.snapshot());}
  assert.equal(s.state.layoutId,'supply');const r=s.state.receipts.at(-1)!;
  assert.deepEqual(r.lines.map(i=>[i.product,i.premium]),items.map(i=>[i.product,i.premium]));assert.equal(s.state.cash,money+r.amount);
});
test('v4 migration preserves a mid-layout-change store without changing old one-item orders',()=>{
  const old=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-v4-active.json',import.meta.url),'utf8')),s=Shop.restore(old);
  assert.equal(s.state.version,6);assert.equal(s.state.cash,old.cash);assert.deepEqual(s.state.shelves,old.shelves);assert.equal(s.state.layoutChange?.target,old.layoutChange?.target);
  assert.deepEqual(s.state.customers.map(c=>[c.id,c.product,c.state,c.timer,c.premium,c.reservation]),old.customers.map((c:any)=>[c.id,c.product,c.state,c.timer,c.premium,c.reservation]));
  assert.ok(s.state.customers.every(c=>c.shopping.length===1&&c.kind==='quick'&&c.patience===250));
  s.state.nextArrival=1e9;drain(s);s.assertValid();assert.equal(s.state.layoutId,'supply');
});
test('Quick and breakfast shoppers have explicit, distinct patience; a second item adds scan time',()=>{
  const s=setup(),b=spawn(s),q=spawn(s,'quick');
  assert.equal(b.patience,SHOPPING_SPEC.breakfastPatience);assert.equal(q.patience,SHOPPING_SPEC.quickPatience);assert.ok(b.patience>q.patience);
  const durations=new Map<number,number>();
  reach(s,()=>{for(const c of s.state.customers)if(c.state==='service')durations.set(c.id,c.serviceDuration);return durations.size===2;});
  assert.equal(durations.get(b.id),40+SHOPPING_SPEC.extraScanTicks);assert.equal(durations.get(q.id),40);
});
test('Six mixed-demand stores complete multi-item sales and drain without deadlock',()=>{
  for(const layout of ['aisle','supply'] as const)for(const seed of [1,13,20260914]){
    const s=Shop.restore(START);s.state.layoutId=layout;s.state.rng=seed;s.upgrade('marketing');
    for(let i=0;i<6000;i++){s.step();s.assertValid();geometry(s);}
    assert.ok(s.state.stats.multiSales>=5,layout+'/'+seed);s.state.nextArrival=1e9;drain(s);assert.equal(s.state.customers.length,0);
    for(const p of PRODUCT_IDS)assert.equal(s.state.shelves[p].reserved,0);
  }
});
test('Visual frame rates do not change multi-item transactions',()=>{
  const snapshots=[];
  for(const hz of [30,60,144]){const s=Shop.restore(START),clock=new FixedClock();for(let i=0;i<hz*100;i++)clock.feed(s,1/hz);s.assertValid();snapshots.push(s.snapshot());}
  assert.deepEqual(snapshots[0],snapshots[1]);assert.deepEqual(snapshots[1],snapshots[2]);
});
test('A paid shopper and a picker can yield sideways in the narrow cold-cabinet corridor',()=>{
  const blocked=JSON.parse(fs.readFileSync(new URL('./fixtures/list-corridor-deadlock.json',import.meta.url),'utf8')),s=Shop.restore(blocked);
  const sold=s.state.stats.sold;s.state.nextArrival=1e9;
  for(let i=0;i<4000&&(s.state.customers.length||s.state.orders.length||s.state.delivery);i++){s.step();s.assertValid();geometry(s);}
  assert.equal(s.state.customers.length,0);assert.ok(s.state.stats.sold>=sold);
  for(const p of PRODUCT_IDS)assert.equal(s.state.shelves[p].reserved,0);
});
test('Upgrading the drinks fixture mid-list preserves the already-picked regular SKU and whole bill',()=>{
  const old=JSON.parse(fs.readFileSync(new URL('../assets/specs/shelf-lab-start.json',import.meta.url),'utf8'));
  const s=Shop.restore(old);s.state.nextArrival=1e9;drain(s);
  assert.ok(s.unlock('bread'));assert.ok(s.order('bread'));drain(s);
  const c=spawn(s);reach(s,()=>c.product==='bread'&&c.state==='shelfQueue');
  const picked=structuredClone(c.shopping);assert.equal(picked[0].premium,false);
  assert.ok(s.upgradeShelf(1));assert.ok(s.upgradeShelf(2));assert.deepEqual(c.shopping,picked);
  const copy=Shop.restore(s.snapshot());drain(copy);const receipt=copy.state.receipts.at(-1)!;
  assert.equal(receipt.amount,12);assert.deepEqual(receipt.lines.map(i=>[i.product,i.premium,i.amount]),[['drinks',false,5],['bread',false,7]]);
  assert.ok(copy.order('drinks'));assert.equal(copy.state.orders[0].premium,true);assert.equal(copy.state.orders[0].unitCost,4);
});
test('Malformed lists and receipt sums are rejected before resume',()=>{
  const s=setup(),c=spawn(s);reach(s,()=>c.state==='leave');const bad=s.snapshot();bad.receipts.at(-1)!.amount++;assert.throws(()=>Shop.restore(bad));
  const duplicated=s.snapshot();duplicated.customers[0].shopping[1].product='drinks';assert.throws(()=>Shop.restore(duplicated));
  const inconsistent=s.snapshot();inconsistent.stats.unitsSold++;assert.throws(()=>Shop.restore(inconsistent));
});
