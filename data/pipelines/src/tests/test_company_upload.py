"""What `submit_company` sends to `/api/ingest/company`.

The uploader takes payloads from two different producers and they carry
ownership in two different shapes, which is the whole reason this needs a test:

  `CompaniesPayloads` resolves the register's shareholder list itself and emits
    `owners` (KRS numbers) and `owner_teryts` (TERYT codes) already worked out.

  the `Companies` pipeline, read directly when a person's ingest names a company
    the site does not have yet, emits `parents` - a list of `{krs, teryt}` - and
    no `owners` at all.

`submit_company` used to derive `owners`/`owner_teryts` from `parents`
unconditionally, so the first shape had both fields overwritten with empty
lists. 3,928 companies uploaded, every one reported OK, and not one ownership
edge was written.
"""

from unittest.mock import MagicMock

from uploader import CompanyUploader


def uploader() -> CompanyUploader:
    """A CompanyUploader whose sign-in is never asked for: `submit_payload`,
    which would send, is replaced."""
    instance = CompanyUploader(
        MagicMock(endpoint="http://localhost:3000", type="company"),
        tokens=MagicMock(),
        session=MagicMock(),
    )
    instance.submit_payload = MagicMock(return_value=None)  # type: ignore[method-assign]
    return instance


def sent(instance: CompanyUploader) -> dict:
    return instance.submit_payload.call_args[0][1]  # type: ignore[attr-defined]


def test_owners_already_worked_out_by_the_pipeline_are_kept():
    instance = uploader()
    instance.submit_company(
        "0000076705",
        {
            "krs": "0000076705",
            "name": "PKP SKM w Trojmiescie",
            "owners": ["0000019193"],
            "owner_teryts": ["2261011", "22"],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == ["0000019193"]
    assert payload["owner_teryts"] == ["2261011", "22"]


def test_an_empty_owner_list_from_the_pipeline_is_an_answer():
    """Not "look for parents instead" - the pipeline found no owner."""
    instance = uploader()
    instance.submit_company(
        "0000000001",
        {
            "krs": "0000000001",
            "name": "Nobody's",
            "owners": [],
            "owner_teryts": [],
            "parents": [{"krs": "0000019193", "teryt": None}],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == []
    assert payload["owner_teryts"] == []


def test_parents_are_split_when_the_payload_has_no_owners():
    """The `Companies` shape: a company created because somebody works there."""
    instance = uploader()
    instance.submit_company(
        "0000076705",
        {
            "krs": "0000076705",
            "name": "PKP SKM w Trojmiescie",
            "parents": [
                {"krs": "0000019193", "teryt": None},
                {"krs": None, "teryt": "2261011"},
                {"krs": None, "teryt": "22"},
            ],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == ["0000019193"]
    assert payload["owner_teryts"] == ["2261011", "22"]


def test_the_supervisory_organ_is_filled_in_from_the_legal_form():
    """The `Companies` shape again: a hospital created because somebody sits on
    its rada spoleczna arrives with a `form` and nothing worked out from it."""
    instance = uploader()
    instance.submit_company(
        "0000079907",
        {
            "krs": "0000079907",
            "name": "SP ZOZ Szpital Specjalistyczny nr I w Bytomiu",
            "form": "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        },
    )
    payload = sent(instance)
    assert payload["supervisory_body"] == "rada-spoleczna"
    # ...and the same form is what puts it in the hospitals category, which no
    # PKD rule can do: an SPZOZ sits in the associations register and declares
    # no przedmiot dzialalnosci at all.
    assert payload["categories"] == ["szpitale"]


def test_an_ordinary_company_says_its_organ_is_nothing_special():
    """The empty string rather than a missing key: it is what clears a value
    written before the mapping was corrected. See `ingest/company.post.ts`."""
    instance = uploader()
    instance.submit_company(
        "0000076705",
        {
            "krs": "0000076705",
            "name": "PKP SKM w Trojmiescie",
            "form": "SPÓŁKA AKCYJNA",
        },
    )
    assert sent(instance)["supervisory_body"] == ""


def test_an_organ_the_pipeline_worked_out_is_not_recomputed():
    """`CompaniesPayloads` decides it against the same table, but a payload that
    states the field owns it - the same guard `categories` and `owners` have."""
    instance = uploader()
    instance.submit_company(
        "0000079907",
        {
            "krs": "0000079907",
            "name": "SP ZOZ Szpital Specjalistyczny nr I w Bytomiu",
            "form": "SPÓŁKA AKCYJNA",
            "supervisory_body": "rada-spoleczna",
        },
    )
    assert sent(instance)["supervisory_body"] == "rada-spoleczna"


def test_the_treasury_is_split_out_of_the_parents_shape():
    """The `Companies` path: a company created because somebody works there.

    `submit_company` derives the owner lists from `parents` when the payload has
    none, and has to make the same three-way split `CompaniesPayloads` does -
    otherwise the sentinel lands in `owner_teryts` and the ingest looks for a
    region called "SKARB PANSTWA".
    """
    instance = uploader()
    instance.submit_company(
        "0000322757",
        {
            "krs": "0000322757",
            "name": "Polska Grupa Zbrojeniowa",
            "parents": [
                {"krs": None, "teryt": "SKARB PANSTWA"},
                {"krs": None, "teryt": "1465"},
            ],
        },
    )
    payload = sent(instance)
    assert payload["owner_skarb_panstwa"] is True
    assert payload["owner_teryts"] == ["1465"]
    assert payload["owners"] == []


def test_a_payload_that_states_its_owners_keeps_its_treasury_flag():
    """`CompaniesPayloads` has already made the split; do not redo it."""
    instance = uploader()
    instance.submit_company(
        "0000322757",
        {
            "krs": "0000322757",
            "name": "Polska Grupa Zbrojeniowa",
            "owners": [],
            "owner_teryts": ["1465"],
            "owner_skarb_panstwa": True,
            "parents": [{"krs": "0000019193", "teryt": None}],
        },
    )
    assert sent(instance)["owner_skarb_panstwa"] is True
