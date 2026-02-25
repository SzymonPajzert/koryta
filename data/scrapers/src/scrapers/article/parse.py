import copy
import json
import re
from datetime import date, datetime
from typing import Any, Dict, Optional

import dateparser
from bs4 import BeautifulSoup


def _parse_polish_date(date_string: str) -> Optional[date]:
    if not date_string:
        return None

    date_string = date_string.strip()

    for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(date_string, fmt).date()
        except ValueError:
            pass

    parsed = dateparser.parse(
        date_string,
        languages=["pl"],
        settings={
            "DATE_ORDER": "DMY",
            "RETURN_AS_TIMEZONE_AWARE": False,
            "PREFER_DAY_OF_MONTH": "first",
        },
    )
    return parsed.date() if parsed else None


def _pick_longest(elements: list[Any]) -> Optional[Any]:
    return max(elements, key=lambda e: len(e.get_text(strip=True))) if elements else None


def _combine_elements(soup: BeautifulSoup, *elements: Optional[Any]) -> Any:
    container = soup.new_tag("div")
    for el in elements:
        if el:
            container.append(copy.copy(el))
    return container


def _find_main_content_element(soup: BeautifulSoup) -> Optional[Any]:
    tight_classes = (
        "article__content", "post__content", "news__content", "entry-content",
        "td-post-content", "shortcode-content", "full-content__main__body",
    )
    tight_candidates = soup.find_all(
        ["div", "section"],
        class_=re.compile(r"^(" + "|".join(map(re.escape, tight_classes)) + r")$", re.I),
    )
    if tight_candidates:
        main_content_element = _pick_longest(tight_candidates)
        subtitle = soup.find("div", class_="article__subtitle")
        if subtitle and "article__content" in (main_content_element.get("class") or []):
            return _combine_elements(soup, subtitle, main_content_element)
        return main_content_element

    article_bodies = soup.find_all("div", class_="articleBody")
    if len(article_bodies) > 1:
        subtitle = soup.find("div", class_="blog--subtitle")
        return _combine_elements(soup, subtitle, *article_bodies)

    article_body_elements = soup.find_all(
        ["article", "main"],
        class_=re.compile(r"article|post|content|story|body", re.I),
    )
    if not article_body_elements:
        article_body_elements = soup.find_all(
            ["div", "section"],
            class_=re.compile(r"article-body|post-body|main-content|entry-content|td-post-content|articleBody", re.I),
        )
    main_content_element = _pick_longest(article_body_elements)
    if main_content_element:
        return main_content_element

    all_articles = soup.find_all("article")
    if len(all_articles) == 1:
        return all_articles[0]

    return None


def _clean_main_content_element(main_content_element: Any) -> str:
    for unwanted in main_content_element.find_all(
            ["script", "style", "img", "iframe", "nav", "aside", "footer", "header"],
            recursive=True,
    ):
        unwanted.extract()

    unwanted_classes = [
        "ads", "ad-unit", "embed", "twit-embed", "twitter-tweet", "sonda", "poll", "quizv2", "tab--open",
        "share-button", "related-post", "comment", "disqus", "post__disqus", "post__listing", "post__footer",
        "recommend", "esi-content", "sd-sharing", "sd-social", "robots-nocontent", "content--excerpt",
        "article--featured", "latest--articles", "article__recommended", "article__img--wrapper",
        "td_block_related", "td-post-header", "wc-memberships", "popup--content", "news__content-more",
        "content-part__share-links", "content-part__tags", "content-part__reaction", "full-content__main__footer",
        "redphone__bottom", "radio-program-widget", "list-summary", "article-foot",
    ]
    unwanted_class_pattern = re.compile(r"^(" + "|".join(map(re.escape, unwanted_classes)) + r")$", re.I)
    for unwanted_class in main_content_element.find_all(class_=unwanted_class_pattern, recursive=True):
        unwanted_class.extract()

    return main_content_element.get_text(separator=" ", strip=True)


def _extract_article_text(soup: BeautifulSoup) -> str:
    main_content_element = _find_main_content_element(soup)
    if main_content_element:
        return _clean_main_content_element(main_content_element)
    return soup.get_text(separator=" ", strip=True)


def _trim_trailing_markers(text: str) -> str:
    markers = [
        "Polecany artykuł:",
        "Dostęp na",
        "Porównaj dostępne pakiety",
        "Wyłącz AdBlock",
    ]
    for marker in markers:
        idx = text.find(marker)
        if idx != -1 and idx > len(text) * 0.6:
            return text[:idx].rstrip()
    return text


def _extract_title_from_meta(soup: BeautifulSoup) -> Optional[str]:
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]
        title = re.sub(
            r"(\s*[:|—–-]\s*|\s*)\s*(Niezalezna\.pl|RadioZET\.pl|PortalPłock\.pl|oko\.press|polityka\.se\.pl|"
            r"zpleszewa\.pl|radomszczanska\.pl|Jawny Lublin|Swidnica24\.pl|Swidnica24\.pl - wydarzenia, informacje, rozrywka, kultura, polityka, wywiady, wypadki)\s*$",
            "",
            title,
            flags=re.I,
        )

        title = re.sub(r"\s{2,}", " ", title)
        return title.strip()
    return None


