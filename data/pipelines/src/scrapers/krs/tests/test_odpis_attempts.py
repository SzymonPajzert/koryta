"""How the odpis job's run record folds into each company's newest attempt."""

import gzip
import itertools
import json

import pandas as pd

from scrapers.krs.odpis_attempts import (
    ABSENT,
    FAILED,
    FETCHED,
    GATEWAY,
    NETWORK,
    RUN_LOG,
    KrsOdpisAttempts,
    failed_odpis,
    newest_attempts,
)
from scrapers.tests.mocks import MockIO

A = "0000000029"
B = "0000000031"


def attempt(krs=A, status=FETCHED, at="2026-10-02T15:22:28+02:00", attempt=1, **kw):
    """One line of the record, as `jobs.krs_odpis.log.RunLog` writes it."""
    return {
        "run": kw.pop("run", "run1"),
        "at": at,
        "krs": krs,
        "status": status,
        "reason": kw.pop("reason", "graph"),
        "refresh": False,
        "attempt": attempt,
        "seconds": 0.5,
        "register": "P" if status == FETCHED else None,
        "size": 1000 if status == FETCHED else None,
        "error": kw.pop("error", None),
    }


def test_the_newest_attempt_stands_whatever_order_the_parts_are_read_in():
    lines = [
        attempt(status=GATEWAY, at="2026-10-02T15:22:28+02:00", error="HTTP 504"),
        attempt(status=FETCHED, at="2026-10-03T04:43:00+02:00"),
        attempt(B, status=FETCHED, at="2026-10-02T15:00:00+02:00"),
        attempt(B, status=NETWORK, at="2026-10-04T04:43:00+02:00"),
    ]

    folds = {
        tuple((a.krs, a.status) for a in newest_attempts(order))
        for order in itertools.permutations(lines)
    }

    assert folds == {((A, FETCHED), (B, NETWORK))}


def test_a_second_pass_in_the_same_second_comes_after_the_first():
    first = attempt(status=GATEWAY, at="2026-10-02T15:22:28+02:00", attempt=1)
    second = attempt(status=FETCHED, at="2026-10-02T15:22:28+02:00", attempt=2)

    assert [a.status for a in newest_attempts([second, first])] == [FETCHED]


def test_the_clocks_are_compared_as_moments_not_text():
    """Across the DST change the offsets differ, and text order would lie."""
    summer = attempt(status=GATEWAY, at="2026-10-25T02:30:00+02:00")
    winter = attempt(status=FETCHED, at="2026-10-25T02:15:00+01:00")  # 45 min later

    assert [a.status for a in newest_attempts([winter, summer])] == [FETCHED]


def test_a_line_that_cannot_be_dated_or_numbered_is_left_out():
    lines = [
        attempt(status=FETCHED),
        attempt(status=FAILED, at="yesterday"),
        attempt("not a krs", status=FAILED),
        {"krs": B},
    ]

    assert [(a.krs, a.status) for a in newest_attempts(lines)] == [(A, FETCHED)]


def test_the_free_odpis_failed_where_nothing_came_back_and_nothing_was_said():
    attempts = pd.DataFrame(
        {
            "krs": ["29", "31", "41", "43", "47"],
            "status": [FETCHED, ABSENT, GATEWAY, NETWORK, FAILED],
        }
    )

    # Absent is an answer: the register has nothing under the number, and
    # rejestr.io, which copies it, has nothing to sell.
    assert failed_odpis(attempts) == {"0000000041", "0000000043", "0000000047"}
    assert failed_odpis(pd.DataFrame()) == set()
    assert failed_odpis(None) == set()


class RecordIO(MockIO):
    """A MockIO whose shared cache holds run record parts."""

    def __init__(self, *parts: list[dict]):
        super().__init__()
        self.parts = {
            f"part-{i}": gzip.compress(
                "".join(
                    json.dumps(line, ensure_ascii=False) + "\n" for line in lines
                ).encode()
            )
            for i, lines in enumerate(parts)
        }
        self.asked: list = []

    def list_files(self, path):
        self.asked.append(path)
        yield from self.parts

    def read_data(self, fs):
        data = self.parts[fs]

        class Part:
            def read_bytes(self):
                return data

        return Part()


def test_the_pipeline_folds_every_part_of_the_record():
    io = RecordIO(
        [attempt(status=GATEWAY, error="KRS 0000000029 register P: HTTP 504")],
        [
            attempt(B, status=FETCHED, at="2026-10-03T04:43:09+02:00"),
            # A message with a line separator in it, which json.dumps leaves
            # raw: one line of the record, not two.
            attempt(status=FAILED, at="2026-10-03T04:43:10+02:00", error="a\u2028b"),
        ],
    )

    class Ctx:
        pass

    ctx = Ctx()
    ctx.io = io  # type: ignore[attr-defined]

    df = KrsOdpisAttempts().process(ctx)  # type: ignore[arg-type]

    assert io.asked == [RUN_LOG]
    assert list(df["krs"]) == [A, B]
    assert list(df["status"]) == [FAILED, FETCHED]
    assert df["error"].iloc[0] == "a\u2028b"
    assert failed_odpis(df) == {A}
