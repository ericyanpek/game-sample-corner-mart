"""Reopen the existing shop; expand architecture without scaling game assets."""
import sys, json, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *
from optimize_gltf import deduplicate
from door_mat import adjust_door_mat
from croissant import refresh_shelf_bread

SOURCE = ROOT / "assets/source"
OUT = ROOT / "public/assets/rooms"
OUT.mkdir(parents=True, exist_ok=True)
ROOM = json.loads((ROOT / "assets/specs/room.json").read_text())
LAYOUT = json.loads((ROOT / "assets/specs/layouts.json").read_text())
CHECKOUTS = json.loads((ROOT / "assets/specs/checkouts.json").read_text())
scale = ROOM["horizontalScale"]
def pt(x, y, z): return Vector((x, -z, y))
def bounds(objects):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    points = [o.matrix_world @ Vector(c) for original in objects if original.type in {"MESH", "FONT"}
              for o in [original.evaluated_get(deps)] for c in o.bound_box]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    return {"min": [low[0], low[2], -high[1]], "max": [high[0], high[2], -low[1]],
            "size": [high[0]-low[0], high[2]-low[2], high[1]-low[1]]}

originals = {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()
             for name in ["shop-actions-v1.blend", "shop-actions-v2.blend", "character-wardrobe.blend", "checkout-counter.blend"]}
records = []
for version in ["v1", "v2"]:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE / f"shop-actions-{version}.blend"))
    refresh_shelf_bread()
    root = bpy.data.objects["corner.shop"]
    root["room_revision"] = ROOM["revision"]
    static = bpy.data.objects["store.static"]
    before = bounds([bpy.data.objects["Foundation"]])
    # Obsolete furniture must not be stretched with the architecture.
    for o in list(static.children):
        if (o.get("asset_id") or o.name).startswith(("Checkout ", "Terminal ", "Paper bags ", "Planter -2.53", "Leaf -2.53")):
            bpy.data.objects.remove(o, do_unlink=True)
    static.scale = (scale, scale, 1)
    adjust_door_mat(static)
    # Bread/fruit stock, labels and fixtures have separate semantic roots.
    # Translate those roots once, preserving every mesh dimension and item mount.
    for product, original in ROOM["originalFixturePositions"].items():
        pose = LAYOUT["presets"]["aisle"][product]["position"]
        delta = pt(pose[0]-original[0], 0, pose[1]-original[1])
        for o in list(root.children):
            if o.get("asset_id", "").startswith(tuple(prefix+"."+product for prefix in ["shelf", "stock", "unit", "label", "stop"])):
                o.location += delta
    for key in ["entrance", "checkout", "delivery"]:
        p = LAYOUT[key]
        bpy.data.objects["nav."+key].location = pt(p[0], 0, p[1])
    for product in ["bread", "fruit"]:
        x,z = LAYOUT["presets"]["aisle"][product]["position"]
        bpy.data.objects["stop."+product].location = pt(x, 0, z+LAYOUT["accessLocal"][1])
    bpy.context.scene.frame_set(1)
    after = bounds([bpy.data.objects["Foundation"]])
    left = max(bounds([o])["max"][0] for o in static.children
               if o.get("asset_id", "").startswith(("Wall left", "Left moulding", "Window"))
               and bounds([o])["min"][1] < 1.18)
    back = max(bounds([o])["max"][2] for o in static.children
               if o.get("asset_id", "").startswith(("Wall back", "Back moulding")))
    assert LAYOUT["bounds"][0]-LAYOUT["actorRadius"] >= left-1e-5
    assert LAYOUT["bounds"][2]-LAYOUT["actorRadius"] >= back-1e-5
    assert abs(after["size"][0]/before["size"][0]-scale) < 1e-5
    assert abs(after["size"][2]/before["size"][2]-scale) < 1e-5
    records.append({"version": version, "foundation_before": before, "foundation_after": after,
                    "bread_fixture": bounds([bpy.data.objects["shelf.bread"], *bpy.data.objects["shelf.bread"].children_recursive]),
                    "perimeter_inner_faces": {"left_with_window_trim": left, "back_with_moulding": back},
                    "employee_corridor_at_window_trim": CHECKOUTS["stations"]["main"]["position"][0]-CHECKOUTS["footprint"][1]/2-left})
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f"shop-spacious-{version}.blend"))
    glb = OUT / f"spacious-{version}.glb"
    export_glb(glb, [root])
    records[-1]["export"] = deduplicate(glb)

# Capture the actual evaluated body envelope, not a guessed radius from a screenshot.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE / "character-wardrobe.blend"))
bpy.context.scene.frame_set(32)
actor = bpy.data.objects["customer"]
character = bounds([actor, *actor.children_recursive])
assert originals == {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() for name in originals}
write_json(ROOT / "evidence/space/blender-contract.json", {
    "blender": bpy.app.version_string, "room": ROOM, "records": records,
    "character_all_variants_wait_pose": character, "original_sources_unchanged": originals,
    "navigation": LAYOUT, "checkouts": CHECKOUTS,
})
print("SPACIOUS ROOM EXPORTED")
