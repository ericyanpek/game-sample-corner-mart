"""Extend the existing rigid-joint character; keep all six actions and hand mounts."""
import sys, json, math, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *
from checkout_payment import update_payment_action

SOURCE=ROOT/"assets/source"; OUT=ROOT/"public/assets/characters"
EVIDENCE=ROOT/"evidence/characters"
OUT.mkdir(parents=True,exist_ok=True); EVIDENCE.mkdir(parents=True,exist_ok=True)
SPEC=json.loads((ROOT/"assets/specs/characters.json").read_text())
original=SOURCE/"character-actions.blend"
original_hash=hashlib.sha256(original.read_bytes()).hexdigest()
def pt(x,y,z):return (x,-z,y)
def cube(name,pos,size,mat,parent,bevel=.005):
    return box(name,pt(*pos),(size[0],size[2],size[1]),mat,parent,bevel)
def ball(name,pos,size,mat,parent):
    return sphere(name,pt(*pos),(size[0],size[2],size[1]),mat,parent)
def line(name,points,radius,mat,parent):
    for i,(a,b) in enumerate(zip(points,points[1:])):rod(name+str(i),pt(*a),pt(*b),radius,mat,parent)
def color(value):
    rgb=[int(value[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)

bpy.ops.wm.open_mainfile(filepath=str(original))
update_payment_action()
actor=bpy.data.objects["customer"]; actor["character_contract"]=SPEC["contract"]
for name in ["hair cap","shirt"]:
    bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
skin=bpy.data.materials["Skin"]; hair=bpy.data.materials["Hair"]; eyes=bpy.data.materials["Eyes"]
trim=material("Outfit trim",color("#efd6ab"),0,.8)
apron=material("Uniform apron",color("#255e51"),0,.78)
cap=material("Uniform cap",color("#e3a438"),0,.78)
badge=material("Uniform badge",color("#fff2cd"),0,.65)
metal=material("Glasses frame",color("#463f39"),.2,.55)
variants=[]
def variant(family,name):
    o=empty(family+"."+name,parent=actor);o["appearance_family"]=family;o["appearance_option"]=name;variants.append(o);return o
# Hair silhouettes, visible from both the default overhead camera and a close view.
for name in ["crop","sweep","bob","bun","curly","long"]:
    p=variant("hair",name)
    ball(name+".crown",(0,.961,-.025),(.165,.104,.15),hair,p)
    if name=="crop":
        for x in [-.10,0,.10]:ball("crop.lock",(x,1.008,.03),(.062,.045,.075),hair,p)
    if name=="sweep":
        for x,y in [(-.105,.984),(-.05,1.014),(.025,1.024),(.095,1.013)]:
            o=ball("sweep.lock",(x,y,.07),(.062,.065,.095),hair,p);o.rotation_euler.y=-.25
    if name in ["bob","long"]:
        lower=.855 if name=="bob" else .79
        ball(name+".back",(0,lower,-.09),(.178,.15 if name=="bob" else .21,.095),hair,p)
        for x in [-.145,.145]:ball(name+".side",(x,lower,.006),(.047,.14 if name=="bob" else .19,.11),hair,p)
        cube(name+".fringe",(-.025,.961,.119),(.25,.054,.035),hair,p,.02)
    if name=="bun":
        ball("bun.back",(0,1.024,-.125),(.10,.102,.098),hair,p)
        ball("bun.tie",(0,1.04,-.16),(.071,.035,.071),trim,p)
        ball("bun.top",(0,1.087,-.145),(.076,.065,.077),hair,p)
    if name=="curly":
        for row,(y,r,n) in enumerate([(.96,.145,9),(1.021,.094,7)]):
            for i in range(n):
                a=math.tau*i/n;bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.061,location=pt(math.cos(a)*r,y,math.sin(a)*r-.025))
                finish(bpy.context.object,f"curl.{row}.{i}",hair,p,smooth=True)
        ball("curl.top",(0,1.058,-.025),(.068,.05,.065),hair,p)
# Clothing details attach to the torso, leaving all arm and leg pivots untouched.
for name in ["hoodie","cardigan","vest","stripe","uniform"]:
    p=variant("outfit",name)
    if name=="hoodie":
        ball("hood.back",(0,.69,-.116),(.145,.082,.061),trim,p)
        cube("hood.pocket",(0,.462,.124),(.225,.085,.018),trim,p,.018)
        for x in [-.045,.045]:cube("hood.drawstring",(x,.634,.135),(.012,.098,.012),trim,p)
    elif name=="cardigan":
        cube("cardigan.shirt",(0,.574,.124),(.10,.285,.013),trim,p)
        for y in [.48,.56,.64]:ball("cardigan.button",(.07,y,.135),(.012,.012,.008),badge,p)
    elif name=="vest":
        for x in [-.12,.12]:cube("vest.shoulder",(x,.68,.12),(.07,.11,.027),trim,p,.013)
        cube("vest.zip",(0,.56,.132),(.012,.28,.012),trim,p)
        for x in [-.09,.09]:cube("vest.pocket",(x,.466,.13),(.065,.016,.013),trim,p)
    elif name=="stripe":
        for y in [.465,.545,.625]:cube("shirt.stripe",(0,y,.124),(.29,.034,.014),trim,p,.004)
    else:
        cube("apron.bib",(0,.60,.132),(.235,.23,.024),apron,p,.018)
        cube("apron.skirt",(0,.423,.137),(.36,.20,.03),apron,p,.017)
        cube("apron.back.belt",(0,.477,-.124),(.34,.042,.017),apron,p,.006)
        for x in [-.105,.105]:
            cube("apron.strap",(x,.713,.074),(.041,.038,.15),apron,p,.008)
            cube("apron.back.strap",(x,.597,-.124),(.043,.235,.019),apron,p,.006)
        cube("apron.pocket",(0,.425,.16),(.205,.095,.012),trim,p,.01)
        cube("staff.badge",(.066,.657,.151),(.096,.061,.009),badge,p,.006)
        cube("badge.mark",(.040,.658,.158),(.019,.031,.004),apron,p,.002)
        for y in [.65,.665]:cube("badge.line",(.078,y,.158),(.036,.006,.004),apron,p,.001)
        ball("uniform.hat",(0,1.005,-.021),(.179,.095,.166),cap,p)
        cube("uniform.brim",(0,.974,.14),(.35,.032,.19),cap,p,.02)
        cube("hat.patch",(0,1.029,.132),(.10,.047,.014),badge,p,.008)
# Face cues: ears, brows, mouth and optional rounded glasses.
for side in [-1,1]:ball("ear."+str(side),(side*.151,.849,0),(.030,.049,.038),skin,actor)
for name in ["smile","round","calm"]:
    p=variant("face",name)
    if name=="smile":
        line("smile",[(-.04,.801,.135),(0,.789,.143),(.04,.801,.135)],.006,eyes,p)
    elif name=="round":
        ball("mouth.round",(0,.792,.137),(.016,.012,.007),eyes,p)
    else:line("mouth.calm",[(-.026,.791,.139),(.026,.791,.139)],.005,eyes,p)
    for x in [-.055,.055]:
        line("brow",[(x-.023,.909,.129),(x+.023,.914 if name=="smile" else .909,.129)],.006,hair,p)
p=variant("accessory","glasses")
for x in [-.063,.063]:
    bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,location=pt(x,.868,.15),major_radius=.044,minor_radius=.006)
    o=bpy.context.object;o.rotation_euler.x=math.pi/2;finish(o,"glasses.rim",metal,p,smooth=True)
