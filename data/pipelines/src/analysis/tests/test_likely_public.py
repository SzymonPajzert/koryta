"""Which of the site's not-public companies hold its koryciarze."""

import numpy as np
import pandas as pd

from analysis.likely_public import (
    KORYCIARZ,
    CompaniesLikelyPublic,
    likely_public,
    owner_history,
    public_company_names,
)
from scrapers.krs.odpis_history import PeselKeyMissing

POSTDATA = "0000117218"
POCZTA = "0000334972"
PRIVATE = "0000000001"


def place(node, krs, is_public, name=None):
    return {
        "id": node,
        "type": "place",
        "name": name or node,
        "krsNumber": krs,
        "isPublic": is_public,
        "legalForm": "SPÓŁKA AKCYJNA",
    }


def employed(person, node, deleted=np.nan):
    return {"type": "employed", "source": person, "target": node, "deleted": deleted}


def person(node, score=None, published=False, parties=(), merged_into=None):
    return {
        "id": node,
        "votes_interesting": score,
        "is_public": published,
        "parties": list(parties),
        "merged_into": merged_into,
    }


NODES = pd.DataFrame(
    [
        place("postdata", POSTDATA, False, "POSTDATA (Bydgoszcz)"),
        place("poczta", POCZTA, True),
        place("private", PRIVATE, None),
        {"id": "teryt04", "type": "region", "name": "Kujawsko-pomorskie"},
    ]
)
PEOPLE = pd.DataFrame(
    [
        person("a", score=KORYCIARZ, parties=["PO"]),
        person("b", published=True),
        person("c", score=KORYCIARZ + 1),
        person("d", score=KORYCIARZ - 1),
    ]
)
COMPANIES = pd.DataFrame({"krs": [POSTDATA, POCZTA], "is_public": [False, True]})


def edges(*rows):
    return pd.DataFrame(list(rows))


def leads(edge_rows, people=PEOPLE, companies=COMPANIES):
    return likely_public(NODES, edges(*edge_rows), people, companies).set_index("krs")


def test_a_company_full_of_koryciarze_heads_the_list():
    df = leads(
        [
            employed("a", "postdata"),
            employed("b", "postdata"),
            employed("c", "postdata"),
            employed("d", "private"),
        ]
    )

    assert list(df.index) == [POSTDATA, PRIVATE]
    assert df.loc[POSTDATA, "people"] == 3
    assert df.loc[POSTDATA, "koryciarze"] == 3
    assert df.loc[PRIVATE, "koryciarze"] == 0


def test_a_company_the_site_calls_public_is_not_a_lead():
    df = leads([employed("a", "poczta")])

    assert POCZTA not in df.index


def test_a_published_page_counts_like_a_koryciarz_score():
    df = leads([employed("b", "postdata"), employed("d", "postdata")])

    assert df.loc[POSTDATA, "koryciarze"] == 1


def test_a_removed_post_does_not_count():
    df = leads([employed("a", "postdata"), employed("c", "postdata", deleted=1.0)])

    assert df.loc[POSTDATA, "people"] == 1


def test_a_merged_page_does_not_count_twice():
    people = pd.concat(
        [PEOPLE, pd.DataFrame([person("a2", score=5, merged_into="a")])],
        ignore_index=True,
    )
    df = leads([employed("a", "postdata"), employed("a2", "postdata")], people=people)

    assert df.loc[POSTDATA, "people"] == 1


def test_party_candidacy_and_public_posts_are_counted_among_the_koryciarze():
    df = leads(
        [
            employed("a", "postdata"),
            employed("b", "postdata"),
            employed("c", "postdata"),
            employed("b", "poczta"),
            {"type": "election", "source": "c", "target": "teryt04"},
        ]
    )

    assert df.loc[POSTDATA, "political"] == 2  # a's party, c's candidacy
    assert df.loc[POSTDATA, "also_public"] == 1  # b at Poczta Polska


def test_it_says_when_the_pipeline_already_calls_the_company_public():
    companies = pd.DataFrame({"krs": [POSTDATA], "is_public": [True]})
    df = leads([employed("a", "postdata")], companies=companies)

    assert bool(df.loc[POSTDATA, "public_in_pipeline"])


def owner(krs, name, until=None, current=False, role="wspolnik"):
    return {
        "krs": krs,
        "role": role,
        "full_name": name,
        "date_removed": until,
        "current": current,
    }


PUBLIC_NAMES = public_company_names(
    pd.DataFrame({"name": ["POCZTA POLSKA"], "is_public": [True]})
)


