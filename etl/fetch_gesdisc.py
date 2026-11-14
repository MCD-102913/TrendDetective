"""Loads GES DISC products into the cube (needs an Earthdata Login token with the GES DISC EULA accepted).

    GLDAS_NOAH025_M 2.1  monthly 0.25 deg  -> gldas_soil, gldas_root, gldas_evap, gldas_runoff, gldas_swe   (0.5 deg)
    AIRS3STM 7.0         monthly 1 deg     -> airs_tair, airs_h2o, airs_olr
    OMNO2d 004           DAILY 0.25 deg    -> omi_no2: monthly mean of cloud-screened tropospheric NO2 (0.5 deg)

Granules are listed through CMR and downloaded over HTTPS in parallel. Work is resumable: finished
months live in <data>/cube/<id>/data.part.npy + state.json; the variable is published (data.npy +
meta.json) when every month is in.

Usage:
    python etl/fetch_gesdisc.py --data /path/to/data [--only GLDAS,AIRS,OMI] [--workers 4]
"""

import argparse
import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import h5py
import numpy as np
import requests
from pyhdf.SD import SD, SDC

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_modis import CMR, log, month_index, token

SWE_MAX_MM = 2000.0
OMI_MIN_DAYS = 5  # valid (cloud-screened) days a cell needs in a month
OMI_NO2 = "HDFEOS/GRIDS/ColumnAmountNO2/Data Fields/ColumnAmountNO2TropCloudScreened"


