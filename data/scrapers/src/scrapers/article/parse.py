import json
from datetime import datetime

from bs4 import BeautifulSoup


def parse_date(date_string: str) -> datetime | None:
    """
    Parses a date string from various formats.
    """
    if not date_string:
        return None
    try:
        # Handle ISO format and other common formats
        return datetime.fromisoformat(date_string.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        # Add more formats here if needed
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d.%m.%Y %H:%M"):
            try:
                return datetime.strptime(date_string, fmt)
            except (ValueError, TypeError):
                continue
    return None


from datetime import datetime


def extract_article_content(html_bytes: bytes) -> dict:
    # 1. Parse and Pre-clean
    # Using 'lxml' is faster and more robust if available, otherwise 'html.parser'
    soup = BeautifulSoup(html_bytes, "html.parser")

    # Remove obvious non-content noise before analysis
    for noise in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
        noise.decompose()

    # --- 1. METADATA VALIDATION ---
    publication_date = None
    is_article_by_meta = False

    # Check JSON-LD for "NewsArticle" or "BlogPosting"
    # Homepages (like bad2.html) often list multiple types or just "WebSite"
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
            nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
            for node in nodes:
                if isinstance(node, dict):
                    node_type = str(node.get("@type", ""))
                    if any(x in node_type for x in ["Article", "NewsArticle", "BlogPosting"]):
                        # Verify this isn't just a snippet in a list
                        date_str = node.get("datePublished")
                        if date_str:
                            publication_date = parse_date(date_str)
                            is_article_by_meta = True
                            break
        except:
            continue

    # --- 2. CONTENT SCORING (Standard Assumptions) ---
    # Find the "Main" container. role="main" is the modern accessibility standard.
    main_tag = soup.find("article") or soup.find("main") or soup.find(role="main") or soup.body

    # Heuristic: Article content has high text density and few links.
    # Homepages have many <a> tags relative to text length.
    content_text = ""
    if main_tag:
        # Get text while preserving paragraph breaks
        content_text = main_tag.get_text(separator="\n", strip=True)

        # Calculate Link Density: (Total Link Text Length) / (Total Text Length)
        links = main_tag.find_all("a")
        link_text_len = sum(len(a.get_text(strip=True)) for a in links)
        total_text_len = len(content_text)
        link_density = link_text_len / total_text_len if total_text_len > 0 else 1
    else:
        link_density = 1

    # --- 3. FINAL IS_ARTICLE DECISION ---
    # Thresholds based on file analysis:
    # - Good articles have link density < 20% (mostly body text).
    # - Homepages have link density > 50% (mostly menus/headlines).
    # - Articles should have a substantial word count (> 200 words).
    word_count = len(content_text.split())

    is_article = False
    if is_article_by_meta and link_density < 0.35 and word_count > 200:
        is_article = True
    elif link_density < 0.20 and word_count > 300:  # Strong content even without meta
        is_article = True

    # Title fallback
    og_title = soup.find("meta", property="og:title")
    title = og_title.get("content") if og_title else (soup.title.string if soup.title else "")

    return {
        "title": title.strip() if title else "",
        "content": content_text.strip(),
        "is_article": is_article,
        "publication_date": publication_date.isoformat() if publication_date else None,
        "metrics": {"word_count": word_count, "link_density": round(link_density, 2)}  # For debugging
    }
