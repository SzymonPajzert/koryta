"""Which people already in the database this article is about.

The batch pipeline answers this with `ArticlePersonMentions`: it scans the
whole crawled corpus for known names, proves each hit against the person's
parties and employers from the KRS register, and puts an LLM judge behind
that. What survives becomes an article's `koryta_ids`, and
`/api/ingest/extraction` uses them to stamp `personNodeId` on the facts whose
subject matches one of those people by name.

A captured page has none of that around it — no corpus, no register join, no
nightly run. What it does have is the same name index, so this does the name
half and stops there: it scans the article text for people whose name matches
a person node, and hands those ids to the endpoint. The endpoint's own
name-match is what decides which facts get linked, so a candidate who is in
the article but has no fact about them costs nothing.

**A name is not a person.** Two things keep that from silently mislinking:

- A name that resolves to more than one person node is dropped, not guessed.
  The pipeline separates namesakes with register proof this has no access to,
  and picking one at random would file somebody else's job under a real
  person's page. The count is reported so the capture says it happened.
- Matching is nominative-only and diacritics-insensitive, inherited from
  `scrapers.article.names`, so it misses inflected mentions rather than
  inventing them. A miss leaves a fact unlinked, which is what the fast path
  did for every fact before this existed.

That is weaker evidence than `koryta_ids` carries on the batch path, which is
why the capture tag says `attempt_lookup`: a reviewer reading `/ekstrakcje`
can tell which rule linked the fact in front of them.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from scrapers.article.names import PersonNameIndex, name_tuple
from scrapers.article.pipelines.common import normalize_text

logger = logging.getLogger(__name__)

#: How long a built index is reused before the person nodes are read again.
#: People are added to the site continuously but not urgently — an hour-old
#: index misses a page created since the last capture, and the alternative is
#: reading every person node on every capture.
CACHE_TTL_SECONDS = 3600


@dataclass(frozen=True)
class PeopleMatch:
    """The lookup's answer for one article."""

    #: Display names to offer the facts prompt as the detected-people hint.
    #: Includes the ambiguous ones: telling the model that a known person is in
    #: the text is useful even when we cannot say which person page they are.
    names: tuple[str, ...] = ()
    #: Person node ids to send as `koryta_ids` — only the unambiguous ones.
    ids: tuple[str, ...] = ()
    #: Names that matched more than one person node and were therefore not
    #: turned into an id. Recorded on the capture so the gap is visible.
    ambiguous: tuple[str, ...] = ()


class PersonLookup:
    """A name index over the site's person nodes, rebuilt on a timer."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._index: PersonNameIndex | None = None
        self._ids_by_name: dict[str, tuple[str, ...]] = {}
        self._built_at = 0.0

    def _build(self, db) -> None:
        index = PersonNameIndex()
        ids: dict[str, list[str]] = {}
        # `select` still bills a document read each, but a person node carries
        # its whole history of relations and only the name is wanted here.
        for doc in (
            db.collection("nodes")
            .where("type", "==", "person")
            .select(["name"])
            .stream()
        ):
            name = (doc.to_dict() or {}).get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            # Stripped before it reaches the index: `normalize_text` does not
            # trim, so " Jan Kowalski" and "Jan Kowalski" would be filed as two
            # people — which is exactly the namesake case this has to detect,
            # arrived at by whitespace rather than by there being two of them.
            name = " ".join(name.split())
            index.add(name, [name_tuple(name)])
            ids.setdefault(normalize_text(name), []).append(doc.id)
        self._index = index
        self._ids_by_name = {name: tuple(v) for name, v in ids.items()}
        self._built_at = time.monotonic()
        logger.info("person index: %s people, %s name forms", index.people, index.forms)

    def _fresh(self, db) -> PersonNameIndex:
        if self._index is None or time.monotonic() - self._built_at > self._ttl:
            self._build(db)
        assert self._index is not None
        return self._index

    def match(self, db, text: str) -> PeopleMatch:
        """People from the database named in ``text``."""
        if not text.strip():
            return PeopleMatch()
        index = self._fresh(db)

        names: list[str] = []
        ids: list[str] = []
        ambiguous: list[str] = []
        for display in sorted(index.find_in_text(text)):
            names.append(display)
            candidates = self._ids_by_name.get(normalize_text(display), ())
            if len(candidates) == 1:
                ids.append(candidates[0])
            elif len(candidates) > 1:
                ambiguous.append(display)
        return PeopleMatch(tuple(names), tuple(ids), tuple(ambiguous))


#: One index per process. Cloud Run keeps an instance alive across captures, so
#: the cost of building it is paid once an hour rather than once a page.
_lookup = PersonLookup()


def match_people(db, text: str) -> PeopleMatch:
    """People from the database named in ``text``, against the shared index.

    Never raises: a lookup that fails leaves the facts unlinked, which is what
    every capture did before this existed, and is not worth losing them over.
    """
    try:
        return _lookup.match(db, text)
    except Exception:
        logger.exception("person lookup failed; submitting facts unlinked")
        return PeopleMatch()
