"""What every model that rates a person has in common.

A scoring model answers one question: of the people the pipeline knows about
and the site has not looked at yet, which should somebody open next? Each model
answers it from a different angle, and each writes its answer as a vote under
its own `userUid` - `pipeline-pagerank`, `pipeline-together` and so on. The
frontend treats any uid containing "pipeline" as non-human and takes the best
of them, so a model that is wrong about somebody costs a wasted click rather
than a corrupted aggregate.

Two things are shared here rather than left to each model. `Population` unpacks
the payloads once into the shapes the models actually want (who works where,
who stood for what, who sits on which board), because four models re-deriving
that from raw payload rows would be four chances to disagree about what a
missing KRS means. And `banded_scores` puts every model on the same 1-5 scale
by rank, not by value: raw model outputs are on wildly different scales - a
PageRank mass is ~1e-5, a co-appointment count is an integer - and with the
frontend taking the maximum across models, whichever model scaled itself most
generously would otherwise win every tie.
"""

import dataclasses
import typing

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from entities.composite import PersonScore
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.krs.list import CompaniesKRS
from scrapers.stores import Context, Pipeline

#: How strongly a published page counts as "we already decided this one is
#: interesting". A page gets published after a human wrote it up, so it is
#: firmer evidence than a single passing vote but weaker than a maximal one.
IS_PUBLIC_SCORE = 3

#: The percentile a raw score has to reach to earn each point of the 1-5 scale,
#: highest band first. Deliberately not even fifths: the point of a score is to
#: order a queue, and a queue where a fifth of everybody is a 5 orders nothing.
SCORE_BANDS: tuple[tuple[float, int], ...] = (
    (0.99, 5),
    (0.95, 4),
    (0.85, 3),
    (0.60, 2),
    (0.0, 1),
)


def iter_dicts(value: typing.Any) -> typing.Iterator[dict]:
    """The dict entries of a payload list column, whatever pandas made of it.

    The same column arrives as a list of dataclass-dicts when the payloads were
    built in this process and as a list of plain dicts when they were read back
    from jsonl, and as a float NaN when the person had none.
    """
    if value is None or isinstance(value, float):
        return
    if not hasattr(value, "__iter__") or isinstance(value, (str, bytes)):
        return
    for item in value:
        if isinstance(item, dict):
            yield item


@dataclasses.dataclass
class Employment:
    krs: str
    role: str | None
    start: str | None
    end: str | None


@dataclasses.dataclass
class Candidacy:
    year: str | None
    teryt: str | None
    party: str | None
    committee: str | None


@dataclasses.dataclass
class CompanyFacts:
    name: str | None
    teryt: str | None
    is_public: bool


@dataclasses.dataclass
class Population:
    """Everyone a model can see, and what the site already thinks of them.

    Keyed by person name throughout, which is what `PeoplePayloads` and the
    site's own nodes are joined on today. Names collide - the existing
    `CompanyScores` carries a TODO saying so - and until the payloads carry the
    koryta node id, a model inherits that.

    The population is whatever the payload run covered. `Extract` filters by
    region unless asked for everything, so a regional run gives a regional
    graph: someone whose only tie to a known face runs through a company in the
    next voivodeship is invisible to it. That is the same horizon the current
    model has, not a new limitation.
    """

    #: Payload rows, one per person, in payload order.
    people: pd.DataFrame
    #: Person name -> koryta node id. Only people the site already has a node
    #: for; a model cannot vote on anybody else.
    node_ids: dict[str, str]
    #: Person name -> posts held, in payload order.
    employments: dict[str, list[Employment]]
    #: Person name -> candidacies stood.
    candidacies: dict[str, list[Candidacy]]
    #: KRS -> everybody the payloads put in that company.
    roster: dict[str, list[str]]
    #: KRS -> what the KRS register says about the company.
    companies: dict[str, CompanyFacts]
    #: Person name -> how firmly the site has already judged them. Positive for
    #: a published page or an upvote, negative for a downvote, absent for the
    #: unexamined. This is the ground truth the models generalise from, so it
    #: counts humans only - seeding a model on the pipeline's own past votes
    #: would just teach it to repeat itself.
    seed_weights: dict[str, float]
    #: The people eligible for a score: known to the site, not published, and
    #: not yet voted on by a human. Rating anybody else is telling somebody
    #: something they already know.
    shortlist: list[str]

    def seeds(self, sign: int = 1) -> dict[str, float]:
        """Confirmed people whose judgement went the given way, weight positive."""
        return {
            name: abs(weight)
            for name, weight in self.seed_weights.items()
            if weight * sign > 0
        }

    def has_candidacy(self, name: str) -> bool:
        return bool(self.candidacies.get(name))

    def with_shortlist(self, names: typing.Iterable[str]) -> "Population":
        """The same population, asked about these people instead.

        Whoever the caller names, the already-judged are dropped from the
        shortlist: a seed is the answer key, and a model that scored one would
        be marking its own homework. Duplicates go with them - the site's
        export is read twice on a day it was dumped twice, and a name rated
        twice is rated no differently.
        """
        return dataclasses.replace(
            self,
            shortlist=[
                name for name in dict.fromkeys(names) if name not in self.seed_weights
            ],
        )


