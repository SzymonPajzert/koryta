import argparse
import math
import typing
from collections import Counter

from entities.person import PKW as Person
from scrapers.pkw.headers import CSV_HEADERS, ElectionContext, SetField
from scrapers.pkw.sources import InputSource, sources
from scrapers.stores import Context, PipelineModel
from scrapers.teryt import Teryt
from util.polish import PkwFormat, parse_name

counters = {k: Counter() for k in CSV_HEADERS.keys()}


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
                    raise ValueError(f"Duplicate column name: {col} and {replacements[processor.name]} map to {processor.name} during {config}")

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
            mapped[p.name] = p.processor(v, ElectionContext(config.year, config.election_type))

        try:
            yield extract_data(
                election_year=str(config.year),
                election_type=str(config.election_type),
                name_format=config.name_format,
                **mapped,
            )
        except TypeError:
            print(row_dict)
            raise


def process_pkw(ctx: Context, csv_headers, limit: int | None, year: str | None):
    print("Downloading files...")

    filtered_sources = sources
    if year:
        filtered_sources = [s for s in sources if str(s.year) == year]

    print("Downloading input files...")
    for config in filtered_sources:
        source = config.source
        ctx.io.read_data(source)  # Access it, so it's downloaded already
    print("Files downloaded")

    for config in filtered_sources:
        reader = config.extractor.read(ctx, config.source)

        try:
            count = 0
            for item in process_csv(reader, config, csv_headers):
                count += 1
                if limit is not None and count > limit:
                    break
                ctx.io.output_entity(item)
        except Exception as e:
            raise ValueError(f"Failed processing {config.source}: {e}")

        print("🎉 Processing complete.")


class PeoplePKW(PipelineModel):
    filename = "person_pkw"
    teryt: Teryt  # TODO mark it as Pipeline[Teryt]

    def process(self, ctx: Context):
        main(ctx, self.teryt.model)


def main(ctx: Context, teryt: Teryt):
    parser = argparse.ArgumentParser(description="I'll add docs here")
    parser.add_argument(
        "--limit",
        dest="limit",
        type=int,
        default=None,
        help="for each file, only process LIMIT elements",
    )
    parser.add_argument(
        "--year",
        dest="year",
        type=str,
        default=None,
        help="for each file, only process LIMIT elements",
    )
    args = parser.parse_args()

    # Initiate headers parsers with ctx dependent variables
    csv_headers = {k: v.set_teryt(teryt) if v else None for k, v in CSV_HEADERS.items()}

    process_pkw(ctx, csv_headers, args.limit, args.year)

    print("\n\n")

    for column, counter in counters.items():
        if len(counter) == 0:
            continue
        print(column)
        print(counter.most_common(10))
