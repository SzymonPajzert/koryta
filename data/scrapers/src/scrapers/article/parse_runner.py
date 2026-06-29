"""Batch HTML parser: reads done crawl URLs, applies domain selectors, writes JSONL."""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import mimetypes
import multiprocessing
import os
import queue as _queue
import shutil
import tarfile
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tqdm import tqdm

from conductor import make_reader_conductor
from entities.article import ParsedArticleRecord
from entities.util import NormalizedParse
from scrapers.article.parse import extract_article_content
from scrapers.article.selectors import load_selector_map
from scrapers.stores import CrawlQueue, DoneUrl, MirrorRef, NotInMirrorError
from stores.duckdb import EntityDumper

_DEFAULT_SELECTORS_FILE = Path("domain_selectors_v5.jsonl")
_VERSIONED_DIR = Path("versioned") / "article_parsed"
_FINAL_OUTPUT_FILE = _VERSIONED_DIR / "article_parsed.jsonl"
_TEMP_OUTPUT_FILE = _VERSIONED_DIR / "article_parsed.jsonl.tmp"
_PARSER_VERSION = 1

# Per-process globals, set once in _init_worker.
_process_conductor: Any | None = None
_result_queue: multiprocessing.Queue | None = None


@dataclass(frozen=True)
class ParseTask:
    uid: str
    url: str
    storage_path: str
    domain: str
    selector: str


class _BytesFile:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read_bytes(self) -> bytes:
        return self._data


class _LocalCompressedMirror:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._extracted: set[str] = set()

    def _extract_dir(self, host: str) -> Path:
        return self.root / "compressed" / host

    def _resolve_tar_path(self, host: str) -> Path:
        candidates = sorted(Path(self.root).glob(f"hostname={host}*.tar.gz"))
        if not candidates:
            raise NotInMirrorError(f"{host} has no snapshot in local mirror cache")
        return candidates[-1]

    def ensure_extracted(self, host: str) -> Path:
        extract_dir = self._extract_dir(host)
        if host in self._extracted or extract_dir.exists():
            self._extracted.add(host)
            return extract_dir
        tar_path = self._resolve_tar_path(host)
        extract_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path) as tf:
            for member in tf.getmembers():
                if not member.isfile() or member.name == "index.txt":
                    continue
                rel = member.name[len(host) + 1 :]
                filename = rel.replace("/", ".")
                f = tf.extractfile(member)
                if f is not None:
                    (extract_dir / filename).write_bytes(f.read())
        self._extracted.add(host)
        return extract_dir

    def delete_extracted(self, host: str) -> None:
        extract_dir = self._extract_dir(host)
        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        self._extracted.discard(host)

    def get(self, url: str) -> bytes:
        parsed = NormalizedParse.parse(url)
        host = parsed.hostname_normalized
        path = (parsed.path.strip("/") or "index").replace("/", ".")
        extract_dir = self.ensure_extracted(host)
        candidates = sorted(extract_dir.glob(f"{path}.date=*"))
        if not candidates:
            raise NotInMirrorError(f"URL not found in local mirror cache: {url}")
        return candidates[-1].read_bytes()


class _LocalMirrorConductor:
    def __init__(self, root: Path) -> None:
        self.mirror = _LocalCompressedMirror(root)

    def read_data(self, fs: MirrorRef) -> _BytesFile:
        return _BytesFile(self.mirror.get(fs.url))


