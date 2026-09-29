import argparse
import collections
import json
import sys
import time
import typing
from dataclasses import dataclass

import numpy as np
import requests
from tqdm import tqdm

from analysis.interesting import Companies
from conductor import setup_context
from entities.company import display_name
from entities.company_bodies import supervisory_body
from entities.company_categories import categories_for
from entities.composite import PersonScore
from entities.person import is_pipeline_uid
from scrapers.map.jst import SKARB_PANSTWA
from scrapers.stores import ProcessPolicy, iterate_pipeline_dict
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.koryta_login import TokenSource, token_source
from util.firestore import Firestore

#: How many kinds of unplaced candidacy to name in the closing report. Enough
#: to act on, short enough to read - the same trade `UNMAPPED_COMMITTEES_REPORTED`
#: makes in `analysis/payloads/person.py`.
UNPLACED_REPORTED = 20

#: The job a `--submit` run of each type is reported under on
#: koryta.pl/admin/procesy, and the unit its progress counts. `computeNodes`
#: uploads nothing - it asks the site to recount - and `region` has no uploader
#: of its own, so neither is reported.
REPORTED_AS: dict[str, tuple[str, str]] = {
    "person": ("people_import", "osób"),
    "company": ("company_import", "firm"),
    "score": ("score_import", "ocen"),
    "extraction": ("extraction_import", "artykułów"),
}

#: What the site did with one person: the response's `person`, or nothing.
PersonOutcome = typing.Literal["created", "updated", "unchanged", "failed"]
#: The ones a response can report; "failed" is ours.
ANSWERED: tuple[PersonOutcome, ...] = ("created", "updated", "unchanged")

#: What a run of `--type person` counts, each shown on the page even at zero.
PERSON_COUNTERS = (
    "created",
    "updated",
    "unchanged",
    "employments_created",
    "companies_created",
    "unplaced",
    "failed",
    "skipped",
)

#: Seconds one person or company request may take. Unbounded, a request the
#: site never answers holds an unattended upload of thousands until somebody
#: notices; bounded, it is one person's failure and the run goes on.
REQUEST_TIMEOUT = 120

#: How much of a refused request's answer an error keeps: enough for the
#: site's message, not its whole error page.
ERROR_TEXT_CHARS = 300


class IngestRefused(Exception):
    """The site answered with something other than success.

    The message is the one `submit_payload` has always raised, payload and all;
    `status` and `text` are what a run's errors keep of it.
    """

    def __init__(self, status: int, text: str, payload: object):
        super().__init__(f"API error: {status} - {text} for: {payload}")
        self.status = status
        self.text = text


@dataclass
class PersonResult:
    """What one person's upload came to, as a run counts it."""

    outcome: PersonOutcome
    #: Of the last answer; None when the request got none at all.
    status: int | None = None
    #: Employments the site did not have before this upload.
    employments_created: int = 0
    #: Companies created first, because the payload named them and the site
    #: had no page for them to hang the employment on.
    companies_created: int = 0
    #: Candidacies the site took the person without.
    unplaced: int = 0
    #: For a failed one: "<status> <answer>", or the exception.
    error: str = ""
    #: The node the site filed the person under.
    person_id: str | None = None


def refusal(status: int, text: str) -> str:
    """A refused request as a run's errors keep it, on one line."""
    return f"{status} {' '.join(text.split())[:ERROR_TEXT_CHARS]}"


def one_line(error: BaseException) -> str:
    if isinstance(error, IngestRefused):
        return refusal(error.status, error.text)
    message = " ".join(str(error).split())[:ERROR_TEXT_CHARS]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


def run_state(attempted: int, failed: int) -> FinalState:
    """How /admin/procesy should read a run of uploads that ended by itself.

    Every request refused is the site refusing the run - a token it will not
    take, an endpoint that is down - and somebody should look. Some of them
    refused is a few payloads the site did not like, which the next run sends
    again, so the run is partial rather than broken.
    """
    if not failed:
        return "succeeded"
    return "failed" if failed >= attempted else "partial"


