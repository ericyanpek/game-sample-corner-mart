import {PRODUCT_IDS,type Shop} from './sim.ts';

export type SoundCue='pickup'|'order'|'stock'|'sale'|'upgrade'|'layout'|'open'|'settled';
export const SOUND_STORAGE_KEY='corner-mart-sound-v1';

/** Observe completed changes, without adding sound state to saves or the simulation. */
export class ShopSoundEvents {
  private shop:Shop|null=null;
  private previous:ReturnType<ShopSoundEvents['read']>|null=null;
  private read(shop:Shop,phase:string){
    const s=shop.state;
    return {
      tick:s.tick,phase,sold:s.stats.sold,procurement:s.ledger.procurement,
      received:PRODUCT_IDS.reduce((sum,p)=>sum+s.shelves[p].received,0),
      upgrades:s.ledger.upgrades+s.ledger.unlocks,layout:s.layoutId,
      held:new Set(s.customers.flatMap(c=>shop.visibleItems(c).map(item=>`${c.id}:${item.product}`))),
    };
  }
  observe(shop:Shop,phase='free'):SoundCue|null{
    const next=this.read(shop,phase),before=this.previous;
    this.previous=next;
    if(this.shop!==shop||!before||next.tick<before.tick){this.shop=shop;return null;}
    // One sound per observation; never replay every event after a slow frame.
    if(next.phase==='settled'&&before.phase!=='settled')return 'settled';
    if(next.phase==='open'&&before.phase!=='open')return 'open';
    if(next.upgrades>before.upgrades)return 'upgrade';
    if(next.layout!==before.layout)return 'layout';
    if(next.sold>before.sold)return 'sale';
    if(next.received>before.received)return 'stock';
    if(next.procurement>before.procurement)return 'order';
    if([...next.held].some(key=>!before.held.has(key)))return 'pickup';
    return null;
  }
}

type Note={frequency:number;at:number;length:number;gain:number;type?:OscillatorType;end?:number};
const notes:Record<SoundCue,Note[]>={
  pickup:[{frequency:390,at:0,length:.09,gain:.24,type:'triangle',end:300}],
  order:[{frequency:260,at:0,length:.1,gain:.3,type:'triangle'}],
  stock:[{frequency:190,at:0,length:.12,gain:.43,type:'triangle',end:130},{frequency:280,at:.12,length:.13,gain:.3,type:'triangle',end:210}],
  sale:[{frequency:784,at:0,length:.14,gain:.38},{frequency:1046.5,at:.105,length:.23,gain:.3}],
  upgrade:[{frequency:523.25,at:0,length:.17,gain:.35},{frequency:659.25,at:.11,length:.17,gain:.32},{frequency:784,at:.22,length:.28,gain:.3}],
  layout:[{frequency:330,at:0,length:.16,gain:.32,type:'triangle'},{frequency:440,at:.12,length:.22,gain:.3,type:'triangle'}],
  open:[{frequency:659.25,at:0,length:.21,gain:.3},{frequency:880,at:.15,length:.32,gain:.28}],
  settled:[{frequency:659.25,at:0,length:.23,gain:.28},{frequency:523.25,at:.15,length:.23,gain:.28},{frequency:392,at:.3,length:.38,gain:.3}],
};
const cooldown:Record<SoundCue,number>={pickup:2.2,order:.55,stock:1.2,sale:1.1,upgrade:.7,layout:1,open:2,settled:3};

