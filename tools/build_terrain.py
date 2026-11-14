"""Builds terrain.npz in the data folder: the dominant land cover type of every 0.5 degree cell.

Source: MODIS land cover MCD12C1 v061 (IGBP classes, 0.05 degree, one year), from LP DAAC with an Earthdata token.
The shares of the 17 IGBP classes are averaged over each 0.5 degree cell and grouped into ten terrain types. A cell
gets the type that covers at least half of it; cities rarely fill half a cell, so a quarter is enough for them.
Cells with no type above the threshold stay mixed and belong to no type.

Usage:
    python tools/build_terrain.py --data /path/to/data [--year 2023]
"""

import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np
import requests
from pyhdf.SD import SD, SDC

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "etl"))
from fetch_modis import CMR, log, token

SDS = "Land_Cover_Type_1_Percent"
BLOCK = 10  # 0.05 -> 0.5 degree
MIN_SHARE = 50.0
MIN_SHARE_URBAN = 25.0

# terrain id -> IGBP classes (0 water ... 16 barren); the order is the index stored in the file
TYPES = {
    "rainforest": [2],
    "forest": [1, 3, 4, 5],
    "shrubland": [6, 7],
    "savanna": [8, 9],
    "grassland": [10],
    "wetland": [11],
    "cropland": [12, 14],
    "urban": [13],
    "ice": [15],
    "barren": [16],
}


def granule(year: int) -> str:
    r = requests.get(
        CMR,
        params={"short_name": "MCD12C1", "version": "061", "temporal": f"{year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z"},
        timeout=120,
    )
    r.raise_for_status()
    links = [l["href"] for g in r.json()["feed"]["entry"] for l in g["links"] if l["href"].endswith(".hdf")]
    if not links:
        sys.exit(f"no MCD12C1 granule for {year}")
    return next(u for u in links if u.startswith("https"))


def shares(path: Path) -> np.ndarray:
    """[lat 360 north to south, lon 720, 17 classes] percent of each IGBP class in every 0.5 degree cell."""
    sd = SD(str(path), SDC.READ)
    a = sd.select(SDS)[:]  # (3600, 7200, 17), uint8 percent
    sd.end()
    out = np.zeros((360, 720, 17), dtype=np.float32)
    for k in range(17):
        out[:, :, k] = a[:, :, k].reshape(360, BLOCK, 720, BLOCK).mean(axis=(1, 3))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--year", default=2023, type=int)
    args = ap.parse_args()
    url = granule(args.year)
    log(f"MCD12C1 {args.year}: {url.rsplit('/', 1)[1]}")
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "mcd12c1.hdf"
        with requests.get(url, headers={"Authorization": f"Bearer {token()}"}, timeout=1800, stream=True) as r:
            r.raise_for_status()
            with open(path, "wb") as f:
                for chunk in r.iter_content(1 << 22):
                    f.write(chunk)
        s = shares(path)
    groups = np.stack([s[:, :, cls].sum(axis=2) for cls in TYPES.values()], axis=2)  # (360, 720, types)
    # the file runs north to south; the cube grids run south to north
    groups = groups[::-1]
    best = groups.argmax(axis=2)
    top = groups.max(axis=2)
    urban = list(TYPES).index("urban")
    dominant = np.where(top >= MIN_SHARE, best, 255).astype(np.uint8)
    dominant[groups[:, :, urban] >= MIN_SHARE_URBAN] = urban
    dest = args.data / "terrain.npz"
    np.savez_compressed(
        dest,
        dominant=dominant,
        shares=np.round(groups).astype(np.uint8),
        types=np.array(list(TYPES)),
        lat0=-89.75,
        dlat=0.5,
        lon0=-179.75,
        dlon=0.5,
        year=args.year,
    )
    counts = {t: int((dominant == i).sum()) for i, t in enumerate(TYPES)}
    log(f"{dest}: cells per type {counts}, mixed {int((dominant == 255).sum())}")


if __name__ == "__main__":
    main()
