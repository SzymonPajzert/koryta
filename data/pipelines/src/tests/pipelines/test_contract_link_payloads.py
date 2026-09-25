"""What `ContractLinkPayloads` emits, and how `ContractLinkUploader` and
`ContractLinkContractUploader` post the findings and their contracts.

The decisions worth a test are the ones about what the site says of a named
person - which findings go out `public`, what class and control a finding
claims, who is named as one of its people and whose name leads its card - and
that a run never prunes what it did not send: the batches that failed, or
everything outside a `--limit`/`--offset` cut.
"""

import collections
import json
import sys
import typing
from unittest.mock import MagicMock

import pandas as pd

from analysis.payloads.contract import ContractsPayloads
from analysis.payloads.contract_link import (
    ContractLinkPayloads,
    contract_ids_from,
    link_payload,
    rank_for_site,
    visibility_for,
)
from scrapers.stores import Context, Pipeline, ProcessPolicy
from uploader import (
    CONTRACT_BATCH,
    CONTRACT_LINK_BATCH,
    ContractLinkContractUploader,
    ContractLinkUploader,
    Uploader,
    parse_args,
)

#: One line of the findings JSONL, shaped as the research writes it.
FINDING: dict[str, typing.Any] = {
    "rank": 1,
    "nip": "9990000001",
    "krs": ["0000999901"],
    "company": "BUDTEST SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    "companySeat": "gmina Testowo, powiat testowski",
    "status": "verified",
    "strength": "A",
    "inOfficeNow": True,
    "controlNow": True,
    "people": [
        {
            "name": "Jan Testowy",
            "kind": "politician",
            "roles": ["udziałowiec"],
            "sharePct": 33,
            "controlNow": False,
            "controlSince": "2020-05-13",
            "controlUntil": "2025-11-21",
            "candidacies": [
                {"year": 2010, "office": "wójt gminy Testowo", "result": "won"},
                {"year": 2014, "office": "rada powiatu testowskiego", "result": "n/a"},
            ],
            "wonYears": [2010],
            "inOfficeNow": True,
            "committees": ["local committee", "PSL"],
            "officeNote": None,
        }
    ],
    "linked": [
        {
            "name": "Anna Testowa",
            "tie": "wspólniczka",
            "family": None,
            "verdict": "publish",
        },
        {"name": "Ewa Możliwa", "tie": "prezes", "family": None, "verdict": "maybe"},
    ],
    "why": "Opis.",
    "total": 1234567,
    "ownAreaTotal": 1234567,
    "firmTotal": 1234567,
    "firmContracts": 1,
    "deals": 1,
    "dealsBasis": "own_territory",
    "dateFrom": "2026-09-11",
    "dateTo": "2026-09-11",
    "buyers": [
        {
            "name": "GMINA TESTOWO",
            "gmina": "Testowo",
            "powiat": "testowski",
            "wojewodztwo": "mazowieckie",
            "value": 1234567,
            "contracts": 1,
            "ownArea": True,
        }
    ],
    "contractIds": ["00000000-0000-4000-8000-000000000001"],
    "topContract": {
        "id": "00000000-0000-4000-8000-000000000001",
        "subject": "Modernizacja budynku",
        "value": 1234567,
        "valueTotal": 1234567,
        "signedAt": "2026-09-11",
        "suppliers": 1,
        "buyer": {
            "name": "GMINA TESTOWO",
            "wojewodztwo": "mazowieckie",
            "gmina": "",
        },
    },
    "left_out": [],
    "flags": ["control_through_tie", "a_flag_the_site_does_not_know"],
}


def test_only_checked_strong_findings_are_public_by_default():
    assert visibility_for(FINDING, "rule", frozenset(), frozenset()) == "public"
    for status, strength in (
        ("plausible", "A"),
        ("unreviewed", "A"),
        ("verified", "C"),
    ):
        record = dict(FINDING, status=status, strength=strength)
        assert visibility_for(record, "rule", frozenset(), frozenset()) == "gated"


def test_the_owner_overrides_the_rule_and_gating_wins():
    weak = dict(FINDING, strength="D")
    assert (
        visibility_for(weak, "rule", frozenset({"9990000001"}), frozenset()) == "public"
    )
    assert (
        visibility_for(
            FINDING, "rule", frozenset({"9990000001"}), frozenset({"9990000001"})
        )
        == "gated"
    )
    assert visibility_for(FINDING, "none", frozenset(), frozenset()) == "gated"


