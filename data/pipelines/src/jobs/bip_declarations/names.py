"""How common a person's surname is: what the site's namesake estimate goes by
(`frontend/shared/declarationPeople.ts`). The share of a settled reading that
turned out a namesake climbs with how many Poles carry the surname, from none
under 50 bearers to nearly half at 20,000 and over (measured on 2026-11-14).
"""

from __future__ import annotations

import csv
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from analysis.utils.names import FirstNameFreq, NamesCountByRegion
from scrapers.stores import Context


@dataclass(frozen=True)
class Names:
    """PESEL's living people (`analysis.utils.names`): how many carry each
    surname in each sex's form, summed over voivodeships, and how many carry
    each first name, by sex (M, K)."""

    surnames: Mapping[str, Mapping[str, int]]
    first_names: Mapping[str, Mapping[str, int]]

    def sex(self, first_name: str) -> str:
        """M or K: the sex that carries the first name more often; a name
        PESEL does not list is a woman's when it ends in a."""
        name = (first_name.split() or [""])[0].upper()
        men = self.first_names["M"].get(name, 0)
        women = self.first_names["K"].get(name, 0)
        if men == women == 0:
            return "K" if name.endswith("A") else "M"
        return "M" if men >= women else "K"

    def bearers(self, first_name: str, last_name: str) -> int:
        """Living Poles with the surname in the person's sex's form; 0 for one
        PESEL does not list, as most double surnames."""
        return self.surnames[self.sex(first_name)].get(last_name.strip().upper(), 0)


def _counts(rows: Iterable[str], name: str, count: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in csv.DictReader(rows):
        counts[row[name].strip().upper()] += int(row[count])
    return counts


def read_names(ctx: Context) -> Names:
    """The PESEL tables, from the downloaded cache (fetched on a miss)."""
    men, women = NamesCountByRegion.surnames
    men_first, women_first = FirstNameFreq.firstnames

    def table(ref: Any, name: str, count: str) -> Counter[str]:
        # utf-8-sig: a byte order mark would otherwise stick to the first
        # column's name, which is the first names' own.
        text = ctx.io.read_data(ref).read_bytes().decode("utf-8-sig")
        return _counts(text.splitlines(), name, count)

    surname, bearers = "Nazwisko aktualne", "Liczba"
    first, carriers = "IMIĘ_PIERWSZE", "LICZBA_WYSTĄPIEŃ"
    return Names(
        surnames={
            "M": table(men, surname, bearers),
            "K": table(women, surname, bearers),
        },
        first_names={
            "M": table(men_first, first, carriers),
            "K": table(women_first, first, carriers),
        },
    )
