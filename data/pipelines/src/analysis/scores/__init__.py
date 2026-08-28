"""Models that nominate the next person to look at.

Each model writes its verdict to the site as a vote under its own `userUid`,
all of them containing "pipeline" so the frontend keeps them out of the human
tally. They are not variants of one another: `PeopleScores` reads a person's
employers, `PeopleScoresPageRank` reads the shape of the graph around them,
`PeopleScoresCoappointment` reads who they keep turning up with,
`PeopleScoresTurnover` reads what they did after an election,
`PeopleScoresSuccession` reads whose seat they took, `PeopleScoresCapture`
reads the institution rather than the person, and `PeopleScoresFacts` reads
what has already been written about them. Any of them can nominate somebody the
others miss, which is why the site takes the best score across models rather
than the sum.

Taking the best only works if a 5 means the same thing whoever said it, and the
first measurement against human verdicts says it did not - so each model now
carries a `ScoreRange` bounding the part of the 1-5 axis its accuracy supports.
`base` holds the numbers and `scripts/score_model_accuracy.py` recomputes them.

See `base.PeopleScoreModel` for what they share.
"""

from analysis.scores.base import (
    FULL_RANGE,
    QUEUE_THRESHOLD,
    PeopleScoreModel,
    Population,
    ScoreRange,
)
from analysis.scores.capture import PeopleScoresCapture
from analysis.scores.coappointment import PeopleScoresCoappointment
from analysis.scores.company import CompanyScores, PeopleScores
from analysis.scores.facts import PeopleScoresFacts
from analysis.scores.pagerank import PeopleScoresPageRank
from analysis.scores.succession import PeopleScoresSuccession
from analysis.scores.turnover import PeopleScoresTurnover

#: Every model, in the order a run should produce them: the shared sources are
#: read once and cached, so the first is the slow one.
PEOPLE_SCORE_MODELS: list[type[PeopleScoreModel]] = [
    PeopleScores,
    PeopleScoresPageRank,
    PeopleScoresCoappointment,
    PeopleScoresTurnover,
    PeopleScoresSuccession,
    PeopleScoresCapture,
    PeopleScoresFacts,
]

__all__ = [
    "FULL_RANGE",
    "QUEUE_THRESHOLD",
    "CompanyScores",
    "PEOPLE_SCORE_MODELS",
    "PeopleScoreModel",
    "PeopleScores",
    "PeopleScoresCapture",
    "PeopleScoresCoappointment",
    "PeopleScoresFacts",
    "PeopleScoresPageRank",
    "PeopleScoresSuccession",
    "PeopleScoresTurnover",
    "Population",
    "ScoreRange",
]
