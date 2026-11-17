"""The declarations' facts, as predator writes them into the shared cache and
the night reads them back."""

import gzip
import json
from datetime import UTC, datetime

from stores.bip_declaration_facts import (
    FACTS_PREFIX,
    CandidacyFacts,
    FactsPart,
    newest_facts,
    write_facts,
)
from stores.storage import LISTING_FIELDS, SHARED_BUCKET
from stores.tests.test_bip_found import Shared

FOUND = CandidacyFacts("0123456789abcdef", "found", "named", cut_named=True)
WAITING = CandidacyFacts("fedcba9876543210", "found", "named", waiting=True)


def test_the_night_reads_the_newest_part_back():
    shared = Shared()
    write_facts(shared, [FOUND], datetime(2026, 11, 16, 23, 59, 59, tzinfo=UTC))  # type: ignore[arg-type]
    url = write_facts(
        shared,  # type: ignore[arg-type]
        [FOUND, WAITING],
        datetime(2026, 11, 17, 6, 5, 4, tzinfo=UTC),
    )
    # Something else under the prefix is not a part.
    shared.objects[f"{FACTS_PREFIX}notes.txt.jsonl.gz"] = b""

    assert url == (
        f"gs://{SHARED_BUCKET}/{FACTS_PREFIX}date=2026-11-17/"
        "2026-11-17T060504Z.jsonl.gz"
    )
    assert newest_facts(shared) == FactsPart(  # type: ignore[arg-type]
        url,
        datetime(2026, 11, 17, 6, 5, 4, tzinfo=UTC),
        {FOUND.key: FOUND, WAITING.key: WAITING},
    )
    assert shared.listed == [(FACTS_PREFIX, LISTING_FIELDS)]


def test_a_line_is_the_key_the_search_and_three_flags():
    shared = Shared()
    write_facts(shared, [WAITING], datetime(2026, 11, 17, tzinfo=UTC))  # type: ignore[arg-type]

    [part] = shared.objects.values()
    [line] = gzip.decompress(part).decode("utf-8").splitlines()
    assert json.loads(line) == {
        "key": WAITING.key,
        "status": "found",
        "reason": "named",
        "uncut": False,
        "cutNamed": False,
        "waiting": True,
    }


def test_a_status_or_reason_that_is_not_a_code_is_not_written():
    shared = Shared()
    odd = CandidacyFacts(FOUND.key, "Not Found", "https://bip.example/ Jan Kowalski")
    write_facts(shared, [odd], datetime(2026, 11, 17, tzinfo=UTC))  # type: ignore[arg-type]

    found = newest_facts(shared)  # type: ignore[arg-type]

    assert found is not None
    assert found.facts[odd.key] == CandidacyFacts(odd.key, "pending", "")


def test_no_part_yet_is_none():
    assert newest_facts(Shared()) is None  # type: ignore[arg-type]
