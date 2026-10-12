"""Shared waist-height payment gesture, including regeneration from older .blend files."""
import json, math
from pathlib import Path
import bpy

PAYMENT = json.loads((Path(__file__).resolve().parents[1] / "specs/checkouts.json").read_text())["payment"]

def payment_pose(reach):
    return (PAYMENT["restAngle"]-PAYMENT["reachAngle"]*reach,
            PAYMENT["forwardReach"]*reach, PAYMENT["upwardReach"]*reach)

def update_payment_action():
    scene = bpy.context.scene
    frame = scene.frame_current
    scene.frame_set(0)
    arm = bpy.data.objects["arm.left"]
    origin = arm.location.copy()
    for i in range(25):
        angle, forward, upward = payment_pose(math.sin(math.pi*i/24)**.8)
        arm.location = origin
        arm.location.y -= forward
        arm.location.z += upward
        arm.rotation_euler = (angle, 0, 0)
        arm.keyframe_insert("rotation_euler", frame=96+i)
        arm.keyframe_insert("location", frame=96+i)
    scene.frame_set(frame)
