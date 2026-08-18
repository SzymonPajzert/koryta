"""Flood aid from SUDOP, as payloads for `/api/ingest/aid`.

Four steps, in the order they cost:

1. `SudopAid` pulls every decision granted for disaster damage since the 2024
   flood. One request, four to eight minutes of queueing, 9461 rows.
2. `SudopBeneficiaries` resolves the beneficiaries' NIPs to KRS numbers through
   the biała lista. 124 requests, and the answer barely changes between runs, so
   it is cached like any other pipeline output.
3. `KorytaPeoplePowiats` reads the people already on the site and the powiats
   each is tied to, from the nightly Firestore export.
4. `AidPayloads` rolls the decisions up per (grantor, beneficiary, measure) and
   emits one payload per beneficiary.

The rollup is where the size of this lands. 9461 decisions are 5232 pairs, and
a beneficiary only becomes a node if the graph has something to join it to:

- **748** have a KRS number, and go through the ownership pipeline koryta.pl
  already runs for every company it tracks.
- **2045** are sole traders. They enter only if CEIDG names an owner who is
  already a person on the site *and* that person is tied to the powiat the
  business sits in. On the data as of 2026-08-18 that is nobody: 21 names
  collide and all 21 are the wrong powiat. See `scrapers.sudop.people`.
- The rest are unknown to the biała lista and stay out.

Everything dropped stays in the totals this pipeline prints. See
`aidRequestSchema` in frontend/shared/api.ts, which enforces the same rules at
the other end rather than trusting this one.
"""

import argparse
import collections
import dataclasses
import typing
from functools import cached_property

import pandas as pd

from scrapers.koryta.download import FirestoreCollection
from scrapers.stores import Context, Pipeline
from scrapers.sudop import api, ceidg, people, whitelist


@dataclasses.dataclass
class AidDecision:
    """One decision as SUDOP reports it, with the fields this pipeline reads.

    `gross` and not `nominal` is what everything downstream sums. For a
    dotacja they are equal; for an odroczenie terminu płatności składki the
    nominal value is the whole deferred contribution while the benefit is only
    the interest that went unpaid, so a ranking on nominal values is a ranking
    of who deferred the most.
    """

    grantor_nip: str
    grantor_name: str
    beneficiary_nip: str
    beneficiary_name: str
    measure: str
    granted_on: str
    gross: float
    nominal: float
    form: str
    pkd: str
    size: str
    teryt: str


@dataclasses.dataclass
class SudopBeneficiary:
    nip: str
    krs: str
    regon: str
    name: str


def _decimal(raw: typing.Any) -> float:
    """A złoty amount as SUDOP writes it.

    The API returns amounts as strings, and has been seen using both the dot
    and the comma for the decimal separator in the same field.
    """
    if raw is None or raw == "":
        return 0.0
    return float(str(raw).replace(" ", "").replace(",", "."))


class SudopAid(Pipeline[AidDecision]):
    """Every decision under one aid measure, straight from the register."""

    filename = "sudop_aid"
    measure: str = api.FLOOD_MEASURE

    @property
    def output_class(self):
        return AidDecision

    def process(self, ctx: Context):
        rows = api.flood_decisions(self.measure)
        decisions = [
            AidDecision(
                grantor_nip=row.get("nip-udzielajacego-pomocy", ""),
                grantor_name=row.get("nazwa-udzielajacego-pomocy", ""),
                beneficiary_nip=row.get("nip-beneficjenta", ""),
                beneficiary_name=row.get("nazwa-beneficjenta", ""),
                measure=row.get("srodek-pomocowy-numer", self.measure),
                granted_on=row.get("dzien-udzielenia-pomocy", ""),
                gross=_decimal(row.get("wartosc-brutto-pln")),
                nominal=_decimal(row.get("wartosc-nominalna-pln")),
                form=row.get("forma-pomocy-nazwa", ""),
                pkd=row.get("sektor-dzialalnosci-kod", ""),
                size=row.get("wielkosc-beneficjenta-nazwa", ""),
                teryt=row.get("gmina-siedziby-kod", ""),
            )
            for row in rows
        ]
        return pd.DataFrame.from_records(
            [dataclasses.asdict(decision) for decision in decisions]
        )


class SudopBeneficiaries(Pipeline[SudopBeneficiary]):
    """The register numbers behind the beneficiaries' NIPs."""

    filename = "sudop_beneficiaries"

    aid: SudopAid

    @property
    def output_class(self):
        return SudopBeneficiary

    def process(self, ctx: Context):
        decisions = self.aid.read_or_process(ctx)
        nips = sorted({str(nip) for nip in decisions["beneficiary_nip"].dropna()})
        print(f"Resolving {len(nips)} beneficiary NIPs through the biała lista")
        resolved = whitelist.resolve(nips)

        with_krs = sum(1 for entry in resolved.values() if entry["krs"])
        print(
            f"{len(resolved)} of {len(nips)} known to the register, "
            f"{with_krs} of them in KRS"
        )
        return pd.DataFrame.from_records(
            [
                dataclasses.asdict(
                    SudopBeneficiary(
                        nip=nip,
                        krs=entry["krs"],
                        regon=entry["regon"],
                        name=entry["name"],
                    )
                )
                for nip, entry in sorted(resolved.items())
            ]
        )


