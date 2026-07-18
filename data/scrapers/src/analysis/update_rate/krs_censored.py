#!/usr/bin/env python
"""
Analysis of KRS update detection success rate using the censored list of people.

This script implements a 4-point analysis:
1. api-krs response about the company (t_api_1)
2. rejestr.io connection response (t_rej_1 >= t_api_1)
3. api-krs response about the same company later with changes in censored list (t_api_2 > t_rej_1)
4. rejestr.io connection response (t_rej_2 >= t_api_2)

We evaluate the success rate and delay of rejestr.io catching up with the change observed in the censored list of people.
"""

import json
import re
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


def extract_censored_people(data: dict) -> set[tuple]:
    """Extract all censored people from an api-krs.ms.gov.pl JSON response.
    Returns a set of tuples: (nazwiskoICzlon, imie, imieDrugie, pesel, role)
    """
    people = set()
    if not isinstance(data, dict) or "odpis" not in data:
        return people

    dane = data["odpis"].get("dane", {})
    if not isinstance(dane, dict):
        return people

    def add_person(p, role=""):
        if not isinstance(p, dict):
            return
        nazwisko = (
            p.get("nazwisko", {}).get("nazwiskoICzlon", "")
            if isinstance(p.get("nazwisko"), dict)
            else ""
        )
        imie = (
            p.get("imiona", {}).get("imie", "")
            if isinstance(p.get("imiona"), dict)
            else ""
        )
        imie2 = (
            p.get("imiona", {}).get("imieDrugie", "")
            if isinstance(p.get("imiona"), dict)
            else ""
        )
        pesel = (
            p.get("identyfikator", {}).get("pesel", "")
            if isinstance(p.get("identyfikator"), dict)
            else ""
        )

        if nazwisko or imie or pesel:
            people.add((nazwisko, imie, imie2, pesel, role))

    # dzial1 -> wspolnicySpzoo
    dzial1 = dane.get("dzial1", {})
    if isinstance(dzial1, dict):
        wspolnicy = dzial1.get("wspolnicySpzoo", [])
        if isinstance(wspolnicy, list):
            for w in wspolnicy:
                add_person(w, role="wspolnik")

    # dzial2
    dzial2 = dane.get("dzial2", {})
    if isinstance(dzial2, dict):
        # reprezentacja
        reprezentacja = dzial2.get("reprezentacja", {})
        if isinstance(reprezentacja, dict):
            sklad = reprezentacja.get("sklad", [])
            if isinstance(sklad, list):
                for p in sklad:
                    funkcja = p.get("funkcjaWOrganie", "") if isinstance(p, dict) else ""
                    add_person(p, role=f"reprezentacja: {funkcja}")

        # organNadzoru
        organ_nadzoru = dzial2.get("organNadzoru", {})
        organs = (
            organ_nadzoru if isinstance(organ_nadzoru, list) else [organ_nadzoru]
        )
        for organ in organs:
            if isinstance(organ, dict):
                sklad = organ.get("sklad", [])
                if isinstance(sklad, list):
                    for p in sklad:
                        funkcja = (
                            p.get("funkcjaWOrganie", "")
                            if isinstance(p, dict)
                            else ""
                        )
                        add_person(p, role=f"nadzor: {funkcja}")

        # prokurenci
        prokurenci = dzial2.get("prokurenci", {})
        if isinstance(prokurenci, dict):
            sklad = prokurenci.get("sklad", [])
            if isinstance(sklad, list):
                for p in sklad:
                    funkcja = (
                        p.get("rodzajProkury", "") if isinstance(p, dict) else ""
                    )
                    add_person(p, role=f"prokurent: {funkcja}")

        # reprezentacjaIBIGBPPSPZOZ
        rep_pzoz = dzial2.get("reprezentacjaIBIGBPPSPZOZ", {})
        if isinstance(rep_pzoz, dict):
            add_person(rep_pzoz, role="kierownik_pzoz")

        # pelnomocnicy
        pelnomocnicy = dzial2.get("pelnomocnicy", [])
        if isinstance(pelnomocnicy, list):
            for p in pelnomocnicy:
                add_person(p, role="pelnomocnik")

        # osobyReprezentujacePZ
        osoby_pz = dzial2.get("osobyReprezentujacePZ", [])
        if isinstance(osoby_pz, list):
            for p in osoby_pz:
                add_person(p, role="osoba_pz")

    return people


def cached_filename(krs: str, method: str, date: str) -> str:
    """Reconstruct the local cache filename for a rejestr.io org connection query."""
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


