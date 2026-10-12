import * as THREE from 'three';
import SPEC from '../assets/specs/expressions.json';
import type {Emotion} from './emotions.ts';
export {SPEC as EXPRESSION_SPEC};

/** Add the shared, editable face specification to the existing Blender wardrobe once. */
export function prepareExpressions(root:THREE.Object3D){
  const parts=new Map<string,THREE.Object3D>();
  root.traverse(o=>{if(o.userData.asset_id)parts.set(o.userData.asset_id,o);});
  const actor=parts.get('customer');
  if(!actor)throw Error('人物模型缺少根节点');
  if(parts.has('expression.head'))return;
  const head=new THREE.Group();head.name='expression.head';head.userData.asset_id=head.name;
  head.position.fromArray(SPEC.headPivot);actor.add(head);
  root.updateMatrixWorld(true);
  for(const o of [...actor.children]){
    const key=o.userData.asset_id??'',family=o.userData.appearance_family;
    if(family==='face')o.removeFromParent();
    if(key==='head'||key==='nose'||key.startsWith('ear.')||key.startsWith('eye.')||family==='hair'||family==='accessory')head.attach(o);
  }
  const hat=new THREE.Group();hat.userData={appearance_family:'headwear',appearance_option:'uniform'};
  actor.add(hat);
  for(const name of ['uniform.hat','uniform.brim','hat.patch']){
    const part=parts.get(name);if(part)hat.attach(part);
  }
  head.attach(hat);
  const eye=parts.get('eye.0.055');
  if(!(eye instanceof THREE.Mesh))throw Error('人物模型缺少五官材质');
  const ink=Array.isArray(eye.material)?eye.material[0]:eye.material;
  for(const [name,spec] of Object.entries(SPEC.faces)){
    const face=new THREE.Group();face.userData.expression=name;face.name='expression.'+name;actor.add(face);
    const lines=[spec.mouth,spec.brow,spec.brow.map(([x,y,z])=>[-x,y,z])];
    for(const [i,line] of lines.entries())for(let j=1;j<line.length;j++){
      const a=new THREE.Vector3().fromArray(line[j-1]),b=new THREE.Vector3().fromArray(line[j]);
      const direction=b.clone().sub(a),r=i===0?.007:.006;
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,direction.length(),8),ink);
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
      face.add(mesh);
    }
    head.attach(face);
  }
  actor.userData.expression_contract=SPEC.contract;
}

/** One controller per person; face geometry remains shared by all cloned characters. */
export class CharacterExpression {
  private faces=new Map<string,THREE.Object3D>();
  private eyes:{object:THREE.Object3D;y:number}[]=[];
  private head:THREE.Object3D|undefined;
  emotion:Emotion='focused';
  constructor(root:THREE.Object3D){
    root.traverse(o=>{
      if(o.userData.expression){o.visible=false;this.faces.set(o.userData.expression,o);}
      if(o.userData.asset_id==='expression.head')this.head=o;
      if(o.userData.asset_id?.startsWith('eye.'))this.eyes.push({object:o,y:o.scale.y});
    });
  }
  update(emotion:Emotion,tick:number,id:number,reducedMotion=false){
    this.emotion=emotion;
    for(const [name,face] of this.faces)face.visible=name===emotion;
    const seconds=tick/10+id*.37,phase=seconds%4.8;
    // A short gesture followed by a rest. Only the head moves; hand mounts are untouched.
    const gesture=phase<1.8?Math.sin(Math.PI*phase/1.8):0;
    const x=reducedMotion?0:emotion==='happy'?.13*Math.sin(phase*8)*gesture:emotion==='disappointed'?.10:0;
    const y=reducedMotion?0:emotion==='disappointed'?.16*Math.sin(phase*7)*gesture:emotion==='impatient'?.25*Math.sin(seconds*1.8):0;
    if(this.head)this.head.rotation.set(x,y,0);
    const blink=!reducedMotion&&seconds%3.9<.11;
    for(const {object,y:base} of this.eyes)object.scale.y=base*(blink?.16:emotion==='happy'?.7:emotion==='impatient'?.8:1);
  }
}
