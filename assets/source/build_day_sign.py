"""Editable sidewalk sign with three interchangeable themed faces."""
import sys, math, json, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
from croissant import croissant

SOURCE=ROOT/'assets/source';OUT=ROOT/'public/assets/days';OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'evidence/day-themes';EVIDENCE.mkdir(parents=True,exist_ok=True)
spec_path=ROOT/'assets/specs/day-themes.json';spec=json.loads(spec_path.read_text())
support=json.loads((ROOT/'assets/specs/sign-supports.json').read_text())
face=json.loads((ROOT/'assets/specs/sign-face.json').read_text())
def point(v):return (v[0],-v[2],v[1])
def size(v):return (v[0],v[2],v[1])
reset()
wood=material('Sign warm oak',(.52,.32,.16),rough=.65)
cream=material('Sign cream lettering',(.96,.90,.71),rough=.7)
dark=material('Sign clock ink',(.12,.22,.19),rough=.7)
root=empty(spec['board']['root']);root['contract']='day-themes-v1'
root['decoration_only']=True
root['support_revision']=support['revision']
root['face_revision']=face['revision']
# Keep a front/rear A-frame; thinner legs follow the outer edges of the side frames.
for x in [-support['frameX'],support['frameX']]:
    for side in ['front','rear']:
        z=support['frontZ'] if side=='front' else support['rearZ']
        foot=support['floorY']
        for _ in range(6):
            foot=support['floorY']+support['radius']*abs(support['hingeZ']-z)/math.hypot(support['hingeY']-foot,support['hingeZ']-z)
        leg=rod('sign.leg.'+side+'.'+str(x),(x,-z,foot),(x,-support['hingeZ'],support['hingeY']),support['radius'],wood,root)
        leg['support_side']=side
    cylinder('sign.hinge.'+str(x),(x,-support['hingeZ'],support['hingeY']),.048,support['hingeLength'],dark,root,axis='X')
box('sign.back',point(face['back']['centre']),size(face['back']['size']),wood,root)
for x in [-.375,.375]:box('sign.frame.'+str(x),(x,-.055,.70),(.055,.095,.87),wood,root)
for z in [.265,1.135]:box('sign.rail.'+str(z),(0,-.055,z),(.80,.095,.065),wood,root)
text('sign.brand','CORNER MART',(0,-face['textZ'],1.025),.062,cream,root)
themes={}
for key,t in spec['themes'].items():
    parent=empty('theme.'+key,parent=root);themes[key]=parent
    rgb=tuple(int(t['accent'][i:i+2],16)/255 for i in [1,3,5])
    panel=material('Sign '+key,rgb,rough=.8)
    box('sign.panel.'+key,point(face['panel']['centre']),size(face['panel']['size']),panel,parent,bevel=.012)
    text('sign.title.'+key,t['signTitle'],(0,-face['textZ'],.895),.082,cream,parent)
    text('sign.detail.'+key,t['signDetail'],(0,-face['textZ'],.36),.047,cream,parent)
    box('sign.rule.'+key,(0,-face['ruleZ'],.83),(.49,.009,.009),cream,parent,bevel=.002)
    if key=='breakfast':
        cylinder('sign.can',(-.16,-face['canZ'],.60),.065,.23,cream,parent,vertices=24)
        box('sign.can.label',(-.16,-face['canLabelZ'],.61),(.075,.006,.07),panel,parent,bevel=.005)
        loaf=croissant('sign.bread',point(face['croissant']['centre']),size(face['croissant']['size']),parent)
        loaf.rotation_euler.x=face['croissant']['rotationX']
    elif key=='hot':
        cylinder('sign.sun',(.17,-face['sunZ'],.65),.09,.025,cream,parent,axis='Y',vertices=32)
        for i in range(8):
            a=i*math.pi/4
            rod('sign.sun.ray.'+str(i),(.17+math.cos(a)*.12,-face['sunRayZ'],.65+math.sin(a)*.12),(.17+math.cos(a)*.16,-face['sunRayZ'],.65+math.sin(a)*.16),.009,cream,parent)
        cylinder('sign.cold.cup',(-.15,-face['coldCupZ'],.59),.07,.22,cream,parent,vertices=24)
        rod('sign.cold.straw',(-.16,-face['coldCupZ'],.69),(-.12,-face['coldCupZ'],.80),.01,cream,parent)
    else:
        cylinder('sign.clock',(0,-face['clockZ'],.62),.165,.035,cream,parent,axis='Y',vertices=48)
        for i in range(12):
            a=i*math.pi/6
            sphere('sign.clock.tick.'+str(i),(math.sin(a)*.137,-face['clockTickZ'],.62+math.cos(a)*.137),(.011,.007,.011),dark,parent)
        rod('sign.clock.minute',(0,-face['clockHandZ'],.62),(0,-face['clockHandZ'],.735),.011,dark,parent)
        rod('sign.clock.hour',(0,-face['clockHandZ'],.62),(.073,-face['clockHandZ'],.585),.014,dark,parent)
bpy.context.view_layer.update()
corners=[o.matrix_world@Vector(c) for o in root.children_recursive if o.type=='MESH' for c in o.bound_box]
size=[max(p[i] for p in corners)-min(p[i] for p in corners) for i in range(3)]
assert size[0]<=.83 and size[1]<=.56 and size[2]<=1.20, size
export_glb(OUT/'day-sign.glb',[root]);deduplicate(OUT/'day-sign.glb')
studio(.7);camera((1.75,-3.0,1.65),(0,0,.62),1.52);configure_render(560,620,24)
for key,parent in themes.items():
    for other,group in themes.items():
        for o in group.children_recursive:o.hide_render=other!=key
    bpy.context.scene.render.filepath=str(OUT/(key+'.png'))
    bpy.ops.render.render(write_still=True)
for key,group in themes.items():
    collection=bpy.data.collections.new('Face - '+key);bpy.context.scene.collection.children.link(collection)
    for o in [group,*group.children_recursive]:
        for old in list(o.users_collection):old.objects.unlink(o)
        collection.objects.link(o)
        o.hide_render=key!='breakfast'
    collection.hide_viewport=key!='breakfast'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'day-sign.blend'))
write_json(OUT/'spec.json',spec)
write_json(EVIDENCE/'sign-contract.json',{'blender':bpy.app.version_string,'source':'day-sign.blend','root':root['asset_id'],'contract':root['contract'],
    'theme_nodes':list('theme.'+key for key in themes),'dimensions_blender':size,'placement_three':spec['board']['placement'],
    'spec_sha256':hashlib.sha256(spec_path.read_bytes()).hexdigest(),'glb_bytes':(OUT/'day-sign.glb').stat().st_size})
print('DAY SIGN COMPLETE')
