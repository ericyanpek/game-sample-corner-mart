"""Editable Blender actions and interaction props; original v1/v2 sources stay intact."""
import sys, math, re, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
from checkout_payment import payment_pose
from croissant import croissant, refresh_shelf_bread

SOURCE=ROOT/"assets/source"
ASSETS=ROOT/"public/assets"
EVIDENCE=ROOT/"evidence/polish"
EVIDENCE.mkdir(parents=True,exist_ok=True)
def pt(x,y,z): return (x,-z,y)
def cube(name,pos,size,mat,parent,bevel=.008):
    return box(name,pt(*pos),(size[0],size[2],size[1]),mat,parent,bevel)
def group(name,parent=None): return empty(name,parent=parent)
originals={n:hashlib.sha256((SOURCE/n).read_bytes()).hexdigest() for n in ["shop-v1.blend","shop-v2.blend","character.blend"]}

# Reopen existing characters, keep rigid pivots and add editable action ranges.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/"character.blend"))
actor=bpy.data.objects["customer"]
joints=[bpy.data.objects[k+"."+s] for k in ["arm","leg"] for s in ["left","right"]]
joint_locations={o.name:o.location.copy() for o in joints}
for o in joints: o.animation_data_clear()
for side in ["left","right"]:
    empty("hold."+side,pt(0,-.29,.012),bpy.data.objects["arm."+side])
clips=[]
s=bpy.context.scene
s.render.fps=24;s.frame_start=0;s.frame_end=184
for index,name in enumerate(["Walk","Wait","PickUp","Pay","Carry","Stock"]):
    start=index*32
    s.timeline_markers.new(name,frame=start)
    clips.append({"name":name,"start":start,"end":start+25,"fps":24})
    for f in range(25):
        t=f/24;wave=math.sin(t*math.tau);reach=math.sin(math.pi*t)**.8
        poses={"arm.left":-.12,"arm.right":-.30,"leg.left":0,"leg.right":0}
        if name in ["Walk","Carry"]:
            poses.update({"leg.left":.38*wave,"leg.right":-.38*wave,"arm.left":-.12-.23*wave})
        if name=="Wait": poses["arm.left"]=-.12-.04*wave
        if name=="PickUp": poses["arm.left"]=-.12-1.75*reach
        if name=="Pay": poses["arm.left"]=payment_pose(reach)[0]
        if name=="Carry": poses.update({"arm.left":-1.12,"arm.right":-1.12})
        if name=="Stock": poses.update({"arm.left":-1.12-.85*reach,"arm.right":-1.12})
        for o in joints:
            o.location=joint_locations[o.name]
            if name=="Pay" and o.name=="arm.left":
                _, forward, upward = payment_pose(reach)
                o.location.y-=forward
                o.location.z+=upward
            o.rotation_euler=(poses[o.name],0,0)
            o.keyframe_insert("rotation_euler",frame=start+f)
            o.keyframe_insert("location",frame=start+f)
    s.frame_set(start)
s.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"character-actions.blend"))
export_glb(ASSETS/"character-actions.glb",[actor],True)
write_json(ASSETS/"actions.json",clips)

# Basket origin is the top grip; its body hangs below the hand.
reset()
sage=material("Basket sage",(.16,.39,.30),0,.56)
cream=material("Basket trim",(.86,.77,.53),0,.58)
carton=material("Delivery kraft",(.54,.32,.14),0,.85)
tape=material("Carton tape",(.79,.59,.32),0,.70)
red=material("Drink coral",(.80,.22,.09),.15,.35)
metal=material("Can silver",(.63,.70,.68),.7,.3)
gold=material("Bread gold",(.86,.52,.15),0,.83)
leaf=material("Fruit green",(.22,.39,.08),0,.7)
card=material("Payment ivory",(.9,.86,.69),.05,.4)
basket=group("prop.basket")
cube("basket.base",(0,-.28,0),(.34,.028,.25),sage,basket)
for x in [-.16,.16]:
    cube("basket.side",(x,-.20,0),(.025,.17,.25),sage,basket)
    rod("basket.handle",pt(x,-.13,0),pt(x,0,0),.012,cream,basket)
