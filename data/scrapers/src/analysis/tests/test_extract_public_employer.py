"""Counting only the jobs that are at a company in public hands."""

import dataclasses
import sys
from unittest.mock import patch

import pandas as pd
import pytest

from analysis.extract import Extract, iso_date
from scrapers.stores import Pipeline

COMPANIES = pd.DataFrame.from_records(
    [
        {"krs": "0000000001", "name": "Wodociagi", "is_public": True},
        {"krs": "0000000002", "name": "Prywatna", "is_public": False},
    ]
)


@dataclasses.dataclass
class Args:
    """The flags `Extract` reads, defaulted to a run that lists everybody."""

    all: bool = True
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


def counting(companies=COMPANIES, **flags):
    """`relevant_employment`, over a register of one public and one private."""
    extract = Pipeline.create(Extract)
    extract.args = Args(**flags)
    extract.companies.read_or_process = lambda ctx: companies
    return extract.relevant_employment(None)


def job(krs, start):
    return {"employed_krs": krs, "employed_start": start, "employed_end": None}


PUBLIC_NEW = job("0000000001", "2025-01-15")
PUBLIC_OLD = job("0000000001", "2011-03-01")
PRIVATE_NEW = job("0000000002", "2025-01-15")
UNKNOWN_NEW = job("0000009999", "2025-01-15")

RECENT = {"public_employer": True, "employed_after": "2024-10-01"}


class TestPublicEmployer:
    def test_a_recent_job_at_a_public_company_counts(self):
        assert counting(**RECENT)([PUBLIC_NEW]) == 1

    def test_a_recent_job_at_a_private_company_does_not(self):
        assert counting(**RECENT)([PRIVATE_NEW]) == 0

    def test_an_old_job_at_a_public_company_does_not(self):
        assert counting(**RECENT)([PUBLIC_OLD]) == 0

    def test_a_company_the_register_never_covered_does_not(self):
        # Silence about who owns it is not evidence that the public does.
        assert counting(**RECENT)([UNKNOWN_NEW]) == 0

    def test_one_public_job_is_enough_however_many_private_ones(self):
        assert counting(**RECENT)([PRIVATE_NEW, PUBLIC_NEW, UNKNOWN_NEW]) == 1

    def test_without_the_flag_a_private_job_still_counts(self):
        assert counting(employed_after="2024-10-01")([PRIVATE_NEW]) == 1

    def test_on_its_own_it_counts_public_jobs_of_any_age(self):
        assert counting(public_employer=True)([PUBLIC_OLD, PRIVATE_NEW]) == 1

    def test_a_register_that_never_says_who_owns_anything_is_an_error(self):
        # Rather than quietly reporting that nobody works anywhere public,
        # which is what an empty set of public companies would come to.
        blind = COMPANIES.drop(columns=["is_public"])

        with pytest.raises(ValueError, match="is_public"):
            counting(companies=blind, public_employer=True)([PUBLIC_NEW])


class TestComposition:
    """The public test is asked of every job, whatever else is being asked."""

    def test_it_narrows_currently_employed_too(self):
        # The public guard sits above the employed-after/currently-employed
        # chain, so it applies to whichever of those the run picked.
        open_ended = job("0000000002", "2025-01-15")
        assert (
            counting(public_employer=True, currently_employed=True)([open_ended]) == 0
        )
        assert counting(currently_employed=True)([open_ended]) == 1

    def test_it_narrows_a_region_run_rather_than_widening_it(self):
        # --region 14 puts both companies in scope; --public-employer takes the
        # private one back out. The two conditions are and-ed, not or-ed.
        register = COMPANIES.assign(teryt_code="1400")
        both = [PUBLIC_NEW, PRIVATE_NEW]

        assert counting(companies=register, all=False, region="14")(both) == 2
        assert (
            counting(companies=register, all=False, region="14", public_employer=True)(
                both
            )
            == 1
        )

    def test_a_job_that_started_on_the_day_itself_is_out(self):
        # `>` not `>=`, which is what --employed-after has always meant.
        assert counting(**RECENT)([job("0000000001", "2024-10-01")]) == 0
        assert counting(**RECENT)([job("0000000001", "2024-10-02")]) == 1

    def test_a_register_that_lost_its_leading_zeros_still_matches(self):
        # Read any way but through `CompaniesKRS`, the krs column comes back as
        # an integer and "1" matches no employment record ever written.
        unpadded = COMPANIES.assign(krs=[1, 2])

        assert counting(companies=unpadded, **RECENT)([PUBLIC_NEW]) == 1


