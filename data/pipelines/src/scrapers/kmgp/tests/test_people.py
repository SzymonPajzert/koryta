"""Matching KMGP people to their 2024 PKW candidacies and their companies."""

import difflib
import json
import random
from types import SimpleNamespace

from entities.person import PKW
from scrapers.kmgp.people import PeopleKMGP, normalize_text
from scrapers.stores.file import DownloadableFile


def candidacy(teryt: str, year: str = "2024", party: str | None = "KWW Gmina") -> PKW:
    return PKW(
        election_year=year,
        election_type="rada gminy",
        teryt_candidacy=teryt,
        party=party,
        pkw_name="Jan KOWALSKI",
        first_name="Jan",
        last_name="Kowalski",
    )


def kmgp(*records: PKW) -> PeopleKMGP:
    pipeline = PeopleKMGP()
    pipeline.index_pkw(records)
    return pipeline


def test_a_candidacy_in_the_same_gmina_is_found():
    """The index held name-only Persons, so this raised on teryt_candidacy."""
    elections = kmgp(candidacy("1465011")).lookup_election("Jan Kowalski", "1465011")

    assert [
        (e.election_type, e.committee, e.election_year, e.teryt) for e in elections
    ] == [("rada gminy", "KWW Gmina", "2024", "1465011")]


def test_a_namesake_standing_elsewhere_is_not():
    assert kmgp(candidacy("0201011")).lookup_election("Jan Kowalski", "1465011") == []


def test_only_2024_candidacies_are_indexed():
    assert kmgp(candidacy("1465011", year="2018")).pkw_index == {}


# ─── the company lookup ───────────────────────────────────

WORDS = (
    "przedsiębiorstwo gospodarki komunalnej zakład usług komunalnych wodociągi "
    "kanalizacja spółka z o.o. miejskie gminne ciepłownictwo transport zieleń "
    "centrum sportu rekreacji szpital powiatowy"
).split()
TERYTS = ("0201011", "0201022", "1465011", "1465028")


def full_scan(index: dict[tuple[str, str], str], teryt: str, entity: str):
    """The lookup as it was before 2026-10-05: every company, a full ratio each."""
    krs = index.get((teryt, entity.strip().lower()))
    if krs:
        return krs
    best_krs, best = None, 0.0
    for (t, name), krs in index.items():
        score = difflib.SequenceMatcher(
            None, normalize_text(entity), normalize_text(name)
        ).ratio()
        if t == teryt:
            score += 0.1
        if score > best:
            best, best_krs = score, krs
    return best_krs if best_krs and best >= 0.75 else None


def test_the_pruned_lookup_finds_what_the_full_scan_found():
    rng = random.Random(20261005)
    companies = [
        SimpleNamespace(
            name=" ".join(rng.sample(WORDS, rng.randint(2, 5))),
            teryt_code=rng.choice(TERYTS),
            krs=f"{i:010d}",
        )
        for i in range(300)
    ]
    pipeline = PeopleKMGP()
    pipeline.index_companies(companies)

    outcomes = []
    for _ in range(400):
        if rng.random() < 0.35:
            # An office no company is named after - mostly no match.
            words = rng.sample(WORDS, rng.randint(1, 3)) + ["urząd"]
        else:
            words = rng.choice(companies).name.split()
            if len(words) > 2 and rng.random() < 0.5:
                words.pop(rng.randrange(len(words)))
            if rng.random() < 0.5:
                words[rng.randrange(len(words))] = rng.choice(WORDS)
        entity, teryt = " ".join(words), rng.choice(TERYTS)

        want = full_scan(pipeline.companies_index, teryt, entity)
        got = [c.krs for c in pipeline.lookup_companies(teryt, entity)]
        assert got == ([want] if want else []), (teryt, entity)
        outcomes.append(want is not None)
    # Not vacuous: both a match and no match come up often.
    assert sum(outcomes) >= 40 and outcomes.count(False) >= 40


def test_one_office_is_looked_up_once():
    pipeline = PeopleKMGP()
    pipeline.index_companies(
        [
            SimpleNamespace(
                name="Zakład Usług Komunalnych", teryt_code="1465011", krs="1"
            )
        ]
    )
    pipeline.lookup_companies("1465011", "Zaklad Uslug Komunalnych")
    pipeline._companies_normalized = []  # a second scan would now find nothing

    assert [
        c.krs for c in pipeline.lookup_companies("1465011", "Zaklad Uslug Komunalnych")
    ] == ["1"]


# ─── the people list ──────────────────────────────────────

BUCKET = "gs://koryta-pl-crawled"
STATS = "hostname=kazdymusigdziespracowac.pl/wp-json/kmgp-map/v1/employment-stats"
BIR12 = "hostname=kazdymusigdziespracowac.pl/wp-json/kmgp-map/v1/bir12/?teryt=0201010"


def people(*names: str) -> str:
    return json.dumps(
        {
            "confirmed_list": [
                {
                    "first_name": name.split()[0],
                    "last_name": name.split()[1],
                    "terc": "1465011",
                    "entity_name": "Zakład",
                    "attachment_url": "https://example.org/a.pdf",
                }
                for name in names
            ]
        }
    )


class Body:
    def __init__(self, text: str):
        self.text = text

    def read_string(self) -> str:
        return self.text


class CapturesIO:
    """The crawl bucket's kazdymusigdziespracowac.pl objects; counts the reads."""

    def __init__(self, bodies: dict[str, str]):
        self.bodies = bodies
        self.read: list[str] = []

    def list_files(self, path):
        for name, body in self.bodies.items():
            if name.startswith(path.prefix):
                yield DownloadableFile(f"{BUCKET}/{name}", size=len(body))

    def read_data(self, ref):
        self.read.append(ref.url)
        return Body(self.bodies[ref.url.removeprefix(f"{BUCKET}/")])


def test_only_the_newest_capture_is_read_and_no_bir12_page_is():
    """Both captures were read: 999 people went through, and out, twice."""
    io = CapturesIO(
        {
            f"{STATS}/date=2026-04-22": people("Jan Kowalski"),
            f"{STATS}/date=2026-05-17": people("Jan Kowalski", "Anna Nowak"),
            f"{BIR12}/date=2026-04-22": "not a people list",
        }
    )

    listed = [p.name for p in PeopleKMGP().list_people(SimpleNamespace(io=io))]

    assert listed == ["Jan Kowalski", "Anna Nowak"]
    assert io.read == [f"{BUCKET}/{STATS}/date=2026-05-17"]
