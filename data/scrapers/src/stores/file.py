import io
from typing import BinaryIO, TextIO

import bz2
import pandas as pd

from scrapers.stores import File


class FromIterable(File):
    def __init__(self, iterable):
        self.iterable = iterable

    def read_iterable(self):
        return self.iterable

    def read_jsonl(self):
        raise NotImplementedError()

    def read_csv(self):
        raise NotImplementedError()

    def read_excel(self):
        raise NotImplementedError()

    def read_parquet(self):
        raise NotImplementedError()

    def read_zip(self, path: str | None = None):
        raise NotImplementedError()

    def read_file(self):
        raise NotImplementedError()


class FromTextIO(File):
    def __init__(self, wrapper: io.TextIOWrapper):
        self._wrapper = wrapper

    def close(self):
        self._wrapper.close()

    def read_iterable(self):
        raise NotImplementedError()

    def read_jsonl(self):
        for line in self._wrapper:
            yield line

    def read_csv(self):
        raise NotImplementedError()

    def read_excel(self):
        raise NotImplementedError()

    def read_parquet(self):
        raise NotImplementedError()

    def read_file(self) -> BinaryIO | TextIO:
        return self._wrapper

    def read_zip(self, path: str | None = None) -> File:
        return FromTextIO(bz2.open(self.path, "rt", encoding="utf-8"))


class FromPath(FromTextIO):
    path: str

    def __init__(self, path):
        super().__init__(open(path, "r"))
        self.path = path

    def read_csv(self):
        return pd.read_csv(self.path)

    def read_excel(self):
        return pd.read_excel(self.path)

    def read_parquet(self):
        return pd.read_parquet(self.path)
