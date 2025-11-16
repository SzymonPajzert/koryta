import io
import csv
import typing
from typing import BinaryIO, TextIO

from zipfile import ZipFile
import bz2
import pandas as pd

from scrapers.stores import File


class FromIterable(File):
    def __init__(self, iterable: typing.Iterable):
        self.iterable = iterable

    def read_iterable(self):
        return self.iterable

    def read_jsonl(self):
        raise NotImplementedError()

    def read_csv(self, sep=","):
        return csv.reader(self.iterable, delimiter=sep)

    def read_excel(self):
        raise NotImplementedError()

    def read_parquet(self):
        raise NotImplementedError()

    def read_zip(self, inner_path: str | None = None):
        raise NotImplementedError()

    def read_file(self):
        raise NotImplementedError()


class FromTextIO(FromIterable):
    def __init__(self, wrapper: io.TextIOWrapper):
        self._wrapper = wrapper

        def generator():
            for line in self._wrapper:
                yield line

        super().__init__(generator())

    def close(self):
        self._wrapper.close()

    def read_iterable(self):
        raise NotImplementedError()

    def read_excel(self):
        raise NotImplementedError()

    def read_parquet(self):
        raise NotImplementedError()

    def read_file(self) -> BinaryIO | TextIO:
        return self._wrapper


class FromPath(FromTextIO):
    path: str

    def __init__(self, path):
        super().__init__(open(path, "r"))
        self.path = path

    def read_excel(self):
        return pd.read_excel(self.path)

    def read_parquet(self):
        return pd.read_parquet(self.path)

    def read_zip(self, inner_path: str | None = None) -> File:
        if inner_path is None or inner_path == "":
            return FromTextIO(bz2.open(self.path, "rt", encoding="utf-8"))
        else:
            raw_bytes = ZipFile(self.path, "r").open(inner_path, "r")
            return FromTextIO(io.TextIOWrapper(raw_bytes, encoding="utf-8"))
