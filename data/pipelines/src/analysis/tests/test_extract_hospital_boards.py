"""Selecting the people who sit on a paid hospital supervisory board.

Three flags have to hold at once and each answers a different question, which
is the whole reason none of them can be dropped:

- ``--company-category szpitale`` says *which companies* - the same rule that
  puts ``categories`` on a place node, so the run selects the people behind
  what the site already shows under that filter.
- ``--employed-role "Rada Nadzorcza"`` says *which kind of post*, because a
  hospital's kierownik and its board sit in the same company.
- ``--paid-supervision`` says *which of those seats is a job*. It has to be
  said separately: rejestr.io reports every supervisory connection as one type
  and `KRS_RELATION_ROLES` labels the whole register "Rada Nadzorcza", so the
  role string on an unpaid rada spoleczna seat is identical to the one on a
  paid rada nadzorcza seat. Only the company's legal form tells them apart.
"""

import dataclasses
from unittest.mock import patch

import pandas as pd
import pytest

from analysis.extract import Extract
from scrapers.stores import Pipeline

SPZOZ = "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ"
SPOLKA = "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"

#: 86.10.Z is "Działalność szpitali", the code `SZPITALE` matches on.
COMPANIES = pd.DataFrame.from_records(
    [
        # A hospital run as a spolka: placed by its PKD code, and its board is
        # a real rada nadzorcza whose members may be paid.
        {
            "krs": "0000000001",
            "name": "Szpital sp. z o.o.",
            "activity": ["86.10.Z"],
            "form": SPOLKA,
        },
        # A hospital run as an SPZOZ: in the associations register, so no PKD
        # code at all, and placed only by its form. Its organ is a rada
        # spoleczna and sitting on it is unpaid.
        {
            "krs": "0000000002",
            "name": "SP ZOZ Szpital Powiatowy",
            "activity": [],
            "form": SPZOZ,
        },
        # Not a hospital at all.
        {
            "krs": "0000000003",
            "name": "Wodociagi",
            "activity": ["36.00.Z"],
            "form": SPOLKA,
        },
    ]
)


@dataclasses.dataclass
class Args:
    """The flags `Extract` reads, defaulted to a run that narrows nothing."""

    all: bool = False
    region: str | None = None
    krss: list[str] | None = None
    approved: bool = False
    rejestrio_id: str | None = None
    employed_after: str | None = None
    currently_employed: bool = False
    ignore_elections: bool = False
    election_after: str | None = None
    public_employer: bool = False
    min_score: int | None = None
    employed_roles: list[str] | None = None
    company_category: str | None = None
    paid_supervision: bool = False


def counting(companies=COMPANIES, **flags):
    extract = Pipeline.create(Extract)
    extract.args = Args(**flags)
    extract.companies.read_or_process = lambda ctx: companies
    return extract.relevant_employment(None)


def parsed(argv):
    """The flags as `Extract.args` reads them off the command line.

    `args` is a cached_property that builds its own parser from sys.argv, so
    the guards it raises can only be reached this way.
    """
    with patch("sys.argv", ["koryta", *argv]):
        return Pipeline.create(Extract).args


def post(krs, role, end=None):
    return {
        "employed_krs": krs,
        "employed_role": role,
        "employed_start": "2023-01-01",
        "employed_end": end,
    }


BOARD_AT_SPOLKA = post("0000000001", "Rada Nadzorcza")
DIRECTOR_AT_SPOLKA = post("0000000001", "Zarząd")
BOARD_AT_SPZOZ = post("0000000002", "Rada Nadzorcza")
DIRECTOR_AT_SPZOZ = post("0000000002", "Zarząd")
BOARD_AT_WODOCIAGI = post("0000000003", "Rada Nadzorcza")

#: What the recommended run says, minus --currently-employed, which is tested
#: on its own below because it is the one flag that already existed.
HOSPITAL_BOARDS = {
    "company_category": "szpitale",
    "employed_roles": ["Rada Nadzorcza"],
    "paid_supervision": True,
}


class TestCompanyCategory:
    def test_a_hospital_run_as_a_spolka_is_placed_by_its_pkd(self):
        assert counting(company_category="szpitale")([BOARD_AT_SPOLKA]) == 1

    def test_a_hospital_run_as_an_spzoz_is_placed_by_its_form(self):
        # It has no PKD code whatsoever, so the form is the only thing that can
        # place it - which is why dropping the form column changes what the
        # flag means rather than merely making it less precise.
        assert counting(company_category="szpitale")([BOARD_AT_SPZOZ]) == 1

    def test_a_company_in_another_sector_is_not(self):
        assert counting(company_category="szpitale")([BOARD_AT_WODOCIAGI]) == 0

    @pytest.mark.parametrize(
        ("category", "column", "seat"),
        [
            ("szpitale", "form", BOARD_AT_SPZOZ),
            # Not a sector but an owner: Prokuratoria's list of the Treasury's
            # stakes, a column `CompaniesKRS` has written since 2026-10-28.
            ("skarb-panstwa", "treasury_share", BOARD_AT_SPOLKA),
        ],
    )
    def test_company_data_without_a_column_the_category_reads_says_so(
        self, capsys, category, column, seat
    ):
        # Built before the column, the data places fewer companies under the
        # category - none at all under skarb-panstwa - and a run of it would
        # send fewer people, or nobody, without a word.
        current = COMPANIES.assign(treasury_share=["100", None, None])
        assert counting(current, company_category=category)([seat]) == 1
        assert "WARNING" not in capsys.readouterr().out

        older = current.drop(columns=[column])
        assert counting(older, company_category=category)([seat]) == 0
        said = capsys.readouterr().out
        assert f"no {column} column" in said
        assert "--refresh CompaniesKRS" in said

    def test_a_sector_reads_no_treasury_share_and_says_nothing_of_it(self, capsys):
        assert "treasury_share" not in COMPANIES
        assert counting(company_category="szpitale")([BOARD_AT_SPOLKA]) == 1
        assert "WARNING" not in capsys.readouterr().out


