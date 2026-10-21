-- 04_grants.sql — nadanie uprawnień rolom rejestr_rw i rejestr_ro.
--
-- Uruchamiać będąc połączonym z bazą `rejestr_umow`:
--     psql -d rejestr_umow -f sql/04_grants.sql
--
-- Granty na tabele obowiązują w obrębie tej bazy (obie tabele: wynik_wyszukiwania,
-- umowa, strona_umowy). Dotyczą obu ról zgodnie z ich przeznaczeniem.

-- --- Połączenie z bazą ------------------------------------------------------
GRANT CONNECT ON DATABASE rejestr_umow TO rejestr_rw, rejestr_ro;

-- --- Dostęp do schematu -----------------------------------------------------
GRANT USAGE ON SCHEMA public TO rejestr_rw, rejestr_ro;

-- --- Rola odczyt+zapis (rejestr_rw) -----------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public TO rejestr_rw;

-- sekwencja klucza IDENTITY tabeli strona_umowy (potrzebne do INSERT)
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public TO rejestr_rw;

-- --- Rola tylko-odczyt (rejestr_ro) -----------------------------------------
GRANT SELECT
    ON ALL TABLES IN SCHEMA public TO rejestr_ro;

-- --- Domyślne uprawnienia dla przyszłych obiektów ---------------------------
-- Aby tabele/sekwencje tworzone później automatycznie otrzymywały te granty.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rejestr_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO rejestr_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO rejestr_ro;
