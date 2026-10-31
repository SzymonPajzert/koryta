"""Keep the people on koryta.pl current: build their payloads and upload them, daily.

`PeoplePayloads` works out what the site should say about everybody it already
has a page for, from the newest crawl and the morning's export, and keeps the
people whose page that would change. This sends those to `/api/ingest/person`,
as

    koryta PeoplePayloads --all --on-koryta --only-changed |
        koryta_uploader --type person --submit --endpoint https://autopush.koryta.pl

does - but in one process, unattended, and with guardrails a pipe has not got:

    koryta_people_import                   # daily on Cloud Run, jobs/CLOUD_RUN.md
    koryta_people_import --dry-run         # build and count them; send nothing
    koryta_people_import --scope not-on-koryta --max-new 50
    koryta_people_import --scope not-on-koryta --max-new 50 --company-category obronnosc
                                           # a sector's people the site lacks
    koryta_people_import --scope priority --max-uploads 100   # the nightly VM
    koryta_people_import --scope priority --max-uploads 100 --companies-only
                                           # the companies those 100 need, first
    koryta_people_import --scope priority --max-uploads 500 \\
        --priority-group skarb-panstwa:100:new=50
                                           # the Treasury's companies' people
                                           # first, out of 100 of their own
    koryta_people_import --request <run id>   # what a page's button asked for

`--request` is a run the datascience group asked for from a company's or a
person's page on the site (`stores.job_requests`): the company's people, or the
person, built as the other scopes build them and kept to the same guards
(`analysis.payloads.target`). It reports as `people_request`, under the id of
the run the site queued, so the link the site handed out follows it to its end.
A company's run creates pages for the company's people the site lacks, and
only those; a person's run creates none.

`--company-category` keeps an `on-koryta` or `not-on-koryta` run to one
sector's people: those in a post now, any post, at a public company
`entities.company_categories` files under it - the same rule that puts the
category on the company's page, so the pages a `not-on-koryta` run of a
sector makes are the ones its filter on the site lists, once the companies
carry it. Public, as the night's tiers are: a sector's codes reach the
private firms in it too, and the site is about public posts. Asked for on
2026-10-20 to put the whole defence sector (`obronnosc`) on the site at once,
for the volunteers checking it first, rather than at the fifty a night the
priority run's `rejestrio_current` tier makes of everybody in a public post.

`--companies-only` sends no people. It plans as a priority run with the same
flags plans, and creates the companies the people that run would send name
and the export has no page for (`CompaniesFirst`): the night's step before its
people, so that they find every page there.

`--scope priority` builds both halves at once and sends, up to the cap, the
new hires the site lacks first, then the pages of the people whose rejestr.io
feed was bought in the last `--bought-days` days, then the pages with a note
no admin has closed - on the page, or on a company the payload names - those
saying data is missing first, then a few of the people the site lacks in a
public post that is not new - those only an odpis names, then those with a
rejestr.io entry - then the published pages that would change, then the
rest, newest news first in each (`analysis.payloads.priority`). The
notes are this morning's export's, as the pages are. It leaves alone a payload
it already sent unchanged in the last `--resend-after` days: an update a
reviewer has not yet approved, or a party a human took off a page, still reads
as a change against the export, and sent every night it would take a slot each
night and undo the human each time. Not a payload the site took without a job
for want of a page for its company - a company the uploader could not create:
that one goes again the next night, as a refused one does, until the job is
on the page (`remembered`).

Of the new hires, the people only an odpis names - no rejestr.io entry, so the
ingest finds them by their name and birth date alone - take at most a tenth of
the run (`--max-new-odpis-only`). Planned over the 2026-10-09 night's data,
the first plan to let them in, they were 109 of 118 new hires, a month of them
at once, and took every one of the 100 slots from the bought, noted and
published pages behind them. A tenth also keeps the pages made this way few
enough to check by hand the morning after; it grows with `--max-uploads`.

The people only an odpis names who hold a public post now that is not new -
980 on 2026-10-11 - take at most `--max-odpis-only-current` a run: ten, as
Szymon set it that day. A number rather than a share of the run: it is how
many pages there are to check by hand the next morning, which sending more
updates a night does not change. Their pages and the new hires' count against
`--max-new` together, and a page made for one of them is one the run is meant
to make, as a new hire's is.

So do the pages of the people with a rejestr.io entry who hold a public post
now that is not new: 13,518 on 2026-10-16, against 89 new hires that day, and
before then no run made a page for any of them. They take at most
`--max-rejestrio-current` a run: fifty, as Szymon set it that day, in any
post at a public company - "count employed in any way". A number rather than
a share of the run, as the odpis-only cap is, so that sending more updates a
night makes no more pages; and behind those people, whose pages are checked
by hand the next morning.

The pages the export shows as published take at most `--max-published` of a
run, whatever tier puts them in it: the bought and the noted count as much as
the published. A change to a published page is what readers see, or a
proposal waiting for a reviewer, and a change to the code that builds the
payloads can make many of them read as changed at once. The cap, Szymon's of
2026-10-15, keeps one night from leaving more of them to review than that.
The nights of 2026-10-10 to 10-14 changed 45 to 87 published pages each, of
the 100 they sent, and 33 to 49 of those were bought or noted. Past the cap
they are left to the next runs, and the run goes on to the pages behind them.
Without it a run changes as many as `--max-uploads` lets it.

A priority group (`--priority-group`, `entities.priority_groups`) is a
category's companies, whose people in a post now go right after the noted
pages, out of a budget of the group's own: so many sent, at most so many of
those pages to create. Szymon, 2026-10-27, for the companies the Treasury holds a stake
in: "if a person payload is uploaded for a higher priority group, it doesn't
count against a lower priority group". So a member sent for a group takes
nothing of `--max-rejestrio-current`, `--max-odpis-only-current` or
`--max-published`, and only `--max-new`, every page the run creates, is
shared. The run still sends `--max-uploads` in all: the groups come before
the backlog, which is what they displace. Only drafts to change and pages to
make for people in an older public post go for a group; a published page and
somebody only an odpis names keep the run's caps, which are a reviewer's and
a hand check's (`plan_priority`). Replayed on the night of 2026-10-28, on its
own outputs - the plan came to its 7,409 - 1,504 people held a post at one of
the Treasury's 317 companies, 981 of them waiting for a page. The night sent
35 of them, 17 new pages; a group of 100 with new=50 sends 103, 50 new, and
one of 150 with new=100 sends 153, 100 new. The rest of the 500 goes as
before, less as many drafts to change.

Two groups are not a category's: the people the BIP crawler's people mode
found an oświadczenie majątkowe for, by the newest list `koryta_scrape_bip
found` left in the shared cache (`stores.bip_found`). Szymon, 2026-10-31,
drafts first: `oswiadczenia-szkice` sends the unpublished pages with no birth
date - the night's payload dates them, and the readers of /oswiadczenia can
settle a crop only against a page that shows one - and `oswiadczenia-bez-strony`
makes pages for the people with none, in a public post now or in one that
ended. Somebody whose public post ended is in a tier of their own
(`DECLARED`), which nothing but that group sends, since no other tier makes a
page for anybody in no public post now; somebody the register knows from
private companies alone is not sent.
Replayed on the night of 2026-10-31, on its own outputs and the crawl's list of
that morning (8,143 candidacies found): 411 drafts with no birth date, and
1,719 people with no page - 405 in a public post now and 1,312 in one that
ended, against 1,032 the register knows from private companies alone - which
empties the drafts after 3 nights at 200 and the rest after 18 at
200:new=100, 9 at 300:new=200, with no inflow. 908 more with no page had no
rejestr.io entry on the list, which no id finds. The groups' sends come out
of `--max-uploads` as any group's do: at 800 the 400 left the published pages
none of their 76 and the run's own rejestr.io pages 84 of 200; at 1,200 every
tier of the run's own kept what it sent that night.

    koryta_people_import --scope priority --max-uploads 1200 \\
        --priority-group skarb-panstwa:200:new=100 \\
        --priority-group oswiadczenia-szkice:200 \\
        --priority-group oswiadczenia-bez-strony:200:new=100

Once the drafts to change run out - late November 2026 at 500 a night - every
tier left has a cap: the 2026-10-28 plan without them sends 214.
`--fill-rejestrio-current` gives the slots left to the people with a
rejestr.io entry in an older public post past their cap: never to published
pages or to the people only an odpis names.

What was bought is read off the crawl bucket, which files every rejestr.io
answer under the day it was bought, whoever bought it (`bought_since`). A week
of it rather than the day, so that a feed a hand run bought after the night's
upload, or one bought on a night whose people step was held, still goes first
the night after; a page whose payload went up since is left alone as sent.

A run builds the payloads (phase "paczki"), writes them to the shared cache as
one write-once part - `jobs/people_import/payloads/date=<day>/<run>.jsonl.gz`,
so that what any day sent can be read back without diffing two exports, which
is what the audit of the 2026-09-12 upload had to do - and then sends them one
by one ("wysyłanie"), at the uploader's pace.

Before it builds anything it finds the export the payloads will be compared
with - who has a page, and what each page holds (`SNAPSHOT`) - and refuses,
as failed, unless the newest finished export was taken today at 04:00 Warsaw
time or later. Compared with an older one, `--only-changed` sends again what
the last night's run put up, and `--scope not-on-koryta` creates again the
pages it created. The night says which export its own export step took
(`--export`), and its run takes that one, or a newer, in place of the rule,
so the two never judge one export differently. A frame of the export on disk
that is not built from the one compared with - cached under today's name
between midnight and four, from the export before; or the morning's, after
an export taken by hand later in the day - is rebuilt, whatever `--refresh`
says (`PeopleImport.check_export`).

It stops itself as failed on the two things that mean the site is not taking
what it should:

- more pages created than `--max-new` allows, which is none unless asked. A
  person an `--on-koryta` run creates is somebody the identity lookup missed,
  a second page for somebody already there: that is how 105 namesake pages
  appeared on 2026-09-12, and the run stops at the first rather than at the
  hundred and fifth;
- `MAX_REFUSED_IN_A_ROW` requests in a row refused: the site is down, or will
  not take this account.

And as partial - the rest is the next day's, since `--only-changed` still finds
it changed - at `--max-uploads`, at `--max-minutes`, on SIGTERM once the person
in hand is done, and on Ctrl+C.

Exit codes: 0 when everything planned was sent and taken; 75 when something is
left for the next run (a limit, the deadline, SIGTERM, Ctrl+C, a few refused
people); 1 for a crash, a guardrail stop or an export too old to compare
with. Each run writes a summary to gs://koryta-pl-sharedcache/jobs/people_import/runs/
and reports how it is going to koryta.pl/admin/procesy (`stores.job_runs`) - a
dry run too, so that a trial week shows there what each day would have sent.

It signs in as `stores.koryta_login` decides; in production through
`KORYTA_PIPELINE_UID`, so the revisions it files count as a robot's.
"""