def failure_reason(attempted: int, failed: int) -> str | None:
    """What a run whose uploads failed says it stopped on, for the page."""
    if not failed:
        return None
    if failed >= attempted:
        return f"strona odrzuciła wszystkie wysyłki ({attempted})"
    return f"nieudane: {failed} z {attempted}"


def json_object(resp: requests.Response) -> dict:
    """The answer's JSON object, or an empty one for anything else."""
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def missing_companies(resp: requests.Response) -> list[str]:
    """The companies a 404 from the person ingest says it has no page for.

    Deduplicated, e.g if a person was employed there twice. Empty for any
    other answer - a 404 that does not list them is a refusal like any other,
    not something creating a company could fix.
    """
    if resp.status_code != 404:
        return []
    data = json_object(resp).get("data")
    if not isinstance(data, list):
        return []
    return sorted({str(krs) for krs in data})


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


class Args:
    endpoint: str
    submit: bool
    type: typing.Literal["person", "company", "region", "score", "extraction"]
    database: str
    limit: int | None
    offset: int | None
    model: str | None


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Upload koryta data to Firestore from stdin."
    )
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint URL"
    )
    parser.add_argument("--submit", action="store_true", help="Submit data to the API")
    parser.add_argument(
        "--type",
        choices=["person", "company", "region", "score", "extraction", "computeNodes"],
        help="Entity type to query",
    )
    parser.add_argument(
        "--database", type=str, default="koryta-pl", help="Firebase Database ID"
    )
    parser.add_argument(
        "--limit", type=int, help="Maximum number of entities to upload."
    )
    parser.add_argument(
        "--offset", type=int, default=0, help="Skip the first N entities."
    )
    parser.add_argument(
        "--prod", action="store_true", help="Production mode (requires token auth)"
    )
    parser.add_argument(
        "--model",
        type=str,
        help="For --type score: store the votes under this pipeline uid instead "
        "of the one the rows carry. The name must contain 'pipeline', which is "
        "what marks a vote as not cast by a person.",
    )
    args = parser.parse_known_args()[0]
    return args  # type: ignore


def clean_payload(payload):
    if isinstance(payload, dict):
        return {k: clean_payload(v) for k, v in payload.items() if v is not None}
    elif isinstance(payload, list):
        return [clean_payload(v) for v in payload if v is not None]
    else:
        return payload


#: The earliest election whose candidacies are sent to the site.
#:
#: 1998, not 2000. The cut-off went in at 2000 on 2026-08-24, when a candidacy
#: the ingest could not place failed the whole person with a 500; the 1990s were
#: where those came from. Since 2026-08-31 the ingest drops such a candidacy and
#: says so in `unplacedElections` instead, so the cut-off no longer protects
#: anything - and what it went on doing was keeping 1998 off the site.
#:
#: 1998's local elections were fought in the powiaty and województwa of the
#: reform that took effect on 1 January 1999, so their codes are today's: 15,468
#: of the 15,961 1998 candidacies in the 2026-09-29 `people_enriched` name a
#: region the site has a node for. The site held 180 candidacies from 1998 that
#: day, against 1,744 from 2002, and 34 pages with a party and no candidacy at
#: all had a placeable one from 1998 and nothing placeable after it.
#:
#: Earlier years stay out, because nothing in them can be placed. 1994 was
#: fought in the 49 old voivodeships and none of its 9,045 codes names a region
#: node; the parliamentary lists of 1991, 1993 and 1997 carry no region at all.
#: Sending them would only fill the run's report of unplaced candidacies.
FIRST_SENT_ELECTION_YEAR = 1998


def sendable_elections(elections: list[dict]) -> list[dict]:
    """The candidacies of a payload worth sending. See `FIRST_SENT_ELECTION_YEAR`.

    A candidacy with no year is left out, as it always has been: the ingest
    dates an edge by it, and an undated candidacy is indistinguishable from
    every other one in the same region.
    """
    return [
        election
        for election in elections
        if int(election.get("election_year") or 0) >= FIRST_SENT_ELECTION_YEAR
    ]


