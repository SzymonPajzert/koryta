"""Which companies in the register ledger the public owns, and through whom.

`KRSRegisterOwners` keeps what the register says about who owns each company;
this decides which of those owners are the public. Five kinds of answer, most
direct first, and a company carries the first one that fits:

- **founding organ** - `organPodmiotZalozycielskiMinisterNadzorujacy`, which is
  how an SPZOZ, a state enterprise or an institute names the body it belongs
  to. The same signal `company_from_api_krs` reads.
- **Skarb Państwa**, however the register spells the minister acting for it.
- **a gmina, a powiat or a województwo** - `JstIndex.resolve`, the resolver
  `CompaniesKRS` uses, so a name it can place here it places there too.
- **a public body outside KRS** - a union of gminas, the metropolis, a state
  agency, fund or forest. They own companies under their own names and have no
  KRS number for the parent test below to follow, so they are named here.
  Deliberately a closed list: a prefix like "AGENCJA" or "INSTYTUT" is as often
  an advertising agency as a state one.
- **a company already known to be public**, by its KRS number: anything
  `CompaniesKRS` marks public, and anything this finds, followed to a fixed
  point, so a subsidiary of a subsidiary of a gmina's holding company arrives
  with the rest.

Two things it cannot see, and says so rather than guessing. An S.A. with several
shareholders names none of them in the register, so a województwo's minority
in one is invisible here; REGON's ownership code (`REGON_PUBLIC_OWNERSHIP`)
covers some of those. And a public owner under 10% of a spółka z o.o. is not
listed at all.
"""

import typing
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from scrapers.krs.columns import is_public, padded_krs
from scrapers.krs.list import CompaniesKRS
from scrapers.krs.register import STATUS_OK, KRSRegisterOwners, owner_share
from scrapers.map.jst import SKARB_PANSTWA, JstIndex, normalise
from scrapers.map.teryt import Jst
from scrapers.stores import Context, Pipeline

REASON_FOUNDING_ORGAN = "founding_organ"
REASON_SKARB_PANSTWA = "skarb_panstwa"
REASON_JST = "jst"
REASON_PUBLIC_BODY = "public_body"
REASON_PUBLIC_PARENT = "public_parent"

#: Public legal persons that own companies without a KRS number of their own,
#: as the start of their normalised name. Found by reading every owner in a
#: 1,750-entry sample of the register that was neither a person, a company nor
#: a government `JstIndex` places - KOWR was the one public name among 137 -
#: plus the bodies `names_an_owner` already names as the ones REGON has to
#: answer for.
PUBLIC_BODY_PREFIXES = (
    # Unions of local governments, which hold utilities for their members.
    "ZWIAZEK GMIN",
    "ZWIAZEK MIEDZYGMINNY",
    "MIEDZYGMINNY ZWIAZEK",
    "ZWIAZEK POWIATOW",
    "ZWIAZEK POWIATOWO",
    "ZWIAZEK KOMUNALNY",
    "KOMUNALNY ZWIAZEK",
    "ZWIAZEK KOMUNIKACYJNY",
    "GORNOSLASKO-ZAGLEBIOWSKA METROPOLIA",
    "GORNOSLASKO - ZAGLEBIOWSKA METROPOLIA",
    "METROPOLIA",
    # State agencies and funds.
    "KRAJOWY OSRODEK WSPARCIA ROLNICTWA",
    "AGENCJA NIERUCHOMOSCI ROLNYCH",
    "AGENCJA WLASNOSCI ROLNEJ SKARBU PANSTWA",
    "AGENCJA MIENIA WOJSKOWEGO",
    "WOJSKOWA AGENCJA MIESZKANIOWA",
    "AGENCJA RESTRUKTURYZACJI I MODERNIZACJI ROLNICTWA",
    "PANSTWOWE GOSPODARSTWO LESNE",
    "LASY PANSTWOWE",
    "PANSTWOWE GOSPODARSTWO WODNE",
    "NARODOWY FUNDUSZ OCHRONY SRODOWISKA",
    "WOJEWODZKI FUNDUSZ OCHRONY SRODOWISKA",
    "BANK GOSPODARSTWA KRAJOWEGO",
    "NARODOWY BANK POLSKI",
    "ZAKLAD UBEZPIECZEN SPOLECZNYCH",
    "PANSTWOWY FUNDUSZ REHABILITACJI",
    "POLSKA AKADEMIA NAUK",
    "SIEC BADAWCZA LUKASIEWICZ",
    "NARODOWE CENTRUM BADAN I ROZWOJU",
)


def public_body(name: str) -> bool:
    """Whether an owner's name is one of `PUBLIC_BODY_PREFIXES`."""
    text = normalise(name).strip(' "')
    return any(text.startswith(prefix) for prefix in PUBLIC_BODY_PREFIXES)


