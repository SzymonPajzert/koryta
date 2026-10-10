import typing
from collections import defaultdict

import pandas as pd

from analysis.utils.tables import create_people_table
from scrapers.krs.odpis_people import PeopleKRSCombined, fold
from scrapers.stores import Context, LocalFile, Pipeline

krs_file = LocalFile("person_krs.jsonl", "versioned")


class PeopleKRSMerged(Pipeline):
    filename = "people_krs_merged"
    # rejestr.io's people, with the odpisy standing in wherever they are newer.
    people_krs: PeopleKRSCombined

    def process(self, ctx: Context):
        krs_data = self.people_krs.read_or_process(ctx)
        return people_krs_merged(ctx, krs_data)


def _present(value: typing.Any) -> str | None:
    """A cell as text, or None for an empty one (None, NaN, "")."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    return str(value) or None


class _People:
    """Union-find over the keys rows are known by: `p:<fingerprint>` and
    `r:<rejestr.io id>`. A person's value is their least key."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, key: str) -> None:
        self.parent.setdefault(key, key)

    def find(self, key: str) -> str:
        root = key
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[key] != root:
            self.parent[key], key = root, self.parent[key]
        return root

    def union(self, one: str, other: str) -> None:
        a, b = self.find(one), self.find(other)
        if a != b:
            self.parent[max(a, b)] = min(a, b)

    def kinds(self) -> dict[str, set[str]]:
        """Which kinds of key ("p", "r") each person is known by."""
        kinds: dict[str, set[str]] = defaultdict(set)
        for key in self.parent:
            kinds[self.find(key)].add(key[0])
        return kinds


def _column(krs: pd.DataFrame, name: str) -> list:
    return list(krs[name]) if name in krs else [None] * len(krs)


def person_keys(krs: pd.DataFrame) -> pd.Series:
    """Who each row is: one value per person, None where the row cannot say.

    The salted PESEL (`pesel_fingerprint`) is a person's id, and a rejestr.io
    id joins it one to one - 75,587 ids on the 2026-10-09 night, with no
    conflict either way. So rows sharing either are one person, transitively:
    an odpis row holds both, and links a rejestr.io row of the same id at a
    company with no odpis on file to the odpis rows of the same PESEL
    elsewhere.

    Except that two rejestr.io entries are never one person, whatever joins
    them (rejestr-io-entry-is-one-person). Where one PESEL matched two ids -
    rejestr.io listing somebody twice, as 126307 and 715231 at 0000127464 on
    the 2026-10-09 night (`match_rejestrio`) - each id stays a person of its
    own, the PESEL on both, and `combine` names the pair for a reviewer to
    merge their pages by hand.

    A person known by a PESEL alone and one known by a rejestr.io id alone are
    one person where they share a first name, a surname and a full birth date,
    no middle name tells them apart, and neither has another such partner. The
    id's companies have no odpis on file to say so outright; when the odpisy
    behind 2,882 such pairs were fetched, 2,867 named the very PESEL and none
    another (the other 15 for reasons of their own). Where neither has such a
    namesake, a surname one of the two extends will do instead
    (`_join_by_name_and_date`).

    The value is the person's least key, `p:<fingerprint>` where they have a
    PESEL and `r:<id>` where only an id. A row with neither - somebody without
    a PESEL whom the odpis gives a printed birth date - is None, and grouped by
    name and date as before (`create_people_table`). A PESEL two entries share
    is keyed with the entry, `p:<fingerprint>/<id>`, so it joins neither to the
    other.
    """
    ids, prints, dates = (
        [_present(value) for value in _column(krs, name)]
        for name in ("id", "pesel_fingerprint", "birth_date")
    )
    # An undated row is left out, as a name alone tells nobody apart. Its id
    # is rejestr.io's `osoba-bez-pesel` number, which names another person
    # than the `osoba` of the same number.
    entries_of: dict[str, set[str]] = defaultdict(set)
    for id, printed, born in zip(ids, prints, dates):
        if id is not None and printed is not None and born is not None:
            entries_of[printed].add(id)

    people = _People()
    rows: list[str | None] = []
    for id, printed, born in zip(ids, prints, dates):
        if born is None:
            rows.append(None)
            continue
        if printed is not None and id is not None and len(entries_of[printed]) > 1:
            printed = f"{printed}/{id}"
        keys = [
            f"{kind}:{value}"
            for kind, value in (("r", id), ("p", printed))
            if value is not None
        ]
        for key in keys:
            people.add(key)
        if len(keys) == 2:
            people.union(*keys)
        rows.append(keys[0] if keys else None)
    _join_by_name_and_date(krs, rows, people)
    return pd.Series(
        [people.find(key) if key is not None else None for key in rows],
        index=krs.index,
        dtype=object,
    )


