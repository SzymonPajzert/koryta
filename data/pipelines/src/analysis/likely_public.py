"""Companies the site does not call public, by how many koryciarze work there.

POSTDATA S.A. (KRS 0000117218) is the case that started this. Six people on the
site sat on its supervisory board, every one of them published or scored as a
koryciarz, half of them with a party, and the board turned over with each
change of government - and the site called it private. It is 51% Poczta Polska.
KRS names no shareholder of a spółka akcyjna that has more than one, so nothing
the pipeline reads could say so.

A company is on the site only because somebody on it worked there, and nearly
everybody on it is there for a public job, so a company the public does not
own or control should hold few of them. One that holds several, all scored as
koryciarz, is usually one the public owns or controls by a route the register
does not show: an SA with more than one public shareholder, a subsidiary struck
off with its parent's ownership struck out with it, a foundation a state company
set up, a union of public hospitals.

Measured on the 2026-10-09 export: 410 companies the site did not call public
had three or more koryciarze, and the pipeline already called 120 of them
public - they only waited for a company upload. The other 291 (counted before
removed posts were left out) were each checked against the odpis pełny and,
where the register could not say, the web. 109 were publicly owned, 71 of them
struck off while a public owner held them (which
`CompaniesKRS.add_owners_at_strike_off` now reads); 51 more were foundations a
public body set up, unions of public hospitals and associations of local
governments; 31 had been public and were sold. The 86 that were not public
were the expected false leads - chambers of commerce, craft guilds, party youth
wings and 28 private firms. Among spółki alone it is sharper: of the 49 with
five or more koryciarze, 44 were public and the other 5 had been.

So this is a list to check, not a verdict. Each row says how many people the
site has there, how many it calls koryciarz, how many are political on the
record, how many also worked at a company the site calls public, and whether
the pipeline already calls the company public - in which case it only waits
for a company upload.

Counting people alone puts the wrong rows first: party youth wings and chambers
of commerce hold more koryciarze than any company, and the Brudziński children's
hospital (0000158332), an SPZOZ of a state medical university, came 486th. So
the list goes by what the register's own history says of the owners first
(`KrsOdpisSeats`, `KrsOdpisEntries`). A public owner still there when the company
was struck off held it to the end: of the 86 companies checked by hand on 2026-10-09
with an owner history, 52 read that way and all 52 were public. One that left
earlier proves nothing either way, 16 sold against 18 still public, because the
register stops naming the shareholders of an SA once it has more than one. Nobody
private appearing after it is no evidence: Veolia Energia Warszawa, sold in 2011,
names no later owner.
"""

import dataclasses
import typing

import pandas as pd

from analysis.interesting import Companies
from entities.company import short_name
from scrapers.koryta.download import KorytaEdges, KorytaNodes, KorytaPeople
from scrapers.krs.columns import is_public
from scrapers.krs.data import public_name_key
from scrapers.krs.odpis_history import (
    KrsOdpisEntries,
    KrsOdpisSeats,
    PeselKeyMissing,
)
from scrapers.krs.public_owners import direct_public_owner
from scrapers.map.jst import JstIndex
from scrapers.map.teryt import Jst
from scrapers.stores import Context, Pipeline, ProcessPolicy

#: The score the site's vote ladder calls "Koryciarz" - see `scaleLabels` in
#: frontend/app/composables/votes.ts. A published page counts the same.
KORYCIARZ = 3

#: The odpis pełny's rubrics that name a company's owners.
OWNER_ROLES = ("wspolnik", "jedyny_akcjonariusz")

#: Legal forms that exist to gather members, not to be owned. The people on the
#: site sit there for their party, town or trade, so a crowd of koryciarze says
#: nothing about who owns the body: on 2026-10-09 these were the 45 chambers and
#: guilds and most of the 14 political leads.
MEMBERSHIP_FORMS = (
    "STOWARZYSZENIE",
    "IZBA",
    "CECH",
    "ZWIĄZEK",
    "FEDERACJA",
    "KONFEDERACJA",
)


