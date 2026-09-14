"""Where a list of NIPs to look up comes from.

Three sources, because the same question gets asked of differently shaped data:

* **A published spend spreadsheet.** The NIP is buried in a free-text party
  column -- ``"Ars Animae z siedzibą przy ul. Staszica 11, 08-400 Garwolin,
  NIP: 8262224957"`` -- alongside the name and address, with the separator and
  spacing varying by row. This is the common case for a one-off request under
  art. 10 ustawy o dostępie do informacji publicznej.
* **The CRU artifact**, where the NIP is a proper field
  (`entities.cru.CruStrona.nip`) and the interesting cut is which side of the
  contract a party was on.
* **A plain list**, one NIP per line, for a set somebody assembled by hand.

The spreadsheet reader is the one with judgement in it. It reports the rows it
could not read a NIP from rather than dropping them, because those are a
finding about the source: in the 2025-26 sponsorship lists, 15 of 2,205 rows
carry a NIP truncated to nine digits and 6 more fail the check digit -- errors
in the published document, and exactly the sort of thing a silent parser turns
into an unexplained shortfall downstream.
"""

import json
import re
import typing
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from scrapers.krs.nip_lookup import nip_valid, only_digits

#: "NIP: 8262224957", "NIP:5260005468" and "NIP 758-235-51-69" all occur, as do
#: line breaks inside the cell. Ten digit-groups are taken after the label and
#: any separators are stripped, so a dashed NIP reads the same as a bare one.
NIP_LABELLED_RE = re.compile(r"NIP\s*:?\s*((?:\d[\s -]*){9}\d)", re.I)

#: A bare ten-digit run, for a column that holds the NIP and nothing else.
NIP_BARE_RE = re.compile(r"\b(\d{10})\b")


@dataclass
class NipRow:
    """One row of a source, with whatever identified its party."""

    nips: list[str] = field(default_factory=list)
    #: The text the NIP was read out of, kept so a bad read is traceable to
    #: the row that produced it.
    party_text: str = ""
    subject: str = ""
    amount: float | None = None
    #: The contract's value attributed to this party: the whole value split
    #: evenly across its suppliers. The party's own figure, as opposed to
    #: `amount`, which is the contract's -- a 10 m PLN contract with five
    #: suppliers does not make each of them a 10 m PLN counterparty.
    share: float | None = None
    source_row: str = ""
    #: Set when the party is a public body rather than a supplier. For CRU
    #: this is ``kolejnosc == 0``; a spreadsheet does not say.
    is_buyer: bool = False


@dataclass(frozen=True)
class Recipient:
    """One body that took money from a source, aggregated across its rows.

    `NipRow` is one line of a register; this is one counterparty, with every
    line it appeared on already summed. The distinction matters to anything
    that orders a run by value -- a body with six small contracts outranks one
    with a single larger contract, and only the aggregate says so.
    """

    nip: str
    #: The registered name as the source wrote it, trimmed of the address.
    #: Kept because it is what a human will search rejestr.io with.
    name: str
    #: Zloty across every row this body appeared on.
    paid: float
    contracts: int


def total_paid(recipients: typing.Iterable[Recipient]) -> float:
    return sum(r.paid for r in recipients)


def read_nips(text: str) -> list[str]:
    """Every distinct NIP in a cell, labelled form preferred over bare.

    Bare matching is only attempted when the labelled form found nothing: an
    address line can hold a ten-digit run that is a phone number or a REGON
    stem, and preferring the explicit label keeps those out.
    """
    found = [only_digits(m) for m in NIP_LABELLED_RE.findall(text)]
    if not found:
        found = [only_digits(m) for m in NIP_BARE_RE.findall(text)]
    seen: list[str] = []
    for nip in found:
        if len(nip) == 10 and nip not in seen:
            seen.append(nip)
    return seen


#: One amount in a cell: an optional minus, then a single run of digits with
#: spaces, dots and commas inside it. Anchored to one run on purpose --
#: cleaning the whole cell instead glues an annotation's digits onto the
#: figure, so ``"1 200,00 zł (2 faktury)"`` read as 1,200,002.00: a
#: thousandfold overstatement that looks like a plausible amount and would top
#: any ordering by value.
AMOUNT_RE = re.compile(r"(?P<sign>-)?\s*(?P<number>\d[\d\s.,]*\d|\d)")


def money(value: str | None) -> float | None:
    """A złoty amount as written in a spreadsheet: ``"  49 571,72 zł "``.

    Both separators occur in the same file, so the rule inside the run is:
    treat the *last* separator as the decimal point and every earlier one as a
    thousands group. Guessing from the character alone gets ``1,500`` wrong one
    way or the other.

    A leading minus is kept. These lists carry korekty, and dropping the sign
    turns a correction into a payment of the same size -- which is worse than
    reading nothing, because it is counted twice.
    """
    if not value:
        return None
    match = AMOUNT_RE.search(value)
    if not match:
        return None
    cleaned = re.sub(r"[^\d,.]", "", match.group("number"))
    if not cleaned:
        return None
    sign = -1.0 if match.group("sign") else 1.0
    decimal = re.search(r"[,.](\d{1,2})$", cleaned)
    if decimal:
        whole = re.sub(r"\D", "", cleaned[: decimal.start()])
        return sign * float(f"{whole or 0}.{decimal.group(1)}")
    return sign * float(re.sub(r"\D", "", cleaned) or 0)


