"""Trend maps ("where is it changing?"): Sen slope and Mann-Kendall significance for every grid cell,
rendered as a Web-Mercator PNG overlay for the map.

Cells that stay significant after the false-discovery-rate control are drawn opaque, the rest faint,
so the eye goes to changes that are unlikely to be noise.
"""

from __future__ import annotations

import io
import math
from functools import lru_cache

import numpy as np
from PIL import Image

from . import trend
from .cube import Variable

MERC_MAX_LAT = 85.0
IMG_W, IMG_H = 1440, 1440
REL_MIN_SHARE = 0.05  # relative rates are not shown where the mean is under 5% of the global 95th percentile
# (deserts: a tiny absolute change is a huge percentage)

# diverging palettes: negative -> neutral -> positive
PALETTES = {
    "temp": [
        (33, 102, 172),
        (103, 169, 207),
        (209, 229, 240),
        (247, 247, 247),
        (253, 219, 199),
        (239, 138, 98),
        (178, 24, 43),
    ],
    "wet": [
        (140, 81, 10),
        (216, 179, 101),
        (246, 232, 195),
        (245, 245, 245),
        (199, 234, 229),
        (90, 180, 172),
        (1, 102, 94),
    ],
    "air": [
        (27, 120, 55),
        (127, 191, 123),
        (217, 240, 211),
        (247, 247, 247),
        (231, 212, 232),
        (175, 141, 195),
        (118, 42, 131),
    ],
}
PALETTE_OF = {
    "precip_gpm": "wet",
    "precip_merra": "wet",
    "evland": "wet",
    "soil_top": "wet",
    "soil_root": "wet",
    "qv2m": "wet",
    "rh2m": "wet",
    "tqv": "wet",
    "snow_depth": "wet",
    "snow_frac": "wet",
    "sea_ice": "wet",
    "gldas_soil": "wet",
    "gldas_root": "wet",
    "gldas_evap": "wet",
    "gldas_runoff": "wet",
    "gldas_swe": "wet",
    "airs_h2o": "wet",
    "omi_no2": "air",
    "ndvi": "wet",
    "evi": "wet",
    "chl": "wet",
    "cloud": "wet",
    "aod": "air",
    "ozone": "air",
    "ws10m": "air",
    "slp": "air",
    "albedo": "air",
}


def palette_for(vid: str) -> str:
    return PALETTE_OF.get(vid, "temp")


def _lut(name: str) -> np.ndarray:
    stops = np.array(PALETTES[name], dtype=float)
    x = np.linspace(0, 1, 256)
    xp = np.linspace(0, 1, len(stops))
    return np.stack([np.interp(x, xp, stops[:, c]) for c in range(3)], axis=1).astype(np.uint8)


def compute(var: Variable, kind: str, y0: int | None, y1: int | None) -> dict:
    """Per-cell rate per decade (absolute, or % of the cell mean for kind == 'rel'), p and FDR mask."""
    years = var.annual_years()
    # only complete years: the last one may be partial
    complete = np.array([(var.year == y).sum() == 12 for y in years])
    sel = complete & (years >= (y0 or years[0])) & (years <= (y1 or years[-1]))
    annual = var.annual()[:, sel]
    slope, p = trend.grid_trends(annual)
    rate = slope * 10
    with np.errstate(invalid="ignore"):
        mean = var.cell_mean()
    if kind == "rel":
        floor = REL_MIN_SHARE * np.nanpercentile(np.abs(mean), 95)
        with np.errstate(invalid="ignore", divide="ignore"):
            rate = np.where(np.abs(mean) > floor, rate / np.abs(mean) * 100, np.nan)
        p = np.where(np.isfinite(rate), p, np.nan)
    sig, thr = trend.fdr_mask(p)
    ok = np.isfinite(rate)
    w = np.repeat(var.grid.weights(), var.grid.nlon)
    area = float(w[ok].sum()) or 1.0
    scale = float(np.nanpercentile(np.abs(rate[ok]), 95 if kind == "rel" else 98)) if ok.any() else 1.0
    shape = (var.grid.nlat, var.grid.nlon)
    return {
        "rate": rate.reshape(shape),
        "p": p.reshape(shape),
        "sig": sig.reshape(shape),
        "years": [int(years[sel][0]), int(years[sel][-1])],
        "scale": scale or 1.0,
        "fdr_p": thr,
        "share_sig_up": float(w[sig & (rate > 0)].sum() / area),
        "share_sig_down": float(w[sig & (rate < 0)].sum() / area),
        "share_up": float(w[ok & (rate > 0)].sum() / area),
    }


