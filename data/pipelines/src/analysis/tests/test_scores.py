"""The scoring models, and the shared rules about who is worth scoring."""

import datetime

import pandas as pd
import pytest

from analysis.scores import (
    PEOPLE_SCORE_MODELS,
    CompanyScores,
    PeopleScoresCapture,
    PeopleScoresCoappointment,
    PeopleScoresFacts,
    PeopleScoresPageRank,
    PeopleScoresSuccession,
    PeopleScoresTurnover,
)
from analysis.scores.base import (
    FULL_RANGE,
    QUEUE_THRESHOLD,
    Candidacy,
    CompanyFacts,
    Employment,
    PeopleScoreModel,
    Population,
    ScoreRange,
    banded_scores,
    person_key,
    rejestr_io_id,
)
from analysis.scores.facts import (
    EXTRA_FACT_POINTS,
    FACT_TYPE_POINTS,
    MAX_EXTRA_POINTS,
    article_points,
)
from analysis.scores.succession import as_date, successions
from analysis.scores.turnover import same_region, year_of
from entities.person import is_pipeline_uid
from scrapers.stores import Pipeline


def population(
    employments: dict[str, list[tuple]],
    candidacies: dict[str, list[Candidacy]] | None = None,
    seeds: dict[str, float] | None = None,
    shortlist: list[str] | None = None,
    companies: dict[str, CompanyFacts] | None = None,
) -> Population:
    """A population built from `{name: [(krs, start), ...]}` and its seeds.

    A model that cares about roles or end dates - `PeopleScoresSuccession` is
    the one - passes whole `Employment`s instead of the pair.
    """
    posts = {
        name: [
            post
            if isinstance(post, Employment)
            else Employment(krs=post[0], role=None, start=post[1], end=None)
            for post in v
        ]
        for name, v in employments.items()
    }
    roster: dict[str, list[str]] = {}
    for name, people_posts in posts.items():
        for post in people_posts:
            roster.setdefault(post.krs, []).append(name)

    seeds = seeds or {}
    return Population(
        people=pd.DataFrame(),
        node_ids={name: f"node-{name}" for name in posts},
        employments=posts,
        candidacies={name: (candidacies or {}).get(name, []) for name in posts},
        roster=roster,
        companies=companies or {},
        seed_weights=seeds,
        shortlist=shortlist
        if shortlist is not None
        else [name for name in posts if name not in seeds],
    )


def model(model_type):
    """A model with its sources present but unread."""
    return Pipeline.create(model_type)


class TestBandedScores:
    def test_drops_people_the_model_said_nothing_about(self):
        assert banded_scores({"a": 0.0, "b": -1.0}) == {}

    def test_bands_by_rank_not_by_value(self):
        # One outlier three orders of magnitude above the rest must not push
        # everybody else to the bottom band - which is what scaling by the
        # maximum did, and what PageRank output would do to it every run.
        raw = {f"p{i}": float(i) for i in range(1, 101)}
        raw["outlier"] = 1_000_000.0

        bands = banded_scores(raw)

        assert bands["outlier"] == 5
        assert bands["p100"] == 5
        assert bands["p90"] == 3
        assert bands["p1"] == 1

    def test_a_lone_score_lands_in_the_top_band(self):
        assert banded_scores({"a": 0.001}) == {"a": 5}

    def test_a_range_folds_the_bands_onto_itself(self):
        raw = {f"p{i}": float(i) for i in range(1, 101)}

        capped = banded_scores(raw, ScoreRange(ceiling=3))

        assert max(capped.values()) == 3
        assert min(capped.values()) == 1
        # Still ordered: a capped model ranks its own people as before, it just
        # cannot outrank a model that has earned the top of the scale.
        assert capped["p100"] >= capped["p90"] >= capped["p1"]

    def test_a_floor_puts_everybody_the_model_named_in_the_queue(self):
        raw = {f"p{i}": float(i) for i in range(1, 101)}

        floored = banded_scores(raw, ScoreRange(floor=QUEUE_THRESHOLD))

        assert min(floored.values()) == QUEUE_THRESHOLD
        assert max(floored.values()) == 5

    def test_a_narrow_range_still_reaches_its_ceiling(self):
        # Rounding down at the halves would leave a 1-2 model unable to say 2
        # for anybody but the very top percentile, which is not a model.
        raw = {f"p{i}": float(i) for i in range(1, 101)}

        assert set(banded_scores(raw, ScoreRange(ceiling=2)).values()) == {1, 2}

    def test_the_default_range_changes_nothing(self):
        raw = {f"p{i}": float(i) for i in range(1, 101)}

        assert banded_scores(raw, FULL_RANGE) == banded_scores(raw)

    def test_a_range_outside_the_scale_is_refused(self):
        with pytest.raises(ValueError):
            ScoreRange(floor=4, ceiling=2)
        with pytest.raises(ValueError):
            ScoreRange(ceiling=6)


