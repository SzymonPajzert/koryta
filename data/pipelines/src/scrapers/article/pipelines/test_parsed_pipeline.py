from __future__ import annotations

from scrapers.article.parse import NEWS_DATA_SELECTOR
from scrapers.article.pipelines.parsed_pipeline import (
    ParseTask,
    _classify_done_url,
    _parse_task,
)
from scrapers.stores import DoneUrl

_TVP_HTML = br"""
    <html><head><title>TVP</title></head><body>
      <section class="screening__wrapper"></section>
      <script>
        window.__newsData = {
          "lead": "Zapowied\u017a.",
          "text_paragraph_standard": [
            {"text": "<p>Odwo\u0142ano burmistrza.</p>"}
          ]
        };
      </script>
    </body></html>
    """


def _done(url: str) -> DoneUrl:
    return DoneUrl(
        uid="u1", url=url, storage_path="gs://b/x.tar.gz", media_type="text/html"
    )


def test_a_domain_without_a_selector_is_still_skipped():
    # selector is None: the domain has no verified selector and no sentinel, so
    # it stays out of the parse stream rather than being fed a fallback it has
    # no payload for.
    row, task, reusable = _classify_done_url(
        _done("https://example.com/2026/01/a-long-article-slug"),
        {},
        {},
    )
    assert (row, task, reusable) == (None, None, None)


def test_a_domain_with_the_news_data_sentinel_is_parsed():
    # The sentinel is a real selector string, so the URL becomes a task instead
    # of being skipped - this is what wires TVP into the __newsData reader.
    url = "https://wroclaw.tvp.pl/12345678/odwolano-burmistrza"
    row, task, reusable = _classify_done_url(
        _done(url),
        {"wroclaw.tvp.pl": NEWS_DATA_SELECTOR},
        {},
    )
    assert row is None and reusable is None
    assert task is not None
    assert task.selector == NEWS_DATA_SELECTOR
    assert task.domain == "wroclaw.tvp.pl"


def test_news_data_task_produces_an_ok_parse():
    task = ParseTask(
        uid="u1",
        url="https://wroclaw.tvp.pl/12345678/odwolano-burmistrza",
        storage_path="gs://b/x.tar.gz",
        domain="wroclaw.tvp.pl",
        selector=NEWS_DATA_SELECTOR,
    )
    record = _parse_task(task, _TVP_HTML)

    assert record["parse_status"] == "ok"
    assert record["extraction_method"] == "news_data"
    assert "Odwołano burmistrza." in record["article_content"]


def test_recovered_news_data_parse_is_reused_on_a_second_run():
    url = "https://wroclaw.tvp.pl/12345678/odwolano-burmistrza"
    done = _done(url)
    previous = {
        "parser_version": 2,
        "selector": NEWS_DATA_SELECTOR,
        "storage_path": done.storage_path,
    }
    row, task, reusable = _classify_done_url(
        done,
        {"wroclaw.tvp.pl": NEWS_DATA_SELECTOR},
        {url: previous},
    )
    assert task is None
    assert reusable == url


def test_a_sentinel_page_without_the_payload_is_not_ok():
    task = ParseTask(
        uid="u1",
        url="https://wroclaw.tvp.pl/12345678/x",
        storage_path="gs://b/x.tar.gz",
        domain="wroclaw.tvp.pl",
        selector=NEWS_DATA_SELECTOR,
    )
    record = _parse_task(
        task, b"<html><body><p>Server-rendered only.</p></body></html>"
    )

    assert record["parse_status"] == "selector_not_found"
    assert record["extraction_method"] is None
