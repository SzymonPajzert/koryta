"""Addresses the people mode misread on 11-13: CONCEPT Intermedia's SAM3
attachments, ZIPs and documents named in their address only, Joomla Phoca
Download's files, Żywiec's, ESC's version pages and AkcessNet's Google Docs
viewer links. Snippets from the real pages."""

from __future__ import annotations

from jobs.bip_crawler.tests.test_people_mode_big_bips import search
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row
from scrapers.bip.classify import is_document_url, is_low_value_url, normalize_url
from scrapers.bip.people import Seeker, candidates, is_file_link, same_file
from scrapers.common.links import extract_link_contexts

OPOCZNO = "https://bip.opoczno.pl"
SAM3_FILE = (
    f"{OPOCZNO}/Common/pobierzPlik/id/{{}}/module_short/port/obj_id/2556"
    "/culture/pl/version/pub.html"
)
SAM3_ZIP = f"{OPOCZNO}/Common/downloadZip/module_short/port/obj_id/2556/preview/0.html"
PHOCA = (
    "https://bip.olsztynek.pl/component/phocadownload/category/"
    "3435-owiadczenia-majtkowe-radnych23.html"
)
VIEWER = (
    "https://docs.google.com/a/www.powiat-czestochowski.4bip.pl/viewer?url="
    "https://www.powiat-czestochowski.4bip.pl/upload/plik,20210601122323,"
    "andrzej_kubat.pdf"
)
LAZISKA = "https://bip.laziska.pl/oswiadczenie-majatkowe-151"


def sam3_attachment(ident: int, label: str, size: str) -> str:
    """One file of a SAM3 portal page's "Załączniki" box."""
    return (
        f'<a class="zalacznik_embeded" title="{label}, plik PDF, {size}" '
        f'href="/Common/pobierzPlik/id/{ident}/module_short/port/obj_id/2556'
        f'/culture/pl/version/pub.html"><span><strong>{label}</strong><br>'
        f'<span class="size" aria-hidden="true">{size}</span></span></a>'
        '<div class="cl"></div>'
    )


#: Marcin Jędrasik's page on Opoczno's BIP (strona-2556), its files' box.
SAM3_PERSON = (
    '<div class="tresc">Dane wyłączone z Biuletynu Informacji Publicznej: '
    "informacja o adresie zamieszkania składającego oświadczenie</div>"
    '<aside class="left"><section class="powiazane"><header class="belka">'
    '<h2 class="title"><span>Załączniki&nbsp;(2)</span></h2>'
    '<a title="Pobierz wszystkie załączniki jako archiwum ZIP" class="zip_link" '
    'href="/Common/downloadZip/module_short/port/obj_id/2556/preview/0.html">'
    "Pobierz wszystkie załączniki</a></header>"
    '<div class="powiazane-wrapper">'
    + sam3_attachment(53981, "Oświadczenie majątkowe za 2019 rok", "663&nbsp;kB")
    + sam3_attachment(54950, "Oświadczenie majątkowe za 2020 rok", "644&nbsp;kB")
    + "</div></section></aside>"
)
SAM3_TITLE = "Jędrasik Marcin - Portal - BIP Powiat Opoczno"


def test_sam3_attachments_are_files_and_its_zip_is_not_read():
    first = SAM3_FILE.format(53981)
    assert is_document_url(first) and is_file_link(first)
    assert is_document_url(normalize_url(first))
    # The ZIP of all a page's attachments, each of them linked on its own.
    assert is_low_value_url(SAM3_ZIP)
    assert is_low_value_url(
        "https://bip.powiat.olecko.pl/dokumenty/downloadZip/id/4654.html"
    )
    assert not is_document_url(SAM3_ZIP)