class TestScoreRanges:
    """What each model is allowed to say, and why it is written down at all."""

    def test_every_model_states_a_range(self):
        for model_type in PEOPLE_SCORE_MODELS:
            assert isinstance(model_type.score_range, ScoreRange), model_type

    def test_the_measured_models_carry_their_verdict(self):
        # The three the 2026-08 measurement moved, pinned so that changing any
        # of them is a change somebody had to write down rather than a constant
        # that drifted. The numbers behind them are in `analysis.scores.base`.
        assert PeopleScoresTurnover.score_range == ScoreRange(
            floor=QUEUE_THRESHOLD, ceiling=5
        )
        assert PeopleScoresPageRank.score_range == ScoreRange(ceiling=QUEUE_THRESHOLD)
        assert PeopleScoresCoappointment.score_range == ScoreRange(ceiling=2)

    def test_the_fact_model_is_floored_but_unmeasured(self):
        # Floored so the people it names are actually read - the signal cannot
        # be measured until somebody looks at them. Pinned so that the day
        # `score_model_accuracy.py` has an opinion, changing this is deliberate.
        assert PeopleScoresFacts.score_range == ScoreRange(
            floor=QUEUE_THRESHOLD, ceiling=5
        )

    def test_a_capped_model_cannot_reach_the_queue_on_its_own(self):
        # The whole point of the cap: `together` may still colour somebody the
        # other models found, but it can no longer put one in front of a reader.
        assert PeopleScoresCoappointment.score_range.ceiling < QUEUE_THRESHOLD


class TestPopulation:
    """Who a model is allowed to have an opinion about."""

    def build(self, koryta_rows, vote_rows=(), payload_rows=None):
        scorer = model(PeopleScoresCapture)
        payloads = pd.DataFrame.from_records(
            payload_rows
            if payload_rows is not None
            else [
                {"name": row["full_name"], "companies": [{"krs": "1"}], "elections": []}
                for row in koryta_rows
            ]
        )
        scorer.people_payloads.read_or_process = lambda ctx: payloads
        scorer.people_koryta.read_or_process = lambda ctx: pd.DataFrame.from_records(
            koryta_rows
        )
        scorer.people_votes.read_or_process = lambda ctx: pd.DataFrame.from_records(
            list(vote_rows)
        )
        scorer.companies_krs.read_or_process = lambda ctx: pd.DataFrame()
        return scorer.population(None)

    def test_a_published_person_is_a_seed_not_a_candidate(self):
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": True, "parties": []}]
        )

        assert result.seed_weights["Anna"] > 0
        assert result.shortlist == []

    def test_a_human_vote_takes_somebody_off_the_shortlist(self):
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            [{"person_koryta_id": "n1", "interesting": 4}],
        )

        assert result.seed_weights["Anna"] == 4
        assert result.shortlist == []

    def test_a_downvote_seeds_the_other_way(self):
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            [{"person_koryta_id": "n1", "interesting": -3}],
        )

        assert result.seeds() == {}
        assert result.seeds(-1) == {"Anna": 3}

    def test_the_pipelines_own_score_does_not_retire_a_candidate(self):
        # `votes_interesting` is the site's aggregate and includes whatever the
        # pipeline last wrote. Reading it as evidence of human review would
        # mean no run after the first could ever revise its own score.
        result = self.build(
            [
                {
                    "id": "n1",
                    "full_name": "Anna",
                    "is_public": False,
                    "parties": [],
                    "votes_interesting": 5,
                }
            ]
        )

        assert result.shortlist == ["Anna"]
        assert result.seed_weights == {}

    def test_a_vote_with_no_node_on_it_is_not_a_person(self):
        # A vote on an extracted fact carries `extractionId` and no `nodeId`,
        # which arrives here as NaN. NaN is truthy and equals nothing, so the
        # guards that read "skip the blank ones" used to pass it straight
        # through and `str(nan)` became a person id of "nan".
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            [
                {"person_koryta_id": float("nan"), "interesting": 5},
                {"person_koryta_id": None, "interesting": 4},
                {"person_koryta_id": "", "interesting": 3},
            ],
        )

        assert result.shortlist == ["Anna"]
        assert result.seed_weights == {}

    def test_somebody_with_no_payload_is_not_scorable(self):
        # The payload run is region-scoped, so the site knows people this model
        # cannot see. Voting on them would be voting on nothing.
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            payload_rows=[],
        )

        assert result.shortlist == []


