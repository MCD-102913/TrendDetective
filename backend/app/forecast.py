"""Which "if the trend continues" model to trust, where, and how wide its intervals must be.

The hindcast cases (trend.hindcast: an earlier year plays the present, the trend is continued and compared) are pooled per variable, for the
whole world and per climate zone. For each group:

  choice     the model with the smallest error (line, anchored, damped, mean) and the interval multipliers
             k80 / k95: the 80th and 95th percentile of |error| / standard error, never below the theory
  judgement  two-fold cross-validation over countries: the model is chosen and calibrated on the
             countries of one fold (with their regions) and scored on the other, so neither the choice of the
             model nor the calibration has seen the data it is judged on

The outlook is shown for a group when, in cross-validation, the chosen model beat both naive answers
(climatology and persistence), its calibrated 95% interval held at least MIN_COVERAGE95 of the real years
and there were at least MIN_CASES cases.
"""

from __future__ import annotations

import zlib

import numpy as np

from . import trend
from .trend import OUTLOOK_MODELS

MIN_CASES = 10
MIN_COVERAGE95 = 0.85
ZONES = {
    "tropics": {"en": "Tropics", "ru": "Тропики"},
    "nh_mid": {"en": "Northern mid-latitudes", "ru": "Умеренные широты Северного полушария"},
    "sh_mid": {"en": "Southern mid-latitudes", "ru": "Умеренные широты Южного полушария"},
    "polar": {"en": "Polar regions", "ru": "Полярные районы"},
}


def zone_of(lat: float) -> str:
    """Climate zone of a latitude: polar beyond 60 degrees, mid-latitudes beyond the tropics."""
    if abs(lat) >= 60:
        return "polar"
    if lat >= 23.5:
        return "nh_mid"
    if lat <= -23.5:
        return "sh_mid"
    return "tropics"


def fold_of(country: str) -> int:
    """Stable fold of a country; regions inside a country go with it (they are not independent of it)."""
    return zlib.crc32(country.encode()) % 2


def _rows(cases):
    return [r for c in cases for r in c["rows"]]


def choose(cases: list[dict]) -> dict:
    """The model with the smallest mean error and its interval multipliers, from these cases only."""
    rows = _rows(cases)
    mae = {m: float(np.mean([r["e"][m] for r in rows])) for m in OUTLOOK_MODELS}
    best = min(mae, key=mae.get)
    z = np.array([r["z"][best] for r in rows])
    t80 = float(np.median([c["t80"] for c in cases]))
    t95 = float(np.median([c["t95"] for c in cases]))
    return {
        "model": best,
        "k80": max(float(np.quantile(z, 0.80)), t80),
        "k95": max(float(np.quantile(z, 0.95)), t95),
        "mae_by_model": mae,
    }


def evaluate(cases: list[dict]) -> dict:
    """Chooses the model on all cases (what the site uses) and judges it by cross-validation over the two folds of countries.

    `cases` carry "fold" (fold_of their country).
    """
    if not cases:
        return {"cases": 0, "points": 0, "enabled": False}
    out = {"cases": len(cases), "points": len(_rows(cases)), **choose(cases)}
    e, clim, persist, in80, in95 = [], [], [], [], []
    for f in (0, 1):
        train = [c for c in cases if c["fold"] != f]
        test = [c for c in cases if c["fold"] == f]
        if not train or not test:
            continue
        ch = choose(train)
        # every test year is judged with the model and the calibration chosen without its country
        for r in _rows(test):
            e.append(r["e"][ch["model"]])
            clim.append(r["e_clim"])
            persist.append(r["e_persist"])
            in80.append(r["z"][ch["model"]] <= ch["k80"])
            in95.append(r["z"][ch["model"]] <= ch["k95"])
    if not e:
        return {**out, "enabled": False}
    mae, mae_c, mae_p = float(np.mean(e)), float(np.mean(clim)), float(np.mean(persist))
    out.update(
        {
            "skill": 1 - mae / min(mae_c, mae_p),
            "coverage80": float(np.mean(in80)),
            "coverage95": float(np.mean(in95)),
            "mae": mae,
            "mae_clim": mae_c,
            "mae_persist": mae_p,
            "cv_points": len(e),
        }
    )
    out["enabled"] = bool(len(cases) >= MIN_CASES and out["skill"] > 0 and out["coverage95"] >= MIN_COVERAGE95)
    return out


# what the site shows
SKILL_FIELDS = ("cases", "skill", "coverage80", "coverage95", "enabled", "model")
WORLD = {"en": "the whole world", "ru": "весь мир"}


def skill_for(skill_data: dict, vid: str, territory: dict) -> tuple[dict | None, str]:
    """The hindcast verdict that applies to a territory: its climate zone when the zone had enough cases, otherwise the
    whole world.

    Returns (result, scope) with scope a zone id or "world".
    """
    d = skill_data.get("variables", {}).get(vid)
    if not d or "global" not in d:
        return None, "world"
    if territory.get("region_id") == "global":
        return d["global"], "world"
    if territory.get("kind") == "point" and territory.get("cell"):
        lat = territory["cell"][1]
    else:
        b = territory.get("bbox") or [0, 0, 0, 0]
        lat = (b[1] + b[3]) / 2
    zone = zone_of(lat)
    z = d["zones"].get(zone)
    if z and z["cases"] >= MIN_CASES:
        return z, zone
    return d["global"], "world"


def outlook_block(skill_data: dict, cat: dict, r: dict, robust: dict, y, year, month, territory: dict) -> dict:
    """If the trend continues: shown only for a significant and robust trend of a variable whose hindcast, in the
    climate zone of the territory (or in the whole world when the zone had too few cases), beat climatology and
    persistence with honest intervals.

    Otherwise the reason it is not shown.
    """
    skill, scope = skill_for(skill_data, cat["id"], territory)
    if not skill:
        return {"available": False, "reason": "no_hindcast"}
    summary = {**{k: skill.get(k) for k in SKILL_FIELDS}, "scope": scope, "scope_name": ZONES.get(scope, WORLD)}
    if not skill.get("enabled"):
        return {"available": False, "reason": "no_skill", "hindcast": summary}
    if not r["verdict"].startswith("significant"):
        return {"available": False, "reason": "not_significant", "hindcast": summary}
    if not robust["robust"]:
        return {"available": False, "reason": "not_robust", "hindcast": summary}
    o = trend.outlook(y, year, month, model=skill["model"], k80=skill["k80"], k95=skill["k95"])
    if o is None:
        return {"available": False, "reason": "too_short", "hindcast": summary}
    return {
        "available": True,
        "hindcast": summary,
        **{k: o[k] for k in ("years", "mid", "lo80", "hi80", "lo95", "hi95", "last_year", "ref", "per_decade")},
    }
