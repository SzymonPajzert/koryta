import pandas as pd

from analysis.payloads.person import PeoplePayloads
from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline

IS_PUBLIC_SCORE = 5


class CompanyScores(Pipeline):
    filename = "company_scores"

    people_payloads: PeoplePayloads
    people_scored: KorytaPeople

    def person_scores(self, ctx: Context) -> dict[str, int]:
        scores = {}
        for _, row in self.people_scored.read_or_process(ctx).iterrows():
            is_public = row.get("is_public", False)
            if pd.isna(is_public):
                is_public = False

            votes_interesting = row.get("votes_interesting")
            if pd.isna(votes_interesting):
                votes_interesting = 0

            is_public_score = IS_PUBLIC_SCORE if is_public else 0
            person_score = is_public_score + votes_interesting
            if person_score == 0:
                continue
            try:
                scores[row["full_name"]] = person_score
            except KeyError:
                print(row)
                raise

        return scores

    def process(self, ctx: Context):
        scores = self.person_scores(ctx)
        people_df = self.people_payloads.read_or_process(ctx)

        records = []
        for _, row in people_df.iterrows():
            person_score = scores.get(row["name"], 0)

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
        scores_df = df.groupby("krs", as_index=False)[["score"]].sum()
        scores_df = scores_df.rename(columns={"score": "sum_score"})

        return scores_df


class PeopleScores(Pipeline):
    filename = "people_scores"

    company_scores: CompanyScores
    people_payloads: PeoplePayloads

    def process(self, ctx: Context):
        company_scores_df = self.company_scores.read_or_process(ctx)
        people_df = self.people_payloads.read_or_process(ctx)

        company_score_map = dict(
            zip(company_scores_df["krs"], company_scores_df["sum_score"])
        )

        records = []
        for _, row in people_df.iterrows():
            person_name = row.get("name")
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

            records.append({"name": person_name, "score": total_person_score})

        if not records:
            return pd.DataFrame(columns=["name", "score"])

        df = pd.DataFrame.from_records(records)
        df = df.sort_values(by="score", ascending=False).reset_index(drop=True)
        return df
