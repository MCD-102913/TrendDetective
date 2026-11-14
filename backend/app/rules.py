"""Hypotheses ("rules"): expert statements of the form "A drives B, B drives C" that the tool checks
against the data for every territory. Format and submission procedure: docs/RULES.md.

    validate(text, known_variables, known_regions)  strict check of a YAML document; nothing is saved
                                                    or evaluated unless it returns no errors
    RuleStore                                       current file, atomic save with history
    evaluate(rule, ...)                             per territory: is every link proven with the expected sign?

A rule never contains code: it is data (variable ids, signs, lags, territory ids). The statistics are
the same as everywhere else in the tool (backend/app/trend.py).
"""

from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

import numpy as np
import yaml

from . import trend

FORMAT_VERSION = 1
MAX_BYTES = 64 * 1024
MAX_RULES = 40
MAX_LINKS = 6
MAX_TERRITORIES = 300
MAX_LAG = trend.MAX_LAG
DEFAULT_MAX_LAG = 3
LAG_TOLERANCE = 1  # monthly means smear timing: the effect may appear to lead by one month
ID_RE = re.compile(r"^[a-z][a-z0-9_]{2,39}$")
TOP_KEYS = {"version", "rules"}
RULE_KEYS = {"id", "name", "description", "author", "source", "links", "territories", "start_year"}
LINK_KEYS = {"from", "to", "sign", "max_lag", "note"}
TEXT_LIMITS = {"name": 120, "description": 600, "author": 80, "source": 200, "note": 200}
FORBIDDEN_TEXT = re.compile(r"[<>{}\x00-\x08\x0b\x0c\x0e-\x1f]")  # no markup, no control characters


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that also refuses duplicate keys (PyYAML silently keeps the last one)."""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise yaml.constructor.ConstructorError(None, None, f"повторяющийся ключ «{key}»", key_node.start_mark)
            seen.add(key)
        return super().construct_mapping(node, deep)


def _text(value, path: str, limit: int, errors: list[str], required: bool = False):
    """A text field: a string, or {en: ..., ru: ...}.

    Returns {en, ru} or None.
    """
    if value is None:
        if required:
            errors.append(f"{path}: обязательное поле")
        return None
    if isinstance(value, str):
        value = {"en": value, "ru": value}
    if not isinstance(value, dict) or set(value) - {"en", "ru"} or not value:
        errors.append(f"{path}: должна быть строка или пара {{en: ..., ru: ...}}")
        return None
    out = {}
    for lang in ("en", "ru"):
        s = value.get(lang, value.get("en") or value.get("ru"))
        if not isinstance(s, str) or not s.strip():
            errors.append(f"{path}.{lang}: пустой текст")
            continue
        s = s.strip()
        if len(s) > limit:
            errors.append(f"{path}.{lang}: длиннее {limit} символов ({len(s)})")
        if FORBIDDEN_TEXT.search(s):
            errors.append(f"{path}.{lang}: недопустимые символы (< > {{ }} или управляющие)")
        out[lang] = s
    return out if len(out) == 2 else None


def validate(text: str, variables: dict[str, dict], regions: set[str], loaded: set[str] | None = None) -> dict:
    """Checks a rules document.

    Returns {"ok", "errors", "warnings", "rules"}; `rules` is the normalized list and is only meaningful when ok.
    `variables` is the catalog (id -> entry), `regions` the known territory ids, `loaded` the variables present in the
    cube (None: that check is skipped).
    """
    errors: list[str] = []
    warnings: list[str] = []
    result = {"ok": False, "errors": errors, "warnings": warnings, "rules": []}

    if not isinstance(text, str) or not text.strip():
        errors.append("файл пуст")
        return result
    if len(text.encode("utf-8")) > MAX_BYTES:
        errors.append(f"файл больше {MAX_BYTES // 1024} КБ")
        return result
    if "&" in text and re.search(r"(^|\s)[&*][A-Za-z0-9_]+", text):
        errors.append("якоря и ссылки YAML (&имя, *имя) не разрешены")
        return result
    try:
        doc = yaml.load(text, Loader=_StrictLoader)  # a SafeLoader subclass  # noqa: S506  # nosec B506
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        where = f" (строка {mark.line + 1}, столбец {mark.column + 1})" if mark else ""
        errors.append(f"это не корректный YAML{where}: {getattr(e, 'problem', None) or e}")
        return result
    if not isinstance(doc, dict):
        errors.append("верхний уровень должен быть словарём с ключами version и rules")
        return result
    for k in set(doc) - TOP_KEYS:
        errors.append(f"неизвестный ключ верхнего уровня «{k}» (разрешены: version, rules)")
    if doc.get("version") != FORMAT_VERSION:
        errors.append(f"version: должно быть {FORMAT_VERSION}")
    rules = doc.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("rules: нужен непустой список правил")
        return result
    if len(rules) > MAX_RULES:
        errors.append(f"rules: не больше {MAX_RULES} правил ({len(rules)})")
        return result

    seen_ids: set[str] = set()
    out = []
    for i, rule in enumerate(rules):
        p = f"rules[{i}]"
        if not isinstance(rule, dict):
            errors.append(f"{p}: правило должно быть словарём")
            continue
        rid = rule.get("id")
        if isinstance(rid, str) and ID_RE.match(rid):
            p = f"rules[{i}] ({rid})"
            if rid in seen_ids:
                errors.append(f"{p}: id повторяется")
            seen_ids.add(rid)
        else:
            errors.append(f"{p}.id: латинские строчные буквы, цифры и _, от 3 до 40 знаков, первая буква")
        for k in set(rule) - RULE_KEYS:
            errors.append(f"{p}: неизвестный ключ «{k}» (разрешены: {', '.join(sorted(RULE_KEYS))})")
        name = _text(rule.get("name"), f"{p}.name", TEXT_LIMITS["name"], errors, required=True)
        desc = _text(rule.get("description"), f"{p}.description", TEXT_LIMITS["description"], errors)
        meta = {}
        for k in ("author", "source"):
            v = rule.get(k)
            if v is None:
                continue
            if not isinstance(v, str) or not v.strip() or len(v) > TEXT_LIMITS[k] or FORBIDDEN_TEXT.search(v):
                errors.append(f"{p}.{k}: строка до {TEXT_LIMITS[k]} символов без < > {{ }}")
            else:
                meta[k] = v.strip()

        start_year = rule.get("start_year")
        if start_year is not None and (
            isinstance(start_year, bool) or not isinstance(start_year, int) or not 1980 <= start_year <= 2020
        ):
            errors.append(f"{p}.start_year: целый год от 1980 до 2020")
            start_year = None

        # links
        links = rule.get("links")
        norm_links = []
        if not isinstance(links, list) or not links:
            errors.append(f"{p}.links: нужен непустой список звеньев")
            links = []
        elif len(links) > MAX_LINKS:
            errors.append(f"{p}.links: не больше {MAX_LINKS} звеньев ({len(links)})")
            links = []
        pairs: set[tuple[str, str]] = set()
        for j, link in enumerate(links):
            lp = f"{p}.links[{j}]"
            if not isinstance(link, dict):
                errors.append(f"{lp}: звено должно быть словарём с ключами from, to, sign")
                continue
            for k in set(link) - LINK_KEYS:
                errors.append(f"{lp}: неизвестный ключ «{k}» (разрешены: {', '.join(sorted(LINK_KEYS))})")
            a, b, sign = link.get("from"), link.get("to"), link.get("sign")
            ok = True
            for key, v in (("from", a), ("to", b)):
                if not isinstance(v, str) or v not in variables:
                    errors.append(f"{lp}.{key}: неизвестная переменная «{v}» (список: GET /api/variables)")
                    ok = False
                elif loaded is not None and v not in loaded:
                    warnings.append(
                        f"{lp}.{key}: переменная «{v}» есть в каталоге, но ещё не загружена; звено не будет проверено"
                    )
            if sign not in ("+", "-"):
                errors.append(f'{lp}.sign: нужно "+" (растут вместе) или "-" (одно растёт, другое падает), в кавычках')
                ok = False
            max_lag = link.get("max_lag", DEFAULT_MAX_LAG)
            if isinstance(max_lag, bool) or not isinstance(max_lag, int) or not 0 <= max_lag <= MAX_LAG:
                errors.append(f"{lp}.max_lag: целое число месяцев от 0 до {MAX_LAG}")
                ok = False
            note = None
            if link.get("note") is not None:
                note = _text(link.get("note"), f"{lp}.note", TEXT_LIMITS["note"], errors)
            if ok:
                if a == b:
                    errors.append(f"{lp}: from и to совпадают")
                elif (a, b) in pairs or (b, a) in pairs:
                    errors.append(f"{lp}: пара {a} и {b} уже есть в этом правиле")
                else:
                    pairs.add((a, b))
                    norm_links.append({"from": a, "to": b, "sign": sign, "max_lag": max_lag, "note": note})

        # territories
        terr = rule.get("territories", "countries")
        if terr in ("countries", "all"):
            terr = "countries"
        elif terr == "oceans":
            pass
        elif isinstance(terr, list) and terr and all(isinstance(t, str) for t in terr):
            if len(terr) > MAX_TERRITORIES:
                errors.append(f"{p}.territories: не больше {MAX_TERRITORIES} территорий")
            if len(set(terr)) != len(terr):
                errors.append(f"{p}.territories: есть повторы")
            for t in terr:
                if t not in regions:
                    errors.append(f"{p}.territories: неизвестная территория «{t}» (поиск: GET /api/regions?q=...)")
        else:
            errors.append(
                f"{p}.territories: «countries» (все страны), «oceans» (океанские регионы) или непустой список кодов территорий"
            )
            terr = "countries"

        if isinstance(rid, str) and name and norm_links:
            out.append(
                {
                    "id": rid,
                    "name": name,
                    "description": desc,
                    **meta,
                    "links": norm_links,
                    "territories": terr,
                    "start_year": start_year,
                }
            )

    result["rules"] = out
    result["ok"] = not errors
    return result


# storage
class RuleStore:
    """rules.yaml in the data directory (falls back to the copy shipped with the code).

    Saving is atomic and keeps every previous version in a history folder next to the file.
    """

    def __init__(self, data_dir: Path, default: Path):
        self.dir = data_dir / "rules"
        self.path = self.dir / "rules.yaml"
        self.default = default

    def text(self) -> str:
        return (self.path if self.path.exists() else self.default).read_text(encoding="utf-8")

    def version(self) -> str:
        return hashlib.sha256(self.text().encode("utf-8")).hexdigest()[:12]

    def save(self, text: str, user: str) -> str:
        self.dir.mkdir(parents=True, exist_ok=True)
        hist = self.dir / "history"
        hist.mkdir(exist_ok=True)
        if self.path.exists():
            stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            (hist / f"{stamp}_replaced_by_{re.sub(r'[^a-z0-9]', '', user.lower()) or 'unknown'}.yaml").write_text(
                self.path.read_text(encoding="utf-8"), encoding="utf-8"
            )
        tmp = self.path.with_suffix(".yaml.tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(self.path)
        return self.version()

    def history(self) -> list[str]:
        h = self.dir / "history"
        return sorted((f.name for f in h.glob("*.yaml")), reverse=True)[:30] if h.exists() else []


# evaluation
def evaluate(rule: dict, territories: list[str], pair, single) -> dict:
    """Checks a rule on every territory.

    pair(a, b, rid, start_year) -> (x, y, year, month) on the common months, or None
    single(v, rid, start_year)  -> (y, year, month) or None

    A link is PROVEN on a territory when the two series are linked (trend.relation: season and trend
    removed, effective sample size, lags from -LAG_TOLERANCE to max_lag months, Bonferroni over the lags)
    with the expected sign, and its p-value passes the Benjamini-Hochberg threshold computed over ALL
    territory x link tests of the rule (false discovery rate 5%). A link is CONTRADICTED when it is
    proven with the opposite sign. Trends are reported next to each link: when both ends have a
    significant trend, their signs must agree with the sign of the link.
    Territory status: confirmed (every link proven, no trend disagreement), partial (some proven, none
    contradicted), contradicted (any link has the opposite sign), not_confirmed.
    """
    rows = []
    trends: dict[tuple[str, str], dict | None] = {}

    def trend_of(v: str, rid: str):
        key = (v, rid)
        if key not in trends:
            s = single(v, rid, rule.get("start_year"))
            if s is None:
                trends[key] = None
            else:
                r = trend.analyze(*s)
                trends[key] = {
                    "verdict": r["verdict"],
                    "sign": 0 if "rate" not in r else int(np.sign(r["rate"]["per_decade"])),
                    "significant": r["verdict"].startswith("significant"),
                }
        return trends[key]

    pvals = []
    for rid in territories:
        links = []
        for link in rule["links"]:
            data = pair(link["from"], link["to"], rid, rule.get("start_year"))
            if data is None:
                links.append({"status": "no_data"})
                continue
            rel = trend.relation(*data, lags=(-LAG_TOLERANCE, link["max_lag"]))
            best = rel.get("best")
            if not best:
                links.append({"status": "no_data"})
                continue
            links.append({"r": best["r"], "p": best["p"], "lag": best["lag"], "status": "pending"})
            pvals.append(best["p"])
        rows.append({"region_id": rid, "links": links})

    _, thr = trend.fdr_mask(np.array(pvals, dtype=float)) if pvals else (None, 0.0)
    counts = {"confirmed": 0, "partial": 0, "contradicted": 0, "not_confirmed": 0, "no_data": 0}
    for row in rows:
        rid = row["region_id"]
        n_proven = n_contra = n_data = 0
        trend_conflict = False
        for link, res in zip(rule["links"], row["links"]):
            if res["status"] == "no_data":
                continue
            n_data += 1
            want = 1 if link["sign"] == "+" else -1
            strong = res["p"] <= thr and thr > 0 and abs(res["r"]) >= trend.MIN_LINK_R
            got = int(np.sign(res["r"]))
            res["status"] = "proven" if strong and got == want else "contradicted" if strong else "not_proven"
            n_proven += res["status"] == "proven"
            n_contra += res["status"] == "contradicted"
            ta, tb = trend_of(link["from"], rid), trend_of(link["to"], rid)
            res["trend_from"] = ta and ta["verdict"]
            res["trend_to"] = tb and tb["verdict"]
            if ta and tb and ta["significant"] and tb["significant"]:
                res["trends_agree"] = bool(ta["sign"] * want == tb["sign"])
                trend_conflict |= not res["trends_agree"]
            else:
                res["trends_agree"] = None
        if n_data == 0:
            status = "no_data"
        elif n_contra:
            status = "contradicted"
        elif n_proven == len(rule["links"]) and not trend_conflict:
            status = "confirmed"
        elif n_proven:
            status = "partial"
        else:
            status = "not_confirmed"
        row["status"] = status
        counts[status] += 1
    return {"id": rule["id"], "fdr_p": thr, "n_tests": len(pvals), "counts": counts, "territories": rows}
