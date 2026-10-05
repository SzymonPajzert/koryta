"""Writing what the register answered to `RESPONSE_LOG`, a part at a time."""

import gzip
from collections.abc import Callable

from scrapers.krs.register import RESPONSE_LOG, RegisterRead

#: Reads per part: ~500 odpisy is ~1 MB gzipped and about four minutes at the
#: polite pace, which is the most a hard kill can lose.
FLUSH_EVERY = 500


class ResponseLog:
    """Buffers reads and writes each batch as one new, never-rewritten part.

    `put(name, data)` writes an object that must not exist yet and raises if it
    cannot - `stores.storage.Client.create_object` in a real run. A part that
    fails to write stays pending, so the next flush tries it again under the
    same name rather than dropping it.
    """

    def __init__(
        self, put: Callable[[str, bytes], str], run: str, flush_every: int = FLUSH_EVERY
    ):
        self.put = put
        self.run = run
        self.flush_every = flush_every
        self.pending: list[RegisterRead] = []
        self.written: list[str] = []
        self.reads_written = 0

    def add(self, read: RegisterRead) -> None:
        self.pending.append(read)
        if len(self.pending) >= self.flush_every:
            self.flush()

    def part_name(self) -> str:
        date = self.pending[0].read_at[:10]
        seq = len(self.written)
        return f"{RESPONSE_LOG.prefix}date={date}/{self.run}-{seq:05d}.jsonl.gz"

    def flush(self) -> str | None:
        if not self.pending:
            return None
        lines = "".join(read.to_line() + "\n" for read in self.pending)
        # mtime=0 so a retried flush sends the same bytes as the first try,
        # which is how `create_object` recognises a write that did land.
        data = gzip.compress(lines.encode("utf-8"), mtime=0)
        url = self.put(self.part_name(), data)
        self.written.append(url)
        self.reads_written += len(self.pending)
        self.pending = []
        return url
