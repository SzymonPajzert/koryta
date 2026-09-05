"""The opening paragraph of an article, which is what a wiki note carries.

Worth testing on its own rather than only through `test_extraction`, because
what makes a lead usable is what it leaves out: the infobox, the maintenance
banners, the disambiguation line and the markup. A lead that came through with
any of those in it would be pasted onto somebody's page as prose.
"""

import pytest

from scrapers.wiki.process_articles import (
    LEAD_MAX_CHARS,
    truncate_lead,
)
from scrapers.wiki.process_articles import (
    lead_paragraph as lead,
)


def test_unwraps_links_and_bold_into_prose():
    assert (
        lead(
            "'''Jan Pamuła''' (ur. [[12 marca]] [[1951]] w "
            "[[Bielsko-Biała|Bielsku-Białej]]) – polski [[polityk]], "
            "[[ekonomista]] i menedżer, poseł na [[Sejm]] I kadencji."
        )
        == "Jan Pamuła (ur. 12 marca 1951 w Bielsku-Białej) – polski polityk, "
        "ekonomista i menedżer, poseł na Sejm I kadencji."
    )


def test_skips_the_infobox_and_the_banners_above_the_text():
    # Everything between the top of an article and its first sentence is
    # templates - the hatnote, the infobox, the maintenance banners - so the
    # lead is found by skipping them rather than by knowing which is which.
    wikitext = (
        "{{Inne znaczenia|polityku|[[Jan Pamuła (informatyk)]]}}\n"
        "{{Polityk infobox\n"
        " |imię i nazwisko = Jan Pamuła\n"
        " |data urodzenia  = 24 czerwca 1951\n"
        "}}\n"
        "'''Jan Pamuła''' – polski polityk i ekonomista, poseł na Sejm "
        "I kadencji z ramienia Unii Demokratycznej."
    )
    assert lead(wikitext) == (
        "Jan Pamuła – polski polityk i ekonomista, poseł na Sejm I kadencji "
        "z ramienia Unii Demokratycznej."
    )


def test_passes_over_a_short_first_line():
    # A disambiguation note or a stray caption, left after the templates were
    # dropped. Short, and never the sentence that says who somebody is.
    wikitext = (
        "Zobacz też: Jan Kowalski.\n\n"
        "'''Jan Kowalski''' (ur. 1960) – polski samorządowiec i urzędnik, "
        "od 2015 prezes miejskiej spółki wodociągowej."
    )
    assert lead(wikitext) is not None
    assert lead(wikitext).startswith("Jan Kowalski (ur. 1960)")


def test_passes_over_a_list():
    # The bullet is what says this is not a sentence, and stripping the markup
    # is what removes it - which is why the lead is looked for in the wikitext.
    # Read the other way round, this would put a list item on somebody's page
    # in place of their biography.
    wikitext = "* pierwszy punkt listy, dostatecznie długi, by wyglądać jak akapit\n"
    assert lead(wikitext) is None


def test_has_no_lead_when_the_article_is_all_furniture():
    assert lead("{{Polityk infobox\n |imię i nazwisko = Jan Pamuła\n}}") is None


class TestTruncateLead:
    def test_leaves_a_paragraph_that_already_fits(self):
        assert truncate_lead("Krótki akapit.") == "Krótki akapit."

    def test_keeps_whole_sentences_and_cuts_at_the_last_one_that_fits(self):
        # A paragraph cut mid-clause reads as a broken note rather than a short
        # one, so the cut lands on the last full stop before the limit.
        first = "A" * 300 + "."
        second = " " + "B" * 300 + "."
        third = " " + "C" * 300 + "."
        assert truncate_lead(first + second + third) == first + second

    def test_falls_back_to_a_hard_cut_on_one_long_sentence(self):
        cut = truncate_lead("A" * (LEAD_MAX_CHARS * 2))
        assert len(cut) == LEAD_MAX_CHARS
        assert cut.endswith("…")


@pytest.mark.parametrize(
    "markup",
    [
        "<ref>{{Cytuj |tytuł=Kto jest kim |url=https://example.test}}</ref>",
        "{{fakt|data=2026-01}}",
        "<!-- komentarz redaktorski -->",
    ],
)
def test_drops_the_apparatus_around_a_sentence(markup):
    lead_text = lead(
        f"'''Jan Kowalski''' (ur. 1960) – polski samorządowiec{markup}, "
        "od 2015 prezes miejskiej spółki wodociągowej."
    )
    assert lead_text is not None
    for fragment in ("<ref", "{{", "http", "<!--"):
        assert fragment not in lead_text
