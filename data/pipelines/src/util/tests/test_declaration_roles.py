"""The pipeline's reading of the site's role chips and their families
(`util.declaration_roles`), held to the site's own reading of the same file."""

import json

import pytest

from util.declaration_roles import ROLES_FILE, read_roles

FRONTEND = ROLES_FILE.parents[1]

#: Names with the family each folds into, which the site's test checks against
#: `roleFamilyOf` row for row.
ROLE_NAMES = FRONTEND / "tests" / "shared" / "declarationEmploymentRoleFamilies.json"


def role_names() -> list[tuple[str, str | None]]:
    return [
        (name, family)
        for name, family in json.loads(ROLE_NAMES.read_text(encoding="utf-8"))["names"]
    ]


def test_the_site_reads_the_same_files():
    shared = (FRONTEND / "shared" / "declarationEmployment.ts").read_text("utf-8")
    assert f'import rolesFile from "./{ROLES_FILE.name}";' in shared
    site_test = FRONTEND / "tests" / "shared" / "declarationEmployment.test.ts"
    assert f'from "./{ROLE_NAMES.name}";' in site_test.read_text("utf-8")


@pytest.mark.parametrize(("name", "family"), role_names())
def test_a_name_folds_into_the_family_the_site_folds_it_into(name, family):
    assert read_roles().family(name) == family


def test_every_chip_folds_its_own_label_into_its_family():
    for chip in read_roles().chips:
        assert (chip.id, read_roles().family(chip.label)) == (chip.id, chip.family)


def test_a_chip_is_found_by_its_id():
    roles = read_roles()
    assert roles.chip("wicestarosta") is not None
    assert roles.chip("wicestarosta").family == "office_deputy"
    assert roles.chip("inne").family is None
    assert roles.chip("radny") is None
    assert roles.chip(None) is None
    assert "starostwo" in roles.offered_at["wicestarosta"]


def test_a_missing_name_folds_into_no_family():
    assert read_roles().family(None) is None
    assert read_roles().fold("p.o. Dyrektora") == "dyrektora"
