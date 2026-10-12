import {type Shop,type Customer,type ShoppingItem} from './sim.ts';
export const PRODUCT_SHORT={drinks:'饮料',bread:'面包',fruit:'水果'};
export const customerName=(c:Customer,combinedLabel='早餐客')=>c.kind==='breakfast'?combinedLabel:'顺路客';
export function itemMark(shop:Shop,c:Customer,item:ShoppingItem){
  if(item.status==='missing')return '×';
  if(item.status==='returned')return '↶';
  if(shop.itemVisible(c,item))return '✓';
  return c.product===item.product&&['shelfQueue','enter','browse','pickup'].includes(c.state)?'→':'○';
}
export function customerActivity(shop:Shop,c:Customer){
  if(shop.state.layoutChange)return '先让出位置';
  if(c.approach)return '返回操作位';
  const name=PRODUCT_SHORT[c.product];
  if(c.state==='leave')return c.happy?(c.shopping.some(i=>i.status==='missing')?'部分买到，带走结账商品':'买齐了，准备回家'):'空篮离店';
  if(c.state==='return'||c.state==='putback')return '放回'+name;
  if(c.state==='service'||c.state==='pay')return `${c.checkout==='flex'?'2':'1'}号台${c.state==='pay'?'付款':'结账'} · ${shop.basketTotal(c)} 币`;
  if(c.state==='toQueue'||c.state==='queue')return `${c.state==='toQueue'?'前往':'等候'}${c.checkout==='flex'?'2':'1'}号台 · 还可等 ${Math.max(0,Math.ceil((c.patience-shop.state.tick+c.queuedAt)/10))} 秒`;
  if(c.state==='pickup')return '拿取'+name;
  if(c.state==='browse')return '挑选'+name;
  return c.nav.blocked>3?'等前面让路':'去找'+name;
}