for z in [-.116,.116]:
    for y in [-.25,-.20,-.15]: cube("basket.rail",(0,y,z),(.34,.022,.022),sage,basket)
    for x in [-.11,-.055,0,.055,.11]: cube("basket.rib",(x,-.20,z),(.015,.16,.02),sage,basket)
rod("basket.grip",pt(-.16,0,0),pt(.16,0,0),.014,cream,basket)
boxroot=group("prop.carton")
cube("carton.body",(0,0,0),(.43,.31,.33),carton,boxroot)
cube("carton.tape",(0,.159,0),(.072,.01,.33),tape,boxroot,.001)
cube("carton.label",(0,.015,.168),(.20,.10,.008),card,boxroot,.002)
for x in [-.10,.10]: cube("carton.mark",(x,.06,.174),(.018,.06,.004),sage,boxroot,.001)
can=group("prop.drinks")
cylinder("drink.can",pt(0,0,0),.067,.20,red,can,vertices=16)
cylinder("drink.lid",pt(0,.103,0),.064,.008,metal,can,vertices=16)
cube("drink.label",(0,0,.066),(.07,.065,.004),card,can,.001)
bread=group("prop.bread")
croissant("bread.loaf",size=(.26,.17,.17),parent=bread)
fruit=group("prop.fruit")
sphere("fruit.apple",pt(0,0,0),(.087,.087,.087),red,fruit)
cube("fruit.stem",(0,.102,0),(.016,.04,.016),leaf,fruit)
pay=group("prop.card")
cube("card.body",(0,0,0),(.095,.009,.06),card,pay,.005)
cube("card.chip",(-.024,.006,0),(.018,.004,.017),gold,pay,.001)
roots=[basket,boxroot,can,bread,fruit,pay]
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"interaction-props.blend"))
export_glb(ASSETS/"interaction-props.glb",roots)
deduplicate(ASSETS/"interaction-props.glb")

# Give each actual shelf item its own visibility root, preserving shelf edits.
unit_counts={}
for version in ["v1","v2"]:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/f"shop-{version}.blend"))
    refresh_shelf_bread()
    root=bpy.data.objects["corner.shop"]
    for p,pattern in [("drinks",r"^Can(?: lid| label)? (\d+)$"),("bread",r"^Loaf(?: score)? (\d+)(?: -?\d+)?$"),("fruit",r"^Fruit(?: stem)? (\d+)$")]:
        units={}
        for batch in range(4):
            parent=bpy.data.objects[f"stock.{p}.{batch}"]
            for o in list(parent.children):
                match=re.match(pattern,o.name)
                if not match: raise ValueError(f"Unmapped stock mesh: {o.name}")
                index=int(match.group(1))
                if index not in units:
                    units[index]=empty(f"unit.{p}.{index}",parent=parent)
                    units[index]["unit_index"]=index
                # Parent and new unit both have identity transforms.
                o.parent=units[index]
        assert len(units)==24
        unit_counts[f"{version}.{p}"]=len(units)
    bpy.data.objects["nav.delivery"].location=pt(1.65,0,2.15)
    bpy.data.objects["nav.checkout"].location=pt(-1.7,0,.49)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f"shop-actions-{version}.blend"))
    export_glb(ASSETS/f"shop-{version}.glb",[root])
    deduplicate(ASSETS/f"shop-{version}.glb")
assert originals=={n:hashlib.sha256((SOURCE/n).read_bytes()).hexdigest() for n in originals}
write_json(EVIDENCE/"asset-checks.json",{"blender":bpy.app.version_string,"clips":clips,"units":unit_counts,"original_sources_unchanged":True,"original_sha256":originals,"props":[o for o in ["basket","carton","drinks","bread","fruit","card"]]})
print("INTERACTION ASSETS COMPLETE")
