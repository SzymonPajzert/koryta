"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import io
import posixpath
import typing
from abc import ABCMeta, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Callable, List, Literal, NewType, Union, overload

import numpy as np
import pandas as pd
from dacite import Config, from_dict  # type: ignore[import-not-found]

from entities.ner import NEREntities

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
Priority = NewType("Priority", int)


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
    # TODO remove this method, it fails if multiple pipelines use it
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
    def upload(
        self,
        source: Any,
        data: Any,
        content_type: str,
        include_query=False,
        verbose=True,
    ):
        """Uploads data to storage (e.g. GCS)."""
        raise NotImplementedError()

    @abstractmethod
    def batch_upload(
        self,
        source: Any,
        data: Any,
        content_type: str,
        include_query=False,
        verbose=True,
    ) -> str:
        """Batches data for upload (e.g. to GCS in a tar.gz).

        Returns: The path to the uploaded batch file."""
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


@dataclass(frozen=True)
class LLMRequest:
    prompt: str
    max_tokens: int
    temperature: float = 0
    model: str | None = None


@dataclass(frozen=True)
class LLMResponse:
    content: str
    port: int | None = None
    model: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLM(metaclass=ABCMeta):
    """Abstract interface for OpenAI-compatible chat completion clients."""

    @abstractmethod
    async def chat(
        self,
        prompt: str,
        *,
        max_tokens: int,
        temperature: float = 0,
        model: str | None = None,
    ) -> str:
        """Return the assistant message content for a single prompt."""
        raise NotImplementedError()

    @abstractmethod
    async def map_chat(self, requests: list[LLMRequest]) -> list[LLMResponse]:
        """Return chat completions for a batch of prompts."""
        raise NotImplementedError()

    @abstractmethod
    async def check_health(self) -> None:
        """Verify configured LLM backends are reachable."""
        raise NotImplementedError()


@dataclass(frozen=True)
class CrawlQueueItem:
    uid: str
    url: str
    priority: int


@dataclass(frozen=True)
class DoneUrl:
    uid: str
    url: str
    storage_path: str
    media_type: str | None = None


@dataclass(frozen=True)
class NewUrl:
    url: str
    priority: int

    def __post_init__(self) -> None:
        if not 0 <= self.priority <= 100:
            raise ValueError(f"Priority must be 0-100, got {self.priority}")


@dataclass(frozen=True)
class BlockedDomain:
    domain: str
    reason: str


