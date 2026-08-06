"""Attribute interesting article tags to the people mentioned in them.

Chains on the ``ArticlePersonMentions`` output: for every article, split its
tags into atomic terms, keep the ones that name an affair, scandal,
investigative commission or notable event, and attribute those to each person
mentioned in the article. The result is one record per person - their name and
the interesting tags they appear next to, each with a count and a date range.

The "interesting" decision is a curated allowlist plus a few prefix/suffix
patterns: an affair has to be named (``afera wizowa``) rather than described
(``afera`` on its own is generic), so generic category tags such as ``polityka``
or ``prokuratura`` are filtered out.
"""

import json
import re
import unicodedata
from collections import defaultdict
from typing import Any

import pandas as pd
from tqdm import tqdm

from analysis.article_person_mentions import ArticlePersonMentions
from entities.article import AffairTag, PersonAffairTags
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.stores import Context


def _normalize(token: str) -> str:
    """Lowercase a token with diacritics stripped (``Ząbek`` -> ``zabek``)."""
    decomposed = unicodedata.normalize("NFKD", token)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.lower().strip()


# Curated allowlist of interesting tags, one per line. Each line is normalized
# (diacritics stripped, lowercased) before comparison, matching the atoms the
# mentions pipeline splits article tags into.
_CURATED_TAGS = """
afera adam neumann
afera endoprotezowa
afera gliwice
afera gliwicka
afera gruntowa
afera hazardowa
afera hejterska
afera hejterska farma trolli
afera kpo
afera kryminalna
afera kryminalna 2026
afera maseczkowa
afera melioracyjna
afera park dewelopment
afera pedofilska
afera pedofilska w kłodzku
afera plakatowa
afera podsłuchowa
afera polityczna
afera radomsko
afera reprywatyzacyjna
afera respiratorowa
afera rywina
afera śląska sieć metropolitalna
afera ssm
afera ssm gliwice
afera stoczniowa
afera taśmowa
afera taśmowa 2.0
afera ukraina
afera w ekonomiku
afera w gliwicach
afera wiatrakowa
afera wizowa
afera wodociągowa
afera zoofilska
afera łącznikowa
afera 30 milionów gliwice
adam neumann afera
amber gold
pegasus
szwalnia
skandal szwalnia
nepotyzm
fundusz sprawiedliwości
skok wołomin
skok-wołomin
subwencja pis
subwencja partyjna
subwencja wyborcza
komisja śledcza
komisja śledcza ds. pegasusa
komisja ds. pegasusa
nielegalna komisja ds. pegasusa
komisja wizowa
komisja kopertowa
reprywatyzacja
""".splitlines()

_INTERESTING_TAGS = {_normalize(t) for t in _CURATED_TAGS if _normalize(t)}

_PREFIXES = ("afera ",)
_SUFFIXES = (" afera",)


def _is_interesting_tag(normalized: str) -> bool:
    if normalized in _INTERESTING_TAGS:
        return True
    if any(normalized.startswith(p) for p in _PREFIXES):
        return True
    return any(
        normalized.endswith(s) and len(normalized) > len(s) + 2 for s in _SUFFIXES
    )


def _atomize_tags(tags: list[str]) -> list[str]:
    """Split comma/semicolon-separated tag bundles into normalized atoms."""
    atoms: list[str] = []
    for tag in tags:
        for atom in re.split(r"[,;]", tag):
            normalized = _normalize(atom)
            if normalized:
                atoms.append(normalized)
    return atoms


class PeopleAffairTags(IncrementalJsonlPipeline[PersonAffairTags]):
    """Summarize, per person, the affair/event tags of their articles."""

    filename = "people_affair_tags"
    backup_to_shared_cache = False  # small derived summary, local-only

    mentions: ArticlePersonMentions

    @property
    def output_class(self):
        return PersonAffairTags

    def process(self, ctx: Context) -> pd.DataFrame:
        mentions_path = self.mentions.final_output_path
        if not mentions_path.exists():
            raise FileNotFoundError(mentions_path)

        self.prepare_temp_output()

        per_person: dict[str, defaultdict[str, list[Any]]] = defaultdict(
            lambda: defaultdict(list)
        )
        with mentions_path.open(encoding="utf-8") as handle:
            for line in tqdm(handle, desc="Reading person mentions", unit="row"):
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                interesting = [
                    atom
                    for atom in _atomize_tags(row.get("tags") or [])
                    if _is_interesting_tag(atom)
                ]
                if not interesting:
                    continue
                date = row.get("date")
                for person in row.get("people_mentioned") or []:
                    bucket = per_person[person]
                    for tag in interesting:
                        bucket[tag].append(date)

        emitted = 0
        for person, buckets in per_person.items():
            tags: list[AffairTag] = []
            for tag, dates in buckets.items():
                present = [d for d in dates if d]
                tags.append(
                    AffairTag(
                        tag=tag,
                        count=len(dates),
                        first_date=min(present) if present else None,
                        last_date=max(present) if present else None,
                    )
                )
            tags.sort(key=lambda t: (-t.count, t.tag))
            ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
                PersonAffairTags(
                    person=person,
                    tags=tags,
                    total_articles=sum(t.count for t in tags),
                ),
                [],
            )
            emitted += 1

        print(f"Emitted {emitted:,} people with affair tags")
        return pd.DataFrame()
