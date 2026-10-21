-- 05_detale_niedostepne.sql — migracja: oznaczanie umów o trwale nieudanym
-- pobraniu detali (po wyczerpaniu wszystkich prób), aby ich nie ponawiać.
--
-- Uruchamiać w bazie rejestr_umow (idempotentne — ADD COLUMN IF NOT EXISTS):
--     psql -d rejestr_umow -f sql/05_detale_niedostepne.sql
--
-- Dla nowo tworzonych baz kolumny są już w 02_schema.sql; ten skrypt służy do
-- aktualizacji istniejących instalacji.

ALTER TABLE wynik_wyszukiwania
    ADD COLUMN IF NOT EXISTS detale_niedostepne     boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS detale_blad            text,
    ADD COLUMN IF NOT EXISTS detale_niedostepne_od  timestamptz;

COMMENT ON COLUMN wynik_wyszukiwania.detale_niedostepne IS
    'true = pobranie detali trwale nieudane (po wyczerpaniu prób); pomijane w etapie detali.';
