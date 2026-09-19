"""Tests for the article-person-mentions proof-based confirmation logic."""

import json
from dataclasses import asdict

import pytest

from analysis.article_person_mentions import (
    JudgeCache,
    PersonProfile,
    PersonProfileIndex,
    _confirm_mentions,
    _content_hash,
    _context_window,
    _employed_krs,
    _legacy_ids_by_survivor,
    _load_index_and_profiles,
    _merged_into,
    _org_match_terms,
    _parse_multi_verdict,
    _parse_verdict,
    _party_match_terms,
    _rejestr_io_id,
    _resolve_merged,
    _stem,
)
from entities.article import ArticlePersonMentioned, ProofSignal
from scrapers.article.pipelines.common import ascii_lower
from scrapers.koryta.download import _teryt_from_edges


@pytest.fixture
def profiles_and_map():
    """Small synthetic profile index + region map for unit tests."""
    kmiec_sanok = PersonProfile()
    kmiec_sanok.woj = {"18"}
    kmiec_sanok.powiat = {"1817"}
    kmiec_sanok.parties = {"psl"}
    kmiec_sanok.orgs = {"regionaln", "izb"}

    kmiec_sedziszow = PersonProfile()
    kmiec_sedziszow.woj = {"18"}
    kmiec_sedziszow.powiat = {"1815"}
    kmiec_sedziszow.parties = {"pis"}
    kmiec_sedziszow.orgs = {"gospodark", "komunaln"}

    index = PersonProfileIndex()
    index.add("Bogusław Norbert Kmieć", "p1", kmiec_sanok)
    index.add("Bogusław Kmieć", "p2", kmiec_sedziszow)

    return index


def test_ascii_lower_maps_l():
    assert ascii_lower("spółka Łódź") == "spolka lodz"


def test_teryt_from_edges_splits_woj_powiat_gmina():
    data = {
        "stats": {
            "edges": {
                "all": {
                    "targetNodeIds": [
                        "teryt3062",
                        "teryt06",
                        "teryt1465078",
                        "00Oyv1Uum4rBpIH6AlXV",
                    ]
                }
            }
        }
    }
    woj, powiat = _teryt_from_edges(data)
    assert woj == ["06", "14", "30"]
    assert powiat == ["1465", "3062"]


def test_teryt_from_edges_missing_edges():
    assert _teryt_from_edges({}) == ([], [])
    assert _teryt_from_edges({"stats": {}}) == ([], [])
    assert _teryt_from_edges({"stats": {"edges": {}}}) == ([], [])


def test_stem_reduces_declined_forms():
    assert _stem("przedsiebiorstwa") == "przedsiebiorstw"
    assert _stem("gospodarki") == "gospodark"
    assert _stem("gospodarka") == "gospodark"


def test_org_match_terms_skip_company_form_words():
    terms = _org_match_terms(
        ascii_lower(
            "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej Sp. z o.o."
        )
    )
    assert "gospodark" in terms
    assert "komunaln" in terms
    assert "spolka" not in terms
    assert "spolk" not in terms


def test_party_match_terms_include_short_and_full():
    terms = _party_match_terms("komitet wyborczy prawo i sprawiedliwosc")
    assert "pis" in terms
    assert "prawo i sprawiedliwosc" in terms


def test_party_match_terms_koryta_short_labels():
    assert _party_match_terms("pis") == {"pis", "prawo i sprawiedliwosc"}
    assert _party_match_terms("psl") == {"psl", "polskie stronnictwo ludowe"}
    # PO is an ordinary Polish word, so only the coalition name is searched.
    assert _party_match_terms("po") == {"koalicja obywatelska"}
    assert _party_match_terms("polska 2050") == {"polska 2050", "pl2050"}
    assert _party_match_terms("nowa lewica") == {"nowa lewica"}
    assert _party_match_terms("konfederacja") == {"konfederacja"}


def test_rejestr_io_id_extraction():
    assert _rejestr_io_id("https://rejestr.io/osoby/2786228") == "2786228"
    assert _rejestr_io_id("https://rejestr.io/osoby/2786228/") == "2786228"
    assert _rejestr_io_id(None) == ""
    assert _rejestr_io_id("") == ""


