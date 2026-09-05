"""Which people get a Wikipedia lead paragraph on their page, and which do not.

The two gates are the whole pipeline. Everything else is a join, and the join
is tested where it lives (`analysis/people.py`); what is tested here is the
refusals, because each of them is a stranger's biography not appearing on
somebody's profile.
"""

import pandas as pd

from analysis.notes import PeopleWikiNotes, article_key, same_day
from scrapers.stores import Pipeline

ARTICLE = "https://pl.wikipedia.org/wiki/Jan_Pamuła"
LEAD = "Jan Pamuła (ur. 24 czerwca 1951 w Bielsku-Białej) – polski polityk."


class TestArticleKey:
    def test_reads_the_spellings_of_one_article_as_one_article(self):
        # The pipelines build the url from a title, a browser copies it back
        # percent-encoded, and somebody pasting one by hand leaves the spaces
        # in. Comparing the raw strings would read those as three articles.
        percent = "https://pl.wikipedia.org/wiki/Jan_Pamu%C5%82a"
        spaces = "https://pl.wikipedia.org/wiki/Jan Pamuła"
        assert article_key(ARTICLE) == article_key(percent) == article_key(spaces)

    def test_keeps_the_language_apart(self):
        # pl and en hold different articles under the same title, and the lead
        # we hold came out of the Polish dump.
        assert article_key(ARTICLE) != article_key(
            "https://en.wikipedia.org/wiki/Jan_Pamuła"
        )

    def test_refuses_anything_that_is_not_an_article(self):
        for url in [
            None,
            "",
            "   ",
            "https://rejestr.io/osoby/123",
            "https://pl.wikipedia.org/wiki/Kategoria:Polscy_politycy",
            "https://pl.wikipedia.org/w/index.php?title=Jan_Pamuła",
        ]:
            assert article_key(url) is None


class TestSameDay:
    def test_agreement_needs_both_dates(self):
        # A missing date is not agreement - it is the absence of the check,
        # which is the thing this gate exists to refuse.
        assert same_day("1951-06-24", "1951-06-24")
        assert not same_day("1951-06-24", None)
        assert not same_day(None, None)
        assert not same_day(float("nan"), "1951-06-24")

    def test_a_year_is_not_a_day(self):
        assert not same_day("1951", "1951")

    def test_ignores_a_time_either_source_carries(self):
        assert same_day("1951-06-24T00:00:00", "1951-06-24")


def pipeline(export: list[dict], people: list[dict]) -> PeopleWikiNotes:
    """`PeopleWikiNotes` with both of its inputs stubbed out.

    Built through `Pipeline.create` so the dependency objects exist, then given
    their answers directly - the two upstreams are a Firestore export and a
    duckdb join, and neither is what these tests are about.
    """
    notes = Pipeline.create(PeopleWikiNotes)
    notes.koryta._cached_result = pd.DataFrame.from_records(export)
    notes.people._cached_result = pd.DataFrame.from_records(
        people,
        columns=["wiki_url", "wiki_lead", "wiki_birth_date", "birth_date"],
    )
    return notes


def page(node_id: str, wikipedia: str | None = ARTICLE) -> dict:
    return {"id": node_id, "full_name": f"Osoba {node_id}", "wikipedia": wikipedia}


def matched(
    lead: str | None = LEAD,
    wiki_birth_date: str | None = "1951-06-24",
    birth_date: str | None = "1951-06-24",
    url: str = ARTICLE,
) -> dict:
    return {
        "wiki_url": url,
        "wiki_lead": lead,
        "wiki_birth_date": wiki_birth_date,
        "birth_date": birth_date,
    }


def run(export, people) -> pd.DataFrame:
    return pipeline(export, people).process(ctx=None)


class TestPeopleWikiNotes:
    def test_writes_the_lead_onto_a_page_that_links_to_the_article(self):
        notes = run([page("n1")], [matched()])

        assert len(notes) == 1
        row = notes.iloc[0]
        assert row["node_id"] == "n1"
        assert row["note"] == LEAD
        assert row["url"] == ARTICLE
        assert row["kind"] == "source"
        # Under a uid that reads as non-human, or the site would count the note
        # as somebody having reviewed the page.
        assert "pipeline" in row["model"]

    def test_says_nothing_about_a_page_with_no_link(self):
        # The link is the page's own claim, made by somebody who can be
        # corrected. Matching an article here instead would put a stranger's
        # biography on a profile with no review in between.
        assert run([page("n1", wikipedia=None)], [matched()]).empty
        assert run([page("n1", wikipedia="")], [matched()]).empty

    def test_says_nothing_when_the_page_links_to_a_different_article(self):
        export = [page("n1", "https://pl.wikipedia.org/wiki/Jan_Pamuła_(informatyk)")]
        assert run(export, [matched()]).empty

    def test_refuses_a_match_made_on_the_year_alone(self):
        # `analysis/people.py` accepts a year-only article on the year, because
        # otherwise such an article can never match anybody. Nine of the ten
        # matches that leant on that branch were somebody else, which is a
        # price worth paying for a candidate list and not for prose.
        assert run([page("n1")], [matched(wiki_birth_date=None)]).empty

    def test_refuses_dates_that_disagree(self):
        assert run([page("n1")], [matched(wiki_birth_date="1951-06-25")]).empty

    def test_says_nothing_when_the_dump_has_no_lead(self):
        assert run([page("n1")], [matched(lead=None)]).empty
        assert run([page("n1")], [matched(lead="   ")]).empty

    def test_leaves_an_article_two_pages_both_claim_alone(self):
        # The two pages are either one person twice or a mismatch. Writing the
        # same biography onto both would assert they are the same human, which
        # is a merge and belongs to whoever decides those.
        assert run([page("n1"), page("n2")], [matched()]).empty