class TestPersonKey:
    """Which payload row is which koryta node."""

    def test_reads_the_id_out_of_a_profile_link(self):
        assert rejestr_io_id("https://rejestr.io/osoby/312837") == "312837"

    def test_tolerates_a_trailing_slash(self):
        # `scrapers.krs.data` stores several hundred of them written that way.
        assert rejestr_io_id("https://rejestr.io/osoby/312837/") == "312837"

    def test_a_missing_link_is_not_an_id(self):
        # A DataFrame column that some rows do not fill arrives as NaN.
        assert rejestr_io_id(None) is None
        assert rejestr_io_id(float("nan")) is None
        assert rejestr_io_id("") is None
        assert rejestr_io_id("https://rejestr.io/firmy/koryta") is None

    def test_somebody_with_no_link_keys_exactly_as_before(self):
        # The whole population used to be keyed on the bare name, so keeping
        # that as the fallback is what makes this change a no-op for the
        # roughly one node in six that has no rejestr.io link.
        assert person_key(None, "Anna Kowalska") == "Anna Kowalska"

    def test_an_id_cannot_be_mistaken_for_a_name(self):
        assert person_key("https://rejestr.io/osoby/312837", "Anna") != "312837"


class TestPopulationJoin:
    """The payload and the site do not spell people the same way."""

    def build(self, koryta_rows, payload_rows):
        scorer = model(PeopleScoresCapture)
        scorer.people_payloads.read_or_process = lambda ctx: pd.DataFrame.from_records(
            payload_rows
        )
        scorer.people_koryta.read_or_process = lambda ctx: pd.DataFrame.from_records(
            koryta_rows
        )
        scorer.people_votes.read_or_process = lambda ctx: pd.DataFrame()
        scorer.companies_krs.read_or_process = lambda ctx: pd.DataFrame()
        return scorer.population(None)

    def test_a_middle_name_no_longer_hides_a_person(self):
        # KRS spells out the middle name and PKW does not, so the site's node
        # and its payload row disagree. Keyed on the name, this person was on
        # no model's shortlist and could not be scored at all - which is how
        # the councillor who joined four Orlen boards after the 2024 election
        # sat unrated.
        result = self.build(
            [
                {
                    "id": "n1",
                    "full_name": "Kacper Karol Pietrusinski",
                    "is_public": False,
                    "parties": [],
                    "rejestrIo": "https://rejestr.io/osoby/312837",
                }
            ],
            [
                {
                    "name": "Kacper Pietrusinski",
                    "rejestrIo": "https://rejestr.io/osoby/312837",
                    "companies": [{"krs": "1"}],
                    "elections": [],
                }
            ],
        )

        assert result.shortlist == ["rejestr.io/312837"]
        assert result.node_ids["rejestr.io/312837"] == "n1"

    def test_the_score_row_is_named_the_way_the_site_names_them(self):
        result = self.build(
            [
                {
                    "id": "n1",
                    "full_name": "Kacper Karol Pietrusinski",
                    "is_public": False,
                    "parties": [],
                    "rejestrIo": "https://rejestr.io/osoby/312837",
                }
            ],
            [
                {
                    "name": "Kacper Pietrusinski",
                    "rejestrIo": "https://rejestr.io/osoby/312837",
                    "companies": [{"krs": "1"}],
                    "elections": [],
                }
            ],
        )

        assert result.display_name("rejestr.io/312837") == "Kacper Karol Pietrusinski"

    def test_two_people_who_share_a_name_stay_apart(self):
        # Keyed on the name these two were one person, so one of them took the
        # other's node id and the score went to whoever the dict kept.
        result = self.build(
            [
                {
                    "id": "n1",
                    "full_name": "Sebastian Wierzbicki",
                    "is_public": False,
                    "parties": [],
                    "rejestrIo": "https://rejestr.io/osoby/1",
                },
                {
                    "id": "n2",
                    "full_name": "Sebastian Wierzbicki",
                    "is_public": False,
                    "parties": [],
                    "rejestrIo": "https://rejestr.io/osoby/2",
                },
            ],
            [
                {
                    "name": "Sebastian Wierzbicki",
                    "rejestrIo": "https://rejestr.io/osoby/1",
                    "companies": [{"krs": "1"}],
                    "elections": [],
                },
                {
                    "name": "Sebastian Wierzbicki",
                    "rejestrIo": "https://rejestr.io/osoby/2",
                    "companies": [{"krs": "2"}],
                    "elections": [],
                },
            ],
        )

        assert sorted(result.shortlist) == ["rejestr.io/1", "rejestr.io/2"]
        assert result.node_ids == {"rejestr.io/1": "n1", "rejestr.io/2": "n2"}
        assert [p.krs for p in result.employments["rejestr.io/2"]] == ["2"]

    def test_a_node_with_no_link_still_joins_on_the_name(self):
        # Nodes written before the site recorded rejestr.io links have no id to
        # match on, and the payload run may not have one either. The name is
        # all there is, and it has to keep working.
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            [{"name": "Anna", "companies": [{"krs": "1"}], "elections": []}],
        )

        assert result.shortlist == ["Anna"]
        assert result.node_ids == {"Anna": "n1"}

    def test_a_node_with_no_link_joins_a_payload_row_that_has_one(self):
        # Only one side having the link is the common case during a backfill,
        # and falling back to the name keeps them together.
        result = self.build(
            [{"id": "n1", "full_name": "Anna", "is_public": False, "parties": []}],
            [
                {
                    "name": "Anna",
                    "rejestrIo": "https://rejestr.io/osoby/7",
                    "companies": [{"krs": "1"}],
                    "elections": [],
                }
            ],
        )

        assert result.shortlist == ["rejestr.io/7"]
        assert result.node_ids == {"rejestr.io/7": "n1"}

    def test_the_seed_follows_the_person_not_the_spelling(self):
        # A published person is the ground truth the models generalise from.
        # Missing the join loses the seed as surely as it loses the candidate.
        result = self.build(
            [
                {
                    "id": "n1",
                    "full_name": "Jerzy Andrzej Michalak",
                    "is_public": True,
                    "parties": [],
                    "rejestrIo": "https://rejestr.io/osoby/1104997",
                }
            ],
            [
                {
                    "name": "Jerzy Michalak",
                    "rejestrIo": "https://rejestr.io/osoby/1104997",
                    "companies": [{"krs": "1"}],
                    "elections": [],
                }
            ],
        )

        assert result.seeds() == {"rejestr.io/1104997": 3}
        assert result.shortlist == []


