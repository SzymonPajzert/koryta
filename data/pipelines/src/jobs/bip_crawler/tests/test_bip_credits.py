"""Whose file it is: the people mode's credits the 11-13 round found wrong.

Each test is built from the pages a walk read that day.
"""

from __future__ import annotations

from scrapers.bip.people import (
    DECLARATION,
    Seeker,
    candidates,
    choose,
    declarants,
    fold,
    link_score,
    names_somebody,
    person_named,
    says_declarations,
    stem,
    url_words,
)
from scrapers.common.links import LinkContext, extract_link_contexts

#: First names the list's candidacies carry, as `PeopleSearch.first_names` has them.
NAMES = frozenset(
    stem(n, min_a=4)
    for n in """Dariusz Monika Leszek Winicjusz Maciej Marek Krzysztof Tadeusz Józef
    Łukasz Tomasz Jan Kazimierz Małgorzata Wojciech""".split()
)


def test_a_record_without_seconds_names_who_entered_the_file():
    # Czeladź (IntraCOM.pl) ends each file's row with who entered it, to the
    # minute: the clerk's name made the chairman's declaration hers (11-13).
    page = "https://bip.czeladz.pl/strony/dominik_penar.html"
    title = (
        "Dominik Penar - Przewodniczący Rady Miejskiej - Biuletyn Informacji "
        "Publicznej | Dominik Penar - Przewodniczący Rady Miejskiej"
    )
    link = LinkContext(
        "https://bip.czeladz.pl/download/7061.html",
        "Oświadczenie majatkowe za 2025 rok",
        row="Oświadczenie majatkowe za 2025 rok zobacz: , ilość pobrań: 115 "
        "2026-08-25 14:35 Wolak Beata - Wydział Organizacyjno - Administracyjny "
        "169.27KB",
        heading="102",
    )
    penar = Seeker.of("p", "Dominik", "Penar")
    (found,) = candidates(page, title, [link], [penar], first_names=NAMES)
    assert (found.key, found.first_name, found.declaration_like) == ("p", True, True)


#: Powiat ostrowski's person page (www.powiat-ostrowski.pl/oswiadczenia.php),
#: its header <h2> left open, so that it swallows the page.
OSTROWSKI = """<html><head><title>Biuletyn Informacji Publicznej | Powiat Ostrowski |
Oświadczenia</title></head><body><div id="content"><h1>Oświadczenia</h1>
<div class="post"><h2>Wybierz kadencję: <a href="?act=kadencja&amp;id=7">VII</a>
<a href="?act=kadencja&amp;id=6">VI</a> <a href="?act=kadencja&amp;id=5">V</a>
<div style="float: right">Wzory druków: <a href="plik/9713">Radni</a>,
<a href="plik/9712">Członkowie Zarządu</a><div></h2>
<h1><span><u>Kadencja VII</u></span></h1></div>
<div class="post"><h2>Gostomczyk Tomasz</h2><p>Należy do Grup</p><ul>
<h3>Kierownicy jednostek organizacyjnych powiatu</h3>
<h3>Radni Rady Powiatu Ostrowskiego</h3></ul><p>Oświadczenia</p><ul>
<li><a href="?act=dnl&amp;id=3687"><span>[2026-04-28] oświadczenie majatkowe
</span></a></li><li><a href="?act=dnl&amp;id=3505"><span>[2025-01-30] oświadczenie
majatkowe</span></a></li><li><a href="?act=dnl&amp;id=3449"><span>[2024-06-06]
oświadczenie majatkowe</span></a></li>
</ul><h3><a href="oswiadczenia.php">powrót do listy osób</a></h3></div></div>
</body></html>"""


def test_term_switches_and_blank_forms_on_a_person_page_are_nobodys():
    # The walk reached the page through "Gostomczyk Tomasz" on the list; the
    # term switches and the forms took his three slots (11-13).
    page = "https://www.powiat-ostrowski.pl/oswiadczenia.php?act=osoba&id=17"
    title, links = extract_link_contexts(OSTROWSKI, page)
    gostomczyk = Seeker.of("g", "Tomasz", "Gostomczyk", "Waldemar")
    found = candidates(
        page,
        title,
        links,
        [gostomczyk],
        first_names=NAMES,
        lender=gostomczyk.name,
        declared=True,
    )
    base = "https://www.powiat-ostrowski.pl/oswiadczenia.php?act=dnl&id="
    assert [c.url for c in found] == [base + "3687", base + "3505", base + "3449"]
    picks = choose(found, [gostomczyk], 3, 3)["g"]
    assert {c.url for c in picks} == {base + "3687", base + "3505", base + "3449"}


