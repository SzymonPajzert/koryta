from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import logging
import os
import pstats
import signal
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable
from scrapers.article.postgres_queue import PostgresClient
import plotly.graph_objects as go
import plotly.io as pio

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_ROOT = PROJECT_ROOT / "versioned" / "benchmarks"


@dataclass
class RunConfig:
    workers: int
    seed: Path
    blocked: Path | None
    rate_limit_qpm: int
    runtime_seconds: int
    storage_type: str
    local_output: Path
    extra_args: list[str]
    profile_dir: Path


def _now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M%S")


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _count_seed_urls(path: Path) -> int:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{path} is missing a header row")
        fieldnames = [name.strip() for name in reader.fieldnames]
        if fieldnames != ["Url"]:
            raise ValueError(
                f"{path} must have exactly one column named 'Url'. Got: {fieldnames}"
            )
        count = 0
        for row in reader:
            value = row.get("Url", "")
            if isinstance(value, str) and value.strip():
                count += 1
        return count


def _run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def _git_rev() -> str | None:
    try:
        return _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    except Exception:
        return None


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _pg_client_from_env() -> PostgresClient | None:
    try:
        port = int(os.getenv("POSTGRES_PORT", "5432"))
    except ValueError:
        port = 5432
    host = os.getenv("POSTGRESS_HOST") or os.getenv("POSTGRES_HOST") or "localhost"
    password = (
        os.getenv("POSTGRES_PASSWORD")
        or os.getenv("POSTGRESS_PASSWORD")
        or "crawler_password"
    )
    try:
        return PostgresClient.from_env(
            host=host,
            database=os.getenv("POSTGRES_DB", "crawler_db"),
            user=os.getenv("POSTGRES_USER", "crawler_user"),
            password=password,
            port=port,
        )
    except Exception as exc:
        logging.warning("Failed to create Postgres client: %s", exc)
        return None


