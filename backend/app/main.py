"""TerraScope API.

    GET  /api/health
    GET  /api/variables                     catalog: what can be analysed, grouped by sphere
    GET  /api/regions?q=                    territory search (countries, regions, latitude belts)
    GET  /api/regions/{id}                  one territory
    GET  /api/regions/{id}/geometry         GeoJSON outline
    POST /api/series                        monthly series + trend report for a variable and a territory
    POST /api/profile                       trend by height: one quantity at every pressure level of a territory
    GET  /api/ai/status, POST /api/ai/ask   the trend detective agent (Gemini; numbers come from our own tests)
    GET  /api/map/meta?variable=            scale, period and significance summary of the trend map
    GET  /api/map.png?variable=             the trend map as a Web-Mercator PNG overlay
    GET  /api/cell?variable=&lat=&lon=      rate and significance of one map cell (hover)
    POST /api/relation                      is one variable related to another on this territory (beyond a shared trend)?
    GET  /api/scan?variable=                countries where the trend of the variable is robust
    GET  /api/rules, GET /api/rules/{id}, POST /api/rules/try   hypotheses; try = a session rule, never saved
    GET  /api/verify/tools, GET /api/verify/reference, POST /api/verify   comparison with NASA Giovanni and POWER

Started with:  TREND_DATA_DIR=/path/to/data uvicorn backend.app.main:app

A deployment may add its own routes and middleware in an optional `extensions` package next to this module:
every module there that defines `install(app)` is called once at start.
"""

from __future__ import annotations

import importlib
import itertools
import json
import math
import os
import pkgutil
import sqlite3
import threading
from contextlib import closing
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests
import shapely
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import ai, discovery, forecast, gibs, maps, rules as rulebook, terrain as terrain_mod, trend, verify
from .catalog import BY_ID, PROFILES, SOURCES, SPHERES, TWINS, VARIABLES
from .cube import Cube, Grid
from .regions import Regions, geometry_from_request

DATA_DIR = Path(os.environ.get("TREND_DATA_DIR", "data"))
MAX_GEOMETRY_POINTS = 20000
COUNTRY_HEADER = os.environ.get("TREND_COUNTRY_HEADER", "").strip().lower()
# the header where a proxy in front of the site puts the visitor's address (for the limits of the SI agent)
CLIENT_IP_HEADER = os.environ.get("TREND_CLIENT_IP_HEADER", "x-forwarded-for").strip().lower()

app = FastAPI(title="TerraScope API", version="0.2")
_lock = threading.Lock()
_state: dict = {}
verifier = verify.Verifier(DATA_DIR)
space = gibs.Gibs(DATA_DIR)
terrain = terrain_mod.Terrain(DATA_DIR)
rule_store = rulebook.RuleStore(DATA_DIR, Path(__file__).resolve().parents[2] / "rules" / "rules.yaml")


def cube() -> Cube:
    with _lock:
        if "cube" not in _state:
            _state["cube"] = Cube(DATA_DIR)
        return _state["cube"]


def regions() -> Regions:
    with _lock:
        if "regions" not in _state:
            _state["regions"] = Regions(DATA_DIR)
        return _state["regions"]


def clean(x):
    """JSON-safe: NaN -> None, numpy -> python, floats rounded to 5 significant digits."""
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, np.ndarray):
        return [clean(v) for v in x.tolist()]
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer, int)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        x = float(x)
        return None if not math.isfinite(x) else float(f"{x:.5g}")
    return x


def variable(vid: str):
    c = cube()
    if vid not in BY_ID:
        raise HTTPException(404, "unknown variable")
    if vid not in c:
        c.reload()
    if vid not in c:
        raise HTTPException(503, "variable is not loaded yet")
    return BY_ID[vid], c[vid]


@app.get("/api/health")
def health():
    return {"ok": True, "variables": len(cube().vars)}


@app.get("/api/variables")
def variables():
    c = cube()
    c.reload()
    out = []
    for v in VARIABLES:
        if v["id"] not in c:
            continue
        cv = c[v["id"]]
        out.append(
            {
                "id": v["id"],
                "name": v["name"],
                "hint": v["hint"],
                "sphere": v["sphere"],
                "source": v["source"],
                "units": v["units"],
                "kind": v["kind"],
                "decimals": v["decimals"],
                "start": cv.meta["t0"],
                "end": cv.t1,
                "resolution": [cv.grid.dlat, cv.grid.dlon],
                "palette": maps.palette_for(v["id"]),
                "profile": v.get("profile"),
            }
        )
    return {"spheres": SPHERES, "sources": SOURCES, "profiles": PROFILES, "variables": out}


@app.get("/api/regions")
def region_search(q: str = "", limit: int = Query(12, ge=1, le=50)):
    return {"results": regions().search(q, limit)}


@app.get("/api/home")
def home(request: Request):
    """The visitor's country (the simple view opens on it); null if unknown.

    Read from the header named in TREND_COUNTRY_HEADER, set by a proxy in front of the site with a two letter country
    code. Without it the country is never guessed.
    """
    code = request.headers.get(COUNTRY_HEADER, "").upper() if COUNTRY_HEADER else ""
    try:
        import pycountry

        c = pycountry.countries.get(alpha_2=code) if len(code) == 2 else None
    except (ImportError, KeyError, LookupError):
        c = None
    rid = c.alpha_3 if c else None
    return {"region_id": rid if rid and regions().get(rid) else None}


@app.get("/api/region-ids")
def region_ids():
    """All territory codes (for checking rules files offline: tools/check_rules.py)."""
    return {"ids": sorted(regions().items)}


@app.get("/api/regions/{region_id}")
def region_info(region_id: str):
    info = regions().get(region_id)
    if not info:
        raise HTTPException(404, "unknown region")
    return info


@app.get("/api/regions/{region_id}/geometry")
def region_geometry(region_id: str):
    gj = regions().geojson(region_id)
    if gj is None:
        raise HTTPException(404, "unknown region")
    return Response(gj, media_type="application/geo+json")


class SeriesRequest(BaseModel):
    variable: str
    region_id: str | None = None
    polygon: dict | None = None
    bbox: list[float] | None = None  # [west, south, east, north]
    point: list[float] | None = None  # [lon, lat]
    name: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    terrain: str | None = None  # keep only the cells of one terrain type (terrain.py)


