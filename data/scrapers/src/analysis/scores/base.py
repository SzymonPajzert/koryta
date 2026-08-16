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


def rejestr_io_id(value: typing.Any) -> str | None:
    """The person id in a rejestr.io profile link, if there is one.

    Both sides store the whole URL (`https://rejestr.io/osoby/312837`), some of
    them with a trailing slash, so compare the id rather than the string. Takes
    `Any` because the value arrives from a DataFrame, where a missing entry is
    NaN rather than None.
    """
    if not isinstance(value, str):
        return None
    ident = value.strip().rstrip("/").rsplit("/", 1)[-1]
    return ident if ident.isdigit() else None


def person_key(rejestr_io: typing.Any, name: typing.Any) -> str:
    """What identifies one person across the payloads and the site.

    rejestr.io's id where there is one, and the name otherwise. The name alone
    used to be the whole key, and it loses people at both ends: KRS spells out
    a middle name where PKW does not, so `Kacper Karol Pietrusinski` and
    `Kacper Pietrusinski` never met, and conversely two people who share a
    common name were merged into one score.

    The id form carries the `rejestr.io/` prefix and the name form is the bare
    name, so everybody without a link keys exactly as they did before this and
    no join that works today changes. Nobody is called `rejestr.io/312837`, so
    the two forms cannot collide.
    """
    ident = rejestr_io_id(rejestr_io)
    return f"rejestr.io/{ident}" if ident else str(name)