#: Gmina Bolesławiec's councillors (SkyCMS, bip.gminaboleslawiec.pl/2291):
#: each name bold over its files, labelled with the person's initials.
SKYCMS = """<html><head><title>Radni Gminy Bolesławiec VIII Kadencji (2018 - 2023)
</title></head><body><ul>
<li><p><strong><span>Leszek Berny</span></strong><strong>&nbsp;</strong></p><ul>
<li><p>Za rok 2024 [<span><a class="fileLink"
href="https://bip.gminaboleslawiec.pl/download/attachment/50379/om_lb_2024c.pdf">
<span class="fileName">OM_LB_2024C (PDF | 1,42MB)</span></a></span>]</p></li></ul></li>
<li><p><strong><span>Łukasz Biegacz</span> </strong></p><ul>
<li><p>Za rok 2024 [<span><a class="fileLink"
href="https://bip.gminaboleslawiec.pl/download/attachment/50380/om_lb_2024c.pdf">
<span class="fileName">OM_ŁB_2024C (PDF | 2,08MB)</span></a></span>]</p></li></ul></li>
</ul></body></html>"""


def test_initials_in_a_file_code_and_an_empty_bold_name_nobody():
    # "OM ŁB" read as a name ended the search at the label, and an empty
    # <strong> after "Leszek Berny" left his file with no heading (11-13).
    page = "https://bip.gminaboleslawiec.pl/2291/radni-gminy-boleslawiec.html"
    title, links = extract_link_contexts(SKYCMS, page)
    assert [x.heading for x in links] == ["Leszek Berny", "Łukasz Biegacz"]
    berny = Seeker.of("b", "Leszek", "Berny", "Franciszek")
    biegacz = Seeker.of("l", "Łukasz", "Biegacz")
    found = candidates(page, title, links, [berny, biegacz], first_names=NAMES)
    assert [(c.key, c.first_name) for c in found] == [("b", True), ("l", True)]
    assert not names_somebody("OM_ŁB_2024A (PDF | 1,18MB)")
    # Wrota's register entry for the whole council (Włodawa).
    assert not names_somebody(
        "Oświadczenia majątkowe radnych Rady Powiatu we Włodawie VII kadencji "
        "składane za 2025 rok"
    )
    assert names_somebody("Oświadczenie majątkowe - Łukasz Biegacz")


def test_a_surname_that_is_a_word_counts_only_beside_their_name():
    # Kraśnik: "zakończenie pełnienia funkcji członka zarządu" gave Tadeusz
    # Członka Piotr Hacia's file (11-13).
    link = LinkContext(
        "https://umkrasnik.e-biuletyn.pl/upload/pliki/BIP-Hacia_III.2026.pdf",
        "treść",
        row="Oświadczenie majątkowe - zakończeni pełnienia funkcji członka "
        "zarządu - III.2026 treść",
        heading="Oświadczenia majątkowe kierowników Jednostek Organizacyjnych",
    )
    title = (
        "Oświadczenia majątkowe kierowników Jednostek Organizacyjnych - BIP "
        "Urząd Miasta Kraśnik | Urząd Miasta Kraśnik - Biuletyn Informacji Publicznej"
    )
    czlonka = Seeker.of("c", "Tadeusz", "Członka")
    page = "https://umkrasnik.e-biuletyn.pl/index.php?id=164"
    assert candidates(page, title, [link], [czlonka], first_names=NAMES) == []
    assert czlonka.named_in(fold("Oświadczenie majątkowe Tadeusza Członki")) == (
        True,
        True,
    )
    # Wschowa's and Zielona Góra's labels for their own (crawl of 11-12).
    starosta = Seeker.of("s", "Waldemar", "Starosta", "Henryk")
    said = fold("oświadczenie majątkowe maj 2025 - członek Zarządu Waldemar Starosta")
    assert starosta.named_in(said) == (True, True)
    assert starosta.named_in(fold("Waldemar Henryk Starosta")) == (True, True)
    assert starosta.named_in(fold("Oświadczenie majątkowe Starosty")) == (False, False)
    radny = Seeker.of("r", "Bernard", "Radny")
    assert radny.named_in(fold("Oświadczenie majątkowe - Bernard Radny")) == (
        True,
        True,
    )
    assert radny.named_in(fold("Radny Rady Powiatu - oświadczenie")) == (False, False)


