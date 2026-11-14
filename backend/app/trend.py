"""Trend statistics: how fast is a series changing and is the change statistically significant?

Everything works on a monthly series (NaN = no data) with its calendar months.

    deseasonalize      anomalies = value - mean of that calendar month over the base period
    ols_trend          linear rate with a t-test and 95% interval, corrected for autocorrelation of the
                       residuals: n_eff = n (1 - r1) / (1 + r1)   (Santer et al. 2000)
    mann_kendall       rank test for a monotonic trend; variance corrected for autocorrelation of the
                       ranks (Hamed & Rao 1998). Used on annual means.
    seasonal_mk        Mann-Kendall within each calendar month, summed (Hirsch et al. 1982). NOT used
                       for the verdict: it ignores month-to-month autocorrelation and on trendless red
                       noise it fired in 12% (r1 = 0.3) to 50% (r1 = 0.8) of the synthetic runs.
    sen_slope          median of pairwise slopes with a rank-based 95% interval (Sen 1968)
    pettitt            change-point test (Pettitt 1979) + check that a step fits better than a line
    years_to_detect    record length needed to detect a trend of this size in this noise (Weatherhead 1998)
    analyze            all of the above for one series -> dict for the API
    grid_trends        Sen slope and Mann-Kendall p for every cell of a grid (annual means), vectorized
    fdr_mask           Benjamini-Hochberg control of the false discovery rate for maps (Wilks 2016)
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

ALPHA = 0.05
MIN_MONTHS_PER_YEAR = 10  # a year with fewer valid months has no annual mean (raw values)
MIN_MONTHS_ANOMALY = 6  # the same for anomalies: the season is removed, so a year with a missing
# polar-night or monsoon season is not biased (ocean colour, snow, NO2)
MIN_YEARS = 10  # shorter records get no verdict


# helpers
def deseasonalize(y: np.ndarray, month: np.ndarray, base: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Anomalies from the monthly climatology.

    `base` is a boolean mask of the baseline months (default: all).
    """
    y = np.asarray(y, dtype=float)
    base = np.ones(len(y), dtype=bool) if base is None else base
    clim = np.full(12, np.nan)
    for m in range(1, 13):
        sel = (month == m) & base & np.isfinite(y)
        if sel.any():
            clim[m - 1] = y[sel].mean()
    return y - clim[month - 1], clim


def annual_means(
    y: np.ndarray, year: np.ndarray, min_months: int = MIN_MONTHS_PER_YEAR
) -> tuple[np.ndarray, np.ndarray]:
    years = np.arange(year.min(), year.max() + 1)
    out = np.full(len(years), np.nan)
    for i, yr in enumerate(years):
        v = y[year == yr]
        if np.isfinite(v).sum() >= min_months:
            out[i] = np.nanmean(v)
    return years, out


def lag1(x: np.ndarray) -> float:
    """Lag-1 autocorrelation of a series that may contain NaN (pairs of consecutive valid values)."""
    a, b = x[:-1], x[1:]
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 8:
        return 0.0
    a, b = a[ok] - np.nanmean(x), b[ok] - np.nanmean(x)
    den = np.nansum((x - np.nanmean(x)) ** 2)
    return float(np.sum(a * b) / den) if den > 0 else 0.0


# linear trend
def ols_trend(t: np.ndarray, y: np.ndarray) -> dict:
    """Least squares rate per unit of t; standard error inflated for lag-1 autocorrelation of residuals."""
    ok = np.isfinite(y)
    n = int(ok.sum())
    if n < 8:
        return {"n": n}
    tt, yy = t[ok], y[ok]
    slope, intercept = np.polyfit(tt, yy, 1)
    resid_full = np.full(len(y), np.nan)
    resid_full[ok] = yy - (slope * tt + intercept)
    r1 = max(0.0, lag1(resid_full))  # negative autocorrelation is not used to shrink the error
    n_eff = max(3.0, n * (1 - r1) / (1 + r1))
    sse = float(np.nansum(resid_full**2))
    sxx = float(np.sum((tt - tt.mean()) ** 2))
    se = math.sqrt(sse / (n_eff - 2) / sxx) if sxx > 0 and n_eff > 2 else math.nan
    tstat = slope / se if se and se > 0 else math.nan
    p = float(2 * stats.t.sf(abs(tstat), n_eff - 2)) if math.isfinite(tstat) else math.nan
    half = float(stats.t.ppf(1 - ALPHA / 2, n_eff - 2) * se) if math.isfinite(se) else math.nan
    return {
        "n": n,
        "slope": float(slope),
        "intercept": float(intercept),
        "se": se,
        "p": p,
        "lo": float(slope - half),
        "hi": float(slope + half),
        "r1": r1,
        "n_eff": float(n_eff),
        "resid_sd": float(np.nanstd(resid_full, ddof=2)),
    }