class Uploader:
    # Per-type ingest URLs handled by the generic submit_entity path. Extraction
    # is handled by ExtractionUploader (batched), so it is intentionally absent.
    TYPE_URLS: dict[str, str] = {}
    #: What a run of this type counts, each shown on the page even at zero.
    COUNTERS: tuple[str, ...] = ("uploaded", "failed", "skipped")

    def __init__(
        self,
        args: Args,
        tokens: TokenSource | None = None,
        session: requests.Session | None = None,
    ):
        self.args = args
        # How the run signs in - `stores.koryta_login`. Nothing is asked of it
        # until a request needs a token, so building an uploader signs in to
        # nothing.
        self.tokens = tokens if tokens is not None else token_source(args.endpoint)
        self.session = session if session is not None else requests.Session()
        #: Off once a renewed token was refused as well, or could not be had:
        #: from then on a 401 is the site refusing this account, and renewing
        #: for every person would mint - or ask for - one per request.
        self.can_refresh = True
        #: Where the run is reported, when it is.
        self.status: JobRun | None = None
        self.counts: collections.Counter[str] = collections.Counter(
            dict.fromkeys(self.COUNTERS, 0)
        )
        #: The first `ERRORS_KEPT` failures, as "<name or krs>: <what>".
        self.errors: list[str] = []
        #: Rows the run has got through, the skipped ones included.
        self.done = 0

        if args.type in ["score"]:
            # Same sign-in as every other type, only the token goes to
            # Firestore rather than to an ingest endpoint. A local stack asks
            # for none of it, so the login is passed rather than performed.
            self.firestore = Firestore(args, login=self.tokens.token)

    @staticmethod
    def create(
        args: Args,
        tokens: TokenSource | None = None,
        session: requests.Session | None = None,
    ) -> "Uploader":
        if args.type == "person":
            return PersonUploader(args, tokens, session)
        if args.type == "company":
            return CompanyUploader(args, tokens, session)
        if args.type == "extraction":
            return ExtractionUploader(args, tokens, session)
        if args.type == "score":
            return ScoreUploader(args, tokens, session)
        if args.type == "computeNodes":
            return ComputeNodesUploader(args, tokens, session)
        return Uploader(args, tokens, session)

    def auth_headers(self) -> dict[str, str]:
        """Headers for one request, with whichever token is good now."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens.token()}",
        }

    def post(
        self,
        url: str,
        data: str | None = None,
        timeout: float | None = REQUEST_TIMEOUT,
    ) -> requests.Response:
        """POST as the run's account; a 401 renews the token once and asks again.

        An id token lasts an hour and an upload of a few thousand people does
        not - the browser login's least of all, since nothing renews it before
        the site refuses it. A renewal that cannot be had raises, and the
        payload in hand is counted as failed.
        """
        resp = self.session.post(
            url, data=data, headers=self.auth_headers(), timeout=timeout
        )
        if resp.status_code != 401 or not self.can_refresh:
            return resp
        try:
            self.tokens.refresh()
        except Exception:
            self.can_refresh = False
            raise
        resp = self.session.post(
            url, data=data, headers=self.auth_headers(), timeout=timeout
        )
        if resp.status_code == 401:
            self.can_refresh = False
        return resp

    def submit_entity(self, payload) -> requests.Response:
        url = self.TYPE_URLS.get(self.args.type, None)

        if url is None:
            raise NotImplementedError(
                f"This function is not implemented for ${self.args.type}"
            )

        return self.submit_payload(url, payload)

    def submit_payload(self, url, payload, fail=True, verbose=False):
        print(
            f"Uploading {payload['name']}... to {url}",
            end=" ",
            file=sys.stderr,
        )
        cleaned_payload = clean_payload(payload)

        if "elections" in cleaned_payload:
            cleaned_payload["elections"] = sendable_elections(
                cleaned_payload["elections"]
            )

        request = json.dumps(cleaned_payload, cls=NumpyEncoder)
        if verbose:
            print(request, file=sys.stderr)
            print(payload, file=sys.stderr)
            print(cleaned_payload, file=sys.stderr)
        resp = self.post(url, request)
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            if resp.status_code == 500:
                print(f"Payload: {payload}", file=sys.stderr)
            if fail:
                raise IngestRefused(resp.status_code, resp.text, payload)

        return resp

    def submit_results(self, entities):
        self.success_count = 0
        self.total = 0
        self.note_progress(0, total=len(entities))
        for idx, payload in tqdm(enumerate(entities), total=len(entities)):
            if self.args.limit is not None and idx >= self.args.limit:
                print(f"Reached limit {self.args.limit}")
                break
            time.sleep(0.3)
            name = payload.get("name", None) if payload is not None else None
            if payload is None or name is None:
                print(
                    f"[{idx + 1}/{self.total}] Skipping invalid payload ...",
                    file=sys.stderr,
                )
                self.counts["skipped"] += 1
            else:
                self.submit_one(idx, payload, name)
            self.note_progress(idx + 1)

        failures = self.total - self.success_count
        print(
            f"\nUpload complete. Success: {self.success_count}, Failed: {failures}",
            file=sys.stderr,
        )
        self.report()

    def submit_one(self, idx: int, payload: dict, name: str) -> None:
        """Send one payload, and count what came of it."""
        label = str(payload.get("krs") or name)
        try:
            resp = self.check_success(self.submit_entity(payload))
        except Exception as error:
            # One bad row must not take the other 3,927 with it. The
            # `Failed:` count the run ends on says this was always the intent,
            # but `submit_payload` raises by default, so a single 404 - a
            # payload naming an owner the site does not have, say - ended the
            # run a few dozen companies in.
            self.total += 1
            print(
                f"[{idx + 1}] {payload.get('krs')} {name}: {error}",
                file=sys.stderr,
            )
            self.fail(label, one_line(error))
            return
        if resp.status_code in [200, 201]:
            self.counts["uploaded"] += 1
        else:
            self.fail(label, refusal(resp.status_code, resp.text))

    def fail(self, label: str, error: str) -> None:
        self.counts["failed"] += 1
        if len(self.errors) < ERRORS_KEPT:
            self.errors.append(f"{label}: {error}")

    def note_progress(self, done: int, total: int | None = None) -> None:
        self.done = done
        if self.status is not None:
            self.status.progress(done, total=total, counters=self.counts)

    def finish(self, status: JobRun) -> None:
        """Tell the page how the run ended, which only the uploader knows.

        Exit code 0 whatever happened, because that is what the command exits
        with: a failed payload is counted, never raised.
        """
        attempted = self.done - self.counts["skipped"]
        failed = self.counts["failed"]
        status.finish(
            run_state(attempted, failed),
            stop_reason=failure_reason(attempted, failed),
            errors=self.errors,
            exit_code=0,
            counters=self.counts,
            done=self.done,
        )

    def report(self) -> None:
        """Anything the run should say beyond how many requests succeeded."""

    def check_success(self, resp):
        self.total += 1
        if resp.status_code in [200, 201]:
            self.success_count += 1
        return resp


class CompanyUploader(Uploader):
    def __init__(
        self,
        args: Args,
        tokens: TokenSource | None = None,
        session: requests.Session | None = None,
        companies_policy: ProcessPolicy | None = None,
    ):
        super().__init__(args, tokens, session)
        self._company_payloads: dict | None = None
        #: What the `Companies` pipeline runs under when a company has to be
        #: looked up. None is `setup_context`'s default, which reuses an output
        #: on disk or in the shared cache - right on a laptop that keeps it
        #: current, and a stale copy on a fresh container.
        self.companies_policy = companies_policy

    @typing.override
    def submit_entity(self, payload):
        mapped_payload = dict(payload)
        return self.submit_company(mapped_payload["krs"], mapped_payload)

    @property
    def company_payloads(self) -> dict:
        """Company payloads keyed by KRS, loaded lazily from the Companies
        pipeline.

        Only needed as a fallback when a caller asks to submit a company by KRS
        without providing a payload (e.g. PersonUploader creating a missing
        company). Uploading companies with explicit payloads from stdin never
        triggers this, so `--type company` avoids re-running the whole
        (expensive) Companies pipeline.
        """
        if self._company_payloads is None:
            print("Loading company payloads from Companies pipeline")
            ctx = setup_context(policy=self.companies_policy)[0]
            df = Companies().read_or_process(ctx)
            self._company_payloads = {c["krs"]: c for c in iterate_pipeline_dict(df)}
        return self._company_payloads

    def submit_company(self, krs: str, payload: dict | None, fail: bool = True):
        current_target_url = f"{self.args.endpoint}/api/ingest/company"
        if payload is None:
            payload = self.company_payloads.get(krs, None)
            if payload is None:
                raise ValueError(f"Couldn't look up {krs} in Companies pipeline")

        assert payload is not None

        # TODO move it somewhere else - Companies pipeline?
        #
        # Two kinds of owner, because the register names two. A company owner
        # has a KRS number and becomes a place-to-place edge; a gmina, powiat or
        # wojewodztwo has none and is carried as the TERYT code
        # `entities.company_categories`' sibling `scrapers.map.jst` resolved its
        # name to. Only the first used to be kept - `if parent.get("krs")` - so
        # all 1,675 government owners in the register died here.
        # Derived here only when the payload has not worked them out already.
        # `CompaniesPayloads` has, and it carries no `parents` at all - so
        # deriving unconditionally overwrote 946 company owners and 1,390 JST
        # owners with two empty lists, and the ingest reported every one of the
        # 3,928 uploads as OK while writing no ownership edge whatsoever. Same
        # guard `categories` has above, and for the same reason: a company that
        # arrives straight from the `Companies` pipeline because somebody works
        # there has `parents` and nothing else, and one that comes through
        # `CompaniesPayloads` is the other way round.
        if "owners" not in payload and "owner_teryts" not in payload:
            owners, owner_teryts = [], []
            skarb_panstwa = False
            for parent in payload.get("parents", []):
                if not isinstance(parent, dict):
                    continue
                if parent.get("krs"):
                    owners.append(parent["krs"])
                elif parent.get("teryt") == SKARB_PANSTWA:
                    # Not a territory, and the ingest must not look it up as
                    # one. Same split `CompaniesPayloads` does.
                    skarb_panstwa = True
                elif parent.get("teryt"):
                    owner_teryts.append(parent["teryt"])
            payload["owners"] = owners
            payload["owner_teryts"] = owner_teryts
            payload["owner_skarb_panstwa"] = skarb_panstwa
        if "teryt_code" in payload and payload["teryt_code"]:
            payload["teryt"] = payload["teryt_code"]
        # `CompaniesPayloads` already worked these out, but a company created
        # because somebody works there arrives straight from the `Companies`
        # pipeline and has none. Filled in rather than recomputed, so the two
        # paths cannot disagree about what a company is - and so an empty list
        # from the payload producer stays empty rather than being taken for a
        # missing value.
        form = payload.get("form")
        form = form if isinstance(form, str) and form.strip() else None
        if "categories" not in payload:
            activity = payload.get("activity")
            wiki_categories = payload.get("wiki_categories")
            payload["categories"] = categories_for(
                payload.get("krs"),
                list(activity) if isinstance(activity, (list, np.ndarray)) else [],
                form,
                list(wiki_categories)
                if isinstance(wiki_categories, (list, np.ndarray))
                else [],
            )
        if "supervisory_body" not in payload:
            payload["supervisory_body"] = supervisory_body(form)
        # The register's own `formaPrawna`, for display beside a hospital's
        # board. Not filled in when absent, unlike the two above: those follow
        # from the form by a rule this side can apply, and this is the form.
        if "legal_form" not in payload and form:
            payload["legal_form"] = form
        # A company created because a person works there comes straight from
        # the Companies pipeline rather than through CompaniesPayloads, so it
        # needs the same disambiguation.
        payload["name"] = display_name(payload.get("name"), payload.get("city"))
        return self.submit_payload(current_target_url, payload, fail=fail)


class PersonUploader(CompanyUploader):
    """PersonUploader submits results for a given person.

    It inherits CompanyUplader, since it needs to upload companies
    if they are missing."""

    COUNTERS = PERSON_COUNTERS

    def __init__(
        self,
        args: Args,
        tokens: TokenSource | None = None,
        session: requests.Session | None = None,
        companies_policy: ProcessPolicy | None = None,
    ):
        super().__init__(args, tokens, session, companies_policy)
        #: Candidacies the site accepted the person without. Counted because
        #: the ingest no longer fails a person over one: a candidacy PKW filed
        #: without a constituency, or one in a region with no node yet, used to
        #: 500 the whole request and take the person's employments with it. The
        #: run has to say what it left behind, or the fix is just silence.
        self.unplaced: collections.Counter[str] = collections.Counter()

    @typing.override
    def submit_one(self, idx: int, payload: dict, name: str) -> None:
        result = self.upload_person(payload)
        self.total += 1
        if result.outcome != "failed":
            self.success_count += 1
        elif result.status is None:
            # No answer at all, so nothing has printed why; an answer that
            # refused the person was printed as it came.
            print(
                f"[{idx + 1}] {payload.get('krs')} {name}: {result.error}",
                file=sys.stderr,
            )
        self.count_person(name, result)

    def upload_person(self, payload: dict) -> PersonResult:
        """Send one person - first creating any company the site has no page
        for - and say what the site made of them.

        Nothing that goes wrong with one person raises: a refusal, no answer at
        all, a company that could not be created. An upload of thousands goes
        on past each, so the result says what happened instead, and the daily
        import (`jobs.people_import`) counts it exactly as a run of this
        command does.
        """
        url = f"{self.args.endpoint}/api/ingest/person"
        companies_created = 0
        try:
            resp = self.submit_payload(url, payload, fail=False)
            missing = missing_companies(resp)
            if missing:
                for krs in missing:
                    company = self.submit_company(krs, None, fail=False)
                    if company.status_code not in [200, 201]:
                        return PersonResult(
                            "failed",
                            status=company.status_code,
                            companies_created=companies_created,
                            error=f"firma {krs}: "
                            + refusal(company.status_code, company.text),
                        )
                    companies_created += 1
                # Try submitting again
                resp = self.submit_payload(url, payload, fail=False)
        except Exception as error:
            return PersonResult(
                "failed", companies_created=companies_created, error=one_line(error)
            )
        unplaced = self.count_unplaced(resp)
        if resp.status_code != 200:
            return PersonResult(
                "failed",
                status=resp.status_code,
                companies_created=companies_created,
                error=refusal(resp.status_code, resp.text),
            )
        body = json_object(resp)
        outcome = body.get("person")
        person_id = body.get("personId")
        employments = [
            company
            for company in body.get("companies") or []
            if isinstance(company, dict) and company.get("created") is True
        ]
        return PersonResult(
            # A site from before the field was added said only that it took
            # the person, and taking is a write as far as anyone can tell.
            outcome if outcome in ANSWERED else "updated",
            status=resp.status_code,
            employments_created=len(employments),
            companies_created=companies_created,
            unplaced=unplaced,
            person_id=str(person_id) if person_id else None,
        )

    def count_person(self, name: str, result: PersonResult) -> None:
        """Add one person's upload to what the run has counted."""
        self.counts[result.outcome] += 1
        self.counts["employments_created"] += result.employments_created
        self.counts["companies_created"] += result.companies_created
        self.counts["unplaced"] += result.unplaced
        if result.outcome == "failed" and len(self.errors) < ERRORS_KEPT:
            self.errors.append(f"{name}: {result.error}")

    def count_unplaced(self, resp: requests.Response) -> int:
        """Tally what the response says it could not place, and say how many.

        Read defensively: a non-200, a body that is not JSON, or a site
        deployed before the field existed all mean "nothing to report" rather
        than an error in the middle of an upload of several thousand people.
        """
        if resp.status_code != 200:
            return 0
        try:
            body = resp.json()
        except ValueError:
            return 0
        if not isinstance(body, dict):
            return 0
        counted = 0
        for entry in body.get("unplacedElections") or []:
            if not isinstance(entry, dict):
                continue
            kind = "expected" if entry.get("expected") else str(entry.get("reason"))
            year = entry.get("election_year") or "?"
            self.unplaced[f"{entry.get('election_type')} {year} ({kind})"] += 1
            counted += 1
        return counted

    @typing.override
    def report(self) -> None:
        if not self.unplaced:
            return
        total = sum(self.unplaced.values())
        print(
            f"\n{total} candidacies were not placed. `expected` is an election "
            "PKW published no constituency mapping for; the rest are worth a "
            "look - `no-region` means the region node is not there yet.",
            file=sys.stderr,
        )
        for label, count in self.unplaced.most_common(UNPLACED_REPORTED):
            print(f"  {count:6d}  {label}", file=sys.stderr)
        if len(self.unplaced) > UNPLACED_REPORTED:
            print(
                f"  ... and {len(self.unplaced) - UNPLACED_REPORTED} more kinds",
                file=sys.stderr,
            )


