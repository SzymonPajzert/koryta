"""Finding known people's names in article text.

Split out of ``analysis.article_person_mentions``, which built this index over
the whole crawled corpus, so the capture extractor can run the same match over
one page. Both need to agree about what counts as a name in Polish prose: a
second regex would drift, and the two would then disagree about which article
mentions whom — the batch run through ``koryta_ids`` and the fast path through
its own lookup, writing facts into the same collection.

Nothing here knows where the people came from. ``analysis`` fills the index
from the ``person_koryta`` dataset and the service fills it from Firestore;
both hand it display names and get display names back.

Matching is nominative-only and diacritics-insensitive ("Jana Kowalskiego" is
not caught), so a result is a lower bound on true mentions — and a name match
on its own is evidence, not proof. `article_person_mentions` puts an LLM judge
and a register-derived proof filter behind it for exactly that reason.
"""

from __future__ import annotations

import re

from scrapers.article.pipelines.common import normalize_text

# A word is capitalized when it starts with an uppercase Polish letter.
_CAP = "A-ZĄĆĘŁŃÓŚŹŻ"
_LOW = "a-ząćęłńóśźż"
_WORD = rf"[{_CAP}][{_LOW}]+(?:['-][{_CAP}{_LOW}]+)*"
# Consecutive capitalized words (2..6) -> a candidate person-name run.
MAX_RUN_WORDS = 6
RUN_RE = re.compile(rf"(?:{_WORD}\s+){{1,{MAX_RUN_WORDS - 1}}}{_WORD}")


def name_tuple(name: str) -> tuple[str, ...]:
    return tuple(normalize_text(t) for t in str(name).split())


class PersonNameIndex:
    """Lookup from normalized name tuples to the people they refer to."""

    def __init__(self) -> None:
        self._by_tuple: dict[tuple[str, ...], dict[str, str]] = {}
        self.max_len = 0
        self.people = 0
        self.forms = 0
        self._seen_people: set[str] = set()

    def add(self, display: str, name_forms: list[tuple[str, ...]]) -> None:
        """Register every spelling variant of one person's name.

        Display names that normalize to the same string (e.g. "Zieliński" and
        "Zielinski") are treated as one person; koryta names are unique, so the
        first spelling seen wins.
        """
        norm_display = normalize_text(display)
        if norm_display not in self._seen_people:
            self._seen_people.add(norm_display)
            self.people += 1
        for form in name_forms:
            if len(form) < 2:
                continue
            self._by_tuple.setdefault(form, {}).setdefault(norm_display, display)
            self.max_len = max(self.max_len, len(form))
            self.forms += 1

    def find_in_text(self, text: str) -> set[str]:
        """Return the display names of people mentioned in ``text``."""
        found: set[str] = set()
        for run in RUN_RE.findall(text):
            words = run.split()
            n_words = len(words)
            max_n = min(n_words, self.max_len)
            for n in range(2, max_n + 1):
                for i in range(n_words - n + 1):
                    key = tuple(normalize_text(w) for w in words[i : i + n])
                    names = self._by_tuple.get(key)
                    if names:
                        found.update(names.values())
        return found
