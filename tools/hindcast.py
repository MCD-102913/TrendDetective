"""Hindcast of "if the trend continues" on the real data: for every variable and every country, region inside a
country (at least MIN_ADMIN1_CELLS grid cells) and ocean region (ocean variables), an earlier year plays the role of
the present; the trend is continued with every model and compared with what happened (backend/app/trend.py:
hindcast). The cases are pooled for the whole world and per climate zone, the model is chosen and the intervals are
calibrated, and everything is judged by cross-validation over countries (backend/app/forecast.py).

Writes <data>/forecast/hindcast.json: per variable, for the world and per zone, the chosen model, the interval
multipliers, the cross-validated skill and coverage and whether the site shows the outlook there.

    TREND_DATA_DIR=/path/to/data python tools/hindcast.py [--workers 2] [--only t_850,t_500]
"""

import json
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import forecast, trend
from backend.app.catalog import VARIABLES
from backend.app.cube import Cube
from backend.app.regions import Regions

MIN_CELLS = 4
MIN_ADMIN1_CELLS = 8
DATA = Path(os.environ.get("TREND_DATA_DIR", "data"))
CUBE: Cube | None = None
TERR: dict[str, list[tuple[str, str, int]]] = {}  # "land" / "ocean" -> (region id, zone, fold)
GEOM: dict[str, object] = {}


def cases_of(vid: str) -> tuple[str, list[dict]]:
    var = CUBE[vid]
    sphere = next(v["sphere"] for v in VARIABLES if v["id"] == vid)
    out = []
    for rid, zone, fold in TERR["ocean" if sphere == "ocean" else "land"]:
        ii, jj = var.grid.cells_in(GEOM[rid])
        if len(ii) < MIN_CELLS:
            continue
        y, _ = var.series(ii, jj)
        # several forecast origins (rolling-origin evaluation): more checks, not a looser criterion
        for frac in trend.TRAIN_FRACTIONS:
            c = trend.hindcast(y, var.year, var.month, frac)
            if c:
                out.append({**c, "region_id": rid, "zone": zone, "fold": fold})
    return vid, out


def main():
    global CUBE
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 2
    # --only a,b: check just these variables and keep the others from the previous run
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    CUBE, regions = Cube(DATA), Regions(DATA)
    ref = CUBE["t2m"].grid
    land, ocean = [], []
    for rid, info in regions.items.items():
        if info["level"] not in (0, 1, -2):
            continue
        GEOM[rid] = regions.geometry(rid)
        if info["level"] == 1 and len(ref.cells_in(GEOM[rid])[0]) < MIN_ADMIN1_CELLS:
            continue
        _w, s, _e, n = info["bbox"]
        row = (rid, forecast.zone_of((s + n) / 2), forecast.fold_of(info["parent_id"] if info["level"] == 1 else rid))
        (ocean if info["level"] == -2 else land).append(row)
    TERR.update(land=land, ocean=ocean)
    print(f"territories: {len(land)} countries and regions, {len(ocean)} ocean regions", flush=True)

    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rule": {
            "train_fractions": list(trend.TRAIN_FRACTIONS),
            "horizon_fraction": trend.OUTLOOK_FRACTION,
            "models": list(trend.OUTLOOK_MODELS),
            "anchor_years": trend.ANCHOR_YEARS,
            "damping": trend.DAMPING,
            "min_cases": forecast.MIN_CASES,
            "min_coverage95": forecast.MIN_COVERAGE95,
            "zones": forecast.ZONES,
        },
        "variables": {},
    }
    t0 = time.time()
    vids = [v["id"] for v in VARIABLES if v["id"] in CUBE and (only is None or v["id"] in only)]
    previous = DATA / "forecast" / "hindcast.json"
    if only and previous.exists():
        out["variables"] = json.loads(previous.read_text())["variables"]
    with mp.get_context("fork").Pool(workers) as pool:
        for vid, cases in pool.imap_unordered(cases_of, vids):
            g = forecast.evaluate(cases)
            zones = {z: forecast.evaluate([c for c in cases if c["zone"] == z]) for z in forecast.ZONES}
            out["variables"][vid] = {"global": g, "zones": zones}
            zs = " ".join(f"{z}:{'ON' if r['enabled'] else 'off'}({r['cases']})" for z, r in zones.items())
            print(
                f"{vid:13s} cases {g['cases']:4d} "
                + (
                    f"model {g['model']:8s} skill {g['skill']:+.2f} cov95 {g['coverage95']:.2f} k95 {g['k95']:.2f} "
                    if g.get("skill") is not None
                    else ""
                )
                + ("ON " if g["enabled"] else "off ")
                + zs
                + f"  ({time.time() - t0:.0f}s)",
                flush=True,
            )
    (DATA / "forecast").mkdir(exist_ok=True)
    (DATA / "forecast" / "hindcast.json").write_text(json.dumps(out, indent=1))
    on = [k for k, v in out["variables"].items() if v["global"]["enabled"]]
    zon = sorted({f"{k}/{z}" for k, v in out["variables"].items() for z, r in v["zones"].items() if r["enabled"]})
    print(f"\nworld: enabled for {len(on)} of {len(out['variables'])}: {', '.join(on)}")
    print(f"zones: {len(zon)} variable/zone groups enabled: {', '.join(zon)}")


if __name__ == "__main__":
    sys.exit(main())
