"""URL scoring for the article crawler.

Assigns priority scores to URLs based on keyword relevance.
"""


def remove_polish_diacritics(text: str) -> str:
    mapping = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
        'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z'
    }
    return "".join(mapping.get(char, char) for char in text)


def tag_in_url(tag: str, url: str) -> bool:
    tag = remove_polish_diacritics(tag.lower().replace(" ", "-"))
    return tag in url.lower()


def url_score(url: str) -> int:
    score = 0

    keywords = [
        "afera", "korupcja", "skandal", "układ", "mafia", "nepotyzm",
        "polityk", "partia", "dotacje", "prywatyzacja", "fundusz", "wybory",
        "polityczny", "polityczna", "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, url)

    if tag_in_url("polityka prywatności", url):
        score -= 10

    return max(0, score)
