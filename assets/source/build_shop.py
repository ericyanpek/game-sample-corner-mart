"""Create editable shop and articulated character, then export browser assets."""
import sys, math, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
from croissant import croissant

OUT=Path(__file__).resolve().parents[2]
SOURCE=OUT/"assets/source"
ASSETS=OUT/"public/assets"
EVIDENCE=OUT/"evidence"
for p in [ASSETS,EVIDENCE]:p.mkdir(parents=True,exist_ok=True)

def pt(x,y,z):return (x,-z,y)
def group(name,x=0,y=0,z=0,parent=None,**extras):
    o=empty(name,pt(x,y,z),parent)
    for k,v in extras.items():o[k]=v
    return o
def cube(name,pos,size,mat,parent,bevel=.018):
    x,y,z=pos;w,h,d=size
    return box(name,pt(x,y,z),(w,d,h),mat,parent,bevel)
def ball(name,pos,size,mat,parent):
    return sphere(name,pt(*pos),(size[0],size[2],size[1]),mat,parent)
def tube(name,pos,radius,depth,mat,parent):
    return cylinder(name,pt(*pos),radius,depth,mat,parent,vertices=16)
def label(name,words,pos,size,mat,parent):
    return text(name,words,pt(*pos),size,mat,parent,rotation=(math.pi/2,0,0))
def save_source(name):
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+".blend")))
def export(name,root,animation=False):
    path=ASSETS/(name+".glb")
    export_glb(path,[root],animation)
    if not animation:write_json(EVIDENCE/(name+"-export.json"),deduplicate(path))
def mesh_triangles():
    n=0;deps=bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        if o.type=="MESH":
            ev=o.evaluated_get(deps);m=ev.to_mesh();m.calc_loop_triangles();n+=len(m.loop_triangles);ev.to_mesh_clear()
    return n

reset()
cream=material("Warm plaster",(.77,.72,.56),0,.83)
white=material("Ivory",(.90,.86,.72),0,.6)
tile=material("Terrazzo cream",(.64,.65,.53),0,.85)
tile2=material("Terrazzo accent",(.57,.61,.51),0,.85)
green=material("Shelf sage",(.17,.34,.26),.05,.48)
greenlight=material("Soft sage",(.37,.53,.40),0,.65)
orange=material("Sign tangerine",(.77,.29,.11),0,.58)
navy=material("Lettering charcoal",(.052,.13,.12),0,.62)
wood=material("Honey oak",(.57,.34,.14),0,.58)
glass=material("Window soft blue",(.23,.51,.55),.28,.22)
red=material("Fruit coral",(.77,.16,.055),0,.48)
yellow=material("Golden bread",(.82,.51,.16),0,.67)
metal=material("Brushed metal",(.48,.56,.53),.65,.3)
root=group("corner.shop")
static=group("store.static",parent=root)
cube("Foundation",(0,-.10,0),(6.25,.20,5.3),greenlight,static,.07)
# Tiled floor and a short pavement in front of the cutaway shop.
for ix in range(8):
    for iz in range(7):
        cube(f"floor.tile.{ix}.{iz}",(-2.73+ix*.78,.01,-2.19+iz*.73),(.77,.045,.72),tile2 if (ix+iz)%7==0 else tile,static,.005)
cube("Pavement",(0,-.07,3.02),(6.5,.12,1.15),white,static,.035)
for x in [-2.9,-1.7,-.5,.7,1.9,3.1]:cube(f"Pavement joint {x}",(x,-.003,3.02),(.014,.005,1.07),tile,static,0)
cube("Wall back",(0,1.22,-2.54),(6.2,2.44,.15),cream,static,.025)
cube("Wall left",(-3.04,1.22,0),(.15,2.44,5.1),cream,static,.025)
cube("Wall back lower",(0,.38,-2.445),(6.05,.75,.035),greenlight,static,.005)
cube("Wall left lower",(-2.945,.38,0),(.035,.75,5),greenlight,static,.005)
cube("Back moulding",(0,.78,-2.41),(6.08,.07,.065),white,static,.006)
cube("Left moulding",(-2.91,.78,0),(.065,.07,5),white,static,.006)
cube("Back top",(0,2.43,-2.50),(6.28,.10,.21),white,static,.012)
cube("Left top",(-3.0,2.43,0),(.21,.10,5.1),white,static,.012)
# Signboard and windows make the room read as a small store.
cube("Store sign board",(0,2.0,-2.39),(3.2,.56,.12),green,static,.06)
label("Store sign","CORNER  MART",(0,1.92,-2.30),.28,white,static)
label("Store sign caption","EVERYDAY GOODS  /  GOOD NEIGHBOURS",(0,1.77,-2.30),.066,white,static)
for z in [.20,1.52]:
    cube(f"Window {z}",(-2.94,1.59,z),(.045,.98,1.05),glass,static,.01)
    for zz in [z-.56,z+.56]:cube(f"Window stile {zz}",(-2.89,1.59,zz),(.08,1.10,.065),white,static,.008)
    for y in [1.05,2.12]:cube(f"Window rail {z} {y}",(-2.89,y,z),(.08,.065,1.17),white,static,.008)
    cube(f"Window centre {z}",(-2.86,1.59,z),(.065,1.04,.04),white,static,.004)
