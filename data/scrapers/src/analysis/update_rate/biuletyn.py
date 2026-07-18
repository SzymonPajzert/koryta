#!/usr/bin/env python
"""
Analysis of KRS update detection success rate.

For each KRS that was scraped via rejestr.io (krs-powiazania), this script:
1. Finds the first scrape date (before an update)
2. Finds the KRS bulletin update date
3. Finds the re-scrape date (after the update)
4. Compares the actual rejestr.io API responses to see if there was a real change
"""

import json
from collections import defaultdict
from pathlib import Path

import pandas as pd

# ─── Configuration ───────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
DOWNLOADED_DIR = PROJECT_ROOT / "downloaded"
VERSIONED_DIR = PROJECT_ROOT / "versioned"

METHODS_OF_INTEREST = [
    "rejestrio_org_krs_powiazania_aktualne",
    "rejestrio_org_krs_powiazania_historyczne",
]


def cached_filename(krs: str, method: str, date: str) -> str:
    """Reconstruct the local cache filename for a rejestr.io org connection query."""
    # From the GCS path:
    #   hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania/?aktualnosc={type}/date={date}
    # Local filename (dots replace slashes):
    #   hostname=rejestr.io.api.v2.org.{krs}.krs-powiazania.aktualnosc_{type}.date={date}
    if method == "rejestrio_org_krs_powiazania_aktualne":
        aktualnosc = "aktualnosc_aktualne"
    elif method == "rejestrio_org_krs_powiazania_historyczne":
        aktualnosc = "aktualnosc_historyczne"
    else:
        raise ValueError(f"Unknown method: {method}")

    return (
        f"hostname=rejestr.io.api.v2.org.{krs}.krs-powiazania.{aktualnosc}.date={date}"
    )


def read_cached_file(krs: str, method: str, date: str) -> str | None:
    """Read the cached rejestr.io response for a given KRS, method, and date."""
    filename = cached_filename(krs, method, date)
    filepath = DOWNLOADED_DIR / filename
    if not filepath.exists():
        return None
    return filepath.read_text(encoding="utf-8", errors="replace")


