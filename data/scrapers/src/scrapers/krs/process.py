import json
from dataclasses import dataclass
from datetime import datetime, timedelta

from stores.storage import iterate_blobs
from stores.duckdb import ducktable, always_export


curr_date = datetime.now().strftime("%Y-%m-%d")


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
    employed_krs: str
    employed_start: str | None
    employed_end: str | None
    employed_for: str | None
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        self.id = str(self.id)

    def insert_into(self):
        pass


@ducktable(name="companies_krs")
@dataclass
class KrsCompany:
    krs: str
    name: str
    city: str


def start_time(item):
    min_start = "2100-01-01"
    for conn in item["krs_powiazania_kwerendowane"]:
        assert isinstance(conn, dict)
        v = conn.get("data_start", curr_date)
        if v is None:
            v = curr_date
        min_start = min(min_start, v)
    return min_start


def end_time(item):
    max_end = "1900-01-01"
    for conn in item["krs_powiazania_kwerendowane"]:
        assert isinstance(conn, dict)
        v = conn.get("data_koniec", curr_date)
        if v is None:
            v = curr_date
        max_end = max(max_end, v)
    return max_end


def employment_duration(item) -> str:
    result = timedelta()
    for conn in item["krs_powiazania_kwerendowane"]:
        assert isinstance(conn, dict)
        end = conn.get("data_koniec", curr_date)
        if end is None:
            end = curr_date
        start = conn["data_start"]
        result = result + (datetime.fromisoformat(end) - datetime.fromisoformat(start))
    days = result.days

    return f"{days/365:.2f}"


@always_export
def extract_people():
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about people.
    """
    for blob_name, content in iterate_blobs("rejestr.io"):
        try:
            if "aktualnosc_" not in blob_name:
                continue
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
            # TODO handle failures better
            continue
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
                        employed_krs=KRS.from_blob_name(blob_name).id,
                        employed_start=start_time(item),
                        employed_end=end_time(item),
                        employed_for=employment_duration(item),
                    ).insert_into()
        except KeyError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")


@always_export
def extract_companies():
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about companies.
    """
    companies = {}
    for blob_name, content in iterate_blobs("rejestr.io"):
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
            continue
        try:
            if "aktualnosc_" in blob_name:
                for item in data:
                    if item.get("typ") == "organizacja":
                        krs_id = item["numery"]["krs"]
                        name = item["nazwy"]["skrocona"]
                        city = item["adres"]["miejscowosc"]
                        companies[krs_id] = KrsCompany(krs=krs_id, name=name, city=city)
            else:
                companies[data["numery"]["krs"]] = KrsCompany(
                    krs=data["numery"]["krs"],
                    name=data["nazwy"]["skrocona"],
                    city=data["adres"]["miejscowosc"],
                )
        except KeyError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")

    for company in companies.values():
        company.insert_into()