class ScoreUploader(Uploader):
    """Uploads one scoring model's shortlist of people worth a look.

    Scores go straight to Firestore rather than through the API: they are the
    pipeline's own opinion rather than a fact about a person, and they are
    stored as votes so that the site's existing aggregate does the combining.
    Each model votes under its own uid, so uploading one model never touches
    another's scores. Against a deployed site that write is judged by
    `firestore.rules`, which want the uploader in the datascience group - see
    `util.firestore`.

    Unlike the per-entity uploaders this writes the whole run at once, because
    what to write can only be decided against what the model wrote last time -
    see `Firestore.replace_scores`.
    """

    COUNTERS = ("written", "retracted", "unchanged")

    @typing.override
    def submit_results(self, entities):
        self.note_progress(0, total=len(entities))
        rows = [PersonScore(**e) for e in entities if e is not None]
        if not rows:
            print("No scores to upload.", file=sys.stderr)
            self.note_progress(len(entities))
            return

        model = self.model_of(rows)
        # Only part of the run reached us, so a person missing from it may
        # simply have been cut off rather than dropped by the model.
        partial = bool(self.args.limit or self.args.offset)
        written, retracted = self.firestore.replace_scores(
            model, rows, retract=not partial
        )

        self.total = len(rows)
        self.success_count = len(rows)
        self.counts["written"] = written
        self.counts["retracted"] = retracted
        self.counts["unchanged"] = len(rows) - written
        self.note_progress(len(entities))
        print(
            f"\nUpload complete. Model: {model}, written: {written}, "
            f"retracted: {retracted}, unchanged: {len(rows) - written}",
            file=sys.stderr,
        )

    def model_of(self, rows: list[PersonScore]) -> str:
        """The uid to store this run under, and a check that it is a robot's.

        A vote whose uid does not read as the pipeline's would be counted as
        human review by the frontend, which would mark thousands of people as
        looked at by somebody when nobody has looked at them.
        """
        if self.args.model:
            model = self.args.model
        else:
            models = {row.model for row in rows}
            if len(models) != 1:
                raise ValueError(
                    f"Expected one model per upload, got {sorted(models)}. "
                    "Upload each model's scores separately, or pass --model."
                )
            model = models.pop()

        if not is_pipeline_uid(model):
            raise ValueError(
                f"Model uid {model!r} does not contain 'pipeline', so the site "
                "would count its votes as human review."
            )
        return model


