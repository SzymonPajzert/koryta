from __future__ import annotations

import tarfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from scrapers.article.parse_runner import run_parse
from scrapers.article.selectors import load_selector_map
from scrapers.stores import BlockedDomain, CrawlQueue, DoneUrl, NewUrl


def _load_tar(tar_path_str: str, selector_hosts: set[str]) -> list[tuple[str, DoneUrl]]:
    tar_path = Path(tar_path_str)
    host = tar_path.name.split("hostname=")[1].split(".from=")[0].split(".total")[0]
    if host not in selector_hosts:
        return []
    out: list[tuple[str, DoneUrl]] = []
    try:
        with tarfile.open(tar_path) as tf:
            idx = tf.extractfile("index.txt")
            if idx is None:
                return []
            for i, raw in enumerate(idx):
                line = raw.decode("utf-8", "replace").strip()
                if not line or not line.startswith("hostname="):
                    continue
                prefix = line.rsplit("/date=", 1)[0]
                if not prefix.startswith("hostname="):
                    continue
                url = "https://" + prefix[len("hostname="):]
                out.append(
                    (
                        url,
                        DoneUrl(f"{host}:{i}", url, f"{tar_path}::{line}", "text/html"),
                    )
                )
    except tarfile.ReadError:
        return []
    return out


def main() -> None:
    selectors = load_selector_map(Path("domain_selectors_semiverified.json"))
    root = Path("downloaded")
    tars = [p for p in sorted(root.glob("*.tar.gz")) if p.name.startswith("hostname=")]
    selector_hosts = set(selectors)

    rows: list[DoneUrl] = []
    seen: set[str] = set()
    with ProcessPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_load_tar, str(p), selector_hosts) for p in tars]
        for fut in as_completed(futures):
            for url, row in fut.result():
                if url in seen:
                    continue
                seen.add(url)
                rows.append(row)

    host_count = len({r.url.split("/")[2] for r in rows})
    print(f"loaded {len(rows)} URLs across {host_count} hosts", flush=True)

    class StaticQueue(CrawlQueue):
        def __init__(self, rows: list[DoneUrl]) -> None:
            self._rows = rows

        def put(self, urls: list[NewUrl]) -> None:
            raise NotImplementedError()

        def get(
            self, worker_id: str, max_retries: int = 3, timeout_seconds: float = 60
        ):
            raise NotImplementedError()

        def mark_done(
            self,
            uid: str,
            storage_path: str | None,
            metadata: dict[str, object] | None = None,
        ) -> None:
            raise NotImplementedError()

        def mark_error(self, uid: str, error: str) -> None:
            raise NotImplementedError()

        def release(self, uid: str) -> None:
            raise NotImplementedError()

        def add_blocked_domains(self, rows: list[BlockedDomain]) -> None:
            raise NotImplementedError()

        def get_blocked_domains(self) -> set[str]:
            raise NotImplementedError()

        def reprioritize(
            self, priority_fn, batch_size: int = 5000
        ) -> None:
            raise NotImplementedError()

        def get_done_urls(self, limit: int | None = None) -> list[DoneUrl]:
            return self._rows

        def reset(self) -> None:
            raise NotImplementedError()

    run_parse(
        StaticQueue(rows),
        None,
        parse_limit=len(rows),
        worker_processes=32,
        selectors_file=Path("domain_selectors_semiverified.json"),
    )


if __name__ == "__main__":
    main()