line("glasses.bridge",[(-.018,.872,.15),(.018,.872,.15)],.005,metal,p)
for side in [-1,1]:line("glasses.arm",[(side*.105,.87,.15),(side*.151,.87,-.004)],.005,metal,p)

bpy.context.scene.frame_set(32)
expected=["hold.left","hold.right","arm.left","arm.right","leg.left","leg.right"]
assert all(bpy.data.objects.get(k) for k in expected)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/SPEC["source"]))
export_glb(OUT/"wardrobe.glb",[actor],True)
optimization={"bytes":(OUT/"wardrobe.glb").stat().st_size,"animation_preserved":True,"static_options_batched_at_runtime":True}
assert hashlib.sha256(original.read_bytes()).hexdigest()==original_hash

# Review actual Blender geometry with the same palette and option contract used in Three.js.
def appearance(root,look):
    for o in [root,*root.children_recursive]:
        family=o.get("appearance_family")
        if family:
            visible=(look.get(family)==o["appearance_option"]) if family!="accessory" else look["glasses"]
            if family=="hair" and look["outfit"]=="uniform":visible=False
            for child in [o,*o.children_recursive]:child.hide_render=not visible
        if o.type=="MESH":
            for i,m in enumerate(o.data.materials):
                field={"Skin":"skin","Hair":"hairColor","Jacket":"shirt","Trousers":"trousers","Shoes":"shoes","Outfit trim":"trim","Uniform apron":"apron","Uniform cap":"cap"}.get(m.name.split(".")[0])
                if field and field in look:o.data.materials[i]=material(m.name+"."+look["id"],color(look[field]),0,.78)
# Apply the default view only after exporting all options and animation.
looks=SPEC["customers"]+[SPEC["staff"]["cashier"],SPEC["staff"]["worker"]]
original_objects=[actor,*actor.children_recursive]
for i,look in enumerate(looks):
    copies={}
    for o in original_objects:
        cp=o.copy()
        if o.data:cp.data=o.data.copy()
        bpy.context.scene.collection.objects.link(cp);cp.animation_data_clear();copies[o]=cp
    for old,cp in copies.items():cp.parent=copies.get(old.parent)
    root=copies[actor];root.location=pt((i%5-2)*.8,0,(i//5)*1.45)
    root.rotation_euler.z=.18 if i<5 else -.18
    appearance(root,look)
for o in original_objects:bpy.data.objects.remove(o,do_unlink=True)
for o in list(bpy.context.scene.objects):
    if o.type in ["CAMERA","LIGHT"] or o.name.startswith("Studio"):bpy.data.objects.remove(o,do_unlink=True)
studio(1.6);camera((3.3,-7,5),(0,-.6,.5),5.1)
configure_render(1400,1000,24);bpy.context.scene.render.filepath=str(OUT/"lineup.png")
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"character-lineup.blend"))
bpy.ops.render.render(write_still=True)
write_json(EVIDENCE/"blender-contract.json",{"blender":bpy.app.version_string,"contract":SPEC["contract"],"customer_looks":len(SPEC["customers"]),"staff_looks":2,"joint_mounts":expected,"original_source_unchanged":True,"original_sha256":original_hash,"optimization":optimization})
print("CHARACTER WARDROBE COMPLETE")
