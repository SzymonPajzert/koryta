"""What `--only-changed` keeps, against a snapshot of what koryta.pl holds.

Every case here is a decision `frontend/server/api/ingest/person.post.ts` makes
for itself when the payload reaches it. A payload dropped by mistake is a fact
that never reaches the site and nothing to notice it by, so the cases that keep
a payload matter more than the ones that drop it.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import PeoplePayloads
from analysis.payloads.person import (
    canonical_name,
    collapsed_people,
    hyphenate_surname,
    one_register_entry,
)
from analysis.payloads.site import (
    ENDED_EMPLOYMENT,
    ENRICHED_CANDIDACY,
    MISSING_COMPANY,
    MOVED_CANDIDACY,
    NEW_CANDIDACY,
    NEW_EMPLOYMENT,
    NEW_PERSON,
    PERSON_FIELDS,
    UNRESOLVED_REGION,
    SiteSnapshot,
)
from entities.composite import Election, Person
from scrapers.koryta.download import KorytaNodes
from scrapers.stores import Context, Pipeline, ProcessPolicy

PERSON_ID = "person-1"
COMPANY_ID = "place-1"


def nodes(*extra, person=None):
    """The site's nodes: one person, one company, one region, plus `extra`."""
    stored_person = {
        "id": PERSON_ID,
        "type": "person",
        "name": "Jan Kowalski",
        "parties": ["PiS"],
        "rejestrIo": "https://rejestr.io/osoby/123",
    }
    stored_person.update(person or {})
    return pd.DataFrame.from_records(
        [
            stored_person,
            {
                "id": COMPANY_ID,
                "type": "place",
                "name": "Testowa S.A.",
                "krsNumber": "0000123456",
            },
            {"id": "teryt1465", "type": "region", "name": "Warszawa", "teryt": "1465"},
            *extra,
        ]
    )


def edges(*rows):
    return pd.DataFrame.from_records(list(rows)) if rows else pd.DataFrame()


def payload(**overrides):
    """The payload `PeoplePayloads` emits for the person the site already has."""
    base = {
        "name": "Jan Kowalski",
        "content": None,
        "companies": [],
        "elections": [],
        "sources": [],
        "parties": ["PiS"],
        "wikipedia": None,
        "rejestrIo": "https://rejestr.io/osoby/123",
        "birthDate": None,
    }
    base.update(overrides)
    return base


EMPLOYMENT = {
    "krs": "0000123456",
    "role": "Prezes",
    "start": "2020-01-01",
    "end": None,
}

STORED_EMPLOYMENT = {
    "id": "edge-employed-1",
    "type": "employed",
    "source": PERSON_ID,
    "target": COMPANY_ID,
    "name": "Prezes",
    "start_date": "2020-01-01",
}

CANDIDACY = {
    "election_type": "Samorząd",
    "committee": None,
    "election_year": "2024",
    "teryt": "1465",
    "party": None,
    "party_from_committee": False,
}

STORED_CANDIDACY = {
    "id": "edge-election-1",
    "type": "election",
    "source": PERSON_ID,
    "target": "teryt1465",
    "name": "kandydatura",
    "position": "Samorząd",
    "start_date": "2024-01-01",
}


def test_a_payload_the_site_already_holds_is_dropped():
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))

    assert (
        snapshot.changes(payload(companies=[EMPLOYMENT], elections=[CANDIDACY])) == []
    )


def test_a_person_the_site_does_not_have_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(
        payload(name="Anna Nowak", rejestrIo="https://rejestr.io/osoby/999")
    ) == [NEW_PERSON]


def test_a_new_spelling_of_a_stored_person_is_not_a_new_person():
    """The name is not the identity, and this is the whole duplicate bug.

    The pipeline picked a name out of a `list_distinct` whose order is a hash,
    so one human was "Andrzej Golimont" one run and "Andrzej Marcin Golimont"
    the next. Reading the second as somebody new is what filed 170 people under
    two pages each; the register entry is what says they are one. The most a
    fuller spelling does to the page is give it the middle name.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(name="Jan Marek Kowalski")) == [PERSON_FIELDS]
    assert snapshot.changes(payload(name="Jan Kowalsky")) == []


def test_a_middle_name_the_page_left_out_is_kept():
    """`updatedPerson` writes it in: 492 pages were made from the short form
    of a name the register also spells in full."""
    snapshot = SiteSnapshot(nodes(person={"name": "Antoni Sikoń"}), edges())

    assert snapshot.changes(payload(name="Antoni Ignacy Sikoń")) == [PERSON_FIELDS]


@pytest.mark.parametrize(
    "sent", ["Anna Nowak-Rudnik", "Anna Maria Nowak-Rudnik", "Anna Maria Nowak Rudnik"]
)
def test_the_hyphen_of_a_double_surname_the_page_spaces_is_kept(sent):
    """`updatedPerson` writes in the hyphen PKW or Wikipedia gives, as it does
    a middle name, and the two together."""
    snapshot = SiteSnapshot(nodes(person={"name": "Anna Nowak Rudnik"}), edges())

    assert snapshot.changes(payload(name=sent)) == [PERSON_FIELDS]


@pytest.mark.parametrize(
    ("stored", "sent"),
    [
        # The page has more than the payload; a name is never shortened.
        ("Antoni Ignacy Sikoń", "Antoni Sikoń"),
        # Another spelling, which `updatedPerson` leaves to whoever wrote the
        # page's - and which would otherwise keep the payload every night.
        ("Anna Kowalska", "Anna Maria Nowak"),
        ("Kamil Barczyk", "KAMIL SEBASTIAN BARCZYK"),
        # A hyphen the page has is never spaced again, and a hyphen is never
        # cover for another word or another case.
        ("Anna Nowak-Rudnik", "Anna Nowak Rudnik"),
        ("Anna Nowak Rudnik", "Anna Nowak-Rudnicka"),
        ("Anna Nowak Rudnik", "Anna NOWAK-Rudnik"),
    ],
)
def test_a_name_the_ingest_would_not_take_is_dropped(stored, sent):
    snapshot = SiteSnapshot(nodes(person={"name": stored}), edges())

    assert snapshot.changes(payload(name=sent)) == []


def test_a_namesake_with_another_register_entry_is_a_new_person():
    """And the other direction, which matching loosely would have made worse.

    Two strangers share a name; only the register tells them apart. 36 stored
    nodes have had one overwrite the other's `rejestrIo` already.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(rejestrIo="https://rejestr.io/osoby/456")) == [
        NEW_PERSON
    ]


