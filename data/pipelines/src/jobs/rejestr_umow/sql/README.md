# SQL — baza, tabele i role rejestru umów

Skrypty tworzą bazę PostgreSQL na dane z `rejestrumow.gov.pl` (wyniki wyszukiwania +
detale umów) oraz dwie role uprawnień.

## Zawartość

| Plik              | Opis                                                        |
|-------------------|-------------------------------------------------------------|
| `01_database.sql` | `CREATE DATABASE rejestr_umow` (UTF-8)                       |
| `02_schema.sql`   | tabele: `wynik_wyszukiwania`, `umowa`, `strona_umowy`       |
| `03_roles.sql`    | role `rejestr_rw` (odczyt+zapis) i `rejestr_ro` (odczyt)     |
| `04_grants.sql`   | nadanie uprawnień obu rolom na tabelach                      |
| `05_detale_niedostepne.sql` | migracja: kolumny oznaczające trwale nieudane pobranie detali |

## Kolejność uruchomienia

```bash
# 1. Baza (poza transakcją; połącz się np. z bazą postgres). Uruchom raz.
psql -f sql/01_database.sql

# 2. Tabele — w nowej bazie
psql -d rejestr_umow -f sql/02_schema.sql

# 3. Role — globalne dla klastra (idempotentne)
psql -d rejestr_umow -f sql/03_roles.sql

# 4. Granty — w bazie rejestr_umow
psql -d rejestr_umow -f sql/04_grants.sql
```

`CREATE DATABASE` nie wspiera `IF NOT EXISTS` — jeśli baza już istnieje, pomiń krok 1.
Pozostałe skrypty są idempotentne (`IF NOT EXISTS`, warunkowe `CREATE ROLE`).

## Role

- **`rejestr_rw`** — `SELECT, INSERT, UPDATE, DELETE` na wszystkich tabelach (dla scrapera).
- **`rejestr_ro`** — `SELECT` na wszystkich tabelach (do raportowania/odczytu).

Obie są rolami grupowymi (`NOLOGIN`). Aby utworzyć login aplikacyjny:

```sql
CREATE ROLE app_scraper LOGIN PASSWORD '...';
GRANT rejestr_rw TO app_scraper;

CREATE ROLE app_readonly LOGIN PASSWORD '...';
GRANT rejestr_ro TO app_readonly;
```
