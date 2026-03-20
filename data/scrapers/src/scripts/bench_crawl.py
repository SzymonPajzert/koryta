#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_ROOT = PROJECT_ROOT / "versioned" / "benchmarks"

SUCCESS_RE = re.compile(r"\[(?P<duration>[0-9.]+)s\] Crawl succeeded: (?P<url>.+)$")
FAIL_RE = re.compile(
    r"\[(?P<duration>[0-9.]+)s\] Crawl failed \((?P<error>.+)\): (?P<url>.+)$"
)


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
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _psql_available() -> bool:
    return shutil.which("psql") is not None


def _pg_env() -> dict[str, str]:
    return {
        "PGHOST": os.getenv("POSTGRESS_HOST", "localhost"),
        "PGDATABASE": os.getenv("POSTGRES_DB", "crawler_db"),
        "PGUSER": os.getenv("POSTGRES_USER", "crawler_user"),
        "PGPASSWORD": os.getenv("POSTGRESS_PASSWORD", "crawler_password"),
        "PGPORT": os.getenv("POSTGRES_PORT", "5432"),
    }


def _psql_query(query: str) -> subprocess.CompletedProcess[str]:
    cmd = [
        "psql",
        "-c",
        query,
        "-P",
        "pager=off",
        "-A",
        "-F",
        "\t",
    ]
    env = os.environ.copy()
    env.update(_pg_env())
    return subprocess.run(cmd, text=True, capture_output=True, env=env)


def _ensure_pg_stat_statements(run_dir: Path) -> bool:
    if not _psql_available():
        return False
    result = _psql_query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")
    out_path = run_dir / "pg" / "pg_stat_statements_setup.txt"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result.stdout + result.stderr)
    return result.returncode == 0


def _reset_pg_stat_statements(run_dir: Path) -> None:
    if not _psql_available():
        return
    result = _psql_query("SELECT pg_stat_statements_reset();")
    out_path = run_dir / "pg" / "pg_stat_statements_reset.txt"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result.stdout + result.stderr)


def _pg_stat_statements_active() -> bool:
    if not _psql_available():
        return False
    result = _psql_query("SHOW shared_preload_libraries;")
    libs = result.stdout.strip()
    return "pg_stat_statements" in libs


def _dump_pg_stat_statements(out_path: Path) -> None:
    if not _psql_available():
        return
    query = (
        "SELECT replace(query, E'\\n', ' ') AS query, "
        "calls, total_exec_time, mean_exec_time, rows "
        "FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 50;"
    )
    result = _psql_query(query)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result.stdout)


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
        "--profile",
        "--profile-out",
        str(cfg.profile_dir / f"worker-{idx}.pstats"),
        "--metrics-out",
        str(cfg.profile_dir / f"worker-{idx}.metrics.json"),
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


def _summarize_durations(durations: list[float]) -> dict:
    durations.sort()
    if durations:
        p95 = durations[int(0.95 * (len(durations) - 1))]
        avg = sum(durations) / len(durations)
    else:
        p95 = None
        avg = None
    return {
        "avg_duration_s": avg,
        "p95_duration_s": p95,
    }


def _summarize_logs(logs_dir: Path) -> dict:
    aggregate_successes = 0
    aggregate_failures = 0
    aggregate_durations: list[float] = []
    aggregate_timing = {
        "request_time_s": 0.0,
        "parse_time_s": 0.0,
        "upload_time_s": 0.0,
        "other_time_s": 0.0,
        "total_runtime_s": 0.0,
    }
    per_worker: dict[str, dict] = {}

    for log_path in sorted(logs_dir.glob("worker-*.log")):
        successes = 0
        failures = 0
        durations: list[float] = []
        for line in log_path.read_text(encoding="utf-8").splitlines():
            match = SUCCESS_RE.search(line)
            if match:
                successes += 1
                durations.append(float(match.group("duration")))
                continue
            match = FAIL_RE.search(line)
            if match:
                failures += 1
                durations.append(float(match.group("duration")))
        aggregate_successes += successes
        aggregate_failures += failures
        aggregate_durations.extend(durations)

        worker_stats = {
            "successes": successes,
            "failures": failures,
            "total": successes + failures,
        }
        if worker_stats["total"] > 0:
            worker_stats["error_rate"] = worker_stats["failures"] / worker_stats["total"]
        else:
            worker_stats["error_rate"] = None
        worker_stats.update(_summarize_durations(durations))
        metrics_path = log_path.with_suffix(".metrics.json")
        if metrics_path.exists():
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            worker_stats["timing"] = metrics
            aggregate_timing["request_time_s"] += metrics.get("request_time_s", 0.0)
            aggregate_timing["parse_time_s"] += metrics.get("parse_time_s", 0.0)
            aggregate_timing["upload_time_s"] += metrics.get("upload_time_s", 0.0)
            aggregate_timing["other_time_s"] += metrics.get("other_time_s", 0.0)
            aggregate_timing["total_runtime_s"] += metrics.get("total_runtime_s", 0.0)
        per_worker[log_path.stem] = worker_stats

    aggregate_stats = {
        "successes": aggregate_successes,
        "failures": aggregate_failures,
        "total": aggregate_successes + aggregate_failures,
    }
    if aggregate_stats["total"] > 0:
        aggregate_stats["error_rate"] = aggregate_stats["failures"] / aggregate_stats["total"]
    else:
        aggregate_stats["error_rate"] = None
    aggregate_stats.update(_summarize_durations(aggregate_durations))
    if aggregate_timing["total_runtime_s"] > 0:
        aggregate_timing["request_time_pct"] = (
            aggregate_timing["request_time_s"] / aggregate_timing["total_runtime_s"]
        )
        aggregate_timing["parse_time_pct"] = (
            aggregate_timing["parse_time_s"] / aggregate_timing["total_runtime_s"]
        )
        aggregate_timing["upload_time_pct"] = (
            aggregate_timing["upload_time_s"] / aggregate_timing["total_runtime_s"]
        )
        aggregate_timing["other_time_pct"] = (
            aggregate_timing["other_time_s"] / aggregate_timing["total_runtime_s"]
        )
    aggregate_stats["timing"] = aggregate_timing

    return {
        "aggregate": aggregate_stats,
        "per_worker": per_worker,
    }