@dataclasses.dataclass
class LikelyPublic:
    krs: str
    #: The company's node on the site.
    node: str
    name: str | None
    legal_form: str | None
    #: People on the site with a post there.
    people: int
    #: Of those, the ones published or scored at `KORYCIARZ` or above.
    koryciarze: int
    #: Of those, the ones with a party or a candidacy on the site.
    political: int
    #: Of those, the ones who also held a post at a company the site calls public.
    also_public: int
    #: Whether `Companies` already calls it public. Then the site is only behind,
    #: and a company upload settles it.
    public_in_pipeline: bool
    #: The last public owner the odpis pełny names, if any odpis stored does.
    public_owner: str | None = None
    #: The day that owner left the register, where it has.
    public_owner_until: str | None = None
    #: Whether that owner stayed until the company was struck off, or never left.
    #: Then the public held the company to the end. Otherwise it may have been sold.
    held_to_end: bool = False
    #: Whether the legal form is one of `MEMBERSHIP_FORMS`.
    membership_body: bool = False


def public_company_names(companies: pd.DataFrame) -> frozenset[str]:
    """The names of the companies `Companies` calls public, for owners with no KRS.

    A seat keeps an owner's name and not its KRS number, so a company owner can
    only be told by name. `Companies` keeps names without their legal form.
    """
    public = companies.loc[is_public(companies["is_public"]), "name"]
    return frozenset(key for key in public.map(public_name_key) if key)


def owner_key(name: str) -> str | None:
    """An owner's name as `public_company_names` holds it."""
    key = public_name_key(short_name(name))
    return key.strip(' "') if key else None


def owner_history(
    seats: pd.DataFrame,
    entries: pd.DataFrame,
    jst: JstIndex | None,
    public_names: typing.Collection[str],
) -> dict[str, tuple[str, str | None, bool]]:
    """For each company, its last public owner, the day it left, whether it stayed.

    A company whose odpis names no public owner has no entry. `entries` is
    `KrsOdpisEntries`: an owner gone by the entry that struck the company off
    held it to the end, and one gone from a company still alive did not.
    """
    owners = seats[seats["role"].isin(OWNER_ROLES)]
    verdicts = {
        name: direct_public_owner({"owners": [{"name": name}]}, jst) is not None
        or owner_key(name) in public_names
        for name in owners["full_name"].dropna().unique()
    }
    newest = entries.sort_values("entry_date").groupby("krs").tail(1)
    struck_off = newest[newest["description"].str.startswith("WYKREŚLENIE", na=False)]
    last_entry = struck_off.set_index("krs")["entry_date"]
    found = {}
    for krs, rows in owners.groupby("krs"):
        public = rows[rows["full_name"].map(verdicts).fillna(False).astype(bool)]
        if public.empty:
            continue
        current = public[is_public(public["current"])]
        latest = (current if len(current) else public).sort_values("date_removed")
        latest = latest.iloc[-1]
        until = None if len(current) else _text(latest["date_removed"])
        held = until is None or (krs in last_entry and until >= last_entry[krs])
        found[str(krs).zfill(10)] = (str(latest["full_name"]), until, held)
    return found


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def likely_public(
    nodes: pd.DataFrame,
    edges: pd.DataFrame,
    people: pd.DataFrame,
    companies: pd.DataFrame,
    history: typing.Mapping[str, tuple[str, str | None, bool]] | None = None,
) -> pd.DataFrame:
    """One row per company the site does not call public and someone works at.

    `nodes` and `edges` are the site's (`KorytaNodes`, `KorytaEdges`), `people`
    is `KorytaPeople`, `companies` is `Companies` and `history` is
    `owner_history`. A public owner held to the end comes first, then one that
    left earlier, then the rest with membership bodies last; most koryciarze
    first within each.
    """
    history = history or {}
    columns = [field.name for field in dataclasses.fields(LikelyPublic)]
    places = nodes[(nodes["type"] == "place") & nodes["krsNumber"].notna()]
    public_places = set(places.loc[is_public(places["isPublic"]), "id"])
    private = places[~places["id"].isin(public_places)]

    live = edges[~is_public(edges["deleted"])] if "deleted" in edges else edges
    employed = live[live["type"] == "employed"]
    politicians = set(live.loc[live["type"] == "election", "source"])

    people = people[people["merged_into"].isna()] if "merged_into" in people else people
    koryciarze = set(
        people.loc[
            is_public(people["is_public"])
            | (
                pd.to_numeric(people["votes_interesting"], errors="coerce") >= KORYCIARZ
            ),
            "id",
        ]
    )
    with_party = set(
        people.loc[
            people["parties"].map(lambda p: hasattr(p, "__len__") and len(p) > 0), "id"
        ]
    )
    political = politicians | with_party
    at_public = set(employed.loc[employed["target"].isin(public_places), "source"])
    known = set(people["id"])

    in_pipeline = set(
        companies.loc[is_public(companies["is_public"]), "krs"]
        .astype(str)
        .str.zfill(10)
    )

    staff = (
        employed[employed["source"].isin(known)]
        .drop_duplicates(["source", "target"])
        .groupby("target")["source"]
        .apply(set)
    )
    rows = []
    for place in private.itertuples():
        workers = staff.get(place.id, set())
        if not workers:
            continue
        krs = str(place.krsNumber).zfill(10)
        form = getattr(place, "legalForm", None)
        form = form if isinstance(form, str) else None
        owner, until, held = history.get(krs, (None, None, False))
        rows.append(
            LikelyPublic(
                krs=krs,
                node=str(place.id),
                # NaN, not None, is what a missing one is once pandas has it.
                name=place.name if isinstance(place.name, str) else None,
                legal_form=form,
                people=len(workers),
                koryciarze=len(workers & koryciarze),
                political=len(workers & koryciarze & political),
                also_public=len(workers & koryciarze & at_public),
                public_in_pipeline=krs in in_pipeline,
                public_owner=owner,
                public_owner_until=until,
                held_to_end=held,
                membership_body=bool(form and form.startswith(MEMBERSHIP_FORMS)),
            )
        )
    df = pd.DataFrame([dataclasses.asdict(row) for row in rows], columns=columns)
    named = df["public_owner"].notna()
    held = df["held_to_end"].astype(bool)
    membership = df["membership_body"].astype(bool)
    df["_rank"] = (
        (~held).astype(int) + (~named).astype(int) + (~named & membership).astype(int)
    )
    return (
        df.sort_values(
            ["_rank", "koryciarze", "people", "krs"],
            ascending=[True, False, False, True],
        )
        .drop(columns="_rank")
        .reset_index(drop=True)
    )