#: A page `/api/nodes/merge` folded into the person's. It keeps the name and the
#: register link that find it, and the merge took its edges. Its id sorts before
#: the person's, so it is the page a query on either reads first.
MERGED_AWAY = {
    "id": "person-0",
    "type": "person",
    "name": "Jan Kowalski",
    "rejestrIo": "https://rejestr.io/osoby/123",
    "merged_into": PERSON_ID,
}


class TestAMergedAwayPage:
    """The ingest writes onto the page a merge leads to (`lookupNodeDoc`,
    `resolveMergedNode`), so that is the page a payload is compared with.
    Compared with the merged-away one, which has no edges, every job and
    candidacy read as new: 74 people of the 2026-10-12 night's plan were judged
    that way."""

    @staticmethod
    def site(person=None):
        """`nodes`, with the merged-away page ahead of the person's."""
        return pd.concat(
            [pd.DataFrame.from_records([MERGED_AWAY]), nodes(person=person)],
            ignore_index=True,
        )

    @staticmethod
    def landing(snapshot, sent):
        found = snapshot.resolve(sent)
        return (None if found.page is None else found.page["id"], found.how)

    def test_what_the_live_page_holds_is_not_news(self):
        snapshot = SiteSnapshot(self.site(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))
        sent = payload(companies=[EMPLOYMENT], elections=[CANDIDACY])

        assert self.landing(snapshot, sent) == (PERSON_ID, "rejestrIo")
        assert snapshot.changes(sent) == []

    def test_a_link_only_the_merged_away_page_holds_is_news_for_the_live_one(self):
        """Why the merged-away page stays in the register index rather than
        being left out of it: the ingest finds it by the link, and writes the
        link onto the page it was merged into."""
        snapshot = SiteSnapshot(
            self.site(person={"rejestrIo": None}), edges(STORED_EMPLOYMENT)
        )
        sent = payload(companies=[EMPLOYMENT])

        assert self.landing(snapshot, sent) == (PERSON_ID, "rejestrIo")
        assert snapshot.changes(sent) == [PERSON_FIELDS]

    def test_a_page_id_is_judged_by_the_live_page_its_birth_date_included(self):
        """`refuseAnotherBirthDate` reads the page the merge leads to: here the
        merged-away one stores no date, and the live one another than the
        payload's."""
        snapshot = SiteSnapshot(
            self.site(person={"birthDate": "1967-09-21"}), edges(STORED_EMPLOYMENT)
        )
        sent = payload(korytaId="person-0", rejestrIo=None, companies=[EMPLOYMENT])

        assert self.landing(snapshot, sent) == (PERSON_ID, "korytaId")
        assert snapshot.changes(sent) == []
        refused = snapshot.resolve(dict(sent, birthDate="1971-03-14"))
        assert (refused.page, refused.held) == (None, True)


def test_the_page_a_lookup_reads_first_is_the_lowest_id_in_any_frame_order():
    """`limit(1)` reads the match with the lowest document id, which is where
    the ingest writes when two pages hold one register link or one name. The
    frame is in id order only while its shards' names list in it."""
    later = {
        "id": "person-2",
        "type": "person",
        "name": "Jan Kowalski",
        "rejestrIo": "https://rejestr.io/osoby/123",
    }
    frame = pd.concat([pd.DataFrame.from_records([later]), nodes()], ignore_index=True)
    snapshot = SiteSnapshot(frame, edges(STORED_EMPLOYMENT))

    assert snapshot.person_for(payload())["id"] == PERSON_ID
    assert snapshot.person_for(payload(rejestrIo=None))["id"] == PERSON_ID
    assert snapshot.changes(payload(companies=[EMPLOYMENT])) == []


def test_a_party_the_node_does_not_carry_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS", "PSL"])) == [PERSON_FIELDS]


def test_a_party_the_node_already_carries_is_dropped():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS"])) == []


