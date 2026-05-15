import copy
import json
import re
from datetime import date
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup, Tag

from util.polish import parse_polish_date

_UTF8_CHARSET_RE = re.compile(rb'charset=["\']?utf-8["\']?', re.I)


_NORM_REPLACEMENTS = [
    ("\xa0", " "),
    ("\u2026", "..."),
    ("\u201e", chr(34)),
    ("\u201c", chr(34)),
    ("\u201d", chr(34)),
    ("\u2019", chr(39)),
]


def _desc_in_content(desc: str, content: str) -> bool:
    def _norm(t: str) -> str:
        for old, new in _NORM_REPLACEMENTS:
            t = t.replace(old, new)
        return " ".join(t.split())
    return _norm(desc) in _norm(content)

def _make_soup(html_bytes: bytes) -> BeautifulSoup:
    if _UTF8_CHARSET_RE.search(html_bytes[:2048]):
        return BeautifulSoup(
            html_bytes.decode("utf-8", errors="replace"), "html.parser"
        )
    return BeautifulSoup(html_bytes, "html.parser")


def _is_homepage(soup: BeautifulSoup) -> bool:
    for tag_name, attrs, key in [
        ("meta", {"property": "og:url"}, "content"),
        ("link", {"rel": "canonical"}, "href"),
    ]:
        tag = soup.find(tag_name, attrs)  # type: ignore[arg-type]
        if isinstance(tag, Tag):
            href = tag.get(key)
            if isinstance(href, str):
                parts = href.split("//", 1)[-1].split("/", 1)
                if len(parts) < 2 or not parts[1].strip("/"):
                    return True
    return False


def extract_article_content(html_bytes: bytes) -> Dict[str, Any]:  # noqa: PLR0912, PLR0915
    header = html_bytes[:16]
    if any(header.startswith(sig) for sig in BINARY_SIGNATURES):
        return dict(_EMPTY_RESULT)

    soup = _make_soup(html_bytes)

    title = extract_title_from_meta(soup) or extract_title_from_html_title(soup)

    publication_date = (
        extract_date_from_ldjson(soup)
        or extract_date_from_meta_tags(soup)
        or extract_date_from_time_tags(soup)
        or extract_date_from_text_elements(soup)
    )

    article_content = extract_article_text(soup)

    desc = extract_description_from_ldjson(soup)
    if not desc:
        meta_desc = soup.find("meta", attrs={"name": "description"})
        og_desc = soup.find("meta", property="og:description")
        if isinstance(meta_desc, Tag) and meta_desc.get("content"):
            c = meta_desc["content"]
            desc = c.strip() if isinstance(c, str) else None
        elif isinstance(og_desc, Tag) and og_desc.get("content"):
            c = og_desc["content"]
            desc = c.strip() if isinstance(c, str) else None

    if desc and "<" in desc:
        desc = BeautifulSoup(desc, "html.parser").get_text(separator=" ", strip=True)
        desc = re.sub(r" +", " ", desc).strip()

    if (
        desc
        and len(desc) > 40
        and not _desc_in_content(desc, article_content)
        and len(article_content) < 20000
    ):
        article_content = f"{desc} {article_content}"

    article_content = article_content.replace("\xa0", " ").replace("&nbsp;", " ")
    article_content = re.sub(r"\s*\n\s*", "\n", article_content).strip()
    article_content = re.sub(r" {2,}", " ", article_content).strip()
    article_content = re.sub(r" ([.,:;!?])", r"\1", article_content)
    article_content = trim_trailing_markers(article_content)
    if article_content and not article_content.endswith("  "):
        article_content = article_content.rstrip() + "  "

    og_type = soup.find("meta", property="og:type")
    has_article_og_type = (
        isinstance(og_type, Tag) and og_type.get("content") == "article"
    )
    all_article_tags = soup.find_all("article")
    is_listing_page = len(all_article_tags) > 5

    is_schema_article = False
    script_ld_json = soup.find("script", type="application/ld+json")
    if (
        isinstance(script_ld_json, Tag)
        and script_ld_json.string
        and isinstance(script_ld_json.string, str)
    ):
        try:
            json_data = json.loads(script_ld_json.string)
            if (
                isinstance(json_data, list)
                and any(item.get("@type") == "NewsArticle" for item in json_data)
            ) or (
                isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle"
            ):
                is_schema_article = True
        except json.JSONDecodeError:
            pass

    is_home = _is_homepage(soup)
    og_type_val = og_type.get("content") if isinstance(og_type, Tag) else None

    if is_schema_article and not is_home:
        is_article = True
    elif has_article_og_type and not is_home:
        is_article = True
    elif is_listing_page or len(all_article_tags) > 3:
        is_article = False
    elif len(all_article_tags) > 0:
        if og_type_val == "website":
            is_article = False
        else:
            is_article = bool(publication_date or len(article_content) > 1500)
    elif title and publication_date and len(article_content) > 1000 and not is_home:
        is_article = True
    else:
        is_article = False

    return {
        "is_article": is_article,
        "title": title,
        "publication_date": publication_date,
        "article_content": article_content,
    }


