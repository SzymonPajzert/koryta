"""The chance that a person's page gets published.

Decision on 2026-11-20: the pipeline's part of a person's score is this chance,
not the best of the other models, which stay on the page as the reasons. The
other models were built to find people a reader would find interesting; what
the queue needs is the people we will find enough on to publish, and on that
the best of them ranked people at AUC 0.71 where a few facts about the person
reach 0.95.

The facts are read off the site's own export, the same graph the publishing
rules read: whether the person won a seat and when, whether they hold a paid
public post, whether that post is where they stood. A logistic model weighs
them, fitted by `scripts/fit_publish_chance.py` on the people unjudged at one
export and published by a later one. Refit it when the publishing routes change
pace; the weights below are its output and nothing else.
"""

import dataclasses
import math
import typing

import pandas as pd

from analysis.bip_people_of_interest import (
    pages_with_a_public_post,
)
from analysis.scores.base import PeopleScoreModel, Population
from scrapers.koryta.download import CURRENT_DATE, KorytaEdges, KorytaNodes
from scrapers.krs.columns import flag
from scrapers.stores import Context

#: The offices of a local election, as the site's candidacy edges name them.
LOCAL_OFFICES = frozenset(
    {
        "Rada gminy",
        "Rada miasta",
        "Rada powiatu",
        "Rada dzielnicy",
        "Wójt",
        "Burmistrz",
        "Prezydent",
        "Samorząd",
    }
)

#: How many local candidacies a year needs to be a general local election
#: rather than a by-election: thousands against tens.
GENERAL_ELECTION_CANDIDACIES = 1000

#: Years since the last candidacy stop mattering here; somebody who never stood
#: counts as this long ago.
MAX_YEARS_SINCE_STOOD = 25

#: TERYT digits naming a powiat: as deep as a candidacy is recorded.
POWIAT_DIGITS = 4

#: Fitted on 2026-11-20 by `scripts/fit_publish_chance.py --anchor 2026-11-11
#: --until 2026-11-20`: 19,560 people unjudged on 11-11, 820 published by 11-20,
#: AUC 0.957 five-fold. Log-odds per unit of each feature in
#: `PublishFacts.features`.
WEIGHTS: dict[str, float] = {
    "won_local": 1.768,
    "won_latest_local": 0.238,
    "paid_post": 4.225,
    "years_since_stood": -0.182,
    "on_a_list_or_party": 0.361,
    "rada_spoleczna_only": -1.792,
    "stood_where_works": 1.221,
    "log_candidacies": -1.559,
    "log_wins": 1.457,
}
INTERCEPT = -6.959

#: The chance each band starts at (decision on 2026-11-20). On the fitting
#: cohort 40 % of band 5 and 22 % of band 4 were published within nine days,
#: and the two held 92 % of everybody published.
CHANCE_BANDS: tuple[tuple[float, int], ...] = (
    (0.30, 5),
    (0.10, 4),
    (0.03, 3),
    (0.01, 2),
)


@dataclasses.dataclass(frozen=True)
class PublishFacts:
    """What the publishing rules look at, for one person page."""

    candidacies: int = 0
    wins: int = 0
    won_local: bool = False
    #: Won a seat at the newest general local election in the export.
    won_latest_local: bool = False
    #: Years since the newest candidacy, `MAX_YEARS_SINCE_STOOD` if none.
    years_since_stood: int = MAX_YEARS_SINCE_STOOD
    #: Stood on any list, or the page names a party. Nearly every candidacy
    #: carries its committee, so this is mostly "ever stood".
    on_a_list_or_party: bool = False
    #: A paid post at a public company, current or ended (the site's rule).
    paid_post: bool = False
    #: Public posts, all of them unpaid rada społeczna seats.
    rada_spoleczna_only: bool = False
    #: A post at a company seated where one of the candidacies was run.
    stood_where_works: bool = False

    def features(self) -> dict[str, float]:
        return {
            "won_local": float(self.won_local),
            "won_latest_local": float(self.won_latest_local),
            "paid_post": float(self.paid_post),
            "years_since_stood": float(self.years_since_stood),
            "on_a_list_or_party": float(self.on_a_list_or_party),
            "rada_spoleczna_only": float(self.rada_spoleczna_only),
            "stood_where_works": float(self.stood_where_works),
            "log_candidacies": math.log1p(self.candidacies),
            "log_wins": math.log1p(self.wins),
        }


def chance(
    facts: PublishFacts,
    weights: typing.Mapping[str, float] = WEIGHTS,
    intercept: float = INTERCEPT,
) -> float:
    """The fitted chance that this page gets published."""
    features = facts.features()
    logit = intercept + sum(weights[name] * features[name] for name in weights)
    return 1.0 / (1.0 + math.exp(-logit))


def chance_band(value: float) -> int:
    """The 1-5 band a chance falls in; 1 below the lowest cut-off."""
    for floor, band in CHANCE_BANDS:
        if value >= floor:
            return band
    return 1


def year_of(value: typing.Any) -> int | None:
    text = str(value or "")[:4]
    return int(text) if text.isdigit() else None


def region_code(node_id: typing.Any) -> str | None:
    """The TERYT code a region node's id spells: `teryt1465` is 1465."""
    text = str(node_id or "")
    if not text.startswith("teryt"):
        return None
    return text[len("teryt") :] or None


