/** Repair existing GLB nodes without re-encoding geometry, materials or animation. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const support=JSON.parse(await fs.readFile('assets/specs/sign-supports.json','utf8'));
const paths=['public/assets/rooms/spacious-v1.glb','public/assets/rooms/spacious-v2.glb','public/assets/days/day-sign.glb'];
const evidence='evidence/display-fixes';
await fs.mkdir(evidence,{recursive:true});
const records=[];
function decode(b){const end=20+b.readUInt32LE(12);return {doc:JSON.parse(b.subarray(20,end)),tail:b.subarray(end)};}
function encode(doc,tail){
  const json=Buffer.from(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4;
  const out=Buffer.alloc(20+length+tail.length,0x20);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);tail.copy(out,20+length);
  return out;
}
for(const path of paths){
  const before=await fs.readFile(path),{doc:g,tail}=decode(before),changes=[];
  if(path.includes('/rooms/')){
    for(const [i,n] of g.nodes.entries())if(n.mesh!==undefined&&/^Checkout[ _]lettering/.test(n.extras?.asset_id||n.name||'')){
      changes.push({removed:n.name});
      for(const parent of g.nodes)if(parent.children)parent.children=parent.children.filter(child=>child!==i);
      for(const scene of g.scenes)scene.nodes=scene.nodes.filter(child=>child!==i);
      g.nodes[i]={name:'removed.checkout.lettering',extras:{removed:true}};
    }
  }else{
    for(const n of g.nodes){
      const id=n.extras?.asset_id??n.name??'';
      if(id.startsWith('sign.leg.')){
        const side=n.extras.support_side??(n.translation[2]>0?'front':'rear');
        const x=Math.sign(n.translation[0])*support.frameX,z=side==='front'?support.frontZ:support.rearZ;
        let foot=support.floorY;
        for(let i=0;i<6;i++)foot=support.floorY+support.radius*Math.abs(support.hingeZ-z)/Math.hypot(support.hingeY-foot,support.hingeZ-z);
        const a=new THREE.Vector3(x,foot,z),b=new THREE.Vector3(x,support.hingeY,support.hingeZ),direction=b.clone().sub(a);
        const pos=g.accessors[g.meshes[n.mesh].primitives[0].attributes.POSITION];
        assert.ok(pos.max[1]-pos.min[1]>1,'leg mesh has a local Y length');
        n.translation=a.clone().add(b).multiplyScalar(.5).toArray();
        n.scale=[support.radius/pos.max[0],direction.length()/(pos.max[1]-pos.min[1]),support.radius/pos.max[2]];
        n.rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()).toArray();
        n.name=`sign.leg.${side}.${x}`;n.extras={...n.extras,asset_id:n.name,support_side:side};
        changes.push({leg:n.name,foot:a.toArray(),hinge:b.toArray()});
      }else if(id.startsWith('sign.hinge.')){
        n.translation=[Math.sign(n.translation[0])*support.frameX,support.hingeY,support.hingeZ];
        const pos=g.accessors[g.meshes[n.mesh].primitives[0].attributes.POSITION];
        n.scale=[1,support.hingeLength/(pos.max[1]-pos.min[1]),1];
      }else if(id==='asset.day-sign')n.extras.support_revision=support.revision;
    }
  }
  const after=encode(g,tail);
  assert.ok(decode(after).tail.equals(tail),'binary geometry and animation bytes must remain unchanged');
  const asset=await new GLTFLoader().parseAsync(after.buffer.slice(after.byteOffset,after.byteOffset+after.byteLength),'');
  asset.scene.updateMatrixWorld(true);
  let visibleOldText=false;
  const legs=[],panels=[];
  asset.scene.traverse(o=>{
    if(o instanceof THREE.Mesh&&/^Checkout[ _]lettering/.test(o.name))visibleOldText=true;
    if(o.userData.asset_id?.startsWith('sign.leg.'))legs.push(o);
    if(o.userData.asset_id?.startsWith('sign.panel.')||o.userData.asset_id==='sign.back')panels.push(o);
  });
  assert.equal(visibleOldText,false);
  if(path.includes('/days/')){
    assert.equal(legs.length,4);assert.equal(panels.length,4);
    for(const leg of legs){
      const bounds=new THREE.Box3().setFromObject(leg);
      for(const panel of panels)assert.ok(!bounds.intersectsBox(new THREE.Box3().setFromObject(panel)),'support clears the face and backing board');
      assert.equal(Math.sign(leg.position.z),leg.userData.support_side==='front'?1:-1,'front and rear legs remain on opposite sides');
      assert.ok(Math.abs(Math.abs(leg.position.x)-support.frameX)<1e-6,'support aligns with side frame');
      assert.ok(Math.abs(bounds.min.y-support.floorY)<.002,'support contacts the ground');
    }
  }
  await fs.writeFile(path,after);
  records.push({path,changes,geometryBytesUnchanged:true,bytes:after.length,sha256:createHash('sha256').update(after).digest('hex')});
}
await fs.writeFile(evidence+'/asset-checks.json',JSON.stringify({at:new Date().toISOString(),records},null,2)+'\n');
console.log(JSON.stringify(records,null,2));
