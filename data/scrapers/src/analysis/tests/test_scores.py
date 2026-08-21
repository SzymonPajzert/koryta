"""The scoring models, and the shared rules about who is worth scoring."""

import pandas as pd
import pytest

from analysis.scores import (
    CompanyScores,
    PeopleScoresCapture,
    PeopleScoresCoappointment,
    PeopleScoresPageRank,
    PeopleScoresTurnover,
)
from analysis.scores.base import (
    Candidacy,
    CompanyFacts,
    Employment,
    PeopleScoreModel,
    Population,
    banded_scores,
)
from analysis.scores.company import company_score_map
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
    """A population built from `{name: [(krs, start), ...]}` and its seeds."""
    posts = {
        name: [
            Employment(krs=krs, role=None, start=start, end=None) for krs, start in v
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

    def test_a_company_is_rated_by_everybody_in_it_it_has_a_rating_for(self):
        payloads = pd.DataFrame.from_records(
            [
                {"name": "Anna", "companies": [{"krs": "1"}, {"krs": "2"}]},
                {"name": "Bogdan", "companies": [{"krs": "1"}]},
                {"name": "Celina", "companies": [{"krs": "2"}]},
            ]
        )

        by_krs = company_score_map(payloads, {"Anna": 5, "Bogdan": 5})

        # Both are somewhere Anna sits, and the confidence factor means the
        # second rating counts: nobody has rated Celina, so company 2 is one
        # person's word against company 1's two.
        assert by_krs["1"] > by_krs["2"]

    def test_a_person_nobody_rated_says_nothing_about_their_employer(self):
        payloads = pd.DataFrame.from_records(
            [{"name": "Celina", "companies": [{"krs": "3"}]}]
        )

        assert company_score_map(payloads, {}) == {}

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
    tags = set()
    for model_type in (
        PeopleScoresPageRank,
        PeopleScoresCoappointment,
        PeopleScoresTurnover,
        PeopleScoresCapture,
    ):
        assert issubclass(model_type, PeopleScoreModel)
        assert is_pipeline_uid(model_type.model_tag)
        tags.add(model_type.model_tag)
    assert len(tags) == 4
