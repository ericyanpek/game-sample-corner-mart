/** A shared, texture-free mesh recipe; also consumed by the editable Blender builder. */
import fs from 'node:fs/promises';
import * as THREE from 'three';

const seams=[-.82,-.57,-.29,.29,.57,.82];
const rings=[...new Set([
  ...Array.from({length:53},(_,i)=>-1+2*i/52),
  ...seams.flatMap(t=>[t-.025,t,t+.025]),
])].sort((a,b)=>a-b);
const sides=20,positions=[],colors=[],uvs=[],indices=[];
const crust=new THREE.Color('#D78A36'),light=new THREE.Color('#EFB461'),crumb=new THREE.Color('#F6CE85');
for(let i=0;i<rings.length;i++){
  const t=rings[i],angle=t*1.12;
  const cx=Math.sin(angle),cz=.80*(1-Math.cos(angle));
  const forward=new THREE.Vector3(Math.cos(angle),0,.80*Math.sin(angle)).normalize();
  const lateral=new THREE.Vector3(-forward.z,0,forward.x);
  for(let j=0;j<=sides;j++){
    const phi=j/sides*Math.PI*2,up=Math.cos(phi),side=Math.sin(phi);
    const distance=Math.min(...seams.map(s=>Math.abs(t-s)));
    const groove=Math.exp(-Math.pow(distance/.020,2));
    const profile=Math.pow(Math.max(0,Math.cos(t*Math.PI/2)),.78);
    const radius=(.014+.385*profile)*(1-.16*groove);
    const h=radius*(up<0?up*.68:up);
    positions.push(cx+lateral.x*radius*side, h+.04*profile,cz+lateral.z*radius*side);
    uvs.push(i/(rings.length-1),j/sides);
    const baked=crust.clone().lerp(light,THREE.MathUtils.clamp(.38-.48*up,0,1));
    baked.lerp(crumb,Math.min(.90,groove*.90));
    const mottling=1+.026*Math.sin(t*47+side*15)*Math.sin(up*23+t*17);
    baked.multiplyScalar(mottling);
    colors.push(baked.r,baked.g,baked.b);
  }
}
for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++){
  const a=i*(sides+1)+j,b=a+sides+1;
  indices.push(a,a+1,b,b,a+1,b+1);
}
// Close both tiny tapered ends; maintain one watertight surface.
for(const end of [0,rings.length-1]){
  const start=end*(sides+1),centre=positions.length/3;
  const p=new THREE.Vector3();
  for(let j=0;j<sides;j++)p.add(new THREE.Vector3().fromArray(positions,(start+j)*3));
  p.divideScalar(sides);positions.push(...p.toArray());colors.push(...new THREE.Color('#C87A2D').toArray());uvs.push(end?1:0,.5);
  for(let j=0;j<sides;j++)indices.push(centre,start+(end?j:j+1),start+(end?j+1:j));
}
const geometry=new THREE.BufferGeometry();
geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
geometry.computeBoundingBox();
const box=geometry.boundingBox,size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
const dims=[.26,.17,.22],p=geometry.attributes.position;
for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++){
  p.array[i*3+axis]=(p.array[i*3+axis]-centre.getComponent(axis))/size.getComponent(axis)*dims[axis];
}
geometry.computeVertexNormals();
// The UV seam is duplicated for export; average its normals to keep the join invisible.
const normal=geometry.attributes.normal;
for(let i=0;i<rings.length;i++){
  const a=i*(sides+1),b=a+sides;
  const n=new THREE.Vector3().fromBufferAttribute(normal,a).add(new THREE.Vector3().fromBufferAttribute(normal,b)).normalize();
  normal.setXYZ(a,n.x,n.y,n.z);normal.setXYZ(b,n.x,n.y,n.z);
}
const data={
  revision:1,units:'metres',axes:'Three.js Y-up; front +Z',dimensions:dims,
  description:'Curved, tapered croissant with six recessed roll seams, baked crust and lighter dough folds. No texture download.',
  positions:Array.from(p.array),normals:Array.from(normal.array),colors,uvs,indices,
};
await fs.writeFile('assets/specs/croissant-mesh.json',JSON.stringify(data)+'\n');
console.log(JSON.stringify({vertices:p.count,triangles:indices.length/3,dimensions:dims}));
