import json
import multiprocessing
import random
import tarfile
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ParsedArticleRecord
from entities.util import NormalizedParse
from scrapers.article.crawler import extract_urls_from_html
from scrapers.article.parse import extract_article_content
from scrapers.article.pipelines.common import (
    PARSER_VERSION,
    build_parse_status_record,
    hash_bytes,
    hash_text,
    is_html,
    parse_record_to_entity,
    should_reuse_parse,
)
from scrapers.article.pipelines.domain_selectors_pipeline import (
    ArticleDomainSelectors,
    selector_map_from_df,
)
from scrapers.article.pipelines.done_urls_pipeline import ArticleDoneUrls
from scrapers.article.pipelines.pipeline_utils import (
    iter_done_urls,
)
from scrapers.stores import DOWNLOADED_DIR, VERSIONED_DIR, Context, DoneUrl, Pipeline

_FINAL_OUTPUT_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_TEMP_OUTPUT_FILE = (
    Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl.tmp"
)


@dataclass(frozen=True)
class ParseTask:
    uid: str
    url: str
    storage_path: str
    domain: str
    selector: str


class ArticleParsed(Pipeline[ParsedArticleRecord]):
    filename = "article_parsed"

    done_urls: ArticleDoneUrls
    domain_selectors: ArticleDomainSelectors

    @property
    def output_class(self):
        return ParsedArticleRecord

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        should_refresh = self.should_refresh_with_logic(ctx)
        if not should_refresh:
            # Avoid loading multi-GB article output into pandas just to report success.
            self._cached_result = pd.DataFrame()
            return self._cached_result

        self.preprocess_sources(ctx, ctx.refresh_policy)
        graceful = True
        completed = False
        try:
            df = self.process(ctx)
            self._refreshed_execution = True
            completed = True
        except InterruptedError:
            print("Caught interrupt signal, will save partial data")
            df = pd.DataFrame()
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                if completed or _TEMP_OUTPUT_FILE.exists():
                    _finalize_temp_output()
                else:
                    print(f"Partial output left at {_TEMP_OUTPUT_FILE}")
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = df
        return df

    def process(self, ctx: Context):
        done_df = self.done_urls.read_or_process(ctx)
        selectors_df = self.domain_selectors.read_or_process(ctx)
        selectors = selector_map_from_df(selectors_df)
        existing_records = _existing_parse_index(_FINAL_OUTPUT_FILE)
        _prepare_temp_output()

        reusable_urls: set[str] = set()
        tasks_by_domain: dict[str, list[ParseTask]] = {}
        seen_urls: set[str] = set()
        for done in iter_done_urls(done_df):
            if done.url in seen_urls:
                continue
            seen_urls.add(done.url)
            if not is_html(done.media_type):
                continue
            row, task, reusable_url = _classify_done_url(
                done, selectors, existing_records
            )
            if row is not None:
                _emit_record(ctx, row)
            elif reusable_url is not None:
                reusable_urls.add(reusable_url)
            elif task is not None:
                tasks_by_domain.setdefault(task.domain, []).append(task)

        _emit_reused_records(ctx, _FINAL_OUTPUT_FILE, reusable_urls)
        _parse_domain_batches(ctx, tasks_by_domain)
        return pd.DataFrame()


def _prepare_temp_output() -> None:
    _TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _TEMP_OUTPUT_FILE.exists():
        _TEMP_OUTPUT_FILE.unlink()
    _TEMP_OUTPUT_FILE.write_text("", encoding="utf-8")


def _finalize_temp_output() -> None:
    if _TEMP_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TEMP_OUTPUT_FILE.replace(_FINAL_OUTPUT_FILE)
    elif not _FINAL_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FINAL_OUTPUT_FILE.write_text("", encoding="utf-8")


