import * as THREE from 'three';
import SPEC from '../assets/specs/characters.json';
export {SPEC as CHARACTER_SPEC};
export type CharacterRole='customer'|'worker'|'cashier';
export type Look=typeof SPEC.customers[number]&{cap?:string;apron?:string};
/** A visual identity from an existing ID: never draw from the simulation RNG. */
export function characterLook(role:CharacterRole,id:number):Look {
  return role==='customer'?SPEC.customers[((id-1)%SPEC.customers.length+SPEC.customers.length)%SPEC.customers.length]:SPEC.staff[role];
}
export function dressCharacter(root:THREE.Object3D,role:CharacterRole,id:number){
  const look=characterLook(role,id),materials=new Map<THREE.Material,THREE.Material>();
  const fields:Record<string,keyof Look>={Skin:'skin',Hair:'hairColor',Jacket:'shirt',Trousers:'trousers',Shoes:'shoes','Outfit trim':'trim','Uniform apron':'apron','Uniform cap':'cap'};
  root.userData.appearance={id:look.id,role,skin:look.skin,hair:look.hair,hairColor:look.hairColor,outfit:look.outfit,shirt:look.shirt,face:look.face,glasses:look.glasses};
  root.traverse(o=>{
    const {appearance_family:family,appearance_option:option}=o.userData;
    if(family)o.visible=family==='accessory'?look.glasses:family==='headwear'?look.outfit===option:(look as unknown as Record<string,unknown>)[family]===option;
    if(family==='hair'&&role!=='customer')o.visible=false;
    if(o instanceof THREE.Mesh){
      o.castShadow=true;o.receiveShadow=true;
      const recolor=(original:THREE.Material)=>{
        const field=fields[original.name],color=field?look[field]:undefined;
        if(typeof color!=='string')return original;
        if(!materials.has(original)){
          const m=original.clone() as THREE.MeshStandardMaterial;m.color.set(color);materials.set(original,m);
        }
        return materials.get(original)!;
      };
      o.material=Array.isArray(o.material)?o.material.map(recolor):recolor(o.material);
      // Keep the same head and rigid rig, but vary facial proportions modestly.
      const key=o.userData.asset_id as string|undefined;
      if(key==='nose')o.scale.setScalar(look.face==='round'?1.22:look.face==='calm'?.85:1);
      if(key?.startsWith('eye.'))o.scale.y=look.face==='round'?1.12:look.face==='calm'?.8:1;
    }
  });
  return [...materials.values()];
}