@lru_cache(maxsize=512)
def _region_cells(region_id: str, grid_key: tuple):
    c = cube()
    grid = next(v.grid for v in c.vars.values() if v.grid.key == grid_key)
    return grid.cells_in(regions().geometry(region_id))


def resolve(req, var):
    """Cells of the requested territory on the grid of `var` + its description."""
    if req.region_id:
        info = regions().get(req.region_id)
        if not info:
            raise HTTPException(404, "unknown region")
        ii, jj = _region_cells(req.region_id, var.grid.key)
        territory = {
            "region_id": req.region_id,
            "name": info["name"],
            "parent_name": info["parent_name"],
            "bbox": info["bbox"],
            "kind": "region",
        }
    else:
        geom = geometry_from_request(req.polygon, req.bbox, req.point)
        if geom is None or geom.is_empty:
            raise HTTPException(422, "region_id, polygon, bbox or point is required")
        if shapely_points(geom) > MAX_GEOMETRY_POINTS:
            raise HTTPException(422, "geometry is too detailed")
        ii, jj = var.grid.cells_in(geom)
        kind = "point" if req.point else "area"
        label = req.name or ("Point" if req.point else "Custom area")
        territory = {
            "region_id": None,
            "name": {
                "en": label,
                "ru": req.name or ("Точка" if req.point else "Своя область"),
            },
            "parent_name": None,
            "bbox": list(geom.bounds),
            "kind": kind,
        }
        if req.point:
            territory["cell"] = [float(var.grid.lon[jj[0]]), float(var.grid.lat[ii[0]])]
    tid = getattr(req, "terrain", None)
    if tid:
        if not terrain.ok or tid not in terrain.types:
            raise HTTPException(422, "unknown terrain type")
        keep = terrain.keep(var.grid.lat[ii], var.grid.lon[jj], tid)
        if not keep.any():
            raise HTTPException(422, "this territory has no cells of this terrain type")
        ii, jj = ii[keep], jj[keep]
        label = terrain.label(tid)
        territory["terrain"] = {"id": tid, "name": label}
        territory["name"] = {k: f"{territory['name'][k]}: {label[k]}" for k in ("en", "ru")}
    return ii, jj, territory


@app.get("/api/terrain")
def terrain_types(region_id: str | None = None):
    """Terrain types present in a territory (or on the whole Earth), with the number of 0.5 degree cells of each."""
    if not terrain.ok:
        return {"year": None, "types": []}
    grid = Grid(terrain.lat0, terrain.dlat, terrain.nlat, terrain.lon0, terrain.dlon, terrain.nlon)
    if region_id:
        if not regions().get(region_id):
            raise HTTPException(404, "unknown region")
        ii, jj = grid.cells_in(regions().geometry(region_id))
    else:
        ii, jj = np.indices((grid.nlat, grid.nlon)).reshape(2, -1)
    counts = terrain.counts(grid.lat[ii], grid.lon[jj])
    return {
        "year": terrain.year,
        "types": [
            {"id": t, "name": terrain.label(t), "cells": n} for t, n in sorted(counts.items(), key=lambda x: -x[1])
        ],
    }


def window(var, y, start_year, end_year):
    sel = np.ones(len(y), dtype=bool)
    if start_year:
        sel &= var.year >= start_year
    if end_year:
        sel &= var.year <= end_year
    return y[sel], var.year[sel], var.month[sel]


def second_opinion(req, cat, r, year) -> list[dict]:
    """The same quantity from independent sources, on the common period: do they agree on the trend?"""
    out = []
    c = cube()
    for tid in TWINS.get(cat["id"], []):
        if tid not in c or "rate" not in r:
            continue
        tcat, tvar = BY_ID[tid], c[tid]
        try:
            ii, jj, _ = resolve(req, tvar)
            ty, _ = tvar.series(ii, jj)
        except HTTPException:
            continue
        y0, y1 = (
            max(int(year[0]), int(tvar.year[0])),
            min(int(year[-1]), int(tvar.year[-1])),
        )
        ty, tyear, tmonth = window(tvar, ty, y0, y1)
        if np.isfinite(ty).sum() < 120:
            continue
        tr = trend.analyze(ty, tyear, tmonth)
        if "rate" not in tr:
            continue
        rate = tr["rate"]["per_decade"]
        rel = tcat["kind"] == "rel" and tr["mean"]
        out.append(
            {
                "id": tid,
                "name": tcat["name"],
                "source": tcat["source"],
                "years": [y0, y1],
                "verdict": tr["verdict"],
                "units": "%" if rel else tcat["units"],
                "decimals": 1 if rel else tcat["decimals"],
                "per_decade": rate / abs(tr["mean"]) * 100 if rel else rate,
                "agrees": bool(
                    np.sign(rate) == np.sign(r["rate"]["per_decade"]) and tr["verdict"].startswith("significant")
                ),
            }
        )
    return out


_json_cache: dict[Path, tuple[float, dict]] = {}


def precomputed(rel: str) -> dict:
    """A JSON file written by a tool under the data directory, reread when it changes; {} if never written."""
    p = DATA_DIR / rel
    try:
        mtime = p.stat().st_mtime
    except OSError:
        return {}
    if p not in _json_cache or _json_cache[p][0] != mtime:
        _json_cache[p] = (mtime, json.loads(p.read_text()))
    return _json_cache[p][1]


def forecast_skill() -> dict:
    """The hindcast table written by tools/hindcast.py."""
    return precomputed("forecast/hindcast.json")


def _db() -> sqlite3.Connection:
    """The database of the exhaustive search (tools/discover.py), read-only."""
    path = DATA_DIR / "discoveries" / "discoveries.sqlite"
    if not path.exists():
        raise HTTPException(404, "the search has not been run")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _meta(con) -> dict:
    return {k: json.loads(v) for k, v in con.execute("SELECT key, value FROM meta")}


_SOURCES = {k: v["source"] for k, v in BY_ID.items()}


def _names(row) -> dict:
    row = dict(row)
    for k in ("a", "b", "c"):
        if k in row:
            row[f"{k}_name"] = BY_ID[row[k]]["name"]
    if "kind" not in row:
        row["kind"] = discovery.pair_kind(row["a"], row["b"], _SOURCES)
    if "y0" in row:
        row["years"] = [row.pop("y0"), row.pop("y1")]
    return row


def _kind_rank(row: dict) -> int:
    return discovery.KIND_ORDER[row["kind"]]