def test_a_party_added_to_a_list_a_person_stated_is_dropped():
    """`partiesSource: "manual"` and `updatedPerson` leaves the list alone.

    A person stated it, so a payload naming another party writes nothing - and
    every candidate of a coalition committee arrives naming both its parties.
    Read as a change, each pinned person was sent night after night, taking a
    place under the upload's cap to write nothing.
    """
    snapshot = SiteSnapshot(nodes(person={"partiesSource": "manual"}), edges())

    assert snapshot.changes(payload(parties=["PiS", "PSL"])) == []


def test_a_list_a_person_stated_does_not_stop_the_rest_being_learned():
    """Only `parties` is pinned; the node still learns everything else."""
    snapshot = SiteSnapshot(nodes(person={"partiesSource": "manual"}), edges())

    assert snapshot.changes(
        payload(parties=["PiS", "PSL"], birthDate="1967-09-20")
    ) == [PERSON_FIELDS]


@pytest.mark.parametrize(
    ("marker", "expected"),
    [("manual", []), (None, [PERSON_FIELDS])],
)
def test_the_marker_survives_the_trip_through_the_export(tmp_path, marker, expected):
    """What `SiteSnapshot` reads is `KorytaNodes`' output, narrowed to
    `NODE_FIELDS` and read back off disk with its dtypes. Leave the column out
    of `NODE_FIELDS` and the marker never arrives, so every pinned person is a
    change again; and the people without it, the column empty, must read as
    unpinned rather than trip over a NaN.
    """
    stored = nodes(person={"partiesSource": marker} if marker else {})
    path = tmp_path / "koryta_nodes.jsonl"
    stored.reindex(columns=KorytaNodes.fields).to_json(
        path, orient="records", lines=True
    )
    read = pd.read_json(path, lines=True, dtype=KorytaNodes.dtype)

    snapshot = SiteSnapshot(read, edges())

    assert snapshot.changes(payload(parties=["PiS", "PSL"])) == expected


def test_a_rejestr_io_link_the_node_lacks_is_kept():
    """Also the fallback match: 880 people predate the pipeline sending a
    register entry, and the name is the only thing left to find them by. The
    payload is kept because it has one to give them."""
    snapshot = SiteSnapshot(nodes(person={"rejestrIo": None}), edges())

    assert snapshot.changes(payload()) == [PERSON_FIELDS]


def test_a_birth_date_the_node_lacks_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(birthDate="1967-09-20")) == [PERSON_FIELDS]


def test_a_birth_date_the_node_already_carries_is_dropped():
    """`updatedPerson` fills this in and never rewrites it, so a payload that
    disagrees with a stored date writes nothing at all. A filter that counted
    the disagreement as a change would keep every one of the 106020 people the
    register has a date for, forever."""
    snapshot = SiteSnapshot(nodes(person={"birthDate": "1967-09-21"}), edges())

    assert snapshot.changes(payload(birthDate="1967-09-20")) == []


def test_an_empty_content_is_not_a_change():
    """`updatedPerson` learns nothing from a field the payload leaves blank."""
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(content="")) == []


def test_a_link_the_pipeline_does_not_have_is_not_a_change():
    """NaN is how a pandas row says "no Wikipedia page", not a link to write.

    `map_person_payload` reads these off a frame, so an absent link arrives as
    NaN rather than None - truthy, and unequal to itself. Counted literally it
    made every person without a Wikipedia page look outdated: 4186 of the 4341
    people on koryta.pl, against 189 that would really learn one.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(wikipedia=float("nan"))) == []


def test_an_employment_at_a_company_the_site_lacks_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())
    unknown = dict(EMPLOYMENT, krs="0000999999")

    assert snapshot.changes(payload(companies=[unknown])) == [MISSING_COMPANY]


def test_a_second_spell_at_one_company_is_kept():
    """Two spells differ in `start_date`, which is what makes them two facts."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))
    second = dict(EMPLOYMENT, start="2023-05-01")

    assert snapshot.changes(payload(companies=[EMPLOYMENT, second])) == [NEW_EMPLOYMENT]


def test_a_repeated_row_is_a_second_fact_the_site_may_not_have():
    """A payload stating one spell twice states two, and one stored edge is one.

    `findEdgeOrCreate` reads a repeat as a second fact rather than a duplicate,
    so the second row goes looking for a second stored edge and does not find
    one here. What it does when there *are* two is
    `test_a_repeated_row_matches_the_second_stored_spell`.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))

    assert snapshot.changes(payload(companies=[EMPLOYMENT, EMPLOYMENT])) == [
        NEW_EMPLOYMENT
    ]


def test_a_repeated_row_matches_the_second_stored_spell():
    """Two rows saying one thing, two stored edges saying it: nothing to write.

    This used to assert the opposite, mirroring an ingest that would have
    written a third edge here - `findEdgeOrCreate` counted a same-identity
    claim twice, once through `occurrence` and once by filtering it out, so the
    second row looked for index 1 of a one-element list and missed. Round-
    tripping the 31 August export found 826 groups on the site that a re-upload
    would have grown that way. The ingest now counts it once and so does this.
    """
    stored_twice = edges(
        STORED_EMPLOYMENT, dict(STORED_EMPLOYMENT, id="edge-employed-2")
    )

    assert (
        SiteSnapshot(nodes(), stored_twice).changes(
            payload(companies=[EMPLOYMENT, EMPLOYMENT])
        )
        == []
    )


def test_a_third_repeated_row_is_still_a_fact_the_site_lacks():
    """The collection settles at max(rows, stored), never below it."""
    stored_twice = edges(
        STORED_EMPLOYMENT, dict(STORED_EMPLOYMENT, id="edge-employed-2")
    )

    assert SiteSnapshot(nodes(), stored_twice).changes(
        payload(companies=[EMPLOYMENT, EMPLOYMENT, EMPLOYMENT])
    ) == [NEW_EMPLOYMENT]


def test_an_end_date_is_learned_onto_the_stored_spell():
    """`end_date` is learned later, so one spell closed since is one spell -
    and the end is written onto it, so the payload is kept.

    This used to assert the payload was dropped, mirroring an ingest that read
    the exact match as nothing to do and left the job current on the site for
    good (Anna Konieczyńska's KARR seat, closed in the register on 2026-08-25).
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))
    closed = dict(EMPLOYMENT, end="2024-03-01")

    assert snapshot.changes(payload(companies=[closed])) == [ENDED_EMPLOYMENT]


