"""Matching a person read out of an odpis against `PeopleMerged`.

The join key is **name plus full birth date**, and the birth date is the half
that carries the argument. Name alone is not a match: its precision is a
property of the population being joined, not of the rule -- measured on the
same day, name-only matching was 0% precise against sole traders and 85.9%
against KRS board members, because koryta's person corpus is largely built
*from* KRS board data and a board member is therefore drawn from the same
population. And 85.9% is still one wrong person in seven.

Adding the birth date settles it, which is what makes a PESEL worth reading:
ambiguity on a name alone is 15.8%, on name plus birth *year* 0.2%, and on name
plus full date 0.02%. The year is not enough and the difference is not
academic -- a previous sweep turned up a PAWEŁ NOWAK born 1978-10-11 against
one born 1978-11-30, seven weeks apart, whom name-and-year would have merged.

So `match` never returns a person on a name alone. What it does instead is
report the name matches whose birth dates *disagree* as `refuted`, because
those are the useful negative: they are the pairs a name-only rule would have
merged, and counting them is how the rule's precision gets measured rather
than assumed.

`PeopleMerged` holds 133,072 people and every one of them carries a birth date
(`versioned/people_merged`, 2026-09-13), so there is no population here that
the key cannot reach -- unlike `PeopleKRS`, where 3,912 ``osoba-bez-pesel``
entries have no date at all and are dropped by `PeopleKRSMerged`'s
``WHERE birth_date IS NOT NULL``. Those are exactly the people an odpis can
supply a date for.
"""

import collections
import json
import typing
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from scrapers.krs.odpis_pdf import OdpisPerson


def fold_name(value: str | None) -> str:
    """Lowercase and strip the accents, keeping the letters.

    `PeopleMerged.base_first_name` is already lowercased but keeps its
    diacritics ("młodzik"), while an odpis shouts and may or may not -- so both
    sides are folded to the same shape here rather than trusting either.
    """
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFD", value)
    bare = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return bare.replace("ł", "l").replace("Ł", "l").strip().lower()


def name_key(first: str | None, last: str | None) -> tuple[str, str]:
    return fold_name(first), fold_name(last)


@dataclass(frozen=True)
class MergedPerson:
    """The fields of a `PeopleMerged` row this join needs."""

    birth_date: str
    first_name: str
    last_name: str
    second_name: str | None
    koryta_id: str | None
    rejestrio_id: tuple[str, ...]
    full_names: tuple[str, ...]

    @property
    def on_koryta(self) -> bool:
        return bool(self.koryta_id)


@dataclass
class PeopleIndex:
    """`PeopleMerged`, indexed both ways the join needs to read it."""

    by_name_and_date: dict[tuple[str, str, str], list[MergedPerson]]
    by_name: dict[tuple[str, str], list[MergedPerson]]

    @property
    def size(self) -> int:
        return sum(len(v) for v in self.by_name.values())


def load_index(path: Path) -> PeopleIndex:
    by_name_and_date: dict[tuple[str, str, str], list[MergedPerson]] = (
        collections.defaultdict(list)
    )
    by_name: dict[tuple[str, str], list[MergedPerson]] = collections.defaultdict(list)

    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            birth_date = row.get("birth_date")
            if not birth_date:
                continue
            first = row.get("base_first_name") or row.get("first_name")
            last = row.get("base_last_name") or row.get("last_name")
            key = name_key(first, last)
            if not key[1]:
                continue
            rejestrio = row.get("rejestrio_id") or []
            full = row.get("full_name") or []
            person = MergedPerson(
                birth_date=str(birth_date),
                first_name=str(first or ""),
                last_name=str(last or ""),
                second_name=row.get("second_name"),
                koryta_id=row.get("koryta_id"),
                rejestrio_id=tuple(
                    str(x)
                    for x in (
                        rejestrio if isinstance(rejestrio, list) else [rejestrio]
                    )
                ),
                full_names=tuple(
                    str(x) for x in (full if isinstance(full, list) else [full])
                ),
            )
            by_name_and_date[(*key, person.birth_date)].append(person)
            by_name[key].append(person)

    return PeopleIndex(dict(by_name_and_date), dict(by_name))


#: Which way a person from an odpis relates to `PeopleMerged`.
#:
#: ``refuted`` is the one worth having: the name is in the corpus but with a
#: different birth date, so a name-only rule would have merged two humans. It
#: is not an error and not a match -- it is the measurement of how often the
#: cheaper rule would have been wrong.
VERDICTS = ("matched", "ambiguous", "refuted", "new", "no_birth_date")


@dataclass(frozen=True)
class MatchResult:
    person: OdpisPerson
    verdict: str
    candidates: tuple[MergedPerson, ...] = ()

    @property
    def matched(self) -> MergedPerson | None:
        return self.candidates[0] if self.verdict == "matched" else None


def split_name(person: OdpisPerson) -> tuple[str, str]:
    """The odpis's ``Imiona`` and ``Nazwisko`` as a (first, last) pair.

    ``Imiona`` is every given name in one field ("TADEUSZ WAWRZYNIEC"), and
    `PeopleMerged` keys on the first with the rest in `second_name`, so only
    the first word is part of the key.
    """
    given = person.given_names.split()
    return (given[0] if given else ""), person.surname


def match_person(person: OdpisPerson, index: PeopleIndex) -> MatchResult:
    if not person.birth_date:
        # No PESEL, so nothing to confirm a name against. Returning a name-only
        # candidate here is exactly the mistake this module exists to avoid.
        return MatchResult(person=person, verdict="no_birth_date")

    first, last = split_name(person)
    key = name_key(first, last)

    exact = index.by_name_and_date.get((*key, person.birth_date), [])
    if len(exact) == 1:
        return MatchResult(person, "matched", tuple(exact))
    if len(exact) > 1:
        # The same name and the same day, twice. Rare, and a real pair of
        # people often enough that picking one would be a guess.
        return MatchResult(person, "ambiguous", tuple(exact))

    same_name = index.by_name.get(key, [])
    if same_name:
        return MatchResult(person, "refuted", tuple(same_name))
    return MatchResult(person, "new")


def match_all(
    people: typing.Iterable[OdpisPerson], index: PeopleIndex
) -> list[MatchResult]:
    return [match_person(person, index) for person in people]


def summarise(results: typing.Sequence[MatchResult]) -> str:
    counts = collections.Counter(result.verdict for result in results)
    on_koryta = sum(
        1
        for result in results
        if result.matched is not None and result.matched.on_koryta
    )
    total = len(results)
    lines = [f"{'verdict':<16}{'people':>8}{'share':>9}"]
    for verdict in VERDICTS:
        count = counts.get(verdict, 0)
        share = f"{count / total:.1%}" if total else "-"
        lines.append(f"{verdict:<16}{count:>8,}{share:>9}")
    lines.append(f"{'(of matched, already on koryta)':<16} {on_koryta:,}")

    refuted = counts.get("refuted", 0)
    matched = counts.get("matched", 0)
    if matched + refuted:
        precision = matched / (matched + refuted)
        lines.append(
            f"\nname-only precision on this population: {precision:.1%} "
            f"({matched:,} agreed, {refuted:,} refuted by the birth date)"
        )
    return "\n".join(lines)
