"""This file contains abstract definition of store functionality, to use in the scrapers"""

import typing
from typing import Any
from dataclasses import dataclass
from abc import ABCMeta, ABC, abstractmethod


class Enterable(metaclass=ABCMeta):
    @abstractmethod
    def __enter__(self):
        raise NotImplementedError()

    @abstractmethod
    def __exit__(self, exc_type, exc_value, traceback):
        raise NotImplementedError()


class Extractor(metaclass=ABCMeta):
    @abstractmethod
    def read(self, file_path):
        raise NotImplementedError()

    @abstractmethod
    def read_bytes(self, raw_bytes):
        raise NotImplementedError()


class File(metaclass=ABCMeta):
    @abstractmethod
    def read_jsonl(self):
        raise NotImplementedError()

    @abstractmethod
    def read_csv(self):
        raise NotImplementedError()

    @abstractmethod
    def read_excel(self):
        raise NotImplementedError()

    @abstractmethod
    def read_parquet(self):
        raise NotImplementedError()

    def read_zip(self, path: str | None = None):
        raise NotImplementedError()


class ZipReader(metaclass=ABCMeta):
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
        raise NotImplementedError()


class Filename(metaclass=ABCMeta):
    pass


@dataclass
class LocalFile(Filename):
    filename: str


@dataclass
class VersionedFile(Filename):
    filename: str


# TODO maybe even to entities?
@dataclass
class DownloadableFile(Filename):
    """
    It corresponds to stores.download.FileSource which executes its configuration
    """

    url: str
    filename_fallback: str | None = None
    complex_download: str | None = None

    @property
    def filename(self):
        if self.filename_fallback is not None:
            return self.filename_fallback
        return self.url.split("/")[-1]


class Conductor(metaclass=ABCMeta):
    """
    Conductor manages relations between pipelines
    """

    @abstractmethod
    def check_input(self, input: Any):  # TODO type this better
        raise NotImplementedError()

    @abstractmethod
    def list_files(self, path: str) -> list[str]:
        raise NotImplementedError()

    @abstractmethod
    def get_path(self, fs: Filename) -> str:
        raise NotImplementedError()

    @abstractmethod
    def read_file(self, fs: Filename) -> File:
        raise NotImplementedError()


class RejestIO(metaclass=ABCMeta):
    @abstractmethod
    def get_rejestr_io(self, url: str) -> str | None:
        raise NotImplementedError()


class IO(metaclass=ABCMeta):
    @abstractmethod
    def read_collection(
        self, collection: str, stream=False, filters: list[tuple[str, str, Any]] = []
    ) -> typing.Iterator:
        raise NotImplementedError()

    @abstractmethod
    def dump_memory(self, tables_to_dump: None | dict[str, list[str]] = None):
        raise NotImplementedError()

    @abstractmethod
    def output_entity(self, entity):
        raise NotImplementedError()


@dataclass
class Context:
    conductor: Conductor
    io: IO
    rejestr_io: RejestIO


def get_context() -> Context:
    raise NotImplementedError()


def insert_into(v):
    raise NotImplementedError()


def always_export(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        finally:
            ctx = get_context()
            ctx.io.dump_memory()

    return wrapper


# pipeline decorator
class Pipeline:
    def __init__(self, io: str | None = None):
        """
        :param: io - specifies the input type of the io to be run in the pipeline
        """
        self.io = io

    def __call__(self, func):
        self.process = func
        return self
