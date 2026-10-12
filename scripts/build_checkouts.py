from pathlib import Path
import os,subprocess,time,json,datetime
ROOT=Path(__file__).resolve().parents[1]
binary=os.environ.get("BLENDER_BIN","blender")
folder=ROOT/"evidence/checkouts";folder.mkdir(parents=True,exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
command=[binary,"--background","--factory-startup","--python-exit-code","1","--python",str(ROOT/"assets/source/build_checkouts.py")]
started=time.monotonic();log=folder/f"blender-{stamp}.log"
with log.open("w") as f:result=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
record={"at":stamp,"seconds":round(time.monotonic()-started,2),"exit_code":result.returncode,"log":str(log.relative_to(ROOT)),"scope":"Blender subprocess only"}
with (folder/"executions.jsonl").open("a") as f:f.write(json.dumps(record)+"\n")
print(json.dumps(record,indent=2))
if result.returncode:print(log.read_text()[-5000:])
raise SystemExit(result.returncode)
