import type {Shop} from './sim.ts';
import type {ShopView} from './view.ts';
import type {GameShell} from './game-shell.ts';
import {firstPersonPose,type FirstPersonTarget} from './first-person.ts';
import {customerName,customerActivity} from './shopping-ui.ts';

const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
export function setupFirstPersonUI(view:ShopView,shell:GameShell,enter:(target:FirstPersonTarget)=>void){
  const choices=$<HTMLSelectElement>('#pov-customer-choice');
  const customer=$<HTMLButtonElement>('#pov-customer');
  const context=$<HTMLButtonElement>('#pov-context');
  const stage=$('#stage'),caption=$('#scene-caption'),foot=$('.window-foot>span');
  const originalCaption=caption.textContent,originalFoot=foot.textContent;
  const originalAria=$('#world').getAttribute('aria-label')!;
  $('#camera-panel').prepend($('.pov-picker'));
  let contextTarget:FirstPersonTarget|null=null,lastSelected:number|null=null;
  $('#pov-cashier').onclick=()=>enter({kind:'cashier'});
  $('#pov-worker').onclick=()=>enter({kind:'worker'});
  customer.onclick=()=>{if(choices.value)enter({kind:'customer',id:Number(choices.value)});};
  context.onclick=()=>{if(contextTarget)enter(contextTarget);};
  $('#pov-ahead').onclick=()=>{view.firstPersonRig.ahead();$('#world').focus({preventScroll:true});};
  return {
    update(shop:Shop,held:boolean){
      const target=view.firstPersonTarget,active=!!target;
      stage.classList.toggle('first-person-mode',active);
      $('#pov-hud').hidden=!active;
      caption.textContent=active?'拖动或方向键环顾 · 角色自动行动 · 全景 / Esc 返回':originalCaption;
      foot.textContent=active?'角色自动行动 · 拖动环顾 · 全景 / Esc 返回':originalFoot;
      $('#world').setAttribute('aria-label',active?'角色第一视角：拖动或方向键环顾，角色自动行动；按 Escape 或点全景返回':originalAria);
      $('#camera-hint').textContent=active?'方向键或拖动环顾，点「全景」返回':'拖动可继续调整，点「全景」回到开店角度';
      for(const [kind,id] of [['cashier','pov-cashier'],['worker','pov-worker']] as const){
        const button=$<HTMLButtonElement>('#'+id);
        button.disabled=!view.loaded||!firstPersonPose(shop,{kind});
        button.setAttribute('aria-pressed',String(target?.kind===kind));
      }
      $('#pov-worker').textContent=firstPersonPose(shop,{kind:'worker'})?'2 号台 · 兼岗店员':'2 号台 · 雇用后可体验';
      for(const option of Array.from(choices.options))if(option.value&&!shop.state.customers.some(c=>String(c.id)===option.value))option.remove();
      for(const c of shop.state.customers){
        let option=Array.from(choices.options).find(o=>o.value===String(c.id));
        if(!option){option=document.createElement('option');option.value=String(c.id);choices.append(option);}
        option.textContent=`${customerName(c)} #${c.id} · ${customerActivity(shop,c)}`;
      }
      if(view.selectedCustomer!==lastSelected&&view.selectedCustomer!==null)choices.value=String(view.selectedCustomer);
      lastSelected=view.selectedCustomer;
      if(!choices.value&&shop.state.customers.length)choices.value=String(shop.state.customers[0].id);
      choices.disabled=!view.loaded||!shop.state.customers.length;
      choices.options[0].textContent=shop.state.customers.length?'选择一位顾客':'顾客进店后可选择';
      customer.disabled=choices.disabled||!choices.value;
      customer.setAttribute('aria-pressed',String(target?.kind==='customer'));
      const inspection=view.inspection;
      contextTarget=inspection?.kind==='customer'&&shell.panel==='guests'?{kind:'customer',id:inspection.id}:
        shell.panel==='staff'&&inspection?.kind==='worker'?{kind:'worker'}:
        shell.panel==='staff'&&inspection?.kind==='checkout'?{kind:inspection.station==='flex'?'worker':'cashier'}:null;
      context.hidden=active||!contextTarget;
      context.disabled=!view.loaded||!contextTarget||!firstPersonPose(shop,contextTarget);
      context.textContent=context.disabled?'角色就位后可进入第一视角':'进入他的第一视角';
      if(!target)return;
      let title='',activity='';
      if(target.kind==='customer'){
        const c=shop.state.customers.find(c=>c.id===target.id);
        title=c?`${customerName(c)} #${c.id}`:'这位街坊';
        activity=c?customerActivity(shop,c):'已离店，即将返回全景';
      }else if(target.kind==='cashier'){
        title='1 号台 · 店员';
        activity=shop.state.service===null?'等候街坊结账':'正在为顾客结账';
      }else{
        title='2 号台 · 兼岗店员';
        const d=shop.state.delivery;
        activity=d?({loading:'抱起货箱',walking:'搬运商品',stocking:'把商品放上货架',returning:'返回收银台'}[d.phase]):
          shop.state.helperService===null?'等候街坊结账':'正在为顾客结账';
      }
      $('#pov-title').textContent=title+'的视角';
      $('#pov-activity').textContent=(held?'已暂停 · ':'')+activity;
    },
  };
}
