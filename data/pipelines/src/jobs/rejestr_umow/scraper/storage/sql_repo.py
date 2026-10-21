from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable, Optional

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

import config
from scraper.models import AgreementDetails, AgreementSearchResult
from scraper.storage.base import AgreementRepository

log = logging.getLogger(__name__)


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d.%m.%Y").date()
    except (ValueError, TypeError):
        log.warning("Nierozpoznany format daty: %r — zapisuję NULL", value)
        return None


def _jsonb(value: Any) -> Optional[Jsonb]:
    return None if value is None else Jsonb(value)




def _values_clause(nrows: int, ncols: int) -> sql.Composed:
    row = sql.SQL("({})").format(
        sql.SQL(", ").join(sql.Placeholder() for _ in range(ncols))
    )
    return sql.SQL(", ").join(row for _ in range(nrows))


def _insert_sql(table: str, columns: tuple[str, ...], nrows: int) -> sql.Composed:
    return sql.SQL("INSERT INTO {tab} ({cols}) VALUES {vals}").format(
        tab=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in columns),
        vals=_values_clause(nrows, len(columns)),
    )


def _upsert_sql(table: str, columns: tuple[str, ...], nrows: int) -> sql.Composed:
    updates = sql.SQL(", ").join(
        sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(c))
        for c in columns[1:]
    )
    return sql.SQL("{insert} ON CONFLICT ({pk}) DO UPDATE SET {updates}").format(
        insert=_insert_sql(table, columns, nrows),
        pk=sql.Identifier(columns[0]),
        updates=updates,
    )


def _flatten(rows: list[tuple]) -> list:
    return [value for row in rows for value in row]


_SEARCH_COLUMNS = (
    "id_umowy", "nazwa", "regon",
    "data_zawarcia_umowy", "data_zakonczenia_umowy",
    "wartosc_przedmiotu_umowy", "przedmiot_umowy", "status_umowy",
)


def _search_row(r: AgreementSearchResult) -> tuple:
    return (
        r.id_umowy,
        r.nazwa,
        r.regon,
        _parse_date(r.data_zawarcia_umowy),
        _parse_date(r.data_zakonczenia_umowy),
        r.wartosc_przedmiotu_umowy,
        r.przedmiot_umowy,
        r.status_umowy,
    )


_UMOWA_COLUMNS = (
    "id_umowy",
    "status_umowy", "numer_umowy", "brak_numeru_umowy",
    "data_zawarcia_umowy", "data_zakonczenia_umowy",
    "umowa_na_czas_nieoznaczony", "okres",
    "przedmiot_umowy", "niejawnosc_przedmiotu",
    "wartosc_przedmiotu", "niejawnosc_wartosci_przedmiotu",
    "opis_wartosci_przedmiotu",
    "finansowana_ze_srodkow", "zmiany_umowy",
    "data_publikacji", "data_modyfikacji",
)


def _umowa_row(d: AgreementDetails) -> tuple:
    """Krotka wartości dla jednego wiersza `umowa` (kolejność = _UMOWA_COLUMNS)."""
    pd = d.podstawowe_dane
    oo = d.okres_obowiazywania
    su = d.szczegoly_umowy
    return (
        d.id_umowy,
        pd.status_umowy, pd.numer_umowy, pd.brak_numeru_umowy,
        _parse_date(pd.data_zawarcia_umowy), _parse_date(pd.data_zakonczenia_umowy),
        oo.umowa_na_czas_nieoznaczony, oo.okres,
        su.przedmiot_umowy, _jsonb(su.niejawnosc_przedmiotu),
        su.wartosc_przedmiotu, _jsonb(su.niejawnosc_wartosci_przedmiotu),
        su.opis_wartosci_przedmiotu,
        d.finansowana_ze_srodkow, _jsonb(d.zmiany_umowy),
        _parse_date(d.data_publikacji), _parse_date(d.data_modyfikacji),
    )


_STRONA_COLUMNS = (
    "id_umowy",
    "kraj", "rodzaj", "nazwa", "nip", "regon", "imie", "nazwisko",
    "czy_konsorcjum", "niejawnosc_strony",
    "ulica", "numer_nieruchomosci", "numer_lokalu",
    "wojewodztwo", "powiat", "gmina_miasto_dzielnica",
    "miejscowosc", "kod_pocztowy",
)