def test_an_end_the_site_already_holds_is_dropped():
    stored = dict(STORED_EMPLOYMENT, end_date="2024-03-01")
    snapshot = SiteSnapshot(nodes(), edges(stored))
    closed = dict(EMPLOYMENT, end="2024-03-01")

    assert snapshot.changes(payload(companies=[closed])) == []


def test_another_end_than_the_stored_one_is_dropped():
    """The ingest fills a blank end and never rewrites one."""
    stored = dict(STORED_EMPLOYMENT, end_date="2024-01-31")
    snapshot = SiteSnapshot(nodes(), edges(stored))
    closed = dict(EMPLOYMENT, end="2024-03-01")

    assert snapshot.changes(payload(companies=[closed])) == []


def test_a_job_the_payload_sends_open_is_not_reopened():
    stored = dict(STORED_EMPLOYMENT, end_date="2024-03-01")
    snapshot = SiteSnapshot(nodes(), edges(stored))

    assert snapshot.changes(payload(companies=[EMPLOYMENT])) == []


@pytest.mark.parametrize("deleted", [True, 1.0])
def test_a_removed_job_learns_no_end(deleted):
    """The ingest leaves a removed edge as it is; `deleted` reads back off a
    frame on disk as 1.0."""
    stored = dict(STORED_EMPLOYMENT, deleted=deleted)
    snapshot = SiteSnapshot(nodes(), edges(stored))
    closed = dict(EMPLOYMENT, end="2024-03-01")

    assert snapshot.changes(payload(companies=[closed])) == []


def test_a_candidacy_that_would_learn_a_committee_is_kept():
    """Every stored candidacy predates the ingest accepting a committee."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    with_committee = dict(
        CANDIDACY,
        committee="Komitet Wyborczy Prawo i Sprawiedliwość",
        party="PiS",
        party_from_committee=True,
    )

    assert snapshot.changes(payload(elections=[with_committee])) == [ENRICHED_CANDIDACY]


def test_a_candidacy_that_would_learn_it_was_won_is_kept():
    """What the backfill turns on, and what would silently drop it.

    `--only-changed` decides what an upload would write, so a result the
    prediction does not model is a person dropped from the run that was meant
    to tell 15,681 stored candidacies what happened to them.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    won = dict(CANDIDACY, elected=True)

    assert snapshot.changes(payload(elections=[won])) == [ENRICHED_CANDIDACY]


def test_a_candidacy_already_marked_won_is_dropped():
    stored = dict(STORED_CANDIDACY, elected=True)
    snapshot = SiteSnapshot(nodes(), edges(stored))
    won = dict(CANDIDACY, elected=True)

    assert snapshot.changes(payload(elections=[won])) == []


#: Marcin Witko's 2010 in Tomaszów Mazowiecki, as the 10-12 night stored it: a
#: council seat he won and a mayoral race he lost, both „Samorząd” in his
#: powiat, so the result is all that tells the two copies apart.
WON_COPY = dict(STORED_CANDIDACY, id="edge-election-1", elected=True)
LOST_COPY = dict(STORED_CANDIDACY, id="edge-election-2")
LOST_RUN = dict(CANDIDACY, elected=False)
WON_RUN = dict(CANDIDACY, elected=True)


@pytest.mark.parametrize(
    "stored",
    [
        pytest.param([WON_COPY, LOST_COPY], id="won-copy-first"),
        pytest.param(
            [dict(LOST_COPY, id="edge-election-0"), WON_COPY], id="lost-copy-first"
        ),
    ],
)
def test_a_won_and_a_lost_run_sent_again_change_nothing(stored):
    """Each row goes back to the copy that says what it says.

    Paired by position, the lost row took whichever copy sorted first. With the
    won copy first, the won row was left the lost copy to write its win onto;
    with the lost copy first, it found nothing and was a new candidacy, the win
    stored a third time.
    """
    snapshot = SiteSnapshot(nodes(), edges(*stored))

    assert snapshot.changes(payload(elections=[LOST_RUN, WON_RUN])) == []


