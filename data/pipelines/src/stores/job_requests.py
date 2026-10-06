"""Runs somebody asked for on koryta.pl, waiting for a machine to do them.

A button on a company's or a person's page (the datascience group's) does not
run anything itself: the site has no Python and no data. It writes a run, in
the same `jobRuns` collection the jobs report to, in state `queued`, with what
was asked under `request`:

    jobRuns/{runId} = {
        job: "people_request", state: "queued", trigger: "request",
        startedAt: <when it was asked>, title, link, ...,
        request: {target: "company" | "person", nodeId, name, krs, rejestrIo,
                  dryRun, by, byName, at},
    }

so /admin/procesy shows it at once, "w kolejce", under the id the person who
asked was given a link to. A worker (`jobs.requests`) takes the queued runs one
at a time - `claim` makes sure only one ever does - and the job it starts
reports on that same document (`JobRun(..., adopt=True)`), so the link follows
the run to its end. The site's half is frontend/server/utils/jobRequests.ts;
the field names here are its contract.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from stores.job_runs import (
    ERROR_CHARS,
    JOB_RUNS_COLLECTION,
    make_client,
)

#: The jobs the site can ask for, by the id their runs report under.
PEOPLE_REQUEST = "people_request"
REQUEST_JOBS = (PEOPLE_REQUEST,)

Target = Literal["company", "person"]
TARGETS: tuple[Target, ...] = ("company", "person")

#: A rejestr.io person link's number: `https://rejestr.io/osoby/383093/jan-k`.
_REGISTER_NUMBER = re.compile(r"osoby/(\d+)")


class RequestError(ValueError):
    """A queued run that says nothing a job can do."""


@dataclass(frozen=True)
class Request:
    """What the site was asked, as the job needs it."""

    run_id: str
    job: str
    target: Target
    #: The page the button was on.
    node_id: str
    name: str
    #: A company: its KRS number, zero-padded as the employments carry it.
    krs: str | None = None
    #: A person: their page's rejestr.io link, if it has one.
    rejestr_io: str | None = None
    #: Build and count, send nothing.
    dry_run: bool = False
    #: The uid of whoever asked.
    by: str | None = None

    @property
    def register_number(self) -> str | None:
        """The rejestr.io person number of the page's link."""
        return register_number(self.rejestr_io)

    def describe(self) -> str:
        if self.target == "company":
            return f"firma {self.name} (KRS {self.krs}, strona {self.node_id})"
        return f"osoba {self.name} (strona {self.node_id})"


def register_number(link: object) -> str | None:
    """`383093` from `https://rejestr.io/osoby/383093/jan-kowalski`, the form
    `Extract --rejestrio-id` and the employment records use."""
    if not isinstance(link, str):
        return None
    match = _REGISTER_NUMBER.search(link)
    return match.group(1) if match else None


def padded_krs(value: object) -> str | None:
    """A KRS number as the ten-character string the employments carry: a
    page's `krsNumber` is whatever somebody typed into it."""
    if value is None:
        return None
    digits = re.sub(r"\D", "", str(value))
    if not digits or len(digits) > 10:
        return None
    return digits.zfill(10)


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def parse_request(run_id: str, data: dict[str, Any] | None) -> Request:
    """The request a run's document holds; `RequestError` when it holds none
    a job could act on."""
    if not data:
        raise RequestError(f"no run {run_id}")
    job = data.get("job")
    if job not in REQUEST_JOBS:
        raise RequestError(f"{run_id}: {job!r} is not a job the site can ask for")
    asked = data.get("request")
    if not isinstance(asked, dict):
        raise RequestError(f"{run_id}: no request")
    target = asked.get("target")
    if target not in TARGETS:
        raise RequestError(f"{run_id}: unknown target {target!r}")
    node_id = _text(asked.get("nodeId"))
    if not node_id:
        raise RequestError(f"{run_id}: no page named")
    krs = padded_krs(asked.get("krs"))
    if target == "company" and krs is None:
        raise RequestError(f"{run_id}: the company has no KRS number")
    return Request(
        run_id=run_id,
        job=str(job),
        target=target,
        node_id=node_id,
        name=_text(asked.get("name")) or node_id,
        krs=krs,
        rejestr_io=_text(asked.get("rejestrIo")),
        dry_run=asked.get("dryRun") is True,
        by=_text(asked.get("by")),
    )


