"""Classify BIP document URLs by category without reading their content.

Features are only what is known before parsing: the URL path (own and parent)
and the anchor text captured at crawl time (``bip_urls.anchor_text``), with
person names replaced by a ``<NAME>`` token. The token weights are trained
offline on 1,000 content-labelled documents (``bip_url_categories.json``) and
combined with a small curated keyword list, so the model stays inspectable.
"""

from __future__ import annotations

import json
import math
import re
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import pandas as pd
from tqdm import tqdm

from entities.bip import BipUrlClassified
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.common.pg import PostgresClient
from scrapers.stores import Context

CATEGORIES = ("przetargi", "oswiadczenia", "nabor", "inne")
FLUSH_EVERY = 500
BATCH_SIZE = 50_000
MODEL_PATH = Path(__file__).with_name("bip_url_categories.json")

_DIACRITICS = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")
_STOP = frozenset(
    {
        "pdf", "doc", "docx", "xls", "xlsx", "zip", "http", "https", "www",
        "php", "html", "index", "pliki", "plik", "uploads", "wp", "content",
        "sites", "default", "files", "file", "zalacznik", "zal", "nr", "strona",
        "strony", "pobierz", "otworz", "kb", "mb", "dokumenty", "bip", "public",
        "images",
    }
)
_BOILERPLATE = (
    "przejdz", "zamknij", "otworz", "menu", "back to login", "pobierz",
    "ukryj", "pokaz", "szukaj", "kontakt", "strona glowna", "cookies", "rodo",
    "logowanie", "panel", "wersja", "dostepnosc", "mapa",
)
_CAPITALISED_RUN = re.compile(
    r"\b[A-ZŁŚŻŹĆŃÓ][a-ząćęłńóśźż]+(?:[- ][A-ZŁŚŻŹĆŃÓ][a-ząćęłńóśźż]+)+\b"
)


def normalize(text: str) -> str:
    folded = (text or "").lower().translate(_DIACRITICS)
    folded = re.sub(r"[^a-z0-9]+", " ", folded)
    return re.sub(r"\s+", " ", folded).strip()


def tag_names(text: str) -> str:
    """Replace runs of capitalised words (person names) with ``<NAME>``."""
    return _CAPITALISED_RUN.sub("<NAME>", text or "")


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in normalize(tag_names(text)).split()
        if len(token) > 2 and token not in _STOP
    ]


def best_anchor(anchor_text: str) -> str:
    """First stored label that is not pure boilerplate."""
    for candidate in (anchor_text or "").split(" | "):
        words = normalize(candidate).split()
        if len(" ".join(words)) < 8:
            continue
        if all(word in _BOILERPLATE or word in _STOP for word in words):
            continue
        return candidate
    return ""


def features(
    url: str,
    anchor_text: str,
    parent_url: str,
    chain_nodes: tuple[str, ...] | list[str] = (),
    chain_anchors: tuple[str, ...] | list[str] = (),
) -> list[str]:
    """Tokens from the whole click trail when available, else the last hop.

    The chain is the list of URLs from the seed page down to the document, and
    ``chain_anchors`` the label of each hop's link (root first). A missing
    anchor contributes nothing; the URL paths of the chain still do.
    """
    if chain_nodes:
        path = " ".join(unquote(urlsplit(node).path) for node in chain_nodes)
        anchors = " | ".join(chain_anchors)
    else:
        path = unquote(urlsplit(url).path)
        if parent_url:
            path += " " + unquote(urlsplit(parent_url).path)
        anchors = best_anchor(anchor_text)
    return tokenize(path) + tokenize(anchors)


@cache
def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


_CHAIN_SQL = """
WITH RECURSIVE chain AS (
    SELECT url AS target, url AS node, discovered_from, anchor_text, 0 AS depth
      FROM bip_urls
     WHERE kind = 'doc' AND url = ANY(%s)
    UNION ALL
    SELECT c.target, u.url, u.discovered_from, u.anchor_text, c.depth + 1
      FROM chain c
      JOIN bip_urls u ON u.url = c.discovered_from
     WHERE c.depth < 8
)
SELECT target,
       array_agg(node ORDER BY depth DESC),
       array_agg(anchor_text ORDER BY depth DESC)
  FROM chain
 GROUP BY target
"""


