"""ContractsPayloads -- CRU contracts in the shape `/api/ingest/contracts` takes.

`CruUmowy` mirrors the Centralny Rejestr Umow into
`versioned/cru_umowy/cru_umowy.jsonl`; this reads that file and emits one
payload per contract for `koryta_uploader --type contract`. Nothing else in the
umowy feature produces data.

It is a projection rather than a transformation, on purpose. The site stores a
contract as a register record (`frontend/shared/contracts.ts`), so the payload
stays in the register's Polish and the mapping into the site's English shape
happens once, server side, in `frontend/server/utils/contracts.ts`. Two things
that look like this pipeline's job and are not:

  - **Matching a party to a company on koryta.pl.** There is no KRS number
    anywhere in CRU; the only join keys are NIP, REGON and REGON9, and the site
    holds those on the node. The ingest resolves them with one
    `nipNumber in <chunk>` query per 30 ids, and that is also the only place
    that knows which companies exist *today* -- a match decided here would be
    stale the moment a company is added.
  - **Dropping a private individual's name.** 18,505 contracts (12.4%) name
    one, and the site never stores it -- but that decision lives at the storage
    boundary, behind `STORE_INDIVIDUAL_NAMES` in the ingest, where a test can
    prove the bytes never reached Firestore. Dropping `imie`/`nazwisko` here
    too would make that test pass for the wrong reason, and would leave the
    endpoint unguarded for whatever posts to it next.

What this does drop is everything the site has nowhere to put: the party's
street address (only `miejscowosc` survives -- it is what tells two companies of
the same name apart), the register's own denormalisations of `strony`
(`identyfikatory`, `liczba_stron`, `zamawiajacy_*`), and the mirror's
bookkeeping (`zaimportowano`, `data_modyfikacji`, `detale_blad`). A payload is
posted 149,683 times; a field nothing renders is bandwidth and an index entry.

Run it the way `submit_people.sh` runs its payloads, and for the same reason --
the framework's own progress lines go to stdout, so the payload stream has to
leave by the other channel or the uploader spends the run skipping log lines:

    uv run koryta ContractsPayloads --output stderr 2>&1 1>/dev/null |
      uv run koryta_uploader --type contract --submit

`filename = None`, so nothing is written to `versioned/`: the stream is the
whole product. A contract payload is the mirror with the unused columns taken
out, and the mirror is already 318 MB -- storing the projection beside it would
be a third copy of the same six weeks of the register.
"""

import typing

import pandas as pd

from scrapers.cru.umowy import CruUmowy
from scrapers.stores import Context, Pipeline
from scrapers.stores.file import LocalFile

#: The contract fields the site reads. `opis_wartosci_przedmiotu` is in the
#: list because `Contract.valueNote` is printed verbatim beside a withheld or
#: unusual amount, and nothing else in the payload can produce it.
CONTRACT_FIELDS = (
    "id_umowy",
    "zrodlo",
    "numer_umowy",
    "przedmiot_umowy",
    "wartosc_przedmiotu",
    "opis_wartosci_przedmiotu",
    "data_zawarcia_umowy",
    "data_zakonczenia_umowy",
    "umowa_na_czas_nieoznaczony",
    "status_umowy",
    "data_publikacji",
    "ma_osobe_fizyczna",
)

#: What a redaction says, all four fields of it. The site prints the basis next
#: to „Utajniono", so the legal reason travels with the absence: 766 contracts
#: withhold a value and 160 a subject, and an empty cell would read as a bug
#: here rather than as a decision by a public body.
REDACTION_FIELDS = ("zakres", "podstawa", "komentarz", "organ_lub_osoba_wylaczajaca")

#: One amendment. `data_zmiany_raw` is deliberately absent: it is the original
#: string kept only when it did not parse, and `ContractAmendment.date` is
#: documented as absent in exactly that case. The site has no field for a date
#: it cannot order by.
AMENDMENT_FIELDS = ("rodzaj_zmiany", "data_zmiany", "komentarz")

#: One party. The address is cut down to `miejscowosc` (see the module
#: docstring), and `imie`/`nazwisko` are sent so that the ingest is the thing
#: that drops them.
PARTY_FIELDS = (
    "kolejnosc",
    "rodzaj",
    "nazwa",
    "imie",
    "nazwisko",
    "nip",
    "regon",
    "regon9",
    "miejscowosc",
)

#: Column order for the empty frame, so a run that emits nothing still returns
#: the shape the uploader reads rather than a frame with no columns at all.
PAYLOAD_COLUMNS = (
    *CONTRACT_FIELDS,
    "niejawnosc_przedmiotu",
    "niejawnosc_wartosci_przedmiotu",
    "zmiany_umowy",
    "strony",
)


def _subset(source: dict, fields: tuple[str, ...]) -> dict:
    """`fields` of `source`, every one of them present, missing ones as None.

    Present-but-None rather than omitted so that every payload has the same
    keys: `pd.DataFrame.from_records` takes its columns from the records it is
    given, and a frame whose columns depend on which contract happened to come
    first is a frame that silently loses a field. The uploader strips the nulls
    again before posting.
    """
    return {field: source.get(field) for field in fields}


def redaction_payload(value: typing.Any) -> dict | None:
    """One `niejawnosc` object, or None where the register withheld nothing.

    A redaction and a missing value are separate questions -- five contracts
    carry the flag *and* state a figure -- so this never infers one from the
    other. It only copies what the register said.
    """
    if not isinstance(value, dict):
        return None
    return _subset(value, REDACTION_FIELDS)


