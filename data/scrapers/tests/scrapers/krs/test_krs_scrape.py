import pytest
from scrapers.krs.scrape import QueryRelation, CompanyGraph, Company
from scrapers.krs.process import KRS


def test_query_relation_from_rejestrio():
    relation_dict = {"typ": "KRS_SHAREHOLDER", "kierunek": "PASYWNY"}
    qr = QueryRelation.from_rejestrio(relation_dict)
    assert qr.relation == "KRS_SHAREHOLDER"
    assert qr.direction == "PASYWNY"


def test_query_relation_is_child():
    # Test parent relations
    assert QueryRelation("KRS_ONLY_SHAREHOLDER", "PASYWNY").is_child() is True
    assert QueryRelation("KRS_SHAREHOLDER", "PASYWNY").is_child() is True
    assert QueryRelation("KRS_SUPERVISION", "PASYWNY").is_child() is True
    assert QueryRelation("KRS_FOUNDER", "PASYWNY").is_child() is True

    # Test ignored parent relations
    assert QueryRelation("KRS_BOARD", "PASYWNY").is_child() is False
    assert QueryRelation("KRS_MEMBER", "PASYWNY").is_child() is False
    assert QueryRelation("KRS_COMMISSIONER", "PASYWNY").is_child() is False
    assert QueryRelation("KRS_RECEIVER", "PASYWNY").is_child() is False
    assert QueryRelation("KRS_GENERAL_PARTNER", "PASYWNY").is_child() is False
    assert QueryRelation("KRS_RESTRUCTURIZATOR", "PASYWNY").is_child() is False

    # Test active direction
    assert QueryRelation("KRS_ONLY_SHAREHOLDER", "AKTYWNY").is_child() is False

    # Test unknown relation
    with pytest.raises(ValueError):
        QueryRelation("UNKNOWN_RELATION", "PASYWNY").is_child()


@pytest.fixture
def mock_iterate_blobs(monkeypatch):
    def mock_return():
        yield (
            "hostname=rejestr.io/date=2025-09-28/api/v2/org/0000000001/krs-powiazania/aktualnosc_aktualne",
            [
                {
                    "typ": "organizacja",
                    "numery": {"krs": "0000000002"},
                    "nazwy": {"pelna": "Child Company 1"},
                    "krs_powiazania_kwerendowane": [
                        {"typ": "KRS_SHAREHOLDER", "kierunek": "PASYWNY"}
                    ],
                },
                {
                    "typ": "organizacja",
                    "numery": {"krs": "0000000003"},
                    "nazwy": {"pelna": "Child Company 2"},
                    "krs_powiazania_kwerendowane": [
                        {"typ": "KRS_SHAREHOLDER", "kierunek": "PASYWNY"}
                    ],
                },
            ],
        )
        yield (
            "hostname=rejestr.io/date=2025-09-28/api/v2/org/0000000002/krs-powiazania/aktualnosc_aktualne",
            [
                {
                    "typ": "organizacja",
                    "numery": {"krs": "0000000004"},
                    "nazwy": {"pelna": "Grandchild Company"},
                    "krs_powiazania_kwerendowane": [
                        {"typ": "KRS_SHAREHOLDER", "kierunek": "PASYWNY"}
                    ],
                }
            ],
        )

    monkeypatch.setattr("scrapers.krs.scrape.iterate_blobs", mock_return)


def test_company_graph_init(mock_iterate_blobs):
    graph = CompanyGraph()
    assert len(graph.companies) == 3
    assert KRS("0000000002") in graph.companies
    assert KRS("0000000003") in graph.companies
    assert KRS("0000000004") in graph.companies

    assert graph.companies[KRS("0000000002")] == Company(
        krs=KRS("0000000002"), name="Child Company 1", parent=KRS("0000000001")
    )

    assert KRS("0000000001") in graph.children
    assert len(graph.children[KRS("0000000001")]) == 2
    assert KRS("0000000002") in graph.children[KRS("0000000001")]
    assert KRS("0000000003") in graph.children[KRS("0000000001")]


def test_company_graph_all_descendants(mock_iterate_blobs):
    graph = CompanyGraph()
    descendants = graph.all_descendants([KRS("0000000001")])
    assert descendants == {
        KRS("0000000001"),
        KRS("0000000002"),
        KRS("0000000003"),
        KRS("0000000004"),
    }
