"""Resolve a handful of NIPs against the wykaz, to see what it actually returns.

    uv run python src/scripts/nip_lookup_probe.py 6791862817 5730003841
    uv run python src/scripts/nip_lookup_probe.py --raw 6791862817

The daily cap is 100 requests, so this deliberately takes NIPs on the command
line rather than a file: a probe should not be able to spend the budget a real
run needs.
"""

import argparse
import datetime
import json
import urllib.request

from scrapers.krs import nip_lookup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nips", nargs="+", help=f"up to {nip_lookup.MF_BATCH_SIZE}")
    parser.add_argument("--date", help="as-of date, default today")
    parser.add_argument(
        "--raw", action="store_true", help="dump the response keys verbatim"
    )
    args = parser.parse_args()

    date = args.date or datetime.date.today().isoformat()
    nips = [nip_lookup.only_digits(n) for n in args.nips]

    if args.raw:
        url = nip_lookup.MF_SEARCH_URL.format(nips=",".join(nips), date=date)
        request = urllib.request.Request(
            url, headers={"User-Agent": nip_lookup.USER_AGENT}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read())
        result = payload.get("result") or {}
        print(f"result keys: {sorted(result.keys())}")

        def summarise(node, path: str, depth: int = 0) -> None:
            pad = "  " * (depth + 1)
            if isinstance(node, dict):
                print(f"{pad}{path} dict keys: {sorted(node.keys())}")
                for key in ("nip", "krs", "regon", "name", "statusVat"):
                    if key in node:
                        print(f"{pad}  {key}: {node[key]!r}")
                for key in ("subject", "subjects", "representatives"):
                    if node.get(key):
                        summarise(node[key], f"{path}.{key}", depth + 1)
            elif isinstance(node, list):
                print(f"{pad}{path} list of {len(node)}")
                if node:
                    summarise(node[0], f"{path}[0]", depth + 1)

        for key in ("entries", "subjects"):
            if result.get(key):
                summarise(result[key], f"result.{key}")
        return

    results = nip_lookup.resolve(nips, date=date)
    print(f"as of {date}")
    print(f"{'nip':<12} {'krs':<12} {'src':<8} {'vat':<10} name")
    for nip in nips:
        r = results.get(nip)
        if r is None:
            print(f"{nip:<12} {'?':<12} {'unasked':<8}")
            continue
        print(
            f"{r.nip:<12} {r.krs or '-':<12} {r.source:<8} "
            f"{r.vat_status or '-':<10} {(r.name or '')[:44]}"
        )
    found = sum(1 for r in results.values() if r.in_krs)
    print(f"\n{found} of {len(results)} resolved to a KRS number")


if __name__ == "__main__":
    main()
