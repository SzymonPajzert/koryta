"""Shared utilities for update rate analysis scripts."""

import json
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd

from conductor import setup_context
from scrapers.krs.scrape import KRSAlreadyScraped
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import Pipeline

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
DOWNLOADED_DIR = PROJECT_ROOT / "downloaded"

METHODS_OF_INTEREST = [
    "rejestrio_org_krs_powiazania_aktualne",
    "rejestrio_org_krs_powiazania_historyczne",
]


def make_context():
    """Create a read-only pipeline context."""
    return setup_context(False)[0]


def load_already_scraped(ctx) -> pd.DataFrame:
    """Load the krs_already_scraped pipeline output."""
    pipeline = Pipeline.create(KRSAlreadyScraped)
    df = pipeline.read_or_process(ctx)
    df["date"] = df["date"].astype(str)
    return df


def load_krs_updates(ctx) -> pd.DataFrame:
    """Load the krs_updates pipeline output."""
    pipeline = Pipeline.create(KRSUpdates)
    df = pipeline.read_or_process(ctx)
    df["date"] = df["date"].astype(str)
    df["krs"] = df["krs"].astype(str).str.zfill(10)
    return df


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


def extract_rejestrio_people(content: str) -> set[tuple] | None:
    """Extract a set of (id, name, type) from a rejestr.io connection response.

    This allows us to detect structural changes (people added/removed)
    rather than cosmetic JSON differences.
    """
    try:
        data = json.loads(content)
        people: set[tuple] = set()
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


def index_api_krs_files() -> dict[tuple[str, str], Path]:
    """Build a lookup dict for api-krs OdpisAktualny files: (krs, date) -> filepath."""
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

    return api_krs_files


def _parse_person(p: dict) -> tuple | None:
    """Parse a single person dict into a (nazwisko, imie, imie2, pesel) tuple."""
    if not isinstance(p, dict):
        return None
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
        return (nazwisko, imie, imie2, pesel)
    return None


def _extract_sklad(
    container: dict, key: str, role_prefix: str, role_field: str,
) -> list[tuple]:
    """Extract people from a 'sklad' list inside a container dict."""
    results: list[tuple] = []
    section = container.get(key, {})
    if not isinstance(section, dict):
        return results
    sklad = section.get("sklad", [])
    if not isinstance(sklad, list):
        return results
    for p in sklad:
        parsed = _parse_person(p)
        if parsed:
            fn = p.get(role_field, "") if isinstance(p, dict) else ""
            results.append((*parsed, f"{role_prefix}: {fn}"))
    return results


def _extract_dzial1_people(dane: dict) -> set[tuple]:
    """Extract people from dzial1 (wspolnicySpzoo)."""
    people: set[tuple] = set()
    dzial1 = dane.get("dzial1", {})
    if not isinstance(dzial1, dict):
        return people
    for w in dzial1.get("wspolnicySpzoo", []):
        parsed = _parse_person(w)
        if parsed:
            people.add((*parsed, "wspolnik"))
    return people


def _extract_dzial2_people(dane: dict) -> set[tuple]:
    """Extract people from dzial2 (representation, supervision, etc.)."""
    people: set[tuple] = set()
    dzial2 = dane.get("dzial2", {})
    if not isinstance(dzial2, dict):
        return people

    # reprezentacja / prokurenci (sklad-based)
    for t in _extract_sklad(
        dzial2, "reprezentacja", "reprezentacja", "funkcjaWOrganie",
    ):
        people.add(t)
    for t in _extract_sklad(
        dzial2, "prokurenci", "prokurent", "rodzajProkury",
    ):
        people.add(t)

    # organNadzoru (can be list or dict)
    organ_nadzoru = dzial2.get("organNadzoru", {})
    organs = (
        organ_nadzoru
        if isinstance(organ_nadzoru, list)
        else [organ_nadzoru]
    )
    for organ in organs:
        if isinstance(organ, dict):
            for t in _extract_sklad(
                {"o": organ}, "o", "nadzor", "funkcjaWOrganie",
            ):
                people.add(t)

    # reprezentacjaIBIGBPPSPZOZ (single person dict)
    rep_pzoz = dzial2.get("reprezentacjaIBIGBPPSPZOZ", {})
    if isinstance(rep_pzoz, dict):
        parsed = _parse_person(rep_pzoz)
        if parsed:
            people.add((*parsed, "kierownik_pzoz"))

    # pelnomocnicy / osobyReprezentujacePZ (plain lists)
    for key, role in [
        ("pelnomocnicy", "pelnomocnik"),
        ("osobyReprezentujacePZ", "osoba_pz"),
    ]:
        for p in dzial2.get(key, []):
            parsed = _parse_person(p)
            if parsed:
                people.add((*parsed, role))

    return people


def extract_censored_people(data: dict) -> set[tuple]:
    """Extract all censored people from an api-krs JSON response.

    Returns a set of (nazwiskoICzlon, imie, imieDrugie, pesel, role).
    """
    if not isinstance(data, dict) or "odpis" not in data:
        return set()

    dane = data["odpis"].get("dane", {})
    if not isinstance(dane, dict):
        return set()

    return _extract_dzial1_people(dane) | _extract_dzial2_people(dane)


def build_scrape_dates(
    scraped_df: pd.DataFrame,
    methods: list[str],
) -> dict[tuple[str, str], list[str]]:
    """Build a dict of (krs, method) -> sorted list of dates for given methods."""
    filtered = scraped_df[scraped_df["method"].isin(methods)]
    scrape_dates: dict[tuple[str, str], list[str]] = defaultdict(list)
    for _, row in filtered.iterrows():
        key = (row["krs"], row["method"])
        scrape_dates[key].append(row["date"])

    for key, dates in scrape_dates.items():
        scrape_dates[key] = sorted(set(dates))

    return scrape_dates


def build_update_dates(updates_df: pd.DataFrame) -> dict[str, list[str]]:
    """Build a dict of krs -> sorted list of bulletin update dates."""
    update_dates: dict[str, list[str]] = defaultdict(list)
    for _, row in updates_df.iterrows():
        update_dates[row["krs"]].append(row["date"])

    for krs, dates in update_dates.items():
        update_dates[krs] = sorted(set(dates))

    return update_dates