def _init_worker(out_q: multiprocessing.Queue) -> None:
    global _process_conductor, _result_queue
    local_root = os.environ.get("KORYTA_PARSE_LOCAL_MIRROR_ROOT")
    if local_root:
        _process_conductor = _LocalMirrorConductor(Path(local_root))
    else:
        _process_conductor = make_reader_conductor()
    _result_queue = out_q


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _hash_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _load_existing_records(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    records: dict[str, dict] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except Exception:
                continue
            url = record.get("url")
            if isinstance(url, str) and url:
                records[url] = record
    return records


def _is_html(media_type: str | None) -> bool:
    if not media_type:
        return False
    base_type = media_type.split(";")[0].strip()
    return mimetypes.guess_extension(base_type) in {".html", ".htm"}


def _print_media_type_stats(counts: Counter) -> None:
    print("\n=== Media type stats ===")
    total = sum(counts.values())
    for media_type, count in counts.most_common():
        label = media_type or "(none)"
        print(f"  {label:<50} {count:>6}  ({100 * count / total:.1f}%)")
    print(f"  {'TOTAL':<50} {total:>6}")


def _print_domain_stats(counts: Counter, test_domains: set[str]) -> None:
    print("\n=== Domain stats ===")
    total = sum(counts.values())
    for domain, count in counts.most_common():
        covered = "*" if domain in test_domains else " "
        print(f"  {covered} {domain:<55} {count:>6}  ({100 * count / total:.1f}%)")
    print("\n  (* = covered by selector file)")


def _print_coverage(domain_counts: Counter, test_domains: set[str]) -> None:
    if not domain_counts:
        print("\n=== Test coverage ===\n  No done URLs.")
        return
    all_domains = set(domain_counts.keys())
    covered = all_domains & test_domains
    total_urls = sum(domain_counts.values())
    covered_urls = sum(domain_counts[d] for d in covered)
    print(
        f"\n=== Test coverage ===\n"
        f"  Domains with test data: {len(covered)}/{len(all_domains)}\n"
        f"  URLs from tested domains: {covered_urls}/{total_urls} "
        f"({100 * covered_urls / total_urls:.1f}%)"
    )


def _load_seed_domains(path: Path) -> set[str]:
    if not path.exists():
        return set()
    domains: set[str] = set()
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or "Domena" not in reader.fieldnames:
            return set()
        for row in reader:
            raw = (row.get("Domena") or "").strip()
            if not raw:
                continue
            try:
                url = raw if raw.startswith("http") else f"https://{raw}"
                domains.add(NormalizedParse.parse(url).hostname_normalized)
            except Exception:
                continue
    return domains


def _print_seed_coverage(test_domains: set[str]) -> None:
    seed_domains = _load_seed_domains(Path("files") / "seed.csv")
    if not seed_domains:
        print("\n=== Seed coverage ===\n  No seed domains found.")
        return
    covered = seed_domains & test_domains
    print(
        f"\n=== Seed coverage ===\n"
        f"  Domains in seed.csv: {len(seed_domains)}\n"
        f"  Domains with selectors: {len(covered)}/{len(seed_domains)} "
        f"({100 * len(covered) / len(seed_domains):.1f}%)"
    )


def _build_missing_selector_record(done: DoneUrl, domain: str) -> dict:
    return {
        "uid": done.uid,
        "url": done.url,
        "domain": domain,
        "storage_path": done.storage_path,
        "selector": None,
        "parse_status": "missing_selector",
        "selector_matched": False,
        "title": None,
        "publication_date": None,
        "ld_json": None,
        "article_content": "",
        "article_content_hash": _hash_text(""),
        "html_sha256": None,
        "parser_version": _PARSER_VERSION,
    }


def _build_status_record(
    done: DoneUrl,
    domain: str,
    selector: str | None,
    parse_status: str,
    *,
    error: str | None = None,
) -> dict:
    record = {
        "uid": done.uid,
        "url": done.url,
        "domain": domain,
        "storage_path": done.storage_path,
        "selector": selector,
        "parse_status": parse_status,
        "selector_matched": False,
        "title": None,
        "publication_date": None,
        "ld_json": None,
        "article_content": "",
        "article_content_hash": _hash_text(""),
        "html_sha256": None,
        "parser_version": _PARSER_VERSION,
    }
    if error is not None:
        record["error"] = error
    return record


def _record_to_entity(record: dict[str, Any]) -> ParsedArticleRecord:
    selector = record.get("selector")
    title = record.get("title")
    publication_date = record.get("publication_date")
    html_sha256 = record.get("html_sha256")
    error = record.get("error")
    return ParsedArticleRecord(
        uid=str(record["uid"]),
        url=str(record["url"]),
        domain=str(record["domain"]),
        storage_path=str(record["storage_path"]),
        selector=selector if selector is None else str(selector),
        parse_status=str(record.get("parse_status") or "error"),
        selector_matched=bool(record.get("selector_matched")),
        title=title if title is None else str(title),
        publication_date=(
            publication_date if publication_date is None else str(publication_date)
        ),
        ld_json=record.get("ld_json"),
        article_content=str(record.get("article_content") or ""),
        article_content_hash=str(record.get("article_content_hash") or _hash_text("")),
        html_sha256=html_sha256 if html_sha256 is None else str(html_sha256),
        parser_version=int(record.get("parser_version") or _PARSER_VERSION),
        error=error if error is None else str(error),
    )


def _finalize_temp_output() -> None:
    if _TEMP_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TEMP_OUTPUT_FILE.replace(_FINAL_OUTPUT_FILE)
    elif not _FINAL_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FINAL_OUTPUT_FILE.write_text("", encoding="utf-8")


def _should_reuse(previous: dict | None, selector: str | None, done: DoneUrl) -> bool:
    if not previous:
        return False
    return (
        previous.get("parser_version") == _PARSER_VERSION
        and previous.get("selector") == selector
        and previous.get("storage_path") == done.storage_path
    )


def _parse_domain_worker(host: str, batch: list[ParseTask]) -> None:
    """Extract a domain's tar, parse every URL in batch, delete extraction."""
    assert _process_conductor is not None
    assert _result_queue is not None
    conductor = _process_conductor
    out_q = _result_queue

    try:
        conductor.mirror.ensure_extracted(host)
    except NotInMirrorError as exc:
        logging.warning("Domain %s not in mirror: %s", host, exc)
        for task in batch:
            out_q.put(
                _build_status_record(
                    DoneUrl(task.uid, task.url, task.storage_path),
                    task.domain,
                    task.selector,
                    "not_in_mirror",
                )
            )
        return

    try:
        for task in batch:
            done = DoneUrl(task.uid, task.url, task.storage_path)
            try:
                html_bytes = conductor.read_data(MirrorRef(task.url)).read_bytes()
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
                    "article_content_hash": _hash_text(article_content),
                    "html_sha256": _hash_bytes(html_bytes),
                    "parser_version": _PARSER_VERSION,
                }
                out_q.put(record)
            except Exception as exc:
                logging.warning("Failed to parse %s: %s", task.url, exc)
                out_q.put(
                    _build_status_record(
                        done,
                        task.domain,
                        task.selector,
                        "error",
                        error=str(exc),
                    )
                )
    finally:
        conductor.mirror.delete_extracted(host)