# Mann-Kendall
def _mk_s_var(x: np.ndarray) -> tuple[float, float]:
    """Mann-Kendall S and its variance with the tie correction, for a series without NaN."""
    n = len(x)
    d = np.sign(x[None, :] - x[:, None])
    s = float(np.triu(d, 1).sum())
    _, counts = np.unique(x, return_counts=True)
    ties = float(np.sum(counts * (counts - 1) * (2 * counts + 5)))
    return s, (n * (n - 1) * (2 * n + 5) - ties) / 18.0


def _z_p(s: float, var: float) -> tuple[float, float]:
    if var <= 0:
        return 0.0, 1.0
    z = (s - np.sign(s)) / math.sqrt(var)  # continuity correction
    return float(z), float(2 * stats.norm.sf(abs(z)))


def mann_kendall(y: np.ndarray, hamed_rao: bool = True) -> dict:
    x = y[np.isfinite(y)]
    n = len(x)
    if n < 8:
        return {"n": n}
    s, var = _mk_s_var(x)
    factor = 1.0
    if hamed_rao:
        # autocorrelation of the ranks of the detrended series; only significant lags count
        t = np.arange(n, dtype=float)
        slope = sen_slope(t, x)["slope"]
        r = stats.rankdata(x - slope * t)
        r = r - r.mean()
        den = float(np.sum(r * r))
        bound = stats.norm.ppf(1 - ALPHA / 2) / math.sqrt(n)
        acc = 0.0
        for k in range(1, n - 1):
            rho = float(np.sum(r[:-k] * r[k:]) / den) if den > 0 else 0.0
            if abs(rho) > bound:
                acc += (n - k) * (n - k - 1) * (n - k - 2) * rho
        factor = max(1.0, 1 + 2 * acc / (n * (n - 1) * (n - 2)))
    z, p = _z_p(s, var * factor)
    return {"n": n, "s": s, "z": z, "p": p, "tau": s / (n * (n - 1) / 2), "var_factor": factor}


def seasonal_mk(y: np.ndarray, month: np.ndarray) -> dict:
    s_tot = var_tot = 0.0
    n = 0
    for m in range(1, 13):
        x = y[(month == m) & np.isfinite(y)]
        if len(x) >= 4:
            s, var = _mk_s_var(x)
            s_tot, var_tot, n = s_tot + s, var_tot + var, n + len(x)
    if n < 24:
        return {"n": n}
    z, p = _z_p(s_tot, var_tot)
    return {"n": n, "s": s_tot, "z": z, "p": p}


def sen_slope(t: np.ndarray, y: np.ndarray) -> dict:
    """Theil-Sen slope with the Sen (1968) confidence interval."""
    ok = np.isfinite(y)
    tt, yy = t[ok], y[ok]
    n = len(yy)
    if n < 8:
        return {"n": n}
    i, j = np.triu_indices(n, 1)
    dt = tt[j] - tt[i]
    slopes = np.sort((yy[j] - yy[i])[dt != 0] / dt[dt != 0])
    med = float(np.median(slopes))
    _, counts = np.unique(yy, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - float(np.sum(counts * (counts - 1) * (2 * counts + 5)))) / 18.0
    c = stats.norm.ppf(1 - ALPHA / 2) * math.sqrt(max(var, 0.0))
    m = len(slopes)
    lo_i, hi_i = int(max(0, math.floor((m - c) / 2))), int(min(m - 1, math.ceil((m + c) / 2)))
    return {
        "n": n,
        "slope": med,
        "lo": float(slopes[lo_i]),
        "hi": float(slopes[hi_i]),
        "intercept": float(np.median(yy - med * tt)),
    }


