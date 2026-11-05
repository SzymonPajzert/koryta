"""samorzad.gov.pl's councils: a ``<details>`` a councillor, the name in its
summary, the files under "Materiały"."""

from __future__ import annotations

from jobs.bip_crawler.accordion import persons
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search

HOST = "https://u1.pl"


def councillor(name: str, *files: tuple[str, str]) -> str:
    links = "".join(
        f'<a class="file-download" href="/attachment/{ident}" download>{label}'
        f'<br/><span class="extension">{name.split(maxsplit=1)[0]}.pdf</span></a>'
        for ident, label in files
    )
    return (
        f'<details class="accordion-detail"><summary class="thin">'
        f'<span class="accordion-attribute__img-placeholder"></span>'
        f"<span>{name}</span></summary><article><h3></h3>"
        f"<h4>Materiały</h4>{links}</article></details>"
    )


#: powiat wołomiński's 2024-2029 council, two of its councillors.
COUNCIL = (
    "<h2>Radni Rady Powiatu w kadencji 2024-2029</h2>"
    + councillor(
        "Banaszek Paweł",
        (
            "ce72e032-b641-4a15-95cc-9190a4bc1532",
            "Oświadczenie majątkowe składane w terminie 30 dni od ślubowania",
        ),
        (
            "1d1f8555-9d71-469a-81c8-509447db07a0",
            "Oświadczenie o stanie majątkowym za 2024 rok",
        ),
    )
    + councillor(
        "Kowalska Anna",
        (
            "e53e2a8e-8b7b-452e-9452-fab5b11550af",
            "Oświadczenie o stanie majątkowym za 2024 rok",
        ),
    )
)


def test_a_details_links_are_its_summarys_persons() -> None:
    owned = persons(html("Radni", COUNCIL)[2], HOST + "/web/x/radni")
    assert owned[f"{HOST}/attachment/ce72e032-b641-4a15-95cc-9190a4bc1532"].startswith(
        "Banaszek Paweł | "
    )
    assert owned[f"{HOST}/attachment/e53e2a8e-8b7b-452e-9452-fab5b11550af"].startswith(
        "Kowalska Anna | "
    )
    # A section's long title is nobody's name; a page without <details> neither.
    section = (
        "<details><summary>Oświadczenia majątkowe radnych powiatu za lata"
        " 2019-2023</summary><a href='/f'>x</a></details>"
    )
    assert persons(html("x", section)[2], HOST) == {}
    assert persons(b"<html><a href='/f'>x</a></html>", HOST) == {}


def test_a_nested_details_answers_for_its_own_links() -> None:
    nested = (
        "<details><summary>Rada Powiatu</summary>"
        + councillor(
            "Banaszek Paweł",
            ("ce72e032-b641-4a15-95cc-9190a4bc1532", "Oświadczenie za 2024"),
        )
        + "</details>"
    )
    owned = persons(html("x", nested)[2], HOST)
    assert owned[f"{HOST}/attachment/ce72e032-b641-4a15-95cc-9190a4bc1532"].startswith(
        "Banaszek Paweł | "
    )


def test_the_walk_takes_each_councillors_files_from_the_accordion(tmp_path) -> None:
    sites = {
        HOST: html("Radni Rady Powiatu w kadencji 2024-2029", COUNCIL),
        f"{HOST}/attachment/ce72e032-b641-4a15-95cc-9190a4bc1532": (
            200,
            "application/pdf",
            PDF + b"1",
        ),
        f"{HOST}/attachment/1d1f8555-9d71-469a-81c8-509447db07a0": (
            200,
            "application/pdf",
            PDF + b"2",
        ),
        f"{HOST}/attachment/e53e2a8e-8b7b-452e-9452-fab5b11550af": (
            200,
            "application/pdf",
            PDF + b"3",
        ),
    }
    _, store, _, _ = search(
        tmp_path,
        sites,
        [row("b", "u1", "Paweł", "Banaszek"), row("k", "u1", "Anna", "Kowalska")],
        sitemaps=False,
    )
    assert store.outcomes["b"].status == "found"
    assert {d.url for d in store.person_docs("b") if d.status == "ok"} == {
        f"{HOST}/attachment/ce72e032-b641-4a15-95cc-9190a4bc1532",
        f"{HOST}/attachment/1d1f8555-9d71-469a-81c8-509447db07a0",
    }
    assert {d.url for d in store.person_docs("k") if d.status == "ok"} == {
        f"{HOST}/attachment/e53e2a8e-8b7b-452e-9452-fab5b11550af"
    }
