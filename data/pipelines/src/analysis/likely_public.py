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
"""

import dataclasses

import pandas as pd

from analysis.interesting import Companies
from scrapers.koryta.download import KorytaEdges, KorytaNodes, KorytaPeople
from scrapers.krs.columns import is_public
from scrapers.stores import Context, Pipeline

#: The score the site's vote ladder calls "Koryciarz" - see `scaleLabels` in
#: frontend/app/composables/votes.ts. A published page counts the same.
KORYCIARZ = 3


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


def likely_public(
    nodes: pd.DataFrame,
    edges: pd.DataFrame,
    people: pd.DataFrame,
    companies: pd.DataFrame,
) -> pd.DataFrame:
    """One row per company the site does not call public and someone works at.

    `nodes` and `edges` are the site's (`KorytaNodes`, `KorytaEdges`), `people`
    is `KorytaPeople` and `companies` is `Companies`. Most koryciarze first.
    """
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
        rows.append(
            LikelyPublic(
                krs=krs,
                node=str(place.id),
                # NaN, not None, is what a missing one is once pandas has it.
                name=place.name if isinstance(place.name, str) else None,
                legal_form=form if isinstance(form, str) else None,
                people=len(workers),
                koryciarze=len(workers & koryciarze),
                political=len(workers & koryciarze & political),
                also_public=len(workers & koryciarze & at_public),
                public_in_pipeline=krs in in_pipeline,
            )
        )
    df = pd.DataFrame([dataclasses.asdict(row) for row in rows], columns=columns)
    return df.sort_values(
        ["koryciarze", "people", "krs"], ascending=[False, False, True]
    ).reset_index(drop=True)


class CompaniesLikelyPublic(Pipeline[LikelyPublic]):
    """The site's not-public companies, by how many koryciarze work there."""

    filename = "companies_likely_public"
    dtype = {"krs": str, "node": str}

    nodes: KorytaNodes
    edges: KorytaEdges
    people: KorytaPeople
    companies: Companies

    @property
    def output_class(self):
        return LikelyPublic

    def process(self, ctx: Context) -> pd.DataFrame:
        df = likely_public(
            self.nodes.read_or_process(ctx),
            self.edges.read_or_process(ctx),
            self.people.read_or_process(ctx),
            self.companies.read_or_process(ctx),
        )
        leads = df[(df["koryciarze"] >= KORYCIARZ) & ~df["public_in_pipeline"]]
        print(
            f"{len(df)} companies the site does not call public have someone on it; "
            f"{len(leads)} have {KORYCIARZ}+ koryciarze and are not public in the "
            "pipeline either"
        )
        return df
