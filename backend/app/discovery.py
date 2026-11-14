"""Exhaustive search for links between variables, made honest.

Every pair of variables is tested on every territory with the same test as a hand-written rule
(trend.relation: season and trend removed, lags up to MAX_LAG months, Bonferroni over the lags). With about
two million tests, chance alone would "confirm" a hundred thousand links, so a link counts as found only if

  1. the two variables are not the same quantity from different sources (FAMILIES: they agree by definition);
  2. on the FIRST half of their common period the link passes the Benjamini-Hochberg threshold computed over
     ALL tests of the search (q = 0.05) and |r| >= trend.MIN_LINK_R;
  3. on the SECOND half, which the search never saw, it repeats: the same sign, a lag within one month of
     the one found, p < 0.05 (Bonferroni over the three lags) and |r| >= REPLICATION_R.

The whole procedure is also run on pairs whose second series is shifted by whole years (null_shift): the
physical link is gone but season, trend and autocorrelation stay. What it still "finds" is the number of
false discoveries to expect.
"""

from __future__ import annotations

import math

import numpy as np

from . import trend

# the same quantity measured or modelled differently: such pairs correlate by construction
FAMILIES: list[set[str]] = [
    {"t2m", "t2m_max", "t2m_min", "airs_tair", "ts", "ts_ocean", "lst_day", "lst_night"},
    {"qv2m", "tqv", "airs_h2o"},
    {"precip_gpm", "precip_merra"},
    {"evland", "gldas_evap"},
    {"gldas_soil", "gldas_root", "soil_top", "soil_root"},
    {"ndvi", "evi"},
    {"snow_depth", "snow_frac", "gldas_swe"},
]
MIN_YEARS = 15  # common period; each half then has at least 7 years
Q = 0.05  # false discovery rate of the search
REPLICATION_R = 0.2  # a smaller threshold than for discovery: the first-half |r| is inflated by the selection


def same_family(a: str, b: str) -> bool:
    return any(a in f and b in f for f in FAMILIES)


def align(year_a, month_a, x, year_b, month_b, y, min_years: int = MIN_YEARS):
    """Common months of two monthly records, or None if shorter than `min_years`."""
    ka, kb = year_a * 12 + month_a, year_b * 12 + month_b
    lo, hi = max(ka[0], kb[0]), min(ka[-1], kb[-1])
    if hi - lo + 1 < min_years * 12:
        return None
    sa, sb = (ka >= lo) & (ka <= hi), (kb >= lo) & (kb <= hi)
    return x[sa], y[sb], year_a[sa], month_a[sa]


def null_shift(y: np.ndarray, years: int) -> np.ndarray:
    """Shifts the series by whole years with wrap-around: calendar months stay aligned, the link in time is destroyed."""
    return np.roll(y, 12 * years)


