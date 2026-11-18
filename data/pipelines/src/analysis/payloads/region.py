import json
import typing
from typing import Any

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from scrapers.map.teryt import Regions
from scrapers.stores import Context, Pipeline


class RegionPayloads(Pipeline):
    """The region nodes the site needs: every place with a government of its own.

    Wojewodztwa and powiaty are emitted whole - 16 and 380 - because a company's
    seat is recorded at powiat level and every one of them is used.

    Gminy were not, until 2026-11-18: TERYT has 2,479 real ones, the site
    fetches the whole region collection into the browser to draw a table, and
    only the gminy something pointed at were emitted - those named as the owner
    of a company, 706 of the 2,479. Every region page now shows who governs the
    place, filled from PKW's results (`scripts/region_authorities.py`), and
    Szymon asked for a page for every gmina ("Yes, every gmina"): so every gmina
    with a government is emitted - urban, rural and urban-rural (RODZ 1, 2, 3)
    outside the cities with powiat rights - and every Warsaw district (8).

    Still left out unless something points at them: the town and rural halves of
    an urban-rural gmina (4, 5) and a city's delegatury (9), which govern
    nothing, and a city with powiat rights' own gmina row, whose government is
    on the city's powiat node. The owners from `Companies` (`parents`) are kept
    too, so no node an ownership edge points at disappears.
    """

    filename = "region_payloads"

    regions: Regions
    companies: Companies

    def gminy_owning_a_company(self, ctx: Context) -> frozenset[str]:
        """Every gmina-level TERYT code named as an owner of some company."""
        companies_df = self.companies.read_or_process(ctx)
        referenced: set[str] = set()
        for parents in companies_df.get("parents", []):
            for parent in parents if isinstance(parents, (list, np.ndarray)) else []:
                if not isinstance(parent, dict):
                    continue
                teryt = parent.get("teryt")
                # 7 characters is WOJ+POW+GMI+RODZ, the gmina level. Shorter
                # codes are powiaty and wojewodztwa, which are emitted anyway.
                if isinstance(teryt, str) and len(teryt) == 7:
                    referenced.add(teryt)
        print(f"{len(referenced)} gminy are named as an owner of some company")
        return frozenset(referenced)

    def process(self, ctx: Context) -> pd.DataFrame:
        regions_df = self.regions.read_or_process(ctx)
        governed = gminy_with_a_government(regions_df["id"].astype(str))
        print(f"{len(governed)} gminy and districts have a government of their own")
        keep_gminy = self.gminy_owning_a_company(ctx) | governed
        # TODO type this correctly
        payloads: list[dict[str, Any]] = []
        regions_df["id_str"] = regions_df["id"].astype(str)
        regions_df["id_len"] = regions_df["id"].astype(str).str.len()
        regions_df = regions_df.sort_values("id_len")
        for _, row in regions_df.iterrows():
            r_payload = map_region_payload(row, keep_gminy)
            if r_payload:
                payloads.append(
                    {
                        "entity_id": str(row.id),
                        "krs": None,
                        "teryt_powiat": [],
                        "payload": json.dumps(r_payload),
                    }
                )

        df = pd.DataFrame(payloads)
        # Ensure 'payload' is always a valid JSON string for DuckDB
        if not df.empty and "payload" in df.columns:
            df["payload"] = df["payload"].apply(
                lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x
            )
        return df


def gminy_with_a_government(ids: typing.Iterable[str]) -> frozenset[str]:
    """The gmina-level codes (WOJ+POW+GMI+RODZ) of every place that elects a
    government of its own: an urban, rural or urban-rural gmina outside the
    cities with powiat rights (powiat code 61 and up, whose government is on
    the powiat node), and a Warsaw district."""
    governed = set()
    for code in ids:
        if len(code) != 7:
            continue
        city = int(code[2:4]) >= 61
        if code[6] == "8" or (code[6] in "123" and not city):
            governed.add(code)
    return frozenset(governed)


def map_region_payload(
    row: pd.Series, keep_gminy: frozenset[str] = frozenset()
) -> dict[str, Any] | None:
    """One region's ingest payload, or None if the site has no use for it.

    Anything below powiat level is dropped unless it is in `keep_gminy`: of
    TERYT's 3,952 gmina rows, the miasto and obszar-wiejski halves of every
    miejsko-wiejska govern nothing (`gminy_with_a_government`), and the region
    collection is fetched unpaginated by the browser.
    """
    id_str_raw = str(row["id"])
    if len(id_str_raw) > 4 and id_str_raw not in keep_gminy:
        return None

    name = str(row["name"])
    id_str = str(row["id"])
    if len(id_str) == 2:
        name = f"Województwo {name}"
    elif len(id_str) == 4 and name.lower() == name:
        name = f"Powiat {name}"
    elif len(id_str) == 7 and id_str[6] == "8":
        # A Warsaw district, as the seven already on the site are named.
        name = f"{name} (Warszawa)"
    elif len(id_str) == 7:
        name = f"Gmina {name}"

    node_id = f"teryt{id_str}"

    # No `revision_id`: it is a pointer to a revision document, so only whatever
    # writes the region can know it. This payload used to carry the node's own id
    # (`teryt02`) and `rev_<edge_id>` for the edge, as a way of saying "publish
    # this" - which reads as published, but leaves 405 regions and 375 edges
    # pointing at revisions that do not exist. `computeRevisionsObj` then marks
    # every one of them as having an unapproved change, forever, and
    # /api/revisions/byNode reports an approved revision nobody can fetch.
    # Publishing is `createRevisionTransaction(..., approve=True)`'s job; see
    # frontend/scripts/migrate/repair-revision-pointers.ts for the repair.
    payload: dict[str, Any] = {
        "node_id": node_id,
        "type": "region",
        "name": name,
        "teryt": id_str,
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
        }

    return payload
