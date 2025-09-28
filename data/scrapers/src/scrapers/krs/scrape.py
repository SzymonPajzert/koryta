import typing
import itertools

from util.rejestr import get_rejestr_io
from stores.storage import upload_to_gcs, list_blobs


class KRS:
    id: str

    def __init__(self, id: int | str) -> None:
        self.id = str(id).zfill(10)

    def __str__(self) -> str:
        return self.id

    def __repr__(self) -> str:
        return self.id

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, KRS) and self.id == other.id


def save_org_connections(krss: typing.Iterable[KRS]):
    for krs in krss:
        yield f"https://rejestr.io/api/v2/org/{krs}"
        yield f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=aktualne"
        yield f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=historyczne"


# https://www.gov.pl/attachment/55892deb-efa3-44ba-87ed-7653034ee00f from
# https://www.gov.pl/web/aktywa-panstwowe/spolki-objete-nadzorem-wlascicielskim-ministra-aktywow-panstwowych
MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs = [
    "0000002710",
    "0000004324",
    "0000006791",
    "0000007411",
    "0000009831",
    "0000010696",
    "0000011737",
    "0000012483",
    "0000015501",
    "0000016065",
    "0000020227",
    "0000022693",
    "0000023302",
    "0000025769",
    "0000026438",
    "0000027151",
    "0000027471",
    "0000027497",
    "0000027591",
    "0000028860",
    "0000035770",
    "0000037957",
    "0000044577",
    "0000045833",
    "0000047030",
    "0000047774",
    "0000047934",
    "0000049056",
    "0000051042",
    "0000054811",
    "0000056031",
    "0000056440",
    "0000056561",
    "0000056964",
    "0000058915",
    "0000059307",
    "0000059625",
    "0000064518",
    "0000066285",
    "0000067459",
    "0000068470",
    "0000070348",
    "0000072093",
    "0000073983",
    "0000075450",
    "0000076693",
    "0000077664",
    "0000081582",
    "0000082312",
    "0000083121",
    "0000084678",
    "0000086641",
    "0000088012",
    "0000095342",
    "0000097998",
    "0000099256",
    "0000100887",
    "0000103624",
    "0000104717",
    "0000108417",
    "0000114136",
    "0000114383",
    "0000116560",
    "0000132241",
    "0000144813",
    "0000144861",
    "0000154178",
    "0000162581",
    "0000166294",
    "0000171101",
    "0000173377",
    "0000185947",
    "0000190790",
    "0000219832",
    "0000223325",
    "0000228587",
    "0000245260",
    "0000271562",
    "0000278401",
    "0000287031",
    "0000288091",
    "0000292313",
    "0000293205",
    "0000294679",
    "0000295452",
    "0000302817",
    "0000305180",
    "0000308183",
    "0000313140",
    "0000325752",
    "0000326587",
    "0000334972",
    "0000360701",
    "0000374289",
    "0000383595",
    "0000384496",
    "0000445684",
    "0000466256",
    "0000478929",
    "0000489456",
    "0000491363",
    "0000495369",
    "0000602576",
    "0000638779",
    "0000651242",
    "0000673893",
    "0000684374",
    "0000709363",
    "0000924719",
    "0000955885",
]

# TODO What is a good source of them?
# Dumped some manually from https://bip.warszawa.pl/jednostki-organizacyjne
# https://docs.google.com/spreadsheets/d/14SM3cuO0gZ897T2mT40Pm4mUqXtY5JCvaemHMvs9AcQ
WARSZAWA = [
    "0000019230",
    "0000030682",
    "0000036568",
    "0000050531",
    "0000052192",
    "0000085927",
    "0000096436",
    "0000114280",
    "0000124188",
    "0000145910",
    "0000146121",
    "0000146122",
    "0000146125",
    "0000146138",
    "0000146143",
    "0000171197",
    "0000173077",
    "0000206762",
    "0000253038",
    "0000278968",
    "0000368174",
    "0000380895",
    "0000445779",
    "0000456064",
    "0000468274",
    "0000478458",
    "0000582513",
    "0000678693",
    "0001004272",
    "0001009228",
]


def scrape_rejestrio():
    # TODO Find children of the mentioned companies

    already_scraped = set(
        KRS(path.split("org/")[1].split("/")[0]) for path in list_blobs("rejestr.io")
    )
    starters = set(
        KRS(krs)
        for krs in itertools.chain(MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs, WARSZAWA)
    )
    to_scrape = starters - already_scraped

    print(f"Already scraped: {already_scraped}")
    print(f"To scrape: {to_scrape}")
    print(f"Will cost: {len(to_scrape) * 0.15} PLN")

    for url in save_org_connections(to_scrape):
        result = get_rejestr_io(url)

        if result is None:
            print(f"Skipping {url}")
            continue

        # We're discarding query params, so it's a hotfix for this
        url = url.replace("?aktualnosc=", "/aktualnosc_")
        upload_to_gcs(url, result, "application/json")
