"""Loads MERRA-2 fields on pressure levels into the cube (needs an Earthdata Login token with the GES DISC EULA accepted).

    M2IMNPASM 5.12.4   monthly, 42 pressure levels, 0.5 x 0.625 deg
        T   -> t_850, t_700, t_500, t_300, t_200, t_100, t_50, t_10      (deg C)
        RH  -> rh_850, rh_500, rh_300                                   (%)
        O3  -> o3_50, o3_10                                             (ppmv)

Only the needed levels are read, through NASA's cloud OPeNDAP: one level of one month is about 0.4 MB. Below the ground
(850 hPa over high mountains) MERRA-2 leaves the value undefined and the cell stays empty. Work is resumable in the
same way as fetch_gesdisc.py: finished months live in data.part.npy + state.json until every month is in.

Usage:
    python etl/fetch_merra_levels.py --data /path/to/data [--workers 4]
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import h5py
import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_gesdisc import Parts
from fetch_modis import CMR, log, month_index, token

CONCEPT = "C1276812904-GES_DISC"
OPENDAP = "https://opendap.earthdata.nasa.gov/collections/" + CONCEPT + "/granules/"
FILL = 1e14  # MERRA-2 marks undefined values with 1e15
O3_PPMV = 28.9644 / 47.9982 * 1e6  # mass mixing ratio of ozone -> parts per million by volume

# (variable in the file, pressure level in hPa, cube id, conversion)
FIELDS = [
    *[("T", p, f"t_{p}", lambda a: a - 273.15) for p in (850, 700, 500, 300, 200, 100, 50, 10)],
    *[("RH", p, f"rh_{p}", lambda a: a * 100.0) for p in (850, 500, 300)],
    *[("O3", p, f"o3_{p}", lambda a: a * O3_PPMV) for p in (50, 10)],
]
SPEC = {
    "source": "MERRA-2",
    "store": "earthdata:M2IMNPASM.5.12.4",
    "grid": {"lat0": -90.0, "dlat": 0.5, "nlat": 361, "lon0": -180.0, "dlon": 0.625, "nlon": 576},
    "vars": {vid: ("°C" if v == "T" else "%" if v == "RH" else "ppmv") for v, _, vid, _ in FIELDS},
}


def granules() -> list[tuple[str, str]]:
    """[(YYYY-MM, granule UR)] oldest first."""
    out, after = [], None
    while True:
        r = requests.get(
            CMR,
            params={"collection_concept_id": CONCEPT, "page_size": 2000, "sort_key": "start_date"},
            headers={"CMR-Search-After": after} if after else {},
            timeout=180,
        )
        r.raise_for_status()
        entries = r.json()["feed"]["entry"]
        out += [(g["time_start"][:7], g["title"]) for g in entries]
        after = r.headers.get("CMR-Search-After")
        if not entries or not after:
            return out


def get(url: str, tok: str) -> bytes:
    for attempt in range(1, 6):
        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=300)
            r.raise_for_status()
            return r.content
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(8 * attempt)
            if attempt >= 2:
                log(f"  retry {attempt}: {type(e).__name__}: {str(e)[:90]}")
    raise AssertionError("unreachable")


def read_slab(content: bytes, var: str) -> np.ndarray:
    import io

    with h5py.File(io.BytesIO(content), "r") as f:
        a = np.asarray(f[var][...], dtype=np.float64).reshape(361, 576)
    a[np.abs(a) > FILL] = np.nan
    return a


def levels(ur: str, tok: str) -> dict[int, int]:
    """Pressure level in hPa -> index in the file."""
    import io

    with h5py.File(io.BytesIO(get(OPENDAP + ur + ".dap.nc4?dap4.ce=/lev", tok)), "r") as f:
        lev = np.asarray(f["lev"][...])
    return {int(round(p)): i for i, p in enumerate(lev)}


def load_month(ur: str, index: dict[int, int], tok: str) -> dict[str, np.ndarray]:
    out = {}
    for var, p, vid, convert in FIELDS:
        k = index[p]
        ce = f"/{var}%5B0:0%5D%5B{k}:{k}%5D%5B0:360%5D%5B0:575%5D"
        out[vid] = convert(read_slab(get(f"{OPENDAP}{ur}.dap.nc4?dap4.ce={ce}", tok), var)).astype(np.float32)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--workers", default=4, type=int)
    args = ap.parse_args()
    tok = token()
    months = dict(granules())
    first, last = min(months), max(months)
    nt = month_index(last, first) + 1
    g = SPEC["grid"]
    parts = Parts(args.data / "cube", list(SPEC["vars"]), first, nt, g["nlat"], g["nlon"])
    todo = [m for m in sorted(months) if m not in parts.done()]
    log(f"MERRA-2 levels: {len(months)} months {first} .. {last}, {len(todo)} to load, {len(FIELDS)} fields")
    index = levels(months[first], tok)
    t0, failed = time.time(), []
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [(m, pool.submit(load_month, months[m], index, tok)) for m in todo]
        for k, (m, fut) in enumerate(futures, 1):
            try:
                parts.put(m, fut.result())
            except Exception as e:
                failed.append(m)
                log(f"  FAILED {m}: {type(e).__name__}: {str(e)[:120]}")
            if k % 12 == 0 or k == len(futures):
                parts.save()
                log(f"MERRA-2 levels: {k}/{len(futures)} months, {time.time() - t0:.0f}s")
    if failed:
        parts.save()
        log(f"MERRA-2 levels: {len(failed)} months failed ({failed[:6]}...), rerun to retry; not published")
        return
    parts.publish(SPEC)
    log("all done")


if __name__ == "__main__":
    sys.exit(main())
