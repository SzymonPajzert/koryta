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
    #: Where a duplicate page's readers are sent: the id of the person this node
    #: was merged into. Set only by a merge, alongside `deleted`, and never a
    #: chain (the site resolves it on write). A node carrying it is a tombstone,
    #: not a person, so no mention or fact may be linked to it.
    merged_into: str | None = None


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
    #: than inferring from the empty fields. It also says which numbering `id`
    #: is in: the two shapes are numbered apart, and the 96 ids that arrive as
    #: both on 2026-10-09 are two people each (`scrapers.krs.list.PERSON_TYPES`).
    rejestrio_type: str | None = None
    #: The day the response this row came from was crawled, ISO. An odpis pełny
    #: tells the same story for free, and which of the two is newer decides
    #: whose word stands for the company (`scrapers.krs.odpis_people`).
    crawled_on: str | None = None

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
class PageNote:
    """One entry of a note a reader left on a page - a person's, a company's,
    an article's - without what it says, where it points or who wrote it.

    A note is one reader's on one page and holds a list of entries, each
    triaged by an admin on its own (`NoteSource` in `frontend/shared/model.ts`).
    """

    #: The page the note is on.
    node_id: str
    #: "source", something the reader read; "change_request", a correction
    #: they want made ("Do poprawy"); "missing", data they noticed is absent
    #: ("Brakuje danych"). An entry written before kinds existed is a source.
    kind: str
    #: "resolved" or "unresolved" once an admin has said, "" until then.
    admin_status: str
    #: Whether it still waits on an admin, as the site reads it
    #: (`noteNeedsAction`): what an admin said, else any kind but a source.
    open: bool


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
    #: The fact's own content, carried verbatim so a consumer can rebuild the
    #: same dedup key `ArticleAnalyzed` uses and tell which facts the site
    #: already holds. Optional: older exports (and the scoring model, which
    #: only needs the id/type) leave them unset.
    person: str | None = None
    organization: str | None = None
    role: str | None = None
    party: str | None = None
    subject: str | None = None
    object: str | None = None
    relation: str | None = None
    affair: str | None = None
    #: The extractor's own text: the quote it drew the fact from, both as the
    #: model wrote it and as the verbatim article span it resolved to.
    justification: str | None = None
    justification_in_text: str | None = None
    #: Provenance of the extraction: the article's domain and the prompt tag
    #: (e.g. `v26-mentions-qwen3.8-27b-only-matched-koryta-id`).
    article_domain: str | None = None
    tag: str | None = None


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
