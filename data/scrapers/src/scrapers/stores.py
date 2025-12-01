"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import typing
from collections.abc import Callable
from typing import Any, Literal
from dataclasses import dataclass, field
from abc import ABCMeta, abstractmethod

import pandas as pd
from duckdb import DuckDBPyConnection


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
    def output_entity(self, entity, sort_by=[]):
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
        self,
        process: Callable[[Context], pd.DataFrame],
        filename: str | None = None,
        use_rejestr_io=False,
    ):
        """
        Initializes the Pipeline decorator.

        Args:
            use_rejestr_io: If True, the pipeline requires access to the RejestrIO interface.
        """
        # Ensure, that the function that is decorated is a pipeline.
        assert len(process.__annotations__) == 1
        assert "ctx" in process.__annotations__

        self._process = process
        self.filename = filename
        self.rejestr_io = use_rejestr_io

    def process(self, ctx: Context):
        return Pipeline.read_or_process(ctx, self.filename, self._process)

    @staticmethod
    def setup(
        use_rejestr_io=False,
    ):

        def wrapper(func):
            pipeline = Pipeline(func, use_rejestr_io=use_rejestr_io)
            return pipeline

        return wrapper

    @staticmethod
    def cached_dataframe(func):
        name: str = func.__name__
        pipeline = Pipeline(func, filename=name)
        return pipeline

    @staticmethod
    def read(ctx: Context, filename: str):
        df = None
        json_path = filename + ".jsonl"
        try:
            df = ctx.io.read_data(LocalFile(json_path, "versioned")).read_dataframe(
                "jsonl"
            )
        except FileNotFoundError as e:
            print("File doesn't exist, continuing: ", e)

        return df, json_path

    @staticmethod
    def read_or_process(
        ctx: Context, filename: str | None, process: Callable[[Context], pd.DataFrame]
    ):
        json_path: str | None = None
        df: pd.DataFrame | None = None
        if filename is not None:
            df, json_path = Pipeline.read(ctx, filename)

        if df is None:
            print("No df file, processing")
            df = process(ctx)
            print("Processing done")

        if df is not None and json_path is not None:
            json_path = "versioned/" + json_path
            print(f"Writing to {json_path}")
            df.to_json(json_path, orient="records", lines=True)

        if df is None:
            assert filename is not None
            df, _ = Pipeline.read(ctx, filename)

        assert df is not None
        return df


class PipelineModel[Output]:
    """If you implement it, the pipeline output can be just passed as an input"""

    filename: str

    @abstractmethod
    def process(self, ctx: Context):
        raise NotImplementedError()

    def output(
        self, ctx: Context, constructor: Callable[[dict], Output]
    ) -> typing.Iterable[Output]:
        try:
            assert self.filename is not None
            df = Pipeline.read_or_process(ctx, self.filename, self.process)
            for row in df.itertuples(index=False):
                yield constructor(row.asdict())
        except:
            print("Failed to process pipeline", self)
            raise
