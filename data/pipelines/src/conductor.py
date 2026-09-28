import collections
import io
import logging
import os
import typing
from concurrent.futures import Future, ThreadPoolExecutor
from functools import cached_property

import duckdb
from duckdb.sqltypes import VARCHAR
from tqdm import tqdm

from scrapers.article.crawler import parse_hostname, uuid7
from scrapers.stores import (
    IO,
    LLM,
    NLP,
    CloudStorage,
    Context,
    ContextResource,
    CrawlQueue,
    DataRef,
    File,
    LocalFile,
    ProcessPolicy,
    RejestrIO,
)
from scrapers.stores.file import (
    DownloadableFile,
    GCSBlob,
    MirrorRef,
    NotInMirrorError,
    VersionedBackup,
)
from stores import file
from stores.config import PROJECT_ROOT
from stores.download import CompressedMirror, FileSource
from stores.duckdb import EntityDumper
from stores.firestore import FirestoreIO
from stores.llm import OpenAICompatibleConfig, OpenAICompatibleMultiPortLLM
from stores.rejestr import Rejestr
from stores.storage import CRAWLED_BUCKET, BatchClient
from stores.storage import Client as CloudStorageClient
from stores.utils import UtilsImpl
from stores.web import WebImpl


class Conductor(IO):
    def __init__(self, dumper: EntityDumper, llm=None, batch_upload=False):
        self.firestore = FirestoreIO()
        self.dumper = dumper
        self.llm = llm
        # Not `batch_upload`, which is already a method on this class.
        self._batch_upload = batch_upload
        self.mirror = CompressedMirror()
        self.progress_bar: tqdm | None = None
        self.continous_download = False

    @cached_property
    def storage(self) -> CloudStorageClient:
        """The GCS client, built on first use.

        Constructing it calls google.auth.default(), so building it eagerly
        made every run need credentials -- including ones that only touch
        public sources, like a wiki-only pass. FirestoreIO is already lazy for
        the same reason.
        """
        return BatchClient() if self._batch_upload else CloudStorageClient()

    def _count_download(self):
        if self.progress_bar is None or not self.continous_download:
            self.progress_bar = tqdm(desc="Downloading files")
            self.continous_download = True
        assert self.progress_bar is not None
        self.progress_bar.update(1)

    def read_data(self, fs: DataRef) -> File:
        if isinstance(fs, DownloadableFile):
            dfs = FileSource(fs)
            if not dfs.downloaded():
                logging.info("Downloading %s", fs.url)
                # Downloads that are skipped here -- a --cache-only miss raises
                # inside download() -- must not count as downloads, so the bar
                # is only touched once the file actually landed.
                dfs.download()
                self._count_download()
            else:
                logging.info("Reading from cache %s", dfs.downloaded_path)
            try:
                return file.FromPath(dfs.downloaded_path)
            except UnicodeDecodeError:
                print(f"[ERROR] UnicodeDecodeError, retrying as binary for file {fs}")
                return file.FromPath(dfs.downloaded_path)

        self.continous_download = False
        self.progress_bar = None
        logging.debug("Reading %s", fs)

        if isinstance(fs, MirrorRef):
            return file.FromBytesIO(self.mirror.get(fs.url), fs.url)

        if isinstance(fs, GCSBlob):
            return self.read_data(
                self.storage.cached_storage(fs.blob_name, binary=True)
            )

        if isinstance(fs, CloudStorage):
            raise NotImplementedError(
                "Use DownloadableFile for CloudStorage reads from list_files"
            )

        if isinstance(fs, LocalFile):
            return file.FromPath(os.path.join(PROJECT_ROOT, fs.folder, fs.filename))

        if isinstance(fs, VersionedBackup):
            data = self.storage.download_backup(fs.filename)
            return file.FromBytesIO(data, fs.filename)

        raise NotImplementedError()

    def list_files(self, path: DataRef) -> typing.Iterable[DataRef]:
        if isinstance(path, LocalFile):
            p = os.path.join(PROJECT_ROOT, path.folder, path.filename)
            if not os.path.exists(p):
                return
            if os.path.isdir(p):
                for root, dirs, files in os.walk(p):
                    for file in files:
                        yield LocalFile(os.path.join(root, file), path.folder)
            elif os.path.isfile(p):
                yield path
        elif isinstance(path, CloudStorage):
            for downloadable_file in self.storage.list_blobs(path):
                yield downloadable_file
        else:
            raise NotImplementedError(
                "list_files not implemented for " + str(type(path))
            )

    def read_many(self, path: DataRef) -> typing.Iterable[tuple[str, File]]:
        if (
            isinstance(path, CloudStorage)
            and path.bucket is None
            and not path.max_namespaces
            and self.mirror.bulk_reads_enabled
        ):
            host = path.prefix.removeprefix("hostname=").split("/")[0]
            try:
                # Resolved before yielding anything: once the caller has taken
                # a single item we can no longer quietly restart on the slow
                # path without handing out duplicates.
                tar_paths = self.mirror._resolve_tar_paths(host)
            except NotInMirrorError:
                logging.info("%s not in the compressed mirror, reading blobs", host)
            else:
                # Named, not counted: the archive filenames carry the dates
                # they cover, and a mirror that has not been rebuilt lately is
                # otherwise a silent hole in the data rather than a slow read.
                print(
                    f"Reading {host} from the compressed mirror: "
                    + ", ".join(p.name for p in tar_paths)
                )
                archived: set[str] = set()
                for name, data in self.mirror.iter_objects(host):
                    # The archive holds the whole host; a narrower prefix
                    # wants only what a listing of it would have returned.
                    if not name.startswith(path.prefix):
                        continue
                    archived.add(name)
                    # Spelled exactly as list_files spells it. Callers parse
                    # these: add_company_source strips the gs:// prefix off to
                    # decide provenance, and silently records the wrong source
                    # rather than failing if it is not there.
                    url = f"gs://{CRAWLED_BUCKET}/{name}"
                    yield url, file.FromBytesIO(data, url)

                # The archive is only as new as its last build, and the bucket
                # has gone on filling since - on 2026-09-28 the newest archive
                # was two months old and missed 21% of rejestr.io and 41% of
                # api-krs. Stopping at the archive silently served the data as
                # it stood on the build date. Everything the listing has that
                # the archive does not is fetched object by object, so the set
                # is the one list_files gives, and only the gap is slow.
                newer = (
                    ref
                    for ref in self.list_files(path)
                    if getattr(ref, "url", "").removeprefix(f"gs://{CRAWLED_BUCKET}/")
                    not in archived
                )
                yield from self._read_each(newer)
                return

        yield from self._read_each(self.list_files(path))

    #: How many objects `_read_each` fetches at once. One GET for a small
    #: object costs about a third of a second, so one at a time a runner
    #: fetches ~3 a second, and the nightly spent its whole two hours on the
    #: first 22k of CompaniesKRS's crawls.
    READ_MANY_WORKERS = 32

    def _read_each(
        self, refs: typing.Iterable[DataRef]
    ) -> typing.Iterable[tuple[str, File]]:
        """read_data on each ref, in order, with the downloads running ahead.

        Only the download is handed to the pool. read_data - and the progress
        bar it keeps - stays on this thread, where it finds the file already
        in the cache. A failed download raises when its turn comes, as it did
        when this was a plain loop.
        """

        def fetch(ref: DataRef) -> bool:
            if not isinstance(ref, DownloadableFile):
                return False
            source = FileSource(ref)
            if source.downloaded():
                return False
            logging.info("Downloading %s", ref.url)
            source.download()
            return True

        # Bounded, so a caller that stops early has not queued the whole
        # prefix, and a failure surfaces while little else is in flight.
        ahead: collections.deque[tuple[DataRef, Future[bool]]] = collections.deque()

        def take() -> tuple[str, File]:
            ref, fetched = ahead.popleft()
            if fetched.result():
                self._count_download()
            return getattr(ref, "url", str(ref)), self.read_data(ref)

        with ThreadPoolExecutor(self.READ_MANY_WORKERS) as pool:
            try:
                for ref in refs:
                    ahead.append((ref, pool.submit(fetch, ref)))
                    if len(ahead) >= 4 * self.READ_MANY_WORKERS:
                        yield take()
                while ahead:
                    yield take()
            finally:
                pool.shutdown(cancel_futures=True)

    def output_entity(self, entity, sort_by=[]):
        try:
            self.dumper.insert_into(entity, sort_by)
        except TypeError as e:
            logging.error(f"Error occurred while outputting entity: {e} {entity}")
            print(entity)
            raise

    def write_file(
        self, fs: DataRef, content: str | typing.Callable[[io.BufferedWriter], None]
    ):
        if isinstance(fs, VersionedBackup):
            self.storage.upload_backup(fs.filename, content)
            return

        # We assume filename is relative to versioned dir
        # If it doesn't have absolute path
        # The filename passed from Pipeline is "something.jsonl"
        if hasattr(fs, "filename"):
            folder = getattr(fs, "folder", None) or "versioned"
            path = os.path.join(PROJECT_ROOT, folder, fs.filename)  # type: ignore
        else:
            raise ValueError(f"Cannot write to {fs} - missing filename")
        os.makedirs(os.path.dirname(path), exist_ok=True)

        if isinstance(content, str):
            with open(path, "w") as f:
                f.write(content)
        else:
            with open(path, "wb") as f:
                content(f)

    def upload(self, source, data, content_type, include_query=False, verbose=True):
        self.storage.upload(
            source, data, content_type, include_query=include_query, verbose=verbose
        )

    def batch_upload(
        self, source, data, content_type, include_query=False, verbose=True
    ) -> str:
        return self.storage.batch_upload(
            source, data, content_type, include_query=include_query, verbose=verbose
        )

    def list_namespaces(self, ref: CloudStorage, namespace: str) -> list[str]:
        return self.storage.list_namespaces(ref, namespace)

    def get_mtime(self, fs: DataRef) -> float | None:
        if isinstance(fs, LocalFile):
            p = os.path.join(PROJECT_ROOT, fs.folder, fs.filename)
            if os.path.exists(p):
                return os.path.getmtime(p)
            return None
        return None

    def get_output(self, entity_type: type) -> list[typing.Any] | None:
        mod = entity_type.__module__.removeprefix("entities.")
        n = mod + "." + entity_type.__name__
        n = n.replace(".", "_")
        return self.dumper.get_output(n)

    def restore_backup_to_path(self, filename: str, dest_path: str) -> None:
        self.storage.restore_backup_to_path(filename, dest_path)

    def upload_backup_from_path(self, filename: str, src_path: str) -> None:
        self.storage.upload_backup_from_path(filename, src_path)


