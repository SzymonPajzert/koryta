"""People mode on the hosting platforms whose BIPs it read badly on 10-31."""

from __future__ import annotations

from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search


def test_bip_net_pl_attachments_on_the_api_host_are_files(tmp_path):
    # bip.net.pl (BIP v2): titles carry the office's name only, the file links
    # go to the office's -api host with no extension and redirect to the PDF.
    article = (
        "<h2>Oświadczenie majątkowe radnych złożone na rozpoczęcie kadencji</h2>"
        "<ul><li>"
        '<a href="https://u1-api.bip.net.pl/api/attachments/1835">'
        "Jan Malinowski.pdf Jan Malinowski.pdf 3.51 MB</a></li><li>"
        '<a href="https://u1-api.bip.net.pl/api/attachments/1836">'
        "Ewa Lis.pdf Ewa Lis.pdf 3.48 MB</a></li></ul>"
    )
    category = "/kategorie/51-oswiadczenia-majatkowe"
    radni = f"{category}/artykuly/1229-radni?lang=PL"
    sites = {
        "https://u1.pl": html(
            "BIP Urząd Gminy U1",
            f'<a href="{category}?lang=PL">Oświadczenia majątkowe</a>',
        ),
        f"https://u1.pl{category}?lang=PL": html(
            "BIP Urząd Gminy U1",
            f'<a href="{radni}">'
            "Oświadczenie majątkowe radnych złożone na rozpoczęcie kadencji</a>",
        ),
        f"https://u1.pl{radni}": html("BIP Urząd Gminy U1", article),
        "https://u1-api.bip.net.pl/api/attachments/1835": (
            200,
            "application/pdf",
            PDF + b"jm",
        ),
        "https://u1-api.bip.net.pl/api/attachments/1836": (
            200,
            "application/pdf",
            PDF + b"el",
        ),
    }
    _, store, web, _ = search(tmp_path, sites, [row("m", "u1", "Jan", "Malinowski")])
    assert store.people["m"].status == "found"
    assert [d.url for d in store.person_docs("m")] == [
        "https://u1-api.bip.net.pl/api/attachments/1835"
    ]
    assert "https://u1-api.bip.net.pl/api/attachments/1836" not in web.calls
