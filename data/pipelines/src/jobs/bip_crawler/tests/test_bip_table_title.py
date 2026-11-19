"""A table's title names its files' person: Gliwice's declarations register.

Built from bip.gliwice.eu/oswiadczeniaMajatkowe/lista as round 2 read it (11-13).
"""

from __future__ import annotations

from scrapers.bip.people import Seeker, candidates, stem
from scrapers.common.links import LinkContext, extract_link_contexts

NAMES = frozenset(stem(n, min_a=4) for n in "Agnieszka Adam Wiktoria Jan".split())

PAGE = "https://bip.gliwice.eu/oswiadczeniaMajatkowe/lista?_token=&funkcja=5"


def _person_table(name: str, office: str, file_id: int) -> str:
    return f"""<table id="zarzadzenia" class="table table-striped table-bordered">
<thead><tr><th style="text-align: center" colspan="2">{name}<br/>
{office}</th></tr>
<tr><th>Oświadczenie za rok</th><th>Informacja</th></tr></thead>
<tbody><tr><td><a href="https://bip.gliwice.eu/storage/oswiadczenia/12533_1_{file_id}.pdf"
title="Pobierz plik oświadczenia (PDF rozmiar 0.42 MiB )">2026 11.03.2026</a></td>
<td><a href="/oswiadczeniaMajatkowe/rejestrZmian/{file_id}">Rejestr zmian
dokumentu</a></td></tr></tbody></table>"""


GLIWICE = f"""<html><head><title>Oświadczenia majątkowe</title></head><body>
<h1>Oświadczenia majątkowe</h1>
{_person_table("Agnieszka Ficek", "radna", 10762)}
{_person_table("Adam Michczyński", "radny", 10578)}
<table><thead><tr><th colspan="2">Metryczka informacji</th></tr></thead>
<tbody><tr><td>Informację wytworzył</td><td>Tomasz Bartel</td></tr></tbody></table>
</body></html>"""


def _file(found: list, url_end: str) -> list[str]:
    return sorted(c.key for c in found if c.url.endswith(url_end))


def test_a_table_titled_with_a_name_gives_its_files_to_that_person():
    title, links = extract_link_contexts(GLIWICE, PAGE)
    ficek = Seeker.of("f", "Agnieszka", "Ficek")
    michczynski = Seeker.of("m", "Adam", "Michczyński")
    found = candidates(
        PAGE, title, links, [ficek, michczynski], first_names=NAMES, declared=True
    )
    assert _file(found, "12533_1_10762.pdf") == ["f"]
    assert _file(found, "12533_1_10578.pdf") == ["m"]
    assert all(c.first_name for c in found if c.key)


def test_only_a_caption_or_a_first_row_spanning_header_titles_a_table():
    html = """<html><body>
<table><tr><td>Rok</td><td>Plik</td></tr>
<tr><th colspan="2">Jan Kowalski</th></tr>
<tr><td>2024</td><td><a href="/a.pdf">za 2024</a></td></tr></table>
<table><caption>Wiktoria Bartosiewicz</caption>
<tr><td><a href="/b.pdf">za 2023</a></td></tr></table>
<table><tr><th>Jan Nowak</th></tr><tr><td><a href="/c.pdf">za 2022</a></td></tr></table>
</body></html>"""
    _, links = extract_link_contexts(html, "https://bip.example.pl/")
    captions = {x.url.rsplit("/", 1)[-1]: x.caption for x in links}
    assert captions == {"a.pdf": "", "b.pdf": "Wiktoria Bartosiewicz", "c.pdf": ""}


def test_a_title_naming_nobody_sought_takes_nothing_from_the_page_title():
    # A one-person page lends its files to its person; a table title of office
    # words must not make them somebody else's, as round 1's breadcrumb joined
    # into the heading did (11-13).
    page = "https://bip.example.pl/radni/jan-kowalski"
    title = "Jan Kowalski - oświadczenia majątkowe"
    link = LinkContext(
        "https://bip.example.pl/pliki/jk-2023.pdf",
        "za 2023",
        caption="Rada Miejska Chojnowa",
    )
    kowalski = Seeker.of("k", "Jan", "Kowalski")
    found = candidates(page, title, [link], [kowalski], first_names=NAMES)
    assert [c.key for c in found] == ["k"]


def test_a_title_giving_the_surname_alone_gives_nothing():
    link = LinkContext(
        "https://bip.gliwice.eu/storage/oswiadczenia/12533_9_1.pdf",
        "2026 11.03.2026",
        caption="Bartosiewicz radny",
    )
    wiktoria = Seeker.of("w", "Wiktoria", "Bartosiewicz")
    found = candidates(
        PAGE, "Oświadczenia majątkowe", [link], [wiktoria], first_names=NAMES
    )
    assert not [c for c in found if c.key]
