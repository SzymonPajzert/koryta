"""People the merge cannot settle from the data, and what was settled for them.

Each case came out of reviewing nightly-test-failures against main on the
2026-10-07 inputs (task review-pages-before-merging-nightly-test-failures): a
person whose PKW candidacies changed, a page that is no longer matched, a page
now matched by a name alone. The data does not say which way each should go,
so somebody has to.

A case fails until `decided` says so - which of PKW's records are the person's,
or which register entry a page is about - and from then on it is a regression
test: a change to the merge that undoes a decision fails here. The failure
prints what the pipeline does now, in the form `decided` takes.

A decision the merge does not reach on its own - a record it attaches that is
not the person's - keeps its case failing until the merge is told: a reviewer
removing the candidacy on the page, once removals are kept (task
decide-how-to-keep-rejected-connections).
"""

from dataclasses import dataclass

import pytest

from analysis.people import PeopleEnriched
from analysis.utils import as_sequence
from conductor import setup_context
from koryta import Pipeline
from scrapers.krs.odpis_people import fold


@dataclass(frozen=True)
class Records:
    """A person's PKW records, written as `pkw_records` writes them."""

    names: tuple[str, ...] = ()


@dataclass(frozen=True)
class Page:
    """The register entry a page is about; None for nobody the merge knows."""

    rejestrio_id: str | None


@dataclass(frozen=True)
class Candidacies:
    rejestrio_id: str
    who: str
    why: str
    decided: Records | None = None


@dataclass(frozen=True)
class PageCase:
    page_id: str
    who: str
    why: str
    decided: Page | None = None


SILENT = "KRS gives no middle name, and nothing contradicts any of them."
ARTICLE = "The article matched to the day names the middle name"