def test_the_won_run_keeps_the_only_copy_that_says_it_was_won():
    """One stored copy, won, and two rows: one new candidacy.

    The prediction only says that one is written, not which, so this held
    before the won rows went first too. Which one it is - the lost run, rather
    than the win stored again beside the won copy - is in `person.test.ts`.
    """
    snapshot = SiteSnapshot(nodes(), edges(WON_COPY))

    assert snapshot.changes(payload(elections=[LOST_RUN, WON_RUN])) == [NEW_CANDIDACY]


def test_a_recorded_defeat_is_not_something_the_upload_would_write():
    """`createElection` writes only a win, so predicting one would be wrong."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    lost = dict(CANDIDACY, elected=False)

    assert snapshot.changes(payload(elections=[lost])) == []


def test_a_committee_that_differs_only_in_case_is_dropped():
    """PKW writes the same committee differently from one year's file to the next."""
    stored = dict(STORED_CANDIDACY, committee="KW  Prawo i Sprawiedliwość")
    snapshot = SiteSnapshot(nodes(), edges(stored))
    same = dict(CANDIDACY, committee="kw prawo i sprawiedliwość")

    assert snapshot.changes(payload(elections=[same])) == []


def test_a_candidacy_in_another_year_is_kept():
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    older = dict(CANDIDACY, election_year="2018")

    assert snapshot.changes(payload(elections=[older])) == [NEW_CANDIDACY]


def test_a_candidacy_the_stored_edge_contradicts_is_kept():
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    other_office = dict(CANDIDACY, election_type="Sejm")

    assert snapshot.changes(payload(elections=[other_office])) == [NEW_CANDIDACY]


def test_a_term_only_the_reviewer_knows_is_not_a_disagreement():
    """The scrapers never send `term`; saying nothing is not saying "none"."""
    stored = dict(STORED_CANDIDACY, term="2024-2029")
    snapshot = SiteSnapshot(nodes(), edges(stored))

    assert snapshot.changes(payload(elections=[CANDIDACY])) == []


def test_an_office_the_reviewer_narrowed_down_is_not_a_disagreement():
    """The payload says "Samorząd" of every local candidacy.

    A reader who has since told the site which council it was has not
    contradicted it. Kept as a new candidacy, the upload would store the
    vague row beside theirs.
    """
    stored = dict(STORED_CANDIDACY, position="Rada gminy")
    snapshot = SiteSnapshot(nodes(), edges(stored))

    assert snapshot.changes(payload(elections=[CANDIDACY])) == []


def test_a_national_office_is_still_not_the_local_one():
    stored = dict(STORED_CANDIDACY, position="Senat")
    snapshot = SiteSnapshot(nodes(), edges(stored))

    assert snapshot.changes(payload(elections=[CANDIDACY])) == [NEW_CANDIDACY]


def test_a_candidacy_with_no_region_on_the_site_is_reported():
    snapshot = SiteSnapshot(nodes(), edges())
    elsewhere = dict(CANDIDACY, teryt="0201")

    assert snapshot.changes(payload(elections=[elsewhere])) == [UNRESOLVED_REGION]


def test_reporting_an_unplaceable_candidacy_does_not_keep_the_payload(
    mock_ctx, monkeypatch
):
    """The ingest drops it and says so, so uploading achieves nothing.

    It used to *throw*, and a payload that would fail is one somebody has to
    see fail - which is why this was the one reason that kept a payload without
    being a write.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )
    person = Person(
        name="Jan Kowalski",
        companies=[],
        elections=[Election(**dict(CANDIDACY, teryt="0201"))],
        sources=[],
        parties=["PiS"],
        rejestrIo="https://rejestr.io/osoby/123",
    )

    kept = _people_payloads(only_changed=True).only_changed(mock_ctx, [person])

    assert kept == []


def test_a_candidacy_the_ingest_skips_is_dropped():
    """PKW published no districts for the 1997 Sejm, so its candidacies carry
    no TERYT, and the ingest drops one without failing."""
    snapshot = SiteSnapshot(nodes(), edges())
    sejm = dict(CANDIDACY, election_type="Sejm", election_year="1997", teryt=None)

    assert snapshot.changes(payload(elections=[sejm])) == []


def test_a_european_candidacy_without_a_district_is_reported():
    """Every European list now names its district, so one without is a fault.

    It used to be the expected case: the scrapers gave none of 2009, 2014 or
    2024 a place, and the ingest dropped all of them without a word.
    """
    snapshot = SiteSnapshot(nodes(), edges())
    european = dict(CANDIDACY, election_type="Parlament Europejski", teryt=None)

    assert snapshot.changes(payload(elections=[european])) == [UNRESOLVED_REGION]


MAZOWIECKIE = {"id": "teryt14", "type": "region", "name": "mazowieckie", "teryt": "14"}

#: A 2019 European run, in district 4, whose seat is Warszawa.
EUROPEAN = dict(
    CANDIDACY,
    election_type="Parlament Europejski",
    election_year="2019",
    teryt="14",
)

#: The same run as the 2019 list's residence column filed it: under the
#: candidate's home powiat, here the city of Warszawa.
EUROPEAN_AT_HOME = dict(
    STORED_CANDIDACY,
    id="edge-european-1",
    position="Parlament Europejski",
    start_date="2019-01-01",
)


def test_a_european_candidacy_filed_under_the_home_powiat_moves():
    """The ingest moves it to the district rather than storing the run twice."""
    snapshot = SiteSnapshot(nodes(MAZOWIECKIE), edges(EUROPEAN_AT_HOME))

    assert snapshot.changes(payload(elections=[EUROPEAN])) == [MOVED_CANDIDACY]


def test_a_european_run_already_in_its_district_moves_nothing():
    """Paweł Tomasz Kurek's 2024 run is stored twice under his home powiat. Once
    one copy is in the district, the other stays where it is, for a reviewer."""
    in_district = dict(EUROPEAN_AT_HOME, id="edge-european-2", target="teryt14")
    snapshot = SiteSnapshot(nodes(MAZOWIECKIE), edges(EUROPEAN_AT_HOME, in_district))

    assert snapshot.changes(payload(elections=[EUROPEAN])) == []


def test_a_misfiled_run_for_another_committee_is_not_moved():
    """A committee that disagrees is somebody else's run, not this one misfiled."""
    elsewhere = dict(EUROPEAN_AT_HOME, committee="KW Inny Komitet")
    snapshot = SiteSnapshot(nodes(MAZOWIECKIE), edges(elsewhere))
    european = dict(EUROPEAN, committee="KW Prawo i Sprawiedliwość")

    assert snapshot.changes(payload(elections=[european])) == [NEW_CANDIDACY]