def test_a_sam3_person_page_lends_its_files():
    title, links = extract_link_contexts(
        f"<html><head><title>{SAM3_TITLE}</title></head><body>{SAM3_PERSON}</body>",
        f"{OPOCZNO}/strona-2556-jedrasik_marcin.html",
    )
    seekers = [
        Seeker.of("m", "Marcin", "Jędrasik"),
        Seeker.of("w", "Grażyna", "Wójcik"),
    ]
    found = candidates(
        f"{OPOCZNO}/strona-2556-jedrasik_marcin.html", title, links, seekers
    )
    assert {(c.key, c.url) for c in found} == {
        ("m", SAM3_FILE.format(53981)),
        ("m", SAM3_FILE.format(54950)),
    }
    assert all(c.first_name and c.declaration_like for c in found)


def test_a_sam3_councillor_is_found_on_his_page(tmp_path):
    council = (
        '<ul><li class="zaj-wrapper"><div class="zajawka port_zaj">'
        '<a target="_self" href="/strona-2556-jedrasik_marcin.html">'
        '<span class="title">Jędrasik Marcin</span><span class="tresc">Dane '
        "wyłączone z Biuletynu Informacji Publicznej</span></a></div></li></ul>"
    )
    sites = {
        OPOCZNO: html(
            "BIP Powiat Opoczno",
            '<a href="/strona-51-oswiadczenia_majatkowe.html">'
            "Oświadczenia majątkowe</a>",
        ),
        f"{OPOCZNO}/strona-51-oswiadczenia_majatkowe.html": html(
            "Oświadczenia majątkowe - Portal - BIP Powiat Opoczno",
            '<a href="/strona-2542-radnych_rady_powiatu.html">Radnych Rady Powiatu '
            "Opoczyńskiego VI kadencji</a>",
        ),
        f"{OPOCZNO}/strona-2542-radnych_rady_powiatu.html": html(
            "Radnych Rady Powiatu Opoczyńskiego VI kadencji - Portal", council
        ),
        f"{OPOCZNO}/strona-2556-jedrasik_marcin.html": html(SAM3_TITLE, SAM3_PERSON),
        SAM3_FILE.format(53981): (200, "application/pdf", PDF + b"2019"),
        SAM3_FILE.format(54950): (200, "application/pdf", PDF + b"2020"),
        SAM3_ZIP: (200, "application/zip", b"PK\x03\x04"),
    }
    rows = [row("jedrasik", "u1", "Marcin", "Jędrasik")]
    _, store, web = search(
        tmp_path, sites, rows, scopes={"u1": "bip.opoczno.pl"}, sitemaps=False
    )
    assert store.outcomes["jedrasik"].status == "found"
    docs = store.person_docs("jedrasik")
    assert {d.url for d in docs} == {SAM3_FILE.format(53981), SAM3_FILE.format(54950)}
    assert len({d.sha256 for d in docs}) == 2
    assert not any("downloadZip" in c for c in web.calls)


WINNICA = "https://bip.gminawinnica.pl"


def sam3_document(ident: int, name: str) -> tuple[int, str, bytes]:
    """A document of Winnica's SAM3 BIP (dokument-3608): titled as all of them
    are, the declaration the document's own file, the declarant named in the
    breadcrumb and the address only."""
    body = (
        '<nav class="navigator" id="breadcrumbs"><h2>Breadcrumbs</h2><ul>'
        '<li><a href="/mapa_strony.html">Mapa Strony</a></li>'
        '<li><a href="/dokumenty.html">Baza dokumentów</a></li>'
        f"<li>Oświadczenie Majątkowe - {name} za rok 2025</li></ul></nav>"
        "<table><tr><th>Data podpisania</th><td>2026-04-21 11:52</td></tr>"
        "<tr><th>Treść dokumentu (wersja do pobrania</th><td>"
        '<section class="powiazane"><div class="file_title"><a title="Pobierz '
        f'plik, plik PDF" href="/dokumenty/download/dok_id/{ident}/type/tresc'
        '/dir/pub.html">Pobierz plik</a></div></section></td></tr></table>'
    )
    return html("Baza dokumentów - Biuletyn Informacji Publicznej Gmina Winnica", body)


