# This file registers all conductor pipelines in this package

from scrapers.stores import Context
from scrapers.koryta.download import process_people as scrape_koryta_people_func
from scrapers.wiki.process_articles import scrape_wiki as scrape_wiki_func
from scrapers.pkw.process import main as scrape_pkw_func


from stores.download import FileSource
from stores.firestore import FirestoreIO
from stores.rejestr import Rejestr
from stores.duckdb import EntityDumper

import stores.file as file


from scrapers.stores import IO, File, DataRef, Pipeline, set_context
from scrapers.stores import FirestoreCollection
from scrapers.stores import DownloadableFile


class Conductor(IO):
    def __init__(self, dumper: EntityDumper):
        # TODO We should probably know what to register here
        # So currently, let's just instantiate everything
        self.firestore = FirestoreIO()
        self.dumper = dumper

    def read_data(self, fs: DataRef, process_if_missing=None) -> File:
        print(f"Reading {fs}")
        if process_if_missing is not None:
            raise NotImplementedError()

        if isinstance(fs, FirestoreCollection):
            collection = self.firestore.read_collection(
                fs.collection,
                stream=fs.stream,
                filters=fs.filters,
            )
            return file.FromIterable(collection)

        if isinstance(fs, DownloadableFile):
            dfs = FileSource(fs)
            if not dfs.downloaded():
                dfs.download()
            return file.FromPath(dfs.downloaded_path)

        raise NotImplementedError()

    def list_data(self, path: DataRef) -> list[str]:
        raise NotImplementedError()

    def output_entity(self, entity):
        self.dumper.insert_into(entity)


def setup_pipeline(pipeline_object: Pipeline):
    def func():
        dumper = EntityDumper()
        conductor = Conductor(dumper)
        rejestr_io = None
        if pipeline_object.rejestr_io:
            rejestr_io = Rejestr()

        ctx = Context(
            io=conductor,
            rejestr_io=rejestr_io,  # type: ignore
        )
        set_context(ctx)
        try:
            pipeline_object.process(ctx)
            print("Finished processing")
        finally:
            print("Dumping...")
            dumper.dump_pandas()
            print("Done")

    return func


def scrape_koryta_people():
    f = setup_pipeline(scrape_koryta_people_func)
    f()


def scrape_wiki():
    f = setup_pipeline(scrape_wiki_func)
    f()


def scrape_pkw():
    f = setup_pipeline(scrape_pkw_func)
    f()
