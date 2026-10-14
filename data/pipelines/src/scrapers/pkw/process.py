import argparse
import dataclasses
import itertools
import math
import re
import typing
from collections import Counter

import pandas as pd

from entities.person import PKW as Person
from scrapers.map.teryt import Teryt
from scrapers.pkw.elections import ElectionType
from scrapers.pkw.headers import CSV_HEADERS, ElectionContext, SetField
from scrapers.pkw.offices import local_office, teryt_code
from scrapers.pkw.sources import InputSource, sources
from scrapers.stores import Context, Pipeline
from util.polish import PkwFormat, parse_name

counters: dict[str, Counter[str]] = {k: Counter() for k in CSV_HEADERS.keys()}

#: How PKW tells two namesakes on one ballot apart: the father's name, written
#: into the given names - "Henryk s. Stefana" (syn), "Maria c. Jana" (córka).
PATRONYMIC = re.compile(r",?\s*\b[sc]\.\s*\S+")


def given_names(names: str) -> str:
    """The given names alone, space-separated.

    Some files separate the names with a comma ("Franciszek,Marian") and some
    add the patronymic, and either would otherwise reach `first_name` or
    `middle_name` as though it were a name - 689 rows between 1997 and 2014,
    460 of them in 2006.
    """
    return re.sub(r"\s*,\s*", " ", PATRONYMIC.sub("", names))


def extract_data(
    election_year: str,
    election_type: str,
    name_format: PkwFormat,
    sex: str | None = None,
    birth_year: int | None = None,
    age: str | None = None,
    teryt_candidacy: str | None = None,
    teryt_living: str | None = None,
    candidacy_success: str | None = None,
    party: str | None = None,
    position: str | None = None,
    pkw_name: str | None = None,
    first_name: str | None = None,
    middle_name: str | None = None,
    last_name: str | None = None,
    party_member: str | None = None,
):
    if pkw_name is not None:
        first_name, middle_name, last_name = parse_name(pkw_name, name_format)
    else:
        # Before `pkw_name` is built from it: the merge takes whatever the
        # full name holds beyond the first and last name as the second name.
        if isinstance(first_name, str):
            first_name = given_names(first_name)
        if isinstance(middle_name, str):
            middle_name = given_names(middle_name) or None
        pkw_name = f"{last_name} {first_name}"

    if first_name is not None and " " in first_name:
        names = first_name.split(" ", 1)
        first_name = names[0]
        middle_name = names[1]

    if age is not None:
        birth_year = int(election_year) - int(age)

    try:
        first_name = strip_if_not_none(first_name)
        middle_name = strip_if_not_none(middle_name)
        last_name = strip_if_not_none(last_name)
        party = strip_if_not_none(party)
        position = strip_if_not_none(position)
        pkw_name = strip_if_not_none(pkw_name)
    except AttributeError as e:
        raise ValueError(f"field has incorrect type: {e}")

    return Person(
        election_year=election_year,
        election_type=election_type,
        sex=sex,
        birth_year=birth_year,
        age=age,
        teryt_candidacy=teryt_candidacy,
        teryt_living=teryt_living,
        candidacy_success=candidacy_success,
        party=party,
        position=position,
        pkw_name=pkw_name,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        party_member=party_member,
    )


def strip_if_not_none(s: str | None):
    if s is None or s != s:  # check if s is nan
        return None
    # TODO Agnieszka True is giving us some issues
    if isinstance(s, bool):
        s = str(s)
    return s.strip()


def process_csv(
    reader: typing.Iterable,
    config: InputSource,
    csv_headers: dict[str, SetField | None],
):
    csv_headers = {**csv_headers, **config.headers}
    header = None

    for row in reader:
        if header is None:
            header = row
            replacements = dict()
            print(header)
            for idx, col in enumerate(header):
                if col != col or (isinstance(col, float) and math.isnan(col)):
                    # It's NaN
                    header[idx] = ""
                processor = csv_headers[col]
                if processor is None:
                    continue

                if processor.name not in replacements:
                    replacements[processor.name] = (col, processor.skippable)
                elif processor.skippable:
                    # This processor is optional
                    continue
                elif replacements[processor.name][1]:
                    # The previous is skippable, so replace with the new one
                    replacements[processor.name] = (col, processor.skippable)
                else:
                    raise ValueError(
                        f"Duplicate column name: {col} and \
                            {replacements[processor.name]} map to \
                                {processor.name} during {config}"
                    )

            continue

        row_dict = dict(zip(header, row))

        for k, v in row_dict.items():
            if csv_headers[k] is None:
                counters[k].update([v])

        mapped = dict()
        for k, v in row_dict.items():
            p = csv_headers[k]
            if p is None:
                continue
            val = p.processor(v, ElectionContext(config.year, config.election_type))
            # Only overwrite if the new value is truthy, or if not yet set
            if val or p.name not in mapped:
                mapped[p.name] = val

        try:
            yield extract_data(
                election_year=str(config.year),
                election_type=str(config.election_type),
                name_format=config.name_format,
                **mapped,  # type: ignore
            )
        except TypeError:
            print(row_dict)
            raise


def read_source(
    ctx: Context,
    config: InputSource,
    csv_headers: dict[str, SetField | None],
    limit: int | None,
) -> list[Person]:
    """One source's candidacies, with its run-off read into them if it has one.

    `limit` caps the candidacies, as `--limit` says: the first round's file is
    cut after `limit` rows. Its run-off is read whole, and only the rows of
    the candidates in that cut are kept. Cutting the run-off by row count too
    would keep the run-offs of races the cut left out, each a candidacy of its
    own and a false "tied to none" in the build's output.
    """
    reader = config.extractor.read(ctx, config.source)
    rows = list(itertools.islice(process_csv(reader, config, csv_headers), limit))
    if config.runoff is None:
        return rows

    reader = config.runoff.extractor.read(ctx, config.runoff.source)
    second_round: typing.Iterable[Person] = process_csv(reader, config, csv_headers)
    if limit is not None:
        read = {race_entry(person) for person in rows}
        second_round = (p for p in second_round if race_entry(p) in read)
    return with_runoff(rows, second_round, str(config))


