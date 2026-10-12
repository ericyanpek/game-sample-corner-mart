/** Fix only the side-post transforms; retain the complete shelf interface and binary data. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

await fs.mkdir('evidence/camera',{recursive:true});
const records=[];
for(const tier of ['wood','lit','chilled']){
  const file=`public/assets/shelves/${tier}.glb`,before=await fs.readFile(file);
  const end=20+before.readUInt32LE(12),doc=JSON.parse(before.subarray(20,end)),binary=before.subarray(end);
  const posts=doc.nodes.filter(n=>['oak.upright','display.side'].includes(n.extras?.asset_id));
  assert.equal(posts.length,2);
  const previous=posts.map(n=>({position:n.translation,scale:n.scale??[1,1,1]}));
  for(const post of posts){
    const positions=doc.accessors[doc.meshes[post.mesh].primitives[0].attributes.POSITION];
    post.translation=[post.translation[0],.85,post.translation[2]];
    post.scale=[1,1.46/(positions.max[1]-positions.min[1]),1];
  }
  const raw=Buffer.from(JSON.stringify(doc)),length=Math.ceil(raw.length/4)*4;
  const after=Buffer.alloc(20+length+binary.length,0x20);
  before.copy(after,0,0,12);after.writeUInt32LE(after.length,8);
  after.writeUInt32LE(length,12);after.writeUInt32LE(0x4e4f534a,16);raw.copy(after,20);binary.copy(after,20+length);
  const asset=await new GLTFLoader().parseAsync(after.buffer.slice(after.byteOffset,after.byteOffset+after.length),'');
  asset.scene.updateMatrixWorld(true);
  const bounds={posts:[]};let anchors=0,units=0;
  asset.scene.traverse(o=>{
    const id=o.userData.asset_id;
    if(id==='common.header')bounds.header=new THREE.Box3().setFromObject(o);
    if(id==='common.plinth')bounds.plinth=new THREE.Box3().setFromObject(o);
    if(['oak.upright','display.side'].includes(id))bounds.posts.push(new THREE.Box3().setFromObject(o));
    if(id==='stop.drinks'||id==='label.drinks')anchors++;
    if(/^unit\.drinks\.\d+$/.test(id??''))units++;
  });
  for(const post of bounds.posts){
    assert.ok(Math.abs(post.min.y-bounds.plinth.max.y)<1e-6);
    assert.ok(Math.abs(post.max.y-bounds.header.min.y)<1e-6);
    assert.ok(post.max.y<=bounds.header.min.y+1e-6&&post.min.y>=bounds.plinth.max.y-1e-6);
  }
  assert.equal(anchors,2);assert.equal(units,{wood:24,lit:36,chilled:48}[tier]);
  assert.ok(after.subarray(20+length).equals(binary));
  await fs.writeFile(file,after);
  records.push({tier,previous,posts:bounds.posts.map(b=>({min:b.min.toArray(),max:b.max.toArray()})),anchors,units,
    binaryUnchanged:true,bytes:after.length,sha256:createHash('sha256').update(after).digest('hex')});
}
await fs.writeFile('evidence/camera/shelf-fix.json',JSON.stringify({at:new Date().toISOString(),records},null,2)+'\n');
console.log('Verified all three shelf tiers: posts meet the plinth/header, anchors and stock geometry unchanged.');