class ExtractionUploader(Uploader):
    """Uploads facts extracted from newspaper articles.

    Each stdin line is a full article carrying an ``extracted_facts`` list. The
    ``/api/ingest/extraction`` endpoint accepts a batch of articles in a single
    request, so unlike the per-entity uploaders we post everything at once. The
    articles have no ``name`` field, so the generic ``submit_results`` (which
    skips nameless payloads and prints ``payload['name']``) doesn't apply.
    """

    COUNTERS = ("articles", "facts")

    @typing.override
    def submit_results(self, entities):
        url = f"{self.args.endpoint}/api/ingest/extraction"
        articles = [e for e in entities if e is not None]
        fact_count = sum(len(a.get("extracted_facts") or []) for a in articles)
        self.total = fact_count
        self.success_count = 0
        self.note_progress(0, total=len(entities))

        print(
            f"Uploading {len(articles)} articles ({fact_count} facts) to {url}...",
            end=" ",
            file=sys.stderr,
        )
        # Note: do not run clean_payload here — the endpoint schema keeps
        # `title`/`publication_date` as nullable-but-required, so stripping
        # their `null` values would fail validation. No timeout either: the
        # whole run is this one request, and it is as long as the run is big.
        resp = self.post(
            url,
            json.dumps({"articles": articles}, cls=NumpyEncoder),
            timeout=None,
        )
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
            self.success_count = fact_count
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            raise Exception(f"API error: {resp.status_code} - {resp.text}")

        self.counts["articles"] = len(articles)
        self.counts["facts"] = fact_count
        self.note_progress(len(entities))
        print(
            f"\nUpload complete. Articles: {len(articles)}, Facts: {fact_count}",
            file=sys.stderr,
        )


