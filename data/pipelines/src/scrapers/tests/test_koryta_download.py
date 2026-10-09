"""Which export the koryta pipelines read when today's has not landed yet.

The site dumps Firestore once or twice a day, so a pipeline started in the
morning asks for a date that does not exist yet. `KorytaPeople` has always
walked back a day until it found one; `KorytaVotes` did not, and returned an
empty frame instead - which reaches the scoring models as "no human has ever
voted on anybody" rather than as an error. These pin the shared behaviour.
"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pandas as pd

from scrapers.koryta.download import (
    MAX_EXPORT_LOOKBACK_DAYS,
    FirestoreCollection,
    KorytaCompanies,
    KorytaEdges,
    KorytaNodes,
    KorytaNotes,
    KorytaPeople,
    KorytaVotes,
    export_timestamp,
)
from scrapers.stores import Context
from scrapers.stores.file import DownloadableFile


def blob(stamp: str, kind: str = "nodes", part: str = "output-0") -> DownloadableFile:
    """A blob ref shaped like the ones `Client.list_blobs` hands back."""
    name = f"hostname=koryta.pl/date={stamp}/all_namespaces/kind_{kind}/{part}"
    return DownloadableFile(f"gs://koryta-pl-crawled/{name}", name.replace("/", "."))


def mock_ctx() -> Mock:
    ctx = Mock(spec=Context)
    ctx.io = Mock()
    ctx.refresh_policy = MagicMock()
    ctx.refresh_policy.should_refresh.return_value = False
    ctx.refresh_policy.refreshed_pipelines = set()
    return ctx


def exports_on(dates: dict[str, pd.DataFrame]):
    """A `FirestoreCollection.process` that only knows about `dates`."""

    def process(self, ctx):
        return dates.get(self.date, pd.DataFrame())

    return process


class TestLatestOnOrBefore(unittest.TestCase):
    def test_uses_the_day_asked_for_when_it_has_an_export(self):
        wanted = pd.DataFrame([{"id": "a"}])
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-07": wanted})
        ):
            df, date = FirestoreCollection.latest_on_or_before(
                mock_ctx(), "votes", date="2026-08-07"
            )
        self.assertEqual(date, "2026-08-07")
        self.assertEqual(len(df), 1)

    def test_walks_back_to_the_most_recent_earlier_export(self):
        wanted = pd.DataFrame([{"id": "a"}])
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-05": wanted})
        ):
            df, date = FirestoreCollection.latest_on_or_before(
                mock_ctx(), "votes", date="2026-08-07"
            )
        # Two days back, and it stops at the first day that has one rather than
        # continuing to the oldest.
        self.assertEqual(date, "2026-08-05")
        self.assertEqual(len(df), 1)

    def test_raises_rather_than_walking_forever_when_there_is_no_export(self):
        with patch.object(FirestoreCollection, "process", exports_on({})):
            with self.assertRaises(FileNotFoundError) as caught:
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "votes", date="2026-08-07"
                )
        self.assertIn("votes", str(caught.exception))

    def test_gives_up_after_the_lookback_window(self):
        seen: list[str] = []

        def process(self, ctx):
            seen.append(self.date)
            return pd.DataFrame()

        with patch.object(FirestoreCollection, "process", process):
            with self.assertRaises(FileNotFoundError):
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "votes", date="2026-08-07", max_lookback_days=3
                )
        self.assertEqual(seen, ["2026-08-07", "2026-08-06", "2026-08-05", "2026-08-04"])

    def test_default_window_is_the_documented_one(self):
        seen: list[str] = []

        def process(self, ctx):
            seen.append(self.date)
            return pd.DataFrame()

        with patch.object(FirestoreCollection, "process", process):
            with self.assertRaises(FileNotFoundError):
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "nodes", "person", "2026-08-07"
                )
        self.assertEqual(len(seen), MAX_EXPORT_LOOKBACK_DAYS + 1)


class TestPipelinesFallBack(unittest.TestCase):
    """Every collection gets the fallback, not just the two that had a loop."""

    def test_votes_read_the_previous_day_rather_than_coming_back_empty(self):
        yesterday = pd.DataFrame(
            [
                {
                    "userUid": "someone",
                    "categoryVotes": {"interesting": 4},
                    "nodeId": "person-1",
                }
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaVotes(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["person_koryta_id"], "person-1")
        self.assertEqual(df.iloc[0]["interesting"], 4)

    def test_votes_still_drop_the_pipeline_s_own(self):
        yesterday = pd.DataFrame(
            [
                {
                    "userUid": "pipeline-pagerank",
                    "categoryVotes": {"interesting": 5},
                    "nodeId": "person-1",
                },
                {
                    "userUid": "human",
                    "categoryVotes": {"interesting": 2},
                    "nodeId": "person-2",
                },
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaVotes(date="2026-08-07").process(mock_ctx())

        self.assertEqual(list(df["person_koryta_id"]), ["person-2"])

    def test_people_fall_back_as_they_always_did(self):
        yesterday = pd.DataFrame(
            [
                {
                    "id": "person-1",
                    "name": "Jan Kowalski",
                    "parties": [],
                    "stats": {"isApproved": True, "votes": {"interesting": 3}},
                }
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaPeople(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["full_name"], "Jan Kowalski")
        self.assertTrue(df.iloc[0]["is_public"])

    def test_companies_fall_back_as_they_always_did(self):
        yesterday = pd.DataFrame(
            [{"id": "place-1", "krsNumber": "0000123456", "revision_id": "r1"}]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaCompanies(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["krs"], "0000123456")


class TestKorytaNotes(unittest.TestCase):
    """A reader's note is a list of entries on one page; the pipeline keeps a
    row per entry, saying which page, what kind, and whether it is still open."""

    def notes(self, *documents: dict) -> pd.DataFrame:
        with patch.object(
            FirestoreCollection,
            "process",
            exports_on({"2026-10-09": pd.DataFrame(list(documents))}),
        ):
            return KorytaNotes(date="2026-10-09").process(mock_ctx())

    def test_an_entry_a_row_and_nothing_of_what_it_says(self):
        df = self.notes(
            {
                "userUid": "reader",
                "nodeId": "person-1",
                "createdAt": "2026-08-21T10:00:00.000Z",
                "sources": [
                    {"note": "Brakuje wyborów", "kind": "missing"},
                    {"note": "Jego linkedin", "url": "https://example.com/x"},
                    {"note": "Duplikat", "kind": "change_request"},
                ],
            },
            {
                "userUid": "other",
                "nodeId": "place-1",
                "sources": [{"note": "Brakuje zarządu", "kind": "missing"}],
            },
        )

        self.assertEqual(list(df.columns), ["node_id", "kind", "admin_status", "open"])
        self.assertEqual(
            df.to_dict(orient="records"),
            [
                {
                    "node_id": "person-1",
                    "kind": "missing",
                    "admin_status": "",
                    "open": True,
                },
                # Written before kinds existed, or with none: a source, which
                # asks nobody for anything.
                {
                    "node_id": "person-1",
                    "kind": "source",
                    "admin_status": "",
                    "open": False,
                },
                {
                    "node_id": "person-1",
                    "kind": "change_request",
                    "admin_status": "",
                    "open": True,
                },
                {
                    "node_id": "place-1",
                    "kind": "missing",
                    "admin_status": "",
                    "open": True,
                },
            ],
        )

    def test_an_admin_s_word_decides_whether_an_entry_is_open(self):
        df = self.notes(
            {
                "userUid": "reader",
                "nodeId": "person-1",
                "sources": [
                    {"note": "a", "kind": "missing", "adminStatus": "resolved"},
                    {
                        "note": "b",
                        "url": "https://example.com/y",
                        "adminStatus": "unresolved",
                    },
                    {
                        "note": "c",
                        "kind": "change_request",
                        "adminStatus": "unresolved",
                    },
                ],
            }
        )

        self.assertEqual(
            list(zip(df["kind"], df["admin_status"], df["open"])),
            [
                ("missing", "resolved", False),
                ("source", "unresolved", True),
                ("change_request", "unresolved", True),
            ],
        )

    def test_a_note_on_no_page_or_with_no_entries_is_left_out(self):
        df = self.notes(
            {"userUid": "a", "nodeId": None, "sources": [{"kind": "missing"}]},
            {"userUid": "b", "nodeId": "person-2"},
            {"userUid": "c", "nodeId": "person-3", "sources": ["not an entry", None]},
            {"userUid": "d", "nodeId": "person-4", "sources": [{"kind": "missing"}]},
        )

        self.assertEqual(list(df["node_id"]), ["person-4"])

    def test_no_entries_at_all_is_an_empty_frame_with_the_columns(self):
        df = self.notes({"userUid": "a", "nodeId": "person-1", "sources": []})

        self.assertTrue(df.empty)
        self.assertEqual(list(df.columns), ["node_id", "kind", "admin_status", "open"])


class TestWantedBlobs(unittest.TestCase):
    """A day can hold more than one export; only the newest should be read."""

    EARLY = "2026-08-07T07:55:08.653Z"
    LATE = "2026-08-07T18:16:39.344Z"

    def test_reads_only_the_newest_export_of_the_day(self):
        blobs = [
            blob(self.EARLY, part="output-0"),
            blob(self.EARLY, part="output-1"),
            blob(self.LATE, part="output-0"),
            blob(self.LATE, part="output-1"),
        ]
        wanted = FirestoreCollection("nodes", date="2026-08-07").wanted_blobs(blobs)

        self.assertEqual(len(wanted), 2)
        self.assertEqual({export_timestamp(b) for b in wanted}, {self.LATE})

    def test_a_single_export_is_untouched(self):
        blobs = [blob(self.LATE, part="output-0"), blob(self.LATE, part="output-1")]
        wanted = FirestoreCollection("nodes", date="2026-08-07").wanted_blobs(blobs)
        self.assertEqual(len(wanted), 2)

    def test_other_days_and_other_collections_are_dropped(self):
        blobs = [
            blob(self.LATE, kind="nodes"),
            blob(self.LATE, kind="votes"),
            blob("2026-08-06T07:55:00.000Z", kind="nodes"),
        ]
        wanted = FirestoreCollection("votes", date="2026-08-07").wanted_blobs(blobs)

        self.assertEqual(len(wanted), 1)
        self.assertIn("kind_votes", wanted[0].url)

    def test_non_output_files_are_dropped(self):
        blobs = [
            blob(self.LATE, part="output-0"),
            blob(self.LATE, part="all_namespaces_kind_nodes.export_metadata"),
        ]
        wanted = FirestoreCollection("nodes", date="2026-08-07").wanted_blobs(blobs)

        self.assertEqual(len(wanted), 1)
        self.assertTrue(wanted[0].url.endswith("output-0"))

    def test_without_a_date_every_export_is_kept(self):
        # `KorytaDiffer` compares one export against another, so it needs them
        # all - the de-duplication is only meaningful within a single day.
        blobs = [blob(self.EARLY), blob(self.LATE), blob("2026-08-06T07:55:00.000Z")]
        wanted = FirestoreCollection("nodes").wanted_blobs(blobs)
        self.assertEqual(len(wanted), 3)


class TestExportListing(unittest.TestCase):
    """How much of the bucket a collection read asks to see.

    The host holds every export ever taken, and listing all of it took a
    quarter of an hour for each collection a pipeline read. A dated read keeps
    one day's worth, so one day is all it should list.
    """

    def listed_prefix(self, collection: FirestoreCollection) -> str:
        ctx = mock_ctx()
        ctx.io.list_files.return_value = []
        collection.process(ctx)
        (ref,), _ = ctx.io.list_files.call_args
        return ref.prefix

    def test_a_dated_read_lists_only_that_day(self):
        self.assertEqual(
            self.listed_prefix(FirestoreCollection("nodes", date="2026-08-07")),
            "hostname=koryta.pl/date=2026-08-07",
        )

    def test_an_undated_read_lists_the_whole_host(self):
        self.assertEqual(
            self.listed_prefix(FirestoreCollection("nodes")), "hostname=koryta.pl"
        )


class TestExportDtypes(unittest.TestCase):
    """The identifiers a comparison matches on have to survive being written.

    `KorytaNodes` is read back through `read_json`, which types a column by
    what it looks like: a KRS becomes 349305.0 and a wojewodztwo's TERYT
    becomes 2.0. Nothing fails - the lookups simply stop matching, and every
    payload reads as one the site has never seen.
    """

    def round_trip(self, pipeline, row: dict) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.jsonl"
            pd.DataFrame.from_records([row]).to_json(path, orient="records", lines=True)
            read = pd.read_json(path, lines=True, dtype=pipeline.dtype)
        return read.iloc[0].to_dict()

    def test_a_krs_keeps_its_leading_zeros(self):
        row = self.round_trip(
            KorytaNodes(),
            {"id": "place-1", "type": "place", "krsNumber": "0000349305"},
        )
        self.assertEqual(row["krsNumber"], "0000349305")

    def test_a_wojewodztwo_teryt_keeps_its_leading_zero(self):
        row = self.round_trip(
            KorytaNodes(),
            {"id": "teryt02", "type": "region", "teryt": "02"},
        )
        self.assertEqual(row["teryt"], "02")

    def test_a_term_a_reviewer_typed_stays_what_they_typed(self):
        row = self.round_trip(
            KorytaEdges(),
            {"id": "edge-1", "type": "election", "term": "2024"},
        )
        self.assertEqual(row["term"], "2024")


class TestExportTimestamp(unittest.TestCase):
    def test_reads_the_full_timestamp_off_the_path(self):
        self.assertEqual(
            export_timestamp(blob("2026-08-07T18:16:39.344Z")),
            "2026-08-07T18:16:39.344Z",
        )

    def test_none_when_the_path_carries_no_date(self):
        ref = DownloadableFile("gs://koryta-pl-crawled/somewhere/output-0", "x")
        self.assertIsNone(export_timestamp(ref))


if __name__ == "__main__":
    unittest.main()