def pick_longest(elements: list[Any]) -> Optional[Any]:
    return (
        max(elements, key=lambda e: len(e.get_text(strip=True))) if elements else None
    )


def combine_elements(soup: BeautifulSoup, *elements: Optional[Any]) -> Any:
    container = soup.new_tag("div")
    for el in elements:
        if el:
            container.append(copy.copy(el))
    return container


def find_main_content_element(soup: BeautifulSoup) -> Optional[Any]:
    tight_classes = (
        "article__content",
        "post__content",
        "news__content",
        "entry-content",
        "td-post-content",
        "shortcode-content",
        "full-content__main__body",
        "trescnews",
    )
    tight_candidates = soup.find_all(
        ["div", "section"],
        class_=re.compile(
            r"^(" + "|".join(map(re.escape, tight_classes)) + r")$", re.I
        ),
    )
    if tight_candidates:
        main_content_element = pick_longest(tight_candidates)
        subtitle = soup.find("div", class_="article__subtitle")
        if (
            isinstance(subtitle, Tag)
            and isinstance(main_content_element, Tag)
            and "article__content" in (main_content_element.get("class") or [])
        ):
            return combine_elements(soup, subtitle, main_content_element)
        return main_content_element

    article_bodies = soup.find_all("div", class_="articleBody")
    if len(article_bodies) > 1:
        subtitle = soup.find("div", class_="blog--subtitle")
        return combine_elements(soup, subtitle, *article_bodies)

    article_body_elements = soup.find_all(
        ["article", "main"],
        class_=re.compile(r"article|post|content|story|body", re.I),
    )
    if not article_body_elements:
        article_body_elements = soup.find_all(
            ["div", "section"],
            class_=re.compile(
                r"article-body|post-body|main-content|entry-content|td-post-content|articleBody",
                re.I,
            ),
        )
    main_content_element = pick_longest(article_body_elements)
    if main_content_element:
        return main_content_element

    all_articles = soup.find_all("article")
    if len(all_articles) == 1:
        return all_articles[0]

    return None


def clean_main_content_element(main_content_element: Any) -> str:
    for unwanted in main_content_element.find_all(
        ["script", "style", "img", "iframe", "nav", "aside", "footer", "header"],
        recursive=True,
    ):
        unwanted.extract()

    unwanted_classes = [
        "ads",
        "ad-unit",
        "embed",
        "twit-embed",
        "twitter-tweet",
        "sonda",
        "poll",
        "quizv2",
        "tab--open",
        "share-button",
        "related-post",
        "comment",
        "disqus",
        "post__disqus",
        "post__listing",
        "post__footer",
        "recommend",
        "esi-content",
        "sd-sharing",
        "sd-social",
        "robots-nocontent",
        "content--excerpt",
        "article--featured",
        "latest--articles",
        "article__recommended",
        "article__img--wrapper",
        "td_block_related",
        "td-post-header",
        "wc-memberships",
        "popup--content",
        "news__content-more",
        "content-part__share-links",
        "content-part__tags",
        "content-part__reaction",
        "full-content__main__footer",
        "redphone__bottom",
        "radio-program-widget",
        "list-summary",
        "article-foot",
        "link-gallery-container",
        "thank-u-note",
        "print-page-link",
    ]
    unwanted_class_pattern = re.compile(
        r"^(" + "|".join(map(re.escape, unwanted_classes)) + r")$", re.I
    )
    for unwanted_class in main_content_element.find_all(
        class_=unwanted_class_pattern, recursive=True
    ):
        unwanted_class.extract()

    # Remove video player widget wrappers (detected by data-scope on the figure)
    for figure in main_content_element.find_all(
        "figure", attrs={"data-scope": re.compile("multimedium", re.I)}
    ):
        parent = figure.parent
        if parent and parent.name == "div" and parent != main_content_element:
            parent.extract()
        else:
            figure.extract()

    # Remove UI control bars (listen/share buttons) via partial class match
    for el in main_content_element.find_all(
        class_=re.compile(r"action-buttons", re.I)
    ):
        el.extract()

    return main_content_element.get_text(separator=" ", strip=True)


