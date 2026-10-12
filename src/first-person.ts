import * as THREE from 'three';
import type {Shop} from './sim.ts';
import {CHECKOUT_SPEC} from './navigation.ts';
import type {CameraDirection} from './camera.ts';

export type FirstPersonTarget={kind:'cashier'|'worker'}|{kind:'customer';id:number};
export interface EyePose {position:THREE.Vector3;heading:number}
export const EYE_HEIGHT=.864;
const radians=THREE.MathUtils.degToRad;
const MAX_HORIZONTAL_FOV=88,MAX_VERTICAL_FOV=68;
const AUTO_TURN_SPEED=radians(90),REDUCED_AUTO_TURN_SPEED=radians(60);

/** Use the same interpolated ground position as the actor, independent of head gestures. */
export function firstPersonPose(shop:Shop,target:FirstPersonTarget,alpha=1):EyePose|null{
  let pos:readonly number[],previous:readonly number[],heading:number;
  if(target.kind==='customer'){
    const c=shop.state.customers.find(c=>c.id===target.id);
    if(!c)return null;
    pos=c.pos;previous=c.nav.previous;heading=c.facing;
  }else if(target.kind==='worker'){
    const s=shop.state;
    if(!s.upgrades.staff&&!s.orders.length&&!s.delivery)return null;
    pos=s.delivery?.pos??shop.layout.delivery;previous=s.delivery?.nav.previous??pos;
    heading=s.delivery?.facing??Math.PI/2;
  }else{
    pos=CHECKOUT_SPEC.stations.main.cashier;previous=pos;heading=Math.PI/2;
  }
  return {position:new THREE.Vector3(
    THREE.MathUtils.lerp(previous[0],pos[0],alpha),.027,
    THREE.MathUtils.lerp(previous[1],pos[1],alpha)),heading};
}

/** A single eye camera for all roles; manual look is relative to the person's heading. */
export class FirstPersonCamera {
  readonly camera=new THREE.PerspectiveCamera(MAX_VERTICAL_FOV,1,.02,80);
  active=false;
  private heading=0;
  private yaw=0;
  private pitch=radians(-6);
  private desiredYaw=0;
  private desiredPitch=this.pitch;
  private pointers=new Map<number,{x:number;y:number}>();
  private multiple=false;
  constructor(private canvas:HTMLCanvasElement){
    canvas.addEventListener('pointerdown',this.down);
    canvas.addEventListener('pointermove',this.move);
    canvas.addEventListener('pointerup',this.up);
    canvas.addEventListener('pointercancel',this.up);
    canvas.addEventListener('lostpointercapture',this.up);
    canvas.addEventListener('wheel',this.wheel,{passive:false});
  }
  private down=(e:PointerEvent)=>{
    if(!this.active||e.button!==0)return;
    this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.pointers.size>1)this.multiple=true;
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move=(e:PointerEvent)=>{
    const last=this.pointers.get(e.pointerId);
    if(!this.active||!last||this.multiple)return;
    const width=Math.max(240,this.canvas.clientWidth),height=Math.max(200,this.canvas.clientHeight);
    this.desiredYaw=THREE.MathUtils.clamp(this.desiredYaw-(e.clientX-last.x)/width*Math.PI,radians(-85),radians(85));
    this.desiredPitch=THREE.MathUtils.clamp(this.desiredPitch+(e.clientY-last.y)/height*Math.PI,radians(-50),radians(35));
    last.x=e.clientX;last.y=e.clientY;
  };
  private up=(e:PointerEvent)=>{
    this.pointers.delete(e.pointerId);
    if(!this.pointers.size)this.multiple=false;
  };
  private wheel=(e:WheelEvent)=>{if(this.active)e.preventDefault();};
  begin(pose:EyePose){
    this.clearPointers();this.active=true;this.heading=pose.heading;
    this.yaw=this.desiredYaw=0;this.pitch=this.desiredPitch=radians(-6);
    this.update(pose,0,true);
  }
  end(){this.active=false;this.clearPointers();}
  private clearPointers(){
    for(const id of [...this.pointers.keys()])if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    this.pointers.clear();this.multiple=false;
  }
  resize(aspect:number){
    if(!Number.isFinite(aspect)||aspect<=0)return;
    this.camera.aspect=aspect;
    // A short, wide game window must not turn the eye camera into an ultrawide lens.
    // Retain the vertical limit on portrait screens instead of opening their vertical FOV.
    this.camera.fov=Math.min(MAX_VERTICAL_FOV,
      THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(radians(MAX_HORIZONTAL_FOV/2))/aspect)));
    this.camera.updateProjectionMatrix();
  }
  ahead(){this.desiredYaw=0;this.desiredPitch=radians(-6);}
  turn(direction:CameraDirection){
    if(direction==='left')this.desiredYaw+=radians(30);
    if(direction==='right')this.desiredYaw-=radians(30);
    if(direction==='up')this.desiredPitch+=radians(10);
    if(direction==='down')this.desiredPitch-=radians(10);
    this.desiredYaw=THREE.MathUtils.clamp(this.desiredYaw,radians(-85),radians(85));
    this.desiredPitch=THREE.MathUtils.clamp(this.desiredPitch,radians(-50),radians(35));
  }
  update(pose:EyePose,dt:number,reducedMotion=false){
    const elapsed=Number.isFinite(dt)?THREE.MathUtils.clamp(dt,0,.05):0;
    const blend=1-Math.exp(-elapsed*8);
    const maxTurn=(reducedMotion?REDUCED_AUTO_TURN_SPEED:AUTO_TURN_SPEED)*elapsed;
    // Navigation can change heading instantly. Follow its shortest arc at a bounded
    // speed, even with reduced motion enabled or after a suspended browser frame.
    const delta=Math.atan2(Math.sin(pose.heading-this.heading),Math.cos(pose.heading-this.heading));
    this.heading+=THREE.MathUtils.clamp(delta*blend,-maxTurn,maxTurn);
    const lookBlend=reducedMotion?1:blend;
    this.yaw=THREE.MathUtils.lerp(this.yaw,this.desiredYaw,lookBlend);
    this.pitch=THREE.MathUtils.lerp(this.pitch,this.desiredPitch,lookBlend);
    this.camera.position.copy(pose.position).add(new THREE.Vector3(Math.sin(this.heading)*.10,EYE_HEIGHT,Math.cos(this.heading)*.10));
    const yaw=this.heading+this.yaw,cos=Math.cos(this.pitch);
    this.camera.lookAt(this.camera.position.clone().add(new THREE.Vector3(Math.sin(yaw)*cos,Math.sin(this.pitch),Math.cos(yaw)*cos)));
    this.camera.updateMatrixWorld(true);
  }
  snapshot(){return {position:this.camera.position.toArray(),heading:this.heading,yaw:this.yaw,pitch:this.pitch,fov:this.camera.fov};}
  dispose(){
    this.end();this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('pointermove',this.move);
    this.canvas.removeEventListener('pointerup',this.up);this.canvas.removeEventListener('pointercancel',this.up);
    this.canvas.removeEventListener('lostpointercapture',this.up);this.canvas.removeEventListener('wheel',this.wheel);
  }
}

/** Hide only the observing person's head for this draw, restoring it even on render failure. */
export function withoutOwnHead(root:THREE.Object3D|undefined,render:()=>void){
  let head:THREE.Object3D|undefined;
  root?.traverse(o=>{if(o.userData.asset_id==='expression.head')head=o;});
  const visible=head?.visible;
  if(head)head.visible=false;
  try{render();}finally{if(head)head.visible=visible!;}
}
