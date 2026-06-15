import csv, json, re
import numpy as np
from curl_cffi import requests
from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from sklearn.linear_model import LogisticRegression
from sklearn.feature_extraction.text import TfidfVectorizer

# ── train on all labeled data ─────────────────────────────────────────────────
art_map = {json.loads(l)['url']: json.loads(l)['text'] for l in Path("extract_articles.jsonl").open()}
llm     = {json.loads(l)['url']: json.loads(l)['score'] for l in Path("score_koryciarski.jsonl").open()}

train_urls   = [u for u, s in llm.items() if u in art_map]
train_texts  = [art_map[u] for u in train_urls]
train_labels = [1 if llm[u] >= 4 else 0 for u in train_urls]

print(f"Training on {len(train_texts)} articles...")
tfidf = TfidfVectorizer(analyzer="word", ngram_range=(1,2), min_df=3, max_features=50000, sublinear_tf=True)
lr    = LogisticRegression(C=5.0, max_iter=1000, class_weight="balanced")
lr.fit(tfidf.fit_transform(train_texts), train_labels)
print("Done.\n")

# ── load selectors + notes ────────────────────────────────────────────────────
selectors = json.loads(Path("domain_selectors_semiverified.json").read_text())
notes     = list(csv.DictReader(Path("koryta_notes.csv").open()))

matched = [
    r for r in notes
    if r.get("url", "").strip().startswith("http")
    and urlparse(r["url"].strip()).netloc.removeprefix("www.") in selectors
]
print(f"Notes with verified selector: {len(matched)}")
print()

# ── fetch with selector + score ───────────────────────────────────────────────
def fetch_with_selector(url, selector):
    try:
        r = requests.get(url, impersonate="chrome", timeout=15, allow_redirects=True)
        if r.status_code >= 400:
            return None
        soup = BeautifulSoup(r.content, "html.parser")
        el   = soup.select_one(selector)
        if not el:
            return None
        for tag in el(["script","style","nav","aside"]):
            tag.decompose()
        text = re.sub(r"\s+", " ", el.get_text(separator=" ")).strip()
        return text if len(text) > 100 else None
    except Exception:
        return None

for note in matched:
    url      = note["url"].strip()
    name     = note["name"]
    content  = note["content"].strip()[:120]
    domain   = urlparse(url).netloc.removeprefix("www.")
    selector = selectors[domain]

    text = fetch_with_selector(url, selector)
    if text is None:
        print(f"FAILED  {name} | {url[:60]}")
        continue

    score = float(lr.predict_proba(tfidf.transform([text]))[0, 1])
    print(f"[{score:.3f}] {name}")
    print(f"  url:     {url[:70]}")
    print(f"  note:    {content}")
    print(f"  extract: {text[:150]}")
    print()