class TestCompanyScores:
    """The votes half of the model the site started with."""

    def person_scores(self, koryta_rows, vote_rows):
        scorer = Pipeline.create(CompanyScores)
        scorer.people_scored.read_or_process = lambda ctx: pd.DataFrame.from_records(
            koryta_rows
        )
        scorer.people_votes.read_or_process = lambda ctx: pd.DataFrame.from_records(
            list(vote_rows)
        )
        return scorer.person_scores(
            None,
            dict(
                zip(
                    [r["id"] for r in koryta_rows],
                    [r["full_name"] for r in koryta_rows],
                )
            ),
        )

    def test_a_vote_with_no_node_on_it_does_not_stop_the_run(self):
        # The crash this replaces: NaN survived the blank check, `str(nan)`
        # became "nan", and the name lookup raised KeyError mid-pipeline.
        scores = self.person_scores(
            [{"id": "n1", "full_name": "Anna", "is_public": False}],
            [
                {"person_koryta_id": float("nan"), "interesting": 5},
                {"person_koryta_id": "n1", "interesting": 2},
            ],
        )

        assert scores == {"Anna": 2}

    def test_a_vote_on_something_that_is_not_a_person_is_ignored(self):
        # Places get voted on too, and a node deleted since the export is gone
        # from the people table while its votes remain.
        scores = self.person_scores(
            [{"id": "n1", "full_name": "Anna", "is_public": False}],
            [
                {"person_koryta_id": "some-place", "interesting": 5},
                {"person_koryta_id": "n1", "interesting": 1},
            ],
        )

        assert scores == {"Anna": 1}


class TestPageRank:
    def test_a_colleague_of_a_known_face_outranks_a_stranger(self):
        pop = population(
            {
                "Seed": [("1", None)],
                "Colleague": [("1", None)],
                "Stranger": [("2", None)],
            },
            seeds={"Seed": 3},
        )

        scores = model(PeopleScoresPageRank).raw_scores(None, pop)

        assert scores["Colleague"] > scores["Stranger"]

    def test_a_seat_on_a_crowded_board_says_less(self):
        crowd = {f"Crowd{i}": [("big", None)] for i in range(50)}
        pop = population(
            {
                "Seed": [("small", None), ("big", None)],
                "Close": [("small", None)],
                **crowd,
            },
            seeds={"Seed": 3},
        )

        scores = model(PeopleScoresPageRank).raw_scores(None, pop)

        assert scores["Close"] > scores["Crowd0"]

    def test_proximity_to_the_downvoted_is_subtracted(self):
        pop = population(
            {
                "Seed": [("1", None)],
                "Clean": [("1", None)],
                "Tainted": [("1", None), ("2", None)],
                "Rejected": [("2", None)],
            },
            seeds={"Seed": 3, "Rejected": -3},
        )

        scores = model(PeopleScoresPageRank).raw_scores(None, pop)

        assert scores["Clean"] > scores["Tainted"]

    def test_nothing_to_walk_from_is_not_an_error(self):
        pop = population({"Anna": [("1", None)]})

        assert model(PeopleScoresPageRank).raw_scores(None, pop) == {}