def test_the_payload_is_the_ingest_shape():
    payload = link_payload(FINDING)
    assert payload is not None
    assert payload["visibility"] == "public"
    assert payload["basis"] == "own_territory"
    assert payload["contractSourceIds"] == ["00000000-0000-4000-8000-000000000001"]
    assert payload["topContract"]["sourceId"] == "00000000-0000-4000-8000-000000000001"
    # Empty strings and Nones are left out rather than sent for zod to refuse.
    assert payload["topContract"]["buyer"] == {
        "name": "GMINA TESTOWO",
        "wojewodztwo": "mazowieckie",
    }
    person = payload["people"][0]
    assert person["committees"] == ["komitet lokalny", "PSL"]
    assert person["candidacies"][1]["result"] == "unknown"
    assert "officeNote" not in person
    assert [t["confirmed"] for t in payload["ties"]] == [True, False]
    # An unknown flag would fail the whole batch at the ingest.
    assert payload["flags"] == ["control_through_tie"]


def test_a_finding_without_a_person_or_a_nip_is_dropped():
    assert link_payload(dict(FINDING, people=[])) is None
    assert link_payload(dict(FINDING, nip="123")) is None


def test_the_pipeline_reads_the_findings_file(tmp_path, monkeypatch):
    path = tmp_path / "findings.jsonl"
    weak = dict(FINDING, nip="1111111111", rank=2, strength="D")
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in (FINDING, weak)) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["koryta", "ContractLinkPayloads", f"--contract-links={path}"],
    )
    pipeline = Pipeline.create(ContractLinkPayloads)
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    frame = pipeline.process(ctx)
    assert list(frame.nip) == ["9990000001", "1111111111"]
    assert list(frame.visibility) == ["public", "gated"]
    assert list(frame["rank"]) == [1, 2]


def test_the_site_ranks_strength_then_money_whatever_is_checked():
    """So a class's teasers interleave with its named findings by money,
    rather than following every checked finding of the class."""
    payloads = [
        {"nip": "1", "strength": "B", "status": "verified", "total": 900},
        {"nip": "2", "strength": "A", "status": "unreviewed", "total": 50},
        {"nip": "3", "strength": "A", "status": "verified", "total": 10},
        {"nip": "4", "strength": "A", "status": "unreviewed", "total": 70},
        {"nip": "5", "strength": "A", "status": "verified", "total": 70},
    ]
    rank_for_site(payloads)
    assert [(p["nip"], p["rank"]) for p in payloads] == [
        # Equal money falls back on the NIP: the rank is the cursor.
        ("4", 1),
        ("5", 2),
        ("2", 3),
        ("3", 4),
        ("1", 5),
    ]


def test_a_finding_with_no_money_counted_is_not_emitted(tmp_path, monkeypatch, capsys):
    """A bank's loan to a gmina is left out, which leaves „0 zł"."""
    path = tmp_path / "findings.jsonl"
    loan = dict(
        FINDING,
        nip="9990000002",
        total=0,
        deals=0,
        flags=["loan_excluded"],
    )
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in (FINDING, loan)) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys, "argv", ["koryta", "ContractLinkPayloads", f"--contract-links={path}"]
    )
    pipeline = Pipeline.create(ContractLinkPayloads)
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    frame = pipeline.process(ctx)
    assert list(frame.nip) == ["9990000001"]
    assert "dropped 1 with no money counted" in capsys.readouterr().out


#: A councillor with no role at the firm, and ties the research left at
#: „maybe" to two people who share the surname.
SURNAME_ONLY = dict(
    FINDING,
    strength="A",
    status="verified",
    controlNow=True,
    people=[
        dict(
            FINDING["people"][0],
            name="Maciej Testowy",
            kind="official",
            roles=[],
            controlNow=True,
            office="radny gminy Przykładowo 2024-2029",
        )
    ],
    linked=[
        {"name": "Michał Testowy", "tie": "właściciel", "verdict": "maybe"},
        {"name": "Jarosław Testowy", "tie": "prezes zarządu", "verdict": "maybe"},
    ],
    flags=["tie_unconfirmed"],
)


def test_a_finding_that_rests_on_a_surname_is_d_and_controls_nothing():
    payload = link_payload(SURNAME_ONLY)
    assert payload is not None
    assert payload["strength"] == "D"
    assert payload["controlNow"] is False
    assert payload["people"][0]["controlNow"] is False
    # Checked or not, a D is not named publicly.
    assert payload["visibility"] == "gated"
    assert payload["flags"] == ["tie_unconfirmed"]


