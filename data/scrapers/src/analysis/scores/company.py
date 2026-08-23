"""The model the site started with: a person is as interesting as their employers.

We have source of truth from two sources:
node_id -> public - from KorytaPeople
node_id -> interesting - from KorytaVotes

We can additionally map
node_id to rejest_io_person_id using KorytaPeople to match them with their companies

We are therefore mapping the person scores to companies
and then try to spread it again to people

We output final scores along with the most recent votes we aggregated,
so the uplaoder can diff if we need/have to update the scores or not.
"""

import dataclasses
import typing

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from analysis.scores.base import IS_PUBLIC_SCORE, PeopleScoreModel, Population
from analysis.utils import as_sequence
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.stores import Context, Pipeline

# Penalize companies with not enough votes
CONFIDENCE_FACTOR = 2


@dataclasses.dataclass
class NormalizationFactors:
    min_score: int
    max_score: int


def normalized_scores(scores: pd.DataFrame, n: NormalizationFactors) -> pd.Series:
    """Normalize the score with min/max scores and adding a confidence factor."""
    if len(scores) == 0:
        return pd.Series({"score": 0})

    ratio = (
        scores["score"]
        .apply(lambda v: v / abs(n.min_score) if v < 0 else v / abs(n.max_score))
        .sum()
    ) / (len(scores) + CONFIDENCE_FACTOR)
    return pd.Series({"score": ratio})


def company_score_map(
    payloads: pd.DataFrame, person_scores: typing.Mapping[str, float]
) -> dict[str, float]:
    """KRS -> how the people in it are rated, from a person->score map.

    A parameter rather than the pipeline's own source because two callers need
    the same arithmetic over scores the pipeline has not got: the recall
    harness rebuilds it per fold so a held-out person cannot be graded on their
    own `is_public`, and `PeoplePayloads` rebuilds it from the population it is
    filtering, which is mid-run and cannot ask a pipeline built on itself.
    """
    records = []
    for _, row in payloads.iterrows():
        score = person_scores.get(row["name"], 0)
        if not score:
            continue

        for company in as_sequence(row.get("companies")):
            if isinstance(company, dict):
                krs = company.get("krs")
            else:
                krs = getattr(company, "krs", None)
            if krs:
                records.append({"krs": krs, "score": score})

    if not records:
        return {}

    df = pd.DataFrame.from_records(records)
    factors = NormalizationFactors(
        min_score=df["score"].min(), max_score=df["score"].max()
    )
    scored = df.groupby("krs", as_index=False)[["score"]].apply(
        lambda s: normalized_scores(s, factors)
    )
    return dict(zip(scored["krs"], scored["score"]))


class CompanyScores(Pipeline):
    filename = "company_scores"
    # Written zero-padded and only meaningful zero-padded. Without the pin a
    # restore from the shared cache re-infers the column as an integer and the
    # leading zeros are gone -- see scrapers/krs/columns.py for the two read
    # paths and why they disagree.
    dtype = {"krs": str}

    people_payloads: PeoplePayloads
    people_scored: KorytaPeople
    people_votes: KorytaVotes

    def get_person_names(self, ctx: Context) -> dict[str, str]:
        koryta_people_df = self.people_scored.read_or_process(ctx)
        return dict(zip(koryta_people_df["id"], koryta_people_df["full_name"]))

    def person_scores(
        self, ctx: Context, koryta_id_to_name: dict[str, str]
    ) -> dict[str, int]:
        # TODO use koryta_ids here instead of people names
        # names could lead to collisions
        scores = {}
        unknown_targets = 0

        for _, row in self.people_scored.read_or_process(ctx).iterrows():
            is_public = row.get("is_public", False)
            if pd.isna(is_public):
                is_public = False

            if is_public:
                scores[row["full_name"]] = IS_PUBLIC_SCORE

        for _, row in self.people_votes.read_or_process(ctx).iterrows():
            person_koryta_id = row.get("person_koryta_id")
            if pd.isna(person_koryta_id) or not str(person_koryta_id).strip():
                continue
            person_koryta_id = str(person_koryta_id)
            interesting = row.get("interesting", 0)

            # A vote can name a node this pipeline has no person for - a place,
            # or somebody deleted since the export - and that is the vote being
            # uninteresting here, not an error worth stopping a run over.
            name = koryta_id_to_name.get(person_koryta_id)
            if name is None:
                unknown_targets += 1
                continue

            # TODO we're overriding votes of multiple people right now
            current = scores.get(name, None)
            if current is not None:
                scores[name] = max(interesting, current)
            scores[name] = interesting

        if unknown_targets:
            print(f"Ignored {unknown_targets} votes on nodes that are not people")
        return scores

    def process(self, ctx: Context):
        person_names = self.get_person_names(ctx)
        scores = self.person_scores(ctx, person_names)
        people_df = self.people_payloads.read_or_process(ctx)

        by_krs = company_score_map(people_df, scores)
        if not by_krs:
            return pd.DataFrame(columns=["krs", "sum_score"])

        scores_df = pd.DataFrame(
            {"krs": list(by_krs.keys()), "sum_score": list(by_krs.values())}
        )
        return scores_df.sort_values(by="sum_score", ascending=False).reset_index(
            drop=True
        )


class PeopleScores(PeopleScoreModel):
    """A person's employers' ratings, plus how often they have stood for office.

    The site's first model, and still the default one: its votes are the ones
    stored under the bare `pipeline` uid, which is why the tag is not renamed
    to match the others. Renaming it would orphan every score already on the
    site behind a uid nothing writes to any more.
    """

    filename = "people_scores"
    model_tag = "pipeline"

    company_scores: CompanyScores

    #: How much of the verdict each half carries. Employers dominate because
    #: standing for office is common and public; being on the board of a
    #: company whose other board members are known is not.
    COMPANY_WEIGHT = 0.6
    ELECTION_WEIGHT = 0.4

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        company_scores_df = self.company_scores.read_or_process(ctx)
        company_score_map = dict(
            zip(company_scores_df["krs"], company_scores_df["sum_score"])
        )

        scores = {}
        for name in population.shortlist:
            posts = population.employments.get(name, [])
            company_score = self.total_company_score(posts, company_score_map)
            election_score = self.elections_score(population.candidacies.get(name, []))
            scores[name] = self.calculate_weighted(
                (company_score, self.COMPANY_WEIGHT),
                (election_score, self.ELECTION_WEIGHT),
            )
        return scores

    def calculate_weighted(self, *args: tuple[float, float]):
        result: float = 0
        weights: float = 0
        for value, weight in args:
            assert value < 1.1 and value >= -1.1, f"Invalid value: {value}"
            result += value * weight
            weights += weight
        return result / weights

    def total_company_score(self, posts, company_score_map):
        if not posts:
            return 0.0
        total_person_score: float = 0
        for post in posts:
            if post.krs in company_score_map:
                total_person_score += company_score_map[post.krs]
        return total_person_score / len(posts)

    def elections_score(self, candidacies):
        return 1 - (2 / 3) ** len(candidacies)
