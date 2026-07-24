import io
import tarfile
from collections import defaultdict
from typing import Generator

import pandas as pd

from entities.util import NormalizedParse
from scrapers.stores import Context, DoneUrl
from scrapers.stores.file import GCSBlob

_GCS_PREFIX = "gs://koryta-pl-crawled/"


def _member_path(url: str) -> str:
    """Return the tar member path for a given URL (mirrors batch_upload logic)."""
    try:
        parsed = NormalizedParse.parse(url)
        path = parsed.path if parsed.path else "index"
        return f"{parsed.hostname}/{path}".replace("//", "/").rstrip("/")
    except Exception:
        return ""


def read_html_from_storage(
    ctx: Context, done_urls: list[DoneUrl]
) -> dict[str, bytes]:
    """Download tar.gz files from GCS and extract HTML for each URL in memory.

    Groups by storage_path so each tar.gz is downloaded only once.
    Returns a mapping of url → html bytes.
    """
    by_path: dict[str, list[DoneUrl]] = defaultdict(list)
    for done in done_urls:
        if done.storage_path:
            by_path[done.storage_path].append(done)

    html_by_url: dict[str, bytes] = {}
    for url, html in iter_html_from_storage(ctx, done_urls):
        html_by_url[url] = html
    return html_by_url


def iter_html_by_tar(
    ctx: Context, done_urls: list[DoneUrl]
) -> "Generator[tuple[str, dict[str, bytes]], None, None]":
    """Yield (storage_path, {url: html_bytes}) one tar.gz at a time."""
    by_path: dict[str, list[DoneUrl]] = defaultdict(list)
    for done in done_urls:
        if done.storage_path:
            by_path[done.storage_path].append(done)

    for storage_path, urls in by_path.items():
        blob_name = storage_path.removeprefix(_GCS_PREFIX)
        try:
            raw = ctx.io.read_data(GCSBlob(blob_name=blob_name)).read_bytes()
        except Exception:
            continue
        html_by_url: dict[str, bytes] = {}
        try:
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
                members = {m.name: m for m in tar.getmembers()}
                for done in urls:
                    member = members.get(_member_path(done.url))
                    if member is None:
                        continue
                    f = tar.extractfile(member)
                    if f is not None:
                        html_by_url[done.url] = f.read()
        except Exception:
            continue
        if html_by_url:
            yield storage_path, html_by_url


def iter_html_from_storage(
    ctx: Context, done_urls: list[DoneUrl]
) -> "Generator[tuple[str, bytes], None, None]":
    """Yield (url, html_bytes) one tar.gz at a time for incremental processing."""
    by_path: dict[str, list[DoneUrl]] = defaultdict(list)
    for done in done_urls:
        if done.storage_path:
            by_path[done.storage_path].append(done)

    for storage_path, urls in by_path.items():
        blob_name = storage_path.removeprefix(_GCS_PREFIX)
        try:
            raw = ctx.io.read_data(GCSBlob(blob_name=blob_name)).read_bytes()
        except Exception:
            continue
        try:
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
                members = {m.name: m for m in tar.getmembers()}
                for done in urls:
                    member_name = _member_path(done.url)
                    member = members.get(member_name)
                    if member is None:
                        continue
                    f = tar.extractfile(member)
                    if f is not None:
                        yield done.url, f.read()
        except Exception:
            continue


def domains_from_done_urls(done_df: pd.DataFrame) -> set[str]:
    domains: set[str] = set()
    for row in done_df.itertuples(index=False):
        try:
            domains.add(NormalizedParse.parse(str(row.url)).hostname_normalized)
        except Exception:
            continue
    return domains


def iter_done_urls(done_df: pd.DataFrame) -> list[DoneUrl]:
    done_urls: list[DoneUrl] = []
    for row in done_df.to_dict(orient="records"):
        done_urls.append(
            DoneUrl(
                uid=str(row["uid"]),
                url=str(row["url"]),
                storage_path=str(row["storage_path"]),
                media_type=(
                    None
                    if pd.isna(row.get("media_type"))
                    else str(row.get("media_type"))
                ),
            )
        )
    return done_urls


def llm_model(ctx: Context) -> str:
    llm_config = getattr(ctx.llm, "config", None)
    model = getattr(llm_config, "model", None)
    if isinstance(model, str) and model.strip():
        return model
    return "Qwen/Qwen3-14B"
