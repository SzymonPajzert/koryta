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
somebody on the site, and hands those ids to the endpoint. The endpoint's own
name-match is what decides which facts get linked, so a candidate who is in
the article but has no fact about them costs nothing.

The people come from `KorytaPeople`'s output — the `person_koryta_<date>.jsonl`
the pipeline already publishes to the shared cache, ~9,300 rows and 360 kB
compressed — rather than from Firestore. Reading the person nodes directly
would be ~9,300 document reads every time an instance refreshed its index, for
a set that changes when somebody adds a person page and not otherwise. One
object read of a dump that is a day old at worst is the same answer, and
`KorytaPeople` itself is built from the nightly export, so it is the same
snapshot the batch path matched against.

**A name is not a person.** Two things keep that from silently mislinking:

- A name that resolves to more than one person is dropped, not guessed. 16 of
  the 9,261 names in the 2026-09-01 dump are shared by two people. The
  pipeline separates namesakes with register proof this has no access to, and
  picking one at random would file somebody else's job under a real person's
  page. The count is reported so the capture says it happened.
- Matching is nominative-only and diacritics-insensitive, inherited from
  `scrapers.article.names`, so it misses inflected mentions rather than
  inventing them. A miss leaves a fact unlinked, which is what the fast path
  did for every fact before this existed.

That is weaker evidence than `koryta_ids` carries on the batch path, which is
why the capture tag says `attempt_lookup`: a reviewer reading `/ekstrakcje`
can tell which rule linked the fact in front of them.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from scrapers.article.names import PersonNameIndex, name_tuple
from scrapers.article.pipelines.common import normalize_text
from service.config import Config
from service.storage import read_backup_payload, read_latest_backup

logger = logging.getLogger(__name__)

#: Every `KorytaPeople` run lands under `filename=person_koryta_<date>/`, so
#: this prefix covers all of them and the newest blob name wins.
BACKUP_PREFIX = "filename=person_koryta_"


@dataclass(frozen=True)
class PeopleMatch:
    """The lookup's answer for one article."""

    #: Display names to offer the facts prompt as the detected-people hint.
    #: Includes the ambiguous ones: telling the model that a known person is in
    #: the text is useful even when we cannot say which person page they are.
    names: tuple[str, ...] = ()
    #: Person node ids to send as `koryta_ids` — only the unambiguous ones.
    ids: tuple[str, ...] = ()
    #: Names that matched more than one person and were therefore not turned
    #: into an id. Recorded on the capture so the gap is visible.
    ambiguous: tuple[str, ...] = ()


def _read_index_file(cfg: Config) -> tuple[str, bytes]:
    """The people dump to build the index from, and where it came from.

    A local path wins when one is configured: it is how the development loop
    runs without the bucket, and it is also the way to pin the index into the
    container image if the daily-ish dump is ever too loose.
    """
    if cfg.people_index_path:
        path = Path(cfg.people_index_path)
        raw = path.read_bytes()
        if path.suffix in {".gz", ".tgz"}:
            return str(path), read_backup_payload(raw)
        return str(path), raw
    return read_latest_backup(cfg.shared_cache_bucket, BACKUP_PREFIX)


class PersonLookup:
    """A name index over the site's people, rebuilt on a timer."""

    def __init__(self) -> None:
        self._index: PersonNameIndex | None = None
        self._ids_by_name: dict[str, tuple[str, ...]] = {}
        self._built_at = 0.0

    def _build(self, cfg: Config) -> None:
        source, payload = _read_index_file(cfg)
        index = PersonNameIndex()
        ids: dict[str, list[str]] = {}
        for line in payload.decode("utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            person_id = row.get("id")
            name = row.get("full_name")
            if not isinstance(person_id, str) or not isinstance(name, str):
                continue
            # Collapsed before it reaches the index: `normalize_text` does not
            # trim, so " Jan Kowalski" and "Jan Kowalski" would be filed as two
            # people — which is the namesake case this has to detect, arrived
            # at by whitespace rather than by there being two of them.
            name = " ".join(name.split())
            if not name:
                continue
            index.add(name, [name_tuple(name)])
            ids.setdefault(normalize_text(name), []).append(person_id)
        self._index = index
        self._ids_by_name = {name: tuple(v) for name, v in ids.items()}
        self._built_at = time.monotonic()
        logger.info(
            "person index: %s people, %s name forms, from %s",
            index.people,
            index.forms,
            source,
        )

    def _fresh(self, cfg: Config) -> PersonNameIndex:
        stale = time.monotonic() - self._built_at > cfg.people_index_ttl_seconds
        if self._index is None or stale:
            self._build(cfg)
        assert self._index is not None
        return self._index

    def match(self, cfg: Config, text: str) -> PeopleMatch:
        """People from the dump named in ``text``."""
        if not text.strip():
            return PeopleMatch()
        index = self._fresh(cfg)

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
#: the dump is fetched once a day at most rather than once a page.
_lookup = PersonLookup()


def match_people(cfg: Config, text: str) -> PeopleMatch:
    """People from the dump named in ``text``, against the shared index.

    Never raises: a lookup that fails leaves the facts unlinked, which is what
    every capture did before this existed, and is not worth losing them over.
    """
    try:
        return _lookup.match(cfg, text)
    except Exception:
        logger.exception("person lookup failed; submitting facts unlinked")
        return PeopleMatch()
