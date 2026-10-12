"""Run in Blender to save a standalone editable croissant and its review render."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from helpers import *
from croissant import croissant
reset()
root=empty("asset.croissant")
croissant("croissant",parent=root)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"assets/source/croissant.blend"))
export_glb(ROOT/"public/assets/croissant.glb",[root])
studio(.15);camera((.28,-.40,.26),(0,0,0),.38);configure_render(720,600,24)
bpy.context.scene.render.filepath=str(ROOT/"evidence/bread-sign/blender-croissant.png")
bpy.ops.render.render(write_still=True)