SIMPLE_NEUTRAL = (150, 150, 150, 80)  # simple mode: cells without a reliable change


def _sampler(var: Variable):
    """Grid rows and columns of every pixel of the Web-Mercator image."""
    g = var.grid
    ymax = math.log(math.tan(math.pi / 4 + math.radians(MERC_MAX_LAT) / 2))
    y = np.linspace(ymax, -ymax, IMG_H)
    lat = np.degrees(2 * np.arctan(np.exp(y)) - math.pi / 2)
    lon = -180 + (np.arange(IMG_W) + 0.5) * 360 / IMG_W
    rows = np.clip(np.round((lat - g.lat0) / g.dlat).astype(int), 0, g.nlat - 1)
    cols = np.round(((lon - g.lon0) % 360) / g.dlon).astype(int) % g.nlon
    return lambda field: field[rows][:, cols]


def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def render(var: Variable, m: dict, palette: str, sig_only: bool, simple: bool = False) -> bytes:
    """RGBA PNG in Web Mercator covering lon -180..180, lat -85..85.

    simple: three colours only: significant rise, significant fall (the palette ends), everything else grey.
    """
    sample = _sampler(var)
    rate = sample(m["rate"])
    sig = sample(m["sig"])
    idx = np.clip((rate / m["scale"] + 1) / 2 * 255, 0, 255)
    rgba = np.zeros((IMG_H, IMG_W, 4), dtype=np.uint8)
    ok = np.isfinite(rate)
    if simple:
        stops = PALETTES[palette]
        rgba[ok] = SIMPLE_NEUTRAL
        up, down = ok & sig & (rate > 0), ok & sig & (rate < 0)
        rgba[up] = (*stops[-1], 235)
        rgba[down] = (*stops[0], 235)
    else:
        rgba[..., :3][ok] = _lut(palette)[idx[ok].astype(np.uint8)]
        rgba[..., 3] = np.where(ok, np.where(sig, 235, 0 if sig_only else 70), 0)
    return _png(rgba)


# "normal" and "last year" layers
# sequential palettes for the climate normal: low -> high
SEQ_PALETTES = {
    "rain": [(239, 243, 255), (198, 219, 239), (107, 174, 214), (33, 113, 181), (8, 48, 107), (63, 0, 125)],
    "heat": [(49, 54, 149), (116, 173, 209), (224, 243, 248), (254, 224, 144), (244, 109, 67), (165, 0, 38)],
    "green": [(140, 81, 10), (223, 194, 125), (246, 232, 195), (199, 233, 192), (65, 171, 93), (0, 68, 27)],
    "ice": [(222, 235, 247), (158, 202, 225), (66, 146, 198), (8, 81, 156), (8, 48, 107)],
    "haze": [(68, 1, 84), (59, 82, 139), (33, 145, 140), (94, 201, 98), (253, 231, 37)],
}
SEQ_OF = {
    **{
        v: "rain"
        for v in (
            "precip_gpm",
            "precip_merra",
            "evland",
            "gldas_evap",
            "gldas_runoff",
            "qv2m",
            "rh2m",
            "tqv",
            "airs_h2o",
            "cloud",
            "soil_top",
            "soil_root",
            "gldas_soil",
            "gldas_root",
        )
    },
    **{
        v: "heat"
        for v in (
            "t2m",
            "t2m_max",
            "t2m_min",
            "ts",
            "ts_ocean",
            "airs_tair",
            "lst_day",
            "lst_night",
            "airs_olr",
            "sw_down",
        )
    },
    **{v: "green" for v in ("ndvi", "evi", "chl")},
    **{v: "ice" for v in ("snow_depth", "snow_frac", "gldas_swe", "sea_ice")},
}
LOG_VARS = {"chl", "omi_no2"}  # span orders of magnitude: a linear scale shows only the hot spots


