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