def _with_region(row, keys: tuple[str, ...]) -> dict:
    """A territory row of a pair or chain list: only what the list shows, plus what is needed to open it."""
    info = regions().get(row["region_id"]) or {}
    return {
        **{k: row[k] for k in keys},
        "region_id": row["region_id"],
        "name": info.get("name"),
        "level": info.get("level"),
        "parent_name": info.get("parent_name"),
        "bbox": [round(v, 2) for v in info.get("bbox") or []],
    }


@app.get("/api/discoveries")
def discoveries_summary(limit: int = Query(60, ge=1, le=700)):
    with closing(_db()) as con:
        m = _meta(con)
        rows = [_names(r) for r in con.execute("SELECT * FROM pairs WHERE found > 0")]
    # links between independent sources first: a link inside one model may be the model's own physics
    rows.sort(key=lambda p: (_kind_rank(p), -p["found"], -abs(p["median_r"] or 0)))
    return {
        "generated": m["generated"],
        "rule": m["rule"],
        "counts": m["counts"],
        "pairs": rows[:limit],
    }


@app.get("/api/discoveries/region/{region_id}")
def discoveries_region(region_id: str, limit: int = Query(40, ge=1, le=700)):
    with closing(_db()) as con:
        m = _meta(con)
        links = [_names(r) for r in con.execute("SELECT * FROM links WHERE region_id = ?", (region_id,))]
        chains = [_names(r) for r in con.execute("SELECT * FROM chains WHERE region_id = ?", (region_id,))]
    links.sort(key=lambda x: (_kind_rank(x), -abs(x["r"] or 0)))
    chains.sort(key=lambda x: (_kind_rank(x), -abs(x["r_ac"] or 0)))
    return {
        "region_id": region_id,
        "counts": m["counts"],
        "total": len(links),
        "links": links[:limit],
        "chains_total": len(chains),
        "chains": chains[:20],
    }


@app.get("/api/discoveries/pair/{a}/{b}")
def discoveries_pair(a: str, b: str):
    with closing(_db()) as con:
        m = _meta(con)
        p = con.execute(
            "SELECT * FROM pairs WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)",
            (a, b, b, a),
        ).fetchone()
        if p is None:
            raise HTTPException(404, "pair not tested")
        rows = [
            _with_region(r, ("r", "lag"))
            for r in con.execute(
                "SELECT * FROM links WHERE a = ? AND b = ? ORDER BY abs(r) DESC",
                (p["a"], p["b"]),
            )
        ]
    return {**_names(p), "counts": m["counts"], "regions": rows}


@app.get("/api/chains")
def chains_summary(limit: int = Query(40, ge=1, le=2000)):
    with closing(_db()) as con:
        m = _meta(con)
        rows = [_names(r) for r in con.execute("SELECT * FROM chain_summary")]
    rows.sort(key=lambda c: (_kind_rank(c), -c["countries"], -c["found"]))
    return {"generated": m["generated"], "counts": m["counts"], "chains": rows[:limit]}


@app.get("/api/chains/{a}/{b}/{c}")
def chain_detail(a: str, b: str, c: str):
    with closing(_db()) as con:
        m = _meta(con)
        s = con.execute("SELECT * FROM chain_summary WHERE a = ? AND b = ? AND c = ?", (a, b, c)).fetchone()
        if s is None:
            raise HTTPException(404, "chain not found")
        rows = [
            _with_region(r, ("r_ab", "r_bc", "r_ac", "partial", "lag1", "lag2"))
            for r in con.execute(
                "SELECT * FROM chains WHERE a = ? AND b = ? AND c = ? ORDER BY abs(r_ac) DESC",
                (a, b, c),
            )
        ]
    return {**_names(s), "counts": m["counts"], "regions": rows}


def outlook_block(cat, r, robust, y, year, month, territory: dict) -> dict:
    return forecast.outlook_block(forecast_skill(), cat, r, robust, y, year, month, territory)


@app.get("/api/forecast/skill")
def forecast_skill_table():
    d = forecast_skill()
    if not d:
        raise HTTPException(404, "hindcast not computed")

    def pick(v):
        return {f: v.get(f) for f in forecast.SKILL_FIELDS}

    return {
        "generated": d["generated"],
        "rule": d["rule"],
        "variables": [
            {
                "id": k,
                "name": BY_ID[k]["name"] if k in BY_ID else k,
                "world": pick(v["global"]),
                "zones": {z: pick(r) for z, r in v["zones"].items()},
            }
            for k, v in d["variables"].items()
        ],
    }


def outlooks() -> dict:
    d = precomputed("forecast/outlooks.json")
    if not d:
        raise HTTPException(404, "outlooks not computed")
    return d


@app.get("/api/forecast/map")
def forecast_map(variable_id: str = Query(..., alias="variable")):
    """The outlook of every country for one variable: the expected change by the end of the horizon."""
    cat, _ = variable(variable_id)
    d = outlooks()
    rows = d["variables"].get(variable_id)
    if rows is None:
        raise HTTPException(404, "no outlooks for this variable")
    rg = regions()
    out = [
        {
            **v,
            "region_id": rid,
            "name": rg.require(rid)["name"],
            "bbox": rg.require(rid)["bbox"],
        }
        for rid, v in rows.items()
    ]
    changes = [abs(v["change"]) for v in out if v.get("available")]
    pal = maps.palette_for(variable_id)
    return clean(
        {
            "variable": variable_id,
            "generated": d["generated"],
            "units": cat["units"],
            "decimals": cat["decimals"],
            "scale": float(np.percentile(changes, 95)) if changes else 1.0,
            "colors": maps.legend_colors(pal),
            "bounds": [-180, -maps.MERC_MAX_LAT, 180, maps.MERC_MAX_LAT],
            "rows": out,
        }
    )


@lru_cache(maxsize=8)
def _owner(grid_key: tuple, vid: str) -> np.ndarray:
    """Which country (index into _countries()) every grid cell belongs to, -1 for none."""
    var = cube()[vid]
    own = np.full((var.grid.nlat, var.grid.nlon), -1, dtype=np.int32)
    for k, rid in enumerate(_countries()):
        ii, jj = _region_cells(rid, grid_key)
        own[ii, jj] = np.where(own[ii, jj] < 0, k, own[ii, jj])
    return own


