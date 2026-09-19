from __future__ import annotations

import json
from pathlib import Path

from scrapers.article.parse import NEWS_DATA_SELECTOR, extract_article_content
from scrapers.article.selectors import load_selector_map


def test_extract_article_content_uses_selector_and_ld_json():
    html = b"""
    <html>
      <head>
        <script type="application/ld+json">
          {"@type":"NewsArticle","headline":"Selector title",
           "datePublished":"2024-01-02"}
        </script>
      </head>
      <body>
        <main class="story-body">
          <p>First paragraph.</p>
          <p>Second paragraph.</p>
        </main>
      </body>
    </html>
    """

    result = extract_article_content(html, "main.story-body")

    assert result["selector_matched"] is True
    assert result["title"] == "Selector title"
    assert result["publication_date"].isoformat() == "2024-01-02"
    assert "First paragraph." in result["article_content"]
    assert result["ld_json"]["headline"] == "Selector title"


_TVP_HTML = br"""
    <html>
      <head><title>Page title</title></head>
      <body>
        <div id="navbar"></div>
        <section class="screening__wrapper"></section>
        <script>
          window.__newsData = {
            "title": "Agata Binkowska odwo\u0142ana",
            "lead": "Nag\u0142a zmiana w zarz\u0105dzie.",
            "text_paragraph_standard": [
              {"supertitle": null,
               "text": "<p>Odwo\u0142anie potwierdzi\u0142 Grzegorz \u017bmuda.</p>"},
              {"supertitle": null,
               "text": "<p>Binkowska by\u0142a radn\u0105 sejmiku.</p>"}
            ]
          };
        </script>
      </body>
    </html>
    """


def test_news_data_fallback_recovers_a_client_rendered_body():
    # No selector matches: the TVP regional CMS renders in the browser and
    # only leaves the payload in window.__newsData.
    result = extract_article_content(_TVP_HTML, "article.article__content")

    assert result["extraction_method"] == "news_data"
    assert result["selector_matched"] is False
    assert "Grzegorz Żmuda" in result["article_content"]
    assert "radną sejmiku" in result["article_content"]
    # The standalone `lead` is not duplicated into the body: real TVP pages
    # repeat it as `text_paragraph_lead`, and the body fields already carry it.
    assert result["article_content"].startswith("Odwołanie potwierdził")


def test_news_data_fallback_does_not_override_a_matching_selector():
    result = extract_article_content(_TVP_HTML, "#navbar")

    assert result["extraction_method"] == "selector"
    assert result["article_content"] == ""


def test_news_data_fallback_is_silent_when_the_object_is_missing():
    html = b"<html><body><main class='story-body'>Text</main></body></html>"
    assert extract_article_content(html, ".missing")["extraction_method"] is None


def test_news_data_sentinel_reads_the_payload_without_a_selector():
    # A domain mapped to the sentinel has no usable DOM selector: the payload is
    # read straight from __newsData, never via select_one.
    result = extract_article_content(_TVP_HTML, NEWS_DATA_SELECTOR)

    assert result["extraction_method"] == "news_data"
    assert result["selector_matched"] is False
    assert "Grzegorz Żmuda" in result["article_content"]


def test_news_data_sentinel_ignores_a_dom_selector_that_would_match():
    # The page's DOM holds only empty containers, but `#navbar` exists. The
    # sentinel must not fall back to it - that empty div is exactly the
    # "selector matched nothing useful" failure the sentinel exists to avoid.
    result = extract_article_content(_TVP_HTML, NEWS_DATA_SELECTOR)

    assert result["extraction_method"] == "news_data"
    assert result["article_content"].strip() != ""


def test_news_data_sentinel_is_silent_without_a_payload():
    html = b"<html><body><main class='story-body'>Text</main></body></html>"
    assert (
        extract_article_content(html, NEWS_DATA_SELECTOR)["extraction_method"] is None
    )


def test_news_data_fallback_survives_malformed_and_empty_objects():
    malformed = (
        b"<html><body><script>window.__newsData = {broken: ;</script></body></html>"
    )
    empty = b"<html><body><script>window.__newsData = {};</script></body></html>"

    assert extract_article_content(malformed, ".missing")["extraction_method"] is None
    assert extract_article_content(empty, ".missing")["extraction_method"] is None


def test_load_selector_map_normalizes_domains(tmp_path: Path):
    path = tmp_path / "selectors.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps({"domain": "WWW.Example.com", "selector": ".content"}),
                json.dumps({"domain": "example.org", "selector": "article"}),
            ]
        ),
        encoding="utf-8",
    )

    selectors = load_selector_map(path)

    assert selectors == {
        "example.com": ".content",
        "example.org": "article",
    }
