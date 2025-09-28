import json
from dataclasses import dataclass
from tqdm import tqdm

from stores.storage import list_blobs, download_from_gcs
from stores.duckdb import ducktable, dump_dbs


@ducktable(name="people_krs")
@dataclass
class KrsPerson:
    id: str
    first_name: str
    last_name: str
    full_name: str
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        self.id = str(self.id)

    def insert_into(self):
        pass


def extract_people():
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about people.
    """
    blobs = list_blobs("rejestr.io")
    try:
        for blob_name in tqdm(blobs):
            if "krs-powiazania" not in blob_name:
                print(f"Skipping")
                continue
            print(f"Processing {blob_name}")
            content = download_from_gcs(blob_name)
            if not content:
                print(f"  [ERROR] Could not download {blob_name}")
                continue
            try:
                data = json.loads(content)
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
                        ).insert_into()
            except (json.JSONDecodeError, KeyError) as e:
                print(f"  [ERROR] Could not process {blob_name}: {e}")
    finally:
        dump_dbs()
