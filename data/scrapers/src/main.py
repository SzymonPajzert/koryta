# This file registers all conductor pipelines in this package

import os
import duckdb
import inspect

from stores.download import FileSource
from stores.firestore import FirestoreIO
from stores.rejestr import Rejestr
from stores.duckdb import EntityDumper
from stores.storage import Client as CloudStorageClient
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

    def read_data(self, fs: DataRef, process_if_missing=None) -> File:
        print(f"Reading {fs}")
        if process_if_missing is not None:
            raise NotImplementedError()

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
                dfs.download()
            return file.FromPath(dfs.downloaded_path)

        if isinstance(fs, CloudStorage):
            return file.FromIterable(self.storage.iterate_blobs(self, fs.hostname))

        if isinstance(fs, LocalFile):
            return file.FromPath(os.path.join(fs.folder, fs.filename))

        raise NotImplementedError()

    def list_data(self, path: DataRef) -> list[str]:
        if isinstance(path, LocalFile):
            p = os.path.join(path.folder, path.filename)
            if os.path.exists(p):
                return [p]
            return []

        raise NotImplementedError()

    def output_entity(self, entity, sort_by=[]):
        self.dumper.insert_into(entity, sort_by)


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
    )
    set_context(ctx)
    return ctx, dumper


def run_pipeline(
    pipeline_type: type[PipelineModel], ctx: Context | None = None, nested=0
) -> Pipeline:
    pipeline_name = pipeline_type.__name__
    pipeline_model = pipeline_type()

    # TODO restore nester here?
    print(f"{'  ' * nested}====== Running pipeline {pipeline_name} =====")

    for annotation, pipeline_type in pipeline_model.__annotations__.items():
        if pipeline_type is type and issubclass(pipeline_type, PipelineModel):
            print("Initializing", annotation, pipeline_type.__name__)
            pipeline_model.__dict__[annotation] = run_pipeline(
                pipeline_type, ctx, nested + 1
            )

    pipeline = Pipeline(pipeline_model.process, pipeline_model.filename)
    f = setup_pipeline(pipeline, ctx)
    f()
    print(f"{'  ' * nested}====== Finished pipeline {pipeline_name} =====\n\n")
    return pipeline


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
            pipeline_object.process(ctx_var)
            print("Finished processing")
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
    run_pipeline(ProcessWiki)


def scrape_pkw():
    run_pipeline(PeoplePKW)


def scrape_krs_people():
    run_pipeline(PeopleKRS)


def scrape_krs_companies():
    run_pipeline(CompaniesKRS)


def people_merged():
    run_pipeline(PeopleMerged)


def companies_merged():
    run_pipeline(CompaniesMerged)


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
