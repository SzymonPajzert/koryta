"""Wrota Lubelszczyzny's BIPs: document lists read through the JSON their pages
are drawn from, persons lists read with each file under its person."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace

from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from jobs.bip_crawler.wrota import Wrota, document_list, persons
from scrapers.bip.people import Seeker, candidates, choose, office_terms, stem
from scrapers.common.fetch import HttpResult
from scrapers.common.links import extract_link_contexts

HOST = "https://u1.pl"
CHALLENGE = b"<html><script>eval(function(p,a,c,k,e,d){}('fwb_dat'))</script></html>"


def breadcrumb(*items: str) -> str:
    links = "".join(
        f'<li><a href="/index.php?id={i}">{item}</a></li>'
        for i, item in enumerate(items)
    )
    return (
        '<nav aria-label="breadcrumb"><ul><li><a href="/index.php?id=6" '
        f'title="Strona główna"><i></i></a></li>{links}</ul></nav>'
    )


def list_page(menu: int, name: str, *trail: str) -> tuple[int, str, bytes]:
    """A document list's page as the CMS writes it: the menu, the breadcrumb,
    an empty table configured to draw its rows from list-ajax."""
    config = {
        "general": {"idKey": "id_dokumentu", "additional": {"menuName": name}},
        "settings": {"serverSide": True, "ajaxSource": f"?id={menu}&action=list-ajax"},
    }
    body = (
        breadcrumb(*trail, name)
        + '<main id="main-panel"><table id="documentsPublic" class="table '
        f"datatable-config-wrapper info\" data-config='{json.dumps(config)}'>"
        "<tbody></tbody></table></main>"
    )
    return html("Biuletyn Informacji Publicznej - Urząd Miasta U1", body)


def rows(*documents: tuple[str, str, str]) -> tuple[int, str, bytes]:
    data = [
        {"id_dokumentu": ident, "tresc": subject, "data_utworzenia": date}
        for ident, subject, date in documents
    ]
    body = {"sEcho": 0, "iTotalRecords": str(len(data)), "aaData": data}
    return 200, "application/json", json.dumps(body).encode()


def detail(menu: int, *files: tuple[str, str]) -> tuple[int, str, bytes]:
    """A document's page: back to the list, its files linked plain and as a
    download, each with its own page of details."""
    links = "".join(
        f'<a href="{HOST}/upload/pliki/{name}">{label}</a>'
        f'<a href="{HOST}/upload/pliki/{name}?download=1"></a>'
        f'<a href="?id={menu}&action=details&document_id=9{i}"></a>'
        for i, (name, label) in enumerate(files)
    )
    body = (
        f'<main id="main-panel"><a href="?id={menu}">Powrót do listy dokumentów</a>'
        f"<div>Tytuł</div>{links}</main>"
    )
    return html("Biuletyn Informacji Publicznej - Urząd Miasta U1", body)


def ajax(menu: int) -> str:
    rows = "iDisplayStart=0&iDisplayLength=500"
    return f"{HOST}/index.php?id={menu}&action=list-ajax&{rows}"


def page(menu: int, document: str) -> str:
    return f"{HOST}/index.php?id={menu}&action=details&document_id={document}"


CHELM = {
    f"{HOST}/index.php?id=295": list_page(
        295,
        "Radni Rady Miasta Chełm- kadencja 2024-2029",
        "Menu",
        "Oświadczenia majątkowe",
    ),
    ajax(295): rows(
        ("2049993", "Longin Bożeński", "2024-07-10"),
        ("2049992", "Dorota Rybaczuk", "2024-07-10"),
    ),
    page(295, "2049993"): detail(
        295,
        ("0l.bozenski.pdf", "na 30 dni po złożeniu ślubowania"),
        ("0bozenski_longin.pdf", "za 2025 r."),
    ),
    page(295, "2049992"): detail(295, ("rybaczuk.pdf", "za 2025 r.")),
}


class Site:
    def __init__(self, sites: dict[str, tuple[int, str, bytes]]) -> None:
        self.sites = sites
        self.calls: list[str] = []

    def get(self, url: str) -> HttpResult:
        self.calls.append(url)
        status, kind, body = self.sites.get(url, (404, "text/html", b""))
        return HttpResult(url, status, kind, body)


def listing(sites: dict, menu: int):
    found = document_list(
        sites[f"{HOST}/index.php?id={menu}"][2], f"{HOST}/index.php?id={menu}"
    )
    assert found is not None
    return found


BOZENSKI = Seeker.of("b", "Longin", "Bożeński")


def test_a_list_page_says_where_its_rows_come_from() -> None:
    found = listing(CHELM, 295)
    assert found.source == f"{HOST}/index.php?id=295&action=list-ajax"
    assert found.name == "Radni Rady Miasta Chełm- kadencja 2024-2029"
    assert found.trail == (
        "Radni Rady Miasta Chełm- kadencja 2024-2029 - Oświadczenia majątkowe - Menu"
    )
    assert found.declarations
    resolutions = list_page(12, "Uchwały Rady Miasta", "Menu", "Prawo lokalne")[2]
    found = document_list(resolutions, f"{HOST}/index.php?id=12")
    assert found is not None and not found.declarations
    assert document_list(b"<html><table></table></html>", HOST) is None


def test_a_councillors_documents_are_opened_and_nobody_elses() -> None:
    site = Site(CHELM)
    (document,) = Wrota(site.get).documents(
        listing(CHELM, 295), [BOZENSKI], None, frozenset(), 3, Counter()
    )
    assert page(295, "2049992") not in site.calls
    assert document.url == page(295, "2049993")
    assert document.title.startswith("Longin Bożeński - Radni Rady Miasta Chełm")
    # Each file once, its details page and its download copy left out.
    assert [(x.url, x.anchor) for x in document.links] == [
        (f"{HOST}/upload/pliki/0l.bozenski.pdf", "na 30 dni po złożeniu ślubowania"),
        (f"{HOST}/upload/pliki/0bozenski_longin.pdf", "za 2025 r."),
    ]
    found = candidates(document.url, document.title, list(document.links), [BOZENSKI])
    assert {c.url.rsplit("/", 1)[1] for c in found if c.first_name} == {
        "0bozenski_longin.pdf"
    }
    assert all(c.key == "b" and c.declaration_like for c in found)


def test_a_list_of_one_persons_documents_names_them_by_its_own_name() -> None:
    # Powiat zamojski: a list a councillor, its rows "Dokument za 2025 rok".
    name = "Adamczuk Agnieszka Katarzyna"
    sites = {
        f"{HOST}/index.php?id=977": list_page(
            977,
            name,
            "BIP",
            "Oświadczenia majątkowe",
            "Oświadczenia majątkowe radnych powiatu",
        ),
        ajax(977): rows(
            ("4", "Dokument za 2025 rok", "2026-07-13"),
            ("3", "dokument za 2024 rok", "2025-06-11"),
            ("2", "dokument na początek VII kadencji", "2024-06-28"),
            ("1", "dokument za 2023 rok", "2024-04-30"),
        ),
        **{
            page(977, i): detail(977, (f"{i}adamczuk_agnieszka.pdf", "Plik źródłowy"))
            for i in "1234"
        },
    }
    site = Site(sites)
    adamczuk = Seeker.of("a", "Agnieszka", "Adamczuk")
    documents = Wrota(site.get).documents(
        listing(sites, 977), [adamczuk], None, frozenset(), 3, Counter()
    )
    assert [d.url for d in documents] == [page(977, i) for i in "432"]
    found = [
        c
        for d in documents
        for c in candidates(d.url, d.title, list(d.links), [adamczuk])
    ]
    assert len(found) == 3 and all(c.key == "a" and c.first_name for c in found)


def test_a_staff_list_offers_its_people_by_first_name_alone() -> None:
    # Milejów files its staff's declarations beside the council's: Kamila
    # Zielińska's are not councillor Justyna's.
    first_names = frozenset(stem(n, min_a=4) for n in ("Kamila", "Justyna"))
    justyna = Seeker.of("z", "Justyna", "Zielińska")
    for trail, name, opened in (
        (("Urząd Gminy Milejów", "Oświadczenia majątkowe"), "Kamila Zielińska", 0),
        (("Urząd Gminy Milejów", "Oświadczenia majątkowe"), "Zielińska", 0),
        (("Rada Gminy", "Oświadczenia majątkowe"), "Zielińska", 1),
    ):
        sites = {
            f"{HOST}/index.php?id=789": list_page(789, name, *trail),
            ajax(789): rows(("1", "Oświadczenie z dnia 30.04.2021 r.", "2021-05-10")),
            page(789, "1"): detail(789, ("kzielinska_30042021.pdf", "Plik źródłowy")),
        }
        documents = Wrota(Site(sites).get).documents(
            listing(sites, 789),
            [justyna],
            office_terms(["Rada gminy"]),
            first_names,
            3,
            Counter(),
        )
        assert len(documents) == opened, (trail, name)


def test_a_persons_documents_are_counted_across_the_walks_lists() -> None:
    # Milejów lists a councillor's documents a year a list.
    sites: dict = {}
    for menu, year in ((807, 2021), (831, 2022)):
        sites[f"{HOST}/index.php?id={menu}"] = list_page(
            menu,
            "Marian Turek",
            "Rada Gminy",
            "Oświadczenia majątkowe",
            f"Oświadczenia {year}",
        )
        sites[ajax(menu)] = rows(
            (str(year), f"Oświadczenie za {year} r.", f"{year}-05-01")
        )
        sites[page(menu, str(year))] = detail(
            menu, (f"Turek.Marian.{year}.pdf", "Plik")
        )
    turek = Seeker.of("t", "Marian", "Turek")
    wrota = Wrota(Site(sites).get)
    opened: Counter[tuple[str, str]] = Counter()
    first = wrota.documents(listing(sites, 807), [turek], None, frozenset(), 1, opened)
    second = wrota.documents(listing(sites, 831), [turek], None, frozenset(), 1, opened)
    assert (len(first), len(second)) == (1, 0)


def test_a_list_that_answers_with_a_challenge_is_asked_once_more() -> None:
    answers = [(200, "text/html", CHALLENGE), CHELM[ajax(295)]]
    sites = dict(CHELM)

    def get(url: str) -> HttpResult:
        if url == ajax(295):
            status, kind, body = (
                answers.pop(0) if answers else (200, "text/html", CHALLENGE)
            )
            return HttpResult(url, status, kind, body)
        return Site(sites).get(url)

    wrota = Wrota(get)
    assert (
        len(
            wrota.documents(
                listing(CHELM, 295), [BOZENSKI], None, frozenset(), 3, Counter()
            )
        )
        == 1
    )
    assert (
        wrota.documents(
            listing(CHELM, 295), [BOZENSKI], None, frozenset(), 3, Counter()
        )
        == []
    )


#: Konopnica's persons list: a card a person, the files linked by an icon.
PERSONS = (
    breadcrumb("BIP", "Inne Dokumenty", "Oświadczenia majątkowe radnych")
    + '<main id="main-panel"><div class="accordion" id="person-assets-accordion">'
    + "".join(
        f'<div class="card card-toggle-expand"><div class="card-header">'
        f'<div><a href="?id=osoba&p1={p}" class="pl-3 link-loader">{who}</a></div>'
        '</div><div class="collapse"><div class="card-body">'
        '<div class="row"><div class="offset-1 col-sm-11 mb-2"><b>Rada gminy</b>'
        '</div></div><div class="row mb-2"><div class="col-sm-1"> 2024 </div>'
        '<div class="col-sm-8">oświadczenie majątkowe na dwa miesiące przed końcem '
        'kadencji</div><div class="col-sm-3"><div class="pull-right">'
        f'<a href="upload/pliki/{name}" title="Pobierz"><i class="fas fa-download">'
        "</i></a></div></div></div></div></div></div>"
        for p, who, name in (
            (43107, "Basak Tomasz", "0basak.pdf"),
            (43108, "Durlak Monika", "202208031120.pdf"),
        )
    )
    + "</div></main>"
)


def test_a_persons_lists_files_stand_under_their_person() -> None:
    url = f"{HOST}/index.php?id=88"
    owners = persons(PERSONS.encode(), url)
    assert owners == {
        f"{HOST}/upload/pliki/0basak.pdf": "Basak Tomasz | 2024 oświadczenie majątkowe"
        " na dwa miesiące przed końcem kadencji",
        f"{HOST}/upload/pliki/202208031120.pdf": "Durlak Monika | 2024 oświadczenie"
        " majątkowe na dwa miesiące przed końcem kadencji",
    }
    title, links = extract_link_contexts(PERSONS, url)
    links = [replace(x, row=owners[x.url]) if x.url in owners else x for x in links]
    durlak, duda = Seeker.of("m", "Monika", "Durlak"), Seeker.of("d", "Andrzej", "Duda")
    picks = choose(candidates(url, title, links, [durlak, duda]), [durlak, duda], 3, 3)
    # Durlak's own, by first name; Basak's is nobody's to hand Duda.
    assert {k: [c.url.rsplit("/", 1)[1] for c in v] for k, v in picks.items()} == {
        "m": ["202208031120.pdf"]
    }
    assert persons(b"<html></html>", url) == {}


# -- the walk ------------------------------------------------------------------
def test_the_walk_reads_a_councils_list_through_its_json(tmp_path) -> None:
    sites = {
        HOST: html(
            "Biuletyn Informacji Publicznej - Urząd Miasta U1",
            '<a href="/index.php?id=82">Oświadczenia majątkowe</a>'
            '<a href="/index.php?id=295">'
            "Radni Rady Miasta Chełm- kadencja 2024-2029</a>"
            # The same list sorted otherwise: its rows are read once.
            '<a href="/index.php?id=295&amp;sort=1">Radni Rady Miasta Chełm</a>',
        ),
        **CHELM,
        f"{HOST}/index.php?id=295&sort=1": CHELM[f"{HOST}/index.php?id=295"],
        f"{HOST}/upload/pliki/0bozenski_longin.pdf": (
            200,
            "application/pdf",
            PDF + b"b",
        ),
        f"{HOST}/upload/pliki/0l.bozenski.pdf": (200, "application/pdf", PDF + b"l"),
    }
    _, store, web, _ = search(
        tmp_path, sites, [row("b", "u1", "Longin", "Bożeński")], sitemaps=False
    )
    assert store.people["b"].status == "found"
    (doc,) = [d for d in store.person_docs("b") if d.status == "ok"]
    assert doc.url == f"{HOST}/upload/pliki/0bozenski_longin.pdf"
    assert doc.page_url == page(295, "2049993")
    assert web.calls.count(ajax(295)) == 1
    assert page(295, "2049992") not in web.calls
    assert store.units["u1"].declaration_pages == 1


def test_the_walk_reads_a_persons_list_with_each_file_under_its_person(
    tmp_path,
) -> None:
    sites = {
        HOST: html(
            "BIP", '<a href="/index.php?id=88">Oświadczenia majątkowe radnych</a>'
        ),
        f"{HOST}/index.php?id=88": html("Biuletyn Informacji Publicznej - U1", PERSONS),
        f"{HOST}/upload/pliki/202208031120.pdf": (200, "application/pdf", PDF + b"m"),
        f"{HOST}/upload/pliki/0basak.pdf": (200, "application/pdf", PDF + b"t"),
    }
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("m", "u1", "Monika", "Durlak"), row("d", "u1", "Andrzej", "Duda")],
        sitemaps=False,
    )
    assert store.people["m"].status == "found"
    assert store.people["d"].status == "not_found"
    assert f"{HOST}/upload/pliki/0basak.pdf" not in web.calls
