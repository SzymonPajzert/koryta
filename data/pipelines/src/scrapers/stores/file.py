import typing
from abc import ABCMeta, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

type Formats = Literal["jsonl", "csv", "parquet", "json"]


class File(metaclass=ABCMeta):
    """Abstract representation of a file, providing methods to read its content."""

    path: str

    @abstractmethod
    def read_bytes(self) -> bytes:
        """Reads the entire content of the file as bytes."""
        pass

    def read_string(self) -> str:
        """Reads the entire content of the file as a string"""
        return self.read_bytes().decode("utf-8")

    @abstractmethod
    def read_dataframe(
        self,
        fmt: Formats,
        csv_sep=",",
        dtype: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        pass

    @abstractmethod
    def read_jsonl(self):
        """Reads a JSONL (JSON Lines) file."""
        raise NotImplementedError()

    @abstractmethod
    def read_csv(self, sep=","):
        """Reads a CSV file."""
        raise NotImplementedError()

    @abstractmethod
    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        """Reads an XLS or XLSX file."""
        raise NotImplementedError()

    @abstractmethod
    def read_parquet(self):
        """Reads a Parquet file."""
        raise NotImplementedError()

    @abstractmethod
    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> "File":
        """Reads a file from within a ZIP archive."""
        raise NotImplementedError()

    @abstractmethod
    def read_file(self) -> typing.IO[bytes] | typing.IO[str]:
        """Returns a file-like object for reading."""
        raise NotImplementedError()


class ZipReader(metaclass=ABCMeta):
    """Abstract base class for a ZIP file reader."""

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
        """Opens a file within a ZIP archive."""
        raise NotImplementedError()


class DataRef(metaclass=ABCMeta):
    """Abstract base class for a reference to a data source."""

    pass


@dataclass
class LocalFile(DataRef):
    """A reference to a file on the local filesystem."""

    filename: str
    folder: Literal["downloaded", "tests", "versioned", "crawler_output", "tests/wiki"]


@dataclass
class DownloadableFile(DataRef):
    """
    A reference to a file that needs to be downloaded.

    Corresponds to stores.download.FileSource, which executes the download.
    """

    url: str
    filename_fallback: str | None = None
    full_url: bool = False
    complex_download: str | None = None
    download_lambda: typing.Callable | None = None
    binary: bool = True
    #: How many bytes the object holds, when whatever produced this reference
    #: already knew - a GCS listing carries it, so asking costs nothing. None
    #: means unknown, which is not the same as empty and must not be read as
    #: it: a crawl that failed is stored as a zero-byte object, and telling
    #: those apart from real ones is otherwise a download each.
    size: int | None = None

    @property
    def filename(self) -> str:
        """
        Determines the local filename for the downloadable file.

        Returns:
            The filename from filename_fallback if provided, otherwise infers
            it from the URL.
        """
        if self.filename_fallback is not None:
            return self.filename_fallback
        if self.full_url:
            return self.url.split("://")[1]
        return self.url.split("/")[-1]


@dataclass
class GCSBlob(DataRef):
    """A reference to a single blob in GCS by its blob name."""

    blob_name: str


@dataclass
class MirrorRef(DataRef):
    """A reference to a URL in the compressed HTML mirror."""

    url: str


class NotInMirrorError(Exception):
    """Raised when a URL has no snapshot in the compressed mirror."""


@dataclass
class CloudStorage(DataRef):
    """A reference to a collection of objects in cloud storage"""

    prefix: str
    max_namespaces: list[str] = field(default_factory=list)
    namespace_values: dict[str, str] = field(default_factory=dict)
    binary: bool = False
    #: The bucket to list, by name. None is the crawl bucket, which is where
    #: every crawl lives; a job keeps its own state elsewhere - see `jobs`.
    #: The compressed mirror only ever covers the crawl bucket.
    bucket: str | None = None


@dataclass
class VersionedBackup(DataRef):
    """A reference to a versioned backup file in cloud storage."""

    filename: str


#: The namespace `Storage.upload` stamps every crawl with, as `date=2026-05-27`.
CRAWL_DATE_NAMESPACE = "date="


def split_crawl_date(url: str) -> tuple[str, str]:
    """Separate what was crawled from when it was crawled.

    Returns the url with its ``date=`` segment removed, and the date itself
    (``""`` when the path carries none). The two together identify one crawl;
    the first alone identifies the thing crawled, across every crawl of it.

    The segment has moved over the life of the bucket - it used to follow the
    hostname and now trails the path, so both of these are the same object::

        hostname=rejestr.io/date=2025-09-29/api/v2/org/0000022006/krs-powiazania/aktualnosc_aktualne
        hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania/aktualnosc_aktualne/date=2026-07-02

    Hence searching for the segment rather than indexing at a fixed position.
    Dates are ISO-8601, so they sort chronologically as strings.
    """
    kept = []
    date = ""
    for segment in url.split("/"):
        if segment.startswith(CRAWL_DATE_NAMESPACE):
            date = max(date, segment.removeprefix(CRAWL_DATE_NAMESPACE))
        else:
            kept.append(segment)
    return "/".join(kept), date


def latest_crawls[T](refs: typing.Iterable[T], url: typing.Callable[[T], str]):
    """Keep the most recent crawl of each object, discarding the rest.

    A crawl never replaces the blob it supersedes - it is written under its own
    ``date=``, so the bucket accumulates one object per crawl and a listing
    returns every snapshot ever taken. Anything that reads a listing as "the
    current state" therefore sees each fact once per crawl: a board seat held
    across four crawls of one company arrives four times, once as it stood on
    each of those days.

    Order is preserved, so a caller that was iterating a listing keeps seeing it
    in listing order. A blob with no ``date=`` sorts below every dated one,
    which is what an undated crawl is: the oldest layout there is.
    """
    latest: dict[str, tuple[str, T]] = {}
    for ref in refs:
        subject, date = split_crawl_date(url(ref))
        best = latest.get(subject)
        if best is None or date > best[0]:
            latest[subject] = (date, ref)
    return [ref for _, ref in latest.values()]
