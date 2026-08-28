"""Data classes representing individuals from various data sources."""

from dataclasses import dataclass, field


@dataclass
class Koryta:
    """Represents a person from the main 'koryta.pl' dataset."""

    id: str
    full_name: str
    parties: list[str]
    data: dict
    is_public: bool = False
    votes_interesting: int | None = None
    rejestrIo: str | None = None
    teryt_wojewodztwo: list[str] = field(default_factory=list)
    teryt_powiat: list[str] = field(default_factory=list)


@dataclass
class KRS:
    """Represents a person associated with a KRS (National Court Register) entry."""

    id: str
    first_name: str
    last_name: str
    full_name: str
    employed_krs: str
    employed_start: str | None
    employed_end: str | None
    employed_for: str | None
    employed_role: str | None = None
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None
    #: What rejestr.io called the entry this row came from: ``osoba``, or
    #: ``osoba-bez-pesel`` for somebody it holds no PESEL for. The latter never
    #: carries a birth date or a sex, which is why it is worth recording rather
    #: than inferring from the empty fields. It is a property of the response
    #: and not of the person - 59 ids in the crawl arrive as both.
    rejestrio_type: str | None = None

    def __post_init__(self):
        """Ensures the person's ID is a string."""
        self.id = str(self.id)


@dataclass
class PKW:
    """Represents a person from a PKW (National Electoral Commission) dataset."""

    election_year: str
    election_type: str
    sex: str | None = None
    birth_year: int | None = None
    age: str | None = None
    teryt_candidacy: str | None = None
    teryt_living: str | None = None
    candidacy_success: str | None = None
    party: str | None = None
    position: str | None = None
    pkw_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    party_member: str | None = None


@dataclass
class Wikipedia:
    """Represents a person from a Wikipedia article."""

    source: str
    full_name: str
    party: str | None
    birth_iso8601: str | None
    birth_year: int | None
    infoboxes: list[str]
    content_score: int
    links: list[str]


@dataclass
class PersonVote:
    """Represents a vote associated with a person."""

    person_koryta_id: str
    interesting: int | None


@dataclass
class PersonFact:
    """One extracted fact the site has matched to a person already in the graph.

    A row per (fact, person), not per article: `/api/ingest/extraction` settles
    which of an article's confirmed people each fact is about and stores that
    as `personNodeId`, so the join is done by the time the export is written.
    Facts it could not place - the usual case, and always the case for a name
    two confirmed people share - never become one of these.

    `article_url` is kept because the unit that matters downstream is the
    article rather than the fact: three facts pulled out of one piece are three
    readings of one source, and a model counting them as three would rate a
    thorough extraction over a person who keeps turning up.
    """

    person_koryta_id: str
    article_url: str
    fact_type: str
    #: What reviewers made of the fact, summed, or None if nobody has looked.
    #: Negative means somebody said the fact is wrong.
    correct: int | None = None
    #: Whether a reviewer flagged the *match* rather than the fact - the name
    #: matcher put this fact on the wrong person. Stored apart from `correct`
    #: because the fact can be perfectly true about somebody else.
    wrong_person: bool = False


def is_pipeline_uid(user_uid: str | None) -> bool:
    """Whether a vote was cast by a scoring model rather than by a person.

    One model per uid - `pipeline`, `pipeline-pagerank` and so on - and the
    substring is what tells them apart from a Firebase uid, which is 28
    alphanumeric characters. Kept identical to `isPipelineUid` in
    `frontend/shared/stats.ts`: the two sides have to agree on what counts as a
    human vote or the pipeline ends up seeded on its own output.
    """
    return bool(user_uid) and "pipeline" in str(user_uid)


@dataclass
class RejestrIOKey:
    """Represents a person from the RejestrIO dataset."""

    id: str

    def __hash__(self) -> int:
        """Computes the hash based on the KRS ID."""
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        """Checks equality based on the KRS ID."""
        return isinstance(other, RejestrIOKey) and self.id == other.id
