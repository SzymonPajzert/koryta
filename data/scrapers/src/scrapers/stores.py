"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import io
import os.path
import typing
from abc import ABCMeta, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, List, Literal, Union, overload

import pandas as pd

from stores.textmodel.ner import NEREntities

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
        return self.url.split("/")[-1]


@dataclass
class CloudStorage(DataRef):
    """A reference to a collection of objects in cloud storage"""

    prefix: str
    max_namespaces: list[str] = field(default_factory=list)
    namespace_values: dict[str, str] = field(default_factory=dict)
    binary: bool = False


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
    def list_files(self, path: DataRef) -> typing.Iterable[DataRef]:
        """Lists the contents of a data source, like a directory or bucket.

        For CloudStorage lists downloadable files.
        """
        raise NotImplementedError()

    @abstractmethod
    def output_entity(self, entity, sort_by=[]):
        """
        Writes a single entity of the core type to the configured output.
        """
        raise NotImplementedError()

    @abstractmethod
    def write_file(
        self, fs: DataRef, content: str | typing.Callable[[io.BufferedWriter], None]
    ):
        """Writes a DataFrame to storage."""
        raise NotImplementedError()

    # TODO remove this as well - it should just be a write_file
    @abstractmethod
    def upload(self, source: Any, data: Any, content_type: str):
        """Uploads data to storage (e.g. GCS)."""
        raise NotImplementedError()

    # TODO get rid of this - it should be just a library call
    @abstractmethod
    def list_namespaces(self, ref: CloudStorage, namespace: str) -> list[str]:
        """Lists available values for a given namespace (e.g. 'date')."""
        raise NotImplementedError()

    @abstractmethod
    def get_mtime(self, fs: DataRef) -> float | None:
        """Returns the modification time of the data reference if aplicable."""
        raise NotImplementedError()

    @abstractmethod
    def get_output(self, entity_type: type) -> list[Any] | None:
        """
        Retrieves the output list for a specific entity type from the current context.
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
    def robot_txt_allowed(
        self, ctx: "Context", url: str, parsed_url: Any, user_agent: str
    ) -> bool:
        """Checks if robots.txt allows fetching the URL."""
        raise NotImplementedError()


class NLP(metaclass=ABCMeta):
    """Abstract interface for NLP toolkit"""

    @abstractmethod
    def extract_ner_entities(self, text: str) -> NEREntities:
        """Extract Named Entity Recognition entities from text."""
        pass

    @overload
    @abstractmethod
    def lemmatize(self, text_data: str) -> str: ...

    @overload
    @abstractmethod
    def lemmatize(self, text_data: List[str]) -> List[str]: ...

    @abstractmethod
    def lemmatize(self, text_data: Union[str, List[str]]) -> Union[str, List[str]]:
        """Lemmatize text or list of texts."""
        pass


@dataclass
class ProcessPolicy:
    refresh_pipelines: set[str]
    exclude_refresh: set[str] = field(default_factory=set)
    refreshed_pipelines: set[str] = field(default_factory=set)

    @staticmethod
    def with_default(
        refresh: list[str] = [],
        exclude_refresh: list[str] = [],
    ):
        refresh_pipelines = set() if len(refresh) == 0 else set(refresh)
        exclude_refresh_set = set(exclude_refresh)
        return ProcessPolicy(refresh_pipelines, exclude_refresh_set)

    def check_set(self, s: set[str], pipeline_name: str):
        return "all" in s or pipeline_name in s

    def should_refresh(self, pipeline_name: str):
        if pipeline_name in self.exclude_refresh:
            return False
        return self.check_set(self.refresh_pipelines, pipeline_name)

    def add_refreshed_pipeline(self, pipeline_name: str):
        self.refreshed_pipelines.add(pipeline_name)


@dataclass
class Context:
    """Execution context for a scraper pipeline, providing access to I/O interfaces."""

    io: IO
    rejestr_io: RejestrIO
    con: "DuckDBPyConnection"
    utils: Utils
    web: Web
    nlp: NLP
    refresh_policy: ProcessPolicy = field(default_factory=ProcessPolicy.with_default)


def write_dataframe(ctx: Context, df: pd.DataFrame, filename: str, format: Formats):
    """Writes a DataFrame to storage."""

    def writer(f: io.BufferedWriter):
        match format:
            case "jsonl":
                df.to_json(f, orient="records", lines=True)
            case "csv":
                df.to_csv(f, index=False)
            case _:
                raise ValueError(f"Not supported export format - {format}")

    ctx.io.write_file(LocalFile(filename, "versioned"), writer)


class Pipeline:
    """
    A decorator for defining and configuring a data processing pipeline.

    If you implement it, the pipeline output can be just passed as an input.
    """

    filename: str | None | property
    nested: int
    format: Formats = "jsonl"
    dtype: dict[str, Any] | None = None
    _cached_result: pd.DataFrame | None = None
    _refreshed_execution: bool = False

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
        self._cached_result = None
        self._refreshed_execution = False
        self.dependencies = {}
        for annotation, pipeline_type_dep in self.list_sources():
            dep = Pipeline.create(pipeline_type_dep, self.nested + 1)
            self.__dict__[annotation] = dep
            self.dependencies[annotation] = dep

    def read(self, ctx: Context):
        assert self.filename
        df = None
        try:
            df = ctx.io.read_data(
                LocalFile(self.output_path, "versioned")
            ).read_dataframe(self.format, dtype=self.dtype)
        except FileNotFoundError as e:
            print("File doesn't exist, continuing: ", e)
        return df

    def output_time(self, ctx: Context):
        self_ref = LocalFile(self.output_path, "versioned") if self.filename else None
        return ctx.io.get_mtime(self_ref) if self_ref else None

    def should_refresh_with_logic(self, ctx: Context) -> bool:
        """
        Determines if the pipeline should refresh based on:
        1. Explicit policy.
        2. Missing output of the dependency.
        3. Refresh upstream (policy or newer timestamp).
        """
        if (
            self.filename is not None
            and self.pipeline_name in ctx.refresh_policy.refreshed_pipelines
        ):
            # Already refreshed
            return False

        if ctx.refresh_policy.should_refresh(self.pipeline_name):
            print(f"Refreshing {self.pipeline_name} because of policy")
            return True

        self_mtime = self.output_time(ctx)
        if self_mtime is None:
            print(f"Refreshing {self.pipeline_name} because of missing output")
            return True

        for dep_name, dep in self.dependencies.items():
            if dep.filename is None:
                print(f"Dependency {self.pipeline_name} is volatile, skipping")
                continue

            if dep.should_refresh_with_logic(ctx):
                print(
                    f"Refreshing {self.pipeline_name} because of dependency {dep_name}"
                )
                return True

            dep_output_time = dep.output_time(ctx)
            if dep_output_time is None or dep_output_time > self_mtime:
                print(
                    f"Refreshing {self.pipeline_name} because of dependency {dep_name}"
                )
                return True

        return False

    def read_or_process(
        self,
        ctx: Context,
    ) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        should_refresh = self.should_refresh_with_logic(ctx)
        if not should_refresh and self.filename is not None:
            try:
                df = self.read(ctx)
                self._cached_result = df
                # If read successfully, we don't need to write (it matches disk).
                assert df is not None
                return df
            except FileNotFoundError:
                # We'll try to process
                pass

        df = self.run_pipeline(ctx, ctx.refresh_policy)

        if df is not None and self.output_path != "":
            print(f"Writing to {self.output_path}")
            write_dataframe(ctx, df, self.output_path, self.format)

        if df is not None:
            ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
            self._cached_result = df

        return df

    def preprocess_sources(self, ctx: Context, policy: ProcessPolicy) -> bool:
        """
        Runs read_or_process on all dependencies.
        Returns True if any dependency was refreshed.
        """
        any_refreshed = False
        for _, dep in self.dependencies.items():
            dep.read_or_process(ctx)
            if dep._refreshed_execution:
                any_refreshed = True
        return any_refreshed

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
            df = self.process(ctx)
            self._refreshed_execution = True
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
                self._refreshed_execution = True
            else:
                raise ValueError(f"Not found last_written for {self.pipeline_name}")

        print(
            f"{'  ' * self.nested}====== \
                Finished pipeline {self.pipeline_name} =====\n\n"
        )
        return df

    def list_sources(self):
        for annotation, pipeline_type_dep in self.__annotations__.items():
            if isinstance(pipeline_type_dep, type) and issubclass(
                pipeline_type_dep, Pipeline
            ):
                yield annotation, pipeline_type_dep

    @property
    def output_path(self) -> str:
        if self.filename:
            return os.path.join(self.filename, self.filename + "." + self.format)
        return ""

    @property
    def pipeline_name(self) -> str:
        pipeline_type = type(self)
        return pipeline_type.__name__
