"""Three interchangeable drink fixtures from one inspectable specification."""
import sys, math, json, hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate

SOURCE=ROOT/"assets/source"
OUT=ROOT/"public/assets/shelves"
EVIDENCE=ROOT/"evidence/shelf-upgrades"
for p in [OUT,EVIDENCE]:p.mkdir(parents=True,exist_ok=True)
spec_path=ROOT/"assets/specs/drink-shelves.json"
SPEC=json.loads(spec_path.read_text());CONTRACT=SPEC["contract"]
def pt(x,y,z):return (x,-z,y)
def cube(name,pos,size,mat,parent,bevel=.012):
    return box(name,pt(*pos),(size[0],size[2],size[1]),mat,parent,bevel)
def group(name,parent=None,pos=(0,0,0)):
    return empty(name,pt(*pos),parent)
def label(name,words,pos,size,mat,parent):
    return text(name,words,pt(*pos),size,mat,parent,rotation=(math.pi/2,0,0))
def clear():
    for o in bpy.context.scene.objects:o.hide_viewport=False;o.hide_set(False)
    reset()
def mats():
    return {
      "oak":material("Family oak",(.56,.34,.16),0,.72),
      "oak_light":material("Family light oak",(.74,.53,.28),0,.74),
      "cream":material("Family cream",(.87,.84,.69),0,.58),
      "sage":material("Family sage",(.20,.40,.30),.06,.48),
      "deep":material("Family forest",(.07,.22,.17),.14,.42),
      "coral":material("Family terracotta",(.78,.27,.10),0,.51),
      "silver":material("Brushed aluminium",(.59,.68,.65),.70,.34),
      "warm":material("Warm LED strip",(.99,.77,.33),0,.3,2.5),
      "cold":material("Cool LED strip",(.56,.91,.87),0,.3,2.1),
      "juice":material("Bottle jade",(.15,.47,.38),.06,.23),
    }
def can(parent,m,name="regular"):
    root=group(name,parent)
    cylinder("can.body",pt(0,.12,0),.062,.21,m["coral"],root,vertices=16)
    cylinder("can.lid",pt(0,.229,0),.060,.008,m["silver"],root,vertices=16)
    cube("can.label",(0,.12,.062),(.07,.07,.003),m["cream"],root,.001)
    return root
def bottle(parent,m,name="premium"):
    root=group(name,parent)
    cylinder("bottle.body",pt(0,.105,0),.062,.17,m["juice"],root,vertices=16)
    sphere("bottle.shoulder",pt(0,.188,0),(.062,.062,.035),m["juice"],root)
    cylinder("bottle.neck",pt(0,.225,0),.033,.055,m["juice"],root,vertices=16)
    cylinder("bottle.cap",pt(0,.261,0),.037,.024,m["oak_light"],root,vertices=16)
    cube("bottle.label",(0,.11,.062),(.073,.086,.004),m["cream"],root,.003)
    cube("bottle.mark",(0,.115,.065),(.037,.04,.003),m["sage"],root,.002)
    return root

