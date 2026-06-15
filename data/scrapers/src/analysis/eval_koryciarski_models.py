"""
Compare CPU-based koryciarski classifiers.
Ground truth: LLM scores (>=4 = positive, <=1 = negative, 2-3 = excluded as ambiguous).
Train/test split: 80/20 stratified.
Reports precision at recall >= 0.90.
"""

import json
import re
import sys
import time
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import precision_recall_curve, average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

# ── load data ─────────────────────────────────────────────────────────────────

art_map = {}
for line in Path("extract_articles.jsonl").open():
    try:
        r = json.loads(line)
        art_map[r["url"]] = r["text"]
    except Exception:
        pass

llm_scores = {}
for line in Path("score_koryciarski.jsonl").open():
    try:
        r = json.loads(line)
        llm_scores[r["url"]] = r["score"]
    except Exception:
        pass

# Only use unambiguous labels: pos=4-5, neg=0-1
pos_urls = [u for u, s in llm_scores.items() if s >= 4 and u in art_map]
neg_urls = [u for u, s in llm_scores.items() if s < 4 and u in art_map]

print(f"Positive (score 4-5): {len(pos_urls)}")
print(f"Negative (score 0-1): {len(neg_urls)}")

urls = pos_urls + neg_urls
labels = [1] * len(pos_urls) + [0] * len(neg_urls)
texts = [art_map[u] for u in urls]

X_train_urls, X_test_urls, y_train, y_test = train_test_split(
    list(zip(urls, texts)), labels, test_size=0.2, random_state=42, stratify=labels
)
train_urls, train_texts = zip(*X_train_urls)
test_urls, test_texts   = zip(*X_test_urls)
y_train = np.array(y_train)
y_test  = np.array(y_test)
print(f"Train: {len(y_train)} (pos={y_train.sum()}), Test: {len(y_test)} (pos={y_test.sum()})\n")


def fbeta(prec, rec, beta):
    if prec + rec == 0:
        return 0.0
    return (1 + beta**2) * prec * rec / (beta**2 * prec + rec)

def prec_at_recall(prec, rec, target):
    idx = np.where(rec >= target)[0]
    return float(prec[idx[-1]]) if len(idx) else 0.0

def metrics_at_recall(y_true, scores):
    prec, rec, _ = precision_recall_curve(y_true, scores)
    ap  = average_precision_score(y_true, scores)
    auc = roc_auc_score(y_true, scores)

    p90 = prec_at_recall(prec, rec, 0.90)
    p95 = prec_at_recall(prec, rec, 0.95)
    p99 = prec_at_recall(prec, rec, 0.99)

    f1 = max(fbeta(p, r, 1) for p, r in zip(prec, rec))
    f2 = max(fbeta(p, r, 2) for p, r in zip(prec, rec))

    return p90, p95, p99, ap, auc, f1, f2


results = []

# ── 1. Keyword baseline ───────────────────────────────────────────────────────
print("1/4 Keyword baseline...", flush=True)

KEYWORD_TIERS = [
    (5, ["łapówk","korupcj","korupcyjn","protekcj","defraudacj","malwersacj","nepotyzm","antykorupcyjn","łapownictw"]),
    (3, ["zatrzyman","zarzut","podejrzan","oskarżon","przetarg","wpływani","powoływani","obsadzani","nadzorczych","nadzorczej","aferę","afery","skandal","nepotyczn"]),
    (2, ["prokuratur","cba","abw","dotacj","zamówieni","nadużyci","bezprawn","nielegalni","dyscyplinarn","rewizj","przeszukan"]),
    (4, ["collegium humanum","banaś","obajtk","wołomin","totalizator","elewarr","fundusz sprawiedliwości","afera wizow","rars","romanowsk","wawrzyk","kwaśniak","mandelson","oncoarend","biereck"]),
]

def kw_score(text):
    t = text.lower()
    words = set(re.findall(r"[a-ząćęłńóśźż]{4,}", t))
    score = 0.0
    for weight, terms in KEYWORD_TIERS:
        for term in terms:
            if " " in term:
                if term in t: score += weight
            else:
                if any(w.startswith(term) for w in words): score += weight
    return score

