import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessDay,demandPlan} from '../src/day.ts';
import {DAY_THEME_IDS,dayStorageKey,type DayThemeId} from '../src/day-themes.ts';
import OLD_OPEN from './fixtures/day-v1-open.json';
import OLD_SETTLED from './fixtures/day-v1-settled.json';

function finish(d:BusinessDay){d.step(9000);d.assertValid();assert.equal(d.phase,'settled');return d.report();}
function prepare(d:BusinessDay){
  assert.ok(d.action('upgrade','checkout'));assert.ok(d.action('upgrade','staff'));assert.ok(d.action('order','drinks'));
  d.action('layout','supply');d.step(900);assert.ok(d.open());
}
test('themes share budget and total visitors but change explicit lists or arrival cadence',()=>{
  const days=DAY_THEME_IDS.map(t=>new BusinessDay(undefined,20260915,t)),[breakfast,hot,rush]=days;
  for(const d of days){assert.deepEqual(d.baseline,breakfast.baseline);assert.equal(d.visits.length,34);}
  assert.equal(breakfast.visits.filter(v=>v.kind==='breakfast').length,24);
  assert.equal(hot.visits.filter(v=>v.kind==='breakfast').length,6);
  assert.deepEqual(breakfast.visits.map(v=>v.at),hot.visits.map(v=>v.at));
  assert.deepEqual(breakfast.visits.map(v=>v.products),rush.visits.map(v=>v.products));
  assert.deepEqual(rush.periods().map(p=>p.demand),[5,23,6]);
  assert.equal(new Set(days.map(d=>d.conditions)).size,3);assert.equal(new Set(DAY_THEME_IDS.map(dayStorageKey)).size,3);
});
test('legacy saves keep transactions and completed reports across the new checkout layout',()=>{
  const active=BusinessDay.restore(OLD_OPEN);assert.equal(active.theme,'breakfast');
  assert.deepEqual(active.shop.state.ledger,OLD_OPEN.shop.ledger);assert.deepEqual(active.shop.state.shelves,OLD_OPEN.shop.shelves);assert.deepEqual(active.visits,OLD_OPEN.visits);
  assert.equal(active.snapshot().version,2);finish(active);assert.notEqual(active.report().conditions,OLD_SETTLED.history.at(-1)!.conditions);
  const closed=BusinessDay.restore(OLD_SETTLED);assert.deepEqual(closed.history,OLD_SETTLED.history);
  const {feedback,admission,...facts}=closed.report();
  const {feedback:oldFeedback,...oldFacts}=OLD_SETTLED.history.at(-1)!;
  assert.deepEqual(facts,oldFacts);assert.equal(admission!.unknown,oldFacts.blocked);
  assert.ok(feedback.some(s=>s.includes('原因未记录')));
  const replay=closed.replay();assert.deepEqual(replay.shop.snapshot(),closed.baseline);assert.equal(replay.theme,'breakfast');
});
test('each theme replays identical arrivals and actions with identical measured outcomes',()=>{
  for(const theme of DAY_THEME_IDS){
    const d=new BusinessDay(undefined,20260915,theme);prepare(d);const report=finish(d),next=d.replay();
    assert.deepEqual(next.visits,demandPlan(next.seed,theme));assert.equal(next.theme,theme);
    prepare(next);assert.deepEqual({...finish(next),attempt:1},report);
  }
});
test('opening, closing and mid-layout saves retain theme and demand schedule',()=>{
  for(const theme of ['hot','rush'] as DayThemeId[]){
    const d=new BusinessDay(undefined,20260915,theme);d.action('upgrade','staff');d.open();d.step(625);d.action('layout','supply');
    const restored=BusinessDay.restore(d.snapshot());d.step(1175);restored.step(1175);
    assert.equal(d.phase,'closing');assert.deepEqual(d.snapshot(),restored.snapshot());
    const close=BusinessDay.restore(d.snapshot());finish(d);finish(close);assert.deepEqual(d.snapshot(),close.snapshot());
  }
});
test('period accounting groups final outcomes by arrival time and reconciles totals',()=>{
  const d=new BusinessDay(undefined,20260915,'rush');prepare(d);const r=finish(d),p=d.periods();
  for(const [periodKey,reportKey] of [['demand','demand'],['complete','complete'],['blocked','blocked'],['impatient','impatient']] as const)
    assert.equal(p.reduce((n,x)=>n+x[periodKey],0),r[reportKey]);
  assert.ok(r.feedback.some(t=>t.includes(`01:00—02:00 到店的 ${p[1].demand}`)));
});
test('unsupported themes and mixed-theme histories are rejected',()=>{
  const d=new BusinessDay(undefined,20260915,'hot');d.open();finish(d);
  const state=d.snapshot();assert.throws(()=>BusinessDay.restore({...state,theme:'rain'}));
  assert.throws(()=>BusinessDay.restore({...state,theme:'rush'}));
  const breakfast=new BusinessDay();breakfast.history=d.history;assert.throws(()=>breakfast.assertValid());
});
test('three themes on both layouts and three seeds close with conserved cash and inventory',()=>{
  for(const theme of DAY_THEME_IDS)for(const seed of [20260915,42,910])for(const layout of ['aisle','supply']){
    const d=new BusinessDay(undefined,seed,theme);d.action('upgrade','staff');d.action('upgrade','checkout');d.action('layout',layout);
    d.step(900);d.open();const r=finish(d);
    assert.equal(r.startInventory+r.procurement-r.cogs,r.endInventory);
    assert.equal(r.cashChange,r.revenue-r.procurement-r.upgrades-r.unlocks);
  }
});