class TestWholeRun:
    """`--all` must stop meaning "everybody" once the flag narrows the run."""

    def people(self):
        return pd.DataFrame.from_records(
            [
                {
                    "krs_name": "Publiczna Osoba",
                    "pkw_name": "Publiczna Osoba",
                    "wiki_name": None,
                    "rejestrio_id": ["1"],
                    "employment": [PUBLIC_NEW],
                    "elections": [{"election_year": "2024"}],
                },
                {
                    "krs_name": "Prywatna Osoba",
                    "pkw_name": "Prywatna Osoba",
                    "wiki_name": None,
                    "rejestrio_id": ["2"],
                    "employment": [PRIVATE_NEW],
                    "elections": [{"election_year": "2024"}],
                },
            ]
        )

    def run(self, **flags):
        extract = Pipeline.create(Extract)
        extract.args = Args(**flags)
        extract.companies.read_or_process = lambda ctx: COMPANIES
        extract.people.read_or_process = lambda ctx: self.people()
        extract.teryt.read_or_process = lambda ctx: None
        return extract.process(None)["krs_name"].tolist()

    def test_the_private_sector_job_is_left_out(self):
        assert self.run(public_employer=True) == ["Publiczna Osoba"]

    def test_and_with_a_date_on_top_of_it(self):
        assert self.run(**RECENT) == ["Publiczna Osoba"]

    def test_a_plain_run_still_lists_everybody(self):
        assert self.run() == ["Publiczna Osoba", "Prywatna Osoba"]

    def test_currently_employed_is_not_overridden_by_all_either(self):
        # Same trap, older flag: `use_all` named --employed-after and
        # --election-after only, so `--all --currently-employed` listed
        # everybody and the flag did nothing at all.
        assert self.run(currently_employed=True) == [
            "Publiczna Osoba",
            "Prywatna Osoba",
        ]

        finished = {**PRIVATE_NEW, "employed_end": "2025-06-01"}
        people = self.people()
        people.at[1, "employment"] = [finished]
        extract = Pipeline.create(Extract)
        extract.args = Args(currently_employed=True)
        extract.companies.read_or_process = lambda ctx: COMPANIES
        extract.people.read_or_process = lambda ctx: people
        extract.teryt.read_or_process = lambda ctx: None

        assert extract.process(None)["krs_name"].tolist() == ["Publiczna Osoba"]


class TestReadingTheRegister:
    """Whatever shape the company frame arrived in, it has to be read right."""

    def test_a_flag_column_of_text_does_not_make_everybody_public(self):
        # `astype(bool)` calls the string "False" true, which would leave
        # --public-employer filtering nothing while looking like it worked.
        as_text = COMPANIES.assign(is_public=["True", "False"])

        assert counting(companies=as_text, **RECENT)([PRIVATE_NEW]) == 0
        assert counting(companies=as_text, **RECENT)([PUBLIC_NEW]) == 1

    def test_a_flag_column_of_bools_and_nulls_reads_as_written(self):
        with_nulls = COMPANIES.assign(is_public=[True, None])

        assert counting(companies=with_nulls, **RECENT)([PRIVATE_NEW]) == 0
        assert counting(companies=with_nulls, **RECENT)([PUBLIC_NEW]) == 1

    def test_an_id_column_of_floats_is_padded_back_rather_than_mangled(self):
        # A float krs stringifies with a ".0" on it, so padding alone turns
        # 1.0 into "00000001.0" and the set matches no job ever recorded.
        as_floats = COMPANIES.assign(krs=[1.0, 2.0])

        assert counting(companies=as_floats, **RECENT)([PUBLIC_NEW]) == 1


def test_the_fake_args_carry_every_flag_extract_parses():
    """A flag missing here is an AttributeError halfway through a real run.

    `Extract` reads its flags off `self.args` one attribute at a time, so a
    fake that is a flag short does not fail where it is built - it fails inside
    whichever filter reads the missing one, which is how `--public-employer`
    broke `test_extract_krs` when it was added.
    """
    with patch.object(sys, "argv", ["koryta", "Extract", "--all"]):
        parsed = vars(Pipeline.create(Extract).args)

    # `krss` is the dest of --krs; argparse names it, the fake matches it.
    missing = set(parsed) - {field.name for field in dataclasses.fields(Args)}

    assert not missing, f"Args is missing {sorted(missing)}"


class TestIsoDate:
    def test_a_date_is_handed_on_as_it_came(self):
        assert iso_date("2024-10-01") == "2024-10-01"

    def test_the_other_way_round_is_refused(self):
        # "01-10-2024" sorts below every ISO date there is, so it used to mean
        # "employed after the beginning of time" and narrowed nothing.
        with pytest.raises(ValueError):
            iso_date("01-10-2024")