/** Short, quiet, synthesized cues. No audio files, background loops or event queue. */
export class ShopAudio {
  enabled=true;
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private voices=new Set<{oscillator:OscillatorNode;gain:GainNode}>();
  private last=new Map<SoundCue,number>();
  private nextSound=0;
  private hidden=false;
  private failed=false;
  private played=0;
  private lastCue:SoundCue|null=null;
  constructor(private factory:(()=>AudioContext)|null,private storage:Pick<Storage,'getItem'|'setItem'>|null){
    try{this.enabled=storage?.getItem(SOUND_STORAGE_KEY)!=='off';}catch{/* Storage is optional. */}
  }
  get supported(){return !!this.factory&&!this.failed;}
  async unlock(){
    if(!this.enabled||this.hidden||!this.supported)return false;
    try{
      if(!this.context){
        this.context=this.factory!();
        this.master=this.context.createGain();
        this.master.gain.value=.12;
        this.master.connect(this.context.destination);
      }
      if(this.context.state!=='running')await this.context.resume();
      return this.context.state==='running'&&this.enabled&&!this.hidden;
    }catch{
      // A blocked resume can be retried with the next gesture. Construction failure
      // disables only audio; it must never interrupt the game.
      if(!this.context)this.failed=true;
      return false;
    }
  }
  setEnabled(enabled:boolean){
    this.enabled=enabled;
    try{this.storage?.setItem(SOUND_STORAGE_KEY,enabled?'on':'off');}catch{/* Keep the session choice. */}
    if(!enabled)this.stop();
  }
  setHidden(hidden:boolean){
    this.hidden=hidden;
    if(hidden){
      this.stop();
      if(this.context?.state==='running')void this.context.suspend().catch(()=>{});
    }
    // Returning to the tab requires another gesture; nothing is queued.
  }
  stop(){
    const now=this.context?.currentTime??0;
    for(const voice of this.voices){
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0,now,.008);
      try{voice.oscillator.stop(now+.035);}catch{/* Already ended. */}
    }
    this.nextSound=0;this.last.clear();
  }
  play(cue:SoundCue){
    const ctx=this.context;
    if(!this.enabled||this.hidden||!ctx||ctx.state!=='running'||!this.master||this.failed)return false;
    const now=ctx.currentTime;
    if(now<this.nextSound||now-(this.last.get(cue)??-Infinity)<cooldown[cue]||this.voices.size+notes[cue].length>6)return false;
    this.last.set(cue,now);
    // Wall-clock spacing stays the same at 1× / 2× / 4× simulation speed.
    this.nextSound=now+Math.max(.25,...notes[cue].map(n=>n.at+n.length))+.06;
    try{
      for(const note of notes[cue]){
        const oscillator=ctx.createOscillator(),gain=ctx.createGain(),start=now+.005+note.at;
        oscillator.type=note.type??'sine';
        oscillator.frequency.setValueAtTime(note.frequency,start);
        if(note.end)oscillator.frequency.exponentialRampToValueAtTime(note.end,start+note.length);
        gain.gain.setValueAtTime(0,now);
        gain.gain.setValueAtTime(0,start);
        gain.gain.linearRampToValueAtTime(note.gain,start+.012);
        gain.gain.exponentialRampToValueAtTime(.0001,start+note.length);
        gain.gain.linearRampToValueAtTime(0,start+note.length+.015);
        oscillator.connect(gain);gain.connect(this.master);
        const voice={oscillator,gain};this.voices.add(voice);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices.delete(voice);};
        oscillator.start(start);oscillator.stop(start+note.length+.02);
      }
      this.played++;this.lastCue=cue;return true;
    }catch{this.failed=true;this.stop();return false;}
  }
  status(){return {enabled:this.enabled,supported:this.supported,state:this.context?.state??'locked',voices:this.voices.size,played:this.played,lastCue:this.lastCue};}
}

export function setupShopAudio(){
  const ctor=window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  let storage:Storage|null=null;try{storage=window.localStorage;}catch{/* Private/restricted storage. */}
  const audio=new ShopAudio(ctor?()=>new ctor({latencyHint:'interactive'}):null,storage);
  const button=document.querySelector<HTMLButtonElement>('#sound-toggle')!;
  const update=()=>{
    const on=audio.enabled&&audio.supported;
    button.setAttribute('aria-pressed',String(on));
    button.setAttribute('aria-label',audio.supported?`游戏音效${on?'已开启，点击静音':'已关闭，点击开启'}`:'此浏览器暂不支持游戏音效');
    button.title=audio.supported?'轻量动作音效 · 无背景音乐':'此浏览器暂不支持游戏音效';
    button.querySelector('span')!.textContent=on?'音效':'静音';
    button.disabled=!audio.supported;
  };
  const unlock=(event:Event)=>{if(event.isTrusted)void audio.unlock().then(update);};
  // The guide's window capture gate runs first, including on off-target clicks.
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true});
  document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')unlock(event);},{capture:true});
  button.onclick=()=>{
    audio.setEnabled(!audio.enabled);update();
    if(audio.enabled)void audio.unlock().then(ok=>{if(ok)audio.play('pickup');update();});
  };
  document.addEventListener('visibilitychange',()=>audio.setHidden(document.hidden));
  window.addEventListener('pagehide',()=>audio.setHidden(true));
  window.addEventListener('pageshow',()=>audio.setHidden(document.hidden));
  audio.setHidden(document.hidden);update();
  return audio;
}
