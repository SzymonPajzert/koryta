from dataclasses import dataclass


@dataclass
class Koryta:
    id: str
    full_name: str
    party: str


@dataclass
class KRS:
    id: str
    first_name: str
    last_name: str
    full_name: str
    employed_krs: str
    employed_start: str | None
    employed_end: str | None
    employed_for: str | None
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        self.id = str(self.id)


@dataclass
class PKW:
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
    source: str
    full_name: str
    party: str
    birth_iso8601: str | None
    birth_year: int | None
    infobox: str
    content_score: int
    links: list[str]
