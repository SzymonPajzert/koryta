#!/usr/bin/env python
"""
Analysis of KRS bulletin update detection success rate.

For each KRS that was scraped via rejestr.io (krs-powiazania), this script:
1. Finds the first scrape date (before an update)
2. Finds the KRS bulletin update date
3. Finds the re-scrape date (after the update)
4. Compares the actual rejestr.io API responses to see if there was a real change
"""

import json

import pandas as pd

from analysis.update_rate.shared import (
    METHODS_OF_INTEREST,
    build_scrape_dates,
    build_update_dates,
    extract_rejestrio_people,
    load_already_scraped,
    load_krs_updates,
    make_context,
    read_cached_file,
)


def normalize_json(content: str) -> str | None:
    """Parse JSON and re-serialize in a canonical form."""
    try:
        data = json.loads(content)
        return json.dumps(data, sort_keys=True, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return None


def find_triplets(multi_scrape, update_dates):
    """Find (before_scrape, update, after_scrape) triplets."""
    triplets = []
    for (krs, method), dates in multi_scrape.items():
        krs_updates = update_dates.get(krs, [])
        if not krs_updates:
            continue

        for i in range(len(dates) - 1):
            before_date = dates[i]
            after_date = dates[i + 1]
            updates_between = [
                u for u in krs_updates
                if before_date < u <= after_date
            ]
            if updates_between:
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
    return pd.DataFrame(triplets)


def compare_content(triplets_df):
    """Compare actual rejestr.io responses for each triplet."""
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

        raw_identical = before_content == after_content

        before_json = normalize_json(before_content)
        after_json = normalize_json(after_content)
        json_identical = (
            before_json == after_json
            if (before_json and after_json)
            else None
        )

        before_people = extract_rejestrio_people(before_content)
        after_people = extract_rejestrio_people(after_content)
        if before_people is not None and after_people is not None:
            people_identical = before_people == after_people
            people_added = after_people - before_people
            people_removed = before_people - after_people
        else:
            people_identical = None
            people_added = set()
            people_removed = set()

        before_empty = before_content.strip() in ("", "[]")
        after_empty = after_content.strip() in ("", "[]")

        update_to_rescrape_days = (
            pd.Timestamp(after_date)
            - pd.Timestamp(triplet["update_date"])
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

    return pd.DataFrame(results), missing_before, missing_after


def print_results(results_df, triplets_df, multi_scrape, update_dates):
    """Print analysis results."""
    total = len(results_df)

    changed_raw = (~results_df["raw_identical"]).sum()
    changed_json = (
        results_df["json_identical"]
        .apply(lambda x: x is False)
        .sum()
    )
    changed_people = (
        results_df["people_identical"]
        .apply(lambda x: x is False)
        .sum()
    )

    print("\n--- Overall Change Detection Rate ---")
    print(f"Total triplets analyzed: {total}")
    pct_raw = 100 * changed_raw / total
    pct_json = 100 * changed_json / total
    pct_ppl = 100 * changed_people / total
    print(f"Raw content changed:        {changed_raw}/{total} ({pct_raw:.1f}%)")
    print(f"JSON content changed:       {changed_json}/{total} ({pct_json:.1f}%)")
    print(f"People/entities changed:    {changed_people}/{total} ({pct_ppl:.1f}%)")

    # Breakdown: what kind of changes
    unchanged = results_df["people_identical"] == True  # noqa: E712
    print(f"\n--- Among unchanged triplets ({unchanged.sum()}) ---")
    if unchanged.sum() > 0:
        unchanged_df = results_df[unchanged]
        raw_same = unchanged_df["raw_identical"].sum()
        raw_diff = (~unchanged_df["raw_identical"]).sum()
        print(f"  Raw content also identical: {raw_same}")
        print(f"  Raw content differs (cosmetic): {raw_diff}")

    changed_mask = results_df["people_identical"] == False  # noqa: E712
    print(f"\n--- Among changed triplets ({changed_mask.sum()}) ---")
    if changed_mask.sum() > 0:
        changed_df = results_df[changed_mask]
        print(f"  Avg people added: {changed_df['n_people_added'].mean():.2f}")
        print(f"  Avg people removed: {changed_df['n_people_removed'].mean():.2f}")
        print(f"  Max people added: {changed_df['n_people_added'].max()}")
        print(f"  Max people removed: {changed_df['n_people_removed'].max()}")

    print("\n--- By Method ---")
    for method in METHODS_OF_INTEREST:
        method_df = results_df[results_df["method"] == method]
        if len(method_df) == 0:
            continue
        n = len(method_df)
        ppl_ch = (method_df["people_identical"] == False).sum()  # noqa: E712
        pct = 100 * ppl_ch / n
        print(f"  {method}:")
        print(f"    Total: {n}, Changed: {ppl_ch} ({pct:.1f}%)")

    # Delay analysis
    delay_col = results_df["update_to_rescrape_days"]
    print("\n--- Delay Analysis (update → re-scrape) ---")
    print(f"  Mean delay: {delay_col.mean():.1f} days")
    print(f"  Median delay: {delay_col.median():.1f} days")
    print(f"  Min delay: {delay_col.min()} days")
    print(f"  Max delay: {delay_col.max()} days")

    _print_delay_buckets(results_df)
    _print_empty_responses(results_df)
    _print_baseline(multi_scrape, update_dates)
    _print_summary(triplets_df, total, changed_people)


def _print_delay_buckets(results_df):
    """Print delay vs change detection buckets."""
    print("\n--- Delay vs Change Detection ---")
    buckets = [
        ("0 days (same day)", 0, 0),
        ("1-3 days", 1, 3),
        ("4-7 days", 4, 7),
        ("8-14 days", 8, 14),
        ("15-30 days", 15, 30),
        ("31+ days", 31, 9999),
    ]
    for label, lo, hi in buckets:
        mask = (
            (results_df["update_to_rescrape_days"] >= lo)
            & (results_df["update_to_rescrape_days"] <= hi)
        )
        bucket_df = results_df[mask]
        if len(bucket_df) == 0:
            continue
        n = len(bucket_df)
        ppl_ch = (bucket_df["people_identical"] == False).sum()  # noqa: E712
        pct = 100 * ppl_ch / n
        print(f"  {label}: {ppl_ch}/{n} changed ({pct:.1f}%)")


def _print_empty_responses(results_df):
    """Print empty response analysis."""
    print("\n--- Empty Responses ---")
    both = (results_df["before_empty"] & results_df["after_empty"]).sum()
    only_before = (results_df["before_empty"] & ~results_df["after_empty"]).sum()
    only_after = (~results_df["before_empty"] & results_df["after_empty"]).sum()
    neither = (~results_df["before_empty"] & ~results_df["after_empty"]).sum()
    print(f"  Both empty: {both}")
    print(f"  Only before empty: {only_before}")
    print(f"  Only after empty: {only_after}")
    print(f"  Neither empty: {neither}")


def _print_baseline(multi_scrape, update_dates):
    """Print baseline: consecutive scrapes without updates."""
    print("\n" + "=" * 80)
    print("BASELINE: Consecutive scrapes WITHOUT updates between them")
    print("=" * 80)

    no_update_results = []
    for (krs, method), dates in multi_scrape.items():
        krs_updates = update_dates.get(krs, [])
        for i in range(len(dates) - 1):
            before_date = dates[i]
            after_date = dates[i + 1]
            updates_between = [
                u for u in krs_updates
                if before_date < u <= after_date
            ]
            if not updates_between:
                before_content = read_cached_file(krs, method, before_date)
                after_content = read_cached_file(krs, method, after_date)
                if before_content is None or after_content is None:
                    continue
                before_people = extract_rejestrio_people(before_content)
                after_people = extract_rejestrio_people(after_content)
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
        changed = (
            no_update_df["people_identical"] == False  # noqa: E712
        ).sum()
        pct = 100 * changed / n
        print(f"  Total pairs without updates: {n}")
        print(f"  Changed anyway: {changed}/{n} ({pct:.1f}%)")
        print(
            "  (This is the 'false positive' baseline"
            " - changes without KRS bulletin)"
        )


def _print_summary(triplets_df, total, changed_people):
    """Print final summary."""
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    pct_changed = 100 * changed_people / total
    pct_unchanged = 100 * (total - changed_people) / total
    quality = "good" if changed_people / total > 0.5 else "poor"
    print(
        f"\nThe analysis found {len(triplets_df)} triplets where:\n"
        f"  1. A KRS was scraped via rejestr.io\n"
        f"  2. A KRS bulletin update was detected\n"
        f"  3. The KRS was re-scraped after the update\n"
        f"\n"
        f"Of {total} triplets with both files available:\n"
        f"  - {pct_changed:.1f}% had actual people/entity changes\n"
        f"  - {pct_unchanged:.1f}% had no structural change"
        f" (false positives from the bulletin)\n"
        f"\n"
        f"This means the KRS bulletin update is a {quality}"
        f" predictor of actual changes in the company"
        f" connections data.\n"
    )


def main():
    print("=" * 80)
    print("KRS Bulletin Update Detection Success Rate Analysis")
    print("=" * 80)

    # ─── Load data ──────────────────────────────────────────

    print("\n1. Loading data...")
    ctx = make_context()

    scraped_df = load_already_scraped(ctx)
    n_krs = scraped_df["krs"].nunique()
    print(f"   krs_already_scraped: {len(scraped_df)} records, {n_krs} unique KRS")

    updates_df = load_krs_updates(ctx)
    n_upd_krs = updates_df["krs"].nunique()
    print(f"   krs_updates: {len(updates_df)} records, {n_upd_krs} unique KRS")

    # ─── Filter to connection methods only ──────────────────

    conn_scraped = scraped_df[
        scraped_df["method"].isin(METHODS_OF_INTEREST)
    ].copy()
    print("\n2. Filtering to connection methods...")
    print(f"   Connection scrapes: {len(conn_scraped)} records")
    n_conn = conn_scraped["krs"].nunique()
    print(f"   Unique KRS with connection scrapes: {n_conn}")
    print("   Method breakdown:")
    for method, count in conn_scraped["method"].value_counts().items():
        print(f"     {method}: {count}")

    # ─── Build indices ──────────────────────────────────────

    print("\n3. Building scrape date index...")
    scrape_dates = build_scrape_dates(scraped_df, METHODS_OF_INTEREST)
    multi_scrape = {
        k: v for k, v in scrape_dates.items() if len(v) >= 2
    }
    print(f"   KRS+method pairs with >= 2 scrape dates: {len(multi_scrape)}")

    print("\n4. Building update date index...")
    update_dates = build_update_dates(updates_df)
    print(f"   KRS entries with updates: {len(update_dates)}")

    # ─── Find triplets ──────────────────────────────────────

    print("\n5. Finding triplets (before_scrape, update, after_scrape)...")
    triplets_df = find_triplets(multi_scrape, update_dates)
    print(f"   Found {len(triplets_df)} triplets")

    if triplets_df.empty:
        print("   No triplets found! Cannot perform analysis.")
        return

    n_tri_krs = triplets_df["krs"].nunique()
    print(f"   Unique KRS in triplets: {n_tri_krs}")
    print("   Method breakdown:")
    for method, count in triplets_df["method"].value_counts().items():
        print(f"     {method}: {count}")

    # ─── Compare actual content ─────────────────────────────

    print("\n6. Comparing actual rejestr.io responses...")
    results_df, missing_before, missing_after = compare_content(triplets_df)

    print(f"\n   Triplets with both files available: {len(results_df)}")
    print(f"   Missing before file: {missing_before}")
    print(f"   Missing after file: {missing_after}")

    if results_df.empty:
        print("   No results to analyze!")
        return

    # ─── Analysis ───────────────────────────────────────────

    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)

    print_results(results_df, triplets_df, multi_scrape, update_dates)


if __name__ == "__main__":
    main()
