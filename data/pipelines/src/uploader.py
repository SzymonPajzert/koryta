import argparse
import collections
import json
import os
import sys
import time
import typing

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
from scrapers.stores import iterate_pipeline_dict
from stores.auth import authenticate_user
from util.firestore import Firestore

#: How many kinds of unplaced candidacy to name in the closing report. Enough
#: to act on, short enough to read - the same trade `UNMAPPED_COMMITTEES_REPORTED`
#: makes in `analysis/payloads/person.py`.
UNPLACED_REPORTED = 20

#: Contracts per request to `/api/ingest/contracts`. The register's first
#: window alone is 149,683 of them, and the per-entity path here sleeps 0.3 s
#: between requests - 12.5 hours of sleep before counting the requests
#: themselves. At 200 a batch that is 749 requests. The ceiling is the ingest's
#: own `.max(500)` on the array; 200 keeps a failed batch small enough to read
#: in the error message and a request body around 165 KB (measured: a cleaned
#: payload averages 846 bytes over the first 20,000 contracts of the register).
CONTRACT_BATCH = 200

#: How many unresolved NIPs to name in the closing report. That list is the
#: point of the counter - it is how somebody decides which institution to add
#: to koryta.pl next - and 20 is the same trade `UNPLACED_REPORTED` makes:
#: enough to act on, short enough to read at the end of a 749-request run.
UNRESOLVED_NIPS_REPORTED = 20

#: Findings per request to `/api/ingest/contracts/powiazania`. A finding is a
#: few KB (people, candidacies, up to 12 buyers, every contract id), and the
#: ingest caps a batch at 100; 50 keeps a failed batch readable.
CONTRACT_LINK_BATCH = 50


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


class Args:
    endpoint: str
    submit: bool
    type: typing.Literal[
        "person",
        "company",
        "region",
        "score",
        "extraction",
        "contract",
        "contract-link",
        "contract-link-contract",
    ]
    database: str
    limit: int | None
    offset: int | None
    model: str | None
    skip_unlinked: bool


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
        choices=[
            "person",
            "company",
            "region",
            "score",
            "extraction",
            "contract",
            "contract-link",
            "contract-link-contract",
            "computeNodes",
        ],
        help="Entity type to query",
    )
    parser.add_argument(
        "--skip-unlinked",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="For --type contract: ask the ingest to keep only the contracts "
        "with at least one end on a company koryta.pl already has. 13,333 of "
        "the register's 149,683 are, touching 825 companies, so the default "
        "stores 9% of what it is offered. --no-skip-unlinked stores all of it, "
        "which is 149,683 documents nothing on the site can currently reach.",
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


class Uploader:
    # Per-type ingest URLs handled by the generic submit_entity path. Extraction
    # is handled by ExtractionUploader (batched), so it is intentionally absent.
    TYPE_URLS: dict[str, str] = {}

    def __init__(self, args: Args):
        self.args = args

        if args.type in ["score"]:
            # Same browser login as every other type, only the token goes to
            # Firestore rather than to an ingest endpoint. A local stack asks
            # for none of it, so the login is passed rather than performed.
            self.firestore = Firestore(
                args, login=lambda: authenticate_user(args.endpoint)
            )
        else:
            # A token handed over in the environment skips the browser round
            # trip - what a headless run against a local stack needs, where the
            # auth emulator hands one out for a password. The score path above
            # reads the same variable (`util/firestore.py`).
            token = os.environ.get("KORYTA_ID_TOKEN") or authenticate_user(
                args.endpoint
            )
            self.headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            }

    @staticmethod
    def create(args: Args) -> "Uploader":
        if args.type == "person":
            return PersonUploader(args)
        if args.type == "company":
            return CompanyUploader(args)
        if args.type == "extraction":
            return ExtractionUploader(args)
        if args.type == "contract":
            return ContractUploader(args)
        if args.type == "contract-link":
            return ContractLinkUploader(args)
        if args.type == "contract-link-contract":
            return ContractLinkContractUploader(args)
        if args.type == "score":
            return ScoreUploader(args)
        if args.type == "computeNodes":
            return ComputeNodesUploader(args)
        return Uploader(args)

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
            cleaned_payload["elections"] = [
                e
                for e in cleaned_payload["elections"]
                if int(e.get("election_year", "0")) > 1999
            ]

        request = json.dumps(cleaned_payload, cls=NumpyEncoder)
        if verbose:
            print(request, file=sys.stderr)
            print(payload, file=sys.stderr)
            print(cleaned_payload, file=sys.stderr)
        resp = requests.post(
            url,
            data=request,
            headers=self.headers,
        )
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            if resp.status_code == 500:
                print(f"Payload: {payload}", file=sys.stderr)
            if fail:
                raise Exception(
                    f"API error: {resp.status_code} - {resp.text} for: {payload}"
                )

        return resp

    def submit_results(self, entities):
        self.success_count = 0
        self.total = 0
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
                continue

            try:
                self.check_success(self.submit_entity(payload))
            except Exception as error:
                # One bad row must not take the other 3,927 with it. The
                # `Failed:` counter below says this was always the intent, but
                # `submit_payload` raises by default, so a single 404 - a
                # payload naming an owner the site does not have, say - ended
                # the run a few dozen companies in.
                self.total += 1
                print(
                    f"[{idx + 1}] {payload.get('krs')} {name}: {error}",
                    file=sys.stderr,
                )

        failures = self.total - self.success_count
        print(
            f"\nUpload complete. Success: {self.success_count}, Failed: {failures}",
            file=sys.stderr,
        )
        self.report()

    def report(self) -> None:
        """Anything the run should say beyond how many requests succeeded."""

    def partial(self) -> bool:
        """Whether `--limit` or `--offset` cut the input short. An uploader
        that prunes whatever its run did not send must not do it after one of
        these: what the run did not see is not what the source dropped."""
        return bool(self.args.limit or self.args.offset)

    def post(self, url: str, body: dict) -> dict:
        """POST `body` as JSON and return the answer, `{}` when it is not
        JSON; anything but a 200 or 201 raises."""
        resp = requests.post(
            url, data=json.dumps(body, cls=NumpyEncoder), headers=self.headers
        )
        if resp.status_code not in [200, 201]:
            raise Exception(f"API error: {resp.status_code} - {resp.text[:1000]}")
        try:
            return resp.json()
        except ValueError:
            return {}

    def check_success(self, resp):
        self.total += 1
        if resp.status_code == 200:
            self.success_count += 1
        return resp