# Neither --employed-role nor --paid-supervision selects anything on its own:
# they only ever take posts away, and `works_in_relevant` counts nothing until a
# scope names the companies. So both are exercised with the category alongside,
# which is also the only way they are meant to be used.
SCOPED = {"company_category": "szpitale"}


class TestEmployedRole:
    def test_only_the_named_role_counts(self):
        counter = counting(employed_roles=["Rada Nadzorcza"], **SCOPED)
        assert counter([BOARD_AT_SPOLKA]) == 1
        assert counter([DIRECTOR_AT_SPOLKA]) == 0

    def test_several_roles_can_be_named(self):
        counter = counting(employed_roles=["Rada Nadzorcza", "Zarząd"], **SCOPED)
        assert counter([BOARD_AT_SPOLKA, DIRECTOR_AT_SPOLKA]) == 2

    def test_a_post_with_no_role_recorded_is_dropped(self):
        # `employed_role` is None for a post rejestr.io reported under a
        # connection type `KRS_RELATION_ROLES` maps to None.
        counter = counting(employed_roles=["Rada Nadzorcza"], **SCOPED)
        assert counter([post("0000000001", None)]) == 0

    def test_narrowing_nothing_leaves_every_post_in_scope(self):
        assert counting(**SCOPED)([BOARD_AT_SPOLKA, DIRECTOR_AT_SPOLKA]) == 2


class TestPaidSupervision:
    def test_a_seat_on_a_rada_spoleczna_is_not_a_job(self):
        assert counting(paid_supervision=True, **SCOPED)([BOARD_AT_SPZOZ]) == 0

    def test_a_seat_on_a_rada_nadzorcza_still_is(self):
        assert counting(paid_supervision=True, **SCOPED)([BOARD_AT_SPOLKA]) == 1

    def test_the_kierownik_of_an_spzoz_keeps_counting(self):
        # Both halves of the rule are needed. A Zarząd post at the same
        # hospital is its director, a salaried job, and only the seat on the
        # unpaid organ is meant to go.
        assert counting(paid_supervision=True, **SCOPED)([DIRECTOR_AT_SPZOZ]) == 1

    def test_the_role_string_alone_cannot_tell_them_apart(self):
        # The point of the flag: both posts carry the identical role, because
        # the register reports all supervision as one connection type, so the
        # role filter passes an unpaid seat through untouched.
        assert BOARD_AT_SPZOZ["employed_role"] == BOARD_AT_SPOLKA["employed_role"]
        counter = counting(employed_roles=["Rada Nadzorcza"], **SCOPED)
        assert counter([BOARD_AT_SPZOZ]) == 1

    def test_a_company_with_no_form_is_treated_as_paid(self):
        # The safe direction, and the same one `bodyIsPaidPost` errs in: a
        # company whose form nobody read keeps counting its seats, rather than
        # being silently dropped out of the run.
        no_form = COMPANIES.assign(form=[None, None, None])
        counter = counting(no_form, paid_supervision=True, **SCOPED)
        assert counter([BOARD_AT_SPOLKA]) == 1


class TestTheThreeTogether:
    def test_it_selects_the_paid_hospital_board_and_nothing_else(self):
        counter = counting(**HOSPITAL_BOARDS)
        assert counter([BOARD_AT_SPOLKA]) == 1
        assert counter([BOARD_AT_SPZOZ]) == 0
        assert counter([DIRECTOR_AT_SPOLKA]) == 0
        assert counter([DIRECTOR_AT_SPZOZ]) == 0
        assert counter([BOARD_AT_WODOCIAGI]) == 0

    def test_a_seat_somebody_has_left_is_dropped_by_currently_employed(self):
        counter = counting(currently_employed=True, **HOSPITAL_BOARDS)
        assert counter([BOARD_AT_SPOLKA]) == 1
        assert counter([post("0000000001", "Rada Nadzorcza", end="2024-06-30")]) == 0

    def test_all_alongside_the_category_is_refused(self):
        # Not merely redundant: `works_in_relevant` reads
        # `krs in relevant_companies or self.all`, so --all takes a post at
        # every company and the category narrows nothing. Until
        # --company-category existed the guard forced every run to name one of
        # --region/--krs/--approved/--all/--rejestrio-id, so --all is exactly
        # what somebody would add out of habit.
        with pytest.raises(ValueError, match="contradict each other"):
            parsed(["--company-category", "szpitale", "--all"])

    def test_an_unknown_category_is_refused(self):
        with pytest.raises(ValueError, match="Unknown --company-category"):
            parsed(["--company-category", "szpitle"])

    def test_the_category_alone_is_scope_enough(self):
        # The guard used to demand one of five flags and --company-category was
        # not among them, so without this the recommended run cannot start.
        assert parsed(["--company-category", "szpitale"]).company_category == "szpitale"