def seq_palette_for(vid: str) -> str:
    return SEQ_OF.get(vid, "haze")


def hex_colors(stops) -> list[str]:
    return [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in stops]


def _lut_stops(stops) -> np.ndarray:
    stops = np.array(stops, dtype=float)
    x, xp = np.linspace(0, 1, 256), np.linspace(0, 1, len(stops))
    return np.stack([np.interp(x, xp, stops[:, c]) for c in range(3)], axis=1).astype(np.uint8)


def compute_normal(var: Variable, vid: str) -> dict:
    """The mean of every month of the record per cell, colour range from the 2nd to the 98th percentile."""
    mean = var.cell_mean().reshape(var.grid.nlat, var.grid.nlon).astype(float)
    log = vid in LOG_VARS
    if log:
        with np.errstate(invalid="ignore", divide="ignore"):
            v = np.where(mean > 0, np.log10(np.where(mean > 0, mean, 1)), np.nan)
    else:
        v = mean
    ok = np.isfinite(v)
    lo, hi = np.nanpercentile(v[ok], [2, 98]) if ok.any() else (0.0, 1.0)
    years = var.annual_years()
    return {
        "value": v,
        "lo": float(lo),
        "hi": float(hi if hi > lo else lo + 1),
        "log": log,
        "years": [int(years[0]), int(years[-1])],
    }


def compute_last_year(var: Variable, kind: str) -> dict:
    """The last complete year against the normal: its annual mean anomaly (in % of the mean for kind == 'rel')."""
    years = var.annual_years()
    complete = [k for k, y in enumerate(years) if (var.year == y).sum() == 12]
    k = complete[-1]
    anom = var.annual()[:, k].astype(float)
    if kind == "rel":
        mean = var.cell_mean()
        floor = REL_MIN_SHARE * np.nanpercentile(np.abs(mean), 95)
        with np.errstate(invalid="ignore", divide="ignore"):
            anom = np.where(np.abs(mean) > floor, anom / np.abs(mean) * 100, np.nan)
    ok = np.isfinite(anom)
    scale = float(np.nanpercentile(np.abs(anom[ok]), 98)) if ok.any() else 1.0
    w = np.repeat(var.grid.weights(), var.grid.nlon)
    area = float(w[ok].sum()) or 1.0
    return {
        "value": anom.reshape(var.grid.nlat, var.grid.nlon),
        "scale": scale or 1.0,
        "year": int(years[k]),
        "years": [int(years[0]), int(years[-1])],
        "share_above": float(w[ok & (anom > 0)].sum() / area),
    }


def render_field(var: Variable, value: np.ndarray, colors, lo: float, hi: float, alpha: int = 225) -> bytes:
    """A continuous field: lo..hi mapped onto the palette, missing cells transparent."""
    v = _sampler(var)(value)
    ok = np.isfinite(v)
    idx = np.clip((v - lo) / (hi - lo) * 255, 0, 255)
    rgba = np.zeros((IMG_H, IMG_W, 4), dtype=np.uint8)
    rgba[..., :3][ok] = _lut_stops(colors)[idx[ok].astype(np.uint8)]
    rgba[..., 3] = np.where(ok, alpha, 0)
    return _png(rgba)


@lru_cache(maxsize=64)
def legend_colors(palette: str) -> list[str]:
    return [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in PALETTES[palette]]


FORECAST_NEUTRAL = (160, 160, 160, 70)


def render_forecast(var: Variable, change: np.ndarray, neutral: np.ndarray, colors, scale: float) -> bytes:
    """Expected change per country cell on a diverging palette; countries tested without an outlook grey."""
    sample = _sampler(var)
    v, g = sample(change), sample(neutral)
    rgba = np.zeros((IMG_H, IMG_W, 4), dtype=np.uint8)
    rgba[np.isfinite(g)] = FORECAST_NEUTRAL
    ok = np.isfinite(v)
    idx = np.clip((v / scale + 1) / 2 * 255, 0, 255)
    rgba[..., :3][ok] = _lut_stops(colors)[idx[ok].astype(np.uint8)]
    rgba[..., 3][ok] = 225
    return _png(rgba)
