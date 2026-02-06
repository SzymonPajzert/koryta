import json
import re
from datetime import date, datetime
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup
from dateutil.parser import parse, parserinfo


class PolishParserInfo(parserinfo):
    """Custom parserinfo for Polish month and weekday names."""
    MONTHS = [
        ('stycznia', 'sty'), ('lutego', 'lut'), ('marca', 'mar'),
        ('kwietnia', 'kwi'), ('maja', 'maj'), ('czerwca', 'cze'),
        ('lipca', 'lip'), ('sierpnia', 'sie'), ('września', 'wrz'),
        ('października', 'paź'), ('listopada', 'lis'), ('grudnia', 'gru')
    ]
    WEEKDAYS = [
        ('poniedziałek', 'pon'), ('wtorek', 'wto'), ('środa', 'śro'),
        ('czwartek', 'czw'), ('piątek', 'pią'), ('sobota', 'sob'),
        ('niedziela', 'nie')
    ]


_polish_parser_info = PolishParserInfo()


def _parse_polish_date(date_string: str) -> Optional[date]:
    """
    Parses a Polish date string into a date object.
    Tries several specific formats (prioritizing DD.MM.YYYY) and falls back to dateutil.parser.
    """
    polish_month_map = {
        'stycznia': 'January', 'lutego': 'February', 'marca': 'March',
        'kwietnia': 'April', 'maja': 'May', 'czerwca': 'June',
        'lipca': 'July', 'sierpnia': 'August', 'września': 'September',
        'października': 'October', 'listopada': 'November', 'grudnia': 'Dec',  # Corrected from Gru to Dec
        'sty': 'Jan', 'lut': 'Feb', 'mar': 'Mar', 'kwi': 'Apr',
        'maj': 'May', 'cze': 'Jun', 'lip': 'Jul', 'sie': 'Aug',
        'wrz': 'Sep', 'paź': 'Oct', 'lis': 'Nov', 'gru': 'Dec',
    }

    # Pre-normalize the string with English month names for more robust parsing by strptime
    pre_normalized_date_string = date_string
    for pl_month, en_month in polish_month_map.items():
        # Use regex to replace full words only, to avoid replacing parts of other words
        pre_normalized_date_string = re.sub(r'\b' + re.escape(pl_month) + r'\b', en_month, pre_normalized_date_string,
                                            flags=re.IGNORECASE)

    date_formats_to_try = [
        # Explicit Day-Month-Year numerical formats - highest priority to avoid ambiguity
        "%d.%m.%Y, %H:%M",  # 05.02.2026, 15:26
        "%d.%m.%Y %H:%M",  # 05.02.2026 17:31
        "%d/%m/%Y %H:%M",  # 06/03/2024 20:00
        "%d.%m.%Y",  # 05.02.2026
        "%d/%m/%Y",  # 06/03/2024

        # Explicit Day-Month Name-Year formats
        "%A, %d %b %Y %H:%M",  # niedziela, 1 Jun 2025 21:08 (after normalization)
        "%d %B %Y %H:%M",  # 28 January 2026 12:00
        "%d %b %Y %H:%M",  # 3 Nov 2025 08:00
        "%d %B %Y",  # 28 January 2026
        "%d %b %Y",  # 3 Nov 2025

        # YYYY-MM-DD formats
        "%Y-%m-%dT%H:%M:%S%z",  # 2026-02-05T17:31:54+0100 (JSON-LD)
        "%Y-%m-%d %H:%M",  # 2026-02-05 07:32
        "%Y-%m-%d",  # generic YYYY-MM-DD

        # Fallback to Month-Day-Year numerical (less common in Poland, but good for robustness)
        "%m.%d.%Y %H:%M",
        "%m/%d/%Y %H:%M",
        "%m.%d.%Y",
        "%m/%d/%Y",
    ]

    for fmt in date_formats_to_try:
        try:
            return datetime.strptime(pre_normalized_date_string, fmt).date()  # Use pre-normalized string here
        except ValueError:
            pass

    # Final fallback to dateutil.parser with custom Polish parserinfo on ORIGINAL string
    try:
        return parse(date_string, parserinfo=_polish_parser_info, yearfirst=False).date()
    except (ValueError, TypeError):
        pass

    return None


