import collections
import json
from typing import Any

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from scrapers.map.teryt import Regions
from scrapers.stores import Context, Pipeline

#: TERYT's RODZ - the last digit of a seven-digit code - of a gmina, and the
#: words that name one by its kind where a town and its villages share a name.
GMINA_KINDS = {"1": "Gmina miejska", "2": "Gmina wiejska", "3": "Gmina miejsko-wiejska"}

#: RODZ of a Warsaw dzielnica, which has an urząd of its own like a gmina.
DZIELNICA = "8"

#: The parts of a gmina - the town (4) and the villages (5) of a gmina
#: miejsko-wiejska, and the delegatury of four cities (9) - and how each is
#: named. They have no urząd of their own.
PART_NAMES = {"4": "Miasto {}", "5": "Obszar wiejski {}", "9": "{}"}


class RegionPayloads(Pipeline):
    """The region nodes the site needs.

    Every województwo, powiat and gmina, and every Warsaw dzielnica: 16, 380,
    2,479 and 18. Until 2026-11-22 only the gminy something pointed at had a
    node, 985 of them; a gmina's urząd was otherwise reached only through its
    powiat, which made a second tier of gminy (decision on 2026-11-22).

    The parts of a gmina are emitted only when something points at one, and
    what points at them is ownership: the register names one as the owner of a
    company, and `Companies` carries the resolved codes on `parents`.
    """

    filename = "region_payloads"

    regions: Regions
    companies: Companies

    def gminy_owning_a_company(self, ctx: Context) -> frozenset[str]:
        """Every gmina-level TERYT code named as an owner of some company,
        which is what makes a part of a gmina worth a node."""
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
        keep_parts = self.gminy_owning_a_company(ctx)
        regions_df = self.regions.read_or_process(ctx)
        shared = shared_gmina_names(regions_df)
        # TODO type this correctly
        payloads: list[dict[str, Any]] = []
        regions_df["id_str"] = regions_df["id"].astype(str)
        regions_df["id_len"] = regions_df["id"].astype(str).str.len()
        regions_df = regions_df.sort_values("id_len")
        for _, row in regions_df.iterrows():
            r_payload = map_region_payload(row, keep_parts, shared)
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


def shared_gmina_names(regions_df: pd.DataFrame) -> frozenset[tuple[str, str]]:
    """The (powiat, name) of every name two gminy of one powiat share - a town
    and the villages around it, 143 times in TERYT: Wejherowo the town and
    Wejherowo the gmina wiejska, both in powiat wejherowski."""
    counts = collections.Counter(
        (code[:4], str(name))
        for code, name in zip(regions_df["id"].astype(str), regions_df["name"])
        if len(code) == 7 and code[6] in GMINA_KINDS
    )
    return frozenset(key for key, count in counts.items() if count > 1)


def map_region_payload(
    row: pd.Series,
    keep_parts: frozenset[str] = frozenset(),
    shared: frozenset[tuple[str, str]] = frozenset(),
) -> dict[str, Any] | None:
    """One region's ingest payload, or None if the site has no use for it.

    A gmina is "Gmina <name>", or "Gmina miejska <name>" and the like where
    another gmina of its powiat has the same name (decision on 2026-11-22). Such
    a payload says, in `replaces`, the shared name it is to take over from, so
    the ingest renames a node that carries it and no other name. A dzielnica is
    "<name> (Warszawa)", as the ones already on the site are. A part of a gmina
    is emitted only when it is in `keep_parts`.
    """
    id_str = str(row["id"])
    name = str(row["name"])
    replaces: list[str] = []
    if len(id_str) == 2:
        name = f"Województwo {name}"
    elif len(id_str) == 4:
        if name.lower() == name:
            name = f"Powiat {name}"
    elif len(id_str) == 7 and id_str[6] in GMINA_KINDS:
        if (id_str[:4], name) in shared:
            replaces = [f"Gmina {name}"]
            name = f"{GMINA_KINDS[id_str[6]]} {name}"
        else:
            name = f"Gmina {name}"
    elif len(id_str) == 7 and id_str[6] == DZIELNICA:
        name = f"{name} (Warszawa)"
    elif len(id_str) == 7 and id_str[6] in PART_NAMES and id_str in keep_parts:
        name = PART_NAMES[id_str[6]].format(name)
    else:
        return None

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
    if replaces:
        payload["replaces"] = replaces

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