def _as_list(value: typing.Any) -> list[str]:
    """A stored array, whichever shape Firestore handed it back in.

    koryta.pl's node arrays come back as objects keyed by a stringified index -
    see `asArray` on the frontend - so a plain `isinstance(value, list)` misses
    most of them.
    """
    if isinstance(value, dict):
        return [str(item) for item in value.values() if item]
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if item]
    return []


class KorytaPeoplePowiats(Pipeline):
    """Everyone on koryta.pl, and the powiats they are tied to.

    The powiats come from `stats.edges.all.targetNodeIds`, which holds the id of
    every node an edge from this person reaches - region nodes among them, under
    ids of the form `teryt1607`. That is where a person stood for office, or
    where a company they hold a post in is seated, and it is the only thing this
    pipeline has with which to tell one Krzysztof Nowak from another.
    """

    filename = "koryta_people_powiats"

    def process(self, ctx: Context):
        nodes, export_date = FirestoreCollection.latest_on_or_before(
            ctx, "nodes", "person"
        )
        print(f"Reading people from the koryta.pl export of {export_date}")

        rows = []
        for data in nodes.to_dict(orient="records"):
            targets = _as_list(
                ((data.get("stats") or {}).get("edges") or {})
                .get("all", {})
                .get("targetNodeIds")
            )
            powiats = sorted(
                {
                    people.powiat_of(target[len("teryt") :])
                    for target in targets
                    if target.startswith("teryt")
                }
                - {""}
            )
            rows.append(
                {
                    "node_id": data["id"],
                    "name": data.get("name", ""),
                    "powiats": powiats,
                }
            )
        with_powiat = sum(1 for row in rows if row["powiats"])
        print(f"{len(rows)} people, {with_powiat} of them tied to a powiat")
        return pd.DataFrame.from_records(rows)


def _payloads(
    decisions: typing.Iterable[dict],
    register: dict[str, dict[str, str]],
    owner_by_nip: dict[str, dict[str, str]] | None = None,
    koryta_people: dict[str, list[people.Person]] | None = None,
) -> list[dict]:
    """Decisions rolled up into one payload per beneficiary per programme.

    Grouped twice: once by (beneficiary, measure), to make the payload, and
    once by grantor inside it, to make the edge. What comes out is one grant per
    edge the ingest will write, in place of 9461 rows.

    The measure is part of the outer key and not just a field on the payload,
    because it is part of the edge's identity at the other end - see
    `EDGE_SEMANTICS.aid`. A company paid under both SA.116730 and SA.117151 is
    two payloads, and folding it into one would silently drop whichever
    programme did not happen to be on its latest decision.

    Every beneficiary in the register is emitted. An earlier version of this
    kept only the 748 with a KRS number, on the grounds that a sole trader has
    no ownership register behind it and so could never gain an edge. That was
    the wrong call for this data: reading it by hand turns up single-decision
    micro-firms that are exactly as interesting as the large repeat recipients,
    and a filter that drops four in five beneficiaries drops them before anyone
    can look. The whole register goes in; what varies is what is *published*,
    which the ingest decides and a reviewer can change.

    `owner_by_nip` and `koryta_people` are no longer a gate but an enrichment:
    when a sole trader's owner is a person the site already tracks *and* that
    person is tied to the powiat the business sits in, the payload carries the
    link. It stays hard to satisfy on purpose - see `scrapers.sudop.people`,
    where the measurement behind that rule is written down.
    """
    owner_by_nip = owner_by_nip or {}
    koryta_people = koryta_people or {}
    by_beneficiary: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for decision in decisions:
        key = (str(decision["beneficiary_nip"]), str(decision["measure"]))
        by_beneficiary[key].append(decision)

    payloads = []
    for (nip, measure), rows in sorted(by_beneficiary.items()):
        known = register.get(nip)
        krs = (known or {}).get("krs")
        owner = owner_by_nip.get(nip)
        # The seat CEIDG holds for the business, falling back to the one SUDOP
        # reported when there is no CEIDG key - the same powiat, one register
        # removed.
        owner_teryt = str(
            (owner or {}).get("teryt")
            or max(rows, key=lambda row: row["granted_on"] or "")["teryt"]
            or ""
        )
        matched = (
            people.match(str(owner["name"]), owner_teryt, koryta_people)
            if owner
            else None
        )
        grants: dict[str, dict] = {}
        for row in rows:
            grantor = str(row["grantor_nip"])
            grant = grants.setdefault(
                grantor,
                {
                    "grantor_nip": grantor,
                    "grantor_name": row["grantor_name"],
                    "gross": 0.0,
                    "decisions": 0,
                    "first_decision": row["granted_on"],
                    "last_decision": row["granted_on"],
                },
            )
            grant["gross"] += float(row["gross"])
            grant["decisions"] += 1
            granted_on = row["granted_on"]
            if granted_on:
                grant["first_decision"] = min(grant["first_decision"], granted_on)
                grant["last_decision"] = max(grant["last_decision"], granted_on)

        # The name and the seat are read off the latest decision rather than the
        # first: a company that moved or was renamed between two grants is
        # better described by the more recent one.
        latest = max(rows, key=lambda row: row["granted_on"] or "")
        pkd = sorted({str(row["pkd"]) for row in rows if row["pkd"]})

        payload: dict[str, typing.Any] = {
            "measure": measure,
            "nip": nip,
            "name": str(latest["beneficiary_name"]),
            "grants": [
                # Rounded to the grosz: the sums are floats, and a total that
                # renders as 31513545.200000003 is not more precise for it.
                {**grant, "gross": round(grant["gross"], 2)}
                for grant in sorted(grants.values(), key=lambda grant: -grant["gross"])
            ],
        }
        if krs:
            payload["krs"] = str(krs).zfill(10)
        if known is not None:
            # Stated rather than left to the endpoint's default, because "the
            # register answered and named no KRS entry" is a different fact from
            # "nobody could look this NIP up", and only the first is evidence
            # that a natural person is trading under their own name. The 918
            # beneficiaries the register did not answer for carry no flag and
            # get the endpoint's cautious default.
            payload["soleTrader"] = not krs
        if matched:
            # The name and the powiat both, so the endpoint can check the same
            # rule rather than trusting this pipeline to have applied it.
            payload["owner"] = {
                "name": matched.name,
                "node_id": matched.node_id,
                "teryt": people.powiat_of(owner_teryt),
            }
        if pkd:
            payload["activity"] = pkd
        teryt = str(latest["teryt"] or "")
        if teryt:
            payload["teryt"] = teryt

        payloads.append(payload)

    return payloads


