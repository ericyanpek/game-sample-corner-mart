import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Shop,PRODUCT_IDS,LAYOUT_SPEC,type LayoutId} from '../src/sim.ts';
import {navigation,distance,SEPARATION,transform} from '../src/navigation.ts';
import {compare} from '../src/comparison.ts';
import START from '../assets/specs/layout-lab-start.json';
function geometry(s:Shop){
  const bodies=[...s.state.customers,...(s.state.delivery?[s.state.delivery]:[])];
  for(let i=0;i<bodies.length;i++){
    assert.ok(s.nav.free(bodies[i].pos),`body inside fixture: ${JSON.stringify(bodies[i].pos)}`);
    for(let j=0;j<i;j++)assert.ok(distance(bodies[i].pos,bodies[j].pos)>=SEPARATION-1e-5,'overlapping people');
    assert.ok(distance(bodies[i].pos,bodies[i].nav.previous)<=.145001,'teleported body');
  }
}
const manage=(s:Shop)=>{for(const p of PRODUCT_IDS)if(s.state.shelves[p].unlocked&&s.available(p)<=6)s.order(p);};
test('Both rotated layouts have reachable stations and reserve the entire door swing',()=>{
  const lengths=[];
  for(const id of ['aisle','supply'] as LayoutId[]){
    const nav=navigation(id,true);
    for(const goal of [...Object.values(nav.access),LAYOUT_SPEC.checkout as [number,number]]){
      let last=LAYOUT_SPEC.entrance as [number,number];const path=nav.route(last,goal);assert.ok(path.length);
      for(const p of path){assert.ok(nav.clear(last,p));last=p;}
    }
    assert.equal(nav.free(transform(nav.preset.drinks,[0,0])),false);
    assert.equal(nav.free(transform(nav.preset.drinks,[-.68,.90])),false);
    let last=LAYOUT_SPEC.delivery as [number,number],length=0;
    for(const p of nav.route(last,nav.access.drinks)){length+=distance(last,p);last=p;}lengths.push(length);
  }
  // With the employee based at the window-wall register, measure both routes;
  // the island no longer promises a shorter delivery than the wall shelf.
  assert.ok(lengths.every(n=>Number.isFinite(n)&&n>0));assert.ok(Math.abs(lengths[1]-lengths[0])>.1);
});
test('Six busy stores finish real orders, keep bodies apart and drain without deadlock',()=>{
  for(const id of ['aisle','supply'] as LayoutId[])for(const seed of [1,13,20260914]){
    const s=Shop.restore(START);s.state.layoutId=id;s.state.rng=seed;s.upgrade('marketing');
    for(let i=0;i<6000;i++){s.step();s.assertValid();geometry(s);}
    assert.ok(s.state.layoutMetrics.sold>25,`${id}/${seed}: no sales progress`);
    assert.ok(s.state.layoutMetrics.deliveryCount>1,`${id}/${seed}: worker starved`);
    s.state.nextArrival=1e9;
    for(let i=0;i<4000&&(s.state.customers.length||s.state.delivery||s.state.orders.length);i++){s.step();geometry(s);}
    assert.equal(s.state.customers.length,0,`${id}/${seed}: customer deadlock`);
    assert.equal(s.state.orders.length,0);s.assertValid();
  }
});
test('Layout changes preserve transactions during clearing and survive save/reload mid-move',()=>{
  const s=Shop.restore(START);let changes=0,stagingReload=false;
  for(let i=0;i<5000;i++){
    if(i%173===0&&!s.state.layoutChange){
      const before=s.snapshot(),target=s.state.layoutId==='aisle'?'supply':'aisle';assert.equal(s.changeLayout(target),true);
      assert.equal(s.changeLayout(target),false);assert.equal(s.shelfUpgradeQuote().allowed,false);
      let ticks=0;
      while(s.state.layoutChange&&ticks++<300){
        s.step();s.assertValid();geometry(s);
        assert.equal(s.state.cash,before.cash);assert.deepEqual(s.state.ledger,before.ledger);assert.deepEqual(s.state.shelves,before.shelves);
        assert.deepEqual(s.state.customers.map(c=>[c.id,c.state,c.timer,c.reservation,c.premium]),before.customers.map(c=>[c.id,c.state,c.timer,c.reservation,c.premium]));
        assert.deepEqual(s.state.orders.map(o=>[o.product,o.quantity,o.unitCost,o.premium]),before.orders.map(o=>[o.product,o.quantity,o.unitCost,o.premium]));
        if(s.state.layoutChange&&!stagingReload){const copy=Shop.restore(s.snapshot());copy.step();s.step();assert.deepEqual(copy.snapshot(),s.snapshot());stagingReload=true;}
      }
      assert.equal(s.state.layoutId,target);assert.equal(s.state.layoutChange,null);changes++;
    }
    s.step();s.assertValid();geometry(s);
  }
  assert.ok(changes>=20);assert.ok(stagingReload);assert.ok(s.state.layoutMetrics.since>START.tick);
});
test('Legacy v3 migration preserves paid state and repairs old positions into navigable space',()=>{
  const old=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-v3.json',import.meta.url),'utf8')),s=Shop.restore(old);
  assert.equal(s.state.version,6);assert.equal(s.state.cash,old.cash);assert.deepEqual(s.state.shelves,old.shelves);
  assert.deepEqual(s.state.customers.map(c=>[c.id,c.state,c.timer,c.reservation,c.premium]),old.customers.map((c:any)=>[c.id,c.state,c.timer,c.reservation,c.premium]));
  geometry(s);s.changeLayout('supply');
  for(let i=0;i<3000;i++){manage(s);s.step();s.assertValid();geometry(s);}
  assert.equal(s.state.layoutId,'supply');assert.ok(s.state.stats.sold>old.stats.sold);
});
test('Admission, resource ownership and return of reserved items stay consistent',()=>{
  for(const id of ['aisle','supply'] as LayoutId[]){
    const s=new Shop(1);s.state.layoutId=id;s.state.nextArrival=1e9;
    for(let i=0;i<2500;i++){
      if(i<600&&i%10===0)s.spawn();manage(s);s.step();s.assertValid();geometry(s);
      assert.ok(s.state.customers.length<=LAYOUT_SPEC.maxCustomers);
      for(const p of PRODUCT_IDS){
        const using=s.state.customers.filter(c=>c.product===p&&!c.approach&&['browse','pickup','putback'].includes(c.state));
        assert.ok(using.length<=1);
        if(s.state.delivery?.product===p&&s.state.delivery.phase==='stocking'&&!s.state.delivery.approach)assert.equal(using.length,0);
      }
    }
    assert.ok(s.state.stats.full>0);assert.equal(s.state.shelves.drinks.reserved,0);assert.equal(s.state.customers.length,0);
  }
});
test('Controlled comparisons consume identical demand and report measured weighted averages',()=>{
  const r=compare();
  for(const seed of r.seeds){const pair=r.trials.filter(t=>t.seed===seed);assert.equal(pair[0].arrivals,pair[1].arrivals);assert.equal(pair[0].demandRng,pair[1].demandRng);}
  for(const row of r.results){const runs=r.trials.filter(t=>t.layout===row.id);assert.equal(row.waitSeconds,runs.reduce((n,t)=>n+t.metrics.waitTicks,0)/10/row.waitCount);assert.ok(row.deliveryCount>0);}
  // A reproducible repeat, independent of wall-clock or rendering.
  assert.deepEqual(compare(),r);
});
test('Invalid layout and movement saves fail before simulation resumes',()=>{
  const bad:any=new Shop().snapshot();bad.layoutId='missing';assert.throws(()=>Shop.restore(bad));
  const s=new Shop();s.spawn();const invalid:any=s.snapshot();invalid.customers[0].nav=null;assert.throws(()=>Shop.restore(invalid));
  const staged:any=s.snapshot();staged.layoutChange={target:'supply',goals:{}};assert.throws(()=>Shop.restore(staged));
});