def same_place(candidacy: str | None, seat: str | None) -> bool:
    """Whether a candidacy's region and a company's seat nest, down to the powiat."""
    if not candidacy or not seat:
        return False
    stood, seated = candidacy[:POWIAT_DIGITS], seat[:POWIAT_DIGITS]
    return stood.startswith(seated) or seated.startswith(stood)


def site_facts(
    nodes: pd.DataFrame, edges: pd.DataFrame, as_of_year: int
) -> dict[str, PublishFacts]:
    """`PublishFacts` for every person page in an export, keyed by node id.

    `nodes` and `edges` are the export as `KorytaNodes` and `KorytaEdges` read
    it; a removed edge counts for nothing. A person with no edge at all is
    still a page, with every fact at its default.
    """
    live = edges[~flag(edges["deleted"])] if "deleted" in edges else edges
    people = nodes.loc[nodes["type"] == "person"]
    places = nodes.loc[nodes["type"] == "place"]
    public = set(places.loc[flag(places["isPublic"]), "id"].astype(str))
    paid = pages_with_a_public_post(nodes, edges)

    seats: dict[str, str] = {}
    for region, place in live.loc[
        live["type"] == "seat", ["source", "target"]
    ].itertuples(index=False):
        code = region_code(region)
        # The most specific region claiming a company is its seat.
        if code and len(code) > len(seats.get(str(place), "")):
            seats[str(place)] = code

    candidacies = live.loc[live["type"] == "election"].assign(
        year=lambda df: df["start_date"].map(year_of),
        won=lambda df: flag(df["elected"]),
        local=lambda df: df["position"].isin(LOCAL_OFFICES),
        listed=lambda df: (
            df["committee"].fillna("").astype(str).str.strip().ne("")
            | df["party"].fillna("").astype(str).str.strip().ne("")
        ),
    )
    local_years = candidacies.loc[candidacies["local"], "year"].value_counts()
    general = local_years[local_years >= GENERAL_ELECTION_CANDIDACIES]
    latest_local = int(general.index.max()) if len(general) else None

    stood: dict[str, list[tuple[str | None, int | None, bool, bool, bool]]] = {}
    for row in candidacies.itertuples(index=False):
        stood.setdefault(str(row.source), []).append(
            (
                region_code(row.target),
                year_of(row.start_date),
                bool(row.won),
                bool(row.local),
                bool(row.listed),
            )
        )
    posts: dict[str, list[tuple[str, typing.Any]]] = {}
    for source, target, role in live.loc[
        live["type"] == "employed", ["source", "target", "name"]
    ].itertuples(index=False):
        posts.setdefault(str(source), []).append((str(target), role))

    facts: dict[str, PublishFacts] = {}
    for person, parties in people[["id", "parties"]].itertuples(index=False):
        person = str(person)
        runs = stood.get(person, [])
        jobs = posts.get(person, [])
        years = [year for _, year, _, _, _ in runs if year]
        regions = [region for region, _, _, _, _ in runs if region]
        public_posts = [place for place, _ in jobs if place in public]
        facts[person] = PublishFacts(
            candidacies=len(runs),
            wins=sum(1 for _, _, won, _, _ in runs if won),
            won_local=any(won and local for _, _, won, local, _ in runs),
            won_latest_local=latest_local is not None
            and any(
                won and local and year == latest_local
                for _, year, won, local, _ in runs
            ),
            years_since_stood=min(
                max(as_of_year - max(years), 0), MAX_YEARS_SINCE_STOOD
            )
            if years
            else MAX_YEARS_SINCE_STOOD,
            on_a_list_or_party=any(listed for *_, listed in runs)
            or names_a_party(parties),
            paid_post=person in paid,
            rada_spoleczna_only=bool(public_posts) and person not in paid,
            stood_where_works=any(
                same_place(region, seats.get(place))
                for place, _ in jobs
                for region in regions
            ),
        )
    return facts


def names_a_party(parties: typing.Any) -> bool:
    """Whether a page's `parties` field names any party, whatever shape it came in."""
    if parties is None or isinstance(parties, float):
        return False
    if isinstance(parties, str):
        return parties.strip() not in ("", "[]")
    try:
        return any(str(party).strip() for party in parties)
    except TypeError:
        return False


class PeopleScoresPublishable(PeopleScoreModel):
    filename = "people_scores_publishable"
    model_tag = "pipeline-publishable"

    koryta_nodes: KorytaNodes
    koryta_edges: KorytaEdges

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        facts = site_facts(
            self.koryta_nodes.read_or_process(ctx),
            self.koryta_edges.read_or_process(ctx),
            as_of_year=int(CURRENT_DATE[:4]),
        )
        scores = {}
        for key in population.shortlist:
            # A page created since the export has no edges in it yet; it waits
            # for the next export rather than being scored as a blank.
            node = population.node_ids.get(key)
            if node in facts:
                scores[key] = chance(facts[node])
        print(
            f"{len(scores)} people scored; "
            + ", ".join(
                f"{sum(1 for v in scores.values() if chance_band(v) == band)} at {band}"
                for band in (5, 4, 3, 2, 1)
            )
        )
        return scores

    def bands(self, raw: typing.Mapping[str, float]) -> dict[str, int]:
        """By the chance itself rather than by rank: a 5 means at least 30 %."""
        return {key: chance_band(value) for key, value in raw.items()}