import argparse
import gzip
import hashlib
import json
import os
import signal
import sys
import time
import typing
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, date, datetime, timedelta

from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from analysis.payloads.priority import (
    AHEAD_OF_GROUPS,
    DECLARED,
    GROUPED,
    NEW_HIRE,
    ODPIS_ONLY_CURRENT,
    REJESTRIO_CURRENT,
    TIERS,
)
from analysis.payloads.target import NEW, PageTarget
from entities.company_categories import CATEGORY_VALUES
from entities.priority_groups import (
    DECLARATION_GROUPS,
    Declared,
    Group,
    parse_group,
    repeated,
)
from jobs.nightly import export_refusal, export_time, latest_export
from jobs.people_import.payloads import (
    PRIORITY,
    REQUEST,
    SCOPES,
    Candidate,
    build_payloads,
    build_priority,
    build_targeted,
    pipeline_names,
)
from scrapers.koryta.created import SENT_LOG
from scrapers.koryta.download import KorytaEdges, KorytaExport, KorytaNodes
from scrapers.krs.coverage import parse_person_connections_url
from scrapers.stores import Pipeline, ProcessPolicy
from stores.bip_found import FOUND_PREFIX, newest_found
from stores.config import VERSIONED_DIR, pesel_salt
from stores.job_requests import PEOPLE_REQUEST, Request, read_request
from stores.job_runs import ERROR_CHARS, ERRORS_KEPT, FinalState, JobRun
from stores.koryta_login import TokenSource, token_source
from stores.storage import (
    CRAWLED_BUCKET,
    LISTING_FIELDS,
    SHARED_BUCKET,
    Client,
    warsaw_tz,
)
from uploader import (
    PERSON_COUNTERS,
    Args,
    PersonResult,
    PersonUploader,
    failure_reason,
    one_line,
    run_state,
)

JOB = "people_import"
UNIT = "osób"
#: What a `--companies-only` run reports as: the job `koryta_uploader --type
#: company` reports as, so that a hand upload and the night's read as one
#: history, as the people's do.
COMPANY_JOB = "company_import"
COMPANY_UNIT = "firm"

PAYLOADS_PREFIX = "jobs/people_import/payloads/"
RUNS_PREFIX = "jobs/people_import/runs/"
#: Where a `--companies-only` run writes its summary.
COMPANIES_PREFIX = "jobs/company_import/runs/"
#: What each priority run took - person, payload hash, outcome, page - as one
#: write-once part, so the next runs can leave alone what is already sent, and
#: the scoring models can rate the pages a run created before the next export
#: has them (`scrapers.koryta.created`, which owns the name).
SENT_PREFIX = SENT_LOG.prefix
#: Where the crawl bucket keeps the person feeds bought from rejestr.io, each
#: answer under the day it was bought (`jobs.krs_common.upload_result`).
PERSON_FEEDS = "hostname=rejestr.io/api/v2/osoby/"

#: Where submit_people.sh uploads for production.
DEFAULT_ENDPOINT = "https://autopush.koryta.pl"

#: Refusals in a row after which the site is taken to be down, or refusing
#: this account, and the run stops rather than counting the rest as failed.
MAX_REFUSED_IN_A_ROW = 20

#: EX_TEMPFAIL: what is left is the next run's.
EXIT_TRY_LATER = 75
EXIT_FAILED = 1

# What /admin/procesy shows, in the page's language.
PHASE_BUILD = "paczki"
PHASE_SEND = "wysyłanie"
PHASE_COMPANIES = "firmy"
STOP_LIMIT = "limit"
STOP_DEADLINE = "koniec czasu"
STOP_SIGTERM = "SIGTERM"
STOP_INTERRUPTED = "przerwany"
STOP_DRY_RUN = "próba - nic nie wysłano"
STOP_NOT_WRITTEN = "nie zapisano paczek"
STOP_UP_TO_DATE = "nic do wysłania - strona ma już te dane"
STOP_NO_COMPANIES = "nic do dodania - kopia bazy ma firmy wszystkich tych osób"

#: The tiers whose people the run is meant to create pages for. A page
#: created for anybody else is the identity lookup missing somebody.
CREATING = (NEW_HIRE, ODPIS_ONLY_CURRENT, REJESTRIO_CURRENT, DECLARED, NEW)

#: Rebuilt on every run, whatever is on disk or in the shared cache, so that
#: the payloads are made from the newest crawl and this morning's export.
#:
#: The sources, each read afresh: `PeopleKRS` (rejestr.io - the newest crawl
#: of every company), `KrsOdpisSeats` and `KrsOdpisEntries` (the odpisy pełne
#: `krs_odpis` fetches), `CompaniesKRS` (api-krs, which the nightly free scrape
#: writes, and rejestr.io's companies) and `KorytaPeople` (who is on the site).
#:
#: And everything between them and the payloads, named rather than left to
#: follow: an output missing on disk is restored from the newest backup in the
#: shared cache without a look at its sources ("missing output" in
#: `ProcessPolicy`), and a Cloud Run execution starts on an empty disk. Naming
#: the roots alone would restore `PeopleEnriched` from whoever uploaded it last
#: and read none of them.
#:
#: `KorytaPeople` is named after the day, which does not make a backup under
#: today's name today's export: a run before the 04:00 export would build it
#: from the one before and upload it under today's name - which is why such a
#: run is refused before it builds (`export_refusal`).
#:
#: Left to be reused: Wikipedia (`ProcessWiki`), PKW (`PeoplePKW`) and the name
#: frequencies, which change with a dump or an election, not overnight. Out of
#: reach: the export `--on-koryta` and `--only-changed` compare against
#: (`SNAPSHOT`) is read outside this tree; the run rebuilds it itself when the
#: frame on disk is not built from the newest export (`stale_frames`).
DEFAULT_REFRESH = (
    "PeopleKRS",
    "KrsOdpisSeats",
    "KrsOdpisEntries",
    "CompaniesKRS",
    "KorytaPeople",
    "PeopleKRSCombined",
    "PeopleKRSMerged",
    "PeopleKorytaMerged",
    "PeopleMerged",
    "PeopleEnriched",
)

#: Fingerprinted with the PESEL key, so only a machine holding it can rebuild
#: them; any other can restore them.
SEATS = "KrsOdpisSeats"

#: The answers that mean the site has the payload, whatever it did with it.
TAKEN = ("created", "updated", "unchanged")

#: `--refresh none`: rebuild nothing, take every output on disk as it is.
REFRESH_NONE = "none"

#: The export `--on-koryta` and `--only-changed` compare the payloads with
#: (`analysis.payloads.site.SiteSnapshot`). The pipelines read it without
#: naming it among their sources, so `--refresh` cannot reach it and
#: `--refresh none` would take a frame of it as it is on disk.
SNAPSHOT: tuple[type[KorytaExport], ...] = (KorytaNodes, KorytaEdges)


def warsaw_now() -> datetime:
    return datetime.now(warsaw_tz)


def now() -> str:
    return warsaw_now().isoformat(timespec="seconds")


def plural(n: int, one: str, few: str, many: str) -> str:
    """The form of a Polish noun after the number `n`: 1 stronę, 3 strony, 5 stron."""
    if n == 1:
        return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return few
    return many


@dataclass
class RunSummary:
    """What one run did, kept in the shared cache next to what it sent."""

    run: str
    started: str
    finished: str = ""
    scope: str = ""
    #: The sector the run kept to (`--company-category`), if it kept to one.
    company_category: str = ""
    endpoint: str = ""
    #: The export the payloads were compared with, as its folder is stamped.
    export: str = ""
    #: Payloads built: the people whose page this run would change.
    planned: int = 0
    counters: dict[str, int] = field(default_factory=dict)
    state: str = ""
    #: Why the run ended before the payloads did, if it did.
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None
    #: The gs:// path of what this run sent.
    payloads: str = ""
    #: Pages the run created, as "<name> (<node id>)". An --on-koryta run
    #: should have none, and the first is one too many (`--max-new`).
    created: list[str] = field(default_factory=list)
    #: What the site did not write, as the ingest reported it
    #: (`droppedChanges`), with the person's name and page: a job end the site
    #: keeps its own of, or one on a removed job. The page's `dropped_changes`
    #: counter says how many; this says which.
    dropped: list[dict] = field(default_factory=list)
    #: The jobs the site took a person without for want of a page for their
    #: company, as the ingest reported them (`unplacedEmployments`) once the
    #: uploader had created what companies it could, with the person's name
    #: and page. The page's `employments_unplaced` counter says how many.
    unplaced_employments: list[dict] = field(default_factory=list)
    #: A priority run: how many of the planned are in each tier.
    tiers: dict[str, int] = field(default_factory=dict)
    #: A priority run, or one asked for: what the site did with the people
    #: sent from each tier - its answers about the person node, and the edges
    #: they came with (`edges_written`) added up.
    sent_by_tier: dict[str, dict[str, int]] = field(default_factory=dict)
    #: A priority run: the people whose rejestr.io feed was bought within
    #: --bought-days. Those with a page the payload would change are the
    #: `bought` tier.
    bought_people: int = 0
    #: A priority run: payloads left out as sent unchanged within --resend-after.
    already_sent: int = 0
    #: A priority run: how many of the planned would change a page the export
    #: shows as published, whatever their tier - at most --max-published - and
    #: how many more it left to the next runs past it.
    published_pages: int = 0
    published_left: int = 0
    #: A priority run: each priority group (`--priority-group`) by its name -
    #: its budget and `new`, its members by tier before any cap, how many it
    #: planned and how many of those are pages to create, how many more of
    #: its members the run's own tiers planned, and what the site did with
    #: the ones sent for it; a declaration group's also the list it read
    #: (`source`, "" for none).
    groups: dict[str, dict] = field(default_factory=dict)
    #: A priority run: the plan, in sending order, as runs of
    #: [group, tier, count] - group "" for the run's own tiers - so that the
    #: payloads part reads back by position: with groups, a tier is no longer
    #: in one piece, nor in `TIERS` order.
    order: list[list] = field(default_factory=list)
    #: A priority run: payloads planned into the slots the plan left under
    #: --max-uploads (`--fill-rejestrio-current`), at its end.
    filled: int = 0
    #: A priority run: the gs:// path of what it took (`SENT_PREFIX`).
    sent: str = ""
    #: A run asked for on a page: which page, and what of its people it left.
    target: str = ""
    matched: int = 0
    up_to_date: int = 0
    left_out: int = 0
    #: A --companies-only run: the people the run it goes before will send -
    #: the first --max-uploads of the plan - and each company they name that
    #: the export has no page for: its KRS number, the name it was sent under,
    #: the people who name it, what the site did with it, and why it failed.
    people: int = 0
    companies: list[dict] = field(default_factory=list)