def _strona_row(id_umowy: str, s: Any) -> tuple:
    """Krotka wartości dla jednego wiersza `strona_umowy` (kolejność = _STRONA_COLUMNS)."""
    a = s.dane_adresowe
    return (
        id_umowy,
        s.kraj, s.rodzaj, s.nazwa, s.nip, s.regon, s.imie, s.nazwisko,
        s.czy_konsorcjum, _jsonb(s.niejawnosc_strony),
        a.ulica if a else None,
        a.numer_nieruchomosci if a else None,
        a.numer_lokalu if a else None,
        a.wojewodztwo if a else None,
        a.powiat if a else None,
        a.gmina_miasto_dzielnica if a else None,
        a.miejscowosc if a else None,
        a.kod_pocztowy if a else None,
    )


class SqlAgreementRepository(AgreementRepository):
    def __init__(self, dsn: str = config.DATABASE_URL) -> None:
        self._conn = psycopg.connect(dsn)
        self._conn.autocommit = False

    def save_search_result(self, result: AgreementSearchResult) -> None:
        self.save_search_results([result])

    def save_search_results(self, results: Iterable[AgreementSearchResult]) -> None:
        by_id = {r.id_umowy: r for r in results}
        rows = [_search_row(r) for r in by_id.values()]
        if not rows:
            return

        query = _upsert_sql("wynik_wyszukiwania", _SEARCH_COLUMNS, len(rows))
        with self._conn.cursor() as cur:
            cur.execute(query, _flatten(rows))
        self._conn.commit()

    def exists_search_result(self, id_umowy: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM wynik_wyszukiwania WHERE id_umowy = %s", (id_umowy,)
            )
            return cur.fetchone() is not None

    def iter_search_ids(self) -> Iterable[str]:
        with self._conn.cursor(name="search_ids") as cur:
            cur.execute("SELECT id_umowy FROM wynik_wyszukiwania ORDER BY id_umowy")
            for (id_umowy,) in cur:
                yield str(id_umowy)

    # -- Detale ---------------------------------------------------------------

    def save_details(self, details: AgreementDetails) -> None:
        self.save_details_many([details])

    def save_details_many(self, items: Iterable[AgreementDetails]) -> None:
        by_id = {d.id_umowy: d for d in items}
        details_list = list(by_id.values())
        if not details_list:
            return

        ids = list(by_id.keys())
        umowa_rows = [_umowa_row(d) for d in details_list]
        strona_rows = [
            _strona_row(d.id_umowy, s)
            for d in details_list
            for s in d.strony_umowy
        ]

        with self._conn.cursor() as cur:
            cur.execute(
                _upsert_sql("umowa", _UMOWA_COLUMNS, len(umowa_rows)),
                _flatten(umowa_rows),
            )
            cur.execute(
                "DELETE FROM strona_umowy WHERE id_umowy = ANY(%s::uuid[])", (ids,)
            )
            if strona_rows:
                cur.execute(
                    _insert_sql("strona_umowy", _STRONA_COLUMNS, len(strona_rows)),
                    _flatten(strona_rows),
                )
        self._conn.commit()

    def exists_details(self, id_umowy: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1 FROM umowa WHERE id_umowy = %s", (id_umowy,))
            return cur.fetchone() is not None

    def mark_details_failed(self, id_umowy: str, error: Optional[str] = None) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE wynik_wyszukiwania
                SET detale_niedostepne = true,
                    detale_blad = %s,
                    detale_niedostepne_od = now()
                WHERE id_umowy = %s
                """,
                (error, id_umowy),
            )
        self._conn.commit()

    def iter_pending_ids(self) -> Iterable[str]:
        with self._conn.cursor(name="pending_ids") as cur:
            cur.execute(
                """
                SELECT w.id_umowy
                FROM wynik_wyszukiwania w
                LEFT JOIN umowa u ON u.id_umowy = w.id_umowy
                WHERE u.id_umowy IS NULL
                  AND NOT w.detale_niedostepne
                ORDER BY w.id_umowy
                """
            )
            for (id_umowy,) in cur:
                yield str(id_umowy)

    def close(self) -> None:
        self._conn.close()
