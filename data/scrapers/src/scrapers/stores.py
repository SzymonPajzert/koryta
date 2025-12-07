"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import typing
from abc import ABCMeta, abstractmethod
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


@dataclass
class ProcessPolicy:
    refresh_pipelines: set[str]
    run_pipelines: set[str]

    @staticmethod
    def with_default(refresh: list[str] = [], only: list[str] = []):
        refresh_pipelines = set() if len(refresh) == 0 else set(refresh)
        run_pipelines = {"all"} if len(only) == 0 else set(only)
        return ProcessPolicy(refresh_pipelines, run_pipelines)

    def check_set(self, s: set[str], pipeline_name: str):
        return "all" in s or pipeline_name in s

    def should_refresh(self, pipeline_name: str):
        return self.check_set(self.refresh_pipelines, pipeline_name)

    def should_run(self, pipeline_name: str):
        return self.check_set(self.refresh_pipelines | self.run_pipelines, pipeline_name)


class Pipeline:
    """
    A decorator for defining and configuring a data processing pipeline.

    If you implement it, the pipeline output can be just passed as an input.
    """

    filename: str | None
    nested: int

    @abstractmethod
    def process(self, ctx: Context):
        raise NotImplementedError()

    @staticmethod
    def create(pipeline_type, nested=0):
        result = pipeline_type()
        Pipeline.__init__(result, nested)
        return result

    def __init__(self, nested=0) -> None:
        self.nested = nested
        for annotation, pipeline_type_dep in self.list_sources():
            self.__dict__[annotation] = Pipeline.create(pipeline_type_dep, self.nested + 1)

    def read_or_process(
        self,
        ctx: Context,
        policy: ProcessPolicy = ProcessPolicy.with_default(),
    ):
        # TODO restore nester here?
        print(f"{'  ' * self.nested}====== Running pipeline {self.pipeline_name} =====")

        read_input = False
        df: pd.DataFrame | None = None
        if self.filename is not None and not policy.should_refresh(self.pipeline_name):
            df = self.read(ctx)
            read_input = True

        empty_should_run = df is None and policy.should_run(self.pipeline_name)
        if empty_should_run:
            print("No df file, processing")
            df = self.run_pipeline(ctx, policy)
        elif policy.should_refresh(self.pipeline_name):
            print(f"Requested a refesh of {self.pipeline_name} - {policy}")
            df = self.run_pipeline(ctx, policy)

        if df is not None and self.json_path != "" and not read_input:
            print(f"Writing to {self.json_path}")
            ctx.io.write_dataframe(df, self.json_path)

        assert df is not None
        return df

    def read(self, ctx: Context):
        assert self.filename
        df = None
        try:
            df = ctx.io.read_data(LocalFile(self.json_path, "versioned")).read_dataframe("jsonl")
        except FileNotFoundError as e:
            print("File doesn't exist, continuing: ", e)
        return df

    def preprocess_sources(self, ctx: Context, policy: ProcessPolicy):
        for annotation, pipeline_type_dep in self.list_sources():
            print("Initializing", annotation, pipeline_type_dep.__name__)
            # Dependencies are not subject to 'only' filter, so we pass "all"
            dep_policy = ProcessPolicy(policy.refresh_pipelines, {"all"})
            self.__dict__[annotation].read_or_process(ctx, dep_policy)

        print("Finished initialization")

    def run_pipeline(
        self,
        ctx: Context,
        policy: ProcessPolicy,
    ) -> pd.DataFrame:
        self.preprocess_sources(ctx, policy)
        dumper = ctx.io.dumper  # type:ignore # TODO fix it
        gracefull = True

        df: pd.DataFrame | None = None
        try:
            # Call the abstract method
            df = self.process(ctx)
        except InterruptedError:
            print("Caught interrupt signal, will save the data")
        except Exception as e:
            print("Not handling this exception", e)
            gracefull = False
            raise e
        finally:
            if gracefull:
                print("Dumping...")
                dumper.dump_pandas()
                print("Done")

        if df is None:
            last_written = dumper.get_last_written()
            if last_written:
                name, data = last_written
                print(f"Recovered {name} from dumper")
                df = pd.DataFrame.from_records([asdict(i) for i in data])
            else:
                raise ValueError("Not found last_written")

        print(f"{'  ' * self.nested}====== Finished pipeline {self.pipeline_name} =====\n\n")
        return df

    def list_sources(self):
        for annotation, pipeline_type_dep in self.__annotations__.items():
            if isinstance(pipeline_type_dep, type) and issubclass(pipeline_type_dep, PipelineModel):
                yield annotation, pipeline_type_dep

    @property
    def json_path(self) -> str:
        if self.filename:
            return self.filename + ".jsonl"
        return ""

    @property
    def pipeline_name(self) -> str:
        pipeline_type = type(self)
        return pipeline_type.__name__


PipelineModel = Pipeline