def _run_sql(pg_client: PostgresClient, query: str) -> tuple[list[str], list[tuple]]:
    with pg_client.transaction() as transaction:
        transaction.execute(query)
        columns = [desc[0] for desc in (transaction.description or [])]
        rows: list[tuple] = []
        if columns:
            rows = transaction.fetchall()
    return columns, rows


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def _ensure_pg_stat_statements(run_dir: Path, pg_client: PostgresClient | None) -> bool:
    out_path = run_dir / "pg_stat_statements_setup.txt"
    if pg_client is None:
        _write_text(out_path, "Postgres client unavailable; skipping setup.\n")
        return False
    try:
        _run_sql(pg_client, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")
    except Exception as exc:
        _write_text(out_path, f"ERROR: {exc}\n")
        return False
    _write_text(out_path, "OK\n")
    return True


def _reset_pg_stat_statements(run_dir: Path, pg_client: PostgresClient | None) -> None:
    out_path = run_dir / "pg_stat_statements_reset.txt"
    if pg_client is None:
        _write_text(out_path, "Postgres client unavailable; skipping reset.\n")
        return
    try:
        _run_sql(pg_client, "SELECT pg_stat_statements_reset();")
    except Exception as exc:
        _write_text(out_path, f"ERROR: {exc}\n")
        return
    _write_text(out_path, "OK\n")


def _pg_stat_statements_active(pg_client: PostgresClient | None) -> bool:
    if pg_client is None:
        return False
    try:
        columns, rows = _run_sql(pg_client, "SHOW shared_preload_libraries;")
    except Exception as exc:
        logging.warning("Failed to check shared_preload_libraries: %s", exc)
        return False
    if not rows or not columns:
        return False
    libs = rows[0][0]
    return libs is not None and "pg_stat_statements" in str(libs)


def _dump_pg_stat_statements(out_path: Path, pg_client: PostgresClient | None) -> None:
    if pg_client is None:
        return
    query = (
        "SELECT replace(query, E'\\n', ' ') AS query, "
        "calls, total_exec_time, mean_exec_time, rows "
        "FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 50;"
    )
    try:
        columns, rows = _run_sql(pg_client, query)
    except Exception as exc:
        _write_text(out_path, f"ERROR: {exc}\n")
        return
    lines: list[str] = []
    if columns:
        lines.append("\t".join(columns))
    for row in rows:
        lines.append("\t".join("" if value is None else str(value) for value in row))
    _write_text(out_path, "\n".join(lines) + ("\n" if lines else ""))


def _fetch_rows(pg_client: PostgresClient, query: str) -> list[dict[str, str]]:
    try:
        columns, rows = _run_sql(pg_client, query)
    except Exception as exc:
        logging.warning("Failed to run metadata query: %s", exc)
        return []
    results: list[dict[str, str]] = []
    for row in rows:
        entry: dict[str, str] = {}
        for idx, column in enumerate(columns):
            value = row[idx] if idx < len(row) else None
            entry[column] = "" if value is None else str(value)
        if entry:
            results.append(entry)
    return results


def _build_worker_cmd(idx: int, cfg: RunConfig) -> list[str]:
    base = [
        sys.executable,
        str(PROJECT_ROOT / "src" / "crawl_cli.py"),
        "--worker-id",
        f"worker-{idx}",
        "--per-domain-rate-limit-qpm",
        str(cfg.rate_limit_qpm),
        "--storage-type",
        cfg.storage_type,
        "--local-output",
        str(cfg.local_output),
        "--profile-path",
        str(cfg.profile_dir),
    ]
    base += cfg.extra_args
    return base


def _start_workers(cfg: RunConfig, logs_dir: Path) -> list[subprocess.Popen[str]]:
    procs = []
    logs_dir.mkdir(parents=True, exist_ok=True)
    for idx in range(1, cfg.workers + 1):
        log_path = logs_dir / f"worker-{idx}.log"
        log_handle = log_path.open("w", encoding="utf-8")
        cmd = _build_worker_cmd(idx, cfg)
        proc = subprocess.Popen(
            cmd, stdout=log_handle, stderr=subprocess.STDOUT, text=True
        )
        proc.log_handle = log_handle  # type: ignore[attr-defined]
        procs.append(proc)
    return procs


def _stop_workers(procs: Iterable[subprocess.Popen[str]]) -> None:
    for proc in procs:
        if proc.poll() is None:
            proc.send_signal(signal.SIGINT)
    deadline = time.time() + 10
    for proc in procs:
        remaining = max(0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            proc.kill()
    for proc in procs:
        handle = getattr(proc, "log_handle", None)
        if handle:
            handle.close()


def _summarize_profiles(profile_dir: Path, out_path: Path, limit: int = 25) -> None:
    sections: list[str] = []
    for profile_path in sorted(profile_dir.glob("worker-*.pstats")):
        stats = pstats.Stats(str(profile_path))
        stats.strip_dirs().sort_stats("cumtime")
        buf: list[str] = []
        buf.append(f"== {profile_path.name} ==")
        # Capture top N lines.
        buf.append(f"Top {limit} by cumulative time")
        stats.stream = None  # type: ignore[assignment]

        stream = io.StringIO()
        stats.stream = stream  # type: ignore[assignment]
        stats.print_stats(limit)
        buf.append(stream.getvalue().rstrip())
        sections.append("\n".join(buf))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n\n".join(sections) + "\n")


def _summarize_pg_stats(
        after_path: Path,
        out_path: Path,
        limit: int = 10,
) -> None:
    if not after_path.exists():
        return
    rows: list[dict[str, str]] = []
    with after_path.open("r", encoding="utf-8") as handle:
        header = handle.readline().strip()
        if not header:
            return
        cols = header.split("\t")
        if cols[:5] != ["query", "calls", "total_exec_time", "mean_exec_time", "rows"]:
            return
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            row = dict(zip(cols, parts))
            rows.append(row)

    def as_float(value: str) -> float:
        try:
            return float(value)
        except ValueError:
            return 0.0

    def as_int(value: str) -> int:
        try:
            return int(value)
        except ValueError:
            return 0

    total_time = sum(as_float(r["total_exec_time"]) for r in rows)
    total_calls = sum(as_int(r["calls"]) for r in rows)

    by_total = sorted(rows, key=lambda r: as_float(r["total_exec_time"]), reverse=True)
    by_mean = sorted(rows, key=lambda r: as_float(r["mean_exec_time"]), reverse=True)

    lines = []
    lines.append(f"Total calls: {total_calls}")
    lines.append(f"Total exec time (ms): {total_time:.3f}")
    lines.append("")
    lines.append(f"Top {limit} by total_exec_time (ms)")
    for row in by_total[:limit]:
        lines.append(
            f"{row['total_exec_time']} ms | calls={row['calls']} "
            f"mean={row['mean_exec_time']} ms | {row['query']}"
        )
    lines.append("")
    lines.append(f"Top {limit} by mean_exec_time (ms)")
    for row in by_mean[:limit]:
        lines.append(
            f"{row['mean_exec_time']} ms | calls={row['calls']} "
            f"total={row['total_exec_time']} ms | {row['query']}"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n")



def _coerce_float(value: str | None) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def _coerce_int(value: str | None) -> int:
    if value is None or value == "":
        return 0
    try:
        return int(value)
    except ValueError:
        return 0


def _duration_minute_query(start_iso: str) -> str:
    escaped = start_iso.replace("'", "''")
    return f"""
        SELECT minute_epoch, request_time_s, parse_time_s, upload_time_s, other_time_s, total_time_s
        FROM (
            SELECT
                extract(epoch FROM date_trunc('minute', date_finished))::bigint AS minute_epoch,
                sum(coalesce((metadata->>'request_duration_s')::double precision, 0)) AS request_time_s,
                sum(coalesce((metadata->>'parse_duration_s')::double precision, 0)) AS parse_time_s,
                sum(coalesce((metadata->>'upload_duration_s')::double precision, 0)) AS upload_time_s,
                sum(coalesce((metadata->>'total_duration_s')::double precision, 0)) AS total_time_s,
                sum(coalesce((metadata->>'total_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'request_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'parse_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'upload_duration_s')::double precision, 0))
                  AS other_time_s
            FROM website_index
            WHERE done = TRUE
              AND date_finished >= TIMESTAMP '{escaped}'
            GROUP BY minute_epoch
        ) aggregated
        ORDER BY minute_epoch;
    """


def _worker_stats_query(start_iso: str) -> str:
    escaped = start_iso.replace("'", "''")
    return f"""
        SELECT worker_id, crawls, request_time_s, parse_time_s, upload_time_s, total_time_s
        FROM (
            SELECT
                coalesce(metadata->>'worker_id', 'unknown') AS worker_id,
                count(*) AS crawls,
                sum(coalesce((metadata->>'request_duration_s')::double precision, 0)) AS request_time_s,
                sum(coalesce((metadata->>'parse_duration_s')::double precision, 0)) AS parse_time_s,
                sum(coalesce((metadata->>'upload_duration_s')::double precision, 0)) AS upload_time_s,
                sum(coalesce((metadata->>'total_duration_s')::double precision, 0)) AS total_time_s,
                sum(coalesce((metadata->>'total_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'request_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'parse_duration_s')::double precision, 0))
                  - sum(coalesce((metadata->>'upload_duration_s')::double precision, 0))
                  AS other_time_s
            FROM website_index
            WHERE done = TRUE
              AND date_finished >= TIMESTAMP '{escaped}'
            GROUP BY worker_id
        ) aggregated
        ORDER BY worker_id;
    """


def _normalize_per_minute(rows: list[dict[str, str]]) -> list[dict[str, float | str]]:
    normalized: list[dict[str, float | str]] = []
    for row in rows:
        minute_epoch = _coerce_int(row.get("minute_epoch"))
        minute = datetime.fromtimestamp(minute_epoch).isoformat()
        request = _coerce_float(row.get("request_time_s"))
        parse = _coerce_float(row.get("parse_time_s"))
        upload = _coerce_float(row.get("upload_time_s"))
        total = _coerce_float(row.get("total_time_s"))
        other = max(total - (request + parse + upload), 0.0)
        total = max(total, request + parse + upload + other)
        normalized.append(
            {
                "minute": minute,
                "request_time_s": request,
                "parse_time_s": parse,
                "upload_time_s": upload,
                "other_time_s": other,
                "total_time_s": total,
                "request_pct": request / total if total else 0.0,
                "parse_pct": parse / total if total else 0.0,
                "upload_pct": upload / total if total else 0.0,
                "other_pct": other / total if total else 0.0,
            }
        )
    return normalized


def _collect_query_stats(run_dir: Path) -> list[dict[str, float | int]]:
    logs_dir = run_dir / "worker_logs"
    if not logs_dir.exists():
        return []
    counts: defaultdict[datetime, dict[str, int]] = defaultdict(
        lambda: {"queries": 0, "errors": 0}
    )
    time_fmt = "%Y-%m-%d %H:%M:%S,%f"
    for log_path in sorted(logs_dir.glob("worker-*.log")):
        with log_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if "Crawl succeeded" not in line and "Crawl failed" not in line:
                    continue
                try:
                    timestamp = datetime.strptime(line[:23], time_fmt)
                except ValueError:
                    continue
                minute = timestamp.replace(second=0, microsecond=0)
                counts[minute]["queries"] += 1
                if "Crawl failed" in line:
                    counts[minute]["errors"] += 1
    entries = []
    for minute, data in sorted(counts.items()):
        total = data["queries"]
        errors = data["errors"]
        entries.append(
            {
                "minute": minute.isoformat(),
                "queries": total,
                "errors": errors,
                "error_rate": errors / total if total else 0.0,
            }
        )
    return entries


def _normalize_worker_rows(
    rows: list[dict[str, str]]
) -> tuple[dict[str, dict[str, float | int]], dict[str, float | int]]:
    per_worker: dict[str, dict[str, float | int]] = {}
    percent_acc: list[tuple[float, float, float, float]] = []
    for row in rows:
        worker_id = row.get("worker_id", "unknown")
        request = _coerce_float(row.get("request_time_s"))
        parse = _coerce_float(row.get("parse_time_s"))
        upload = _coerce_float(row.get("upload_time_s"))
        total = _coerce_float(row.get("total_time_s"))
        other = max(total - (request + parse + upload), 0.0)
        total = max(total, request + parse + upload + other)
        percent_acc.append(
            (
                request / total if total else 0.0,
                parse / total if total else 0.0,
                upload / total if total else 0.0,
                other / total if total else 0.0,
            )
        )
        per_worker[worker_id] = {
            "worker_id": worker_id,
            "total_crawls": _coerce_int(row.get("crawls")),
            "request_time_s": request,
            "parse_time_s": parse,
            "upload_time_s": upload,
            "other_time_s": other,
            "total_time_s": total,
            "request_pct": request / total if total else 0.0,
            "parse_pct": parse / total if total else 0.0,
            "upload_pct": upload / total if total else 0.0,
            "other_pct": other / total if total else 0.0,
        }
    if not per_worker:
        return per_worker, {}

    num_workers = len(per_worker)
    avg_totals = {
        "worker_id": "average",
        "total_crawls": sum(
            data["total_crawls"] for data in per_worker.values()
        )
        / num_workers,
        "request_time_s": sum(
            data["request_time_s"] for data in per_worker.values()
        )
        / num_workers,
        "parse_time_s": sum(
            data["parse_time_s"] for data in per_worker.values()
        )
        / num_workers,
        "upload_time_s": sum(
            data["upload_time_s"] for data in per_worker.values()
        )
        / num_workers,
        "other_time_s": sum(
            data["other_time_s"] for data in per_worker.values()
        )
        / num_workers,
        "total_time_s": sum(
            data["total_time_s"] for data in per_worker.values()
        )
        / num_workers,
    }
    avg_percents = tuple(
        sum(values[idx] for values in percent_acc) / num_workers
        for idx in range(4)
    )
    (
        avg_totals["request_pct"],
        avg_totals["parse_pct"],
        avg_totals["upload_pct"],
        avg_totals["other_pct"],
    ) = avg_percents
    return per_worker, avg_totals


def _plot_per_minute(run_dir: Path, per_minute: list[dict[str, float | str]]) -> None:
    if not go or not pio or not per_minute:
        return
    timestamps = [datetime.fromisoformat(entry["minute"]) for entry in per_minute]
    plot_dir = run_dir / "plots"
    plot_dir.mkdir(parents=True, exist_ok=True)

    def _plot(
        title: str,
        y_axis: str,
        suffix: str,
        keys: dict[str, tuple[str, float]],
    ) -> None:
        fig = go.Figure()
        for label, (entry_key, scale) in keys.items():
            fig.add_trace(
                go.Scatter(
                    x=timestamps,
                    y=[entry[entry_key] * scale for entry in per_minute],
                    mode="lines+markers",
                    name=label,
                )
            )
        fig.update_layout(
            title=title,
            xaxis_title="Minute",
            yaxis_title=y_axis,
            template="plotly_white",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        )
        pio.write_html(
            fig,
            plot_dir / suffix,
            include_plotlyjs="cdn",
        )

    _plot(
        "Duration breakdown per minute",
        "Seconds",
        "duration_split_per_minute.html",
        {
            "Request": ("request_time_s", 1.0),
            "Parse": ("parse_time_s", 1.0),
            "Upload": ("upload_time_s", 1.0),
            "Other": ("other_time_s", 1.0),
        },
    )

    _plot(
        "Duration percentage per minute",
        "Percent",
        "duration_percent_per_minute.html",
        {
            "Request": ("request_pct", 100.0),
            "Parse": ("parse_pct", 100.0),
            "Upload": ("upload_pct", 100.0),
            "Other": ("other_pct", 100.0),
        },
    )


def _plot_query_metrics(run_dir: Path, query_stats: list[dict[str, float | int]]) -> None:
    if not go or not pio or not query_stats:
        return
    timestamps = [datetime.fromisoformat(entry["minute"]) for entry in query_stats]
    plot_dir = run_dir / "plots"
    plot_dir.mkdir(parents=True, exist_ok=True)

    fig_queries = go.Figure()
    fig_queries.add_trace(
        go.Scatter(
            x=timestamps,
            y=[entry["queries"] for entry in query_stats],
            mode="lines+markers",
            name="Queries",
        )
    )
    fig_queries.add_trace(
        go.Scatter(
            x=timestamps,
            y=[entry["errors"] for entry in query_stats],
            mode="lines+markers",
            name="Errors",
        )
    )
    fig_queries.update_layout(
        title="Queries per minute",
        xaxis_title="Minute",
        yaxis_title="Count",
        template="plotly_white",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    pio.write_html(
        fig_queries,
        plot_dir / "queries_count.html",
        include_plotlyjs="cdn",
    )

    fig_error_rate = go.Figure()
    fig_error_rate.add_trace(
        go.Scatter(
            x=timestamps,
            y=[entry["error_rate"] * 100 for entry in query_stats],
            mode="lines+markers",
            name="Error rate (%)",
        )
    )
    fig_error_rate.update_layout(
        title="Per-minute error rate",
        xaxis_title="Minute",
        yaxis_title="Error rate (%)",
        template="plotly_white",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    pio.write_html(
        fig_error_rate,
        plot_dir / "error_rate.html",
        include_plotlyjs="cdn",
    )


def _collect_duration_stats(
    run_dir: Path, started_at: str, pg_client: PostgresClient | None
):
    if pg_client is None:
        logging.warning("Postgres unavailable; skipping duration stats.")
        return {}
    per_minute_rows = _fetch_rows(pg_client, _duration_minute_query(started_at))
    per_minute = _normalize_per_minute(per_minute_rows)
    worker_rows = _fetch_rows(pg_client, _worker_stats_query(started_at))
    per_worker, average = _normalize_worker_rows(worker_rows)
    query_stats = _collect_query_stats(run_dir)
    stats = {
        "per_minute": per_minute,
        "per_worker": per_worker,
        "average_per_worker": average,
        "queries_per_minute": query_stats,
    }
    duration_path = run_dir / "duration_summary.json"
    _write_json(duration_path, stats)
    _plot_per_minute(run_dir, per_minute)
    _plot_query_metrics(run_dir, query_stats)


def _reset_queue() -> None:
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "src" / "crawl_cli.py"),
        "--reset",
    ]
    env = os.environ.copy()
    env["CRAWL_RESET_CONFIRM"] = "1"
    subprocess.run(cmd, check=True, env=env)


def _seed_queue(cfg: RunConfig) -> None:
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "src" / "crawl_cli.py"),
        "--seed",
        str(cfg.seed),
        "--setup-only",
    ]
    if cfg.blocked is not None:
        cmd += ["--append-blocked", str(cfg.blocked)]
    subprocess.run(cmd, check=True)


def _parse_args() -> RunConfig:
    parser = argparse.ArgumentParser(description="Benchmark crawl workers")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=Path, required=True)
    parser.add_argument("--append-blocked", dest="blocked", type=Path)
    parser.add_argument("--per-domain-rate-limit-qpm", type=int, default=1)
    parser.add_argument("--runtime-seconds", type=int, default=300)
    parser.add_argument("--storage-type", choices=["local", "gcs"], default="local")
    parser.add_argument("--local-output", type=Path, default=Path("crawler_output"))
    parser.add_argument("--extra-arg", action="append", default=[])
    args = parser.parse_args()
    return RunConfig(
        workers=args.workers,
        seed=args.seed,
        blocked=args.blocked,
        rate_limit_qpm=args.per_domain_rate_limit_qpm,
        runtime_seconds=args.runtime_seconds,
        storage_type=args.storage_type,
        local_output=args.local_output,
        extra_args=args.extra_arg,
        profile_dir=Path("."),
    )


