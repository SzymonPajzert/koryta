"""Which of the site's not-public companies hold its koryciarze."""

import numpy as np
import pandas as pd

from analysis.likely_public import KORYCIARZ, likely_public

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
