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
from scrapers.wiki.process_articles import scrape_wiki as scrape_wiki_func
from scrapers.pkw.process import main as scrape_pkw_func
from scrapers.krs.list import extract_people as scrape_krs_people_func
from scrapers.krs.list import CompaniesKRS
from analysis.people import people_merged as people_merged_func


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


def create_model(pipeline_model: PipelineModel) -> Pipeline:
    for annotation, pipeline_type in pipeline_model.__annotations__.items():
        if issubclass(pipeline_type, PipelineModel):
            print(annotation, pipeline_type)
            pipeline_model.__dict__[annotation] = pipeline_type()

    return Pipeline(pipeline_model.process)


def setup_pipeline(pipeline_object: Pipeline):
    def func():
        ctx, dumper = setup_context(pipeline_object.rejestr_io)
        try:
            pipeline_object.process(ctx)
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
    f = setup_pipeline(scrape_wiki_func)
    f()


def scrape_pkw():
    f = setup_pipeline(scrape_pkw_func)
    f()


def scrape_krs_people():
    f = setup_pipeline(scrape_krs_people_func)
    f()


def scrape_krs_companies():
    ctx, dumper = setup_context(False)
    pipeline = create_model(CompaniesKRS())
    f = setup_pipeline(pipeline)
    f()


def people_merged():
    f = setup_pipeline(people_merged_func)
    f()


def main():
    ctx, dumper = setup_context(False)

    try:
        scrape_wiki_func.process(ctx)
        scrape_pkw_func.process(ctx)
        scrape_krs_people_func.process(ctx)
        create_model(CompaniesKRS()).process(ctx)
        people_merged_func.process(ctx)
        print("Finished processing")
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")
