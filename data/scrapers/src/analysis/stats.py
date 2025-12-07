from analysis.people import PeopleMerged
from scrapers.stores import Context, PipelineModel

PEOPLE_COLUMNS_TO_CHECK = ["koryta_name", "krs_name", "pkw_name", "wiki_name"]


class Statistics(PipelineModel):
    filename = "statistics"
    people: PeopleMerged

    def process(self, ctx: Context):
        df = self.people.read_or_process(ctx)
        combination_counts = df[PEOPLE_COLUMNS_TO_CHECK].notnull().groupby(PEOPLE_COLUMNS_TO_CHECK).size()
        combination_counts = combination_counts.sort_values(ascending=False)
        combination_counts = combination_counts.reset_index(name="count")
        combination_counts["good"] = combination_counts["krs_name"] & (combination_counts["pkw_name"] | combination_counts["wiki_name"])

        print(combination_counts)

        return combination_counts
