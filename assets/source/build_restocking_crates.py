"""Reopen the original carton; preserve its pivot and size across product variants."""
import sys,json,hashlib,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
from croissant import croissant
SOURCE=ROOT/'assets/source';OUT=ROOT/'public/assets/restocking';OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'evidence/restocking';EVIDENCE.mkdir(parents=True,exist_ok=True)
original=SOURCE/'interaction-props.blend';before=hashlib.sha256(original.read_bytes()).hexdigest()
spec_path=ROOT/'assets/specs/restocking.json';spec=json.loads(spec_path.read_text())
records=[]
for product,settings in spec['products'].items():
    bpy.ops.wm.open_mainfile(filepath=str(original))
    root=bpy.data.objects['prop.carton'];root.name=settings['root'];root['asset_id']=settings['root']
    root['contract']=spec['contract'];root['goods']=product
    for obj in list(root.children_recursive):
        if obj.name.startswith(('carton.label','carton.mark')):bpy.data.objects.remove(obj,do_unlink=True)
    color=material('Crate '+product,settings['color'],rough=.72)
    cream=material('Crate ivory',(.94,.85,.65),rough=.7)
    for obj in root.children_recursive:
        if obj.type=='MESH' and obj.name.startswith('carton.body'):
            obj.data.materials.clear();obj.data.materials.append(color)
    # Paired badges make the product legible while the helper turns around.
    for side,angle in [('front',0),('back',math.pi)]:
        face=empty('badge.'+side,parent=root);face.rotation_euler.z=angle
        box('badge.plate.'+side,(0,-.172,0),(.29,.012,.23),cream,face,bevel=.01)
        text('badge.text.'+side,settings['label'],(0,-.182,-.083),.033,color,face)
        if product=='drinks':
            cylinder('badge.can.'+side,(0,-.195,.018),.033,.098,color,face,vertices=20)
            box('badge.can.band.'+side,(0,-.230,.018),(.038,.005,.025),cream,face,.003)
            cylinder('badge.can.lid.'+side,(0,-.195,.070),.033,.006,cream,face,vertices=20)
        elif product=='bread':
            loaf=croissant('badge.loaf.'+side,(0,-.191,.022),(.162,.082,.026),face)
            loaf.rotation_euler.x=math.pi/2
        else:
            sphere('badge.apple.'+side,(0,-.202,.018),(.047,.023,.047),color,face)
            rod('badge.stem.'+side,(0,-.207,.056),(.014,-.207,.079),.004,color,face)
    bpy.context.view_layer.update()
    assert all(abs(v)<1e-7 for v in root.location), list(root.location)
    export_glb(OUT/('crate-'+product+'.glb'),[root]);deduplicate(OUT/('crate-'+product+'.glb'))
    for obj in bpy.context.scene.objects:obj.hide_render=True
    for obj in [root,*root.children_recursive]:obj.hide_render=False
    floor=material('Review floor',(.27,.33,.30),rough=1)
    box('Review floor',(0,0,-.184),(200,200,.025),floor,bevel=0)
    area('Crate key',(1,-2,3),(0,0,0),240,2)
    area('Crate fill',(-2,1,2),(0,0,0),160,2,(.75,.86,1))
    camera((.72,-1,.52),(0,0,0),.68);configure_render(640,540,24)
    bpy.context.scene.render.filepath=str(OUT/('crate-'+product+'.png'))
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('restock-crate-'+product+'.blend')))
    bpy.ops.render.render(write_still=True)
    records.append({'product':product,'root':root['asset_id'],'pivot':list(root.location),'glb_bytes':(OUT/('crate-'+product+'.glb')).stat().st_size})
assert before==hashlib.sha256(original.read_bytes()).hexdigest()
write_json(OUT/'spec.json',spec)
write_json(EVIDENCE/'crate-contract.json',{'blender':bpy.app.version_string,'original_unchanged':True,'original_sha256':before,'spec_sha256':hashlib.sha256(spec_path.read_bytes()).hexdigest(),'crates':records})
print('RESTOCK CRATES COMPLETE')
