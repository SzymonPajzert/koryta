# Scraper Rejestru Umów (rejestrumow.gov.pl)

Pobiera dane o umowach z [rejestrumow.gov.pl](https://rejestrumow.gov.pl/):
listę umów oraz szczegóły każdej z nich. Wyniki można zapisywać do bazy
**PostgreSQL** (domyślnie) albo do plików **JSON** — warstwa zapisu jest
odseparowana wspólnym interfejsem (`AgreementRepository`), więc backend wybiera
się flagą `--storage` bez zmian w reszcie kodu.

## Instalacja

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Uruchomienie

> Domyślnym backendem zapisu jest baza **PostgreSQL** (`--storage db`). Przed
> pierwszym uruchomieniem przygotuj bazę i połączenie — patrz sekcja
> [Backend bazodanowy (PostgreSQL)](#backend-bazodanowy-postgresql). Aby szybko
> przetestować bez bazy, dodaj `--storage json`.

```bash
python main.py --max-records 20     # szybki smoke test (20 umów, do bazy)
python main.py                      # pełny scrape: lista + detale wszystkich umów
python main.py --search-only        # tylko lista umów
python main.py --details-only       # tylko detale dla już pobranej listy
python main.py --details-only --max-details 500   # detale, ale najwyżej 500 umów na przebieg
python main.py --from 2026-07-01 --to 2026-07-02   # zakres dat zawarcia umowy
python main.py --storage json --max-records 20     # test bez bazy (pliki JSON)
```

Najważniejsze opcje CLI:

| Opcja            | Opis                                             |
|------------------|--------------------------------------------------|
| `--page-size N`  | rozmiar strony wyszukiwania (domyślnie 50)       |
| `--max-records N`| limit pobieranych pozycji (do testów)            |
| `--max-details N`| limit umów przetwarzanych w etapie detali (jeden przebieg) |
| `--offset N`     | offset początkowy wyszukiwania (wznawianie)      |
| `--from RRRR-MM-DD` | filtr: data zawarcia umowy OD (opcjonalny)    |
| `--to RRRR-MM-DD`   | filtr: data zawarcia umowy DO (opcjonalny)    |
| `--sort-key K`   | klucz sortowania przekazywany do API             |
| `--incremental`  | pobieraj strony tylko do pierwszej umowy już obecnej w bazie |
| `--throttle S`   | opóźnienie między żądaniami w sekundach           |
| `--storage {json,db}` | backend zapisu (domyślnie `db`)             |
| `--data-dir DIR` | katalog wyjściowy dla backendu `json` (domyślnie `data/`) |
| `--dsn DSN`      | DSN połączenia dla backendu `db`                 |
| `-v`             | logowanie DEBUG                                  |

Backend bazodanowy — patrz sekcja [Backend bazodanowy (PostgreSQL)](#backend-bazodanowy-postgresql).

## Źródła danych (API)

Ustalone przez zbadanie działającego serwisu:

- **Wyszukiwanie** — `POST /api-dp/v1/agreements/search?offset=&limit=&sortKey=`,
  ciało JSON z filtrami (pusty obiekt `{}` też działa). Zwraca stronę wyników
  z `content[]`, `totalElements` itd. Zakres dat zawarcia umowy przekazuje się
  w ciele jako `menuGlowne` (patrz opcje `--from` / `--to`):

  ```json
  {"menuGlowne": {"dataZawarciaOd": "2026.07.01", "dataZawarciaDo": "2026.07.02"}}
  ```
- **Detale umowy** — `GET /api-dp/v1/agreement/{idUmowy}`. Zwraca zagnieżdżoną
  strukturę (dane podstawowe, okres, szczegóły, strony umowy z adresami, ...).

Serwis stoi za CDN Imperva — klient wysyła nagłówek `User-Agent`, stosuje
throttling i ponawia żądania z wykładniczym backoffem na `429`/`5xx`/błędy sieci.

## Format wyników (backend JSON)

Dotyczy backendu `--storage json`. Układ danych w bazie opisuje sekcja
[Backend bazodanowy (PostgreSQL)](#backend-bazodanowy-postgresql).

```
data/
├── search_index.jsonl        # jedna pozycja wyszukiwania na linię (JSON Lines)
└── details/
    └── {id_umowy}.json       # pełne detale pojedynczej umowy
```

Detale zapisywane są per plik — sama ich obecność oznacza „już pobrane", dzięki
czemu scrape jest **wznawialny** i idempotentny (przerwany proces dokańcza tylko
brakujące umowy).

## Architektura

```
config.py              # stałe (URL-e, limity, throttling, ścieżki) + DATABASE_URL (.env)
main.py                # CLI, wybór backendu zapisu
.env                   # zmienne środowiskowe (DATABASE_URL); ładowany automatycznie
scraper/
├── models.py          # modele danych (dataclasses) + from_dict/to_dict
├── client.py          # klient HTTP (sesja, retry, backoff, throttle)
├── search.py          # stronicowanie wyszukiwania
├── details.py         # pobieranie detali
├── runner.py          # orkiestracja: search → detale → zapis (+ resume)
└── storage/
    ├── base.py        # AgreementRepository (ABC) — kontrakt zapisu
    ├── json_repo.py   # JsonAgreementRepository — implementacja JSON
    └── sql_repo.py    # SqlAgreementRepository — implementacja PostgreSQL
sql/                   # skrypty: baza, tabele, role, granty (patrz sql/README.md)
tests/
├── test_models.py     # round-trip parsowania na realnych odpowiedziach
└── test_sql_repo.py   # testy backendu SQL (jednostkowe + integracyjne)
```

### Backend bazodanowy (PostgreSQL)

Cała logika zależy wyłącznie od abstrakcyjnego `AgreementRepository`
(`scraper/storage/base.py`). Oprócz backendu JSON dostępny jest
`SqlAgreementRepository` (`scraper/storage/sql_repo.py`) zapisujący do PostgreSQL —
`runner`, `search` i `details` pozostają bez zmian.

Wyniki wyszukiwania zapisywane są **wsadowo** (`save_search_results`) — jedna
paczka to jeden wielowierszowy `INSERT ... ON CONFLICT` zamiast N osobnych zapytań.
Rozmiar paczki ustawia `config.SEARCH_BATCH_SIZE` (domyślnie 500).

```bash
# 1. Utwórz bazę, tabele i role (patrz sql/README.md)
psql -f sql/01_database.sql
psql -d rejestr_umow -f sql/02_schema.sql
psql -d rejestr_umow -f sql/03_roles.sql
psql -d rejestr_umow -f sql/04_grants.sql

# 2. Ustaw DATABASE_URL w pliku .env (ładowany automatycznie), np.:
#    DATABASE_URL=postgresql://user:haslo@host/rejestr_umow
python main.py --storage db --max-records 20
```

Wybór backendu: `--storage db` (domyślnie) lub `--storage json`. DSN można podać
przez `--dsn`, zmienną `DATABASE_URL` albo plik `.env` (wczytywany automatycznie
przez `config.py` dzięki `python-dotenv`). Schemat bazy tworzą skrypty z `sql/` —
repozytorium zakłada, że tabele już istnieją.

Skrypty z `sql/` zakładają też dwie role: `rejestr_rw` (odczyt+zapis, dla scrapera)
i `rejestr_ro` (tylko odczyt). Szczegóły i kolejność uruchomienia — `sql/README.md`.

> `.env` jest w `.gitignore` — nie commituj danych dostępowych.

#### Przykład: pełny przepływ z bazą danych

```bash
# 0. Zależności
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. Baza, tabele, role i granty (PostgreSQL musi działać)
psql -f sql/01_database.sql
psql -d rejestr_umow -f sql/02_schema.sql
psql -d rejestr_umow -f sql/03_roles.sql
psql -d rejestr_umow -f sql/04_grants.sql

# 2. Login aplikacyjny dziedziczący z roli zapisu (jednorazowo)
psql -d rejestr_umow -c "CREATE ROLE scraper LOGIN PASSWORD 'tajne';" \
                     -c "GRANT rejestr_rw TO scraper;"

# 3. Połączenie w .env (ładowane automatycznie)
echo 'DATABASE_URL=postgresql://scraper:tajne@localhost:5432/rejestr_umow' > .env

# 4. Scrape do bazy — najpierw smoke test, potem pełny przebieg
python main.py --storage db --max-records 20
python main.py --storage db
```

Alternatywnie, bez `.env`, DSN można podać wprost:

```bash
python main.py --storage db --dsn "postgresql://scraper:tajne@localhost:5432/rejestr_umow"
```

Scrape jest **wznawialny** — po przerwaniu ponowne uruchomienie dokańcza tylko
umowy bez detali (`iter_pending_ids`). Etap detali można też ograniczyć flagą
`--max-details N` — przetworzy najwyżej `N` umów w jednym przebiegu, a pozostałe
zostaną doczytane przy kolejnym uruchomieniu (dzięki wznawialności). Przydatne do
rozłożenia dużego backlogu detali na mniejsze porcje:

```bash
python main.py --storage db --details-only --max-details 500
```

##### Aktualizacja inkrementalna (`--incremental`)

Do cyklicznego doczytywania tylko nowych umów użyj `--incremental`. Wyszukiwanie
przerywa się na pierwszej pozycji, która jest już w bazie — zakładając sortowanie
od najnowszych oznacza to, że kolejne strony też już mamy, więc nie są pobierane:

```bash
# pierwszy, pełny import
python main.py --storage db

# kolejne uruchomienia (np. z crona) — pobiera tylko nowości i ich detale
python main.py --storage db --incremental
```

> Tryb zakłada, że API zwraca wyniki od najnowszych. Jeśli zmieniasz kolejność
> przez `--sort-key`, zadbaj, by nowe umowy trafiały na początek listy.

Podgląd zebranych danych:

```sql
-- ile umów i pozycji wyszukiwania mamy w bazie
SELECT
    (SELECT count(*) FROM wynik_wyszukiwania) AS pozycje_wyszukiwania,
    (SELECT count(*) FROM umowa)              AS umowy_z_detalami;

-- umowa wraz z jej stronami
SELECT u.numer_umowy, u.status_umowy, u.wartosc_przedmiotu,
       s.nazwa, s.nip, s.wojewodztwo
FROM umowa u
JOIN strona_umowy s ON s.id_umowy = u.id_umowy
ORDER BY u.data_zawarcia_umowy DESC
LIMIT 20;
```

Do samego odczytu (raporty, analizy) używaj roli tylko-do-odczytu `rejestr_ro`:

```bash
psql -d rejestr_umow -c "CREATE ROLE analityk LOGIN PASSWORD 'tajne';" \
                     -c "GRANT rejestr_ro TO analityk;"
```

## Testy

```bash
python tests/test_models.py       # round-trip modeli (bez zależności)
python tests/test_sql_repo.py     # testy jednostkowe _parse_date (bez bazy)
pytest tests/                     # cały zestaw (wymaga: pip install pytest)
```

Testy **integracyjne** backendu SQL uruchamiają się tylko, gdy wskażesz bazę
testową zmienną `TEST_DATABASE_URL` (inaczej są pomijane). Tworzą schemat
i czyszczą tabele — użyj osobnej bazy, nie produkcyjnej:

```bash
TEST_DATABASE_URL="postgresql://user:haslo@localhost/rejestr_umow_test" pytest tests/test_sql_repo.py
```
