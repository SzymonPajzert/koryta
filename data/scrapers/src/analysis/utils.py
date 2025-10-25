from collections import Counter
from datetime import timedelta, date

import pandas as pd

from util.config import versioned
from util.polish import TERYT
from scrapers.pkw.sources import election_date

MATCHED_ODDS = 100000  # 1/odds is the probability the person is an accidental match
EXPECTED_SCORE = 10.5  # Expected score calculated by analysis.people script

krs_companies = versioned.read_jsonl("companies_krs.jsonl")
company_names = {elt["krs"]: f"{elt["name"]} w {elt["city"]}" for elt in krs_companies}


def extract_companies(df):
    krs = Counter()
    for es in df["employment"].to_list():
        for e in es:
            krs[e["employed_krs"]] += 1

    return [
        (krs, company_names.get(krs, krs), count)
        for krs, count in krs.most_common()
        if count > 3
    ]


def append_nice_history(df):
    def nice_history(row):
        actions = []

        first_work: date | None = None
        latest_election: date | None = None
        last_employed: date | None = None
        employed_total = timedelta(days=0)

        for emp in row["employment"]:
            duration = timedelta(days=365 * float(emp["employed_for"]))
            start_employed: date = emp["employed_end"] - duration
            if first_work is None or start_employed < first_work:
                first_work = start_employed
            if last_employed is None or emp["employed_end"] > last_employed:
                last_employed = emp["employed_end"]
            employed_total += duration

            emp["employment_start"] = start_employed
            text = f"Pracuje od {start_employed} do {emp["employed_end"]} w {company_names.get(emp["employed_krs"], emp["employed_krs"])}"
            actions.append((start_employed, text))

        assert first_work is not None

        for el in row["elections"]:
            start_election: date | None = election_date.get(el["election_year"], None)
            if start_election is None:
                start_election = date(year=int(el["election_year"]), month=1, day=1)
            if latest_election is None or (
                start_election > latest_election and start_election < first_work
            ):
                latest_election = start_election
            region_name = "nieznane"
            for e in el["teryt_powiat"]:
                if e in TERYT:
                    region_name = TERYT[e]
            text = f"Kandyduje w {el["election_year"]} z list {el["party"]} w {region_name}"
            actions.append((start_election, text))

        assert latest_election is not None

        actions.sort(key=lambda x: x[0])
        history = ""
        for a in actions:
            action = a[1]
            history += f"{action}" + "\n"

        election_before_work = (
            first_work - latest_election
        )  # if latest_election < first_work else None

        return pd.Series([history, election_before_work, last_employed, employed_total])

    df[["history", "election_before_work", "last_employed", "employed_total"]] = df[
        ["employment", "elections"]
    ].apply(nice_history, axis=1)
    return df


def drop_duplicates(df, *cols):
    for col in cols:
        df = df[(~df[col].duplicated()) | df[col].isna()]
    return df


def read_enriched(filter_region):
    """
    :param: filter_region - region in TERYT 10 code, to filter to
    """
    matched_all = versioned.read_parquet("matched.parquet")

    # Get people for the given region
    local = matched_all["teryt_wojewodztwo"].apply(
        lambda row: row is not None and filter_region in row
    )

    # Get people with high enough scores
    good_score = matched_all["overall_score"] > EXPECTED_SCORE

    # Make sure the chance of a random match is low
    high_probability = (1 - matched_all["unique_chance"]).lt(1 / MATCHED_ODDS)

    # Does the person has matching
    has_wiki = ~matched_all["wiki_name"].isna()

    local_good = matched_all[good_score & local & (high_probability | has_wiki)]

    # Filter out duplicates
    local_good = drop_duplicates(local_good, "krs_name", "pkw_name", "wiki_name")

    # Add derived fields
    local_good = append_nice_history(local_good)

    local_good = local_good.sort_values(by="election_before_work").reset_index()

    return local_good
