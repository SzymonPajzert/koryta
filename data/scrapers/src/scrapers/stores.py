"""This file contains abstract definition of store functionality, to use in the scrapers"""

import typing
from typing import Any
from dataclasses import dataclass, field
from abc import ABCMeta, abstractmethod


class Extractor(metaclass=ABCMeta):
    @abstractmethod
    def read(self, file_path):
        raise NotImplementedError()

    @abstractmethod
    def read_bytes(self, raw_bytes):
        raise NotImplementedError()


class File(metaclass=ABCMeta):
    @abstractmethod
    def read_iterable(self) -> typing.Iterable:
        raise NotImplementedError()

    @abstractmethod
    def read_jsonl(self):
        raise NotImplementedError()

    @abstractmethod
    def read_csv(self, sep=","):
        raise NotImplementedError()

    @abstractmethod
    def read_excel(self):
        raise NotImplementedError()

    @abstractmethod
    def read_parquet(self):
        raise NotImplementedError()

    @abstractmethod
    def read_zip(self, inner_path: str | None = None) -> "File":
        raise NotImplementedError()

    @abstractmethod
    def read_file(self) -> typing.BinaryIO | typing.TextIO:
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


class DataRef(metaclass=ABCMeta):
    pass


@dataclass
class FirestoreCollection(DataRef):
    collection: str
    stream: bool = True
    filters: list[tuple[str, str, Any]] = field(default_factory=list)


@dataclass
class LocalFile(DataRef):
    filename: str


@dataclass
class VersionedFile(DataRef):
    filename: str


# TODO maybe even to entities?
@dataclass
class DownloadableFile(DataRef):
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


"""
Just a note of difference between Conductor and IO, because it can be a bit
confusing or is currently badly designed:

Conductor takes care of the dependence and processing.
    If you ask for an input, it will reprocess necessary data to get it.
    It 


"""


class IO(metaclass=ABCMeta):
    @abstractmethod
    def read_data(self, fs: DataRef, process_if_missing=True) -> File:
        raise NotImplementedError()

    @abstractmethod
    def list_data(self, path: DataRef) -> list[str]:
        raise NotImplementedError()

    @abstractmethod
    def output_entity(self, entity):
        """
        Write a single entity of the core type to the specified output.
        """
        raise NotImplementedError()


class RejestrIO(metaclass=ABCMeta):
    @abstractmethod
    def get_rejestr_io(self, url: str) -> str | None:
        raise NotImplementedError()


@dataclass
class Context:
    io: IO
    rejestr_io: RejestrIO


GLOBAL_CONTEXT: None | Context = None


def set_context(ctx: Context):
    global GLOBAL_CONTEXT
    GLOBAL_CONTEXT = ctx


def get_context() -> Context:
    global GLOBAL_CONTEXT

    if not GLOBAL_CONTEXT:
        raise NotImplementedError(
            "This pipeline needs to be migrated to the @Pipeline wrapper"
        )

    return GLOBAL_CONTEXT


# pipeline decorator
class Pipeline:
    def __init__(
        self, output_order: dict[str, list[str]] = {}, use_rejestr_io=False, **kwargs
    ):
        """
        :param: output_order - specifies order in the produced collection
        """
        # TODO implement it
        self.output_order = output_order
        self.rejestr_io = use_rejestr_io
        # TODO clean it up
        if len(kwargs) > 0:
            print(f"Unknown kwargs: {kwargs}")

    def __call__(self, func):
        self.process = func
        return self
