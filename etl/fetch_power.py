"""Loads monthly global grids from the NASA POWER open data store (AWS S3, no login) into the cube.

Sources (backend/app/catalog.py): MERRA-2, GPM IMERG, CERES SYN1deg monthly Zarr stores.
For every variable it writes
    <data>/cube/<id>/data.npy    float32 [lat, lon, month], NaN = no data  (a cell's whole series is contiguous)
    <data>/cube/<id>/meta.json   grid (lat0, dlat, nlat, lon0, dlon, nlon), first month, number of months, units

Fine grids are block-averaged (catalog `block`, NaN-aware) so that no cube grid is finer than 0.5 degree.
Months after the last one with data are dropped (the stores are pre-allocated to 2029).

Usage:
    python etl/fetch_power.py --data /path/to/data [--only t2m,precip_gpm] [--force]
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import s3fs
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.catalog import POWER, VARIABLES

BAND_ROWS = 60  # native latitude rows read per request
PIECE_BYTES = 150e6  # memory bound of one request (the first IMERG attempt took 3.3 GB and was killed)
MIN_BLOCK_SHARE = 0.5  # a block-averaged cell needs at least half of its native cells


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def block_mean(a: np.ndarray, k: int) -> np.ndarray:
    """NaN-aware k x k block mean over the two leading axes of [lat, lon, time]."""
    if k == 1:
        return a
    nlat, nlon, nt = a.shape
    b = a.reshape(nlat // k, k, nlon // k, k, nt)
    ok = np.isfinite(b)
    n = ok.sum(axis=(1, 3))
    s = np.where(ok, b, 0.0).sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = s / n
    out[n < MIN_BLOCK_SHARE * k * k] = np.nan
    return out.astype(np.float32)


def fetch(fs, v: dict, out_root: Path, force: bool) -> None:
    out = out_root / v["id"]
    if (out / "meta.json").exists() and not force:
        log(f"{v['id']}: already in the cube, skipped")
        return
    t0 = time.time()
    ds = xr.open_dataset(s3fs.S3Map(v["store"], s3=fs), engine="zarr", consolidated=True, chunks=None)
    da = ds[v["var"]]
    lat, lon = ds["lat"].values.astype(float), ds["lon"].values.astype(float)
    if not (lat[1] > lat[0] and lon[1] > lon[0]):
        raise ValueError("grid must be ascending")
    times = ds["time"].values.astype("datetime64[M]")
    k = v["block"]
    nlat, nlon, nt = len(lat) // k * k, len(lon) // k * k, len(times)

    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "data.part.npy"
    cube = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float32, shape=(nlat // k, nlon // k, nt))
    # reading goes in pieces of at most ~PIECE_BYTES (float64 while decoding), aligned to the block factor
    rows = min(BAND_ROWS, 30) // k * k if nlat * nlon > 500_000 else BAND_ROWS // k * k
    cols = max(k, int(PIECE_BYTES / (rows * nt * 8)) // (30 * k) * (30 * k))
    for r0 in range(0, nlat, rows):
        r1 = min(r0 + rows, nlat)
        for c0 in range(0, nlon, cols):
            c1 = min(c0 + cols, nlon)
            a = da.isel(lat=slice(r0, r1), lon=slice(c0, c1)).transpose("lat", "lon", "time").values.astype(np.float32)
            a[a < -900] = np.nan  # POWER fill value is -999
            cube[r0 // k : r1 // k, c0 // k : c1 // k] = block_mean(a, k)
            del a
        log(f"{v['id']}: rows {r1}/{nlat}, {time.time() - t0:.0f}s")

    # trailing months without any data are dropped
    has = np.zeros(nt, dtype=bool)
    step = max(1, cube.shape[0] // 12)
    for r in range(0, cube.shape[0], step):
        has |= np.isfinite(cube[r : r + step]).any(axis=(0, 1))
    last = int(np.nonzero(has)[0][-1]) + 1
    first = int(np.nonzero(has)[0][0])
    final = np.lib.format.open_memmap(
        out / "data.npy", mode="w+", dtype=np.float32, shape=(cube.shape[0], cube.shape[1], last - first)
    )
    for r in range(0, cube.shape[0], step):
        final[r : r + step] = cube[r : r + step, :, first:last]
    final.flush()
    del cube, final
    tmp.unlink()

    dlat, dlon = float(lat[1] - lat[0]) * k, float(lon[1] - lon[0]) * k
    meta = {
        "id": v["id"],
        "source": v["source"],
        "store": v["store"],
        "var": v["var"],
        "units": v["units"],
        # centres of the first cube cell
        "lat0": float(lat[:k].mean()),
        "dlat": dlat,
        "nlat": nlat // k,
        "lon0": float(lon[:k].mean()),
        "dlon": dlon,
        "nlon": nlon // k,
        "t0": str(times[first]),
        "nt": last - first,
        "long_name": da.attrs.get("long_name", ""),
        "native_units": da.attrs.get("units", ""),
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    log(
        f"{v['id']}: done, {meta['nlat']}x{meta['nlon']} cells, {meta['t0']} + {meta['nt']} months, "
        f"{time.time() - t0:.0f}s"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--only", default="", help="comma-separated variable ids")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    only = {x for x in args.only.split(",") if x}
    fs = s3fs.S3FileSystem(anon=True)
    failed = []
    for v in VARIABLES:
        if not v["store"].startswith(POWER) or (only and v["id"] not in only):
            continue
        try:
            fetch(fs, v, args.data / "cube", args.force)
        except Exception as e:  # the other variables still load
            failed.append(v["id"])
            log(f"{v['id']}: FAILED {type(e).__name__}: {e}")
    log("all done" + (f", failed: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