def banded_scores(raw: typing.Mapping[str, float]) -> dict[str, int]:
    """Put a model's raw output on the shared 1-5 scale.

    By rank, so the shape of the raw distribution does not matter: PageRank
    masses are a power law and co-appointment counts are small integers with
    ties everywhere, and both need to come out as a usable shortlist. People
    scoring zero or less are dropped rather than banded - a model saying
    nothing about somebody is not a vote.
    """
    series = pd.Series(raw, dtype="float64")
    positive = series[series > 0]
    if positive.empty:
        return {}

    percentile = positive.rank(pct=True, method="average")

    def band(value: float) -> int:
        for floor, points in SCORE_BANDS:
            if value >= floor:
                return points
        return 1

    return {str(name): band(value) for name, value in percentile.items()}


class PeopleScoreModel(Pipeline):
    """A model that nominates people to look at next.

    Subclasses set `filename` and `model_tag` and implement `raw_scores`. The
    base handles who is eligible, the 1-5 banding and the output shape.
    """

    #: The `userUid` this model's votes are stored under. Anything containing
    #: "pipeline" reads as non-human to the frontend; the tag after it is what
    #: tells two models apart in `stats.votes.models`.
    model_tag: str = "pipeline"

    people_payloads: PeoplePayloads
    people_koryta: KorytaPeople
    people_votes: KorytaVotes
    companies_krs: CompaniesKRS

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        """This model's opinion, on whatever scale suits it, keyed by name.

        Scores for people outside the shortlist are ignored, so a model is free
        to compute over everybody - the graph models have to.
        """
        raise NotImplementedError

    def process(self, ctx: Context):
        population = self.population(ctx)
        print(
            f"{type(self).__name__}: {len(population.people)} people, "
            f"{len(population.seeds())} positive seeds, "
            f"{len(population.seeds(-1))} negative, "
            f"{len(population.shortlist)} on the shortlist"
        )

        raw = self.raw_scores(ctx, population)
        eligible = set(population.shortlist)
        banded = banded_scores(
            {name: score for name, score in raw.items() if name in eligible}
        )

        records = [
            dataclasses.asdict(
                PersonScore(
                    node_id=population.node_ids[name],
                    name=name,
                    score=score,
                    model=self.model_tag,
                )
            )
            for name, score in banded.items()
        ]
        if not records:
            print(f"{type(self).__name__} found nobody to score")
            return pd.DataFrame(columns=["node_id", "name", "score", "model"])

        df = pd.DataFrame.from_records(records)
        df = df.sort_values(by="score", ascending=False).reset_index(drop=True)
        print(f"{type(self).__name__} scored {len(df)} people")
        print(df["score"].value_counts().sort_index(ascending=False))
        return df.astype({"score": "int32"})

    def population(self, ctx: Context) -> Population:
        return population_from(
            people=self.people_payloads.read_or_process(ctx),
            koryta=self.people_koryta.read_or_process(ctx),
            votes=self.people_votes.read_or_process(ctx),
            companies=self.companies_krs.read_or_process(ctx),
        )