def _ref(client: Any, run_id: str) -> Any:
    return client.collection(JOB_RUNS_COLLECTION).document(run_id)


def read_request(run_id: str, client: Any | None = None) -> Request:
    """The request of the run `run_id`."""
    client = client or make_client()
    snapshot = _ref(client, run_id).get()
    return parse_request(run_id, snapshot.to_dict() if snapshot.exists else None)


def _started(data: dict[str, Any]) -> str:
    value = data.get("startedAt")
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(value or "")


def queued_requests(client: Any, limit: int = 50) -> list[tuple[str, dict]]:
    """Queued runs of the jobs the site can ask for, oldest first, as (id,
    document). Only these are ever queued in `jobRuns`: a capture waits in
    `articlePages`, and a job that runs reports `running` from its start."""
    from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: PLC0415

    query = (
        client.collection(JOB_RUNS_COLLECTION)
        .where(filter=FieldFilter("state", "==", "queued"))
        .limit(limit)
    )
    found = [
        (snapshot.id, snapshot.to_dict() or {})
        for snapshot in query.stream()
        if (snapshot.to_dict() or {}).get("job") in REQUEST_JOBS
    ]
    return sorted(found, key=lambda pair: (_started(pair[1]), pair[0]))


def claim(client: Any, run_id: str, *, host: str, now: datetime) -> bool:
    """Take a queued run on, unless somebody else already has; whether it is
    ours. The update is made on the condition that the document is as it was
    read, so of two workers reading it at once only one's lands."""
    from google.api_core.exceptions import (  # noqa: PLC0415
        Aborted,
        FailedPrecondition,
        NotFound,
    )

    ref = _ref(client, run_id)
    snapshot = ref.get()
    if not snapshot.exists or (snapshot.to_dict() or {}).get("state") != "queued":
        return False
    try:
        ref.update(
            {
                "state": "running",
                "host": host,
                "heartbeatAt": now,
                "claimedAt": now,
                "phase": "start",
            },
            option=client.write_option(last_update_time=snapshot.update_time),
        )
    except (FailedPrecondition, Aborted, NotFound):
        return False
    return True


def end_open_run(
    client: Any,
    run_id: str,
    *,
    state: Literal["succeeded", "partial", "failed"] = "failed",
    reason: str,
    errors: Iterable[str] = (),
    exit_code: int | None = None,
    now: datetime,
) -> bool:
    """End a run nobody else will end - its job died before it could say how
    it went, could not report, or never started. Whether it was still open:
    one its job ended is left as the job ended it."""
    ref = _ref(client, run_id)
    snapshot = ref.get()
    if not snapshot.exists:
        return False
    if (snapshot.to_dict() or {}).get("state") not in ("queued", "running"):
        return False
    ref.update(
        {
            "state": state,
            "finishedAt": now,
            "heartbeatAt": now,
            "stopReason": reason[:200],
            "errors": [str(error)[:ERROR_CHARS] for error in errors][:20],
            "exitCode": exit_code,
        }
    )
    return True


def running_on(client: Any, host: str, limit: int = 50) -> list[str]:
    """Runs of the asked-for jobs that say they are going on `host`."""
    from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: PLC0415

    query = (
        client.collection(JOB_RUNS_COLLECTION)
        .where(filter=FieldFilter("state", "==", "running"))
        .where(filter=FieldFilter("host", "==", host))
        .limit(limit)
    )
    return [
        snapshot.id
        for snapshot in query.stream()
        if (snapshot.to_dict() or {}).get("job") in REQUEST_JOBS
    ]
