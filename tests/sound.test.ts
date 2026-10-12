import test from 'node:test';
import assert from 'node:assert/strict';
import {Shop} from '../src/sim.ts';
import {BusinessDay} from '../src/day.ts';
import {ShopAudio,ShopSoundEvents,type SoundCue} from '../src/sound.ts';

test('audio follows actual shelf placement and payment, without changing simulation results',()=>{
  const observed=new BusinessDay(),control=new BusinessDay(),events=new ShopSoundEvents();
  const heard:SoundCue[]=[];
  assert.equal(events.observe(observed.shop,observed.phase),null);
  for(const day of [observed,control]){day.action('upgrade','staff');day.action('order','bread');}
  assert.equal(events.observe(observed.shop,observed.phase),'upgrade');
  let received=observed.shop.state.shelves.bread.received;
  for(let tick=0;tick<600;tick++){
    observed.step(1);control.step(1);
    const cue=events.observe(observed.shop,observed.phase);
    if(cue==='stock')assert.ok(observed.shop.state.shelves.bread.received>received);
    received=observed.shop.state.shelves.bread.received;
    if(cue)heard.push(cue);
  }
  assert.ok(heard.includes('stock'));
  assert.ok(observed.open());assert.ok(control.open());
  assert.equal(events.observe(observed.shop,observed.phase),'open');
  let sold=0;
  for(let tick=0;tick<3000;tick++){
    observed.step(1);control.step(1);
    const cue=events.observe(observed.shop,observed.phase);
    if(cue==='sale')assert.ok(observed.shop.state.stats.sold>sold);
    sold=observed.shop.state.stats.sold;
    if(cue)heard.push(cue);
  }
  assert.ok(heard.includes('pickup')&&heard.includes('sale'));
  assert.equal(heard.filter(c=>c==='settled').length,1);
  assert.deepEqual(observed.snapshot(),control.snapshot());
  assert.equal(events.observe(observed.shop,observed.phase),null);
  assert.equal(events.observe(BusinessDay.restore(observed.snapshot()).shop,'settled'),null);
  const replay=observed.replay();
  assert.equal(events.observe(replay.shop,replay.phase),null);
});

test('a paid order sounds different from placement; rejected actions stay silent',()=>{
  const shop=new Shop(),events=new ShopSoundEvents();
  events.observe(shop);
  assert.equal(shop.order('bread'),false);
  assert.equal(events.observe(shop),null);
  assert.ok(shop.order('drinks'));
  assert.equal(events.observe(shop),'order');
  assert.equal(shop.state.shelves.drinks.received,0);
  assert.equal(events.observe(shop),null);
  assert.ok(shop.changeLayout('supply'));
  assert.equal(events.observe(shop),null);
  let layoutHeard=false;
  for(let i=0;i<500;i++){
    shop.step(1,{arrivals:false,restock:false});
    if(events.observe(shop)==='layout'){layoutHeard=true;assert.equal(shop.state.layoutId,'supply');}
  }
  assert.ok(layoutHeard);
});

class FakeParam {
  value=0;
  setValueAtTime(){return this;} linearRampToValueAtTime(){return this;}
  exponentialRampToValueAtTime(){return this;} cancelScheduledValues(){return this;}
  setTargetAtTime(){return this;}
}
class FakeOscillator {
  type='sine';frequency=new FakeParam();onended:(()=>void)|null=null;end=Infinity;disconnected=false;
  connect(){} start(){} disconnect(){this.disconnected=true;}
  stop(at:number){this.end=at;}
}
class FakeContext {
  state='suspended';currentTime=0;destination={};oscillators:FakeOscillator[]=[];gains:FakeParam[]=[];
  resume(){this.state='running';return Promise.resolve();}
  suspend(){this.state='suspended';return Promise.resolve();}
  createGain(){const gain=new FakeParam();this.gains.push(gain);return {gain,connect(){},disconnect(){}};}
  createOscillator(){const o=new FakeOscillator();this.oscillators.push(o);return o;}
  advance(seconds:number){
    this.currentTime+=seconds;
    for(const o of this.oscillators)if(!o.disconnected&&o.end<=this.currentTime)o.onended?.();
  }
}
function audioFixture(saved:string|null=null){
  const ctx=new FakeContext();let value=saved,created=0;
  const audio=new ShopAudio(()=>{created++;return ctx as unknown as AudioContext;},{getItem:()=>value,setItem:(_key,v)=>{value=v;}});
  return {audio,ctx,created:()=>created,saved:()=>value};
}
test('audio is lazy, rate-limited in real time, and releases every oscillator',async()=>{
  const {audio,ctx,created}=audioFixture();
  assert.equal(audio.play('sale'),false);assert.equal(created(),0);
  assert.ok(await audio.unlock());assert.equal(created(),1);assert.equal(ctx.gains[0].value,.12);
  assert.ok(audio.play('sale'));
  for(let i=0;i<40;i++){assert.equal(audio.play('sale'),false);assert.equal(audio.play('pickup'),false);}
  assert.equal(audio.status().voices,2);
  ctx.advance(.6);assert.equal(audio.status().voices,0);
  assert.equal(audio.play('sale'),false);
  assert.ok(audio.play('stock'));
  ctx.advance(2);
  assert.ok(audio.play('sale'));
  ctx.advance(2);
  assert.equal(audio.status().voices,0);
  assert.ok(ctx.oscillators.every(o=>o.disconnected));
});
test('mute and background cut off future notes, retain preference and do not queue cues',async()=>{
  const {audio,ctx,saved}=audioFixture();
  await audio.unlock();audio.play('settled');
  audio.setEnabled(false);
  assert.equal(saved(),'off');
  assert.ok(ctx.oscillators.every(o=>o.end<=ctx.currentTime+.035));
  assert.equal(audio.play('upgrade'),false);
  ctx.advance(1);assert.equal(audio.status().voices,0);
  audio.setEnabled(true);
  audio.setHidden(true);
  assert.equal(ctx.state,'suspended');assert.equal(audio.play('sale'),false);
  assert.equal(await audio.unlock(),false);
  audio.setHidden(false);
  assert.equal(audio.play('sale'),false);
  await audio.unlock();
  assert.equal(audio.status().played,1);
  assert.ok(audio.play('stock'));
  const muted=audioFixture('off');
  assert.equal(await muted.audio.unlock(),false);assert.equal(muted.created(),0);
});
test('unsupported audio or inaccessible storage never prevents playing the game',async()=>{
  const unavailable=new ShopAudio(null,null);
  assert.equal(await unavailable.unlock(),false);
  assert.equal(unavailable.play('sale'),false);
  const broken=new ShopAudio(()=>{throw Error('Audio unavailable');},{getItem(){throw Error('Storage denied');},setItem(){throw Error('Storage denied');}});
  assert.equal(await broken.unlock(),false);
  assert.doesNotThrow(()=>broken.setEnabled(false));
  assert.equal(broken.supported,false);
});