# change point
def pettitt(x_years: np.ndarray, x: np.ndarray) -> dict | None:
    """Pettitt test on annual values.

    Reported as a step only when two flat levels fit better than a line.
    """
    ok = np.isfinite(x)
    yrs, v = x_years[ok], x[ok]
    n = len(v)
    if n < 12:
        return None
    r = stats.rankdata(v)
    u = 2 * np.cumsum(r) - np.arange(1, n + 1) * (n + 1)
    k = int(np.argmax(np.abs(u[:-1])))
    p = float(min(1.0, 2 * math.exp(-6 * float(u[k]) ** 2 / (n**3 + n**2))))
    before, after = v[: k + 1], v[k + 1 :]
    rss_step = float(np.sum((before - before.mean()) ** 2) + np.sum((after - after.mean()) ** 2))
    coef = np.polyfit(yrs, v, 1)
    rss_line = float(np.sum((v - np.polyval(coef, yrs)) ** 2))
    return {
        "year": int(yrs[k + 1]),
        "p": p,
        "before": float(before.mean()),
        "after": float(after.mean()),
        "shift": float(after.mean() - before.mean()),
        "is_step": bool(p < ALPHA and rss_step < rss_line and min(len(before), len(after)) >= 4),
    }


def years_to_detect(rate_per_year: float, noise_sd: float, r1: float) -> float | None:
    """Years of monthly data needed to detect the trend with 90% probability (Weatherhead et al. 1998)."""
    if not rate_per_year or not math.isfinite(rate_per_year) or noise_sd <= 0:
        return None
    r1 = min(max(r1, 0.0), 0.95)
    return float((3.3 * noise_sd / abs(rate_per_year) * math.sqrt((1 + r1) / (1 - r1))) ** (2 / 3))


# one series
def analyze(y: np.ndarray, year: np.ndarray, month: np.ndarray, base: tuple[int, int] | None = None) -> dict:
    """Full trend report for a monthly series.

    Rates are per decade.
    """
    y = np.asarray(y, dtype=float)
    t = year + (month - 0.5) / 12.0
    base_mask = None if base is None else (year >= base[0]) & (year <= base[1])
    anom, clim = deseasonalize(y, month, base_mask)
    years, ann = annual_means(y, year)
    _, ann_anom = annual_means(anom, year, MIN_MONTHS_ANOMALY)
    n_years = int(np.isfinite(ann_anom).sum())
    out: dict = {
        "n_months": int(np.isfinite(y).sum()),
        "n_years": n_years,
        "mean": float(np.nanmean(y)) if np.isfinite(y).any() else None,
        "climatology": clim,
        "anomaly": anom,
        "years": years,
        "annual": ann,
        "annual_anomaly": ann_anom,
    }
    if n_years < MIN_YEARS:
        out["verdict"] = "too_short"
        return out

    ols = ols_trend(t, anom)
    mk = mann_kendall(ann_anom)
    sen = sen_slope(t, anom)
    out["tests"] = {
        "t_test": {"p": ols.get("p"), "n_eff": ols.get("n_eff"), "r1": ols.get("r1")},
        "mann_kendall": {"p": mk.get("p"), "z": mk.get("z"), "tau": mk.get("tau")},
        "sen_interval": {"excludes_zero": bool(sen["lo"] > 0 or sen["hi"] < 0)},
    }
    out["rate"] = {
        "per_decade": ols["slope"] * 10,
        "lo": ols["lo"] * 10,
        "hi": ols["hi"] * 10,
        "intercept": ols["intercept"],
    }
    out["sen"] = {
        "per_decade": sen["slope"] * 10,
        "lo": sen["lo"] * 10,
        "hi": sen["hi"] * 10,
        "intercept": sen["intercept"],
    }
    t_valid = t[np.isfinite(anom)]
    out["total_change"] = ols["slope"] * float(t_valid[-1] - t_valid[0])

    # verdict: two independent families of tests must agree (parametric on months, rank-based on years)
    sig_t = ols["p"] < ALPHA
    sig_mk = mk.get("p", 1.0) < ALPHA
    same_sign = np.sign(ols["slope"]) == np.sign(mk.get("s", 0.0))
    direction = "up" if ols["slope"] > 0 else "down"
    if sig_t and sig_mk and same_sign:
        out["verdict"] = f"significant_{direction}"
    elif sig_t or sig_mk:
        out["verdict"] = f"likely_{direction}"
    else:
        out["verdict"] = "no_trend"

    out["change_point"] = pettitt(years.astype(float), ann_anom)
    out["years_to_detect"] = years_to_detect(ols["slope"], ols["resid_sd"], ols["r1"])
    out["noise_sd"] = ols["resid_sd"]
    return out


