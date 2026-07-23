"""
KRSCensoredPeople tracks the censored people list from api-krs.ms.gov.pl
OdpisAktualny responses. It hashes the people set per KRS per date and
exposes a method to detect KRS entries where people changed between snapshots.
"""

import hashlib
import json

import pandas as pd
from tqdm import tqdm

from scrapers.krs.people_parsing import extract_censored_people
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile


def hash_people_set(people: set[tuple]) -> str:
    """Produce a deterministic hash for a set of people tuples."""
    canonical = sorted(str(p) for p in people)
    return hashlib.sha256(
        json.dumps(canonical).encode()
    ).hexdigest()[:16]


class KRSCensoredPeople(Pipeline):
    """Indexes censored people from api-krs snapshots.

    Outputs a DataFrame with columns: krs, date, people_hash, n_people.
    Each row represents one api-krs OdpisAktualny file.
    """

    filename = "krs_censored_people"
    dtype = {"krs": str}

    def process(self, ctx: Context) -> pd.DataFrame:
        results: list[dict] = []

        for blob_ref in tqdm(
            ctx.io.list_files(
                CloudStorage(prefix="hostname=api-krs.ms.gov.pl")
            ),
            desc="Indexing censored people",
        ):
            assert isinstance(blob_ref, DownloadableFile)
            url = blob_ref.url
            if "OdpisAktualny" not in url:
                continue

            # Extract KRS and date from the URL
            krs = _extract_krs(url)
            date = _extract_date(url)
            if not krs or not date:
                continue

            try:
                content = ctx.io.read_data(blob_ref).read_string()
                if not content:
                    continue
                data = json.loads(content)
            except Exception:
                continue

            people = extract_censored_people(data)
            results.append(
                {
                    "krs": krs,
                    "date": date,
                    "people_hash": hash_people_set(people),
                    "n_people": len(people),
                }
            )

        if not results:
            return pd.DataFrame(
                columns=["krs", "date", "people_hash", "n_people"]
            )

        return pd.DataFrame(results)

    def krs_with_people_changes(self, ctx: Context) -> dict[str, str]:
        """Return KRS → change_date for entries where people changed.

        For each KRS, walks snapshots in date order and records the
        date of the most recent hash change. Returns only KRS entries
        where such a change exists.

        KRS entries with only one snapshot are included with that
        snapshot's date (first-time scrape, no prior data).
        """
        df = self.read_or_process(ctx)
        if df.empty:
            return {}

        changed: dict[str, str] = {}
        for krs, group in df.groupby("krs"):
            sorted_group = group.sort_values("date")
            hashes = sorted_group["people_hash"].tolist()
            dates = sorted_group["date"].tolist()
            if len(hashes) < 2:
                # Only one snapshot — include it (first-time)
                changed[str(krs)] = str(dates[0])
            else:
                # Walk backwards to find the most recent change
                for i in range(len(hashes) - 1, 0, -1):
                    if hashes[i] != hashes[i - 1]:
                        changed[str(krs)] = str(dates[i])
                        break

        return changed


def _extract_krs(url: str) -> str | None:
    """Extract 10-digit KRS from an api-krs URL."""
    if "OdpisAktualny/" not in url:
        return None
    after = url.split("OdpisAktualny/", 1)[1]
    krs = after.split("/", 1)[0].split(".", 1)[0]
    try:
        return str(int(krs)).zfill(10)
    except ValueError:
        return None


def _extract_date(url: str) -> str | None:
    """Extract date from a cached api-krs file URL."""
    if "date=" not in url:
        return None
    return url.split("date=", 1)[1].split("/", 1)[0]
