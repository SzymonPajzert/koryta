from __future__ import annotations

import json
from pathlib import Path

from scrapers.article.parse import extract_article_content
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
