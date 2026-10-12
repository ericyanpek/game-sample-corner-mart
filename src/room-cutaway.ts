import * as THREE from 'three';

export type WallSide='back'|'left';
export function wallSide(object:THREE.Object3D):WallSide|null {
  const key=(object.userData.asset_id||object.name).replaceAll('_',' ');
  if(/^(Wall back|Back (moulding|top)|Store sign)/.test(key))return 'back';
  if(/^(Wall left|Left (moulding|top)|Window)/.test(key))return 'left';
  return null;
}
/** Partition before batching so wall trims/windows disappear with their wall. */
export class RoomCutaway {
  readonly walls=new Map<WallSide,{root:THREE.Group;plane:number;members:string[]}>();
  constructor(room:THREE.Object3D){
    let structure:THREE.Object3D|undefined;
    room.traverse(o=>{if(o.userData.asset_id==='store.static')structure=o;});
    if(!structure)return;
    room.updateMatrixWorld(true);
    for(const side of ['back','left'] as const){
      const parts=structure.children.filter(o=>wallSide(o)===side);
      if(!parts.length)continue;
      const wall=parts.find(o=>(o.userData.asset_id||o.name).replaceAll('_',' ')===`Wall ${side}`)!;
      if(!wall)continue;
      const center=new THREE.Box3().setFromObject(wall).getCenter(new THREE.Vector3());
      const group=new THREE.Group();group.name='cutaway.'+side;group.userData.cutawayWall=side;
      structure.add(group);
      const members=parts.map(o=>o.userData.asset_id||o.name);
      parts.forEach(o=>group.attach(o));
      this.walls.set(side,{root:group,plane:side==='left'?center.x:center.z,members});
    }
  }
  update(camera:THREE.Camera){
    for(const [side,wall] of this.walls){
      const distance=(side==='left'?camera.position.x:camera.position.z)-wall.plane;
      // Hysteresis avoids alternating visibility while orbiting along a wall plane.
      if(wall.root.visible&&distance<-.15)wall.root.visible=false;
      else if(!wall.root.visible&&distance>.15)wall.root.visible=true;
    }
  }
  snapshot(){return [...this.walls].map(([side,w])=>({side,visible:w.root.visible,members:w.members}));}
}
