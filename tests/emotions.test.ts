import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Shop,type Customer} from '../src/sim.ts';
import {BusinessDay} from '../src/day.ts';
import {customerEmotion} from '../src/emotions.ts';
import {CharacterExpression,prepareExpressions,EXPRESSION_SPEC} from '../src/expression-view.ts';
import {characterLook,dressCharacter,CHARACTER_SPEC,type CharacterRole} from '../src/appearance.ts';
import {ShopView} from '../src/view.ts';

const quiet={arrivals:false,restock:false};
function sample(){
  const s=new BusinessDay().shop;
  return {s,c:s.spawn({kind:'breakfast',products:['drinks','bread'],style:0})!};
}
test('only a completely paid shopping list is happy; a partial sale remains disappointed',()=>{
  const {s,c}=sample();
  for(const item of c.shopping)item.status='reserved';
  c.state='pay';
  assert.equal(customerEmotion(c,s.state.tick).emotion,'focused');
  c.state='leave';c.happy=true;c.shopping.forEach(i=>i.status='purchased');
  assert.equal(customerEmotion(c,s.state.tick).emotion,'happy');
  c.shopping[1].status='missing';
  assert.equal(customerEmotion(c,s.state.tick).label,'没买齐');
  c.happy=false;c.shopping[0].status='missing';
  assert.equal(customerEmotion(c,s.state.tick).label,'空手而归');
});
test('patience warning begins at 65%, clears on service, and returns stay impatient',()=>{
  const {c}=sample();c.state='queue';c.queuedAt=100;c.patience=200;
  assert.equal(customerEmotion(c,229).emotion,'focused');
  assert.equal(customerEmotion(c,230).emotion,'impatient');
  c.state='service';assert.equal(customerEmotion(c,240).emotion,'focused');
  c.shopping[1].status='missing';assert.equal(customerEmotion(c,240).emotion,'disappointed');
  c.state='return';assert.equal(customerEmotion(c,400).label,'不想等了');
  c.state='leave';c.shopping[0].status='returned';
  assert.equal(customerEmotion(c,450).emotion,'impatient');
});
test('real purchases distinguish complete, partial and empty baskets',()=>{
  for(const stock of ['full','partial','empty'] as const){
    const {s,c}=sample();
    if(stock!=='full')Object.assign(s.state.shelves.bread,{onHand:0,initial:0,received:s.state.shelves.bread.sold});
    if(stock==='empty')Object.assign(s.state.shelves.drinks,{onHand:0,initial:0,received:s.state.shelves.drinks.sold});
    let departed:Customer|undefined;
    for(let n=0;n<2000;n++){
      s.step(1,quiet);s.assertValid();
      if(c.state==='leave'){departed=c;break;}
    }
    assert.ok(departed);
    assert.equal(customerEmotion(departed,s.state.tick).label,{full:'买齐啦',partial:'没买齐',empty:'空手而归'}[stock]);
  }
});
test('emotion observation and save reload preserve the exact business-day result',()=>{
  const observed=new BusinessDay(),control=new BusinessDay();
  observed.open();control.open();
  for(let n=0;n<2600;n++){
    observed.step(1);control.step(1);
    for(const c of observed.shop.state.customers){
      const before=structuredClone(c),emotion=customerEmotion(c,observed.shop.state.tick);
      const restored=Shop.restore(observed.shop.snapshot()).state.customers.find(x=>x.id===c.id)!;
      assert.deepEqual(customerEmotion(restored,observed.shop.state.tick),emotion);
      assert.deepEqual(c,before);
    }
  }
  assert.deepEqual(observed.snapshot(),control.snapshot());
});

async function wardrobe(){
  const bytes=await readFile(new URL('../public/assets/characters/wardrobe.glb',import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
}
function node(root:THREE.Object3D,id:string){
  let found:THREE.Object3D|undefined;root.traverse(o=>{if(o.userData.asset_id===id)found=o;});
  assert.ok(found,id);return found;
}
test('all eight customer looks and both staff reuse four faces without changing identity or mounts',async()=>{
  const asset=await wardrobe();
  prepareExpressions(asset.scene);
  const variants:THREE.Object3D[]=[];
  asset.scene.traverse(o=>{if(o.userData.appearance_family||o.userData.expression)variants.push(o);});
  for(const variant of variants)ShopView.prototype.batch.call({} as ShopView,variant);
  const cases:[CharacterRole,number][]=[...CHARACTER_SPEC.customers.map((_,i)=>['customer',i+1] as [CharacterRole,number]),['worker',0],['cashier',0]];
  let sharedGeometry:THREE.BufferGeometry|undefined;
  for(const [role,id] of cases){
    const root=asset.scene.clone(true),materials=dressCharacter(root,role,id),controller=new CharacterExpression(root);
    const before=structuredClone(root.userData.appearance);
    const left=node(root,'hold.left'),right=node(root,'hold.right');
    root.updateMatrixWorld(true);const mounts=[left.matrixWorld.toArray(),right.matrixWorld.toArray()];
    for(const emotion of Object.keys(EXPRESSION_SPEC.faces) as (keyof typeof EXPRESSION_SPEC.faces)[]){
      controller.update(emotion,37,id);root.updateMatrixWorld(true);
      const visible:string[]=[];
      root.traverse(o=>{if(o.userData.expression&&o.visible)visible.push(o.userData.expression);});
      assert.deepEqual(visible,[emotion]);
      assert.deepEqual(root.userData.appearance,before);
      assert.deepEqual([left.matrixWorld.toArray(),right.matrixWorld.toArray()],mounts);
    }
    assert.equal(before.id,characterLook(role,id).id);
    root.traverse(o=>{
      if(o.parent?.userData.expression==='happy'&&o instanceof THREE.Mesh){
        if(sharedGeometry)assert.equal(o.geometry,sharedGeometry);
        else sharedGeometry=o.geometry;
      }
    });
    const hat=node(root,'expression.head').children.find(o=>o.userData.appearance_family==='headwear');
    assert.equal(hat?.visible,role!=='customer');
    materials.forEach(m=>m.dispose());
  }
});
test('head gestures preserve original walk/pay hand motion and stop with reduced motion',async()=>{
  const original=await wardrobe(),updated=await wardrobe();prepareExpressions(updated.scene);
  dressCharacter(updated.scene,'customer',1);
  const expression=new CharacterExpression(updated.scene);
  function animator(asset:typeof original){
    const full=new THREE.AnimationClip('Timeline',-1,asset.animations.flatMap(c=>c.tracks));
    const mixer=new THREE.AnimationMixer(asset.scene);mixer.clipAction(full).play();return mixer;
  }
  const originalMixer=animator(original),updatedMixer=animator(updated);
  for(const tick of [0,11,37,89,132,185]){
    originalMixer.setTime(tick/24);updatedMixer.setTime(tick/24);
    expression.update('impatient',tick,2);
    original.scene.updateMatrixWorld(true);updated.scene.updateMatrixWorld(true);
    for(const id of ['hold.left','hold.right','arm.left','arm.right','leg.left','leg.right']){
      const a=node(original.scene,id).matrixWorld.toArray(),b=node(updated.scene,id).matrixWorld.toArray();
      assert.ok(a.every((x,i)=>Math.abs(x-b[i])<1e-7),id);
    }
  }
  expression.update('happy',37,1,true);
  assert.deepEqual(node(updated.scene,'expression.head').rotation.toArray(),[0,0,0,'XYZ']);
  assert.equal(expression.emotion,'happy');
});
