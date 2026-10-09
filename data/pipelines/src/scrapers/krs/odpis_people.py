"""Odpis seats as the rows rejestr.io's company feeds give, and the two together.

`PeopleKRS` reads rejestr.io's ``krs-powiazania`` feeds: a row per post somebody
held at a company, with the days it began and ended. An odpis pełny says the
same from the register's own entries. Measured over the 585 companies both
covered on 2026-10-02: 16,287 of rejestr.io's 16,441 people are in the odpis
under the same name and birth date, and of their 18,491 posts 18,478 are there
too, 18,279 agreeing to the day at both ends. Nearly all the rest is one person
spelled two ways -- a double surname joined by a space or by a hyphen, a maiden
name, an early entry typed without Polish letters -- and what is left after
that is the newer source having seen an entry the older had not.

`PeopleKRSCombined` is `PeopleKRS` with the odpisy folded in:

- A company's people come from whichever source is newer -- the day the odpis
  speaks for against the day rejestr.io was crawled -- and never from both,
  which would state every seat twice. Where rejestr.io has nothing, the odpis
  is all there is.
- Only companies the pipelines know take part (`CompaniesKRS`). The CRU crawl
  filed odpisy of ~7,600 private contractors, and their boards are not this
  corpus until the company graph takes the companies in.
- An odpis person who is a rejestr.io person at the same company keeps
  rejestr.io's spelling and id, so a page linked by that id stays linked; the
  PESEL fingerprint carries that identity to the person's other companies, and
  gives one spelling to somebody the register wrote two ways.
- Every row says whose PESEL it is where anybody knows: an odpis row its own
  fingerprint, a rejestr.io row the fingerprint its id was matched to.
  `PeopleKRSMerged` keys people by it. It goes no further than the pipelines'
  outputs: no payload, sent part, request or log line carries it.
- rejestr.io lists somebody twice now and then: two ids, one name, one birth
  date, one post. Where the odpis names one person there with that name and
  day, both ids are that person's, and the odpis rows are written once per id
  so that each id stays on the record (ids 126307 and 715231 at 0000127464, on
  the 2026-10-09 night).
- Somebody without a PESEL takes no rejestr.io identity. The odpis prints
  some of them a birth date in the PESEL's place, but rejestr.io's
  ``osoba-bez-pesel`` entry has no date to match it on, and its id names
  nobody past its one company (`scrapers.krs.list.PERSON_TYPES`). Dated, they
  go on as people only the odpis names; undated, `PeopleKRSMerged` drops them
  as it drops the entry.
- A rejestr.io person the newer odpis does not name keeps rejestr.io's rows.
  An odpis pełny names everybody who ever held a seat, struck out or not, so
  somebody missing from it is the parser's miss or a spelling no rule above
  reaches -- 8 of the 16,441, measured -- and not a person who left.
- An odpis that records the company struck off one register while it lives on
  in the other (``WYKREŚLENIE Z REJESTRU PRZEDSIĘBIORCÓW``, 17 on file) stands in
  for nobody. Its seats all end on the day of the strike-off, which is when the
  register stopped speaking, not when the people left; the other register's
  odpis carries on where it stops.

Without the PESEL key and with no copy of the seats to restore -- a CI runner --
the people are rejestr.io's alone, and the run says so.
"""

import unicodedata
from collections.abc import Iterable

import pandas as pd

from entities.person import KRS as KrsPerson
from scrapers.krs.columns import iso_dates, padded_krs
from scrapers.krs.list import KRS_RELATION_ROLES, CompaniesKRS, PeopleKRS, Post
from scrapers.krs.odpis_history import (
    KrsOdpisEntries,
    KrsOdpisSeats,
    PeselKeyMissing,
)
from scrapers.stores import Context, Pipeline


#: The parser's roles (`odpis_pdf.ROLE_BY_RUBRYKA`) that are posts, named as
#: `PeopleKRS` names the rejestr.io connection for each. The other roles --
#: owners, founders, liquidators, receivers, curators -- are what
#: `KRS_RELATION_ROLES` maps to None: rejestr.io lists none of the 32
#: liquidators the odpisy name at the companies both cover as a post.
def _post(connection: str) -> str:
    post = KRS_RELATION_ROLES[connection]
    assert post is not None, f"{connection} is not a post"
    return post