# maps
def grid_trends(annual: np.ndarray, chunk: int = 8000) -> tuple[np.ndarray, np.ndarray]:
    """Sen slope (per year) and Mann-Kendall p for every row of `annual` [cells, years].

    Cells with fewer than MIN_YEARS valid years get NaN. Annual means have little autocorrelation, so no variance
    correction is applied here; the FDR control (fdr_mask) guards the map as a whole.
    """
    n_cells, n = annual.shape
    i, j = np.triu_indices(n, 1)
    dt = (j - i).astype(np.float32)
    slope = np.full(n_cells, np.nan, dtype=np.float32)
    p = np.full(n_cells, np.nan, dtype=np.float32)
    for c0 in range(0, n_cells, chunk):
        a = annual[c0 : c0 + chunk]
        nv = np.isfinite(a).sum(axis=1)
        rows = np.nonzero(nv >= MIN_YEARS)[0]
        if not len(rows):
            continue
        a = a[rows]
        d = a[:, j] - a[:, i]  # NaN where either year is missing
        with np.errstate(invalid="ignore"):
            slope[c0 + rows] = np.nanmedian(d / dt, axis=1)
            s = np.nansum(np.sign(d), axis=1)
        m = nv[rows].astype(np.float64)
        var = m * (m - 1) * (2 * m + 5) / 18.0
        z = (s - np.sign(s)) / np.sqrt(var)
        pv = 2 * stats.norm.sf(np.abs(z))
        pv[np.nanmax(a, axis=1) == np.nanmin(a, axis=1)] = 1.0  # constant series (e.g. no snow at all)
        p[c0 + rows] = pv
    return slope, p


def fdr_mask(p: np.ndarray, q: float = 0.05) -> tuple[np.ndarray, float]:
    """Benjamini-Hochberg: which p-values stay significant when the expected share of false discoveries is limited to q.

    Returns the mask and the p threshold (0 if nothing passes).
    """
    ok = np.isfinite(p)
    pv = np.sort(p[ok])
    m = len(pv)
    if m == 0:
        return np.zeros(p.shape, dtype=bool), 0.0
    passed = np.nonzero(pv <= q * np.arange(1, m + 1) / m)[0]
    thr = float(pv[passed[-1]]) if len(passed) else 0.0
    return ok & (p <= thr) & (thr > 0), thr