@dataclass
class Ending:
    """Where sending stopped."""

    #: Payloads gone through, skipped ones included.
    done: int = 0
    stopped: str = ""
    #: Stopped by a guardrail, which makes the run a failure whatever else
    #: happened in it.
    guarded: bool = False


def stop_rule(
    deadline: float | None,
    signalled: Callable[[], bool],
    clock: Callable[[], float] | None = None,
) -> Callable[[], str]:
    """Why the run should stop before the next person, or "" to carry on.

    `deadline` is on `clock`, `time.monotonic` unless another is given.
    """
    tick = clock or time.monotonic

    def should_stop() -> str:
        if signalled():
            return STOP_SIGTERM
        if deadline is not None and tick() >= deadline:
            return STOP_DEADLINE
        return ""

    return should_stop


def guardrail(created: int, refused_in_a_row: int, max_new: int) -> str:
    """Why the run has to stop now, as failed, or "" to carry on."""
    if created > max_new:
        pages = plural(created, "stronę", "strony", "stron")
        return f"utworzył {created} {pages}, a wolno {max_new} (--max-new)"
    if refused_in_a_row >= MAX_REFUSED_IN_A_ROW:
        return f"{refused_in_a_row} żądań z rzędu odrzuconych"
    return ""


def judge(ending: Ending, counts: Mapping[str, int]) -> tuple[FinalState, str, int]:
    """The state the page shows, why the run stopped, and the exit code.

    A guardrail fails the run, and so does every person sent being refused.
    Anything else that leaves people unsent is partial: a stop asked for - a
    limit, the deadline, a signal - or a few refusals, which the next run sends
    again. So is a job left off a person's page for want of its company.
    """
    if ending.guarded:
        return "failed", ending.stopped, EXIT_FAILED
    attempted = ending.done - counts.get("skipped", 0)
    failed = counts.get("failed", 0)
    refused = failure_reason(attempted, failed) or ""
    if run_state(attempted, failed) == "failed":
        return "failed", refused, EXIT_FAILED
    if ending.stopped:
        return "partial", ending.stopped, EXIT_TRY_LATER
    if failed:
        return "partial", refused, EXIT_TRY_LATER
    if unplaced := counts.get("employments_unplaced", 0):
        # A person taken without a job, for want of a company the uploader
        # could not create, is what a refused person was until 2026-10-14:
        # the next run sends them again (`remembered`).
        return "partial", f"zatrudnienia bez strony firmy: {unplaced}", EXIT_TRY_LATER
    return "succeeded", "", 0


def refresh_policy(
    asked: Sequence[str] | None, rebuild: Iterable[str] = ()
) -> ProcessPolicy:
    """What the payloads are built under: `DEFAULT_REFRESH`, or the pipelines
    --refresh names in its place, less any `:Name`, which is held as it is.
    `none` rebuilds nothing: what is on disk is taken as it is - the nightly's
    reprocess has rebuilt all of it minutes before.

    And, whatever --refresh says, `rebuild`: the frames of the export that
    are not built from the newest one (`stale_frames`)."""
    named = {name for name in asked or () if not name.startswith(":")}
    held = {name[1:] for name in asked or () if name.startswith(":")}
    refresh = named or set(DEFAULT_REFRESH)
    if REFRESH_NONE in refresh:
        refresh = set()
    rebuilt = SEATS in refresh or "all" in refresh
    if rebuilt and SEATS not in held and not pesel_salt():
        # Rebuilt without the key, the seats fail and `PeopleKRSCombined` falls
        # back on rejestr.io alone, so every company whose odpis is the newer
        # source would be sent with its older posts. Restored, they are the
        # last keyed machine's, missing only the PDFs fetched since.
        print(
            "No PESEL key (KORYTA_PESEL_SALT): restoring the odpis seats "
            "rather than rebuilding them"
        )
        held.add(SEATS)
    return ProcessPolicy((refresh - held) | set(rebuild), exclude_refresh=held)


def frame_written(pipeline: Pipeline) -> datetime | None:
    """When the pipeline's output on disk was written, or None without one."""
    path = os.path.join(VERSIONED_DIR, pipeline.output_path())
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), UTC)
    except FileNotFoundError:
        return None


def stale_frames(frames: Iterable[Pipeline], finished: datetime | None) -> list[str]:
    """The names of the `frames` whose output on disk is not built from the
    export that finished writing at `finished`: none on disk, or one written
    before - built from the export before, or from this one half-written.

    Missing is rebuilt rather than restored: the backup in the shared cache
    under today's name may be one a run made before the export. Told by when
    the file was written, not by what it holds, so one restored from such a
    backup since, by some other run, passes; on the nightly VM nothing
    restores them, since the reprocess builds them.
    """
    stale = []
    for frame in frames:
        written = frame_written(frame)
        if finished is None or written is None or written < finished:
            stale.append(frame.pipeline_name)
    return stale


def person_key(payload: Mapping[str, typing.Any]) -> str:
    """Who a payload is about, as steadily as the payload can say: the
    register link, else the page it names, else the name with the birth date.

    Somebody only an odpis names has neither link nor page id, and two of them
    can share a name; the ingest tells them apart by the day, and so does this.
    Their PESEL, which tells them apart in the pipeline, is never written here.
    """
    for key in ("rejestrIo", "korytaId"):
        if payload.get(key):
            return str(payload[key])
    name, born = payload.get("name") or "", payload.get("birthDate")
    return f"{name} {born}" if born else str(name)


def payload_hash(payload: Mapping[str, typing.Any]) -> str:
    """The payload's content, so an unchanged one is recognised next time -
    whatever order its lists come in (`in_any_order`).

    The lists are the person's posts, candidacies, parties and sources, and
    the order of none of them is anything the site keeps. Hashed as they came,
    the posts were a new payload whenever a rebuild listed them in another
    order: of the 100 people the 2026-10-13 and 10-14 nights sent, 33 and 40
    had gone up before with the same payload listed otherwise, and all but one
    came back `unchanged`. The build sorts the posts since
    (`analysis.payloads.person._extract_companies`); this keeps the next list
    a rebuild reorders from doing the same.
    """
    return hash_as_listed(in_any_order(payload))


