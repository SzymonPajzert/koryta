import json
from dataclasses import dataclass
from tqdm import tqdm

from stores.storage import list_blobs, download_from_gcs
from stores.duckdb import ducktable, dump_dbs


class KRS:
    id: str

    def __init__(self, id: int | str) -> None:
        self.id = str(id).zfill(10)

    @staticmethod
    def from_blob_name(blob_name: str) -> "KRS":
        return KRS(blob_name.split("org/")[1].split("/")[0])

    def __str__(self) -> str:
        return self.id

    def __repr__(self) -> str:
        return self.id

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, KRS) and self.id == other.id


@ducktable(name="people_krs")
@dataclass
class KrsPerson:
    id: str
    first_name: str
    last_name: str
    full_name: str
    krs: str
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        self.id = str(self.id)

    def insert_into(self):
        pass


def iterate_blobs():
    blobs = list_blobs("rejestr.io")
    for blob_name in tqdm(blobs):
        if "krs-powiazania" not in blob_name:
            continue
        content = download_from_gcs(blob_name)
        if not content:
            print(f"  [ERROR] Could not download {blob_name}")
            continue
        try:
            data = json.loads(content)
            yield blob_name, data
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")


def extract_people():
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about people.
    """
    try:
        for blob_name, data in iterate_blobs():
            try:
                for item in data:
                    if item.get("typ") == "osoba":
                        identity = item.get("tozsamosc", {})
                        KrsPerson(
                            id=item["id"],
                            first_name=identity.get("imie"),
                            last_name=identity.get("nazwisko"),
                            full_name=identity.get("imiona_i_nazwisko"),
                            birth_date=identity.get("data_urodzenia"),
                            second_names=identity.get("drugie_imiona"),
                            sex=identity.get("plec"),
                            krs=KRS.from_blob_name(blob_name).id,
                        ).insert_into()
            except KeyError as e:
                print(f"  [ERROR] Could not process {blob_name}: {e}")
    finally:
        dump_dbs()
