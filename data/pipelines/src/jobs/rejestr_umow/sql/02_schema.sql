-- 02_schema.sql — tabele w bazie rejestr_umow.
--
-- Uruchamiać będąc połączonym z bazą `rejestr_umow`:
--     psql -d rejestr_umow -f sql/02_schema.sql
--
-- Nazwy kolumn zachowują polskie nazewnictwo z modeli `scraper/models.py`
-- (odpowiedniki pól JSON API), aby przyszłe `SqlAgreementRepository` mapowało 1:1.

-- ---------------------------------------------------------------------------
-- Wyniki wyszukiwania  (model AgreementSearchResult)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wynik_wyszukiwania (
    id_umowy                  uuid           PRIMARY KEY,          -- idUmowy
    nazwa                     text,                                -- nazwa
    regon                     text,                                -- regon
    data_zawarcia_umowy       date,                                -- dataZawarciaUmowy
    data_zakonczenia_umowy    date,                                -- dataZakonczeniaUmowy
    wartosc_przedmiotu_umowy  numeric(18, 2),                      -- wartoscPrzedmiotuUmowy
    przedmiot_umowy           text,                                -- przedmiotUmowy
    status_umowy              text,                                -- statusUmowy
    zaimportowano             timestamptz    NOT NULL DEFAULT now(),

    -- Etap detali: gdy pobranie detali trwale się nie powiodło (po wyczerpaniu
    -- wszystkich prób), oznaczamy pozycję, aby nie ponawiać jej w nieskończoność.
    detale_niedostepne        boolean        NOT NULL DEFAULT false,
    detale_blad               text,                                -- ostatni komunikat błędu
    detale_niedostepne_od     timestamptz                          -- kiedy oznaczono
);

COMMENT ON TABLE wynik_wyszukiwania IS
    'Pojedyncze pozycje z listy wyszukiwania (content[]).';

CREATE INDEX IF NOT EXISTS ix_wynik_regon
    ON wynik_wyszukiwania (regon);
CREATE INDEX IF NOT EXISTS ix_wynik_status
    ON wynik_wyszukiwania (status_umowy);
CREATE INDEX IF NOT EXISTS ix_wynik_data_zawarcia
    ON wynik_wyszukiwania (data_zawarcia_umowy);

-- ---------------------------------------------------------------------------
-- Detale umowy  (model AgreementDetails: podstawoweDane, okresObowiazywania,
--                szczegolyUmowy spłaszczone do kolumn)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS umowa (
    id_umowy                        uuid          PRIMARY KEY,     -- idUmowy

    -- podstawoweDane
    status_umowy                    text,                          -- statusUmowy
    numer_umowy                     text,                          -- numerUmowy
    brak_numeru_umowy               boolean,                       -- brakNumeruUmowy
    data_zawarcia_umowy             date,                          -- dataZawarciaUmowy
    data_zakonczenia_umowy          date,                          -- dataZakonczeniaUmowy

    -- okresObowiazywania
    umowa_na_czas_nieoznaczony      boolean,                       -- umowaNaCzasNieoznaczony
    okres                           text,                          -- okres

    -- szczegolyUmowy
    przedmiot_umowy                 text,                          -- przedmiotUmowy
    niejawnosc_przedmiotu           jsonb,                         -- niejawnoscPrzedmiotu
    wartosc_przedmiotu              numeric(18, 2),                -- wartoscPrzedmiotu
    niejawnosc_wartosci_przedmiotu  jsonb,                         -- niejawnoscWartosciPrzedmiotu
    opis_wartosci_przedmiotu        text,                          -- opisWartosciPrzedmiotu

    finansowana_ze_srodkow          boolean,                       -- finansowanaZeSrodkow
    zmiany_umowy                    jsonb         NOT NULL DEFAULT '[]'::jsonb,  -- zmianyUmowy
    data_publikacji                 date,                          -- dataPublikacji
    data_modyfikacji                date,                          -- dataModyfikacji
    zaimportowano                   timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE umowa IS
    'Detale umowy z endpointu /api-dp/v1/agreement/{idUmowy}.';

-- strony umowy (stronyUmowy[]) z wbudowanym daneAdresowe
CREATE TABLE IF NOT EXISTS strona_umowy (
    id                       bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_umowy                 uuid          NOT NULL
                                 REFERENCES umowa (id_umowy) ON DELETE CASCADE,

    kraj                     text,                                 -- kraj
    rodzaj                   text,                                 -- rodzaj
    nazwa                    text,                                 -- nazwa
    nip                      text,                                 -- nip
    regon                    text,                                 -- regon
    imie                     text,                                 -- imie
    nazwisko                 text,                                 -- nazwisko
    czy_konsorcjum           boolean,                              -- czyKonsorcjum
    niejawnosc_strony        jsonb,                                -- niejawnoscStrony

    -- daneAdresowe (spłaszczone)
    ulica                    text,                                 -- ulica
    numer_nieruchomosci      text,                                 -- numerNieruchomosci
    numer_lokalu             text,                                 -- numerLokalu
    wojewodztwo              text,                                 -- wojewodztwo
    powiat                   text,                                 -- powiat
    gmina_miasto_dzielnica   text,                                 -- gminaMiastoDzielnica
    miejscowosc              text,                                 -- miejscowosc
    kod_pocztowy             text                                  -- kodPocztowy
);

COMMENT ON TABLE strona_umowy IS
    'Strony umowy (stronyUmowy[]) wraz z danymi adresowymi.';

CREATE INDEX IF NOT EXISTS ix_strona_umowy_id_umowy
    ON strona_umowy (id_umowy);
CREATE INDEX IF NOT EXISTS ix_strona_umowy_nip
    ON strona_umowy (nip);
CREATE INDEX IF NOT EXISTS ix_strona_umowy_regon
    ON strona_umowy (regon);
