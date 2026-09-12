"""Inference for the article-content koryciarski models.

Two TF-IDF + logistic-regression models trained by
``scrapers.article.scripts.train_koryciarski_content_models``, kept in
``scrapers/article/models/`` next to this module:

- ``koryciarski_content_is_article`` : is the text actually an article?
  (binary logistic regression)
- ``koryciarski_content_score``      : how strongly the article is about
  koryciarstwo, 0-5 (multiclass, trained on articles only)

The models replicate the LLM oracle behind ``ArticleKoryciarskiScores``, so
that pipeline can score without the LLM (``--koryciarski-scorer ml``). Models
are loaded lazily so LLM pipelines never pay for them unless an ML scorer is
selected.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

# Must match the text truncation used when training the models.
TEXT_LIMIT = 20_000

_MODELS_DIR = Path(__file__).resolve().parent / "models"
IS_ARTICLE_MODEL = "koryciarski_content_is_article"
SCORE_MODEL = "koryciarski_content_score"

#: `model` value stamped on ML-scored rows so they never collide with LLM
#: rows in the same article_koryciarski_scores output file.
ML_MODEL_TAG = "koryciarski_content_ml"

_lock = threading.Lock()
_loaded: dict[str, object] = {}


def _load(name: str):
    with _lock:
        model = _loaded.get(name)
        if model is None:
            import joblib  # noqa: PLC0415  lazy: sklearn off the LLM path

            model = joblib.load(_MODELS_DIR / f"{name}.joblib")
            _loaded[name] = model
        return model


@dataclass(frozen=True)
class ContentKoryciarskiScore:
    is_article: bool
    #: 0-5 koryciarstwo degree; None when the text is not an article.
    score: int | None


def score_article(text: str) -> ContentKoryciarskiScore:
    """Run both models on parsed article content.

    The score model only applies once the "is article" gate passes -- matching
    the LLM oracle, which leaves the score null for non-articles.
    """
    text = (text or "")[:TEXT_LIMIT]
    is_article = bool(_load(IS_ARTICLE_MODEL).predict([text])[0])
    if not is_article:
        return ContentKoryciarskiScore(is_article=False, score=None)
    score = int(_load(SCORE_MODEL).predict([text])[0])
    return ContentKoryciarskiScore(is_article=True, score=score)


def models_available() -> bool:
    return (_MODELS_DIR / f"{IS_ARTICLE_MODEL}.joblib").exists() and (
        _MODELS_DIR / f"{SCORE_MODEL}.joblib"
    ).exists()