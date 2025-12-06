import csv
import fnmatch
import io
import math

import pandas

from scrapers.stores import Extractor, get_context

ctx = get_context()


class CsvExtractor(Extractor):
    def read(self, file_path):
        with open(file_path, "rb") as f:
            content = f.read()
        return self.read_bytes(io.BytesIO(content))

    def read_bytes(self, raw_bytes):
        def generator():
            for line in io.TextIOWrapper(raw_bytes, encoding="utf-8"):
                yield line

        first = True
        for line in csv.reader(generator(), delimiter=";"):
            if first:
                first = False
                yield [col.strip('\ufeff"') for col in line]
            else:
                yield line


class ZipExtractor(Extractor):
    inner_filename: str
    extractor: Extractor

    def __init__(self, inner_filename, extractor: Extractor = CsvExtractor()) -> None:
        self.inner_filename = inner_filename
        self.extractor = extractor

    def read(self, file_path):
        raw_bytes = ctx.conductor.read_file(file_path).read_zip(self.inner_filename)
        return self.extractor.read_bytes(raw_bytes)


class MultiXlsZipExtractor(Extractor):
    inner_filename_pattern: str
    header_rows: int
    skip_rows: int

    def __init__(self, inner_filename_pattern, header_rows, skip_rows=0) -> None:
        self.inner_filename_pattern = inner_filename_pattern
        self.header_rows = header_rows
        self.skip_rows = skip_rows

    def read(self, file_path):
        with ctx.conductor.read_file(file_path).read_zip() as z:
            first = True
            header = self.header_rows
            skip = self.skip_rows
            for filename in z.namelist():
                print(f"Checking {filename}")
                if not first:
                    header = 0
                    skip = self.header_rows
                if fnmatch.fnmatch(filename, self.inner_filename_pattern):
                    raw_bytes = z.open(filename, "r")

                    xls_extractor = XlsExtractor(filename, header, skip)
                    yield from xls_extractor.read_bytes(raw_bytes)

                first = False

    def read_bytes(self, raw_bytes):
        raise NotImplementedError(
            "MultiXlsZipExtractor does not support read_bytes directly"
        )


class XlsExtractor(Extractor):
    inner_filename: str
    header_rows: int
    skip_rows: int  # Row many rows to skip, e.g additional headers

    def __init__(self, inner_filename, header_rows, skip_rows=0) -> None:
        self.inner_filename = inner_filename
        self.header_rows = header_rows
        self.skip_rows = skip_rows

    def _read(self, content):
        df = pandas.read_excel(content, header=None, skiprows=self.skip_rows)
        count = 0
        header = None
        processed_header = []
        header_counts = {}

        for row in df.itertuples(index=False, name=None):
            if count < self.header_rows:
                current = list(row)
                for idx, _ in enumerate(current):
                    if not isinstance(current[idx], str) and math.isnan(current[idx]):
                        current[idx] = current[idx - 1]

                if header is None:
                    header = current
                else:
                    header = [f"{p} {c}" for p, c in zip(header, current)]
                count += 1
            elif count == self.header_rows and header is not None:
                # Process the aggregated header to handle duplicates
                for original_col_name in header:
                    col_name = original_col_name
                    suffix = 0
                    while col_name in header_counts:
                        suffix += 1
                        col_name = f"{original_col_name}_{suffix}"
                    header_counts[col_name] = 1
                    processed_header.append(col_name)
                yield processed_header
                count += 1
            else:
                yield row

    def read(self, file_path):
        return self._read(file_path)

    def read_bytes(self, raw_bytes):
        return self._read(raw_bytes)
