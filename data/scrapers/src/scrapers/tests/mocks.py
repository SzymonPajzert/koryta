from unittest.mock import MagicMock, patch
from io import StringIO, BytesIO
from scrapers.stores import File, IO, RejestrIO, DataRef, LocalFile
import typing


# Fake/Mock Implementations for testing
class MockFile(File):
    """A mock implementation of the File interface for testing."""

    def __init__(self, content: str | bytes = ""):
        if isinstance(content, str):
            self._content_bytes = content.encode("utf-8")
        else:
            self._content_bytes = content
        self._content_str = self._content_bytes.decode("utf-8")

    def read_iterable(self) -> typing.Iterable:
        return StringIO(self._content_str)

    def read_content(self) -> str | bytes:
        return self._content_bytes

    def read_jsonl(self):
        import json

        return [json.loads(line) for line in self.read_iterable() if line.strip()]

    def read_csv(self, sep=","):
        import csv

        return list(csv.reader(self.read_iterable(), delimiter=sep))

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        # This would require a library like pandas or openpyxl.
        # For a mock, we can return a predefined list of lists.
        print(f"Mock-reading XLS with header={header_rows}, skip={skip_rows}")
        return [["mock", "data"], ["row1", "row2"]]

    def read_parquet(self):
        raise NotImplementedError("MockFile does not implement read_parquet.")

    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> "File":
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

    def read_data(self, fs: DataRef) -> File:
        key = str(fs)
        if key not in self.files:
            raise FileNotFoundError(f"No mock data for {key}")
        return self.files[key]

    def list_data(self, path: DataRef) -> list[str]:
        key = str(path)
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

    def read_data(self, fs):
        if isinstance(fs, LocalFile):
            if fs.filename in self.files:
                from stores.file import FromPath

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