def extract_article_text(soup: BeautifulSoup) -> str:
    main_content_element = find_main_content_element(soup)
    if main_content_element:
        text = clean_main_content_element(main_content_element)
        if len(text) > 100:
            return text

    selectors = [
        "article",
        "main",
        "div#article-content",
        "div.layout_2",
        "div#content",
        "div.content",
        "div#main",
        "div.main",
    ]
    for selector in selectors:
        elements = soup.select(selector)
        element = pick_longest(elements) if elements else None
        if element:
            text = clean_main_content_element(element)
            if len(text) > 200:
                return text

    return soup.get_text(separator=" ", strip=True)


def trim_trailing_markers(text: str) -> str:
    for marker in ("Dziękujemy, że przeczytałaś/eś nasz artykuł do końca",):
        idx = text.find(marker)
        if idx != -1:
            return text[:idx].rstrip()

    markers = [
        "Polecany artykuł:",
        "Dostęp na",
        "Porównaj dostępne pakiety",
        "Wyłącz AdBlock",
        "Autopromocja",
        "Galeria zdjęć",
        "Oceń artykuł",
        "przejdź do galerii",
        "Dodaj komentarz",
        "Płatny dostęp do treści",
        "Bądź na bieżąco",
        "REKLAMA",
        "© Materiał chroniony prawem autorskim",
        "Źródło: tvn24.pl",
    ]
    for marker in markers:
        idx = text.find(marker)
        if idx != -1 and idx > len(text) * 0.6:
            return text[:idx].rstrip()
    return text


def extract_title_from_meta(soup: BeautifulSoup) -> Optional[str]:
    og_title = soup.find("meta", property="og:title")
    if isinstance(og_title, Tag) and og_title.get("content"):
        content = og_title["content"]
        if isinstance(content, list):
            content = " ".join(content)
        title = content.replace("\xa0", " ")
        title = re.sub(
            r"(\s*[:|—–-]\s*|\s*)\s*(Niezalezna\.pl|RadioZET\.pl|PortalPłock\.pl|"
            r"oko\.press|polityka\.se\.pl|zpleszewa\.pl|radomszczanska\.pl|"
            r"Jawny Lublin|Swidnica24\.pl|Swidnica24\.pl - wydarzenia, informacje, "
            r"rozrywka, kultura, polityka, wywiady, wypadki|"
            r"Radom24\.pl|Forsal\.pl)\s*$",
            "",
            title,
            flags=re.I,
        )
        title = re.sub(r"\s{2,}", " ", title)
        return title.strip() or None
    return None


def extract_title_from_html_title(soup: BeautifulSoup) -> Optional[str]:
    title_tag = soup.find("title")
    if not isinstance(title_tag, Tag):
        return None
    title = title_tag.get_text().replace("\xa0", " ").strip()
    title = re.sub(
        r"\s*[-|–—]\s*(?:wiadomości\s+\S+|[A-Za-z0-9][A-Za-z0-9\-\s]*"
        r"\.(?:pl|tv|com\.pl|eu|info|net|press|org))\s*$",
        "",
        title,
        flags=re.I,
    )
    title = re.sub(r"^[A-Za-z0-9][A-Za-z0-9\-\.]*\.[a-z]{2,}\s*[|]\s*", "", title)
    title = re.sub(r"\s{2,}", " ", title).strip()
    return title if len(title) > 10 else None