@dataclasses.dataclass
class Population:
    """Everyone a model can see, and what the site already thinks of them.

    Keyed by `person_key` throughout - rejestr.io's person id where both the
    payloads and the site's own node carry one, and the bare name where either
    does not. Around a sixth of nodes have no rejestr.io link, so the name
    fallback is still load-bearing and still inherits the collisions the
    existing `CompanyScores` TODO describes; it just no longer decides the join
    for everybody.

    The population is whatever the payload run covered. `Extract` filters by
    region unless asked for everything, so a regional run gives a regional
    graph: someone whose only tie to a known face runs through a company in the
    next voivodeship is invisible to it. That is the same horizon the current
    model has, not a new limitation.
    """

    #: Payload rows, one per person, in payload order.
    people: pd.DataFrame
    #: Person key -> koryta node id. Only people the site already has a node
    #: for; a model cannot vote on anybody else.
    node_ids: dict[str, str]
    #: Person key -> posts held, in payload order.
    employments: dict[str, list[Employment]]
    #: Person key -> candidacies stood.
    candidacies: dict[str, list[Candidacy]]
    #: KRS -> everybody the payloads put in that company.
    roster: dict[str, list[str]]
    #: KRS -> what the KRS register says about the company.
    companies: dict[str, CompanyFacts]
    #: Person key -> how firmly the site has already judged them. Positive for
    #: a published page or an upvote, negative for a downvote, absent for the
    #: unexamined. This is the ground truth the models generalise from, so it
    #: counts humans only - seeding a model on the pipeline's own past votes
    #: would just teach it to repeat itself.
    seed_weights: dict[str, float]
    #: The people eligible for a score: known to the site, not published, and
    #: not yet voted on by a human. Rating anybody else is telling somebody
    #: something they already know.
    shortlist: list[str]
    #: Person key -> the name the site shows, for the score rows a run writes.
    #: The site's spelling rather than the payload's, because that is what a
    #: reader comparing the two will have in front of them.
    names: dict[str, str] = dataclasses.field(default_factory=dict)

    def seeds(self, sign: int = 1) -> dict[str, float]:
        """Confirmed people whose judgement went the given way, weight positive."""
        return {
            key: abs(weight)
            for key, weight in self.seed_weights.items()
            if weight * sign > 0
        }

    def has_candidacy(self, key: str) -> bool:
        return bool(self.candidacies.get(key))

    def display_name(self, key: str) -> str:
        """What to call this person in the output.

        Every key a run scores comes from a koryta row, so `names` has it; the
        fallback is for a caller assembling a `Population` by hand.
        """
        return self.names.get(key) or key


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
        """This model's opinion, on whatever scale suits it, keyed by person key.

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
            {key: score for key, score in raw.items() if key in eligible}
        )

        records = [
            dataclasses.asdict(
                PersonScore(
                    node_id=population.node_ids[key],
                    name=population.display_name(key),
                    score=score,
                    model=self.model_tag,
                )
            )
            for key, score in banded.items()
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
        people = self.people_payloads.read_or_process(ctx)
        koryta = self.people_koryta.read_or_process(ctx)
        votes = self.people_votes.read_or_process(ctx)
        companies = self.companies_krs.read_or_process(ctx)

        human_votes = self.human_votes(votes, koryta)

        employments: dict[str, list[Employment]] = {}
        candidacies: dict[str, list[Candidacy]] = {}
        roster: dict[str, list[str]] = {}
        # Both ways of naming a payload row, so a koryta node can be matched on
        # whichever of the two it carries. Where two payload rows share a name
        # the first wins it; keying on the name alone used to leave the last
        # one standing instead. Both are arbitrary and only a node with no
        # rejestr.io link is decided by it - anybody who has one is matched on
        # the id before the name is consulted.
        keys_by_rejestr: dict[str, str] = {}
        keys_by_name: dict[str, str] = {}

        for _, row in people.iterrows():
            name = str(row.get("name"))
            key = person_key(row.get("rejestrIo"), name)
            ident = rejestr_io_id(row.get("rejestrIo"))
            if ident:
                keys_by_rejestr.setdefault(ident, key)
            keys_by_name.setdefault(name, key)

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
            employments[key] = posts
            for post in posts:
                roster.setdefault(post.krs, []).append(key)

            candidacies[key] = [
                Candidacy(
                    year=election.get("election_year"),
                    teryt=election.get("teryt"),
                    party=election.get("party"),
                    committee=election.get("committee"),
                )
                for election in iter_dicts(row.get("elections"))
            ]

        def key_of(entry) -> str:
            """The payload row this koryta node is, by id and then by name.

            The name is still tried, and has to be: a node written before the
            site started recording rejestr.io links has no id to match on.
            """
            ident = rejestr_io_id(entry.get("rejestr_io"))
            if ident and ident in keys_by_rejestr:
                return keys_by_rejestr[ident]
            name = str(entry.get("full_name"))
            if name in keys_by_name:
                return keys_by_name[name]
            return person_key(entry.get("rejestr_io"), name)

        node_ids: dict[str, str] = {}
        names: dict[str, str] = {}
        seed_weights: dict[str, float] = {}
        shortlist: list[str] = []
        for _, entry in koryta.iterrows():
            key = key_of(entry)
            node_ids[key] = str(entry.get("id"))
            names[key] = str(entry.get("full_name"))

            is_public = entry.get("is_public", False)
            if pd.isna(is_public):
                is_public = False

            vote = human_votes.get(str(entry.get("id")), 0.0)
            if is_public:
                seed_weights[key] = max(seed_weights.get(key, 0.0), IS_PUBLIC_SCORE)
            elif vote:
                seed_weights[key] = vote
            elif key in employments:
                shortlist.append(key)

        return Population(
            people=people,
            node_ids=node_ids,
            employments=employments,
            candidacies=candidacies,
            roster=roster,
            companies=self.company_facts(companies),
            seed_weights=seed_weights,
            shortlist=shortlist,
            names=names,
        )

    @staticmethod
    def human_votes(votes: pd.DataFrame, koryta: pd.DataFrame) -> dict[str, float]:
        """Node id -> the sum of what people voted on it.

        `KorytaPeople.votes_interesting` would be the obvious source and is the
        wrong one: it is the site's own aggregate, which includes the
        pipeline's vote. A model seeded on it would be seeded on its own output
        and, worse, `shortlist` would drop everybody the pipeline had ever
        scored, so no run after the first could revise a score.
        """
        if votes.empty or "person_koryta_id" not in votes:
            return {}
        totals: dict[str, float] = {}
        for _, row in votes.iterrows():
            target = row.get("person_koryta_id")
            interesting = row.get("interesting")
            # NaN rather than a blank is what a vote with no node on it looks
            # like once pandas has been through it, and NaN is truthy - see
            # `KorytaVotes.process`, which is where those get dropped now.
            if pd.isna(target) or interesting is None or pd.isna(interesting):
                continue
            node_id = str(target).strip()
            if not node_id:
                continue
            totals[node_id] = totals.get(node_id, 0.0) + float(interesting)
        return totals

    @staticmethod
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
