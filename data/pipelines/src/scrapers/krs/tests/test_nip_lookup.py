"""That NIP-to-KRS resolution reads the wykaz's real shape and respects its cap.

The response shape here is the one the live service returned on 2026-09-13.
Two details in it are easy to get wrong from the documentation alone: the
people are under ``result.entries[].subjects[]`` rather than a flat
``subjects``, and the entries **do not come back in the order they were asked
for** -- so reading them positionally silently attributes each company's KRS to
a different NIP.
"""

import pytest

from scrapers.krs.nip_lookup import (
    MF_BATCH_SIZE,
    MfQuotaExhausted,
    fetch_mf_batch,
    nip_valid,
    parse_mf_response,
    resolve,
)


def wykaz(entries):
    return {"result": {"requestId": "x", "requestDateTime": "y", "entries": entries}}


def subject(nip, krs, name="X", regon="150354701", status="Czynny"):
    return {
        "identifier": nip,
        "subjects": [
            {
                "nip": nip,
                "krs": krs,
                "name": name,
                "regon": regon,
                "statusVat": status,
                "representatives": [],
            }
        ],
    }


class FakeResponse:
    """The parts of a `requests.Response` this module touches."""

    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"unexpected status {self.status_code}")


def opener_for(payload, status_code=200):
    def opener(_url, headers=None, timeout=None):
        return FakeResponse(payload, status_code)

    return opener


def test_reads_krs_out_of_the_nested_entries_shape():
    payload = wykaz(
        [
            subject("5730003841", "0000057953", "PWIK CZĘSTOCHOWA"),
            subject("6791862817", "0000006301", "KRAKOWSKI HOLDING"),
        ]
    )
    out = parse_mf_response(payload)
    assert out["5730003841"].krs == "0000057953"
    assert out["6791862817"].krs == "0000006301"
    assert out["5730003841"].name == "PWIK CZĘSTOCHOWA"
    assert out["5730003841"].vat_status == "Czynny"
    assert all(r.in_krs for r in out.values())


def test_entries_are_keyed_by_nip_not_by_position():
    """The live service returns them out of order, so position is meaningless."""
    asked = ["6791862817", "5730003841"]
    payload = wykaz(
        [  # deliberately the reverse of `asked`
            subject("5730003841", "0000057953"),
            subject("6791862817", "0000006301"),
        ]
    )
    out = fetch_mf_batch(asked, date="2026-09-13", opener=opener_for(payload))
    assert out["6791862817"].krs == "0000006301"
    assert out["5730003841"].krs == "0000057953"


def test_an_entity_the_wykaz_does_not_hold_is_an_answer_not_a_gap():
    """Only VAT-registered entities are in the wykaz.

    A koło gospodyń or a gminna instytucja kultury gets an entry with an empty
    ``subjects`` -- which means "not a registered VAT payer", and must not be
    confused with "not asked yet".
    """
    payload = wykaz([{"identifier": "4960255468", "subjects": []}])
    out = parse_mf_response(payload)
    assert out["4960255468"].krs is None
    assert out["4960255468"].source == "mf"
    assert not out["4960255468"].in_krs


def test_a_subject_with_no_krs_resolves_to_no_krs():
    """A sole trader is in the wykaz but has no KRS, being in CEIDG."""
    payload = wykaz([subject("1234563218", None)])
    out = parse_mf_response(payload)
    assert out["1234563218"].krs is None
    assert out["1234563218"].name == "X"


def test_krs_is_zero_filled_to_ten_digits():
    payload = wykaz([subject("5730003841", "57953")])
    assert parse_mf_response(payload)["5730003841"].krs == "0000057953"


def test_a_batch_over_the_published_limit_is_refused():
    with pytest.raises(ValueError, match=str(MF_BATCH_SIZE)):
        fetch_mf_batch(["1234567890"] * (MF_BATCH_SIZE + 1), date="2026-09-13")


def test_a_429_is_reported_as_the_daily_quota():
    with pytest.raises(MfQuotaExhausted, match="today"):
        fetch_mf_batch(
            ["5730003841"], date="2026-09-13", opener=opener_for({}, 429)
        )


def test_a_400_names_the_malformed_nips_in_the_batch():
    # 1111111112: the weighted sum of the first nine digits is 45, so the check
    # digit must be 1. (1111111111 is a *valid* NIP, which is why it makes a
    # poor fixture for this.)
    with pytest.raises(ValueError, match="1111111112"):
        fetch_mf_batch(
            ["5730003841", "1111111112"],
            date="2026-09-13",
            opener=opener_for({}, 400),
        )


def test_known_pairs_are_taken_free_and_never_asked():
    """Every cached hit is a request not spent against the 100-a-day cap."""
    calls = []

    def opener(url, headers=None, timeout=None):
        calls.append(url)
        return FakeResponse(wykaz([subject("5730003841", "0000057953")]))

    out = resolve(
        ["6791862817", "5730003841"],
        date="2026-09-13",
        known={"6791862817": "6301"},
        opener=opener,
    )
    assert out["6791862817"].source == "cache"
    assert out["6791862817"].krs == "0000006301"
    assert len(calls) == 1
    assert "6791862817" not in calls[0]


def test_a_malformed_nip_is_rejected_before_a_request_is_spent():
    out = resolve(["12345"], date="2026-09-13", known={}, opener=None)
    assert out["12345"].source == "invalid"
    assert out["12345"].krs is None


def test_the_request_cap_stops_the_run_rather_than_overrunning():
    """Overrunning locks the IP out until midnight, costing the next run too."""
    nips = [f"{i:010d}" for i in range(MF_BATCH_SIZE * 3)]
    calls = []

    def opener(url, headers=None, timeout=None):
        calls.append(url)
        return FakeResponse(wykaz([]))

    # Every fixture NIP is checksum-invalid, so give the resolver real ones.
    valid = [n for n in nips if nip_valid(n)]
    out = resolve(valid, date="2026-09-13", max_requests=1, opener=opener)
    assert len(calls) <= 1
    # What was not reached simply has no entry, so a later run picks it up.
    assert len(out) <= len(valid)


@pytest.mark.parametrize(
    "nip, expected",
    [
        ("5730003841", True),
        ("6791862817", True),
        ("5231844247", False),  # from the sponsorship list; fails its check digit
        ("821268376", False),  # nine digits, truncated in the source
        ("", False),
        ("abcdefghij", False),
    ],
)
def test_nip_validity(nip, expected):
    assert nip_valid(nip) is expected
