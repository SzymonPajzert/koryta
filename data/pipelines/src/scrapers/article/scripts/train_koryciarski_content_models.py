"""Train the article-content koryciarski models.

Two separate logistic-regression models over TF-IDF of the article text:

- koryciarski_content_is_article : predicts `llm_is_article` (is the text a
  real article vs a menu/listing/short blurb). Binary logistic regression.
- koryciarski_content_score      : predicts `koryciarski_llm_score` (0-5, how
  strongly the article is about koryciarstwo), trained on articles only.
  Multiclass logistic regression with balanced class weights.

Both answer questions the LLM oracle answers separately (score is null for
non-articles), so they are kept as two models: the first gates scoring and the
second measures degree, mirroring the existing two URL models.

Dataset (built by data/pipelines work, see /tmp/koryta_ml/build_dataset.py):
    <VERSIONED_DIR>/koryciarski_content_train.parquet
    url, domain, article_content, content_len, llm_is_article, score (0-5,
    null if not an article), content_hash.

Usage:

    uv run --with scikit-learn --with joblib \
      python -m scrapers.article.scripts.train_koryciarski_content_models

Artifacts are written to scrapers/article/models/*.joblib. Training provenance
and evaluation metrics are recorded in
scrapers/article/models/koryciarski_content_models_meta.json and embedded on
each checkpoint as ``model.metadata_`` (read them back with
``joblib.load(path).metadata_``) so future retrains know exactly what scale of
data and which evaluation these checkpoints were built on.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import make_pipeline

from scrapers.stores import VERSIONED_DIR

DATASET = Path(VERSIONED_DIR) / "koryciarski_content_train.parquet"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
URL_MODEL_PATH = MODELS_DIR / "koryciarski_url.joblib"  # optional comparison
META_FILE = MODELS_DIR / "koryciarski_content_models_meta.json"

DATASET_SOURCE = (
    "Domain-uniform per-class sample of article_koryciarski_scores.jsonl "
    "(labels by LLM Qwen/Qwen3.8-27B, prompt_version 1, scoring pipeline "
    "ArticleKoryciarskiScores), joined on url with article_content from "
    "article_parsed.jsonl (content kept <=30k chars at dataset build). "
    "Per class, rows are allocated evenly across domains via a per-domain cap; "
    "rare score classes 4 and 5 are kept fully."
)

TFIDF = dict(
    ngram_range=(1, 2),
    min_df=5,
    max_features=40_000,
    sublinear_tf=True,
    strip_accents="unicode",
    lowercase=True,
)
LR_CONFIG = dict(max_iter=2000, solver="lbfgs", class_weight="balanced")
TEXT_TRUNCATE = 20_000  # chars of content used per row
SEED = 42


def _load_dataset() -> pd.DataFrame:
    df = pd.read_parquet(DATASET)
    df["content"] = df["article_content"].str[:TEXT_TRUNCATE]
    print(f"dataset: {len(df):,} rows, {df['content'].str.len().median():,} "
          f"median content chars")
    return df


def _fit(
    subset: pd.DataFrame, multiclass: bool, *, domain_holdout: bool = False,
) -> tuple[object, pd.DataFrame, np.ndarray, np.ndarray]:
    """Fit a TF-IDF + logistic-regression pipeline on `subset`, return the
    pipeline plus the held-out rows/true labels/predicted labels.

    With domain_holdout, the held-out split keeps entire domains unseen
    (GroupShuffleSplit), to measure how well the model generalizes to sites
    it never trained on.
    """
    y = subset["y"].to_numpy()
    if domain_holdout:
        gss = GroupShuffleSplit(
            n_splits=1, test_size=0.2, random_state=SEED,
        )
        idx_tr, idx_te = next(gss.split(subset, y, groups=subset["domain"]))
    else:
        idx_tr, idx_te = train_test_split(
            np.arange(len(subset)), test_size=0.2, random_state=SEED,
            stratify=y,
        )
    lr = LogisticRegression(**LR_CONFIG)
    model = make_pipeline(TfidfVectorizer(**TFIDF), lr)
    model.fit(subset["content"].iloc[idx_tr].tolist(), y[idx_tr])
    y_pred = model.predict(subset["content"].iloc[idx_te].tolist())
    return model, subset.iloc[idx_te].copy(), y[idx_te], y_pred


def _report_classification(name: str, y_te, y_pred, classes) -> dict:
    """Print metrics and return them as a JSON-serializable dict."""
    acc = accuracy_score(y_te, y_pred)
    bal = balanced_accuracy_score(y_te, y_pred)
    print(f"\n=== {name} (test n={len(y_te):,}) ===")
    print(f"accuracy      {acc:.4f}")
    print(f"balanced acc  {bal:.4f}")
    labels = sorted(set(y_te) | set(y_pred))
    cm = confusion_matrix(y_te, y_pred, labels=labels).tolist()
    print(pd.DataFrame(cm, index=pd.Index(labels, name="true"),
                       columns=pd.Index(labels, name="pred")).to_string())
    if len(classes) == 2:
        auc = roc_auc_score(y_te, y_pred)
        p, r, f1, _ = precision_recall_fscore_support(
            y_te, y_pred, labels=labels,
        )
        print(f"roc-auc       {auc:.4f}")
        for c, pp, rr, ff in zip(labels, p, r, f1):
            print(f"  class {c!s:8}: prec {pp:.3f} recall {rr:.3f} f1 {ff:.3f}")
        base = np.bincount(y_te).max() / len(y_te)
        print(f"mostly-class baseline accuracy: {base:.4f}")
        return {
            "split": name,
            "n_test": int(len(y_te)),
            "accuracy": float(acc),
            "balanced_accuracy": float(bal),
            "roc_auc": float(auc),
            "class_f1": {str(c): float(ff) for c, ff in zip(labels, f1)},
            "baseline_accuracy": float(base),
            "confusion": cm,
        }
    f1w = f1_score(y_te, y_pred, average="weighted", zero_division=0)
    f1m = f1_score(y_te, y_pred, average="macro", zero_division=0)
    mae = mean_absolute_error(y_te, y_pred)
    base = np.bincount(y_te).max() / len(y_te)
    mean_mae = np.abs(y_te - y_te.mean()).mean()
    hot = y_te >= 4
    rec_hot = float(np.mean(y_pred[hot] >= 4)) if hot.sum() else None
    print(f"weighted-f1   {f1w:.4f}")
    print(f"macro-f1      {f1m:.4f}")
    print(f"MAE           {mae:.4f}")
    print(f"majority-class baseline accuracy: {base:.4f}")
    print(f"predict-mean baseline MAE: {mean_mae:.4f}")
    if hot.sum():
        print(f"recall on score>=4 : {rec_hot:.4f} ({hot.sum()} hot held-out)")
    return {
        "split": name,
        "n_test": int(len(y_te)),
        "accuracy": float(acc),
        "balanced_accuracy": float(bal),
        "weighted_f1": float(f1w),
        "macro_f1": float(f1m),
        "mae": float(mae),
        "recall_score_ge4": rec_hot,
        "n_hot": int(hot.sum()),
        "baseline_accuracy": float(base),
        "baseline_mae": float(mean_mae),
        "confusion": cm,
    }


def _run_split(
    subset: pd.DataFrame,
    multiclass: bool,
    domain_holdout: bool,
) -> tuple[object, pd.DataFrame, np.ndarray, np.ndarray]:
    label = "domain-held-out" if domain_holdout else "random-stratified"
    print(f"\n--- split: {label} ({len(subset):,} rows) ---")
    return _fit(subset, multiclass, domain_holdout=domain_holdout)


def _train_is_article(df: pd.DataFrame) -> tuple[object, dict]:
    subset = df.copy()
    subset["y"] = df["llm_is_article"].astype(int)
    metrics = {}
    for dh in (False, True):
        model, te, y_te, y_pred = _run_split(subset, False, dh)
        split = "domain_holdout" if dh else "random"
        metrics[split] = _report_classification(
            "koryciarski_content_is_article", y_te, y_pred, [0, 1],
        )
    model, *_ = _fit(subset, False)  # final artifact on the random split
    return model, metrics


def _train_score(df: pd.DataFrame) -> tuple[object, dict, pd.DataFrame]:
    articles = df[df["llm_is_article"]].copy()
    articles["y"] = articles["score"].astype(int)
    metrics = {}
    te_res = None
    for dh in (False, True):
        model, te, y_te, y_pred = _run_split(articles, True, dh)
        split = "domain_holdout" if dh else "random"
        metrics[split] = _report_classification(
            "koryciarski_content_score (articles only)", y_te, y_pred,
            [0, 1, 2, 3, 4, 5],
        )
        if dh:
            te_res = te.copy().assign(y_pred=y_pred)
    model, *_ = _fit(articles, True)  # final artifact on the random split
    assert te_res is not None
    return model, metrics, te_res


def _url_model_comparison(
    df: pd.DataFrame, articles_te: pd.DataFrame,
) -> dict | None:
    if not URL_MODEL_PATH.exists():
        print("\n(skipping URL-model comparison, koryciarski_url.joblib not found)")
        return None
    url_model = joblib.load(URL_MODEL_PATH)
    yt = articles_te["score"].astype(int).to_numpy()
    yp = np.clip(np.rint(url_model.predict(articles_te["url"].tolist())), 0, 5)
    yc = articles_te["y_pred"].to_numpy()
    print("\n=== URL-only model comparison (same held-out rows) ===")
    print(f"content LR MAE  : {mean_absolute_error(yt, yc):.4f}")
    print(f"url-only MAE    : {mean_absolute_error(yt, yp):.4f}")
    return {
        "n_rows": int(len(yt)),
        "content_ml_mae": float(mean_absolute_error(yt, yc)),
        "url_only_mae": float(mean_absolute_error(yt, yp)),
    }


def _dataset_meta(df: pd.DataFrame) -> dict:
    arts = df[df["llm_is_article"]]
    counts = df.groupby(["llm_is_article", "score"], dropna=False).size()
    by_class = {
        f"{'article' if a else 'not_article'}:"
        f"{'na' if pd.isna(s) else int(s)}": int(v)
        for a, s, v in counts.reset_index().itertuples(index=False)
    }
    top_domains = df["domain"].value_counts().head(10)
    lens = df["article_content"].str.len()
    return {
        "path": str(DATASET),
        "source": DATASET_SOURCE,
        "n_rows": int(len(df)),
        "n_articles": int(len(arts)),
        "n_not_articles": int(len(df) - len(arts)),
        "rows_by_class": by_class,
        "distinct_domains": int(df["domain"].nunique()),
        "top_domains": {str(k): int(v) for k, v in top_domains.items()},
        "content_chars": {
            "median": int(lens.median()),
            "mean": round(float(lens.mean()), 1),
            "min": int(lens.min()),
            "max": int(lens.max()),
        },
        "sampling": "domain-uniform per class (per-domain cap = ceil(target/"
        "ndomains)); score classes 4 and 5 kept fully; training rows drawn "
        "from the article_koryciarski_scores snapshot at dataset build time.",
    }


def _write_metadata(metadata: dict) -> None:
    META_FILE.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"saved {META_FILE}")


def _dump_with_metadata(model, name: str, metadata: dict) -> None:
    try:
        # Best-effort: sklearn estimators accept arbitrary attributes, so the
        # full provenance travels with the checkpoint (joblib.load(m).metadata_).
        setattr(model, "metadata_", metadata)
    except Exception:  # pragma: no cover
        print(f"warning: could not embed metadata on {name}")
    out = MODELS_DIR / f"{name}.joblib"
    joblib.dump(model, out, compress=3)
    print(f"saved {out} ({out.stat().st_size/1e6:.1f} MB)")


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    df = _load_dataset()
    dataset_meta = _dataset_meta(df)

    is_article_model, is_article_metrics = _train_is_article(df)
    score_model, score_metrics, articles_te = _train_score(df)
    url_cmp = _url_model_comparison(df, articles_te)

    metadata: dict = {
        "artifact": "koryciarski_content_models",
        "trained_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "labels": "LLM oracle article_koryciarski_scores.jsonl "
        "(model=Qwen/Qwen3.8-27B, prompt_version=1, "
        "is_article gate + 0-5 koryciarstwo score)",
        "config": {
            "features": {
                "tfidf": TFIDF,
                "text_truncate_chars": TEXT_TRUNCATE,
                "scaler": "none",
            },
            "is_article": {"name": "koryciarski_content_is_article",
                          "solver": LR_CONFIG["solver"],
                          "class_weight": LR_CONFIG["class_weight"],
                          "max_iter": LR_CONFIG["max_iter"]},
            "score": {"name": "koryciarski_content_score",
                      "solver": LR_CONFIG["solver"],
                      "class_weight": LR_CONFIG["class_weight"],
                      "max_iter": LR_CONFIG["max_iter"],
                      "labels": [0, 1, 2, 3, 4, 5]},
            "split": {"test_size": 0.2, "random_state": SEED,
                      "eval_modes": ["random-stratified", "domain-held-out"]},
        },
        "dataset": dataset_meta,
        "evaluation": {
            "is_article": is_article_metrics,
            "score": score_metrics,
        },
        "url_model_comparison": url_cmp,
    }

    for name, model in (
        ("koryciarski_content_is_article", is_article_model),
        ("koryciarski_content_score", score_model),
    ):
        _dump_with_metadata(model, name, metadata)
    _write_metadata(metadata)


if __name__ == "__main__":
    main()