def _summarize_profiles(profile_dir: Path, out_path: Path, limit: int = 25) -> None:
    try:
        import pstats
    except ImportError:
        return

    sections: list[str] = []
    for profile_path in sorted(profile_dir.glob("worker-*.pstats")):
        stats = pstats.Stats(str(profile_path))
        stats.strip_dirs().sort_stats("cumtime")
        buf: list[str] = []
        buf.append(f"== {profile_path.name} ==")
        # Capture top N lines.
        buf.append(f"Top {limit} by cumulative time")
        stats.stream = None  # type: ignore[assignment]
        import io

        stream = io.StringIO()
        stats.stream = stream  # type: ignore[assignment]
        stats.print_stats(limit)
        buf.append(stream.getvalue().rstrip())
        sections.append("\n".join(buf))

    if sections:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("\n\n".join(sections) + "\n")


def _summarize_pg_stats(
    after_path: Path,
    out_path: Path,
    summary: dict | None = None,
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

    if summary is not None and "per_worker" in summary:
        lines.append("")
        lines.append("Per-worker crawl summary")
        for worker, stats in summary["per_worker"].items():
            lines.append(
                f"{worker}: total={stats['total']} success={stats['successes']} "
                f"failures={stats['failures']} error_rate={stats['error_rate']} "
                f"avg={stats['avg_duration_s']} p95={stats['p95_duration_s']}"
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n")


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
    logs_dir = run_dir / "workers"
    pg_dir = run_dir / "pg"
    cfg.profile_dir = logs_dir
    print(f"Benchmark artifacts: {run_dir}")

    run_meta = {
        "started_at": datetime.now().isoformat(),
        "git_rev": _git_rev(),
        "workers": cfg.workers,
        "seed": str(cfg.seed),
        "seed_sha256": _hash_file(cfg.seed),
        "blocked": str(cfg.blocked) if cfg.blocked else None,
        "blocked_sha256": _hash_file(cfg.blocked) if cfg.blocked else None,
        "rate_limit_qpm": cfg.rate_limit_qpm,
        "runtime_seconds": cfg.runtime_seconds,
        "storage_type": cfg.storage_type,
        "local_output": str(cfg.local_output),
        "extra_args": cfg.extra_args,
    }
    seed_count = _count_seed_urls(cfg.seed)
    run_meta["seed_count"] = seed_count
    if seed_count < 8:
        raise ValueError(
            f"Seed file must contain at least 8 URLs, got {seed_count}."
        )
    if seed_count <= cfg.workers:
        raise ValueError(
            f"Seed file must contain more URLs ({seed_count}) than workers "
            f"({cfg.workers})."
        )
    run_meta["runtime_seconds"] = cfg.runtime_seconds
    run_meta["pg_stat_statements_enabled"] = _ensure_pg_stat_statements(run_dir)
    run_meta["pg_stat_statements_active"] = _pg_stat_statements_active()
    _reset_pg_stat_statements(run_dir)
    _write_json(run_dir / "run.json", run_meta)

    _dump_pg_stat_statements(pg_dir / "pg_stat_statements_before.tsv")

    _reset_queue()
    _seed_queue(cfg)

    procs = _start_workers(cfg, logs_dir)
    try:
        time.sleep(cfg.runtime_seconds)
    finally:
        _stop_workers(procs)

    _dump_pg_stat_statements(pg_dir / "pg_stat_statements_after.tsv")

    summary = _summarize_logs(logs_dir)
    runtime_seconds = cfg.runtime_seconds
    if runtime_seconds > 0:
        summary["aggregate"]["throughput_per_s"] = (
            summary["aggregate"]["total"] / runtime_seconds
        )
        for worker_stats in summary["per_worker"].values():
            worker_stats["throughput_per_s"] = (
                worker_stats["total"] / runtime_seconds
            )
    summary["finished_at"] = datetime.now().isoformat()
    _write_json(run_dir / "summary.json", summary)
    _summarize_profiles(logs_dir, run_dir / "profile_summary.txt")
    _summarize_pg_stats(
        pg_dir / "pg_stat_statements_after.tsv",
        run_dir / "pg_summary.txt",
        summary=summary,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