class CompanyUploader(Uploader):
    def __init__(self, args: Args):
        super().__init__(args)
        self._company_payloads: dict | None = None

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
            df = Companies().read_or_process(setup_context()[0])
            self._company_payloads = {c["krs"]: c for c in iterate_pipeline_dict(df)}
        return self._company_payloads

    def submit_company(self, krs: str, payload: dict | None):
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
            payload["categories"] = categories_for(
                payload.get("krs"),
                list(activity) if isinstance(activity, (list, np.ndarray)) else [],
                form,
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
        return self.submit_payload(
            current_target_url,
            payload,
        )


class PersonUploader(CompanyUploader):
    """PersonUploader submits results for a given person.

    It inherits CompanyUplader, since it needs to upload companies
    if they are missing."""

    def __init__(self, args: Args):
        super().__init__(args)
        #: Candidacies the site accepted the person without. Counted because
        #: the ingest no longer fails a person over one: a candidacy PKW filed
        #: without a constituency, or one in a region with no node yet, used to
        #: 500 the whole request and take the person's employments with it. The
        #: run has to say what it left behind, or the fix is just silence.
        self.unplaced: collections.Counter[str] = collections.Counter()

    @typing.override
    def submit_entity(self, payload):
        current_target_url = f"{self.args.endpoint}/api/ingest/person"
        resp = self.check_success(
            self.submit_payload(
                current_target_url,
                payload,
                fail=False,
            )
        )
        if resp.status_code == 404:
            # Deduplicate, e.g if a person was employed there twice
            for krs in set(resp.json()["data"]):
                self.submit_company(krs, None)
            # Try submitting again
            resp = self.submit_payload(current_target_url, payload, fail=False)
        self.count_unplaced(resp)
        return resp

    def count_unplaced(self, resp: requests.Response) -> None:
        """Tally what the response says it could not place.

        Read defensively: a non-200, a body that is not JSON, or a site
        deployed before the field existed all mean "nothing to report" rather
        than an error in the middle of an upload of several thousand people.
        """
        if resp.status_code != 200:
            return
        try:
            body = resp.json()
        except ValueError:
            return
        if not isinstance(body, dict):
            return
        for entry in body.get("unplacedElections") or []:
            if not isinstance(entry, dict):
                continue
            kind = "expected" if entry.get("expected") else str(entry.get("reason"))
            year = entry.get("election_year") or "?"
            self.unplaced[f"{entry.get('election_type')} {year} ({kind})"] += 1

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

    @typing.override
    def submit_results(self, entities):
        rows = [PersonScore(**e) for e in entities if e is not None]
        if not rows:
            print("No scores to upload.", file=sys.stderr)
            return

        model = self.model_of(rows)
        # Only part of the run reached us, so a person missing from it may
        # simply have been cut off rather than dropped by the model.
        written, retracted = self.firestore.replace_scores(
            model, rows, retract=not self.partial()
        )

        self.total = len(rows)
        self.success_count = len(rows)
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

    @typing.override
    def submit_results(self, entities):
        url = f"{self.args.endpoint}/api/ingest/extraction"
        articles = [e for e in entities if e is not None]
        fact_count = sum(len(a.get("extracted_facts") or []) for a in articles)
        self.total = fact_count
        self.success_count = 0

        print(
            f"Uploading {len(articles)} articles ({fact_count} facts) to {url}...",
            end=" ",
            file=sys.stderr,
        )
        # Note: do not run clean_payload here — the endpoint schema keeps
        # `title`/`publication_date` as nullable-but-required, so stripping
        # their `null` values would fail validation.
        resp = requests.post(
            url,
            data=json.dumps({"articles": articles}, cls=NumpyEncoder),
            headers=self.headers,
        )
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
            self.success_count = fact_count
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            raise Exception(f"API error: {resp.status_code} - {resp.text}")

        print(
            f"\nUpload complete. Articles: {len(articles)}, Facts: {fact_count}",
            file=sys.stderr,
        )


class ContractUploader(Uploader):
    """Uploads public contracts from `ContractsPayloads` to the site.

    The only batching uploader besides `ExtractionUploader`, and the only one
    where batching is not a nicety: the first six weeks of the Centralny
    Rejestr Umow are 149,683 contracts, and the per-entity path posts one
    request each with a 0.3 s sleep between them - 12.5 hours of sleeping
    before anything else is counted. At `CONTRACT_BATCH` a request that is 749
    requests, and no sleep: the ingest writes through a `bulkWriter` and is
    idempotent per contract, so the rate this can go at is the server's to
    decide and not this file's to guess.

    `skipUnlinked` is the other half of the arrangement. The register is a
    national one and this site describes 825 of its 12,858 contracting
    institutions, so the ingest is asked to keep only the 13,333 contracts with
    at least one end on a company koryta.pl has and to report the rest as
    `skipped`. It is sent explicitly on every batch: the endpoint defaults it
    to false, because storing the whole register is a defensible choice and not
    one an uploader should make by omission.

    What did not resolve comes back as `unresolvedNips`, summed here across the
    run and printed at the end. That list, ordered by how often a NIP came
    back, is the answer to "which institution should we add next", and this is
    the only place it exists - the endpoint recomputes it per batch and keeps
    nothing.
    """

    #: Where the batches go, under `--endpoint`.
    route = "/api/ingest/contracts"

    def __init__(self, args: Args):
        super().__init__(args)
        #: `written`/`skipped`/`linked`/`bothLinked`, summed over every batch.
        #: Per-batch they say nothing; the run's totals are what can be checked
        #: against the measured 13,333 linked and 825 companies.
        self.counters: collections.Counter[str] = collections.Counter()
        #: NIPs the site has no company for, by how many batches named them -
        #: see `count_unresolved` for why that is not a contract count.
        self.unresolved: collections.Counter[str] = collections.Counter()

    @typing.override
    def submit_results(self, entities):
        url = f"{self.args.endpoint}{self.route}"
        # Cleaned, unlike `ExtractionUploader`'s articles, which cannot be:
        # `cruContractSchema` is `nullish` throughout, so a key that is absent
        # and a key that is null mean the same thing to it. The payload carries
        # every field as a key even where the register said nothing - that is
        # what keeps the pipeline's DataFrame columns stable - and dropping the
        # nulls again here takes 22% off the wire, measured over the first
        # 20,000 contracts: 846 bytes a payload against 1,084.
        contracts = [clean_payload(e) for e in entities if e is not None]
        batches = [
            contracts[start : start + CONTRACT_BATCH]
            for start in range(0, len(contracts), CONTRACT_BATCH)
        ]
        self.total = len(contracts)
        self.success_count = 0

        print(
            f"Uploading {self.total} contracts to {url} in {len(batches)} "
            f"batches of up to {CONTRACT_BATCH}"
            f"{'' if self.args.skip_unlinked else ', keeping unlinked ones'}",
            file=sys.stderr,
        )
        for batch in tqdm(batches):
            try:
                self.submit_batch(url, batch)
                self.success_count += len(batch)
            except Exception as error:
                # One rejected batch must not take the other 748 with it. The
                # ingest is idempotent per contract, so a batch that failed can
                # simply be re-sent with `--offset`.
                print(
                    f"Batch starting {batch[0].get('id_umowy')}: {error}",
                    file=sys.stderr,
                )

        failures = self.total - self.success_count
        print(
            f"\nUpload complete. Contracts: {self.success_count}, "
            f"in failed batches: {failures}",
            file=sys.stderr,
        )
        self.finish(url, contracts)
        self.report()

    def batch_body(self, batch: list[dict]) -> dict:
        return {"contracts": batch, "skipUnlinked": self.args.skip_unlinked}

    def finish(self, url: str, contracts: list[dict]) -> None:
        """Anything the run does once every batch has been sent."""

    def submit_batch(self, url: str, batch: list[dict]) -> None:
        resp = requests.post(
            url,
            data=json.dumps(self.batch_body(batch), cls=NumpyEncoder),
            headers=self.headers,
        )
        if resp.status_code not in [200, 201]:
            # Truncated: a rejected batch of 200 contracts can answer with a zod
            # issue per field per contract, and a megabyte of it on stderr
            # buries every other line of the run.
            raise Exception(f"API error: {resp.status_code} - {resp.text[:1000]}")
        self.count_batch(resp)

    def count_batch(self, resp: requests.Response) -> None:
        """Add one response's counters to the run's.

        Read defensively, the same way `count_unplaced` is: a body that is not
        JSON, or a site deployed before a counter existed, means "nothing to
        report" rather than an exception in the middle of 749 requests that are
        otherwise succeeding.
        """
        try:
            body = resp.json()
        except ValueError:
            return
        if not isinstance(body, dict):
            return
        for name in ("written", "skipped", "linked", "bothLinked"):
            value = body.get(name)
            if isinstance(value, int) and not isinstance(value, bool):
                self.counters[name] += value
        self.count_unresolved(body.get("unresolvedNips"))

    def count_unresolved(self, unresolved) -> None:
        """Tally the NIPs the ingest could not place.

        The ingest answers with a bare list, deduplicated within the batch
        (`Array.from(unresolved)`), so what this counts is batches and not
        contracts. That still ranks: the mirror is ordered by a UUID, so an
        institution's contracts are spread evenly over the 749 batches of a
        full run and a NIP on 400 contracts lands in far more of them than one
        on three. Read the number as a lower bound on contracts, not as one.

        A list of `{nip, count}` objects and a NIP-to-count map are accepted
        too, so that the day the endpoint starts counting properly this file
        does not have to be the thing that notices.
        """
        items: typing.Iterable[tuple[typing.Any, typing.Any]]
        if isinstance(unresolved, dict):
            items = unresolved.items()
        elif isinstance(unresolved, list):
            items = [self._unresolved_entry(entry) for entry in unresolved]
        else:
            return
        for nip, count in items:
            if nip and isinstance(count, int) and not isinstance(count, bool):
                self.unresolved[str(nip)] += count

    @staticmethod
    def _unresolved_entry(entry) -> tuple[typing.Any, int]:
        if isinstance(entry, dict):
            count = entry.get("count", 1)
            return entry.get("nip") or entry.get("regon"), (
                count if isinstance(count, int) else 1
            )
        return entry, 1

    @typing.override
    def report(self) -> None:
        if self.counters:
            print(
                "\n"
                + "  ".join(
                    f"{name}: {self.counters[name]}"
                    for name in ("written", "skipped", "linked", "bothLinked")
                ),
                file=sys.stderr,
            )
        if not self.unresolved:
            return
        print(
            f"\n{len(self.unresolved)} NIPs on these contracts have no company "
            "on koryta.pl. Adding the ones at the top is what turns the most "
            "contracts into something the site can say anything about:",
            file=sys.stderr,
        )
        for nip, count in self.unresolved.most_common(UNRESOLVED_NIPS_REPORTED):
            print(f"  {count:6d}  {nip}", file=sys.stderr)


class ContractLinkUploader(Uploader):
    """Uploads the CRU findings from `ContractLinkPayloads`.

    In batches of `CONTRACT_LINK_BATCH`, then one closing request that carries
    every id the run wrote as `final.keep`. That closing call is what makes a
    run authoritative: the ingest deletes the findings it does not name - a
    supplier the review has since rejected has to stop being served, not
    linger from an older run - and recomputes `stats/powiazania`. It is only
    sent when the run saw every finding and every batch went through: a run
    that pruned after a failed batch would delete the findings of that batch,
    and one cut by `--limit` or `--offset` every finding outside the cut.
    """

    @typing.override
    def submit_results(self, entities):
        url = f"{self.args.endpoint}/api/ingest/contracts/powiazania"
        links = [clean_payload(e) for e in entities if e is not None]
        batches = [
            links[start : start + CONTRACT_LINK_BATCH]
            for start in range(0, len(links), CONTRACT_LINK_BATCH)
        ]
        self.total = len(links)
        self.success_count = 0
        print(
            f"Uploading {self.total} findings to {url} in {len(batches)} batches",
            file=sys.stderr,
        )
        for batch in tqdm(batches):
            try:
                self.post(url, {"links": batch})
                self.success_count += len(batch)
            except Exception as error:
                print(f"Batch starting {batch[0].get('nip')}: {error}", file=sys.stderr)

        if self.success_count != self.total:
            print(
                f"\n{self.total - self.success_count} findings failed; not pruning "
                "or recomputing the summary. Re-run once they go through.",
                file=sys.stderr,
            )
            return
        if self.partial():
            print(
                f"\nUploaded {self.success_count} findings. --limit/--offset "
                "sent only part of the run, so not pruning or recomputing the "
                "summary: every finding outside it would be deleted.",
                file=sys.stderr,
            )
            return
        keep = [f"cru_{link['nip']}" for link in links]
        body = self.post(url, {"links": [], "final": {"keep": keep}})
        summary = body.get("summary") or {}
        print(
            f"\nUpload complete. Findings: {self.success_count}, deleted as stale: "
            f"{body.get('deleted', 0)}; "
            f"public {summary.get('public', '?')}, gated {summary.get('gated', '?')}",
            file=sys.stderr,
        )


class ContractLinkContractUploader(ContractUploader):
    """Uploads the contracts the CRU findings join to, into their own closed
    collection rather than the public `contracts` one.

    A finding's contracts are mostly between a gmina and a small firm, and in
    the public list they would name the firm of every gated finding, with its
    NIP and its money, to anybody. So `/api/ingest/contracts/powiazania/umowy`
    stores them where only the finding's own route reads them, and only for a
    reader past the gate.

    The same payloads and batches as `ContractUploader`, without
    `skipUnlinked`: the route keeps every contract it is sent, since a finding
    needs all of its own and neither end of most of them is a page here. Then,
    as `ContractLinkUploader` does, one closing request whose `final.keep`
    names every contract the run wrote by its `id_umowy`, and the route deletes
    the rest - a contract no finding names any more is no longer anybody's to
    read. Not sent after a failed batch or a `--limit`/`--offset` run, for the
    same reason as there.
    """

    route = "/api/ingest/contracts/powiazania/umowy"

    @typing.override
    def batch_body(self, batch: list[dict]) -> dict:
        return {"contracts": batch}

    @typing.override
    def finish(self, url: str, contracts: list[dict]) -> None:
        if self.success_count != self.total:
            print(
                f"\n{self.total - self.success_count} contracts failed; not "
                "pruning. Re-run once they go through.",
                file=sys.stderr,
            )
            return
        if self.partial():
            print(
                "\n--limit/--offset sent only part of the run, so not pruning: "
                "every contract outside it would be deleted.",
                file=sys.stderr,
            )
            return
        keep = list(dict.fromkeys(contract["id_umowy"] for contract in contracts))
        body = self.post(url, {"contracts": [], "final": {"keep": keep}})
        print(
            f"Kept {len(keep)} contracts, deleted as stale: {body.get('deleted', 0)}",
            file=sys.stderr,
        )

    @typing.override
    def report(self) -> None:
        # Only what was written: the route skips nothing, and a NIP it cannot
        # place is a gmina or a small firm, not a page the site is missing.
        if self.counters["written"]:
            print(f"\nwritten: {self.counters['written']}", file=sys.stderr)


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
        resp = requests.post(
            url,
            headers=self.headers,
        )
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
        uploader = Uploader.create(args)
        uploader.submit_results(entities)


if __name__ == "__main__":
    main()
