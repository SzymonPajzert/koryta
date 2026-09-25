"""ContractLinkPayloads -- the CRU findings, shaped for their ingest route.

The route is `/api/ingest/contracts/powiazania`.

A finding is a supplier in the Centralny Rejestr Umow, the person in power tied
to it, and the institutions that paid it (`frontend/shared/contractLinks.ts`).
The findings come out of the reviewed research on CRU suppliers -- odpisy of
their KRS entries matched to PKW candidacies, the review sheets, the adversarial
pass and the web research on relatives and partners -- which is not a pipeline
of this repository yet. What it hands over is one JSON line per finding (the
machine-readable twin of the summary CSV), and this pipeline is the boundary
between that file and the site: it checks each line, maps it to the ingest's
shape, and decides who is named to a logged out reader.

That last decision is the one this file owns. By default a finding is `public`
only when it is checked (`verified`) *and* its story is one of the two strong
classes -- a person in office now, or elected since 2010, whose own or family
firm is paid by the territory where they won (A and B). Everything else is
`gated`: a signed-in reader sees it in full, an anonymous one a teaser with no
name. `--public-nips` and `--gated-nips` overrule the rule for named suppliers,
and `--contract-links-public none` gates everything.

The class it decides on is the one after this file's own corrections, which
are about what the site would otherwise say of a named person: a finding that
rests on a shared surname is D however the research classed it
(`rests_on_a_surname`), an office the research hedged is flagged
(`hedges_identity`), a person is never their own related person, one with no
candidacy and no office is a tie of the firm rather than one of the people the
finding is about (`holds_nothing_public`), and a finding with no money counted
-- a bank's loan to a gmina, which is left out -- is not emitted at all.

Run it into the uploader like the other payloads -- progress on stdout, the
stream on stderr:

    uv run koryta ContractLinkPayloads --contract-links=/abs/findings.jsonl \\
        --output stderr 2>&1 1>/dev/null |
      uv run koryta_uploader --type contract-link --submit

The contracts a finding joins to are uploaded separately, and only those, into
the findings' own closed collection - which the finding's route reads only
for a reader past the gate:

    uv run koryta ContractsPayloads --contract-ids-from=/abs/findings.jsonl \\
        --output stderr 2>&1 1>/dev/null |
      uv run koryta_uploader --type contract-link-contract --submit

Never with `--type contract`. That is the public `contracts` collection, and
its list would name the firm of every gated finding, with its NIP and its
money, to anybody - the very thing the gate withholds.
"""

import argparse
import json
import re
import typing
from functools import cached_property
from pathlib import Path

import pandas as pd

from scrapers.stores import Context, Pipeline

#: The strength classes a checked finding is named publicly for by default.
PUBLIC_STRENGTHS = frozenset({"A", "B"})

#: The codes the site knows (`contractLinkFlags` in shared/contractLinks.ts). A
#: flag the site does not know would fail the whole batch at the ingest's zod
#: check, so an unknown one is dropped here and counted instead.
KNOWN_FLAGS = frozenset(
    {
        "unreviewed",
        "former_control",
        "control_through_tie",
        "never_elected",
        "own_powiat_fallback",
        "payer_outside_territory",
        "loan_excluded",
        "reverse_payment_excluded",
        "direction_unclear",
        "shared_contract",
        "whole_board",
        "coop_exemption",
        "ownership_open",
        "payer_disputed",
        "tie_unconfirmed",
        "identity_unconfirmed",
    }
)

#: How the research's basis names map to the site's.
BASES = {
    "own_territory": "own_territory",
    "own_powiat": "own_powiat",
    "own_territory_and_powiat": "own_territory_and_powiat",
    "all": "all",
}

#: The weakest class, which a finding that rests on a surname is capped at.
WEAKEST_STRENGTH = "D"

