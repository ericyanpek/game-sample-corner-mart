import './guided-tour.css';
import type {BusinessDay} from './day.ts';
import {UPGRADE_COST,type Product} from './sim.ts';
import type {GameShell,Panel} from './game-shell.ts';
import type {ShopView,InspectTarget} from './view.ts';
import {restoreGuide,roundGuide,themeBriefing,guideOutcome,type GuideProgress,type GuideStep,type RoundGuidance} from './guided-tour-state.ts';
import {firstPersonPose,type FirstPersonTarget} from './first-person.ts';
import {admissionBrief} from './day-ui.ts';
import {GuideInputGate} from './guide-input.ts';

interface Bridge {
  day:()=>BusinessDay;selected:()=>Product;shell:GameShell;view:ShopView;
  inspect:(target:InspectTarget)=>void;save:()=>unknown;resume:()=>void;restart:()=>void;restartGuide:()=>void;replay:()=>unknown;paused:()=>boolean;
  enterFirstPerson:(target:FirstPersonTarget)=>boolean;togglePause:()=>void;
}
type Target={selector:string}|{scene:InspectTarget;click?:boolean};
type Mode='act'|'watch'|'ready'|'free';
const titles:Record<GuideStep,string>={
  welcome:'来当三分钟店长',forecast:'先看看，街坊想买什么',hire:'请一位会收银的补货帮手',
  restock:'先给面包架补一箱',upgrade:'让饮料架升级一次',open:'准备好了，开门营业',
  customer:'点一位街坊，看他的购物清单',checkout:'跟着这一篮商品，走到收银台',
  layout:'换个摆法，观察路线',dispatch:'下一箱，听你的安排',finish:'余下的营业时间，由你经营',
  report:'打烊了，看看你的经营结果',done:'想试试另一种经营方式吗？',skipped:'自由探索这家小店',
  briefing:'换个主题，试试你的安排',
};
const chapters:Partial<Record<GuideStep,number>>={hire:1,restock:1,open:2,customer:3,checkout:3,finish:4};

