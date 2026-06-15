"""
Extract article text from tarballs using verified CSS selectors.

For each domain in domain_selectors_semiverified.json:
  1. Find its tarball in the downloaded/ directory
  2. Stream index.txt to pick article candidate paths
  3. Extract matching HTML files one tarball at a time (never all at once)
  4. Apply the CSS selector to pull article body text
  5. Append results to extract_articles.jsonl (resumable)

Output per line: {domain, url, selector, text, char_count}
"""

import json
import re
import sys
import tarfile
from pathlib import Path

from bs4 import BeautifulSoup
from tqdm import tqdm

DOWNLOADED_DIR   = Path("/home/mp/Projects/koryta/data/scrapers/downloaded")
SELECTORS_FILE   = Path("domain_selectors_semiverified.json")
OUTPUT_FILE      = Path("extract_articles.jsonl")
MAX_INDEX_SCAN   = 2000   # index.txt lines to consider per tarball
MIN_TEXT_CHARS   = 200    # skip extracted text shorter than this
NON_ARTICLE_EXT  = re.compile(
    r"\.(php|jpg|jpeg|png|gif|mp4|avi|mov|pdf|svg|ico|xml|txt|csv|"
    r"doc|docx|xls|xlsx|webm|mp3|ogg|wav|zip|rar)$", re.I,
)
_SKIP_SEG_RE = re.compile(
    r"^(tag|tagi|kategori|category|categories|autor|author|strona|page|"
    r"archiv|szukaj|search|reklam|kontakt|o-nas|o-firmie|o-portalu|o-mnie|redakcja|"
    r"polityka|regulamin|newsletter|rejestracja|logowanie|feed|rss|"
    r"firma|firmy|katalog|ogloszeni|galeri|foto|fotorelacj|zdjecia|"
    r"wideo|video|ofert|klient|account|user|dodaj|zaloguj|login|register|"
    r"wp-admin|wp-content|forum|wydarzeni|terminarz|konkurs|przetarg|"
    r"spis|about|sample-page|hello-world|index|moje|my|opinie|contact|privacy|terms)",
    re.I,
)


def _segment_blocked(seg: str) -> bool:
    bare = re.sub(r"^\d+[_-]", "", seg).rsplit(".", 1)[0]
    return bool(_SKIP_SEG_RE.match(bare))


def _is_article_path(path: str) -> bool:
    path = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", path)
    path = re.sub(r"^hostname=[^/]+", "", path)
    segments = [s for s in path.split("/") if s]
    if not segments:
        return False
    if NON_ARTICLE_EXT.search(segments[-1]):
        return False
    if any(_segment_blocked(s) for s in segments):
        return False
    if len(segments) == 1:
        bare = segments[0].rsplit(".", 1)[0]
        return (len(bare) > 15 and bare.count("-") >= 2) or bool(re.search(r"\d{5,}", bare))
    return True


def _article_score(path: str) -> int:
    clean = re.sub(r"^hostname=[^/]+", "", path)
    clean = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", clean)
    segs  = [s for s in clean.split("/") if s]
    last  = segs[-1] if segs else ""
    score = 0
    hyphens = last.count("-")
    if len(last) > 25 and hyphens >= 3:
        score += 3
    elif len(last) > 12 and hyphens >= 2:
        score += 2
    if re.search(r"\d{5,}", path):
        score += 2
    if re.search(r"/20\d{2}/\d{2}/", clean):
        score += 2
    score += min(len(segs) - 1, 2)
    return score


def find_tarball(domain: str) -> Path | None:
    for p in DOWNLOADED_DIR.glob(f"hostname={domain}.*.tar.gz"):
        return p
    return None


def get_article_members(tarball: Path) -> list[tuple[str, str]]:
    """Return (member_name, url) pairs for article-like paths from index.txt."""
    candidates: list[tuple[int, str, str]] = []
    try:
        with tarfile.open(tarball, "r:gz") as tf:
            first = next(iter(tf))
            if first.name != "index.txt":
                return []
            raw = tf.extractfile(first).read().decode(errors="replace")
            lines = raw.strip().splitlines()

        for line in lines[:MAX_INDEX_SCAN]:
            line = line.strip()
            if not line or not _is_article_path(line):
                continue
            member_name = line.removeprefix("hostname=")
            url_path    = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", member_name)
            url         = "https://" + url_path
            candidates.append((_article_score(line), member_name, url))

        candidates.sort(key=lambda x: -x[0])
    except Exception as e:
        print(f"  [error] reading index {tarball.name}: {e}", file=sys.stderr)
    return [(m, u) for _, m, u in candidates]


def extract_text(html_bytes: bytes, selector: str) -> str | None:
    """Apply CSS selector and return clean text, or None if not found/too short."""
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
        el   = soup.select_one(selector)
        if not el:
            return None
        # Remove noise tags in-place on the selected element
        for tag in el.find_all(["script", "style", "nav", "aside", "iframe", "figure"]):
            tag.decompose()
        text = re.sub(r"\s+", " ", el.get_text(separator=" ")).strip()
        return text if len(text) >= MIN_TEXT_CHARS else None
    except Exception:
        return None


def main() -> None:
    selectors: dict[str, str] = json.loads(SELECTORS_FILE.read_text())
    print(f"Loaded {len(selectors)} domain selectors")

    # Resume: skip already-done domains
    done_domains: set[str] = set()
    if OUTPUT_FILE.exists():
        for line in OUTPUT_FILE.open():
            try:
                done_domains.add(json.loads(line)["domain"])
            except Exception:
                pass
        print(f"Resuming — {len(done_domains)} domains already done")

    domains_todo = [(d, s) for d, s in selectors.items() if d not in done_domains]

    with OUTPUT_FILE.open("a") as out:
        for domain, selector in tqdm(domains_todo, unit="domain"):
            tarball = find_tarball(domain)
            if not tarball:
                tqdm.write(f"  [skip] {domain}: no tarball found")
                continue

            members = get_article_members(tarball)
            if not members:
                tqdm.write(f"  [skip] {domain}: no article candidates in index")
                continue

            # Extract all candidate HTMLs in one sequential pass
            member_names = [m for m, _ in members]
            url_map      = {m: u for m, u in members}
            htmls: dict[str, bytes] = {}
            try:
                with tarfile.open(tarball, "r:gz") as tf:
                    targets = set(member_names)
                    for member in tf:
                        if member.name in targets:
                            f = tf.extractfile(member)
                            if f:
                                htmls[member.name] = f.read()
                            targets.discard(member.name)
                            if not targets:
                                break
            except Exception as e:
                tqdm.write(f"  [error] {domain}: {e}")
                continue

            extracted = 0
            for member_name, html_bytes in htmls.items():
                url  = url_map[member_name]
                text = extract_text(html_bytes, selector)
                if text is None:
                    continue
                record = {
                    "domain":     domain,
                    "url":        url,
                    "selector":   selector,
                    "text":       text,
                    "char_count": len(text),
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                extracted += 1

            out.flush()
            tqdm.write(f"  {domain}: {extracted}/{len(htmls)} articles extracted")

    print(f"\nDone. Results in {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