def _existing_parse_index(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Indexing existing parses", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            url = row.get("url")
            if isinstance(url, str) and url:
                records[url] = {
                    "parser_version": row.get("parser_version"),
                    "selector": row.get("selector"),
                    "storage_path": row.get("storage_path"),
                }
    return records


def _classify_done_url(
    done: DoneUrl,
    selectors: dict[str, str],
    existing_records: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, ParseTask | None, str | None]:
    try:
        host = NormalizedParse.parse(done.url).hostname_normalized
    except Exception:
        host = "(unparseable)"

    selector = selectors.get(host)
    previous = existing_records.get(done.url)

    if selector is None:
        return None, None, None

    if should_reuse_parse(previous, selector, done):
        assert previous is not None
        return None, None, done.url

    return None, ParseTask(done.uid, done.url, done.storage_path, host, selector), None


def _emit_reused_records(ctx: Context, path: Path, reusable_urls: set[str]) -> int:
    if not reusable_urls or not path.exists():
        return 0
    emitted = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reusing existing parses", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if row.get("parse_status") == "missing_selector":
                continue
            url = row.get("url")
            if isinstance(url, str) and url in reusable_urls:
                _emit_record(ctx, row)
                reusable_urls.discard(url)
                emitted += 1
                if not reusable_urls:
                    break
    return emitted


def _emit_record(ctx: Context, row: dict[str, Any]) -> None:
    ctx.io.dumper.insert_into(parse_record_to_entity(row), [])  # type: ignore[attr-defined]


def _parse_domain_batches(
    ctx: Context,
    tasks_by_domain: dict[str, list[ParseTask]],
) -> None:
    if not tasks_by_domain:
        return

    workers = max(1, int(getattr(ctx, "article_workers", 8) or 8))
    total_work = sum(len(tasks) for tasks in tasks_by_domain.values())

    by_storage: dict[str, list[ParseTask]] = defaultdict(list)
    for tasks in tasks_by_domain.values():
        for task in tasks:
            by_storage[task.storage_path].append(task)

    storage_items = list(by_storage.items())
    random.shuffle(storage_items)

    print(
        f"Parsing {total_work} pages across "
        f"{len(by_storage)} tar.gz files with {workers} workers"
    )

    # Limit in-flight futures to bound memory: each future holds parsed
    # results (including outbound_urls) until consumed by as_completed.
    MAX_IN_FLIGHT = workers * 4

    mp_ctx = multiprocessing.get_context("fork")
    with ProcessPoolExecutor(
        max_workers=workers, mp_context=mp_ctx
    ) as pool:
        try:
            with tqdm(
                total=total_work, desc="Parsing HTML", unit="page", smoothing=0.05
            ) as bar:
                pending: dict = {}
                items_iter = iter(storage_items)
                done = False
                while not done or pending:
                    # fill up to MAX_IN_FLIGHT
                    while not done and len(pending) < MAX_IN_FLIGHT:
                        try:
                            sp, t = next(items_iter)
                            f = pool.submit(
                                _parse_storage_batch_in_process, sp, t, DOWNLOADED_DIR
                            )
                            pending[f] = len(t)
                        except StopIteration:
                            done = True
                            break
                    if not pending:
                        break
                    for future in as_completed(list(pending.keys()), timeout=None):
                        if future not in pending:
                            continue
                        n = pending.pop(future)
                        try:
                            rows = future.result()
                        except Exception as exc:
                            bar.update(n)
                            print(f"Batch error: {exc}")
                            break
                        for row in rows:
                            _emit_record(ctx, row)
                        bar.update(len(rows))
                        break  # refill the queue after each completed future
        except KeyboardInterrupt:
            raise InterruptedError


def _status_row_for_task(
    task: ParseTask,
    status: str,
    *,
    error: str | None = None,
) -> dict[str, Any]:
    return _entity_to_record(
        parse_record_to_entity(
            build_parse_status_record(
                DoneUrl(task.uid, task.url, task.storage_path),
                task.domain,
                task.selector,
                status,
                error=error,
            )
        )
    )


def _parse_task(task: ParseTask, html_bytes: bytes) -> dict[str, Any]:
    done = DoneUrl(task.uid, task.url, task.storage_path)
    try:
        result = extract_article_content(html_bytes, task.selector, task.url)
        base_url = (
            task.url if task.url.startswith("http") else f"https://{task.url}"
        )
        html_text = html_bytes.decode("utf-8", errors="replace")
        outbound_urls = sorted(extract_urls_from_html(html_text, base_url))
        article_content = result.get("article_content", "") or ""
        selector_matched = bool(result.get("selector_matched"))
        extraction_method = result.get("extraction_method")
        has_content = bool(article_content.strip())
        if extraction_method == "selector":
            parse_status = "ok" if has_content else "empty_text"
        elif extraction_method == "readability":
            parse_status = "ok" if has_content else "empty_text"
        else:
            parse_status = "selector_not_found"
        publication_date = result.get("publication_date")
        record = {
            "uid": task.uid,
            "url": task.url,
            "domain": task.domain,
            "storage_path": task.storage_path,
            "selector": task.selector,
            "parse_status": parse_status,
            "selector_matched": selector_matched,
            "extraction_method": extraction_method,
            "title": result.get("title"),
            "publication_date": (
                publication_date.isoformat()
                if publication_date is not None
                else None
            ),
            "ld_json": result.get("ld_json"),
            "article_content": article_content,
            "article_content_hash": hash_text(article_content),
            "html_sha256": hash_bytes(html_bytes),
            "parser_version": PARSER_VERSION,
            "outbound_urls": outbound_urls,
        }
        return _entity_to_record(parse_record_to_entity(record))
    except Exception as exc:
        return _entity_to_record(
            parse_record_to_entity(
                build_parse_status_record(
                    done,
                    task.domain,
                    task.selector,
                    "error",
                    error=str(exc),
                )
            )
        )


_GCS_PREFIX = "gs://koryta-pl-crawled/"


def _parse_storage_batch_in_process(
    storage_path: str, tasks: list[ParseTask], downloaded_dir: str
) -> list[dict[str, Any]]:
    blob_name = storage_path.removeprefix(_GCS_PREFIX)
    local_path = Path(downloaded_dir) / blob_name.replace("/", ".")
    remaining = {t.url: t for t in tasks}
    results: list[dict[str, Any]] = []
    try:
        with tarfile.open(local_path, mode="r:gz") as tar:
            members = {m.name: m for m in tar.getmembers()}
            for task in tasks:
                member = members.get(_member_path_from_url(task.url))
                if member is None:
                    continue
                f = tar.extractfile(member)
                if f is not None:
                    results.append(_parse_task(task, f.read()))
                    remaining.pop(task.url, None)
    except Exception as exc:
        return [_status_row_for_task(t, "error", error=str(exc)) for t in tasks]
    for task in remaining.values():
        results.append(_status_row_for_task(task, "not_in_mirror"))
    return results


def _member_path_from_url(url: str) -> str:
    try:
        parsed = NormalizedParse.parse(url)
        path = parsed.path if parsed.path else "index"
        return f"{parsed.hostname}/{path}".replace("//", "/").rstrip("/")
    except Exception:
        return ""


def _entity_to_record(entity: ParsedArticleRecord) -> dict[str, Any]:
    return {
        "uid": entity.uid,
        "url": entity.url,
        "domain": entity.domain,
        "storage_path": entity.storage_path,
        "selector": entity.selector,
        "parse_status": entity.parse_status,
        "selector_matched": entity.selector_matched,
        "extraction_method": entity.extraction_method,
        "title": entity.title,
        "publication_date": entity.publication_date,
        "ld_json": entity.ld_json,
        "article_content": entity.article_content,
        "article_content_hash": entity.article_content_hash,
        "html_sha256": entity.html_sha256,
        "parser_version": entity.parser_version,
        "outbound_urls": entity.outbound_urls,
        "error": entity.error,
    }
