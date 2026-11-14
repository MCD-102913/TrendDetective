"""Verification against NASA's own tools: does the pipeline of the site (download, regridding, masking,
area averaging) reproduce what NASA computes from the same products?

    giovanni   NASA Giovanni area-averaged time series through Harmony (giovanni-averaging-service):
               computed by NASA from the original files at native resolution, for a lon/lat box.
               GPM IMERG, GLDAS, AIRS.
    power      NASA POWER API, monthly values at a point (the API behind the POWER data store that
               MERRA-2, IMERG and CERES are loaded from): shows whether the cube returns the same numbers.

compare() aligns the two monthly series and reports correlation of the values and of the anomalies
(season removed), mean bias, RMSE and the trend of both series with the same statistics as everywhere
else (backend/app/trend.py). Results are cached on disk: a check is computed once.
"""

from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import math
import os
import threading
import time
from pathlib import Path

import numpy as np
import requests

from . import trend

HARMONY = "https://harmony.earthdata.nasa.gov"
POWER_API = "https://power.larc.nasa.gov/api/temporal/monthly/point"
JOB_TIMEOUT_S = 240
MIN_COMMON_MONTHS = 24

TOOLS = {
    "giovanni": {
        "name": "NASA Giovanni (Harmony)",
        "geometry": "box",
        "about": {
            "en": "Area average computed by NASA from the original files at native resolution",
            "ru": "Среднее по области, которое NASA считает из исходных файлов на родном разрешении",
        },
    },
    "power": {
        "name": "NASA POWER API",
        "geometry": "point",
        "about": {
            "en": "Monthly values at a point from the NASA POWER service",
            "ru": "Месячные значения в точке из сервиса NASA POWER",
        },
    },
}

# catalog variable -> collection, Giovanni data field ids (combined by mean or sum), factor and offset to cube units
GIOVANNI = {
    "precip_gpm": ("C2723754851-GES_DISC", ["GPM_3IMERGM_07_precipitation"], "mean", 24.0, 0.0),  # mm/h -> mm/day
    "gldas_soil": ("C1342986036-GES_DISC", ["GLDAS_NOAH025_M_2_1_SoilMoi0_10cm_inst"], "mean", 1.0, 0.0),
    "gldas_root": ("C1342986036-GES_DISC", ["GLDAS_NOAH025_M_2_1_RootMoist_inst"], "mean", 1.0, 0.0),
    "gldas_evap": (
        "C1342986036-GES_DISC",
        ["GLDAS_NOAH025_M_2_1_Evap_tavg"],
        "mean",
        86400.0,
        0.0,
    ),  # kg/m2/s -> mm/day
    "gldas_runoff": (
        "C1342986036-GES_DISC",
        ["GLDAS_NOAH025_M_2_1_Qs_acc", "GLDAS_NOAH025_M_2_1_Qsb_acc"],
        "sum",
        8.0,
        0.0,
    ),
    "gldas_swe": ("C1342986036-GES_DISC", ["GLDAS_NOAH025_M_2_1_SWE_inst"], "mean", 1.0, 0.0),
    "airs_tair": (
        "C1701805662-GES_DISC",
        ["AIRS3STM_7_0_SurfAirTemp_A", "AIRS3STM_7_0_SurfAirTemp_D"],
        "mean",
        1.0,
        -273.15,
    ),
    "airs_h2o": ("C1701805662-GES_DISC", ["AIRS3STM_7_0_TotH2OVap_A", "AIRS3STM_7_0_TotH2OVap_D"], "mean", 1.0, 0.0),
    "airs_olr": ("C1701805662-GES_DISC", ["AIRS3STM_7_0_OLR_A", "AIRS3STM_7_0_OLR_D"], "mean", 1.0, 0.0),
}

# variables loaded from the NASA POWER data store: the API parameter is the same name (catalog "var")
POWER_COMMUNITY = "AG"
POWER_UNIT_FACTOR = {"MJ/m^2/day": 1e6 / 86400, "kW-hr/m^2/day": 1000 / 24}  # -> W/m2


def _token() -> str:
    tok = os.environ.get("EARTHDATA_TOKEN", "")
    if not tok:
        env = Path(__file__).resolve().parents[2] / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("EARTHDATA_TOKEN="):
                    tok = line.split("=", 1)[1].strip()
    return tok


