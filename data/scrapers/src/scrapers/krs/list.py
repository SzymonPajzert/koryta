import dataclasses
import json
from datetime import datetime, timedelta

from entities.company import KRS as KrsCompany
from entities.company import ManualKRS as KRS
from entities.person import KRS as KrsPerson
from scrapers.krs.graph import QueryRelation
from scrapers.stores import CloudStorage, Context, DownloadableFile, Pipeline

curr_date = datetime.now().strftime("%Y-%m-%d")


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

    return f"{days / 365:.2f}"


class PeopleKRS(Pipeline):
    filename = "person_krs"
    dtype = {"employed_krs": str}

    def process(self, ctx: Context):
        extract_people(ctx)


def extract_people(ctx: Context):
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about people.
    """
    for blob_ref in ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io")):
        blob = ctx.io.read_data(blob_ref)
        assert isinstance(blob_ref, DownloadableFile)
        blob_name = blob_ref.url
        content = blob.read_string()
        try:
            if "aktualnosc_" not in blob_name:
                continue
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
            raise e
        try:
            for item in data:
                if item.get("typ") == "osoba":
                    identity = item.get("tozsamosc", {})
                    ctx.io.output_entity(
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
                        )
                    )
        except KeyError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")


class CompaniesKRS(Pipeline):
    filename = "company_krs"
    dtype = {"krs": str}

    def __init__(self) -> None:
        super().__init__()
        self.companies: dict[str, KrsCompany] = {}
        self.company_sources: dict[str, set[str]] = {}
        self.awaiting_relations: dict[str, list[tuple[str, str]]] = {}

    def add_company(self, company: KrsCompany):
        krs_id = company.krs
        if krs_id in self.companies:
            # TODO implement merge logic
            existing = self.companies[krs_id]
            existing.name = existing.name or company.name
            existing.city = existing.city or company.city
            self.companies[krs_id] = existing
        else:
            self.companies[company.krs] = company

        if krs_id in self.awaiting_relations:
            for parent, child in self.awaiting_relations[krs_id]:
                self.add_relation(parent, child)
            del self.awaiting_relations[krs_id]

        return company

    def add_company_source(self, company: str, source: str):
        self.company_sources[company] = self.company_sources.get(company, set()) | {
            source
        }

    def add_awaiting(self, company: str, relation: tuple[str, str]):
        self.awaiting_relations[company] = self.awaiting_relations.get(company, []) + [
            relation
        ]

    def add_relation(self, parent: str, child: str):
        if parent in self.companies and child in self.companies:
            self.companies[parent].children.add(child)
            self.companies[child].parents.add(parent)
        elif child not in self.companies:
            self.add_awaiting(child, (parent, child))
        elif parent not in self.companies:
            self.add_awaiting(parent, (parent, child))

    def iterate_blobs(self, ctx: Context, hostname: str):
        for blob_ref in ctx.io.list_files(CloudStorage(prefix=f"hostname={hostname}")):
            blob = ctx.io.read_data(blob_ref)
            assert isinstance(blob_ref, DownloadableFile)
            content = blob.read_string()
            data = json.loads(content)
            yield blob_ref.url, data

    def process(self, ctx: Context):
        """
        Iterates through GCS files from rejestr.io, parses them,
        and extracts information about companies.
        """
        for blob_name, data in self.iterate_blobs(ctx, "rejestr.io"):
            if "org" not in blob_name:
                print("Skipping non-org file: ", blob_name)
                continue

            if "aktualnosc_" in blob_name:
                parent = KRS.from_blob_name(blob_name)
                self.add_company_source(parent.id, blob_name)

                for item in data:
                    if item.get("typ") != "organizacja":
                        continue
                    c = self.add_company(company_from_rejestrio(item))
                    conn_type = QueryRelation.from_rejestrio(
                        item["krs_powiazania_kwerendowane"][0]
                    )
                    if conn_type.is_child():
                        self.add_relation(parent.id, c.krs)

            else:
                c = company_from_rejestrio(data)
                self.add_company(c)
                self.add_company_source(c.krs, blob_name)

        for blob_name, data in self.iterate_blobs(ctx, "api-krs.ms.gov.pl"):
            c = company_from_api_krs(data)
            self.add_company(c)
            self.add_company_source(c.krs, blob_name)

        for company in self.companies.values():
            ctx.io.output_entity(
                dataclasses.replace(
                    company, sources=self.company_sources.get(company.krs, set())
                )
            )

        for k, vs in self.awaiting_relations.items():
            for v in vs:
                if v[0] == k:
                    continue

                raise ValueError(f"Awaiting relations not empty: {k} {v}")


def company_from_rejestrio(data: dict) -> KrsCompany:
    krs = data["numery"]["krs"]
    name = data["nazwy"]["skrocona"]
    city = data["adres"]["miejscowosc"]
    return KrsCompany(krs=krs, name=name, city=city)


def company_from_api_krs(data: dict) -> KrsCompany:
    try:
        odpis = data["odpis"]
        krs = odpis.get("naglowekA").get("numerKRS")
        dane = odpis.get("dane", {})
        dzial1 = dane.get("dzial1", {})
        nazwa = dzial1.get("danePodmiotu").get("nazwa")
        siedziba = dzial1.get("siedzibaIAdres", {}).get("siedziba", {})
        miejscowosc = siedziba.get("miejscowosc")
        return KrsCompany(krs=krs, name=nazwa, city=miejscowosc)
    except KeyError as e:
        raise ValueError(
            f"Failed to extract company data from API KRS response: {e}, data: {data}"
        ) from e