def test_a_surname_run_into_an_address_needs_its_end():
    # Kłodzko: "J. Kołodziejczyk-Jakimiszyn" gave Wojciech Kołodziej three
    # files of hers (11-13).
    page = "https://bip.powiat.klodzko.pl/1716/jolanta-kolodziejczyk-zietkiewicz.html"
    title = "Jolanta Kołodziejczyk-Ziętkiewicz - Starostwo Powiatowe w Kłodzku"
    label = (
        "J. Kołodziejczyk-Jakimiszyn - oświadczenie majątkowe wg stanu na dzień "
        "31.12.2020 r. (PDF | 3,83MB)"
    )
    link = LinkContext(
        "https://bip.powiat.klodzko.pl/download/attachment/3733/"
        "j-kolodziejczyk-jakimiszyn-oswiadczenie-majatkowe-wg-stanu-na-dzien-"
        "31122020-r.pdf?v=1620732057",
        label,
        row=label,
        heading="Jolanta Kołodziejczyk-Ziętkiewicz",
    )
    kolodziej = Seeker.of("k", "Wojciech", "KOŁODZIEJ")
    assert candidates(page, title, [link], [kolodziej], first_names=NAMES) == []

    def named(first: str, last: str, file: str) -> tuple[bool, bool]:
        address = url_words(file)
        return Seeker.of("s", first, last).named_in(address, address, NAMES)

    # Files the 11-12 crawl credited by an address alone.
    assert named("Adam", "Salwowski", "/download/2/34127/salwowskiadam.pdf")[0]
    assert named("Kazimierz", "Świątczak", "/files/291/swiatczakk.pdf")[0]
    assert named("Maria", "Zalewska", "/download/2/36687/mariajolantazalewska.pdf")[0]
    assert not named("Sławomir", "Napierała", "/oswiadczenie_napieralski.pdf")[0]
    assert not named("Zbigniew", "Chmiel", "/adam-chmielewski-oswiadczenie.pdf")[0]
    assert not named("Jerzy", "Wójcik", "/osoby/29884/wojcikpawel.pdf")[0]


def test_a_letter_explaining_a_declaration_is_no_declaration():
    # Czeladź's "Wyjasnienia do oświadczenia ..." took 2 of Gadecki's 3 slots,
    # Iłża's dokument 1090 was all Józef Skrobisz was found on (11-13).
    letter = LinkContext(
        "https://bip.czeladz.pl/download/7062.html",
        "Wyjasnienia do oświadczenia majątkowego za 2025 rok",
        row="Wyjasnienia do oświadczenia majątkowego za 2025 rok zobacz: , ilość "
        "pobrań: 102 2026-08-25 14:37 Wolak Beata - Wydział Organizacyjno",
        heading="Rozmiar",
    )
    penar = Seeker.of("p", "Dominik", "Penar")
    title = "Dominik Penar - Przewodniczący Rady Miejskiej"
    page = "https://bip.czeladz.pl/strony/dominik_penar.html"
    assert candidates(page, title, [letter], [penar], first_names=NAMES) == []
    skrobisz = Seeker.of("s", "Józef", "SKROBISZ")
    ilza = LinkContext(
        "https://bip.ilza.pl/dokumenty/download/dok_id/1090/zal/1708/type/zal/dir/"
        "pub.html",
        "122 kB",
        row="Menu modułowe - Dokumenty Menu Statystyka Ilość odwiedzin: 3702945 "
        "Ostatnia aktualizacja tego dokumentu 30-08-2019 Breadcrumbs Wyjaśnienia "
        "do oświadczenia majątkowego - Józef Skrobisz Pobierz artykuł w formie "
        "pliku Pdf",
        heading="Załączniki (1)",
    )
    page = (
        "https://bip.ilza.pl/dokument-1090-wyjasnienia_do_oswiadczenia_majatkowego.html"
    )
    title = "Baza dokumentów - Biuletyn Informacji Publicznej Urząd Miejski w Iłży"
    assert candidates(page, title, [ilza], [skrobisz], first_names=NAMES) == []
    # Titled so, a page lends its file to nobody.
    bare = LinkContext(ilza.url, "122 kB")
    titled = "Wyjaśnienia do oświadczenia majątkowego - Józef Skrobisz | BIP Iłża"
    assert candidates(page, titled, [bare], [skrobisz], first_names=NAMES) == []
    # And a link to the letter says no declaration of his.
    to = LinkContext(page, "Wyjaśnienia do oświadczenia majątkowego - Józef Skrobisz")
    assert declarants(to, [skrobisz]) == set()