records=[]
for tier in SPEC["tiers"]:
    clear();m=mats();tid=tier["id"]
    root=group(CONTRACT["root_id"]);root["product"]="drinks";root["tier"]=tid;root["capacity"]=tier["capacity"]
    root["family"]=SPEC["family"];root["spec_sha256"]=hashlib.sha256(spec_path.read_bytes()).hexdigest()
    fixture=group("shelf.drinks",root);fixture["product"]="drinks"
    shell=group("shelf.drinks.shell",fixture)
    frame=m["oak"] if tid==0 else m["sage"] if tid==1 else m["deep"]
    cube("common.plinth",(0,.06,0),(1.48,.12,.90),frame,shell,.025)
    cube("common.header",(0,1.67,0),(1.48,.18,.84),frame,shell,.025)
    label("common.brand","CORNER SIPS",(0,1.64,.428),.105,m["cream"],shell)
    if tid==0:
        # Butt the posts against the plinth/header; overlapping outer faces shimmer.
        for x in [-.69,.69]:cube("oak.upright",(x,.85,0),(.10,1.46,.79),m["oak_light"],shell)
        for x in [-.55,-.275,0,.275,.55]:cube("oak.back.slat",(x,.86,-.36),(.255,1.40,.045),m["oak"],shell,.006)
        for x in [-.69,.69]:
            for y in [.34,.79,1.24]:cube("oak.dowel",(x,y,.398),(.027,.027,.006),m["oak"],shell,.005)
    else:
        cube("display.back",(0,.87,-.37),(1.32,1.50,.07),m["cream"],shell)
        for x in [-.69,.69]:cube("display.side",(x,.85,0),(.10,1.46,.82),frame,shell,.019)
    levels=tier["levels"];heights=[.22,.65,1.08] if tid<2 else [.18,.52,.86,1.20]
    for level,y in enumerate(heights):
        cube("deck."+str(level),(0,y,0),(1.31,.045,.73),m["oak_light"] if tid==0 else m["cream"],shell,.008)
        cube("price.rail."+str(level),(0,y+.011,.37),(1.29,.064,.036),m["oak"] if tid==0 else frame,shell,.004)
        for col in range(4):
            cube("price.tag",(-.48+col*.32,y+.015,.394),(.10,.036,.005),m["cream"],shell,.002)
        if tid==1:
            cube("led.warm."+str(level),(0,y+.043,.410),(1.23,.018,.012),m["warm"],shell,.003)
    if tid==1:
        cube("led.canopy",(0,1.567,.37),(1.23,.025,.024),m["warm"],shell,.004)
    if tid==2:
        for x in [-.621,.621]:cube("led.cold."+str(x),(x,.88,.31),(.022,1.37,.025),m["cold"],shell,.003)
        for x in [-.43,-.29,-.15,-.01,.13,.27,.41]:cube("vent",(x,.10,.444),(.083,.028,.004),m["sage"],shell,.004)
        glass=material("Door clear glass",(.69,.88,.84),0,.16)
        glass.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value=.13
        glass.diffuse_color=(.69,.88,.84,.13)
        glass.surface_render_method="DITHERED"
        for side,sign in [("left",1),("right",-1)]:
            pivot=group("door.drinks."+side,fixture,(-sign*.68,0,.408))
            pivot["open_degrees"]=-sign*SPEC["door_open_degrees"]
            centre=sign*.338
            # Glass stays separate so transparent and opaque pieces sort correctly.
            cube("door.glass."+side,(centre,.87,0),(.60,1.36,.012),glass,pivot,.003)
            for x in [0,sign*.676]:cube("door.stile."+side,(x,.87,0),(.036,1.48,.028),m["sage"],pivot,.008)
            for y in [.145,1.595]:cube("door.rail."+side,(centre,y,0),(.676,.034,.030),m["sage"],pivot,.007)
            cube("door.handle."+side,(sign*.606,.91,.026),(.025,.29,.022),m["silver"],pivot,.006)
    group("stop.drinks",root,tuple(CONTRACT["stop_local"]))
    group("label.drinks",root,tuple(CONTRACT["label_local"]))
    stock=group("stock.drinks",root)
    for i in range(tier["capacity"]):
        col=i%4;level=(i//4)%levels;row=i//(4*levels)
        unit=group(f"unit.drinks.{i}",stock,(-.48+col*.32,heights[level]+.026,.25-row*.235))
        unit["unit_index"]=i
        r=can(unit,m,f"regular.drinks.{i}");r["stock_kind"]="regular"
        if tid==2:
            premium=bottle(unit,m,f"premium.drinks.{i}");premium["stock_kind"]="premium"
            for o in [r,*r.children_recursive]:o.hide_render=True;o.hide_viewport=True
    bpy.context.view_layer.update()
    # Verify semantic anchors and the common mounting envelope before export.
    points={key:[round(v,6) for v in bpy.data.objects[key].location] for key in ["stop.drinks","label.drinks"]}
    plinth=bpy.data.objects["common.plinth"]
    assert all(abs(a-b)<1e-6 for a,b in zip(plinth.dimensions,(*CONTRACT["footprint"],.12)))
    corners=[o.matrix_world@Vector(c) for o in root.children_recursive if o.type in {"MESH","FONT"} for c in o.bound_box]
    bounds=[[min(c[i] for c in corners),max(c[i] for c in corners)] for i in range(3)]
    assert max(abs(v) for v in bounds[0])<=CONTRACT["footprint"][0]/2+1e-5
    assert max(abs(v) for v in bounds[1])<=CONTRACT["footprint"][1]/2+1e-5
    assert bounds[2][0]>=-1e-5 and bounds[2][1]<=CONTRACT["height"]+1e-5
    assert len([o for o in root.children_recursive if o.get("asset_id","").startswith("unit.drinks.")])==tier["capacity"]
    source=SOURCE/f"drink-shelf-{tier['key']}.blend"
    area("Key",(3,-4,6),(0,0,.8),850,4);area("Fill",(-3,1,4),(0,0,.8),450,4,(.72,.85,1))
    camera((2.8,-4.2,2.7),(0,0,.88),2.45);configure_render(640,760,24)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.context.scene.render.filepath=str(OUT/f"{tier['key']}.png")
    bpy.ops.render.render(write_still=True)
    # All stock variants are exported; the game chooses based on the saved SKU.
    for o in root.children_recursive:o.hide_viewport=False;o.hide_render=False
    path=OUT/f"{tier['key']}.glb";export_glb(path,[root]);deduplicate(path)
    records.append({"tier":tid,"key":tier["key"],"capacity":tier["capacity"],"anchor_blender":points,
        "source":source.name,"asset":path.name,"bytes":path.stat().st_size,"root":root["asset_id"],
        "interaction":fixture["asset_id"],"placement":CONTRACT["placement"],"footprint":CONTRACT["footprint"],"closed_geometry_bounds_blender":bounds})
    # Store editable door motion as Blender keyframes in the chilled source.
    if tid==2:
        scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=49;scene.render.fps=24
        for side,sign in [("left",1),("right",-1)]:
            door=bpy.data.objects["door.drinks."+side]
            for f,value in [(1,0),(13,1),(37,1),(49,0)]:
                door.rotation_euler.z=math.radians(-sign*SPEC["door_open_degrees"])*value
                door.keyframe_insert("rotation_euler",frame=f)
        scene.frame_set(1)
        for o in root.children_recursive:
            if o.get("stock_kind")=="regular":
                for part in [o,*o.children_recursive]:part.hide_render=True;part.hide_viewport=True
        bpy.ops.wm.save_as_mainfile(filepath=str(source))

clear();m=mats();p=bottle(None,m,"prop.premium")
# Re-centre the handheld bottle, whose shelf version has a bottom origin.
for o in p.children:o.location.z-=.135
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"premium-drink.blend"))
export_glb(OUT/"premium-drink.glb",[p]);deduplicate(OUT/"premium-drink.glb")
assert all(r["anchor_blender"]==records[0]["anchor_blender"] for r in records)
write_json(OUT/"spec.json",SPEC)
write_json(EVIDENCE/"asset-contract-checks.json",{"spec_sha256":hashlib.sha256(spec_path.read_bytes()).hexdigest(),
    "blender":bpy.app.version_string,"records":records,"checks":{"same_anchor_coordinates":True,
    "same_root_and_interaction_ids":True,"same_mounting_footprint":True,"closed_geometry_within_envelope":True,"capacity_matches_unit_count":True}})
print("SHELF FAMILY COMPLETE")
