"""The night's invariants on declared posts, run on made-up edges.

`test_invariants` reads the production export, so its tests only run with
`-m e2e`. These call its checks on a person of Testowo and the posts at one
place, as the declarations automation would leave them, so the checks' own
rules are tested every run.
"""

import pytest

from tests.pipelines import test_invariants as invariants

PERSON = "person-testowo"
PLACE = "place-testowo"
CREATED = "created"
ITEM = f"{'a' * 64}-p0"


def post(edge_id: str, name: str | None, **fields) -> dict:
    """An employment of the person at the place."""
    return {
        "id": edge_id,
        "type": "employed",
        "source": PERSON,
        "target": PLACE,
        "name": name,
        **fields,
    }


def created(name: str, role_id: str, as_of: str = "2024-12-31", **fields) -> dict:
    """A post the automation created, with the label of the chip readers
    agreed on and one entry of its declaration."""
    entry = {
        "url": "https://bip.testowo.pl/oswiadczenie-2024.pdf",
        "as_of": as_of,
        "kind": "annual",
        "band": "employer",
        "role": name,
        "roleId": role_id,
        "by": "readers",
        "readers": 2,
        "at": "2026-11-21T10:00:00Z",
    }
    return post(
        CREATED, name, as_of=as_of, declared={f"{ITEM}:employer:0": entry}, **fields
    )


def twins(post_created: dict, *others: dict) -> bool:
    """Whether the night finds the created post a second copy of another."""
    try:
        invariants.test_a_declared_post_is_not_a_second_copy_of_one_stored(
            [post_created, *others], {CREATED}
        )
    except AssertionError:
        return True
    return False


@pytest.mark.parametrize(
    ("name", "chip", "other"),
    [
        ("starosta", "starosta", post("other", "dyrektor Wydziału Komunikacji")),
        ("wicestarosta", "wicestarosta", post("other", "zastępca dyrektora")),
        ("sekretarz", "sekretarz", post("other", "sekretarz rady")),
        ("członek zarządu", "czlonek_zarzadu", post("other", "pełnomocnik zarządu")),
        (
            "dyrektor",
            "dyrektor",
            post(
                "other", "Prezes Zarządu, Dyrektor Generalny", start_date="2020-01-01"
            ),
        ),
    ],
)
def test_a_post_of_another_family_beside_it_is_no_twin(name, chip, other):
    """The site keeps these apart, so the automation creates the post beside
    the other one, and the night has to agree."""
    assert not twins(created(name, chip), other)


@pytest.mark.parametrize(
    ("name", "chip", "other"),
    [
        ("naczelnik", "naczelnik", post("other", "Kierownik Referatu Inwestycji")),
        ("dyrektor", "dyrektor", post("other", "p.o. dyrektora")),
        ("zastępca dyrektora", "zastepca_dyrektora", post("other", "z/ca dyrektora")),
        ("prezes", "prezes", post("other", "Zarząd", start_date="2019-06-01")),
    ],
)
def test_a_post_of_its_family_beside_it_is_a_twin(name, chip, other):
    """The automation would have written onto the other post: one family."""
    assert twins(created(name, chip), other)


def test_a_created_post_is_matched_by_its_entries_chip():
    """Its name is the label its chip had when it was created; what the
    automation matched it by is the chip, whose id and family stay."""
    by_chip = created("dyrektor", "kierownik")
    assert twins(by_chip, post("other", "Kierownik Referatu"))
    assert not twins(by_chip, post("other", "dyrektor"))


def test_a_spell_that_ended_before_the_declaration_is_another_post():
    assert not twins(
        created("dyrektor", "dyrektor"),
        post("other", "dyrektor", start_date="2005-09-01", end_date="2010-08-31"),
    )


def test_a_removed_post_beside_it_is_no_twin():
    assert not twins(
        created("dyrektor", "dyrektor"), post("other", "dyrektor", deleted=True)
    )


def ageless(*edges: dict) -> bool:
    """Whether the night finds a created post that says nothing of how old it
    is."""
    try:
        invariants.test_a_post_a_declaration_created_says_how_old_it_is(
            list(edges), {CREATED}
        )
    except AssertionError:
        return True
    return False


def test_a_created_post_carries_its_entries_and_their_as_of():
    assert not ageless(created("dyrektor", "dyrektor"))


@pytest.mark.parametrize(
    "change",
    [
        {"as_of": None},
        {"as_of": ""},
        {"declared": {}},
        {"declared": None},
        {"declared": {f"{ITEM}:employer:0": None}},
        {"declared": {}, "as_of": None},
    ],
)
def test_a_created_post_without_entries_or_as_of_is_counted(change):
    """A write that dropped the entries, or a withdrawal that left the post
    behind: withdrawing an item soft-deletes a post it created that no other
    entry holds."""
    assert ageless({**created("dyrektor", "dyrektor"), **change})


def test_a_created_post_withdrawn_whole_is_not_counted():
    withdrawn = {**created("dyrektor", "dyrektor"), "declared": {}, "deleted": True}
    assert not ageless(withdrawn)