class TestCoappointment:
    def test_one_shared_board_is_a_coincidence(self):
        pop = population(
            {"Seed": [("1", None)], "Once": [("1", None)]},
            seeds={"Seed": 3},
        )

        assert model(PeopleScoresCoappointment).raw_scores(None, pop) == {}

    def test_following_somebody_between_two_companies_is_not(self):
        pop = population(
            {
                "Seed": [("1", None), ("2", None)],
                "Twice": [("1", None), ("2", None)],
                "Once": [("1", None)],
            },
            seeds={"Seed": 3},
        )

        scores = model(PeopleScoresCoappointment).raw_scores(None, pop)

        assert set(scores) == {"Twice"}
        assert scores["Twice"] == 3

    def test_travelling_with_two_known_faces_beats_travelling_with_one(self):
        pop = population(
            {
                "SeedA": [("1", None), ("2", None)],
                "SeedB": [("1", None), ("2", None)],
                "Both": [("1", None), ("2", None)],
                "One": [("1", None), ("3", None)],
                "Lone": [("3", None)],
            },
            seeds={"SeedA": 3, "SeedB": 3},
        )
        pop.employments["Lone"] = [
            Employment(krs="1", role=None, start=None, end=None),
            Employment(krs="3", role=None, start=None, end=None),
        ]

        scores = model(PeopleScoresCoappointment).raw_scores(None, pop)

        assert scores["Both"] == 6
        assert "One" not in scores


class TestTurnover:
    def test_reads_a_year_out_of_either_shape_it_arrives_in(self):
        assert year_of("2018-10-21") == 2018
        assert year_of("2018") == 2018
        assert year_of(None) is None
        assert year_of("brak") is None

    def test_a_region_is_matched_at_whichever_depth_is_recorded(self):
        assert same_region("14", "1465")
        assert same_region("1465", "14")
        assert not same_region("14", "24")
        # Neither side saying anything is an abstention, not a match.
        assert not same_region(None, "1465")

    def build(self, employments, candidacies, companies=None):
        return population(
            employments,
            candidacies=candidacies,
            seeds={},
            companies=companies or {},
        )

    def test_a_post_taken_up_after_the_election_counts(self):
        pop = self.build(
            {"Anna": [("1", "2019-03-01")]},
            {"Anna": [Candidacy(year="2018", teryt="14", party=None, committee=None)]},
        )

        scores = model(PeopleScoresTurnover).raw_scores(None, pop)

        assert scores == {"Anna": 1.0}

    def test_a_post_taken_up_years_later_does_not(self):
        pop = self.build(
            {"Anna": [("1", "2023-03-01")]},
            {"Anna": [Candidacy(year="2018", teryt="14", party=None, committee=None)]},
        )

        assert model(PeopleScoresTurnover).raw_scores(None, pop) == {}

    def test_the_same_region_and_a_public_company_each_add_to_it(self):
        pop = self.build(
            {"Anna": [("1", "2019-03-01")]},
            {"Anna": [Candidacy(year="2018", teryt="14", party=None, committee=None)]},
            companies={
                "1": CompanyFacts(name="Gmina sp.", teryt="1465", is_public=True)
            },
        )

        scores = model(PeopleScoresTurnover).raw_scores(None, pop)

        assert scores == {"Anna": 4.0}

    def test_standing_three_times_in_a_year_is_still_one_appointment(self):
        pop = self.build(
            {"Anna": [("1", "2018-12-01")]},
            {
                "Anna": [
                    Candidacy(year="2018", teryt="14", party=None, committee=None),
                    Candidacy(year="2018", teryt="14", party=None, committee=None),
                    Candidacy(year="2018", teryt="24", party=None, committee=None),
                ]
            },
        )

        assert model(PeopleScoresTurnover).raw_scores(None, pop) == {"Anna": 1.0}

    def test_somebody_who_never_stood_is_not_this_models_business(self):
        pop = self.build({"Anna": [("1", "2019-03-01")]}, {})

        assert model(PeopleScoresTurnover).raw_scores(None, pop) == {}