@lru_cache(maxsize=16)
def _forecast_png(vid: str, generated: str) -> bytes:
    _, var = variable(vid)
    rows = outlooks()["variables"][vid]
    own = _owner(var.grid.key, vid)
    countries = _countries()
    avail = [abs(rows[r]["change"]) for r in countries if r in rows and rows[r].get("available")]
    scale = float(np.percentile(avail, 95)) if avail else 1.0
    change = np.full(len(countries) + 1, np.nan)  # the last slot: cells of no country
    known = np.zeros(len(countries) + 1, dtype=bool)
    for k, rid in enumerate(countries):
        v = rows.get(rid)
        if v:
            known[k] = True
            if v.get("available"):
                change[k] = v["change"]
    idx = np.where(own >= 0, own, len(countries))
    field = change[idx]
    grey = np.where(known[idx] & ~np.isfinite(field), 0.0, np.nan)  # tested, no outlook: drawn neutral
    return maps.render_forecast(var, field, grey, maps.PALETTES[maps.palette_for(vid)], scale)


@app.get("/api/forecast/map.png")
def forecast_map_png(variable_id: str = Query(..., alias="variable")):
    variable(variable_id)
    return Response(
        _forecast_png(variable_id, outlooks()["generated"]),
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/forecast/where")
def forecast_where(
    variable_id: str = Query(..., alias="variable"),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """The country under a click on the forecast map."""
    _, var = variable(variable_id)
    k = int(_owner(var.grid.key, variable_id)[var.grid.row(lat), var.grid.col(lon)])
    if k < 0:
        raise HTTPException(404, "no country here")
    return region_info(_countries()[k])


class MatrixRequest(SeriesRequest):
    variables: list[str]


@app.post("/api/relations/matrix")
def relation_matrix(req: MatrixRequest):
    """Every pair of 2 to 5 variables on one territory: the relation test of the relation card, the lag profile, the
    detrended anomalies at the best lag (for a scatter plot), the annual anomalies of every variable and what the
    exhaustive search found among them on this territory.
    """
    vids = list(dict.fromkeys(req.variables))
    if not 2 <= len(vids) <= 5:
        raise HTTPException(422, "choose 2 to 5 variables")
    data, territory = {}, None
    for vid in vids:
        cat, var = variable(vid)
        ii, jj, terr = resolve(req, var)
        territory = territory or terr
        y, _ = var.series(ii, jj)
        data[vid] = (cat, var, y)
    pairs = []
    for a, b in itertools.combinations(vids, 2):
        (_, va, ya), (_, vb, yb) = data[a], data[b]
        al = aligned(va, ya, vb, yb, req.start_year, req.end_year)
        if al is None:
            pairs.append({"a": a, "b": b, "verdict": "too_short"})
            continue
        x, y, year, month, _, _ = al
        rel = trend.relation(x, y, year, month)
        row = {
            "a": a,
            "b": b,
            "verdict": rel["verdict"],
            "raw": rel["raw"],
            "detrended": rel["detrended"],
            "best": rel.get("best"),
            "explained": rel.get("explained"),
            "n_months": rel["n_months"],
            "n_eff": rel["n_eff"],
            "lags": [{"lag": k["lag"], "r": k["r"]} for k in rel["lags"]],
            "period": [f"{year[0]}-{month[0]:02d}", f"{year[-1]}-{month[-1]:02d}"],
        }
        if rel.get("best"):
            t = year + (month - 0.5) / 12
            dx = trend._detrend(t, trend.deseasonalize(x, month)[0])
            dy = trend._detrend(t, trend.deseasonalize(y, month)[0])
            lag = rel["best"]["lag"]
            if lag > 0:
                dx, dy = dx[:-lag], dy[lag:]
            elif lag < 0:
                dx, dy = dx[-lag:], dy[:lag]
            ok = np.isfinite(dx) & np.isfinite(dy)
            row["points"] = {"x": dx[ok], "y": dy[ok]}
        pairs.append(row)
    annual = {}
    for vid, (_cat, var, y) in data.items():
        yy, year, month = window(var, y, req.start_year, req.end_year)
        if np.isfinite(yy).sum() < 24:
            continue
        anom, _ = trend.deseasonalize(yy, month)
        yrs, ann = trend.annual_means(anom, year, trend.MIN_MONTHS_ANOMALY)
        annual[vid] = {"years": yrs, "value": ann}
    found: dict[str, list] = {"links": [], "chains": []}
    rid = req.region_id
    if rid:
        try:
            with closing(_db()) as con:
                q = ",".join("?" * len(vids))
                found["links"] = [
                    _names(r)
                    for r in con.execute(
                        f"SELECT a, b, r, lag FROM links WHERE region_id = ? AND a IN ({q}) AND b IN ({q})",  # noqa: S608  # nosec B608
                        (rid, *vids, *vids),
                    )
                ]
                found["chains"] = [
                    _names(r)
                    for r in con.execute(
                        f"SELECT a, b, c, lag1, lag2, r_ab, r_bc, r_ac, partial, kind FROM chains WHERE region_id = ? "  # noqa: S608  # nosec B608
                        f"AND a IN ({q}) AND b IN ({q}) AND c IN ({q})",
                        (rid, *vids, *vids, *vids),
                    )
                ]
        except HTTPException:
            pass
    return clean(
        {
            "territory": territory,
            "variables": [
                {
                    "id": v,
                    "name": data[v][0]["name"],
                    "units": data[v][0]["units"],
                    "decimals": data[v][0]["decimals"],
                }
                for v in vids
            ],
            "pairs": pairs,
            "annual": annual,
            "found": found,
        }
    )


class ProfileRequest(SeriesRequest):
    variable: str = ""
    quantity: str


@app.post("/api/profile")
def profile(req: ProfileRequest):
    """Trend by height: the rate of one quantity (temperature, humidity, ozone) at every pressure level, on one territory."""
    if req.quantity not in PROFILES:
        raise HTTPException(404, "unknown quantity")
    c = cube()
    levels = [v for v in VARIABLES if (v.get("profile") or {}).get("quantity") == req.quantity and v["id"] in c]
    if not levels:
        raise HTTPException(404, "no levels loaded for this quantity")
    rows, territory = [], None
    for v in sorted(levels, key=lambda x: -x["profile"]["level"]):
        var = c[v["id"]]
        ii, jj, terr = resolve(req, var)
        territory = territory or terr
        y, _ = var.series(ii, jj)
        y, year, month = window(var, y, req.start_year, req.end_year)
        valid = np.nonzero(np.isfinite(y))[0]
        row = {"variable": v["id"], "level": v["profile"]["level"], "height_km": v["profile"]["height_km"]}
        if len(valid) < 24:
            rows.append({**row, "verdict": "no_data"})
            continue
        sl = slice(valid[0], valid[-1] + 1)
        r = trend.analyze(y[sl], year[sl], month[sl])
        rows.append(
            {
                **row,
                "verdict": r["verdict"],
                "rate": r.get("rate"),
                "mean": r["mean"],
                "years": [int(year[sl][0]), int(year[sl][-1])],
            }
        )
    first = levels[0]
    return clean(
        {
            "quantity": req.quantity,
            "name": PROFILES[req.quantity],
            "units": first["units"],
            "decimals": first["decimals"],
            "source": first["source"],
            "territory": territory,
            "levels": rows,
        }
    )


class AskRequest(SeriesRequest):
    variable: str = ""
    goal: str
    text: str | None = None
    mode: str = "detailed"
    lang: str = "ru"
    user_key: str | None = None  # the visitor's own Gemini key: used for this request only, never logged or stored


_agent: ai.Agent | None = None


def agent() -> ai.Agent:
    global _agent
    if _agent is None:
        catalog = variables()["variables"]  # outside the lock: it takes the same lock to open the cube
        with _lock:
            if _agent is None:
                _agent = ai.Agent(DATA_DIR, catalog)
    return _agent


def _ai_tools(req: AskRequest) -> dict:
    """Our own tests in the compact form the model reads; the territory is always the visitor's."""
    base = req.model_dump(include={"region_id", "polygon", "bbox", "point", "start_year", "end_year", "terrain"})

    def trend_of(v: str) -> dict:
        s = series(SeriesRequest(variable=v, **base))
        rate = s.get("rate") or {}
        return {
            "variable": v,
            "verdict": s["verdict"],
            "per_decade": rate.get("per_decade"),
            "ci95": [rate.get("lo"), rate.get("hi")],
            "units": s["variable"]["units"],
            "period": [s["period"]["start"], s["period"]["end"]],
            "robust": bool((s.get("robustness") or {}).get("robust")),
            "record_years": s["n_years"],
            "years_needed_to_detect": s.get("years_to_detect"),
        }

    def link_of(a: str, b: str) -> dict:
        r = relation(RelationRequest(variable=a, other=b, **base))
        best = r.get("best") or {}
        return {
            "variable_a": a,
            "variable_b": b,
            "verdict": r.get("verdict"),
            "r": best.get("r"),
            "lag_months": best.get("lag"),
            "p": best.get("p"),
        }

    def scan_here() -> dict:
        rows = []
        for v in VARIABLES:
            if v["id"] not in cube():
                continue
            try:
                t = trend_of(v["id"])
            except HTTPException:
                continue
            if t["verdict"].startswith("significant") and t["per_decade"] is not None and t["ci95"][0] is not None:
                width = (t["ci95"][1] - t["ci95"][0]) or 1e-9
                rows.append({**t, "strength": round(abs(t["per_decade"]) / width, 2)})
        rows.sort(key=lambda x: -x["strength"])
        return {"changes": rows[:12], "variables_checked": len(VARIABLES)}

    def profile_of(qn: str) -> dict:
        p = profile(ProfileRequest(quantity=qn, **base))
        return {
            "quantity": qn,
            "units": p["units"],
            "levels": [
                {
                    "hpa": x["level"],
                    "km": x["height_km"],
                    "verdict": x["verdict"],
                    "per_decade": (x.get("rate") or {}).get("per_decade"),
                }
                for x in p["levels"]
            ],
        }

    return {"trend": trend_of, "link": link_of, "scan": scan_here, "profile": profile_of}


@app.get("/api/ai/status")
def ai_status():
    return agent().status()


@app.post("/api/ai/ask")
def ai_ask(req: AskRequest, request: Request):
    """The trend detective: a goal, not a chat. Failures come back as a code the site turns into a message."""
    lang = "ru" if req.lang == "ru" else "en"
    if req.region_id:
        info = regions().get(req.region_id)
        if not info:
            raise HTTPException(404, "unknown region")
        where = info["name"][lang]
    elif req.point:
        where = f"point {req.point[1]:.2f}, {req.point[0]:.2f}"
    elif req.polygon:
        geom = geometry_from_request(req.polygon, None, None)
        if geom is None or geom.is_empty:
            raise HTTPException(422, "empty area")
        w, s_, e, n = geom.bounds
        where = f"an area drawn by the visitor, longitude {w:.1f} to {e:.1f}, latitude {s_:.1f} to {n:.1f}"
    else:
        raise HTTPException(422, "region_id, point or polygon is required")
    if req.terrain and terrain.ok and req.terrain in terrain.types:
        where = f"{where}, only {terrain.label(req.terrain)['en'].lower()}"
    q = {
        "goal": req.goal,
        "text": req.text,
        "mode": req.mode,
        "lang": lang,
        "variable": req.variable,
        "where": [req.region_id, req.point, req.terrain, req.polygon],
        "where_name": where,
        "start_year": req.start_year,
    }
    ip = (request.headers.get(CLIENT_IP_HEADER, "") if CLIENT_IP_HEADER else "").split(",")[0].strip()
    ip = ip or (request.client.host if request.client else "")
    try:
        return clean(agent().ask(q, _ai_tools(req), ip, (req.user_key or "").strip() or None))
    except ai.AiError as e:
        body = {"code": e.code, "retry_after": e.retry_after}
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        return JSONResponse(body, status_code=e.status, headers=headers)


@app.post("/api/series")
def series(req: SeriesRequest):
    cat, var = variable(req.variable)
    ii, jj, territory = resolve(req, var)
    y, cov = var.series(ii, jj)
    y, year, month = window(var, y, req.start_year, req.end_year)
    if not np.isfinite(y).any():
        raise HTTPException(422, "no data for this territory (for example ocean for a land variable)")
    # leading and trailing months without data are trimmed
    valid = np.nonzero(np.isfinite(y))[0]
    y, year, month = (
        y[valid[0] : valid[-1] + 1],
        year[valid[0] : valid[-1] + 1],
        month[valid[0] : valid[-1] + 1],
    )

    r = trend.analyze(y, year, month)
    territory.update(cov)
    robust = trend.robustness(y, year, month) if "rate" in r else {"robust": False, "checks": None}
    robust["robust"] = bool(robust["robust"] and r["verdict"].startswith("significant"))
    twins = second_opinion(req, cat, r, year)
    out = {
        "variable": {
            "id": cat["id"],
            "name": cat["name"],
            "units": cat["units"],
            "kind": cat["kind"],
            "decimals": cat["decimals"],
            "source": cat["source"],
        },
        "territory": territory,
        "period": {
            "start": f"{year[0]}-{month[0]:02d}",
            "end": f"{year[-1]}-{month[-1]:02d}",
        },
        "time": [f"{a}-{b:02d}" for a, b in zip(year, month)],
        "value": y,
        "anomaly": r["anomaly"],
        "climatology": r["climatology"],
        "annual": {
            "years": r["years"],
            "value": r["annual"],
            "anomaly": r["annual_anomaly"],
        },
        "mean": r["mean"],
        "n_months": r["n_months"],
        "n_years": r["n_years"],
        "verdict": r["verdict"],
    }
    for k in (
        "rate",
        "sen",
        "tests",
        "total_change",
        "change_point",
        "years_to_detect",
        "noise_sd",
    ):
        if k in r:
            out[k] = r[k]
    out["robustness"] = robust
    out["second_opinion"] = twins
    out["outlook"] = outlook_block(cat, r, robust, y, year, month, territory)
    if "rate" in r and cat["kind"] == "rel" and r["mean"]:
        out["rate_rel"] = {k: r["rate"][k] / abs(r["mean"]) * 100 for k in ("per_decade", "lo", "hi")}
    return clean(out)


def aligned(var_x, x, var_y, y, start_year=None, end_year=None):
    """The common months of two monthly records inside the requested window, or None if under 10 years."""
    kx, ky = var_x.year * 12 + var_x.month, var_y.year * 12 + var_y.month
    lo = max(kx[0], ky[0], (start_year or 0) * 12 + 1)
    hi = min(kx[-1], ky[-1], (end_year or 9999) * 12 + 12)
    if hi - lo < 119:
        return None
    sx, sy = (kx >= lo) & (kx <= hi), (ky >= lo) & (ky <= hi)
    return x[sx], y[sy], var_x.year[sx], var_x.month[sx], lo, hi


class RelationRequest(SeriesRequest):
    other: str


@app.post("/api/relation")
def relation(req: RelationRequest):
    """Is `variable` related to `other` on this territory beyond a shared trend?"""
    cat_x, var_x = variable(req.variable)
    cat_y, var_y = variable(req.other)
    ix, jx, territory = resolve(req, var_x)
    iy, jy, _ = resolve(req, var_y)
    x, _ = var_x.series(ix, jx)
    y, _ = var_y.series(iy, jy)
    al = aligned(var_x, x, var_y, y, req.start_year, req.end_year)
    if al is None:
        raise HTTPException(422, "the two records share less than 10 years")
    xa, ya, year, month, lo, hi = al
    r = trend.relation(xa, ya, year, month)

    def side(c):
        return {
            "id": c["id"],
            "name": c["name"],
            "units": c["units"],
            "decimals": c["decimals"],
            "source": c["source"],
        }

    return clean(
        {
            "x": side(cat_x),
            "y": side(cat_y),
            "territory": territory,
            "period": {
                "start": f"{(lo - 1) // 12}-{(lo - 1) % 12 + 1:02d}",
                "end": f"{(hi - 1) // 12}-{(hi - 1) % 12 + 1:02d}",
            },
            **r,
        }
    )


@lru_cache(maxsize=64)
def _scan(vid: str, y0: int | None) -> list[dict]:
    """Trend report for every country: where is the trend of this variable robust?"""
    cat, var = variable(vid)
    rg = regions()
    rows = []
    for rid, info in rg.items.items():
        if info["level"] != 0:
            continue
        ii, jj = _region_cells(rid, var.grid.key)
        if len(ii) < 4:  # too small for this grid
            continue
        y, _ = var.series(ii, jj)
        y, year, month = window(var, y, y0, None)
        if np.isfinite(y).sum() < 120:
            continue
        r = trend.analyze(y, year, month)
        if "rate" not in r or not r["verdict"].startswith("significant"):
            continue
        rb = trend.robustness(y, year, month)
        if not rb["robust"]:
            continue
        rate = r["rate"]
        rel = cat["kind"] == "rel" and r["mean"]
        k = 100 / abs(r["mean"]) if rel else 1.0
        half = (rate["hi"] - rate["lo"]) / 2
        rows.append(
            {
                "region_id": rid,
                "name": info["name"],
                "bbox": info["bbox"],
                "level": 0,
                "parent_name": None,
                "per_decade": rate["per_decade"] * k,
                "lo": rate["lo"] * k,
                "hi": rate["hi"] * k,
                "strength": abs(rate["per_decade"]) / half if half > 0 else 0.0,
            }
        )
    return rows


@app.get("/api/scan")
def scan(
    variable_id: str = Query(..., alias="variable"),
    start_year: int | None = None,
    limit: int = Query(8, ge=1, le=50),
):
    """Countries where the trend is robust: significant by both tests, same sign in both halves of the record, survives
    dropping the first or the last fifth of the years, and is not a step.
    """
    cat, _ = variable(variable_id)
    rows = _scan(variable_id, start_year)
    up = sorted((r for r in rows if r["per_decade"] > 0), key=lambda r: -r["strength"])[:limit]
    down = sorted((r for r in rows if r["per_decade"] < 0), key=lambda r: -r["strength"])[:limit]
    return clean(
        {
            "variable": variable_id,
            "units": "%" if cat["kind"] == "rel" else cat["units"],
            "decimals": 1 if cat["kind"] == "rel" else cat["decimals"],
            "n_robust": len(rows),
            "n_up": sum(r["per_decade"] > 0 for r in rows),
            "n_down": sum(r["per_decade"] < 0 for r in rows),
            "up": up,
            "down": down,
        }
    )


# verification against NASA tools
@app.get("/api/verify/tools")
def verify_tools():
    sup = verify.supported(BY_ID)
    return {
        "tools": verify.TOOLS,
        "variables": sup,
        "names": {v: BY_ID[v]["name"] for v in BY_ID},
    }


@app.get("/api/verify/reference")
def verify_reference():
    """Precomputed checks for fixed places (tools/verify_all.py)."""
    return verifier.reference()


class VerifyRequest(SeriesRequest):
    tool: str | None = None


@app.post("/api/verify")
def verify_now(req: VerifyRequest):
    """Compares the series of the site with NASA's own computation.

    A territory is checked over its bounding box (Giovanni works with boxes); a point uses the POWER API when the
    variable comes from POWER.
    """
    cat, var = variable(req.variable)
    tools = verify.supported(BY_ID).get(cat["id"], [])
    if not tools:
        raise HTTPException(422, "no NASA tool to check this variable against")
    tool = req.tool or ("power" if req.point and "power" in tools else tools[0])
    if tool not in tools:
        raise HTTPException(422, f"{tool} does not cover this variable")
    box = point = None
    if tool == "power":
        if req.point:
            point = (float(req.point[0]), float(req.point[1]))
        else:
            info = regions().get(req.region_id) if req.region_id else None
            if not info:
                raise HTTPException(422, "the POWER check needs a point or a territory")
            w, s_, e, n = info["bbox"]
            point = ((w + e) / 2, (s_ + n) / 2)
    else:
        if req.point:
            box = (
                req.point[0] - 0.5,
                req.point[1] - 0.5,
                req.point[0] + 0.5,
                req.point[1] + 0.5,
            )
        elif req.bbox:
            box = tuple(req.bbox)
        elif req.region_id and (found_region := regions().get(req.region_id)):
            box = tuple(found_region["bbox"])
        else:
            raise HTTPException(422, "region_id, bbox or point is required")
        box = tuple(round(float(x), 3) for x in box)
        if box[0] >= box[2]:
            raise HTTPException(
                422,
                "territories across the antimeridian cannot be checked with Giovanni",
            )
    first_full = int(var.year[0]) + (1 if var.month[0] > 1 else 0)
    y0 = max(req.start_year or first_full, first_full)
    y1 = min(req.end_year or int(var.year[-1]) - 1, int(var.year[-1]) - 1)
    try:
        res = verifier.run(
            tool,
            cat["id"],
            var,
            cat,
            box=box,
            point=point,
            y0=y0,
            y1=y1,
            ours_series=lambda ii, jj: var.series(ii, jj)[0],
        )
    except (TimeoutError, RuntimeError, ValueError, requests.RequestException) as e:
        raise HTTPException(502, f"NASA service: {e}") from e
    return clean(res)


# hypotheses (docs/RULES.md)
@lru_cache(maxsize=12000)
def _region_series(vid: str, rid: str):
    var = cube()[vid]
    ii, jj = _region_cells(rid, var.grid.key)
    if len(ii) < 2:
        return None
    y, _ = var.series(ii, jj)
    return y if np.isfinite(y).sum() >= 120 else None


def _countries() -> list[str]:
    return [rid for rid, info in regions().items.items() if info["level"] == 0]


def _check_rules(text: str) -> dict:
    c = cube()
    c.reload()
    return rulebook.validate(text, BY_ID, set(regions().items), set(c.vars))


@lru_cache(maxsize=4)
def _rules(version: str) -> list[dict]:
    res = _check_rules(rule_store.text())
    return res["rules"] if res["ok"] else []


@lru_cache(maxsize=64)
def _rule_result(version: str, rule_id: str) -> dict | None:
    rule = next((r for r in _rules(version) if r["id"] == rule_id), None)
    return None if rule is None else _evaluate_rule(rule)


def _territory_set(terr) -> list[str]:
    if terr == "countries":
        return _countries()
    if terr == "oceans":
        return [rid for rid, info in regions().items.items() if info["level"] == -2]
    return terr


def _evaluate_rule(rule: dict) -> dict:
    c = cube()

    def single(v, rid, y0):
        if v not in c:
            return None
        y = _region_series(v, rid)
        if y is None:
            return None
        return window(c[v], y, y0, None)

    def pair(a, b, rid, y0):
        if a not in c or b not in c:
            return None
        x, y = _region_series(a, rid), _region_series(b, rid)
        if x is None or y is None:
            return None
        al = aligned(c[a], x, c[b], y, y0)
        return None if al is None else al[:4]

    out = rulebook.evaluate(rule, _territory_set(rule["territories"]), pair, single)
    rg = regions()
    for row in out["territories"]:
        info = rg.require(row["region_id"])
        row.update(
            name=info["name"],
            bbox=info["bbox"],
            level=info["level"],
            parent_name=info["parent_name"],
        )
    order = {
        "confirmed": 0,
        "partial": 1,
        "contradicted": 2,
        "not_confirmed": 3,
        "no_data": 4,
    }
    out["territories"].sort(key=lambda r: (order[r["status"]], -sum(abs(l.get("r", 0)) for l in r["links"])))
    return out


def _rule_card(rule: dict) -> dict:
    return {
        "id": rule["id"],
        "name": rule["name"],
        "description": rule["description"],
        "author": rule.get("author"),
        "source": rule.get("source"),
        "links": [
            {
                **l,
                "from_name": BY_ID[l["from"]]["name"],
                "to_name": BY_ID[l["to"]]["name"],
            }
            for l in rule["links"]
        ],
    }


@app.get("/api/rules")
def rules_list():
    """Hypotheses to check: expert statements "A drives B" as data (docs/RULES.md)."""
    return {
        "version": rule_store.version(),
        "rules": [_rule_card(r) for r in _rules(rule_store.version())],
    }


@app.get("/api/rules/{rule_id}")
def rule_result(rule_id: str):
    """Where does the hypothesis hold?

    Every territory gets: confirmed, partial, contradicted or not confirmed.
    """
    version = rule_store.version()
    res = _rule_result(version, rule_id)
    if res is None:
        raise HTTPException(404, "unknown rule")
    rule = next(r for r in _rules(version) if r["id"] == rule_id)
    return clean({**_rule_card(rule), **res})


class RulesText(BaseModel):
    yaml: str


# Session hypotheses: a visitor checks a rule of their own. It is validated exactly like the shared file,
# evaluated, and never stored on the server (the browser keeps it until the tab is closed). At most two
# evaluations run at once so that a burst of requests cannot take the server down.
_try_slots = threading.BoundedSemaphore(2)
MAX_TRY_BYTES = 8 * 1024


@lru_cache(maxsize=64)
def _session_result(key: str) -> dict:
    return _evaluate_rule(json.loads(key))


@app.post("/api/rules/try")
def rule_try(body: RulesText):
    """Checks one user rule (YAML document with exactly one rule) without saving it anywhere."""
    if len(body.yaml.encode("utf-8")) > MAX_TRY_BYTES:
        return JSONResponse(
            {
                "ok": False,
                "errors": [f"правило больше {MAX_TRY_BYTES // 1024} КБ"],
                "warnings": [],
            },
            status_code=422,
        )
    res = _check_rules(body.yaml)
    if res["ok"] and len(res["rules"]) != 1:
        res = {**res, "ok": False, "errors": ["нужно ровно одно правило"]}
    if not res["ok"]:
        return JSONResponse(
            {"ok": False, "errors": res["errors"], "warnings": res["warnings"]},
            status_code=422,
        )
    rule = res["rules"][0]
    key = json.dumps(rule, sort_keys=True, ensure_ascii=False)
    if not _try_slots.acquire(timeout=60):
        raise HTTPException(503, "the server is busy checking other hypotheses, try again in a minute")
    try:
        out = _session_result(key)
    finally:
        _try_slots.release()
    return clean(
        {
            **_rule_card(rule),
            **out,
            "ok": True,
            "warnings": res["warnings"],
            "session": True,
        }
    )


def shapely_points(geom) -> int:
    return int(shapely.get_num_coordinates(geom))


@lru_cache(maxsize=48)
def _map(vid: str, y0: int | None, y1: int | None):
    cat, var = variable(vid)
    return maps.compute(var, cat["kind"], y0, y1)


@lru_cache(maxsize=48)
def _field(vid: str, layer: str) -> dict:
    cat, var = variable(vid)
    return maps.compute_normal(var, vid) if layer == "normal" else maps.compute_last_year(var, cat["kind"])


LAYER_PATTERN = "^(trend|normal|last)$"


@app.get("/api/map/meta")
def map_meta(
    variable_id: str = Query(..., alias="variable"),
    start_year: int | None = None,
    end_year: int | None = None,
    layer: str = Query("trend", pattern=LAYER_PATTERN),
):
    cat, _var = variable(variable_id)
    bounds = [-180, -maps.MERC_MAX_LAT, 180, maps.MERC_MAX_LAT]
    if layer == "normal":
        f = _field(variable_id, "normal")
        pal = maps.seq_palette_for(variable_id)
        return clean(
            {
                "variable": variable_id,
                "layer": layer,
                "years": f["years"],
                "units": cat["units"],
                "lo": f["lo"],
                "hi": f["hi"],
                "log": f["log"],
                "palette": pal,
                "colors": maps.hex_colors(maps.SEQ_PALETTES[pal]),
                "bounds": bounds,
            }
        )
    if layer == "last":
        f = _field(variable_id, "last")
        pal = maps.palette_for(variable_id)
        return clean(
            {
                "variable": variable_id,
                "layer": layer,
                "years": f["years"],
                "year": f["year"],
                "units": "%" if cat["kind"] == "rel" else cat["units"],
                "scale": f["scale"],
                "share_above": f["share_above"],
                "palette": pal,
                "colors": maps.legend_colors(pal),
                "bounds": bounds,
            }
        )
    m = _map(variable_id, start_year, end_year)
    pal = maps.palette_for(variable_id)
    return clean(
        {
            "variable": variable_id,
            "years": m["years"],
            "scale": m["scale"],
            "units": "%" if cat["kind"] == "rel" else cat["units"],
            "per": "decade",
            "palette": pal,
            "colors": maps.legend_colors(pal),
            "fdr_p": m["fdr_p"],
            "share_sig_up": m["share_sig_up"],
            "share_sig_down": m["share_sig_down"],
            "share_up": m["share_up"],
            "layer": "trend",
            "bounds": bounds,
        }
    )


@lru_cache(maxsize=48)
def _png(
    vid: str,
    y0: int | None,
    y1: int | None,
    sig_only: bool,
    simple: bool,
    layer: str = "trend",
) -> bytes:
    _, var = variable(vid)
    if layer == "normal":
        f = _field(vid, "normal")
        return maps.render_field(
            var,
            f["value"],
            maps.SEQ_PALETTES[maps.seq_palette_for(vid)],
            f["lo"],
            f["hi"],
        )
    if layer == "last":
        f = _field(vid, "last")
        return maps.render_field(
            var,
            f["value"],
            maps.PALETTES[maps.palette_for(vid)],
            -f["scale"],
            f["scale"],
        )
    return maps.render(var, _map(vid, y0, y1), maps.palette_for(vid), sig_only, simple)


@app.get("/api/map.png")
def map_png(
    variable_id: str = Query(..., alias="variable"),
    start_year: int | None = None,
    end_year: int | None = None,
    sig_only: bool = False,
    simple: bool = False,
    layer: str = Query("trend", pattern=LAYER_PATTERN),
):
    if layer != "trend":
        start_year = end_year = None
        sig_only = simple = False
    return Response(
        _png(variable_id, start_year, end_year, sig_only, simple, layer),
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/space")
def space_layer(variable_id: str = Query(..., alias="variable")):
    """The latest NASA GIBS imagery closest to the variable (tiles for the map, legend, Worldview link)."""
    variable(variable_id)
    try:
        return space.layer(variable_id)
    except (OSError, KeyError, requests.RequestException) as e:
        raise HTTPException(503, f"NASA GIBS is not reachable: {e}") from e


@app.get("/api/cell")
def cell(
    variable_id: str = Query(..., alias="variable"),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_year: int | None = None,
    end_year: int | None = None,
):
    _, var = variable(variable_id)
    m = _map(variable_id, start_year, end_year)
    i, j = var.grid.row(lat), var.grid.col(lon)
    return clean(
        {
            "lat": var.grid.lat[i],
            "lon": var.grid.lon[j],
            "rate": m["rate"][i, j],
            "p": m["p"][i, j],
            "significant": m["sig"][i, j],
        }
    )


def _install_extensions() -> None:
    try:
        package = importlib.import_module(".extensions", __package__)
    except ModuleNotFoundError as e:
        if e.name != f"{__package__}.extensions":
            raise
        return
    for info in pkgutil.iter_modules(package.__path__):
        module = importlib.import_module(f"{package.__name__}.{info.name}")
        if hasattr(module, "install"):
            module.install(app)


_install_extensions()
