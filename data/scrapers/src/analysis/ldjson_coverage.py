"""Check how often <script type="application/ld+json"> appears in crawled HTML.

For each domain picks the page with the longest URL path (likely an article)
plus up to 10 random pages, reads them directly from the tar without extracting.

Usage (from repo root):
    python src/analysis/ldjson_coverage.py
    python src/analysis/ldjson_coverage.py --sample  # run only on SAMPLE_DOMAINS
"""

from __future__ import annotations

import argparse
import csv
import random
import re
import tarfile
from pathlib import Path

from tqdm import tqdm

DOWNLOADED_DIR = Path(__file__).parents[2] / "downloaded"
OUTPUT_CSV = Path(__file__).parents[2] / "files" / "ldjson_coverage.csv"
CSV_FIELDS = ["domain", "url", "selection", "has_ldjson", "tar_total_pages"]

SAMPLE_DOMAINS = [
    "wyborcza.pl", "wp.pl", "rp.pl", "polsatnews.pl", "rmf24.pl",
    "tokfm.pl", "bankier.pl", "gazetaprawna.pl", "trojmiasto.pl", "pap.pl",
]

LD_JSON_MARKER = b'type="application/ld+json"'
N_RANDOM = 10


def all_domains() -> list[str]:
    seen: dict[str, Path] = {}
    for tar in DOWNLOADED_DIR.glob("hostname=*.tar.gz"):
        m = re.match(r"hostname=(.+?)\.(?:from=|total\.)", tar.name)
        if m:
            domain = m.group(1)
            # keep latest tar per domain
            if domain not in seen or tar.name > seen[domain].name:
                seen[domain] = tar
    return sorted(seen)


def find_tar(domain: str) -> Path | None:
    candidates = sorted(DOWNLOADED_DIR.glob(f"hostname={domain}.*.tar.gz"))
    return candidates[-1] if candidates else None


def check_domain(domain: str, writer: csv.DictWriter) -> dict:
    tar_path = find_tar(domain)
    if tar_path is None:
        return {"domain": domain, "checked": 0, "with_ldjson": 0, "error": "no tar"}

    try:
        tf_ctx = tarfile.open(tar_path, "r:gz")
    except tarfile.ReadError as e:
        return {"domain": domain, "checked": 0, "with_ldjson": 0, "error": f"bad tar: {e}"}

    with tf_ctx as tf:
        members = [m for m in tf.getmembers() if m.isfile() and m.name != "index.txt"]
        if not members:
            return {"domain": domain, "checked": 0, "with_ldjson": 0, "error": "empty tar"}

        total_pages = len(members)
        longest = max(members, key=lambda m: len(m.name))
        rest = [m for m in members if m is not longest]
        sample = random.sample(rest, min(N_RANDOM, len(rest)))

        hits = 0
        for selection, m in [("longest", longest)] + [("random", s) for s in sample]:
            f = tf.extractfile(m)
            if f is None:
                continue
            found = LD_JSON_MARKER in f.read().lower()
            hits += found
            url = "https://" + m.name.split("/date=")[0]
            writer.writerow({
                "domain": domain,
                "url": url,
                "selection": selection,
                "has_ldjson": found,
                "tar_total_pages": total_pages,
            })

    return {"domain": domain, "checked": len(sample) + 1, "with_ldjson": hits, "error": None}


def print_summary(stats: list[dict]) -> None:
    ok = [s for s in stats if s["error"] is None]
    total_checked = sum(s["checked"] for s in ok)
    total_hits = sum(s["with_ldjson"] for s in ok)

    domains_any = sum(1 for s in ok if s["with_ldjson"] > 0)
    domains_all = sum(1 for s in ok if s["with_ldjson"] == s["checked"] and s["checked"] > 0)
    domains_none = sum(1 for s in ok if s["with_ldjson"] == 0 and s["checked"] > 0)

    print(f"\n{'='*55}")
    print(f"Domains processed:          {len(ok):>6}")
    print(f"Domains with errors:        {len(stats)-len(ok):>6}")
    print(f"Total pages checked:        {total_checked:>6}")
    print(f"Pages with ld+json:         {total_hits:>6}  ({100*total_hits/total_checked:.1f}%)")
    print(f"Domains with ANY ld+json:   {domains_any:>6}  ({100*domains_any/len(ok):.1f}%)")
    print(f"Domains with ALL ld+json:   {domains_all:>6}  ({100*domains_all/len(ok):.1f}%)")
    print(f"Domains with NO ld+json:    {domains_none:>6}  ({100*domains_none/len(ok):.1f}%)")
    print(f"Results saved to:           {OUTPUT_CSV}")


def already_done(csv_path: Path) -> set[str]:
    if not csv_path.exists():
        return set()
    with csv_path.open(encoding="utf-8") as fh:
        return {row["domain"] for row in csv.DictReader(fh)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", action="store_true", help="Run only on SAMPLE_DOMAINS")
    parser.add_argument("--fresh", action="store_true", help="Ignore existing CSV and start over")
    args = parser.parse_args()

    domains = SAMPLE_DOMAINS if args.sample else all_domains()
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    done = set() if args.fresh else already_done(OUTPUT_CSV)
    remaining = [d for d in domains if d not in done]
    mode = "w" if (args.fresh or not done) else "a"

    print(f"Total domains: {len(domains)} | Already done: {len(done)} | Remaining: {len(remaining)}")
    print(f"Writing to {OUTPUT_CSV}  (mode={mode})")

    stats: list[dict] = []

    with OUTPUT_CSV.open(mode, newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        if mode == "w":
            writer.writeheader()

        bar = tqdm(remaining, unit="domain", dynamic_ncols=True)
        for domain in bar:
            bar.set_postfix_str(domain[:35])
            result = check_domain(domain, writer)
            stats.append(result)
            fh.flush()

    print_summary(stats)


if __name__ == "__main__":
    main()