class CrawlQueue(metaclass=ABCMeta):
    """Abstract interface for crawler URL queue."""

    @abstractmethod
    def put(self, urls: list[NewUrl]) -> None:
        """Insert/enqueue URLs (idempotent).

        Each entry contains a URL and its priority in [0, 100].
        """
        raise NotImplementedError()

    @abstractmethod
    def get(
        self, worker_id: str, max_retries: int = 3, timeout_seconds: float = 60
    ) -> CrawlQueueItem | None:
        """Atomically claim a URL for processing.

        max_retries filters url that were retried more than $max_retries.
        timeout_seconds controls when a previously locked URL is retried.

        Returns CrawlQueueItem or None.
        """
        raise NotImplementedError()

    def get_batch(
        self,
        worker_id: str,
        batch_size: int = 16,
        max_retries: int = 3,
        timeout_seconds: float = 60,
    ) -> list[CrawlQueueItem]:
        """Atomically claim up to batch_size URLs for processing.

        Default implementation calls get() repeatedly; subclasses may override
        with a single-query implementation.
        """
        items = []
        for _ in range(batch_size):
            item = self.get(worker_id, max_retries, timeout_seconds)
            if item is None:
                break
            items.append(item)
        return items

    @abstractmethod
    def mark_done(
        self,
        uid: str,
        storage_path: str | None,
        metadata: dict[str, object] | None = None,
    ) -> None:
        """Mark a URL as successfully crawled."""
        raise NotImplementedError()

    def mark_done_batch(
        self,
        items: list[tuple[str, str | None, dict[str, object]]],
    ) -> None:
        """Batch-mark URLs as crawled. Default calls mark_done() per item."""
        for uid, storage_path, metadata in items:
            self.mark_done(uid, storage_path, metadata)

    @abstractmethod
    def mark_error(self, uid: str, error: str) -> None:
        """Record an error and increment retries."""
        raise NotImplementedError()

    def mark_error_batch(self, items: list[tuple[str, str]]) -> None:
        """Batch-record errors. Default calls mark_error() per item."""
        for uid, error in items:
            self.mark_error(uid, error)

    @abstractmethod
    def release(self, uid: str) -> None:
        """Handle an unprocessed URL without marking done or error.

        Implementations may either make the URL immediately claimable again or
        keep the current lock and rely on their timeout/retry semantics.
        """
        raise NotImplementedError()

    def release_batch(self, uids: list[str]) -> None:
        """Batch-handle unprocessed URLs. Default calls release() per item."""
        for uid in uids:
            self.release(uid)

    @abstractmethod
    def add_blocked_domains(self, rows: list[BlockedDomain]) -> None:
        """Add or update blocked domains.

        Domain can be a bare hostname or URL; matching ignores scheme/www.
        """
        raise NotImplementedError()

    @abstractmethod
    def get_blocked_domains(self) -> set[str]:
        """Return normalized blocked domain hostnames for in-memory filtering."""
        raise NotImplementedError()

    @abstractmethod
    def reprioritize(
        self, priority_fn: Callable[[str], int], batch_size: int = 5000
    ) -> None:
        """Update priorities using priority_fn(url) -> priority."""
        raise NotImplementedError()

    @abstractmethod
    def get_done_urls(self, limit: int | None = None) -> list[DoneUrl]:
        """Return done URLs with storage_path. If limit is None, returns all."""
        raise NotImplementedError()

    @abstractmethod
    def reset(self) -> None:
        """Reset the queue tables/state to an empty clean slate."""
        raise NotImplementedError()


@dataclass
class ProcessPolicy:
    refresh_pipelines: set[str]
    exclude_refresh: set[str] = field(default_factory=set)
    refreshed_pipelines: set[str] = field(default_factory=set)

    execution_decisions: dict[str, tuple[bool, str]] = field(default_factory=dict)
    tree_printed: bool = False

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

    def build_and_print_tree(self, root_pipeline: Any, ctx: Any):
        def evaluate(pipeline) -> tuple[bool, str]:
            if pipeline.pipeline_name in self.execution_decisions:
                return self.execution_decisions[pipeline.pipeline_name]

            # evaluate dependencies first so they are populated
            for dep in getattr(pipeline, "dependencies", {}).values():
                evaluate(dep)

            if pipeline.pipeline_name in self.refreshed_pipelines:
                decision = (False, "already refreshed")
            elif self.should_refresh(pipeline.pipeline_name):
                decision = (True, "policy")
            else:
                mtime = pipeline.output_time(ctx)
                if mtime is None:
                    decision = (True, "missing output")
                else:
                    decision = (False, "up to date")
                    for dep_name, dep in getattr(pipeline, "dependencies", {}).items():
                        if dep.volatile:
                            continue

                        dep_run, dep_reason = self.execution_decisions[
                            dep.pipeline_name
                        ]
                        if dep_run:
                            decision = (
                                True,
                                f"dependency {dep.pipeline_name} refreshed",
                            )
                            break

                        dep_mtime = dep.output_time(ctx)
                        if dep_mtime is None or dep_mtime > mtime:
                            decision = (
                                True,
                                f"dependency {dep.pipeline_name} is newer",
                            )
                            break

            self.execution_decisions[pipeline.pipeline_name] = decision
            return decision

        evaluate(root_pipeline)

        # Now print nicely
        print("\n=== Pipeline Execution Tree ===")

        def print_tree(pipeline, indent=0):
            run, reason = self.execution_decisions[pipeline.pipeline_name]
            status = "[RUN] " if run else "[SKIP]"
            print(f"{'  ' * indent}{status} {pipeline.pipeline_name} ({reason})")
            for dep in getattr(pipeline, "dependencies", {}).values():
                print_tree(dep, indent + 1)

        print_tree(root_pipeline)
        print("===============================\n")
        self.tree_printed = True


