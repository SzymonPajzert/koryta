import argparse
import io
import os
import typing

import duckdb
from duckdb.typing import VARCHAR  # type: ignore
from tqdm import tqdm

from analysis.extract import Extract
from analysis.interesting import CompaniesMerged
from analysis.people import PeopleEnriched, PeopleMerged
from analysis.stats import Statistics
from scrapers.article.crawler import parse_hostname, uuid7
from scrapers.koryta.differ import KorytaDiffer
from scrapers.koryta.download import KorytaPeople
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.scrape import ScrapeRejestrIO
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import (
    IO,
    CloudStorage,
    Context,
    DataRef,
    DownloadableFile,
    File,
    LocalFile,
    Pipeline,
    ProcessPolicy,
)
from scrapers.teryt import Regions
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.wiki.process_articles_ner import ProcessWikiNer
from stores import file
from stores.config import PROJECT_ROOT
from stores.download import FileSource
from stores.duckdb import EntityDumper
from stores.firestore import FirestoreIO
from stores.nlp import NLPImpl
from stores.rejestr import Rejestr
from stores.storage import Client as CloudStorageClient
from stores.utils import UtilsImpl
from stores.web import WebImpl


class Conductor(IO):
    def __init__(self, dumper: EntityDumper):
        self.firestore = FirestoreIO()
        self.dumper = dumper
        self.storage = CloudStorageClient()
        self.progress_bar: tqdm | None = None
        self.continous_download = False

    def read_data(self, fs: DataRef) -> File:
        if isinstance(fs, DownloadableFile):
            dfs = FileSource(fs)
            if not dfs.downloaded():
                if self.progress_bar is None or not self.continous_download:
                    self.progress_bar = tqdm(desc="Downloading files")
                    self.continous_download = True
                assert self.progress_bar is not None
                self.progress_bar.update(1)
                dfs.download()
            try:
                return file.FromPath(dfs.downloaded_path)
            except UnicodeDecodeError:
                print(f"[ERROR] UnicodeDecodeError, retrying as binary for file {fs}")
                return file.FromPath(dfs.downloaded_path)

        # Stop progress bar
        self.continous_download = False
        self.progress_bar = None
        # Print what we're reading instead
        print(f"Reading {fs}")

        if isinstance(fs, CloudStorage):
            raise NotImplementedError(
                "Use DownloadableFile for CloudStorage reads from list_files"
            )

        if isinstance(fs, LocalFile):
            return file.FromPath(os.path.join(PROJECT_ROOT, fs.folder, fs.filename))

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

    def output_entity(self, entity, sort_by=[]):
        self.dumper.insert_into(entity, sort_by)

    def write_file(
        self, fs: DataRef, content: str | typing.Callable[[io.BufferedWriter], None]
    ):
        # We assume filename is relative to versioned dir
        # If it doesn't have absolute path
        # The filename passed from Pipeline is "something.jsonl"
        if hasattr(fs, "filename"):
            path = os.path.join(PROJECT_ROOT, "versioned", fs.filename)  # type: ignore
        else:
            raise ValueError(f"Cannot write to {fs} - missing filename")
        os.makedirs(os.path.dirname(path), exist_ok=True)

        if isinstance(content, str):
            with open(path, "w") as f:
                f.write(content)
        else:
            with open(path, "wb") as f:
                content(f)

    def upload(self, source, data, content_type):
        self.storage.upload(source, data, content_type)

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


def _setup_context(
    use_rejestr_io: bool, policy: ProcessPolicy = ProcessPolicy.with_default()
) -> tuple[Context, EntityDumper]:
    dumper = EntityDumper()
    conductor = Conductor(dumper)
    rejestr_io = None
    if use_rejestr_io:
        rejestr_io = Rejestr()

    ctx = Context(
        io=conductor,
        rejestr_io=rejestr_io,  # type: ignore
        con=duckdb.connect(),
        utils=UtilsImpl(),
        web=WebImpl(),
        nlp=NLPImpl(),
        refresh_policy=policy,
    )

    ctx.con.create_function("parse_hostname", parse_hostname, [VARCHAR], VARCHAR)  # type: ignore
    ctx.con.create_function("uuid7str", uuid7, [], VARCHAR)  # type: ignore

    return ctx, dumper


PIPELINES = [
    ScrapeRejestrIO,
    KorytaPeople,
    KorytaDiffer,
    PeoplePKW,
    PeopleKRS,
    CompaniesKRS,
    ProcessWiki,
    ProcessWikiNer,
    PeopleMerged,
    PeopleEnriched,
    CompaniesMerged,
    Statistics,
    Extract,
    Regions,
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh",
        help="Pipeline name to refresh, : to exclude or 'all'",
        action="append",
        default=[],
    )
    parser.add_argument("pipeline", help="Pipeline to be run", default=None, nargs="*")
    args, _ = parser.parse_known_args()

    refresh = []
    exclude_refresh = []
    if args.refresh:
        for r in args.refresh:
            if r.startswith(":"):
                exclude_refresh.append(r[1:])
            else:
                refresh.append(r)

    policy = ProcessPolicy.with_default(refresh, exclude_refresh=exclude_refresh)
    ctx, dumper = _setup_context(False, policy)

    no_pipeline = len(args.pipeline) == 0 or args.pipeline is None
    if no_pipeline:
        print("No pipeline specified, will run all")
    pipeline_names = set(pt.__name__ for pt in PIPELINES)
    for p in args.pipeline:
        if p not in pipeline_names:
            print(f"Error: pipeline {p} not found")
            raise ValueError(
                f"Pipeline {p} not found. Available: {' '.join(pipeline_names)}"
            )
        print(f"Will run pipeline: {p}")

    try:
        for p_type in PIPELINES:
            if p_type.__name__ in args.pipeline or no_pipeline:
                print(f"Processing {p_type.__name__}")
                p: Pipeline = Pipeline.create(p_type)
                p.read_or_process(ctx)
        print("Finished processing")
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")