class TestCapture:
    def stood(self, *names):
        return {
            name: [Candidacy(year="2018", teryt=None, party=None, committee=None)]
            for name in names
        }

    def test_a_board_of_former_candidates_lifts_the_newcomer(self):
        pop = population(
            {
                "Newcomer": [("captured", None)],
                "ExA": [("captured", None)],
                "ExB": [("captured", None)],
                "ExC": [("captured", None)],
                "Quiet": [("ordinary", None)],
                "Nobody": [("ordinary", None)],
            },
            candidacies=self.stood("ExA", "ExB", "ExC"),
        )

        scores = model(PeopleScoresCapture).raw_scores(None, pop)

        assert scores["Newcomer"] > 0
        assert "Quiet" not in scores

    def test_a_candidate_does_not_capture_their_own_board(self):
        # The only political thing about this board is Alone. Alone knowing
        # that about themselves is not a finding; Ordinary sitting next to them
        # is the one this model has something to say about.
        pop = population(
            {"Alone": [("1", None)], "Ordinary": [("1", None)]},
            candidacies=self.stood("Alone"),
        )

        scores = model(PeopleScoresCapture).raw_scores(None, pop)

        assert "Alone" not in scores
        assert scores["Ordinary"] > 0

    def test_a_small_board_cannot_reach_the_top_on_one_colleague(self):
        small = population(
            {"Anna": [("s", None)], "Ex": [("s", None)]},
            candidacies=self.stood("Ex"),
        )
        big = population(
            {
                "Anna": [("b", None)],
                **{f"Ex{i}": [("b", None)] for i in range(9)},
            },
            candidacies=self.stood(*[f"Ex{i}" for i in range(9)]),
        )

        anna_small = model(PeopleScoresCapture).raw_scores(None, small)["Anna"]
        anna_big = model(PeopleScoresCapture).raw_scores(None, big)["Anna"]

        assert anna_small < anna_big


