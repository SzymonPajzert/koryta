import typing

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


STARTER_KRSs = ["0000004619"]


def scrape_rejestrio():
    # TODO Find children of the mentioned companies

    already_scraped = set(
        KRS(path.split("org/")[1].split("/")[0]) for path in list_blobs("rejestr.io")
    )
    starters = set(KRS(krs) for krs in STARTER_KRSs)
    to_scrape = starters - already_scraped

    print(f"Already scraped: {already_scraped}")
    print(f"To scrape: {to_scrape}")
    print(f"Will cost: {len(to_scrape) * 0.05} PLN")

    for url in save_org_connections(to_scrape):
        result = get_rejestr_io(url)

        if result is None:
            print(f"Skipping {url}")
            continue

        # We're discarding query params, so it's a hotfix for this
        url = url.replace("?aktualnosc=", "/aktualnosc_")
        upload_to_gcs(url, result, "application/json")
