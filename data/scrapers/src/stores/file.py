import bz2
import csv
import io
import json
import typing
from typing import Any, BinaryIO, Literal, TextIO
from zipfile import ZipFile

import pandas as pd

from scrapers.stores import File


class FromIterable(File):
    def __init__(self, iterable: typing.Iterable):
        self.iterable = iterable

    def read_iterable(self):
        return self.iterable

    def read_bytes(self) -> bytes:
        return b"".join(self.iterable)

    def read_jsonl(self):
        for line in self.iterable:
            yield json.loads(line)

    def read_dataframe(
        self,
        fmt: Literal["jsonl", "csv", "parquet"],
        csv_sep=",",
        dtype: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        if fmt == "jsonl":
            return pd.DataFrame.from_records(
                [json.loads(line) for line in self.iterable]
            )
        else:
            raise NotImplementedError()

    def read_csv(self, sep=","):
        return csv.reader(self.iterable, delimiter=sep)

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        raise NotImplementedError(type(self).__name__)

    def read_parquet(self):
        raise NotImplementedError()

    def read_zip(self, inner_path: str | None = None, idx: int | None = None):
        raise NotImplementedError()

    def read_file(self):
        raise NotImplementedError()


class FromBytesIO(File):
    def __init__(self, raw_bytes):
        self.raw_bytes = raw_bytes

    def read_iterable(self):
        raise NotImplementedError()

    def read_bytes(self) -> bytes:
        return self.raw_bytes

    def read_dataframe(
        self,
        fmt: Literal["jsonl", "csv", "parquet"],
        csv_sep=",",
        dtype: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        if fmt == "csv":
            return pd.read_csv(self.raw_bytes, sep=csv_sep, dtype=dtype)  # type: ignore
        elif fmt == "jsonl":
            return pd.read_json(self.raw_bytes, lines=True, dtype=dtype)
        elif fmt == "parquet":
            return pd.read_parquet(self.raw_bytes)
        else:
            raise NotImplementedError(f"Format {fmt} not supported for FromBytesIO")

    def read_jsonl(self):
        raise NotImplementedError()

    def read_csv(self, sep=","):
        yield from pd.read_csv(self.raw_bytes, sep=sep, header=None).itertuples(
            index=False, name=None
        )

    def read_parquet(self):
        raise NotImplementedError()

    def read_file(self) -> BinaryIO | TextIO:
        if isinstance(self.raw_bytes, str):
            return io.StringIO(self.raw_bytes)
        return io.BytesIO(self.raw_bytes)

    def read_zip(self, inner_path: str | None = None, idx: int | None = None):
        raise NotImplementedError()

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        return read_xls(self.raw_bytes, header_rows, skip_rows)


class FromTextIO(FromIterable):
    def __init__(self, wrapper: io.TextIOWrapper):
        self._wrapper = wrapper

        def generator():
            for line in self._wrapper:
                yield line

        super().__init__(generator())

    def close(self):
        self._wrapper.close()

    def read_file(self) -> BinaryIO | TextIO:
        return self._wrapper


class FromPath(FromBytesIO):
    # TODO inheritance here is incorrect.
    # Given binary=False, we should inherit from FromTextIO
    path: str

    def __init__(self, path, binary=False):
        super().__init__(open(path, "rb").read())
        self.path = path

    def read_parquet(self):
        return pd.read_parquet(self.path)

    def read_jsonl(self):
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                yield json.loads(line)

    def read_iterable(self):
        with open(self.path, "r", encoding="utf-8") as f:
            yield from f

    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> File:
        if inner_path is None and idx is None:
            return FromTextIO(bz2.open(self.path, "rt", encoding="utf-8"))
        elif inner_path is not None:
            raw_bytes = ZipFile(self.path, "r").open(inner_path, "r")
            return FromBytesIO(raw_bytes)
        elif idx is not None:
            inner_path = ZipFile(self.path, "r").namelist()[idx]
            raw_bytes = ZipFile(self.path, "r").open(inner_path, "r")
            return FromBytesIO(raw_bytes)
        else:
            raise NotImplementedError()

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        return read_xls(self.path, header_rows, skip_rows)

    def read_dataframe(
        self,
        fmt: Literal["jsonl", "csv", "parquet"],
        csv_sep=",",
        dtype: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        if fmt == "jsonl":
            # TODO remove this hardcodeFix
            if dtype is None:
                dtype = {}
            if self.path.endswith("names_count_by_region.jsonl"):
                dtype["teryt"] = str
            if "company_" in self.path:
                dtype["krs"] = str
            return pd.read_json(self.path, lines=True, dtype=dtype)
        elif fmt == "csv":
            return pd.read_csv(self.path, sep=csv_sep)
        elif fmt == "parquet":
            return pd.read_parquet(self.path)

        return super().read_dataframe(fmt, csv_sep)


def read_xls(raw_bytes_or_path: bytes | str, header_rows: int = 0, skip_rows: int = 0):
    df = pd.read_excel(raw_bytes_or_path, header=None, skiprows=skip_rows)
    count = 0
    header = None
    processed_header = []
    header_counts = {}

    for row in df.itertuples(index=False, name=None):
        if count < header_rows:
            current = list(row)
            for idx, _ in enumerate(current):
                if not isinstance(current[idx], str) and pd.isna(current[idx]):
                    current[idx] = current[idx - 1]

            if header is None:
                header = current
            else:
                header = [f"{p} {c}" for p, c in zip(header, current)]
            count += 1
        elif count == header_rows and header is not None:
            # Process the aggregated header to handle duplicates
            for col_name in header:
                original_col_name = col_name
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
