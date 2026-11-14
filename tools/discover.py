"""Exhaustive search for links between variables and for chains A -> B -> C (backend/app/discovery.py has the rules), on
countries, ocean regions, latitude belts and the larger regions inside countries.

Writes <data>/discoveries/discoveries.sqlite:
  meta           the criteria and the counts (tests, links found, links found on year-shifted pairs)
  pairs          per pair of variables: territories tested, where the link was found, sign and lag
  links          every link found, with the result on the full common period
  chains         every chain found on a territory
  chain_summary  per chain A -> B -> C: on how many territories it was tested and found
and <data>/discoveries/candidates.yaml: pairs of independent sources found on many territories with one
sign, written as rules for a human to review, never added automatically.

    TREND_DATA_DIR=/path/to/data python tools/discover.py [--workers 2]
    TREND_DATA_DIR=/path/to/data python tools/discover.py --candidates     (only candidates.yaml)
    TREND_DATA_DIR=/path/to/data python tools/discover.py --quick          (dry run, quick.sqlite)
"""

import itertools
import json
import multiprocessing as mp
import os
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import discovery, rules as rulebook, trend
from backend.app.catalog import BY_ID, VARIABLES
from backend.app.cube import Cube
from backend.app.regions import Regions

MIN_MONTHS = 120
MIN_ADMIN1_CELLS = 8  # regions inside countries: at least this many 0.5 x 0.625 degree cells
NULL_SHIFT_YEARS = 7
CANDIDATE_MIN_REGIONS = 10
CANDIDATE_MIN_SIGN_SHARE = 0.8
CANDIDATE_MAX = 20
SOURCES = {k: v["source"] for k, v in BY_ID.items()}

# filled in the parent before the workers fork, read (never copied) by them
SERIES: dict[str, dict[str, np.ndarray]] = {}
TIME: dict[str, tuple[np.ndarray, np.ndarray]] = {}
TERR: list[str] = []


def r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def test_pair(pair):
    """Discovery and replication of one pair on every territory, and the same on the year-shifted pair."""
    a, b = pair
    (ya, ma), (yb, mb) = TIME[a], TIME[b]
    out = []
    for rid in TERR:
        x, y = SERIES[a].get(rid), SERIES[b].get(rid)
        if x is None or y is None:
            continue
        al = discovery.align(ya, ma, x, yb, mb, y)
        if al is None:
            continue
        xa, ybv, year, month = al
        res = discovery.discover_and_replicate(xa, ybv, year, month)
        if res is None:
            continue
        nres = discovery.discover_and_replicate(xa, discovery.null_shift(ybv, NULL_SHIFT_YEARS), year, month)
        out.append((a, b, rid, res, nres or {"p": 1.0, "r": 0.0, "replicated": False}))
    return out


