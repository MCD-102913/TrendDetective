"""Trend statistics checked on synthetic series with a known answer."""

import numpy as np
import pytest

from backend.app import trend


def make(n_years=40, rate_per_decade=0.0, noise=1.0, r1=0.0, seasonal=10.0, seed=0, gaps=0.0, step=None):
    rng = np.random.default_rng(seed)
    n = n_years * 12
    year = 1985 + np.arange(n) // 12
    month = np.arange(n) % 12 + 1
    t = year + (month - 0.5) / 12
    e = np.zeros(n)
    w = rng.normal(0, noise * np.sqrt(1 - r1**2), n)
    e[0] = rng.normal(0, noise)
    for k in range(1, n):
        e[k] = r1 * e[k - 1] + w[k]
    y = 15 + seasonal * np.cos(2 * np.pi * (month - 7) / 12) + rate_per_decade / 10 * (t - t[0]) + e
    if step:
        y = y + np.where(year >= step[0], step[1], 0.0)
    if gaps:
        y[rng.random(n) < gaps] = np.nan
    return y, year, month


def test_recovers_known_rate_and_interval():
    y, year, month = make(rate_per_decade=0.3, noise=0.5, r1=0.4, seed=1)
    r = trend.analyze(y, year, month)
    assert r["verdict"] == "significant_up"
    assert r["rate"]["lo"] < 0.3 < r["rate"]["hi"]
    assert abs(r["rate"]["per_decade"] - 0.3) < 0.08
    assert abs(r["sen"]["per_decade"] - 0.3) < 0.08


def test_negative_trend_with_gaps():
    y, year, month = make(rate_per_decade=-0.5, noise=0.6, gaps=0.1, seed=2)
    r = trend.analyze(y, year, month)
    assert r["verdict"] == "significant_down"
    assert r["rate"]["lo"] < -0.5 < r["rate"]["hi"]


def test_seasonal_cycle_does_not_create_a_trend():
    y, year, month = make(rate_per_decade=0.0, noise=0.5, seasonal=25.0, seed=3)
    r = trend.analyze(y, year, month)
    assert r["verdict"] == "no_trend"
    assert abs(r["rate"]["per_decade"]) < 0.1


@pytest.mark.parametrize("r1", [0.0, 0.6])
def test_false_alarm_rate_is_near_nominal(r1):
    """No trend + red noise: the verdict 'significant' must stay rare (it needs both tests)."""
    hits = t_hits = 0
    n = 300
    for seed in range(n):
        y, year, month = make(n_years=30, rate_per_decade=0.0, noise=1.0, r1=r1, seasonal=5.0, seed=100 + seed)
        r = trend.analyze(y, year, month)
        hits += r["verdict"].startswith("significant")
        t_hits += r["tests"]["t_test"]["p"] < 0.05
    assert hits / n < 0.08, f"false 'significant' verdicts: {hits / n:.3f}"
    assert t_hits / n < 0.10, f"t-test false alarms: {t_hits / n:.3f}"


def test_uncorrected_test_would_overstate_significance():
    """Why the correction matters: with r1 = 0.6 a naive t-test fires far too often."""
    from scipy import stats

    naive = 0
    n = 300
    for seed in range(n):
        y, year, month = make(n_years=30, noise=1.0, r1=0.6, seasonal=0.0, seed=500 + seed)
        t = year + (month - 0.5) / 12
        naive += stats.linregress(t, y).pvalue < 0.05
    assert naive / n > 0.20


def test_coverage_of_the_interval():
    inside = 0
    n = 200
    for seed in range(n):
        y, year, month = make(n_years=30, rate_per_decade=0.2, noise=1.0, r1=0.5, seed=900 + seed)
        r = trend.analyze(y, year, month)
        inside += r["rate"]["lo"] <= 0.2 <= r["rate"]["hi"]
    assert 0.88 <= inside / n <= 1.0, f"95% interval covers the truth in {inside / n:.3f} of runs"


def test_step_is_reported_as_change_point_not_only_trend():
    y, year, month = make(n_years=30, noise=0.3, step=(2005, 2.0), seed=7)
    r = trend.analyze(y, year, month)
    cp = r["change_point"]
    assert cp["is_step"] and abs(cp["year"] - 2005) <= 1
    assert abs(cp["shift"] - 2.0) < 0.3


def test_linear_trend_is_not_called_a_step():
    y, year, month = make(n_years=30, rate_per_decade=1.0, noise=0.3, seed=8)
    assert not trend.analyze(y, year, month)["change_point"]["is_step"]


def test_short_record_gets_no_verdict():
    y, year, month = make(n_years=6, rate_per_decade=1.0, noise=0.1)
    assert trend.analyze(y, year, month)["verdict"] == "too_short"


def test_grid_trends_and_fdr():
    rng = np.random.default_rng(5)
    years = np.arange(40)
    noise = rng.normal(0, 1.0, (2000, 40))
    truth = np.zeros(2000)
    truth[:400] = 0.1  # 20% of the cells have a real trend
    a = noise + truth[:, None] * years
    a[5, :35] = np.nan  # too few years
    slope, p = trend.grid_trends(a.astype(np.float32))
    assert np.isnan(slope[5]) and np.isnan(p[5])
    assert abs(np.nanmedian(slope[:400]) - 0.1) < 0.01
    raw_false = (p[400:] < 0.05).mean()
    mask, _thr = trend.fdr_mask(p)
    assert 0.02 < raw_false < 0.09  # ~5% of trendless cells look significant without control
    assert mask[:400].mean() > 0.95  # real trends survive
    false_share = mask[400:].sum() / max(mask.sum(), 1)
    assert false_share < 0.08  # false discoveries limited to ~5% of what is shown


