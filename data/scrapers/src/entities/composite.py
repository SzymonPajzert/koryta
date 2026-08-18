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
    #: Date of birth as `YYYY-MM-DD`, from rejestr.io by way of
    #: `people_krs_merged`, which carries one for all 106020 people it holds.
    #:
    #: The field the whole identity problem turns on. Matching a name against
    #: the ~6100 people on koryta.pl leaves 15.8% of them ambiguous; a name plus
    #: this leaves 0.02%. It was computed all along and dropped here - the
    #: dataclass had nowhere to put it, so `payloads/person.py` never read the
    #: column it was iterating past.
    birthDate: str | None = None
    autoapprove: bool = False


@dataclass
class PersonScore:
    node_id: str
    name: str
    score: float
    # Which model said so, and the `userUid` the vote is stored under. The
    # default is the tag the first model has always written under, so a score
    # produced before models had names still uploads where it used to.
    model: str = "pipeline"
