# This file registers all conductor pipelines in this package

import argparse
import os

import duckdb
import pandas as pd
from duckdb.typing import VARCHAR  # type: ignore
from tqdm import tqdm

from analysis.interesting import CompaniesMerged
from analysis.people import PeopleMerged
from analysis.stats import Statistics
from scrapers.article.crawler import parse_hostname, uuid7
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import (
    IO,
    CloudStorage,
    Context,
    DataRef,
    DownloadableFile,
    File,
    FirestoreCollection,
    LocalFile,
    Pipeline,
    ProcessPolicy,
)
from scrapers.wiki.process_articles import ProcessWiki
from stores import file
from stores.config import PROJECT_ROOT
from stores.download import FileSource
from stores.duckdb import EntityDumper
from stores.rejestr import Rejestr
from stores.storage import Client as CloudStorageClient
from stores.utils import UtilsImpl
from stores.web import WebImpl


class Conductor(IO):
    def __init__(self, dumper: EntityDumper):
        # TODO reenable self.firestore = FirestoreIO()
        self.dumper = dumper
        self.storage = CloudStorageClient()
        self.progress_bar: tqdm | None = None
        self.continous_download = False

    def read_data(self, fs: DataRef) -> File:
        if isinstance(fs, FirestoreCollection):
            raise NotImplementedError("Firestore reading is not implemented")
            # collection = self.firestore.read_collection(
            #     fs.collection,
            #     stream=fs.stream,
            #     filters=fs.filters,
            # )
            # return file.FromIterable(collection)

        if isinstance(fs, DownloadableFile):
            dfs = FileSource(fs)
            if not dfs.downloaded():
                if self.progress_bar is None or not self.continous_download:
                    self.progress_bar = tqdm(desc="Downloading files")
                    self.continous_download = True
                assert self.progress_bar is not None
                self.progress_bar.update(1)
                dfs.download()
            return file.FromPath(dfs.downloaded_path)

        # Stop progress bar
        self.continous_download = False
        self.progress_bar = None
        # Print what we're reading instead
        print(f"Reading {fs}")

        if isinstance(fs, CloudStorage):
            return file.FromIterable(self.storage.iterate_blobs(self, fs.hostname))

        if isinstance(fs, LocalFile):
            return file.FromPath(os.path.join(PROJECT_ROOT, fs.folder, fs.filename))

        raise NotImplementedError()

    def list_data(self, path: DataRef) -> list[str]:
        if isinstance(path, LocalFile):
            p = os.path.join(PROJECT_ROOT, path.folder, path.filename)
            if os.path.exists(p):
                return [p]
            return []

        raise NotImplementedError()

    def output_entity(self, entity, sort_by=[]):
        self.dumper.insert_into(entity, sort_by)

    def write_dataframe(self, df: pd.DataFrame, filename: str):
        # We assume filename is relative to versioned dir if it doesn't have absolute path
        # The filename passed from Pipeline is "something.jsonl"
        path = os.path.join(PROJECT_ROOT, "versioned", filename)
        df.to_json(path, orient="records", lines=True)

    def upload(self, source, data, content_type):
        self.storage.upload(source, data, content_type)

    def list_blobs(self, hostname: str):
        return self.storage.list_blobs(hostname)


def _setup_context(use_rejestr_io: bool) -> tuple[Context, EntityDumper]:
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
    )

    ctx.con.create_function("parse_hostname", parse_hostname, [VARCHAR], VARCHAR)  # type: ignore
    ctx.con.create_function("uuid7str", uuid7, [], VARCHAR)  # type: ignore

    return ctx, dumper


def info_exception(pipeline_name: str) -> NotImplementedError:
    return NotImplementedError(f"""Removed. Run instead:
$ koryta --only {pipeline_name}
python> from main import run_pipeline
python> run_pipeline({pipeline_name})[1]
""")


# TODO reenable reading from koryta, maybe without firestore
# def scrape_koryta_people():
#     return run_pipeline(KorytaPeople)[1]


def scrape_wiki():
    raise info_exception("ProcessWiki")


def scrape_pkw():
    raise info_exception("PeoplePKW")


def scrape_krs_people():
    raise info_exception("PeopleKRS")


def scrape_krs_companies():
    raise info_exception("CompaniesKRS")


def people_merged():
    raise info_exception("PeopleMerged")


def companies_merged():
    raise info_exception("CompaniesMerged")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", help="Pipeline name to refresh or 'all'", action="append", default=[])
    parser.add_argument("--only", help="Pipeline name to run or 'all'", action="append", default=[])
    args = parser.parse_args()

    ctx, dumper = _setup_context(False)

    pipelines = [
        PeoplePKW,
        PeopleKRS,
        CompaniesKRS,
        ProcessWiki,
        PeopleMerged,
        CompaniesMerged,
        Statistics,
    ]

    policy = ProcessPolicy.with_default(args.refresh, args.only)

    try:
        for p_type in pipelines:
            if not policy.should_run(p_type.__name__):
                continue
            p: Pipeline = Pipeline.create(p_type)
            p.read_or_process(ctx, policy)
        print("Finished processing")
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")