def main() -> int:
    cfg = _parse_args()
    run_dir = ARTIFACTS_ROOT / _now_stamp()
    logs_dir = run_dir / "worker_logs"
    pg_dir = run_dir / "postgres"
    cfg.profile_dir = logs_dir
    print(f"Benchmark artifacts: {run_dir}")

    pg_client = _pg_client_from_env()

    run_meta = {
        "started_at": datetime.now().isoformat(),
        "git_rev": _git_rev(),
        "workers": cfg.workers,
        "seed": str(cfg.seed),
        "seed_sha256": _hash_file(cfg.seed),
        "seed_count": _count_seed_urls(cfg.seed),
        "blocked": str(cfg.blocked) if cfg.blocked else None,
        "blocked_sha256": _hash_file(cfg.blocked) if cfg.blocked else None,
        "rate_limit_qpm": cfg.rate_limit_qpm,
        "runtime_seconds": cfg.runtime_seconds,
        "storage_type": cfg.storage_type,
        "local_output": str(cfg.local_output),
        "extra_args": cfg.extra_args,
        "pg_stat_statements_enabled": _ensure_pg_stat_statements(pg_dir, pg_client),
        "pg_stat_statements_active": _pg_stat_statements_active(pg_client),
    }

    if run_meta["seed_count"] <= cfg.workers:
        raise ValueError(
            f"Seed file must contain more URLs ({run_meta['seed_count']}) than workers "
            f"({cfg.workers})."
        )

    _reset_pg_stat_statements(pg_dir, pg_client)
    _write_json(run_dir / "run.json", run_meta)

    _dump_pg_stat_statements(pg_dir / "pg_stat_statements_before.tsv", pg_client)

    _reset_queue()
    _seed_queue(cfg)

    procs = _start_workers(cfg, logs_dir)
    try:
        time.sleep(cfg.runtime_seconds)
    finally:
        _stop_workers(procs)

    _dump_pg_stat_statements(pg_dir / "pg_stat_statements_after.tsv", pg_client)

    _collect_duration_stats(run_dir, run_meta["started_at"], pg_client)


    _summarize_profiles(logs_dir, run_dir / "profile_summary.txt")
    _summarize_pg_stats(
        pg_dir / "pg_stat_statements_after.tsv",
        run_dir / "pg_summary.txt",
    )


if __name__ == "__main__":
    main()
