"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import typing
from abc import ABCMeta, abstractmethod
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Literal

import pandas as pd

if TYPE_CHECKING:
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
        self,
        fmt: Literal["jsonl", "csv", "parquet"],
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
    def read_data(self, fs: DataRef) -> File:
        """
        Reads data from a given data reference.

        Args:
            fs: The DataRef pointing to the data source.

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

    @abstractmethod
    def write_dataframe(self, df: pd.DataFrame, filename: str):
        """Writes a DataFrame to storage."""
        raise NotImplementedError()

    @abstractmethod
    def upload(self, source: Any, data: Any, content_type: str):
        """Uploads data to storage (e.g. GCS)."""
        raise NotImplementedError()

    @abstractmethod
    def list_blobs(self, hostname: str) -> typing.Generator[DownloadableFile, None, None]:
        """Lists blobs in storage for a given hostname."""
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


class Utils(metaclass=ABCMeta):
    """Abstract interface for utility functions."""

    @abstractmethod
    def input_with_timeout(self, msg: str, timeout: int = 10) -> str | None:
        """Reads input from stdin with a timeout."""
        raise NotImplementedError()

    @abstractmethod
    def join_url(self, base: str, url: str) -> str:
        """Joins a base URL with a relative URL."""
        raise NotImplementedError()


class Web(metaclass=ABCMeta):
    """Abstract interface for web related operations."""

    @abstractmethod
    def robot_txt_allowed(self, ctx: "Context", url: str, parsed_url: Any, user_agent: str) -> bool:
        """Checks if robots.txt allows fetching the URL."""
        raise NotImplementedError()


@dataclass
class Context:
    """Execution context for a scraper pipeline, providing access to I/O interfaces."""

    io: IO
    rejestr_io: RejestrIO
    con: "DuckDBPyConnection"
    utils: Utils
    web: Web


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
        raise NotImplementedError("This pipeline needs to be migrated to the @Pipeline wrapper")

    return GLOBAL_CONTEXT


class Pipeline:
    """
    A decorator for defining and configuring a data processing pipeline.

    If you implement it, the pipeline output can be just passed as an input.
    """

    filename: str | None

    @abstractmethod
    def process(self, ctx: Context):
        raise NotImplementedError()

    # TODO remove
    @property
    def model(self):
        return self

    def read(self, ctx: Context):
        if not self.filename:
            raise ValueError("Filename not set")
        df = None
        json_path = self.filename + ".jsonl"
        try:
            df = ctx.io.read_data(LocalFile(json_path, "versioned")).read_dataframe("jsonl")
        except FileNotFoundError as e:
            print("File doesn't exist, continuing: ", e)

        return df, json_path

    def read_or_process(
        self,
        ctx: Context,
        force_refresh=False,
    ):
        json_path: str | None = None
        df: pd.DataFrame | None = None
        if self.filename is not None and not force_refresh:
            df, json_path = self.read(ctx)

        if df is None:
            print("No df file, processing")
            df = self.run_pipeline(ctx)

            if df is None:
                # Try to recover from dumper
                try:
                    # We assume ctx.io.dumper exists and is an EntityDumper
                    # This is a bit hacky but requested by user
                    dumper = ctx.io.dumper  # type: ignore
                    last_written = dumper.get_last_written()
                    if last_written:
                        name, data = last_written
                        print(f"Recovered {name} from dumper")
                        df = pd.DataFrame.from_records([asdict(i) for i in data])

                        # If filename was None, maybe we can infer it from the entity name?
                        # But filename is passed to read_or_process.
                        # If filename is provided, we should probably use it.
                except AttributeError:
                    pass

            print("Processing done")

        if df is not None and json_path is not None:
            print(f"Writing to {json_path}")
            ctx.io.write_dataframe(df, json_path)

        if df is None:
            assert self.filename is not None
            df, _ = self.read(ctx, filename)

        assert df is not None
        return df

    def initialize_fields(self, ctx: Context):
        for annotation, pipeline_type_dep in self.__annotations__.items():
            if isinstance(pipeline_type_dep, type) and issubclass(pipeline_type_dep, PipelineModel):
                print("Initializing", annotation, pipeline_type_dep.__name__)
                # Dependencies are not subject to 'only' filter (nested > 0),
                # but they might be subject to 'refresh' if we wanted recursive refresh (logic below)
                # For now, 'refresh' only targets the specific pipeline name or 'all'
                res = run_pipeline(pipeline_type_dep, ctx, nested + 1, refresh_target=refresh_target, only_target=only_target)
                if res:
                    pipeline_model.__dict__[annotation], _ = res
                else:
                    # This should effectively not happen if valid pipelines are passed
                    # because we only skip at nested=0.
                    # However, if a dependency was somehow skipped, we might have an issue.
                    # But nested > 0 check prevents skipping dependencies.
                    pass

        print("Finished initialization")

    def run_pipeline(
        self,
        ctx: Context,
        nested=0,
        refresh_target: str | None = None,
        only_target: str | None = None,
    ) -> tuple["Pipeline", pd.DataFrame]:
        pipeline_type = type(self)
        pipeline_name = pipeline_type.__name__

        # Filter execution if "only" is specified
        requested_other_target = only_target and only_target not in {"all", pipeline_name}
        if nested == 0 and requested_other_target:
            # TODO implement lazy loading so there's always output
            return None

        # TODO restore nester here?
        print(f"{'  ' * nested}====== Running pipeline {pipeline_name} =====")

        should_refresh = refresh_target in {"all", pipeline_name}

        self.initialize_fields(ctx)
        setup_pipeline(pipeline, ctx)
        print(f"{'  ' * nested}====== Finished pipeline {pipeline_name} =====\n\n")
        return pipeline, df

    def setup_pipeline(self, ctx: Context):
        dumper = ctx.io.dumper  # pyright: ignore[reportAttributeAccessIssue] # TODO fix it
        try:
            result = self.process(ctx)
            return result
        finally:
            print("Dumping...")
            dumper.dump_pandas()
            print("Done")


PipelineModel = Pipeline
