import csv
import json
import os
import typing
from io import BytesIO, StringIO
from typing import TypeAlias, Union
from unittest.mock import MagicMock

import duckdb
import pandas as pd

from scrapers.stores import IO, Context, DataRef, File, LocalFile, RejestrIO
from stores.file import FromPath

nested_dict: TypeAlias = dict[str, Union[str, bytes, "nested_dict"]]


# Fake/Mock Implementations for testing
class MockFile(File):
    """A mock implementation of the File interface for testing."""

    def __init__(self, content: str | bytes | dict[str, str | bytes] | nested_dict = ""):
        self._inner_files: nested_dict = {}
        if isinstance(content, dict):
            self._inner_files = content  # type: ignore
            self._content_bytes = b"archive"
            self._content_str = "archive"
        elif isinstance(content, str):
            self._content_bytes = content.encode("utf-8")
            self._content_str = content
        else:
            self._content_bytes = content
            self._content_str = self._content_bytes.decode("utf-8")

    def read_iterable(self) -> typing.Iterable:
        return StringIO(self._content_str)

    def read_content(self) -> str | bytes:
        return self._content_bytes

    def read_jsonl(self):
        return [json.loads(line) for line in self.read_iterable() if line.strip()]

    def read_csv(self, sep=","):
        return list(csv.reader(self.read_iterable(), delimiter=sep))

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        # This would require a library like pandas or openpyxl.
        # For a mock, we can return a predefined list of lists.
        print(f"Mock-reading XLS with header={header_rows}, skip={skip_rows}")
        return [["mock", "data"], ["row1", "row2"]]

    def read_dataframe(
        self,
        fmt: str,
        csv_sep=",",
        dtype: dict[str, typing.Any] | None = None,
    ) -> "pd.DataFrame":
        if fmt == "jsonl":
            return pd.DataFrame(self.read_jsonl())
        elif fmt == "csv":
            return pd.read_csv(self.read_iterable(), sep=csv_sep, dtype=dtype)  # type: ignore
        raise NotImplementedError(f"MockFile read_dataframe not implemented for {fmt}")

    def read_parquet(self):
        raise NotImplementedError("MockFile does not implement read_parquet.")

    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> "File":
        if inner_path and inner_path in self._inner_files:
            return MockFile(self._inner_files[inner_path])
        # Returns a mock file representing the content of the zip.
        return MockFile(f"zipped content: {inner_path or idx}")

    def read_file(self) -> typing.BinaryIO | typing.TextIO:
        return BytesIO(self._content_bytes)


class MockIO(IO):
    """A mock implementation of the IO interface for testing."""

    def __init__(self):
        self.files: dict[str, File] = {}
        self.output: list[typing.Any] = []
        self.listed_data: dict[str, list[str]] = {}
        self.dumper = MagicMock()

    def read_data(self, fs: DataRef) -> File:
        key = str(fs)
        if key in self.files:
            return self.files[key]

        # Fallback: try using the filename if available (e.g. for DownloadableFile or LocalFile)
        if hasattr(fs, "filename") and fs.filename in self.files:
            return self.files[fs.filename]

        raise FileNotFoundError(f"No mock data for {key}. Available: {list(self.files.keys())}")

    def list_data(self, path: DataRef) -> list[str]:
        key = str(path)
        if hasattr(path, "filename") and path.filename in self.files:
            # Return the filename as a "path" that exists
            return [path.filename]
        # Also check if the key itself is in files (direct match)
        if key in self.files:
            return [key]
        return self.listed_data.get(key, [])

    def output_entity(self, entity, sort_by=[]):
        self.output.append(entity)

    def write_dataframe(self, df, filename: str):
        self.output.append((filename, df))

    def upload(self, source, data, content_type):
        self.output.append((source, data, content_type))

    def list_blobs(self, hostname: str):
        return []


class DictMockIO(IO):
    def __init__(self, files):
        self.files = files
        self.output = []
        self.dumper = MagicMock()

    def read_data(self, fs):
        if isinstance(fs, LocalFile):
            if fs.filename in self.files:
                return FromPath(self.files[fs.filename])
        raise FileNotFoundError(f"File {fs} not found in mock")

    def output_entity(self, entity):
        self.output.append(entity)

    def list_data(self, fs):
        if isinstance(fs, LocalFile):
            if fs.filename in self.files:
                return [fs.filename]
        return []

    def write_dataframe(self, df, filename: str):
        self.output.append((filename, df))

    def upload(self, source, data, content_type):
        self.output.append((source, data, content_type))

    def list_blobs(self, hostname: str):
        return []


class MockRejestrIO(RejestrIO):
    """A mock implementation of the RejestrIO interface for testing."""

    def __init__(self):
        self.responses: dict[str, str] = {}

    def get_rejestr_io(self, url: str) -> str | None:
        return self.responses.get(url)


def get_test_context() -> Context:
    return Context(
        io=MockIO(),
        rejestr_io=typing.cast(RejestrIO, None),
        con=typing.cast(duckdb.DuckDBPyConnection, None),
        utils=typing.cast(typing.Any, None),
        web=typing.cast(typing.Any, None),
    )


def setup_test_context(ctx: Context, files: nested_dict = {}):
    for filename, content in files.items():
        if isinstance(content, str):
            if content.startswith("/") and os.path.exists(content):
                with open(content, "rb") as f:
                    if isinstance(ctx.io, MockIO):
                        ctx.io.files[filename] = MockFile(f.read())
                    else:
                        raise ValueError("Context IO must be MockIO")
            elif isinstance(ctx.io, MockIO):
                ctx.io.files[filename] = MockFile(content)
            else:
                raise ValueError("Context IO must be MockIO")
        elif isinstance(ctx.io, MockIO):
            ctx.io.files[filename] = MockFile(content)

    return ctx
