import re
from unittest.mock import patch

import pandas as pd
import pytest

from conductor import setup_context
from koryta import Pipeline
from pipelines import Extract


@pytest.fixture
def ctx():
    return setup_context(False)[0]


def extract(ctx, region):
    # Mock sys.argv to passing the region argument
    with patch("sys.argv", ["main.py", "--region", region]):
        extract_pipeline = Pipeline.create(Extract)
        return extract_pipeline.read_or_process(ctx)


@pytest.mark.parametrize("region", ["%02d" % (2 * i) for i in range(1, 17)])
def test_successful_company_names(ctx, region):
    df = extract(ctx, region)
    history_series = df["history"]

    total_companies = 0
    named_companies = 0

    # Regex to find company names in the history strings
    # Pattern looks for " w " followed by the company name, until end of line
    # or before next specific keyword if structure is complex.
    # Based on append_nice_history: f"Pracuje od {start} do {end} w {company_name}"
    company_pattern = re.compile(r" w (.+)$")

    for history_block in history_series:
        if pd.isna(history_block) or not history_block:
            continue

        lines = history_block.split("\n")
        for line in lines:
            if "Pracuje od" in line:  # Check 2
                match = company_pattern.search(line)
                if match:
                    total_companies += 1
                    company_name = match.group(1).strip()

                    # Check if company_name is NOT just digits
                    # which would mean lookup failed and returned KRS
                    if not company_name.isdigit():
                        named_companies += 1

    assert total_companies > 0, "No employment history found to test"

    ratio = named_companies / total_companies
    print(f"Named companies: {named_companies}/{total_companies} ({ratio:.2%})")

    assert ratio > 0.8, f"Less than 80% of companies have names resolved: {ratio:.2%}"


def test_teryt_is_set_for_extracted_people(ctx):
    # Testing that the teryt is set for elections in an extracted person
    df = extract(ctx, "14")

    people_with_relevant_elections = 0
    for elections in df["elections"]:
        if not isinstance(elections, list):
            continue

        has_relevant = False
        for election in elections:
            teryt = (
                (
                    election.get("teryt_powiat") and election["teryt_powiat"][0]
                    if election.get("teryt_powiat")
                    else None
                )
                or (
                    election.get("teryt_wojewodztwo")
                    and election["teryt_wojewodztwo"][0]
                    if election.get("teryt_wojewodztwo")
                    else None
                )
                or ""
            )
            if teryt != "" and teryt.startswith("14"):
                has_relevant = True
                people_with_relevant_elections += 1
                break

        assert has_relevant, (
            f"Person extracted for region 14 without matching elections: {elections}"
        )

    assert people_with_relevant_elections > 0, (
        "No people extracted with relevant elections for region 14"
    )
