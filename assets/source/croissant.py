"""Editable shared croissant mesh and baked vertex colors. Coordinates here are Blender Z-up."""
import json, re
from helpers import *

def croissant(name, loc=(0,0,0), size=(.26,.22,.17), parent=None):
    recipe=json.loads((ROOT/"assets/specs/croissant-mesh.json").read_text())
    scale=(size[0]/.26,size[1]/.22,size[2]/.17)
    coords=recipe["positions"]
    vertices=[(coords[i]*scale[0],-coords[i+2]*scale[1],coords[i+1]*scale[2]) for i in range(0,len(coords),3)]
    indices=recipe["indices"]
    faces=[tuple(indices[i:i+3]) for i in range(0,len(indices),3)]
    mesh=bpy.data.meshes.new(name+" editable dough")
    mesh.from_pydata(vertices,[],faces);mesh.update()
    uv=mesh.uv_layers.new(name="UVMap")
    color=mesh.color_attributes.new(name="bake_color",type="FLOAT_COLOR",domain="CORNER")
    for loop in mesh.loops:
        i=loop.vertex_index
        uv.data[loop.index].uv=recipe["uvs"][i*2:i*2+2]
        color.data[loop.index].color=(*recipe["colors"][i*3:i*3+3],1)
    mat=material("Croissant baked crust",(1,1,1),rough=.78)
    nodes=mat.node_tree.nodes
    attribute=nodes.get("Croissant bake colors") or nodes.new("ShaderNodeVertexColor")
    attribute.name="Croissant bake colors";attribute.layer_name="bake_color"
    mat.node_tree.links.new(attribute.outputs["Color"],nodes.get("Principled BSDF").inputs["Base Color"])
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    obj.location=loc
    finish(obj,name,mat,parent,smooth=True)
    obj["visual_revision"]="croissant-v1"
    return obj

def refresh_shelf_bread():
    """Update reopened legacy scenes without resetting shelf positions or stock roots."""
    for obj in list(bpy.data.objects):
        if re.match(r"^Loaf score \d+",obj.name):
            bpy.data.objects.remove(obj,do_unlink=True)
        elif re.fullmatch(r"Loaf \d+",obj.name) and obj.get("visual_revision")!="croissant-v1":
            name=obj.name;transform=obj.matrix_local.copy();parent=obj.parent
            replacement=croissant(name+".replacement",parent=parent)
            replacement.matrix_local=transform
            bpy.data.objects.remove(obj,do_unlink=True)
            replacement.name=name;replacement["asset_id"]=name
