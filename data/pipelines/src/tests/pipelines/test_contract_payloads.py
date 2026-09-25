"""What `ContractsPayloads` emits, and how `ContractUploader` posts it.

Three things here would each be invisible if they broke, which is why they are
the ones with tests:

  a REGON with a leading zero read back as an integer - the failure the
    docstring at the top of `entities/cru.py` exists for, and the one that would
    silently stop every contract for that institution from matching a company;

  a `zrodlo == "wynik"` contract dropped instead of emitted - 42 of them, with
    no parties at all, and dropping them is a silent edit of the register that
    also makes every coverage figure on the site stop adding up;

  the uploader posting one contract per request - which is not an error, just
    12.5 hours of `time.sleep` for the 149,683 contracts in the first window.
"""

import collections
import json
import typing
from unittest.mock import MagicMock

import pandas as pd

from analysis.payloads.contract import ContractsPayloads, contract_payload
from scrapers.stores import Context, Pipeline, ProcessPolicy
from uploader import CONTRACT_BATCH, ContractUploader

#: A real row from `versioned/cru_umowy/cru_umowy.jsonl`, cut down to the fields
#: the payload keeps. The REGON is the one `entities/cru.py` names.
UMOWA = {
    "id_umowy": "00067b71-47aa-4e23-81c3-d523b5a0c1a4",
    "zrodlo": "umowa",
    "status_umowy": "Aktywna",
    "numer_umowy": "WKS.526.60.2026",
    "data_zawarcia_umowy": "2026-07-08",
    "data_zakonczenia_umowy": None,
    "umowa_na_czas_nieoznaczony": False,
    "przedmiot_umowy": "Organizacja zajec w ramach Lata w Miescie",
    "wartosc_przedmiotu": 1500.0,
    "opis_wartosci_przedmiotu": None,
    "niejawnosc_przedmiotu": None,
    "niejawnosc_wartosci_przedmiotu": None,
    "zmiany_umowy": [],
    "ma_osobe_fizyczna": False,
    "liczba_stron": 2,
    "identyfikatory": ["000524832", "5360015621"],
    "zamawiajacy_nazwa": "URZAD MIASTA LEGIONOWO",
    "data_publikacji": "2026-07-24",
    "zaimportowano": "2026-07-24 15:16:35.886057+00",
    "strony": [
        {
            "kolejnosc": 0,
            "rodzaj": "JSFP",
            "nazwa": "URZAD MIASTA LEGIONOWO",
            "imie": None,
            "nazwisko": None,
            "nip": "5360015621",
            "regon": "000524832",
            "regon9": "000524832",
            "ulica": "ul. marsz. Jozefa Pilsudskiego",
            "kod_pocztowy": "05-120",
            "miejscowosc": "Legionowo",
            "niejawnosc": None,
        },
        {
            "kolejnosc": 1,
            "rodzaj": "Przedsiebiorca",
            "nazwa": "FUNDACJA ELITE LEGIONOWO",
            "nip": "5361982599",
            "regon": "529645575",
            "regon9": "529645575",
            "miejscowosc": "Legionowo",
            "niejawnosc": None,
        },
    ],
}

#: One of the 42 contracts the register indexes but will not serve details for.
WYNIK: dict[str, typing.Any] = {
    "id_umowy": "ff9a7a0e-0000-4000-8000-000000000042",
    "zrodlo": "wynik",
    "status_umowy": "Aktywna",
    "przedmiot_umowy": "Dostawa artykulow biurowych",
    "wartosc_przedmiotu": None,
    "data_zawarcia_umowy": None,
    "data_publikacji": "2026-07-30",
    "ma_osobe_fizyczna": False,
    "zmiany_umowy": [],
    "strony": [],
    "detale_blad": "Nie udalo sie pobrac szczegolow umowy",
}


def emit(records: list[dict]) -> pd.DataFrame:
    """What the pipeline emits for `records`, without the 318 MB mirror.

    `read_jsonl` is the seam on purpose: it is the streaming, `json.loads`
    reader this pipeline uses instead of `CruUmowy.read_or_process`, which
    returns an empty frame whenever the mirror is already fresh.
    """
    pipeline = Pipeline.create(ContractsPayloads)
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    ctx.io.read_data.return_value.read_jsonl.return_value = iter(records)
    return pipeline.process(ctx)


