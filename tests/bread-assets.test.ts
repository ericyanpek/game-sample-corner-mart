import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ShopView} from '../src/view.ts';

async function load(file:string){
  const b=await readFile(file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer,'');
}
function find(root:THREE.Object3D,id:string){
  let result:THREE.Object3D|undefined;
  root.traverse(o=>{if(o.userData.asset_id===id)result=o;});
  assert.ok(result,id);return result;
}
test('all 24 shelf breads share one colored mesh and preserve independent stock visibility',async()=>{
  for(const version of ['v1','v2']){
    const {scene}=await load(`public/assets/rooms/spacious-${version}.glb`);
    let shared:THREE.BufferGeometry|undefined;
    for(let i=0;i<24;i++){
      const unit=find(scene,`unit.bread.${i}`),meshes:THREE.Mesh[]=[];
      unit.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
      assert.equal(meshes.length,1);
      const mesh=meshes[0];assert.ok((mesh.material as THREE.MeshStandardMaterial).vertexColors);
      if(shared)assert.equal(mesh.geometry,shared);else shared=mesh.geometry;
      mesh.geometry.computeBoundingBox();
      const dimensions=mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      [.26,.17,.22].forEach((n,a)=>assert.ok(Math.abs(dimensions.getComponent(a)-n)<1e-6));
      assert.ok(mesh.geometry.index!.count/3<3000);
      unit.visible=i%2===0;
    }
    let visible=0;scene.traverseVisible(o=>{if(o.userData.asset_id?.startsWith('unit.bread.'))visible++;});
    assert.equal(visible,12);
  }
});
test('actual game batching preserves baked colors and keeps bread at one material draw',async()=>{
  const {scene}=await load('public/assets/rooms/spacious-v1.glb');
  const unit=find(scene,'unit.bread.0');
  ShopView.prototype.batch.call({} as ShopView,unit);
  const meshes:THREE.Mesh[]=[];unit.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
  assert.equal(meshes.length,1);
  const colors=meshes[0].geometry.attributes.color;
  assert.ok(colors&&colors.count===meshes[0].geometry.attributes.position.count);
  assert.ok((meshes[0].material as THREE.MeshStandardMaterial).vertexColors);
  assert.ok(Math.max(...colors.array)-Math.min(...colors.array)>.2,'crust and dough colors remain distinct');
});
test('handheld bread keeps its original envelope and carton front/back badges match',async()=>{
  const props=await load('public/assets/interaction-props.glb'),bread=find(props.scene,'prop.bread');
  const dimensions=new THREE.Box3().setFromObject(bread).getSize(new THREE.Vector3());
  [.26,.17,.17].forEach((n,a)=>assert.ok(Math.abs(dimensions.getComponent(a)-n)<1e-6));
  const crate=await load('public/assets/restocking/crate-bread.glb');
  for(const side of ['front','back']){
    const badge=find(crate.scene,'badge.loaf.'+side) as THREE.Mesh;
    assert.equal(badge.userData.visual_revision,'croissant-v1');
    assert.ok((badge.material as THREE.MeshStandardMaterial).vertexColors);
  }
});
test('all three sign panels fill the frame opening and keep separate theme roots',async()=>{
  const {scene}=await load('public/assets/days/day-sign.glb');scene.updateMatrixWorld(true);
  const supportNames:string[]=[];
  scene.traverse(o=>{if(o.userData.asset_id?.startsWith('sign.leg.'))supportNames.push(o.userData.asset_id);});
  assert.equal(supportNames.filter(id=>id.includes('.front.')).length,2);
  assert.equal(supportNames.filter(id=>id.includes('.rear.')).length,2);
  for(const theme of ['breakfast','hot','rush']){
    const root=find(scene,'theme.'+theme),panel=find(root,'sign.panel.'+theme);
    for(const x of [-.346,0,.346])for(const y of [.300,.70,1.10]){
      const ray=new THREE.Raycaster(new THREE.Vector3(x,y,1),new THREE.Vector3(0,0,-1));
      assert.ok(ray.intersectObject(panel,true).length>0,`${theme} frame opening is covered at ${x},${y}`);
    }
    const panelBounds=new THREE.Box3().setFromObject(panel),backBounds=new THREE.Box3().setFromObject(find(scene,'sign.back'));
    assert.ok(panelBounds.intersectsBox(backBounds),'face is seated against backing');
  }
});
