import json
from datetime import datetime, timedelta

from entities.company import KRS as KrsCompany
from entities.company import ManualKRS as KRS
from entities.person import KRS as KrsPerson
from scrapers.krs.graph import QueryRelation
from scrapers.stores import CloudStorage, Context, PipelineModel

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

    return f"{days/365:.2f}"


class PeopleKRS(PipelineModel[KrsPerson]):
    filename = "person_krs"

    def process(self, ctx: Context):
        extract_people(ctx)


def extract_people(ctx: Context):
    """
    Iterates through GCS files from rejestr.io, parses them,
    and extracts information about people.
    """
    for blob_name, content in ctx.io.read_data(
        CloudStorage(hostname="rejestr.io")
    ).read_iterable():
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


class CompaniesKRS(PipelineModel[KrsCompany]):
    filename = "company_krs"  # TODO calculate it

    def __init__(self) -> None:
        super().__init__()
        self.companies = {}
        self.awaiting_relations: dict[str, list[tuple[str, str]]] = {}

    def add_company(self, item):
        krs_id = item["numery"]["krs"]
        if krs_id in self.companies:
            company = self.companies[krs_id]
        else:
            name = item["nazwy"]["skrocona"]
            city = item["adres"]["miejscowosc"]
            company = KrsCompany(krs=krs_id, name=name, city=city)
            self.companies[company.krs] = company

        if krs_id in self.awaiting_relations:
            for parent, child in self.awaiting_relations[krs_id]:
                self.add_relation(parent, child)
            del self.awaiting_relations[krs_id]

        return company

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

    def process(self, ctx: Context):
        """
        Iterates through GCS files from rejestr.io, parses them,
        and extracts information about companies.
        """
        for blob_name, content in ctx.io.read_data(
            CloudStorage(hostname="rejestr.io")
        ).read_iterable():
            data = json.loads(content)
            if "aktualnosc_" in blob_name:
                for item in data:
                    if item.get("typ") != "organizacja":
                        continue
                    c = self.add_company(item)

                    # Add it to the parent of the company
                    parent = KRS.from_blob_name(blob_name)
                    conn_type = QueryRelation.from_rejestrio(
                        item["krs_powiazania_kwerendowane"][0]
                    )
                    if conn_type.is_child():
                        self.add_relation(parent.id, c.krs)

            else:
                self.add_company(data)

        for company in self.companies.values():
            ctx.io.output_entity(company)

        if len(self.awaiting_relations) > 1:
            raise ValueError(
                f"Awaiting relations not empty - {self.awaiting_relations}"
            )