POST_BY_ROLE: dict[str, str] = {
    "reprezentacja": _post("KRS_BOARD"),
    "nadzor": _post("KRS_SUPERVISION"),
    "prokurent": _post("KRS_PROXY"),
    "pelnomocnik": _post("KRS_PROCURATOR"),
}

SOURCE_REJESTRIO = "rejestr.io"
SOURCE_ODPIS = "odpis"

#: `PeopleKRS`'s columns, in its order.
KRS_COLUMNS = tuple(KrsPerson.__dataclass_fields__)

#: Those, where each row came from, and whose PESEL it is (`combine`).
COLUMNS = (*KRS_COLUMNS, "source", "pesel_fingerprint")

#: The columns the people's frames carry that no log line may print: the
#: salted PESEL. The key that made it is never rotated, so a fingerprint in a
#: log is as good as one on a page to whoever holds the key.
NEVER_SHOWN = ("pesel_fingerprint",)

#: How the list of entries records a company struck off one register while it
#: lives on in the other: "WYKREŚLENIE Z REJESTRU PRZEDSIĘBIORCÓW". Leaving the
#: KRS altogether is "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO", after which
#: the odpis is the last word and stands.
STRUCK_OFF_ONE_REGISTER = "WYKREŚLENIE Z REJESTRU "


def struck_off_one_register(entries: pd.DataFrame) -> set[str]:
    """The companies whose odpis on file records leaving one register for the other."""
    struck = entries["description"].fillna("").str.upper()
    return set(entries.loc[struck.str.startswith(STRUCK_OFF_ONE_REGISTER), "krs"])


#: What a rejestr.io person is known by, carried onto an odpis person.
IDENTITY = ("id", "first_name", "last_name", "second_names", "full_name")


def _text(value) -> str | None:
    """A cell as text, or None for a missing one (which pandas may hand over as NaN)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return str(value)


def title(name) -> str:
    """A register name as rejestr.io writes it: ``NOWAK-KOS`` -> ``Nowak-Kos``."""
    return " ".join(str(name or "").split()).title()


def fold(name) -> str:
    """A name for comparing spellings: no case, no diacritics, a hyphen as a space."""
    text = str(name or "").replace("ł", "l").replace("Ł", "L")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.replace("-", " ").lower().split())


def posts_from_seats(seats: pd.DataFrame) -> pd.DataFrame:
    """Every seat that is a post, as a `PeopleKRS` row, with its PESEL fingerprint.

    The names are re-cased the way rejestr.io gives them, and split the same
    way: the first given name, the others as second names, and a full name of
    the first and the surname alone.
    """
    is_post = seats["role"].isin(list(POST_BY_ROLE))
    is_person = ~seats["is_company"].eq(True)
    rows = []
    for seat in seats[is_post & is_person].itertuples(index=False):
        given = title(seat.given_names).split()
        first = given[0] if given else ""
        last = title(seat.surname)
        start, end = _text(seat.date_added), _text(seat.date_removed)
        post = Post(role=POST_BY_ROLE[str(seat.role)], start=start, end=end)
        rows.append(
            {
                "id": None,
                "first_name": first,
                "last_name": last,
                "full_name": f"{first} {last}".strip(),
                "employed_krs": seat.krs,
                "employed_start": start,
                "employed_end": end,
                "employed_for": post.years,
                "employed_role": post.role,
                "birth_date": _text(seat.birth_date),
                "second_names": " ".join(given[1:]),
                "sex": _text(seat.sex),
                "rejestrio_type": None,
                "crawled_on": _text(seat.stated_on),
                "source": SOURCE_ODPIS,
                "pesel_fingerprint": _text(seat.pesel_fingerprint),
            }
        )
    return pd.DataFrame.from_records(rows, columns=list(COLUMNS))


def _tier(first: str, last: str, first_r: str, last_r: str) -> int | None:
    """How well two spellings of one birth date's name agree; None when they do not."""
    if first == first_r and last == last_r:
        return 1
    if first == first_r:
        # The same first name on the same birth date at the same company: a
        # surname changed by marriage, or written in part.
        return 2
    if set(last.split()) & set(last_r.split()):
        # A first name the two spell differently, under a shared surname.
        return 3
    if first == last_r and last == first_r:
        # The two names entered the wrong way round, as rejestr.io holds one
        # supervisory board member.
        return 4
    return None


