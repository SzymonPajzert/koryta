"""The chance that a person's page gets published, and the facts it reads."""

import numpy as np
import pandas as pd

from analysis.scores import PEOPLE_SCORE_MODELS
from analysis.scores.base import Employment, Population
from analysis.scores.publishable import (
    MAX_YEARS_SINCE_STOOD,
    PeopleScoresPublishable,
    PublishFacts,
    chance,
    chance_band,
    site_facts,
)
from scrapers.koryta.download import KorytaEdges, KorytaNodes
from scrapers.stores import Pipeline


def node(id, type, **fields):
    return {
        "id": id,
        "type": type,
        "parties": None,
        "isPublic": None,
        "supervisoryBody": None,
    } | fields


def edge(type, source, target, **fields):
    return {
        "type": type,
        "source": source,
        "target": target,
        "name": None,
        "start_date": None,
        "end_date": None,
        "position": None,
        "party": None,
        "committee": None,
        "elected": None,
        "deleted": None,
    } | fields


def general_election(year, n=1000):
    """Enough strangers' local candidacies for `year` to be a general election."""
    return [
        edge(
            "election",
            f"x{i}",
            "teryt0201",
            position="Rada gminy",
            start_date=f"{year}-01-01",
        )
        for i in range(n)
    ]


NODES = pd.DataFrame(
    [
        node("anna", "person"),
        node("beata", "person", parties=["PSL"]),
        node("celina", "person"),
        node("dorota", "person"),
        node("wodociagi", "place", isPublic=True),
        node("szpital", "place", isPublic=True, supervisoryBody="rada-spoleczna"),
        node("sklep", "place", isPublic=False),
        node("teryt1261", "region"),
        node("teryt2261", "region"),
    ]
)
EDGES = pd.DataFrame(
    [
        edge("seat", "teryt1261", "wodociagi"),
        edge("seat", "teryt1261", "szpital"),
        # Anna: councillor in Kraków since 2024, board of the city's water company.
        edge(
            "election",
            "anna",
            "teryt1261",
            position="Rada miasta",
            start_date="2024-01-01",
            elected=True,
            committee="KWW Kraków",
        ),
        edge(
            "election",
            "anna",
            "teryt1261",
            position="Rada miasta",
            start_date="2018-01-01",
            elected=False,
            committee="KWW Kraków",
        ),
        edge("employed", "anna", "wodociagi", name="Zarząd", start_date="2025-02-01"),
        # Beata: never stood; only a seat on a hospital's rada społeczna.
        edge("employed", "beata", "szpital", name="Rada Nadzorcza"),
        # Celina: lost in Gdańsk long ago, works in a private shop; her win was removed.
        edge(
            "election",
            "celina",
            "teryt2261",
            position="Rada gminy",
            start_date="2006-01-01",
        ),
        edge(
            "election",
            "celina",
            "teryt2261",
            position="Wójt",
            start_date="2024-01-01",
            elected=True,
            deleted=True,
        ),
        edge("employed", "celina", "sklep", name="Zarząd"),
        *general_election(2024),
        *general_election(2018),
    ]
)


class TestSiteFacts:
    def facts(self):
        return site_facts(NODES, EDGES, as_of_year=2026)

    def test_a_councillor_on_her_towns_company_board(self):
        anna = self.facts()["anna"]

        assert anna == PublishFacts(
            candidacies=2,
            wins=1,
            won_local=True,
            won_latest_local=True,
            years_since_stood=2,
            on_a_list_or_party=True,
            paid_post=True,
            rada_spoleczna_only=False,
            stood_where_works=True,
        )

    def test_a_rada_spoleczna_seat_is_not_a_paid_post(self):
        beata = self.facts()["beata"]

        assert (beata.paid_post, beata.rada_spoleczna_only) == (False, True)
        # Never stood, but the page names a party.
        assert beata.on_a_list_or_party
        assert beata.years_since_stood == MAX_YEARS_SINCE_STOOD

    def test_a_removed_candidacy_counts_for_nothing(self):
        celina = self.facts()["celina"]

        assert (celina.candidacies, celina.wins, celina.won_local) == (1, 0, False)
        assert celina.years_since_stood == 20
        # Neither a public post nor the place she stood in.
        assert (celina.paid_post, celina.stood_where_works) == (False, False)

    def test_a_page_with_no_edges_is_still_a_page(self):
        assert self.facts()["dorota"] == PublishFacts()

    def test_the_latest_general_election_ignores_a_by_election(self):
        by_election = pd.concat(
            [
                EDGES,
                pd.DataFrame(
                    [
                        edge(
                            "election",
                            "dorota",
                            "teryt1261",
                            position="Wójt",
                            start_date="2025-06-01",
                            elected=True,
                        )
                    ]
                ),
            ]
        )

        facts = site_facts(NODES, by_election, as_of_year=2026)

        # 2025 has one candidacy, so 2024 is still the latest general election:
        # Anna keeps her current term, and Dorota's by-election win is not one.
        assert facts["anna"].won_latest_local
        assert facts["dorota"].won_local and not facts["dorota"].won_latest_local


