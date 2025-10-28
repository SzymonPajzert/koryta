import duckdb

from stores.duckdb import read_table
from util.config import versioned

SELECT_DOMAINS = "select regexp_extract(url, '://[^/]+/') as domain, count(*) as c from website_index group by all order by c desc"

read = set(
    """
srem.naszemiasto.pl
wiadomosci.wp.pl
www.wirtualnemedia.pl
tvn24.pl
wiadomosci.onet.pl
gazetalubuska.pl
oko.press
echodnia.eu
swidnica24.pl
dziennikpolski24.pl
jarocinska.pl
gazetakrakowska.pl
www.rp.pl
nowosci.com.pl
www.tygodnikprzeglad.pl
gostynska.pl
www.krotoszynska.pl
dzienniklodzki.pl
www.pb.pl
portalplock.pl
www.onet.pl
zwielkopolski24.pl
jawnylublin.pl
expressilustrowany.pl
kedzierzynkozle.pl
tygodniksiedlecki.com
www.kedzierzynkozle.pl
rzeszow24.info
niezalezna.pl
metropoliabydgoska.pl
kutno.net.pl
zpleszewa.pl
lodz.naszemiasto.pl
terazgostynin.pl
transinfo.pl
www.gov.pl
infokolej.pl
wiadomosci.radiozet.pl
rzeszow-news.pl
mazovia.pl
ddzelow.pl
debica.naszemiasto.pl
przegladsportowy.onet.pl
i.pl
radomszczanska.pl
businessinsider.com.pl
polityka.se.pl
www.newsweek.pl
ddbelchatow.pl
sportowefakty.wp.pl
tulodz.pl
www.tvn24.pl
tp.com.pl
plus.echodnia.eu
www.bronisze.com.pl
naszemiasto.pl
strefabiznesu.pl
finanse.wp.pl
korsosanockie.pl
strefaobrony.pl
www.gazetalubuska.pl
wspolczesna.pl
paulinamatysiak.pl
www.fakt.pl
strefaagro.pl
""".strip().split(
        "\n"
    )
)

ignore = set(
    """
x.com
www.ceneo.pl
www.linkedin.com
twitter.com
www.facebook.com
www.forbes.pl
pdt.tradedoubler.com
kodyrabatowe.naszemiasto.pl
kup.tvn24.pl
stronazdrowia.pl
www.komputerswiat.pl
www.auto-swiat.pl
stronakobiet.pl
kobieta.onet.pl
api.whatsapp.com
gratka.pl
www.gramwzielone.pl
pinterest.com
facebook.com
www.youtube.com
stronapodrozy.pl
""".strip().split(
        "\n"
    )
)


def get_domains():
    read_table("website_index")
    result = duckdb.sql(SELECT_DOMAINS).df()
    print(result.columns)
    result.to_json(versioned.get_path("domains.jsonl"), lines=True, orient="records")

    known_good = 0
    known_bad = 0
    total = 0

    with open(versioned.get_path("domains.txt"), "w") as f:
        for domain, count in result.itertuples(index=False):
            domain = domain.rstrip("/")
            domain = domain.lstrip("://")
            total += count
            if domain in read:
                known_good += count
                continue
            if domain in ignore:
                known_bad += count
                continue
            f.write(domain + "\n")

    known = known_good + known_bad
    print(f"Known: {known} / {total} = {known / total * 100:.2f}%")
    print(f"Good: {known_good} / {known} = {known_good / known * 100:.2f}%")
    print(f"Bad: {known_bad} / {known} = {known_bad / known * 100:.2f}%")
