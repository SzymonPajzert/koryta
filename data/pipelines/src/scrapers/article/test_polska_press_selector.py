"""The Polska Press selector reads the article, not the page around it.

Polska Press publishes gloswielkopolski.pl, pomorska.pl, dziennikpolski24.pl,
the *.naszemiasto.pl local sites and the rest of the domains that share one
selector in ``verified_selectors.json``. The platform puts the article in
``<main class="layoutsContainer--article">`` next to lists of other articles:
"Najnowsze", "Wybrane dla Ciebie", "Powiązane", "Polecamy". The selector used
to take the whole ``<main>``, so those headlines and leads reached the facts
prompt as if the article had said them.

The fixtures are stored pages trimmed to the template's structure: an article
from gloswielkopolski.pl and the last page of a photo gallery (``/gh/``) from
dzienniklodzki.pl, whose text is the photo captions.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from scrapers.article.parse import extract_article_content
from scrapers.article.pipelines.domain_selectors_pipeline import (
    load_verified_selectors,
)

_FIXTURES = Path(__file__).parent / "test_data" / "polska_press"

# What the selector used to be, for the 47 regional dailies and the 526
# naszemiasto.pl local sites respectively. Both match the whole <main>.
_WHOLE_PAGE = {
    "main.layoutsContainer--article",
    "main.layoutsContainer.layoutsContainer--article",
}


def _text(fixture: str, domain: str) -> str:
    html = (_FIXTURES / fixture).read_bytes()
    result = extract_article_content(html, load_verified_selectors()[domain])
    assert result["selector_matched"] is True
    return result["article_content"]


def test_no_polska_press_domain_reads_the_whole_page():
    selectors = load_verified_selectors()
    platform = {d: s for d, s in selectors.items() if "layoutsContainer" in s}

    assert not {d for d, s in platform.items() if s in _WHOLE_PAGE}
    # the regional dailies and the local sites alike
    assert selectors["gloswielkopolski.pl"] == selectors["krakow.naszemiasto.pl"]


@pytest.mark.parametrize(
    "kept",
    [
        # headline, lead, photo caption and body
        "Wybory parlamentarne 2019: Jarosław Pucek kandydatem PiS do senatu",
        "Podczas konferencji prasowej Prawo i Sprawiedliwość przedstawiło",
        "Jarosław Pucek z zawodu jest radcą prawnym.",
        "jako kandydat bezpartyjny z nominacji PiS.",
        "Jarosław Pucek jest nową propozycją PiS.",
    ],
)
def test_article_keeps_its_own_text(kept: str):
    assert kept in _text("gloswielkopolski_article.html", "gloswielkopolski.pl")


@pytest.mark.parametrize(
    "teaser",
    [
        # "Najnowsze", beside the article
        'Jaśkowiak prywatnie: "Jestem zwolennikiem ograniczania konsumpcji',
        # "Wybrane dla Ciebie", under it
        "Samolot odleciał, pasażerowie zostali na lotnisku.",
        # "Powiązane", after it: another article's headline and lead
        "Prokuratura „punktuje” dyrektora Zoo Poznań.",
        "oskarżył on pracownika ogrodu o przywłaszczenie mienia.",
        # sponsored offers, next to the article in its own column
        "Polecane oferty",
    ],
)
def test_article_leaves_out_the_lists_around_it(teaser: str):
    assert teaser not in _text("gloswielkopolski_article.html", "gloswielkopolski.pl")


def test_gallery_keeps_its_captions_and_leaves_out_the_column_beside_it():
    text = _text("dzienniklodzki_gallery.html", "dzienniklodzki.pl")

    assert "Marek Sarwa, dyrektor ds. logistyki w TCZ Sp. z o.o." in text
    assert "fot. Marek Obszarny" in text
    assert "Polecamy" not in text
