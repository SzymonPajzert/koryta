-- 03_roles.sql — role uprawnień.
--
-- Role są obiektami klastra (globalne), więc tworzone są raz. Są to role
-- „grupowe" (NOLOGIN) opisujące kontrakt uprawnień — właściwe loginy aplikacyjne
-- można później utworzyć i przypisać do nich (GRANT rejestr_rw TO <login>).
--
-- Tworzone idempotentnie, aby ponowne uruchomienie nie kończyło się błędem.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rejestr_rw') THEN
        CREATE ROLE rejestr_rw NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rejestr_ro') THEN
        CREATE ROLE rejestr_ro NOLOGIN;
    END IF;
END
$$;

COMMENT ON ROLE rejestr_rw IS 'Odczyt i zapis w tabelach rejestru umów.';
COMMENT ON ROLE rejestr_ro IS 'Tylko odczyt w tabelach rejestru umów.';
