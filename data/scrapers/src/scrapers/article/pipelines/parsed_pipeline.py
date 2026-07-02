import json
import queue
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ParsedArticleRecord
from entities.util import NormalizedParse
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
from scrapers.article.pipelines.pipeline_utils import iter_done_urls
from scrapers.stores import Context, DoneUrl, MirrorRef, NotInMirrorError, Pipeline
from stores.config import VERSIONED_DIR

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

    workers = max(1, int(getattr(ctx, "article_workers", 1) or 1))
    domains_sorted = sorted(tasks_by_domain.items(), key=lambda item: -len(item[1]))
    total_work = sum(len(tasks) for tasks in tasks_by_domain.values())
    row_queue: queue.Queue[dict[str, Any]] = queue.Queue()
    domain_queue: queue.Queue[tuple[str, list[ParseTask]] | None] = queue.Queue()
    stop_event = threading.Event()

    print(f"Parsing {total_work} article HTML pages with {workers} workers")
    for item in domains_sorted:
        domain_queue.put(item)
    for _ in range(workers):
        domain_queue.put(None)

    worker_threads = [
        threading.Thread(
            target=_parse_worker_loop,
            args=(ctx, domain_queue, row_queue, stop_event),
            name=f"article-parse-{idx}",
            daemon=True,
        )
        for idx in range(workers)
    ]
    for thread in worker_threads:
        thread.start()

    try:
        with tqdm(total=total_work, desc="Parsing HTML", unit="page") as bar:
            received = 0
            while received < total_work:
                try:
                    row = row_queue.get(timeout=5)
                except queue.Empty:
                    if not any(thread.is_alive() for thread in worker_threads):
                        break
                    continue
                _emit_record(ctx, row)
                received += 1
                bar.update(1)
    except KeyboardInterrupt as exc:
        stop_event.set()
        raise InterruptedError from exc
    finally:
        stop_event.set()
        for thread in worker_threads:
            thread.join(timeout=1)


def _parse_worker_loop(
    ctx: Context,
    domain_queue: queue.Queue[tuple[str, list[ParseTask]] | None],
    row_queue: queue.Queue[dict[str, Any]],
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        item = domain_queue.get()
        if item is None:
            return
        host, tasks = item
        _parse_domain_batch(ctx, host, tasks, row_queue, stop_event)


def _parse_domain_batch(
    ctx: Context,
    host: str,
    tasks: list[ParseTask],
    row_queue: queue.Queue[dict[str, Any]],
    stop_event: threading.Event,
) -> None:
    mirror = getattr(ctx.io, "mirror", None)
    ensure_extracted = getattr(mirror, "ensure_extracted", None)
    delete_extracted = getattr(mirror, "delete_extracted", None)
    try:
        if callable(ensure_extracted):
            ensure_extracted(host)
        for task in tasks:
            if stop_event.is_set():
                return
            row_queue.put(_parse_task(ctx, task))
    except NotInMirrorError as exc:
        for task in tasks:
            row_queue.put(_status_row_for_task(task, "not_in_mirror", error=str(exc)))
    except Exception as exc:
        for task in tasks:
            row_queue.put(_status_row_for_task(task, "error", error=str(exc)))
    finally:
        if callable(delete_extracted):
            delete_extracted(host)


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


def _parse_task(ctx: Context, task: ParseTask) -> dict[str, Any]:
    done = DoneUrl(task.uid, task.url, task.storage_path)
    try:
        html_bytes = ctx.io.read_data(MirrorRef(task.url)).read_bytes()
        result = extract_article_content(html_bytes, task.selector)
        article_content = result.get("article_content", "") or ""
        selector_matched = bool(result.get("selector_matched"))
        if not selector_matched:
            parse_status = "selector_not_found"
        elif not article_content.strip():
            parse_status = "empty_text"
        else:
            parse_status = "ok"
        publication_date = result.get("publication_date")
        record = {
            "uid": task.uid,
            "url": task.url,
            "domain": task.domain,
            "storage_path": task.storage_path,
            "selector": task.selector,
            "parse_status": parse_status,
            "selector_matched": selector_matched,
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


def _entity_to_record(entity: ParsedArticleRecord) -> dict[str, Any]:
    return {
        "uid": entity.uid,
        "url": entity.url,
        "domain": entity.domain,
        "storage_path": entity.storage_path,
        "selector": entity.selector,
        "parse_status": entity.parse_status,
        "selector_matched": entity.selector_matched,
        "title": entity.title,
        "publication_date": entity.publication_date,
        "ld_json": entity.ld_json,
        "article_content": entity.article_content,
        "article_content_hash": entity.article_content_hash,
        "html_sha256": entity.html_sha256,
        "parser_version": entity.parser_version,
        "error": entity.error,
    }