# Low decorative entrance markers preserve the view into the shop.
cube("Door mat",(2.35,.044,2.30),(1.1,.035,.48),green,static,.02)
label("Pavement title","OPEN DAILY",(-.15,.015,3.2),.20,orange,static).rotation_euler=(0,0,0)
for x,z in [(-2.53,2.12),(2.85,-2.18)]:
    tube(f"Planter {x}",(x,.17,z),.17,.32,orange,static)
    for j in range(6):
        angle=j*math.tau/6
        leaf=ball(f"Leaf {x} {j}",(x+math.cos(angle)*.11,.50+j*.035,z+math.sin(angle)*.11),(.11,.24,.07),green if j%2 else greenlight,static)
        leaf.rotation_euler.y=.5*math.cos(angle)
# Checkout desk, belt, screen, bags.
cube("Checkout base",(-1.9,.43,1.1),(1.5,.86,.68),green,static,.08)
cube("Checkout front panel",(-1.9,.47,.749),(1.27,.52,.028),greenlight,static,.025)
cube("Checkout top",(-1.9,.90,1.1),(1.65,.10,.78),wood,static,.03)
cube("Checkout belt",(-1.56,.958,1.1),(.60,.02,.53),navy,static,.01)
cube("Terminal stand",(-2.3,1.045,1.07),(.07,.18,.08),metal,static,.012)
screen=cube("Terminal screen",(-2.3,1.19,1.07),(.28,.20,.05),navy,static,.022)
cube("Terminal display",(-2.3,1.19,1.038),(.235,.155,.008),glass,static,.007)
for i in range(3):
    cube("Paper bags "+str(i),(-2.35+i*.12,.99,1.37),(.10,.16,.10),cream,static,.01)