class TestChance:
    def test_the_publishing_rules_point_the_right_way(self):
        councillor = PublishFacts(
            candidacies=1,
            wins=1,
            won_local=True,
            won_latest_local=True,
            years_since_stood=2,
            on_a_list_or_party=True,
            paid_post=True,
        )
        nobody = PublishFacts()

        assert chance(councillor) > 0.3 > chance(nobody)
        assert chance(councillor) > chance(
            PublishFacts(**{**councillor.__dict__, "paid_post": False})
        )
        assert chance(councillor) > chance(
            PublishFacts(
                **{
                    **councillor.__dict__,
                    "paid_post": False,
                    "rada_spoleczna_only": True,
                }
            )
        )

    def test_bands_start_at_fixed_chances(self):
        chances = (0.95, 0.9, 0.89, 0.75, 0.6, 0.5, 0.2, 0.15, 0.14, 0.0)
        assert [chance_band(v) for v in chances] == [5, 5, 4, 4, 3, 3, 2, 2, 1, 1]


class TestModel:
    def scorer(self):
        scorer = Pipeline.create(PeopleScoresPublishable)
        scorer.koryta_nodes.read_or_process = lambda ctx: NODES
        scorer.koryta_edges.read_or_process = lambda ctx: EDGES
        return scorer

    def population(self, shortlist):
        return Population(
            people=pd.DataFrame(),
            node_ids={
                "Anna": "anna",
                "Beata": "beata",
                "Nowa": "created-after-the-export",
            },
            employments={
                "Anna": [Employment(krs="1", role=None, start=None, end=None)]
            },
            candidacies={},
            roster={},
            companies={},
            seed_weights={},
            shortlist=shortlist,
        )

    def test_scores_the_shortlist_but_not_a_page_the_export_lacks(self):
        scores = self.scorer().raw_scores(
            None, self.population(["Anna", "Beata", "Nowa"])
        )

        assert set(scores) == {"Anna", "Beata"}
        assert scores["Anna"] > scores["Beata"]

    def test_bands_by_the_chance_not_by_rank(self):
        # Rank banding would give the only person scored the top band.
        assert self.scorer().bands({"Beata": 0.2}) == {"Beata": 2}

    def test_it_is_one_of_the_nights_models(self):
        assert PeopleScoresPublishable in PEOPLE_SCORE_MODELS
        assert np.isclose(
            sum(1 for m in PEOPLE_SCORE_MODELS if m is PeopleScoresPublishable), 1
        )


def test_the_facts_survive_the_trip_through_the_nights_cache(tmp_path):
    """The night reads `KorytaNodes` and `KorytaEdges` back off disk with their
    dtypes, where a flag arrives as 1.0 / 0.0 / NaN and a year as text; the
    refit reads the export's own values. Both must give the same facts."""
    read = {}
    for name, frame, reader in (
        ("nodes", NODES, KorytaNodes),
        ("edges", EDGES, KorytaEdges),
    ):
        path = tmp_path / f"koryta_{name}.jsonl"
        frame.reindex(columns=reader.fields).to_json(path, orient="records", lines=True)
        read[name] = pd.read_json(path, lines=True, dtype=reader.dtype)

    assert site_facts(read["nodes"], read["edges"], as_of_year=2026) == site_facts(
        NODES, EDGES, as_of_year=2026
    )
