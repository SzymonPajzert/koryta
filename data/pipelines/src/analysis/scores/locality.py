"""Who holds a post in the place they stood for office.

A councillor of a powiat on the board of a company seated in that powiat is the
case the site exists for, and the register shows it without any timing: the
candidacy says where the person stood, the company's seat says where the post
is. `PeopleScoresTurnover` adds a point when the two agree, but only for a post
taken up in the election year or the one after.

TERYT codes nest and the two sides are recorded at different depths. A local
candidacy (gmina, city, powiat, wójt, mayor) carries its powiat's four digits,
a Sejm, Senate, sejmik or European one only the voivodeship's two, and a
company the gmina or powiat of its seat. Codes are compared down to the powiat,
the deepest both sides reliably have, so a regional or national candidate
matches any company in their voivodeship. Both depths measured alike.
"""

from analysis.scores.base import (
    QUEUE_THRESHOLD,
    PeopleScoreModel,
    Population,
    ScoreRange,
)
from analysis.scores.turnover import year_of
from scrapers.stores import Context

#: TERYT digits naming a powiat: as deep as a candidacy is recorded.
POWIAT_DIGITS = 4

#: What a matched post that carries no start date ranks as: below any year.
UNDATED = 1.0


def stood_where_seated(candidacy_teryt: str | None, company_teryt: str | None) -> bool:
    """Whether a company sits in the place a candidacy was run in.

    One code nesting in the other, compared down to the powiat. Neither side
    being known is an abstention, not a match.
    """
    if not candidacy_teryt or not company_teryt:
        return False
    stood = candidacy_teryt[:POWIAT_DIGITS]
    seated = company_teryt[:POWIAT_DIGITS]
    return stood.startswith(seated) or seated.startswith(stood)


class PeopleScoresLocality(PeopleScoreModel):
    filename = "people_scores_locality"
    model_tag = "pipeline-locality"

    #: Measured on 2026-11-20 against Szymon's first votes on 224 people the
    #: queue showed (any model at 2 or more) since 2026-08-08, with the
    #: candidacies and posts of the export before the vote: 85 % of the people
    #: this rule names were voted interesting, against 43 % of the rest and
    #: 66 % of everybody another model put at 5. Adjusted for posts held,
    #: candidacies, the best band and turnover, the odds ratio is 8.9
    #: (p < 0.001). Hence a floor above the queue threshold. Within it the
    #: newest such post orders - one taken up since 2024 was 93 % against 76 % -
    #: so the raw score is its year and the band above the floor goes to the
    #: most recent.
    score_range = ScoreRange(floor=QUEUE_THRESHOLD + 1, ceiling=5)

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        scores: dict[str, float] = {}
        matched_posts = 0

        for name in population.shortlist:
            candidacies = population.candidacies.get(name, [])
            if not candidacies:
                continue

            newest = 0.0
            for post in population.employments.get(name, []):
                company = population.companies.get(post.krs)
                if company is None or not any(
                    stood_where_seated(candidacy.teryt, company.teryt)
                    for candidacy in candidacies
                ):
                    continue
                matched_posts += 1
                newest = max(newest, float(year_of(post.start) or UNDATED))

            if newest:
                scores[name] = newest

        print(
            f"{matched_posts} posts at a company seated where the person stood, "
            f"across {len(scores)} people"
        )
        return scores
