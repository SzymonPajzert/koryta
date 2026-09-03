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
    #: What the candidate answered when PKW asked, at THIS election, whether
    #: they belong to a party - stored verbatim, e.g. "członek partii
    #: politycznej: Prawo i Sprawiedliwość" or "nie należy do partii
    #: politycznej".
    #:
    #: A different claim from `party`, and the difference is the point. `party`
    #: is the site's own reading of the committee through a curated table, and
    #: is deliberately empty for a coalition; this is the candidate speaking
    #: about themselves. They disagree often enough to be worth showing: over
    #: the 1,404 Trzecia Droga candidacies that carry a declaration, two thirds
    #: of the party labels the committee map writes are contradicted by it.
    #:
    #: Left as PKW wrote it rather than folded into the seven tokens
    #: `committee_to_party` emits. The 1,084 distinct spellings run through
    #: nominative and genitive ("Prawo i Sprawiedliwość", "Prawa i
    #: Sprawiedliwości"), and a declension-folding guess that lands wrong would
    #: write a second, worse party onto an edge that already has one.
    #:
    #: Absent means PKW published no answer for that election - which is most
    #: of them, and is not the same as answering "no party".
    party_member: str | None = None


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
