"""Run the base shop generator in background Blender (set BLENDER_BIN to override)."""
from pathlib import Path
import datetime,json,subprocess,time,os
ROOT=Path(__file__).resolve().parents[1]
blender=os.environ.get("BLENDER_BIN","blender")
(ROOT/"evidence").mkdir(exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
log=ROOT/"evidence"/f"blender-{stamp}.log"
command=[blender,"--background","--factory-startup","--python-exit-code","1","--python",str(ROOT/"assets/source/build_shop.py")]
t=time.monotonic()
with log.open("w") as f:
    p=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
record={"started_utc":stamp,"seconds":round(time.monotonic()-t,3),"exit_code":p.returncode,"log":str(log.relative_to(ROOT)),"command":command,"scope":"Blender subprocess only; not model authoring or iteration time"}
with (ROOT/"evidence/executions.jsonl").open("a") as f:f.write(json.dumps(record)+"\n")
print(json.dumps(record,indent=2))
if p.returncode:print(log.read_text()[-7000:])
raise SystemExit(p.returncode)
