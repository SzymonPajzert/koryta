import typing
from abc import ABCMeta, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

type Formats = Literal["jsonl", "csv", "parquet"]


class File(metaclass=ABCMeta):
    """Abstract representation of a file, providing methods to read its content."""

    path: str

    @abstractmethod
    def read_bytes(self) -> bytes:
        """Reads the entire content of the file as bytes."""
        pass

    def read_string(self) -> str:
        """Reads the entire content of the file as a string"""
        return self.read_bytes().decode("utf-8")

    @abstractmethod
    def read_dataframe(
        self,
        fmt: Formats,
        csv_sep=",",
        dtype: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        pass

    @abstractmethod
    def read_jsonl(self):
        """Reads a JSONL (JSON Lines) file."""
        raise NotImplementedError()

    @abstractmethod
    def read_csv(self, sep=","):
        """Reads a CSV file."""
        raise NotImplementedError()

    @abstractmethod
    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        """Reads an XLS or XLSX file."""
        raise NotImplementedError()

    @abstractmethod
    def read_parquet(self):
        """Reads a Parquet file."""
        raise NotImplementedError()

    @abstractmethod
    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> "File":
        """Reads a file from within a ZIP archive."""
        raise NotImplementedError()

    @abstractmethod
    def read_file(self) -> typing.IO[bytes] | typing.IO[str]:
        """Returns a file-like object for reading."""
        raise NotImplementedError()


class ZipReader(metaclass=ABCMeta):
    """Abstract base class for a ZIP file reader."""

    # import bz2
    # with bz2.open(DUMP_FILENAME, "rt", encoding="utf-8") as f:
    @abstractmethod
    def open(
        self,
        filename: str,
        mode: str,
        encoding: str | None = None,
        subfile: str | None = None,
    ) -> typing.BinaryIO | typing.TextIO:
        """Opens a file within a ZIP archive."""
        raise NotImplementedError()


class DataRef(metaclass=ABCMeta):
    """Abstract base class for a reference to a data source."""

    pass


@dataclass
class LocalFile(DataRef):
    """A reference to a file on the local filesystem."""

    filename: str
    folder: Literal["downloaded", "tests", "versioned", "crawler_output", "tests/wiki"]


@dataclass
class DownloadableFile(DataRef):
    """
    A reference to a file that needs to be downloaded.

    Corresponds to stores.download.FileSource, which executes the download.
    """

    url: str
    filename_fallback: str | None = None
    full_url: bool = False
    complex_download: str | None = None
    download_lambda: typing.Callable | None = None
    binary: bool = True

    @property
    def filename(self) -> str:
        """
        Determines the local filename for the downloadable file.

        Returns:
            The filename from filename_fallback if provided, otherwise infers
            it from the URL.
        """
        if self.filename_fallback is not None:
            return self.filename_fallback
        if self.full_url:
            return self.url.split("://")[1]
        return self.url.split("/")[-1]


@dataclass
class GCSBlob(DataRef):
    """A reference to a single blob in GCS by its blob name."""

    blob_name: str


@dataclass
class MirrorRef(DataRef):
    """A reference to a URL in the compressed HTML mirror."""

    url: str


class NotInMirrorError(Exception):
    """Raised when a URL has no snapshot in the compressed mirror."""


@dataclass
class CloudStorage(DataRef):
    """A reference to a collection of objects in cloud storage"""

    prefix: str
    max_namespaces: list[str] = field(default_factory=list)
    namespace_values: dict[str, str] = field(default_factory=dict)
    binary: bool = False