# robustness of a trend
def robustness(y: np.ndarray, year: np.ndarray, month: np.ndarray) -> dict:
    """Is the trend stable, or does it hang on a few years?

    Four checks on the annual anomalies:
        halves      the Sen slope has the same sign in the first and in the second half of the record
        drop_start  still significant (Mann-Kendall) and same sign without the first 20% of years
        drop_end    the same without the last 20% of years
        no_step     the change is not better described as one abrupt step (Pettitt)
    The trend is called robust when the main verdict is significant and all four hold.
    """
    anom, _ = deseasonalize(np.asarray(y, dtype=float), month)
    years, ann = annual_means(anom, year, MIN_MONTHS_ANOMALY)
    ok = np.isfinite(ann)
    yrs, v = years[ok].astype(float), ann[ok]
    n = len(v)
    if n < 15:
        return {"robust": False, "checks": None}
    full = sen_slope(yrs, v)["slope"]
    sign = np.sign(full)
    h = n // 2
    first, second = sen_slope(yrs[: h + 1], v[: h + 1]), sen_slope(yrs[h:], v[h:])
    k = max(2, round(0.2 * n))

    def holds(a_vals) -> bool:
        mk = mann_kendall(a_vals)
        return bool(mk.get("p", 1.0) < ALPHA and np.sign(mk.get("s", 0.0)) == sign)

    cp = pettitt(yrs, v)
    checks = {
        "halves": bool(np.sign(first.get("slope", 0.0)) == sign and np.sign(second.get("slope", 0.0)) == sign),
        "drop_start": holds(v[k:]),
        "drop_end": holds(v[:-k]),
        "no_step": not (cp and cp["is_step"]),
    }
    return {
        "robust": all(checks.values()),
        "checks": checks,
        "first_half": first.get("slope", math.nan) * 10,
        "second_half": second.get("slope", math.nan) * 10,
        "split_year": int(yrs[h]),
    }


# relation between two series
def _detrend(t: np.ndarray, a: np.ndarray) -> np.ndarray:
    ok = np.isfinite(a)
    out = np.full(len(a), np.nan)
    if ok.sum() >= 8:
        out[ok] = a[ok] - np.polyval(np.polyfit(t[ok], a[ok], 1), t[ok])
    return out


def _corr(a: np.ndarray, b: np.ndarray) -> tuple[float, float, int, float]:
    """Pearson r between two series with NaN, its p-value with the effective sample size
    n_eff = n (1 - r1a r1b) / (1 + r1a r1b)  (Bretherton et al. 1999), n and n_eff.
    """
    ok = np.isfinite(a) & np.isfinite(b)
    n = int(ok.sum())
    if n < 12 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
        return math.nan, math.nan, n, math.nan
    r = float(np.corrcoef(a[ok], b[ok])[0, 1])
    ra, rb = max(0.0, lag1(np.where(ok, a, np.nan))), max(0.0, lag1(np.where(ok, b, np.nan)))
    n_eff = max(4.0, n * (1 - ra * rb) / (1 + ra * rb))
    tstat = r * math.sqrt((n_eff - 2) / max(1e-12, 1 - r * r))
    return r, float(2 * stats.t.sf(abs(tstat), n_eff - 2)), n, float(n_eff)


MAX_LAG = 6  # months
MIN_LINK_R = 0.3  # a link weaker than this explains under 9% of the variance


def relation(
    x: np.ndarray, y: np.ndarray, year: np.ndarray, month: np.ndarray, lags: tuple[int, int] = (-MAX_LAG, MAX_LAG)
) -> dict:
    """Are two monthly series of one territory related beyond sharing a trend?

    Both are deseasonalized. `raw` correlates the anomalies as they are: two series that merely both
    trend will correlate. `detrended` first removes the linear trend of each series, so it measures whether
    the month-to-month and year-to-year swings move together: the evidence of a physical link.
    Lags from lags[0] to lags[1] months are scanned on the detrended series (positive: x leads y);
    the p-value of the best lag is multiplied by the number of lags tried (Bonferroni).
    """
    t = year + (month - 0.5) / 12.0
    ax, _ = deseasonalize(np.asarray(x, dtype=float), month)
    ay, _ = deseasonalize(np.asarray(y, dtype=float), month)
    dx, dy = _detrend(t, ax), _detrend(t, ay)
    r_raw, p_raw, n, _ = _corr(ax, ay)
    r_det, p_det, _, n_eff = _corr(dx, dy)
    scan = []
    for lag in range(lags[0], lags[1] + 1):
        if lag > 0:
            r, p, _, _ = _corr(dx[:-lag], dy[lag:])
        elif lag < 0:
            r, p, _, _ = _corr(dx[-lag:], dy[:lag])
        else:
            r, p = r_det, p_det
        scan.append({"lag": lag, "r": r, "p": p})
    valid = [l for l in scan if math.isfinite(l["r"])]
    out: dict = {
        "n_months": n,
        "n_eff": n_eff,
        "raw": {"r": r_raw, "p": p_raw},
        "detrended": {"r": r_det, "p": p_det},
        "lags": scan,
    }
    if not valid or not math.isfinite(r_det):
        out["verdict"] = "too_short"
        return out
    best = max(valid, key=lambda l: abs(l["r"]))
    best_p = min(1.0, best["p"] * len(valid))
    out["best"] = {"lag": best["lag"], "r": best["r"], "p": best_p}
    yrs, annx = annual_means(ax, year, MIN_MONTHS_ANOMALY)
    _, anny = annual_means(ay, year, MIN_MONTHS_ANOMALY)
    out["annual"] = {"years": yrs, "x": annx, "y": anny}
    linked = best_p < ALPHA and abs(best["r"]) >= MIN_LINK_R
    if linked:
        out["verdict"] = "linked_positive" if best["r"] > 0 else "linked_negative"
    elif math.isfinite(p_raw) and p_raw < ALPHA and abs(r_raw) >= MIN_LINK_R:
        out["verdict"] = "common_trend_only"
    else:
        out["verdict"] = "no_link"
    out["explained"] = best["r"] ** 2  # share of the swings of y that x accounts for at the best lag
    return out


