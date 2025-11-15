"""This file contains abstract definition of store functionality, to use in the scrapers"""

from dataclasses import dataclass
from abc import ABC, abstractmethod


class Enterable(ABC):
    @abstractmethod
    def __enter__(self):
        pass

    @abstractmethod
    def __exit__(self, exc_type, exc_value, traceback):
        pass


class ZipReader(ABC):
    # import bz2
    # with bz2.open(DUMP_FILENAME, "rt", encoding="utf-8") as f:
    @abstractmethod
    def open(self, filename: str, mode: str, encoding: str) -> Enterable:
        pass


@dataclass
class Context:
    zip_reader: ZipReader


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
