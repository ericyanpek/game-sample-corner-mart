"""Reassemble the existing editable shop and shelf; layout JSON is the shared contract."""
import sys,json,math,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
SOURCE=ROOT/'assets/source';OUT=ROOT/'public/assets/layouts';OUT.mkdir(parents=True,exist_ok=True)
SPEC_PATH=ROOT/'assets/specs/layouts.json';SPEC=json.loads(SPEC_PATH.read_text())
unchanged={name:hashlib.sha256((SOURCE/name).read_bytes()).hexdigest() for name in ['shop-actions-v1.blend','drink-shelf-chilled.blend']}
records=[]
def pt(x,y,z):return (x,-z,y)
def game(v):return [round(v.x,6),round(v.z,6),round(-v.y,6)]
for name,layout in SPEC['presets'].items():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'shop-actions-v1.blend'))
    remove=set()
    for o in bpy.context.scene.objects:
        if any(o.get('asset_id','').startswith(prefix) for prefix in ['shelf.drinks','stock.drinks','label.drinks','stop.drinks']):remove.update([o,*o.children_recursive])
    for o in remove:bpy.data.objects.remove(o,do_unlink=True)
    with bpy.data.libraries.load(str(SOURCE/'drink-shelf-chilled.blend'),link=False) as (available,loaded):loaded.objects=list(available.objects)
    root=next(o for o in loaded.objects if o and o.get('asset_id')=='asset.drinks')
    for o in [root,*root.children_recursive]:
        bpy.context.scene.collection.objects.link(o)
        if o.animation_data:o.animation_data_clear()
    root.parent=bpy.data.objects['corner.shop'];root.location=pt(layout['drinks']['position'][0],0,layout['drinks']['position'][1]);root.rotation_euler.z=layout['drinks']['yaw']
    for o in root.children_recursive:
        if o.get('asset_id','').startswith('door.drinks.'):o.rotation_euler.z=0
    # Runtime-only clearance and routing markers are editable empties, excluded from beauty renders.
    nav=empty('layout.navigation');nav['layout_id']=name;nav['spec_sha256']=hashlib.sha256(SPEC_PATH.read_bytes()).hexdigest()
    for key in ['entrance','checkout','delivery']:
        p=SPEC[key];bpy.data.objects['nav.'+key].location=pt(p[0],0,p[1])
    access={}
    for product in ['drinks','bread','fruit']:
        pose=layout[product];x,z=pose['position'];a=pose['yaw'];ax=x+math.sin(a)*SPEC['accessLocal'][1];az=z+math.cos(a)*SPEC['accessLocal'][1]
        access[product]=[round(ax,6),round(az,6)]
        o=empty('access.'+product,pt(ax,.03,az),nav);o.empty_display_type='CIRCLE';o.empty_display_size=SPEC['actorRadius'];o['role']='shared shopper/restock station'
    for i,p in enumerate(layout['waiting']):
        o=empty('wait.'+str(i),pt(p[0],.03,p[1]),nav);o.empty_display_type='CIRCLE';o.empty_display_size=SPEC['actorRadius']
    for product in ['drinks','bread','fruit']:
        pose=layout[product];o=empty('collision.'+product,pt(pose['position'][0],.88,pose['position'][1]),nav);o.empty_display_type='CUBE';o.empty_display_size=1;o.scale=(.74,.45,.88);o.rotation_euler.z=pose['yaw'];o['role']='navigation footprint'
    bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    stop=next(o for o in root.children_recursive if o.get('asset_id')=='stop.drinks')
    local=game(root.matrix_world.inverted()@stop.matrix_world.translation)
    assert all(abs(a-b)<1e-5 for a,b in zip(local,[0,0,1]))
    fixture=next(o for o in root.children_recursive if o.get('asset_id')=='shelf.drinks')
    corners=[o.matrix_world@Vector(c) for o in fixture.children_recursive if o.type in {'MESH','FONT'} for c in o.bound_box]
    bounds=[[min(game(c)[i] for c in corners),max(game(c)[i] for c in corners)] for i in range(3)]
    expected=[.90,1.48] if name=='supply' else [1.48,.90]
    assert abs(bounds[0][1]-bounds[0][0]-expected[0])<1e-4
    assert abs(bounds[2][1]-bounds[2][0]-expected[1])<1e-4
    bpy.context.scene.camera.location=(8,-10,9);bpy.context.scene.camera.rotation_euler=(Vector((0,0,.6))-bpy.context.scene.camera.location).to_track_quat('-Z','Y').to_euler();bpy.context.scene.camera.data.ortho_scale=9.6
    configure_render(1100,860,24);bpy.context.scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('layout-'+name+'.blend')))
    bpy.ops.render.render(write_still=True)
    records.append({'id':name,'source':'layout-'+name+'.blend','root_position':game(root.matrix_world.translation),'yaw':layout['drinks']['yaw'],'asset_stop_world':game(stop.matrix_world.translation),'access':access,'closed_bounds_game':bounds,'local_stop_preserved':True})
assert unchanged=={n:hashlib.sha256((SOURCE/n).read_bytes()).hexdigest() for n in unchanged}
write_json(OUT/'spec.json',SPEC)
write_json(ROOT/'evidence/layouts/blender-contract.json',{'blender':bpy.app.version_string,'spec_sha256':hashlib.sha256(SPEC_PATH.read_bytes()).hexdigest(),'records':records,'original_sources_unchanged':unchanged})
print('LAYOUT ASSEMBLY COMPLETE')