def discover_and_replicate(x: np.ndarray, y: np.ndarray, year: np.ndarray, month: np.ndarray) -> dict | None:
    """Searches for the link on the first half of the years and checks it on the second half.

    `p` (first half, already Bonferroni over lags) is what enters the Benjamini-Hochberg step of the search.
    """
    yrs = np.unique(year)
    if len(yrs) < MIN_YEARS:
        return None
    split = int(yrs[len(yrs) // 2])
    first, second = year < split, year >= split
    d = trend.relation(x[first], y[first], year[first], month[first])
    if "best" not in d:
        return None
    lag, r = d["best"]["lag"], d["best"]["r"]
    lo, hi = max(-trend.MAX_LAG, lag - 1), min(trend.MAX_LAG, lag + 1)
    rep = trend.relation(x[second], y[second], year[second], month[second], lags=(lo, hi)).get("best")
    replicated = bool(
        rep
        and math.isfinite(rep["r"])
        and np.sign(rep["r"]) == np.sign(r)
        and rep["p"] < trend.ALPHA
        and abs(rep["r"]) >= REPLICATION_R
    )
    return {
        "p": d["best"]["p"],
        "r": r,
        "lag": lag,
        "split": split,
        "replicated": replicated,
        "r_repl": rep["r"] if rep else math.nan,
        "lag_repl": rep["lag"] if rep else None,
    }


def confirmed_mask(results: list[dict], q: float = Q) -> np.ndarray:
    """Which results are found links: Benjamini-Hochberg over all of them, strong enough, replicated."""
    if not results:
        return np.zeros(0, dtype=bool)
    p = np.array([r["p"] for r in results], dtype=float)
    sig, _ = trend.fdr_mask(p, q)
    strong = np.array([abs(r["r"]) >= trend.MIN_LINK_R for r in results])
    rep = np.array([r["replicated"] for r in results])
    return sig & strong & rep


# where a link can come from
# A link between two outputs of one model may be the model's own physics, not something observed.
SYSTEM = {
    "MERRA-2": "MERRA-2",
    "GLDAS": "GLDAS",
    "MODIS Terra": "MODIS",
    "MODIS Aqua": "MODIS",
    "CERES / MODIS": "MODIS",
    "GPM IMERG": "GPM",
    "AIRS": "AIRS",
    "OMI": "OMI",
}
MODELS = {"MERRA-2", "GLDAS"}
# GLDAS is driven by observed precipitation and by reanalysis weather and radiation
GLDAS_FORCING = {"t2m", "t2m_max", "t2m_min", "qv2m", "rh2m", "ws10m", "slp", "precip_gpm", "precip_merra", "sw_down"}
KIND_ORDER = {"independent": 0, "same_instrument": 1, "forcing": 2, "same_model": 3}


def pair_kind(a: str, b: str, sources: dict[str, str]) -> str:
    """independent: different instruments or models; same_instrument / same_model: one system produced both;
    forcing: a land model and the weather it is driven with. `sources` maps variable id to catalog source.
    """
    sa, sb = SYSTEM.get(sources[a], sources[a]), SYSTEM.get(sources[b], sources[b])
    if sa == sb:
        return "same_model" if sa in MODELS else "same_instrument"
    if (sa == "GLDAS" and b in GLDAS_FORCING) or (sb == "GLDAS" and a in GLDAS_FORCING):
        return "forcing"
    return "independent"


# chains A -> B -> C
# Built only from links already found on the same territory. A chain counts when, on the second half of the
# years (never used to find the links): A relates to C at the summed delay with the sign the two links imply,
# and taking B into account removes at least CHAIN_MEDIATION of that relation (B carries it).
CHAIN_MEDIATION = 0.5


def directed_edges(links: list[dict]) -> dict[str, list[tuple[str, int, float]]]:
    """Links as directed edges u -> v (u does not come later than v): positive lag a -> b, negative b -> a, zero both
    ways.

    `links` rows have a, b, lag, r.
    """
    out: dict[str, list[tuple[str, int, float]]] = {}
    for k in links:
        if k["lag"] >= 0:
            out.setdefault(k["a"], []).append((k["b"], k["lag"], k["r"]))
        if k["lag"] <= 0:
            out.setdefault(k["b"], []).append((k["a"], -k["lag"], k["r"]))
    return out


def candidate_chains(links: list[dict]):
    """(A, B, C, lag A->B, lag B->C, r AB, r BC) with a real delay somewhere and three different quantities."""
    edges = directed_edges(links)
    for a, outs in edges.items():
        for b, l1, r1 in outs:
            for c, l2, r2 in edges.get(b, []):
                if c == a or same_family(a, c) or l1 + l2 == 0:
                    continue
                yield a, b, c, l1, l2, r1, r2


def _anomalies(y: np.ndarray, year: np.ndarray, month: np.ndarray) -> np.ndarray:
    a, _ = trend.deseasonalize(y, month)
    return trend._detrend(year + (month - 0.5) / 12.0, a)


def chain_test(xa, xb, xc, year, month, l1: int, l2: int, split: int) -> dict | None:
    """Mediation check of A -> B -> C on the years from `split` on (the second half)."""
    sel = year >= split
    if sel.sum() < 7 * 12:
        return None
    A, B, C = (_anomalies(v[sel], year[sel], month[sel]) for v in (xa, xb, xc))
    n = len(A)
    x, m, y = A[: n - l1 - l2], B[l1 : n - l2], C[l1 + l2 :]
    r_ac, p_ac, _, _ = trend._corr(x, y)
    r_am, _, _, _ = trend._corr(x, m)
    r_mc, _, _, _ = trend._corr(m, y)
    if not all(math.isfinite(v) for v in (r_ac, r_am, r_mc)) or abs(r_am) >= 1 or abs(r_mc) >= 1:
        return None
    partial = (r_ac - r_am * r_mc) / math.sqrt((1 - r_am**2) * (1 - r_mc**2))
    ok = bool(
        np.sign(r_ac) == np.sign(r_am * r_mc) and p_ac < trend.ALPHA and abs(partial) <= CHAIN_MEDIATION * abs(r_ac)
    )
    return {"ok": ok, "r_ac": r_ac, "p_ac": p_ac, "partial": partial, "r_ab2": r_am, "r_bc2": r_mc}


def align_many(records: list[tuple[np.ndarray, np.ndarray, np.ndarray]], min_years: int = MIN_YEARS):
    """Common months of several monthly records (year, month, values), or None if shorter than `min_years`."""
    keys = [yr * 12 + mo for yr, mo, _ in records]
    lo, hi = max(k[0] for k in keys), min(k[-1] for k in keys)
    if hi - lo + 1 < min_years * 12:
        return None
    sels = [(k >= lo) & (k <= hi) for k in keys]
    yr, mo, _ = records[0]
    return [v[s] for (_, _, v), s in zip(records, sels)], yr[sels[0]], mo[sels[0]]