class AidPayloads(Pipeline):
    """Ingest payloads for `/api/ingest/aid`.

    One per (beneficiary, measure), for the beneficiaries the graph has
    something to join to - see `_payloads`.
    """

    volatile = True
    filename = None

    aid: SudopAid
    beneficiaries: SudopBeneficiaries
    koryta_people: KorytaPeoplePowiats

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--ceidg-key",
            help="CEIDG API key, which names the owner of a sole trader. "
            "Apply at https://biznes.gov.pl/pl/e-uslugi/00_9999_00. Without it "
            "the sole traders fall back to the biała lista's name, which is the "
            "same person but without a clean imię/nazwisko split.",
            default=None,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        decisions = self.aid.read_or_process(ctx).to_dict(orient="records")
        beneficiaries = self.beneficiaries.read_or_process(ctx).to_dict(
            orient="records"
        )
        register = {
            str(row["nip"]): {
                "krs": str(row["krs"] or ""),
                "name": str(row["name"] or ""),
                "regon": str(row["regon"] or ""),
            }
            for row in beneficiaries
        }

        sole_traders = [str(row["nip"]) for row in beneficiaries if not row["krs"]]
        if self.args.ceidg_key:
            print(f"Asking CEIDG about {len(sole_traders)} sole traders")
            owner_by_nip = ceidg.owner_of(sole_traders, self.args.ceidg_key)
        else:
            # The biała lista already returns the natural person's name for a
            # sole trader, which is most of what CEIDG would say. It carries no
            # seat for them, so the match falls back to the seat SUDOP reported
            # - the same powiat, one register removed.
            print("No --ceidg-key; falling back to the biała lista's names")
            owner_by_nip = {
                str(row["nip"]): {"name": str(row["name"]), "teryt": ""}
                for row in beneficiaries
                if not row["krs"] and row["name"]
            }

        koryta_people = people.index(
            people.Person(
                node_id=str(row["node_id"]),
                name=str(row["name"]),
                powiats=frozenset(_as_list(row["powiats"])),
            )
            for row in self.koryta_people.read_or_process(ctx).to_dict(orient="records")
        )

        payloads = _payloads(decisions, register, owner_by_nip, koryta_people)
        edges = sum(len(payload["grants"]) for payload in payloads)
        owned = sum(1 for payload in payloads if payload.get("owner"))
        companies = sum(1 for payload in payloads if payload.get("krs"))
        total_gross = sum(
            grant["gross"] for payload in payloads for grant in payload["grants"]
        )
        all_gross = sum(float(row["gross"]) for row in decisions)
        print(
            f"{len(payloads)} payloads: {companies} companies in KRS, "
            f"{len(payloads) - companies} not, {owned} of those tied to somebody "
            f"already on the site. {edges} aid edges, "
            f"{total_gross:,.2f} of {all_gross:,.2f} PLN gross"
        )
        return payloads