def test_a_role_or_a_confirmed_tie_is_more_than_a_surname():
    with_role = dict(
        SURNAME_ONLY,
        people=[dict(SURNAME_ONLY["people"][0], roles=["prezes zarządu"])],
    )
    confirmed = dict(
        SURNAME_ONLY,
        linked=[dict(SURNAME_ONLY["linked"][0], verdict="publish")],
    )
    for record in (with_role, confirmed):
        payload = link_payload(record)
        assert payload is not None
        assert (payload["strength"], payload["controlNow"]) == ("A", True)
        assert payload["visibility"] == "public"


def test_an_office_the_research_hedged_flags_the_identity():
    person = FINDING["people"][0]
    for key, text in (
        ("office", "wójt gminy Wzorcowo (jeśli to ta sama osoba)"),
        ("office", "wójt gminy Wzorcowo (o ile to ta sama osoba)"),
        ("officeNote", "Prawdopodobnie radny gminy Przykładowo"),
        ("officeNote", "być może wójt gminy Wzorcowo"),
    ):
        record = dict(FINDING, people=[dict(person, **{key: text})])
        payload = link_payload(record)
        assert payload is not None
        assert "identity_unconfirmed" in payload["flags"], text
    plain = dict(FINDING, people=[dict(person, officeNote="wicestarosta od 2024 r.")])
    payload = link_payload(plain)
    assert payload is not None
    assert "identity_unconfirmed" not in payload["flags"]


def test_a_person_is_not_their_own_related_person():
    """The research found a person on the board and listed them among the
    ties as well, at „maybe" - which read as a relative of that name."""
    own = {"name": "jan  testowy", "tie": "wiceprezes zarządu", "verdict": "maybe"}
    record = dict(FINDING, linked=[own], flags=["tie_unconfirmed"])
    payload = link_payload(record)
    assert payload is not None
    assert payload["ties"] == []
    # It was the only doubt about a tie, and it is gone with the tie.
    assert "tie_unconfirmed" not in payload["flags"]

    other = {"name": "Ewa Możliwa", "tie": "prezes", "verdict": "maybe"}
    record = dict(FINDING, linked=[own, other], flags=["tie_unconfirmed"])
    payload = link_payload(record)
    assert payload is not None
    assert [t["name"] for t in payload["ties"]] == ["Ewa Możliwa"]
    assert "tie_unconfirmed" in payload["flags"]


def test_the_lead_is_in_office_then_the_latest_mandate_then_the_research_order():
    """The card leads with `people[0]`, and the teaser's hook comes from it."""
    base = FINDING["people"][0]

    def person(name, in_office, won_years=(), candidacies=()):
        return dict(
            base,
            name=name,
            inOfficeNow=in_office,
            wonYears=list(won_years),
            candidacies=list(candidacies),
        )

    lost = [{"year": 2018, "office": "rada gminy", "result": "lost"}]
    record = dict(
        FINDING,
        people=[
            person("Never Won", False, candidacies=lost),
            person(
                "Won In 2002",
                False,
                candidacies=[{"year": 2002, "office": "rada gminy", "result": "won"}],
            ),
            person("Also Never Won", False, candidacies=lost),
            # A second person on a finding has years but no candidacies.
            person("Sitting Since 2018", True, won_years=[2018, 2024]),
            person("Won In 2014", False, won_years=[2014]),
        ],
    )
    payload = link_payload(record)
    assert payload is not None
    assert [p["name"] for p in payload["people"]] == [
        "Sitting Since 2018",
        "Won In 2014",
        "Won In 2002",
        "Never Won",
        "Also Never Won",
    ]


#: A co-owner the research filed as a politician with no candidacy, mandate,
#: office or note - on a card, a name with nothing saying why it is there.
CO_OWNER: dict[str, typing.Any] = dict(
    FINDING["people"][0],
    name="Zofia Testowa",
    roles=["wspólnik", "prezes zarządu"],
    candidacies=[],
    wonYears=[],
    inOfficeNow=False,
    controlNow=False,
    office="  ",
)


