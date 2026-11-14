"""Territories: countries and first-level regions (Natural Earth, with Russian names), latitude belts, and user
geometries (polygon, box, point).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import duckdb
import shapely
from shapely.geometry import box, shape

# (id, south, north, en, ru)
BELTS = [
    ("global", -90, 90, "Whole Earth", "Вся Земля"),
    ("arctic", 66.5, 90, "Arctic (north of 66.5°N)", "Арктика (севернее 66,5° с. ш.)"),
    ("nh_mid", 23.5, 66.5, "Northern mid-latitudes", "Умеренные широты Северного полушария"),
    ("tropics", -23.5, 23.5, "Tropics", "Тропики"),
    ("sh_mid", -66.5, -23.5, "Southern mid-latitudes", "Умеренные широты Южного полушария"),
    ("antarctic", -90, -66.5, "Antarctic (south of 66.5°S)", "Антарктика (южнее 66,5° ю. ш.)"),
]


# Ocean regions for ocean variables (chlorophyll): (id, [boxes w s e n], en, ru). A region that crosses
# the antimeridian is two boxes. Boxes are approximate: they follow the textbook regions, not coastlines.
OCEANS = [
    (
        "ocean_n_pacific_gyre",
        [(150, 15, 180, 35), (-180, 15, -130, 35)],
        "North Pacific subtropical gyre",
        "Субтропический круговорот северной части Тихого океана",
    ),
    (
        "ocean_s_pacific_gyre",
        [(-150, -35, -90, -15)],
        "South Pacific subtropical gyre",
        "Субтропический круговорот южной части Тихого океана",
    ),
    (
        "ocean_n_atlantic_gyre",
        [(-70, 15, -20, 35)],
        "North Atlantic subtropical gyre (Sargasso Sea)",
        "Субтропический круговорот Северной Атлантики (Саргассово море)",
    ),
    (
        "ocean_s_atlantic_gyre",
        [(-35, -35, 5, -15)],
        "South Atlantic subtropical gyre",
        "Субтропический круговорот Южной Атлантики",
    ),
    (
        "ocean_indian_gyre",
        [(55, -35, 100, -15)],
        "South Indian Ocean gyre",
        "Субтропический круговорот Индийского океана",
    ),
    ("ocean_n_atlantic_subpolar", [(-60, 45, -10, 65)], "North Atlantic subpolar", "Субполярная Северная Атлантика"),
    (
        "ocean_eq_pacific",
        [(160, -10, 180, 10), (-180, -10, -90, 10)],
        "Equatorial Pacific",
        "Экваториальная часть Тихого океана",
    ),
    ("ocean_southern", [(-180, -65, 180, -45)], "Southern Ocean", "Южный океан"),
    ("ocean_arabian_sea", [(50, 5, 75, 25)], "Arabian Sea", "Аравийское море"),
    ("ocean_bay_of_bengal", [(80, 5, 95, 22)], "Bay of Bengal", "Бенгальский залив"),
    ("ocean_mediterranean", [(-5, 30, 36, 46)], "Mediterranean Sea", "Средиземное море"),
    ("ocean_baltic", [(10, 53, 30, 66)], "Baltic Sea", "Балтийское море"),
    ("ocean_gulf_of_mexico", [(-98, 18, -81, 31)], "Gulf of Mexico", "Мексиканский залив"),
    (
        "ocean_benguela",
        [(8, -35, 20, -15)],
        "Benguela upwelling (off southwest Africa)",
        "Бенгельский апвеллинг (у юго-западной Африки)",
    ),
    ("ocean_humboldt", [(-85, -20, -70, -3)], "Humboldt upwelling (off Peru)", "Апвеллинг Гумбольдта (у берегов Перу)"),
    ("ocean_bering", [(-180, 52, -157, 66), (162, 52, 180, 66)], "Bering Sea", "Берингово море"),
    ("ocean_barents", [(15, 68, 60, 80)], "Barents Sea", "Баренцево море"),
]


class Regions:
    def __init__(self, data_dir: Path):
        con = duckdb.connect()
        rows = con.execute(
            # the only value put into the text is the path of the project's own data file
            f"""SELECT r.region_id, r.level, r.parent_id, r.iso, r.name_en, r.name_local, r.name_ru,
                       r.bbox_w, r.bbox_s, r.bbox_e, r.bbox_n, r.area_km2, r.geojson::VARCHAR,
                       p.name_en, p.name_ru
                FROM '{(data_dir / "regions.parquet").as_posix()}' r
                LEFT JOIN '{(data_dir / "regions.parquet").as_posix()}' p ON p.region_id = r.parent_id"""  # noqa: S608  # nosec B608
        ).fetchall()
        self.items: dict[str, dict] = {}
        self._geojson: dict[str, str] = {}
        for rid, level, parent, iso, en, local, ru, w, s, e, n, area, gj, pen, pru in rows:
            self.items[rid] = {
                "region_id": rid,
                "level": level,
                "parent_id": parent,
                "iso": iso,
                "name": {"en": en, "ru": ru or en},
                "name_local": local,
                "parent_name": {"en": pen, "ru": pru or pen} if pen else None,
                "bbox": [w, s, e, n],
                "area_km2": area,
            }
            self._geojson[rid] = gj
        for oid, boxes, en, ru in OCEANS:
            geom = shapely.union_all([box(*b) for b in boxes])
            w, s, e, n = geom.bounds
            self.items[oid] = {
                "region_id": oid,
                "level": -2,
                "parent_id": None,
                "iso": None,
                "name": {"en": en, "ru": ru},
                "name_local": None,
                "parent_name": {"en": "Ocean", "ru": "Океан"},
                "bbox": [w, s, e, n],
                "area_km2": None,
            }
            self._geojson[oid] = json.dumps(shapely.geometry.mapping(geom))
        for bid, s, n, en, ru in BELTS:
            self.items[bid] = {
                "region_id": bid,
                "level": -1,
                "parent_id": None,
                "iso": None,
                "name": {"en": en, "ru": ru},
                "name_local": None,
                "parent_name": None,
                "bbox": [-180, s, 180, n],
                "area_km2": None,
            }
            self._geojson[bid] = json.dumps(shapely.geometry.mapping(box(-180, s, 180, n)))

    def get(self, rid: str) -> dict | None:
        return self.items.get(rid)

    def geojson(self, rid: str) -> str | None:
        return self._geojson.get(rid)

    @lru_cache(maxsize=256)  # noqa: B019  one Regions object lives as long as the process
    def geometry(self, rid: str):
        g = shape(json.loads(self._geojson[rid]))
        return g if g.is_valid else g.buffer(0)

    def search(self, q: str, limit: int = 12) -> list[dict]:
        q = q.strip().lower()
        if not q:
            return [self.items[b[0]] for b in BELTS]
        scored = []
        for it in self.items.values():
            names = [x.lower() for x in (it["name"]["en"], it["name"]["ru"], it["name_local"]) if x]
            if it["level"] == -2:  # "ocean", "океан" finds every ocean region
                names += ["ocean", "океан"]
            if any(x == q for x in names) or (it["iso"] or "").lower() == q:
                rank = 0
            elif any(x.startswith(q) for x in names):
                rank = 1
            elif any(q in x for x in names):
                rank = 2
            else:
                continue
            scored.append((rank, it["level"], -(it["area_km2"] or 0), it))
        scored.sort(key=lambda x: x[:3])
        return [x[3] for x in scored[:limit]]


def geometry_from_request(polygon: dict | None, bbox: list[float] | None, point: list[float] | None):
    """User geometry: GeoJSON (Feature, FeatureCollection or geometry), [w, s, e, n] or [lon, lat]."""
    if polygon:
        g = polygon
        if g.get("type") == "FeatureCollection":
            g = shapely.union_all([shape(f["geometry"]) for f in g["features"]])
        elif g.get("type") == "Feature":
            g = shape(g["geometry"])
        else:
            g = shape(g)
        return g if g.is_valid else g.buffer(0)
    if bbox:
        w, s, e, n = bbox
        return box(w, s, e, n)
    if point:
        return shapely.Point(point[0], point[1])
    return None