#: What ties a run-off's row to the first round's: the office as PKW titles it
#: ("Prezydent Miasta Poznania"), the candidate's name as PKW spells it, and
#: the TERYT of the area.
RaceEntry = tuple[str | None, str | None, str | None]


def race_entry(person: Person) -> RaceEntry:
    return (person.position, person.pkw_name, teryt_code(person.teryt_candidacy))


def with_runoff(
    first_round: list[Person], second_round: typing.Iterable[Person], label: str
) -> list[Person]:
    """The first round's candidacies, each settled by its run-off if it went to one.

    A run-off is no candidacy of its own: the race, the office and the
    candidate are the first round's, and only the result is new. So it goes on
    the row of the first round that sent the candidate there - won if they won
    the run-off, lost if they lost it - as 2014's workbook keeps both rounds on
    one row (`parse_runoff_mandate`) and `fold_rounds` makes one candidacy of
    the 2002-2010 files' row per round.

    A second-round row is tied to the first-round row with its `race_entry`. In
    2024 that ties all 1,491, each to one of the 1,496 candidates the first
    round sent through; the other five withdrew, and their race's run-off was
    a vote for or against the one left. A row that ties to no first-round row,
    or to more than one, is kept as a candidacy of its own - a result lost
    unseen is worse than a race read twice - and counted in the build's output.
    """
    entries = Counter(race_entry(person) for person in first_round)
    runoffs: dict[RaceEntry, Person] = {}
    untied: list[Person] = []
    for person in second_round:
        entry = race_entry(person)
        if entries[entry] == 1 and entry not in runoffs:
            runoffs[entry] = person
        else:
            untied.append(person)

    settled = []
    for person in first_round:
        runoff = runoffs.get(race_entry(person))
        if runoff is not None:
            person = dataclasses.replace(
                person, candidacy_success=runoff.candidacy_success
            )
        settled.append(person)

    won = sum(runoff.candidacy_success == "TRUE" for runoff in runoffs.values())
    print(
        f"{label} run-off: {len(runoffs) + len(untied)} second-round rows, "
        f"{len(runoffs)} tied to the first round ({won} of them won), "
        f"{len(untied)} tied to none and kept as candidacies of their own"
    )
    for person in untied:
        print(f"  tied to no first-round row: {race_entry(person)}")
    return settled + untied


def process_pkw(ctx: Context, csv_headers, limit: int | None, year: str | None):
    print("Downloading files...")

    filtered_sources = sources
    if year:
        filtered_sources = [s for s in sources if str(s.year) == year]

    print("Downloading input files...")
    for config in filtered_sources:
        # Access them, so they're downloaded already
        ctx.io.read_data(config.source)
        if config.runoff is not None:
            ctx.io.read_data(config.runoff.source)
    print("Files downloaded")
    outputs = []
    for config in filtered_sources:
        try:
            outputs.extend(read_source(ctx, config, csv_headers, limit))
        except Exception as e:
            raise ValueError(f"Failed processing {config.source}: {e}")

        print("🎉 Processing complete.")

    return pd.DataFrame.from_records([dataclasses.asdict(r) for r in outputs])


def local_offices(rows: pd.DataFrame, gmina_kinds: typing.Mapping[str, str]) -> list:
    """The `office` column: which seat each local candidacy was for.

    After the files are read rather than row by row, because what a gmina's
    council is called needs the TERYT register (`scrapers.pkw.offices`).
    """
    if rows.empty:
        return []
    local = str(ElectionType.SAMORZADOWE)
    return [
        local_office(position, teryt, gmina_kinds) if kind == local else None
        for kind, position, teryt in zip(
            rows["election_type"], rows["position"], rows["teryt_candidacy"]
        )
    ]


class PeoplePKW(Pipeline[Person]):
    filename = "person_pkw"
    # Written zero-padded and only meaningful zero-padded. Without the pin a
    # restore from the shared cache re-infers the column as an integer and the
    # leading zeros are gone -- see scrapers/krs/columns.py for the two read
    # paths and why they disagree.
    dtype = {"teryt_candidacy": str, "teryt_living": str}
    teryt: Teryt

    @property
    def output_class(self):
        return Person

    def process(self, ctx: Context):
        assert self.teryt is not None
        self.teryt.process(ctx)  # TODO mark teryt as autoinitializing
        return main(ctx, self.teryt)


def main(ctx: Context, teryt: Teryt):
    parser = argparse.ArgumentParser(description="I'll add docs here")
    parser.add_argument(
        "--limit",
        dest="limit",
        type=int,
        default=None,
        help="for each source, only process its first LIMIT candidacies",
    )
    parser.add_argument(
        "--year",
        dest="year",
        type=str,
        default=None,
        help="for each file, only process LIMIT elements",
    )
    args, _ = parser.parse_known_args()

    # Initiate headers parsers with ctx dependent variables
    csv_headers = {k: v.set_teryt(teryt) if v else None for k, v in CSV_HEADERS.items()}

    res = process_pkw(ctx, csv_headers, args.limit, args.year)
    res["office"] = local_offices(res, teryt.gmina_kinds)

    print("\n\n")

    for column, counter in counters.items():
        if len(counter) == 0:
            continue
        print(column)
        print(counter.most_common(10))

    return res
