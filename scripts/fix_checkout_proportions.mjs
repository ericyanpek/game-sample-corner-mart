/** Apply the shared checkout dimensions to existing GLBs without regenerating meshes. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const spec=JSON.parse(await fs.readFile('assets/specs/checkouts.json','utf8'));
const report={at:new Date().toISOString(),method:'GLB node transforms and payment animation samples; no Blender execution.',assets:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
function unpack(bytes){
  const end=20+bytes.readUInt32LE(12);
  return {doc:JSON.parse(bytes.subarray(20,end)),binary:Buffer.from(bytes.subarray(end))};
}
function pack(doc,binary){
  const raw=Buffer.from(JSON.stringify(doc)),length=Math.ceil(raw.length/4)*4;
  const bytes=Buffer.alloc(20+length+binary.length,0x20);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(length,12);bytes.writeUInt32LE(0x4e4f534a,16);raw.copy(bytes,20);binary.copy(bytes,20+length);
  return bytes;
}
const load=bytes=>new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
const file='public/assets/checkouts/counter.glb',before=await fs.readFile(file);
const {doc,binary}=unpack(before);
const ratio=(spec.height-.09)/.8,shift=spec.height-.89;
const originalHeights={'counter.top':.85,'counter.scan':.898,'counter.card.reader':.923,
  'terminal.foot':.918,'terminal.neck':1,'terminal.back':1.10,'terminal.display':1.10};
let line=0;
for(const node of doc.nodes){
  const id=node.extras?.asset_id;
  if(id==='counter.body'||id==='counter.front'){
    node.translation[1]=(id==='counter.body'?.4:.43)*ratio;
    node.scale=[1,ratio,1];
  }else if(['counter.logo','logo.shelf','logo.bar'].includes(id))node.translation[1]=.49*ratio;
  else if(id in originalHeights)node.translation[1]=originalHeights[id]+shift;
  else if(id==='terminal.line')node.translation[1]=[1.065,1.10,1.135][line++]+shift;
  else if(id?.startsWith('checkout.item.'))node.translation=[...spec.itemSlots[Number(id.split('.').at(-1))]];
}
assert.equal(line,3);
const after=pack(doc,binary),asset=await load(after),parts=new Map();
asset.scene.traverse(o=>{if(o.userData.asset_id)parts.set(o.userData.asset_id,o);});
const box=id=>new THREE.Box3().setFromObject(parts.get(id));
assert.ok(Math.abs(box('counter.top').max.y-spec.height)<1e-6);
assert.ok(Math.abs(box('counter.scan').max.y-spec.itemSlots[0][1])<1e-6);
assert.ok(box('terminal.back').max.y<.864); // Below the character's eyes.
assert.ok(Math.abs(box('counter.body').min.y)<1e-6);
for(const [i,slot] of spec.itemSlots.entries())assert.deepEqual(parts.get('checkout.item.'+i).position.toArray(),slot);
const originalAsset=await load(before),oldParts=new Map();
originalAsset.scene.traverse(o=>{if(o.userData.asset_id)oldParts.set(o.userData.asset_id,o);});
for(const id of ['checkout.customer','checkout.employee'])
  assert.deepEqual(parts.get(id).matrixWorld.toArray(),oldParts.get(id).matrixWorld.toArray());
const oldTop=new THREE.Box3().setFromObject(oldParts.get('counter.top'));
for(const axis of ['x','z'])for(const edge of ['min','max'])assert.equal(box('counter.top')[edge][axis],oldTop[edge][axis]);
assert.ok(unpack(after).binary.equals(unpack(before).binary));
await fs.writeFile(file,after);
report.assets.push({file,before:hash(before),after:hash(after),top:box('counter.top').max.y,terminalTop:box('terminal.back').max.y,meshBinaryUnchanged:true,footprintAndNavigationAnchorsUnchanged:true});

// Replace only the left-arm Pay samples. All mesh data and other actions remain byte-identical.
for(const file of ['public/assets/characters/wardrobe.glb','public/assets/character-actions.glb']){
  const before=await fs.readFile(file),{doc,binary}=unpack(before),original=Buffer.from(binary),allowed=new Set();
  function accessor(index){
    const a=doc.accessors[index],view=doc.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];
    assert.equal(a.componentType,5126);assert.ok(!a.sparse);
    const offset=8+(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??width*4;
    return {a,width,read:i=>Array.from({length:width},(_,c)=>binary.readFloatLE(offset+i*stride+c*4)),
      write(i,values){for(let c=0;c<width;c++){const p=offset+i*stride+c*4;binary.writeFloatLE(values[c],p);for(let k=0;k<4;k++)allowed.add(p+k);}}};
  }
  let changedSamples=0,channels=0;
  for(const animation of doc.animations){
    for(const channel of animation.channels){
      const node=doc.nodes[channel.target.node],path=channel.target.path;
      if(node.extras?.asset_id!=='arm.left'||!['translation','rotation'].includes(path))continue;
      const sampler=animation.samplers[channel.sampler];
      assert.equal(sampler.interpolation,'LINEAR');
      const times=accessor(sampler.input),values=accessor(sampler.output),origin=node.translation??[0,0,0];
      channels++;
      for(let i=0;i<times.a.count;i++){
        const frame=Math.round(times.read(i)[0]*24);
        if(frame<96||frame>120)continue;
        const reach=Math.sin(Math.PI*(frame-96)/24)**.8,p=spec.payment;
        const angle=p.restAngle-p.reachAngle*reach;
        values.write(i,path==='rotation'?[Math.sin(angle/2),0,0,Math.cos(angle/2)]:
          [origin[0],origin[1]+p.upwardReach*reach,origin[2]+p.forwardReach*reach]);
        changedSamples++;
      }
      if(values.a.min||values.a.max){
        const samples=Array.from({length:values.a.count},(_,i)=>values.read(i));
        values.a.min=Array.from({length:values.width},(_,c)=>Math.min(...samples.map(v=>v[c])));
        values.a.max=Array.from({length:values.width},(_,c)=>Math.max(...samples.map(v=>v[c])));
      }
    }
  }
  assert.equal(channels,2);assert.equal(changedSamples,50);
  for(let i=0;i<binary.length;i++)if(!allowed.has(i))assert.equal(binary[i],original[i]);
  const after=pack(doc,binary);await load(after);await fs.writeFile(file,after);
  report.assets.push({file,before:hash(before),after:hash(after),paymentSamples:changedSamples,allOtherBinaryBytesUnchanged:true});
}
await fs.mkdir('evidence/checkout-height',{recursive:true});
await fs.writeFile('evidence/checkout-height/asset-fix.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
