"""Reading a captured page back out of the crawled bucket."""

from __future__ import annotations

import io
import tarfile

from google.cloud import storage

from entities.util import NormalizedParse

_GCS_SCHEME = "gs://"


def member_path(url: str) -> str:
    """Where a page sits inside its archive.

    The same computation as `_member_path_from_url` in `parsed_pipeline`, and
    as `crawlMemberPath` on the frontend that wrote the archive. All three have
    to agree or the page is simply not found.
    """
    parsed = NormalizedParse.parse(url)
    path = parsed.path if parsed.path else "index"
    return f"{parsed.hostname}/{path}".replace("//", "/").rstrip("/")


def split_gs_path(storage_path: str) -> tuple[str, str]:
    if not storage_path.startswith(_GCS_SCHEME):
        raise ValueError(f"not a gs:// path: {storage_path!r}")
    bucket, _, blob = storage_path[len(_GCS_SCHEME) :].partition("/")
    if not bucket or not blob:
        raise ValueError(f"incomplete gs:// path: {storage_path!r}")
    return bucket, blob


def read_captured_html(storage_path: str, url: str) -> bytes:
    """The html for one url, out of the tar.gz it was uploaded in.

    Reads the whole archive into memory, which is the right call here: a
    capture archive holds a single page, and the alternative is a ranged read
    over a gzip stream that has to be decompressed from the start anyway.
    """
    bucket_name, blob_name = split_gs_path(storage_path)
    raw = storage.Client().bucket(bucket_name).blob(blob_name).download_as_bytes()

    wanted = member_path(url)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        member = tar.getmember(wanted)
        extracted = tar.extractfile(member)
        if extracted is None:
            raise KeyError(f"{wanted!r} is not a file in {storage_path}")
        return extracted.read()