def history(*rows, last_entry="2020-01-01", last_entry_is="WYKREŚLENIE Z KRS"):
    entries = pd.DataFrame(
        [
            {"krs": POSTDATA, "entry_date": "1999-01-01", "description": "REJESTRACJA"},
            {"krs": POSTDATA, "entry_date": last_entry, "description": last_entry_is},
        ]
    )
    return owner_history(pd.DataFrame(list(rows)), entries, None, PUBLIC_NAMES)


def test_a_public_owner_there_at_the_last_entry_held_to_the_end():
    found = history(
        owner(POSTDATA, "POCZTA POLSKA SPÓŁKA AKCYJNA", until="2020-01-01"),
    )

    assert found[POSTDATA] == ("POCZTA POLSKA SPÓŁKA AKCYJNA", "2020-01-01", True)


def test_entries_after_the_public_owner_left_leave_it_open():
    """The register names nobody after a sale of an SA, so no later owner shows."""
    found = history(
        owner(POSTDATA, "POCZTA POLSKA SPÓŁKA AKCYJNA", until="2011-11-18"),
        last_entry="2024-05-05",
    )

    assert not found[POSTDATA][2]


def test_a_public_owner_gone_from_a_live_company_was_not_held_to_the_end():
    """The last entry of a company still alive may be the sale itself."""
    found = history(
        owner(POSTDATA, "POCZTA POLSKA SPÓŁKA AKCYJNA", until="2020-01-01"),
        last_entry_is="ZMIANA DANYCH W REJESTRZE",
    )

    assert not found[POSTDATA][2]


def test_a_public_owner_still_listed_held_to_the_end():
    found = history(
        owner(POSTDATA, "POCZTA POLSKA SPÓŁKA AKCYJNA", current=True),
        owner(POSTDATA, "ASSECO POLAND SPÓŁKA AKCYJNA", current=True),
    )

    assert found[POSTDATA] == ("POCZTA POLSKA SPÓŁKA AKCYJNA", None, True)


def test_a_company_no_public_owner_ever_held_has_no_history():
    assert history(owner(POSTDATA, "ASSECO POLAND SPÓŁKA AKCYJNA", current=True)) == {}


def test_a_seat_that_is_no_owner_does_not_count():
    found = history(owner(POSTDATA, "POCZTA POLSKA SPÓŁKA AKCYJNA", role="nadzor"))

    assert found == {}


def test_a_held_public_owner_comes_before_one_that_left_and_any_crowd():
    nodes = pd.DataFrame(
        [
            place("crowd", "0000000002", False),
            place("left", "0000000003", False),
            place("held", "0000000004", False),
            {**place("chamber", "0000000005", False), "legalForm": "IZBA GOSPODARCZA"},
        ]
    )
    rows = (
        [employed(p, "crowd") for p in "abc"]
        + [employed(p, "chamber") for p in "abc"]
        + [
            employed("a", "left"),
            employed("d", "held"),
        ]
    )
    df = likely_public(
        nodes,
        edges(*rows),
        PEOPLE,
        COMPANIES,
        {
            "0000000003": ("GMINA X", "2010-01-01", False),
            "0000000004": ("GMINA Y", "2010-01-01", True),
        },
    )

    assert list(df["node"]) == ["held", "left", "crowd", "chamber"]
    assert df.set_index("node").loc["chamber", "membership_body"]


class Source:
    """A declared source: `refreshed` says whether it was read at all."""

    _refreshed_execution = False

    def __init__(self, fails=False):
        self.fails = fails
        self.read = False

    def read_or_process(self, ctx):
        self.read = True
        if self.fails:
            raise PeselKeyMissing("no key")
        return pd.DataFrame()


def test_a_machine_without_the_pesel_key_still_gets_its_leads():
    """The GitHub nightly has neither the key nor a copy of the seats to restore."""
    pipeline = CompaniesLikelyPublic.__new__(CompaniesLikelyPublic)
    pipeline.seats = Source(fails=True)
    pipeline.entries = Source()

    assert pipeline.read_history(None, COMPANIES) == {}
    assert not pipeline.entries.read


def test_the_odpisy_are_not_read_before_process():
    pipeline = CompaniesLikelyPublic.__new__(CompaniesLikelyPublic)
    seats, entries, nodes = Source(fails=True), Source(), Source()
    pipeline.dependencies = {"seats": seats, "entries": entries, "nodes": nodes}

    assert pipeline.preprocess_sources(None, None) is False
    assert nodes.read and not seats.read and not entries.read
