"""Derive editable expressions from the wardrobe without altering its joints or source."""
import sys, json, math, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *
from checkout_payment import update_payment_action

SOURCE = ROOT / "assets/source"
OUT = ROOT / "public/assets/characters"
EVIDENCE = ROOT / "evidence/emotions"
EVIDENCE.mkdir(parents=True, exist_ok=True)
SPEC = json.loads((ROOT / "assets/specs/expressions.json").read_text())
LOOKS = json.loads((ROOT / "assets/specs/characters.json").read_text())
original = SOURCE / "character-wardrobe.blend"
original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
def pt(x, y, z): return (x, -z, y)

bpy.ops.wm.open_mainfile(filepath=str(original))
update_payment_action()
bpy.context.scene.frame_set(32)
actor = bpy.data.objects["customer"]
actor["expression_contract"] = SPEC["contract"]
mounts = ["hold.left", "hold.right", "arm.left", "arm.right", "leg.left", "leg.right"]
bpy.context.view_layer.update()
before_mounts = {n: [list(row) for row in bpy.data.objects[n].matrix_world] for n in mounts}
for group in list(actor.children):
    if group.get("appearance_family") == "face":
        for o in list(group.children_recursive): bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.objects.remove(group, do_unlink=True)

# Keep world transforms when introducing a head pivot. Hair, ears and glasses follow it.
head = empty("expression.head", pt(*SPEC["headPivot"]), actor)
bpy.context.view_layer.update()
def reparent(o, parent):
    world = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = world

for o in list(actor.children):
    key = o.get("asset_id", "")
    if key in ["head", "nose"] or key.startswith(("ear.", "eye.")) or o.get("appearance_family") in ["hair", "accessory"]:
        reparent(o, head)
hat = empty("headwear.uniform", parent=actor)
hat["appearance_family"] = "headwear"
hat["appearance_option"] = "uniform"
for name in ["uniform.hat", "uniform.brim", "hat.patch"]: reparent(bpy.data.objects[name], hat)
reparent(hat, head)

ink = bpy.data.materials["Eyes"]
for name, spec in SPEC["faces"].items():
    face = empty("expression." + name, parent=actor)
    face["expression"] = name
    for label, points in [("mouth", spec["mouth"]), ("brow.right", spec["brow"]),
                          ("brow.left", [[-x, y, z] for x, y, z in spec["brow"]])]:
        # Low sided editable tubes retain clear expressions without texture downloads.
        for i, (a, b) in enumerate(zip(points, points[1:])):
            a, b = Vector(pt(*a)), Vector(pt(*b))
            radius = .007 if label == "mouth" else .006
            o = cylinder(f"{name}.{label}.{i}", (a+b)/2, radius, (b-a).length, ink, face, vertices=8)
            o.rotation_euler = (b-a).to_track_quat("Z", "Y").to_euler()
    bpy.context.view_layer.update()
    reparent(face, head)

bpy.context.view_layer.update()
assert before_mounts == {n: [list(row) for row in bpy.data.objects[n].matrix_world] for n in mounts}
# All variants are saved/exported; their visibility is selected per character in the game.
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / SPEC["source"]))
export_glb(OUT / "expressions.glb", [actor], True)
assert hashlib.sha256(original.read_bytes()).hexdigest() == original_hash
write_json(EVIDENCE / "blender-contract.json", {
    "blender": bpy.app.version_string, "contract": SPEC["contract"],
    "source_unchanged": True, "source_sha256": original_hash,
    "hand_and_limb_transforms_unchanged": True, "expressions": list(SPEC["faces"]),
    "previous_bytes": (OUT / "wardrobe.glb").stat().st_size,
    "bytes": (OUT / "expressions.glb").stat().st_size,
})

# A compact review sheet: all four expressions on different existing identities.
objects = [actor, *actor.children_recursive]
for index, (emotion, look) in enumerate(zip(SPEC["faces"], LOOKS["customers"][:4])):
    copies = {}
    for o in objects:
        cp = o.copy()
        if o.data: cp.data = o.data.copy()
        bpy.context.scene.collection.objects.link(cp)
        cp.animation_data_clear()
        copies[o] = cp
    for old, cp in copies.items(): cp.parent = copies.get(old.parent)
    root = copies[actor]
    root.location = pt((index-1.5)*.65, 0, 0)
    for o in [root, *root.children_recursive]:
        family, expr = o.get("appearance_family"), o.get("expression")
        if family or expr:
            visible = expr == emotion if expr else look["glasses"] if family == "accessory" else look.get("outfit" if family == "headwear" else family) == o.get("appearance_option")
            for child in [o, *o.children_recursive]: child.hide_render = not visible
        if o.type == "MESH":
            for i, m in enumerate(o.data.materials):
                field = {"Skin":"skin", "Hair":"hairColor", "Jacket":"shirt", "Trousers":"trousers", "Shoes":"shoes", "Outfit trim":"trim"}.get(m.name.split(".")[0])
                if field:
                    rgb = [int(look[field][j:j+2], 16)/255 for j in (1,3,5)]
                    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
                    o.data.materials[i] = material(m.name+"."+look["id"], linear, 0, .78)
for o in objects: bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.context.scene.objects):
    if o.type in ["CAMERA", "LIGHT"] or o.name.startswith("Studio"): bpy.data.objects.remove(o, do_unlink=True)
studio()
camera((0,-6,1.6), (0,0,.79), 2.7)
configure_render(1400,580,16)
bpy.context.scene.render.filepath = str(EVIDENCE / "expressions.png")
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE / "expression-review.blend"))
bpy.ops.render.render(write_still=True)
print("EXPRESSION ASSET COMPLETE")
