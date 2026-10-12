"""Two compact counters parallel to the window wall, using one editable asset."""
import sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
SPEC=json.loads((ROOT/"assets/specs/checkouts.json").read_text())
OUT=ROOT/"public/assets/checkouts";OUT.mkdir(parents=True,exist_ok=True)
def pt(x,y,z):return (x,-z,y)
def cube(name,pos,size,mat,parent,bevel=.01):
    return box(name,pt(*pos),(size[0],size[2],size[1]),mat,parent,bevel)
reset()
sage=material("Counter sage",(.17,.34,.26),0,.6)
light=material("Counter inset",(.37,.53,.40),0,.65)
wood=material("Counter oak",(.57,.34,.14),0,.58)
cream=material("Counter ivory",(.9,.86,.72),0,.6)
dark=material("Counter charcoal",(.052,.13,.12),0,.65)
screen=material("POS screen",(.11,.34,.37),.1,.35)
root=empty("asset.checkout");root["contract"]=SPEC["contract"]
shift=SPEC["height"]-.89
body_ratio=(SPEC["height"]-.09)/.8
# Shorten the cabinet only. Preserve the top, terminal and badge proportions.
body=cube("counter.body",(0,.4*body_ratio,0),(1.06,.8,.55),sage,root,.06)
body.scale.z=body_ratio
front=cube("counter.front",(0,.43*body_ratio,.282),(.9,.47,.025),light,root,.025)
front.scale.z=body_ratio
cube("counter.top",(0,.85+shift,0),(1.15,.08,.62),wood,root,.024)
cube("counter.scan",(.2,.898+shift,.02),(.42,.016,.43),dark,root,.008)
cube("terminal.foot",(-.33,.918+shift,-.09),(.23,.04,.17),dark,root)
cube("terminal.neck",(-.33,1.0+shift,-.09),(.05,.14,.045),dark,root)
cube("terminal.back",(-.33,1.10+shift,-.09),(.27,.20,.035),dark,root,.018)
cube("terminal.display",(-.33,1.10+shift,-.111),(.225,.16,.009),screen,root,.006)
for y in [1.065,1.1,1.135]:cube("terminal.line",(-.35,y+shift,-.118),(.13,.007,.003),cream,root,.001)
cube("counter.card.reader",(.44,.923+shift,.16),(.13,.05,.12),dark,root,.01)
cube("counter.logo",(0,.49*body_ratio,.298),(.20,.13,.015),cream,root,.014)
for x in [-.043,.043]:cube("logo.shelf",(x,.49*body_ratio,.308),(.020,.078,.004),sage,root,.002)
cube("logo.bar",(0,.49*body_ratio,.308),(.11,.018,.004),sage,root,.002)
for i,slot in enumerate(SPEC["itemSlots"]):empty("checkout.item."+str(i),pt(*slot),root)
empty("checkout.customer",pt(0,0,.85),root)
empty("checkout.employee",pt(0,0,-.6),root)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"assets/source/checkout-counter.blend"))
export_glb(OUT/"counter.glb",[root]);optimized=deduplicate(OUT/"counter.glb")
# Review both authored placements and retain employee/customer anchors in Blender.
objects=[root,*root.children_recursive]
for key,station in SPEC["stations"].items():
    copies={}
    for o in objects:
        cp=o.copy();bpy.context.collection.objects.link(cp);copies[o]=cp
    for old,cp in copies.items():cp.parent=copies.get(old.parent)
    r=copies[root];r.name="checkout."+key;r["station"]=key
    r.location=pt(station["position"][0],0,station["position"][1]);r.rotation_euler.z=station["yaw"]
for o in objects:bpy.data.objects.remove(o,do_unlink=True)
studio(1.5);camera((2.8,-4.8,3.2),(-1.6,-1.1,.5),4.3)
configure_render(1000,850,24);bpy.context.scene.render.filepath=str(OUT/"pair.png")
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"assets/source/checkout-pair.blend"))
bpy.ops.render.render(write_still=True)
write_json(ROOT/"evidence/checkouts/blender-contract.json",{"blender":bpy.app.version_string,"contract":SPEC["contract"],"spec":SPEC,"optimized":optimized})
print("WALL CHECKOUTS COMPLETE")