def main():
    data = Path(os.environ.get("TREND_DATA_DIR", "data"))
    cube, regions = Cube(data), Regions(data)
    db_path = data / "discoveries" / "discoveries.sqlite"
    if "--candidates" in sys.argv:
        return write_candidates(data, sqlite3.connect(db_path), cube, regions)
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 2
    t0 = time.time()

    vids = [v["id"] for v in VARIABLES if v["id"] in cube]
    ref = cube["t2m"].grid
    terr = [rid for rid, i in regions.items.items() if i["level"] in (0, -1, -2)]
    admin1 = [
        rid
        for rid, i in regions.items.items()
        if i["level"] == 1 and len(ref.cells_in(regions.geometry(rid))[0]) >= MIN_ADMIN1_CELLS
    ]
    quick = "--quick" in sys.argv  # a dry run on a few pairs and regions, into a separate file
    if quick:
        admin1 = admin1[:40]
        db_path = db_path.with_name("quick.sqlite")
    TERR.extend(terr + admin1)
    print(f"territories: {len(terr)} countries, oceans and belts + {len(admin1)} regions inside countries", flush=True)

    cells: dict[tuple, dict] = {}
    for vid in vids:
        var = cube[vid]
        TIME[vid] = (var.year, var.month)
        grid_cells = cells.setdefault(var.grid.key, {})
        SERIES[vid] = {}
        for rid in TERR:
            if rid not in grid_cells:
                grid_cells[rid] = var.grid.cells_in(regions.geometry(rid))
            ii, jj = grid_cells[rid]
            if len(ii) < 2:
                continue
            y, _ = var.series(ii, jj)
            if np.isfinite(y).sum() >= MIN_MONTHS:
                SERIES[vid][rid] = y
        print(f"series {vid:13s} {len(SERIES[vid]):5d} territories  ({time.time() - t0:.0f}s)", flush=True)

    pairs = [(a, b) for a, b in itertools.combinations(vids, 2) if not discovery.same_family(a, b)]
    if quick:
        pairs = [p for p in pairs if {"precip_gpm", "soil_root", "ndvi", "qv2m", "cloud", "sw_down"} >= set(p)]
    keys, real, null = [], [], []
    with mp.get_context("fork").Pool(workers) as pool:
        for k, rows in enumerate(pool.imap_unordered(test_pair, pairs, chunksize=2)):
            for a, b, rid, res, nres in rows:
                keys.append((a, b, rid))
                real.append(res)
                null.append(nres)
            if k % 25 == 0:
                print(f"pairs {k + 1}/{len(pairs)}: {len(real)} tests ({time.time() - t0:.0f}s)", flush=True)

    found = discovery.confirmed_mask(real)
    found_null = discovery.confirmed_mask(null)
    print(f"tests {len(real)}, found {int(found.sum())}, found on shifted pairs {int(found_null.sum())}", flush=True)

    level = {rid: regions.require(rid)["level"] for rid in TERR}
    tested: defaultdict[tuple[str, str], int] = defaultdict(int)
    link_rows, by_region = [], defaultdict(list)
    for (a, b, rid), res, f in zip(keys, real, found):
        tested[(a, b)] += 1
        if not f:
            continue
        (ya, ma), (yb, mb) = TIME[a], TIME[b]
        xa, ybv, year, month = discovery.align(ya, ma, SERIES[a][rid], yb, mb, SERIES[b][rid])
        full = trend.relation(xa, ybv, year, month)
        row = {
            "a": a,
            "b": b,
            "region_id": rid,
            "level": level[rid],
            "r": r4(full["best"]["r"]),
            "lag": full["best"]["lag"],
            "p": r4(full["best"]["p"]),
            "r_first": r4(res["r"]),
            "lag_first": res["lag"],
            "r_second": r4(res["r_repl"]),
            "lag_second": res["lag_repl"],
            "split": res["split"],
            "y0": int(year[0]),
            "y1": int(year[-1]),
        }
        link_rows.append(row)
        by_region[rid].append(row)
    print(f"full-period results ({time.time() - t0:.0f}s)", flush=True)

    # chains from the links of each territory; a chain inside one model (both links) is not kept
    chain_rows: list[dict] = []
    chain_tested: defaultdict[tuple[str, str, str], int] = defaultdict(int)
    for rid, links in by_region.items():
        split_of = {(k["a"], k["b"]): k["split"] for k in links}
        kind_of = {(k["a"], k["b"]): discovery.pair_kind(k["a"], k["b"], SOURCES) for k in links}
        for a, b, c, l1, l2, r1, r2 in discovery.candidate_chains(links):
            k1 = kind_of.get((a, b)) or kind_of[(b, a)]
            k2 = kind_of.get((b, c)) or kind_of[(c, b)]
            if k1 == "same_model" and k2 == "same_model":
                continue
            if rid not in SERIES[c] or rid not in SERIES[a]:
                continue
            al = discovery.align_many([(*TIME[v], SERIES[v][rid]) for v in (a, b, c)])
            if al is None:
                continue
            (xa, xb, xc), year, month = al
            split = max(split_of.get((a, b)) or split_of[(b, a)], split_of.get((b, c)) or split_of[(c, b)])
            chain_tested[(a, b, c)] += 1
            t = discovery.chain_test(xa, xb, xc, year, month, l1, l2, split)
            if t and t["ok"]:
                kind = max((k1, k2), key=lambda k: discovery.KIND_ORDER[k])
                chain_rows.append(
                    {
                        "a": a,
                        "b": b,
                        "c": c,
                        "region_id": rid,
                        "level": level[rid],
                        "lag1": l1,
                        "lag2": l2,
                        "r_ab": r4(r1),
                        "r_bc": r4(r2),
                        "r_ac": r4(t["r_ac"]),
                        "partial": r4(t["partial"]),
                        "kind": kind,
                    }
                )
    print(f"chains: {sum(chain_tested.values())} tested, {len(chain_rows)} found ({time.time() - t0:.0f}s)", flush=True)

    write_db(
        db_path,
        pairs,
        tested,
        link_rows,
        chain_rows,
        chain_tested,
        {
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "rule": {
                "q": discovery.Q,
                "min_r": trend.MIN_LINK_R,
                "replication_r": discovery.REPLICATION_R,
                "max_lag": trend.MAX_LAG,
                "min_years": discovery.MIN_YEARS,
                "null_shift_years": NULL_SHIFT_YEARS,
                "chain_mediation": discovery.CHAIN_MEDIATION,
                "min_admin1_cells": MIN_ADMIN1_CELLS,
                "families": [sorted(f) for f in discovery.FAMILIES],
            },
            "counts": {
                "pairs": len(pairs),
                "territories": len(TERR),
                "admin1": len(admin1),
                "tests": len(real),
                "found": int(found.sum()),
                "found_null": int(found_null.sum()),
                "expected_false_share": r4(found_null.sum() / max(found.sum(), 1)),
                "chains_tested": sum(chain_tested.values()),
                "chains_found": len(chain_rows),
            },
        },
    )
    if not quick:
        write_candidates(data, sqlite3.connect(db_path), cube, regions)
    print(f"done in {time.time() - t0:.0f}s")