#: How the research hedges who a person is when it writes their office down:
#: „wójt gminy Wzorcowo (jeśli to ta sama osoba)". The first is the phrasing
#: it uses today; the rest are the ways the same doubt is written in Polish.
IDENTITY_HEDGES = re.compile(
    r"\b(?:jeśli|jeżeli|o ile|czy) to (?:ta sama|tą samą) osob"
    r"|\bprawdopodobnie\b|\bbyć może\b|\bprzypuszczalnie\b|\bnajpewniej\b"
    r"|\bniewykluczone\b|\bmożliwe, że\b|\bimienni(?:k|czk)",
    re.IGNORECASE,
)

#: The research tags committees in English; the site shows them.
COMMITTEE_LABELS = {"local committee": "komitet lokalny"}

PAYLOAD_COLUMNS = (
    "nip",
    "krs",
    "company",
    "companySeat",
    "status",
    "strength",
    "visibility",
    "rank",
    "inOfficeNow",
    "controlNow",
    "people",
    "ties",
    "why",
    "total",
    "ownAreaTotal",
    "firmTotal",
    "firmContracts",
    "deals",
    "basis",
    "dateFrom",
    "dateTo",
    "buyers",
    "buyerCount",
    "topContract",
    "contractSourceIds",
    "flags",
)


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Registered in `koryta.get_args` as well, so that a flag's value is never
    read as a positional pipeline name (see `scrapers/cru/config.py`)."""
    parser.add_argument(
        "--contract-links",
        default=None,
        help="For ContractLinkPayloads: the findings, one JSON object a line.",
    )
    parser.add_argument(
        "--contract-links-public",
        choices=["rule", "none"],
        default="rule",
        help="For ContractLinkPayloads: 'rule' names checked A/B findings "
        "publicly and gates the rest; 'none' gates everything.",
    )
    parser.add_argument(
        "--public-nips",
        default="",
        help="For ContractLinkPayloads: comma-separated supplier NIPs to name "
        "publicly whatever the rule says.",
    )
    parser.add_argument(
        "--gated-nips",
        default="",
        help="For ContractLinkPayloads: comma-separated supplier NIPs to gate "
        "whatever the rule says. Wins over --public-nips.",
    )
    parser.add_argument(
        "--contract-ids-from",
        default=None,
        help="For ContractsPayloads: emit only these contracts -- a file of "
        "id_umowy, one a line, or a findings JSONL whose lines carry "
        "`contractIds`.",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


def nip_set(raw: str) -> frozenset[str]:
    return frozenset(
        "".join(ch for ch in part if ch.isdigit())
        for part in raw.split(",")
        if part.strip()
    )


def visibility_for(
    record: dict,
    rule: str,
    public_nips: frozenset[str],
    gated_nips: frozenset[str],
) -> str:
    """`public` or `gated` for one finding; the gated list wins a conflict.

    `link_payload` hands it the capped class, so a finding the research called
    A on a shared surname is judged as the D it is emitted as.
    """
    nip = record["nip"]
    if nip in gated_nips:
        return "gated"
    if nip in public_nips:
        return "public"
    if rule == "none":
        return "gated"
    checked = record.get("status") == "verified"
    return (
        "public" if checked and record.get("strength") in PUBLIC_STRENGTHS else "gated"
    )


def _drop_none(value: typing.Any) -> typing.Any:
    if isinstance(value, dict):
        return {k: _drop_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_drop_none(v) for v in value if v is not None]
    return value


def _named(entries: list[dict] | None) -> list[dict]:
    return [entry for entry in entries or [] if entry.get("name")]


def _name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def rests_on_a_surname(record: dict) -> bool:
    """Whether nothing but a shared surname ties the finding's people to the
    firm: none of them holds a role at the supplier, and the research
    confirmed none of the ties it found there.

    What is left is a councillor whose surname is the owner's. Every class
    above D assumes the person, or a documented relative, controls the firm,
    and a surname does not show that - so such a finding is D and nobody on
    it controls anything.
    """
    if any(
        role
        for person in _named(record.get("people"))
        for role in person.get("roles") or []
    ):
        return False
    return not any(
        tie.get("verdict") == "publish" for tie in _named(record.get("linked"))
    )


def hedges_identity(record: dict) -> bool:
    """Whether the research doubted that a person is the office-holder it
    names - the doubt it writes into `office` or `officeNote` rather than into
    a flag."""
    return any(
        IDENTITY_HEDGES.search(person.get(key) or "")
        for person in _named(record.get("people"))
        for key in ("office", "officeNote")
    )


def holds_nothing_public(person: dict) -> bool:
    """Whether the research gives no reason to name a person beyond their place
    at the firm: no candidacy, no mandate won, no office and no note of one.

    The research files everybody it did not tag as an official as a
    politician, so a co-owner whose candidacies did not reach the summary
    arrives as a politician with nothing to show for it - a name on a card
    with no line saying why it is there. What the finding does know of them is
    their role at the firm, and that is a tie.
    """
    return not (
        person.get("candidacies")
        or person.get("wonYears")
        or (person.get("office") or "").strip()
        or (person.get("officeNote") or "").strip()
    )


def _latest_win(person: dict) -> int:
    # `wonYears` alone for a second person on a finding, whose candidacies the
    # research does not list; the candidacies alone when it forgot the years.
    won = [
        *person["wonYears"],
        *(c["year"] for c in person["candidacies"] if c["result"] == "won"),
    ]
    return max(won, default=0)


def lead_first(people: list[dict]) -> list[dict]:
    """People in the order a card shows them: whoever is in office now, then
    the most recent mandate won, then the research's order.

    The card leads with `people[0]` and the ingest derives the teaser's hook
    from it, while the research lists people in the order it found them - which
    put a councillor of 2002 ahead of the one sitting today on an A finding.
    """
    return sorted(
        people, key=lambda person: (not person["inOfficeNow"], -_latest_win(person))
    )


def person_payload(person: dict) -> dict:
    return _drop_none(
        {
            "name": person["name"],
            "kind": "official" if person.get("kind") == "official" else "politician",
            "roles": [r for r in person.get("roles") or [] if r],
            "sharePct": person.get("sharePct"),
            "controlNow": bool(person.get("controlNow")),
            "controlSince": person.get("controlSince"),
            "controlUntil": person.get("controlUntil"),
            "office": person.get("office"),
            "officeNote": person.get("officeNote"),
            "candidacies": [
                {
                    "year": int(c["year"]),
                    "office": c["office"],
                    "result": c.get("result")
                    if c.get("result") in ("won", "lost")
                    else "unknown",
                }
                for c in person.get("candidacies") or []
            ],
            "wonYears": [int(y) for y in person.get("wonYears") or []],
            "inOfficeNow": bool(person.get("inOfficeNow")),
            "committees": [
                COMMITTEE_LABELS.get(c, c) for c in person.get("committees") or []
            ],
        }
    )


def tie_payload(linked: dict) -> dict:
    return _drop_none(
        {
            "name": linked["name"],
            "tie": linked.get("tie") or "",
            "family": linked.get("family"),
            # The research's own word: a „maybe" tie is shown as unconfirmed.
            "confirmed": linked.get("verdict") == "publish",
        }
    )


def split_people(people: list[dict]) -> tuple[list[dict], list[dict]]:
    """The people a finding names as people, and the ones who
    `holds_nothing_public` and go among its ties instead - none of them when
    that would leave nobody, since the finding is still about them."""
    stated = [p for p in people if not holds_nothing_public(p)]
    if not stated:
        return people, []
    return stated, [p for p in people if holds_nothing_public(p)]


def role_tie(person: dict) -> dict:
    """A person who `holds_nothing_public`, as a tie: tied by their roles at
    the firm, which the register states - so the tie is confirmed."""
    return {
        "name": person["name"],
        "tie": ", ".join(r for r in person.get("roles") or [] if r),
        "confirmed": True,
    }


def link_payload(
    record: dict,
    rule: str = "rule",
    public_nips: frozenset[str] = frozenset(),
    gated_nips: frozenset[str] = frozenset(),
) -> dict | None:
    """One finding as the ingest takes it, or None if it cannot be one.

    A finding needs a NIP (it is the document id) and at least one person (it
    is what the finding is about). Anything else missing is left out and the
    ingest's defaults apply.

    A person who `holds_nothing_public` is emitted among the ties rather than
    the people (`split_people`).
    """
    nip = "".join(ch for ch in str(record.get("nip") or "") if ch.isdigit())
    named = _named(record.get("people"))
    if len(nip) != 10 or not named:
        return None
    people, moved = split_people(named)

    surname_only = rests_on_a_surname(record)
    strength = WEAKEST_STRENGTH if surname_only else record["strength"]
    persons = [person_payload(p) for p in people]
    if surname_only:
        for person in persons:
            person["controlNow"] = False

    # The research lists a person among the firm's related people when it
    # found them on its board too, which reads as somebody else of that name.
    names = {_name_key(p["name"]) for p in named}
    ties = _named(record.get("linked"))
    own = [t for t in ties if _name_key(t["name"]) in names]
    kept = [t for t in ties if _name_key(t["name"]) not in names]

    flags = [f for f in record.get("flags") or [] if f in KNOWN_FLAGS]
    if hedges_identity(record):
        flags.append("identity_unconfirmed")
    if any(t.get("verdict") != "publish" for t in own) and all(
        t.get("verdict") == "publish" for t in kept
    ):
        # The only doubt was the person's own seat on the board, now gone.
        flags = [f for f in flags if f != "tie_unconfirmed"]
    if (
        record.get("controlNow")
        and not surname_only
        and any(p.get("controlNow") for p in moved)
        and not any(p["controlNow"] for p in persons)
    ):
        # Whoever holds the firm today was among the people and is a tie now,
        # which is what the flag says - and what lets the card name the role.
        flags.append("control_through_tie")

    buyers = record.get("buyers") or []
    top = record.get("topContract")
    return _drop_none(
        {
            "nip": nip,
            "krs": [k for k in record.get("krs") or [] if len(str(k)) == 10],
            "company": record.get("company") or nip,
            "companySeat": record.get("companySeat") or None,
            "status": record["status"],
            "strength": strength,
            "visibility": visibility_for(
                {**record, "nip": nip, "strength": strength},
                rule,
                public_nips,
                gated_nips,
            ),
            "rank": int(record["rank"]),
            "inOfficeNow": bool(record.get("inOfficeNow")),
            "controlNow": bool(record.get("controlNow")) and not surname_only,
            "people": lead_first(persons),
            "ties": [role_tie(p) for p in moved] + [tie_payload(t) for t in kept],
            "why": record.get("why") or None,
            "total": round(float(record.get("total") or 0)),
            "ownAreaTotal": round(float(record.get("ownAreaTotal") or 0)),
            "firmTotal": round(float(record.get("firmTotal") or 0)),
            "firmContracts": int(record.get("firmContracts") or 0),
            "deals": int(record.get("deals") or 0),
            "basis": BASES.get(record.get("dealsBasis") or "", "all"),
            "dateFrom": record.get("dateFrom"),
            "dateTo": record.get("dateTo"),
            "buyers": [
                _drop_none(
                    {
                        "name": b.get("name") or "",
                        "gmina": b.get("gmina") or None,
                        "powiat": b.get("powiat") or None,
                        "wojewodztwo": b.get("wojewodztwo") or None,
                        "value": round(float(b.get("value") or 0)),
                        "contracts": int(b.get("contracts") or 0),
                        "ownArea": bool(b.get("ownArea")),
                    }
                )
                for b in buyers
            ],
            # Every payer, where `buyers` lists the biggest twelve - so never
            # fewer than it lists, and just those when the research left it out.
            "buyerCount": max(int(record.get("buyerCount") or 0), len(buyers)),
            "topContract": None
            if not top
            else _drop_none(
                {
                    "sourceId": top["id"],
                    "subject": top.get("subject") or None,
                    "value": round(float(top.get("value") or 0)),
                    "valueTotal": None
                    if top.get("valueTotal") is None
                    else round(float(top["valueTotal"])),
                    "signedAt": top.get("signedAt"),
                    "suppliers": int(top.get("suppliers") or 1),
                    "buyer": {k: v for k, v in (top.get("buyer") or {}).items() if v}
                    or {"name": ""},
                }
            ),
            "contractSourceIds": list(record.get("contractIds") or []),
            # Once each: the ingest caps the list at the number of codes.
            "flags": list(dict.fromkeys(flags)),
        }
    )


def rank_for_site(payloads: list[dict]) -> None:
    """Renumber `rank` in the site's order: the strength of the story, then
    money, then the NIP - so no two findings tie, since the rank is the list's
    cursor.

    How far a finding is checked is not part of it. The research puts every
    checked finding ahead of every unchecked one, and even inside a class that
    runs all the named findings - which are all checked - before the first
    teaser: an anonymous reader scrolled past A findings of a thousand złoty
    before meeting a locked one of a million. By money, the teasers interleave
    with the named findings of their class and the biggest story of a class
    leads it whether or not the review has reached it; the `status` filter and
    label are what say how far it is checked.
    """
    payloads.sort(key=lambda p: (p["strength"], -p["total"], p["nip"]))
    for position, payload in enumerate(payloads, start=1):
        payload["rank"] = position


def contract_ids_from(path: str) -> set[str]:
    """The `id_umowy`s a findings JSONL names, or a plain list of them."""
    ids: set[str] = set()
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            if line.startswith("{"):
                record = json.loads(line)
                ids.update(
                    record.get("contractIds") or record.get("contractSourceIds") or []
                )
            else:
                ids.add(line)
    return ids


class ContractLinkPayloads(Pipeline):
    """Ingest payloads for the findings in `--contract-links`.

    Volatile with no output file, like `ContractsPayloads`: the input is a file
    this repository does not produce, so there is nothing for the framework to
    keep fresh, and the stream is the whole product. Not backed up to the
    shared cache either -- the findings name people, and the shared cache is
    not where a decision about naming them is made.
    """

    volatile = True
    filename = None
    backup_to_shared_cache = False

    @cached_property
    def args(self) -> argparse.Namespace:
        return parse_args()

    def records(self) -> typing.Iterator[dict]:
        path = self.args.contract_links
        if not path:
            raise ValueError(
                "ContractLinkPayloads needs --contract-links=/path/to/findings.jsonl"
            )
        with Path(path).open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)

    def process(self, ctx: Context) -> pd.DataFrame:
        public_nips = nip_set(self.args.public_nips)
        gated_nips = nip_set(self.args.gated_nips)
        payloads: list[dict] = []
        dropped = 0
        no_money = 0
        capped = 0
        moved = 0
        unknown_flags = 0
        for record in self.records():
            unknown_flags += sum(
                1 for flag in record.get("flags") or [] if flag not in KNOWN_FLAGS
            )
            payload = link_payload(
                record, self.args.contract_links_public, public_nips, gated_nips
            )
            if payload is None:
                dropped += 1
                continue
            if payload["total"] <= 0:
                # A bank's loan to a gmina is left out of the total, and what
                # remains is a „0 zł" finding on a page about who was paid.
                no_money += 1
                continue
            capped += rests_on_a_surname(record)
            moved += len(split_people(_named(record.get("people")))[1])
            payloads.append(payload)

        rank_for_site(payloads)
        public = sum(1 for p in payloads if p["visibility"] == "public")
        hedged = sum(1 for p in payloads if "identity_unconfirmed" in p["flags"])
        print(
            f"Emitting {len(payloads)} findings: {public} named publicly, "
            f"{len(payloads) - public} gated"
            + (f"; dropped {dropped} without a NIP or a person" if dropped else "")
            + (f"; dropped {no_money} with no money counted" if no_money else "")
            + (f"; {capped} resting on a surname, capped at D" if capped else "")
            + (f"; {hedged} with an unconfirmed identity" if hedged else "")
            + (
                f"; moved {moved} without a candidacy or an office to the ties"
                if moved
                else ""
            )
            + (f"; ignored {unknown_flags} unknown flags" if unknown_flags else "")
        )
        if not payloads:
            return pd.DataFrame(columns=list(PAYLOAD_COLUMNS))
        return pd.DataFrame.from_records(payloads)