def setup_context(
    requires: typing.Iterable[type[ContextResource]] = (),
    policy: ProcessPolicy | None = None,
    crawl_queue: CrawlQueue | None = None,
    batch_upload: bool = False,
) -> tuple[Context, EntityDumper]:
    """Build the Context, with the clients `requires` names and no others.

    Callers get `requires` from `required_resources` on the pipelines they are
    about to run, so what a run sets up follows from what the pipelines declare
    rather than from a list kept in step by hand.
    """
    required = set(requires)
    if CrawlQueue in required and crawl_queue is None:
        raise ValueError(
            "A selected pipeline requires the crawl queue, which is backed by "
            "postgres and only the crawler CLI opens -- pass crawl_queue= to "
            "setup_context."
        )
    if policy is None:
        policy = ProcessPolicy.with_default()
    dumper = EntityDumper()
    llm = _build_llm() if LLM in required else None
    conductor = Conductor(dumper, llm=llm, batch_upload=batch_upload)
    rejestr_io = None
    if RejestrIO in required:
        print("Initializing RejestrIO as a data source")
        rejestr_io = Rejestr()

    nlp = None
    if NLP in required:
        # We're importing dynamically here
        # to avoid big dependency on spacy
        from stores.nlp import NLPImpl  # noqa: PLC0415

        nlp = NLPImpl()

    ctx = Context(
        io=conductor,
        # Rejestr matches RejestrIO by shape, not by inheritance.
        rejestr_io=rejestr_io,  # type: ignore[arg-type]
        con=duckdb.connect(),
        utils=UtilsImpl(),
        web=WebImpl(),
        crawl_queue=crawl_queue,
        nlp=nlp,
        refresh_policy=policy,
        llm=llm,
    )

    ctx.con.create_function("parse_hostname", parse_hostname, [VARCHAR], VARCHAR)  # type: ignore
    ctx.con.create_function("uuid7str", uuid7, [], VARCHAR)  # type: ignore

    return ctx, dumper


def _build_llm() -> OpenAICompatibleMultiPortLLM:
    """Build the shared LLM client from the article pipelines' CLI flags.

    The config lives with the pipelines (scrapers layer); the concrete client is
    constructed here because scrapers must not import stores.llm directly.
    """
    from scrapers.article.pipelines import pipeline_utils as a  # noqa: PLC0415

    return OpenAICompatibleMultiPortLLM(
        OpenAICompatibleConfig(
            model=a.llm_model(),
            ports=tuple(a.llm_ports() or list(range(6000, 6016))),
            per_port_concurrency=a.llm_per_port_concurrency(),
            request_timeout_seconds=a.llm_request_timeout_seconds(),
            base_url=a.llm_base_url(),
            api_key=(
                a.llm_api_key()
                or os.environ.get("OPENROUTER_APIKEY")
                or os.environ.get("OPENAI_API_KEY")
            ),
        )
    )


def make_reader_conductor() -> Conductor:
    return Conductor(EntityDumper())