def extract_date_from_ldjson(soup: BeautifulSoup) -> Optional[date]:
    script_ld_json = soup.find("script", type="application/ld+json")
    if (
        isinstance(script_ld_json, Tag)
        and script_ld_json.string
        and isinstance(script_ld_json.string, str)
    ):
        try:
            json_data = json.loads(script_ld_json.string)
            if isinstance(json_data, list):
                for item in json_data:
                    if item.get("@type") == "NewsArticle":
                        date_str = (
                            item.get("datePublished")
                            or item.get("dateCreated")
                            or item.get("dateModified")
                        )
                        if date_str:
                            parsed = parse_polish_date(date_str)
                            if parsed:
                                return parsed
            elif (
                isinstance(json_data, dict) and json_data.get("@type") == "NewsArticle"
            ):
                date_str = (
                    json_data.get("datePublished")
                    or json_data.get("dateCreated")
                    or json_data.get("dateModified")
                )
                if date_str:
                    return parse_polish_date(date_str)
        except json.JSONDecodeError:
            return None
    return None


def extract_date_from_meta_tags(soup: BeautifulSoup) -> Optional[date]:
    meta_date_tags = soup.find_all(
        "meta",
        attrs={
            "property": re.compile(
                r"article:published_time|og:published_time|published_time", re.I
            )
        },
    )
    meta_date_tags.extend(
        soup.find_all(
            "meta", attrs={"name": re.compile(r"date|pubdate|timestamp", re.I)}
        )
    )

    for tag in meta_date_tags:
        if not isinstance(tag, Tag):
            continue
        content = tag.get("content")
        if isinstance(content, str):
            parsed = parse_polish_date(content)
            if parsed:
                return parsed
    return None


def extract_date_from_time_tags(soup: BeautifulSoup) -> Optional[date]:
    for tag in soup.find_all("time"):
        if not isinstance(tag, Tag):
            continue
        datetime_attr = tag.get("datetime")
        if (
            tag.string
            and isinstance(tag.string, str)
            and "ago" not in tag.string.lower()
        ):
            parsed_from_string = parse_polish_date(tag.string)
            current_year = date.today().year
            if parsed_from_string and abs(parsed_from_string.year - current_year) < 20:
                return parsed_from_string

        if isinstance(datetime_attr, str):
            parsed = parse_polish_date(datetime_attr)
            if parsed:
                return parsed
    return None


_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?")
_PUB_PREFIX_RE = re.compile(
    r"(Dodane?|Opublikowano|Data|Dodał|Dodała|Czas|Publikacja)\s*:?\s*", re.I
)
_DATE_CLASS_RE = re.compile(r"\b(?:date|data|pub)\b|czas|metainfo", re.I)


def extract_date_from_text_elements(soup: BeautifulSoup) -> Optional[date]:
    current_year = date.today().year
    for tag in soup.find_all(True):
        text = tag.get_text(strip=True)
        if len(text) > 150 or len(text) < 5:
            continue
        if _PUB_PREFIX_RE.search(text):
            m = _ISO_DATE_RE.search(text)
            if m:
                parsed = parse_polish_date(m.group(0))
                if parsed and abs(parsed.year - current_year) < 5:
                    return parsed
    for tag in soup.find_all(True, class_=_DATE_CLASS_RE):
        text = tag.get_text(strip=True)
        if len(text) > 100 or len(text) < 5:
            continue
        m = _ISO_DATE_RE.search(text)
        if m:
            parsed = parse_polish_date(m.group(0))
            if parsed and abs(parsed.year - current_year) < 5:
                return parsed
    return None


BINARY_SIGNATURES = (
    b"%PDF",
    b"\x89PNG",
    b"\xff\xd8\xff",
    b"GIF8",
    b"PK\x03\x04",
    b"RIFF",
    b"\x00\x00\x01\x00",
    b"\x1f\x8b",
)

_EMPTY_RESULT: Dict[str, Any] = {
    "is_article": False,
    "title": None,
    "publication_date": None,
    "article_content": "",
}


def extract_description_from_ldjson(soup: BeautifulSoup) -> Optional[str]:
    script_ld_json = soup.find("script", type="application/ld+json")
    if (
        isinstance(script_ld_json, Tag)
        and script_ld_json.string
        and isinstance(script_ld_json.string, str)
    ):
        try:
            json_data = json.loads(script_ld_json.string)
            items = json_data if isinstance(json_data, list) else [json_data]
            for item in items:
                if isinstance(item, dict) and item.get("@type") == "NewsArticle":
                    desc = item.get("description")
                    if isinstance(desc, str) and len(desc) > 40:
                        return desc.strip()
        except json.JSONDecodeError:
            pass
    return None
