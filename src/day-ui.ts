import {BusinessDay,DAY_TICKS,DAY_TARGET,type DayReport} from './day.ts';
import {PRODUCT_SHORT} from './shopping-ui.ts';
import {DAY_THEMES} from './day-themes.ts';
import {restockingReport,policyLabel} from './restocking-ui.ts';
import {admissionLabels,admissionPeriod,summarizeAdmissions,type AdmissionSummary} from './admission.ts';
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const money=(n:number)=>n.toLocaleString()+' 币',signed=(n:number)=>(n>0?'+':'')+n.toLocaleString();
const line=(label:string,value:string)=>`<div class="report-line"><span>${label}</span><b>${value}</b></div>`;
let shownAttempt=0;
export function resetDayReport(){shownAttempt=0;$<HTMLDialogElement>('#day-report').close();}
export function showDayReport(day:BusinessDay){
  if(day.phase!=='settled')return;
  const r=day.report(),previous=day.previousComparable();
  $('#day-report-title').textContent=r.complete>=DAY_TARGET?'街坊们，买齐了不少。':'这一天，值得再试一次。';
  $('#day-report-summary').textContent=`${DAY_THEMES[day.theme].name} · 第 ${r.attempt} 次尝试 · ${r.demand} 位街坊到店 · ${r.orders} 笔成交 / ${r.units} 件商品`;
  $('#day-report-metrics').innerHTML=[
    ['买齐清单',`${r.complete}<small> / ${r.demand} 人</small>`,`目标 ${DAY_TARGET} 人 · 来客买齐率 ${Math.round(r.completion*100)}%`],
    ['销售毛利',`${r.grossProfit}<small> 币</small>`,`收入 ${r.revenue} − 已售成本 ${r.cogs}`],
    ['现金增减',`${signed(r.cashChange)}<small> 币</small>`,`开局 ${r.startCash} → 打烊 ${r.endCash}`],
  ].map(([label,value,note])=>`<div><small>${label}</small><strong>${value}</strong><span>${note}</span></div>`).join('');
  $('#day-report-finance').innerHTML=[
    ['筹备前现金',money(r.startCash)],['销售收入','+'+money(r.revenue)],['采购支出（含筹备）','−'+money(r.procurement)],
    ['设施升级','−'+money(r.upgrades)],['货架解锁','−'+money(r.unlocks)],['打烊现金',money(r.endCash)],
    ['剩余库存 · 按进价',money(r.endInventory)],
  ].map(([a,b])=>line(a,b)).join('');
  $('#day-report-shopping').innerHTML=[
    ['买齐清单',`${r.complete} 人`],['部分买到',`${r.partial} 人`],['缺货空手离开',`${r.empty} 人`],
    ['排队超时放回商品',`${r.impatient} 人`],['未能入店',`${r.blocked} 人`],
  ].map(([a,b])=>line(a,b)).join('')+
    `<div class="report-products">${r.byProduct.filter(p=>p.wanted).map(p=>`<span>${PRODUCT_SHORT[p.product]}：想买 ${p.wanted} 人 · 售出 ${p.sold} 件 · 缺货 ${p.missing} 人</span>`).join('')}</div>`;
  $('#day-report-timing').textContent=`取货后等到收银：${r.waitSeconds===null?'暂无样本':r.waitSeconds.toFixed(1)+' 秒 / '+r.waitCount+' 人'}。营业后下单到上架：${r.deliverySeconds===null?'暂无样本':r.deliverySeconds.toFixed(1)+' 秒 / '+r.deliveryCount+' 批'}。收尾用时 ${r.closingSeconds.toFixed(1)} 秒。`;
  $('#day-report-feedback').replaceChildren(...r.feedback.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('#day-report-comparison').innerHTML=previous?comparison(previous,r):`<p class="report-note">${day.history.some(x=>x.attempt<day.attempt)||day.routingChangedAt?'店铺空间或经营规则已调整，旧规则或中途调整的轮次不作同条件比较。再重玩一次，可比较新规则下的结果。':'这是本主题的第一次尝试。重玩后与本主题上次结果比较，各主题分别保留最近 5 次结算。'}</p>`;
  $('#day-report-restocking').innerHTML=restockingReport(r.restocking);
  $('#day-report-admission').innerHTML=admissionReport(r.admission!);
  $('#day-report-periods').innerHTML=`<h3>哪一段最忙？</h3><div class="report-table-wrap"><table><thead><tr><th>到店时段</th><th>来客</th><th>买齐</th><th>未入店</th><th>久等离开</th><th>遇到缺货</th></tr></thead><tbody>${day.periods().map(p=>`<tr><th>${periodLabel(p.start)}</th><td>${p.demand}</td><td>${p.complete}</td><td>${p.blocked}</td><td>${p.impatient}</td><td>${p.missing}</td></tr>`).join('')}</tbody></table></div><p class="report-note">按顾客的到店时段分组，统计他们最终的购物结果，包含收尾期间完成的购物。遇到缺货可能仍买到其他商品，不与前几列相加。</p>`;
  $('#day-replay-copy').textContent=`恢复 ${r.startCash} 币、饮料 ${day.baseline.shelves.drinks.onHand} 件、面包 ${day.baseline.shelves.bread.onHand} 件和初始设施。每位顾客的到店时间与清单都不变；重新决定如何花钱、备货和摆放。`;
  $('#day-condition-id').textContent=`相同条件编号：${r.conditions}`;
  const dialog=$<HTMLDialogElement>('#day-report');if(!dialog.open)dialog.showModal();shownAttempt=day.attempt;
}
export function admissionBrief(a:AdmissionSummary){
  const parts=(['capacity','entrance','layout','unknown'] as const).filter(k=>a[k]).map(k=>`${admissionLabels[k]} ${a[k]} 位`);
  return parts.length?`未能入店：${parts.join(' · ')}。`:'目前到店的街坊都顺利入店。';
}
function admissionReport(a:AdmissionSummary){
  const reasons=(['capacity','entrance','layout','unknown'] as const).filter(k=>a[k]);
  if(!reasons.length)return '<h3>街坊都进店了吗？</h3><p>本轮没有未能入店的街坊。</p>';
  return `<h3>为什么没能进店？</h3><p>${admissionBrief(a)}</p><div class="report-table-wrap"><table><thead><tr><th>到店时段</th>${reasons.map(k=>`<th>${admissionLabels[k]}</th>`).join('')}</tr></thead><tbody>${a.periods.map(p=>`<tr><th>${admissionPeriod(p.start)}</th>${reasons.map(k=>`<td>${p[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="report-note">按到门口时实际触发的限制记录；同时发生时，依次记录布局调整、满员、入口受阻。满员说明当时店内人数达到上限，不代表已经确定拥堵原因。旧存档缺失的原因不作推测。</p>`;
}
function comparison(a:DayReport,b:DayReport){
  const complete=(r:DayReport)=>r.restocking?.since===0&&r.restocking.observedTicks===DAY_TICKS;
  const restockRows=['drinks','bread'].map(p=>{
    const key=p as 'drinks'|'bread',x=a.restocking?.stockoutTicks[key],y=b.restocking?.stockoutTicks[key];
    return `<tr><th>${PRODUCT_SHORT[key]}缺货秒数</th><td>${complete(a)?(x!/10).toFixed(1):'未完整记录'}</td><td>${complete(b)?(y!/10).toFixed(1):'未完整记录'}</td><td>${complete(a)&&complete(b)?signed(Math.round((y!-x!)/10*10)/10):'—'}</td></tr>`;
  }).join('');
  const policy=(r:DayReport)=>r.restocking?r.restocking.changes.length?`${policyLabel(r.restocking.changes.at(-1)!.policy)}（调整 ${r.restocking.changes.length} 次）`:policyLabel(r.restocking.initialPolicy):'旧记录';
  return `<h3>与本主题上一次相同条件相比</h3><div class="report-table-wrap"><table><thead><tr><th>观察项</th><th>第 ${a.attempt} 次</th><th>第 ${b.attempt} 次</th><th>变化</th></tr></thead><tbody>${
    [['完整清单',a.complete,b.complete],['销售毛利',a.grossProfit,b.grossProfit],['现金增减',a.cashChange,b.cashChange],
      ['采购支出',a.procurement,b.procurement],['设施升级',a.upgrades,b.upgrades],['未能入店',a.blocked,b.blocked]]
      .map(([label,x,y])=>`<tr><th>${label}</th><td>${x}</td><td>${y}</td><td>${signed(Number(y)-Number(x))}</td></tr>`).join('')
  }${restockRows}<tr><th>最后补货安排</th><td>${policy(a)}</td><td>${policy(b)}</td><td>见本轮记录</td></tr></tbody></table></div><p class="report-note">同时更改采购、布局或升级，也会影响结果。只改变补货策略时，才适合比较调度的效果。</p>`;
}
function periodLabel(start:number){return `${String(start/600).padStart(2,'0')}:00—${String(start/600+1).padStart(2,'0')}:00`;}
export function renderDay(day:BusinessDay,loaded:boolean,paused:boolean){
  const s=day.shop.state,r=day.report(),phase=day.phase;
  const theme=DAY_THEMES[day.theme];
  document.body.dataset.dayTheme=day.theme;$('#day-panel').style.setProperty('--theme-accent',theme.accent);
  document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b=>{
    const active=b.dataset.theme===day.theme;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
    b.disabled=!loaded||phase==='open'||phase==='closing';
  });
  const seconds=Math.ceil((DAY_TICKS-day.elapsed)/10);
  $('#day-timer').textContent=phase==='closing'?'收尾中':phase==='settled'?'已打烊':`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  $('#clock').textContent=`${Math.floor(day.elapsed/600).toString().padStart(2,'0')}:${(Math.floor(day.elapsed/10)%60).toString().padStart(2,'0')}`;
  $('#sold').innerHTML=`${r.orders}<span> 单</span>`;
  $('#multi-sales').textContent=(s.stats.multiSales-day.baseline.stats.multiSales)+' 单';
  $('#partial-sales').textContent=(s.stats.partialSales-day.baseline.stats.partialSales)+' 单';
  $('#missing-items').textContent=(s.stats.missingItems-day.baseline.stats.missingItems)+' 项次';
  $('#layout-wait').textContent=r.waitSeconds===null?'—':r.waitSeconds.toFixed(1)+' 秒';
  $('#layout-wait-samples').textContent=`今日 ${r.waitCount} 位顾客的平均值`;
  $('#layout-delivery').textContent=r.deliverySeconds===null?'—':r.deliverySeconds.toFixed(1)+' 秒';
  $('#layout-delivery-samples').textContent=`营业后 ${r.deliveryCount} 次补货的平均值`;
  $('#layout-loss').textContent=`${r.empty+r.impatient+r.blocked} 人`;
  $('#layout-period').textContent='今日累计 · 换布局不清零';
  $('#day-attempt').textContent=`${theme.name} · 第 ${day.attempt} 次尝试 · 相同客流`;
  $('#day-title').textContent={preparing:theme.subtitle,open:day.theme==='rush'&&day.elapsed>=600&&day.elapsed<1200?'高峰来了，照顾好队伍。':'今天的小店，由你经营。',closing:'最后几位街坊，也要照顾好。',settled:'今天打烊，明天有新想法。'}[phase];
  document.querySelectorAll<HTMLElement>('[data-phase]').forEach(el=>{el.classList.toggle('active',el.dataset.phase===phase);el.setAttribute('aria-current',el.dataset.phase===phase?'step':'false');});
  $('#day-progress-bar').style.width=`${day.elapsed/DAY_TICKS*100}%`;
  const bread=day.visits.filter(v=>v.kind==='breakfast').length;
  $('#day-description').textContent=phase==='preparing'?`起始 ${day.baseline.cash} 币；饮料 ${day.baseline.shelves.drinks.onHand} 件、面包 ${day.baseline.shelves.bread.onHand} 件。${theme.description}筹备不计入营业时间。`:
    phase==='open'?`${day.visits.filter(v=>v.outcome!=='planned').length} / ${day.visits.length} 位街坊已到店。照顾好库存和收银，3 分钟后停止迎客。${paused?'当前已暂停。':''}`:
    phase==='closing'?`已停止迎客和新采购。店内还剩 ${s.customers.length} 位顾客、${s.orders.length} 批待上架订单${s.delivery?.phase==='returning'?'，员工正在返回':''}，全部完成后结算。${paused?'点击“继续”完成收尾。':''}`:
    `完成 ${r.orders} 笔成交，销售毛利 ${r.grossProfit} 币。可以查看结算，再用相同起点试试另一种经营方式。`;
  const forecast=`<div class="forecast-products"><span>今日需求 <strong>${day.visits.length} 位街坊</strong></span><span>饮料 <b>${r.byProduct[0].wanted}</b> 件 · 面包 <b>${bread}</b> 件</span><small>合购 ${bread} 人 · 单买 ${day.visits.length-bread} 人</small></div><div class="forecast-periods">${day.periods().map(p=>`<div class="${day.elapsed>=p.start&&day.elapsed<p.end&&phase==='open'?'current':''}"><span>${periodLabel(p.start)}</span><div><i style="width:${p.demand/day.visits.length*100}%"></i></div><b>${p.demand} 人</b></div>`).join('')}</div>`;
  if($('#day-forecast').innerHTML!==forecast)$('#day-forecast').innerHTML=forecast;
  $('#day-advice').textContent=theme.advice;
  $('#theme-switch-note').textContent=phase==='open'||phase==='closing'?'本轮结束后可换主题；同一主题重玩保持相同来客。':'各主题独立保存；切换后可继续上次进度或查看结算。';
  $('#shopping-hint').textContent=`${theme.name}：${day.visits.length-bread} 位顺路客买饮料，${bread} 位合购客买饮料＋面包。缺货时仍可购买清单中的其他商品。`;
  $('#day-goal').textContent=`今日目标：${DAY_TARGET} 位街坊买齐清单 · 已完成 ${r.complete} 人`;
  let admission=document.querySelector<HTMLElement>('#day-admission');
  if(!admission){admission=document.createElement('p');admission.id='day-admission';admission.className='report-note';$('#day-goal').parentElement!.after(admission);}
  admission.textContent=admissionBrief(summarizeAdmissions(day.visits));
  admission.hidden=phase==='preparing';
  const open=$<HTMLButtonElement>('#open-day');open.classList.toggle('hidden',phase!=='preparing');open.disabled=!day.canOpen||!loaded;
  open.textContent=!loaded?'正在载入…':day.canOpen?'开门营业':paused?'待完成备货':'备货中…';
  $('#show-day-report').classList.toggle('hidden',phase!=='settled');
  const previous=day.previousComparable();
  $('#day-previous').textContent=previous?`本主题上次：买齐 ${previous.complete} 人 · 毛利 ${previous.grossProfit} 币 · 现金变化 ${signed(previous.cashChange)} 币。`:day.history.length?'收银与补货分工已调整；本轮开始记录新规则下的对照。':'同主题重玩固定到店时间与清单；招徕客流和水果暂不开放。';
  $<HTMLButtonElement>('[data-product="fruit"]').disabled=true;
  const marketing=$<HTMLButtonElement>('[data-upgrade="marketing"]');marketing.disabled=true;marketing.querySelector('small')!.textContent='本挑战保持客流固定';marketing.querySelector('b')!.textContent='固定客流';
  if(!day.canEdit)document.querySelectorAll<HTMLButtonElement>('#order,#upgrade-shelf,[data-upgrade],[data-layout]').forEach(b=>b.disabled=true);
  $<HTMLButtonElement>('#pause').disabled=phase==='settled';$<HTMLButtonElement>('#speed').disabled=phase==='settled';
  $('#selected-state').textContent={preparing:'筹备中',open:'营业中',closing:'收尾中',settled:'已打烊'}[phase];
  if(phase==='preparing')$('#order-note').textContent='筹备时手动备货，货款计入本轮。开门后补货帮手才会自动采购。';
  if(!day.canEdit){
    $('#order-note').textContent=phase==='closing'?'已停止新采购，已付款的订单会继续送到货架。':'今日已结算，同条件重玩后可以重新安排采购。';
    $('#layout-status').textContent='今日累计数据保留；可以在下一次筹备时换一种摆法，再比较经营结果。';
    $('#insight').textContent=phase==='closing'?'最后的顾客仍会正常购物、付款或归还商品；已付款补货也会完成。':'今天的选择已经记在结算里。换一个想法，用相同条件再试一次。';
  }
  $('#shopping-empty').textContent=phase==='settled'?'今天的街坊都已离店。打开结算，看看大家买得怎么样。':'开门后，第一位街坊很快就到。';
  if(phase==='settled'&&shownAttempt!==day.attempt)showDayReport(day);
}
