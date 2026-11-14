import numpy as np

from backend.app import discovery
from tests.test_trend import make


def linked(seed, k=0.7, lag=2, n_years=24):
    """Y follows x with a delay of `lag` months; both have their own trend and red noise."""
    x, year, month = make(n_years=n_years, rate_per_decade=0.3, noise=1.0, r1=0.5, seed=seed)
    e, _, _ = make(n_years=n_years, rate_per_decade=-0.2, noise=1.0, r1=0.5, seasonal=3, seed=seed + 10_000)
    ax = x - np.nanmean(x)
    y = e + k * np.roll(ax, lag)
    return x, y, year, month


def test_a_real_delayed_link_is_found_and_repeats():
    res = [discovery.discover_and_replicate(*linked(s)) for s in range(40)]
    found = discovery.confirmed_mask(res)
    assert found.mean() >= 0.9
    assert all(r["lag"] in (1, 2, 3) for r, f in zip(res, found) if f)


def test_independent_series_are_almost_never_confirmed():
    """Independent pairs sharing trends and autocorrelation: the search must stay quiet."""
    res = []
    for s in range(300):
        x, year, month = make(n_years=20, rate_per_decade=0.4, noise=1.0, r1=0.7, seed=20_000 + s)
        y, _, _ = make(n_years=20, rate_per_decade=0.4, noise=1.0, r1=0.7, seed=30_000 + s)
        res.append(discovery.discover_and_replicate(x, y, year, month))
    assert discovery.confirmed_mask(res).sum() <= 3


def test_shifting_by_whole_years_destroys_the_link():
    res = []
    for s in range(40):
        x, y, year, month = linked(s)
        res.append(discovery.discover_and_replicate(x, discovery.null_shift(y, 7), year, month))
    assert discovery.confirmed_mask(res).sum() <= 2


def test_too_short_and_same_quantity():
    x, y, year, month = linked(1, n_years=12)
    assert discovery.discover_and_replicate(x, y, year, month) is None
    assert discovery.same_family("ndvi", "evi") and discovery.same_family("ts", "ts_ocean")
    assert not discovery.same_family("precip_gpm", "ndvi")


def test_where_a_link_comes_from():
    from backend.app.catalog import BY_ID

    src = {k: v["source"] for k, v in BY_ID.items()}
    assert discovery.pair_kind("precip_gpm", "ndvi", src) == "independent"
    assert discovery.pair_kind("evland", "soil_top", src) == "same_model"
    assert discovery.pair_kind("precip_gpm", "gldas_soil", src) == "forcing"
    assert discovery.pair_kind("cloud", "sw_down", src) == "same_instrument"


def chain_series(seed, mediated=True, n_years=24):
    """A drives B after 1 month, B drives C after 2 months; or (mediated=False) A drives B and C separately."""
    rng = np.random.default_rng(seed)
    n = n_years * 12
    year = 1995 + np.arange(n) // 12
    month = np.arange(n) % 12 + 1
    a = rng.normal(0, 1, n)
    b = 0.8 * np.roll(a, 1) + rng.normal(0, 0.6, n)
    c = (0.8 * np.roll(b, 2) if mediated else 0.6 * np.roll(a, 3)) + rng.normal(0, 0.6, n)
    return a, b, c, year, month


def test_a_real_chain_passes_and_a_common_driver_does_not():
    ok = [discovery.chain_test(*chain_series(s), 1, 2, 2007)["ok"] for s in range(30)]
    assert sum(ok) >= 27
    # B and C both follow A: "A -> B -> C" is not a chain, B does not carry the A-C relation
    bad = [discovery.chain_test(*chain_series(s, mediated=False), 1, 2, 2007)["ok"] for s in range(30)]
    assert sum(bad) <= 3


def test_chains_need_a_delay_and_three_quantities():
    links = [
        {"a": "precip_gpm", "b": "soil_root", "lag": 1, "r": 0.5},
        {"a": "soil_root", "b": "ndvi", "lag": 2, "r": 0.4},
        {"a": "ndvi", "b": "evi", "lag": 0, "r": 0.9},
        {"a": "cloud", "b": "sw_down", "lag": 0, "r": -0.8},
        {"a": "sw_down", "b": "t2m_max", "lag": 0, "r": 0.6},
    ]
    chains = {(a, b, c) for a, b, c, *_ in discovery.candidate_chains(links)}
    assert ("precip_gpm", "soil_root", "ndvi") in chains
    assert ("cloud", "sw_down", "t2m_max") not in chains  # no delay anywhere: order unknown
    assert not any(a == "ndvi" and c == "evi" for a, b, c in chains)
