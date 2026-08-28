"""How much has already been written about this person.

Every other model here reasons from the register: who a person sits on a board
with, whose seat they took, what their employer is. This one reasons from the
press. The extraction pipeline reads articles, pulls facts out of them and -
since `/api/ingest/extraction` learned to - says which person already in the
graph each fact is about. A person those facts keep landing on is a person
journalists have already found reasons to write about, and that is a different
kind of evidence from anything the KRS can offer.

The unit is the article, not the fact. Three facts pulled out of one piece are
three readings of one source: a thorough extractor would otherwise outrank a
person who keeps turning up, which is the opposite of the signal. So an article
scores once, for the strongest thing it says, and extra facts inside it add a
little on top rather than multiplying.

What the fact says matters as well as how often it is said. `affair_involvement`
is the site's subject stated outright; `personal_relation` is the mechanism it
exists to trace; `employment` is the bread and butter and also the most common,
so it discriminates least; and `party_membership` is barely evidence of anything
- half the people in the graph belong to a party. The weights below say so.

A fact a reviewer has rejected is not evidence. `correct` below zero means
somebody read the fact and said it was wrong, and `wrongPerson` means the name
matcher put a true fact on the wrong person - the failure the button on the card
exists to catch. Either way the fact stops counting, for this person at least.

Nobody has measured whether any of this predicts what a reader concludes, and
there is not yet enough of it to try: at the time of writing the export carries
16 matched facts over 12 people, seven of whom are published already and so
outside the shortlist entirely. `score_range` is therefore a decision rather
than a measurement, and the docstring on it says which.
"""

import collections

from analysis.scores.base import (
    QUEUE_THRESHOLD,
    PeopleScoreModel,
    Population,
    ScoreRange,
)
from scrapers.koryta.download import KorytaFacts
from scrapers.stores import Context

#: What an article is worth, by the strongest fact it carries about the person.
#: Ordered by how directly the type names the thing the site is about, not by
#: how sure the extractor is - a confident `party_membership` still says less
#: than a hedged `affair_involvement`. A type nobody has seen before scores
#: `DEFAULT_TYPE_POINTS` rather than nothing: the enum is the extractor's and it
#: has grown before, and silently ignoring a new kind of fact would look exactly
#: like the pipeline not running.
FACT_TYPE_POINTS: dict[str, float] = {
    "affair_involvement": 4.0,
    "personal_relation": 3.0,
    "employment": 2.0,
    "party_membership": 1.0,
}

#: What a fact of a type this module has never heard of is worth - the same as
#: an employment, which is the middle of the range and the commonest thing an
#: article says.
DEFAULT_TYPE_POINTS = 2.0

#: Added for each fact after the first in the same article, up to
#: `MAX_EXTRA_POINTS`. Small on purpose: it breaks ties between two people with
#: one article each without letting a thoroughly mined article stand in for a
#: second one.
EXTRA_FACT_POINTS = 0.25

#: The most the extra facts inside one article can add, whatever their number.
#: Strictly below the weakest article's own worth (`party_membership`, 1.0),
#: which is what makes the rule hold: two articles of any one type score 2T and
#: a single article of that type scores at most T + 0.75, and 2T > T + 0.75 for
#: every T on the scale. Without the cap this failed exactly where it mattered -
#: six party-membership facts in one profile piece came to 2.25 and beat two
#: separate articles at 2.0, which is the ranking the module exists to avoid.
#:
#: A stronger *type* still outranks two weaker articles, and that is intended:
#: the brief asks for the number of facts and their type, so one documented
#: affair is allowed to beat two mentions of a party card.
MAX_EXTRA_POINTS = 0.75


def article_points(fact_types: list[str]) -> float:
    """What one article is worth, given every fact it carries about the person.

    The strongest fact decides the article, and the rest add `EXTRA_FACT_POINTS`
    each. An article with no usable facts left - every one of them rejected by a
    reviewer - never reaches here; the caller drops it.
    """
    best = max(
        FACT_TYPE_POINTS.get(fact_type, DEFAULT_TYPE_POINTS) for fact_type in fact_types
    )
    extra = min(EXTRA_FACT_POINTS * (len(fact_types) - 1), MAX_EXTRA_POINTS)
    return best + extra


