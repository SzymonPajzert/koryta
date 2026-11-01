"""BUK Softres's BIPs: files offered as form buttons, the position's name for
their row."""

from __future__ import annotations

from jobs.bip_crawler.softres import files
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search

HOST = "https://u1.pl"
ATACH = f"{HOST}/atach/4/291"


def button(ident: int, label: str) -> str:
    return (
        '<li class="attachment-list__element"><form class="download" method="post">'
        f'<input type="hidden" name="attach_id" value="{ident}">'
        f'<input type="hidden" name="attach_file_path" value="{ATACH}/{ident}/x.pdf">'
        f'<button type="submit" class="attachment-list__button">{label}</button>'
        "</form></li>"
    )


#: Strzyżów's councillor's page (index.php?page=position.php&id=291&grp=5).
POSITION = (
    "<table><tbody><tr><td><strong>Nazwa pozycji</strong>:</td>"
    "<td>Grzegorz Baran</td></tr></tbody></table>"
    '<div class="persons"><span class="persons__position"><strong> Grzegorz&nbsp;'
    "Baran </strong></span><p>Oświadczenie majątkowe na początek kadencji.</p></div>"
    '<div class="attachment"><h2 class="attachment__title">Załączniki</h2>'
    '<ul class="attachment-list">'
    + button(8424, "Oświadczenie majątkowe na początek IX kadencji")
    + button(8919, "Oświadczenie majątkowe za 2024 rok.")
    + "</ul></div>"
)


def test_a_file_button_is_a_link_under_its_positions_name() -> None:
    url = f"{HOST}/index.php?page=position.php&id=291&grp=5"
    first, second = files(POSITION.encode(), url)
    assert first.url == f"{ATACH}/8424/x.pdf"
    assert first.anchor == "Oświadczenie majątkowe na początek IX kadencji"
    assert (
        first.row == "Grzegorz Baran | Oświadczenie majątkowe na początek IX kadencji"
    )
    assert second.anchor == "Oświadczenie majątkowe za 2024 rok."
    persons_only = POSITION.split("</table>", 1)[1]
    assert files(persons_only.encode(), url)[0].row.startswith("Grzegorz Baran |")
    assert files(b"<html><form><button>x</button></form></html>", url) == []
    # Rozwienica: a list's position names the list, its files their
    # councillors; whoever answers for the page is nobody's owner.
    listing = POSITION.replace(
        "<td>Grzegorz Baran</td>", "<td>Oświadczenia majątkowe radnych</td>"
    ).replace("Grzegorz&nbsp;Baran", "Anna Kowalska")
    assert files(listing.encode(), url)[0].row.startswith(
        "Oświadczenia majątkowe radnych |"
    )


def test_the_walk_takes_a_councillors_buttons_for_his_files(tmp_path) -> None:
    position = f"{HOST}/index.php?page=position.php&id=291&grp=5"
    sites = {
        HOST: html(
            "Urząd Miejski w Strzyżowie",
            '<a href="/index.php?page=position.php&amp;id=291&amp;grp=5">'
            "Grzegorz Baran</a>",
        ),
        position: html("Urząd Miejski w Strzyżowie", POSITION),
        f"{ATACH}/8424/x.pdf": (200, "application/pdf", PDF + b"1"),
        f"{ATACH}/8919/x.pdf": (200, "application/pdf", PDF + b"2"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("b", "u1", "Grzegorz", "Baran")], sitemaps=False
    )
    assert store.outcomes["b"].status == "found"
    assert {d.url for d in store.person_docs("b") if d.status == "ok"} == {
        f"{ATACH}/8424/x.pdf",
        f"{ATACH}/8919/x.pdf",
    }
