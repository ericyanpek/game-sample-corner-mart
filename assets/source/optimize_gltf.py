"""Deduplicate exact static meshes; retain every node, transform, material and extras.

This intentionally rejects animation/skin/image GLBs. It is a narrow helper for
the untextured static workshop, not a general glTF optimizer.
"""
import json
import struct
import hashlib
from pathlib import Path


def deduplicate(path):
    path=Path(path)
    raw=path.read_bytes()
    size,kind=struct.unpack_from("<II",raw,12)
    doc=json.loads(raw[20:20+size])
    assert not doc.get("animations") and not doc.get("skins") and not doc.get("images")
    offset=20+size
    binary_size,binary_kind=struct.unpack_from("<II",raw,offset)
    assert binary_kind==0x004E4942
    binary=raw[offset+8:offset+8+binary_size]
    widths={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}
    components={"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}
    def signature(i):
        a=doc["accessors"][i]
        assert "sparse" not in a
        view=doc["bufferViews"][a["bufferView"]]
        width=widths[a["componentType"]]*components[a["type"]]
        stride=view.get("byteStride",width)
        start=view.get("byteOffset",0)+a.get("byteOffset",0)
        data=b"".join(binary[start+n*stride:start+n*stride+width] for n in range(a["count"]))
        return [a["componentType"],a["type"],a["count"],a.get("normalized",False),hashlib.sha256(data).hexdigest()]
    unique=[];seen={};mapping={}
    for i,m in enumerate(doc["meshes"]):
        primitives=[]
        for p in m["primitives"]:
            assert "targets" not in p and "extensions" not in p
            primitives.append({"mode":p.get("mode",4),"material":p.get("material"),
                "attributes":{k:signature(v) for k,v in sorted(p["attributes"].items())},
                "indices":signature(p["indices"]) if "indices" in p else None})
        key=json.dumps(primitives,sort_keys=True)
        if key not in seen:
            seen[key]=len(unique);unique.append(m)
        mapping[i]=seen[key]
    before_meshes=len(doc["meshes"])
    doc["meshes"]=unique
    for node in doc.get("nodes",[]):
        if "mesh" in node:node["mesh"]=mapping[node["mesh"]]
    used=set()
    for mesh in unique:
        for p in mesh["primitives"]:
            used.update(p["attributes"].values())
            if "indices" in p:used.add(p["indices"])
    index={old:new for new,old in enumerate(sorted(used))}
    accessors=[doc["accessors"][i] for i in sorted(used)]
    for mesh in unique:
        for p in mesh["primitives"]:
            p["attributes"]={k:index[v] for k,v in p["attributes"].items()}
            if "indices" in p:p["indices"]=index[p["indices"]]
    used_views=sorted({a["bufferView"] for a in accessors})
    views=[];view_map={};packed=bytearray()
    for old in used_views:
        view=dict(doc["bufferViews"][old]);start=view.get("byteOffset",0)
        packed.extend(b"\0"*((-len(packed))%4))
        piece=binary[start:start+view["byteLength"]]
        view["byteOffset"]=len(packed);view["buffer"]=0
        packed.extend(piece);view_map[old]=len(views);views.append(view)
    for a in accessors:a["bufferView"]=view_map[a["bufferView"]]
    doc["accessors"]=accessors;doc["bufferViews"]=views;doc["buffers"]=[{"byteLength":len(packed)}]
    encoded=json.dumps(doc,separators=(",",":")).encode()
    encoded+=b" "*((-len(encoded))%4);packed.extend(b"\0"*((-len(packed))%4))
    result=struct.pack("<III",0x46546C67,2,12+8+len(encoded)+8+len(packed))
    result+=struct.pack("<II",len(encoded),0x4E4F534A)+encoded
    result+=struct.pack("<II",len(packed),0x004E4942)+packed
    path.write_bytes(result)
    return {"before_bytes":len(raw),"after_bytes":len(result),"before_meshes":before_meshes,
            "after_meshes":len(unique),"method":"Exact primitive-data and material equality; node transforms/extras preserved"}
