"""Checks a rules file before it is sent to the server. The validator is the one the server uses
(backend/app/rules.py), so a file that passes here passes there.

    python tools/check_rules.py rules/rules.yaml
    python tools/check_rules.py my_rules.yaml --regions https://example.com --login LOGIN:PASSWORD   # also checks territory codes

Without --regions the territory codes are not verified (variable names always are).
Exit code 0: the file is valid; 1: it has errors.
"""

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import rules
from backend.app.catalog import BY_ID


class AnyRegion(set):
    """Accepts every territory code (used when the list of territories is not available offline)."""

    def __contains__(self, item) -> bool:
        return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("--login", help="логин:пароль команды, если сайт закрыт")
    ap.add_argument(
        "--regions", help="site URL to verify territory codes against (asks for a login if the site is closed)"
    )
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    regions: set = AnyRegion()
    if args.regions:
        req = urllib.request.Request(args.regions.rstrip("/") + "/api/region-ids")  # noqa: S310
        if args.login:
            req.add_header("Authorization", "Basic " + base64.b64encode(args.login.encode()).decode())
        try:
            with urllib.request.urlopen(req, timeout=60) as r:  # address given by whoever runs it  # noqa: S310  # nosemgrep  # nosec B310
                regions = set(json.load(r)["ids"])
        except urllib.error.HTTPError as e:
            sys.exit(
                f"не удалось получить список территорий: HTTP {e.code}"
                + (" (нужен --login логин:пароль)" if e.code == 401 else "")
            )
    res = rules.validate(args.file.read_text(encoding="utf-8"), BY_ID, regions)
    for w in res["warnings"]:
        print("предупреждение:", w)
    for e in res["errors"]:
        print("ОШИБКА:", e)
    if res["ok"]:
        print(f"OK: правил {len(res['rules'])}")
        for r in res["rules"]:
            chain = "; ".join(f"{l['from']} {l['sign']}> {l['to']}" for l in r["links"])
            print(f"  {r['id']}: {chain}")
        if not args.regions:
            print("коды территорий не проверялись (нет --regions); сервер проверит их при загрузке")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
