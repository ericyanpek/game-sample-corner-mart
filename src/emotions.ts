import type {Customer} from './sim.ts';
import SPEC from '../assets/specs/expressions.json';

export type Emotion=keyof typeof SPEC.faces;
export interface EmotionCue {emotion:Emotion;label:string;detail:string}
const cues={
  focused:{emotion:'focused',label:'专心购物',detail:'正在购物，尚无缺货或久等反馈'},
  complete:{emotion:'happy',label:'买齐啦',detail:'清单全部买齐，已经完成付款'},
  missing:{emotion:'disappointed',label:'有点失落',detail:'遇到缺货，还有商品没买到'},
  partial:{emotion:'disappointed',label:'没买齐',detail:'已经付款，但清单中有商品缺货'},
  empty:{emotion:'disappointed',label:'空手而归',detail:'没有买到商品，准备离店'},
  waiting:{emotion:'impatient',label:'等得有点久',detail:'排队时间已超过耐心的 65%'},
  abandoned:{emotion:'impatient',label:'不想等了',detail:'等待超时，放回商品后离店'}
} as const satisfies Record<string,EmotionCue>;

/** Presentation only: infer feelings from existing facts; never mutate a save or draw RNG. */
export function customerEmotion(c:Customer,tick:number):EmotionCue {
  if(c.state==='return'||c.state==='putback'||c.shopping.some(i=>i.status==='returned'))return cues.abandoned;
  const missing=c.shopping.some(i=>i.status==='missing');
  if(c.state==='leave'){
    if(c.happy&&c.shopping.every(i=>i.status==='purchased'))return cues.complete;
    return c.happy&&missing?cues.partial:cues.empty;
  }
  if((c.state==='queue'||c.state==='toQueue')&&tick-c.queuedAt>=c.patience*SPEC.impatientFraction)return cues.waiting;
  return missing?cues.missing:cues.focused;
}