def normalize_json(content: str) -> str | None:
    """Parse JSON and re-serialize in a canonical form for comparison."""
    try:
        data = json.loads(content)
        return json.dumps(data, sort_keys=True, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return None


def extract_people_set(content: str) -> set[tuple] | None:
    """Extract a set of (id, imiona_i_nazwisko) from a rejestr.io connection response.

    This allows us to detect structural changes (people added/removed)
    rather than cosmetic JSON differences.
    """
    try:
        data = json.loads(content)
        people = set()
        for item in data:
            if isinstance(item, dict):
                item_id = item.get("id", "")
                identity = item.get("tozsamosc", {})
                name = (
                    identity.get("imiona_i_nazwisko", "")
                    if isinstance(identity, dict)
                    else ""
                )
                item_type = item.get("typ", "")
                people.add((str(item_id), str(name), str(item_type)))
        return people
    except (json.JSONDecodeError, TypeError):
        return None


def main():
    print("=" * 80)
    print("KRS Update Detection Success Rate Analysis")
    print("=" * 80)

    # ─── Load data ────────────────────────────────────────────────────────

    print("\n1. Loading data...")

    scraped_df = pd.read_json(
        VERSIONED_DIR / "krs_already_scraped" / "krs_already_scraped.jsonl",
        lines=True,
        dtype={"krs": str},
    )
    scraped_df["date"] = scraped_df["date"].astype(str)
    print(
        f"   krs_already_scraped: {len(scraped_df)} records, {scraped_df['krs'].nunique()} unique KRS"
    )

    updates_df = pd.read_json(
        VERSIONED_DIR / "krs_updates" / "krs_updates.jsonl",
        lines=True,
        dtype={"krs": str},
    )
    updates_df["date"] = updates_df["date"].astype(str)
    # Normalize KRS to 10-digit zero-padded
    updates_df["krs"] = updates_df["krs"].str.zfill(10)
    print(
        f"   krs_updates: {len(updates_df)} records, {updates_df['krs'].nunique()} unique KRS"
    )

    # ─── Filter to connection methods only ────────────────────────────────

    conn_scraped = scraped_df[scraped_df["method"].isin(METHODS_OF_INTEREST)].copy()
    print("\n2. Filtering to connection methods...")
    print(f"   Connection scrapes: {len(conn_scraped)} records")
    print(f"   Unique KRS with connection scrapes: {conn_scraped['krs'].nunique()}")
    print("   Method breakdown:")
    for method, count in conn_scraped["method"].value_counts().items():
        print(f"     {method}: {count}")

    # ─── Build per-KRS, per-method scrape date lists ──────────────────────

    print("\n3. Building scrape date index...")
    scrape_dates: dict[tuple[str, str], list[str]] = defaultdict(list)
    for _, row in conn_scraped.iterrows():
        key = (row["krs"], row["method"])
        scrape_dates[key].append(row["date"])

    # Sort dates
    for key, value in scrape_dates.items():
        scrape_dates[key] = sorted(set(value))

    multi_scrape = {k: v for k, v in scrape_dates.items() if len(v) >= 2}
    print(f"   KRS+method pairs with >= 2 scrape dates: {len(multi_scrape)}")

    # ─── Build per-KRS update date index ──────────────────────────────────

    print("\n4. Building update date index...")
    update_dates: dict[str, list[str]] = defaultdict(list)
    for _, row in updates_df.iterrows():
        update_dates[row["krs"]].append(row["date"])

    for key, value in update_dates.items():
        update_dates[key] = sorted(set(value))

    print(f"   KRS entries with updates: {len(update_dates)}")

    # ─── Find triplets ────────────────────────────────────────────────────

    print("\n5. Finding triplets (before_scrape, update, after_scrape)...")

    triplets = []
    for (krs, method), dates in multi_scrape.items():
        krs_updates = update_dates.get(krs, [])
        if not krs_updates:
            continue

        # For each consecutive pair of scrape dates, check if there's an update between them
        for i in range(len(dates) - 1):
            before_date = dates[i]
            after_date = dates[i + 1]

            # Find updates that happened between before_date and after_date (inclusive)
            updates_between = [u for u in krs_updates if before_date < u <= after_date]

            if updates_between:
                # Use the first update date
                triplets.append(
                    {
                        "krs": krs,
                        "method": method,
                        "before_date": before_date,
                        "update_date": updates_between[0],
                        "after_date": after_date,
                        "n_updates_between": len(updates_between),
                    }
                )

    triplets_df = pd.DataFrame(triplets)
    print(f"   Found {len(triplets_df)} triplets")

    if triplets_df.empty:
        print("   No triplets found! Cannot perform analysis.")
        return

    print(f"   Unique KRS in triplets: {triplets_df['krs'].nunique()}")
    print("   Method breakdown:")
    for method, count in triplets_df["method"].value_counts().items():
        print(f"     {method}: {count}")

    # ─── Compare actual content ───────────────────────────────────────────

    print("\n6. Comparing actual rejestr.io responses...")

    results = []
    missing_before = 0
    missing_after = 0

    for _, triplet in triplets_df.iterrows():
        krs = triplet["krs"]
        method = triplet["method"]
        before_date = triplet["before_date"]
        after_date = triplet["after_date"]

        before_content = read_cached_file(krs, method, before_date)
        after_content = read_cached_file(krs, method, after_date)

        if before_content is None:
            missing_before += 1
            continue
        if after_content is None:
            missing_after += 1
            continue

        # Compare raw content
        raw_identical = before_content == after_content

        # Compare normalized JSON
        before_json = normalize_json(before_content)
        after_json = normalize_json(after_content)
        json_identical = (
            before_json == after_json if (before_json and after_json) else None
        )

        # Compare people/entity sets (structural comparison)
        before_people = extract_people_set(before_content)
        after_people = extract_people_set(after_content)
        if before_people is not None and after_people is not None:
            people_identical = before_people == after_people
            people_added = after_people - before_people
            people_removed = before_people - after_people
        else:
            people_identical = None
            people_added = set()
            people_removed = set()

        # Check if before or after is empty content (error response)
        before_empty = before_content.strip() == "" or before_content.strip() == "[]"
        after_empty = after_content.strip() == "" or after_content.strip() == "[]"

        # Calculate delay between update and re-scrape
        update_to_rescrape_days = (
            pd.Timestamp(after_date) - pd.Timestamp(triplet["update_date"])
        ).days

        results.append(
            {
                "krs": krs,
                "method": method,
                "before_date": before_date,
                "update_date": triplet["update_date"],
                "after_date": after_date,
                "update_to_rescrape_days": update_to_rescrape_days,
                "raw_identical": raw_identical,
                "json_identical": json_identical,
                "people_identical": people_identical,
                "n_people_added": len(people_added),
                "n_people_removed": len(people_removed),
                "before_empty": before_empty,
                "after_empty": after_empty,
                "n_updates_between": triplet["n_updates_between"],
            }
        )

    results_df = pd.DataFrame(results)

    print(f"\n   Triplets with both files available: {len(results_df)}")
    print(f"   Missing before file: {missing_before}")
    print(f"   Missing after file: {missing_after}")

    if results_df.empty:
        print("   No results to analyze!")
        return

    # ─── Analysis ─────────────────────────────────────────────────────────

    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)

    total = len(results_df)

    # Overall success rate (content actually changed)
    changed_raw = (~results_df["raw_identical"]).sum()
    changed_json = results_df["json_identical"].apply(lambda x: x is False).sum()
    changed_people = results_df["people_identical"].apply(lambda x: x is False).sum()

    print("\n--- Overall Change Detection Rate ---")
    print(f"Total triplets analyzed: {total}")
    print(
        f"Raw content changed:        \
            {changed_raw}/{total} ({100 * changed_raw / total:.1f}%)"
    )
    print(
        f"JSON content changed:       \
            {changed_json}/{total} ({100 * changed_json / total:.1f}%)"
    )
    print(
        f"People/entities changed:    \
            {changed_people}/{total} ({100 * changed_people / total:.1f}%)"
    )

    # Breakdown: what kind of changes
    unchanged = results_df["people_identical"] == True
    print(f"\n--- Among unchanged triplets ({unchanged.sum()}) ---")
    if unchanged.sum() > 0:
        unchanged_df = results_df[unchanged]
        raw_same = unchanged_df["raw_identical"].sum()
        raw_diff = (~unchanged_df["raw_identical"]).sum()
        print(f"  Raw content also identical: {raw_same}")
        print(f"  Raw content differs (cosmetic): {raw_diff}")

    changed_mask = results_df["people_identical"] == False
    print(f"\n--- Among changed triplets ({changed_mask.sum()}) ---")
    if changed_mask.sum() > 0:
        changed_df = results_df[changed_mask]
        print(f"  Avg people added: {changed_df['n_people_added'].mean():.2f}")
        print(f"  Avg people removed: {changed_df['n_people_removed'].mean():.2f}")
        print(f"  Max people added: {changed_df['n_people_added'].max()}")
        print(f"  Max people removed: {changed_df['n_people_removed'].max()}")

    # Breakdown by method
    print(f"\n--- By Method ---")
    for method in METHODS_OF_INTEREST:
        method_df = results_df[results_df["method"] == method]
        if len(method_df) == 0:
            continue
        n = len(method_df)
        ppl_changed = (method_df["people_identical"] == False).sum()
        print(f"  {method}:")
        print(f"    Total: {n}, Changed: {ppl_changed} ({100 * ppl_changed / n:.1f}%)")

    # Delay analysis
    print(f"\n--- Delay Analysis (update → re-scrape) ---")
    print(f"  Mean delay: {results_df['update_to_rescrape_days'].mean():.1f} days")
    print(f"  Median delay: {results_df['update_to_rescrape_days'].median():.1f} days")
    print(f"  Min delay: {results_df['update_to_rescrape_days'].min()} days")
    print(f"  Max delay: {results_df['update_to_rescrape_days'].max()} days")

    # Is delay correlated with change detection?
    print(f"\n--- Delay vs Change Detection ---")
    for bucket_label, lo, hi in [
        ("0 days (same day)", 0, 0),
        ("1-3 days", 1, 3),
        ("4-7 days", 4, 7),
        ("8-14 days", 8, 14),
        ("15-30 days", 15, 30),
        ("31+ days", 31, 9999),
    ]:
        mask = (results_df["update_to_rescrape_days"] >= lo) & (
            results_df["update_to_rescrape_days"] <= hi
        )
        bucket_df = results_df[mask]
        if len(bucket_df) == 0:
            continue
        n = len(bucket_df)
        ppl_changed = (bucket_df["people_identical"] == False).sum()
        print(
            f"  {bucket_label}: {ppl_changed}/{n} changed ({100 * ppl_changed / n:.1f}%)"
        )

    # Empty responses analysis
    print(f"\n--- Empty Responses ---")
    both_empty = (results_df["before_empty"] & results_df["after_empty"]).sum()
    before_only_empty = (results_df["before_empty"] & ~results_df["after_empty"]).sum()
    after_only_empty = (~results_df["before_empty"] & results_df["after_empty"]).sum()
    neither_empty = (~results_df["before_empty"] & ~results_df["after_empty"]).sum()
    print(f"  Both empty: {both_empty}")
    print(f"  Only before empty: {before_only_empty}")
    print(f"  Only after empty: {after_only_empty}")
    print(f"  Neither empty: {neither_empty}")

    # Also look at cases WITHOUT an update between scrapes for baseline comparison
    print("\n" + "=" * 80)
    print("BASELINE: Consecutive scrapes WITHOUT updates between them")
    print("=" * 80)

    no_update_results = []
    for (krs, method), dates in multi_scrape.items():
        krs_updates = update_dates.get(krs, [])

        for i in range(len(dates) - 1):
            before_date = dates[i]
            after_date = dates[i + 1]

            updates_between = [u for u in krs_updates if before_date < u <= after_date]

            if not updates_between:
                before_content = read_cached_file(krs, method, before_date)
                after_content = read_cached_file(krs, method, after_date)
                if before_content is None or after_content is None:
                    continue

                before_people = extract_people_set(before_content)
                after_people = extract_people_set(after_content)
                if before_people is not None and after_people is not None:
                    no_update_results.append(
                        {
                            "krs": krs,
                            "method": method,
                            "people_identical": before_people == after_people,
                        }
                    )

    if no_update_results:
        no_update_df = pd.DataFrame(no_update_results)
        n = len(no_update_df)
        changed = (no_update_df["people_identical"] == False).sum()
        print(f"  Total pairs without updates: {n}")
        print(f"  Changed anyway: {changed}/{n} ({100 * changed / n:.1f}%)")
        print(
            f"  (This is the 'false positive' baseline - changes without KRS bulletin)"
        )

    # ─── Summary ──────────────────────────────────────────────────────────

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"""
The analysis found {len(triplets_df)} triplets where:
  1. A KRS was scraped via rejestr.io
  2. A KRS bulletin update was detected
  3. The KRS was re-scraped after the update

Of {total} triplets with both files available:
  - {100 * changed_people / total:.1f}% had actual people/entity changes
  - {100 * (total - changed_people) / total:.1f}% had no structural change (false positives from the bulletin)

This means the KRS bulletin update is a {"good" if changed_people / total > 0.5 else "poor"} predictor
of actual changes in the company connections data.
""")


if __name__ == "__main__":
    main()