def _chain_rows(pg: PostgresClient, batch: list[str]):
    """(url, chain nodes root-first, chain anchors root-first) per URL."""
    for target, nodes, anchors in pg.fetchall(_CHAIN_SQL, (batch,)):
        yield str(target), [str(node) for node in nodes], [a or "" for a in anchors]


@cache
def load_model() -> dict[str, Any]:
    return json.loads(MODEL_PATH.read_text(encoding="utf-8"))


def predict(
    model: dict[str, Any],
    url: str,
    anchor_text: str,
    parent_url: str,
    chain_nodes: tuple[str, ...] | list[str] = (),
    chain_anchors: tuple[str, ...] | list[str] = (),
) -> tuple[str, float, str]:
    """(category, score, runner-up) for one document URL.

    The score combines token evidence, the curated keyword bonus and the class
    prior; the pure token evidence stays out of it so the tests can pin the
    name/voice signals. Prior probabilities keep the rare classes (declarations,
    hiring) from swallowing the corpus, which a balanced training sample would
    otherwise cause.
    """
    tokens = set(features(url, anchor_text, parent_url, chain_nodes, chain_anchors))
    joined = " ".join(tokens)
    weights = model["classes"]
    curated = model.get("curated", {})
    priors = model.get("priors", {})
    log_prior = {
        category: math.log(priors.get(category, 1.0 / len(CATEGORIES)))
        for category in CATEGORIES
    }
    scores: dict[str, float] = {}
    for category in CATEGORIES:
        score = sum(
            value
            for token, value in weights.get(category, {}).items()
            if token in tokens
        )
        score += model.get("curated_bonus", 0.0) * sum(
            1 for keyword in curated.get(category, ()) if keyword in joined
        )
        if category == "oswiadczenia" and "name" in tokens:
            score += model.get("name_bonus", 0.0)
        scores[category] = score + log_prior[category]
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    return ranked[0][0], round(ranked[0][1], 3), ranked[1][0]


class BipUrlsClassified(IncrementalJsonlPipeline[BipUrlClassified]):
    filename = "bip_urls_classified"
    backup_to_shared_cache = False  # one row per URL; regenerated cheaply
    interrupt_exceptions = (KeyboardInterrupt, InterruptedError)
    interrupt_note = "will save classified URLs written so far"

    @property
    def output_class(self):
        return BipUrlClassified

    def process(self, ctx: Context) -> pd.DataFrame:
        model = load_model()
        self.prepare_temp_output()
        pg = PostgresClient.from_env(max_size=2)
        try:
            total_row = pg.fetchone("SELECT count(*) FROM bip_urls WHERE kind='doc'")
            total = int(total_row[0]) if total_row else 0
            emitted = 0
            with tqdm(
                total=total, desc="Classifying BIP URLs", unit="url", smoothing=0.05
            ) as bar:
                last = ""
                while True:
                    batch = [
                        row[0]
                        for row in pg.fetchall(
                            "SELECT url FROM bip_urls WHERE kind='doc' AND url > %s"
                            " ORDER BY url LIMIT %s",
                            (last, BATCH_SIZE),
                        )
                    ]
                    if not batch:
                        break
                    last = batch[-1]
                    for url, nodes, anchors in _chain_rows(pg, batch):
                        category, score, runner_up = predict(
                            model, url, "", "", nodes, anchors
                        )
                        record = BipUrlClassified(
                            url=url,
                            host=host_of(url),
                            category=category,
                            score=score,
                            runner_up=runner_up,
                            model_version=int(model["version"]),
                        )
                        ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
                        emitted += 1
                        if emitted % FLUSH_EVERY == 0:
                            ctx.io.dumper.flush()  # type: ignore[attr-defined]
                    bar.update(len(batch))
        finally:
            pg.close()
        print(f"classified: {emitted:,}")
        return pd.DataFrame()