def test_experience_and_requests_for_public_information_are_no_declarations():
    # Brzostek: the sitemap seeded "... doświadczających przemocy" as a
    # declarations page, and each request lists its siblings under one asking
    # about "pracowników ... podlegających składaniu oświadczenia majątkowego":
    # ~80 requests read (11-13).
    seeded = (
        "https://bip.brzostek.pl/76-wniosek-o-udostepnienie-informacji-publicznej-"
        "dot-pomocy-dla-kobiet-doswiadczajacych-przemocy.html"
    )
    assert DECLARATION.search(url_words(seeded)) is None
    assert DECLARATION.search(fold("Leśny Zakład Doświadczalny w Rogowie")) is None
    assert DECLARATION.search(fold("Oświadczenia majątkowe radnych"))
    sibling = LinkContext(
        "https://bip.brzostek.pl/12-wniosek-o-udostepnienie-informacji-publicznej-"
        "dot-uzyskania-praw-miejskich-przez-brzostek-.html",
        "12) Wniosek o udostępnienie informacji publicznej dot. uzyskania praw "
        "miejskich przez Brzostek.",
        path="7) Wniosek o udostępnienie informacji publicznej dot. podania kwot "
        "wynagrodzenia dla pracowników Urzędu Miejskiego w Brzostku podlegających "
        "składaniu oświadczenia majątkowego",
    )
    assert not says_declarations(sibling)
    assert link_score(sibling, [], 1) <= -3  # below what the walk queues


def test_a_page_that_says_majatek_alone_pools_no_unnamed_file():
    # Brzeziny's tender went to all 18 people as their unnamed file (11-13).
    page = (
        "https://powiat-brzeziny.pl/ogloszenie-o-przetargu-na-sprzedaz-"
        "skladnikow-rzeczowych-majatku-ruchomego-powiatu/"
    )
    title = "Ogłoszenie o przetargu na sprzedaż składników rzeczowych majątku ruchomego"
    link = LinkContext(
        "https://powiat-brzeziny.pl/wp-content/uploads/2021/06/"
        "202106281404przetarg_tczew.pdf",
        "202106281404przetarg_tczew .pdf",
        row="202106281404przetarg_tczew .pdf",
        heading="Załączniki:",
    )
    kobiera = Seeker.of("k", "Renata", "Kobiera")
    assert candidates(page, title, [link], [kobiera], first_names=NAMES) == []
    # A declarations page's unnamed file still is, and so is one the walk
    # reached through a declarations section.
    own = "Oświadczenia majątkowe radnych za 2025 rok"
    (pooled,) = candidates(page, own, [link], [kobiera], first_names=NAMES)
    assert pooled.key == ""
    (led,) = candidates(page, title, [link], [kobiera], declared=True)
    assert led.key == ""


def test_a_request_for_public_information_pools_no_unnamed_file():
    # Brzostek's request about its mayor's declarations holds the request and
    # the answer, filed under case codes that name nobody: they went to six
    # seekers as their unnamed files, the burmistrz among them (11-13).
    page = (
        "https://bip.brzostek.pl/58-wniosek-o-udostepnienie-informacji-publicznej-"
        "dot-oswiadczen-majatkowych-skladanych-za-2024-i-2025-r-przez-burmistrza-"
        "brzostku-zastepce-burmistrza-skarbnika-sekretarza.html"
    )
    title = (
        "Wniosek o udostępnienie informacji publicznej dot. oświadczeń majątkowych "
        "składanych za 2024 i 2025 r. przez Burmistrza Brzostku"
    )
    files = "https://bip.brzostek.pl/files/file_add/download/"
    links = [
        LinkContext(
            files + "5729_wniosek-so1431582026.pdf",
            "Wniosek SO.1431.58.2026.pdf",
            heading="Załączniki",
        ),
        LinkContext(
            files + "5728_odpowiedz-so1431582026.pdf",
            "Odpowiedź SO.1431.58.2026.pdf",
            heading="Załączniki",
        ),
    ]
    kowalski = Seeker.of("k", "Zbigniew", "Kowalski")
    assert candidates(page, title, links, [kowalski], first_names=NAMES) == []
    assert candidates(page, title, links, [kowalski], declared=True) == []
    # The address alone says it too, when the title is lost.
    assert candidates(page, "", links, [kowalski], declared=True) == []