def test_a_sitemap_address_naming_a_seeker_lends_them_its_page(tmp_path):
    index = (
        "<sitemapindex><sitemap>"
        f"<loc>{WINNICA}/sitemap-doku.xml</loc></sitemap></sitemapindex>"
    )
    documents = "".join(
        f"<url><loc>{WINNICA}/dokument-{n}-oswiadczenie_majatkowe_{slug}.html</loc></url>"
        for n, slug in [
            (3608, "jerzy_karlowicz"),
            (3602, "pawel_krawczyk"),
            (3609, "dariusz"),
        ]
    )
    sites = {
        WINNICA: html("BIP Gmina Winnica", '<a href="/przetargi.html">Przetargi</a>'),
        f"{WINNICA}/robots.txt": (
            200,
            "text/plain",
            b"User-agent: *\nDisallow: /uploads/\n\nSitemap: /sitemap.xml\n",
        ),
        f"{WINNICA}/sitemap.xml": (200, "text/xml", index.encode()),
        f"{WINNICA}/sitemap-doku.xml": (
            200,
            "text/xml",
            f"<urlset>{documents}</urlset>".encode(),
        ),
        f"{WINNICA}/dokument-3608-oswiadczenie_majatkowe_jerzy_karlowicz.html": (
            sam3_document(3608, "Jerzy Karłowicz")
        ),
        f"{WINNICA}/dokument-3602-oswiadczenie_majatkowe_pawel_krawczyk.html": (
            sam3_document(3602, "Paweł Krawczyk")
        ),
        f"{WINNICA}/dokument-3609-oswiadczenie_majatkowe_dariusz.html": (
            sam3_document(3609, "Dariusz Kowalczyk")
        ),
    }
    for n in (3608, 3602, 3609):
        sites[f"{WINNICA}/dokumenty/download/dok_id/{n}/type/tresc/dir/pub.html"] = (
            200,
            "application/pdf",
            PDF + str(n).encode(),
        )
    rows = [
        row("karlowicz", "u1", "Jerzy", "Karłowicz"),
        row("krawczyk", "u1", "Paweł", "Krawczyk"),
        row("guzel", "u1", "Stanisław", "Guzel"),
    ]
    _, store, _ = search(tmp_path, sites, rows, scopes={"u1": "bip.gminawinnica.pl"})
    (karlowicz,) = store.person_docs("karlowicz")
    (krawczyk,) = store.person_docs("krawczyk")
    assert "/dok_id/3608/" in karlowicz.url and "/dok_id/3602/" in krawczyk.url
    assert store.outcomes["karlowicz"].status == "found"
    assert store.outcomes["krawczyk"].status == "found"
    # A page whose address names nobody in full lends nobody its file.
    assert store.person_docs("guzel") == []


#: Olsztynek's Phoca Download category of councillors' declarations (3435).
PHOCA_CATEGORY = (
    '<h1 class="ph-header">Oświadczenia majątkowe radnych</h1>'
    '<div class="pd-filename"><div class="pd-document16"><div class="pd-float">'
    '<a class="" href="/component/phocadownload/category/'
    '3435-owiadczenia-majtkowe-radnych23.html?download=17628:kowalski-krzysztof">'
    "Kowalski Krzysztof.pdf</a></div></div></div>"
    '<div class="pd-filename"><div class="pd-document16"><div class="pd-float">'
    '<a class="" href="/component/phocadownload/category/'
    '3435-owiadczenia-majtkowe-radnych23.html?download=17630:lewandowski-roman">'
    "Lewandowski Roman.pdf</a></div></div></div>"
    '<a href="http://www.phoca.cz/phocadownload">Phoca Download</a>'
)


def test_phoca_download_links_are_files():
    kowalski = f"{PHOCA}?download=17628:kowalski-krzysztof"
    assert is_document_url(kowalski) and is_file_link(kowalski)
    # normalize_url writes the colon as %3A.
    assert is_file_link(normalize_url(kowalski))
    # Wrota's flag on a page is no file.
    assert not is_document_url("https://bip.x.pl/strona.html?download=1")