CANDIDACIES = [
    Candidacies(
        "439853",
        "Anna Brzezińska, born 1977-03-04, page UvHUkR6QzLnx9597k2hu",
        "Main gave her Anna Olga Brzezińska's 2014 Krosno candidacy, through a "
        "row holding both women (Anna Olga is entry 874917). " + SILENT,
    ),
    Candidacies(
        "365646",
        "Krzysztof Nowak, born 1972-07-05, page jCZvfO22mWbRXU8YpVZm",
        "Main's row also held entry 2817588, Krzysztof Rafał, and took his "
        '"Samorządne Miasteczko" candidacies. ' + SILENT,
    ),
    Candidacies(
        "88058",
        "Andrzej Kleszcz, born 1968-10-04, page UL5x0sHMVuCiiq4uOigk",
        "Main's row also held entry 416593, born 1969, and took Andrzej Marian's "
        "2024 PiS candidacy through it. " + SILENT,
    ),
    Candidacies(
        "2160417",
        "Krzysztof Dąbrowski, born 1962-10-14, page PItWMhFOT6yYOS3We1mj",
        "Main's row also held entry 1161299 and its middle name, and took "
        "a namesake's 1994-2002 candidacies through it. " + SILENT,
    ),
    Candidacies(
        "405468",
        "Andrzej Sroka, born 1962-08-31, page uzUzC5PmReF944EC8tfJ",
        "Main's row also held entry 2102814 and its middle name, and took "
        "a namesake's 1994-2002 candidacies through it. " + SILENT,
    ),
    Candidacies(
        "1290816",
        "Barbara Chrobak, born 1965-09-10, page H3PquDWFUcFXQWjcyQ7q",
        f"{ARTICLE} Stanisława, as one record does; the other is silent.",
    ),
    Candidacies(
        "1108870",
        "Bogdan Bujak, born 1954-07-14, page zTt99gcrmJOg9YDCz1lb",
        f"{ARTICLE} Tadeusz, as one record does; the other is silent.",
    ),
    Candidacies(
        "1104386",
        "Ewa Kołodziej, born 1978-09-02, page E5TEDhgiftbBdZF2SueM",
        f"{ARTICLE} Edyta, as one record does; the other is silent.",
    ),
    Candidacies(
        "687276",
        "Jacek Brzezinka, born 1966-08-30, page HxRS1LI5K3DWsTKqsO3F",
        f"{ARTICLE} Piotr, as one record does; the other is silent.",
    ),
    Candidacies(
        "2323161",
        "Jacek Suski, born 1948-08-05, page VHwCmgoQhRbzSJiKhLAo",
        f"{ARTICLE} Antoni, as one record does; the other is silent.",
    ),
    Candidacies(
        "996363",
        "Jerzy Fedorowicz, born 1947-10-29, page ezEebT0TayJQlKqJDfKD",
        f"{ARTICLE} Feliks, as one record does; two are silent.",
    ),
    Candidacies(
        "1173787",
        "Jerzy Gwiżdż, born 1954-08-10, page C8CswoHkMLZDc3kanUr8",
        f"{ARTICLE} Lesław, as one record does; the other is silent.",
    ),
    Candidacies(
        "774027",
        "Krzysztof Dudek, born 1967-09-16, page uj2RiqkYsQlHzWz5tdfG",
        f"{ARTICLE} Adam, as one record does - one PKW emptied, standing in two "
        "places at once; the silent one has UW 1998 and PL!SP 2024.",
    ),
    Candidacies(
        "513561",
        "Leszek Sikorski, born 1955-10-24, page Ec89OOM0rPJapsolyzoJ",
        "The article matched to the day picked one of two silent records.",
    ),
    Candidacies(
        "683437",
        "Michał Wojtkiewicz, born 1946-06-24, page gvlnWGrbXTBfaD5w09AY",
        f"{ARTICLE} Jan, as one record does; the other is silent.",
    ),
    Candidacies(
        "720448",
        "Piotr Grzelak, born 1982-01-29, page WESYfmabVp0GHxrJgVKU",
        f"{ARTICLE} Grzegorz, as one record does; the other is silent.",
    ),
    Candidacies(
        "1393606",
        "Robert Choma, born 1963-06-24, page 7xmnGpitwsr2Cmaiz8sh",
        f"{ARTICLE} Jan, as one record does; the other is silent.",
    ),
    Candidacies(
        "143899",
        "Tomasz Koziński, born 1955-02-10, page W75goPoQs6imQmSyHY0N",
        f"{ARTICLE} Marian, as one record does; the other is silent.",
    ),
    Candidacies(
        "2968813",
        "Zbigniew Starzec, born 1962-02-10, page Dq7iTqNoYMbQEe2XKThG",
        f"{ARTICLE} Władysław, as one record does; the other is silent.",
    ),
    Candidacies(
        "1329145",
        "Janusz Okrzesik, born 1964-06-27, page pqXPIstULPPIqjo2uPvw",
        f"{ARTICLE} Władysław; silence had given him no candidacy (UD/UW "
        "1991-2001, Niezależni.BB).",
    ),
    Candidacies(
        "880588",
        "Wojciech Blecharczyk, born 1962-12-15, page oBS0QT1iW7FbWR87TZU3",
        f"{ARTICLE} Aleksander, as four records do, born 1961-1963 or undated; "
        "silence had given him none.",
    ),
    Candidacies(
        "244954",
        "Zbigniew Ostrowski, born 1955-07-28, page i4th6kA1LTGKVqazBbNY",
        f"{ARTICLE} Wiktor, as the record does; silence had given him none. The "
        "record has no candidacies.",
    ),
    Candidacies(
        "2333768",
        "Andrzej Pietrzyk, born 1953-08-24, page LUrsARZPP0vKaKMXupAd",
        "The article matched to the day calls him Andrzej Bartłomiej, so PKW's "
        "Andrzej Bolesław (Jaworze 2010), main's match, is refused.",
    ),
    Candidacies(
        "2196900",
        "Andrzej Parafianowicz, born 1963-10-25, no page",
        "The article matched to the day calls him Andrzej Tadeusz, so PKW's "
        "Andrzej Józef (UW 1998), main's match, is refused - though Józef's "
        "age at that election fits his birth date exactly.",
    ),
]

BY_NAME = (
    "A page with no register link, matched by the name alone to this one "
    "person, which main did not reach."
)