@dataclass
class Context:
    """Execution context for a scraper pipeline, providing access to I/O interfaces."""

    io: IO
    rejestr_io: RejestrIO
    con: "DuckDBPyConnection"
    utils: Utils
    web: Web
    nlp: NLP
    crawl_queue: CrawlQueue | None = None
    refresh_policy: ProcessPolicy = field(default_factory=ProcessPolicy.with_default)
    llm: LLM | None = None
    article_workers: int = 4


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


Output = typing.TypeVar("Output")


class Pipeline(typing.Generic[Output]):
    """
    A decorator for defining and configuring a data processing pipeline.

    If you implement it, the pipeline output can be just passed as an input.
    """

    filename: str | None | property = None
    volatile: bool = False
    nested: int
    format: Formats = "jsonl"
    dtype: dict[str, Any] | None = None
    confirm_run: bool = False

    _cached_result: pd.DataFrame | None = None
    _refreshed_execution: bool = False

    @abstractmethod
    def process(self, ctx: Context):
        raise NotImplementedError()

    @property
    def output_class(self) -> typing.Type[Output]:
        """Subclasses must return the dataclass type here for runtime instantiation."""
        raise NotImplementedError("Subclasses must define output_class")

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
            raise
        return df

    def output_time(self, ctx: Context):
        self_ref = LocalFile(self.output_path, "versioned") if self.filename else None
        return ctx.io.get_mtime(self_ref) if self_ref else None

    @staticmethod
    def confirm_if_big(func):
        def wrapper(self, ctx: Context):
            result = func(self, ctx)
            if result and self.confirm_run:
                answer = ctx.utils.input_with_timeout(
                    "This pipeline is pretty big, Should I run it? (y/n) [n]",
                    timeout=10,
                )
                if answer is None or answer.lower() != "y":
                    print("Not refreshing")
                    return False
            return result

        return wrapper

    @confirm_if_big
    def should_refresh_with_logic(self, ctx: Context) -> bool:
        """
        Determines if the pipeline should refresh based on the execution tree.
        """
        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        if (
            getattr(self, "filename", None) is not None
            and self.pipeline_name in ctx.refresh_policy.refreshed_pipelines
        ):
            # Already refreshed
            return False

        if self.pipeline_name not in ctx.refresh_policy.execution_decisions:
            return False

        run, reason = ctx.refresh_policy.execution_decisions[self.pipeline_name]
        return run

    def read_or_process(
        self,
        ctx: Context,
    ) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        should_refresh = self.should_refresh_with_logic(ctx)
        if not should_refresh and self.filename is not None:
            try:
                df = self.read(ctx)
                self._cached_result = df
                # If read successfully, we don't need to write (it matches disk).
                assert df is not None, self.filename
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

    def read_list(self, ctx: Context) -> typing.Iterable[Output]:
        df = self.read(ctx)
        assert df is not None, (
            f"Expected to read dataframe for {self.pipeline_name}, but got None"
        )
        return iterate_pipeline(df, self.output_class)

    def read_or_process_list(self, ctx: Context) -> typing.Iterable[Output]:
        return iterate_pipeline(self.read_or_process(ctx), self.output_class)

    # TODO the policy is ignored now
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
            print(f"\n=== Started pipeline {self.pipeline_name} ===")
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

        print(f"=== Finished pipeline {self.pipeline_name} ===\n")
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
            return posixpath.join(self.filename, self.filename + "." + self.format)
        return ""

    @property
    def pipeline_name(self) -> str:
        pipeline_type = type(self)
        return pipeline_type.__name__


def iterate_pipeline_dict(df: pd.DataFrame):
    df = df.replace({np.nan: None})
    for row in df.to_dict(orient="records"):
        records = typing.cast(dict[str, typing.Any], row)
        yield records


def iterate_pipeline[T](
    df: pd.DataFrame, constructor: typing.Type
) -> typing.Iterable[T]:  # TODO join T and constructor
    df = df.replace({np.nan: None})
    for row in df.to_dict(orient="records"):
        records = typing.cast(dict[str, typing.Any], row)
        yield from_dict(
            data_class=constructor,
            data=records,
            # TODO - I don't think we need this, try to remove it.
            config=Config(cast=[int, float, str, bool]),
        )
