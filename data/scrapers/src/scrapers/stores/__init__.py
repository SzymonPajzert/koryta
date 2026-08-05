"""
This file contains abstract definitions for storage and I/O functionalities,
to be used across all scrapers. It provides a common interface for handling
file operations, data references, and pipeline execution contexts.
"""

import io
import os
import posixpath
import typing
from abc import ABCMeta, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Callable, List, NewType, Union, overload

import numpy as np
import pandas as pd
from dacite import Config, from_dict  # type: ignore[import-not-found]

from entities.ner import NEREntities
from scrapers.stores.file import (
    CloudStorage,
    DataRef,
    File,
    Formats,
    LocalFile,
    VersionedBackup,
)
from stores.config import DOWNLOADED_DIR as DOWNLOADED_DIR
from stores.config import VERSIONED_DIR as VERSIONED_DIR
from stores.config import backup_disabled

if TYPE_CHECKING:
    from duckdb import DuckDBPyConnection

Priority = NewType("Priority", int)


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
    def read_many(self, path: DataRef) -> typing.Iterable[tuple[str, File]]:
        """Yields (object name, contents) for everything under a prefix.

        The same set as list_files followed by read_data on each, but free to
        get there another way. Reach for this over the pair whenever the whole
        prefix is wanted: a host with a compressed snapshot is served from one
        archive rather than one request per object, which for rejestr.io is an
        18 MB download against 29k of them.
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

    @abstractmethod
    def restore_backup_to_path(self, filename: str, dest_path: str) -> None:
        """Streams the latest versioned backup for a filename to a local path."""
        raise NotImplementedError()

    @abstractmethod
    def upload_backup_from_path(self, filename: str, src_path: str) -> None:
        """Uploads a local file as a versioned backup for a filename."""
        raise NotImplementedError()


class ContextResource(metaclass=ABCMeta):
    """A client the Context only carries when some pipeline asked for it.

    A pipeline declares what it needs the same way it declares its sources --
    by annotating it on the class:

        class ArticleDomainSelectors(Pipeline):
            done_urls: ArticleDoneUrls   # a source
            llm: LLM                     # a client on the Context

    The runner reads those declarations (see `required_resources`, which walks
    the sources too) and builds only the clients the selected pipelines can
    actually reach. That is what keeps a wiki-only pass from needing an LLM
    backend, or a parse-only pass from paying for rejestr.io.

    Reach for the client through `LLM.from_context(ctx)` rather than `ctx.llm`:
    it is typed non-optional, and it names the missing declaration when a
    pipeline reaches for a client it never asked for.
    """

    # The Context field this resource is passed as.
    context_attr: typing.ClassVar[str]

    @classmethod
    def from_context(cls, ctx: "Context") -> typing.Self:
        """This client off `ctx`, or a MissingResourceError naming it."""
        value = getattr(ctx, cls.context_attr, None)
        if value is None:
            raise MissingResourceError(cls)
        return typing.cast(typing.Self, value)


class MissingResourceError(RuntimeError):
    """A pipeline reached for a client the Context was not built with."""

    def __init__(self, resource: type[ContextResource]) -> None:
        super().__init__(
            f"{resource.__name__} is not set up on this Context. Annotate the "
            f"pipeline that needs it with "
            f"`{resource.context_attr}: {resource.__name__}`, so the runner "
            f"builds the client before the run starts."
        )
        self.resource = resource


class RejestrIO(ContextResource, metaclass=ABCMeta):
    """Abstract interface for interacting with the rejestr.io API."""

    context_attr = "rejestr_io"

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


class NLP(ContextResource, metaclass=ABCMeta):
    """Abstract interface for NLP toolkit"""

    context_attr = "nlp"

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
    enable_thinking: bool = False


@dataclass(frozen=True)
class LLMResponse:
    content: str
    port: int | None = None
    model: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLMResponsePool(metaclass=ABCMeta):
    """Bounded async request/response pool for long-running LLM pipelines."""

    @abstractmethod
    async def __aenter__(self) -> "LLMResponsePool":
        raise NotImplementedError()

    @abstractmethod
    async def __aexit__(self, exc_type, exc, traceback) -> None:
        raise NotImplementedError()

    @abstractmethod
    def is_full(self) -> bool:
        """Return True when the pool cannot accept more outstanding requests."""
        raise NotImplementedError()

    @abstractmethod
    async def put_request(self, request: LLMRequest) -> int:
        """Submit a request and return its response id."""
        raise NotImplementedError()

    @abstractmethod
    async def get_response(self) -> tuple[int, LLMResponse | Exception]:
        """Return the next completed response by id."""
        raise NotImplementedError()


class LLM(ContextResource, metaclass=ABCMeta):
    """Abstract interface for OpenAI-compatible chat completion clients."""

    context_attr = "llm"

    @abstractmethod
    def response_pool(self) -> LLMResponsePool:
        """Create a bounded request/response pool."""
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


class CrawlQueue(ContextResource, metaclass=ABCMeta):
    """Abstract interface for crawler URL queue."""

    context_attr = "crawl_queue"

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
    # Override backup_to_shared_cache=False: force a shared-cache restore even
    # for local-only pipelines. Still disabled by --no-backup/DISABLE_BACKUP.
    force_download_shared_cache: bool = False
    # Override backup_to_shared_cache=False: force a shared-cache upload even
    # for local-only pipelines. Still disabled by --no-backup/DISABLE_BACKUP.
    force_upload_shared_cache: bool = False

    execution_decisions: dict[str, tuple[bool, str]] = field(default_factory=dict)
    tree_printed: bool = False

    @staticmethod
    def with_default(
        refresh: list[str] = [],
        exclude_refresh: list[str] = [],
        force_download_shared_cache: bool = False,
        force_upload_shared_cache: bool = False,
    ):
        refresh_pipelines = set() if len(refresh) == 0 else set(refresh)
        exclude_refresh_set = set(exclude_refresh)
        return ProcessPolicy(
            refresh_pipelines,
            exclude_refresh_set,
            force_download_shared_cache=force_download_shared_cache,
            force_upload_shared_cache=force_upload_shared_cache,
        )

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
                        if (
                            dep_run
                            and pipeline.pipeline_name not in self.exclude_refresh
                        ):
                            decision = (
                                True,
                                f"dependency {dep.pipeline_name} refreshed",
                            )
                            break

                        if pipeline.pipeline_name in self.exclude_refresh:
                            continue
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
    # The ContextResource fields are None unless a pipeline declared them --
    # reach for them through `from_context`, not directly.
    rejestr_io: RejestrIO | None
    con: "DuckDBPyConnection"
    utils: Utils
    web: Web
    nlp: NLP | None
    crawl_queue: CrawlQueue | None = None
    refresh_policy: ProcessPolicy = field(default_factory=ProcessPolicy.with_default)
    llm: LLM | None = None


Output = typing.TypeVar("Output")


def _annotated_classes(pipeline_type: type) -> typing.Iterable[tuple[str, type]]:
    """(name, class) for every annotation on the pipeline that names a class.

    Base classes included: `pipeline_type.__annotations__` would only see the
    most derived class that has any, silently dropping the sources and clients
    a base pipeline declared.
    """
    merged: dict[str, Any] = {}
    for klass in reversed(pipeline_type.__mro__):
        merged.update(klass.__dict__.get("__annotations__", {}))
    for annotation, annotated in merged.items():
        if isinstance(annotated, type):
            yield annotation, annotated


def required_resources(pipeline_type: type) -> set[type[ContextResource]]:
    """The clients a run of this pipeline needs, its sources' included.

    Transitive, because read_or_process runs a stale source before reading it:
    ArticleAnalyzed never touches the LLM itself, but it cannot run without one
    unless every pipeline under it is already up to date.
    """
    resources: set[type[ContextResource]] = set()
    seen: set[type] = set()

    def walk(p_type: type) -> None:
        if p_type in seen:
            return
        seen.add(p_type)
        for _, annotated in _annotated_classes(p_type):
            if issubclass(annotated, ContextResource):
                resources.add(annotated)
            elif issubclass(annotated, Pipeline):
                walk(annotated)

    walk(pipeline_type)
    return resources


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
    # Whether this pipeline's output participates in the shared GCS cache
    # (uploaded on write, restored on read). Set False for large/incremental
    # outputs that would flood the shared bucket — they stay local-only while
    # still using local caching + refresh logic.
    backup_to_shared_cache: bool = True

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
        """Attempts to read the output of the pipeline from storage (local or bucket).

        Raises FileNotFoundError if not found."""
        assert self.filename
        filenotfound: Exception | None = None
        try:
            return ctx.io.read_data(
                LocalFile(self.output_path(), "versioned")
            ).read_dataframe(self.format, dtype=self.dtype)
        except FileNotFoundError as e:
            print("File doesn't exist, continuing: ", e)
            filenotfound = e

        if self.backup_to_shared_cache and not backup_disabled():
            try:
                return ctx.io.read_data(VersionedBackup(self.filename)).read_dataframe(
                    self.format, dtype=self.dtype
                )
            except Exception as e:
                print("Versioned backup read failed, continuing: ", e)
                filenotfound = e

        # If there was any exception, raise the last one
        if filenotfound is not None:
            raise filenotfound
        return None

    def output_time(self, ctx: Context):
        self_ref = LocalFile(self.output_path(), "versioned") if self.filename else None
        return ctx.io.get_mtime(self_ref) if self_ref else None

    @staticmethod
    def confirm_if_big(func):
        def wrapper(self, ctx: Context):
            result = func(self, ctx)
            if result and self.confirm_run:
                answer = ctx.utils.input_with_timeout(
                    f"Pipeline {type(self).__name__} runs long. \
Should I run it? (y/n) [n]",
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
        elif should_refresh and self.filename is not None:
            # When the local output is missing (not an explicit policy refresh),
            # try reading from backup before re-processing, unless backups are
            # disabled (then recompute from source instead of restoring stale data).
            decision = ctx.refresh_policy.execution_decisions.get(self.pipeline_name)
            if (
                decision
                and decision[1] == "missing output"
                and self._shared_cache_active(ctx, force_download=True)
            ):
                try:
                    df = ctx.io.read_data(
                        VersionedBackup(self.filename)
                    ).read_dataframe(self.format, dtype=self.dtype)
                    if df is not None:
                        self._cached_result = df
                        # Save locally so the next run finds the file on disk.
                        print(
                            f"Restored {self.pipeline_name} from versioned backup, "
                            f"saving to {self.output_path()}"
                        )
                        self.write_dataframe(ctx, df, local_only=True)
                        return df
                except Exception as e:
                    print(
                        f"Backup read failed for {self.pipeline_name}, "
                        f"will re-process: {e}"
                    )

        df = self.run_pipeline(ctx, ctx.refresh_policy)

        if df is not None and self.output_path != "":
            print(f"Writing to {self.output_path()}")
            self.write_dataframe(ctx, df)

        if df is not None:
            ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
            self._cached_result = df

        return df

    def write_dataframe(
        self,
        ctx: Context,
        df: pd.DataFrame,
        filename: str | None = None,
        format: Formats | None = None,
        local_only: bool = False,
    ):
        """Writes a DataFrame to storage.

        Args:
            local_only: If True, only writes to the local versioned path
                and skips the GCS backup upload.
        """
        if filename is None:
            filename = self.filename
        if format is None:
            format = self.format

        if filename is None:
            return

        def writer(f: io.BufferedWriter):
            match format:
                case "jsonl":
                    df.to_json(f, orient="records", lines=True)
                case "csv":
                    df.to_csv(f, index=False)
                case _:
                    raise ValueError(f"Not supported export format - {self.format}")

        ctx.io.write_file(
            LocalFile(self.output_path(filename, format), "versioned"), writer
        )
        if not local_only and self._shared_cache_active(
            ctx, force_upload=True
        ):
            ctx.io.write_file(VersionedBackup(filename), writer)

    def _shared_cache_active(
        self, ctx: Context, force_download: bool = False, force_upload: bool = False
    ) -> bool:
        """Whether this pipeline's output should go through the shared cache.

        A pipeline is shared-cache enabled when backups are not disabled AND it
        opts in via backup_to_shared_cache OR the corresponding force flag is
        set. Callers set exactly one of force_download/force_upload to name the
        direction; only that direction's flag applies.
        """
        if backup_disabled():
            return False
        if self.backup_to_shared_cache:
            return True
        if force_download:
            return ctx.refresh_policy.force_download_shared_cache
        if force_upload:
            return ctx.refresh_policy.force_upload_shared_cache
        return False

    def restore_output_from_shared_cache(self, ctx: Context) -> bool:
        """Restore this pipeline's local output from the shared GCS cache.

        Streams the latest backup for ``filename`` to the local output path, so
        it is safe for multi-GB outputs. Returns True when a restore happened,
        False otherwise (flag disabled, backup missing, or failure).

        The incremental article pipelines reuse this hook on their read path --
        it is what lets them pick up cached outputs instead of re-processing.
        """
        if (
            self.filename is None
            or not self._shared_cache_active(ctx, force_download=True)
        ):
            return False

        dest_path = os.path.join(VERSIONED_DIR, self.output_path())
        try:
            ctx.io.restore_backup_to_path(self.filename, dest_path)
        except Exception as e:
            print(
                f"Restore from shared cache failed for {self.pipeline_name}, "
                f"will re-process: {e}"
            )
            return False

        print(
            f"Restored {self.pipeline_name} from shared cache, "
            f"saving to {dest_path}"
        )
        return True

    def upload_output_to_shared_cache(self, ctx: Context) -> bool:
        """Upload this pipeline's local output to the shared GCS cache.

        Streams the local file at the output path into the latest backup slot
        for ``filename``. No-op unless backup_to_shared_cache is set or the
        force-upload flag is on, and backups are not disabled. Returns True
        when an upload happened.

        The incremental article pipelines reuse this hook on their write path --
        they never go through write_dataframe, so this is where their outputs
        reach the shared cache.
        """
        if (
            self.filename is None
            or not self._shared_cache_active(ctx, force_upload=True)
        ):
            return False

        src_path = os.path.join(VERSIONED_DIR, self.output_path())
        if not os.path.exists(src_path):
            print(
                f"Upload to shared cache skipped for {self.pipeline_name}: "
                f"{src_path} does not exist"
            )
            return False

        ctx.io.upload_backup_from_path(self.filename, src_path)
        return True

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
            try:
                dep.read_or_process(ctx)
            except Exception as e:
                print(f"Dependency {dep.pipeline_name} failed: {e}")
                raise e
            if dep._refreshed_execution:
                any_refreshed = True
        return any_refreshed

    def run_pipeline(
        self,
        ctx: Context,
        policy: ProcessPolicy,
    ) -> pd.DataFrame:
        self.bind_requirements(ctx)
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
        for annotation, annotated in _annotated_classes(type(self)):
            if issubclass(annotated, Pipeline):
                yield annotation, annotated

    def list_requirements(self) -> typing.Iterable[tuple[str, type[ContextResource]]]:
        """The clients this pipeline declares, without its sources'.

        `required_resources` is the one the runner wants -- this is only what
        this class itself will reach for through `from_context`.
        """
        for annotation, annotated in _annotated_classes(type(self)):
            if issubclass(annotated, ContextResource):
                yield annotation, annotated

    def bind_requirements(self, ctx: Context) -> None:
        """Put the declared clients on the instance, as __init__ does sources.

        Raises before any work is done when one is missing, which is worth
        doing up front: these pipelines spend minutes loading their inputs
        before the first request, and a run that dies then has thrown that
        away.
        """
        for annotation, resource in self.list_requirements():
            self.__dict__[annotation] = resource.from_context(ctx)

    def output_path(
        self, filename: str | None = None, format: Formats | None = None
    ) -> str:
        if filename is None:
            filename = self.filename
        if format is None:
            format = self.format

        if filename is not None:
            return posixpath.join(filename, filename + "." + format)
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
