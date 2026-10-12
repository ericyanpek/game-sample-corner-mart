import {Shop,PRODUCT_IDS,RESTOCK_POLICIES,type RestockPolicy} from './sim.ts';
import {PRODUCT_SHORT} from './shopping-ui.ts';
import type {BusinessDay,RestockingStats} from './day.ts';
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
export const policyLabel=(p:RestockPolicy|'fifo')=>p==='fifo'?'按下单顺序':RESTOCK_POLICIES[p];
const clock=(tick:number)=>`${String(Math.floor(tick/600)).padStart(2,'0')}:${String(Math.floor(tick/10)%60).padStart(2,'0')}`;
export function renderRestocking(shop:Shop,day:BusinessDay|null,loaded:boolean){
  const s=shop.state,d=s.delivery,pending=shop.pendingOrders(),p=s.restockPolicy;
  const status=(['main','flex'] as const).map(id=>shop.checkoutStatus(id));
  const statusHTML=status.map(v=>`<div class="checkout-status-card" data-station="${v.id}" data-status="${v.state}"><strong>${v.id==='main'?'1':'2'}号收银台 <b>${v.text}</b></strong><span>${v.detail} · ${v.waiting} 位顾客</span></div>`).join('')+'<p>同一位兼岗店员：先结完手上这一单，再去补货；送完返回2号台。等待的街坊转到1号台，排队时间继续计算。</p>';
  if($('#checkout-status-panel').innerHTML!==statusHTML)$('#checkout-status-panel').innerHTML=statusHTML;
  document.querySelectorAll<HTMLButtonElement>('[data-restock-policy]').forEach(b=>{
    const active=b.dataset.restockPolicy===p;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
    b.disabled=!loaded||!!day&&!day.canEdit;
  });
  $('#restock-policy-name').textContent=p?RESTOCK_POLICIES[p]:'沿用原安排 · 按下单顺序';
  $('#restock-current').textContent=d?d.phase==='returning'?'这一箱已送达，返回2号台':`${PRODUCT_SHORT[d.product]} ${d.quantity} 件 · ${{loading:'正在抱箱',walking:'送往货架',stocking:'正在上架'}[d.phase]}`:s.orders.length?s.helperService!==null?'结完手上这一单后取箱':'准备取下一箱':s.upgrades.staff?'在2号台收银待命':'2号台等待兼岗店员';
  $('#restock-current-card').dataset.goods=d&&d.phase!=='returning'?d.product:'idle';
  const next=pending[0];
  $('#restock-next').textContent=next?`${PRODUCT_SHORT[next.product]} ${next.quantity} 件 · 已付款`:'暂无待搬订单';
  $('#restock-next-card').dataset.goods=next?.product??'idle';
  $('#restock-queue').textContent=pending.length>1?'随后：'+pending.slice(1).map(o=>`${PRODUCT_SHORT[o.product]} ${o.quantity} 件`).join(' → '):'手上这一箱先送完；待搬顺序随库存与策略更新。';
  $('#restock-help').textContent=day&&!day.canEdit?'本轮安排已结束，已付款货物会完成配送。下一轮可重新选择策略。':
    (day?.phase==='preparing'?'筹备时手动采购；兼岗店员平时在2号台收银，营业中可自动进货。':s.upgrades.staff?'兼岗店员在可售库存 ≤ 6 件时自动进货，完成当前结账后暂停2号台并去补货。':'手动采购也按策略搬运；请一位兼岗店员后，可开2号台并在低库存时自动进货。')+
    (p==='shortage'?' 优先可售件数最少的商品。':p?' 优先所选商品，其余按可售件数从少到多安排。':' 选择策略即可采用新的安排。');
  const stats=day?.restocking;
  $('#restock-stockouts').textContent=stats?`营业缺货累计：饮料 ${(stats.stockoutTicks.drinks/10).toFixed(1)} 秒 · 面包 ${(stats.stockoutTicks.bread/10).toFixed(1)} 秒${stats.since?'（从 '+clock(stats.since)+' 起统计）':''}`:day?'这份旧进度未记录缺货时长；选择策略后开始统计，或同条件重玩记录整轮。':'营业日挑战会记录缺货时长，结算后可比较调度效果。';
}
export function restockingReport(stats?:RestockingStats){
  if(!stats)return '<h3>补货安排与缺货时长</h3><p class="report-note">旧结算未记录缺货时长。同条件重玩后可记录整轮数据。</p>';
  const choices=[`${clock(stats.since)} ${policyLabel(stats.initialPolicy)}`,...stats.changes.map(c=>`${clock(c.at)} ${policyLabel(c.policy)}`)];
  return `<h3>补货安排与缺货时长</h3><p class="report-note">${choices.join(' → ')}</p><div class="report-products">${PRODUCT_IDS.filter(p=>p!=='fruit').map(p=>`<span>${PRODUCT_SHORT[p]}无可售库存：<b>${(stats.stockoutTicks[p]/10).toFixed(1)} 秒</b></span>`).join('')}</div><p class="report-note">统计营业期间可售库存为 0 的时间，已被顾客预留的商品不再可售；不计筹备与收尾。已记录 ${(stats.observedTicks/10).toFixed(1)} / 180 秒${stats.since?'，旧进度此前的时长未知':''}。同一时刻两种商品都可能缺货，时长不相加。</p>`;
}