export class GuidedTour {
  progress:GuideProgress;
  holdsClock=true;
  private mode:Mode='act';
  private target:Target|null=null;
  private povTarget:FirstPersonTarget|null=null;
  private lastKey='';
  private lastScroll='';
  private card:HTMLElement;
  private halo:HTMLElement;
  private point:HTMLButtonElement;
  private next:HTMLButtonElement;
  private sceneHit:HTMLButtonElement;
  private pause:HTMLButtonElement;
  private pov:HTMLButtonElement;
  private overview:HTMLButtonElement;
  private gate:GuideInputGate;
  private skip:HTMLButtonElement;
  private fold:HTMLButtonElement;
  private details:HTMLElement;
  private status:HTMLElement;
  private title:HTMLElement;
  private banner:HTMLElement;
  private reportAttempt=0;
  constructor(private bridge:Bridge,saved:unknown){
    this.progress=restoreGuide(saved,bridge.day());
    document.body.classList.add('guided');
    document.title='街角便利店 · Corner Mart';
    document.querySelector('.brand>span:last-child')!.innerHTML='街角便利店<small>CORNER MART · 一间店，一点好生意</small>';
    document.querySelector('.brand')!.setAttribute('href',location.pathname);
    document.querySelector('footer')!.innerHTML='你安排小店，街坊们把结果带回来。<span>GPT-6 ASTRA × BLENDER</span>';
    document.querySelector('#lab-banner span')!.textContent='新手引导 · 380 币 · 饮料、面包各 12 件 · 营业 3 分钟';
    document.querySelector('#lab-banner a')!.remove();
    this.card=document.createElement('section');this.card.id='tour-coach';
    this.card.setAttribute('aria-labelledby','coach-title');
    this.card.innerHTML=`<div class="coach-number" aria-hidden="true">01</div><div class="coach-copy"><div class="coach-meta"><span id="coach-status"></span><span id="coach-clock-note"></span></div><h2 id="coach-title"></h2><p id="coach-description"></p></div><div class="coach-actions"><button id="coach-next" class="primary">开始引导</button><button id="coach-pov" class="primary" hidden>进入第一视角</button><button id="coach-overview" class="quiet" hidden>回到全景继续看</button><button id="coach-pause" class="quiet" hidden>暂停观察</button><button id="coach-fold" class="quiet" aria-controls="coach-description" aria-expanded="true">收起说明</button><button id="coach-skip" class="quiet">跳过引导，自由经营</button></div>`;
    document.querySelector('.game-window')!.insertBefore(this.card,document.querySelector('.game-dock'));
    this.title=this.card.querySelector('#coach-title')!;
    this.details=this.card.querySelector('#coach-description')!;
    this.details.setAttribute('aria-live','polite');this.details.setAttribute('aria-atomic','true');
    this.status=this.card.querySelector('#coach-status')!;
    this.next=this.card.querySelector('#coach-next')!;
    this.pause=this.card.querySelector('#coach-pause')!;
    this.pause.onclick=()=>this.bridge.togglePause();
    this.pov=this.card.querySelector('#coach-pov')!;
    this.pov.onclick=()=>this.enterPov();
    this.overview=this.card.querySelector('#coach-overview')!;
    this.overview.onclick=()=>{
      this.bridge.view.reset();this.bridge.shell.close();this.update();
    };
    this.skip=this.card.querySelector('#coach-skip')!;
    this.fold=this.card.querySelector('#coach-fold')!;
    this.fold.onclick=()=>this.foldDetails(!this.card.classList.contains('coach-collapsed'));
    this.halo=document.createElement('div');this.halo.id='coach-halo';this.halo.setAttribute('aria-hidden','true');
    this.point=document.createElement('button');this.point.id='coach-point';this.point.hidden=true;
    this.point.onclick=()=>{if(this.target&&'scene' in this.target)this.bridge.inspect(this.target.scene);};
    this.sceneHit=document.createElement('button');this.sceneHit.id='coach-scene-hit';this.sceneHit.hidden=true;
    this.sceneHit.setAttribute('aria-label','选择高亮的这位街坊');
    this.sceneHit.onclick=()=>{if(this.target&&'scene' in this.target)this.bridge.inspect(this.target.scene);};
    document.body.append(this.halo,this.point,this.sceneHit);
    this.gate=new GuideInputGate(()=>this.skipTour());
    this.next.onclick=()=>this.nextStep();
    this.skip.onclick=()=>this.skipTour();
    const controls=document.createElement('div');controls.className='tour-tools';
    controls.innerHTML='<button id="tour-guide" class="quiet">新手引导</button><button id="tour-reset" class="quiet">从头再来</button>';
    document.querySelector('.top-actions')!.prepend(controls);
    controls.querySelector('#tour-guide')!.addEventListener('click',()=>{
      if(this.bridge.day().phase==='preparing'){this.reset();this.bridge.resume();this.bridge.save();}
      else if(confirm('重新开始引导会重置本轮进度，保留历史成绩和其他主题。继续吗？'))this.bridge.restartGuide();
    });
    controls.querySelector('#tour-reset')!.addEventListener('click',()=>{
      this.bridge.restart();
    });
    this.banner=document.createElement('section');this.banner.id='tour-result';
    document.querySelector('#day-report-summary')!.after(this.banner);
    const more=document.createElement('button');more.id='tour-more';more.className='quiet';more.textContent='展开完整经营账目与分析';
    document.querySelector('#day-report-metrics')!.after(more);
    more.onclick=()=>{const expanded=document.querySelector('#day-report')!.classList.toggle('tour-expanded');more.textContent=expanded?'收起详细分析':'展开完整经营账目与分析';more.setAttribute('aria-expanded',String(expanded));};
    this.update();
  }
  snapshot(){return structuredClone(this.progress);}
  private foldDetails(collapsed:boolean){
    this.card.classList.toggle('coach-collapsed',collapsed);
    this.fold.setAttribute('aria-expanded',String(!collapsed));
    this.fold.textContent=collapsed?'展开说明':'收起说明';
  }
  describe(){return {mode:this.mode,target:this.target,povTarget:this.povTarget,locked:this.locked};}
  get locked(){return !['skipped','done','briefing'].includes(this.progress.step)&&this.bridge.day().phase!=='settled';}
  allowsControl(selector:string){return !this.locked||this.mode==='act'&&this.target!==null&&'selector' in this.target&&this.target.selector===selector;}
  allowsAction(kind:string,key:string){
    if(!this.locked)return true;
    return kind==='upgrade'&&key==='staff'&&this.allowsControl('[data-upgrade="staff"]')||
      kind==='order'&&key==='bread'&&this.bridge.selected()==='bread'&&this.allowsControl('#order');
  }
  allowsInspect(target:InspectTarget){
    return !this.locked||this.mode==='act'&&this.target!==null&&'scene' in this.target&&
      target.kind==='customer'&&this.target.scene.kind==='customer'&&target.id===this.target.scene.id;
  }
  allowsFirstPerson(target:FirstPersonTarget){
    const expected=this.povTarget;
    return !this.locked||!this.pov.hidden&&!!expected&&target.kind===expected.kind&&
      (target.kind!=='customer'||expected.kind==='customer'&&target.id===expected.id);
  }
  private enterPov(){
    const target=this.povTarget,step=this.progress.step;
    if(!target||!this.allowsFirstPerson(target)||!['restock','checkout'].includes(step))return;
    const lesson=step as 'restock'|'checkout',previous=this.progress.pov[lesson];
    // The bridge renders synchronously; mark entry first so it cannot re-offer the gate.
    this.progress.pov[lesson]=true;
    if(this.bridge.enterFirstPerson(target))this.bridge.resume();
    else this.progress.pov[lesson]=previous;
    this.update();this.bridge.save();
  }
  reset(mode:RoundGuidance='guided'){
    this.progress=roundGuide(this.bridge.day(),mode);this.lastKey='';this.lastScroll='';this.reportAttempt=0;
    this.bridge.shell.close();this.bridge.view.reset();this.holdsClock=true;this.update();
  }
  dismissBriefing(){
    if(this.progress.step!=='briefing')return;
    this.progress.step='skipped';this.update();
  }
  private enter(step:GuideStep){
    if(!this.progress.completed.includes(this.progress.step)&&this.progress.step!=='welcome')this.progress.completed.push(this.progress.step);
    this.progress.step=step;
    if(step==='open'||step==='finish'){this.bridge.view.reset();this.bridge.shell.close();}
    if(step==='restock')this.progress.receivedBefore=this.bridge.day().shop.state.shelves.bread.received;
    if(step==='customer')this.progress.customerId=null;
    this.lastKey='';this.lastScroll='';this.bridge.save();
  }
  private nextStep(){
    const step=this.progress.step;
    if(step==='briefing'){this.skipTour();return;}
    if(step==='welcome'){this.enter('hire');this.bridge.resume();this.update();return;}
    if(step==='finish'){this.enter('done');this.skipTour(true);return;}
    if(step==='hire'&&this.bridge.day().shop.state.cash<UPGRADE_COST.staff){this.enter('restock');this.update();return;}
    if(step==='restock'&&this.bridge.day().shop.orderQuote('bread').quantity===0){this.enter('open');this.update();return;}
    if(step==='customer'&&this.target&&'scene' in this.target)this.bridge.inspect(this.target.scene);
  }
  private skipTour(completed=false){
    this.progress.step=completed?'done':'skipped';this.holdsClock=false;this.target=null;this.bridge.resume();
    this.bridge.view.reset();this.bridge.shell.close();this.update();this.bridge.save();
  }
  private inPanel(panel:Panel,target:string):Target {
    return {selector:this.bridge.shell.panel===panel?target:`[data-panel="${panel}"]`};
  }
  private shelfAction(product:Product,selector:string):Target {
    return this.inPanel('shelves',this.bridge.selected()===product?selector:`[data-product="${product}"]`);
  }
  update(){
    const day=this.bridge.day(),s=day.shop.state,p=this.progress;
    this.povTarget=null;this.pov.hidden=true;this.overview.hidden=true;
    if(day.phase==='settled'){this.showReport();return;}
    if(p.step==='skipped'||p.step==='done'){
      this.card.hidden=true;document.querySelector('.game-window')!.classList.remove('guide-visible');
      this.holdsClock=false;this.target=null;this.mode='free';this.position();return;
    }
    if(p.step==='briefing'){
      const brief=themeBriefing(day);this.render('free',brief.text,null);this.title.textContent=brief.title;return;
    }
    if(day.phase==='closing'){
      this.render('watch','已停止迎客，等最后的顾客结账和已付款的补货送达，就能查看今天的成绩。',null);
      this.title.textContent='正在收尾';return;
    }
    let mode:Mode='act',text='',target:Target|null=null;
    switch(p.step){
      case 'welcome':
        text='目标：让 20 位街坊买齐清单。先备货、再开门；从店员和顾客的第一视角看懂补货、结账，就交给你经营。只点发光目标，随时可退出。';
        target={selector:'#coach-next'};break;
      case 'hire':
        if(s.upgrades.staff){this.enter('restock');this.update();return;}
        if(s.cash<UPGRADE_COST.staff){text='预算暂时不够雇人，先用现有店员和库存经营。';target={selector:'#coach-next'};break;}
        target=this.inPanel('staff','[data-upgrade="staff"]');
        text=this.bridge.shell.panel==='staff'?'请这位兼岗店员（70 币）：闲时帮你收银，有货时帮你搬。下一步给面包架备货。':'先点「店员」，请一位收银、补货都能做的帮手。';break;
      case 'restock': {
        const pending=s.orders.some(o=>o.product==='bread')||s.delivery?.product==='bread';
        if(guideOutcome('restock',day,p)||!pending&&s.shelves.bread.onHand>=day.shop.capacity('bread')){this.enter('open');this.update();return;}
        else if(pending){
          if(firstPersonPose(day.shop,{kind:'worker'}))this.povTarget={kind:'worker'};
          const firstPerson=this.bridge.view.firstPersonTarget?.kind==='worker';
          if(this.povTarget&&!p.pov.restock){
            target={selector:'#coach-pov'};
            text='钱已付好。点「店员第一视角」，跟着 2 号店员抱箱、走到面包架，把这箱货上架。';
          }else{
            mode='watch';target=firstPerson?null:{scene:{kind:'shelf',product:'bread'}};
            text=firstPerson?'你正在跟着 2 号店员补货。看前方的面包架：上架后库存才增加，完成后自动回全景。随时可回到全景继续看。':
              '看面包架：店员把这一箱送到，库存才增加。送达后自动继续；也可再进入店员视角。';
          }
        }
        else if(!day.shop.orderQuote('bread').quantity){target={selector:'#coach-next'};text='当前无法再进面包，先用现有库存开门。营业后赚到钱，还可以手动补货。';}
        else{
          target=this.shelfAction('bread','#order');
          text=this.bridge.shell.panel!=='shelves'?'帮手就位了。点「货架」，给接下来买早餐的街坊准备面包。':
            this.bridge.selected()!=='bread'?'点「面包」，看看库存和进货按钮。':
            `现在有 ${s.shelves.bread.onHand} 件面包，今天有 ${day.visits.filter(v=>v.products.includes('bread')).length} 位街坊想买。点「补货」，先备 ${day.shop.orderQuote('bread').quantity} 件。`;
        }break;
      }
      case 'open':
        if(day.phase==='open'){this.enter('customer');this.update();return;}
        mode=day.canOpen?'act':'watch';target=day.canOpen?{selector:'#open-day'}:{scene:{kind:'checkout',station:'flex'}};
        text=day.canOpen?`面包已备好 ${s.shelves.bread.onHand} 件。点「开门营业」，三分钟营业现在才开始。`:'货已上架，等店员回到岗位就能开门。';break;
      case 'customer': {
        let customer=s.customers.find(c=>c.id===p.customerId&&c.state!=='leave');
        if(!customer){customer=s.customers.find(c=>c.kind==='breakfast'&&c.state!=='leave')??s.customers.find(c=>c.state!=='leave');p.customerId=customer?.id??null;}
        if(!customer){mode='watch';text='店开了，第一位街坊正在路上。出现发光框后，点他看购物清单。';}
        else if(this.bridge.view.selectedCustomer===customer.id&&this.bridge.view.inspection?.kind==='customer'){
          this.enter('checkout');this.update();return;
        }else {target={scene:{kind:'customer',id:customer.id},click:true};text='点框里的这位街坊，看看他要买什么。顾客会自己找货、拿货和排队，不用逐个操作。';}break;
      }
      case 'checkout': {
        if(guideOutcome('checkout',day,p)){this.enter('finish');this.update();return;}
        const customer=s.customers.find(c=>c.id===p.customerId);
        mode='watch';target=customer?{scene:{kind:'customer',id:customer.id}}:null;
        const atCheckout=customer&&['toQueue','queue','service','pay'].includes(customer.state);
        if(atCheckout){
          this.povTarget={kind:'customer',id:customer.id};
          const firstPerson=this.bridge.view.firstPersonTarget?.kind==='customer';
          if(!p.pov.checkout){
            mode='act';target={selector:'#coach-pov'};
            text='这位街坊准备结账了。点「顾客第一视角」，跟他走到柜台，看排队和付款。';
          }else{
            target=firstPerson?null:target;
            text=firstPerson?'你正从这位街坊的眼睛看柜台。顾客自动排队、付款，钱到账后回全景看结果。随时可回到全景继续看。':
              '看这位街坊排队、付款，现金和买齐人数随真实结果更新。也可再进入顾客视角。';
          }
        }else text=`清单里要${customer?.shopping.map(i=>i.product==='bread'?'面包':'饮料').join('和')??'商品'}。看他把货放进篮子；准备结账时，再从他的眼睛看柜台。`;
        break;
      }
      case 'finish': {
        target={selector:'#coach-next'};
        const receipt=s.receipts.find(r=>r.customer===p.customerId);
        text=(receipt?`这位街坊买了 ${receipt.lines.length} 件，付了 ${receipt.amount} 币。`:'这位街坊的购物结果已记下。')+
          '现在轮到你：少货就补，钱够再升级。目标是 20 位买齐；布局和第一视角也可自己探索。';break;
      }
      default:this.enter(day.phase==='preparing'?'hire':'finish');this.update();return;
    }
    this.render(mode,text,target);
  }
  private render(mode:Mode,text:string,target:Target|null){
    this.card.hidden=false;document.querySelector('.game-window')!.classList.add('guide-visible');
    this.mode=mode;this.target=target;this.holdsClock=mode==='act';
    this.next.disabled=!this.bridge.view.loaded;
    const firstPerson=!!this.bridge.view.firstPersonTarget,povGate=target&&'selector' in target&&target.selector==='#coach-pov';
    this.pov.hidden=!this.povTarget||firstPerson;this.pov.disabled=!this.bridge.view.loaded;
    this.pov.className=povGate?'primary':'quiet';
    this.pov.textContent=this.povTarget?.kind==='worker'?(povGate?'店员第一视角 →':'再看店员视角'):(povGate?'顾客第一视角 →':'再看顾客视角');
    this.overview.hidden=!firstPerson;
    this.pause.hidden=mode!=='watch';this.pause.textContent=this.bridge.paused()?'继续观察':'暂停观察';
    this.card.querySelector('#coach-clock-note')!.textContent=mode==='free'?'自主经营':this.holdsClock?'只点发光目标 · 阅读时暂停':this.bridge.paused()?'已暂停 · 点继续观察':'观察中 · 完成后自动继续';
    const step=this.progress.step,key=JSON.stringify([step,mode,text,target]);
    if(key!==this.lastKey){
      this.foldDetails(false);this.lastKey=key;this.card.dataset.step=step;this.card.dataset.mode=mode;
      this.card.querySelector('.coach-number')!.textContent=step==='briefing'?'☀':step==='welcome'?'↗':String(chapters[step]??4).padStart(2,'0');
      this.status.textContent=step==='briefing'?'主题提示 · 自主经营':step==='welcome'?'三分钟店长 · 学会怎么玩':`${chapters[step]??4} / 4 · ${{act:'跟着做',watch:'看结果',ready:'看结果',free:'自己经营'}[mode]}`;
      this.title.textContent=({welcome:'先学会做一笔生意',hire:'1 · 请帮手，备好货',restock:'1 · 给面包架备货',open:'2 · 开门迎客',customer:'3 · 看懂一张购物清单',checkout:'3 · 看懂一笔交易',finish:'4 · 现在由你经营'} as Partial<Record<GuideStep,string>>)[step]??titles[step];
      if(this.povTarget)this.title.textContent=this.povTarget.kind==='worker'?'1 · 跟店员去补货':'3 · 跟顾客排队结账';
      this.details.textContent=text;
      this.next.hidden=step!=='briefing'&&!(target&&'selector' in target&&target.selector==='#coach-next');
      this.next.textContent=step==='briefing'?(this.bridge.day().phase==='preparing'?'知道了，自己备货':'继续这一轮'):step==='welcome'?'开始备货 →':step==='finish'?'我会玩了，自己经营 →':'用现有条件继续 →';
      this.skip.hidden=step==='briefing';this.skip.textContent='退出引导，自己玩';
    }
    this.position();
  }
  private syncInput(){
    if(this.locked){
      const cameraPanel=document.querySelector<HTMLElement>('#camera-panel')!;
      if(!cameraPanel.hidden){
        cameraPanel.hidden=true;
        document.querySelector('#camera-toggle')!.setAttribute('aria-expanded','false');
      }
    }
    const allowed=['#coach-skip','#coach-fold','#coach-pause','#coach-pov','#coach-overview','#loading-retry','#sound-toggle'];
    if(this.mode==='act'&&this.target){
      if('selector' in this.target)allowed.unshift(this.target.selector);
      else allowed.unshift('#coach-scene-hit','#coach-point','#coach-next');
    }
    this.gate.update(this.locked,allowed);this.bridge.view.setGuidedInput(this.locked);
  }
  position(){
    this.sceneHit.hidden=true;
    if(!this.target||this.card.hidden||this.bridge.day().phase==='settled'){this.halo.hidden=true;this.point.hidden=true;this.syncInput();return;}
    const watching=this.mode!=='act';let rect:DOMRect|{left:number;top:number;width:number;height:number}|null=null;
    let sceneFrame=false;
    this.card.classList.remove('needs-overview');
    if('selector' in this.target){
      sceneFrame=this.target.selector==='#world';
      const element=document.querySelector<HTMLElement>(this.target.selector);
      if(element&&element.getClientRects().length){
        const scroll=document.querySelector('#inspector-scroll');
        if(scroll?.contains(element)){
          const r=element.getBoundingClientRect(),s=scroll.getBoundingClientRect();
          const scrollKey=this.target.selector+':'+Math.round(s.height);
          if((r.top<s.top+8||r.bottom>s.bottom-8)&&this.lastScroll!==scrollKey){
            scroll.scrollTop+=r.top-s.top-18;this.lastScroll=scrollKey;
          }
        }
        rect=element.getBoundingClientRect();
        if(scroll?.contains(element)){
          const s=scroll.getBoundingClientRect(),left=Math.max(rect.left,s.left+7),top=Math.max(rect.top,s.top+7);
          const right=Math.min(rect.left+rect.width,s.right-7),bottom=Math.min(rect.top+rect.height,s.bottom-7);
          rect=right>left&&bottom>top?{left,top,width:right-left,height:bottom-top}:null;
        }
      }
      this.point.hidden=true;
    }else {
      const point=this.bridge.view.screenTarget(this.target.scene);
      if(point){
        const viewport=point.viewport??{left:0,top:0,right:innerWidth,bottom:innerHeight};
        const bounds=point.bounds??{left:point.x-55,top:point.y-65,width:110,height:130};
        const left=Math.max(viewport.left+12,bounds.left-16),top=Math.max(viewport.top+12,bounds.top-16);
        const right=Math.min(viewport.right-12,bounds.left+bounds.width+16),bottom=Math.min(viewport.bottom-12,bounds.top+bounds.height+16);
        rect={left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};sceneFrame=true;
        this.point.hidden=this.mode!=='act';
        const label='点这位街坊';
        if(this.point.textContent!==label)this.point.textContent=label;
        this.point.dataset.mode=watching?'watch':'act';
        const width=this.point.offsetWidth||170,height=this.point.offsetHeight||38,gap=17;
        const centerX=Math.max(viewport.left+12,Math.min(point.x-width/2,viewport.right-width-12));
        const centerY=Math.max(viewport.top+12,Math.min(point.y-height/2,viewport.bottom-height-12));
        const placements=[
          {side:'above',left:centerX,top:top-height-gap},
          {side:'below',left:centerX,top:bottom+gap},
          {side:'right',left:right+gap,top:centerY},
          {side:'left',left:left-width-gap,top:centerY},
        ];
        const placement=placements.find(p=>p.left>=viewport.left+12&&p.top>=viewport.top+12&&p.left+width<=viewport.right-12&&p.top+height<=viewport.bottom-12);
        // At extreme zoom, keep the transparent frame and bottom guide instead of covering the object.
        this.point.hidden=this.mode!=='act'||!placement;
        if(this.mode==='act'){
          const hitVisible=rect.width>=12&&rect.height>=12;
          this.next.hidden=hitVisible||!!placement;this.sceneHit.hidden=!hitVisible;
          Object.assign(this.sceneHit.style,{left:`${left}px`,top:`${top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
          if(!this.next.hidden){this.next.textContent='查看这位街坊 →';rect=this.next.getBoundingClientRect();sceneFrame=false;}
        }
        if(placement){this.point.dataset.side=placement.side;this.point.style.left=`${placement.left}px`;this.point.style.top=`${placement.top}px`;}
      }else {
        this.point.hidden=true;
        if(this.bridge.view.loaded&&this.mode==='act'){this.next.hidden=false;this.next.textContent='查看这位街坊 →';rect=this.next.getBoundingClientRect();}
      }
    }
    this.halo.hidden=!rect;
    if(rect){
      const padding=sceneFrame?0:7;
      Object.assign(this.halo.style,{left:`${rect.left-padding}px`,top:`${rect.top-padding}px`,width:`${rect.width+padding*2}px`,height:`${rect.height+padding*2}px`});
      this.halo.dataset.mode=watching?'watch':'act';this.halo.dataset.kind=sceneFrame?'scene':'control';
    }
    this.syncInput();
  }
  private showReport(){
    const day=this.bridge.day();this.holdsClock=false;this.card.hidden=true;this.target=null;this.position();
    if(this.bridge.view.firstPersonTarget)this.bridge.view.reset();
    document.querySelector('.game-window')!.classList.remove('guide-visible');
    if(this.reportAttempt===day.attempt)return;
    this.reportAttempt=day.attempt;
    const r=day.report();
    this.progress.step='done';
    this.banner.innerHTML=`<span class="tour-result-tag">这一轮，真实结算</span><h3>先看买齐人数，再看钱花在哪里。</h3><p>${r.complete} 位街坊买齐了清单，${r.partial} 位只买到一部分。销售毛利 ${r.grossProfit} 币；采购与升级还会影响手头现金。</p><p>${admissionBrief(r.admission!)}展开分析可查看发生时段。</p><div class="visitor-reset-actions"><button id="tour-replay" class="primary">保留成绩，同条件重玩 ↻</button><button id="tour-restart" class="quiet">清空进度，从头再来 →</button></div>`;
    this.banner.querySelector<HTMLButtonElement>('#tour-replay')!.onclick=()=>this.bridge.replay();
    this.banner.querySelector<HTMLButtonElement>('#tour-restart')!.onclick=()=>this.bridge.restart();
    document.querySelector('#day-report')!.classList.remove('tour-expanded');
    document.querySelector('#tour-more')!.textContent='展开完整经营账目与分析';
    document.querySelector('#tour-more')!.setAttribute('aria-expanded','false');
    this.bridge.save();
  }
}