# robustness and relation
def test_steady_trend_is_robust_and_step_is_not():
    y, year, month = make(n_years=40, rate_per_decade=0.5, noise=0.4, r1=0.3, seed=11)
    assert trend.robustness(y, year, month)["robust"]
    y, year, month = make(n_years=40, noise=0.3, step=(2005, 1.5), seed=12)
    assert not trend.robustness(y, year, month)["checks"]["no_step"]


def test_trend_carried_by_the_last_years_is_not_robust():
    y, year, month = make(n_years=40, noise=0.4, seed=13)
    y = y + np.where(year >= 2019, (year - 2018) * 0.5, 0.0)  # flat for 34 years, then a jump
    r = trend.robustness(y, year, month)
    assert not r["robust"] and not r["checks"]["drop_end"]


def _pair(kind, seed, n_years=30, r1=0.5):
    """Two series: 'linked' share their swings, 'trend' share only a trend, 'none' share nothing."""
    rate = 0.6 if kind == "trend" else 0.0
    noise = 0.5 if kind == "trend" else 1.0  # the shared trend must stand out of the noise
    x, year, month = make(n_years=n_years, noise=noise, r1=r1, seed=seed, rate_per_decade=rate)
    e, _, _ = make(n_years=n_years, noise=noise, r1=r1, seed=seed + 10_000, seasonal=3.0, rate_per_decade=rate)
    if kind == "linked":
        ax, _ = trend.deseasonalize(x, month)
        y = e + 0.8 * np.roll(ax, 2)  # y follows x two months later
        y[:2] = np.nan
    else:
        y = e
    return x, y, year, month


def test_relation_finds_a_real_link_and_its_lag():
    x, y, year, month = _pair("linked", 21)
    r = trend.relation(x, y, year, month)
    assert r["verdict"] == "linked_positive"
    assert r["best"]["lag"] == 2 and r["best"]["r"] > 0.4


def test_shared_trend_is_not_called_a_link():
    hits = common = 0
    n = 100
    for seed in range(n):
        x, y, year, month = _pair("trend", 300 + seed)
        v = trend.relation(x, y, year, month)["verdict"]
        hits += v.startswith("linked")
        common += v == "common_trend_only"
    assert hits / n < 0.08, f"false links from a shared trend: {hits / n:.2f}"
    assert common / n > 0.3, f"shared trend recognised in only {common / n:.2f}"


def test_relation_false_alarm_rate_on_independent_red_noise():
    hits = 0
    n = 200
    for seed in range(n):
        x, y, year, month = _pair("none", 600 + seed, r1=0.7)
        hits += trend.relation(x, y, year, month)["verdict"].startswith("linked")
    assert hits / n < 0.06, f"false links: {hits / n:.3f}"


def test_missing_season_every_year_still_gives_a_verdict():
    """Ocean colour at high latitudes: no data in polar-night months.

    Annual means of anomalies need 6 months; the rate stays unbiased and its interval keeps its coverage (checked on 150
    series).
    """
    est, inside = [], 0
    for seed in range(150):
        y, year, month = make(n_years=24, rate_per_decade=-0.4, noise=0.4, r1=0.3, seed=1000 + seed)
        y[(month <= 3) | (month >= 11)] = np.nan  # five dark months every year
        r = trend.analyze(y, year, month)
        assert r["n_years"] == 24
        est.append(r["rate"]["per_decade"])
        inside += r["rate"]["lo"] <= -0.4 <= r["rate"]["hi"]
    assert abs(np.mean(est) + 0.4) < 0.02
    assert inside / 150 > 0.88


# "if the trend continues"
def test_outlook_intervals_cover_future_years_at_the_stated_rate():
    """30 years fitted, 10 continued: the true future values must fall inside the 80% and 95% intervals in about 80%
    and 95% of the cases (red noise, a real trend).
    """
    in80 = in95 = total = 0
    for seed in range(250):
        y, year, month = make(n_years=40, rate_per_decade=0.4, noise=0.6, r1=0.4, seed=4000 + seed)
        train = year < 2015
        o = trend.outlook(y[train], year[train], month[train], horizon=10)
        anom, _ = trend.deseasonalize(y, month, train)
        yrs, ann = trend.annual_means(anom, year, trend.MIN_MONTHS_ANOMALY)
        actual = dict(zip(yrs.tolist(), ann.tolist()))
        for k, ty in enumerate(o["years"].tolist()):
            v = actual[ty]
            in80 += o["lo80"][k] <= v <= o["hi80"][k]
            in95 += o["lo95"][k] <= v <= o["hi95"][k]
            total += 1
    assert 0.74 <= in80 / total <= 0.88, f"80% interval covers {in80 / total:.3f}"
    assert 0.91 <= in95 / total <= 0.985, f"95% interval covers {in95 / total:.3f}"


def test_outlook_horizon_is_a_third_of_the_record_and_widens():
    y, year, month = make(n_years=45, rate_per_decade=0.3, noise=0.5, seed=41)
    o = trend.outlook(y, year, month)
    assert len(o["years"]) == 15 and o["years"][0] == year.max() + 1
    width = o["hi95"] - o["lo95"]
    assert np.all(np.diff(width) > 0)
    assert abs(o["per_decade"] - 0.3) < 0.15
