"""The run record: every attempt a crawl made, written to the shared cache.

The PDFs themselves are the job's output, in the crawl bucket. This is what
they do not say: which companies a run asked about and why, which came back,
which were not in either register, which the gateway or the network ate, and
how long each took. One gzipped jsonl part per `FLUSH_EVERY` attempts, written
once and never rewritten, under `RUN_LOG` -- the layout `krs_register_owners`
keeps its answers in. `KrsOdpisAttempts` folds it back into each company's
newest attempt, which is how the paid job knows where the free odpis failed.
"""

import gzip
import json
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime

from jobs.krs_odpis.crawl import Outcome
from scrapers.krs.odpis_attempts import RUN_LOG
from stores.storage import warsaw_tz

#: Attempts per part: ~1,000 is about half an hour at the polite pace, which is
#: the most a hard kill can lose.
FLUSH_EVERY = 1000


class RunLog:
    """Buffers attempts and writes each batch as one new, never-rewritten part.

    `put(name, data)` writes an object that must not exist yet and raises if it
    cannot -- `stores.storage.Client.create_object` in a real run. A part that
    fails to write stays pending, so the next flush tries it again under the
    same name rather than dropping it.
    """

    def __init__(
        self,
        put: Callable[[str, bytes], str],
        run: str,
        flush_every: int = FLUSH_EVERY,
        now: Callable[[], datetime] = lambda: datetime.now(warsaw_tz),
    ):
        self.put = put
        self.run = run
        self.flush_every = flush_every
        self.now = now
        self.pending: list[tuple[str, Outcome]] = []
        self.written: list[str] = []
        self.attempts_written = 0

    def add(self, outcome: Outcome) -> None:
        self.pending.append((self.now().isoformat(timespec="seconds"), outcome))
        if len(self.pending) >= self.flush_every:
            self.flush()

    def part_name(self) -> str:
        day = self.pending[0][0][:10]
        return f"{RUN_LOG.prefix}date={day}/{self.run}-{len(self.written):05d}.jsonl.gz"

    def flush(self) -> str | None:
        if not self.pending:
            return None
        lines = "".join(
            json.dumps({"run": self.run, "at": at, **asdict(o)}, ensure_ascii=False)
            + "\n"
            for at, o in self.pending
        )
        # mtime=0 so a retried flush sends the same bytes as the first try,
        # which is how `create_object` recognises a write that did land.
        url = self.put(self.part_name(), gzip.compress(lines.encode("utf-8"), mtime=0))
        self.written.append(url)
        self.attempts_written += len(self.pending)
        self.pending = []
        return url
