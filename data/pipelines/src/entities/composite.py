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
    #: The node id of the page this person is already on, where the pipeline
    #: could work it out. The site's own key, so the ingest does not have to
    #: infer who this is - see `lookupPersonDoc`.
    korytaId: str | None = None
    autoapprove: bool = False


@dataclass
class PersonNote:
    """One note a pipeline wrote onto a person's page.

    The same shape a contributor's note has - a link and a sentence about what
    is in it - stored in the same `notes` collection and drawn by the same
    card. What makes it the pipeline's is the uid it is filed under: anything
    containing "pipeline" reads as non-human, so the site can count community
    notes without counting these, and a re-run replaces the pipeline's own note
    on a page without touching anybody else's.

    One note per (node, uid), which is the collection's own rule - a person has
    at most one note from each author. A pipeline that wanted to say two things
    about somebody would say them in one note, or write under a second uid.
    """

    node_id: str
    #: The page's name, for the upload's own reporting. Nothing is written
    #: from it: the note hangs off the node id.
    name: str
    #: Where the text came from. Rendered as the source link on the card, so a
    #: reader can check the claim against the page it was taken from - which is
    #: also what the licence on Wikipedia text asks for.
    url: str
    note: str
    #: Which entry kind the note reads as on the card. "source" is a thing to
    #: read rather than a correction somebody is owed, which is what keeps
    #: these off the admin queue - see `noteNeedsAction` in
    #: `frontend/shared/model.ts`.
    kind: str = "source"
    #: Which pipeline said so, and the `userUid` the note is stored under. The
    #: default is the tag a note with no other provenance goes under, the way
    #: `PersonScore.model` works.
    model: str = "pipeline"


@dataclass
class PersonScore:
    node_id: str
    name: str
    score: float
    # Which model said so, and the `userUid` the vote is stored under. The
    # default is the tag the first model has always written under, so a score
    # produced before models had names still uploads where it used to.
    model: str = "pipeline"
