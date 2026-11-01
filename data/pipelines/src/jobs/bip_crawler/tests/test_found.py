"""`koryta_scrape_bip found`: what the night is handed of the people mode's
outcomes."""

import gzip
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from jobs.bip_crawler import build_parser
from jobs.bip_crawler.found import cmd_found, publish_found
from scrapers.stores import PersonRow, with_outcomes
from stores.bip_people import MemoryBipPeopleStore


def candidacy(key: str, priority: int, year: int = 2024) -> PersonRow:
    return PersonRow(
        key, "146501", priority, year, "Jan", "Kowalski", {"rejestrio_ids": [key]}
    )


def test_only_the_found_go_to_the_night_most_wanted_first(capsys):
    """Unconfirmed is a file no link names the person in: maybe a stranger's."""
    store = MemoryBipPeopleStore()
    listed = [
        candidacy("published", 3),
        candidacy("old-draft", 0, 2014),
        candidacy("no-page", 2),
        candidacy("draft", 0),
        candidacy("unconfirmed", 0),
        candidacy("missing", 0),
    ]
    for key in ("published", "old-draft", "no-page", "draft"):
        store.record_person(key, "found", "", 1, "run")
    store.record_person("unconfirmed", "unconfirmed", "", 2, "run")
    store.record_person("missing", "not_found", "not_listed", 0, "run")
    written: dict[str, bytes] = {}

    def create_object(bucket, name, data, content_type):
        written[name] = data
        return f"gs://{bucket}/{name}"

    client = SimpleNamespace(create_object=create_object)

    url = publish_found(
        with_outcomes(listed, store.searched()),
        client,  # type: ignore[arg-type]
        datetime(2026, 10, 31, 9, 30, tzinfo=UTC),
    )

    [(name, part)] = written.items()
    assert url == f"gs://koryta-pl-sharedcache/{name}"
    lines = [json.loads(line) for line in gzip.decompress(part).splitlines()]
    assert [line["key"] for line in lines] == [
        "draft",
        "old-draft",
        "no-page",
        "published",
    ]
    assert "4 candidacies, 4 rejestr.io entries; by priority {0: 2, 2: 1, 3: 1}" in (
        capsys.readouterr().out
    )


def test_who_is_found_is_the_night_s_list_s_word(capsys):
    """A page made, or a draft dated, since the crawl found the declaration: the
    part says so, and a candidacy the list dropped is not in it."""
    store = MemoryBipPeopleStore()
    store.record_person("draft", "found", "", 1, "run")
    store.record_person("gone", "found", "", 1, "run")
    dated = PersonRow(
        "draft", "146501", 1, 2024, "Jan", "Kowalski", {"koryta_ids": ["page"]}
    )
    written: dict[str, bytes] = {}

    def create_object(bucket, name, data, content_type):
        written[name] = data
        return name

    client = SimpleNamespace(create_object=create_object)
    publish_found(with_outcomes([dated], store.searched()), client, datetime.now(UTC))  # type: ignore[arg-type]

    [part] = written.values()
    [line] = [json.loads(line) for line in gzip.decompress(part).splitlines()]
    assert (line["key"], line["priority"], line["koryta_ids"]) == ("draft", 1, ["page"])


def test_a_dry_run_counts_and_writes_nothing(monkeypatch, capsys):
    store = MemoryBipPeopleStore()
    store.record_person("draft", "found", "", 1, "run")
    closed: list[bool] = []
    pg = SimpleNamespace(close=lambda: closed.append(True))
    monkeypatch.setattr(
        "jobs.bip_crawler.found.PostgresClient.from_env", lambda **kwargs: pg
    )
    monkeypatch.setattr(
        "jobs.bip_crawler.found.PostgresBipPeopleStore", lambda given: store
    )
    monkeypatch.setattr(
        "jobs.bip_crawler.found.setup_context", lambda **kwargs: (None, None)
    )
    monkeypatch.setattr(
        "jobs.bip_crawler.people_list.read_list", lambda ctx: [candidacy("draft", 0)]
    )

    def no_client():
        raise AssertionError("a dry run opens no bucket")

    monkeypatch.setattr("jobs.bip_crawler.found.Client", no_client)
    args = build_parser().parse_args(["found", "--dry-run"])

    assert args.func is cmd_found
    assert cmd_found(args) == 0
    assert closed == [True]
    assert "Found a declaration for 1 candidacies" in capsys.readouterr().out