def population_from(
    people: pd.DataFrame,
    koryta: pd.DataFrame,
    votes: pd.DataFrame,
    companies: pd.DataFrame,
) -> Population:
    """The population, from the four frames it is unpacked out of.

    Taken apart from the pipeline that usually reads them because the payloads
    are not always on disk when somebody wants them scored: `PeoplePayloads`
    rates the frame it has just built, in the same process, and asking a
    pipeline for it there would rebuild it underneath the run doing the rating.
    """
    node_ids = dict(zip(koryta["full_name"], koryta["id"]))
    votes_by_node = human_votes(votes)

    employments: dict[str, list[Employment]] = {}
    candidacies: dict[str, list[Candidacy]] = {}
    roster: dict[str, list[str]] = {}

    for _, row in people.iterrows():
        name = str(row.get("name"))
        posts = [
            Employment(
                krs=str(company["krs"]),
                role=company.get("role"),
                start=company.get("start"),
                end=company.get("end"),
            )
            for company in iter_dicts(row.get("companies"))
            if company.get("krs")
        ]
        employments[name] = posts
        for post in posts:
            roster.setdefault(post.krs, []).append(name)

        candidacies[name] = [
            Candidacy(
                year=election.get("election_year"),
                teryt=election.get("teryt"),
                party=election.get("party"),
                committee=election.get("committee"),
            )
            for election in iter_dicts(row.get("elections"))
        ]

    seed_weights: dict[str, float] = {}
    shortlist: list[str] = []
    for _, entry in koryta.iterrows():
        name = str(entry.get("full_name"))
        is_public = entry.get("is_public", False)
        if pd.isna(is_public):
            is_public = False

        vote = votes_by_node.get(str(entry.get("id")), 0.0)
        if is_public:
            seed_weights[name] = max(seed_weights.get(name, 0.0), IS_PUBLIC_SCORE)
        elif vote:
            seed_weights[name] = vote
        elif name in employments:
            shortlist.append(name)

    return Population(
        people=people,
        node_ids=node_ids,
        employments=employments,
        candidacies=candidacies,
        roster=roster,
        companies=company_facts(companies),
        seed_weights=seed_weights,
        shortlist=shortlist,
    )


def human_votes(votes: pd.DataFrame) -> dict[str, float]:
    """Node id -> the sum of what people voted on it.

    `KorytaPeople.votes_interesting` would be the obvious source and is the
    wrong one: it is the site's own aggregate, which includes the pipeline's
    vote. A model seeded on it would be seeded on its own output and, worse,
    `shortlist` would drop everybody the pipeline had ever scored, so no run
    after the first could revise a score.
    """
    if votes.empty or "person_koryta_id" not in votes:
        return {}
    totals: dict[str, float] = {}
    for _, row in votes.iterrows():
        target = row.get("person_koryta_id")
        interesting = row.get("interesting")
        # NaN rather than a blank is what a vote with no node on it looks like
        # once pandas has been through it, and NaN is truthy - see
        # `KorytaVotes.process`, which is where those get dropped now.
        if pd.isna(target) or interesting is None or pd.isna(interesting):
            continue
        node_id = str(target).strip()
        if not node_id:
            continue
        totals[node_id] = totals.get(node_id, 0.0) + float(interesting)
    return totals


def company_facts(companies: pd.DataFrame) -> dict[str, CompanyFacts]:
    if companies.empty or "krs" not in companies:
        return {}
    facts = {}
    for _, row in companies.iterrows():
        krs = row.get("krs")
        if not krs or pd.isna(krs):
            continue
        is_public = row.get("is_public", False)
        facts[str(krs)] = CompanyFacts(
            name=row.get("name"),
            teryt=str(row["teryt_code"]) if row.get("teryt_code") else None,
            is_public=bool(is_public) if not pd.isna(is_public) else False,
        )
    return facts
