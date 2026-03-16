import typing
from dataclasses import asdict

import numpy as np
import pandas as pd

from analysis.extract import Extract
from analysis.payloads.election import get_election_type, get_party_from_elections
from entities.composite import Company, Election, Person
from scrapers.stores import Context, Pipeline


class PeoplePayloads(Pipeline[Person]):
    filename = None

    people: Extract

    @property
    def output_class(self) -> typing.Type:
        return Person

    def process(self, ctx: Context):
        people_df = self.people.read_or_process(ctx)
        result = []
        for _, row in people_df.iterrows():
            person = map_person_payload(row)
            ctx.io.output_entity(person)
            result.append(person)
        return (
            pd.DataFrame.from_records([asdict(p) for p in result])
            if result
            else pd.DataFrame(
                columns=[
                    "name",
                    "companies",
                    "elections",
                    "party",
                    "wikipedia_url",
                    "rejestr_io_url",
                ]
            )
        )


def map_person_payload(row: pd.Series) -> Person:
    def get_scalar(key):
        val = row.get(key)
        if isinstance(val, (list, np.ndarray)):
            if len(val) > 0:
                return val[0]
            return None
        return val

    name = (
        get_scalar("name")
        or get_scalar("full_name")
        or get_scalar("fullname")
        or get_scalar("krs_name")
        or get_scalar("base_full_name")
        or "Unknown Payload"
    )

    companies = _extract_companies(row)
    elections = _extract_elections(row)

    wiki_name = get_scalar("wiki_name")
    wikipedia_url = get_scalar("wikipedia") or get_scalar("wiki_url")
    if not wikipedia_url and wiki_name and isinstance(wiki_name, str):
        wikipedia_url = f"https://pl.wikipedia.org/wiki/{wiki_name.replace(' ', '_')}"

    rejestr_io_url = get_scalar("rejestrIo")
    rejestr_id = get_scalar("rejestrio_id")
    if not rejestr_io_url and rejestr_id and isinstance(rejestr_id, str):
        rejestr_io_url = f"https://rejestr.io/osoby/{rejestr_id}"

    party = None
    if elections:
        party = get_party_from_elections(elections)

    return Person(
        name=name,
        companies=companies,
        elections=elections,
        party=party,
        wikipedia_url=wikipedia_url,
        rejestr_io_url=rejestr_io_url,
    )


def _extract_companies(row: pd.Series) -> list[Company]:
    companies = []
    company_list = row.get("companies") or row.get("employment")
    if isinstance(company_list, (list, np.ndarray)):
        for c in company_list:
            if isinstance(c, dict):
                c_krs = c.get("krs") or c.get("employed_krs")
                companies.append(
                    Company(
                        krs=c_krs,
                        role=c.get("role")
                        or c.get("function")
                        or c.get("employed_role"),
                        start=c.get("start") or c.get("employed_start"),
                        end=c.get("end") or c.get("employed_end"),
                    )
                )
    return companies


def _extract_elections(row: pd.Series) -> list[typing.Any]:
    elections = []
    elec_list = row.get("elections")
    if isinstance(elec_list, (list, np.ndarray)):
        for e in elec_list:
            if isinstance(e, dict):
                teryt_powiat = e.get("teryt_powiat", [])
                teryt_wojewodztwo = e.get("teryt_wojewodztwo", [])

                teryt_val = None
                if (
                    isinstance(teryt_powiat, (list, np.ndarray))
                    and len(teryt_powiat) > 0
                ):
                    teryt_val = str(teryt_powiat[0])
                elif (
                    isinstance(teryt_wojewodztwo, (list, np.ndarray))
                    and len(teryt_wojewodztwo) > 0
                ):
                    teryt_val = str(teryt_wojewodztwo[0])
                elif e.get("teryt"):
                    teryt_val = str(e.get("teryt"))

                election_payload = Election(
                    election_type=get_election_type(str(e.get("election_type")))
                )
                if e.get("party"):
                    # TODO handle this nicer and add some checks
                    election_payload.committee = str(e.get("party"))
                if e.get("election_year"):
                    election_payload.election_year = str(e.get("election_year"))
                if teryt_val:
                    if len(teryt_val) == 4 and teryt_val.endswith("00"):
                        teryt_val = teryt_val[:2]
                    election_payload.teryt = teryt_val

                elections.append(election_payload)
    return elections
