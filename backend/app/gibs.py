"""How it looks from space: the latest NASA GIBS imagery (the service behind NASA Worldview) for a variable.

GIBS serves ready-made Web-Mercator tiles without a key. The capabilities document gives, for every layer, the latest
date, the zoom levels, the format and a legend; it is fetched at most every CAPS_MAX_AGE seconds and kept on disk, so
the site keeps working on the last copy when GIBS is unreachable.
"""

from __future__ import annotations

import datetime as dt
import re
import threading
import time
from pathlib import Path

import requests

CAPS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
TILE_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{date}/{tms}/{{z}}/{{y}}/{{x}}.{ext}"
CAPS_MAX_AGE = 12 * 3600
TRUE_COLOR = "VIIRS_NOAA20_CorrectedReflectance_TrueColor"

# the closest GIBS product for each variable; the rest (and any layer GIBS drops) fall back to true colour
LAYER_OF = {
    **{v: "AIRS_L3_Surface_Air_Temperature_Daily_Day" for v in ("t2m", "t2m_max", "t2m_min", "airs_tair", "ts")},
    **{v: "MODIS_Terra_Land_Surface_Temp_Day" for v in ("lst_day", "lst_night")},
    **{v: "IMERG_Precipitation_Rate" for v in ("precip_gpm", "precip_merra")},
    **{
        v: "SMAP_L4_Analyzed_Surface_Soil_Moisture"
        for v in ("soil_top", "soil_root", "gldas_soil", "gldas_root", "gldas_runoff", "evland", "gldas_evap")
    },
    **{v: "MERRA2_Total_Precipitable_Water_Vapor_Monthly" for v in ("qv2m", "rh2m", "tqv", "airs_h2o")},
    **{v: "MODIS_Terra_L3_NDVI_16Day" for v in ("ndvi", "evi")},
    **{v: "MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct" for v in ("snow_depth", "snow_frac", "gldas_swe")},
    "sea_ice": "GHRSST_L4_GAMSSA_GDS2_Sea_Ice_Concentration",
    "ts_ocean": "GHRSST_L4_MUR25_Sea_Surface_Temperature",
    "chl": "MODIS_Aqua_L2_Chlorophyll_A",
    "omi_no2": "OMI_Nitrogen_Dioxide_Tropo_Column",
    "aod": "MODIS_Combined_Value_Added_AOD",
    "cloud": "MODIS_Terra_Cloud_Fraction_Day",
}


def parse_caps(xml: str, wanted: set[str]) -> dict[str, dict]:
    """Title, latest date, period, tile matrix set, format and horizontal legend of the wanted layers."""
    out = {}
    for block in re.findall(r"<Layer>(.*?)</Layer>", xml, re.S):
        m = re.search(r"<ows:Identifier>(.*?)</ows:Identifier>", block)
        if not m or m.group(1) not in wanted:
            continue
        default = re.search(r"<Default>(.*?)</Default>", block)
        values = re.findall(r"<Value>(.*?)</Value>", block)
        tms = re.search(r"<TileMatrixSet>(.*?)</TileMatrixSet>", block)
        fmt = re.search(r"<Format>image/(\w+)</Format>", block)
        legend = re.search(r"xlink:href='([^']*_H\.svg)'", block) or re.search(r'xlink:href="([^"]*_H\.svg)"', block)
        title = re.search(r"<ows:Title[^>]*>(.*?)</ows:Title>", block)
        if not (default and tms and fmt):
            continue
        out[m.group(1)] = {
            "title": title.group(1) if title else m.group(1),
            "default": default.group(1),
            "period": values[-1].rsplit("/", 1)[-1] if values else "",
            "tms": tms.group(1),
            "ext": "jpg" if fmt.group(1) == "jpeg" else fmt.group(1),
            "legend": legend.group(1) if legend else None,
        }
    return out


def pick_date(info: dict, today: dt.date) -> str:
    """The latest date; for daily swath products the day before when the latest is today (still filling in)."""
    d = info["default"][:10]
    if info["period"] == "P1D":
        day = dt.date.fromisoformat(d)
        if day >= today:
            day = today - dt.timedelta(days=1)
        d = day.isoformat()
    return d


class Gibs:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "gibs" / "capabilities.xml"
        self._lock = threading.Lock()
        self._layers: dict[str, dict] | None = None
        self._loaded = 0.0

    def _refresh(self) -> None:
        fresh = self.path.exists() and time.time() - self.path.stat().st_mtime < CAPS_MAX_AGE
        if not fresh:
            try:
                r = requests.get(CAPS_URL, timeout=60)
                r.raise_for_status()
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(r.text, encoding="utf-8")
            except requests.RequestException:
                if not self.path.exists():
                    raise
        if self._layers is None or self.path.stat().st_mtime != self._loaded:
            self._layers = parse_caps(self.path.read_text(encoding="utf-8"), set(LAYER_OF.values()) | {TRUE_COLOR})
            self._loaded = self.path.stat().st_mtime

    def layer(self, vid: str) -> dict:
        with self._lock:
            self._refresh()
        layers = self._layers or {}
        lid = LAYER_OF.get(vid)
        if lid not in layers:
            lid = TRUE_COLOR
        info = layers[lid]
        date = pick_date(info, dt.datetime.now(dt.UTC).date())
        return {
            "layer": lid,
            "title": info["title"],
            "date": date,
            "true_color": lid == TRUE_COLOR,
            "tiles": TILE_URL.format(layer=lid, date=date, tms=info["tms"], ext=info["ext"]),
            "maxzoom": int(info["tms"].rsplit("Level", 1)[-1]),
            "legend": info["legend"],
            "worldview": f"https://worldview.earthdata.nasa.gov/?l={lid},Coastlines_15m&t={date}",
        }
