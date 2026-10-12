"""Reopen the existing basket; widen it and add two reusable item mounting points."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from mathutils import Matrix
from optimize_gltf import deduplicate
SOURCE=ROOT/'assets/source';OUT=ROOT/'public/assets/shopping';OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'evidence/shopping-lists';EVIDENCE.mkdir(parents=True,exist_ok=True)
source=SOURCE/'interaction-props.blend';before=hashlib.sha256(source.read_bytes()).hexdigest()
spec_path=ROOT/'assets/specs/shopping.json';spec=json.loads(spec_path.read_text());contract=spec['basket']
bpy.ops.wm.open_mainfile(filepath=str(source))
basket=bpy.data.objects['prop.basket']
for o in bpy.context.scene.objects:o.hide_render=True
for o in [basket,*basket.children_recursive]:o.hide_render=False
scale=Matrix.Diagonal((contract['width']/.34,contract['depth']/.25,1,1))
for o in list(basket.children):o.matrix_world=scale@o.matrix_world
basket['slot_contract']='shopping-v1';basket['capacity']=2
for slot in contract['slots']:
    x,y,z=slot['position'];o=empty(slot['id'],(x,-z,y),basket);o.empty_display_type='SPHERE';o.empty_display_size=.015;o['role']='item bottom anchor'
bpy.context.view_layer.update()
path=OUT/'basket.glb';export_glb(path,[basket]);deduplicate(path)
# Full, editable review composition using the existing individual product models.
for index,product in enumerate(['drinks','bread']):
    o=bpy.data.objects['prop.'+product];o.scale=(contract['itemScale'][product],)*3
    for child in [o,*o.children_recursive]:child.hide_render=False
    bpy.context.view_layer.update()
    corners=[child.matrix_world@Vector(c) for child in o.children_recursive if child.type=='MESH' for c in child.bound_box]
    x,y,z=contract['slots'][index]['position'];o.location=(x,-z,y-min(v.z for v in corners))
mat=material('Review warm floor',(.28,.33,.31),0,1)
box('Review floor',(0,0,-.306),(20,20,.025),mat,bevel=0)
area('Basket key',(1,-2,3),(0,0,-.14),240,2)
area('Basket fill',(-2,1,2),(0,0,-.14),160,2,(.75,.86,1))
camera((.65,-1,.62),(0,0,-.12),.76);configure_render(720,620,24)
bpy.context.scene.render.filepath=str(OUT/'basket.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'shopping-basket.blend'))
bpy.ops.render.render(write_still=True)
anchors={slot['id']:[round(v,6) for v in bpy.data.objects[slot['id']].location] for slot in contract['slots']}
for slot in contract['slots']:
    x,y,z=slot['position'];assert all(abs(a-b)<1e-6 for a,b in zip(anchors[slot['id']],[x,-z,y]))
assert before==hashlib.sha256(source.read_bytes()).hexdigest()
write_json(EVIDENCE/'basket-contract.json',{'blender':bpy.app.version_string,'source':'shopping-basket.blend','slots_blender':anchors,'root':basket['asset_id'],'capacity':basket['capacity'],'spec_sha256':hashlib.sha256(spec_path.read_bytes()).hexdigest(),'original_source_sha256':before,'original_unchanged':True,'glb_bytes':path.stat().st_size})
write_json(OUT/'spec.json',spec)
print('SHOPPING BASKET COMPLETE')