def block_mean(a: np.ndarray, k: int, min_share: float = 0.25) -> np.ndarray:
    if k == 1:
        return a.astype(np.float32)
    b = a.reshape(a.shape[0] // k, k, a.shape[1] // k, k)
    ok = np.isfinite(b)
    n = ok.sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(ok, b, 0.0).sum(axis=(1, 3)) / n
    out[n < min_share * k * k] = np.nan
    return out.astype(np.float32)


def nanmean2(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        return np.where(np.isfinite(a) & np.isfinite(b), (a + b) / 2, np.where(np.isfinite(a), a, b))


# readers: file -> {cube id: grid}
def read_gldas(path: Path) -> dict[str, np.ndarray]:
    with h5py.File(path) as h:

        def get(name):
            a = h[name][0].astype(np.float32)
            a[a < -9000] = np.nan
            return a

        # the model has no glaciers: on ice sheets snow piles up without limit (up to 100 m of water in the
        # sample month), which would read as a huge false trend. Seasonal snow stays far below 2 m of water.
        swe = get("SWE_inst")
        swe[swe > SWE_MAX_MM] = np.nan
        return {
            "gldas_soil": block_mean(get("SoilMoi0_10cm_inst"), 2),
            "gldas_root": block_mean(get("RootMoist_inst"), 2),
            "gldas_evap": block_mean(get("Evap_tavg") * 86400.0, 2),  # kg m-2 s-1 -> mm/day
            "gldas_runoff": block_mean((get("Qs_acc") + get("Qsb_acc")) * 8.0, 2),  # kg m-2 per 3 h -> mm/day
            "gldas_swe": block_mean(swe, 2),
        }


def read_airs(path: Path) -> dict[str, np.ndarray]:
    h = SD(str(path), SDC.READ)

    def get(name):
        a = h.select(name)[:].astype(np.float32)
        a[a < -9000] = np.nan
        return a[::-1]  # rows run north -> south

    out = {
        "airs_tair": nanmean2(get("SurfAirTemp_A"), get("SurfAirTemp_D")) - 273.15,
        "airs_h2o": nanmean2(get("TotH2OVap_A"), get("TotH2OVap_D")),
        "airs_olr": nanmean2(get("OLR_A"), get("OLR_D")),
    }
    h.end()
    return out


def read_omi_day(path: Path) -> np.ndarray:
    with h5py.File(path) as h:
        a = h[OMI_NO2][:].astype(np.float32)
    a[(a < -1e29) | (a > 1e18)] = np.nan
    return a / 1e15  # 10^15 molecules / cm2


PRODUCTS = {
    "GLDAS": {
        "concept": "C1342986036-GES_DISC",
        "suffix": ".nc4",
        "reader": read_gldas,
        "daily": False,
        "grid": {"lat0": -59.75, "dlat": 0.5, "nlat": 300, "lon0": -179.75, "dlon": 0.5, "nlon": 720},
        "source": "GLDAS",
        "store": "earthdata:GLDAS_NOAH025_M.2.1",
        "vars": {
            "gldas_soil": "kg/m²",
            "gldas_root": "kg/m²",
            "gldas_evap": "mm/day",
            "gldas_runoff": "mm/day",
            "gldas_swe": "mm",
        },
    },
    "AIRS": {
        "concept": "C1701805662-GES_DISC",
        "suffix": ".hdf",
        "reader": read_airs,
        "daily": False,
        "grid": {"lat0": -89.5, "dlat": 1.0, "nlat": 180, "lon0": -179.5, "dlon": 1.0, "nlon": 360},
        "source": "AIRS",
        "store": "earthdata:AIRS3STM.7.0",
        "vars": {"airs_tair": "°C", "airs_h2o": "kg/m²", "airs_olr": "W/m²"},
    },
    "OMI": {
        "concept": "C3333493715-GES_DISC",
        "suffix": ".he5",
        "reader": read_omi_day,
        "daily": True,
        "grid": {"lat0": -89.75, "dlat": 0.5, "nlat": 360, "lon0": -179.75, "dlon": 0.5, "nlon": 720},
        "source": "OMI",
        "store": "earthdata:OMNO2d.004",
        "vars": {"omi_no2": "10¹⁵ molec/cm²"},
    },
}


# download
def list_granules(concept: str, suffix: str) -> list[tuple[str, str]]:
    """[(YYYY-MM-DD, url)] oldest first."""
    out, after = [], None
    while True:
        r = requests.get(
            CMR,
            params={"collection_concept_id": concept, "page_size": 2000, "sort_key": "start_date"},
            headers={"CMR-Search-After": after} if after else {},
            timeout=180,
        )
        r.raise_for_status()
        entries = r.json()["feed"]["entry"]
        for g in entries:
            url = next(
                (
                    l["href"]
                    for l in g["links"]
                    if l.get("rel", "").endswith("/data#")
                    and l["href"].startswith("https")
                    and l["href"].endswith(suffix)
                ),
                None,
            )
            if url:
                out.append((g["time_start"][:10], url))
        after = r.headers.get("CMR-Search-After")
        if not entries or not after:
            break
    return out


def download(url: str, tmp: Path, tok: str, reader):
    path = tmp / url.rsplit("/", 1)[1]
    for attempt in range(1, 6):
        try:
            with requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=600, stream=True) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            return reader(path)
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(8 * attempt)
            if attempt >= 2:
                log(f"  retry {attempt} for {path.name}: {type(e).__name__}: {str(e)[:90]}")
        finally:
            path.unlink(missing_ok=True)


# resumable cube
class Parts:
    def __init__(self, cube: Path, vids: list[str], first: str, nt: int, nlat: int, nlon: int):
        self.cube, self.first, self.nt = cube, first, nt
        self.arrays, self.states = {}, {}
        for vid in vids:
            d = cube / vid
            d.mkdir(parents=True, exist_ok=True)
            part, st = d / "data.part.npy", d / "state.json"
            state = (
                json.loads(st.read_text()) if st.exists() and part.exists() else {"first": first, "nt": nt, "done": []}
            )
            if state["first"] != first or state["nt"] != nt or not part.exists():
                new = np.lib.format.open_memmap(d / "data.new.npy", mode="w+", dtype=np.float32, shape=(nlat, nlon, nt))
                new[:] = np.nan
                if part.exists() and state["done"]:
                    old = np.load(part, mmap_mode="r")
                    off = month_index(state["first"], first)
                    new[:, :, off : off + old.shape[2]] = old
                    del old
                new.flush()
                del new
                (d / "data.new.npy").replace(part)
                state.update(first=first, nt=nt)
            self.arrays[vid] = np.load(part, mmap_mode="r+")
            self.states[vid] = state

    def done(self) -> set[str]:
        return set.intersection(*(set(s["done"]) for s in self.states.values()))

    def put(self, ym: str, grids: dict[str, np.ndarray]) -> None:
        for vid, g in grids.items():
            self.arrays[vid][:, :, month_index(ym, self.first)] = g
            self.states[vid]["done"].append(ym)

    def save(self) -> None:
        for vid, arr in self.arrays.items():
            arr.flush()
            (self.cube / vid / "state.json").write_text(json.dumps(self.states[vid]))

    def publish(self, spec: dict) -> None:
        self.save()
        self.arrays.clear()
        for vid, units in spec["vars"].items():
            d = self.cube / vid
            (d / "data.part.npy").replace(d / "data.npy")
            (d / "state.json").unlink(missing_ok=True)
            (d / "annual.npy").unlink(missing_ok=True)
            meta = {
                "id": vid,
                "source": spec["source"],
                "store": spec["store"],
                "var": vid,
                "units": units,
                **spec["grid"],
                "t0": self.first,
                "nt": self.nt,
                "long_name": vid,
                "native_units": "",
                "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            (d / "meta.json").write_text(json.dumps(meta, indent=1))
            log(f"{vid}: published, {self.first} + {self.nt} months")


def run(name: str, data: Path, tok: str, workers: int) -> None:
    spec = PRODUCTS[name]
    granules = list_granules(spec["concept"], spec["suffix"])
    by_month: dict[str, list[str]] = defaultdict(list)
    for day, url in granules:
        by_month[day[:7]].append(url)
    months = sorted(by_month)
    if spec["daily"]:
        # the running month is incomplete and stays out
        months = [m for m in months if m < time.strftime("%Y-%m", time.gmtime())]
    first, last = months[0], months[-1]
    nt = month_index(last, first) + 1
    g = spec["grid"]
    parts = Parts(data / "cube", list(spec["vars"]), first, nt, g["nlat"], g["nlon"])
    todo = [m for m in months if m not in parts.done()]
    log(f"{name}: {len(granules)} granules, {first} .. {last}, {len(todo)} months to load")
    tmp = data / "tmp"
    tmp.mkdir(exist_ok=True)
    t0 = time.time()
    failed = []
    with ThreadPoolExecutor(workers) as pool:
        if not spec["daily"]:
            futures = [(m, pool.submit(download, by_month[m][0], tmp, tok, spec["reader"])) for m in todo]
            for k, (m, fut) in enumerate(futures, 1):
                try:
                    parts.put(m, fut.result())
                except Exception as e:
                    failed.append(m)
                    log(f"  FAILED {m}: {type(e).__name__}: {str(e)[:120]}")
                if k % 12 == 0 or k == len(futures):
                    parts.save()
                    log(f"{name}: {k}/{len(futures)} months, {time.time() - t0:.0f}s")
        else:
            vid = next(iter(spec["vars"]))
            for k, m in enumerate(todo, 1):
                total = np.zeros((720, 1440), dtype=np.float64)
                count = np.zeros((720, 1440), dtype=np.int16)
                bad = 0
                for fut in [pool.submit(download, u, tmp, tok, spec["reader"]) for u in by_month[m]]:
                    try:
                        day = fut.result()
                    except Exception as e:
                        bad += 1
                        log(f"  FAILED day in {m}: {type(e).__name__}: {str(e)[:100]}")
                        continue
                    ok = np.isfinite(day)
                    total[ok] += day[ok]
                    count[ok] += 1
                if bad > 3:
                    failed.append(m)
                    continue
                with np.errstate(invalid="ignore", divide="ignore"):
                    mean = np.where(count >= OMI_MIN_DAYS, total / count, np.nan)
                parts.put(m, {vid: block_mean(mean, 2)})
                if k % 3 == 0 or k == len(todo):
                    parts.save()
                    log(f"{name}: {k}/{len(todo)} months ({m}), {time.time() - t0:.0f}s")
    if failed:
        parts.save()
        log(f"{name}: {len(failed)} months failed ({failed[:6]}...), rerun to retry; not published")
        return
    parts.publish(spec)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--only", default="", help="comma-separated: GLDAS,AIRS,OMI")
    ap.add_argument("--workers", default=4, type=int)
    args = ap.parse_args()
    tok = token()
    for name in PRODUCTS:
        if args.only and name not in args.only.split(","):
            continue
        try:
            run(name, args.data, tok, args.workers)
        except Exception as e:
            log(f"{name}: FAILED {type(e).__name__}: {e}")
    log("all done")


if __name__ == "__main__":
    sys.exit(main())
