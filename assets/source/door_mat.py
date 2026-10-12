"""Keep the original tiled floor and make the entrance mat thin and flush."""
import json
from helpers import ROOT

def adjust_door_mat(static):
    spec = json.loads((ROOT / "assets/specs/door-mat.json").read_text())
    door_mat = next((o for o in static.children if o.get("asset_id") == "Door mat"), None)
    if door_mat:
        low = min(v.co.z for v in door_mat.data.vertices)
        high = max(v.co.z for v in door_mat.data.vertices)
        door_mat.scale.z = spec["thickness"]/(high-low)
        door_mat.location.z = spec["floorY"]-low*door_mat.scale.z
        door_mat["receiveOnly"] = True
