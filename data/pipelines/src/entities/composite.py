import typing
from dataclasses import dataclass


@dataclass
class Company:
    krs: str | None = None
    role: str | None = None
    start: str | None = None
    end: str | None = None


@dataclass
class Election:
    # TODO we need a proper typing of the election types
    election_type: typing.Any
    # None when the PKW listing records no committee, which is the usual case
    # for a small-town candidacy. Nullable rather than the string "None": the
    # uploader drops null fields, and the frontend stores what it is sent.
    committee: str | None = None
    election_year: str | None = None
    teryt: str | None = None
    # The national party this candidacy puts the person with, when
    # `committee_to_party` names exactly one. A coalition leaves this None on
    # purpose: the stored edge holds a single `party`, and picking one half of
    # Trzecia Droga would assert something PKW never recorded. The committee is
    # still stored, and the person's own `parties` still gets both.
    party: str | None = None
    # Whether `committee_to_party` recognised the committee at all - true for a
    # coalition too, where `party` stays None. This is what the ingest approves
    # an enrichment revision on: the map is a curated table of exact committee
    # names, so a hit means a human has already vouched for this committee, and
    # a candidacy carrying one needs no second look. An unrecognised committee
    # is usually a one-gmina KWW, but it is also where a misspelt national
    # committee hides, so those are proposed and left for review.
    party_from_committee: bool = False
    # Whether PKW recorded this candidacy as winning the mandate. Tri-state,
    # and the third state is the whole difficulty: PKW says nothing for 74.5%
    # of its rows, which is not a loss. Ten (type, year) blocks are complete -
    # samorzadu 2010 and 2024, sejmu and senatu 2011/2019/2023, europarlamentu
    # 2019/2024 - samorzadu 2002 and 2018 are about 4%, and everything else is
    # silent. Reading a missing value as False would file every politician who
    # stood before 2010 as having lost.
    #
    # The value has been carried this far since `people_pkw_merged` first
    # selected `candidacy_success` into the elections struct; it stopped here,
    # because nothing read it off the row.
    elected: bool | None = None


@dataclass
class Source:
    url: str
    note: str | None = None


@dataclass
class Person:
    name: str

    companies: list[Company]
    elections: list[Election]
    sources: list[Source]
    content: str | None = None
    parties: list[str] | None = None
    wikipedia: str | None = None
    rejestrIo: str | None = None
    #: The node id of the page this person is already on, where the pipeline
    #: could work it out. The site's own key, so the ingest does not have to
    #: infer who this is - see `lookupPersonDoc`.
    korytaId: str | None = None
    #: Date of birth as `YYYY-MM-DD`, from rejestr.io by way of
    #: `people_krs_merged`, which carries one for all 106020 people it holds.
    #:
    #: The field the whole identity problem turns on. Matching a name against
    #: the ~6100 people on koryta.pl leaves 15.8% of them ambiguous; a name plus
    #: this leaves 0.02%. It was computed all along and dropped here - the
    #: dataclass had nowhere to put it, so `payloads/person.py` never read the
    #: column it was iterating past.
    birthDate: str | None = None


@dataclass
class PersonScore:
    node_id: str
    name: str
    score: float
    # Which model said so, and the `userUid` the vote is stored under. The
    # default is the tag the first model has always written under, so a score
    # produced before models had names still uploads where it used to.
    model: str = "pipeline"