def test_employed_krs_resolves_via_rejestrio():
    person_krs = {"2786228": {"0000084967", "0000123456"}}
    assert _employed_krs(
        {"rejestrIo": "https://rejestr.io/osoby/2786228"}, person_krs
    ) == {"0000084967", "0000123456"}
    assert _employed_krs({"rejestrIo": None}, person_krs) == set()
    assert (
        _employed_krs({"rejestrIo": "https://rejestr.io/osoby/999"}, person_krs)
        == set()
    )


class FakeDomainMap:
    def __init__(self, powiat, woj):
        self._powiat = powiat
        self._woj = woj

    def powiat_codes(self, domain):
        return self._powiat

    def woj_codes(self, domain):
        return self._woj


def test_region_powiat_confirms(profiles_and_map):
    domain_map = FakeDomainMap({"1817"}, {"18"})
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć", "Bogusław Norbert Kmieć"},
        "Burmistrz Sanoka Bogusław Kmieć nie dostał wotum zaufania.",
        "esanok.pl",
        profiles_and_map,
        domain_map,
    )
    assert "Bogusław Norbert Kmieć" in confirmed
    assert "p1" in confirmed["Bogusław Norbert Kmieć"]
    assert any(
        s.type == "region" and s.value == "powiat"
        for s in confirmed["Bogusław Norbert Kmieć"]["p1"]
    )
    assert "Bogusław Kmieć" not in confirmed