def hash_as_listed(payload: typing.Any) -> str:
    """The hash of the payload with its lists in the order they come: what
    `payload_hash` was until October 2026, and what a `SENT_PREFIX` line
    written then holds (`HASHED`)."""
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def in_any_order(value: typing.Any) -> typing.Any:
    """`value` with every list in it sorted, by each item's own JSON, so that
    two payloads listing the same things in another order are one. A thing
    listed twice stays twice: that is a payload of its own."""
    if isinstance(value, Mapping):
        return {key: in_any_order(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return sorted(
            (in_any_order(item) for item in value),
            key=lambda item: json.dumps(
                item, sort_keys=True, ensure_ascii=False, default=str
            ),
        )
    return value


#: How the hash in a line of a `SENT_PREFIX` part was made, written beside it
#: (`write_sent`): of the payload with its lists in any order (`payload_hash`).
#: A line without it holds the hash of the payload as it was listed
#: (`hash_as_listed`), as every line did until October 2026.
HASHED = "lists-in-any-order"


def sent_recently(client: "Client", since: str) -> set[tuple[str, str]]:
    """(person, payload hash) of everything a priority run took on `since`
    (YYYY-MM-DD) or later, read from its `SENT_PREFIX` parts, that a later run
    may leave alone (`remembered`).

    A line whose hash was made as the payload was listed is hashed again, off
    the payload its run wrote before it sent anything (`hashed_again`). Left
    as it is, it would match nothing a build makes now, and the nights after
    the change would send again what the `--resend-after` days before it sent
    and the site has not taken in full: about 95 pages of the plan of
    2026-10-14 - most of a night's 100, and each a reviewer's change it could
    undo.
    """
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    seen: set[tuple[str, str]] = set()
    listed = found = 0
    for blob in bucket.list_blobs(
        prefix=SENT_PREFIX, start_offset=f"{SENT_PREFIX}date={since}"
    ):
        old: set[tuple[str, str]] = set()
        for row in json_lines(blob.download_as_bytes()):
            if not remembered(row):
                continue
            pair = (row["person"], row["payload"])
            if row.get("hashed") == HASHED:
                seen.add(pair)
            else:
                old.add(pair)
        if old:
            again = hashed_again(bucket, blob.name, {digest for _, digest in old})
            listed, found = listed + len(old), found + len(again)
            # Kept as they were too: a payload whose lists came in order
            # hashes the same either way.
            seen |= old | again
    if listed:
        print(
            f"Sent with the hash of the payload as listed: {listed}; "
            f"{found} hashed again off the payloads their runs wrote"
        )
    return seen


def remembered(row: Mapping[str, typing.Any]) -> bool:
    """Whether a later run may leave alone as sent the payload one line of a
    `SENT_PREFIX` part names.

    Not one the site took without a job, for want of a page for its company
    (`unplaced`): until 2026-10-14 the site refused such a person whole, and a
    refused person is not in the part at all, so the next run sent them again
    and the uploader tried the company once more. Remembered, the payload
    would be left alone for `--resend-after` days with the company still
    missing, or with its page there and the job not on it.
    """
    return not row.get("unplaced")


def hashed_again(
    bucket: typing.Any, sent: str, hashes: set[str]
) -> set[tuple[str, str]]:
    """(person, payload hash) of the payloads one run wrote whose hash as
    listed is among `hashes`, the hashes of the lines of its `sent` part.

    The payloads are the `PAYLOADS_PREFIX` part of the same day and run: all
    the run planned, in the order it sent them. What it took is among the
    first, so its lines are parsed only as far as the last of those. Every
    line from 2026-10-06 to 2026-10-14 is there: a night's hundred are the
    first hundred of its 9,000-odd payloads.
    """
    name = PAYLOADS_PREFIX + sent.removeprefix(SENT_PREFIX)
    blob = bucket.get_blob(name)
    if blob is None:
        print(f"No payloads for {sent}: {len(hashes)} lines left as they were")
        return set()
    wanted = set(hashes)
    found: set[tuple[str, str]] = set()
    for payload in json_lines(blob.download_as_bytes()):
        listed = hash_as_listed(payload)
        if listed in wanted:
            wanted.remove(listed)
            found.add((person_key(payload), payload_hash(payload)))
            if not wanted:
                break
    if wanted:
        print(f"{len(wanted)} lines of {sent} not among its run's payloads")
    return found


def json_lines(part: bytes) -> typing.Iterator[dict]:
    """The rows of one of the job's gzipped JSON-lines parts, one by one.

    Read by "\\n" alone, as `scrapers.koryta.created` reads them: the parts
    are written with `ensure_ascii=False`, and `splitlines` would also break
    a line at a separator a name carries raw."""
    for line in gzip.decompress(part).decode("utf-8").split("\n"):
        if line.strip():
            yield json.loads(line)


def bought_since(client: "Client", since: str) -> set[str]:
    """The rejestr.io ids of the people whose feed was bought on `since`
    (YYYY-MM-DD) or later - by `koryta_scrape_krs_paid`, at night or by hand.

    Read off the names the answers are stored under, which end in the day of
    the purchase, rather than off the paid job's summaries: a run killed
    before it wrote one has still bought what it stored. Some 5,000 names in
    October 2026, a few seconds to list.

    Listed with the mask `Client.list_blobs` uses, since only the name is
    read: unmasked, every item carries the object's whole metadata - 5.5 MB
    a night for those 5,000, against 0.6 MB masked.
    """
    bucket = client.storage_client.bucket(CRAWLED_BUCKET)
    bought: set[str] = set()
    for blob in bucket.list_blobs(prefix=PERSON_FEEDS, fields=LISTING_FIELDS):
        feed = parse_person_connections_url(blob.name)
        if feed is not None and feed[1] >= since:
            bought.add(feed[0])
    return bought


#: One in this many of a priority run's sends may be a new hire only an odpis
#: names, unless `--max-new-odpis-only` says otherwise (the module's docstring).
ODPIS_ONLY_PER = 10

#: How many of the people only an odpis names in a public post that is not
#: new a priority run creates pages for, unless `--max-odpis-only-current`
#: says otherwise: ten a night, as Szymon set it on 2026-10-11.
ODPIS_ONLY_CURRENT_CAP = 10

#: How many of the people with a rejestr.io entry in a public post that is
#: not new a priority run creates pages for, unless `--max-rejestrio-current`
#: says otherwise: fifty a night, as Szymon set it on 2026-10-16.
REJESTRIO_CURRENT_CAP = 50


def only_an_odpis_names(payload: Mapping[str, typing.Any]) -> bool:
    """Whether the payload is somebody with no rejestr.io entry, whom the
    ingest finds by their name and birth date alone."""
    return not payload.get("rejestrIo") and not payload.get("korytaId")


def plan_priority(
    candidates: Sequence[Candidate],
    already_sent: set[tuple[str, str]],
    max_new: int,
    max_new_odpis_only: int | None = None,
    max_odpis_only_current: int | None = None,
    max_published: int | None = None,
    max_rejestrio_current: int | None = None,
    groups: Sequence[Group] = (),
    fill_to: int | None = None,
) -> tuple[list[Candidate], int]:
    """What a priority run sends, in order, and how many it left out as sent.

    Out: a payload already taken unchanged (`already_sent`), and the pages to
    create past `max_new` - so a night with more of them than it may create
    still gets to the pages after them - and, among the new hires, the ones
    only an odpis names past `max_new_odpis_only`, and of the people in an
    older post those only an odpis names past `max_odpis_only_current` and
    those with a rejestr.io entry past `max_rejestrio_current`, for the same
    reason. The three kinds of page count against `max_new` together: the
    run stops as failed past it, so a plan past it would fail the night by
    itself. And the changes to published pages past `max_published`, in
    whichever tier they come (`Candidate.published`).

    The priority `groups` go in before the first payload of a tier past the
    noted pages (`AHEAD_OF_GROUPS`), one after another, each with its
    members (`Candidate.groups`) in the order they come: at most
    `Group.budget` of them, and at most `Group.new` of those pages to create.
    A member sent for a group counts against no cap of the run's own but
    `max_new`, which is every page the run creates; Szymon, 2026-10-27: "if a
    person payload is uploaded for a higher priority group, it doesn't count
    against a lower priority group". The groups are part of the run all the
    same, so the run sends --max-uploads in all, as before. A member past a
    group's budget goes in their own tier, as if there were no group, and
    somebody in two groups is sent for the first that has room. Only the
    members in the `GROUPED` tiers: the tiers before the groups go first
    anyway, a published page leaves a reviewer a proposal, and somebody only
    an odpis names is checked by hand, so those keep the run's own caps. The
    declared (`DECLARED`, in no public post) have no tier of the run's own to
    go in: past their group's budget they wait for the next run.

    `fill_to` is what the run sends at most, given to have the slots its
    plan leaves under it filled (`--fill-rejestrio-current`): by the people
    with a rejestr.io entry in an older public post that
    `max_rejestrio_current` left out, newest seat first, within `max_new`.
    Planned behind everything else, as the plan's tail.
    """
    unsent = [
        candidate
        for candidate in candidates
        if (person_key(candidate.payload), payload_hash(candidate.payload))
        not in already_sent
    ]
    plan = PriorityPlan(
        max_new,
        max_new_odpis_only,
        max_odpis_only_current,
        max_published,
        max_rejestrio_current,
    )
    # Where the groups go: before the first payload past the noted pages.
    at = next(
        (n for n, c in enumerate(unsent) if c.tier not in AHEAD_OF_GROUPS),
        len(unsent),
    )
    plan.own_tiers(unsent[:at])
    rest = unsent[at:]
    for group in groups:
        rest = plan.group(group, rest)
    waiting = plan.own_tiers(rest)
    if fill_to is not None:
        plan.fill(waiting, fill_to)
    return plan.planned, len(candidates) - len(unsent)


def at_cap(count: int, cap: int | None) -> bool:
    return cap is not None and count >= cap


@dataclass
class PriorityPlan:
    """A priority run's plan as `plan_priority` makes it: the payloads in
    sending order, and how much of each cap they have taken."""

    max_new: int
    max_new_odpis_only: int | None = None
    max_odpis_only_current: int | None = None
    max_published: int | None = None
    max_rejestrio_current: int | None = None
    planned: list[Candidate] = field(default_factory=list)
    #: Pages to create, in every tier and group: at most `max_new`.
    created: int = 0
    odpis_only: int = 0
    seated: int = 0
    linked: int = 0
    published: int = 0

    def own_tiers(self, found: Sequence[Candidate]) -> list[Candidate]:
        """Plan `found` in the run's own tiers, under their caps; and say
        which of the people with a rejestr.io entry in an older public post
        were left out, for the fill."""
        waiting = []
        for candidate in found:
            if self.admits(candidate):
                self.planned.append(candidate)
            elif candidate.tier == REJESTRIO_CURRENT:
                waiting.append(candidate)
        return waiting

    def admits(self, candidate: Candidate) -> bool:
        """Whether the run's own tiers have room for `candidate`; counted in
        when they have."""
        tier = candidate.tier
        if tier == DECLARED:
            # Only its group sends somebody in no public post.
            return False
        if tier in CREATING and self.created >= self.max_new:
            return False
        if tier == NEW_HIRE:
            if only_an_odpis_names(candidate.payload):
                if at_cap(self.odpis_only, self.max_new_odpis_only):
                    return False
                self.odpis_only += 1
        elif tier == ODPIS_ONLY_CURRENT:
            if at_cap(self.seated, self.max_odpis_only_current):
                return False
            self.seated += 1
        elif tier == REJESTRIO_CURRENT:
            if at_cap(self.linked, self.max_rejestrio_current):
                return False
            self.linked += 1
        elif candidate.published:
            if at_cap(self.published, self.max_published):
                return False
            self.published += 1
        if tier in CREATING:
            self.created += 1
        return True

    def group(self, group: Group, found: Sequence[Candidate]) -> list[Candidate]:
        """Plan the members of `group` among `found`, out of its own budget;
        and give back the rest, in their order, for the next."""
        sends = new = 0
        rest = []
        for candidate in found:
            if (
                sends >= group.budget
                or candidate.tier not in GROUPED
                or group.name not in candidate.groups
            ):
                rest.append(candidate)
                continue
            if candidate.tier in CREATING:
                if self.created >= self.max_new or new >= group.new:
                    rest.append(candidate)
                    continue
                self.created += 1
                new += 1
            sends += 1
            self.planned.append(replace(candidate, group=group.name))
        return rest

    def fill(self, waiting: Sequence[Candidate], fill_to: int) -> None:
        """Plan the first of `waiting` into the slots left under `fill_to`."""
        for candidate in waiting:
            if len(self.planned) >= fill_to or self.created >= self.max_new:
                return
            self.created += 1
            self.planned.append(replace(candidate, filled=True))


def runs(planned: Sequence[Candidate]) -> list[list]:
    """The plan as runs of [group, tier, count], in sending order
    (`RunSummary.order`)."""
    order: list[list] = []
    for candidate in planned:
        if order and order[-1][:2] == [candidate.group, candidate.tier]:
            order[-1][2] += 1
        else:
            order.append([candidate.group, candidate.tier, 1])
    return order


def companies_needed(
    payloads: Sequence[Mapping[str, typing.Any]], missing: Sequence[Sequence[str]]
) -> dict[str, list[str]]:
    """The companies the payloads name that the export has no page for -
    `missing`, each payload's own (`Candidate.missing`) - each once, in the
    order the people go, with the names of the people who name it."""
    needed: dict[str, list[str]] = {}
    for payload, companies in zip(payloads, missing, strict=True):
        for krs in companies:
            needed.setdefault(krs, []).append(str(payload.get("name")))
    return needed


def sign_in(endpoint: str) -> TokenSource:
    """How the run signs in, tried before anything is built: a key or a grant
    that is missing is better found in a second than after an hour of
    pipelines. A person at the keyboard is asked when the first upload is."""
    tokens = token_source(endpoint)
    print(f"Signing in to {endpoint} as {tokens.who}")
    if not tokens.interactive:
        tokens.token()
    return tokens


def make_uploader(endpoint: str, tokens: TokenSource) -> PersonUploader:
    """The uploader `koryta_uploader --type person --submit` would be."""
    args = argparse.Namespace(
        endpoint=endpoint,
        type="person",
        submit=True,
        database="koryta-pl",
        limit=None,
        offset=0,
        model=None,
    )
    # A company a person names and the site has no page for is looked up in
    # `Companies`, rebuilt from the `CompaniesKRS` this run has just read.
    # Restored instead, a fresh container takes whichever copy was uploaded
    # last, which may predate the very company.
    return PersonUploader(
        typing.cast(Args, args),
        tokens=tokens,
        companies_policy=ProcessPolicy({"Companies"}),
    )


def send_one(uploader: PersonUploader, payload: object) -> PersonResult | None:
    """Upload one payload, counted as `koryta_uploader` counts it; None for
    one it skips too, which is neither an answer nor a refusal."""
    if not isinstance(payload, dict) or not payload.get("name"):
        uploader.counts["skipped"] += 1
        return None
    result = uploader.upload_person(payload)
    uploader.count_person(str(payload["name"]), result)
    return result


def edges_written(result: PersonResult) -> dict[str, int]:
    """What the site wrote of one person besides the node, as its answer says:
    the jobs and candidacies it created, the jobs it put live, and the changes
    to stored candidacies it left for a reviewer.

    The answer's `person` is about the node alone, so a person answered
    `unchanged` may have had all of these written. Every one of the 106
    bought pages sent 2026-10-24..28 had edges written, and 91 of them were
    answered `unchanged`. On 10-28 the 20 of them wrote 87 new jobs, every
    one at a company the bought feed names and 81 of them put live, and 15
    new candidacies. Not counted, as the answer does not say: a stored edge
    filled in - a job's end, a candidacy's office or result.
    """
    return {
        "employments_created": result.employments_created,
        "employments_published": result.employments_published,
        "candidacies_created": result.candidacies_created,
        "proposals_filed": result.proposals_filed,
    }


class PeopleImport:
    """One run: what it was asked to do, how far it got, and where it says so."""

    #: The job the run reports as, what its progress counts, and where its
    #: summary goes - another for `CompaniesFirst`.
    job = JOB
    unit = UNIT
    runs_prefix = RUNS_PREFIX

    def __init__(
        self, args: argparse.Namespace, should_stop: Callable[[], str] = lambda: ""
    ):
        self.args = args
        self.should_stop = should_stop
        asked: str | None = getattr(args, "request", None)
        self.summary = RunSummary(
            run=asked or uuid7str(),
            started=now(),
            scope=args.scope,
            company_category=getattr(args, "company_category", None) or "",
            endpoint=args.endpoint,
        )
        # Under the summary's id, so the page's run and what the run left in
        # the shared cache are found from each other. A run asked for on the
        # site goes on in the document the site queued, which holds the
        # request and is the one its link names.
        self.status = (
            JobRun(
                PEOPLE_REQUEST, run_id=asked, trigger="request", adopt=True, unit=UNIT
            )
            if asked
            else JobRun(self.job, run_id=self.summary.run, unit=self.unit)
        )
        self.uploader: PersonUploader | None = None
        self.ending = Ending()
        self._client: Client | None = None
        #: A run given a declaration group: the list it read the declarations
        #: off, "" for none (`declared`).
        self.declared_from = ""
        #: A priority run, or one asked for: each payload's tier, in sending order.
        self.tiers: list[str] | None = None
        #: A priority run: whether each payload's page is published, in
        #: sending order (`Candidate.published`).
        self.published: list[bool] | None = None
        #: ...and the companies each names that the export has no page for
        #: (`Candidate.missing`).
        self.missing: list[tuple[str, ...]] | None = None
        #: ...and the priority group each is sent for, "" for none
        #: (`Candidate.group`).
        self.groups: list[str] | None = None
        #: A priority run, or one asked for: what the site took - payload,
        #: tier, outcome, the page it filed the person under, the companies
        #: it took them without a job at, for want of a page, the priority
        #: group it was sent for, and the edges written (`edges_written`).
        self.taken: list[
            tuple[dict, str, str, str | None, list[str], str, dict[str, int]]
        ] = []
        #: A run asked for on a page: what was asked, once read.
        self.request: Request | None = None
        #: ...and what of the page's people it found and left, for the page.
        self.request_counts: dict[str, int] = {}
        #: The frames of the export to rebuild before they are compared with.
        self.rebuild: list[str] = []

    @property
    def dry(self) -> bool:
        """Sends nothing: --dry-run, or a request for a count alone."""
        return bool(self.args.dry_run or (self.request and self.request.dry_run))

    def run(self) -> int:
        self.status.start(phase=PHASE_BUILD)
        try:
            return self.attempt()
        except KeyboardInterrupt:
            # Ctrl+C is someone stopping a hand run, not the job breaking. One
            # while the payloads are sent is caught there, with what was sent.
            print("Interrupted")
            self.summary.stopped = STOP_INTERRUPTED
            return self.end("partial", EXIT_TRY_LATER)
        except Exception as e:
            self.summary.stopped = f"wyjątek {type(e).__name__}"
            self.end("failed", EXIT_FAILED, crash=repr(e)[:ERROR_CHARS])
            raise

    def attempt(self) -> int:
        args = self.args
        if args.request:
            self.request = read_request(args.request)
            self.summary.target = self.request.describe()
            print(f"Asked for on the site: {self.summary.target}")
        tokens = None if self.dry else sign_in(args.endpoint)
        if refusal := self.check_export():
            print(f"Stopping: {refusal}")
            self.summary.stopped = refusal
            return self.end("failed", EXIT_FAILED)
        if self.request is not None:
            payloads = self.plan_request(self.request)
        elif args.scope == PRIORITY:
            payloads = self.plan()
        else:
            payloads = build_payloads(
                args.scope, args.koryta_date, self.policy(), args.company_category
            )
        self.summary.planned = len(payloads)
        self.status.progress(
            0,
            total=len(payloads),
            counters=(
                {"planned": len(payloads), **self.request_counts}
                if self.dry
                else self.counters()
            ),
            force=True,
        )
        if tokens is None:  # A dry run, which signed in to nothing.
            return self.dry_run(payloads)
        if self.request is not None and not payloads:
            # Nothing the page lacks. Said, rather than left as a success with
            # no reason, which on the page reads as a run that did nothing.
            self.summary.stopped = self.summary.stopped or STOP_UP_TO_DATE
            return self.end("succeeded", 0)
        if payloads:
            try:
                self.summary.payloads = self.write_payloads(payloads)
            except Exception as e:
                # The part is the record of what a day sent. A run that cannot
                # leave one sends nothing, rather than what nobody could audit.
                print(f"Could not write the payloads: {e}")
                self.summary.errors.append(one_line(e))
                self.summary.stopped = STOP_NOT_WRITTEN
                return self.end("failed", EXIT_FAILED)
        self.uploader = make_uploader(args.endpoint, tokens)
        self.status.progress(phase=PHASE_SEND, force=True)
        self.send(payloads, self.uploader)
        self.uploader.report()
        state, self.summary.stopped, code = judge(self.ending, self.uploader.counts)
        print(
            f"Sent {self.ending.done:,} of {len(payloads):,} people: "
            f"{dict(self.uploader.counts)}"
            + (f"; stopped: {self.summary.stopped}" if self.summary.stopped else "")
        )
        return self.end(state, code)

    def check_export(self) -> str:
        """Why the run may not compare the payloads with the newest export
        (`export_refusal`), or "" - and then which frames of it on disk to
        rebuild first (`stale_frames`).

        Rebuilt rather than refused: the nightly VM's frames are built by its
        reprocess within two hours of the export - at 05:26 on 2026-10-10 -
        so a run asked for on a page later in the day rebuilds nothing, unless
        an export was taken by hand since; and the two take a minute and a
        quarter to rebuild.
        """
        export = latest_export(self.client())
        frames = [pipeline(self.args.koryta_date) for pipeline in SNAPSHOT]
        refusal = export_refusal(
            export, frames[0].date, warsaw_now(), accepted=self.args.export
        )
        if export is None or refusal:
            return refusal
        self.summary.export = export.stamp
        self.rebuild = stale_frames(frames, export.finished)
        print(
            f"Comparing with the export of {export.stamp}"
            + (
                f"; rebuilding {', '.join(self.rebuild)}, not built from it"
                if self.rebuild
                else ""
            )
        )
        return ""

    def policy(self) -> ProcessPolicy:
        return refresh_policy(self.args.refresh, self.rebuild)

    def declared(self, groups: Sequence[Group]) -> Declared | None:
        """Who the BIP crawl found a declaration for, as its newest list in the
        shared cache has it (`stores.bip_found`) - read only for a run given a
        declaration group. With no list the groups have nobody in them, and
        the run goes on without them: the night is not held over a list."""
        if not any(group.of_declarations for group in groups):
            return None
        declared = newest_found(self.client())
        if declared is None:
            print(
                f"No list of the people the BIP crawl found a declaration for "
                f"under gs://{SHARED_BUCKET}/{FOUND_PREFIX} (koryta_scrape_bip "
                f"found writes one): {', '.join(DECLARATION_GROUPS)} have nobody "
                "in them"
            )
            return Declared()
        print(
            f"Declarations downloaded: {len(declared.register_ids)} rejestr.io "
            f"entries, {len(declared.page_ids)} pages, from {declared.source}"
        )
        self.declared_from = declared.source
        return declared

    def plan(self) -> list[dict]:
        """A priority run's payloads, in sending order: built, the already sent
        left out, the pages to create cut at --max-new, the new hires only an
        odpis names at --max-new-odpis-only, the people in an older public
        post only an odpis names at --max-odpis-only-current and those with a
        rejestr.io entry at --max-rejestrio-current, and the changes to
        published pages at --max-published; each priority group's members
        after the noted pages, out of its own budget (--priority-group); and
        with --fill-rejestrio-current, the slots left under --max-uploads
        filled."""
        args = self.args
        groups: list[Group] = args.priority_group or []
        today = warsaw_now().date()
        bought_from = (today - timedelta(days=args.bought_days)).isoformat()
        bought = bought_since(self.client(), bought_from)
        self.summary.bought_people = len(bought)
        print(f"Bought from rejestr.io since {bought_from}: {len(bought)} people")
        candidates = build_priority(
            args.koryta_date,
            self.policy(),
            today,
            args.recent_days,
            bought,
            groups,
            declared=self.declared(groups),
        )
        already: set[tuple[str, str]] = set()
        if args.resend_after:
            since = (today - timedelta(days=args.resend_after)).isoformat()
            already = sent_recently(self.client(), since)
        planned, self.summary.already_sent = plan_priority(
            candidates,
            already,
            args.max_new,
            args.max_new_odpis_only,
            args.max_odpis_only_current,
            args.max_published,
            args.max_rejestrio_current,
            groups=groups,
            fill_to=args.max_uploads if args.fill_rejestrio_current else None,
        )
        self.tiers = [candidate.tier for candidate in planned]
        self.published = [candidate.published for candidate in planned]
        self.missing = [candidate.missing for candidate in planned]
        self.groups = [candidate.group for candidate in planned]
        counts = Counter(self.tiers)
        self.summary.tiers = {tier: counts.get(tier, 0) for tier in TIERS}
        self.summary.order = runs(planned)
        print(
            f"Planned by tier: {self.summary.tiers}; left out as sent unchanged "
            f"in the last {args.resend_after} days: {self.summary.already_sent}"
        )

        def by_name(found: Sequence[Candidate]) -> list[Candidate]:
            return [
                candidate
                for candidate in found
                if candidate.tier == NEW_HIRE and only_an_odpis_names(candidate.payload)
            ]

        def seated(found: Sequence[Candidate]) -> list[Candidate]:
            return [c for c in found if c.tier == ODPIS_ONLY_CURRENT]

        def linked(found: Sequence[Candidate]) -> list[Candidate]:
            return [c for c in found if c.tier == REJESTRIO_CURRENT]

        def unsent(found: Sequence[Candidate]) -> list[Candidate]:
            return [
                candidate
                for candidate in found
                if (person_key(candidate.payload), payload_hash(candidate.payload))
                not in already
            ]

        if hires := unsent(by_name(candidates)):
            print(
                f"New hires only an odpis names: {len(by_name(planned))} of "
                f"{len(hires)} planned (--max-new-odpis-only "
                f"{args.max_new_odpis_only})"
            )
        if older := unsent(seated(candidates)):
            print(
                f"People only an odpis names in an older public post: "
                f"{len(seated(planned))} of {len(older)} planned "
                f"(--max-odpis-only-current {args.max_odpis_only_current})"
            )
        if waiting := unsent(linked(candidates)):
            # All of the tier that is planned, groups and fill included: the
            # rest of "N of M planned" is what the tier leaves to later runs.
            mine = [c for c in linked(planned) if not c.group and not c.filled]
            beyond = len(linked(planned)) - len(mine)
            print(
                f"People with a rejestr.io entry in an older public post: "
                f"{len(linked(planned))} of {len(waiting)} planned "
                f"(--max-rejestrio-current {args.max_rejestrio_current}"
                + (f"; {beyond} more for priority groups or the fill" if beyond else "")
                + ")"
            )
        if pages := unsent([c for c in candidates if c.published]):
            # The cap is the one thing that leaves a published page out.
            summary = self.summary
            summary.published_pages = sum(self.published)
            summary.published_left = len(pages) - summary.published_pages
            cap = args.max_published
            print(
                f"Published pages to change: {summary.published_pages} of "
                f"{len(pages)} planned"
                + ("" if cap is None else f" (--max-published {cap})")
            )
        for group in groups:
            members = unsent([c for c in candidates if group.name in c.groups])
            sent_for = [c for c in planned if c.group == group.name]
            pool = Counter(c.tier for c in members)
            report = self.summary.groups[group.name] = {
                "budget": group.budget,
                "new": group.new,
                "members": {tier: pool[tier] for tier in TIERS if pool[tier]},
                "planned": len(sent_for),
                "to_create": sum(c.tier in CREATING for c in sent_for),
                # Sent ahead of the group (a new hire, a bought or noted page),
                # past its budget, or in a tier that keeps the run's caps.
                "planned_in_own_tiers": sum(
                    group.name in c.groups and not c.group for c in planned
                ),
                **({"source": self.declared_from} if group.of_declarations else {}),
            }
            print(
                f"Priority group {group.name}: {report['planned']} of "
                f"{len(members)} members planned (budget {group.budget}), "
                f"{report['to_create']} of them pages to create "
                f"(new={group.new}); {report['planned_in_own_tiers']} more in "
                "the run's own tiers"
            )
        if waiting := unsent([c for c in candidates if c.tier == DECLARED]):
            print(
                f"People with a downloaded declaration whose public post ended: "
                f"{sum(c.tier == DECLARED for c in planned)} of {len(waiting)} "
                "planned, all for their group"
            )
        if args.fill_rejestrio_current:
            self.summary.filled = sum(c.filled for c in planned)
            print(
                f"Filled up to --max-uploads {args.max_uploads}: "
                f"{self.summary.filled} more people with a rejestr.io entry in "
                "an older public post"
            )
        return [candidate.payload for candidate in planned]

    def plan_request(self, request: Request) -> list[dict]:
        """A page's people, in sending order: the pages that would change,
        then the people the site lacks - a company's, never a person's."""
        target = PageTarget(
            kind=request.target,
            node_id=request.node_id,
            name=request.name,
            krs=request.krs,
            register=request.register_number,
        )
        candidates, targeted = build_targeted(
            target, self.args.koryta_date, self.policy()
        )
        self.tiers = [candidate.tier for candidate in candidates]
        # The people it was asked to add are exactly the pages it may create;
        # one more is somebody whose page the export has and the ingest missed.
        self.args.max_new = len(targeted.new)
        summary = self.summary
        summary.matched = targeted.matched
        summary.up_to_date = targeted.up_to_date
        summary.left_out = targeted.left_out
        summary.tiers = dict(Counter(self.tiers))
        self.request_counts = {
            "matched": targeted.matched,
            "to_change": len(targeted.changed),
            "to_create": len(targeted.new),
            "up_to_date": targeted.up_to_date,
            "left_out": targeted.left_out,
        }
        if targeted.reason:
            summary.stopped = targeted.reason
        print(
            f"Planned for {request.describe()}: {len(targeted.changed)} to change, "
            f"{len(targeted.new)} to create; {targeted.up_to_date} up to date, "
            f"{targeted.left_out} left out"
        )
        return [candidate.payload for candidate in candidates]

    def dry_run(self, payloads: list[dict]) -> int:
        """Say what a run would send - the first --max-uploads of the plan, as
        `send` stops there - and end as a trial. The dry run of the first
        whole night, 2026-10-05, said 9,542 people of a run capped at 100."""
        sent = min(len(payloads), self.args.max_uploads)
        named = payloads[: min(sent, 3)]
        names = ", ".join(str(payload.get("name")) for payload in named)
        more = ", ..." if sent > 3 else ""
        capped = (
            f", the first {sent:,} of {len(payloads):,} planned (--max-uploads)"
            if sent < len(payloads)
            else ""
        )
        print(
            f"Dry run: {sent:,} people would be sent to {self.args.endpoint}"
            + capped
            + (f": {names}{more}" if sent else "")
        )
        if self.tiers is not None and self.request is None:
            first = Counter(self.tiers[:sent])
            print(
                f"The first {sent} (--max-uploads) by tier: "
                f"{ {tier: first.get(tier, 0) for tier in TIERS} }"
            )
        if self.summary.groups and self.groups is not None:
            by_group = Counter(self.groups[:sent])
            print(
                f"The first {sent} (--max-uploads) by priority group: "
                f"{ {name: by_group[name] for name in self.summary.groups} }; "
                f"the run's own tiers: {by_group['']}"
            )
        if self.published is not None:
            print(
                f"Of the first {sent}, changes to published pages: "
                f"{sum(self.published[:sent])}"
            )
        reason = STOP_DRY_RUN
        if self.request is not None and self.summary.stopped:
            reason = f"{STOP_DRY_RUN}; {self.summary.stopped}"
        self.status.finish(
            "succeeded",
            stop_reason=reason,
            counters={"planned": len(payloads), **self.request_counts},
            exit_code=0,
            done=0,
        )
        return 0

    def send(self, payloads: list[dict], uploader: PersonUploader) -> Ending:
        """Upload each payload in turn, until they run out or something says
        stop. Ctrl+C included: what was sent is counted either way."""
        args, ending = self.args, self.ending
        refused = 0
        try:
            for n, payload in enumerate(tqdm(payloads, disable=None)):
                if reason := self.should_stop():
                    ending.stopped = reason
                    break
                if n >= args.max_uploads:
                    ending.stopped = STOP_LIMIT
                    break
                result = send_one(uploader, payload)
                if result is not None:
                    refused = refused + 1 if result.outcome == "failed" else 0
                    if result.outcome == "created":
                        page = f"{payload['name']} ({result.person_id})"
                        self.summary.created.append(page)
                    self.summary.dropped += [
                        {"name": payload["name"], "node": result.person_id, **change}
                        for change in result.dropped
                    ]
                    self.summary.unplaced_employments += [
                        {"name": payload["name"], "node": result.person_id, **job}
                        for job in result.unplaced_jobs
                    ]
                ending.done = n + 1
                self.status.progress(ending.done, counters=self.counters())
                if result is not None and self.tiers is not None:
                    tier = self.tiers[n]
                    if result.outcome in TAKEN:
                        self.taken.append(
                            (
                                payload,
                                tier,
                                result.outcome,
                                result.person_id,
                                result.unplaced_companies(),
                                self.groups[n] if self.groups else "",
                                edges_written(result),
                            )
                        )
                    if result.outcome == "created" and tier not in CREATING:
                        # Planned onto a page the export has, so a page made
                        # for it is the identity lookup missing somebody.
                        reason = (
                            f"utworzył stronę dla osoby, która już ma stronę: "
                            f"{self.summary.created[-1]}"
                        )
                        print(f"Stopping: {reason}")
                        ending.stopped, ending.guarded = reason, True
                        self.summary.errors.append(
                            f"utworzona strona: {self.summary.created[-1]}"
                        )
                        break
                if reason := guardrail(
                    uploader.counts["created"], refused, args.max_new
                ):
                    print(f"Stopping: {reason}")
                    ending.stopped, ending.guarded = reason, True
                    if uploader.counts["created"] > args.max_new:
                        # Named on the page, where the run is looked at first:
                        # each is a page somebody has to merge or keep.
                        self.summary.errors += [
                            f"utworzona strona: {page}" for page in self.summary.created
                        ]
                    break
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("Interrupted; stopping after what was sent")
            ending.stopped = STOP_INTERRUPTED
        return ending

    def counters(self) -> dict[str, int]:
        sent = (
            dict(self.uploader.counts)
            if self.uploader is not None
            else dict.fromkeys(PERSON_COUNTERS, 0)
        )
        return {"planned": self.summary.planned, **self.request_counts, **sent}

    def end(self, state: FinalState, code: int, crash: str | None = None) -> int:
        """Write the run's summary and tell the page how the run ended."""
        summary = self.summary
        if self.taken and not self.dry:
            summary.sent = self.write_sent()
        for _, tier, outcome, _, _, group, edges in self.taken:
            tally = summary.sent_by_tier.setdefault(tier, {})
            for name, n in {outcome: 1, **edges}.items():
                tally[name] = tally.get(name, 0) + n
            if group in summary.groups:
                sent = summary.groups[group].setdefault("sent", {})
                sent[outcome] = sent.get(outcome, 0) + 1
        for tier, tally in summary.sent_by_tier.items():
            print(f"Sent from {tier}: {tally}")
        summary.state = state
        summary.exit_code = code
        summary.counters = self.counters()
        errors = [*summary.errors, *(self.uploader.errors if self.uploader else [])]
        if crash:
            # First: after twenty refusals the list already holds as many
            # errors as the page keeps, and last it would be cut.
            errors = [crash, *errors]
        summary.errors = errors[:ERRORS_KEPT]
        path = "" if self.dry else self.write_summary()
        self.status.finish(
            state,
            stop_reason=summary.stopped or None,
            errors=summary.errors,
            exit_code=code,
            counters=summary.counters,
            done=self.ending.done,
            # "" when the summary could not be written: no link to nothing.
            summary_path=path or None,
        )
        return code

    def client(self) -> Client:
        if self._client is None:
            self._client = Client()
        return self._client

    def write_payloads(self, payloads: list[dict]) -> str:
        """Write what the run is about to send, once, before it sends any."""
        day, run = self.summary.started[:10], self.summary.run
        name = f"{PAYLOADS_PREFIX}date={day}/{run}.jsonl.gz"
        lines = "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in payloads)
        # mtime=0, so the bytes are the payloads' alone and a retried create is
        # recognised as the write that landed (`Client.create_object`).
        data = gzip.compress(lines.encode("utf-8"), mtime=0)
        url = self.client().create_object(SHARED_BUCKET, name, data, "application/gzip")
        print(f"Payloads: {url}")
        return url

    def write_sent(self) -> str:
        """Write what the site took, once, for later runs to leave alone; a
        failure to is printed and kept among the errors, not raised - those
        people are only sent again, and the pages it created are rated after
        the next export rather than tonight."""
        day, run = self.summary.started[:10], self.summary.run
        name = f"{SENT_PREFIX}date={day}/{run}.jsonl.gz"
        lines = "".join(
            json.dumps(
                {
                    "person": person_key(payload),
                    "payload": payload_hash(payload),
                    "hashed": HASHED,
                    "name": payload.get("name"),
                    "tier": tier,
                    "outcome": outcome,
                    "node": node,
                    "rejestrIo": payload.get("rejestrIo"),
                    # The companies the site took the person without a job
                    # at: such a line is not left alone (`remembered`).
                    "unplaced": unplaced,
                    # The priority group it was sent for; None for the run's
                    # own tiers.
                    "group": group or None,
                    # What came with an `outcome` that is the node's alone.
                    **edges,
                },
                ensure_ascii=False,
            )
            + "\n"
            for payload, tier, outcome, node, unplaced, group, edges in self.taken
        )
        data = gzip.compress(lines.encode("utf-8"), mtime=0)
        try:
            url = self.client().create_object(
                SHARED_BUCKET, name, data, "application/gzip"
            )
        except Exception as e:
            print(f"Could not write what was sent {name}: {e}")
            self.summary.errors.append(f"nie zapisano wysłanych: {one_line(e)}")
            return ""
        print(f"Sent: {url}")
        return url

    def write_summary(self) -> str:
        """Write the run's summary once; a failure to is printed, not raised."""
        summary = self.summary
        summary.finished = now()
        name = f"{self.runs_prefix}date={summary.started[:10]}/{summary.run}.json"
        data = json.dumps(asdict(summary), ensure_ascii=False, indent=1)
        try:
            url = self.client().create_object(
                SHARED_BUCKET, name, data.encode("utf-8"), "application/json"
            )
        except Exception as e:
            # What the run sent is on the site, and its payloads in the cache.
            print(f"Could not write the run summary {name}: {e}")
            return ""
        print(f"Summary: {url}")
        return url


class CompaniesFirst(PeopleImport):
    """A run of `--companies-only`: the companies the night's people name that
    the export has no page for, created before the people go.

    Planned as the priority run after it plans - the same build from the same
    outputs, with the same flags, which the night gives both its steps - and of
    the first `--max-uploads` people of the plan, the ones that run sends, the
    companies the export has no page for (`Candidate.missing`), each once, in
    the order the people go. Each is created through /api/ingest/company from
    `Companies`, as the uploader creates one when the site takes a person
    without it (`PersonUploader.create_company`): so the people run finds every
    page there, and places each job with its first request. The people runs of
    2026-10-13 and 10-14 created 27 and 16 companies on their way. A company
    this run cannot create is the people run's to try again, and to leave the
    job off the page for, as before.

    It sends no person, and writes neither what it would send nor what was
    sent. It reports as `COMPANY_JOB` and summarises each company - the name
    it went under, who names it, what the site did with it - in
    `COMPANIES_PREFIX`. A company the site had a page for after all, made
    since the export, is counted as the site answered: updated or unchanged.
    """

    job = COMPANY_JOB
    unit = COMPANY_UNIT
    runs_prefix = COMPANIES_PREFIX

    def __init__(
        self, args: argparse.Namespace, should_stop: Callable[[], str] = lambda: ""
    ):
        super().__init__(args, should_stop)
        #: The companies to create, in order, with the people who name each.
        self.needed: dict[str, list[str]] = {}
        #: What the site did with the companies sent, by outcome.
        self.outcomes: Counter[str] = Counter()

    def attempt(self) -> int:
        args = self.args
        tokens = None if self.dry else sign_in(args.endpoint)
        if refusal := self.check_export():
            print(f"Stopping: {refusal}")
            self.summary.stopped = refusal
            return self.end("failed", EXIT_FAILED)
        payloads = self.plan()
        self.summary.planned = len(payloads)
        people = payloads[: args.max_uploads]
        self.summary.people = len(people)
        self.needed = companies_needed(people, (self.missing or [])[: len(people)])
        print(
            f"The first {len(people):,} of {len(payloads):,} people planned "
            f"(--max-uploads) name {len(self.needed)} companies the export has no "
            "page for" + (f": {', '.join(self.needed)}" if self.needed else "")
        )
        self.status.progress(
            0, total=len(self.needed), counters=self.counters(), force=True
        )
        if tokens is None:  # A dry run, which signed in to nothing.
            return self.dry_run(payloads)
        if not self.needed:
            # Said, as a request with nothing to send says it: a success with
            # no reason reads on the page as a run that did nothing.
            self.summary.stopped = STOP_NO_COMPANIES
            return self.end("succeeded", 0)
        self.uploader = make_uploader(args.endpoint, tokens)
        self.status.progress(phase=PHASE_COMPANIES, force=True)
        self.create(self.uploader)
        failed = self.outcomes["failed"]
        print(
            f"Companies for the first {len(people):,} people: "
            f"{dict(self.outcomes)} of {len(self.needed)}"
            + (f"; stopped: {self.ending.stopped}" if self.ending.stopped else "")
        )
        if self.ending.stopped:
            self.summary.stopped = self.ending.stopped
            return self.end("partial", EXIT_TRY_LATER)
        if failed:
            # Partial, never failed: the people run tries each of them again,
            # and a company it cannot create costs a person that job alone.
            self.summary.stopped = f"nie dodano firm: {failed} z {self.ending.done}"
            return self.end("partial", EXIT_TRY_LATER)
        return self.end("succeeded", 0)

    def create(self, uploader: PersonUploader) -> None:
        """Create each company needed, in turn, until they run out or
        something says stop - Ctrl+C included."""
        try:
            for n, (krs, people) in enumerate(self.needed.items()):
                if reason := self.should_stop():
                    self.ending.stopped = reason
                    break
                result = uploader.create_company(krs)
                self.outcomes[result.outcome] += 1
                company: dict[str, typing.Any] = {"krs": krs}
                if result.name:
                    company["name"] = result.name
                company.update(people=people, outcome=result.outcome)
                if result.error:
                    company["error"] = result.error
                    self.summary.errors.append(result.error)
                self.summary.companies.append(company)
                self.ending.done = n + 1
                self.status.progress(self.ending.done, counters=self.counters())
                time.sleep(self.args.interval)
        except KeyboardInterrupt:
            print("Interrupted; stopping after the companies sent")
            self.ending.stopped = STOP_INTERRUPTED

    def counters(self) -> dict[str, int]:
        return {
            "planned": len(self.needed),
            "companies_created": self.outcomes["created"],
            "updated": self.outcomes["updated"],
            "unchanged": self.outcomes["unchanged"],
            "failed": self.outcomes["failed"],
        }

    def dry_run(self, payloads: list[dict]) -> int:
        """Say how many companies a run would create, and end as a trial."""
        print(
            f"Dry run: {len(self.needed)} companies would be created at "
            f"{self.args.endpoint}, before the people"
        )
        self.status.finish(
            "succeeded",
            stop_reason=STOP_DRY_RUN,
            counters={"planned": len(self.needed)},
            exit_code=0,
            done=0,
        )
        return 0


def non_negative_int(text: str) -> int:
    value = int(text)
    if value < 0:
        raise ValueError(text)
    return value


def non_negative_float(text: str) -> float:
    value = float(text)
    if value < 0:
        raise ValueError(text)
    return value


def iso_day(text: str) -> str:
    return date.fromisoformat(text).isoformat()


def export_stamp(text: str) -> str:
    """An export folder's stamp, as it is: `export_time` reads it later.

    With its zone, as every folder is stamped ("Z"): `export_refusal` compares
    it with the newest export's time, and one without -
    "2026-10-10T02:00:59", typed by hand - would stop the run there with a
    TypeError rather than here with its usage."""
    if export_time(text).tzinfo is None:
        raise ValueError(text)
    return text


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_people_import",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    parser.add_argument(
        "--scope",
        choices=SCOPES,
        default="on-koryta",
        help="on-koryta, the default, refreshes the pages the site has; "
        "not-on-koryta adds the people it has not, and needs --max-new; "
        "priority sends new hires first, then the pages of the people bought "
        "from rejestr.io, then the pages with an open note (data noted missing "
        "first), then a few people the site lacks in an older public post - "
        "those only an odpis names, then those with a rejestr.io entry - then "
        "published pages, then the rest (analysis.payloads.priority).",
    )
    parser.add_argument(
        "--request",
        metavar="RUN_ID",
        help="Do what the site was asked on a page: the company's people, or "
        "the person, of the queued run RUN_ID (koryta_job_requests starts "
        "these). In place of --scope; the run may create pages only for the "
        "company's people the site lacks.",
    )
    parser.add_argument(
        "--company-category",
        choices=CATEGORY_VALUES,
        metavar="CATEGORY",
        help="With --scope on-koryta or not-on-koryta: only the people in a post "
        "now - any post - at a public company in this sector, as "
        "entities.company_categories files it, in place of everybody. One of: "
        f"{', '.join(CATEGORY_VALUES)}.",
    )
    parser.add_argument(
        "--recent-days",
        type=non_negative_int,
        default=30,
        help="Priority: a new hire is somebody without a page whose public post "
        "began within this many days and has not ended. Default: %(default)s.",
    )
    parser.add_argument(
        "--bought-days",
        type=non_negative_int,
        default=7,
        help="Priority: right after the new hires, the pages of the people whose "
        "rejestr.io feed was bought within this many days, ahead of the "
        "published pages. 0: today's alone. Default: %(default)s.",
    )
    parser.add_argument(
        "--resend-after",
        type=non_negative_int,
        default=30,
        help="Priority: leave alone a payload already sent unchanged within this "
        "many days. 0: send it again every run. Default: %(default)s.",
    )
    parser.add_argument(
        "--max-uploads",
        type=non_negative_int,
        default=3000,
        help="Send the first N payloads and leave the rest to the next run "
        "(partial, 'limit'). Default: %(default)s.",
    )
    parser.add_argument(
        "--max-new",
        type=non_negative_int,
        help="Pages the run may create before it stops as failed. Default 0: "
        "an --on-koryta run that creates a page has missed somebody's identity. "
        "With --scope priority: the most pages a run plans to create - new "
        "hires and the people in an older public post together - default "
        "--max-uploads; a page made for anybody else stops it as failed.",
    )
    parser.add_argument(
        "--max-new-odpis-only",
        type=non_negative_int,
        help="Priority: the most new hires only an odpis names - no rejestr.io "
        "entry, so the ingest finds them by their name and birth date alone - "
        "a run sends, within --max-new. Default: a tenth of --max-uploads, "
        "rounded up.",
    )
    parser.add_argument(
        "--max-odpis-only-current",
        type=non_negative_int,
        help="Priority: the most people only an odpis names a run creates pages "
        "for whose public post has not ended and began before --recent-days, "
        f"within --max-new. Default: {ODPIS_ONLY_CURRENT_CAP}.",
    )
    parser.add_argument(
        "--max-rejestrio-current",
        type=non_negative_int,
        help="Priority: the most people with a rejestr.io entry a run creates "
        "pages for whose public post - any post - has not ended and began "
        f"before --recent-days, within --max-new. Default: {REJESTRIO_CURRENT_CAP}.",
    )
    parser.add_argument(
        "--max-published",
        type=non_negative_int,
        help="Priority: the most pages the export shows as published a run "
        "changes, whatever tier sends them - the bought and the noted as much "
        "as the published; the rest wait for the next runs, and the run goes "
        "on to the pages behind them. Default: no cap but --max-uploads.",
    )
    parser.add_argument(
        "--priority-group",
        action="append",
        type=parse_group,
        metavar="NAME:BUDGET[:new=N]",
        help="Priority: right after the noted pages, the people in a post now "
        f"at the public companies of a category, one of "
        f"{', '.join(CATEGORY_VALUES)} (skarb-panstwa: those on Prokuratoria's "
        "list of the Treasury's stakes), out of a budget of the "
        "group's own: BUDGET people, at most N of them pages to create "
        "(default: BUDGET). They count against no --max-* cap but --max-new, "
        "and the ones past the budget go as if there were no group. Only "
        "drafts to change and pages for people in an older public post: "
        "published pages and the people only an odpis names keep their caps. "
        "Or the people the BIP crawl downloaded an oświadczenie majątkowe for, "
        "by its newest list (koryta_scrape_bip found): oswiadczenia-szkice "
        "their drafts with no birth date, oswiadczenia-bez-strony those with "
        "no page, whom it makes one for in a public post now or in one that "
        "ended. "
        "Repeatable: the groups go in the order given, and somebody in two "
        "is sent for the first with room (entities.priority_groups).",
    )
    parser.add_argument(
        "--fill-rejestrio-current",
        action="store_true",
        help="Priority: when the plan comes to fewer than --max-uploads, fill "
        "the slots left with the people with a rejestr.io entry in an older "
        "public post that --max-rejestrio-current left out, newest seat "
        "first, within --max-new. Never published pages, nor the people only "
        "an odpis names.",
    )
    parser.add_argument(
        "--companies-only",
        action="store_true",
        help="Priority: send no people. Of the people the run would send - the "
        "first --max-uploads of its plan - create the companies they name that "
        "the export has no page for, through /api/ingest/company as the "
        "uploader creates them on the way, and report as company_import. The "
        "night's step before its people.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the payloads and report how many; send nothing and write "
        "nothing of the job's own - rebuilt pipelines still go to the shared "
        "cache unless --no-backup.",
    )
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT, help="Default: %(default)s."
    )
    parser.add_argument(
        "--koryta-date",
        type=iso_day,
        help="The day (YYYY-MM-DD) of the export --on-koryta and --only-changed "
        "compare against. Default: today. The run is refused unless the newest "
        "finished export is of that day, taken at 04:00 today or later.",
    )
    parser.add_argument(
        "--export",
        type=export_stamp,
        metavar="STAMP",
        help="An export already taken as fresh enough, as its folder is stamped "
        "(2026-10-10T02:00:59.242Z) - the night passes the one its export step "
        "took. The run compares with it, or a newer one, in place of the rule "
        "that the newest is today's, taken at 04:00 or later.",
    )
    parser.add_argument(
        "--refresh",
        action="append",
        metavar="NAME",
        help="A pipeline to rebuild rather than reuse; repeatable, and in place "
        "of the default set (DEFAULT_REFRESH: the newest crawl and export, "
        "and what is built from them). ':NAME' holds one as it is, alone "
        "taking it out of the default set; 'all' rebuilds everything, 'none' "
        "nothing. The export compared against is rebuilt whatever this says "
        "when the copy on disk is not built from the newest export.",
    )
    parser.add_argument(
        "--max-minutes",
        type=non_negative_float,
        default=120,
        help="Stop sending this many minutes after the start, the build "
        "included, and leave the rest to the next run. 0: no limit. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--interval",
        type=non_negative_float,
        default=0.3,
        help="Seconds between people - the uploader's pace. Default: %(default)s.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The payloads and the summary are "
        "written either way.",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parse = parser()
    args = parse.parse_args(argv)
    if args.request:
        # The page decides who: `plan_request` sets --max-new to the people
        # it was asked to add, once it knows them.
        args.scope = REQUEST
    if args.max_new is None:
        args.max_new = args.max_uploads if args.scope == PRIORITY else 0
    if args.max_new_odpis_only is None and args.scope == PRIORITY:
        args.max_new_odpis_only = -(-args.max_uploads // ODPIS_ONLY_PER)
    if args.max_odpis_only_current is None and args.scope == PRIORITY:
        args.max_odpis_only_current = ODPIS_ONLY_CURRENT_CAP
    if args.max_rejestrio_current is None and args.scope == PRIORITY:
        args.max_rejestrio_current = REJESTRIO_CURRENT_CAP
    if args.scope == "not-on-koryta" and args.max_new <= 0:
        parse.error(
            "--scope not-on-koryta creates a page for everybody it sends; say "
            "how many this run may create with --max-new"
        )
    if args.company_category and args.scope not in ("on-koryta", "not-on-koryta"):
        parse.error(
            "--company-category keeps --scope on-koryta or not-on-koryta to one "
            "sector's people; a priority run and a page's request choose their "
            "own people"
        )
    if args.companies_only and args.scope != PRIORITY:
        parse.error(
            "--companies-only creates the companies of the people a priority run "
            "sends: it needs --scope priority"
        )
    if (args.priority_group or args.fill_rejestrio_current) and args.scope != PRIORITY:
        parse.error(
            "--priority-group and --fill-rejestrio-current order a priority "
            "run's plan: they need --scope priority"
        )
    if twice := repeated(args.priority_group or []):
        parse.error(f"--priority-group: more than one group called {', '.join(twice)}")
    if args.refresh:
        known = pipeline_names() | {"all", REFRESH_NONE}
        unknown = sorted({name.removeprefix(":") for name in args.refresh} - known)
        if unknown:
            # A misspelt name would refresh nothing, and say nothing about it.
            parse.error(
                f"--refresh {' '.join(unknown)}: not a pipeline the payloads are "
                f"built from. One of: {', '.join(sorted(known))}"
            )
    return args


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    # `build_payloads` hands them theirs.
    sys.argv = sys.argv[:1]

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the person in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    run = CompaniesFirst if args.companies_only else PeopleImport
    try:
        return run(args, stop_rule(deadline, lambda: signalled)).run()
    finally:
        signal.signal(signal.SIGTERM, previous)
