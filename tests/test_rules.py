"""The rules validator must accept the shipped file and refuse every kind of garbage with a clear reason."""

from pathlib import Path

import numpy as np
import pytest

from backend.app import rules
from backend.app.catalog import BY_ID

from backend.app.regions import OCEANS

REGIONS = {"IND", "DEU", "BRA", "global"} | {o[0] for o in OCEANS}
GOOD = """
version: 1
rules:
  - id: aerosol_dimming
    name: {en: More aerosol less sunlight, ru: Больше аэрозоля меньше света}
    links:
      - {from: aod, to: sw_down, sign: "-", max_lag: 1}
      - {from: sw_down, to: t2m_max, sign: "+"}
    territories: [IND, DEU]
"""


def check(text, loaded=None):
    return rules.validate(text, BY_ID, REGIONS, loaded)


def test_shipped_file_is_valid():
    text = (Path(__file__).resolve().parents[1] / "rules" / "rules.yaml").read_text(encoding="utf-8")
    res = rules.validate(text, BY_ID, REGIONS)
    assert res["ok"], res["errors"]
    assert len(res["rules"]) >= 3


def test_good_document_is_normalized():
    res = check(GOOD)
    assert res["ok"], res["errors"]
    rule = res["rules"][0]
    assert rule["links"][1]["max_lag"] == rules.DEFAULT_MAX_LAG  # default filled in
    assert rule["name"] == {"en": "More aerosol less sunlight", "ru": "Больше аэрозоля меньше света"}
    assert rule["territories"] == ["IND", "DEU"]


BAD = {
    "empty": ("", "пуст"),
    "not yaml": ("version: 1\nrules: [", "не корректный YAML"),
    "list at top": ("- a\n- b\n", "верхний уровень"),
    "wrong version": (GOOD.replace("version: 1", "version: 2"), "version"),
    "unknown top key": (GOOD + "extra: 1\n", "неизвестный ключ верхнего уровня"),
    "no rules": ("version: 1\nrules: []\n", "непустой список"),
    "bad id": (GOOD.replace("id: aerosol_dimming", "id: Aerosol-Dimming"), ".id"),
    "unknown rule key": (
        GOOD.replace("    territories:", "    script: rm\n    territories:"),
        "неизвестный ключ «script»",
    ),
    "unknown variable": (GOOD.replace("from: aod", "from: unicorns"), "неизвестная переменная «unicorns»"),
    "sign as word": (GOOD.replace('sign: "-"', "sign: minus"), ".sign"),
    "sign unquoted minus": (GOOD.replace('sign: "-", max_lag: 1', "sign: -1"), ".sign"),
    "lag too long": (GOOD.replace("max_lag: 1", "max_lag: 24"), ".max_lag"),
    "lag not a number": (GOOD.replace("max_lag: 1", "max_lag: soon"), ".max_lag"),
    "self link": (GOOD.replace('to: sw_down, sign: "-"', 'to: aod, sign: "-"'), "совпадают"),
    "duplicate pair": (GOOD.replace("{from: sw_down, to: t2m_max", "{from: sw_down, to: aod"), "уже есть"),
    "unknown territory": (GOOD.replace("[IND, DEU]", "[IND, ATLANTIS]"), "неизвестная территория «ATLANTIS»"),
    "territories as number": (GOOD.replace("[IND, DEU]", "42"), ".territories"),
    "markup in name": (GOOD.replace("More aerosol less sunlight", "<script>alert(1)</script>"), "недопустимые символы"),
    "no name": (
        GOOD.replace("    name: {en: More aerosol less sunlight, ru: Больше аэрозоля меньше света}\n", ""),
        ".name",
    ),
    "no links": (GOOD.split("    links:")[0] + "    territories: [IND]\n", ".links"),
    "start year out of range": (GOOD + "    start_year: 1850\n", ".start_year"),
    "anchors": (
        "version: 1\nrules:\n  - &a {id: abc, name: x, links: [{from: aod, to: sw_down, sign: '-'}]}\n  - *a\n",
        "якоря",
    ),
    "duplicate key": (GOOD.replace("    territories:", "    id: other_id\n    territories:"), "повторяющийся ключ"),
    "python object": ("version: 1\nrules: !!python/object/apply:os.system ['echo hi']\n", "не корректный YAML"),
}


@pytest.mark.parametrize("case", BAD)
def test_garbage_is_refused_with_a_reason(case):
    text, fragment = BAD[case]
    res = check(text)
    assert not res["ok"], f"{case}: accepted"
    assert any(fragment in e for e in res["errors"]), f"{case}: expected «{fragment}» in {res['errors']}"


def test_duplicate_rule_ids_and_size_limits():
    two = GOOD + GOOD.split("rules:\n")[1]
    assert any("повторяется" in e for e in check(two)["errors"])
    assert any("больше" in e for e in check("# " + "x" * (rules.MAX_BYTES + 10))["errors"])
    many = "version: 1\nrules:\n" + "".join(
        f"  - {{id: rule_{i}, name: n, links: [{{from: aod, to: sw_down, sign: '-'}}]}}\n"
        for i in range(rules.MAX_RULES + 1)
    )
    assert any("не больше" in e for e in check(many)["errors"])


def test_variable_not_loaded_is_a_warning_not_an_error():
    res = check(GOOD, loaded={"aod", "sw_down"})
    assert res["ok"] and any("t2m_max" in w for w in res["warnings"])


def test_evaluate_marks_confirmed_contradicted_and_unproven():
    rng = np.random.default_rng(3)
    n = 30 * 12
    year, month = 1995 + np.arange(n) // 12, np.arange(n) % 12 + 1
    base = {rid: rng.normal(0, 1, n) for rid in ("GOOD", "OPPOSITE", "NOISE")}
    series = {
        ("aod", "GOOD"): base["GOOD"],
        ("sw_down", "GOOD"): -0.8 * base["GOOD"] + rng.normal(0, 0.5, n),
        ("aod", "OPPOSITE"): base["OPPOSITE"],
        ("sw_down", "OPPOSITE"): 0.8 * base["OPPOSITE"] + rng.normal(0, 0.5, n),
        ("aod", "NOISE"): base["NOISE"],
        ("sw_down", "NOISE"): rng.normal(0, 1, n),
    }
    rule = {"id": "t", "links": [{"from": "aod", "to": "sw_down", "sign": "-", "max_lag": 1}], "start_year": None}

    def pair(a, b, rid, y0):
        return series[(a, rid)], series[(b, rid)], year, month

    def single(v, rid, y0):
        return series[(v, rid)], year, month

    res = rules.evaluate(rule, ["GOOD", "OPPOSITE", "NOISE"], pair, single)
    status = {r["region_id"]: r["status"] for r in res["territories"]}
    assert status == {"GOOD": "confirmed", "OPPOSITE": "contradicted", "NOISE": "not_confirmed"}
    assert res["counts"]["confirmed"] == 1 and res["n_tests"] == 3


def test_oceans_is_a_territory_set():
    res = check(GOOD.replace("[IND, DEU]", "oceans"))
    assert res["ok"], res["errors"]
    assert res["rules"][0]["territories"] == "oceans"
