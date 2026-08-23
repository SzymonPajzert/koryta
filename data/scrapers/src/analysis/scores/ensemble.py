"""What all five models together say about a person.

Each model in `analysis.scores` writes its own vote and the site takes the best
of them, because somebody the co-appointment model has nothing to say about may
be exactly the one PageRank found. Anything that needs one number per person -
the `--min-score` filter on the payloads, the recall harness that grades the
models - has to do that same best-of-five, and doing it twice would let the two
drift apart.

`PeopleScores` is the awkward one. It reads its company scores off a pipeline
that is itself built from the payloads, so asking for it by pipeline while the
payloads are being built would rebuild them underneath the run doing the
asking. Its company scores are recomputed here from the population's own seeds
instead, which is what `CompanyScores` does with them anyway.
"""

import typing

import pandas as pd

from analysis.scores import PEOPLE_SCORE_MODELS
from analysis.scores.base import (
    SCORE_BANDS,
    PeopleScoreModel,
    Population,
    banded_scores,
    population_from,
)
from analysis.scores.company import PeopleScores, company_score_map
from scrapers.stores import Context, Pipeline

#: What the site's own judgement is worth on the models' scale. A page somebody
#: published or a person somebody upvoted is not a nomination to be ranked
#: against nominations; it is the thing the models are trying to predict.
CONFIRMED_BAND = max(points for _, points in SCORE_BANDS)


def people_scores_raw(
    model: PeopleScores, population: Population, payloads: pd.DataFrame
) -> dict[str, float]:
    """`PeopleScores.raw_scores`, over company scores built here.

    Same two halves in the same proportion - the employers' ratings and how
    often the person has stood for office - off a company map rebuilt from this
    population's positive seeds rather than read from `CompanyScores`.
    """
    companies = company_score_map(payloads, population.seeds())

    def score(name: str) -> float:
        posts = population.employments.get(name, [])
        return model.calculate_weighted(
            (model.total_company_score(posts, companies), model.COMPANY_WEIGHT),
            (
                model.elections_score(population.candidacies.get(name, [])),
                model.ELECTION_WEIGHT,
            ),
        )

    return {name: score(name) for name in population.shortlist}


def model_bands(
    model: PeopleScoreModel,
    ctx: Context,
    population: Population,
    payloads: pd.DataFrame,
) -> dict[str, int]:
    """One model's 1-5 verdict on this population's shortlist."""
    if isinstance(model, PeopleScores):
        raw = people_scores_raw(model, population, payloads)
    else:
        raw = model.raw_scores(ctx, population)

    eligible = set(population.shortlist)
    return banded_scores({name: s for name, s in raw.items() if name in eligible})


def best_bands(
    ctx: Context,
    population: Population,
    payloads: pd.DataFrame,
    models: typing.Sequence[PeopleScoreModel],
) -> dict[str, int]:
    """The best band any of `models` gave each person on the shortlist."""
    best: dict[str, int] = {}
    for model in models:
        bands = model_bands(model, ctx, population, payloads)
        print(f"  {model.model_tag:<22} rated {len(bands)}")
        for name, band in bands.items():
            best[name] = max(best.get(name, 0), band)
    return best


def score_payloads(
    ctx: Context,
    payloads: pd.DataFrame,
    models: typing.Sequence[PeopleScoreModel] | None = None,
) -> dict[str, int]:
    """How highly the models rate each person in a payload frame, 1-5.

    The models normally answer a question about the site: of the people it
    already has a node for and nobody has looked at yet, who should somebody
    open next. Asked of a payload frame the question is the other one - of the
    people this run is about to submit, most of whom the site has never heard
    of, which are worth submitting - so the shortlist is everybody in the frame
    rather than everybody in the export.

    People the site has already judged keep the site's judgement: a published
    page or a human upvote is a fact and comes back as the top band, a downvote
    comes back as nothing. Ranking those against the models' guesses would put
    the answer key back in with the questions, and `banded_scores` ranks, so a
    population full of confirmed people would push the merely promising down.
    """
    models = models or [Pipeline.create(model) for model in PEOPLE_SCORE_MODELS]
    # Read off the first model rather than declared as sources of whoever is
    # scoring: `PeoplePayloads` must not depend on the site's export, or every
    # payload run would download it whether or not it was asked to score.
    sources = models[0]

    population = population_from(
        people=payloads,
        koryta=sources.people_koryta.read_or_process(ctx),
        votes=sources.people_votes.read_or_process(ctx),
        companies=sources.companies_krs.read_or_process(ctx),
    ).with_shortlist(payloads["name"])

    print(
        f"Scoring {len(population.shortlist)} people against "
        f"{len(population.seeds())} confirmed and {len(population.seeds(-1))} "
        "rejected by the site"
    )
    if not population.seeds():
        print(
            "WARNING: the site's export names nobody confirmed, so the models "
            "that measure proximity to a known face have nothing to walk from. "
            "Check versioned/person_koryta_<date>/ is not empty."
        )

    scores = best_bands(ctx, population, payloads, models)
    for name, weight in population.seed_weights.items():
        scores[name] = CONFIRMED_BAND if weight > 0 else 0
    return scores