class TestSuccession:
    """Who took over the seat of somebody already known to be political."""

    def spell(self, krs, start, end, role="Rada Nadzorcza"):
        return Employment(krs=krs, role=role, start=start, end=end)

    def stood(self, *names, party="PiS"):
        return {
            name: [Candidacy(year="2018", teryt=None, party=party, committee="KW PiS")]
            for name in names
        }

    def build(self, employments, candidacies=None, seeds=None, companies=None):
        return population(
            employments,
            candidacies=candidacies or {},
            seeds=seeds or {},
            shortlist=list(employments),
            companies=companies or {},
        )

    def test_a_register_date_is_read_as_a_day_or_not_at_all(self):
        assert as_date("2024-04-12") == datetime.date(2024, 4, 12)
        assert as_date(None) is None
        assert as_date("") is None
        # A year on its own would land every such spell on 1 January and
        # manufacture handovers eleven months wide.
        assert as_date("2024") is None
        assert as_date("brak") is None

    def test_a_seat_handed_over_on_the_day_is_a_succession(self):
        spells = [
            ("Odchodzi", self.spell("1", "2020-01-01", "2024-04-12")),
            ("Wchodzi", self.spell("1", "2024-04-12", None)),
        ]

        assert successions(spells) == [("Odchodzi", "Wchodzi", 0)]

    def test_a_seat_left_empty_for_a_year_is_not(self):
        spells = [
            ("Odchodzi", self.spell("1", "2020-01-01", "2023-01-01")),
            ("Wchodzi", self.spell("1", "2024-04-12", None)),
        ]

        assert successions(spells) == []

    def test_the_register_writing_the_two_filings_out_of_order_still_counts(self):
        # The successor is entered before the predecessor is struck off. That
        # is a filing artefact, not two people on one seat.
        spells = [
            ("Odchodzi", self.spell("1", "2020-01-01", "2024-04-12")),
            ("Wchodzi", self.spell("1", "2024-03-20", None)),
        ]

        assert successions(spells) == [("Odchodzi", "Wchodzi", -23)]

    def test_two_people_sitting_on_the_board_for_years_together_do_not(self):
        spells = [
            ("Pierwszy", self.spell("1", "2015-01-01", "2024-04-12")),
            ("Drugi", self.spell("1", "2016-01-01", None)),
        ]

        assert successions(spells) == []

    def test_a_board_seat_is_not_handed_over_to_the_supervisory_board(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12", "Zarząd")],
                "Wchodzi": [self.spell("1", "2024-04-12", None, "Rada Nadzorcza")],
            },
            candidacies=self.stood("Odchodzi"),
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {}

    def test_a_spell_whose_role_nobody_recorded_takes_no_part(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12", None)],
                "Wchodzi": [self.spell("1", "2024-04-12", None, None)],
            },
            candidacies=self.stood("Odchodzi"),
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {}

    def test_a_whole_board_changing_on_one_day_pairs_off_rather_than_squaring(self):
        # The shape KRS actually produces, and the reason the match is
        # one-to-one: seven out and seven in is seven claims, not forty-nine.
        spells = [
            (f"Odchodzi{i}", self.spell("1", "2018-01-01", "2024-04-12"))
            for i in range(7)
        ] + [(f"Wchodzi{i}", self.spell("1", "2024-04-12", None)) for i in range(7)]

        paired = successions(spells)

        assert len(paired) == 7
        assert len({leaver for leaver, _, _ in paired}) == 7
        assert len({joiner for _, joiner, _ in paired}) == 7

    def test_the_same_spell_recorded_twice_is_one_seat(self):
        duplicated = self.spell("1", "2020-01-01", "2024-04-12")
        pop = self.build(
            {
                "Odchodzi": [duplicated, duplicated],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
                "Też": [self.spell("1", "2024-04-12", None)],
            },
            candidacies=self.stood("Odchodzi"),
        )

        scores = model(PeopleScoresSuccession).raw_scores(None, pop)

        # Only one of the two arrivals can have taken the one seat that was
        # vacated; the duplicate must not hand it over a second time.
        assert len(scores) == 1

    def test_replacing_somebody_with_a_party_is_the_whole_point(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            candidacies=self.stood("Odchodzi"),
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {"Wchodzi": 1.0}

    def test_replacing_somebody_nobody_knows_anything_about_is_not(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            }
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {}

    def test_a_committee_no_party_could_be_read_off_is_worth_a_quarter(self):
        # A coalition committee maps to no party on purpose, so this layer is
        # quieter than a named party rather than absent.
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            candidacies=self.stood("Odchodzi", party=None),
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {"Wchodzi": 0.25}

    def test_a_person_the_site_already_published_carries_their_own_weight(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            seeds={"Odchodzi": 3.0},
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {"Wchodzi": 3.0}

    def test_somebody_a_human_voted_down_is_not_evidence_for_their_successor(self):
        pop = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            seeds={"Odchodzi": -2.0},
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {}

    def test_a_public_company_adds_to_a_case_but_never_makes_one(self):
        public = {"1": CompanyFacts(name="Spółka gminy", teryt=None, is_public=True)}

        evidenced = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            candidacies=self.stood("Odchodzi"),
            companies=public,
        )
        bare = self.build(
            {
                "Odchodzi": [self.spell("1", "2020-01-01", "2024-04-12")],
                "Wchodzi": [self.spell("1", "2024-04-12", None)],
            },
            companies=public,
        )

        assert model(PeopleScoresSuccession).raw_scores(None, evidenced) == {
            "Wchodzi": 2.0
        }
        assert model(PeopleScoresSuccession).raw_scores(None, bare) == {}

    def test_replacing_two_political_people_counts_twice(self):
        pop = self.build(
            {
                "OdchodziA": [self.spell("1", "2018-01-01", "2020-04-12")],
                "OdchodziB": [self.spell("2", "2018-01-01", "2024-04-12")],
                "Wchodzi": [
                    self.spell("1", "2020-04-12", "2023-01-01"),
                    self.spell("2", "2024-04-12", None),
                ],
            },
            candidacies=self.stood("OdchodziA", "OdchodziB"),
        )

        assert model(PeopleScoresSuccession).raw_scores(None, pop)["Wchodzi"] == 2.0

    def test_somebody_who_replaced_nobody_is_not_this_models_business(self):
        pop = self.build({"Anna": [self.spell("1", "2019-03-01", None)]})

        assert model(PeopleScoresSuccession).raw_scores(None, pop) == {}


class TestPipelineUid:
    @pytest.mark.parametrize(
        "uid, expected",
        [
            ("pipeline", True),
            ("pipeline-pagerank", True),
            ("extraction-pipeline-v2", True),
            ("aB3xYz", False),
            ("", False),
            (None, False),
        ],
    )
    def test_matches_the_frontends_rule(self, uid, expected):
        assert is_pipeline_uid(uid) is expected


def test_every_model_votes_under_a_uid_the_site_reads_as_a_robot():
    # Over the registry rather than a list written out here: the hardcoded
    # version named four of the six models, so a new one could ship with a uid
    # the frontend counts as a human - which would put its score into the human
    # tally and seed the next run on the pipeline's own output.
    tags = set()
    for model_type in PEOPLE_SCORE_MODELS:
        assert issubclass(model_type, PeopleScoreModel)
        assert is_pipeline_uid(model_type.model_tag), model_type
        tags.add(model_type.model_tag)
    assert len(tags) == len(PEOPLE_SCORE_MODELS), "two models share a uid"


def facts_frame(rows: list[dict]) -> pd.DataFrame:
    """The `KorytaFacts` output shape, defaults filled in."""
    return pd.DataFrame.from_records(
        [
            {
                "person_koryta_id": row.get("person", "node-Anna"),
                "article_url": row.get("article", "https://a.pl/1"),
                "fact_type": row.get("type", "employment"),
                "correct": row.get("correct"),
                "wrong_person": row.get("wrong_person", False),
            }
            for row in rows
        ],
        columns=[
            "person_koryta_id",
            "article_url",
            "fact_type",
            "correct",
            "wrong_person",
        ],
    )


def facts_model(rows: list[dict]):
    scorer = model(PeopleScoresFacts)
    scorer.people_facts.read_or_process = lambda ctx: facts_frame(rows)
    return scorer


class TestArticlePoints:
    """What one article is worth, given the facts it carries."""

    def test_the_strongest_fact_decides_the_article(self):
        assert article_points(["affair_involvement"]) == (
            FACT_TYPE_POINTS["affair_involvement"]
        )
        # The affair decides it; the party membership only adds the extra-fact
        # increment on top.
        assert article_points(["party_membership", "affair_involvement"]) == (
            FACT_TYPE_POINTS["affair_involvement"] + EXTRA_FACT_POINTS
        )

    def test_a_type_nobody_has_seen_scores_like_an_employment(self):
        # The extractor owns the enum and has grown it before. A new kind of
        # fact scoring zero would look exactly like the pipeline not running.
        assert article_points(["something_new"]) == article_points(["employment"])

    def test_two_articles_beat_one_well_mined_one(self):
        # The whole point of counting articles rather than facts: three facts
        # pulled out of one piece are three readings of one source.
        one_thorough = article_points(["employment", "employment", "employment"])
        two_separate = 2 * article_points(["employment"])

        assert two_separate > one_thorough

    def test_no_number_of_facts_in_one_article_beats_two_articles(self):
        # Uncapped this failed at six facts of the weakest type: 1 + 0.25*5 =
        # 2.25 against two separate articles at 2.0. The bonus is capped below
        # the weakest article's own worth precisely so that no count can.
        for fact_type in FACT_TYPE_POINTS:
            for count in range(1, 60):
                assert article_points([fact_type] * count) < 2 * article_points(
                    [fact_type]
                ), (fact_type, count)

    def test_the_extra_fact_bonus_cannot_stand_in_for_an_article(self):
        assert MAX_EXTRA_POINTS < min(FACT_TYPE_POINTS.values())
        assert EXTRA_FACT_POINTS <= MAX_EXTRA_POINTS


class TestFacts:
    """Scoring a person on what has already been written about them."""

    def test_somebody_in_two_articles_outranks_somebody_in_one(self):
        scorer = facts_model(
            [
                {"person": "node-Anna", "article": "https://a.pl/1"},
                {"person": "node-Anna", "article": "https://a.pl/2"},
                {"person": "node-Bob", "article": "https://b.pl/1"},
                {"person": "node-Bob", "article": "https://b.pl/1"},
                {"person": "node-Bob", "article": "https://b.pl/1"},
            ]
        )

        scores = scorer.raw_scores(None, population({"Anna": [], "Bob": []}))

        assert scores["Anna"] > scores["Bob"]

    def test_an_affair_says_more_than_a_party_card(self):
        scorer = facts_model(
            [
                {"person": "node-Anna", "type": "affair_involvement"},
                {"person": "node-Bob", "type": "party_membership"},
            ]
        )

        scores = scorer.raw_scores(None, population({"Anna": [], "Bob": []}))

        assert scores["Anna"] > scores["Bob"]

    def test_a_fact_a_reviewer_rejected_does_not_count(self):
        scorer = facts_model(
            [
                {"person": "node-Anna", "correct": -2},
                {"person": "node-Bob", "correct": 1},
            ]
        )

        scores = scorer.raw_scores(None, population({"Anna": [], "Bob": []}))

        assert "Anna" not in scores
        assert scores["Bob"] > 0

    def test_a_fact_on_the_wrong_person_does_not_count(self):
        scorer = facts_model([{"person": "node-Anna", "wrong_person": True}])

        assert scorer.raw_scores(None, population({"Anna": []})) == {}

    def test_an_unreviewed_fact_still_counts(self):
        # `correct` and `wrong_person` are NaN for a fact nobody has voted on,
        # which is every fact in the export today - and NaN is truthy, so
        # reading it the obvious way would reject the entire signal.
        rows = facts_frame([{"person": "node-Anna"}])
        rows["correct"] = float("nan")
        rows["wrong_person"] = float("nan")
        scorer = model(PeopleScoresFacts)
        scorer.people_facts.read_or_process = lambda ctx: rows

        assert scorer.raw_scores(None, population({"Anna": []}))["Anna"] > 0

    def test_a_fact_on_somebody_outside_the_payloads_is_skipped(self):
        # A regional payload run covers a region; the extraction crawl does not.
        scorer = facts_model([{"person": "node-Nobody"}])

        assert scorer.raw_scores(None, population({"Anna": []})) == {}

    def test_an_export_with_no_matched_facts_is_not_an_error(self):
        scorer = facts_model([])

        assert scorer.raw_scores(None, population({"Anna": []})) == {}