def supported(catalog: dict[str, dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for vid, v in catalog.items():
        tools = []
        if vid in GIOVANNI:
            tools.append("giovanni")
        if str(v.get("store", "")).startswith("nasa-power/"):
            tools.append("power")
        if tools:
            out[vid] = tools
    return out


# reference series from NASA
def _parse_giovanni_csv(text: str) -> dict[str, float]:
    """Giovanni CSV: a few header lines, then 'time,mean_<field>' and one row per month."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.lower().startswith("time,"))
    fill = None
    for line in lines[:start]:
        if line.lower().startswith("fill value"):
            with contextlib.suppress(ValueError):
                fill = float(line.split(",", 1)[1])
    out = {}
    for row in csv.reader(io.StringIO("\n".join(lines[start + 1 :]))):
        if len(row) < 2 or not row[1].strip():
            continue
        v = float(row[1])
        if fill is not None and abs(v - fill) < 1e-3 * max(1.0, abs(fill)):
            continue
        out[row[0][:7]] = v
    return out


def giovanni_series(vid: str, box: tuple[float, float, float, float], y0: int, y1: int) -> dict[str, float]:
    """Monthly area averages over the box from Giovanni, in cube units.

    Raises on any failure.
    """
    concept, fields, combine, factor, offset = GIOVANNI[vid]
    w, s, e, n = box
    if w >= e:
        raise ValueError("boxes across the antimeridian are not supported by this check")
    tok = _token()
    headers = {"Authorization": f"Bearer {tok}"}
    per_field = []
    for field in fields:
        url = (
            f"{HARMONY}/{concept}/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset"
            f"?variable={field}&subset=lat({s}:{n})&subset=lon({w}:{e})"
            f"&subset=time(%22{y0}-01-01T00:00:00Z%22:%22{y1}-12-31T23:59:59Z%22)"
            "&average=area&format=text%2Fcsv&skipPreview=true"
        )
        r = requests.get(url, headers=headers, timeout=120, allow_redirects=False)
        if r.status_code in (301, 302, 303):
            job = r.headers["location"]
            t0 = time.time()
            while True:
                j = requests.get(HARMONY + job if job.startswith("/") else job, headers=headers, timeout=60).json()
                if j["status"] == "successful":
                    break
                if j["status"] in ("failed", "canceled", "complete_with_errors"):
                    raise RuntimeError(f"Giovanni job {j['status']}: {j.get('message', '')[:200]}")
                if time.time() - t0 > JOB_TIMEOUT_S:
                    raise TimeoutError("Giovanni job is taking too long")
                time.sleep(4)
            link = next(l["href"] for l in j["links"] if l.get("rel") == "data")
            text = requests.get(link, headers=headers, timeout=120).text
        elif r.status_code == 200:
            text = r.text
        else:
            raise RuntimeError(f"Harmony HTTP {r.status_code}: {r.text[:200]}")
        per_field.append(_parse_giovanni_csv(text))
    months = set.intersection(*(set(d) for d in per_field))
    out = {}
    for m in sorted(months):
        vals = [d[m] for d in per_field]
        v = sum(vals) if combine == "sum" else sum(vals) / len(vals)
        out[m] = v * factor + offset
    return out


def power_series(param: str, lon: float, lat: float, y0: int, y1: int) -> dict[str, float]:
    r = requests.get(
        POWER_API,
        params={
            "parameters": param,
            "community": POWER_COMMUNITY,
            "longitude": round(lon, 4),
            "latitude": round(lat, 4),
            "start": y0,
            "end": y1,
            "format": "JSON",
        },
        timeout=120,
    )
    if r.status_code != 200:
        raise RuntimeError(f"POWER HTTP {r.status_code}: {r.text[:200]}")
    j = r.json()
    values = j["properties"]["parameter"][param]
    # the API may answer in daily energy totals where the store has a mean flux (found by this very check:
    # surface sunlight came back in MJ/m2/day, 11.57 times smaller than W/m2)
    units = str(j.get("parameters", {}).get(param, {}).get("units", ""))
    factor = POWER_UNIT_FACTOR.get(units.replace(" ", ""), 1.0)
    out = {}
    for k, v in values.items():
        if k[4:] == "13" or v is None or v <= -998:
            continue  # month 13 is the annual value, -999 is "no data"
        out[f"{k[:4]}-{k[4:]}"] = float(v) * factor
    return out


# comparison
def compare(ours: dict[str, float], ref: dict[str, float]) -> dict:
    months = sorted(m for m in set(ours) & set(ref) if math.isfinite(ours[m]) and math.isfinite(ref[m]))
    res: dict = {"n_months": len(months)}
    if len(months) < MIN_COMMON_MONTHS:
        res["verdict"] = "too_short"
        return res
    a = np.array([ours[m] for m in months])
    b = np.array([ref[m] for m in months])
    year = np.array([int(m[:4]) for m in months])
    month = np.array([int(m[5:7]) for m in months])
    aa, _ = trend.deseasonalize(a, month)
    ba, _ = trend.deseasonalize(b, month)
    r = float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 and np.std(b) > 0 else math.nan
    ra = float(np.corrcoef(aa, ba)[0, 1]) if np.nanstd(aa) > 0 and np.nanstd(ba) > 0 else math.nan
    bias = float(np.mean(a - b))
    ref_mean = float(np.mean(b))
    res.update(
        period=[months[0], months[-1]],
        r=r,
        r_anomaly=ra,
        bias=bias,
        ours_mean=float(np.mean(a)),
        ref_mean=ref_mean,
        rel_bias=bias / abs(ref_mean) * 100 if ref_mean else None,
        rmse=float(np.sqrt(np.mean((a - b) ** 2))),
    )
    ta, tb = trend.analyze(a, year, month), trend.analyze(b, year, month)
    if "rate" in ta and "rate" in tb:
        res["trend_ours"] = {
            "per_decade": ta["rate"]["per_decade"],
            "lo": ta["rate"]["lo"],
            "hi": ta["rate"]["hi"],
            "verdict": ta["verdict"],
        }
        res["trend_ref"] = {
            "per_decade": tb["rate"]["per_decade"],
            "lo": tb["rate"]["lo"],
            "hi": tb["rate"]["hi"],
            "verdict": tb["verdict"],
        }
        sig_a, sig_b = ta["verdict"].startswith("significant"), tb["verdict"].startswith("significant")
        same = np.sign(ta["rate"]["per_decade"]) == np.sign(tb["rate"]["per_decade"])
        res["trend_agrees"] = bool((sig_a and sig_b and same) or (not sig_a and not sig_b))
    rb = abs(res["rel_bias"]) if res["rel_bias"] is not None else math.inf
    if ra >= 0.95 and rb <= 5:
        res["verdict"] = "match"
    elif ra >= 0.8:
        res["verdict"] = "consistent"
    else:
        res["verdict"] = "differs"
    res["series"] = {"months": months, "ours": a.tolist(), "ref": b.tolist()}
    return res


# cache and runner
class Verifier:
    def __init__(self, data_dir: Path):
        self.dir = data_dir / "verify"
        (self.dir / "cache").mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()  # one external request at a time: protect NASA services and the server

    def _key(self, *parts) -> Path:
        return self.dir / "cache" / (hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:20] + ".json")

    def run(
        self, tool: str, vid: str, var, catalog_entry: dict, *, box=None, point=None, y0: int, y1: int, ours_series
    ) -> dict:
        """ours_series(cells) -> monthly values on var's calendar.

        Returns the comparison (cached).
        """
        f = self._key(tool, vid, box, point, y0, y1)
        if f.exists():
            return json.loads(f.read_text())
        with self._lock:
            if f.exists():
                return json.loads(f.read_text())
            if tool == "giovanni":
                ref = giovanni_series(vid, box, y0, y1)
                import shapely.geometry as sg

                ii, jj = var.grid.cells_in(sg.box(*box))
            elif tool == "power":
                ref = power_series(catalog_entry["var"], point[0], point[1], y0, y1)
                ii, jj = np.array([var.grid.row(point[1])]), np.array([var.grid.col(point[0])])
            else:
                raise ValueError("unknown tool")
            y = ours_series(ii, jj)
            ours = {
                f"{yr}-{mo:02d}": float(v)
                for yr, mo, v in zip(var.year, var.month, y)
                if y0 <= yr <= y1 and math.isfinite(v)
            }
            res = compare(ours, ref)
            res.update(
                tool=tool,
                tool_name=TOOLS[tool]["name"],
                variable=vid,
                box=box,
                point=point,
                years=[y0, y1],
                cells=len(ii),
                checked=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            )
            f.write_text(json.dumps(res))
            return res

    def reference(self) -> dict:
        f = self.dir / "reference.json"
        return json.loads(f.read_text()) if f.exists() else {"cases": []}
