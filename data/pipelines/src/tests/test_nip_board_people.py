"""That the search bucket answers for the run's own NIPs, in the run's order.

`resolutions_from_bucket` used to take no argument and hardcode the 361
sponsorship NIPs, so `sponsorship_rejestrio resolve --cru` could fill the
bucket with 18,364 answers and the odpis stage would read back none of them.
The population being a parameter is the whole fix; these pin it, and the
ordering, which `--limit-companies` truncates on.
"""

import argparse
import json
import sys
import types

import pytest

from scrapers.krs.odpis_pdf import OdpisPerson
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
    fake._names_of = lambda payload: {
        str(h["krs"]): str(h["name"])
        for h in (payload.get("hits") or [])
        if h.get("krs") and h.get("name")
    }
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


def odpis_person(krs: str, surname: str) -> OdpisPerson:
    return OdpisPerson(
        krs=krs,
        dzial=2,
        rubryka="Organ uprawniony do reprezentacji podmiotu",
        role="reprezentacja",
        organ_name="ZARZĄD",
        organ=None,
        position=1,
        surname=surname,
        given_names="JAN",
        funkcja="PREZES ZARZĄDU",
        birth_date="1970-01-01",
        sex="M",
        pesel_fingerprint="ff",
        has_pesel=True,
        is_company=False,
        entry_added="1",
        entry_removed="-",
    )


def test_a_row_carries_the_nip_that_joins_a_company_s_entries(tmp_path):
    """Several `krs` for one company, and nothing in the row saying so.

    EMITEL is two entries since the 2018 transformation. Without the taxpayer's
    own number a reader counts it twice and finds its pre-2018 board filed
    under a KRS that answers to no name they know.
    """
    open_entry, superseded = "0000716108", "0000482636"
    company = nip_board_people.nip_lookup.NipResolution(
        nip="5272703675",
        krs=open_entry,
        also_krs=(superseded,),
        name="EMITEL SPÓŁKA AKCYJNA",
    )
    people = [odpis_person(open_entry, "NOWAK"), odpis_person(superseded, "KOWALSKI")]
    path = tmp_path / "people.jsonl"
    nip_board_people.write_output(
        path, people, {open_entry: company, superseded: company}, []
    )

    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [r["nip"] for r in rows] == ["5272703675", "5272703675"]
    assert [r["krs_is_open_entry"] for r in rows] == [True, False]


def named_answer(nip: str, *pairs: tuple[str, str]) -> dict:
    """A stored search answer that carries the register's name for each entry."""
    return {"nip": nip, "hits": [{"krs": k, "name": n} for k, n in pairs]}


def test_each_entry_is_named_as_the_register_printed_it(bucket, monkeypatch):
    """`nazwa` was parsed and stored all along, and nothing ever read it.

    On a `--nip-list` source there is no party text, so a company was named
    only if `companies_merged` happened to hold it -- and these are CRU
    counterparties, most of which it does not. The two entries of a transformed
    company also have different names, and using the open one's for both would
    hide which era a board sat in.
    """
    bucket["1111111111"] = named_answer(
        "1111111111",
        ("0000716108", "EMITEL SPÓŁKA AKCYJNA"),
        ("0000482636", "EMITEL SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"),
    )
    seen: dict[str, str] = {}
    monkeypatch.setattr(
        nip_board_people,
        "fetch_and_match",
        lambda args, resolutions, salt, known_names=None, *rest: (
            seen.update(known_names or {}) or ([], {}, [])
        ),
    )
    nip_board_people.from_search_bucket(
        resolve_only_args(resolve_only=False),
        rows=[],
        nips=["1111111111"],
        salt="k",
    )
    assert seen == {
        "0000716108": "EMITEL SPÓŁKA AKCYJNA",
        "0000482636": "EMITEL SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    }


def test_also_krs_names_entries_no_nip_of_ours_reaches(tmp_path):
    """Re-keying the artifact is the case the NIP-keyed chain cannot serve.

    `krs_odpis_people` holds 255 entries and only 64 reverse to a NIP through
    `companies_merged` or the search bucket, so without naming entries directly
    a republish would have dropped 6,281 rows on the floor.
    """
    path = tmp_path / "krs.txt"
    path.write_text("9458\n0000017753\n\n0000017753\n", encoding="utf-8")
    out = nip_board_people.resolutions_for_krs(path, {"0000009458": "1111111111"})
    # Padded, deduplicated, and keyed so that entries with no NIP do not all
    # collapse onto one empty-string key.
    assert sorted(out) == ["krs:0000009458", "krs:0000017753"]
    assert out["krs:0000009458"].krs == "0000009458"
    assert out["krs:0000009458"].nip == "1111111111"
    assert out["krs:0000017753"].nip == ""


def test_also_krs_skips_what_the_population_already_covers(tmp_path, capsys):
    already = nip_board_people.nip_lookup.NipResolution(
        nip="1111111111", krs="0000000002", also_krs=("0000000001",)
    )
    path = tmp_path / "krs.txt"
    path.write_text("0000000001\n0000000003\n", encoding="utf-8")
    extra = nip_board_people.add_named_entries(
        argparse.Namespace(also_krs=str(path)), {"1111111111": already}, {}
    )
    # 0000000001 is already reached, as a superseded entry of the same company.
    assert sorted(extra) == ["krs:0000000003"]
    assert "1 of 2 already in the population" in capsys.readouterr().out


def test_no_also_krs_adds_nothing():
    assert nip_board_people.add_named_entries(argparse.Namespace(), {}, {}) == {}


def test_the_unresolved_count_is_about_nips_only(capsys):
    """`--also-krs` entries share the dict and are not NIPs.

    Counted among them, a run that named 251 entries reported "no KRS number
    yet: -167", which is not a quantity of anything.
    """
    resolutions = {
        "1111111111": nip_board_people.nip_lookup.NipResolution(
            nip="1111111111", krs="0000000001", source="search"
        ),
        "krs:0000000002": nip_board_people.nip_lookup.NipResolution(
            nip="", krs="0000000002", source="krs-list"
        ),
    }
    nip_board_people.report_resolution(["1111111111", "2222222222"], resolutions)
    out = capsys.readouterr().out
    assert "no KRS number yet                   1" in out
    assert "odpisy to fetch                     2" in out


def test_an_entry_reached_by_no_nip_writes_null_not_empty_string(tmp_path):
    """`--also-krs` sets "" for an entry no NIP of ours reaches.

    Published as "" it would be a second spelling of "unknown" beside null,
    which is exactly the sort of thing that survives until somebody's `IS NULL`
    quietly misses 191 rows.
    """
    company = nip_board_people.nip_lookup.NipResolution(
        nip="", krs="0000000001", source="krs-list"
    )
    path = tmp_path / "people.jsonl"
    nip_board_people.write_output(
        path, [odpis_person("0000000001", "NOWAK")], {"0000000001": company}, []
    )
    row = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert row["nip"] is None