# "if the trend continues"
OUTLOOK_FRACTION = 1 / 3  # the outlook reaches at most a third of the record length
TRAIN_FRACTIONS = (
    0.6,
    0.675,
    0.75,
)  # hindcast origins: the fit uses the first part, the check the next third of its length
TRAIN_FRACTION = TRAIN_FRACTIONS[-1]
OUTLOOK_MODELS = ("line", "anchored", "damped", "mean")
ANCHOR_YEARS = 5  # "anchored" starts from the mean of the last five years
DAMPING = 0.9  # "damped": the yearly step shrinks by this factor each year ahead


def outlook(
    y: np.ndarray,
    year: np.ndarray,
    month: np.ndarray,
    horizon: int | None = None,
    model: str = "line",
    k80: float | None = None,
    k95: float | None = None,
) -> dict | None:
    """Continues the trend of the annual anomalies for `horizon` years (default: a third of the record).

    The slope b is the least-squares slope of the annual anomalies; the models differ in where they start
    and how the slope continues:
        line      the fitted line itself
        anchored  starts from the mean of the last ANCHOR_YEARS years (catches a recent acceleration or step)
        damped    anchored, with the yearly step shrinking by DAMPING each year ahead
        mean      the average of line and anchored
    Prediction interval of a single future year T (line; anchored uses 1/k and the centre of the last years):
        var = s^2 * infl * (1/n + (T - mean t)^2 / Sxx)   uncertainty of the fit, inflated for lag-1
                                                         autocorrelation phi: infl = (1+phi)/(1-phi)
            + s^2                                        year-to-year scatter
    The half-widths are quantiles of the t distribution with n_eff - 2 degrees of freedom times the standard
    error, or k80 / k95 times it when calibrated on the past (never narrower than the theory).
    An acceleration is never extrapolated: all models keep the straight-line slope.
    """
    anom, clim = deseasonalize(np.asarray(y, dtype=float), month)
    years, ann = annual_means(anom, year, MIN_MONTHS_ANOMALY)
    ok = np.isfinite(ann)
    t, z = years[ok].astype(float), ann[ok]
    n = len(z)
    if n < MIN_YEARS:
        return None
    horizon = horizon if horizon is not None else int(n * OUTLOOK_FRACTION)
    if horizon < 1:
        return None
    b, a = np.polyfit(t, z, 1)
    resid = np.full(len(ann), np.nan)
    resid[ok] = z - (a + b * t)
    phi = min(max(lag1(resid), 0.0), 0.9)
    infl = (1 + phi) / (1 - phi)
    n_eff = max(4.0, n * (1 - phi) / (1 + phi))
    s2 = float(np.nansum(resid**2) / (n - 2))
    tbar, sxx = t.mean(), float(np.sum((t - t.mean()) ** 2))
    last = int(t[-1])
    k = min(ANCHOR_YEARS, n)
    level, tc = float(z[-k:].mean()), float(t[-k:].mean())
    future = np.arange(last + 1, last + horizon + 1, dtype=float)
    h = future - last
    line = a + b * future
    anchored = level + b * (future - tc)
    damped = level + b * (last - tc) + b * DAMPING * (1 - DAMPING**h) / (1 - DAMPING)
    se_line = np.sqrt(s2 * infl * (1 / n + (future - tbar) ** 2 / sxx) + s2)
    se_anch = np.sqrt(s2 * infl * (1 / k + (future - tc) ** 2 / sxx) + s2)
    mids = {"line": line, "anchored": anchored, "damped": damped, "mean": (line + anchored) / 2}
    ses = {"line": se_line, "anchored": se_anch, "damped": se_anch, "mean": (se_line + se_anch) / 2}
    refs = {"line": a + b * last, "anchored": level + b * (last - tc), "damped": level + b * (last - tc)}
    refs["mean"] = (refs["line"] + refs["anchored"]) / 2
    t80, t95 = float(stats.t.ppf(0.90, n_eff - 2)), float(stats.t.ppf(0.975, n_eff - 2))
    q80, q95 = max(k80 or 0.0, t80), max(k95 or 0.0, t95)
    mid, se = mids[model], ses[model]
    return {
        "years": future.astype(int),
        "mid": mid,
        "lo80": mid - q80 * se,
        "hi80": mid + q80 * se,
        "lo95": mid - q95 * se,
        "hi95": mid + q95 * se,
        "model": model,
        "calibrated": bool(k95),
        "last_year": last,
        "ref": float(refs[model]),
        "per_decade": float(b * 10),
        "noise_sd": math.sqrt(s2),
        "phi": phi,
        "clim_mean": float(np.nanmean(clim)),
        "t80": t80,
        "t95": t95,
        "all": {m: (mids[m], ses[m]) for m in OUTLOOK_MODELS},
    }