def test_a_leading_zero_regon_stays_a_string():
    """`000524832` is a real REGON and 524832 is not a number at all.

    The mirror is read line by line with `json.loads` rather than through
    `pd.read_json`, which needs every identifier column pinned in `dtype` and
    cannot reach inside `strony` at all. This is the assertion that says so.
    """
    df = emit([UMOWA])

    buyer = df["strony"].iloc[0][0]
    assert buyer["regon"] == "000524832"
    assert buyer["regon9"] == "000524832"
    assert buyer["nip"] == "5360015621"
    # The frame is what the framework prints from, so the round trip through
    # pandas has to keep it a string too.
    assert json.loads(df.to_json(orient="records"))[0]["strony"][0]["regon"] == (
        "000524832"
    )


def test_a_detail_less_contract_is_emitted_not_dropped():
    """`zrodlo == "wynik"`, `strony == []`, and it still goes to the site.

    The site renders these as one honest line. Dropping them here would be a
    silent edit of the register, and the coverage sentence every contracts
    surface is built from would be counting a denominator we had quietly
    changed.
    """
    df = emit([WYNIK])

    assert len(df) == 1
    assert df["zrodlo"].iloc[0] == "wynik"
    assert df["strony"].iloc[0] == []
    assert pd.isna(df["wartosc_przedmiotu"].iloc[0])


def test_every_payload_has_the_same_keys():
    """Columns come from the records, so a missing key is a lost field.

    `pd.DataFrame.from_records` takes its columns from the dicts it is handed.
    A payload that omitted its empty fields would give a frame whose columns
    depend on which contract happened to come first - here, one where nothing
    downstream could tell a withheld value from a column that never existed.
    """
    df = emit([UMOWA, WYNIK])

    assert set(df.columns) == set(contract_payload(UMOWA))
    assert "przedmiot_umowy" in df.columns
    assert df["niejawnosc_przedmiotu"].isna().all()


def test_the_address_is_cut_down_to_the_town():
    """A street address is not something the site has anywhere to put."""
    payload = contract_payload(UMOWA)
    assert payload is not None
    buyer = payload["strony"][0]

    assert buyer["miejscowosc"] == "Legionowo"
    assert "ulica" not in buyer
    assert "kod_pocztowy" not in buyer
    # The register's own denormalisations of `strony` go the same way: the
    # ingest recomputes them from the parties it is sent.
    assert "identyfikatory" not in payload
    assert "zamawiajacy_nazwa" not in payload
    assert "liczba_stron" not in payload


def test_the_parties_are_ordered_so_that_strony_zero_is_the_buyer():
    """Every „kto komu zaplacil" sentence on the site follows from that index."""
    shuffled = dict(UMOWA, strony=list(reversed(UMOWA["strony"])))
    payload = contract_payload(shuffled)

    assert payload is not None
    assert [p["kolejnosc"] for p in payload["strony"]] == [0, 1]
    assert payload["strony"][0]["rodzaj"] == "JSFP"


def test_a_redaction_keeps_its_legal_basis():
    """The basis travels with the absence, or the site prints a bug instead."""
    redacted = dict(
        UMOWA,
        wartosc_przedmiotu=None,
        niejawnosc_wartosci_przedmiotu={
            "zakres": "Wartosc umowy",
            "podstawa": "art. 5 ust. 2 ustawy o dostepie do informacji publicznej",
            "komentarz": None,
            "organ_lub_osoba_wylaczajaca": "Dyrektor",
        },
    )
    payload = contract_payload(redacted)

    assert payload is not None
    assert payload["niejawnosc_wartosci_przedmiotu"]["podstawa"].startswith("art. 5")
    assert payload["niejawnosc_przedmiotu"] is None


def test_a_contract_without_an_id_is_dropped():
    """The document id is derived from it, so a row without one would collide."""
    assert contract_payload(dict(UMOWA, id_umowy=None)) is None