def _join_by_name_and_date(
    krs: pd.DataFrame, rows: list[str | None], people: _People
) -> None:
    """Join each person known by a PESEL alone to the one person known by a
    rejestr.io id alone with their name and birth date, where neither has
    another such partner and no middle name tells them apart.

    Failing any such namesake, on either side, to the one with their first
    name and birth date under a surname one of the two extends: Justyna
    Monika Ryfa, as her newest odpis has her, is the Justyna Monika Ryfa
    Rakowska of entry 2740942. Five people on the 2026-10-10 night, all a
    married name added or dropped; without it each would have had a page of
    her own beside the entry's, since the ingest's `namesAgree` holds the
    surname to the last word. Of the 85,303 PESELs on that night's rows, one
    first name and birth date came under two such surnames 11 times, always
    one PESEL, never two. A person known by a PESEL alone has no entry, so
    this joins no two entries (rejestr-io-entry-is-one-person).
    """
    named: dict[str, set[tuple[str, str, str]]] = defaultdict(set)
    middles: dict[str, set[str]] = defaultdict(set)
    for key, first, last, born, middle in zip(
        rows,
        _column(krs, "first_name"),
        _column(krs, "last_name"),
        _column(krs, "birth_date"),
        _column(krs, "second_names"),
    ):
        if key is None or (born := _present(born)) is None:
            continue
        root = people.find(key)
        named[root].add((fold(first), fold(last), born[:10]))
        if folded := fold(_present(middle)):
            middles[root].add(folded)

    kinds = people.kinds()
    by_name: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for root, names in named.items():
        if kinds[root] == {"r"}:
            for name in names:
                by_name[name].append(root)

    def agree(root: str, other: str) -> bool:
        return (
            not middles[root]
            or not middles[other]
            or bool(middles[root] & middles[other])
        )

    # Who has a namesake on the other side at all, before the middle names
    # are asked: a person with one is left to the exact name.
    exact: dict[str, set[str]] = defaultdict(set)
    partners: dict[str, set[str]] = defaultdict(set)
    for root, names in named.items():
        if kinds[root] != {"p"}:
            continue
        for other in {other for name in names for other in by_name.get(name, ())}:
            exact[root].add(other)
            exact[other].add(root)
            if agree(root, other):
                partners[root].add(other)
                partners[other].add(root)
    _join_partners(partners, people)

    # Then a surname written in part, among the people left with no namesake.
    unnamed = {
        root: names
        for root, names in named.items()
        if kinds[root] in ({"p"}, {"r"}) and not exact[root]
    }
    _join_partners(_extended_surnames(named, unnamed, kinds, agree), people)


def _extended_surnames(
    named: dict[str, set[tuple[str, str, str]]],
    unnamed: typing.Container[str],
    kinds: dict[str, set[str]],
    agree: typing.Callable[[str, str], bool],
) -> dict[str, set[str]]:
    """The partners of each `unnamed` person known by a PESEL alone among the
    `unnamed` people known by an id alone: the same first name and birth date,
    under a surname one of the two extends (`surname_extends`), and no middle
    name apart.

    Everybody else who fits by the first name, the date and the surname, as
    written or extended, counts against the pair without being a partner: a
    person known by a PESEL and an entry both, or one left to the exact name
    or joined by it. Entry 7's Justyna Ryfa Rakowska may be the Justyna Ryfa
    only an odpis names, or the Justyna Ryfa whose PESEL entry 9 carries -
    rejestr.io lists somebody twice now and then - and the second is never
    joined to entry 7, two entries being two people. With both there, which
    one entry 7 is would be a guess, and a wrong one hangs a stranger's posts
    on the entry's page. None of the five joined on 2026-10-10 had such a
    rival.
    """
    by_first: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for root, names in named.items():
        if "r" in kinds[root]:
            for first, last, born in names:
                by_first[(first, born)].append((root, last))
    partners: dict[str, set[str]] = defaultdict(set)
    for root, names in named.items():
        if "p" not in kinds[root]:
            continue
        for first, last, born in names:
            for other, theirs in by_first.get((first, born), ()):
                fits = last == theirs or surname_extends(last, theirs)
                if other != root and fits and agree(root, other):
                    partners[root].add(other)
                    partners[other].add(root)
    return {root: others for root, others in partners.items() if root in unnamed}


