import numpy as np

from backend.app import forecast, trend
from tests.test_trend import make


def cases_of(series, seeds):
    out = []
    for s, (y, year, month) in zip(seeds, series):
        for frac in trend.TRAIN_FRACTIONS:
            c = trend.hindcast(y, year, month, frac)
            if c:
                out.append({**c, "fold": s % 2})
    return out


def test_a_real_trend_is_rewarded_and_noise_is_never_extrapolated():
    seeds = range(5000, 5060)
    real = cases_of([make(n_years=40, rate_per_decade=0.6, noise=0.5, r1=0.3, seed=s) for s in seeds], seeds)
    res = forecast.evaluate(real)
    assert res["cases"] >= 100 and res["skill"] > 0.2 and res["enabled"]
    assert 0.88 <= res["coverage95"] <= 0.99
    noise = [
        trend.hindcast(*make(n_years=40, rate_per_decade=0.0, noise=0.5, r1=0.3, seed=6000 + s)) for s in range(60)
    ]
    assert sum(c is not None for c in noise) <= 6


def accelerating(seed):
    """Flat for 25 years, then rising: a straight line through all of it lags behind the recent years."""
    y, year, month = make(n_years=40, rate_per_decade=0.0, noise=0.3, r1=0.3, seed=seed)
    t = year + (month - 0.5) / 12
    return y + np.where(t > 2010, (t - 2010) * 0.08, 0.0), year, month


def test_an_acceleration_is_caught_by_starting_from_the_recent_level():
    seeds = range(7000, 7060)
    cases = cases_of([accelerating(s) for s in seeds], seeds)
    res = forecast.evaluate(cases)
    assert res["model"] in ("anchored", "damped", "mean")
    assert res["mae_by_model"]["anchored"] < res["mae_by_model"]["line"]


def test_overconfident_intervals_are_widened_by_calibration():
    """Errors twice as large as the standard error predicts: the theory would cover far less than 95%, the calibrated
    interval (judged on other countries) about 95%.
    """
    rng = np.random.default_rng(3)
    cases = []
    for k in range(200):
        rows = [
            {
                "year": 2020 + i,
                "e_clim": 3.0,
                "e_persist": 3.0,
                "e": {m: 1.0 for m in trend.OUTLOOK_MODELS},
                "z": {m: abs(rng.normal(0, 2.0)) for m in trend.OUTLOOK_MODELS},
            }
            for i in range(5)
        ]
        cases.append({"rows": rows, "t80": 1.3, "t95": 2.0, "fold": k % 2})
    res = forecast.evaluate(cases)
    assert res["k95"] > 3.5
    assert 0.92 <= res["coverage95"] <= 0.98


def test_zones():
    assert forecast.zone_of(5) == "tropics" and forecast.zone_of(45) == "nh_mid"
    assert forecast.zone_of(-40) == "sh_mid" and forecast.zone_of(70) == "polar"
