import {Shop} from './sim.ts';
import {BusinessDay,DAY_TARGET} from './day.ts';
import {DAY_THEMES} from './day-themes.ts';
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
export type Panel='day'|'shelves'|'guests'|'staff'|'layout'|'manage';
const panels:Record<Panel,{title:string;icon:string}>={
  day:{title:'今日',icon:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'},
  shelves:{title:'货架',icon:'<path d="M4 3v18M20 3v18M4 10h16M4 19h16M7 5v3m4-3v3m5-3v3M7 13v4m5-4v4m5-4v4"/>'},
  guests:{title:'街坊',icon:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>'},
  staff:{title:'店员',icon:'<path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M8 5l9 5v4"/>'},
  layout:{title:'布局',icon:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11M15 3v7"/>'},
  manage:{title:'店务',icon:'<path d="M3 10V6l2-3h14l2 3v4M4 10v11h16V10M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 21v-6h6v6"/>'},
};
/** Move the existing controls once: no duplicate state, buttons, or event handlers. */
export class GameShell {
  panel:Panel|null=null;
  onClose=()=>{};
  onGoalReached=()=>{};
  private goalDay:BusinessDay|null=null;
  private goalComplete=0;
  customerDetail=false;
  private opener:HTMLElement|null=null;
  constructor(){
    const root=document.createElement('div');root.className='game-window';root.id='game-window';
    root.innerHTML=`
      <div class="game-hud">
        <button id="hud-day" class="hud-day" aria-controls="inspector"><span id="hud-phase">街角小店</span><strong id="hud-time"></strong></button>
        <div id="hud-wallet"><span id="hud-goal"></span></div>
        <div id="hud-actions"></div>
      </div>
      <div class="game-body">
        <div class="scene-area"></div>
        <aside id="inspector" aria-labelledby="inspector-title" hidden>
          <div class="inspector-heading"><div><small id="inspector-kicker">店铺手账</small><h2 id="inspector-title"></h2></div><div class="inspector-actions"><button id="inspector-size" class="quiet" aria-controls="inspector-scroll" aria-pressed="false">展开详情</button><button id="close-inspector" class="quiet" aria-label="关闭详情并返回全景">×</button></div></div>
          <button id="pov-context" hidden>进入他的第一视角</button>
          <div id="inspector-scroll">${(Object.keys(panels) as Panel[]).map(id=>`<section id="pane-${id}" class="inspector-pane" hidden></section>`).join('')}</div>
        </aside>
      </div>
      <div class="game-dock"><nav aria-label="店铺操作">${(Object.entries(panels) as [Panel,{title:string;icon:string}][]).map(([id,p])=>`<button data-panel="${id}" aria-controls="inspector" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.icon}</svg><span>${p.title}</span></button>`).join('')}</nav><div id="game-time-controls"></div></div>
      <div class="window-foot"><span>拖动旋转 · 点击物件近看 · 空白处 / Esc 返回</span><span id="window-status">准备开店</span></div>`;
    const find=(s:string)=>root.querySelector<HTMLElement>(s)!;
    const take=(s:string)=>{
      const node=document.querySelector<HTMLElement>(s)??root.querySelector<HTMLElement>(s);
      if(!node)throw Error('Missing game control: '+s);
      return node;
    };
    find('.scene-area').append($('#stage'));
    find('#hud-wallet').prepend(take('.wallet'));
    find('#hud-time').append($('#day-timer'),$('#clock'));
    find('#hud-actions').append($('#open-day'),$('#show-day-report'));
    find('#game-time-controls').append($('#pause'),take('#speed'));
    const move=(panel:Panel,...selectors:string[])=>selectors.forEach(s=>find('#pane-'+panel).append(take(s)));
    move('day','.heading','#day-panel','#day-invite','.goal-card','.insight','.log-panel');
    move('shelves','.stock-panel','#shelf-upgrade-panel');
    move('guests','.shopping-panel');
    move('staff','.restock-panel');
    find('.restock-panel').append($('[data-upgrade="staff"]'));
    move('layout','.layout-panel');
    move('manage','.upgrade-panel','#lab-banner','.learning');
    const all=document.createElement('button');all.id='all-guests';all.className='quiet';all.textContent='查看店内所有街坊';
    find('.shopping-panel').prepend(all);
    all.onclick=()=>{this.customerDetail=false;find('#pane-guests').classList.remove('one-guest');all.hidden=true;};
    all.hidden=true;
    $('main').replaceChildren(root);
    document.body.classList.add('windowed-game');
    $('#hud-day').onclick=()=>this.toggle('day');
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b=>b.onclick=()=>{this.opener=b;this.toggle(b.dataset.panel as Panel);});
    $('#close-inspector').onclick=()=>{this.close(true);this.onClose();};
    $('#inspector-size').onclick=()=>this.expandInspector(!root.classList.contains('inspector-expanded'));
    if(matchMedia('(pointer:coarse)').matches){
      root.querySelector('.window-foot>span')!.textContent='单指旋转 · 点选近看 · 全景返回';
      $('#scene-caption').textContent='点选近看 · 单指旋转 · 双指缩放 / 平移';
    }
    // Old deep links now open the corresponding in-window panel.
    const anchors:Record<string,Panel>={'#restock-title':'staff','#shopping-title':'guests','#layout-heading':'layout','#day-panel':'day'};
    if(anchors[location.hash])this.open(anchors[location.hash]);
    if(location.hash)history.replaceState(null,'',location.pathname+location.search);
    window.scrollTo(0,0);
  }
  toggle(panel:Panel){if(this.panel===panel){this.close();this.onClose();}else this.open(panel);}
  private expandInspector(expanded:boolean){
    $('#game-window').classList.toggle('inspector-expanded',expanded);
    $('#inspector-size').setAttribute('aria-pressed',String(expanded));
    $('#inspector-size').textContent=expanded?'收起详情':'展开详情';
  }
  open(panel:Panel,context=false){
    if(this.panel!==panel)this.expandInspector(false);
    this.panel=panel;$('#game-window').classList.add('has-inspector');$('#inspector').hidden=false;
    $('#inspector-title').textContent={day:'今天怎么经营？',shelves:'货架与商品',guests:'街坊的购物清单',staff:'店员与补货',layout:'店铺的摆法',manage:'让小店更好一点'}[panel];
    $('#inspector-kicker').textContent=context?'正在近看':'店铺手账';
    for(const id of Object.keys(panels))$('#pane-'+id).hidden=id!==panel;
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b=>{
      const active=b.dataset.panel===panel;b.classList.toggle('active',active);b.setAttribute('aria-expanded',String(active));
    });
    this.customerDetail=panel==='guests'&&context;
    $('#pane-guests').classList.toggle('one-guest',this.customerDetail);$('#all-guests').hidden=!this.customerDetail;
    $('#inspector-scroll').scrollTop=0;
  }
  close(restoreFocus=false){
    const focusInside=$('#inspector').contains(document.activeElement);
    if(focusInside)(restoreFocus?this.opener??$('#world'):$('#world')).focus({preventScroll:true});
    this.panel=null;$('#inspector').hidden=true;$('#game-window').classList.remove('has-inspector');
    this.expandInspector(false);
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-expanded','false');});
  }
  update(shop:Shop,day:BusinessDay|null,paused:boolean){
    const s=shop.state;
    $('#open-day').hidden=!day;$('#show-day-report').hidden=!day;
    $('#clock').hidden=!!day;$('#day-timer').hidden=!day;
    $('#hud-phase').textContent=day?`${DAY_THEMES[day.theme].name} · ${{preparing:'筹备',open:'营业中',closing:'收尾',settled:'已打烊'}[day.phase]}`:'自由经营';
    const complete=day?.visits.filter(v=>v.outcome==='complete').length??0,goal=$('#hud-goal');
    goal.textContent=day?`买齐 ${complete}/${DAY_TARGET}${complete>=DAY_TARGET?' ✓':''}`:`店内 ${s.customers.length} 位`;
    goal.setAttribute('role',day?'progressbar':'status');
    if(day){
      goal.setAttribute('aria-label','今日买齐目标');goal.setAttribute('aria-valuemin','0');
      goal.setAttribute('aria-valuemax',String(DAY_TARGET));goal.setAttribute('aria-valuenow',String(Math.min(complete,DAY_TARGET)));
      goal.setAttribute('aria-valuetext',`${complete} 位买齐，目标 ${DAY_TARGET} 位`);
    }
    goal.classList.toggle('goal-reached',!!day&&complete>=DAY_TARGET);
    if(day===this.goalDay&&this.goalComplete<DAY_TARGET&&complete>=DAY_TARGET)this.onGoalReached();
    this.goalDay=day;this.goalComplete=complete;
    $('#window-status').textContent=`${paused?'已暂停 · ':''}店内 ${s.customers.length} 位 · ${s.queue.length} 位等候结账`;
    $('#game-window').dataset.phase=day?.phase??'free';
    if(this.panel==='guests'&&this.customerDetail&&!document.querySelector('.customer-card.selected')){
      this.customerDetail=false;$('#pane-guests').classList.remove('one-guest');$('#all-guests').hidden=true;
      $('#inspector-kicker').textContent='这位街坊已离店';
    }
  }
}
