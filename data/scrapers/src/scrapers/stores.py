"""This file contains abstract definition of store functionality, to use in the scrapers"""

from typing import Any
from dataclasses import dataclass
from abc import ABC, abstractmethod


class Enterable(ABC):
    @abstractmethod
    def __enter__(self):
        pass

    @abstractmethod
    def __exit__(self, exc_type, exc_value, traceback):
        pass


class File(ABC):
    @abstractmethod
    def read_jsonl(self):
        pass

    @abstractmethod
    def read_csv(self):
        pass

    @abstractmethod
    def read_excel(self):
        pass

    @abstractmethod
    def read_parquet(self):
        pass


class ZipReader(ABC):
    # import bz2
    # with bz2.open(DUMP_FILENAME, "rt", encoding="utf-8") as f:
    @abstractmethod
    def open(
        self,
        filename: str,
        mode: str,
        encoding: str | None = None,
        subfile: str | None = None,
    ) -> Enterable:
        pass


@dataclass
class VersionedFile:
    filename: str


# TODO maybe even to entities?
@dataclass
class DownloadableFile:
    """
    It corresponds to stores.download.FileSource which executes its configuration
    """

    url: str
    filename: str | None = None
    complex_download: str | None = None


class Conductor(ABC):
    """
    Conductor manages relations between pipelines
    """

    @abstractmethod
    def check_input(self, input: Any):  # TODO type this better
        pass

    @abstractmethod
    def list_files(self, path: str) -> list[str]:
        pass

    @abstractmethod
    def get_path(self, fs: FileSource) -> str:
        pass

    @abstractmethod
    def read_file(self, fs: FileSource) -> File:
        pass


class RejestIO(ABC):
    @abstractmethod
    def get_rejestr_io(self, url: str) -> str | None:
        pass


@dataclass
class Context:
    zip_reader: ZipReader
    conductor: Conductor
    rejestr_io: RejestIO


def get_context() -> Context:
    raise NotImplementedError()


def insert_into(v):
    raise NotImplementedError


def always_export(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        finally:
            dump_dbs()

    return wrapper


def dump_dbs(tables_to_dump: None | dict[str, list[str]] = None):
    raise NotImplementedError()
