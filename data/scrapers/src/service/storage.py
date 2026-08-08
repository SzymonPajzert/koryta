"""Reading a captured page back out of the crawled bucket."""

from __future__ import annotations

import io
import os
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

from google.cloud import storage

from entities.util import NormalizedParse

_GCS_SCHEME = "gs://"
_FILE_SCHEME = "file://"


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


def local_capture_root() -> Path:
    """The one directory a `file://` capture may be read from.

    `CAPTURE_LOCAL_DIR` and this default are the same pair the frontend's
    `localCaptureRoot` uses, so the two halves of the development loop agree on
    where an archive goes without either being told by the other.
    """
    configured = os.environ.get("CAPTURE_LOCAL_DIR")
    root = (
        Path(configured)
        if configured
        else Path(tempfile.gettempdir()) / "koryta-captures"
    )
    return root.resolve()


def read_local_path(storage_path: str) -> Path:
    """The file a `file://` capture path points at, inside the sink.

    Only the development sink produces these: with no storage emulator to write
    to, `uploadCapturedPage` puts the archive on disk under the same name and
    hands back its path, so the whole capture loop runs on one machine without
    touching `gs://koryta-pl-crawled`.

    The path arrives in the request body, which makes it the caller's to choose,
    so it is confined to that sink rather than trusted. Cloud Tasks is the only
    caller that should reach `/extract`, but "should" is not an argument for
    handing whoever does reach it an arbitrary file off this disk.
    """
    if not storage_path.startswith(_FILE_SCHEME):
        raise ValueError(f"not a file:// path: {storage_path!r}")
    # Through urlparse rather than a slice, so a percent-escaped path (a url
    # with a space or a diacritic in it, which is most Polish article slugs)
    # comes back as the name that was written.
    parsed = urlparse(storage_path)
    # `file://relative/path` parses as host "relative", path "/path" — which
    # would otherwise read as an absolute path on this machine.
    if parsed.netloc not in ("", "localhost"):
        raise ValueError(f"file:// path names another host: {storage_path!r}")
    path = Path(unquote(parsed.path))
    if not path.is_absolute():
        raise ValueError(f"file:// path is not absolute: {storage_path!r}")

    # Rebuilt from the root rather than merely compared against it. Checking
    # `root in resolved.parents` would be just as safe, but the file is then
    # still opened through a path the caller supplied, and neither a reader nor
    # a taint analysis can see that the check governs the open. Taking the
    # relative part and joining it back onto a path we chose leaves nothing of
    # the caller's string in the value that reaches the filesystem.
    root = local_capture_root()
    resolved = os.path.realpath(str(path))
    try:
        relative = Path(resolved).relative_to(root)
    except ValueError:
        raise ValueError(f"file:// path is outside {root}: {storage_path!r}") from None
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"file:// path escapes {root}: {storage_path!r}")
    return root.joinpath(*relative.parts)


def _download(storage_path: str) -> bytes:
    if storage_path.startswith(_FILE_SCHEME):
        return read_local_path(storage_path).read_bytes()
    bucket_name, blob_name = split_gs_path(storage_path)
    return storage.Client().bucket(bucket_name).blob(blob_name).download_as_bytes()


def read_captured_html(storage_path: str, url: str) -> bytes:
    """The html for one url, out of the tar.gz it was uploaded in.

    Reads the whole archive into memory, which is the right call here: a
    capture archive holds a single page, and the alternative is a ranged read
    over a gzip stream that has to be decompressed from the start anyway.
    """
    raw = _download(storage_path)

    wanted = member_path(url)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        member = tar.getmember(wanted)
        extracted = tar.extractfile(member)
        if extracted is None:
            raise KeyError(f"{wanted!r} is not a file in {storage_path}")
        return extracted.read()
