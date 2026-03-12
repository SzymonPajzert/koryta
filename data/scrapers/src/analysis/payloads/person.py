import json
from typing import Any, cast

import numpy as np
import pandas as pd

from analysis.extract import Extract
from analysis.interesting import Companies
from analysis.payloads.election import get_election_type, get_party_from_elections
from analysis.payloads.util import strip_none
from scrapers.stores import Context, Pipeline


class PeoplePayloads(Pipeline):
    filename = None

    people: Extract
    companies: Companies

    def process(self, ctx: Context) -> pd.DataFrame:
        people_df = self.people.read_or_process(ctx)
        companies_df = self.companies.read_or_process(ctx)

        # Region filtering for companies
        # TODO support accessing object flags in python
        people_args = getattr(self.people, "args", None)
        region = getattr(people_args, "region", None)
        if region:
            companies_df = companies_df[
                companies_df["teryt_code"].fillna("").str.startswith(region)
            ]
            print(f"Filtered to {len(companies_df)} companies for region {region}")

        companies_df_lookup = companies_df.dropna(subset=["krs", "name"])
        company_lookup = dict(
            zip(companies_df_lookup["krs"], companies_df_lookup["name"])
        )

        # TODO type this correctly
        payloads: list[dict[str, Any]] = []

        for _, row in people_df.iterrows():
            payload = map_person_payload(row, company_lookup)
            if payload:
                # Get region for filtering
                teryt_powiat = []
                elec_list = row.get("elections")
                if isinstance(elec_list, (list, np.ndarray)):
                    for e in elec_list:
                        if isinstance(e, dict):
                            powiat = e.get("teryt_powiat", [])
                            if isinstance(powiat, (list, np.ndarray)):
                                teryt_powiat.extend([str(p) for p in powiat])

                payloads.append(
                    {
                        "entity_type": "person",
                        "entity_id": None,
                        "krs": None,
                        "teryt_powiat": list(set(teryt_powiat)),
                        "payload": payload,
                    }
                )

        df = pd.DataFrame(payloads)
        # Ensure 'payload' is always a valid JSON string for DuckDB
        if not df.empty and "payload" in df.columns:
            df["payload"] = df["payload"].apply(
                lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x
            )
        return df


def map_person_payload(
    row: pd.Series, company_lookup: dict[str, str]
) -> dict[str, Any]:
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

    companies = _extract_companies(row, company_lookup)
    elections = _extract_elections(row)

    articles = []
    arts = row.get("articles")
    if isinstance(arts, list):
        for a in arts:
            if isinstance(a, dict) and a.get("url"):
                articles.append({"url": a.get("url")})
            elif isinstance(a, str):
                articles.append({"url": a})

    wiki_name = get_scalar("wiki_name")
    wikipedia_url = get_scalar("wikipedia") or get_scalar("wiki_url")
    if not wikipedia_url and wiki_name and isinstance(wiki_name, str):
        wikipedia_url = f"https://pl.wikipedia.org/wiki/{wiki_name.replace(' ', '_')}"

    rejestr_io_url = get_scalar("rejestrIo")
    rejestr_id = get_scalar("rejestrio_id")
    if not rejestr_io_url and rejestr_id and isinstance(rejestr_id, str):
        rejestr_io_url = f"https://rejestr.io/osoby/{rejestr_id}"

    payload = {"name": name}
    if wikipedia_url:
        payload["wikipedia"] = wikipedia_url
    if rejestr_io_url:
        payload["rejestrIo"] = rejestr_io_url
    if companies:
        payload["companies"] = companies
    if articles:
        payload["articles"] = articles
    if elections:
        payload["elections"] = elections
        payload["party"] = get_party_from_elections(elections)

    return cast(dict[str, Any], strip_none(payload))


def _extract_companies(
    row: pd.Series, company_lookup: dict[str, str]
) -> list[dict[str, Any]]:
    companies = []
    company_list = row.get("companies") or row.get("employment")
    if isinstance(company_list, (list, np.ndarray)):
        for c in company_list:
            if isinstance(c, dict):
                c_name = c.get("name")
                c_krs = c.get("krs") or c.get("employed_krs")

                if not c_name and c_krs:
                    c_name = company_lookup.get(c_krs)

                if not c_name and c_krs:
                    print(
                        f"Warning: Cannot resolve company name for KRS: {c_krs}.\
                            Using KRS as name."
                    )
                    c_name = c_krs

                companies.append(
                    {
                        "name": c_name or "Unknown Company",
                        "krs": c_krs,
                        "role": c.get("role") or c.get("function"),
                        "start": c.get("start") or c.get("employed_start"),
                        "end": c.get("end") or c.get("employed_end"),
                    }
                )
    return companies


def _extract_elections(row: pd.Series) -> list[dict[str, Any]]:
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

                election_payload = {
                    "election_type": get_election_type(str(e.get("election_type")))
                }
                if e.get("party"):
                    # TODO handle this nicer and add some checks
                    election_payload["committee"] = str(e.get("party"))
                if e.get("election_year"):
                    election_payload["election_year"] = str(e.get("election_year"))
                if teryt_val:
                    if len(teryt_val) == 4 and teryt_val.endswith("00"):
                        teryt_val = teryt_val[:2]
                    election_payload["teryt"] = teryt_val

                elections.append(election_payload)
    return elections