def extract_people_set(content: str) -> set[tuple] | None:
    """Extract a set of (id, imiona_i_nazwisko) from a rejestr.io connection response."""
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
    print("KRS Censored People Update Detection Success Rate Analysis")
    print("=" * 80)

    # ─── Index api-krs files ──────────────────────────────────────────────

    print("\n1. Indexing api-krs local files...")
    api_krs_files = {}
    krs_pat = re.compile(r"\b\d{10}\b")
    date_pat = re.compile(r"date=(\d{4}-\d{2}-\d{2})")

    for p in DOWNLOADED_DIR.iterdir():
        name = p.name
        if "api-krs.ms.gov.pl" in name and "OdpisAktualny" in name:
            krs_match = krs_pat.search(name)
            date_match = date_pat.search(name)
            if krs_match and date_match:
                krs = krs_match.group(0)
                date = date_match.group(1)
                api_krs_files[(krs, date)] = p

    print(f"   Indexed {len(api_krs_files)} api-krs OdpisAktualny files")

    # ─── Load scraped data ───────────────────────────────────────────────

    print("\n2. Loading scrape log data...")
    scraped_df = pd.read_json(
        VERSIONED_DIR / "krs_already_scraped" / "krs_already_scraped.jsonl",
        lines=True,
        dtype={"krs": str},
    )
    scraped_df["date"] = scraped_df["date"].astype(str)
    print(f"   Total scrape records: {len(scraped_df)}")

    # ─── Build scrape index ──────────────────────────────────────────────

    print("\n3. Building scrape date index per KRS...")
    krs_scrapes = defaultdict(lambda: defaultdict(list))
    for _, row in scraped_df.iterrows():
        krs = row["krs"]
        method = row["method"]
        date = row["date"]
        krs_scrapes[krs][method].append(date)

    # Sort all date lists
    for krs in krs_scrapes:
        for method in krs_scrapes[krs]:
            krs_scrapes[krs][method] = sorted(set(krs_scrapes[krs][method]))

    # ─── Find Quadruplets ────────────────────────────────────────────────

    print("\n4. Finding quadruplets (api_1 -> rej_1 -> api_2 -> rej_2)...")
    quadruplets = []

    for krs, method_dates in krs_scrapes.items():
        api_dates = method_dates.get("api_krs_odpis_aktualny_p", [])
        if not api_dates:
            continue

        for method in METHODS_OF_INTEREST:
            rej_dates = method_dates.get(method, [])
            if not rej_dates:
                continue

            for t_api_1 in api_dates:
                # Find t_rej_1: first rej_date >= t_api_1
                rej_1_candidates = [d for d in rej_dates if d >= t_api_1]
                if not rej_1_candidates:
                    continue
                t_rej_1 = rej_1_candidates[0]

                # Find t_api_2: first api_date > t_rej_1
                api_2_candidates = [d for d in api_dates if d > t_rej_1]
                if not api_2_candidates:
                    continue
                t_api_2 = api_2_candidates[0]

                # Find t_rej_2: first rej_date >= t_api_2
                rej_2_candidates = [d for d in rej_dates if d >= t_api_2]
                if not rej_2_candidates:
                    continue
                t_rej_2 = rej_2_candidates[0]

                quadruplets.append(
                    {
                        "krs": krs,
                        "method": method,
                        "t_api_1": t_api_1,
                        "t_rej_1": t_rej_1,
                        "t_api_2": t_api_2,
                        "t_rej_2": t_rej_2,
                    }
                )

    quad_df = pd.DataFrame(quadruplets)
    print(f"   Found {len(quad_df)} potential quadruplets")

    if quad_df.empty:
        print("   No quadruplets found to analyze!")
        return

    # ─── Analyze content changes ──────────────────────────────────────────

    print("\n5. Comparing actual content across quadruplets...")
    results = []

    for _, quad in quad_df.iterrows():
        krs = quad["krs"]
        method = quad["method"]
        t_api_1 = quad["t_api_1"]
        t_rej_1 = quad["t_rej_1"]
        t_api_2 = quad["t_api_2"]
        t_rej_2 = quad["t_rej_2"]

        # Read api-krs files
        api_file_1 = api_krs_files.get((krs, t_api_1))
        api_file_2 = api_krs_files.get((krs, t_api_2))

        if not api_file_1 or not api_file_2:
            continue

        try:
            api_data_1 = json.loads(api_file_1.read_text(encoding="utf-8"))
            api_data_2 = json.loads(api_file_2.read_text(encoding="utf-8"))
        except Exception:
            continue

        people_api_1 = extract_censored_people(api_data_1)
        people_api_2 = extract_censored_people(api_data_2)

        # Check if censored list changed
        api_changed = people_api_1 != people_api_2

        # Read rejestr.io files
        rej_content_1 = read_cached_file(krs, method, t_rej_1)
        rej_content_2 = read_cached_file(krs, method, t_rej_2)

        if rej_content_1 is None or rej_content_2 is None:
            continue

        people_rej_1 = extract_people_set(rej_content_1)
        people_rej_2 = extract_people_set(rej_content_2)

        if people_rej_1 is None or people_rej_2 is None:
            continue

        # Check if rejestr.io data changed
        rej_changed = people_rej_1 != people_rej_2

        # Calculate delays
        delay_api_to_rej = (pd.Timestamp(t_rej_2) - pd.Timestamp(t_api_2)).days
        time_between_api_scrapes = (
            pd.Timestamp(t_api_2) - pd.Timestamp(t_api_1)
        ).days

        results.append(
            {
                "krs": krs,
                "method": method,
                "t_api_1": t_api_1,
                "t_rej_1": t_rej_1,
                "t_api_2": t_api_2,
                "t_rej_2": t_rej_2,
                "api_changed": api_changed,
                "rej_changed": rej_changed,
                "delay_days": delay_api_to_rej,
                "time_between_api_days": time_between_api_scrapes,
            }
        )

    res_df = pd.DataFrame(results)
    print(f"   Analyzed {len(res_df)} quadruplets with all files available")

    if res_df.empty:
        print("   No complete quadruplets available for analysis.")
        return

    # ─── Print results ────────────────────────────────────────────────────

    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)

    # 1. Primary Event of Interest: Censored List Changed
    changed_api_df = res_df[res_df["api_changed"]]
    total_changed = len(changed_api_df)

    print(f"--- Rejestr.io hit rate when api-krs censored list changed ---")
    print(f"Total cases analyzed: {total_changed}")
    if total_changed > 0:
        success = changed_api_df["rej_changed"].sum()
        print(
            f"Rejestr.io changed:   {success}/{total_changed} ({100 * success / total_changed:.1f}%)"
        )
        print(
            f"Rejestr.io unchanged: {total_changed - success}/{total_changed} ({100 * (total_changed - success) / total_changed:.1f}%)"
        )

    # 2. Baseline / Control Group: Censored List Unchanged
    unchanged_api_df = res_df[~res_df["api_changed"]]
    total_unchanged = len(unchanged_api_df)

    print(f"\n--- Rejestr.io change rate when api-krs censored list did NOT change ---")
    print(f"Total cases analyzed: {total_unchanged}")
    if total_unchanged > 0:
        false_positives = unchanged_api_df["rej_changed"].sum()
        print(
            f"Rejestr.io changed:   {false_positives}/{total_unchanged} ({100 * false_positives / total_unchanged:.1f}%)"
        )
        print(
            f"Rejestr.io unchanged: {total_unchanged - false_positives}/{total_unchanged} ({100 * (total_unchanged - false_positives) / total_unchanged:.1f}%)"
        )

    # 3. Delay Analysis for Changed Cases
    print(f"\n--- Delay Analysis (api-krs change observed → rejestr.io query) ---")
    if total_changed > 0:
        print(f"  Mean delay: {changed_api_df['delay_days'].mean():.1f} days")
        print(
            f"  Median delay: {changed_api_df['delay_days'].median():.1f} days"
        )
        print(f"  Min delay: {changed_api_df['delay_days'].min()} days")
        print(f"  Max delay: {changed_api_df['delay_days'].max()} days")

        print(f"\n--- Success Rate vs Delay ---")
        for bucket_label, lo, hi in [
            ("0 days (same day)", 0, 0),
            ("1-3 days", 1, 3),
            ("4-7 days", 4, 7),
            ("8-14 days", 8, 14),
            ("15-30 days", 15, 30),
            ("31+ days", 31, 9999),
        ]:
            mask = (changed_api_df["delay_days"] >= lo) & (
                changed_api_df["delay_days"] <= hi
            )
            bucket_df = changed_api_df[mask]
            n = len(bucket_df)
            if n > 0:
                succ = bucket_df["rej_changed"].sum()
                print(
                    f"  {bucket_label}: {succ}/{n} changed ({100 * succ / n:.1f}%)"
                )

    # ─── Summary ──────────────────────────────────────────────────────────

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    if total_changed > 0 and total_unchanged > 0:
        success_pct = 100 * success / total_changed
        control_pct = 100 * false_positives / total_unchanged
        print(f"""
When we detect a change in the censored list of people via api-krs:
  - rejestr.io reflects a change in **{success_pct:.1f}%** of the cases.
  - When no change is observed in the censored list, rejestr.io changes in only **{control_pct:.1f}%** of cases.

This indicates that watching the censored people list is a {'strong' if success_pct > 60 else 'weak'}
indicator of actual connection modifications, showing that api-krs updates map directly to rejestr.io updates.
""")


if __name__ == "__main__":
    main()