def write_db(path, pairs, tested, link_rows, chain_rows, chain_tested, meta):
    tmp = path.with_suffix(".tmp")
    tmp.parent.mkdir(exist_ok=True)
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript(
        """CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE pairs (a TEXT, b TEXT, kind TEXT, tested
        INT, found INT, positive INT, negative INT, median_r REAL, median_lag REAL); CREATE TABLE links (a TEXT, b TEXT,
        region_id TEXT, level INT, r REAL, lag INT, p REAL, r_first REAL, lag_first INT, r_second REAL, lag_second INT,
        split INT, y0 INT, y1 INT); CREATE TABLE chains (a TEXT, b TEXT, c TEXT, region_id TEXT, level INT, lag1 INT,
        lag2 INT, r_ab REAL, r_bc REAL, r_ac REAL, partial REAL, kind TEXT); CREATE TABLE chain_summary (a TEXT, b TEXT,
        c TEXT, kind TEXT, tested INT, found INT, countries INT, median_r_ac REAL, median_partial REAL, lag1 REAL, lag2
        REAL);
        """
    )
    db.executemany("INSERT INTO meta VALUES (?, ?)", [(k, json.dumps(v)) for k, v in meta.items()])
    by_pair = defaultdict(list)
    for r in link_rows:
        by_pair[(r["a"], r["b"])].append(r)
    db.executemany(
        "INSERT INTO pairs VALUES (?,?,?,?,?,?,?,?,?)",
        [
            (
                a,
                b,
                discovery.pair_kind(a, b, SOURCES),
                tested[(a, b)],
                len(f),
                sum(1 for x in f if x["r"] > 0),
                sum(1 for x in f if x["r"] <= 0),
                r4(np.median([x["r"] for x in f])) if f else None,
                float(np.median([x["lag"] for x in f])) if f else None,
            )
            for (a, b) in pairs
            for f in [by_pair.get((a, b), [])]
        ],
    )
    cols = [
        "a",
        "b",
        "region_id",
        "level",
        "r",
        "lag",
        "p",
        "r_first",
        "lag_first",
        "r_second",
        "lag_second",
        "split",
        "y0",
        "y1",
    ]
    # only "?" placeholders go into the text of the statements below
    db.executemany(f"INSERT INTO links VALUES ({','.join('?' * len(cols))})", [[r[c] for c in cols] for r in link_rows])  # noqa: S608  # nosec B608
    ccols = ["a", "b", "c", "region_id", "level", "lag1", "lag2", "r_ab", "r_bc", "r_ac", "partial", "kind"]
    db.executemany(
        f"INSERT INTO chains VALUES ({','.join('?' * len(ccols))})",  # noqa: S608  # nosec B608
        [[r[c] for c in ccols] for r in chain_rows],
    )
    by_chain = defaultdict(list)
    for r in chain_rows:
        by_chain[(r["a"], r["b"], r["c"])].append(r)
    db.executemany(
        "INSERT INTO chain_summary VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                a,
                b,
                c,
                f[0]["kind"],
                chain_tested[(a, b, c)],
                len(f),
                sum(1 for x in f if x["level"] == 0),
                r4(np.median([x["r_ac"] for x in f])),
                r4(np.median([x["partial"] for x in f])),
                float(np.median([x["lag1"] for x in f])),
                float(np.median([x["lag2"] for x in f])),
            )
            for (a, b, c), f in by_chain.items()
        ],
    )
    db.executescript("""CREATE INDEX links_region ON links (region_id); CREATE INDEX links_pair ON links (a, b); CREATE
                     INDEX chains_region ON chains (region_id); CREATE INDEX chains_key ON chains (a, b, c);
                     """)
    db.commit()
    db.close()
    os.replace(tmp, path)


