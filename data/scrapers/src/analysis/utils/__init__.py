from collections import Counter
from datetime import date, timedelta

import numpy as np
import pandas as pd

# TODO remove this dependence
from scrapers.krs.companies import (
    company_names as company_names_harcoded,
)
from scrapers.krs.companies import (
    lodzkie_companies,
)
from scrapers.pkw.elections import committee_to_party
from scrapers.pkw.sources import election_date
from scrapers.stores import Context
from scrapers.teryt import Teryt

MATCHED_ODDS = 100000  # 1/odds is the probability the person is an accidental match
EXPECTED_SCORE = 10.5  # Expected score calculated by analysis.people script
RECENT_EMPLOYMENT_START = date.fromisoformat("2024-10-01")
OLD_EMPLOYMENT_END = date.fromisoformat("2020-10-01")


def read_enriched(ctx: Context, matched_all, companies_df, teryt: Teryt):
    # Add derived fields
    company_names = get_company_names(companies_df)
    enriched = append_nice_history(ctx, matched_all, company_names, teryt)
    enriched = enriched.sort_values(by="election_before_work").reset_index()
    return enriched


def get_company_names(companies_df):
    krs_companies = companies_df.to_dict("records")
    company_names_krs = {elt["krs"]: f"{elt['name']} w {elt['city']}" for elt in krs_companies}
    return {
        **company_names_krs,
        **company_names_harcoded,
    }


def extract_companies(ctx: Context, df, company_names):
    krs: Counter[str] = Counter()
    for es in df["employment"].to_list():
        for e in es:
            krs[e["employed_krs"]] += 1

    return [(krs, company_names.get(krs, krs), count) for krs, count in krs.most_common() if count > 3]


def append_nice_history(ctx: Context, df, company_names, teryt: Teryt):
    missing_teryt = set()

    def nice_history(row):
        actions = []

        first_work: date | None = None
        last_employed: date | None = None
        employed_total = timedelta(days=0)
        parties_simplified = set()

        for emp in empty_list_if_nan(row["employment"]):
            duration = timedelta(days=365 * float(emp["employed_for"]))
            start_employed: date = date.fromisoformat(emp["employed_end"]) - duration
            if first_work is None or start_employed < first_work:
                first_work = start_employed
            if last_employed is None or emp["employed_end"] > last_employed:
                last_employed = emp["employed_end"]
            employed_total += duration

            emp["employment_start"] = start_employed
            text = f"Pracuje od {start_employed} do {emp['employed_end']} w {company_names.get(emp['employed_krs'], emp['employed_krs'])}"
            actions.append((start_employed, text))

        elections = []
        for el in empty_list_if_nan(row["elections"]):
            if el["party"] is not None:
                party = committee_to_party.get(el["party"].lower().strip(), None)
                if party is not None:
                    parties_simplified.add(party)

            start_election: date = election_date.get(el["election_year"], date(year=int(el["election_year"]), month=1, day=1))
            elections.append(start_election)
            region_name = "nieznane"
            for e in el["teryt_powiat"]:
                if e in teryt.TERYT:
                    region_name = teryt.TERYT[e]
                else:
                    missing_teryt.add(e)

            text = f"Kandyduje w {el['election_year']} do {el['election_type']} z list {(el['party'] or '').strip()} w {region_name}"
            actions.append((start_election, text))

        before_work = [e for e in elections if e < first_work]
        latest_election = max(before_work, default=min(elections, default=None))

        actions.sort(key=lambda x: x[0])
        history = ""
        for a in actions:
            action = a[1]
            history += f"{action}" + "\n"

        election_before_work = None
        if first_work is not None and latest_election is not None:
            election_before_work = first_work - latest_election

        return pd.Series(
            [
                history,
                election_before_work,
                first_work,
                last_employed,
                employed_total,
                parties_simplified,
            ]
        )

    df[
        [
            "history",
            "election_before_work",
            "first_employed",
            "last_employed",
            "employed_total",
            "parties_simplified",
        ]
    ] = df[["employment", "elections"]].apply(nice_history, axis=1)

    print(f"Missing teryt: {missing_teryt}")

    return df


def drop_duplicates(df, *cols):
    for col in cols:
        df = df[(~df[col].duplicated()) | df[col].isna()]
    return df


def filter_local_good(matched_all, filter_region: str | None):
    """
    :param: filter_region - region in TERYT 10 code, to filter to
    """

    def check_teryt_wojewodztwo(row_regions):
        if filter_region is None:
            return True
        return row_regions is not None and filter_region in row_regions

    def check_employed(employed):
        for emp in empty_list_if_nan(employed):
            if emp["employed_krs"] in lodzkie_companies:
                return True
        return False

    # Get people with high enough scores
    good_score = matched_all["overall_score"] > EXPECTED_SCORE
    recent = matched_all["first_employed"] > RECENT_EMPLOYMENT_START
    not_too_old = matched_all["last_employed"] > OLD_EMPLOYMENT_END
    interesting = (good_score | recent) & not_too_old

    # Get people for the given region
    local_candidacy = matched_all["teryt_wojewodztwo"].apply(check_teryt_wojewodztwo)
    local_company = matched_all["employment"].apply(check_employed)
    local = local_candidacy | local_company

    # Make sure the chance of a random match is low
    # TODO There's an issue with priobability calculation
    high_probability = True  # (1 - matched_all["unique_chance"]).lt(1 / MATCHED_ODDS)
    # Does the person has matching
    has_wiki = ~matched_all["wiki_name"].isna()
    accurate = high_probability | has_wiki

    local_good = matched_all[interesting & local & accurate]

    # Filter out duplicates
    local_good = drop_duplicates(local_good, "krs_name", "pkw_name", "wiki_name")

    return local_good


def empty_list_if_nan(value):
    if isinstance(value, np.ndarray):
        return value
    return []
