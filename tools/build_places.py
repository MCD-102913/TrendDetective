"""Builds places.parquet in the data folder: named physical regions, seas and large cities from Natural Earth (public domain).

    deserts, plateaus, basins, mountain ranges, plains, deltas   ne_10m_geography_regions_polys
    oceans, seas, gulfs, bays                                    ne_10m_geography_marine_polys
    cities with more than 5 million people (a 50 km circle)      ne_10m_populated_places

Shapes with the same English name are merged into one territory. The API loads the file next to the countries.

Usage:
    python tools/build_places.py --data /path/to/data
"""

import argparse
import json
import math
import re
import tempfile
from pathlib import Path

import duckdb
import requests
import shapely
from shapely import affinity
from shapely.geometry import Point

NE = "https://naciscdn.org/naturalearth/10m/"
CITY_MIN_POP = 5_000_000
CITY_RADIUS_KM = 50.0
KM_PER_DEG = 111.32
SIMPLIFY_DEG = 0.02  # well below the 0.5 degree grid of the data

# Natural Earth class -> (kind, en, ru)
KINDS = {
    "Desert": ("desert", "Desert", "пустыня"),
    "Plateau": ("plateau", "Plateau", "плато"),
    "Basin": ("basin", "Basin", "котловина"),
    "Range/mtn": ("mountains", "Mountains", "горы"),
    "Plain": ("plain", "Plain", "равнина"),
    "Delta": ("delta", "Delta", "дельта"),
    "ocean": ("ocean", "Ocean", "океан"),
    "sea": ("sea", "Sea", "море"),
    "gulf": ("gulf", "Gulf", "залив"),
    "bay": ("bay", "Bay", "залив"),
}
CITY = ("city", "City", "город")


def shapes(name: str, part: str, cols: str) -> list[tuple]:
    """Rows of a Natural Earth layer with the geometry as WKB, read straight from the downloaded zip."""
    r = requests.get(f"{NE}{part}/{name}.zip", timeout=300)
    r.raise_for_status()
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d) / f"{name}.zip"
        tmp.write_bytes(r.content)
        con = duckdb.connect()
        con.execute("INSTALL spatial; LOAD spatial")
        # the path is built here from a fixed layer name, never from user input
        return con.execute(
            f"SELECT {cols}, ST_AsWKB(geom) FROM ST_Read('/vsizip/{tmp.as_posix()}/{name}.shp')"  # noqa: S608  # nosec B608
        ).fetchall()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def area_km2(g) -> float:
    lat = g.centroid.y
    return g.area * KM_PER_DEG**2 * math.cos(math.radians(lat))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    args = ap.parse_args()

    merged: dict[tuple[str, str], dict] = {}
    layers = [
        ("ne_10m_geography_regions_polys", "physical", "FEATURECLA, NAME_EN, NAME_RU"),
        ("ne_10m_geography_marine_polys", "physical", "featurecla, name_en, name_ru"),
    ]
    for name, part, cols in layers:
        for cla, en, ru, wkb in shapes(name, part, cols):
            if cla not in KINDS or not en:
                continue
            kind = KINDS[cla][0]
            g = shapely.from_wkb(bytes(wkb))
            item = merged.setdefault((kind, en.strip()), {"kind": kind, "en": en.strip(), "ru": (ru or en).strip(), "geoms": []})
            item["geoms"].append(g)

    rows = []
    for (kind, en), item in merged.items():
        g = shapely.union_all(item["geoms"]).simplify(SIMPLIFY_DEG, preserve_topology=True)
        if g.is_empty:
            continue
        rows.append({"kind": kind, "en": en, "ru": item["ru"], "parent": None, "geom": g})

    for en, ru, pop, iso, lat, lon, _ in shapes(
        "ne_10m_populated_places", "cultural", "NAME_EN, NAME_RU, POP_MAX, ADM0_A3, LATITUDE, LONGITUDE"
    ):
        if not pop or pop < CITY_MIN_POP or not en:
            continue
        r = CITY_RADIUS_KM / KM_PER_DEG
        circle = affinity.scale(Point(lon, lat).buffer(r, 32), xfact=1 / math.cos(math.radians(lat)), yfact=1.0)
        rows.append({"kind": "city", "en": en.strip(), "ru": (ru or en).strip(), "parent": iso, "geom": circle})

    # one Russian name can stand for two parts of an ocean ("North Atlantic", "South Atlantic"): keep them apart
    ru_count: dict[str, int] = {}
    for r_ in rows:
        ru_count[r_["ru"]] = ru_count.get(r_["ru"], 0) + 1
    out, used = [], set()
    for r_ in sorted(rows, key=lambda x: (x["kind"], x["en"])):
        rid = f"{r_['kind']}_{slug(r_['en'])}"
        k = 2
        while rid in used:
            rid, k = f"{r_['kind']}_{slug(r_['en'])}_{k}", k + 1
        used.add(rid)
        ru = r_["ru"] if ru_count[r_["ru"]] == 1 else f"{r_['ru']} ({r_['en']})"
        g = r_["geom"]
        w, s, e, n = g.bounds
        out.append(
            (rid, r_["kind"], r_["en"], ru, r_["parent"], w, s, e, n, area_km2(g), json.dumps(shapely.geometry.mapping(g)))
        )

    con = duckdb.connect()
    con.execute(
        "CREATE TABLE places (region_id VARCHAR, kind VARCHAR, name_en VARCHAR, name_ru VARCHAR, parent_id VARCHAR, "
        "bbox_w DOUBLE, bbox_s DOUBLE, bbox_e DOUBLE, bbox_n DOUBLE, area_km2 DOUBLE, geojson VARCHAR)"
    )
    con.executemany("INSERT INTO places VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", out)
    dest = args.data / "places.parquet"
    con.execute(f"COPY places TO '{dest.as_posix()}' (FORMAT PARQUET)")  # the project's own data path
    counts = con.execute("SELECT kind, count(*) FROM places GROUP BY 1 ORDER BY 2 DESC").fetchall()
    print(f"{dest}: {len(out)} places", dict(counts))


if __name__ == "__main__":
    main()