class PeopleScoresFacts(PeopleScoreModel):
    filename = "people_scores_facts"
    model_tag = "pipeline-facts"

    #: The whole queue-visible span, floored so that everybody this model names
    #: is actually looked at. Unlike `PeopleScoresTurnover`, whose floor records
    #: a measurement, this one records the absence of one: the signal is new,
    #: the export holds a handful of matched facts, and a ceiling below
    #: `QUEUE_THRESHOLD` would keep every one of them out of the queue and so
    #: guarantee it stays unmeasured. Floored at 3 the people it names get read,
    #: and `scripts/score_model_accuracy.py` has something to score in a few
    #: weeks. Revisit it then - this range is a bet, and the others are not.
    score_range = ScoreRange(floor=QUEUE_THRESHOLD, ceiling=5)

    people_facts: KorytaFacts

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        facts = self.people_facts.read_or_process(ctx)
        if facts.empty or "person_koryta_id" not in facts:
            print(f"{type(self).__name__}: the export carries no matched facts")
            return {}

        # The facts arrive keyed by node id, because that is what the site
        # matched them on and it is the one join here that a shared name cannot
        # break. Everything else in `Population` is keyed by name, so this is
        # where the two meet - and a name the site has two nodes for keeps only
        # one of them, the same limitation `Population` documents.
        names_by_id = {
            node_id: name for name, node_id in population.node_ids.items()
        }

        # person -> article -> the types of the facts it carries about them.
        by_person: dict[str, dict[str, list[str]]] = collections.defaultdict(
            lambda: collections.defaultdict(list)
        )
        rejected = 0
        unknown_person = 0

        for row in facts.to_dict(orient="records"):
            if _is_rejected(row):
                rejected += 1
                continue
            name = names_by_id.get(str(row.get("person_koryta_id")))
            if name is None:
                # A fact whose person is not in the site export at all - a node
                # deleted since the extraction was ingested, or an export older
                # than the fact. Not the regional-coverage case: `node_ids`
                # comes from `KorytaPeople`, which is every person the site has,
                # so somebody the payload run missed is matched here and then
                # dropped by the shortlist filter in `process` instead.
                unknown_person += 1
                continue
            article = str(row.get("article_url"))
            by_person[name][article].append(str(row.get("fact_type") or ""))

        scores = {
            name: sum(article_points(types) for types in articles.values())
            for name, articles in by_person.items()
        }
        shortlist = set(population.shortlist)
        on_shortlist = sum(1 for name in scores if name in shortlist)
        print(
            f"{type(self).__name__}: {len(scores)} people carry a matched fact "
            f"({on_shortlist} of them on the shortlist), "
            f"{rejected} facts rejected by a reviewer, "
            f"{unknown_person} on somebody the site export does not have"
        )
        return scores


def _is_rejected(row: dict) -> bool:
    """Whether a reviewer has already said this fact should not count.

    Two separate verdicts. `wrongPerson` says the fact is about somebody else,
    so it is no evidence about this person whatever it says. `correct` below
    zero says the fact itself is wrong. Zero is not rejection - it is what a
    fact that was voted both ways, or not voted on at all, looks like.

    Both fields arrive as a float NaN for a fact nobody has voted on once the
    row has been through a DataFrame, and NaN is truthy - so testing
    `wrong_person` the obvious way would reject every unreviewed fact in the
    export, which is all of them.
    """
    if _is_true(row.get("wrong_person")):
        return True
    correct = _as_float(row.get("correct"))
    return correct is not None and correct < 0


def _is_true(value: object) -> bool:
    """A boolean column's value, with pandas' NaN read as "not set"."""
    return value is True or value == 1


def _as_float(value: object) -> float | None:
    """A numeric column's value, or None for a blank, a NaN or a non-number."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return None if number != number else number