def test_a_removed_misfiled_run_is_not_moved():
    """A removed edge stays as its reviewer left it, and the district gets the run."""
    removed = dict(EUROPEAN_AT_HOME, deleted=True)
    snapshot = SiteSnapshot(nodes(MAZOWIECKIE), edges(removed))

    assert snapshot.changes(payload(elections=[EUROPEAN])) == [NEW_CANDIDACY]


def test_a_sejm_run_is_never_moved():
    """Only a European run is moved: its district is whole województwa, so one
    under a powiat cannot be where it was stood. Other offices' runs stay put."""
    sejm_at_home = dict(EUROPEAN_AT_HOME, position="Sejm")
    snapshot = SiteSnapshot(nodes(MAZOWIECKIE), edges(sejm_at_home))
    sejm = dict(EUROPEAN, election_type="Sejm")

    assert snapshot.changes(payload(elections=[sejm])) == [NEW_CANDIDACY]


def test_a_person_with_no_id_column_is_not_indexed():
    """An export row without a document id is not a node anything can point at."""
    snapshot = SiteSnapshot(
        pd.DataFrame.from_records(
            [{"id": "", "type": "person", "name": "Jan Kowalski"}]
        ),
        edges(),
    )

    assert snapshot.changes(payload()) == [NEW_PERSON]


class _FixedPipeline(Pipeline):
    filename = "mock"

    def __init__(self, data):
        super().__init__()
        self.data = pd.DataFrame(data)

    def process(self, ctx: Context) -> pd.DataFrame:
        return self.data

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        return self.data


EXTRACTED_PEOPLE = [
    {
        "krs_name": "Jan Kowalski",
        "rejestrio_id": ["123"],
        "employment": [
            {
                "employed_krs": "0000123456",
                "employed_role": "Prezes",
                "employed_start": "2020-01-01",
            }
        ],
        "elections": [
            {
                "election_type": "samorządu",
                "party": None,
                "election_year": 2024,
                "teryt_powiat": ["1465"],
            }
        ],
    },
    {
        "krs_name": "Anna Nowak",
        "rejestrio_id": ["456"],
        "employment": [],
        "elections": [],
    },
]


@pytest.fixture
def mock_ctx():
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    return ctx


def _people_payloads(
    only_changed: bool = False,
    on_koryta: bool = False,
    not_on_koryta: bool = False,
) -> PeoplePayloads:
    pipeline = Pipeline.create(PeoplePayloads)
    pipeline.people = _FixedPipeline(EXTRACTED_PEOPLE)  # type: ignore[assignment]
    # The flags come off the process's own argv, which a test does not have.
    pipeline.__dict__["args"] = SimpleNamespace(
        only_changed=only_changed,
        on_koryta=on_koryta,
        not_on_koryta=not_on_koryta,
        koryta_date=None,
    )
    return pipeline


def test_the_pipeline_emits_every_payload_by_default(mock_ctx, monkeypatch):
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: 1 / 0)
    )

    assert len(_people_payloads(only_changed=False).process(mock_ctx)) == 2


