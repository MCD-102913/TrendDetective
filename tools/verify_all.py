"""Reference verification: the cube against NASA Giovanni (area averages) and the NASA POWER API (points) for a fixed
set of places. Writes <data>/verify/reference.json (shown on the site in "Methodology and evidence") and prints a
Markdown table for docs/VERIFICATION.md.

TREND_DATA_DIR=/path/to/data python tools/verify_all.py [--only giovanni|power]
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import verify
from backend.app.catalog import BY_ID
from backend.app.cube import Cube

# (variable, place name, box w s e n) for Giovanni; boxes away from the antimeridian
BOXES = [
    ("precip_gpm", "India", (68, 8, 90, 30)),
    ("precip_gpm", "Amazon", (-70, -12, -50, 2)),
    ("precip_gpm", "Sahel", (-15, 10, 30, 18)),
    ("gldas_soil", "India", (68, 8, 90, 30)),
    ("gldas_root", "Amazon", (-70, -12, -50, 2)),
    ("gldas_evap", "Europe", (-5, 42, 25, 55)),
    ("gldas_runoff", "Amazon", (-70, -12, -50, 2)),
    ("airs_tair", "Arctic Siberia", (60, 66, 170, 80)),
    ("airs_tair", "Sahara", (-10, 18, 30, 30)),
    ("airs_h2o", "Tropical Pacific", (150, -10, 179, 10)),
    ("airs_olr", "Sahara", (-10, 18, 30, 30)),
]
PLACES_RU = {
    "India": "Индия",
    "Amazon": "Амазония",
    "Sahel": "Сахель",
    "Europe": "Европа",
    "Arctic Siberia": "Арктическая Сибирь",
    "Sahara": "Сахара",
    "Tropical Pacific": "Тропики Тихого океана",
    "Moscow": "Москва",
    "Delhi": "Дели",
    "Manaus": "Манаус",
    "Madrid": "Мадрид",
    "Brasilia": "Бразилиа",
    "Yakutsk": "Якутск",
    "London": "Лондон",
}

# (variable, place name, lon, lat) for the POWER API
POINTS = [
    ("t2m", "Moscow", 37.6, 55.75),
    ("t2m", "Delhi", 77.2, 28.6),
    ("t2m_max", "Delhi", 77.2, 28.6),
    ("precip_merra", "Manaus", -60.0, -3.1),
    ("rh2m", "Madrid", -3.7, 40.4),
    ("soil_root", "Brasilia", -47.9, -15.8),
    ("snow_depth", "Yakutsk", 129.7, 62.0),
    ("cloud", "London", -0.1, 51.5),
    ("sw_down", "Delhi", 77.2, 28.6),
    ("aod", "Delhi", 77.2, 28.6),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["giovanni", "power"])
    args = ap.parse_args()
    data = Path(os.environ.get("TREND_DATA_DIR", "data"))
    cube = Cube(data)
    ver = verify.Verifier(data)
    cases = []
    jobs = [("giovanni", v, name, box, None) for v, name, box in BOXES] + [
        ("power", v, name, None, (lon, lat)) for v, name, lon, lat in POINTS
    ]
    for tool, vid, name, box, point in jobs:
        if args.only and tool != args.only:
            continue
        if vid not in cube:
            print(f"skip {vid}: not loaded")
            continue
        var = cube[vid]
        y0 = max(int(var.year[0]) + (1 if var.month[0] > 1 else 0), 2001 if tool == "giovanni" else 1981)
        y1 = int(var.year[-1]) - 1  # complete years only
        t0 = time.time()
        try:
            res = ver.run(
                tool,
                vid,
                var,
                BY_ID[vid],
                box=box,
                point=point,
                y0=y0,
                y1=y1,
                ours_series=lambda ii, jj, var=var: var.series(ii, jj)[0],
            )
        except Exception as e:
            print(f"FAILED {tool} {vid} {name}: {type(e).__name__}: {e}")
            cases.append(
                {
                    "tool": tool,
                    "variable": vid,
                    "place": {"en": name, "ru": PLACES_RU.get(name, name)},
                    "error": str(e)[:300],
                }
            )
            continue
        res = {k: v for k, v in res.items() if k != "series"}
        res["place"] = {"en": name, "ru": PLACES_RU.get(name, name)}
        cases.append(res)
        to, tr = res.get("trend_ours", {}), res.get("trend_ref", {})
        print(
            f"{tool:8s} {vid:12s} {name:18s} {res['verdict']:10s} n={res['n_months']:3d} r={res.get('r', 0):.3f} "
            f"r_anom={res.get('r_anomaly', 0):.3f} bias={res.get('rel_bias') or 0:+.1f}% "
            f"trend ours {to.get('per_decade', float('nan')):+.3f} NASA {tr.get('per_decade', float('nan')):+.3f} "
            f"agree={res.get('trend_agrees')} ({time.time() - t0:.0f}s)",
            flush=True,
        )
    out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cases": cases}
    (data / "verify").mkdir(exist_ok=True)
    (data / "verify" / "reference.json").write_text(json.dumps(out, indent=1))

    print(
        "\n| Инструмент | Переменная | Место | Месяцев | r | r аномалий | Смещение | Тренд у нас / у NASA за 10 лет | Тренды согласны | Вывод |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|")
    for c in cases:
        if "error" in c:
            print(f"| {c['tool']} | {c['variable']} | {c['place']['ru']} | | | | | | | ошибка: {c['error'][:80]} |")
            continue
        to, tr = c.get("trend_ours", {}), c.get("trend_ref", {})
        print(
            f"| {verify.TOOLS[c['tool']]['name']} | `{c['variable']}` | {c['place']['ru']} | {c['n_months']} | {c.get('r', 0):.3f} | "
            f"{c.get('r_anomaly', 0):.3f} | {c.get('rel_bias') or 0:+.1f}% | {to.get('per_decade', float('nan')):+.3f} / "
            f"{tr.get('per_decade', float('nan')):+.3f} | {'да' if c.get('trend_agrees') else 'нет'} | {c['verdict']} |"
        )


if __name__ == "__main__":
    sys.exit(main())