def test_region_woj_fallback_does_not_confirm_with_powiat(profiles_and_map):
    # Same woj (18) but wrong powiat -> woj fallback must NOT confirm
    domain_map = FakeDomainMap(set(), {"18"})
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć w jakimś artykule z województwa podkarpackiego.",
        "rrs24.net",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_party_abbreviation_confirms(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Poseł PiS Bogusław Kmieć skomentował sprawę.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed["Bogusław Kmieć"]["p2"] == [
        ProofSignal(type="party", value="pis")
    ]


def test_party_not_confirmed_by_partial_word(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć spisał oświadczenie.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_organization_stems_confirm(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć z Przedsiębiorstwa Gospodarki Komunalnej i Mieszkaniowej.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert "Bogusław Kmieć" in confirmed
    assert any(
        s.type == "organization" for s in confirmed["Bogusław Kmieć"]["p2"]
    )


def test_no_proof_drops(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć był na spotkaniu sąsiedzkim.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_entity_has_structured_proof_and_verdict_fields():
    record = ArticlePersonMentioned(
        url="x",
        person="Jan Kowalski",
        person_id="123",
        domain="y",
        title="t",
        date="2020-01-01",
        tags=[],
        proof=[
            ProofSignal(type="region", value="powiat"),
            ProofSignal(type="party", value="pis"),
        ],
        verdict="yes",
        justification="kontekst się zgadza",
    )
    assert record.proof[0].type == "region"
    assert record.proof[0].value == "powiat"
    assert record.proof[0].matched is True
    assert record.proof[1].type == "party"
    assert record.verdict == "yes"
    assert json.dumps(asdict(record))  # serializable


def test_parse_verdict_justification_then_label():
    text = (
        "<think>Sprawdzam kontekst.</think>\n"
        "Uzasadnienie: Artykuł opisuje Marka Sowę jako krytyka rządzących, "
        "a w danych ma partie PiS - to rozbieżność.\n"
        "Werdykt: NIE\n"
    )
    verdict, justification = _parse_verdict(text)
    assert verdict == "no"
    assert "krytyka rządzących" in justification


def test_parse_verdict_unclosed_think_block():
    # A response truncated while still inside <think> has no usable verdict.
    verdict, justification = _parse_verdict(
        "<think>Porównuję kontekst, sprawdzam partie, regiony, organizacje, "
        "analizuję szczegółowo wszystko co można przeanalizować w tym artykule"
    )
    assert verdict == "unknown"
    assert "<think>" not in justification


def test_context_window_centers_on_name():
    content = "początek " + ("x " * 5000) + " Jan Kowalski " + ("y " * 5000) + " koniec"
    window = _context_window(content, "Jan Kowalski")
    assert "Jan Kowalski" in window
    assert "początek" not in window
    assert "koniec" not in window

    # short content returns whole text
    short = "Krótki artykuł o Janie Kowalskim."
    assert _context_window(short, "Jan Kowalski") == short


def test_parse_verdict_bare_label_fallback():
    verdict, _ = _parse_verdict("Artykuł wyraźnie opisuje posła PiS z Podlasia. TAK")
    assert verdict == "yes"
    verdict, _ = _parse_verdict("Nie mam pewności, czy to ta sama osoba.")
    assert verdict == "unknown"


def test_parse_multi_verdict_picks_candidate():
    text = (
        "<think>Porównuję kandydatów.</think>\n"
        "Uzasadnienie: Artykuł opisuje posła PiS, pasuje K2.\n"
        "Werdykt: K2\n"
    )
    matched, verdict, just = _parse_multi_verdict(text, 3)
    assert verdict == "yes"
    assert matched == "K2"
    assert "K2" in just or "piS" in just

    matched, verdict, _ = _parse_multi_verdict(
        "Uzasadnienie: Żadna osoba nie pasuje.\nWerdykt: NIE\n", 3
    )
    assert verdict == "no"
    assert matched == ""


# --- merged-away people resolve to their survivor -------------------------- #


def _person_row(person_id: str, name: str, **extra):
    row = {
        "id": person_id,
        "full_name": name,
        "parties": [],
        "teryt_wojewodztwo": [],
        "teryt_powiat": [],
    }
    row.update(extra)
    return row


def test_merged_into_reads_only_a_real_survivor_id():
    assert _merged_into({"merged_into": "survivor"}) == "survivor"
    assert _merged_into({"merged_into": None}) is None
    assert _merged_into({"merged_into": ""}) is None
    assert _merged_into({"merged_into": "   "}) is None
    assert _merged_into({"merged_into": float("nan")}) is None
    assert _merged_into({}) is None


def test_resolve_merged_follows_a_chain_to_the_end():
    by_id = {
        "a": _person_row("a", "A", merged_into="b"),
        "b": _person_row("b", "B", merged_into="c"),
        "c": _person_row("c", "C"),
    }
    assert _resolve_merged("a", by_id) == "c"
    assert _resolve_merged(None, by_id) is None
    assert _resolve_merged("missing", by_id) is None


def test_resolve_merged_survives_a_cycle():
    by_id = {
        "a": _person_row("a", "A", merged_into="b"),
        "b": _person_row("b", "B", merged_into="a"),
    }
    # A cycle is broken rather than followed for ever.
    assert _resolve_merged("a", by_id) is None


def test_load_index_aliases_merged_name_onto_the_survivor():
    rows = [
        _person_row("p1", "Marian Antoni Uherek"),
        _person_row("p2", "Marian Uherek", merged_into="p1"),
    ]
    index, profiles = _load_index_and_profiles(rows, {}, {})
    # The duplicate's shorter name now resolves to the survivor's display, and
    # therefore to the survivor's id - never to the tombstone p2.
    assert index.find_in_text("Marian Uherek") == {"Marian Antoni Uherek"}
    assert index.find_in_text("Marian Antoni Uherek") == {"Marian Antoni Uherek"}
    candidates = profiles.candidates("Marian Antoni Uherek")
    assert [pid for pid, _ in candidates] == ["p1"]


def test_load_index_matches_when_article_drops_the_middle_name():
    # The article says "Tomasz Kotajny"; we hold the register's full name.
    # Registering only full_name left every middle-name person unmatchable.
    index, _ = _load_index_and_profiles(
        [_person_row("p1", "Tomasz Jerzy Kotajny")], {}, {}
    )
    assert index.find_in_text("dyrektor Tomasz Kotajny odszedł") == {
        "Tomasz Jerzy Kotajny"
    }


def test_load_index_matches_a_hyphenated_surname_in_the_article():
    # We hold the shorter form; the article uses the married hyphenated one.
    index, _ = _load_index_and_profiles(
        [_person_row("p1", "Magdalena Porzucek")], {}, {}
    )
    assert index.find_in_text("jego żona Magdalena Zgiep-Porzucek") == {
        "Magdalena Porzucek"
    }


def test_load_index_matches_when_article_uses_the_shorter_surname():
    # The mirror case: we hold the hyphenated form, the article uses one half.
    index, _ = _load_index_and_profiles(
        [_person_row("p1", "Magdalena Zgiep-Porzucek")], {}, {}
    )
    assert index.find_in_text("radna Magdalena Porzucek") == {
        "Magdalena Zgiep-Porzucek"
    }


def test_load_index_does_not_match_a_lone_surname():
    # Last-name-only is deliberately not a form: "Wolski" alone is three people.
    index, _ = _load_index_and_profiles([_person_row("p1", "Piotr Wolski")], {}, {})
    assert index.find_in_text("Wolski powiedział, że") == set()


def test_load_index_keeps_unmerged_people_when_column_absent():
    rows = [_person_row("p1", "Jan Kowalski"), _person_row("p2", "Anna Nowak")]
    index, _ = _load_index_and_profiles(rows, {}, {})
    assert index.find_in_text("Anna Nowak") == {"Anna Nowak"}


def test_load_index_drops_a_merged_name_with_no_survivor():
    rows = [_person_row("p2", "Anna Nowak", merged_into="gone")]
    index, _ = _load_index_and_profiles(rows, {}, {})
    assert index.find_in_text("Anna Nowak") == set()


# --- judge verdict cache --------------------------------------------------- #


def test_content_hash_is_stable_and_content_sensitive():
    assert _content_hash("ten sam tekst") == _content_hash("ten sam tekst")
    assert _content_hash("a") != _content_hash("b")


def test_legacy_ids_by_survivor_maps_the_duplicate():
    rows = [
        {"id": "surv", "full_name": "Marian Antoni Uherek"},
        {"id": "dup", "full_name": "Marian Uherek", "merged_into": "surv"},
    ]
    assert _legacy_ids_by_survivor(rows) == {"surv": {"dup"}}


def test_judge_cache_roundtrip_persists(tmp_path):
    path = tmp_path / "judge_cache.jsonl"
    cache = JudgeCache(path)
    h = _content_hash("artykul")
    assert cache.lookup(h, "a.pl/1", "p1") is None
    cache.store(h, "p1", "yes", "uzasadnienie")
    assert cache.lookup(h, "a.pl/1", "p1") == ("yes", "uzasadnienie")
    # A fresh instance reads it back off disk.
    assert JudgeCache(path).lookup(h, "a.pl/1", "p1") == ("yes", "uzasadnienie")


def test_judge_cache_does_not_store_unknown(tmp_path):
    cache = JudgeCache(tmp_path / "c.jsonl")
    cache.store("h", "p1", "unknown", "brak")
    assert cache.lookup("h", "a.pl/1", "p1") is None


def test_judge_cache_reuses_a_verdict_across_a_merge(tmp_path):
    path = tmp_path / "c.jsonl"
    h = _content_hash("artykul")
    JudgeCache(path).store(h, "dup", "yes", "uzasadnienie")
    # The pair was judged under the duplicate's id; the new run resolves to the
    # survivor, which is the id that merged the duplicate in.
    cache = JudgeCache(path, legacy_ids={"surv": {"dup"}})
    assert cache.lookup(h, "a.pl/1", "surv") == ("yes", "uzasadnienie")


def test_judge_cache_seeds_from_previous_output_by_url(tmp_path):
    out = tmp_path / "article_person_mentions.jsonl"
    out.write_text(
        json.dumps(
            {
                "url": "a.pl/1",
                "person": "Jan Kowalski",
                "person_id": "p1",
                "verdict": "no",
                "justification": "inna osoba",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    cache = JudgeCache(tmp_path / "c.jsonl")
    assert cache.seed_from_output(out) == 1
    # No content hash needed: the seed is keyed by url.
    assert cache.lookup(_content_hash("cokolwiek"), "a.pl/1", "p1") == (
        "no",
        "inna osoba",
    )