def _extract_date_from_ldjson(soup: BeautifulSoup) -> Optional[date]:
    script_ld_json = soup.find("script", type="application/ld+json")
    if script_ld_json and script_ld_json.string:
        try:
            json_data = json.loads(script_ld_json.string)
            if isinstance(json_data, list):
                for item in json_data:
                    if item.get("@type") == "NewsArticle":
                        date_str = item.get("datePublished") or item.get("dateCreated") or item.get("dateModified")
                        if date_str:
                            parsed = _parse_polish_date(date_str)
                            if parsed:
                                return parsed
            elif isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle":
                date_str = json_data.get("datePublished") or json_data.get("dateCreated") or json_data.get(
                    "dateModified")
                if date_str:
                    return _parse_polish_date(date_str)
        except json.JSONDecodeError:
            return None
    return None


def _extract_date_from_meta_tags(soup: BeautifulSoup) -> Optional[date]:
    meta_date_tags = soup.find_all(
        "meta",
        attrs={"property": re.compile(r"article:published_time|og:published_time|published_time", re.I)},
    )
    meta_date_tags.extend(soup.find_all("meta", attrs={"name": re.compile(r"date|pubdate|timestamp", re.I)}))

    for tag in meta_date_tags:
        content = tag.get("content")
        if content:
            parsed = _parse_polish_date(content)
            if parsed:
                return parsed
    return None


def _extract_date_from_time_tags(soup: BeautifulSoup) -> Optional[date]:
    for tag in soup.find_all("time"):
        datetime_attr = tag.get("datetime")
        if tag.string and "ago" not in tag.string.lower():
            parsed_from_string = _parse_polish_date(tag.string)
            current_year = date.today().year
            if parsed_from_string and abs(parsed_from_string.year - current_year) < 20:
                return parsed_from_string

        if datetime_attr:
            parsed = _parse_polish_date(datetime_attr)
            if parsed:
                return parsed
    return None


_BINARY_SIGNATURES = (
    b"%PDF", b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"PK\x03\x04",
    b"RIFF", b"\x00\x00\x01\x00", b"\x1f\x8b",
)

_EMPTY_RESULT: Dict[str, Any] = {
    "is_article": False,
    "title": None,
    "publication_date": None,
    "article_content": "",
}


def extract_article_content(html_bytes: bytes) -> Dict[str, Any]:
    header = html_bytes[:16]
    if any(header.startswith(sig) for sig in _BINARY_SIGNATURES):
        return dict(_EMPTY_RESULT)

    soup = BeautifulSoup(html_bytes, "html.parser")

    title = _extract_title_from_meta(soup)

    publication_date = (
            _extract_date_from_ldjson(soup)
            or _extract_date_from_meta_tags(soup)
            or _extract_date_from_time_tags(soup)
    )

    article_content = _extract_article_text(soup)

    # Prepend meta description when it's a short lead not already in content
    meta_desc = soup.find("meta", attrs={"name": "description"})
    og_desc = soup.find("meta", property="og:description")
    desc = None
    if meta_desc and meta_desc.get("content"):
        desc = meta_desc["content"].strip()
    elif og_desc and og_desc.get("content"):
        desc = og_desc["content"].strip()
    if desc and len(desc) > 40 and desc not in article_content and len(article_content) < 2500:
        article_content = f"{desc} {article_content}"

    article_content = article_content.replace("\xa0", " ")
    article_content = re.sub(r"\s*\n\s*", "\n", article_content).strip()
    article_content = re.sub(r" {2,}", " ", article_content).strip()
    article_content = re.sub(r" ([.,:;!?])", r"\1", article_content)
    article_content = _trim_trailing_markers(article_content)
    if article_content and not article_content.endswith("  "):
        article_content = article_content.rstrip() + "  "

    og_type = soup.find("meta", property="og:type")
    has_article_og_type = og_type and og_type.get("content") == "article"
    all_article_tags = soup.find_all("article")
    is_listing_page = len(all_article_tags) > 5

    is_schema_article = False
    script_ld_json = soup.find("script", type="application/ld+json")
    if script_ld_json and script_ld_json.string:
        try:
            json_data = json.loads(script_ld_json.string)
            if (
                    isinstance(json_data, list)
                    and any(item.get("@type") == "NewsArticle" for item in json_data)
            ) or (isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle"):
                is_schema_article = True
        except json.JSONDecodeError:
            pass

    if is_schema_article:
        is_article = True
    elif has_article_og_type:
        is_article = True
    elif is_listing_page:
        is_article = False
    elif len(all_article_tags) > 0:
        is_article = bool(publication_date or len(article_content) > 500)
    elif title and publication_date and len(article_content) > 1500:
        is_article = True
    else:
        is_article = False

    return {
        "is_article": is_article,
        "title": title,
        "publication_date": publication_date,
        "article_content": article_content,
    }