class CompaniesLikelyPublic(Pipeline[LikelyPublic]):
    """The site's not-public companies, by how many koryciarze work there."""

    filename = "companies_likely_public"
    dtype = {"krs": str, "node": str}

    nodes: KorytaNodes
    edges: KorytaEdges
    people: KorytaPeople
    companies: Companies
    seats: KrsOdpisSeats
    entries: KrsOdpisEntries
    jst: Jst

    @property
    def output_class(self):
        return LikelyPublic

    def preprocess_sources(self, ctx: Context, policy: ProcessPolicy) -> bool:
        """Read every source but the odpisy on file, which `process` reads.

        The seats raise PeselKeyMissing on a machine with no key and no copy to
        restore, the GitHub nightly's full tier, and a declared source is read
        before `process` could catch it. As `PeopleKRSCombined.preprocess_sources`.
        """
        refreshed = False
        for name, dep in self.dependencies.items():
            if name in ("seats", "entries"):
                continue
            dep.read_or_process(ctx)
            refreshed = refreshed or dep._refreshed_execution
        return refreshed

    def read_history(
        self, ctx: Context, companies: pd.DataFrame
    ) -> dict[str, tuple[str, str | None, bool]]:
        """`owner_history`, or nothing on a machine that cannot read the seats."""
        try:
            # The seats first: without the key they fail before any document
            # is read, and the entries would read every one of them.
            seats = self.seats.read_or_process(ctx)
        except PeselKeyMissing as missing:
            print(f"  [WARN] {missing} The leads go by people alone.")
            return {}
        return owner_history(
            seats,
            self.entries.read_or_process(ctx),
            getattr(self.jst, "index", None),
            public_company_names(companies),
        )

    def process(self, ctx: Context) -> pd.DataFrame:
        companies = self.companies.read_or_process(ctx)
        self.jst.read_or_process(ctx)
        history = self.read_history(ctx, companies)
        df = likely_public(
            self.nodes.read_or_process(ctx),
            self.edges.read_or_process(ctx),
            self.people.read_or_process(ctx),
            companies,
            history,
        )
        leads = df[(df["koryciarze"] >= KORYCIARZ) & ~df["public_in_pipeline"]]
        owned = df[df["public_owner"].notna() & ~df["public_in_pipeline"]]
        print(
            f"{len(df)} companies the site does not call public have someone on it; "
            f"{len(leads)} have {KORYCIARZ}+ koryciarze and are not public in the "
            f"pipeline either; the register names a public owner of {len(owned)}, "
            f"{int(owned['held_to_end'].sum())} of them held to the end"
        )
        return df
