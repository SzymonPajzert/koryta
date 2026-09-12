import argparse
import io
import json
import tarfile
from collections import defaultdict
from functools import cache
from pathlib import Path
from typing import Generator, Iterator

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


def read_html_from_storage(ctx: Context, done_urls: list[DoneUrl]) -> dict[str, bytes]:
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


def iter_done_urls_from_file(
    path: str | Path, *, progress_every: int = 0
) -> Iterator[DoneUrl]:
    """Stream done URL rows from the article_done_urls.jsonl output file.

    The done urls file is far too large to load into a pandas DataFrame in one
    go (millions of rows), so this reads it line by line and yields ``DoneUrl``
    objects. ``progress_every`` optionally prints a per-N processed-row tally.
    """
    with open(path, encoding="utf-8") as handle:
        for i, line in enumerate(handle):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            yield DoneUrl(
                uid=str(row["uid"]),
                url=str(row["url"]),
                storage_path=str(row["storage_path"]),
                media_type=(
                    None if row.get("media_type") is None else str(row["media_type"])
                ),
            )
            if progress_every and (i + 1) % progress_every == 0:
                print(f"  read {i + 1:,} done URLs")


# ---------------------------------------------------------------------------
# Article/LLM pipeline configuration.
#
# These flags belong to the article pipelines, not to the generic Context, so
# they are defined and read here (mirroring scrapers.wiki.dump). koryta.py
# registers them via add_arguments so the positional pipeline names are not
# mistaken for flag values; the pipelines then read them lazily via the cached
# accessors below — nothing pipeline-specific has to live on conductor/Context.
# ---------------------------------------------------------------------------
def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Register the article/LLM pipeline flags on a parser."""
    parser.add_argument(
        "--llm-model",
        default="Qwen/Qwen3-14B",
        help="Model name for the OpenAI-compatible LLM servers.",
    )
    parser.add_argument(
        "--llm-ports",
        default="6000-6015",
        help="LLM ports as an inclusive range or comma list, e.g. 6000-6015.",
    )
    parser.add_argument(
        "--llm-per-port-concurrency",
        type=int,
        default=4,
        help="Concurrent requests allowed per LLM port.",
    )
    parser.add_argument(
        "--llm-base-url",
        default=None,
        help="OpenAI-compatible base URL (e.g. https://openrouter.ai/api/v1). "
        "When set, requests go here instead of local ports. API key is read "
        "from --llm-api-key or the OPENROUTER_APIKEY / OPENAI_API_KEY env var.",
    )
    parser.add_argument(
        "--llm-api-key",
        default=None,
        help="Bearer token for --llm-base-url (falls back to env).",
    )
    parser.add_argument(
        "--llm-request-timeout-seconds",
        type=int,
        default=1800,
        help="HTTP timeout for each LLM request.",
    )
    parser.add_argument(
        "--article-workers",
        type=int,
        default=4,
        help="Parallel workers for article parsing pipelines.",
    )
    parser.add_argument(
        "--koryciarski-scorer",
        choices=["llm", "ml"],
        default="llm",
        help="Scorer for ArticleKoryciarskiScores. 'llm' (default) calls the "
        "LLM; 'ml' scores article content with the trained TF-IDF + logistic "
        "regression models (no LLM, fast), stamping rows with "
        "model=koryciarski_content_ml.",
    )
    parser.add_argument(
        "--article-facts-min-koryciarski-score",
        type=int,
        default=None,
        help="Only run ArticleExtractedFacts LLM extraction for uncached "
        "articles with koryciarski_llm_score >= N.",
    )
    parser.add_argument(
        "--article-facts-max-tokens",
        type=int,
        default=None,
        help="Max completion tokens for ArticleExtractedFacts LLM requests.",
    )
    parser.add_argument(
        "--article-facts-text-limit",
        type=int,
        default=None,
        help="Max article text characters fed to the facts extraction prompt.",
    )
    parser.add_argument(
        "--article-facts-require-mentions",
        action="store_true",
        help="Only extract facts for articles that have confirmed person "
        "mentions, and error if the mentions file is missing. Off by default: "
        "ArticleExtractedFacts runs over every scored parsed article and treats "
        "mentions as an optional people hint.",
    )
    parser.add_argument(
        "--article-analyzed-keep-evidence",
        action="store_true",
        help="Attach the dedup `evidence` (list of article URLs where the same "
        "fact was seen) to kept facts in article_analyzed. Default: the field "
        "is dropped so the output matches the ingest schema.",
    )
    parser.add_argument(
        "--article-analyzed-only-matched-koryta",
        action="store_true",
        help="Keep only facts whose person (subject for relations) matches one "
        "of the article's confirmed koryta_ids by name — the rule the website "
        "ingest uses to link a fact to a person page. Default: keep every "
        "verified fact.",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="Tag for this pipeline run (e.g. v1_qwen3-32b), stored in outputs.",
    )


@cache
def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


def _parse_ports(raw_ports: str) -> list[int]:
    raw_ports = raw_ports.strip()
    if not raw_ports:
        return []
    ports: list[int] = []
    for part in raw_ports.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            if end < start:
                raise ValueError("--llm-ports range end must be >= start")
            ports.extend(range(start, end + 1))
        else:
            ports.append(int(part))
    return ports


# The concrete LLM client is built by conductor.setup_context (the stores layer)
# from these plain-value accessors; scrapers must not import stores.llm itself.
def llm_model() -> str:
    model = _args().llm_model
    return model if isinstance(model, str) and model.strip() else "Qwen/Qwen3-14B"


def llm_ports() -> list[int]:
    return _parse_ports(_args().llm_ports)


def llm_per_port_concurrency() -> int:
    return _args().llm_per_port_concurrency


def llm_request_timeout_seconds() -> int:
    return _args().llm_request_timeout_seconds


def llm_base_url() -> str | None:
    return _args().llm_base_url


def llm_api_key() -> str | None:
    return _args().llm_api_key


def article_workers() -> int:
    return _args().article_workers


def koryciarski_scorer() -> str:
    return _args().koryciarski_scorer


def article_tag() -> str | None:
    return _args().tag


def article_facts_min_koryciarski_score() -> int | None:
    return _args().article_facts_min_koryciarski_score


def article_facts_max_tokens() -> int | None:
    return _args().article_facts_max_tokens


def article_facts_text_limit() -> int | None:
    return _args().article_facts_text_limit


def article_facts_require_mentions() -> bool:
    return bool(_args().article_facts_require_mentions)


def article_analyzed_keep_evidence() -> bool:
    return bool(_args().article_analyzed_keep_evidence)


def article_analyzed_only_matched_koryta() -> bool:
    return bool(_args().article_analyzed_only_matched_koryta)
