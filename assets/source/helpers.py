"""Small, inspectable Blender helpers; run through Blender, not ordinary Python."""
from pathlib import Path
import bpy
import math
import json
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def reset():
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1


def material(name, color, metal=0, rough=.45, emission=0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    m.diffuse_color = (*color[:3], 1)
    p.inputs["Base Color"].default_value = (*color[:3], 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if emission:
        p.inputs["Emission Color"].default_value = (*color[:3], 1)
        p.inputs["Emission Strength"].default_value = emission
    return m


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o["asset_id"] = name
    return o


def finish(o, name, mat=None, parent=None, bevel=0, smooth=False):
    o.name = name
    o["asset_id"] = name
    o.parent = parent
    if mat:
        o.data.materials.append(mat)
    if o.type == "MESH":
        if bevel:
            b = o.modifiers.new("Editable edge radius", "BEVEL")
            b.width = bevel
            b.segments = 3
            b = o.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
        if smooth:
            for p in o.data.polygons:
                p.use_smooth = True
    return o


def box(name, loc, size, mat, parent=None, bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.data.transform(__import__("mathutils").Matrix.Diagonal((*size, 1)))
    o.location = loc
    return finish(o, name, mat, parent, bevel)


def sphere(name, loc, size, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16)
    o = bpy.context.object
    o.data.transform(__import__("mathutils").Matrix.Diagonal((*size, 1)))
    o.location = loc
    return finish(o, name, mat, parent, smooth=True)


def cylinder(name, loc, radius, depth, mat, parent=None, axis="Z", vertices=40):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    o = bpy.context.object
    o.location = loc
    if axis == "X":
        o.rotation_euler.y = math.pi / 2
    elif axis == "Y":
        o.rotation_euler.x = math.pi / 2
    return finish(o, name, mat, parent, bevel=.004, smooth=True)


def rod(name, a, b, radius, mat, parent=None):
    a, b = Vector(a), Vector(b)
    o = cylinder(name, (a+b)/2, radius, (b-a).length, mat, parent)
    o.rotation_euler = (b-a).to_track_quat("Z", "Y").to_euler()
    return o


def text(name, words, loc, size, mat, parent=None, rotation=(math.pi/2, 0, 0)):
    c = bpy.data.curves.new(name, "FONT")
    c.body = words
    c.size = size
    c.extrude = .0008
    c.align_x = "CENTER"
    o = bpy.data.objects.new(name, c)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rotation
    c.materials.append(mat)
    return o


def camera(loc, target, ortho=6, name="Review camera"):
    bpy.ops.object.camera_add(location=loc)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (Vector(target)-o.location).to_track_quat("-Z", "Y").to_euler()
    o.data.type = "ORTHO"
    o.data.ortho_scale = ortho
    o.data.lens = 45
    bpy.context.scene.camera = o
    return o


def area(name, loc, target, power=500, size=4, color=(1, .86, .72)):
    bpy.ops.object.light_add(type="AREA", location=loc)
    o = bpy.context.object
    o.name = name
    o.data.energy = power
    o.data.shape = "DISK"
    o.data.size = size
    o.data.color = color
    o.rotation_euler = (Vector(target)-o.location).to_track_quat("-Z", "Y").to_euler()
    return o


def configure_render(width=960, height=720, samples=32):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x = width
    s.render.resolution_y = height
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "PNG"
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    s.world = s.world or bpy.data.worlds.new("World")
    s.world.use_nodes = True
    s.world.node_tree.nodes["Background"].inputs[0].default_value = (.30, .37, .46, 1)
    s.world.node_tree.nodes["Background"].inputs[1].default_value = .35
    devices = []
    try:
        p = bpy.context.preferences.addons["cycles"].preferences
        p.compute_device_type = "METAL"
        p.get_devices()
        for d in p.devices:
            d.use = d.type == "METAL"
            devices.append({"name": d.name, "type": d.type, "enabled": d.use})
        s.cycles.device = "GPU" if any(d["enabled"] for d in devices) else "CPU"
    except Exception as e:
        s.cycles.device = "CPU"
        devices.append({"fallback_reason": str(e)})
    return devices


def studio(scale=1):
    floor = material("Studio warm grey", (.22, .26, .27))
    box("Studio floor", (0, 0, -.04), (200, 200, .08), floor, bevel=0)
    area("Large warm softbox", (3*scale, -4*scale, 6*scale), (0, 0, scale), 600*scale**2, 4*scale)
    area("Cool rim softbox", (-3*scale, 2*scale, 4*scale), (0, 0, scale), 450*scale**2, 3*scale, (.65, .80, 1))


def snapshot():
    bpy.context.view_layer.update()
    result = {}
    deps = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        if o.type not in {"MESH", "EMPTY", "ARMATURE", "CURVE", "FONT"}:
            continue
        entry = {
            "type": o.type, "parent": o.parent.name if o.parent else None,
            "location": [round(v, 6) for v in o.location],
            "dimensions": [round(v, 6) for v in o.dimensions],
            "rotation_euler": [round(v, 6) for v in o.rotation_euler],
            "scale": [round(v, 6) for v in o.scale],
            "materials": [m.name for m in o.data.materials if m] if hasattr(o.data, "materials") else [],
            "mesh_data": o.data.name if o.type == "MESH" else None,
        }
        if o.type == "MESH":
            corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
            entry["world_dimensions"] = [round(max(c[i] for c in corners)-min(c[i] for c in corners), 6) for i in range(3)]
            ev = o.evaluated_get(deps)
            mesh = ev.to_mesh()
            mesh.calc_loop_triangles()
            entry["triangles_evaluated"] = len(mesh.loop_triangles)
            ev.to_mesh_clear()
        result[o.name] = entry
    return result


def save_render(folder, name, render=True):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    s = bpy.context.scene
    s.render.filepath = str(folder / (name+".png"))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / (name+".blend")))
    write_json(folder / (name+".scene.json"), snapshot())
    if render:
        bpy.ops.render.render(write_still=True)


def export_glb(path, roots=None, animation=False):
    bpy.ops.object.select_all(action="DESELECT")
    selected = set()
    def collect(o):
        selected.add(o)
        for c in o.children:
            collect(c)
    if roots:
        for o in roots:
            collect(o)
    else:
        selected = {o for o in bpy.context.scene.objects if o.type not in {"CAMERA", "LIGHT"} and not o.name.startswith("Studio")}
    # The exporter supports meshes, not Blender font objects. Convert export-only copies.
    temp = []
    for o in list(selected):
        if o.type in {"FONT", "CURVE"}:
            mesh = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            copy = bpy.data.objects.new(o.name+"_export", mesh)
            bpy.context.collection.objects.link(copy)
            copy.parent = o.parent
            copy.matrix_world = o.matrix_world.copy()
            selected.remove(o)
            selected.add(copy)
            temp.append(copy)
    for o in selected:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_extras=True, export_apply=True,
        export_animations=animation, export_animation_mode="SCENE",
        export_frame_range=True, export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_lights=False, export_cameras=False,
    )
    for o in temp:
        bpy.data.objects.remove(o, do_unlink=True)
    if roots and any(o.name == "workshop" for o in roots):
        from optimize_gltf import deduplicate
        import shutil
        (ROOT/"evidence").mkdir(exist_ok=True)
        shutil.copy2(path, ROOT/"evidence"/(Path(path).stem+"-raw.glb"))
        write_json(ROOT/"evidence"/(Path(path).stem+"-export.json"),deduplicate(path))