def test_two_phoca_files_of_one_category_are_two_files():
    kowalski = f"{PHOCA}?download=17628:kowalski-krzysztof"
    lewandowski = f"{PHOCA}?download=17630:lewandowski-roman"
    assert same_file(kowalski) != same_file(lewandowski)
    assert same_file(kowalski) == same_file(normalize_url(kowalski))
    # Wrota's ?download=1 is still the plain file asked for as a download.
    plain = "https://umchelm.bip.lubelskie.pl/upload/pliki/0bozenski_longin.pdf"
    assert same_file(plain + "?download=1") == same_file(plain)


def test_each_councillor_gets_his_own_phoca_file(tmp_path):
    # 11-13: the walk took both for one file and gave Lewandowski the PDF
    # that came down for Kowalski.
    sites = {
        "https://bip.olsztynek.pl": html(
            "BIP Urząd Miejski w Olsztynku",
            '<a href="/component/phocadownload/category/'
            '3435-owiadczenia-majtkowe-radnych23.html">Oświadczenia majątkowe '
            "radnych</a>",
        ),
        PHOCA: html("BIP Urząd Miejski w Olsztynku", PHOCA_CATEGORY),
        f"{PHOCA}?download=17628:kowalski-krzysztof": (
            200,
            "application/pdf",
            PDF + b"kowalski",
        ),
        f"{PHOCA}?download=17630:lewandowski-roman": (
            200,
            "application/pdf",
            PDF + b"lewandowski",
        ),
    }
    rows = [
        row("kowalski", "u1", "Krzysztof", "Kowalski"),
        row("lewandowski", "u1", "Roman", "Lewandowski"),
    ]
    _, store, _ = search(
        tmp_path, sites, rows, scopes={"u1": "bip.olsztynek.pl"}, sitemaps=False
    )
    (kowalski,) = store.person_docs("kowalski")
    (lewandowski,) = store.person_docs("lewandowski")
    assert kowalski.url.endswith("17628:kowalski-krzysztof")
    assert lewandowski.url.endswith("17630:lewandowski-roman")
    assert kowalski.sha256 != lewandowski.sha256


def test_a_zywiec_item_page_lends_its_file():
    # https://www.bip.zywiec.pl/item/8502: the file's name only in the
    # Content-Disposition of an application/octet-stream answer.
    body = (
        "<h1>Antoni Szlagor - Burmistrz Miasta Żywca</h1>"
        '<ul class="pagination"><li><a href="https://www.bip.zywiec.pl/item/8452">'
        "&laquo;&nbsp;Poprzedni</a></li></ul>"
        '<div class="blog-post-attachments"><h4>Załączniki:</h4>'
        '<table class="table table-striped"><thead><tr>'
        "<th>Opis (kliknij aby pobrać)</th><th>Data zamieszczenia</th>"
        "<th>Rozmiar</th></tr></thead><tbody><tr>"
        '<td><a href="https://www.bip.zywiec.pl/zalacznik/get/22517" '
        'title="Oświadczenie majątkowe">Oświadczenie majątkowe</a></td>'
        "<td>2025-06-24 08:58:00</td><td>163 kB</td></tr></tbody></table></div>"
    )
    page = "https://www.bip.zywiec.pl/item/8502"
    title, links = extract_link_contexts(
        "<html><head><title>Antoni Szlagor - Burmistrz Miasta Żywca</title>"
        f"</head><body>{body}</body></html>",
        page,
    )
    szlagor = Seeker.of("s", "Antoni", "Szlagor")
    (found,) = candidates(
        page, title, links, [szlagor, Seeker.of("c", "Janina", "Czul")]
    )
    assert (found.key, found.url) == (
        "s",
        "https://www.bip.zywiec.pl/zalacznik/get/22517",
    )
    assert found.first_name and found.declaration_like
    # Lesko's shape still is one, a bare /zalacznik/get/ is not.
    assert is_file_link("https://bip.lesko.pl/zalacznik/9565")
    assert not is_document_url("https://www.bip.zywiec.pl/zalacznik/get/")


