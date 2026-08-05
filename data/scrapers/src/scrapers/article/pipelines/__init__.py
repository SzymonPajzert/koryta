"""Article pipeline registry.

The pipeline classes are exposed lazily (module ``__getattr__``) so that
importing a leaf submodule — e.g. ``scrapers.article.pipelines.incremental``
or ``...parsed_pipeline``, which ``ArticlePersonMentions`` (analysis layer)
imports — does not eagerly pull in ``facts_pipeline``. ``ArticleExtractedFacts``
chains on ``ArticlePersonMentions`` as a pipeline source, so an eager import
here would form a cycle: analysis → pipelines.incremental → (this package) →
facts_pipeline → analysis.
"""

from importlib import import_module
from typing import Any

__all__ = [
    "ArticleAnalyzed",
    "ArticleDoneUrls",
    "ArticleDomainSelectors",
    "ArticleExtractedFacts",
    "ArticleFactsVerified",
    "ArticleKoryciarskiScores",
    "ArticleParsed",
]

_LAZY: dict[str, tuple[str, str]] = {
    "ArticleAnalyzed": ("article_analyzed_pipeline", "ArticleAnalyzed"),
    "ArticleDoneUrls": ("done_urls_pipeline", "ArticleDoneUrls"),
    "ArticleDomainSelectors": ("domain_selectors_pipeline", "ArticleDomainSelectors"),
    "ArticleExtractedFacts": ("facts_pipeline", "ArticleExtractedFacts"),
    "ArticleFactsVerified": ("verified_facts_pipeline", "ArticleFactsVerified"),
    "ArticleKoryciarskiScores": (
        "koryciarski_scores_pipeline",
        "ArticleKoryciarskiScores",
    ),
    "ArticleParsed": ("parsed_pipeline", "ArticleParsed"),
}


def __getattr__(name: str) -> Any:
    spec = _LAZY.get(name)
    if spec is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(import_module(f"{__name__}.{spec[0]}"), spec[1])
