"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import typing
from typing import Any, Literal
from dataclasses import dataclass, field
from abc import ABCMeta, abstractmethod

import pandas as pd
from duckdb import DuckDBPyConnection  # TODO remove


class Extractor(metaclass=ABCMeta):
    """Abstract base class for data extraction logic from a file."""

    @abstractmethod
    def read(self, file_path):
        """Reads and processes a file from the given path."""
        raise NotImplementedError()

    @abstractmethod
    def read_bytes(self, raw_bytes):
        """Reads and processes raw bytes."""
        raise NotImplementedError()


class File(metaclass=ABCMeta):
    """Abstract representation of a file, providing methods to read its content."""

    @abstractmethod
    def read_iterable(self) -> typing.Iterable:
        """Reads the file as an iterable, suitable for large files."""
        raise NotImplementedError()

    @abstractmethod
    def read_content(self) -> str | bytes:
        """Reads the entire content of the file into a string or bytes."""
        pass

    @abstractmethod
    def read_dataframe(
        self, fmt: Literal["jsonl", "csv", "parquet"], csv_sep=","
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
    def read_file(self) -> typing.BinaryIO | typing.TextIO:
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
class FirestoreCollection(DataRef):
    """A reference to a Google Firestore collection."""

    collection: str
    stream: bool = True
    filters: list[tuple[str, str, Any]] = field(default_factory=list)


@dataclass
class LocalFile(DataRef):
    """A reference to a file on the local filesystem."""

    filename: str
    folder: Literal["downloaded", "tests", "versioned"]


@dataclass
class DownloadableFile(DataRef):
    """
    A reference to a file that needs to be downloaded.

    Corresponds to stores.download.FileSource, which executes the download.
    """

    url: str
    filename_fallback: str | None = None
    complex_download: str | None = None
    download_lambda: typing.Callable | None = None

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
        return self.url.split("/")[-1]


@dataclass
class CloudStorage(DataRef):
    """A reference to a collection of objects in cloud storage under a hostname."""

    hostname: str


class IO(metaclass=ABCMeta):
    """Abstract interface for data input/output operations within a pipeline."""

    @abstractmethod
    def read_data(self, fs: DataRef, process_if_missing=True) -> File:
        """
        Reads data from a given data reference.

        Args:
            fs: The DataRef pointing to the data source.
            process_if_missing: If True, trigger processing to generate the data
                                if it doesn't exist.

        Returns:
            A File object for accessing the data.
        """
        raise NotImplementedError()

    @abstractmethod
    def list_data(self, path: DataRef) -> list[str]:
        """Lists the contents of a data source, like a directory or bucket."""
        raise NotImplementedError()

    @abstractmethod
    def output_entity(self, entity):
        """
        Writes a single entity of the core type to the configured output.
        """
        raise NotImplementedError()


class RejestrIO(metaclass=ABCMeta):
    """Abstract interface for interacting with the rejestr.io API."""

    @abstractmethod
    def get_rejestr_io(self, url: str) -> str | None:
        """
        Fetches data from a specific rejestr.io URL.

        Args:
            url: The URL to fetch.

        Returns:
            The content of the response as a string, or None if the request fails.
        """
        raise NotImplementedError()


@dataclass
class Context:
    """Execution context for a scraper pipeline, providing access to I/O interfaces."""

    io: IO
    rejestr_io: RejestrIO
    con: DuckDBPyConnection


GLOBAL_CONTEXT: None | Context = None


def set_context(ctx: Context):
    """Sets the global pipeline context."""
    global GLOBAL_CONTEXT
    GLOBAL_CONTEXT = ctx


def get_context() -> Context:
    """
    Retrieves the global pipeline context.

    Raises:
        NotImplementedError: If the context has not been set.
    """
    global GLOBAL_CONTEXT

    if not GLOBAL_CONTEXT:
        raise NotImplementedError(
            "This pipeline needs to be migrated to the @Pipeline wrapper"
        )

    return GLOBAL_CONTEXT


class Pipeline:
    """
    A decorator for defining and configuring a data processing pipeline.
    """

    def __init__(
        self, output_order: dict[str, list[str]] = {}, use_rejestr_io=False, **kwargs
    ):
        """
        Initializes the Pipeline decorator.

        Args:
            output_order: Specifies the sorting order for the output collection.
            use_rejestr_io: If True, the pipeline requires access to the RejestrIO interface.
        """
        # TODO implement it
        self.output_order = output_order
        self.rejestr_io = use_rejestr_io
        # TODO clean it up
        if len(kwargs) > 0:
            print(f"Unknown kwargs: {kwargs}")

    def __call__(self, func):
        """Wraps the decorated function."""
        self.process = func
        return self

    @staticmethod
    def cached_dataframe(func):
        name = func.__name__
        pipeline = Pipeline()
        # TODO check if name is set
        pipeline.process = func
        return pipeline
