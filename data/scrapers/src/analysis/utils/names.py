from scrapers.stores import DownloadableFile as FileSource
from frameworks.conductor import pipeline

from scrapers.stores import Context


surnames = [
    FileSource(
        # https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65049/table
        "https://api.dane.gov.pl/resources/65049,nazwiska-meskie-wg-zameldowania-na-pobyt-stay-stan-na-2025-02-24/csv",
        "nazwiska_męskie-osoby_żyjące_w_podziale_na_województwo_zameldowania.csv",
    ),
    FileSource(
        # "https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65090/file",
        "https://api.dane.gov.pl/resources/65090,nazwiska-zenskie-wg-zameldowania-na-pobyt-stay-stan-na-2025-02-24/csv",
        "nazwiska_żeńskie-osoby_żyjące_w_podziale_na_województwo_zameldowania.csv",
    ),
]

firstnames = [
    FileSource(
        # https://dane.gov.pl/pl/dataset/1667,lista-imion-wystepujacych-w-rejestrze-pesel-osoby-zyjace/resource/63929/table
        "https://api.dane.gov.pl/resources/63929,lista-imion-meskich-w-rejestrze-pesel-stan-na-22012025-imie-pierwsze/csv",
        "8_-_Wykaz_imion_męskich_osób_żyjących_wg_pola_imię_pierwsze_występujących_w_rejestrze_PESEL_bez_zgonów.csv",
    ),
    FileSource(
        # https://dane.gov.pl/pl/dataset/1667,lista-imion-wystepujacych-w-rejestrze-pesel-osoby-zyjace/resource/63924/table
        "https://api.dane.gov.pl/resources/63924,lista-imion-zenskich-w-rejestrze-pesel-stan-na-22012025-imie-pierwsze/csv",
        "8_-_Wykaz_imion_żeńskich__osób_żyjących_wg_pola_imię_pierwsze_występujących_w_rejestrze_PESEL_bez_zgonów.csv",
    ),
]


@pipeline(
    "names_count_by_region",
)
def names_count_by_region(ctx: Context, con):
    for source in surnames:
        ctx.conductor.check_input(source)

    # TODO Instead of get_path, just read them as df
    # Duckdb can access it

    con.execute(
        f"""CREATE TABLE names_count_by_region AS
        SELECT
            lower("Nazwisko aktualne") as last_name,
            AVG("Liczba") as count,
            teryt
        FROM (
            SELECT *, 'M' as sex FROM read_csv('{ctx.conductor.get_path(surnames[0])}')
            UNION ALL
            SELECT *, 'F' as sex FROM read_csv('{ctx.conductor.get_path(surnames[1])}')
        ) AS names
        LEFT JOIN (
            SELECT * FROM (VALUES
                ('DOLNOŚLĄSKIE', '02'),
                ('KUJAWSKO-POMORSKIE', '04'),
                ('LUBELSKIE', '06'),
                ('LUBUSKIE', '08'),
                ('ŁÓDZKIE', '10'),
                ('MAŁOPOLSKIE', '12'),
                ('MAZOWIECKIE', '14'),
                ('OPOLSKIE', '16'),
                ('PODKARPACKIE', '18'),
                ('PODLASKIE', '20'),
                ('POMORSKIE', '22'),
                ('ŚLĄSKIE', '24'),
                ('ŚWIĘTOKRZYSKIE', '26'),
                ('WARMIŃSKO-MAZURSKIE', '28'),
                ('WIELKOPOLSKIE', '30'),
                ('ZACHODNIOPOMORSKIE', '32')
            ) AS t(wojewodztwo, teryt)
        ) AS regions ON names."Województwo zameldowania na pobyt stały" = regions.wojewodztwo
        GROUP BY ALL
        """
    )


@pipeline(
    "first_name_freq",
)
def first_name_freq(ctx: Context, con):
    for source in firstnames:
        ctx.conductor.check_input(source)

    con.execute(
        f"""CREATE TABLE first_name_freq AS
        WITH raw_names_split AS (
            SELECT
                lower("IMIĘ_PIERWSZE") as first_name,
                "LICZBA_WYSTĄPIEŃ" as count
            FROM read_csv('{ctx.conductor.get_path(firstnames[0])}')
            UNION ALL
            SELECT
                lower("IMIĘ_PIERWSZE") as first_name,
                "LICZBA_WYSTĄPIEŃ" as count
            FROM read_csv('{ctx.conductor.get_path(firstnames[1])}')
        ),
        raw_names AS (
            SELECT
                first_name,
                SUM(count) as count
            FROM raw_names_split
            GROUP BY first_name
        ),
        total AS (
            SELECT SUM(count) as total_count FROM raw_names
        )
        SELECT
            first_name,
            count,
            CAST(count AS DOUBLE) / total.total_count as p
        FROM raw_names, total
    """
    )
