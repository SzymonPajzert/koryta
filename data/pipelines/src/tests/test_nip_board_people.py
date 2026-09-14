"""That the search bucket answers for the run's own NIPs, in the run's order.

`resolutions_from_bucket` used to take no argument and hardcode the 361
sponsorship NIPs, so `sponsorship_rejestrio resolve --cru` could fill the
bucket with 18,364 answers and the odpis stage would read back none of them.
The population being a parameter is the whole fix; these pin it, and the
ordering, which `--limit-companies` truncates on.
"""

import argparse
import sys
import types

import pytest

from scripts import nip_board_people


def answer(nip: str, *krs: str) -> dict:
    """A stored search answer, in the shape `cached_answers` returns."""
    return {"nip": nip, "hits": [{"krs": k} for k in krs]}


@pytest.fixture
def bucket(monkeypatch):
    """Stand in for the crawl bucket, so no test touches GCS."""
    stored: dict[str, dict] = {}
    fake = types.ModuleType("scripts.sponsorship_rejestrio")
    fake.cached_answers = lambda ctx: stored
    fake._krs_of = lambda payload: (
        str(payload["hits"][0]["krs"])
        if len(payload.get("hits") or []) == 1 and payload["hits"][0].get("krs")
        else None
    )
    monkeypatch.setitem(sys.modules, "scripts.sponsorship_rejestrio", fake)
    monkeypatch.setattr(nip_board_people, "setup_context", lambda: (None, None))
    return stored


def test_reads_the_nips_it_is_given_not_the_sponsorship_list(bucket):
    bucket.update(
        {
            "1111111111": answer("1111111111", "0000000001"),
            "2222222222": answer("2222222222", "0000000002"),
        }
    )
    resolutions = nip_board_people.resolutions_from_bucket(["2222222222"])
    assert list(resolutions) == ["2222222222"]
    assert resolutions["2222222222"].krs == "0000000002"
    assert resolutions["2222222222"].source == "search"


def test_keeps_the_source_order(bucket):
    for nip in ("3333333333", "1111111111", "2222222222"):
        bucket[nip] = answer(nip, "0000000009")
    # The bucket lists 3,1,2; the source asked in 1,2,3.
    asked = ["1111111111", "2222222222", "3333333333"]
    assert list(nip_board_people.resolutions_from_bucket(asked)) == asked


def test_a_multi_hit_answer_resolves_nothing(bucket):
    bucket["1111111111"] = answer("1111111111", "0000000001", "0000000002")
    assert nip_board_people.resolutions_from_bucket(["1111111111"]) == {}


def test_an_unasked_nip_is_absent(bucket):
    bucket["1111111111"] = answer("1111111111", "0000000001")
    assert nip_board_people.resolutions_from_bucket(["9999999999"]) == {}


def test_the_name_comes_from_the_source(bucket):
    bucket["1111111111"] = answer("1111111111", "0000000001")
    resolutions = nip_board_people.resolutions_from_bucket(
        ["1111111111"], {"1111111111": "FUNDACJA X"}
    )
    assert resolutions["1111111111"].name == "FUNDACJA X"


def source_args(**kwargs) -> argparse.Namespace:
    defaults: dict[str, object] = {
        "spreadsheet": None,
        "cru": None,
        "nip_list": None,
        "nip": [],
    }
    return argparse.Namespace(**{**defaults, **kwargs})


@pytest.mark.parametrize(
    "args, expected",
    [
        (source_args(), False),
        (source_args(spreadsheet="/tmp/x.csv"), True),
        # `--cru` takes an optional path, so the bare flag is the empty string.
        # Read as a boolean it is falsy, which made the whole source vanish.
        (source_args(cru=""), True),
        (source_args(cru="/tmp/cru.jsonl"), True),
        (source_args(nip_list="/tmp/nips.txt"), True),
        (source_args(nip=["1111111111"]), True),
    ],
)
def test_has_source(args, expected):
    assert nip_board_people.has_source(args) is expected


def test_a_cached_pair_keeps_its_place_in_the_population_order():
    """The bug this exists for: appending the fallbacks reorders the run.

    `pick_companies` truncates on `--limit-companies`, so a resolution dict
    ordered [every search hit] ++ [every companies_merged pair] makes a capped
    run cut by where the KRS came from rather than by the order the population
    was built in. On the real CRU population that dropped POLREGIO -- the
    largest counterparty in the register -- because its search answer has two
    hits and only `companies_merged` could settle it.
    """
    nips = ["1111111111", "2222222222", "3333333333"]
    from_bucket = {
        "1111111111": nip_board_people.nip_lookup.NipResolution(
            nip="1111111111", krs="0000000001", source="search"
        ),
        "3333333333": nip_board_people.nip_lookup.NipResolution(
            nip="3333333333", krs="0000000003", source="search"
        ),
    }
    merged = nip_board_people.merge_resolutions(
        nips, from_bucket, {"2222222222": "0000000002"}
    )
    assert list(merged) == nips
    assert [r.source for r in merged.values()] == ["search", "cache", "search"]


def test_the_bucket_wins_where_both_can_answer():
    """A search answer is the register replying today; a held pair is older."""
    from_bucket = {
        "1111111111": nip_board_people.nip_lookup.NipResolution(
            nip="1111111111", krs="0000000001", source="search"
        )
    }
    merged = nip_board_people.merge_resolutions(
        ["1111111111"], from_bucket, {"1111111111": "0000009999"}
    )
    assert merged["1111111111"].krs == "0000000001"


def test_a_nip_neither_source_can_answer_is_absent():
    merged = nip_board_people.merge_resolutions(["1111111111"], {}, {})
    assert merged == {}


def test_a_repeated_nip_is_resolved_once():
    """`distinct_nips` dedups, but merge_resolutions must not depend on it."""
    from_bucket = {
        "1111111111": nip_board_people.nip_lookup.NipResolution(
            nip="1111111111", krs="0000000001", source="search"
        )
    }
    merged = nip_board_people.merge_resolutions(
        ["1111111111", "1111111111"], from_bucket, {}
    )
    assert list(merged) == ["1111111111"]


def test_the_name_reaches_a_cached_resolution_too():
    merged = nip_board_people.merge_resolutions(
        ["1111111111"], {}, {"1111111111": "0000000002"}, {"1111111111": "POLREGIO"}
    )
    assert merged["1111111111"].name == "POLREGIO"
    assert merged["1111111111"].source == "cache"
