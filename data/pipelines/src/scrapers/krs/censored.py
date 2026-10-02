"""
KRSCensoredPeople tracks the censored people list from api-krs.ms.gov.pl
OdpisAktualny responses. It hashes the people set per KRS per date and
exposes a method to detect KRS entries where people changed between snapshots.
"""

import hashlib
import json

import pandas as pd
from tqdm import tqdm

from scrapers.krs.columns import normalise
from scrapers.krs.people_parsing import (
    CensoredPerson,
    extract_censored_people,
    is_odpis,
    last_entry_number,
    unread_person_paths,
)
from scrapers.stores import CloudStorage, Context, Pipeline


class StaleOutputError(RuntimeError):
    """A cached pipeline output predates the columns the reader needs."""


def hash_people_set(people) -> str:
    """Produce a deterministic hash for a set of people."""
    canonical = sorted(str(p) for p in people)
    return hashlib.sha256(json.dumps(canonical).encode()).hexdigest()[:16]


class KRSCensoredPeople(Pipeline):
    """Indexes censored people from api-krs snapshots.

    Outputs a DataFrame with columns: krs, date, people_hash, n_people,
    people. Each row represents one KRS on one crawl date.

    A KRS is queried against both registers - ``?rejestr=P`` and
    ``?rejestr=S`` - and the one it is not in answers with a 404 body. That
    body is valid JSON, so reading it as a snapshot used to produce a second
    row for the same KRS and date holding nobody, which `krs_with_people_changes`
    then read as everyone resigning and being reappointed on the same day. Both
    the register mismatch and a crawl that failed (stored as an empty object)
    are dropped here instead.
    """

    filename = "krs_censored_people"
    dtype = {"krs": str}

    def process(self, ctx: Context) -> pd.DataFrame:
        # Keyed so a second response for the same KRS and date - the other
        # register, or a re-crawl - cannot become a second row.
        snapshots: dict[tuple[str, str], set[CensoredPerson]] = {}
        unread: dict[tuple[str, str], set[str]] = {}
        entries: dict[tuple[str, str], int | None] = {}

        # read_many rather than a listing read object by object: that was
        # 29,681 GETs, one at a time, and on a fresh runner it never finished.
        for url, blob in tqdm(
            ctx.io.read_many(CloudStorage(prefix="hostname=api-krs.ms.gov.pl")),
            desc="Indexing censored people",
        ):
            if "OdpisAktualny" not in url:
                continue

            # Extract KRS and date from the URL
            krs = _extract_krs(url)
            date = _extract_date(url)
            if not krs or not date:
                continue

            try:
                content = blob.read_string()
                if not content:
                    continue
                data = json.loads(content)
            except Exception:
                continue

            if not is_odpis(data):
                continue

            people = extract_censored_people(data)
            previous = snapshots.get((krs, date))
            # Two odpisy for one KRS on one day should not happen; if they do,
            # the larger one is the one that read a full entry.
            if previous is None or len(people) > len(previous):
                snapshots[(krs, date)] = people
                unread[(krs, date)] = unread_person_paths(data)
                entries[(krs, date)] = last_entry_number(data)

        if not snapshots:
            return pd.DataFrame(
                columns=[
                    "krs",
                    "date",
                    "people_hash",
                    "n_people",
                    "people",
                    "unread_paths",
                    "last_entry_no",
                ]
            )

        return pd.DataFrame(
            [
                {
                    "krs": krs,
                    "date": date,
                    "people_hash": hash_people_set(people),
                    "n_people": len(people),
                    "people": [p.as_row() for p in sorted(people)],
                    # Almost always empty. A section the register adds that
                    # PERSON_PATHS does not name is a change that never
                    # registers as one, which is what the prokurenci bug was;
                    # carrying it here turns that into a failing invariant.
                    "unread_paths": sorted(unread.get((krs, date), ())),
                    # The register's own count of how many times this entry
                    # has been written to. rejestr.io publishes its view of
                    # the same number, so the two compare directly - an exact
                    # answer to "was rejestr.io behind when we asked", with no
                    # name matching in it.
                    "last_entry_no": entries.get((krs, date)),
                }
                for (krs, date), people in snapshots.items()
            ]
        )

    def snapshots(self, ctx: Context) -> dict[str, dict[str, list[CensoredPerson]]]:
        """KRS → crawl date → the people api-krs listed on that date."""
        df = self._rows(ctx)
        by_krs: dict[str, dict[str, list[CensoredPerson]]] = {}
        if df.empty:
            return by_krs
        if "people" not in df.columns:
            # Loudly: a caller that reads this as "nobody works anywhere"
            # concludes rejestr.io's coverage is perfect and buys nothing.
            raise StaleOutputError(
                f"{self.filename} has no `people` column - it predates the "
                f"column being added. Re-run with `--refresh {type(self).__name__}`."
            )
        for krs, date, people in zip(df["krs"], df["date"], df["people"]):
            rows = people if isinstance(people, (list, tuple)) else []
            by_krs.setdefault(str(krs), {})[str(date)] = [
                CensoredPerson.from_row(r) for r in rows
            ]
        return by_krs

    def entry_numbers(self, ctx: Context) -> dict[str, dict[str, int]]:
        """KRS → crawl date → the register's last-entry number on that date."""
        df = self._rows(ctx)
        if df.empty or "last_entry_no" not in df.columns:
            return {}
        by_krs: dict[str, dict[str, int]] = {}
        for krs, date, number in zip(df["krs"], df["date"], df["last_entry_no"]):
            if pd.isna(number):
                continue
            by_krs.setdefault(str(krs), {})[str(date)] = int(number)
        return by_krs

    def unread_paths(self, ctx: Context) -> dict[str, int]:
        """Person-bearing paths in the crawl that `PERSON_PATHS` does not name."""
        df = self._rows(ctx)
        if df.empty or "unread_paths" not in df.columns:
            return {}
        counts: dict[str, int] = {}
        for paths in df["unread_paths"]:
            for path in paths if isinstance(paths, (list, tuple)) else ():
                counts[str(path)] = counts.get(str(path), 0) + 1
        return counts

    def _rows(self, ctx: Context) -> pd.DataFrame:
        """The output, normalised and with one row per KRS per day.

        `process` cannot emit a duplicate, but a cached file written before it
        keyed by (krs, date) can hold one, and `read_or_process` will hand back
        that file - or restore it from the shared cache - without a word. The
        larger row wins, as it does in `process`: it is the one that read a
        real entry rather than the 404 from the other register.
        """
        df = normalise(self.read_or_process(ctx), "date")
        if df.empty or "n_people" not in df.columns:
            return df
        return (
            df.sort_values("n_people")
            .drop_duplicates(subset=["krs", "date"], keep="last")
            .sort_values(["krs", "date"])
        )

    def krs_with_people_changes(self, ctx: Context) -> dict[str, str]:
        """Return KRS → change_date for entries where people changed.

        For each KRS, walks snapshots in date order and records the
        date of the most recent hash change. Returns only KRS entries
        where such a change exists.

        KRS entries with only one snapshot are included with that
        snapshot's date (first-time scrape, no prior data).
        """
        df = self._rows(ctx)
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
