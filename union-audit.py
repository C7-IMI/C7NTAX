import json, io, glob, os

versions = sorted(glob.glob("audit-versions/*.json"))
union = {}
for f in versions:
    try:
        rows = json.load(io.open(f, encoding="utf-8"))
    except Exception:
        continue
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("auditLogs") or []
    for r in rows:
        if isinstance(r, dict) and r.get("id"):
            union[r["id"]] = r

rows = sorted(union.values(), key=lambda r: r.get("createdAt") or "")
print("versions:", len(versions), "| union rows:", len(rows))
for r in rows:
    print(" -", (r.get("createdAt") or "?")[:19], "|", r.get("action"), "|", r.get("entityType"))

out = json.dumps(rows, indent=2, ensure_ascii=False, default=str)
io.open("apps/api/src/snapshots/audit-logs.json", "w", encoding="utf-8", newline="\n").write(out + "\n")
print("written to snapshots/audit-logs.json:", len(rows), "rows")