t0 = time.time()
test_kw_scores = np.array([kw_score(t) for t in test_texts])
elapsed = time.time() - t0
p90, p95, p99, ap, auc, f1, f2 = metrics_at_recall(y_test, test_kw_scores)
results.append(("Keyword matching", p90, p95, p99, ap, auc, f1, f2, elapsed, "no training"))
print(f"   done in {elapsed:.1f}s  p@r90={p90:.2f}  p@r95={p95:.2f}  p@r99={p99:.2f}  AUC={auc:.2f}  F2={f2:.2f}")


# ── 2. TF-IDF + Logistic Regression ──────────────────────────────────────────
print("2/4 TF-IDF + Logistic Regression...", flush=True)

t0 = time.time()
tfidf = TfidfVectorizer(
    analyzer="word", ngram_range=(1, 2), min_df=3, max_features=50000,
    sublinear_tf=True,
)
X_train_tfidf = tfidf.fit_transform(train_texts)
X_test_tfidf  = tfidf.transform(test_texts)
lr = LogisticRegression(C=5.0, max_iter=1000, class_weight="balanced")
lr.fit(X_train_tfidf, y_train)
test_lr_scores = lr.predict_proba(X_test_tfidf)[:, 1]
elapsed = time.time() - t0
p90, p95, p99, ap, auc, f1, f2 = metrics_at_recall(y_test, test_lr_scores)
results.append(("TF-IDF + LogReg", p90, p95, p99, ap, auc, f1, f2, elapsed, "trained"))
print(f"   done in {elapsed:.1f}s  p@r90={p90:.2f}  p@r95={p95:.2f}  p@r99={p99:.2f}  AUC={auc:.2f}  F2={f2:.2f}")


# ── 3. BM25 ───────────────────────────────────────────────────────────────────
print("3/4 BM25...", flush=True)
from rank_bm25 import BM25Okapi

def tokenize_pl(text):
    return re.findall(r"[a-ząćęłńóśźż]{3,}", text.lower())

t0 = time.time()
pos_train_texts = [train_texts[i] for i in range(len(train_texts)) if y_train[i] == 1]
query_tokens = tokenize_pl(" ".join(pos_train_texts[:50]))
bm25 = BM25Okapi([tokenize_pl(t) for t in test_texts])
bm25_scores = np.array(bm25.get_scores(query_tokens))
elapsed = time.time() - t0
p90, p95, p99, ap, auc, f1, f2 = metrics_at_recall(y_test, bm25_scores)
results.append(("BM25", p90, p95, p99, ap, auc, f1, f2, elapsed, "no training"))
print(f"   done in {elapsed:.1f}s  p@r90={p90:.2f}  p@r95={p95:.2f}  p@r99={p99:.2f}  AUC={auc:.2f}  F2={f2:.2f}")


# ── 4. Multilingual sentence embeddings ───────────────────────────────────────
print("4/4 Sentence embeddings (paraphrase-multilingual-MiniLM-L12-v2)...", flush=True)
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression as LR2

t0 = time.time()
model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
train_short = [t[:512] for t in train_texts]
test_short  = [t[:512] for t in test_texts]
X_train_emb = model.encode(train_short, batch_size=64, show_progress_bar=False)
X_test_emb  = model.encode(test_short,  batch_size=64, show_progress_bar=False)
lr2 = LR2(C=5.0, max_iter=1000, class_weight="balanced")
lr2.fit(X_train_emb, y_train)
test_emb_scores = lr2.predict_proba(X_test_emb)[:, 1]
elapsed = time.time() - t0
p90, p95, p99, ap, auc, f1, f2 = metrics_at_recall(y_test, test_emb_scores)
results.append(("MiniLM embeddings + LR", p90, p95, p99, ap, auc, f1, f2, elapsed, "trained"))
print(f"   done in {elapsed:.1f}s  p@r90={p90:.2f}  p@r95={p95:.2f}  p@r99={p99:.2f}  AUC={auc:.2f}  F2={f2:.2f}")


# ── summary table ─────────────────────────────────────────────────────────────
print()
print(f"{'Model':<26} {'P@R90':>6} {'P@R95':>6} {'P@R99':>6} {'AP':>6} {'AUC':>6} {'F1':>6} {'F2':>6} {'Time':>7}")
print("-" * 90)
for name, p90, p95, p99, ap, auc, f1, f2, elapsed, mode in results:
    print(f"{name:<26} {p90:>6.2f} {p95:>6.2f} {p99:>6.2f} {ap:>6.2f} {auc:>6.2f} {f1:>6.2f} {f2:>6.2f} {elapsed:>6.1f}s")
