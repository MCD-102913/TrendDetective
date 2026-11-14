"""Loads MODIS monthly climate-modeling-grid products (0.05 degree, HDF4) from LP DAAC into the cube.

    MOD13C2.061  vegetation indices   -> ndvi, evi
    MOD11C3.061  land surface temperature -> lst_day, lst_night (deg C)

Needs an Earthdata Login token: EARTHDATA_TOKEN in the environment or in <app>/.env.
Granules are listed through CMR, downloaded over HTTPS (a few in parallel), block-averaged
10 x 10 to 0.5 degree (NaN-aware) and deleted. The run can be interrupted and resumed: finished
months are kept in <data>/cube/<id>/data.part.npy + state.json.

Usage:
    python etl/fetch_modis.py --data /path/to/data [--only MOD13C2] [--workers 3]
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from pyhdf.SD import SD, SDC

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
BLOCK = 10  # 0.05 -> 0.5 degree
MIN_BLOCK_SHARE = 0.25  # a 0.5-degree cell needs a quarter of its 100 native cells (coasts, snow line)

# product -> (collection concept id, {cube id: (SDS name, multiply, add, fill value)})
PRODUCTS = {
    "MOD13C2": (
        "C2565788914-LPCLOUD",
        {
            "ndvi": ("CMG 0.05 Deg Monthly NDVI", 1e-4, 0.0, -3000),
            "evi": ("CMG 0.05 Deg Monthly EVI", 1e-4, 0.0, -3000),
        },
    ),
    "MOD11C3": (
        "C2565788897-LPCLOUD",
        {
            "lst_day": ("LST_Day_CMG", 0.02, -273.15, 0),
            "lst_night": ("LST_Night_CMG", 0.02, -273.15, 0),
        },
    ),
}
UNITS = {"ndvi": "", "evi": "", "lst_day": "°C", "lst_night": "°C"}


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def token() -> str:
    tok = os.environ.get("EARTHDATA_TOKEN")
    env = Path(__file__).resolve().parents[1] / ".env"
    if not tok and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("EARTHDATA_TOKEN="):
                tok = line.split("=", 1)[1].strip()
    if not tok:
        sys.exit("EARTHDATA_TOKEN is not set")
    return tok


def list_granules(concept_id: str) -> list[tuple[str, str]]:
    """[(YYYY-MM, download url)] for every granule, oldest first (CMR Search After paging)."""
    out, after = [], None
    while True:
        headers = {"CMR-Search-After": after} if after else {}
        r = requests.get(
            CMR,
            params={"collection_concept_id": concept_id, "page_size": 2000, "sort_key": "start_date"},
            headers=headers,
            timeout=180,
        )
        r.raise_for_status()
        entries = r.json()["feed"]["entry"]
        for g in entries:
            url = next(
                l["href"]
                for l in g["links"]
                if l.get("rel", "").endswith("/data#") and l["href"].startswith("https") and l["href"].endswith(".hdf")
            )
            out.append((g["time_start"][:7], url))
        after = r.headers.get("CMR-Search-After")
        if not entries or not after:
            break
    return out


def block_mean(a: np.ndarray) -> np.ndarray:
    n0, n1 = a.shape[0] // BLOCK, a.shape[1] // BLOCK
    b = a.reshape(n0, BLOCK, n1, BLOCK)
    ok = np.isfinite(b)
    n = ok.sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(ok, b, 0.0).sum(axis=(1, 3)) / n
    out[n < MIN_BLOCK_SHARE * BLOCK * BLOCK] = np.nan
    return out.astype(np.float32)


def fetch_one(url: str, tmp_dir: Path, tok: str, layers: dict) -> dict[str, np.ndarray]:
    """Downloads one granule and returns {cube id: 0.5-degree grid [lat ascending, lon]}."""
    path = tmp_dir / url.rsplit("/", 1)[1]
    for attempt in range(1, 5):
        try:
            with requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=600, stream=True) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            h = SD(str(path), SDC.READ)
            out = {}
            for vid, (sds, mul, add, fill) in layers.items():
                raw = h.select(sds)[:]
                a = np.where(raw == fill, np.nan, raw.astype(np.float32) * mul + add).astype(np.float32)
                out[vid] = block_mean(a)[::-1]  # file rows run north -> south
            h.end()
            return out
        except Exception as e:
            if attempt == 4:
                raise
            log(f"  retry {attempt} for {path.name}: {type(e).__name__}: {str(e)[:100]}")
            time.sleep(10 * attempt)
        finally:
            path.unlink(missing_ok=True)
    raise RuntimeError("unreachable")


def month_index(ym: str, first: str) -> int:
    y, m = (int(x) for x in ym.split("-"))
    y0, m0 = (int(x) for x in first.split("-"))
    return (y - y0) * 12 + (m - m0)


def run(product: str, data: Path, tok: str, workers: int) -> None:
    concept, layers = PRODUCTS[product]
    cube = data / "cube"
    todo_layers = {v: s for v, s in layers.items()}
    granules = list_granules(concept)
    first, last = granules[0][0], granules[-1][0]
    nt = month_index(last, first) + 1
    nlat, nlon = 3600 // BLOCK, 7200 // BLOCK
    log(f"{product}: {len(granules)} granules, {first} .. {last}")

    arrays, states = {}, {}
    for vid in todo_layers:
        d = cube / vid
        d.mkdir(parents=True, exist_ok=True)
        part, st = d / "data.part.npy", d / "state.json"
        state = json.loads(st.read_text()) if st.exists() and part.exists() else {"first": first, "nt": nt, "done": []}
        if state["first"] != first or state["nt"] != nt or not part.exists():
            # new months appeared or a fresh start: allocate and copy what is already done
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
        arrays[vid] = np.load(part, mmap_mode="r+")
        states[vid] = state

    done = set.intersection(*(set(s["done"]) for s in states.values()))
    todo = [(ym, url) for ym, url in granules if ym not in done]
    log(f"{product}: {len(todo)} months to download")
    tmp_dir = data / "tmp"
    tmp_dir.mkdir(exist_ok=True)
    t0 = time.time()
    with ThreadPoolExecutor(workers) as pool:
        futures = [(ym, pool.submit(fetch_one, url, tmp_dir, tok, todo_layers)) for ym, url in todo]
        for k, (ym, fut) in enumerate(futures, 1):
            try:
                grids = fut.result()
            except Exception as e:
                log(f"  FAILED {ym}: {type(e).__name__}: {str(e)[:120]}")
                continue
            for vid, g in grids.items():
                arrays[vid][:, :, month_index(ym, first)] = g
                states[vid]["done"].append(ym)
            if k % 12 == 0 or k == len(futures):
                for vid in arrays:
                    arrays[vid].flush()
                    (cube / vid / "state.json").write_text(json.dumps(states[vid]))
                log(f"{product}: {k}/{len(futures)} months, {time.time() - t0:.0f}s")

    missing = [ym for ym, _ in granules if any(ym not in s["done"] for s in states.values())]
    for arr in arrays.values():
        arr.flush()
    arrays.clear()  # the memory maps are released before the files are renamed
    if missing:
        log(f"{product}: {len(missing)} months still missing ({missing[:6]}...), rerun to retry; cube not published")
        return
    for vid in todo_layers:
        d = cube / vid
        (d / "data.part.npy").replace(d / "data.npy")
        (d / "state.json").unlink(missing_ok=True)
        (d / "annual.npy").unlink(missing_ok=True)
        meta = {
            "id": vid,
            "source": "MODIS Terra",
            "store": f"earthdata:{product}.061",
            "var": layers[vid][0],
            "units": UNITS[vid],
            "lat0": -90 + 0.25,
            "dlat": 0.5,
            "nlat": nlat,
            "lon0": -180 + 0.25,
            "dlon": 0.5,
            "nlon": nlon,
            "t0": first,
            "nt": nt,
            "long_name": layers[vid][0],
            "native_units": "",
            "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        (d / "meta.json").write_text(json.dumps(meta, indent=1))
        log(f"{vid}: published, {first} + {nt} months")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--only", default="", help="comma-separated products (MOD13C2, MOD11C3)")
    ap.add_argument("--workers", default=3, type=int)
    args = ap.parse_args()
    tok = token()
    for product in PRODUCTS:
        if args.only and product not in args.only.split(","):
            continue
        run(product, args.data, tok, args.workers)
    log("all done")


if __name__ == "__main__":
    sys.exit(main())
