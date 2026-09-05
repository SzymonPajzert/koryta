"""Notes the pipeline writes onto people's pages.

A note is the first thing the pipelines say on a page in prose rather than as
a field. Scores are an opinion the site aggregates and employments are
revisioned facts; this is a paragraph a reader reads, so what it takes to write
one is deliberately stricter than what it takes to propose a fact.

Today there is one of them. `PeopleWikiNotes` copies the opening paragraph of a
person's Wikipedia article onto their page, which is the sentence that says who
they are - the thing every other section of the page assumes you already know.

Two gates stand in front of it, and both are about identity rather than about
text:

* the page has to link to that article already. The link is a stored field
  somebody can see and correct; a note derived from it says nothing the page
  does not already claim. Matching an article to a page here instead would put
  a stranger's biography on somebody's profile the first time the matcher was
  wrong, with no revision review in between.
* the register's date of birth and the article's have to agree to the day.
  `analysis/people.py` accepts a year-only article on the year alone, because
  otherwise no article that gives only a year can match anybody - and of the
  ten matches that leant on that branch, nine were somebody else. That price is
  worth paying for a candidate list. It is not worth paying for prose.
"""

import typing
import urllib.parse
from dataclasses import asdict

import pandas as pd

from analysis.people import PeopleEnriched
from entities.composite import PersonNote
from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline

#: The uid these notes are stored under. Contains "pipeline", which is what
#: `isPipelineUid` on the frontend and `is_pipeline_uid` here read as
#: non-human, and names the source after it so a reader of the raw collection
#: can tell where a note came from.
WIKIPEDIA_MODEL = "pipeline-wikipedia"


def article_key(url: str | None) -> str | None:
    """A Wikipedia url reduced to the article it names.

    The same article reaches us spelled several ways: the pipelines build
    `https://pl.wikipedia.org/wiki/Jan_Pamuła_(ekonomista)` from a title, a
    browser copies it back percent-encoded, and somebody pasting one by hand
    may leave the spaces in or add a fragment. Comparing the raw strings would
    read those as different articles and drop the note.

    Returns None for anything that is not an article url, which is how a page
    linking to a category or to another language's Wikipedia is left alone.
    """
    if not isinstance(url, str) or not url.strip():
        return None
    parsed = urllib.parse.urlsplit(url.strip())
    if not parsed.netloc.lower().endswith("wikipedia.org"):
        return None
    prefix, sep, title = parsed.path.partition("/wiki/")
    if not sep or prefix not in ("", "/"):
        return None
    title = urllib.parse.unquote(title).replace(" ", "_").strip("/")
    if not title or ":" in title:
        return None
    # The host is part of the answer: pl and en hold different articles under
    # the same title, and the lead we hold came from the Polish dump.
    return f"{parsed.netloc.lower()}/{title}"


def same_day(left: typing.Any, right: typing.Any) -> bool:
    """Whether two dates of birth name the same day.

    Compared as the first ten characters of each, because the two sides are
    written by different scrapers: the register's is a date and the article's
    an ISO string, and either can arrive carrying a time. A missing date on
    either side is not agreement - it is the absence of the check, and this
    gate exists precisely to refuse those.
    """
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    return len(left) >= 10 and left[:10] == right[:10]


class PeopleWikiNotes(Pipeline[PersonNote]):
    """The Wikipedia opening paragraph for every page that already links to it.

    Emits one row per person, in the shape `koryta_uploader --type note` reads.
    The upload reconciles the whole uid at once, so a person who stops
    qualifying - the link was corrected, the dates stopped agreeing - has the
    note taken back rather than left standing.
    """

    filename = "people_wiki_notes"

    people: PeopleEnriched
    koryta: KorytaPeople

    @property
    def output_class(self) -> typing.Type:
        return PersonNote

    def process(self, ctx: Context):
        pages = self.linked_pages(ctx)
        leads = self.leads(ctx)

        notes: list[PersonNote] = []
        counts = {
            "pages linked to an article": len(pages),
            "the dump has a lead for": 0,
            "dates of birth agree": 0,
        }
        for key, (node_id, name) in pages.items():
            lead = leads.get(key)
            if lead is None:
                continue
            counts["the dump has a lead for"] += 1
            if not same_day(lead["birth_date"], lead["wiki_birth_date"]):
                continue
            counts["dates of birth agree"] += 1
            notes.append(
                PersonNote(
                    node_id=node_id,
                    name=name,
                    url=lead["url"],
                    note=lead["lead"],
                    model=WIKIPEDIA_MODEL,
                )
            )

        for label, count in counts.items():
            print(f"  {count:6d}  {label}")

        if not notes:
            return pd.DataFrame(
                columns=["node_id", "name", "url", "note", "kind", "model"]
            )
        return pd.DataFrame.from_records([asdict(note) for note in notes])

    def linked_pages(self, ctx: Context) -> dict[str, tuple[str, str]]:
        """Article key -> the page that links to it, from the site's export.

        An article two pages both link to is dropped rather than written to
        both: the pages are either duplicates of one person or a mismatch, and
        pasting the same biography onto both would assert they are the same
        human. `scripts/merge-duplicate-people.ts` is where that gets decided,
        not here.
        """
        export = self.koryta.read_or_process(ctx)
        pages: dict[str, tuple[str, str]] = {}
        contested: set[str] = set()
        for row in export.to_dict(orient="records"):
            key = article_key(row.get("wikipedia"))
            if key is None:
                continue
            if key in pages and pages[key][0] != row["id"]:
                contested.add(key)
            pages[key] = (str(row["id"]), str(row.get("full_name") or ""))
        for key in contested:
            pages.pop(key, None)
        if contested:
            print(f"{len(contested)} articles are linked from more than one page")
        return pages

    def leads(self, ctx: Context) -> dict[str, dict]:
        """Article key -> its opening paragraph and the two dates of birth.

        Read off `people_enriched` rather than off the wiki table directly,
        because the register's date of birth is what the article's has to agree
        with, and the merged table is the only place the two sit on one row.
        """
        people = self.people.read_or_process(ctx)
        missing = [
            column
            for column in ("wiki_url", "wiki_lead", "wiki_birth_date", "birth_date")
            if column not in people.columns
        ]
        if missing:
            raise ValueError(
                f"people_enriched is missing {missing}. The wiki lead is added by "
                "ProcessWiki and carried through PeopleWikiMerged and "
                "PeopleMerged, so an artifact written before it existed has to "
                "be rebuilt: koryta PeopleEnriched --refresh ProcessWiki "
                "--refresh all"
            )

        leads: dict[str, dict] = {}
        for row in people[
            ["wiki_url", "wiki_lead", "wiki_birth_date", "birth_date"]
        ].to_dict(orient="records"):
            key = article_key(row["wiki_url"])
            lead = row["wiki_lead"]
            if key is None or not isinstance(lead, str) or not lead.strip():
                continue
            # First one wins. `remove_duplicates` has already run, and where two
            # rows still name one article they carry the same lead - only the
            # dates could differ, and a row whose dates disagree is one this
            # pipeline drops anyway.
            leads.setdefault(
                key,
                {
                    "url": row["wiki_url"],
                    "lead": lead.strip(),
                    "wiki_birth_date": row["wiki_birth_date"],
                    "birth_date": row["birth_date"],
                },
            )
        return leads
