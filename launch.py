"""Open the built local game, or an editable Blender source."""
from pathlib import Path
import argparse,functools,http.server,os,subprocess,sys,urllib.request,webbrowser
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument("--source",choices=["shop-v1","shop-v2","character","shop-actions-v1","shop-actions-v2","character-actions","interaction-props","shopping-basket","drink-shelf-wood","drink-shelf-lit","drink-shelf-chilled","premium-drink","layout-aisle","layout-supply","day-sign","restock-crate-drinks","restock-crate-bread","restock-crate-fruit"])
args=parser.parse_args()
if args.source:
    executable=Path(os.environ.get("BLENDER_BIN","blender"))
    app=next((p for p in executable.parents if p.suffix==".app"),None)
    source=ROOT/"assets/source"/(args.source+".blend")
    if app:subprocess.run(["open","-a",str(app),str(source)],check=True)
    else:subprocess.Popen([str(executable),str(source)])
    raise SystemExit
url="http://127.0.0.1:9418/"
try:
    body=urllib.request.urlopen(url,timeout=1).read(20000).decode()
    if "Corner Mart" in body:
        webbrowser.open(url);raise SystemExit
except (OSError,ValueError):pass
if not (ROOT/"dist/index.html").exists():
    print("Build the game first: npm ci && npm run build",file=sys.stderr);raise SystemExit(1)
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT/"dist"))
try:server=http.server.ThreadingHTTPServer(("127.0.0.1",9418),handler)
except OSError:
    print("Port 9418 is in use by another application.",file=sys.stderr);raise SystemExit(1)
print(f"街角小店：{url}\n保留这个窗口即可继续游戏。按 Ctrl+C 停止服务。",flush=True)
webbrowser.open(url)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