def write_candidates(data, db, cube, regions):
    """Candidates for hand-written rules: pairs of independent sources found on many countries with one sign, most
    territories first; the leader becomes "from".
    """
    rows = db.execute(
        "SELECT a, b, found, positive, negative, median_lag FROM pairs WHERE kind = 'independent' "
        "AND found >= ? ORDER BY found DESC",
        (CANDIDATE_MIN_REGIONS,),
    ).fetchall()
    chosen = [r for r in rows if max(r[3], r[4]) >= CANDIDATE_MIN_SIGN_SHARE * r[2]][:CANDIDATE_MAX]
    lines = [
        "# Candidates found by tools/discover.py. NOT checked hypotheses: review the physics before",
        "# copying any of them into rules/rules.yaml.",
        "version: 1",
        "rules:",
    ]
    for a, b, n, pos, neg, lag in chosen:
        if lag < 0:
            a, b, lag = b, a, -lag
        na, nb = BY_ID[a]["name"], BY_ID[b]["name"]
        lines += [
            f"  - id: found_{a}_{b}",
            "    name:",
            f"      en: {json.dumps(na['en'] + ' and ' + nb['en'], ensure_ascii=False)}",
            f"      ru: {json.dumps(na['ru'] + ' и ' + nb['ru'], ensure_ascii=False)}",
            "    description:",
            f'      en: "Found by the exhaustive search on {n} territories; the cause is not established."',
            f'      ru: "Найдено перебором на {n} территориях; причина не установлена."',
            "    author: exhaustive search",
            "    links:",
            f'      - {{from: {a}, to: {b}, sign: "{"+" if pos >= neg else "-"}", max_lag: {min(trend.MAX_LAG, round(lag) + 1)}}}',
            "    territories: countries",
            "",
        ]
    text = "\n".join(lines) + "\n"
    check = rulebook.validate(text, BY_ID, set(regions.items), set(cube.vars))
    (data / "discoveries" / "candidates.yaml").write_text(text)
    print(f"candidates: {len(chosen)}, valid: {check['ok']} {'' if check['ok'] else check['errors'][:3]}")


if __name__ == "__main__":
    sys.exit(main())