PAGES = [
    PageCase(
        "yZvogez1qIJpUjJxUasw",
        "Grażyna Dziedzic",
        "A page with no register link. Main's one row held entries 1033334, "
        "born 1954-06-28, and 411343, born 1955-07-27; they are two people now, "
        "and a name two people fit matches neither.",
    ),
    PageCase("a4hKpxzAfyPjqypmb4ot", "Adam Bartosik", BY_NAME),
    PageCase("dycNVusqrylw7jZsRuR2", "Anna Naszkiewicz", BY_NAME),
    PageCase("PImLFXh4jfLPYFkoPAoL", "Antoni Rapacz", BY_NAME),
    PageCase("j19aAxN9hMvJCKR4od9l", "Beata Michalec", BY_NAME),
    PageCase("eq3c9eovBgrl8t0AgoPX", "Dariusz Figura", BY_NAME),
    PageCase("f0AVzWnnQimsAmQW8Z5L", "Dariusz Klimczak", BY_NAME),
    PageCase("OUKwVbYr8EyWUCJ0u7hD", "Franciszek Adamczyk", BY_NAME),
    PageCase("9g0IF0S0uV54rNDYXVz6", "Jan Harhaj", BY_NAME),
    PageCase("QNEAJS2R1mWGKZ2otqdJ", "Marek Litwiński", BY_NAME),
    PageCase("yhFrSrgrTJYLLpFHmOpT", "Mieczysław Król", BY_NAME),
    PageCase("ueOMzU7aI2MEyLGz8Nxp", "Mieczysław Niedźwiedź", BY_NAME),
    PageCase("XvtKYOW3DCAClt0KvLB4", "Mikołaj Grzyb", BY_NAME),
    PageCase("E6kY7TgqQUBeWR9ZWJYK", "Tadeusz Maćkała", BY_NAME),
    PageCase("6ll42D5WFzfgnnsomTgF", "Waldemar Pawlak", BY_NAME),
    PageCase("dMqqUDHe4s28izMFH6cP", "Wiesław Pióro", BY_NAME),
    PageCase("N8NyT7R4ju27yMgpANNZ", "Włodzimierz Olszewski", BY_NAME),
]


def slug(text: str) -> str:
    return "-".join(fold(text.split(",", 1)[0]).split())


@pytest.fixture(scope="module")
def people():
    ctx, _ = setup_context()
    return Pipeline.create(PeopleEnriched).read_or_process(ctx)


def holding(people, rejestrio_id: str):
    """The rows carrying a register entry."""
    entries = people["rejestrio_id"].map(lambda ids: rejestrio_id in as_sequence(ids))
    return people[entries]


@pytest.mark.parametrize(
    "case", CANDIDACIES, ids=[f"{c.rejestrio_id}-{slug(c.who)}" for c in CANDIDACIES]
)
def test_a_reviewed_person_carries_the_decided_candidacies(people, case):
    rows = holding(people, case.rejestrio_id)
    assert len(rows) == 1, f"entry {case.rejestrio_id} is on {len(rows)} rows"
    attached = tuple(
        sorted(str(name) for name in as_sequence(rows.iloc[0]["pkw_records"]))
    )
    if case.decided is None:
        pytest.fail(
            f"Not decided: which of PKW's records are those of {case.who}?\n"
            f"{case.why}\n"
            f"Attached now: decided=Records({attached!r})"
        )
    assert attached == tuple(sorted(case.decided.names))


@pytest.mark.parametrize(
    "case", PAGES, ids=[f"{c.page_id}-{slug(c.who)}" for c in PAGES]
)
def test_a_reviewed_page_is_about_the_decided_person(people, case):
    rows = people[people["koryta_id"] == case.page_id]
    entries = sorted(i for ids in rows["rejestrio_id"] for i in as_sequence(ids))
    if case.decided is None:
        reaching = [
            (list(as_sequence(row["rejestrio_id"])), row["krs_name"], row["birth_date"])
            for _, row in rows.iterrows()
        ]
        pytest.fail(
            f"Not decided: who is page {case.page_id}, {case.who}, about?\n"
            f"{case.why}\n"
            f"Matched now: {reaching or 'nobody'}"
        )
    assert entries == ([case.decided.rejestrio_id] if case.decided.rejestrio_id else [])