label("Checkout lettering","THANK YOU",(-1.9,.49,.725),.11,white,static)
# Shelf groups have stable IDs and remain separate from visibility-controlled stock.
for p,x,title in [("drinks",-1.9,"COOL DRINKS"),("bread",0,"DAILY BREAD"),("fruit",1.9,"FRESH PICKS")]:
    shelf=group("shelf."+p,parent=root,product=p)
    cube(p+".plinth",(x,.095,-1.67),(1.45,.16,.79),green,shelf,.035)
    cube(p+".back",(x,.77,-2.06),(1.45,1.4,.075),greenlight,shelf,.02)
    for side in [-1,1]:
        cube(p+".side."+str(side),(x+side*.68,.79,-1.7),(.085,1.39,.77),green,shelf,.018)
    for level in range(3):
        y=.21+level*.43
        cube(p+".shelf."+str(level),(x,y,-1.69),(1.35,.065,.70),wood,shelf,.012)
        cube(p+".lip."+str(level),(x,y+.025,-1.325),(1.36,.09,.045),white,shelf,.006)
        label(p+".price."+str(level),["05","07","09"][["drinks","bread","fruit"].index(p)],(x+.44,y+.005,-1.295),.060,navy,shelf)
    cube(p+".header",(x,1.51,-1.70),(1.46,.25,.78),green,shelf,.025)
    label(p+".name",title,(x,1.455,-1.295),.092,white,shelf)
    group("label."+p,x,1.86,-1.65,parent=root)
    group("stop."+p,x,0,-.7,parent=root)
    for batch in range(4):
        stock=group(f"stock.{p}.{batch}",parent=root)
        for i in range(6):
            index=batch*6+i;col=index%4;level=(index//4)%3;row=index//12
            xx=x-.48+col*.32;yy=.26+level*.43;zz=-1.47-row*.34
            if p=="drinks":
                tube(f"Can {index}",(xx,yy+.13,zz),.083,.24,red if index%2 else glass,stock)
                tube(f"Can lid {index}",(xx,yy+.255,zz),.077,.012,metal,stock)
                cube(f"Can label {index}",(xx,yy+.13,zz+.080),(.095,.09,.008),white,stock,.004)
            elif p=="bread":
                croissant(f"Loaf {index}",pt(xx,yy+.09,zz),parent=stock)
            else:
                ball(f"Fruit {index}",(xx,yy+.10,zz),(.095,.095,.095),red if index%2 else yellow,stock)
                cube(f"Fruit stem {index}",(xx,yy+.205,zz),(.017,.046,.017),wood,stock,.003)
group("nav.entrance",2.55,0,2.8,parent=root)
group("nav.aisle",2.5,0,-.1,parent=root)
group("nav.checkout",-1.7,0,.35,parent=root)
group("nav.delivery",-2.6,0,1.95,parent=root)
area("Warm key",(4,-5,8),(0,0,0),1600,6)
area("Soft fill",(-4,1,6),(0,0,0),950,5,(.77,.88,1))
camera((8,-10,9),(0,0,.6),9.6)
configure_render(1440,1100,40)
bpy.context.scene.render.filepath=str(EVIDENCE/"shop-v1.png")
save_source("shop-v1")
bpy.ops.render.render(write_still=True)
export("shop-v1",root)
before=snapshot()
# Deliberate reopen + targeted revision. Source objects and semantic IDs remain.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/"shop-v1.blend"))
root=bpy.data.objects["corner.shop"]
shelf=bpy.data.objects["shelf.drinks"]
# Scale the shelf around its centre while keeping navigation and stock separate.
for o in shelf.children:
    o.location.x=-1.9+(o.location.x+1.9)*1.10
    o.scale.x*=1.10
v2=material("Drink shelf terracotta",(.70,.24,.09),.05,.48)
for o in shelf.children:
    if hasattr(o.data,"materials"):
        for i,m in enumerate(o.data.materials):
            if m and m.name=="Shelf sage":o.data.materials[i]=v2
bpy.context.view_layer.update()
after=snapshot()
checks={
    "stable_names_preserved":set(before)==set(after),
    "non_drinks_shelf_objects_unchanged":all(before[k]==after[k] for k in before if before[k]["parent"]!="shelf.drinks"),
    "drinks_shelf_plinth_width_plus_ten_percent":abs(after["drinks.plinth"]["world_dimensions"][0]-before["drinks.plinth"]["world_dimensions"][0]*1.1)<1e-5,
    "navigation_anchors_preserved":all(before[k]==after[k] for k in before if k.startswith(("stop.","nav."))),
    "semantic_product_id_preserved":shelf["product"]=="drinks",
}
save_source("shop-v2")
bpy.context.scene.render.filepath=str(EVIDENCE/"shop-v2.png");bpy.ops.render.render(write_still=True)
export("shop-v2",root)
write_json(EVIDENCE/"asset-edit-checks.json",{"checks":checks,"change":"Reopen source, widen drinks shelf 10%, replace frame material only","before_width":before["drinks.plinth"]["world_dimensions"][0],"after_width":after["drinks.plinth"]["world_dimensions"][0]})
assert all(checks.values()),checks

# Separate editable character; rigid pivots avoid relying on the earlier fox skin.
reset()
skin=material("Skin",(.67,.40,.24),0,.67)
jacket=material("Jacket",(.65,.30,.12),0,.68)
hair=material("Hair",(.09,.075,.045),0,.85)
trousers=material("Trousers",(.10,.19,.22),0,.8)
shoe=material("Shoes",(.13,.17,.13),0,.75)
ivory=material("Character ivory",(.87,.84,.68),0,.7)
eye=material("Eyes",(.015,.035,.03),0,.5)
actor=group("customer")
cube("body",(0,.54,0),(.35,.34,.24),jacket,actor,.09)
cube("shirt",(0,.62,.121),(.075,.16,.012),ivory,actor,.008)
ball("head",(0,.85,0),(.155,.175,.145),skin,actor)
ball("hair cap",(0,.955,-.025),(.158,.095,.145),hair,actor)
for x in [-.055,.055]:ball("eye."+str(x),(x,.864,.135),(.016,.021,.010),eye,actor)
ball("nose",(0,.834,.146),(.024,.031,.025),skin,actor)
for side,x in [("left",-.085),("right",.085)]:
    leg=group("leg."+side,x,.37,0,actor)
    cube("leg.mesh."+side,(0,-.13,0),(.125,.25,.135),trousers,leg,.035)
    cube("shoe."+side,(0,-.31,.027),(.145,.105,.21),shoe,leg,.028)
    arm=group("arm."+side,x*2.55,.67,0,actor)
    cube("arm.mesh."+side,(0,-.13,0),(.105,.25,.14),jacket,arm,.036)
    ball("hand."+side,(0,-.29,.012),(.058,.065,.06),skin,arm)
s=bpy.context.scene;s.render.fps=24;s.frame_start=1;s.frame_end=25
for f in range(1,26,2):
    phase=(f-1)/24*math.tau
    for side,sign in [("left",1),("right",-1)]:
        for kind,amp in [("leg",.40),("arm",-.28)]:
            o=bpy.data.objects[kind+"."+side];o.rotation_euler.x=sign*amp*math.sin(phase);o.keyframe_insert("rotation_euler",frame=f)
studio(.8);camera((2.1,-3.5,2.0),(0,0,.48),1.8);configure_render(720,720,32)
save_source("character")
s.render.filepath=str(EVIDENCE/"character.png");bpy.ops.render.render(write_still=True)
export("character",actor,True)
write_json(EVIDENCE/"build-assets.json",{
    "blender":bpy.app.version_string,"source":"Procedural assets authored in current session",
    "files":{p.name:p.stat().st_size for p in ASSETS.glob("*.glb")},
    "character_animation":"Four rigid joint tracks, one second, no deforming skin",
    "limitations":["Simple walk cycle; no planted-foot IK","Navigation uses authored waypoints, not full avoidance"]
})
print("CORNER SHOP ASSETS COMPLETE")
