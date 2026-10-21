"""Testy backendu SQL.

- `_parse_date` — testy jednostkowe, bez bazy (zawsze).
- Round-trip repozytorium — testy integracyjne wymagające PostgreSQL; uruchamiane
  tylko, gdy ustawiono `TEST_DATABASE_URL` (inaczej pomijane).

Test integracyjny sam tworzy schemat (`sql/02_schema.sql`) w wskazanej bazie
i czyści tabele po sobie.
"""
import os
import sys
from datetime import date
from pathlib import Path

try:
    import pytest
except ImportError:  # pozwala uruchomić testy jednostkowe przez `python tests/...`
    pytest = None

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scraper.models import AgreementDetails, AgreementSearchResult
from scraper.storage.sql_repo import _parse_date

from tests.test_models import DETAILS_RESPONSE, SEARCH_RESPONSE

TEST_DSN = os.getenv("TEST_DATABASE_URL")


# --- Testy jednostkowe: _parse_date -----------------------------------------

def test_parse_date_valid():
    assert _parse_date("17.07.2026") == date(2026, 7, 17)


def test_parse_date_none():
    assert _parse_date(None) is None
    assert _parse_date("") is None


def test_parse_date_invalid():
    assert _parse_date("2026-07-17") is None
    assert _parse_date("22 dni") is None


# --- Testy integracyjne: SqlAgreementRepository -----------------------------
# Definiowane tylko gdy dostępny pytest (używają fixture'ów i skipif).

if pytest is not None:

    pytestmark_db = pytest.mark.skipif(
        not TEST_DSN,
        reason="ustaw TEST_DATABASE_URL, aby uruchomić testy integracyjne",
    )

    @pytest.fixture()
    def repo():
        """Repozytorium na czystym schemacie testowej bazy."""
        import psycopg

        from scraper.storage.sql_repo import SqlAgreementRepository

        schema_sql = (ROOT / "sql" / "02_schema.sql").read_text(encoding="utf-8")
        with psycopg.connect(TEST_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql)
                cur.execute(
                    "TRUNCATE wynik_wyszukiwania, umowa, strona_umowy RESTART IDENTITY"
                )
            conn.commit()

        r = SqlAgreementRepository(dsn=TEST_DSN)
        yield r
        r.close()

    @pytestmark_db
    def test_search_roundtrip(repo):
        result = AgreementSearchResult.from_dict(SEARCH_RESPONSE["content"][0])
        repo.save_search_result(result)

        ids = list(repo.iter_search_ids())
        assert result.id_umowy in ids
        # idempotencja — ponowny zapis nie duplikuje
        repo.save_search_result(result)
        assert list(repo.iter_search_ids()).count(result.id_umowy) == 1

    @pytestmark_db
    def test_save_search_results_batch(repo):
        base = SEARCH_RESPONSE["content"][0]
        # trzy różne pozycje w jednej paczce (jedno zapytanie INSERT)
        batch = [
            AgreementSearchResult.from_dict({**base, "idUmowy": f"00000000-0000-0000-0000-{i:012d}"})
            for i in range(1, 4)
        ]
        repo.save_search_results(batch)
        ids = list(repo.iter_search_ids())
        assert all(r.id_umowy in ids for r in batch)
        assert len(ids) == 3

        # ponowna paczka (idempotencja + UPSERT) nie duplikuje wierszy
        repo.save_search_results(batch)
        assert len(list(repo.iter_search_ids())) == 3

        # pusta paczka jest bezpieczna
        repo.save_search_results([])
        assert len(list(repo.iter_search_ids())) == 3

    @pytestmark_db
    def test_details_roundtrip_and_idempotency(repo):
        details = AgreementDetails.from_dict(DETAILS_RESPONSE)
        assert repo.exists_details(details.id_umowy) is False

        repo.save_details(details)
        assert repo.exists_details(details.id_umowy) is True

        n_stron = len(details.strony_umowy)
        # ponowny zapis nie dubluje wierszy strona_umowy
        repo.save_details(details)
        with repo._conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM strona_umowy WHERE id_umowy = %s",
                (details.id_umowy,),
            )
            assert cur.fetchone()[0] == n_stron

    @pytestmark_db
    def test_save_details_many_batch(repo):
        base = DETAILS_RESPONSE
        # trzy różne umowy w jednej paczce (jedna transakcja wsadowa)
        batch = [
            AgreementDetails.from_dict({**base, "idUmowy": f"00000000-0000-0000-0000-{i:012d}"})
            for i in range(1, 4)
        ]
        repo.save_details_many(batch)
        assert all(repo.exists_details(d.id_umowy) for d in batch)

        # każda umowa ma swoje wiersze strona_umowy (bez pomieszania między umowami)
        n_stron = len(batch[0].strony_umowy)
        with repo._conn.cursor() as cur:
            for d in batch:
                cur.execute(
                    "SELECT count(*) FROM strona_umowy WHERE id_umowy = %s",
                    (d.id_umowy,),
                )
                assert cur.fetchone()[0] == n_stron

        # ponowna paczka (idempotencja + UPSERT) nie dubluje wierszy strona_umowy
        repo.save_details_many(batch)
        with repo._conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM strona_umowy WHERE id_umowy = ANY(%s::uuid[])",
                ([d.id_umowy for d in batch],),
            )
            assert cur.fetchone()[0] == n_stron * len(batch)

        # pusta paczka jest bezpieczna
        repo.save_details_many([])

    @pytestmark_db
    def test_pending_ids(repo):
        search = AgreementSearchResult.from_dict(SEARCH_RESPONSE["content"][0])
        repo.save_search_result(search)

        # bez detali → id na liście oczekujących
        assert search.id_umowy in list(repo.iter_pending_ids())

        # po zapisaniu detali → znika z listy
        repo.save_details(AgreementDetails.from_dict(DETAILS_RESPONSE))
        assert search.id_umowy not in list(repo.iter_pending_ids())

    @pytestmark_db
    def test_mark_details_failed_excludes_from_pending(repo):
        search = AgreementSearchResult.from_dict(SEARCH_RESPONSE["content"][0])
        repo.save_search_result(search)
        assert search.id_umowy in list(repo.iter_pending_ids())

        # po oznaczeniu jako trwale niepobieralna → znika z listy oczekujących
        repo.mark_details_failed(search.id_umowy, "HTTP 500 po 5 próbach")
        assert search.id_umowy not in list(repo.iter_pending_ids())

        # flaga i komunikat błędu utrwalone w wierszu
        with repo._conn.cursor() as cur:
            cur.execute(
                "SELECT detale_niedostepne, detale_blad, detale_niedostepne_od "
                "FROM wynik_wyszukiwania WHERE id_umowy = %s",
                (search.id_umowy,),
            )
            niedostepne, blad, kiedy = cur.fetchone()
            assert niedostepne is True
            assert blad == "HTTP 500 po 5 próbach"
            assert kiedy is not None


if __name__ == "__main__":
    test_parse_date_valid()
    test_parse_date_none()
    test_parse_date_invalid()
    print("OK — testy jednostkowe _parse_date przeszły")
    if not TEST_DSN:
        print("Pominięto testy integracyjne (brak TEST_DATABASE_URL)")
