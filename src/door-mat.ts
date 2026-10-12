import * as THREE from 'three';
import MAT from '../assets/specs/door-mat.json';

/** Keep the original beveled tiles; adjust only the entrance mat. */
export function prepareDoorMat(room:THREE.Object3D){
  room.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||o.userData.asset_id!=='Door mat')return;
    o.geometry.computeBoundingBox();
    const box=o.geometry.boundingBox!;
    o.scale.y=MAT.thickness/(box.max.y-box.min.y);
    o.position.y=MAT.floorY-box.min.y*o.scale.y;
    o.userData.receiveOnly=true;o.castShadow=false;o.receiveShadow=true;
  });
}