def from_spreadsheet(
    path: Path,
    party_column: int = 1,
    subject_column: int | None = 2,
    amount_column: int | None = 3,
    index_column: int = 0,
) -> tuple[list[NipRow], list[NipRow]]:
    """Rows of a published spend list, split into (readable, unreadable).

    A data row is recognised by `index_column` holding a bare integer -- the
    ``Lp.`` counter. That is more robust than skipping a fixed number of header
    lines, because these files carry a title block, merged cells and blank
    spacer rows whose count differs between the 2025 and 2026 editions of the
    very same list.
    """
    rows: list[NipRow] = []
    unreadable: list[NipRow] = []

    # pandas rather than the csv module: `scrapers` is kept free of the stdlib
    # IO modules (see the importlinter contract), and pandas is what the rest
    # of the package reads tabular data with anyway. `header=None` because the
    # header is not on the first line, and `dtype=str` because a NIP with a
    # leading zero must not become an integer.
    frame = pd.read_csv(
        path,
        header=None,
        dtype=str,
        encoding="utf-8-sig",
        keep_default_na=False,
        skip_blank_lines=False,
        engine="python",
    )

    for record in frame.itertuples(index=False, name=None):
        if len(record) <= party_column:
            continue
        if not re.fullmatch(r"\d+", str(record[index_column] or "").strip()):
            continue

        party = str(record[party_column] or "")
        row = NipRow(
            nips=read_nips(party),
            party_text=" ".join(party.split()),
            subject=(
                " ".join(str(record[subject_column] or "").split())
                if subject_column is not None and len(record) > subject_column
                else ""
            ),
            amount=(
                money(str(record[amount_column]))
                if amount_column is not None and len(record) > amount_column
                else None
            ),
            source_row=f"{path.name}:{str(record[index_column]).strip()}",
        )
        (rows if row.nips else unreadable).append(row)

    return rows, unreadable


def from_cru(
    path: Path,
    suppliers_only: bool = True,
    limit: int | None = None,
    order_by_value: bool = False,
) -> list[NipRow]:
    """Parties to public contracts, from the `CruUmowy` artifact.

    Defaults to suppliers, i.e. everyone but ``strony[0]``: position 0 is the
    contracting public body, and including it would mix "who was paid" with
    "who paid" in one list.

    `order_by_value` sorts the rows so that every party appears in descending
    order of the money attributed to it across the whole register. That is what
    makes a capped run meaningful: the odpis stage is one request per company,
    so a run stopped at 2,000 covers the 2,000 biggest counterparties rather
    than whichever ones the file happened to list first. `limit` still caps the
    *read*, so the two are not usually combined.
    """
    rows: list[NipRow] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            value = record.get("wartosc_przedmiotu") or 0.0
            suppliers = sum(
                1 for s in record.get("strony", []) if s.get("kolejnosc", 0) != 0
            )
            for strona in record.get("strony", []):
                is_buyer = strona.get("kolejnosc") == 0
                if suppliers_only and is_buyer:
                    continue
                nip = only_digits(strona.get("nip"))
                if len(nip) != 10:
                    continue
                rows.append(
                    NipRow(
                        nips=[nip],
                        party_text=strona.get("nazwa") or "",
                        subject=(record.get("przedmiot_umowy") or "")[:200],
                        amount=record.get("wartosc_przedmiotu"),
                        share=(
                            value / suppliers
                            if suppliers and not is_buyer
                            else 0.0
                        ),
                        source_row=str(record.get("id_umowy")),
                        is_buyer=is_buyer,
                    )
                )
            if limit and len(rows) >= limit:
                break
    if order_by_value:
        totals = attributed_value(rows)
        # By NIP and not by row, so every row of one counterparty stays
        # together: `distinct_nips` reads first-seen order, and interleaving
        # would make the cut fall in the middle of a company's contracts.
        def rank(row: NipRow) -> tuple[float, list[str]]:
            return -max((totals.get(n, 0.0) for n in row.nips), default=0.0), row.nips

        rows.sort(key=rank)
    return rows


def attributed_value(rows: typing.Iterable[NipRow]) -> dict[str, float]:
    """Total contract value attributed to each NIP across these rows.

    One definition, used both to order the population and to price it, so a
    report and the run it describes cannot disagree about what a counterparty
    was paid.
    """
    totals: dict[str, float] = {}
    for row in rows:
        if row.is_buyer:
            continue
        for nip in row.nips:
            totals[nip] = totals.get(nip, 0.0) + (row.share or 0.0)
    return totals


def from_list(path: Path) -> list[NipRow]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        nip = only_digits(line)
        if nip:
            rows.append(NipRow(nips=[nip], source_row=line.strip()))
    return rows


def distinct_nips(rows: typing.Iterable[NipRow]) -> list[str]:
    """Every NIP across the rows, once, in first-seen order.

    Order is kept deliberately: a run capped by the daily request budget then
    covers a prefix of the source rather than an arbitrary subset, so what was
    and was not reached is something a reader can state.
    """
    seen: dict[str, None] = {}
    for row in rows:
        for nip in row.nips:
            seen.setdefault(nip, None)
    return list(seen)


def summarise(rows: list[NipRow], unreadable: list[NipRow]) -> str:
    nips = distinct_nips(rows)
    invalid = [n for n in nips if not nip_valid(n)]
    total = sum(row.amount or 0 for row in rows)
    lines = [
        f"rows with a NIP      {len(rows):>8,}",
        f"rows without one     {len(unreadable):>8,}",
        f"distinct NIPs        {len(nips):>8,}",
        f"  checksum-invalid   {len(invalid):>8,}",
        f"declared value       {total:>14,.2f} PLN",
    ]
    return "\n".join(lines)