def hindcast(y: np.ndarray, year: np.ndarray, month: np.ndarray, train_fraction: float = TRAIN_FRACTION) -> dict | None:
    """Hindcast: the first `train_fraction` of the years plays the role of the present. The trend fitted there is
    continued for a third of the training length (the same rule as on the site) with every model and compared with
    what happened. Only trends that the site would extrapolate count: significant and robust on the training part.

    Per future year: the error of every model and of the two naive answers (climatology: the training mean;
    persistence: the mean of the last five training years) in units of the training noise, so that territories
    and variables can be pooled, and the error of every model in units of its own standard error (z), from
    which the intervals are calibrated (backend/app/forecast.py).
    """
    y = np.asarray(y, dtype=float)
    yrs = np.unique(year)
    split = int(yrs[0] + int(len(yrs) * train_fraction))
    train = year < split
    if (~train).sum() < 12:
        return None
    a = analyze(y[train], year[train], month[train])
    if not a["verdict"].startswith("significant"):
        return None
    if not robustness(y[train], year[train], month[train])["robust"]:
        return None
    o = outlook(y[train], year[train], month[train])
    if o is None:
        return None
    # actual future anomalies against the TRAINING climatology (no information from the future)
    anom, _ = deseasonalize(y, month, train)
    years_all, ann_all = annual_means(anom, year, MIN_MONTHS_ANOMALY)
    actual = dict(zip(years_all.tolist(), ann_all.tolist()))
    train_ann = [actual[v] for v in years_all if v < split and math.isfinite(actual[v])]
    clim, persist = float(np.mean(train_ann)), float(np.mean(train_ann[-5:]))
    s = o["noise_sd"] or 1.0
    rows = []
    for k, ty in enumerate(o["years"].tolist()):
        v = actual.get(ty)
        if v is None or not math.isfinite(v):
            continue
        rows.append(
            {
                "year": ty,
                "e_clim": abs(v - clim) / s,
                "e_persist": abs(v - persist) / s,
                "e": {m: abs(v - mid[k]) / s for m, (mid, se) in o["all"].items()},
                "z": {m: abs(v - mid[k]) / se[k] for m, (mid, se) in o["all"].items()},
            }
        )
    return (
        {"split": split, "horizon": len(o["years"]), "t80": o["t80"], "t95": o["t95"], "rows": rows} if rows else None
    )