def _join_partners(partners: dict[str, set[str]], people: _People) -> None:
    """Join each person known by a PESEL alone to their one partner, where
    the partner has no other - and is a candidate at all: a rival left out of
    `partners` is never joined."""
    for root, others in list(partners.items()):
        if root.startswith("p:") and len(others) == 1:
            (other,) = others
            if len(partners.get(other, ())) == 1:
                people.union(root, other)


def surname_extends(one: str, other: str) -> bool:
    """Whether one folded surname is the other with words added: "ryfa" and
    "ryfa rakowska", "griffin knoblauch" and "griffin" - a hyphen is a space
    by now (`fold`). Sharing a word is not enough: "wollik littwin" and
    "wollik litwin" is a typo or two people, not a surname taken on."""
    a, b = set(one.split()), set(other.split())
    return bool(a) and bool(b) and (a < b or b < a)


def people_krs_merged(ctx: Context, krs_data: pd.DataFrame):
    con = ctx.con
    krs_data = krs_data.assign(person=person_keys(krs_data))
    if "pesel_fingerprint" not in krs_data:
        # A copy of PeopleKRSCombined from before it kept the fingerprint, or a
        # run without the key: nobody is known by a PESEL.
        krs_data = krs_data.assign(pesel_fingerprint=None)
    krs_data["pesel_fingerprint"] = krs_data["pesel_fingerprint"].map(_present)

    con.execute(
        """
        CREATE OR REPLACE TABLE krs_people_raw AS
        SELECT
            lower(first_name) as first_name,
            lower(last_name) as last_name,
            -- The register knows the middle name; it is `drugie_imiona` in the
            -- response and `scrapers/krs/list.py` has always captured it. This
            -- used to be `CAST(NULL AS VARCHAR)`, which threw it away and left
            -- `create_people_table` to work it out by subtracting the first and
            -- last name from `full_name` - a guess, and made against a column
            -- that is not one value per person.
            --
            -- An empty `drugie_imiona` means "no middle name" and is trusted as
            -- such rather than coalesced back into the guess. Of the 180,330
            -- rows crawled, 85,581 carry one; of the 94,749 that do not, every
            -- single one whose `full_name` still runs to three words has a
            -- two-word `last_name` - a double surname, not a middle name the
            -- register forgot. Nothing is left for the guess to add.
            --
            -- NULL is still NULL, and still derives: that is a field the
            -- response did not have at all, which is not the same answer as an
            -- empty one.
            lower(trim(second_names)) as second_name,
            CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
            CAST(birth_date AS VARCHAR) as birth_date,
            employed_start,
            employed_end,
            employed_krs,
            employed_role,
            employed_for,
            id as rejestrio_id,
            CAST(pesel_fingerprint AS VARCHAR) as pesel_fingerprint,
            CAST(person AS VARCHAR) as person,
            full_name
        FROM krs_data
        -- Nobody without a full birth date: a name alone tells no two people
        -- apart. That drops every rejestr.io `osoba-bez-pesel` entry (5,343 on
        -- the 2026-10-09 night), but not everybody without a PESEL: where an
        -- odpis prints the birth date instead, its row has one: 236 people come
        -- in that way on that night's data (scrapers/krs/list.py, PERSON_TYPES).
        WHERE birth_date IS NOT NULL AND first_name IS NOT NULL
            AND last_name IS NOT NULL
        """
    )

    create_people_table(
        con,
        "krs_people",
        # Who a row is (`person_keys`): the PESEL, which a rejestr.io id joins
        # one to one. rejestr.io writes a person the way each company's entry
        # has it - without Polish letters, under a maiden name, with the
        # middle name and without - so grouped by the name, one person came
        # out as several rows: 87 ids split over two rows each in the
        # 2026-10-01 crawl. The other way round, an entry missing its middle
        # name joined every namesake born the same year, a stranger's post and
        # id with it; and two people only the odpisy name, with one name and
        # one birth date, were one row.
        identity="person",
        to_list=["rejestrio_id", "full_name", "pesel_fingerprint"],
        any_vals=["birth_date"],
        employment={
            "employed_krs": "employed_krs",
            "employed_end": "employed_end",
            "employed_for": "employed_for",
            "employed_start": "employed_start",
            "employed_role": "employed_role",
        },
    )

    return con.sql("SELECT * FROM krs_people").df()
