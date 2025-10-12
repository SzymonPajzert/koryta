from dataclasses import dataclass
import regex as re
from collections import Counter

from stores.duckdb import dump_dbs, ducktable
from util.polish import UPPER
from scrapers.pkw.sources import sources
from scrapers.pkw.headers import CSV_HEADERS

# TODO write years to separate files, so it's a bit faster to processles
# TODO compare teryt_candidacy and teryt_living and find people who are too far


counters = {k: Counter() for k in CSV_HEADERS.keys()}


@ducktable(name="people_pkw")
@dataclass
class ExtractedData:
    election_year: str
    sex: str
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
            words = self.pkw_name.split(" ")
            if words[-1].isupper() and any(c.islower() for w in words[:-1] for c in w):
                # Assume "First Middle LAST"
                self.last_name = words[-1]
                self.first_name = words[0]
                if len(words) > 2:
                    self.middle_name = " ".join(words[1:-1])
            else:
                # Assume "LAST First Middle"
                m = re.match(f"((?:[-{UPPER}]+ ?)+)", self.pkw_name)
                if not m:
                    raise ValueError(f"Invalid name: {self.pkw_name}")
                self.last_name = m.group(1).strip()
                rest = self.pkw_name[len(m.group(0)) :].strip()
                if rest:
                    names = rest.split(" ")
                    self.first_name = names[0]
                    if len(names) > 1:
                        self.middle_name = " ".join(names[1:])
                else:
                    # This can happen if the whole name is uppercase and considered a last name.
                    # Try to split it.
                    name_parts = self.last_name.split(" ")
                    if len(name_parts) > 1:
                        self.last_name = " ".join(name_parts[:-1])
                        self.first_name = name_parts[-1]
                    else:
                        self.first_name = ""
        else:
            self.pkw_name = f"{self.last_name} {self.first_name}"

        if self.first_name is not None and " " in self.first_name:
            names = self.first_name.split(" ", 1)
            self.first_name = names[0]
            self.middle_name = names[1]

        if self.age is not None:
            self.birth_year = int(self.election_year) - int(self.age)

    def insert_into(self):
        pass


def process_csv(reader, election_year, csv_headers):
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
                if csv_headers[col] == "" or csv_headers[col] is None:
                    continue

                if csv_headers[col].name not in replacements:
                    replacements[csv_headers[col].name] = col
                else:
                    raise ValueError(
                        f"Duplicate column name: {col} and {replacements[csv_headers[col].name]} map to {csv_headers[col].name}"
                    )

            continue

        row_dict = dict(zip(header, row))

        for k, v in row_dict.items():
            if csv_headers[k] == "":
                counters[k].update([v])

        mapped = dict()
        for k, v in row_dict.items():
            if csv_headers[k] == "" or csv_headers[k] is None:
                continue
            mapped[csv_headers[k].name] = csv_headers[k].processor(v)

        try:
            yield ExtractedData(election_year=election_year, **mapped)
        except TypeError:
            print(row_dict)
            raise


def process_pkw():
    print("Downloading files...")
    for config in sources:
        source = config.source
        if not source.downloaded():
            source.download()
        if source.downloaded():
            # Double check that everything is good
            print(f"File {source.filename} is present")
        else:
            raise Exception(f"File {source.filename} is not present")
    print("Files downloaded")

    for config in sources:
        # TODO Correctly open zip file
        print(f"🗂️  Starts processing CSV file: {config.source.filename}")
        reader = config.extractor.read(config.source.downloaded_path)

        # TODO check the year, since it's currently hardcoded for 2024
        headers = {**CSV_HEADERS}
        try:
            for item in process_csv(reader, config.year, headers):
                item.insert_into()
        except KeyError as e:
            raise ValueError(f"Failed processing {config.source.downloaded_path}: {e}")

        print("🎉 Processing complete.")


def main():
    try:
        process_pkw()

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
