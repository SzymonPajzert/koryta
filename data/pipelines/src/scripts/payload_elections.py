"""The candidacies each person's payload carries, for checking stored ones.

`frontend/scripts/migrate/merge-local-runs-stored-twice.ts` folds a local
candidacy stored as „Samorząd” into the named copy of the same run, and it may
only do that where PKW says the person stood once that year: a „Samorząd” copy
beside a named one is just as often the council run beside a mayoral one, and
removing it loses a real candidacy. PKW's word is what the payload would send,
so this writes it out the way the payload builds it (`_extract_elections`),
one line per person:

    {"korytaId": "...", "rejestrIo": ["870160"], "elections": [...]}

`korytaId` is the page `PeopleKorytaMerged` matched the person to, and
`rejestrIo` the register entries, so a script can find the evidence for a page
either way.

Run it over the newest `people_enriched` backup the night wrote:

    B=gs://koryta-pl-sharedcache/filename=people_enriched/user=main
    gcloud storage ls $B/                                   # pick the newest
    gcloud storage cp $B/datetime=<newest>/backup.tar.gz /tmp/
    tar -xzf /tmp/backup.tar.gz -C /tmp people_enriched
    uv run python -m scripts.payload_elections /tmp/people_enriched \
        > /tmp/payload-elections.jsonl

Nothing is downloaded or written but what the commands above say. Over the
2026-10-23 backup (571 MB, 152,724 rows) it took 5 s and wrote 138,909 people.
"""

import json
import sys
import typing
from dataclasses import asdict

from analysis.payloads.person import _extract_elections


def payload_elections(row: typing.Mapping[str, typing.Any]) -> dict | None:
    """One person's line, or None for a row no page can be found by."""
    page = row.get("koryta_id")
    entries = row.get("rejestrio_id") or []
    if isinstance(entries, str):
        entries = [entries]
    if not page and not entries:
        return None
    return {
        "korytaId": page or None,
        "rejestrIo": [str(entry) for entry in entries],
        "elections": [asdict(election) for election in _extract_elections(row)],
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    written = 0
    with open(sys.argv[1]) as people:
        for line in people:
            if not line.strip():
                continue
            out = payload_elections(json.loads(line))
            if out is not None:
                print(json.dumps(out, ensure_ascii=False))
                written += 1
    print(f"{written} people", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
