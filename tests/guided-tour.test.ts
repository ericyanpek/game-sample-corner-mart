import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessDay,DAY_TICKS} from '../src/day.ts';
import {dayStorageKey} from '../src/day-themes.ts';
import {guidedStorageKey,freshGuide,restoreGuide,roundGuide,themeBriefing,guideOutcome} from '../src/guided-tour-state.ts';

test('guided uses separate storage and unchanged starting economy',()=>{
  const day=new BusinessDay();
  for(const theme of ['breakfast','hot','rush'] as const)assert.notEqual(guidedStorageKey(theme),dayStorageKey(theme));
  assert.equal(day.shop.state.cash,380);
  assert.equal(day.shop.state.shelves.bread.onHand,12);
  assert.equal(day.shop.state.drinksTier,0);
});
test('restock guidance waits for physical stocking, not payment or a queued box',()=>{
  const day=new BusinessDay(),guide=freshGuide(day),s=day.shop.state;
  assert.ok(day.action('upgrade','staff'));
  assert.ok(day.action('order','bread'));
  assert.equal(s.cash,274);
  assert.equal(guideOutcome('restock',day,guide),false);
  day.step(1);
  assert.equal(guideOutcome('restock',day,guide),false);
  for(let i=0;i<3000&&!guideOutcome('restock',day,guide);i++)day.step();
  assert.ok(guideOutcome('restock',day,guide));
  assert.equal(s.shelves.bread.received-guide.receivedBefore,12);
  assert.equal(day.elapsed,0);
  assert.equal(day.report().procurement,36);
  day.assertValid();
});
test('a different customer paying cannot complete the followed customer lesson',()=>{
  const day=new BusinessDay(),guide=freshGuide(day);
  guide.customerId=700;guide.step='checkout';
  day.visits[0].customer=701;day.visits[0].outcome='complete';
  assert.equal(guideOutcome('checkout',day,guide),false);
  day.visits[1].customer=700;day.visits[1].outcome='shopping';
  assert.equal(guideOutcome('checkout',day,guide),false);
  day.visits[1].outcome='impatient';
  assert.equal(guideOutcome('checkout',day,guide),true);
});
test('layout lesson completes only after the actual move finishes',()=>{
  const day=new BusinessDay(),guide=freshGuide(day);
  assert.ok(day.action('layout','supply'));
  assert.equal(guideOutcome('layout',day,guide),false);
  for(let i=0;i<3000&&day.shop.state.layoutChange;i++)day.step();
  assert.equal(guideOutcome('layout',day,guide),true);
  day.assertValid();
});
test('tutorial progress survives reload but is not carried into a new attempt or theme',()=>{
  const day=new BusinessDay(),guide=freshGuide(day);
  guide.step='restock';guide.completed=['forecast','hire'];guide.customerId=null;
  const restored=BusinessDay.restore(day.snapshot());
  assert.deepEqual(restoreGuide(JSON.parse(JSON.stringify(guide)),restored),guide);
  restored.attempt++;
  assert.equal(restoreGuide(guide,restored).step,'welcome');
  assert.equal(restoreGuide(guide,new BusinessDay(undefined,day.seed,'hot')).step,'welcome');
  assert.equal(restoreGuide({...guide,step:'missing-step'},day).step,'welcome');
});
test('perspective lesson flags migrate old saves and never replace physical outcomes',()=>{
  const day=new BusinessDay(),guide=freshGuide(day);
  guide.step='checkout';guide.customerId=700;guide.pov={restock:true,checkout:true};
  const restored=restoreGuide(JSON.parse(JSON.stringify(guide)),day);
  assert.deepEqual(restored,guide);
  assert.equal(guideOutcome('restock',day,restored),false);
  assert.equal(guideOutcome('checkout',day,restored),false);
  const {pov,...legacy}=guide;
  assert.deepEqual(restoreGuide(legacy,day),{...legacy,pov:{restock:false,checkout:false}});
  assert.deepEqual(restoreGuide({...guide,attempt:day.attempt+1},day).pov,{restock:false,checkout:false});
});
test('guided purchases and full business day conserve cash, goods, and replay conditions',()=>{
  const day=new BusinessDay(),guide=freshGuide(day);
  assert.ok(day.action('upgrade','staff'));assert.ok(day.action('order','bread'));
  for(let i=0;i<3000&&!day.canOpen;i++)day.step();
  assert.ok(guideOutcome('restock',day,guide));
  assert.ok(day.action('shelf','1'));
  assert.equal(day.shop.state.cash,194);
  assert.ok(day.open());
  assert.ok(guideOutcome('open',day,guide));
  day.step(200);
  assert.ok(day.action('layout','supply'));assert.ok(day.action('restock','bread'));
  assert.ok(guideOutcome('dispatch',day,guide));
  for(let i=0;i<15000&&!guideOutcome('finish',day,guide);i++)day.step();
  assert.equal(day.phase,'settled');assert.equal(day.elapsed,DAY_TICKS);
  const r=day.report();
  assert.equal(r.cashChange,r.revenue-r.procurement-r.upgrades-r.unlocks);
  assert.equal(r.startInventory+r.procurement-r.cogs,r.endInventory);
  const replay=day.replay();
  assert.equal(replay.conditions,day.conditions);
  assert.equal(replay.shop.state.cash,380);assert.equal(replay.shop.state.drinksTier,0);
  assert.equal(replay.shop.state.upgrades.staff,false);
  assert.equal(freshGuide(replay).step,'welcome');
  day.assertValid();replay.assertValid();
});
test('switching guidance preserves paid preparation and survives save/reopen',()=>{
  const day=new BusinessDay(undefined,undefined,'hot');
  day.action('order','bread');day.step(20);
  const snapshot=day.snapshot();
  for(const mode of ['free','theme','guided'] as const){
    const progress=roundGuide(day,mode);
    const restored=BusinessDay.restore(snapshot);
    assert.deepEqual(restoreGuide(JSON.parse(JSON.stringify(progress)),restored),progress);
    assert.deepEqual(day.snapshot(),snapshot);assert.deepEqual(restored.snapshot(),snapshot);
  }
  assert.equal(roundGuide(day,'free').step,'skipped');
  assert.equal(roundGuide(day,'theme').step,'briefing');
  assert.equal(roundGuide(day,'guided').step,'welcome');
});
test('manual full guidance remains available on later attempts without clearing history',()=>{
  const day=new BusinessDay();day.open();day.step(8000);
  const replay=day.replay(),before=replay.snapshot();
  assert.equal(roundGuide(replay,'free').step,'skipped');
  assert.equal(roundGuide(replay,'guided').step,'welcome');
  assert.equal(replay.attempt,2);assert.deepEqual(replay.snapshot(),before);
  assert.equal(replay.history.length,1);
  assert.equal(roundGuide(new BusinessDay(),'guided').step,'welcome');
});
test('theme reminders describe actual demand and distinguish resumed trading',()=>{
  const hot=new BusinessDay(undefined,undefined,'hot'),rush=new BusinessDay(undefined,undefined,'rush');
  assert.match(themeBriefing(hot).text,/饮料需求 34 件、面包 6 件/);
  assert.match(themeBriefing(rush).text,/第 2 分钟有 23 位/);
  hot.open();hot.step(30);
  assert.match(themeBriefing(hot).text,/已恢复上次进度/);
  assert.doesNotMatch(themeBriefing(hot).text,/筹备不计时/);
});
test('legacy showcase progress migrates into the short tour without changing paid work',()=>{
  const day=new BusinessDay();day.action('upgrade','staff');day.action('order','bread');day.step(10);
  const before=day.snapshot();
  for(const [oldStep,nextStep] of [['forecast','hire'],['upgrade','open'],['layout','finish'],['dispatch','finish'],['restock','restock']] as const){
    const legacy={...freshGuide(day),version:1,step:oldStep,pov:{restock:true,checkout:true}};
    const restored=restoreGuide(legacy,day);
    assert.equal(restored.version,2);assert.equal(restored.step,nextStep);
    assert.deepEqual(day.snapshot(),before);
    assert.deepEqual(restored.pov,legacy.pov);
  }
  assert.equal(restoreGuide({...freshGuide(day),version:1,step:'skipped'},day).step,'skipped');
});