def uploader(skip_unlinked: bool = True) -> ContractUploader:
    """A ContractUploader without its constructor, which logs in via a browser."""
    instance = object.__new__(ContractUploader)
    instance.args = MagicMock(
        endpoint="http://localhost:3000", skip_unlinked=skip_unlinked
    )
    instance.headers = {}
    instance.counters = collections.Counter()
    instance.unresolved = collections.Counter()
    return instance


def fake_post(recorded: list, body: dict | None = None):
    def post(url, data, headers):
        recorded.append((url, json.loads(data)))
        response = MagicMock(status_code=200)
        response.json.return_value = body if body is not None else {}
        return response

    return post


def contracts(count: int) -> list[dict]:
    return [dict(UMOWA, id_umowy=f"id-{i}") for i in range(count)]


def test_the_uploader_batches(monkeypatch):
    """One request per contract is 149,683 requests and 12.5 hours of sleep."""
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", fake_post(recorded))

    uploader().submit_results(contracts(CONTRACT_BATCH * 2 + 7))

    assert len(recorded) == 3
    assert [len(body["contracts"]) for _, body in recorded] == [
        CONTRACT_BATCH,
        CONTRACT_BATCH,
        7,
    ]
    assert recorded[0][0] == "http://localhost:3000/api/ingest/contracts"
    # Every contract went exactly once: a batching bug that drops or repeats a
    # tail is idempotent at the ingest and invisible in the run's output.
    sent = [c["id_umowy"] for _, body in recorded for c in body["contracts"]]
    assert sent == [c["id_umowy"] for c in contracts(CONTRACT_BATCH * 2 + 7)]


def test_skip_unlinked_travels_with_every_batch(monkeypatch):
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", fake_post(recorded))

    uploader().submit_results(contracts(CONTRACT_BATCH + 1))
    assert [body["skipUnlinked"] for _, body in recorded] == [True, True]

    recorded.clear()
    uploader(skip_unlinked=False).submit_results(contracts(1))
    assert recorded[0][1]["skipUnlinked"] is False


def test_nulls_are_stripped_before_posting(monkeypatch):
    """`z.string().optional()` accepts a missing key and rejects a null one."""
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", fake_post(recorded))

    uploader().submit_results([UMOWA])

    sent = recorded[0][1]["contracts"][0]
    assert "data_zakonczenia_umowy" not in sent
    assert "niejawnosc_przedmiotu" not in sent
    assert sent["wartosc_przedmiotu"] == 1500.0


def test_the_run_sums_the_servers_counters(monkeypatch, capsys):
    """Per batch they say nothing; the totals are what can be checked."""
    recorded: list = []
    monkeypatch.setattr(
        "uploader.requests.post",
        fake_post(
            recorded,
            {
                "written": 2,
                "skipped": 198,
                "linked": 2,
                "bothLinked": 1,
                "unresolvedNips": [{"nip": "5360015621", "count": 3}, "7010000000"],
            },
        ),
    )

    instance = uploader()
    instance.submit_results(contracts(CONTRACT_BATCH + 1))

    assert instance.counters["written"] == 4
    assert instance.counters["skipped"] == 396
    assert instance.counters["bothLinked"] == 2
    # Summed over the run, because a batch of 200 can only name a NIP a few
    # times and the ranking is the whole point of the list.
    assert instance.unresolved["5360015621"] == 6
    assert instance.unresolved["7010000000"] == 2
    assert "5360015621" in capsys.readouterr().err


def test_a_failed_batch_does_not_end_the_run(monkeypatch, capsys):
    """The ingest is idempotent per contract, so a bad batch is re-sendable."""
    calls: list = []

    def post(url, data, headers):
        calls.append(json.loads(data))
        failing = len(calls) == 1
        response = MagicMock(status_code=400 if failing else 200)
        response.text = "zod: przedmiot_umowy"
        response.json.return_value = {"written": 1}
        return response

    monkeypatch.setattr("uploader.requests.post", post)

    instance = uploader()
    instance.submit_results(contracts(CONTRACT_BATCH + 5))

    assert len(calls) == 2
    assert instance.success_count == 5
    assert instance.total == CONTRACT_BATCH + 5
    assert "zod: przedmiot_umowy" in capsys.readouterr().err
