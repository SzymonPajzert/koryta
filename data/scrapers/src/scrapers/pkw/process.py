from dataclasses import dataclass
from collections import Counter
import argparse

from stores.duckdb import dump_dbs, ducktable
from util.polish import parse_name, PkwFormat
from scrapers.pkw.elections import ElectionType
from scrapers.pkw.sources import sources, InputSource
from scrapers.pkw.headers import CSV_HEADERS, SetField, ElectionContext


counters = {k: Counter() for k in CSV_HEADERS.keys()}


@ducktable(name="people_pkw", excluded_fields={"name_format"})
@dataclass
class ExtractedData:
    election_year: str
    election_type: str
    name_format: PkwFormat
    sex: str | None = None
    birth_year: int | None = None
    age: str | None = None
    teryt_candidacy: str | None = None
    teryt_living: str | None = None
    candidacy_success: str | None = None
    party: str | None = None
    position: str | None = None
    pkw_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    party_member: str | None = None

    def __post_init__(self):
        if self.pkw_name is not None:
            self.first_name, self.middle_name, self.last_name = parse_name(
                self.pkw_name, self.name_format
            )
        else:
            self.pkw_name = f"{self.last_name} {self.first_name}"

        if self.first_name is not None and " " in self.first_name:
            names = self.first_name.split(" ", 1)
            self.first_name = names[0]
            self.middle_name = names[1]

        if self.age is not None:
            self.birth_year = int(self.election_year) - int(self.age)

        try:
            self.first_name = strip_if_not_none(self.first_name)
            self.middle_name = strip_if_not_none(self.middle_name)
            self.last_name = strip_if_not_none(self.last_name)
            self.party = strip_if_not_none(self.party)
            self.position = strip_if_not_none(self.position)
            self.pkw_name = strip_if_not_none(self.pkw_name)
        except AttributeError:
            raise ValueError(f"field has incorrect type: {self}")

    def insert_into(self):
        pass


def strip_if_not_none(s: str | None):
    if s is None or s != s:  # check if s is nan
        return None
    # TODO Agnieszka True is giving us some issues
    if isinstance(s, bool):
        s = str(s)
    return s.strip()


def process_csv(reader, config: InputSource, csv_headers: dict[str, SetField | None]):
    header = None

    for row in reader:
        if header is None:
            header = row
            replacements = dict()
            print(header)
            for idx, col in enumerate(header):
                if col != col or col == float("nan"):
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
                        f"Duplicate column name: {col} and {replacements[processor.name]} map to {processor.name} during {config}"
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
            mapped[p.name] = p.processor(
                v, ElectionContext(config.year, config.election_type)
            )

        try:
            yield ExtractedData(
                election_year=str(config.year),
                election_type=str(config.election_type),
                name_format=config.name_format,
                **mapped,
            )
        except TypeError:
            print(row_dict)
            raise


def process_pkw(limit: int | None, year: str | None):
    print("Downloading files...")

    filtered_sources = sources
    if year:
        filtered_sources = [s for s in sources if str(s.year) == year]

    for config in filtered_sources:
        source = config.source
        if not source.downloaded():
            source.download()
        if source.downloaded():
            # Double check that everything is good
            print(f"File {source.filename} is present")
        else:
            raise Exception(f"File {source.filename} is not present")
    print("Files downloaded")

    for config in filtered_sources:
        # TODO Correctly open zip file
        print(f"🗂️  Starts processing CSV file: {config.source.filename}")
        reader = config.extractor.read(config.source.downloaded_path)

        try:
            count = 0
            for item in process_csv(reader, config, CSV_HEADERS):
                count += 1
                if limit is not None and count > limit:
                    break
                item.insert_into()
        except KeyError as e:
            raise ValueError(f"Failed processing {config.source.downloaded_path}: {e}")

        print("🎉 Processing complete.")


def main():
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

    try:
        process_pkw(args.limit, args.year)

        print("\n\n")

        for column, counter in counters.items():
            if len(counter) == 0:
                continue
            print(column)
            print(counter.most_common(10))
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs()
