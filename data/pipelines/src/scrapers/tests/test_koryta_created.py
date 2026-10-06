"""The pages the people import created today, read off what it says it sent."""

import gzip
import json

from scrapers.koryta.created import SENT_LOG, KorytaPeopleCreated
from scrapers.stores import CloudStorage, iterate_pipeline_dict
from scrapers.tests.mocks import MockIO

DAY = "2026-10-06"


def part(*rows: dict) -> bytes:
    lines = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    return gzip.compress(lines.encode("utf-8"), mtime=0)


def sent(name: str, outcome: str, node: str | None, rejestr: str | None = None):
    return {
        "person": rejestr or name,
        "payload": "hash",
        "name": name,
        "tier": "new_hire" if outcome == "created" else "published",
        "outcome": outcome,
        "node": node,
        "rejestrIo": rejestr,
    }


class Part:
    def __init__(self, url: str):
        self.url = url


class SentIO(MockIO):
    """A MockIO whose shared bucket holds the import's parts, by name."""

    def __init__(self, parts: dict[str, bytes]):
        super().__init__()
        self.parts = parts
        self.asked: list[CloudStorage] = []

    def list_files(self, path):
        self.asked.append(path)
        for name in self.parts:
            if name.startswith(path.prefix):
                yield Part(f"gs://{path.bucket}/{name}")

    def read_data(self, fs):
        data = self.parts[fs.url.split("/", 3)[3]]

        class Read:
            def read_bytes(self):
                return data

        return Read()


def created(parts: dict[str, bytes]):
    io = SentIO(parts)

    class Ctx:
        pass

    ctx = Ctx()
    ctx.io = io  # type: ignore[attr-defined]
    return KorytaPeopleCreated(DAY).process(ctx), io  # type: ignore[arg-type]


def test_the_pages_created_that_day_are_read_with_the_run_that_made_them():
    link = "https://rejestr.io/osoby/7"
    df, io = created(
        {
            f"{SENT_LOG.prefix}date={DAY}/run-a.jsonl.gz": part(
                sent("Anna Nowak", "created", "n1", link),
                sent("Jan Kowalski", "updated", "n2"),
                sent("Ewa Lis", "unchanged", "n3"),
            ),
            f"{SENT_LOG.prefix}date={DAY}/run-b.jsonl.gz": part(
                sent("Beata Kos", "created", "n4"),
            ),
            # Another day's: in that day's export, or after this one.
            f"{SENT_LOG.prefix}date=2026-10-05/run-c.jsonl.gz": part(
                sent("Celina Bór", "created", "n5"),
            ),
        }
    )

    [asked] = io.asked
    assert (asked.prefix, asked.bucket) == (
        f"jobs/people_import/sent/date={DAY}/",
        "koryta-pl-sharedcache",
    )
    assert list(iterate_pipeline_dict(df)) == [
        {"id": "n1", "full_name": "Anna Nowak", "rejestrIo": link, "run": "run-a"},
        {"id": "n4", "full_name": "Beata Kos", "rejestrIo": None, "run": "run-b"},
    ]


def test_a_line_from_before_the_page_was_written_down_is_passed_over():
    old = sent("Anna Nowak", "created", None)
    del old["node"], old["rejestrIo"]

    df, _ = created({f"{SENT_LOG.prefix}date={DAY}/run-a.jsonl.gz": part(old)})

    assert df.empty
    assert list(df.columns) == ["id", "full_name", "rejestrIo", "run"]


def test_a_page_named_twice_is_one_page():
    df, _ = created(
        {
            f"{SENT_LOG.prefix}date={DAY}/run-a.jsonl.gz": part(
                sent("Anna Nowak", "created", "n1")
            ),
            f"{SENT_LOG.prefix}date={DAY}/run-b.jsonl.gz": part(
                sent("Anna Nowak", "created", "n1")
            ),
        }
    )

    assert list(df["id"]) == ["n1"]


def test_a_name_with_a_line_separator_stays_on_its_line():
    """U+2028 is written raw, and str.splitlines would break the line at it."""
    df, _ = created(
        {
            f"{SENT_LOG.prefix}date={DAY}/run-a.jsonl.gz": part(
                sent("Anna\u2028Nowak", "created", "n1")
            )
        }
    )

    assert list(df["full_name"]) == ["Anna\u2028Nowak"]


def test_nothing_is_kept_on_disk_so_every_run_reads_the_day_afresh():
    pipeline = KorytaPeopleCreated(DAY)

    assert pipeline.volatile and pipeline.filename is None
    assert KorytaPeopleCreated().date  # today's, unless asked for another day
