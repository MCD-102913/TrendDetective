"""Loads ocean colour into the cube: MODIS Aqua chlorophyll-a, monthly 9 km mapped L3 (OB.DAAC, NASA Ocean Biology).

    MODISA_L3m_CHL 2022.0 (C3380709133-OB_CLOUD), AQUA_MODIS.<month>.L3m.MO.CHL.chlor_a.9km.nc
    -> chl: mean chlorophyll-a concentration, mg/m3, 0.5 degree (6 x 6 blocks of 1/12 degree)

Chlorophyll is log-normally distributed and the trend is shown in % of the mean (catalog kind "rel").
A 0.5 degree cell needs at least a quarter of its 36 native cells (clouds, sea ice and polar night
leave gaps in monthly composites). Resumable like the other loaders.

Usage:
    python etl/fetch_ocean.py --data /path/to/data [--workers 4]
"""

import argparse
import sys
from pathlib import Path

import h5py
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_gesdisc import Parts, block_mean, download, list_granules
from fetch_modis import log, month_index, token

CONCEPT = "C3380709133-OB_CLOUD"
SUFFIX = ".L3m.MO.CHL.chlor_a.9km.nc"
GRID = {"lat0": -89.75, "dlat": 0.5, "nlat": 360, "lon0": -179.75, "dlon": 0.5, "nlon": 720}
SPEC = {"source": "MODIS Aqua", "store": "earthdata:MODISA_L3m_CHL.2022.0", "grid": GRID, "vars": {"chl": "mg/m³"}}


def read_chl(path: Path) -> dict[str, np.ndarray]:
    with h5py.File(path) as h:
        a = h["chlor_a"][:].astype(np.float32)  # 2160 x 4320, north -> south
    a[(a <= 0) | (a > 1000)] = np.nan  # fill value -32767, physically impossible values
    return {"chl": block_mean(a, 6)[::-1]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--workers", default=4, type=int)
    args = ap.parse_args()
    tok = token()
    granules = list_granules(CONCEPT, SUFFIX)
    months = sorted({d[:7]: u for d, u in granules}.items())
    first, last = months[0][0], months[-1][0]
    nt = month_index(last, first) + 1
    parts = Parts(args.data / "cube", ["chl"], first, nt, GRID["nlat"], GRID["nlon"])
    todo = [(m, u) for m, u in months if m not in parts.done()]
    log(f"chlorophyll: {len(months)} months {first} .. {last}, {len(todo)} to load")
    tmp = args.data / "tmp"
    tmp.mkdir(exist_ok=True)
    from concurrent.futures import ThreadPoolExecutor

    failed = []
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [(m, pool.submit(download, u, tmp, tok, read_chl)) for m, u in todo]
        for k, (m, fut) in enumerate(futures, 1):
            try:
                parts.put(m, fut.result())
            except Exception as e:
                failed.append(m)
                log(f"  FAILED {m}: {type(e).__name__}: {str(e)[:120]}")
            if k % 12 == 0 or k == len(futures):
                parts.save()
                log(f"chlorophyll: {k}/{len(futures)} months")
    if failed:
        parts.save()
        log(f"{len(failed)} months failed ({failed[:6]}), rerun to retry; not published")
        return 1
    parts.publish(SPEC)
    log("all done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