def test_the_pipeline_drops_the_payloads_the_site_already_holds(mock_ctx, monkeypatch):
    """The whole path: an extracted row, the payload built from it, the match.

    Worth running end to end because the two halves agree on field names and
    nothing else - `changes` reads `election_type` after `get_election_type`
    has rewritten it, and a rename on either side would silently keep or drop
    every payload rather than fail.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(only_changed=True).process(mock_ctx)

    assert list(result["name"]) == ["Anna Nowak"]


def test_the_pipeline_keeps_only_the_people_the_site_has(mock_ctx, monkeypatch):
    snapshot = SiteSnapshot(nodes(), edges())
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(on_koryta=True).process(mock_ctx)

    assert list(result["name"]) == ["Jan Kowalski"]


def test_the_pipeline_keeps_only_the_people_the_site_lacks(mock_ctx, monkeypatch):
    """The same path as `--on-koryta`, read the other way round. End to end
    because the two flags are only each other's complement if they resolve a
    payload to a page by the same fields, and nothing but a run over a real
    payload checks that."""
    snapshot = SiteSnapshot(nodes(), edges())
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(not_on_koryta=True).process(mock_ctx)

    assert list(result["name"]) == ["Anna Nowak"]


def test_a_column_another_document_fills_is_not_a_value_here():
    """Every row of an export carries every column the collection has.

    A person node arrives with a `krsNumber` of NaN because some place node has
    one, and indexing that would put people in the company lookup.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.companies == {"0000123456": COMPANY_ID}
    assert snapshot.regions == {"1465": "teryt1465"}
    assert list(snapshot.people) == ["https://rejestr.io/osoby/123"]
    assert list(snapshot.people_by_name) == ["Jan Kowalski"]


class TestOneRegisterEntry:
    """Which rejestr.io entry a row that carries several is filed under.

    A row carrying two is two people: `create_people_table` groups namesakes of
    the same age on purpose and cannot tell them from strangers. Nothing here
    undoes that - the point is only that the choice does not *move*, because
    `/api/ingest/person` now identifies a person by their register entry, and an
    entry that changes between runs opens a second page for them.
    """

    def test_the_only_entry_is_the_answer(self):
        assert one_register_entry(["1956879"]) == "1956879"

    def test_the_choice_does_not_depend_on_the_order_it_arrives_in(self):
        """duckdb's `list_distinct` returns a hash order, not the input order,
        so the same set reaches this function differently on different runs."""
        assert one_register_entry(["1956879", "383093"]) == one_register_entry(
            ["383093", "1956879"]
        )

    def test_entries_sort_as_numbers_rather_than_as_text(self):
        assert one_register_entry(["1956879", "383093"]) == "383093"

    def test_a_non_numeric_entry_still_sorts_somewhere_stable(self):
        assert one_register_entry(["abc", "123"]) == "123"
        assert one_register_entry(["abc", "abd"]) == "abc"

    def test_somebody_only_an_odpis_names_has_no_entry(self):
        assert one_register_entry([]) is None

    def test_a_collapsed_row_is_reported_rather_than_dropped(self):
        collapsed_people.clear()
        one_register_entry(["1956879", "383093"])
        one_register_entry(["123"])

        assert dict(collapsed_people) == {"383093, 1956879": 1}
        collapsed_people.clear()


class TestCanonicalName:
    """Which spelling a person whose sources disagree gets called on the site."""

    def test_the_middle_name_is_kept(self):
        assert (
            canonical_name(["Andrzej Marcin Golimont", "Andrzej Golimont"])
            == "Andrzej Marcin Golimont"
        )

    def test_the_most_given_names_win(self):
        assert (
            canonical_name(
                ["Jan Maria Kowalski", "Jan Kowalski", "Jan Maria Józef Kowalski"]
            )
            == "Jan Maria Józef Kowalski"
        )

    def test_a_shouted_short_form_still_gains_its_middle_name(self):
        """Kamil Barczyk's page was made "KAMIL BARCZYK" from these two (report
        ZPDRstUlzvztjywjtym2), and the middle name had to be typed in by hand.
        The capitals are `format_person_name`'s to undo; this keeps the name."""
        assert (
            canonical_name(["KAMIL BARCZYK", "Kamil Sebastian Barczyk"])
            == "Kamil Sebastian Barczyk"
        )

    def test_another_surname_is_not_preferred_for_being_longer(self):
        """A maiden name with a middle name is longer, and is not the name the
        short form picked: nobody's surname changes for a middle name."""
        assert canonical_name(["Anna Kowalska", "Anna Maria Nowak"]) == "Anna Kowalska"

    def test_a_surname_typed_twice_is_not_a_middle_name(self):
        assert canonical_name(["Mirosław Dywan Dywan", "Mirosław Dywan"]) == (
            "Mirosław Dywan"
        )

    def test_the_choice_does_not_depend_on_the_order_it_arrives_in(self):
        """`full_name` is a `list_distinct`, so the order is a hash."""
        assert canonical_name(["Andrzej Golimont", "Andrzej Marcin Golimont"]) == (
            canonical_name(["Andrzej Marcin Golimont", "Andrzej Golimont"])
        )

    def test_the_register_shouting_does_not_win(self):
        """A bare sort would take the capitals, which sort first."""
        assert (
            canonical_name(["GRZEGORZ GWOZDZ", "Grzegorz Gwozdz"]) == "Grzegorz Gwozdz"
        )

    def test_a_single_spelling_is_left_alone(self):
        assert canonical_name(["Teresa Maria Bogiel"]) == "Teresa Maria Bogiel"

    def test_nothing_to_choose_from_is_no_name(self):
        assert canonical_name([]) is None
        assert canonical_name(["", "   "]) is None