@dataclass
class PublicOwnership:
    """One company the register says the public owns, and the owner that says so."""

    krs: str
    name: str | None
    form: str | None
    wojewodztwo: str | None
    powiat: str | None
    gmina: str | None
    reason: str
    #: The owner's name as the register writes it, or "" for a founding organ.
    owner: str
    #: What the owner resolved to: a TERYT code, `SKARB_PANSTWA`, `AMBIGUOUS`,
    #: or the parent's KRS number for `REASON_PUBLIC_PARENT`.
    owner_id: str | None
    #: The fraction of the company that owner holds, where the register says:
    #: 1.0 for a sole owner, None for a founding organ or a figure it gives no
    #: capital to divide by. A minority stake still counts as public here, as
    #: it does in `CompaniesKRS` - this is what tells the two apart.
    share: float | None


def direct_public_owner(
    entry: dict, jst: JstIndex | None
) -> tuple[str, str, str | None, float | None] | None:
    """`(reason, owner, owner_id, share)` if an owner is plainly the public.

    Plainly meaning without knowing anything about other companies - the parent
    test needs the whole public set and is `classify` below.
    """
    if entry.get("founding_organ"):
        return REASON_FOUNDING_ORGAN, "", None, None
    seat = jst.wojewodztwo_code(entry.get("wojewodztwo")) if jst else None
    for owner in entry.get("owners") or []:
        name = owner.get("name") or ""
        if not name:
            continue
        share = owner_share(owner, entry.get("capital"))
        resolved = jst.resolve(name, seat) if jst else None
        if resolved == SKARB_PANSTWA:
            return REASON_SKARB_PANSTWA, name, SKARB_PANSTWA, share
        if resolved:
            return REASON_JST, name, resolved, share
        if not owner.get("krs") and public_body(name):
            return REASON_PUBLIC_BODY, name, None, share
    return None


def classify(
    entries: typing.Iterable[dict],
    jst: JstIndex | None,
    known_public: set[str],
) -> list[PublicOwnership]:
    """Every entry the public owns, directly or through a public parent.

    `known_public` is the KRS numbers already known to be public from outside
    the ledger - `CompaniesKRS`'s own verdicts. The parent test runs to a fixed
    point over those and whatever this finds, because the ledger holds chains
    the crawl does not: a gmina's holding company and the subsidiaries it owns
    are all in the register, and possibly none in the crawl.
    """
    rows = [e for e in entries if e.get("status") == STATUS_OK]
    found: dict[str, PublicOwnership] = {}

    def record(entry, reason, owner, owner_id, share):
        found[entry["krs"]] = PublicOwnership(
            krs=entry["krs"],
            name=entry.get("name"),
            form=entry.get("form"),
            wojewodztwo=entry.get("wojewodztwo"),
            powiat=entry.get("powiat"),
            gmina=entry.get("gmina"),
            reason=reason,
            owner=owner,
            owner_id=owner_id,
            share=share,
        )

    for entry in rows:
        direct = direct_public_owner(entry, jst)
        if direct is not None:
            record(entry, *direct)

    public = set(known_public) | set(found)
    changed = True
    while changed:
        changed = False
        for entry in rows:
            if entry["krs"] in found:
                continue
            for owner in entry.get("owners") or []:
                parent = owner.get("krs")
                if parent and str(parent).zfill(10) in public:
                    parent = str(parent).zfill(10)
                    record(
                        entry,
                        REASON_PUBLIC_PARENT,
                        owner.get("name") or "",
                        parent,
                        owner_share(owner, entry.get("capital")),
                    )
                    public.add(entry["krs"])
                    changed = True
                    break
    return sorted(found.values(), key=lambda row: row.krs)


def ledger_records(ledger: pd.DataFrame) -> list[dict]:
    """The ledger as `classify` reads it: one dict per entry, KRS padded.

    Read back from jsonl, a value the register left out is NaN rather than
    None, and NaN is truthy - so a seat that is not there reached `JstIndex`
    as if it were a name, and the run stopped on it. A foreign company's
    branch has no seat; 25 of the 20,162 entries read on 2026-09-28 were one.
    """
    ledger = ledger.copy()
    ledger["krs"] = padded_krs(ledger["krs"])
    return ledger.replace({np.nan: None}).to_dict("records")


class CompaniesPublicByRegister(Pipeline[PublicOwnership]):
    """The register ledger's publicly owned companies. See the module doc."""

    filename = "companies_public_by_register"
    dtype = {"krs": str, "owner_id": str}

    ledger: KRSRegisterOwners
    companies: CompaniesKRS
    jst: Jst

    @property
    def output_class(self):
        return PublicOwnership

    def process(self, ctx: Context) -> pd.DataFrame:
        ledger = self.ledger.read_or_process(ctx)
        columns = list(PublicOwnership.__dataclass_fields__)
        if ledger is None or ledger.empty:
            return pd.DataFrame(columns=columns)
        self.jst.read_or_process(ctx)
        index = getattr(self.jst, "index", None)

        companies = self.companies.read_or_process(ctx)
        known_public = set(
            padded_krs(companies.loc[is_public(companies["is_public"]), "krs"])
        )

        found = classify(ledger_records(ledger), index, known_public)
        df = pd.DataFrame([asdict(row) for row in found], columns=columns)
        print(
            f"Publicly owned by the register: {len(df)} of {len(ledger)} entries; "
            f"{df['reason'].value_counts().to_dict() if len(df) else {}}"
        )
        return df
