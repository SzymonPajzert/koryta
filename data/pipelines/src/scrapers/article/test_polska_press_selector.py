"""The Polska Press selector reads the article, not the page around it.

Polska Press publishes gloswielkopolski.pl, pomorska.pl, dziennikpolski24.pl,
the *.naszemiasto.pl local sites and the rest of the domains that share one
selector in ``verified_selectors.json``. The platform puts the article in
``<main class="layoutsContainer--article">`` next to lists of other articles:
"Najnowsze", "Wybrane dla Ciebie", "Powiązane", "Polecamy". The selector used
to take the whole ``<main>``, so those headlines and leads reached the facts
prompt as if the article had said them. Inside the article the platform puts
more of them ("Sprawdź też", "Więcej z Twojej okolicy"), along with readers'
comments and quizzes, and ``parse.py`` takes those out by class name.

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


@pytest.mark.parametrize(
    "box",
    [
        # "Sprawdź też:" between two paragraphs: other articles' headlines
        "Sprawdź też:",
        "Rusz się z domu! 21 miejsc idealnych na krótką wycieczkę",
        # a quiz between the paragraphs
        "Poznaniak w barze mlecznym.",
        # readers' comments, inside the <article> element
        "Komentarze",
        "PiS strzelił sobie w kolano",
    ],
)
def test_article_leaves_out_the_boxes_inside_it(box: str):
    assert box not in _text("gloswielkopolski_article.html", "gloswielkopolski.pl")


@pytest.mark.parametrize(
    "teaser",
    [
        # the title of the gallery that follows this one
        "Następna galeria",
        "nie ocaliły Antoniego Macierewicza",
        # "Zobacz również", in the same column as the photos
        "Zobacz również",
        "Tak mieszka Katarzyna Grochola.",
    ],
)
def test_gallery_leaves_out_what_follows_the_photos(teaser: str):
    assert teaser not in _text("dzienniklodzki_gallery.html", "dzienniklodzki.pl")


def test_single_recommendation_in_the_body_is_left_out():
    # "Więcej z Twojej okolicy" as tomaszowmazowiecki.naszemiasto.pl renders
    # it: another article's headline, lead and author between two paragraphs.
    html = """
    <main class="layoutsContainer layoutsContainer--article">
    <div class="layoutsGrid"><div class="layoutsGrid__left"><article>
      <header class="atomsArticleHead"><h1 class="atomsArticleHead__title">
        Szpital w Tomaszowie jak partyjny folwark PiS
      </h1></header>
      <div class="componentsArticleContent">
      <div class="componentsArticleContent__text">
        <div class="md"><p>Zaczęło się od prezesa powiatowej spółki.</p></div>
        <div class="componentsRecommendationsSingleArticle">
          <h2 class="componentsRecommendationsSingleArticle__header">
            Więcej z Twojej okolicy
          </h2>
          <a class="componentsRecommendationsSingleArticle__link"
             href="https://naszemiasto.pl/nowy-prezes-szpitala/ar/c1p2-29209963">
            <div class="componentsRecommendationsSingleArticle__info">
              <h3 class="componentsRecommendationsSingleArticle__title">
                Nowy prezes szpitala w Tomaszowie wybrany. Kto przejmie stery TCZ?
              </h3>
              <p class="componentsRecommendationsSingleArticle__lead">
                Tym razem będzie to kobieta, mieszkanka Łodzi.
              </p>
              <div class="atomsTileAuthorWithAvatar">
                <span class="atomsTileAuthorWithAvatar__authorName">
                  Marek Obszarny
                </span>
              </div>
            </div>
          </a>
        </div>
        <div class="md"><p>Kontrakt obowiązywał do końca grudnia.</p></div>
      </div></div>
    </article></div></div></main>
    """.encode()
    selector = load_verified_selectors()["tomaszowmazowiecki.naszemiasto.pl"]

    text = extract_article_content(html, selector)["article_content"]

    assert text == (
        "Szpital w Tomaszowie jak partyjny folwark PiS "
        "Zaczęło się od prezesa powiatowej spółki. "
        "Kontrakt obowiązywał do końca grudnia."
    )


def test_article_leaves_out_the_notices_beside_it():
    # "Komunikaty i przetargi" as pomorska.pl renders it in the column beside
    # the article: official notices that name a wójt or a starosta, none of
    # them the article's. parse.py names no class of this box, so only the
    # narrowed selector keeps it out of the text.
    html = """
    <main class="layoutsContainer layoutsContainer--article">
    <div class="layoutsGrid">
    <div class="layoutsGrid__left medium-narrow large-wide"><article>
      <header class="atomsArticleHead"><h1 class="atomsArticleHead__title">
        Menedżer Roku 2015. Janusz Radzikowski
      </h1></header>
      <div class="atomsArticleLead">
        Przygotowuje się do egzaminu na pilota samolotowego.
      </div>
    </article></div>
    <aside class="layoutsGrid__right medium-narrow large-narrow">
      <div class="atomsSectionHeaderAccent">
        <h2 class="atomsSectionHeaderAccent__titleWrapper">
          <span class="atomsHeaderHeaderContent__title">
            Komunikaty i przetargi
          </span>
        </h2>
      </div>
      <div class="componentsTendersListing component">
        <ul class="componentsTendersListing__list">
          <li class="componentsTendersListing__element">
            <a class="componentsTendersListing__title">
              Bd.6721.1.202628.08.2026 r. OGŁOSZENIE WÓJTA GMINY BRENNA o...
            </a>
          </li>
        </ul>
      </div>
    </aside>
    </div></main>
    """.encode()
    selector = load_verified_selectors()["pomorska.pl"]

    text = extract_article_content(html, selector)["article_content"]

    assert text == (
        "Menedżer Roku 2015. Janusz Radzikowski "
        "Przygotowuje się do egzaminu na pilota samolotowego."
    )


def test_other_sites_keep_boxes_the_platform_does_not_name():
    html = b"""
    <article class="post">
      <p>Body.</p>
      <section class="related-articles">Another article's headline</section>
      <div class="comments">A reader's comment</div>
    </article>
    """

    text = extract_article_content(html, "article.post")["article_content"]

    assert text == "Body. Another article's headline A reader's comment"