class TestHyphenatedSurname:
    """A double surname the register writes with a space takes the hyphen of the
    PKW records and the Wikipedia article matched to the person (Szymon,
    2026-10-11): "Władysław Kosiniak Kamysz" is "Władysław Kosiniak-Kamysz"."""

    def test_pkw_s_hyphen_joins_the_register_s_space(self):
        assert (
            hyphenate_surname("Władysław Kosiniak Kamysz", ["kosiniak-kamysz"])
            == "Władysław Kosiniak-Kamysz"
        )

    def test_the_middle_name_is_kept(self):
        assert (
            canonical_name(
                ["Antoni Ignacy Nowak Rudnik", "Antoni Nowak Rudnik"], ["nowak-rudnik"]
            )
            == "Antoni Ignacy Nowak-Rudnik"
        )

    def test_a_spelling_the_register_hyphenated_still_gains_the_middle_name(self):
        """Without PKW's hyphen the short "Anna Nowak-Rudnik" had no fuller
        form: "Anna Maria Nowak Rudnik" ends in another word."""
        spellings = ["Anna Maria Nowak Rudnik", "Anna Nowak-Rudnik"]

        assert canonical_name(spellings) == "Anna Nowak-Rudnik"
        assert canonical_name(spellings, ["nowak-rudnik"]) == "Anna Maria Nowak-Rudnik"

    @pytest.mark.parametrize(
        ("spellings", "expected"),
        [
            # The record ends only the longer spelling. Hyphenated first, it
            # lost its word count to "Anna Rudnik" and the alphabet chose that,
            # the surname's first half gone.
            (["Anna Zawada Rudnik", "Anna Rudnik"], "Anna Zawada-Rudnik"),
            # Another surname in one spelling: hyphenated first, "Anna
            # Zawada-Rudnik" was the shorter and replaced "Maria".
            (["Anna Maria Rudnik", "Anna Zawada Rudnik"], "Anna Maria Rudnik"),
        ],
    )
    def test_the_hyphen_changes_only_the_separator_of_the_choice(
        self, spellings, expected
    ):
        """The register's spellings choose, not the hyphenated ones, so a
        spelling the record does not end is not a word longer for it."""
        surnames = ["zawada-rudnik"]

        assert canonical_name(spellings, surnames) == expected
        assert canonical_name(spellings, surnames) == hyphenate_surname(
            canonical_name(spellings) or "", surnames
        )

    @pytest.mark.parametrize("surname", ["pakuła - błoch", "pakuła – błoch"])
    def test_a_hyphen_typed_loosely_is_a_hyphen(self, surname):
        assert hyphenate_surname("Iwona Pakuła Błoch", [surname]) == (
            "Iwona Pakuła-Błoch"
        )

    @pytest.mark.parametrize(
        "surnames", [["nowak rudnik", "nowak-rudnik"], ["nowak-rudnik", "nowak rudnik"]]
    )
    def test_a_hyphen_from_any_source_wins_whatever_the_order(self, surnames):
        assert hyphenate_surname("Anna Nowak Rudnik", surnames) == "Anna Nowak-Rudnik"

    def test_only_the_separator_changes(self):
        """The words, their case and their order are the register's - the
        capitals are `format_person_name`'s to undo."""
        assert hyphenate_surname("ANNA NOWAK RUDNIK", ["nowak-rudnik"]) == (
            "ANNA NOWAK-RUDNIK"
        )
        three_parts = hyphenate_surname(
            "Jan Nowak Kowalski Rudnik", ["nowak-kowalski rudnik"]
        )
        assert three_parts == "Jan Nowak-Kowalski Rudnik"

    @pytest.mark.parametrize(
        ("name", "surnames"),
        [
            # A surname no source hyphenates.
            ("Piotr van der Coghen", ["van der coghen"]),
            ("Anna Nowak Rudnik", ["nowak rudnik", None, float("nan")]),
            # Other words than the name ends in.
            ("Anna Nowak Rudnik", ["nowak-rudnicka"]),
            ("Anna Rudnik", ["nowak-rudnik"]),
            ("Anna Nowak Rudnik Kowalska", ["nowak-rudnik"]),
            # Nothing left for a first name.
            ("Nowak Rudnik", ["nowak-rudnik"]),
            # Written with the hyphen already.
            ("Anna Nowak-Rudnik", ["nowak-rudnik"]),
            ("Anna Nowak Rudnik", []),
        ],
    )
    def test_nothing_else_is_joined(self, name, surnames):
        assert hyphenate_surname(name, surnames) == name

    def test_the_payload_takes_the_hyphen_of_pkw_or_wikipedia(self):
        """`people_merged` carries the matched records' surnames as
        `pkw_last_names` and `wiki_last_name`."""

        def name_of(**fields) -> str:
            row = pd.Series(
                {
                    "full_name": ["Władysław Marcin Kosiniak Kamysz"],
                    "rejestrio_id": ["1"],
                    "employment": [],
                    "elections": [],
                    **fields,
                }
            )
            pipeline = Pipeline.create(PeoplePayloads)
            return pipeline.map_person_payload(ctx=None, row=row).name  # type: ignore[arg-type]

        assert name_of() == "Władysław Marcin Kosiniak Kamysz"
        assert name_of(pkw_last_names=["kosiniak-kamysz"]) == (
            "Władysław Marcin Kosiniak-Kamysz"
        )
        assert name_of(pkw_last_names=[], wiki_last_name="kosiniak-kamysz") == (
            "Władysław Marcin Kosiniak-Kamysz"
        )
