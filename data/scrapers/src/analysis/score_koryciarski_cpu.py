"""
CPU-based koryciarski scorer using weighted keyword matching.

Derived from LLM-scored articles: words most over-represented in score 4-5
vs score 0-1 articles, split into tiers by specificity.

Goal: high recall — flag everything that might be score 4-5.
Output: score_koryciarski_cpu.jsonl  {domain, url, cpu_score, matched_keywords}
"""

import json
import re
from pathlib import Path

INPUT_FILE  = Path("extract_articles.jsonl")
OUTPUT_FILE = Path("score_koryciarski_cpu.jsonl")

# ── keyword tiers ─────────────────────────────────────────────────────────────
# Each tier: (weight, [terms])
# Stemmed/prefix matching: term matches if word startswith(term)

TIERS = [
    # Tier A (weight=5): unambiguous corruption/abuse vocabulary
    (5, [
        "łapówk",       # łapówka/łapówki/łapówkę
        "korupcj",      # korupcja/korupcji/korupcję
        "korupcyjn",    # korupcyjny/korupcyjnych/korupcyjnym
        "protekcj",     # protekcja/protekcji/protekcję
        "defraudacj",   # defraudacja
        "malwersacj",   # malwersacja
        "nepotyzm",     # nepotyzm/nepotyzmu
        "łapówkobiorc", # łapówkobiorca
        "antykorupcyjn",# antykorupcyjny
        "łapownictw",   # łapownictwo
    ]),

    # Tier B (weight=3): strong contextual signals
    (3, [
        "zatrzyman",    # zatrzymano/zatrzymał/zatrzymało (CBA arrests)
        "zarzut",       # zarzuty/zarzucono
        "podejrzan",    # podejrzany/podejrzanego
        "oskarżon",     # oskarżony/oskarżono
        "przetarg",     # przetarg/przetargu/przetargi
        "wpływani",     # wpływanie (na przetarg)
        "powoływani",   # powoływanie (na stanowiska)
        "obsadzani",    # obsadzanie stanowisk
        "nadzorczych",  # rada nadzorcza
        "nadzorczej",
        "aferę",        # afera
        "afery",
        "skandal",
        "nepotyczn",
        "konfliktu interesów",
        "konflikt interesów",
    ]),

    # Tier C (weight=2): softer contextual signals
    (2, [
        "prokuratur",   # prokuratura/prokuratury/prokuratorem
        "cba",          # CBA (Centralne Biuro Antykorupcyjne)
        "abw",          # ABW
        "oke",          # OKE (but noisy — skip)
        "dotacj",       # dotacja/dotacji (public grants)
        "zamówieni",    # zamówienie publiczne
        "spółk",        # spółka (company — weak alone)
        "skarbu państwa",
        "publiczn",     # publicznych pieniędzy (very weak alone)
        "nadużyci",     # nadużycie
        "bezprawn",     # bezprawnie
        "nielegalni",   # nielegalnie
        "dyscyplinarn", # postępowanie dyscyplinarne
        "rewizj",       # rewizja
        "przeszukan",   # przeszukanie
    ]),

    # Tier D (weight=4): known scandal names / high-signal proper nouns
    (4, [
        "collegium humanum",
        "banaś",
        "bania",        # banaś variants
        "obajtk",       # Obajtek/Obajtka
        "wołomin",      # gang z wołomina
        "totalizator",
        "elewarr",
        "fundusz sprawiedliwości",
        "afera wizow",
        "rars",
        "romanowsk",
        "wawrzyk",
        "kwaśniak",
        "mandelson",
        "oncoarend",
        "bierecc",
        "biereck",
    ]),
]


def tokenize(text: str) -> str:
    """Lowercase, keep Polish chars."""
    return text.lower()


def score_text(text: str) -> tuple[float, list[str]]:
    t = tokenize(text)
    words = re.findall(r"[a-ząćęłńóśźż]{4,}", t)
    word_set = set(words)

    total = 0.0
    matched = []

    for weight, terms in TIERS:
        for term in terms:
            # Multi-word: substring match in full text
            if " " in term:
                if term in t:
                    total += weight
                    matched.append(term)
            else:
                # Prefix match against word tokens
                hits = [w for w in word_set if w.startswith(term)]
                if hits:
                    total += weight
                    matched.append(term)

    return total, matched


def main() -> None:
    articles = []
    for line in INPUT_FILE.open():
        try:
            articles.append(json.loads(line))
        except Exception:
            pass
    print(f"Loaded {len(articles)} articles")

    # Resume
    done = set()
    if OUTPUT_FILE.exists():
        for line in OUTPUT_FILE.open():
            try:
                done.add(json.loads(line)["url"])
            except Exception:
                pass

    todo = [a for a in articles if a["url"] not in done]
    print(f"Scoring {len(todo)} articles...")

    with OUTPUT_FILE.open("a") as out:
        for art in todo:
            score, matched = score_text(art["text"])
            record = {
                "domain":           art["domain"],
                "url":              art["url"],
                "cpu_score":        score,
                "matched_keywords": matched,
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Stats + validation against LLM scores
    cpu = {json.loads(l)["url"]: json.loads(l) for l in OUTPUT_FILE.open()}
    llm = {}
    llm_file = Path("score_koryciarski.jsonl")
    if llm_file.exists():
        for line in llm_file.open():
            try:
                r = json.loads(line)
                llm[r["url"]] = r["score"]
            except Exception:
                pass

    both = [(cpu[u]["cpu_score"], llm[u]) for u in cpu if u in llm]
    print(f"\nCPU score distribution (all {len(cpu)} articles):")
    thresholds = [0, 2, 5, 8, 12, 20]
    for lo, hi in zip(thresholds, thresholds[1:] + [9999]):
        n = sum(1 for r in cpu.values() if lo <= r["cpu_score"] < hi)
        print(f"  cpu {lo:2d}-{hi if hi<9999 else '∞':>3}: {n:5d}")

    if both:
        print(f"\nValidation vs LLM scores ({len(both)} overlap):")
        for thresh in [3, 5, 8, 12]:
            tp = sum(1 for cpu_s, llm_s in both if cpu_s >= thresh and llm_s >= 4)
            fp = sum(1 for cpu_s, llm_s in both if cpu_s >= thresh and llm_s < 4)
            fn = sum(1 for cpu_s, llm_s in both if cpu_s < thresh and llm_s >= 4)
            tn = sum(1 for cpu_s, llm_s in both if cpu_s < thresh and llm_s < 4)
            total_pos = tp + fn
            recall    = tp / total_pos if total_pos else 0
            precision = tp / (tp + fp) if (tp + fp) else 0
            print(f"  cpu_thresh={thresh:2d}: recall={recall:.2f}  precision={precision:.2f}  "
                  f"tp={tp} fn={fn} fp={fp}")

    print(f"\nDone. Results in {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