def test_a_page_about_somebody_nobody_seeks_lends_and_pools_nothing():
    # Braniewo gave Dariusz Lis's files to three 2014 councillors nothing
    # named; Żywiec Marek Czul's to Maciej Gibas (11-13).
    page = "https://bip.powiat-braniewo.pl/oswiadczenie-majatkowe/6069/dariusz-lis"
    title = (
        "Dariusz Lis - Oświadczenia majątkowe - Biuletyn Informacji Publicznej "
        "Powiat Braniewski | Dariusz Lis"
    )
    link = LinkContext(
        "https://bip.powiat-braniewo.pl/attachments/download/11587",
        "ariusz Lis- oświadczenie majątkowe za rok 2025",
        heading="Liczba pobrań:",
    )
    seekers = [
        Seeker.of("k", "Leszek", "KŁĘBUCKI"),
        Seeker.of("s", "Winicjusz", "SOKÓŁ"),
    ]
    assert candidates(page, title, [link], seekers, first_names=NAMES) == []
    zywiec = LinkContext(
        "https://www.bip.zywiec.pl/zalacznik/get/22351",
        "Oświadczenie majątkowe",
        row="Oświadczenie majątkowe 2025-05-16 08:04:00 196 kB",
        heading="Rozmiar",
    )
    czul = "Marek Czul - Zastępca Burmistrza Miasta Żywca | BIP - Urząd Miejski w Żywcu"
    gibas = Seeker.of("g", "Maciej", "Gibas")
    item = "https://www.bip.zywiec.pl/item/8420"
    for lender in (None, gibas.name):
        found = candidates(
            item, czul, [zywiec], [gibas], first_names=NAMES, lender=lender
        )
        assert found == []
    # His own page is still his.
    lis = Seeker.of("d", "Dariusz", "Lis")
    assert [
        c.key for c in candidates(page, title, [link], [lis], first_names=NAMES)
    ] == ["d"]
    assert person_named("KOSIŃSKI Krzysztof Roman | BIP - Urząd Miejski", NAMES)
    for place in (
        "Urząd Gminy i Miasta Kazimierz Dolny - Oświadczenia majątkowe",
        "Rada Gminy Góra Świętej Małgorzaty",
        "Szkoła Podstawowa im. Jana Pawła II",
    ):
        assert not person_named(place, NAMES), place


def test_a_middle_name_tells_a_seeker_from_a_namesake():
    # Grudziądz files two Krzysztof Kosińskis; the seeker, born 1962, got two
    # of the other's three files (11-13).
    base = "https://bip.grudziadz.pl/pliki/grudziadz/zalaczniki/"
    pages = (
        (
            "v-2024-poczatek-kadencji-4",
            "12104/14_08_2024_06_21_55_krzysztof_roman_kosinski_v_2024_poczatek.pdf",
        ),
        (
            "vi-2024-poczatek-kadencji-2",
            "12106/14_08_2024_06_21_12_krzysztof_kosinski_vi_2024_poczatek.pdf",
        ),
        ("iv-2026-roczne-10", "31749/krzysztof-kosinski-iv-2026-roczne.pdf"),
    )
    kosinski = Seeker.of("k", "Krzysztof", "KOSIŃSKI", "Roman")
    found = []
    for article, file in pages:
        label = file.rsplit("/", 1)[-1].removesuffix(".pdf").replace("_", " ")
        link = LinkContext(base + file, label, row=f"{label} (PDF)", heading="Pobrań")
        title = "Oświadczenia majątkowe | BIP - Urząd Miejski w Grudziądzu"
        url = f"https://bip.grudziadz.pl/artykul/{article}"
        found += candidates(url, title, [link], [kosinski], first_names=NAMES)
    assert [c.middle for c in found] == [True, False, False]
    assert [c.url for c in choose(found, [kosinski], 3, 3)["k"]] == [base + pages[0][1]]