def match_rejestrio(rejestrio: pd.DataFrame, posts: pd.DataFrame) -> pd.DataFrame:
    """Each odpis person who is exactly one rejestr.io person at the same company.

    Matched on the company and the birth date, then on the names as far as the
    two spellings agree: both, else the first name, else a word of the surname.
    The best of those that leaves one candidate wins. Two candidates at the best
    tier are no match, and neither is a rejestr.io person two odpis people
    would claim: guessing would hang one person's posts on another's page.

    Except where the candidates are one name: the same first name, surname and
    birth date, and no two middle names. That is rejestr.io listing one person
    twice, and the odpis, which names everybody who held a seat, naming one
    person there under that name says so. Each id is matched, so a person can
    come out with two (`with_identities`).

    One row per (employed_krs, pesel_fingerprint, id), with the rejestr.io
    person's `IDENTITY`.
    """
    person = ["employed_krs", "pesel_fingerprint"]
    theirs = {c: f"r_{c}" for c in IDENTITY}
    empty = pd.DataFrame(columns=[*person, *IDENTITY])
    rejestrio = rejestrio.reindex(columns=list(KRS_COLUMNS))
    odpis = posts.dropna(subset=["pesel_fingerprint", "birth_date"])
    odpis = odpis[[*person, "first_name", "last_name", "birth_date"]].drop_duplicates()
    known = rejestrio.dropna(subset=["id", "birth_date"])
    known = known[["employed_krs", "birth_date", *IDENTITY]].drop_duplicates(
        subset=["employed_krs", "id"]
    )
    if odpis.empty or known.empty:
        return empty
    pairs = odpis.merge(known.rename(columns=theirs), on=["employed_krs", "birth_date"])
    if pairs.empty:
        return empty
    pairs["tier"] = [
        _tier(fold(a), fold(b), fold(c), fold(d))
        for a, b, c, d in zip(
            pairs["first_name"],
            pairs["last_name"],
            pairs["r_first_name"],
            pairs["r_last_name"],
        )
    ]
    pairs = pairs.dropna(subset=["tier"])
    best = pairs.groupby(person)["tier"].transform("min")
    pairs = pairs[pairs["tier"] == best].drop_duplicates(subset=[*person, "r_id"])
    pairs = pairs.assign(
        r_name=pd.Series(
            [
                f"{fold(first)}|{fold(last)}"
                for first, last in zip(pairs["r_first_name"], pairs["r_last_name"])
            ],
            index=pairs.index,
            dtype=object,
        ),
        r_middle=pd.Series(
            [fold(_text(middle)) or None for middle in pairs["r_second_names"]],
            index=pairs.index,
            dtype=object,
        ),
    )
    candidates = pairs.groupby(person)
    one_name = (candidates["r_name"].transform("nunique") == 1) & (
        candidates["r_middle"].transform("nunique") <= 1
    )
    pairs = pairs[(candidates["r_id"].transform("size") == 1) | one_name]
    claimed = pairs.groupby(["employed_krs", "r_id"])["pesel_fingerprint"]
    pairs = pairs[claimed.transform("size") == 1]
    ours = {v: k for k, v in theirs.items()}
    return (
        pairs[[*person, *theirs.values()]].rename(columns=ours).reset_index(drop=True)
    )


