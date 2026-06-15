import json, re
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import precision_recall_curve
from sklearn.model_selection import train_test_split

art_map = {json.loads(l)['url']: json.loads(l)['text'] for l in Path("extract_articles.jsonl").open()}
llm = {json.loads(l)['url']: json.loads(l)['score'] for l in Path("score_koryciarski.jsonl").open()}

pos_urls = [u for u, s in llm.items() if s >= 4 and u in art_map]
neg_urls = [u for u, s in llm.items() if s <  4 and u in art_map]
urls   = pos_urls + neg_urls
labels = [1]*len(pos_urls) + [0]*len(neg_urls)
texts  = [art_map[u] for u in urls]

X_train, X_test, y_train, y_test = train_test_split(
    list(zip(urls, texts)), labels, test_size=0.2, random_state=42, stratify=labels
)
train_urls, train_texts = zip(*X_train)
test_urls,  test_texts  = zip(*X_test)
y_train = np.array(y_train)
y_test  = np.array(y_test)

tfidf = TfidfVectorizer(analyzer="word", ngram_range=(1,2), min_df=3, max_features=50000, sublinear_tf=True)
X_tr = tfidf.fit_transform(train_texts)
X_te = tfidf.transform(test_texts)
lr = LogisticRegression(C=5.0, max_iter=1000, class_weight="balanced")
lr.fit(X_tr, y_train)
scores = lr.predict_proba(X_te)[:, 1]

prec, rec, thresh = precision_recall_curve(y_test, scores)
idx = np.where(rec >= 0.99)[0]
threshold = float(thresh[idx[-1]])
preds = (scores >= threshold).astype(int)

tp = [(test_urls[i], llm[test_urls[i]], scores[i]) for i in range(len(y_test)) if preds[i]==1 and y_test[i]==1]
fp = [(test_urls[i], llm[test_urls[i]], scores[i]) for i in range(len(y_test)) if preds[i]==1 and y_test[i]==0]
fn = [(test_urls[i], llm[test_urls[i]], scores[i]) for i in range(len(y_test)) if preds[i]==0 and y_test[i]==1]

actual_rec = len(tp)/(len(tp)+len(fn))
actual_pre = len(tp)/(len(tp)+len(fp)) if (len(tp)+len(fp)) else 0
print(f"Threshold: {threshold:.3f}  |  Recall: {actual_rec:.2f}  Precision: {actual_pre:.2f}")
print(f"TP={len(tp)}  FP={len(fp)}  FN={len(fn)}\n")

# FP breakdown by LLM score
fp_by_score = {}
for u, s, sc in fp:
    fp_by_score[s] = fp_by_score.get(s, 0) + 1
print("=== FALSE POSITIVES by LLM score ===")
for s in sorted(fp_by_score):
    print(f"  score {s}: {fp_by_score[s]:4d}  ({100*fp_by_score[s]/len(fp):.0f}%)")

print(f"\n=== FALSE NEGATIVES ({len(fn)} missed positives) ===")
for u, s, sc in sorted(fn, key=lambda x: x[2]):
    text = art_map[u][:300].replace('\n', ' ')
    print(f"[LLM={s} model_score={sc:.3f}] {u[8:70]}")
    print(f"  {text[:200]}")
    print()

print(f"\n=== FALSE POSITIVES sample (score 2-3) ===")
fp_mid = [(u, s, sc) for u, s, sc in fp if s in (2, 3)]
for u, s, sc in sorted(fp_mid, key=lambda x: -x[2])[:8]:
    text = art_map[u][:200].replace('\n', ' ')
    print(f"[LLM={s} model_score={sc:.3f}] {u[8:70]}")
    print(f"  {text[:180]}")
    print()
