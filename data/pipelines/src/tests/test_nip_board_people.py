"""That the search bucket answers for the run's own NIPs, in the run's order.

`resolutions_from_bucket` used to take no argument and read a population this
module knew about, so `sponsorship_rejestrio resolve --cru` could fill the
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
    fake._krs_entries_of = lambda payload: nip_board_people.nip_lookup.newest_first(
        h.get("krs") for h in (payload.get("hits") or []) if h.get("krs")
    )
    monkeypatch.setitem(sys.modules, "scripts.sponsorship_rejestrio", fake)
    monkeypatch.setattr(nip_board_people, "setup_context", lambda: (None, None))
    return stored


def test_reads_only_the_nips_it_is_given(bucket):
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


def test_a_multi_hit_answer_is_one_taxpayer_not_none(bucket):
    """It used to resolve to nothing, on the reading that it meant two companies.

    A NIP belongs to one taxpayer, so the extra hits are its earlier register
    entries. Refusing them dropped 1,272 CRU recipients carrying 746 m PLN --
    EMITEL, TEXOM and CATERMED among them.
    """
    bucket["1111111111"] = answer("1111111111", "0000000001", "0000000002")
    resolutions = nip_board_people.resolutions_from_bucket(["1111111111"])
    resolution = resolutions["1111111111"]
    # The open entry first: KRS numbers are sequential, so the largest is the
    # latest registration and the earlier ones are what it superseded.
    assert resolution.krs == "0000000002"
    assert resolution.also_krs == ("0000000001",)
    assert resolution.krs_entries == ("0000000002", "0000000001")


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


def resolve_only_args(**kwargs) -> argparse.Namespace:
    defaults: dict[str, object] = {
        "companies_merged": "/nonexistent/companies_merged.jsonl",
        "resolve_only": True,
        "out": None,
        "keep_pesel": None,
        "publish": False,
        "show": False,
    }
    return argparse.Namespace(**{**defaults, **kwargs})


def test_resolve_only_fetches_no_odpisy_from_the_search_bucket(bucket, monkeypatch):
    """The wykaz path returned on `--resolve-only`; this one fell through it.

    So the flag that exists to say "where does this stand, fetch nothing"
    started a ~4 h crawl of the register instead -- on the CRU population,
    14,967 companies at one request each.
    """
    bucket["1111111111"] = answer("1111111111", "0000000001")

    def refuse(*_args, **_kwargs):
        raise AssertionError("--resolve-only must not reach the odpis stage")

    monkeypatch.setattr(nip_board_people, "fetch_and_match", refuse)
    nip_board_people.from_search_bucket(
        resolve_only_args(), rows=[], nips=["1111111111"], salt="k"
    )


def test_without_resolve_only_the_search_bucket_path_does_fetch(bucket, monkeypatch):
    """The guard must not be the whole path: the default is still to fetch."""
    bucket["1111111111"] = answer("1111111111", "0000000001")
    calls: list[dict] = []
    monkeypatch.setattr(
        nip_board_people,
        "fetch_and_match",
        lambda args, resolutions, *rest: calls.append(resolutions) or ([], {}, []),
    )
    nip_board_people.from_search_bucket(
        resolve_only_args(resolve_only=False),
        rows=[],
        nips=["1111111111"],
        salt="k",
    )
    assert [list(c) for c in calls] == [["1111111111"]]


def resolution(nip: str, *krs: str) -> "nip_board_people.nip_lookup.NipResolution":
    entries = nip_board_people.nip_lookup.newest_first(krs)
    return nip_board_people.nip_lookup.NipResolution(
        nip=nip, krs=entries[0], also_krs=entries[1:], name=f"COMPANY {nip[:2]}"
    )


def test_every_register_entry_of_a_company_is_fetched():
    """The board of the years before a transformation is only in the old entry.

    EMITEL is the worked example: 0000482636 was struck out on 2018-02-27 and
    the business continues as 0000716108. Fetching only the open entry loses
    everyone who sat on the sp. z o.o. board, which is the history this chain
    exists to read.
    """
    resolutions = {
        "1111111111": resolution("1111111111", "0000482636", "0000716108"),
        "2222222222": resolution("2222222222", "0000000007"),
    }
    args = argparse.Namespace(limit_companies=None)
    krs_numbers, company_by_krs = nip_board_people.pick_companies(args, resolutions)
    assert krs_numbers == ["0000716108", "0000482636", "0000000007"]
    # Both entries point back at the taxpayer, so the odpis stage can name it.
    assert company_by_krs["0000482636"].nip == "1111111111"


def test_a_cap_cuts_between_companies_not_through_one():
    """Half a transformed company's history is worse than none of it.

    Nothing downstream records which entries a company had, so a run that
    fetched the open entry and not its predecessor would look complete.
    """
    resolutions = {
        "1111111111": resolution("1111111111", "0000000001", "0000000002"),
        "2222222222": resolution("2222222222", "0000000003"),
    }
    args = argparse.Namespace(limit_companies=2)
    krs_numbers, _ = nip_board_people.pick_companies(args, resolutions)
    assert krs_numbers == ["0000000002", "0000000001"]


def test_the_same_entry_under_two_nips_is_fetched_once():
    resolutions = {
        "1111111111": resolution("1111111111", "0000000001"),
        "2222222222": resolution("2222222222", "0000000001"),
    }
    args = argparse.Namespace(limit_companies=None)
    krs_numbers, _ = nip_board_people.pick_companies(args, resolutions)
    assert krs_numbers == ["0000000001"]