def with_identities(posts: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    """Each odpis row under the one name its person goes by, and any rejestr.io id.

    A fingerprint matched at some company takes the identity of the rejestr.io
    person it matched most often, on every row it has. One never matched keeps
    the spelling of its newest seat, so a surname written without diacritics in
    2004 and with them in 2019 is one person and not two. A row's id is the
    one its own company matched, else the fingerprint's; where its company
    matched two (`match_rejestrio`), the row is written once for each.
    """
    posts = posts.reset_index(drop=True)
    printed = posts.dropna(subset=["pesel_fingerprint"])
    if printed.empty:
        return posts

    newest = printed.sort_values(
        ["employed_start", "crawled_on", "full_name"], na_position="first"
    ).drop_duplicates("pesel_fingerprint", keep="last")
    names = newest.set_index("pesel_fingerprint")[list(IDENTITY)]
    names["id"] = None

    if not matches.empty:
        sizes = matches.groupby(["pesel_fingerprint", "id"]).size().rename("n")
        counts = sizes.reset_index()
        # The lowest id of a tie by its number, so 99 comes before 100.
        counts["number"] = pd.to_numeric(counts["id"], errors="coerce")
        preferred = counts.sort_values(
            ["pesel_fingerprint", "n", "number", "id"],
            ascending=[True, False, True, True],
        ).drop_duplicates("pesel_fingerprint")
        known = preferred.merge(
            matches.drop_duplicates(["pesel_fingerprint", "id"]),
            on=["pesel_fingerprint", "id"],
        ).set_index("pesel_fingerprint")[list(IDENTITY)]
        names.loc[known.index, list(IDENTITY)] = known

    has_print = posts["pesel_fingerprint"].notna()
    keyed = posts.loc[has_print, "pesel_fingerprint"]
    for column in IDENTITY:
        posts.loc[has_print, column] = keyed.map(names[column]).to_numpy()
    if not matches.empty:
        own = matches[["employed_krs", "pesel_fingerprint", "id"]].rename(
            columns={"id": "id_own"}
        )
        posts = posts.merge(own, on=["employed_krs", "pesel_fingerprint"], how="left")
        posts["id"] = posts["id_own"].where(posts["id_own"].notna(), posts["id"])
        posts = posts.drop(columns="id_own")
    return posts


def odpis_companies(rejestrio: pd.DataFrame, posts: pd.DataFrame) -> set[str]:
    """The companies whose odpis is at least as new as rejestr.io's crawl of them.

    Including every company rejestr.io has no rows for. A rejestr.io row with
    no crawl day -- an output written before `PeopleKRS` recorded one -- loses
    to the odpis: the register's own document, which agreed with rejestr.io to
    the day on 98.9% of posts and was the newer of the two at 560 of 585.
    """
    odpis_day = posts.groupby("employed_krs")["crawled_on"].max()
    crawled = rejestrio.reindex(columns=list(KRS_COLUMNS)).dropna(subset=["crawled_on"])
    rejestrio_day = {
        str(krs): str(day)
        for krs, day in crawled.groupby("employed_krs")["crawled_on"].max().items()
    }
    return {
        str(krs)
        for krs, day in odpis_day.items()
        if rejestrio_day.get(str(krs), "") <= str(day)
    }


def combine(
    rejestrio: pd.DataFrame,
    seats: pd.DataFrame,
    graph: set[str],
    struck: Iterable[str] = (),
) -> pd.DataFrame:
    """rejestr.io's rows and the odpis's, each company from the newer source.

    `struck` names the companies whose odpis on file stands in for nobody
    (`struck_off_one_register`).

    A rejestr.io row takes the fingerprint its id was matched to, at any
    company, so the row says whose PESEL it is where the odpis of its own
    company is not on file. An id matched to two fingerprints - none on the
    2026-10-09 night, of 75,587 matched - takes neither: which of the two its
    rows are is not something to guess.
    """
    rejestrio = rejestrio.reindex(columns=list(KRS_COLUMNS))
    posts = posts_from_seats(seats)
    posts = posts[posts["employed_krs"].isin(graph - set(struck))]
    matches = match_rejestrio(rejestrio, posts)
    posts = with_identities(posts, matches)
    from_odpis = odpis_companies(rejestrio, posts)
    prints = matches.groupby("id")["pesel_fingerprint"].unique()
    print_of_id = {
        str(id): values[0] for id, values in prints.items() if len(values) == 1
    }
    # Dated rows only: an undated one is an `osoba-bez-pesel` entry, whose
    # number names somebody else than the `osoba` of the same number.
    rejestrio = rejestrio.assign(
        pesel_fingerprint=pd.Series(
            [
                print_of_id.get(str(id)) if pd.notna(id) and pd.notna(born) else None
                for id, born in zip(rejestrio["id"], rejestrio["birth_date"])
            ],
            index=rejestrio.index,
            dtype=object,
        )
    )

    named = set(zip(matches["employed_krs"], matches["id"]))
    unnamed = pd.Series(
        [
            (krs, id) not in named
            for krs, id in zip(rejestrio["employed_krs"], rejestrio["id"])
        ],
        index=rejestrio.index,
        dtype=bool,
    )
    replaced = rejestrio["employed_krs"].isin(from_odpis)
    kept = rejestrio[~replaced | unnamed].assign(source=SOURCE_REJESTRIO)
    added = posts[posts["employed_krs"].isin(from_odpis)]
    report(rejestrio, posts, matches, from_odpis, kept, added, replaced & unnamed)
    combined = pd.concat(
        [kept.reindex(columns=list(COLUMNS)), added.reindex(columns=list(COLUMNS))],
        ignore_index=True,
    )
    return combined


def report(rejestrio, posts, matches, from_odpis, kept, added, unnamed) -> None:
    """What `combine` did, in counts and rejestr.io ids - never a fingerprint."""
    covered = set(rejestrio["employed_krs"])
    odpis_cos = set(posts["employed_krs"])
    replaced = from_odpis & covered
    people = posts.dropna(subset=["pesel_fingerprint"]).drop_duplicates(
        ["employed_krs", "pesel_fingerprint"]
    )
    matched = matches.drop_duplicates(["employed_krs", "pesel_fingerprint"])
    print(
        f"  Odpisy of {len(odpis_cos):,} companies in the graph: "
        f"{len(from_odpis - covered):,} rejestr.io has nothing for, "
        f"{len(replaced):,} where the odpis is newer, "
        f"{len(odpis_cos - from_odpis):,} where rejestr.io is."
    )
    print(
        f"  {len(matched):,} of {len(people):,} odpis people at their company are "
        f"a rejestr.io person there and keep that identity."
    )
    ids_of_print = matches.groupby("pesel_fingerprint")["id"].unique()
    shared = sorted(
        ", ".join(sorted(map(str, ids), key=lambda id: (len(id), id)))
        for ids in ids_of_print
        if len(ids) > 1
    )
    prints_of_id = matches.groupby("id")["pesel_fingerprint"].nunique()
    torn = sorted(str(id) for id, n in prints_of_id.items() if n > 1)
    print(
        f"  {matches['id'].nunique():,} rejestr.io ids have a PESEL fingerprint; "
        f"{len(shared):,} fingerprints are two ids or more, one person each: "
        f"{'; '.join(shared) or 'none'}. {len(torn):,} ids have two fingerprints"
        + (f": {', '.join(torn)}" if torn else "")
    )
    print(
        f"  Rows: {len(kept):,} from rejestr.io, {len(added):,} from odpisy "
        f"(in place of {int(rejestrio['employed_krs'].isin(replaced).sum()):,}); "
        f"{int(unnamed.sum()):,} rows of people an odpis does not name stay "
        f"rejestr.io's."
    )


def odpis_days(combined: pd.DataFrame) -> dict[str, str]:
    """KRS to the day of the odpis `combine` took the company's people from.

    Read off the combined rows rather than worked out again, so whatever acts
    on it agrees with what the site shows: the graph, the strike-off and which
    source is newer are all decided above, once.
    """
    if combined.empty or "source" not in combined.columns:
        return {}
    rows = combined[combined["source"] == SOURCE_ODPIS]
    days = pd.Series(
        iso_dates(rows["crawled_on"]).to_numpy(),
        index=padded_krs(rows["employed_krs"]).to_numpy(),
    )
    latest = days[days != ""].groupby(level=0).max()
    return {str(krs): str(day) for krs, day in latest.items()}


class PeopleKRSCombined(Pipeline):
    """`PeopleKRS`, with every odpis on file standing in where it is newer."""

    filename = "person_krs_combined"
    # Text: a fingerprint is 32 hex digits, and one that happens to be all
    # digits would come back off jsonl as a number.
    dtype = {**PeopleKRS.dtype, "pesel_fingerprint": str}

    people_krs: PeopleKRS
    seats: KrsOdpisSeats
    entries: KrsOdpisEntries
    companies: CompaniesKRS

    def process(self, ctx: Context) -> pd.DataFrame:
        rejestrio = self.people_krs.read_or_process(ctx)
        try:
            # The seats first: without the key they fail before any document
            # is read, and the entries would read every one of them.
            seats = self.seats.read_or_process(ctx)
        except PeselKeyMissing as missing:
            print(f"  [WARN] {missing} The people are rejestr.io's alone.")
            return rejestrio.assign(source=SOURCE_REJESTRIO).reindex(
                columns=list(COLUMNS)
            )
        struck = struck_off_one_register(self.entries.read_or_process(ctx))
        print(f"  {len(struck):,} odpisy record leaving one register; set aside")
        companies = self.companies.read_or_process(ctx)
        graph = set(companies["krs"].astype(str).str.zfill(10))
        return combine(rejestrio, seats, graph, struck)
