from analysis.people import PeopleEnriched
from scrapers.article.hardcoded.epidemiamiszalskiego import (
    hardcoded as epidemia,
)
from scrapers.article.hardcoded.kazdymusigdziespracowac import (
    hardcoded as kazdymusi,
)
from scrapers.article.hardcoded.listawstydupo import hardcoded as wstydu
from scrapers.article.hardcoded.tlustekotypisu import hardcoded as tlustekoty
from scrapers.stores import Context, Pipeline

PEOPLE_COLUMNS_TO_CHECK = [
    "koryta_name",
    "krs_name",
    "pkw_name",
    "wiki_name",
    "tlustekoty",
    "listawstydu",
    # "kazdymusi",
    # "epidemia",
    "approve",
]


def check_name_in_list(tlustekoty: list[str]):
    tlustekotyset = set(tlustekoty)

    def check(name):
        first_name = name.split(" ")[0]
        last_name = name.split(" ")[-1]
        return "true" if f"{first_name} {last_name}" in tlustekotyset else None

    return check


class Statistics(Pipeline):
    volatile = True
    filename = None  # There's no input to be memoized
    people: PeopleEnriched

    def process(self, ctx: Context):
        df = self.people.read_or_process(ctx)
        print(df.head())

        kazdymusi_set = set(p[0] for p in kazdymusi)
        df["kazdymusi"] = df["pkw_name"].apply(
            lambda x: x if x in kazdymusi_set else None
        )
        df["tlustekoty"] = df["krs_name"].apply(
            check_name_in_list([name for name, _ in tlustekoty])
        )
        df["listawstydu"] = df["krs_name"].apply(
            check_name_in_list([name for name, _ in wstydu])
        )
        df["epidemia"] = df["krs_name"].apply(lambda x: x if x in epidemia else None)
        df["approve"] = (
            df["kazdymusi"].notnull()
            | (df["tlustekoty"].notnull() | df["listawstydu"].notnull())
            | (df["epidemia"].notnull())
        )
        df["approve"] = df["approve"].apply(lambda x: "tak" if x else None)

        # df.drop("kazdymusi", axis=1, inplace=True)
        # df.drop("tlustekoty", axis=1, inplace=True)
        # df.drop("epidemia", axis=1, inplace=True)

        combination_counts_series = (
            df[PEOPLE_COLUMNS_TO_CHECK]
            .notnull()
            .groupby(PEOPLE_COLUMNS_TO_CHECK)
            .size()
        )
        combination_counts_series = combination_counts_series.sort_values(
            ascending=False
        )
        combination_counts = combination_counts_series.reset_index(name="count")

        combination_counts["good"] = combination_counts["krs_name"] & (
            combination_counts["pkw_name"] | combination_counts["wiki_name"]
        )

        print(combination_counts)

        return combination_counts