def extract_article_content(html_bytes: bytes) -> Dict[str, Any]:
    soup = BeautifulSoup(html_bytes, 'html.parser')
    text_content = soup.get_text(separator=' ', strip=True)

    # Initialize all return values
    is_article = False
    title = ""
    publication_date = None
    article_content = ""

    # --- Extract Title ---
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]
    else:
        twitter_title = soup.find("meta", attrs={"name": "twitter:title"})
        if twitter_title and twitter_title.get("content"):
            title = twitter_title["content"]
        elif soup.title and soup.title.string:
            title = soup.title.string

            # --- Clean up title ---
    if title:
        # Normalize various quotation marks and guillemets to straight double/single quotes
        title = title.replace('”', '"').replace('„', '"').replace('“', '"').replace('″', '"')
        title = title.replace("’", "'").replace("‘", "'").replace('«', '"').replace('»', '"')
        title = title.replace('›', "'").replace('‹', "'")
        title = title.replace("''", '"') # Handle double single quotes becoming a double quote

        # Remove specific site names only if they appear at the end, and only if preceded by a common separator.
        title = re.sub(r'(\s*[:|—–-]\s*|\s*)\s*(Niezalezna\.pl|RadioZET\.pl|PortalPłock\.pl|oko\.press|polityka\.se\.pl|zpleszewa\.pl|radomszczanska\.pl|Jawny Lublin|Swidnica24\.pl|Swidnica24\.pl - wydarzenia, informacje, rozrywka, kultura, polityka, wywiady, wypadki)\s*$', '', title, flags=re.I)
        
        # Collapse multiple spaces, but don't strip at the end
        title = re.sub(r'\s{2,}', ' ', title) 
        
        # Strip leading/trailing whitespace after all operations
        title = title.strip()

    # --- Extract Publication Date ---
    # 1. Try to find date in Schema.org JSON-LD
    script_ld_json = soup.find("script", type="application/ld+json")
    if script_ld_json and script_ld_json.string:
        try:
            json_data = json.loads(script_ld_json.string)
            # Handle list of JSON-LD objects
            if isinstance(json_data, list):
                for item in json_data:
                    if item.get("@type") == "NewsArticle":
                        date_str = item.get("datePublished") or item.get("dateCreated") or item.get("dateModified")
                        if date_str:
                            publication_date = _parse_polish_date(date_str)
                            if publication_date:
                                break
            # Handle single JSON-LD object
            elif isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle":
                date_str = json_data.get("datePublished") or json_data.get("dateCreated") or json_data.get(
                    "dateModified")
                if date_str:
                    publication_date = _parse_polish_date(date_str)

        except json.JSONDecodeError:
            pass

    # 2. Try to find date in meta tags if not found in JSON-LD
    if not publication_date:
        meta_date_tags = soup.find_all("meta", attrs={
            "property": re.compile(r"article:published_time|og:published_time|published_time", re.I)})
        meta_date_tags.extend(soup.find_all("meta", attrs={"name": re.compile(r"date|pubdate|timestamp", re.I)}))

        for tag in meta_date_tags:
            content = tag.get("content")
            if content:
                publication_date = _parse_polish_date(content)
                if publication_date:
                    break

    # 3. Try to find date in <time> tags if not found earlier
    if not publication_date:
        for tag in soup.find_all("time"):
            datetime_attr = tag.get("datetime")
            # Prefer text content over datetime attribute if datetime attribute is suspect
            # But ensure the text is not just a relative time (e.g., "2 hours ago")
            if tag.string and "ago" not in tag.string.lower():  # Simple heuristic to avoid relative times
                parsed_from_string = _parse_polish_date(tag.string)
                # Heuristic: if parsed year is significantly different from current year (2026), prefer string
                current_year = date.today().year
                if parsed_from_string and (
                        abs(parsed_from_string.year - current_year) < 20):  # Acceptable range for dates
                    publication_date = parsed_from_string
                    break

            if not publication_date and datetime_attr:  # Fallback to datetime_attr if string parsing failed or was suspect
                publication_date = _parse_polish_date(datetime_attr)
                if publication_date:
                    break

    # --- Extract Article Content ---
    main_content_element = None

    # Tier 1: Very specific body content selectors (tightest containers)
    # Use anchored regex to match exact class values, not substrings
    tight_class_pattern = re.compile(
        r'^(article__content|post__content|news__content|entry-content|td-post-content)$',
        re.I
    )
    tight_candidates = soup.find_all(['div', 'section'], class_=tight_class_pattern)
    if tight_candidates:
        main_content_element = max(tight_candidates, key=lambda e: len(e.get_text(strip=True)))
        # For OS Media sites: include article__subtitle lead paragraph if present
        subtitle = soup.find('div', class_='article__subtitle')
        if subtitle and main_content_element.get('class') and 'article__content' in main_content_element.get('class', []):
            import copy
            container = soup.new_tag('div')
            container.append(copy.copy(subtitle))
            container.append(copy.copy(main_content_element))
            main_content_element = container

    # Tier 2: Multiple articleBody divs (rp.pl pattern - combine them)
    if not main_content_element:
        article_bodies = soup.find_all('div', class_='articleBody')
        if len(article_bodies) > 1:
            import copy
            container = soup.new_tag('div')
            # Include lead/subtitle paragraph if present
            subtitle = soup.find('div', class_='blog--subtitle')
            if subtitle:
                container.append(copy.copy(subtitle))
            for body in article_bodies:
                container.append(copy.copy(body))
            main_content_element = container

    # Tier 3: Broader selectors (original logic)
    if not main_content_element:
        article_body_elements = soup.find_all(['article', 'main'],
                                              class_=re.compile(r'article|post|content|story|body', re.I))

        if not article_body_elements:
            article_body_elements = soup.find_all(['div', 'section'], class_=re.compile(
                r'article-body|post-body|main-content|entry-content|td-post-content|articleBody', re.I))

        if article_body_elements:
            main_content_element = max(article_body_elements, key=lambda e: len(e.get_text(strip=True)))

    # Tier 5: Single <article> tag on the page (no class requirement)
    if not main_content_element:
        all_articles = soup.find_all('article')
        if len(all_articles) == 1:
            main_content_element = all_articles[0]

    if main_content_element:
        # Remove unwanted elements by tag
        for unwanted in main_content_element.find_all(
                ['script', 'style', 'img', 'iframe', 'nav', 'aside', 'footer', 'header'], recursive=True):
            unwanted.extract()

        # Remove unwanted elements by class - use anchored patterns to avoid matching
        # Tailwind utility classes like [&_div.twitter-tweet]:mx-auto
        # First group: exact class value matches only
        # Second group: prefix matches (class starts with pattern)
        unwanted_class_pattern = re.compile(
            r'^(ads|ad-unit|embed|twit-embed|twitter-tweet|sonda|poll|quizv2|tab--open)$|'
            r'^(share-button|related-post|comment|disqus|'
            r'post__disqus|post__listing|post__footer|'
            r'recommend|esi-content|'
            r'sd-sharing|sd-social|robots-nocontent|'
            r'content--excerpt|article--featured|latest--articles|'
            r'article__recommended|article__img--wrapper|'
            r'td_block_related|td-post-header|'
            r'wc-memberships|popup--content|'
            r'news__content-more)',
            re.I
        )
        for unwanted_class in main_content_element.find_all(
                class_=unwanted_class_pattern, recursive=True):
            unwanted_class.extract()

        article_content = main_content_element.get_text(separator=' ', strip=True)
    else:
        article_content = soup.get_text(separator=' ', strip=True)

    # Normalize whitespace and non-breaking spaces
    article_content = article_content.replace('\xa0', ' ')
    article_content = re.sub(r'\s*\n\s*', '\n', article_content).strip()
    article_content = re.sub(r' {2,}', ' ', article_content).strip()
    # Fix spaces before punctuation caused by get_text(separator=' ') on inline elements
    article_content = re.sub(r' ([.,:;!?])', r'\1', article_content)

    # --- Determine if it's an article ---
    og_type = soup.find("meta", property="og:type")
    has_article_og_type = og_type and og_type.get("content") == "article"
    all_article_tags = soup.find_all('article')
    has_article_tag = len(all_article_tags) > 0
    # Many article tags typically means a listing/homepage, not a single article
    is_listing_page = len(all_article_tags) > 5

    # Stricter heuristic for is_article
    is_schema_article = False
    script_ld_json = soup.find("script", type="application/ld+json")
    if script_ld_json and script_ld_json.string:
        try:
            json_data = json.loads(script_ld_json.string)
            if (isinstance(json_data, list) and any(item.get("@type") == "NewsArticle" for item in json_data)) or \
                    (isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle"):
                is_schema_article = True
        except json.JSONDecodeError:
            pass

    # Evaluate positive conditions (strong signals override listing page heuristic)
    if is_schema_article:
        is_article = True
    elif has_article_og_type:
        is_article = True
    elif is_listing_page:
        is_article = False
    elif has_article_tag and publication_date: # Simplified condition: if article tag and date, it's an article
        is_article = True
    elif has_article_tag and len(article_content) > 500: # If article tag and decent content, it's an article
        is_article = True
    elif title and publication_date and len(article_content) > 1500:  # Original stricter condition
        is_article = True

    # Final override for negative heuristics
    # The title for paulinamatysiak.pl is "Strona Główna | PAULINA MATYSIAK - Posłanka na Sejm RP"
    if "paulinamatysiak.pl" in str(html_bytes) and title:
        if "Strona Główna" in title or "Kontakt" in title or "O mnie" in title:
            is_article = False

    return {
        "is_article": is_article,
        "title": title,
        "publication_date": publication_date,
        "article_content": article_content,
    }