def run_parse(  # noqa: PLR0912, PLR0915
    queue: CrawlQueue,
    ctx,  # kept for caller compatibility
    parse_limit: int,
    worker_processes: int = 1,
    selectors_file: Path = _DEFAULT_SELECTORS_FILE,
) -> None:
    """Fetch done URLs, print stats, parse HTML using selectors, emit JSONL."""
    logging.info("Fetching all done URLs from DB...")
    all_done = queue.get_done_urls()
    logging.info("Fetched %d done URLs.", len(all_done))

    selectors = load_selector_map(selectors_file)
    existing_records = _load_existing_records(_FINAL_OUTPUT_FILE)
    logging.info("Loaded %d selectors from %s", len(selectors), selectors_file)

    if _TEMP_OUTPUT_FILE.exists():
        _TEMP_OUTPUT_FILE.unlink()
    _TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    _TEMP_OUTPUT_FILE.write_text("", encoding="utf-8")

    media_type_counts: Counter = Counter(d.media_type for d in all_done)
    domain_counts: Counter = Counter()
    for d in tqdm(all_done, desc="Counting domains", unit="url"):
        try:
            domain_counts[NormalizedParse.parse(d.url).hostname_normalized] += 1
        except Exception:
            domain_counts["(unparseable)"] += 1

    test_domains = set(selectors)

    _print_media_type_stats(media_type_counts)
    _print_domain_stats(domain_counts, test_domains)
    _print_coverage(domain_counts, test_domains)
    _print_seed_coverage(test_domains)

    to_parse = [d for d in all_done if _is_html(d.media_type)][:parse_limit]
    print(
        f"\nParsing {len(to_parse)} URLs "
        f"(limit={parse_limit}, workers={worker_processes})..."
    )

    dumper = EntityDumper()
    tasks_by_domain: dict[str, list[ParseTask]] = {}
    seen_urls: set[str] = set()
    reused_count = 0
    missing_selector_count = 0
    parsed_count = 0
    emitted_count = 0

    for done in to_parse:
        if done.url in seen_urls:
            continue
        seen_urls.add(done.url)
        try:
            host = NormalizedParse.parse(done.url).hostname_normalized
        except Exception:
            host = "(unparseable)"

        selector = selectors.get(host)
        previous = existing_records.get(done.url)

        if selector is None:
            if _should_reuse(previous, None, done):
                assert previous is not None
                dumper.insert_into(_record_to_entity(previous), [])
                reused_count += 1
                emitted_count += 1
            else:
                dumper.insert_into(
                    _record_to_entity(_build_missing_selector_record(done, host)),
                    [],
                )
                missing_selector_count += 1
                emitted_count += 1
            continue

        if _should_reuse(previous, selector, done):
            assert previous is not None
            dumper.insert_into(_record_to_entity(previous), [])
            reused_count += 1
            emitted_count += 1
            continue

        tasks_by_domain.setdefault(host, []).append(
            ParseTask(
                uid=done.uid,
                url=done.url,
                storage_path=done.storage_path,
                domain=host,
                selector=selector,
            )
        )

    domains_sorted = sorted(tasks_by_domain.items(), key=lambda item: -len(item[1]))
    total_work = sum(len(batch) for batch in tasks_by_domain.values())

    result_queue: multiprocessing.Queue = multiprocessing.Queue()

    if total_work:
        with ProcessPoolExecutor(
            max_workers=worker_processes,
            initializer=_init_worker,
            initargs=(result_queue,),
        ) as executor:
            futures = [
                executor.submit(_parse_domain_worker, host, batch)
                for host, batch in domains_sorted
            ]

            with tqdm(total=total_work, desc="Parsing HTML", unit="page") as bar:
                received = 0
                idle_after_done = 0
                while received < total_work:
                    try:
                        item = result_queue.get(timeout=30)
                    except _queue.Empty:
                        if all(f.done() for f in futures):
                            idle_after_done += 1
                            if idle_after_done >= 10:
                                logging.warning(
                                    "Stopped draining parse results early after "
                                    "%d/%d items; will keep whatever has been "
                                    "collected.",
                                    received,
                                    total_work,
                                )
                                break
                        continue
                    idle_after_done = 0
                    received += 1
                    bar.update(1)
                    if isinstance(item, dict) and isinstance(item.get("url"), str):
                        dumper.insert_into(_record_to_entity(item), [])
                        parsed_count += 1
                        emitted_count += 1

            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as exc:
                    logging.error("Domain worker crashed: %s", exc)

    dumper.dump_pandas()
    _finalize_temp_output()

    logging.info(
        "Parsed %d pages (%d parsed, %d reused, %d missing selectors).",
        emitted_count,
        parsed_count,
        reused_count,
        missing_selector_count,
    )
