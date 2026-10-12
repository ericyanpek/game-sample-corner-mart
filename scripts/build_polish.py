"""Rebuild the action update using Blender; keeps original .blend sources."""
from pathlib import Path
import os,subprocess,time,json
ROOT=Path(__file__).resolve().parents[1]
binary=os.environ.get("BLENDER_BIN","blender")
folder=ROOT/"evidence/polish";folder.mkdir(parents=True,exist_ok=True)
command=[binary,"--background","--factory-startup","--python-exit-code","1","--python",str(ROOT/"assets/source/polish_actions.py")]
started=time.monotonic()
with (folder/"blender.log").open("w") as f:
    result=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
record={"seconds":round(time.monotonic()-started,2),"exit_code":result.returncode,"command":command,"scope":"Blender subprocess, excludes authoring and review"}
(folder/"execution.json").write_text(json.dumps(record,indent=2))
print(json.dumps(record,indent=2))
if result.returncode:print((folder/"blender.log").read_text()[-5000:])
raise SystemExit(result.returncode)
