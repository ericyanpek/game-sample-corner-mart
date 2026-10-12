import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import ROOM from '../assets/specs/room.json';

export type CameraDirection='left'|'right'|'up'|'down';
const radians=THREE.MathUtils.degToRad;
export const CAMERA_LIMITS={minPolar:radians(15),maxPolar:radians(82),minZoom:.65,maxZoom:3.2};
const defaultOffset=new THREE.Vector3(8,7.25,9.75);

/** Follow the subject independently of the user's orbit angle, pan and zoom. */
export class ShopCamera {
  readonly controls:OrbitControls;
  automatic=true;
  private anchor:THREE.Vector3|null=null;
  private offset=defaultOffset.clone();
  private zoom=1;
  private turnAnimation:{from:THREE.Spherical;to:THREE.Spherical;elapsed:number}|null=null;
  constructor(readonly camera:THREE.OrthographicCamera,canvas:HTMLCanvasElement){
    camera.position.copy(defaultOffset).add(new THREE.Vector3().fromArray(ROOM.cameraTarget));
    this.controls=new OrbitControls(camera,canvas);
    const c=this.controls;
    c.target.fromArray(ROOM.cameraTarget);
    c.enableRotate=true;c.enableDamping=true;c.dampingFactor=.12;c.rotateSpeed=.65;c.panSpeed=.8;
    c.mouseButtons.LEFT=THREE.MOUSE.ROTATE;c.mouseButtons.RIGHT=THREE.MOUSE.PAN;
    c.touches.ONE=THREE.TOUCH.ROTATE;c.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    c.minPolarAngle=CAMERA_LIMITS.minPolar;c.maxPolarAngle=CAMERA_LIMITS.maxPolar;
    c.minZoom=CAMERA_LIMITS.minZoom;c.maxZoom=CAMERA_LIMITS.maxZoom;
    c.addEventListener('start',()=>{this.automatic=false;this.turnAnimation=null;});
    this.reset(true);
  }
  private stopInertia(){
    const position=this.camera.position.clone(),target=this.controls.target.clone(),zoom=this.camera.zoom;
    // Flush damping through the public API, then restore the exact current view.
    const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();
    this.camera.position.copy(position);this.controls.target.copy(target);this.camera.zoom=zoom;
    this.camera.updateProjectionMatrix();this.controls.update();this.controls.enableDamping=damping;
  }
  focus(){
    this.stopInertia();this.offset.copy(this.camera.position).sub(this.controls.target);
    this.automatic=true;this.turnAnimation=null;this.anchor=null;
  }
  suspend(){this.stopInertia();this.turnAnimation=null;this.anchor=null;this.controls.enabled=false;}
  resume(){this.controls.enabled=true;this.anchor=null;}
  reset(instant=false){
    this.stopInertia();this.offset.copy(defaultOffset);this.zoom=1;this.automatic=true;this.turnAnimation=null;this.anchor=null;
    if(instant){
      this.controls.target.fromArray(ROOM.cameraTarget);this.camera.position.copy(this.controls.target).add(this.offset);
      this.camera.zoom=1;this.camera.updateProjectionMatrix();this.controls.update();this.camera.updateMatrixWorld(true);
    }
  }
  turn(direction:CameraDirection){
    const to=this.turnAnimation?.to.clone()??new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    if(direction==='left')to.theta-=radians(30);
    if(direction==='right')to.theta+=radians(30);
    if(direction==='up')to.phi-=radians(10);
    if(direction==='down')to.phi+=radians(10);
    this.orbitTo(to);
  }
  setElevation(degrees:number){
    const to=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    to.phi=radians(90-degrees);this.orbitTo(to);
  }
  private orbitTo(to:THREE.Spherical){
    this.stopInertia();this.automatic=false;
    const from=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    to.phi=THREE.MathUtils.clamp(to.phi,CAMERA_LIMITS.minPolar,CAMERA_LIMITS.maxPolar);
    to.theta=from.theta+Math.atan2(Math.sin(to.theta-from.theta),Math.cos(to.theta-from.theta));
    this.turnAnimation={from,to,elapsed:0};
  }
  update(target:THREE.Vector3,desiredZoom:number,dt:number,reducedMotion=false){
    const c=this.controls,camera=this.camera;
    c.enableDamping=!reducedMotion;
    if(this.automatic){
      this.zoom=desiredZoom;
      const blend=reducedMotion?1:1-Math.exp(-Math.min(dt,.1)*9);
      c.target.lerp(target,blend);
      camera.position.lerp(target.clone().add(this.offset),blend);
      camera.zoom=THREE.MathUtils.lerp(camera.zoom,THREE.MathUtils.clamp(this.zoom,c.minZoom,c.maxZoom),blend);
      camera.updateProjectionMatrix();
    }else if(this.anchor){
      const delta=target.clone().sub(this.anchor);
      camera.position.add(delta);c.target.add(delta);
    }
    this.anchor??=new THREE.Vector3();this.anchor.copy(target);
    if(this.turnAnimation){
      const t=this.turnAnimation;t.elapsed+=Math.min(dt,.1);
      const progress=reducedMotion?1:Math.min(1,t.elapsed/.2),ease=progress*progress*(3-2*progress);
      const spherical=new THREE.Spherical(t.from.radius,
        THREE.MathUtils.lerp(t.from.phi,t.to.phi,ease),THREE.MathUtils.lerp(t.from.theta,t.to.theta,ease));
      camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(spherical));
      if(progress===1)this.turnAnimation=null;
    }
    c.update();camera.updateMatrixWorld(true);
  }
}

/** Once a pointer moves, returning to its starting point must not become a click. */
export class SceneTap {
  private pointers=new Set<number>();
  private start={x:0,y:0};
  private dragged=false;
  down(id:number,x:number,y:number,button:number){
    this.pointers.add(id);
    if(this.pointers.size===1){this.start={x,y};this.dragged=button!==0;}else this.dragged=true;
  }
  move(id:number,x:number,y:number){
    if(this.pointers.has(id)&&Math.hypot(x-this.start.x,y-this.start.y)>6)this.dragged=true;
  }
  up(id:number,x:number,y:number,button:number){
    this.move(id,x,y);const known=this.pointers.delete(id);
    return known&&!this.dragged&&button===0&&this.pointers.size===0;
  }
  cancel(id:number){this.pointers.delete(id);this.dragged=true;}
  get active(){return this.pointers.size>0;}
}
