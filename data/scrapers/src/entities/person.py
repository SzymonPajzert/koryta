"""Data classes representing individuals from various data sources."""

from dataclasses import dataclass


@dataclass
class Koryta:
    """Represents a person from the main 'koryta.pl' dataset."""

    id: str
    full_name: str
    parties: list[str]
    data: dict
    is_public: bool = False
    votes_interesting: int | None = None
    #: The person's rejestr.io profile, as the site stores it. Carried because
    #: it is the only identifier both this dataset and `PeoplePayloads` hold,
    #: and joining the two on `full_name` silently drops whoever the two
    #: sources spell differently. See `analysis.scores.base.person_key`.
    rejestr_io: str | None = None


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
