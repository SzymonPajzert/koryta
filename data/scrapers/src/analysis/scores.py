"""
We have source of truth from two sources:
node_id -> public - from KorytaPeople
node_id -> interesting - from KorytaVotes

We can additionally map
node_id to rejest_io_person_id using KorytaPeople to match them with their companies

We are therefore mapping the person scores to companies
and then try to spread it again to people

We output final scores along with the most recent votes we aggregated,
so the uplaoder can diff if we need/have to update the scores or not.
"""

import dataclasses

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from entities.composite import PersonScore
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.stores import Context, Pipeline

IS_PUBLIC_SCORE = 3


class CompanyScores(Pipeline):
    filename = "company_scores"

    people_payloads: PeoplePayloads
    people_scored: KorytaPeople
    people_votes: KorytaVotes

    def get_person_names(self, ctx: Context) -> dict[str, str]:
        koryta_people_df = self.people_scored.read_or_process(ctx)
        return dict(zip(koryta_people_df["id"], koryta_people_df["full_name"]))

    def person_scores(
        self, ctx: Context, koryta_id_to_name: dict[str, str]
    ) -> dict[str, int]:
        scores = {}

        for _, row in self.people_votes.read_or_process(ctx).iterrows():
            person_koryta_id = row.get("person_koryta_id")
            if not person_koryta_id or person_koryta_id == "":
                continue
            person_koryta_id = str(person_koryta_id)
            interesting = row.get("interesting", 0)
            if interesting == 0:
                continue

            scores[koryta_id_to_name[person_koryta_id]] = interesting

        for _, row in self.people_scored.read_or_process(ctx).iterrows():
            is_public = row.get("is_public", False)
            if pd.isna(is_public):
                is_public = False

            if not is_public:
                continue

            scores[row["full_name"]] = IS_PUBLIC_SCORE

        return scores

    @staticmethod
    def company_aggregate(x) -> pd.Series:
        if len(x) == 0:
            return pd.Series({"score": 0})

        any_negative = x["score"].apply(lambda v: v < 0).any()
        if any_negative:
            ratio = x["score"].apply(
                lambda v: 1 if v > 0 else -1 if v < 0 else 0
            ).sum() / len(x)
            return pd.Series({"score": ratio})

        return x.sum() / IS_PUBLIC_SCORE

    def process(self, ctx: Context):
        person_names = self.get_person_names(ctx)
        scores = self.person_scores(ctx, person_names)
        people_df = self.people_payloads.read_or_process(ctx)

        records = []
        for _, row in people_df.iterrows():
            person_score = scores.get(row["name"], 0)
            if person_score == 0:
                continue

            companies = row.get("companies", [])
            if (
                isinstance(companies, list)
                or isinstance(companies, pd.Series)
                or hasattr(companies, "__iter__")
            ):
                for company in companies:
                    krs = None
                    if isinstance(company, dict):
                        krs = company.get("krs")
                    else:
                        krs = getattr(company, "krs", None)
                    if krs:
                        records.append({"krs": krs, "score": person_score})

        if not records:
            return pd.DataFrame(columns=["krs", "sum_score"])

        df = pd.DataFrame.from_records(records)
        scores_df = df.groupby("krs", as_index=False)[["score"]].apply(
            self.company_aggregate
        )
        scores_df = scores_df.rename(columns={"score": "sum_score"})
        scores_df = scores_df.sort_values(by="sum_score", ascending=False).reset_index(
            drop=True
        )

        return scores_df


class PeopleScores(Pipeline):
    filename = "people_scores"

    company_scores: CompanyScores
    people_payloads: PeoplePayloads
    people_koryta: KorytaPeople

    # Don't produce scores for people who are already public
    ignore_public = True
    # Don't produce scores for people who have votes
    ignore_votes = True

    def process(self, ctx: Context):
        company_scores_df = self.company_scores.read_or_process(ctx)
        people_df = self.people_payloads.read_or_process(ctx)
        koryta_people_df = self.people_koryta.read_or_process(ctx)
        print(koryta_people_df.head())

        company_score_map = dict(
            zip(company_scores_df["krs"], company_scores_df["sum_score"])
        )
        name_to_node_id: dict[str, str] = dict(
            zip(koryta_people_df["full_name"], koryta_people_df["id"])
        )

        records = []
        for _, row in people_df.iterrows():
            person_name = str(row.get("name"))
            node_id = name_to_node_id.get(person_name)
            total_score = self.total_person_score(row, company_score_map)
            if node_id is None:
                continue
            if total_score <= 0:
                continue
            koryta_entry = koryta_people_df[koryta_people_df["id"] == node_id].iloc[0]
            if self.ignore_public and koryta_entry.get("is_public", False):
                continue

            records.append(
                dataclasses.asdict(
                    PersonScore(
                        node_id=node_id,
                        name=str(person_name),
                        score=total_score,
                    )
                )
            )

        if not records:
            return pd.DataFrame(columns=["node_id", "name", "score"])
        print("Found scores for", len(records), "people")

        df = pd.DataFrame.from_records(records)
        df = df.sort_values(by="score", ascending=False).reset_index(drop=True)
        df["score"] /= df["score"].max()
        df["score"] *= 5
        df["score"] = df["score"].round()
        print(df.head())

        print(df["score"].describe())
        print(df["score"].value_counts())

        return df.astype({"score": "int32"})

    def total_person_score(self, row, company_score_map):
        companies = row.get("companies", [])
        total_person_score = 0

        if (
            isinstance(companies, list)
            or isinstance(companies, pd.Series)
            or hasattr(companies, "__iter__")
        ):
            for company in companies:
                krs = None
                if isinstance(company, dict):
                    krs = company.get("krs")
                else:
                    krs = getattr(company, "krs", None)

                if krs and krs in company_score_map:
                    total_person_score += company_score_map[krs]

        return total_person_score