def test_a_person_with_no_candidacy_or_office_is_a_tie():
    record = dict(FINDING, people=[FINDING["people"][0], CO_OWNER])
    payload = link_payload(record)
    assert payload is not None
    assert [p["name"] for p in payload["people"]] == ["Jan Testowy"]
    # Tied by the roles the register gives, so confirmed, and no family.
    assert payload["ties"] == [
        {"name": "Zofia Testowa", "tie": "wspólnik, prezes zarządu", "confirmed": True},
        {"name": "Anna Testowa", "tie": "wspólniczka", "confirmed": True},
        {"name": "Ewa Możliwa", "tie": "prezes", "confirmed": False},
    ]


def test_any_stated_reason_keeps_a_person_among_the_people():
    for reason in (
        {"candidacies": [{"year": 2018, "office": "rada gminy", "result": "lost"}]},
        {"wonYears": [2014]},
        {"office": "sołtys"},
        {"officeNote": "członek zarządu powiatu"},
    ):
        record = dict(FINDING, people=[FINDING["people"][0], dict(CO_OWNER, **reason)])
        payload = link_payload(record)
        assert payload is not None
        assert len(payload["people"]) == 2, reason
        assert len(payload["ties"]) == 2, reason


def test_nobody_is_moved_when_nobody_would_be_left():
    """The finding is still about them; the site decides what to show."""
    payload = link_payload(dict(FINDING, people=[CO_OWNER]))
    assert payload is not None
    assert [p["name"] for p in payload["people"]] == ["Zofia Testowa"]
    assert [t["name"] for t in payload["ties"]] == ["Anna Testowa", "Ewa Możliwa"]


def test_control_held_only_by_a_moved_person_is_control_through_a_tie():
    """The finding says the firm is held today, and nobody left among its
    people holds it - the tie does, which is what the flag says."""
    politician = dict(FINDING["people"][0], controlNow=False)
    holder = dict(CO_OWNER, controlNow=True)
    record = dict(FINDING, controlNow=True, people=[politician, holder], flags=[])
    payload = link_payload(record)
    assert payload is not None
    assert payload["controlNow"] is True
    assert payload["flags"] == ["control_through_tie"]

    both = dict(record, people=[dict(politician, controlNow=True), holder])
    payload = link_payload(both)
    assert payload is not None
    assert payload["flags"] == []

    past = dict(record, controlNow=False)
    payload = link_payload(past)
    assert payload is not None
    assert payload["flags"] == []


def test_the_run_counts_the_people_it_moved(tmp_path, monkeypatch, capsys):
    path = tmp_path / "findings.jsonl"
    with_co_owner = dict(
        FINDING, nip="9990000003", people=[FINDING["people"][0], CO_OWNER]
    )
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in (FINDING, with_co_owner))
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys, "argv", ["koryta", "ContractLinkPayloads", f"--contract-links={path}"]
    )
    pipeline = Pipeline.create(ContractLinkPayloads)
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    frame = pipeline.process(ctx)
    assert [len(people) for people in frame.people] == [1, 1]
    assert "moved 1 without a candidacy or an office" in capsys.readouterr().out


def test_the_buyer_count_is_every_payer_not_just_the_listed_ones():
    buyer = FINDING["buyers"][0]
    payload = link_payload(dict(FINDING, buyerCount=17))
    assert payload is not None
    assert payload["buyerCount"] == 17
    payload = link_payload(dict(FINDING, buyers=[buyer, buyer]))
    assert payload is not None
    assert payload["buyerCount"] == 2


def test_contracts_are_narrowed_to_the_ones_a_finding_names(tmp_path, monkeypatch):
    path = tmp_path / "findings.jsonl"
    path.write_text(json.dumps(FINDING) + "\n", encoding="utf-8")
    assert contract_ids_from(str(path)) == {"00000000-0000-4000-8000-000000000001"}

    monkeypatch.setattr(
        sys, "argv", ["koryta", "ContractsPayloads", f"--contract-ids-from={path}"]
    )
    pipeline = Pipeline.create(ContractsPayloads)
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    records = [
        {
            "id_umowy": "00000000-0000-4000-8000-000000000001",
            "zrodlo": "umowa",
            "strony": [],
        },
        {"id_umowy": "someone-else", "zrodlo": "umowa", "strony": []},
    ]
    ctx.io.read_data.return_value.read_jsonl.return_value = iter(records)
    frame: pd.DataFrame = pipeline.process(ctx)
    assert list(frame.id_umowy) == ["00000000-0000-4000-8000-000000000001"]


def uploader(cls=ContractLinkUploader, limit=None, offset=0):
    """An uploader without its constructor, which logs in via a browser."""
    instance = object.__new__(cls)
    instance.args = MagicMock(
        endpoint="http://localhost:3000",
        limit=limit,
        offset=offset,
        skip_unlinked=True,
    )
    instance.headers = {}
    instance.counters = collections.Counter()
    instance.unresolved = collections.Counter()
    return instance