def test_esc_version_comparisons_are_not_read():
    assert is_low_value_url(f"{LAZISKA}/porownaj/2/1")
    assert not is_low_value_url(LAZISKA)
    # By its address alone a version is a list's page too: /lista/<slug>/2.
    assert not is_low_value_url(f"{LAZISKA}/1")
    assert not is_low_value_url("https://bip.laziska.pl/lista/za-2024-rok/2")


def test_an_esc_pages_older_versions_are_not_read(tmp_path):
    # Grzegorz Nowok's correction at Łaziska Górne: its history links version 1
    # beside a comparison with it, the list its next page.
    history = (
        '<div class="history"><table><tbody>'
        '<tr><td class="c">2 - bieżąca</td><td>29 października 2024 12:10</td></tr>'
        '<tr><td class="c">1 - <a rel="nofollow" href="/oswiadczenie-majatkowe-151/1">'
        'zobacz dokument</a> | <a rel="nofollow" '
        'href="/oswiadczenie-majatkowe-151/porownaj/2/1">porównaj</a></td>'
        "<td>29 października 2024 12:09</td></tr></tbody></table></div>"
    )
    sites = {
        "https://bip.laziska.pl": html(
            "BIP - Łaziska Górne",
            '<a href="/lista/oswiadczenia-majatkowe">Oświadczenia majątkowe</a>',
        ),
        "https://bip.laziska.pl/lista/oswiadczenia-majatkowe": html(
            "BIP - Łaziska Górne » Oświadczenia majątkowe",
            '<a href="/oswiadczenie-majatkowe-151">Oświadczenie majątkowe</a>'
            '<a href="/lista/oswiadczenia-majatkowe/2">2</a>',
        ),
        "https://bip.laziska.pl/lista/oswiadczenia-majatkowe/2": html(
            "BIP - Łaziska Górne » Oświadczenia majątkowe", ""
        ),
        LAZISKA: html(
            "BIP - Łaziska Górne » Oświadczenie majątkowe",
            '<h3>Pliki do pobrania</h3><a href="/zalacznik/32632">Nowok Grzegorz '
            "korekta.pdf</a>" + history,
        ),
        "https://bip.laziska.pl/zalacznik/32632": (200, "application/pdf", PDF),
    }
    rows = [
        row("nowok", "u1", "Grzegorz", "Nowok"),
        row("kaleta", "u1", "Józef", "Kaleta"),
    ]
    _, store, web = search(
        tmp_path, sites, rows, scopes={"u1": "bip.laziska.pl"}, sitemaps=False
    )
    assert store.outcomes["nowok"].status == "found"
    asked = {normalize_url(c) for c in web.calls}
    assert "https://bip.laziska.pl/lista/oswiadczenia-majatkowe/2" in asked
    assert f"{LAZISKA}/1" not in asked
    assert f"{LAZISKA}/porownaj/2/1" not in asked


def test_a_google_docs_viewer_is_no_file():
    assert not is_document_url(VIEWER)
    assert not is_document_url("https://docs.google.com/viewer?url=https://x.pl/a.pdf")
    assert is_document_url(VIEWER.split("?url=", 1)[1])


def test_a_viewer_link_is_no_candidate():
    # AkcessNet links each file twice: plain, and as a viewer of it.
    body = (
        "<table><tr><td>Oświadczenie majątkowe radnego za 2020 rok</td><td>"
        '<a href="/upload/plik,20210601122323,andrzej_kubat.pdf">Oświadczenie '
        "majątkowe radnego za 2020 rok</a></td><td>"
        f'<a href="{VIEWER}">Otwórz plik w Google Docs - Viewer</a></td></tr></table>'
    )
    page = "https://www.powiat-czestochowski.4bip.pl/index.php?idg=6&id=237&x=20&y=448"
    title, links = extract_link_contexts(
        f"<html><head><title>Andrzej Kubat</title></head><body>{body}</body></html>",
        page,
    )
    found = candidates(page, title, links, [Seeker.of("k", "Andrzej", "Kubat")])
    assert [c.url for c in found] == [VIEWER.split("?url=", 1)[1]]
