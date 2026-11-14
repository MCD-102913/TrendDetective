"""If the trend continues: the outlook for every country, for the forecast page and its map: the same decision as on the
site (backend/app/forecast.py: outlook_block) for every variable whose outlook is shown anywhere.

Writes <data>/forecast/outlooks.json: per variable and country either the outlook at the end of the horizon (expected
change from the current level, the 95% range, the model, the zone whose verdict applies) or the reason it is not shown.
Runs after tools/hindcast.py.

TREND_DATA_DIR=/path/to/data python tools/outlooks.py
"""

import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import forecast, trend
from backend.app.catalog import BY_ID
from backend.app.cube import Cube
from backend.app.regions import Regions

MIN_CELLS = 2


def r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 5)


def main():
    data = Path(os.environ.get("TREND_DATA_DIR", "data"))
    cube, regions = Cube(data), Regions(data)
    skill = json.loads((data / "forecast" / "hindcast.json").read_text())
    shown = [
        vid
        for vid, v in skill["variables"].items()
        if vid in cube and (v["global"]["enabled"] or any(z["enabled"] for z in v["zones"].values()))
    ]
    countries = [rid for rid, i in regions.items.items() if i["level"] == 0]
    out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "variables": {}}
    t0 = time.time()
    for vid in shown:
        var, cat = cube[vid], BY_ID[vid]
        rows = {}
        for rid in countries:
            ii, jj = var.grid.cells_in(regions.geometry(rid))
            if len(ii) < MIN_CELLS:
                continue
            y, _ = var.series(ii, jj)
            valid = np.nonzero(np.isfinite(y))[0]
            if len(valid) < 120:
                continue
            sl = slice(valid[0], valid[-1] + 1)
            y, year, month = y[sl], var.year[sl], var.month[sl]
            r = trend.analyze(y, year, month)
            robust = trend.robustness(y, year, month) if "rate" in r else {"robust": False}
            robust["robust"] = bool(robust["robust"] and r["verdict"].startswith("significant"))
            info = regions.require(rid)
            o = forecast.outlook_block(
                skill, cat, r, robust, y, year, month, {"region_id": rid, "bbox": info["bbox"], "kind": "region"}
            )
            h = o.get("hindcast", {})
            row = {
                "available": o["available"],
                "scope": h.get("scope"),
                "model": h.get("model"),
                "verdict": r["verdict"],
                "mean": r4(r["mean"]),
            }
            if o["available"]:
                row.update(
                    year_end=int(o["years"][-1]),
                    last_year=o["last_year"],
                    ref=r4(o["ref"]),
                    change=r4(o["mid"][-1] - o["ref"]),
                    mid_end=r4(o["mid"][-1]),
                    lo95_end=r4(o["lo95"][-1]),
                    hi95_end=r4(o["hi95"][-1]),
                    per_decade=r4(o["per_decade"]),
                )
            else:
                row["reason"] = o["reason"]
            rows[rid] = row
        out["variables"][vid] = rows
        n = sum(1 for v in rows.values() if v["available"])
        print(f"{vid:13s} {n:4d} of {len(rows)} countries with an outlook  ({time.time() - t0:.0f}s)", flush=True)
    (data / "forecast" / "outlooks.json").write_text(json.dumps(out))


if __name__ == "__main__":
    sys.exit(main())
