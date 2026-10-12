import SPEC from '../assets/specs/layouts.json';
import SHELF from '../assets/specs/drink-shelves.json';
import CHECKOUT_SPEC from '../assets/specs/checkouts.json';
export {CHECKOUT_SPEC};
export type CheckoutId=keyof typeof CHECKOUT_SPEC.stations;
export {SPEC as LAYOUT_SPEC};
export type Point=[number,number];
export type LayoutId=keyof typeof SPEC.presets;
export type Product='drinks'|'bread'|'fruit';
export interface Pose {position:number[];yaw:number}
export interface Body {pos:Point;id:number}
export interface NavMotion {
  path:Point[];goal:Point|null;blocked:number;moving:boolean;waiting:Point|null;previous:Point;
}
export const RADIUS=SPEC.actorRadius,SEPARATION=SPEC.separation;
export const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function transform(p:Pose,q:number[]):Point{
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  return [p.position[0]+c*q[0]+s*q[1],p.position[1]-s*q[0]+c*q[1]];
}
export function pointSegment(p:Point,a:Point,b:Point){
  const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;
  const t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l)):0;
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
}
function rectangleDistance(p:Point,center:number[],half:number[],yaw:number){
  const dx=p[0]-center[0],dz=p[1]-center[1],c=Math.cos(yaw),s=Math.sin(yaw);
  return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-half[0]),Math.max(0,Math.abs(s*dx+c*dz)-half[1]));
}
class Heap {
  values:{id:number;score:number}[]=[];
  push(id:number,score:number){const a=this.values;let i=a.length;a.push({id,score});while(i){const p=(i-1)>>1;if(a[p].score<=score)break;[a[i],a[p]]=[a[p],a[i]];i=p;}}
  pop(){const a=this.values,first=a[0],last=a.pop()!;if(a.length){a[0]=last;let i=0;while(true){let next=i;for(const j of [i*2+1,i*2+2])if(j<a.length&&a[j].score<a[next].score)next=j;if(next===i)break;[a[i],a[next]]=[a[next],a[i]];i=next;}}return first;}
}
export class Navigation {
  readonly preset;
  readonly access:Record<Product,Point>;
  readonly nodes:Point[]=[];
  readonly neighbors:number[][]=[];
  readonly swings:{a:Point;b:Point}[]=[];
  readonly waitPoints:Point[]=[];
  constructor(public id:LayoutId,public chilled:boolean){
    this.preset=SPEC.presets[id];
    this.access=Object.fromEntries((['drinks','bread','fruit'] as Product[]).map(p=>[p,transform(this.preset[p],SPEC.accessLocal)])) as Record<Product,Point>;
    if(chilled)for(const sign of [1,-1])for(let degrees=0;degrees<=100;degrees+=5){
      const a:Point=[-sign*.68,.408],angle=degrees*Math.PI/180;
      const b:Point=[a[0]+sign*.676*Math.cos(angle),a[1]+.676*Math.sin(angle)];
      this.swings.push({a:transform(this.preset.drinks,a),b:transform(this.preset.drinks,b)});
    }
    const index=new Map<string,number>(),step=SPEC.grid,[x0,x1,z0,z1]=SPEC.bounds;
    for(let ix=0;x0+ix*step<=x1+.001;ix++)for(let iz=0;z0+iz*step<=z1+.001;iz++){
      const p:Point=[Number((x0+ix*step).toFixed(4)),Number((z0+iz*step).toFixed(4))];
      if(this.free(p)){index.set(`${ix},${iz}`,this.nodes.length);this.nodes.push(p);}
    }
    for(const p of this.nodes){
      const ix=Math.round((p[0]-x0)/step),iz=Math.round((p[1]-z0)/step),n:number[]=[];
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        if(!dx&&!dz)continue;const j=index.get(`${ix+dx},${iz+dz}`);
        if(j!==undefined&&this.clear(p,this.nodes[j]))n.push(j);
      }
      this.neighbors.push(n);
    }
    // Shared waiting slots never occupy a service point or a door's swept area.
    for(const point of this.preset.waiting){
      const p=point as Point;if(!this.free(p))throw Error('Invalid waiting bay: '+id+JSON.stringify(p));
      this.waitPoints.push(p);
    }
  }
  free(p:Point){
    const [x0,x1,z0,z1]=SPEC.bounds;
    if(p[0]<x0||p[0]>x1||p[1]<z0||p[1]>z1)return false;
    for(const c of Object.values(CHECKOUT_SPEC.stations))
      if(rectangleDistance(p,c.position,CHECKOUT_SPEC.footprint.map(n=>n/2),c.yaw)<RADIUS-.00001)return false;
    for(const product of ['drinks','bread','fruit'] as Product[]){
      const pose=this.preset[product],half=product==='drinks'?SHELF.contract.footprint.map(x=>x/2):[.74,.45];
      if(rectangleDistance(p,pose.position,half,pose.yaw)<RADIUS-.00001)return false;
    }
    if(SPEC.fixedCircles.some(c=>distance(p,c.center as Point)<RADIUS+c.radius-.00001))return false;
    return !this.swings.some(s=>pointSegment(p,s.a,s.b)<RADIUS+.019);
  }
  clear(a:Point,b:Point,others:Point[]=[]){
    if(others.some(p=>pointSegment(p,a,b)<SEPARATION-.00001))return false;
    const n=Math.max(1,Math.ceil(distance(a,b)/.065));
    for(let i=0;i<=n;i++)if(!this.free([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]))return false;
    return true;
  }
  nearest(p:Point,excluded:Point[]=[],other?:Navigation):Point{
    let best:Point|null=null,cost=Infinity;
    for(const q of this.nodes){
      const d=distance(p,q);
      if(d<cost&&excluded.every(x=>distance(q,x)>=SEPARATION+.025)&&(!other||other.free(q))){cost=d;best=q;}
    }
    if(!best)throw Error('No unoccupied staging point');
    return [...best];
  }
  route(start:Point,goal:Point,others:Point[]=[]):Point[]{
    if(!this.free(goal)||others.some(p=>distance(p,goal)<SEPARATION))return [];
    if(this.clear(start,goal,others))return [[...goal]];
    const near=(point:Point)=>{
      let best=-1,d=Infinity;
      for(let i=0;i<this.nodes.length;i++){
        const next=distance(point,this.nodes[i]);if(next<d&&next<.85&&this.clear(point,this.nodes[i],others)){d=next;best=i;}
      }return best;
    };
    const source=near(start),target=near(goal);if(source<0||target<0)return [];
    const g=new Float64Array(this.nodes.length).fill(Infinity),came=new Int32Array(this.nodes.length).fill(-1),closed=new Uint8Array(this.nodes.length),heap=new Heap();
    g[source]=0;heap.push(source,distance(this.nodes[source],goal));
    const allowed=new Int8Array(this.nodes.length);
    while(heap.values.length){
      const u=heap.pop().id;if(closed[u])continue;closed[u]=1;
      if(u===target){
        const path:Point[]=[[...goal]];let j=u;
        while(j!==source){path.unshift(this.nodes[j]);j=came[j];}
        path.unshift(this.nodes[source]);
        // Shortcut only segments that are collision-free, including circular agents.
        const simple:Point[]=[];let last=start;
        for(let i=0;i<path.length;i++){
          let far=i;while(far+1<path.length&&this.clear(last,path[far+1],others))far++;
          simple.push([...path[far]]);last=path[far];i=far;
        }return simple;
      }
      for(const v of this.neighbors[u]){
        if(closed[v])continue;
        if(!allowed[v])allowed[v]=others.every(p=>distance(this.nodes[v],p)>=SEPARATION)?1:-1;
        if(allowed[v]<0||others.some(p=>pointSegment(p,this.nodes[u],this.nodes[v])<SEPARATION))continue;
        const candidate=g[u]+distance(this.nodes[u],this.nodes[v]);
        if(candidate<g[v]){g[v]=candidate;came[v]=u;heap.push(v,candidate+distance(this.nodes[v],goal));}
      }
    }return [];
  }
}
const cache=new Map<string,Navigation>();
export function navigation(id:LayoutId,chilled:boolean){
  const key=id+chilled;let value=cache.get(key);
  if(!value){value=new Navigation(id,chilled);cache.set(key,value);}return value;
}
export function freshMotion(pos:Point):NavMotion{return {path:[],goal:null,blocked:0,moving:false,waiting:null,previous:[...pos]};}