def recording_post(recorded: list, fail_call: int | None = None):
    """`requests.post` that records `(url, body)` and fails call `fail_call`."""

    def post(url, data, headers):
        recorded.append((url, json.loads(data)))
        failing = len(recorded) == fail_call
        response = MagicMock(status_code=500 if failing else 200)
        response.text = "boom"
        response.json.return_value = {
            "written": 1,
            "deleted": 0,
            "summary": {"public": 1, "gated": 0},
        }
        return response

    return post


def findings(count: int) -> list[dict]:
    links = [link_payload(dict(FINDING, nip=f"{n:010d}")) for n in range(1, count + 1)]
    assert all(link is not None for link in links)
    return typing.cast(list[dict], links)


def test_the_uploader_batches_and_then_prunes(monkeypatch):
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", recording_post(recorded))
    uploader().submit_results(findings(120))

    batches = [body for _, body in recorded if body["links"]]
    assert [len(b["links"]) for b in batches] == [
        CONTRACT_LINK_BATCH,
        CONTRACT_LINK_BATCH,
        20,
    ]
    final = recorded[-1][1]
    assert final["links"] == [] and len(final["final"]["keep"]) == 120
    assert final["final"]["keep"][0] == "cru_0000000001"
    assert all(url.endswith("/api/ingest/contracts/powiazania") for url, _ in recorded)


def test_a_failed_batch_means_nothing_is_pruned(monkeypatch):
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", recording_post(recorded, 2))
    uploader().submit_results(findings(120))
    assert not any("final" in body for _, body in recorded)


def test_a_partial_run_uploads_but_never_prunes(monkeypatch, capsys):
    """A trial `--limit 5` would otherwise delete every other finding."""
    for cut in ({"limit": 5}, {"offset": 3}):
        recorded: list = []
        monkeypatch.setattr("uploader.requests.post", recording_post(recorded))
        uploader(**cut).submit_results(findings(5))
        assert [len(body["links"]) for _, body in recorded] == [5]
        assert not any("final" in body for _, body in recorded)
        assert "not pruning" in capsys.readouterr().err


def contracts(count: int) -> list[dict]:
    return [
        {"id_umowy": f"id-{n}", "zrodlo": "umowa", "strony": []} for n in range(count)
    ]


def test_the_findings_contracts_go_to_their_own_route_and_are_pruned(monkeypatch):
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", recording_post(recorded))
    uploader(ContractLinkContractUploader).submit_results(contracts(CONTRACT_BATCH + 3))

    assert all(
        url == "http://localhost:3000/api/ingest/contracts/powiazania/umowy"
        for url, _ in recorded
    )
    batches = [body for _, body in recorded if body["contracts"]]
    assert [len(body["contracts"]) for body in batches] == [CONTRACT_BATCH, 3]
    # Every contract is kept: a finding needs all of its own.
    assert not any("skipUnlinked" in body for body in batches)
    final = recorded[-1][1]
    assert final["contracts"] == []
    assert final["final"]["keep"] == [c["id_umowy"] for c in contracts(203)]


def test_the_findings_contracts_are_not_pruned_after_a_failure_or_a_cut(
    monkeypatch, capsys
):
    recorded: list = []
    monkeypatch.setattr("uploader.requests.post", recording_post(recorded, 1))
    uploader(ContractLinkContractUploader).submit_results(contracts(CONTRACT_BATCH + 3))
    assert len(recorded) == 2
    assert not any("final" in body for _, body in recorded)

    for cut in ({"limit": 3}, {"offset": 3}):
        recorded.clear()
        monkeypatch.setattr("uploader.requests.post", recording_post(recorded))
        uploader(ContractLinkContractUploader, **cut).submit_results(contracts(3))
        assert len(recorded) == 1
        assert not any("final" in body for _, body in recorded)
        assert "not pruning" in capsys.readouterr().err


def test_the_findings_contracts_have_their_own_type(monkeypatch):
    monkeypatch.setattr(
        sys, "argv", ["koryta_uploader", "--type", "contract-link-contract"]
    )
    monkeypatch.setenv("KORYTA_ID_TOKEN", "token")
    args = parse_args()
    assert args.type == "contract-link-contract"
    assert isinstance(Uploader.create(args), ContractLinkContractUploader)