class ComputeNodesUploader(Uploader):
    """Uploads compute nodes POST request to the API."""

    @typing.override
    def submit_results(self, _entities):
        url = f"{self.args.endpoint}/api/stats/computeNodes"

        print(
            f"Calling compute nodes to {url}...",
            end=" ",
            file=sys.stderr,
        )
        # Unbounded, as it always was: the recount is minutes of work.
        resp = self.post(url, timeout=None)
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            raise Exception(f"API error: {resp.status_code} - {resp.text}")

        print(
            "\nFinished",
            file=sys.stderr,
        )


def print_results(entities):
    print("\n--- Payload Preview (First 3) ---", file=sys.stderr)
    for i in range(min(3, len(entities))):
        print(json.dumps(entities[i], indent=2, ensure_ascii=False), file=sys.stderr)


def read_payloads_filtered(args) -> list[dict]:
    # Read from stdin
    entities = []
    skipped = 0
    count = 0

    if sys.stdin.isatty():
        print("Waiting for JSONL data on standard input...", file=sys.stderr)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            print(f"Error parsing JSON on line: {e}", file=sys.stderr)
            continue

        # Allow offsetting the reads, skipping the 'offset' first entries.
        if skipped < args.offset:
            skipped += 1
            continue

        entities.append(payload)
        count += 1

        if args.limit and count >= args.limit:
            break

    return entities


def main():
    args = parse_args()

    entities = read_payloads_filtered(args)
    print(f"Query returned {len(entities)} rows.", file=sys.stderr)

    if len(entities) == 0:
        print("No results.", file=sys.stderr)
        sys.exit(0)

    if not args.submit:
        print_results(entities)
        print("\nUse --submit to upload.", file=sys.stderr)
    else:
        submit(args, entities)


def submit(
    args: Args,
    entities: list,
    tokens: TokenSource | None = None,
    session: requests.Session | None = None,
) -> None:
    """Upload `entities`, reporting the run to /admin/procesy when its type is
    one the page follows (`REPORTED_AS`)."""
    reported = REPORTED_AS.get(args.type)
    if reported is None:
        Uploader.create(args, tokens, session).submit_results(entities)
        return
    job, unit = reported
    # A `with`, and the uploader built inside it, so a run that raises - a
    # sign-in refused, a site that is down - is reported as failed, and Ctrl+C
    # as stopped by hand.
    with JobRun(job, unit=unit, total=len(entities)) as status:
        uploader = Uploader.create(args, tokens, session)
        uploader.status = status
        uploader.submit_results(entities)
        uploader.finish(status)


if __name__ == "__main__":
    main()
