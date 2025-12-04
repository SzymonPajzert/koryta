# This file registers all conductor pipelines in this package

import os
import duckdb
from tqdm import tqdm
import pandas as pd

from stores.download import FileSource
from stores.rejestr import Rejestr
from stores.duckdb import EntityDumper
from stores.storage import Client as CloudStorageClient
from stores.config import PROJECT_ROOT
import stores.file as file

from scrapers.stores import (
    IO,
    File,
    DataRef,
    LocalFile,
    set_context,
    FirestoreCollection,
    Pipeline,
    DownloadableFile,
    CloudStorage,
)

from scrapers.stores import Context, Pipeline, PipelineModel
from scrapers.koryta.download import process_people as scrape_koryta_people_func
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.pkw.process import PeoplePKW
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from analysis.people import PeopleMerged
from analysis.interesting import CompaniesMerged


class Conductor(IO):
    def __init__(self, dumper: EntityDumper):
        # TODO reenable self.firestore = FirestoreIO()
        self.dumper = dumper
        self.storage = CloudStorageClient()
        self.progress_bar = None
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


from stores.utils import UtilsImpl
from stores.web import WebImpl

def setup_context(use_rejestr_io: bool):
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
    
    # Register DuckDB functions
    from scrapers.article.crawler import parse_hostname, uuid7
    from duckdb.typing import VARCHAR
    ctx.con.create_function("parse_hostname", parse_hostname, [VARCHAR], VARCHAR)
    ctx.con.create_function("uuid7str", uuid7, [], VARCHAR)

    set_context(ctx)
    return ctx, dumper


def create_model(model: PipelineModel) -> Pipeline:
    return Pipeline(model.process, model.filename)


def run_pipeline(
    pipeline_type: type[PipelineModel], ctx: Context | None = None, nested=0
) -> tuple[Pipeline, pd.DataFrame]:
    pipeline_name = pipeline_type.__name__
    pipeline_model = pipeline_type()

    # TODO restore nester here?
    print(f"{'  ' * nested}====== Running pipeline {pipeline_name} =====")

    for annotation, pipeline_type in pipeline_model.__annotations__.items():
        if isinstance(pipeline_type, type) and issubclass(pipeline_type, PipelineModel):
            print("Initializing", annotation, pipeline_type.__name__)
            pipeline_model.__dict__[annotation], _ = run_pipeline(
                pipeline_type, ctx, nested + 1
            )
    print("Finished initialization")

    pipeline = Pipeline(pipeline_model.process, pipeline_model.filename)
    f = setup_pipeline(pipeline, ctx)
    df = f()
    print(f"{'  ' * nested}====== Finished pipeline {pipeline_name} =====\n\n")
    return pipeline, df


def setup_pipeline(pipeline_object: Pipeline, ctx: Context | None = None):
    def func():
        ctx_var = ctx
        if ctx_var is None:
            ctx_var, dumper = setup_context(pipeline_object.rejestr_io)
        else:
            dumper = (  # TODO fix it
                ctx_var.io.dumper  # pyright: ignore[reportAttributeAccessIssue]
            )
        try:
            result = pipeline_object.process(ctx_var)
            print("Finished processing")
            return result
        finally:
            print("Dumping...")
            dumper.dump_pandas()
            print("Done")

    return func


# TODO reenable reading from koryta, maybe without firestore
# def scrape_koryta_people():
#     f = setup_pipeline(scrape_koryta_people_func)
#     f()


def scrape_wiki():
    return run_pipeline(ProcessWiki)[1]


def scrape_pkw():
    return run_pipeline(PeoplePKW)[1]


def scrape_krs_people():
    return run_pipeline(PeopleKRS)[1]


def scrape_krs_companies():
    return run_pipeline(CompaniesKRS)[1]


def people_merged():
    return run_pipeline(PeopleMerged)[1]


def companies_merged():
    return run_pipeline(CompaniesMerged)[1]


def main():
    ctx, dumper = setup_context(False)

    try:
        run_pipeline(ProcessWiki, ctx)
        run_pipeline(PeoplePKW, ctx)
        run_pipeline(PeopleKRS, ctx)
        run_pipeline(CompaniesKRS, ctx)
        run_pipeline(PeopleMerged, ctx)
        run_pipeline(CompaniesMerged, ctx)
        print("Finished processing")
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")