def party_payload(party: dict) -> dict:
    """One row of `strony`."""
    payload = _subset(party, PARTY_FIELDS)
    payload["niejawnosc"] = redaction_payload(party.get("niejawnosc"))
    return payload


def contract_payload(record: dict) -> dict | None:
    """One contract as the ingest takes it, or None if it has no id.

    The id is the one field with no fallback: the ingest derives the Firestore
    document id from it (`contractDocumentId`), which is what makes a re-ingest
    land on the document it already wrote instead of a second copy of the whole
    register.
    """
    if not record.get("id_umowy"):
        return None

    payload = _subset(record, CONTRACT_FIELDS)
    payload["niejawnosc_przedmiotu"] = redaction_payload(
        record.get("niejawnosc_przedmiotu")
    )
    payload["niejawnosc_wartosci_przedmiotu"] = redaction_payload(
        record.get("niejawnosc_wartosci_przedmiotu")
    )
    payload["zmiany_umowy"] = [
        _subset(zmiana, AMENDMENT_FIELDS)
        for zmiana in record.get("zmiany_umowy") or []
        if isinstance(zmiana, dict)
    ]
    # Sorted by `kolejnosc` rather than trusted in file order, because the
    # ingest reads `strony[0]` as the institution doing the spending and every
    # „kto komu zaplacil" sentence on the site follows from that one index.
    # `scrapers.cru.records` numbers the parties by enumerating them, so the
    # two agree today; this makes the payload's own order the thing the server
    # depends on, whatever a later re-dump does.
    parties = [p for p in record.get("strony") or [] if isinstance(p, dict)]
    parties.sort(key=lambda p: p.get("kolejnosc") or 0)
    payload["strony"] = [party_payload(party) for party in parties]
    return payload


class ContractsPayloads(Pipeline):
    """Ingest payloads for every contract in the CRU mirror.

    Every contract is emitted, including the 42 `zrodlo == "wynik"` rows the
    register indexes but will not serve details for. They arrive with
    `strony == []` and no buyer NIP, and the site renders them as one honest
    line -- dropping them here would be a silent edit of the register, and the
    coverage figures the whole feature is built on would stop adding up.

    Nothing is filtered by whether koryta.pl has the company either. Only the
    site knows that (13,333 of 149,683 contracts have at least one end on a
    company we describe, touching 825 of them), so the filter lives in the
    ingest behind `skipUnlinked` and this pipeline offers it everything.
    """

    volatile = True
    filename = None

    # Declared as a bare class annotation, which is how the framework reads a
    # dependency, so `koryta ContractsPayloads` rebuilds the mirror when it is
    # stale. `from __future__ import annotations` must never be added to this
    # module: `_annotated_classes` keeps only annotations that are already
    # classes, so PEP 563 would turn this into the string "CruUmowy" and drop
    # the dependency with no error at all -- the same trap, and the same note,
    # as in `scrapers/cru/umowy.py`.
    umowy: CruUmowy

    def contracts(self, ctx: Context) -> typing.Iterator[dict]:
        """The mirror's rows, streamed, parsed by `json` and not by pandas.

        Two reasons this is not the obvious `self.umowy.read_or_process(ctx)`:

        - `CruUmowy` is an `IncrementalJsonlPipeline`, and that base class
          returns an **empty** DataFrame whenever its output is already fresh,
          to avoid loading a multi-GB file into pandas just to report success.
          So the obvious call would emit 149,683 contracts on the run that
          rebuilds the mirror and zero on every run after it, reporting nothing
          wrong either time.
        - `pd.read_json` needs every identifier column pinned in `dtype` or it
          reads the REGON "000524832" as the integer 524832, and `dtype` cannot
          reach inside `strony`, where most of the identifiers are. `json.loads`
          has no opinion: a JSON string stays a `str`.

        Streaming also keeps the run flat. The mirror is 318 MB; measured peak
        RSS for the whole pipeline, payload list and printed frame included, is
        849 MB.
        """
        return ctx.io.read_data(
            LocalFile(self.umowy.output_path(), "versioned")
        ).read_jsonl()

    def process(self, ctx: Context) -> pd.DataFrame:
        payloads: list[dict] = []
        without_id = 0
        for record in self.contracts(ctx):
            payload = contract_payload(record)
            if payload is None:
                without_id += 1
                continue
            payloads.append(payload)

        if without_id:
            print(f"Skipped {without_id} rows with no id_umowy")

        # Counted and printed because the failure mode of this pipeline is
        # silence: it reads a file another pipeline wrote, and both an empty
        # mirror and a mirror read through the wrong API come out as "emitted 0
        # payloads" with no error. These three counts are the ones with known
        # values to compare against -- 149,683 contracts, 42 without details,
        # 18,505 naming a private individual -- so a run that quietly read half
        # the file says so here.
        no_details = sum(1 for p in payloads if p["zrodlo"] == "wynik")
        individuals = sum(1 for p in payloads if p["ma_osobe_fizyczna"])
        parties = sum(len(p["strony"]) for p in payloads)
        print(
            f"Emitting {len(payloads)} contract payloads with {parties} parties "
            f"({no_details} the register served no details for, {individuals} "
            f"naming a private individual)"
        )

        if not payloads:
            return pd.DataFrame(columns=list(PAYLOAD_COLUMNS))
        return pd.DataFrame.from_records(payloads)
