import json
from typing import Any, cast

import numpy as np
import pandas as pd

from analysis.extract import Extract
from analysis.interesting import CompaniesMerged
from scrapers.map.teryt import Regions
from scrapers.stores import Context, Pipeline


def strip_none(d: dict | list) -> dict | list:
    if isinstance(d, dict):
        return {
            k: strip_none(v)
            for k, v in d.items()
            if v is not None and (not isinstance(v, float) or not np.isnan(v))
        }
    elif isinstance(d, list):
        return [strip_none(v) for v in d if v is not None]
    return d


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

                election_payload = {"election_type": e.get("election_type")}
                if e.get("party"):
                    election_payload["party"] = e.get("party")
                if e.get("election_year"):
                    election_payload["election_year"] = str(e.get("election_year"))
                if teryt_val:
                    election_payload["teryt"] = teryt_val

                elections.append(election_payload)
    return elections


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
    if row.get("content") or row.get("history"):
        payload["content"] = row.get("content") or row.get("history")
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

    return cast(dict[str, Any], strip_none(payload))


def map_company_payload(row: pd.Series) -> dict[str, Any] | None:
    if not row.get("krs") or not row.get("name"):
        return None
    payload = {
        "krs": row.get("krs"),
        "name": row.get("name"),
        "city": row.get("city"),
        "owns": row.get("children") or [],
        "teryt": str(row.get("teryt_code")).removesuffix(".0")
        if pd.notna(row.get("teryt_code"))
        else None,
    }
    return cast(dict[str, Any], strip_none(payload))


def map_region_payload(row: pd.Series) -> dict[str, Any] | None:
    if len(str(row["id"])) > 4:
        return None

    name = str(row["name"])
    id_str = str(row["id"])
    if len(id_str) == 2:
        name = f"Województwo {name}"
    elif len(id_str) == 4 and name.lower() == name:
        name = f"Powiat {name}"
    elif len(id_str) == 7:
        name = f"Gmina {name}"

    node_id = f"teryt{id_str}"

    payload: dict[str, Any] = {
        "node_id": node_id,
        "type": "region",
        "name": name,
        "teryt": id_str,
        "revision_id": node_id,
    }

    parent_id = row.get("parent_id")
    if parent_id and str(parent_id) != "nan" and str(parent_id) != "None":
        parent_id_str = str(parent_id)
        parent_node_id = f"teryt{parent_id_str}"
        edge_id = f"edge_{parent_node_id}_{node_id}_owns"

        payload["edge"] = {
            "edge_id": edge_id,
            "source": parent_node_id,
            "target": node_id,
            "type": "owns",
            "revision_id": f"rev_{edge_id}",
        }

    return payload


class UploadPayloads(Pipeline):
    filename = None

    people: Extract
    companies: CompaniesMerged
    regions: Regions

    def process(self, ctx: Context) -> pd.DataFrame:
        people_df = self.people.read_or_process(ctx)
        companies_df = self.companies.read_or_process(ctx)

        # Region filtering for companies
        region = getattr(self.people.args, "region", None)
        if region:
             companies_df = companies_df[companies_df["teryt_code"].fillna("").str.startswith(region)]
             print(f"Filtered to {len(companies_df)} relevant companies for region {region}")

        companies_df_lookup = companies_df.dropna(subset=["krs", "name"])
        company_lookup = dict(
            zip(companies_df_lookup["krs"], companies_df_lookup["name"])
        )

        payloads = []

        print("Processing people payloads...")
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

        print("Processing company payloads...")
        for _, row in companies_df.iterrows():
            c_payload = map_company_payload(row)
            if c_payload:
                payloads.append(
                    {
                        "entity_type": "company",
                        "entity_id": row.get("krs"),
                        "krs": row.get("krs"),
                        "teryt_powiat": [],
                        "payload": c_payload,
                    }
                )

        # TODO remove or move to other pipeline
        # print("Processing region payloads...")
        # regions_df["id_str"] = regions_df["id"].astype(str)
        # regions_df["id_len"] = regions_df["id"].astype(str).str.len()
        # regions_df = regions_df.sort_values("id_len")
        # for _, row in regions_df.iterrows():
        #     r_payload = map_region_payload(row)
        #     if r_payload:
        #         payloads.append(
        #             {
        #                 "entity_type": "region",
        #                 "entity_id": str(row.id),
        #                 "krs": None,
        #                 "teryt_powiat": [],
        #                 "payload": json.dumps(r_payload),
        #             }
        #         )

        df = pd.DataFrame(payloads)
        # Ensure 'payload' is always a valid JSON string for DuckDB
        if not df.empty and "payload" in df.columns:
            df["payload"] = df["payload"].apply(lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x)
        return df
