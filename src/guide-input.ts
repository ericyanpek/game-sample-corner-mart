/** Capture input before button handlers, scene picking and camera controls. */
export class GuideInputGate {
  private active=false;
  private allowed:HTMLElement[]=[];
  private selectors:string[]=[];
  private lastMark=-Infinity;
  private marked=new Map<HTMLElement,{tab:string|null;aria:string|null}>();
  constructor(private exit:()=>void){
    for(const type of ['pointerdown','pointerup','pointermove','mousedown','mouseup','touchstart','touchmove','touchend','click','dblclick','auxclick','contextmenu','wheel','keydown','keyup','input','change','focusin']){
      window.addEventListener(type,event=>this.capture(event),{capture:true,passive:false});
    }
  }
  private visible(el:HTMLElement){
    const style=getComputedStyle(el);
    return el.isConnected&&!el.closest('[hidden],.hidden')&&style.display!=='none'&&style.visibility!=='hidden'&&!(el as HTMLButtonElement).disabled;
  }
  private resolve(){return this.selectors.flatMap(s=>Array.from(document.querySelectorAll<HTMLElement>(s))).filter(el=>this.visible(el));}
  update(active:boolean,selectors:string[]){
    this.selectors=selectors;
    const next=active?this.resolve():[];
    const changed=this.active!==active||next.length!==this.allowed.length||next.some((el,i)=>el!==this.allowed[i]);
    this.active=active;
    this.allowed=next;
    if(!changed&&performance.now()-this.lastMark<100)return;
    this.lastMark=performance.now();
    document.body.classList.toggle('guide-locked',active);
    for(const [el,prior] of this.marked){
      if(!active||this.allowed.some(a=>a===el||a.contains(el))||!el.isConnected){
        if(prior.tab===null)el.removeAttribute('tabindex');else el.setAttribute('tabindex',prior.tab);
        if(prior.aria===null)el.removeAttribute('aria-disabled');else el.setAttribute('aria-disabled',prior.aria);
        delete el.dataset.guideLocked;this.marked.delete(el);
      }
    }
    if(!active)return;
    for(const el of Array.from(document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[role="button"],canvas[tabindex]'))){
      if(this.allowed.some(a=>a===el||a.contains(el))||this.marked.has(el))continue;
      this.marked.set(el,{tab:el.getAttribute('tabindex'),aria:el.getAttribute('aria-disabled')});
      el.setAttribute('tabindex','-1');el.setAttribute('aria-disabled','true');el.dataset.guideLocked='';
    }
    const focus=document.activeElement;
    if(focus&&focus!==document.body&&!this.allowed.some(el=>el===focus||el.contains(focus)))this.focusFirst();
  }
  private focusFirst(){this.allowed[0]?.focus({preventScroll:true});}
  private stop(event:Event){event.preventDefault();event.stopImmediatePropagation();}
  private capture(event:Event){
    if(!this.active)return;
    this.allowed=this.resolve();
    const node=event.target;
    if(!(node instanceof Node))return;
    if(event instanceof KeyboardEvent){
      // Keep browser navigation/refresh/zoom shortcuts available.
      if((event.metaKey||event.ctrlKey)&&['r','l','f','w','t','+','-','=','0','c'].includes(event.key.toLowerCase()))return;
      if(event.type==='keydown'&&event.key==='Escape'){this.stop(event);this.exit();return;}
      if(event.key==='Tab'){
        this.stop(event);
        if(event.type==='keydown'){
          const focusable=this.allowed.filter(el=>this.visible(el));
          const i=focusable.findIndex(el=>el===document.activeElement||el.contains(document.activeElement));
          focusable[(i+(event.shiftKey?-1:1)+focusable.length)%focusable.length]?.focus({preventScroll:true});
        }
        return;
      }
    }
    if(this.allowed.some(el=>el===node||el.contains(node)))return;
    const element=node instanceof Element?node:node.parentElement;
    const scroll=element?.closest('#inspector-scroll,#tour-coach');
    const canScroll=scroll&&this.allowed.some(el=>scroll.contains(el));
    const interactive=element?.closest('button,a,input,select,[role="button"],canvas');
    if(canScroll&&(event.type==='wheel'||['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup'].includes(event.type)&&!interactive))return;
    this.stop(event);
    if(event.type==='focusin')this.focusFirst();
  }
}
