"""Narrowing a payload run to the people the models would have nominated."""

import sys
from unittest.mock import patch

import pandas as pd
import pytest

from analysis.payloads.person import filter_by_score, keep_mask
from analysis.scores import PEOPLE_SCORE_MODELS
from analysis.scores.ensemble import CONFIRMED_BAND, score_payloads
from pipelines import PeoplePayloads
from scrapers.stores import Pipeline

KORYTA = [
    {"id": "n1", "full_name": "Anna", "is_public": True},
    {"id": "n4", "full_name": "Damian", "is_public": False},
]

VOTES = [{"person_koryta_id": "n4", "interesting": -3}]


def payload(name, companies=(), elections=(), autoapprove=False):
    return {
        "name": name,
        "companies": [{"krs": krs} for krs in companies],
        "elections": list(elections),
        "autoapprove": autoapprove,
    }


CANDIDACY = {"election_year": "2018", "teryt": "12", "committee": "KW X"}

PAYLOADS = pd.DataFrame.from_records(
    [
        # On the site and published - the answer key, not a question.
        payload("Anna", companies=["1"]),
        # A stranger, on the same board as Anna, who has stood for office.
        payload("Bogdan", companies=["1"], elections=[CANDIDACY]),
        # A stranger with a company of his own and nothing else.
        payload("Celina", companies=["9"]),
        # On the site, and a human said no.
        payload("Damian", companies=["1"]),
        # Named by one of the hardcoded press lists.
        payload("Ewa", autoapprove=True),
    ]
)


@pytest.fixture
def models():
    """Every model, with the site's export and the register stubbed out."""
    built = [Pipeline.create(model) for model in PEOPLE_SCORE_MODELS]
    for model in built:
        model.people_koryta.read_or_process = lambda ctx: pd.DataFrame.from_records(
            KORYTA
        )
        model.people_votes.read_or_process = lambda ctx: pd.DataFrame.from_records(
            VOTES
        )
        model.companies_krs.read_or_process = lambda ctx: pd.DataFrame()
    return built


@pytest.fixture
def scores(models):
    return score_payloads(None, PAYLOADS, models)


class TestScorePayloads:
    def test_a_published_person_keeps_the_sites_own_verdict(self, scores):
        assert scores["Anna"] == CONFIRMED_BAND

    def test_a_downvoted_person_comes_back_with_nothing(self, scores):
        assert scores["Damian"] == 0

    def test_a_stranger_on_a_confirmed_persons_board_is_rated(self, scores):
        # Nobody has ever voted on Bogdan and the site has no node for him, so
        # the models the site runs today say nothing about him at all. That is
        # the case this scoring exists for.
        assert scores.get("Bogdan", 0) >= 1

    def test_a_stranger_with_no_tie_to_anybody_is_not(self, scores):
        assert scores.get("Celina", 0) == 0


class TestKeepMask:
    def test_keeps_the_people_at_or_above_the_band(self):
        kept = PAYLOADS[keep_mask(PAYLOADS, {"Anna": 5, "Bogdan": 2}, 2)]

        assert set(kept["name"]) == {"Anna", "Bogdan", "Ewa"}

    def test_drops_the_people_below_it(self):
        kept = PAYLOADS[keep_mask(PAYLOADS, {"Anna": 5, "Bogdan": 2}, 3)]

        assert "Bogdan" not in set(kept["name"])

    def test_a_press_list_name_is_listed_whatever_the_models_think(self):
        kept = PAYLOADS[keep_mask(PAYLOADS, {"Ewa": 0}, 5)]

        assert "Ewa" in set(kept["name"])


class TestFilterByScore:
    def test_a_run_without_the_flag_lists_everybody(self):
        assert filter_by_score(None, PAYLOADS, None) is PAYLOADS

    def test_the_flag_is_read_off_extract(self):
        argv = ["koryta", "PeoplePayloads", "--all", "--min-score=2"]
        with patch.object(sys, "argv", argv):
            assert Pipeline.create(PeoplePayloads).people.min_score == 2

    def test_a_run_without_it_asks_extract_for_nothing(self):
        with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
            assert Pipeline.create(PeoplePayloads).people.min_score is None
