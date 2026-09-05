import argparse
import collections
import json
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
from entities.composite import PersonNote, PersonScore
from entities.person import is_pipeline_uid
from scrapers.map.jst import SKARB_PANSTWA
from scrapers.stores import iterate_pipeline_dict
from stores.auth import authenticate_user
from util.firestore import Firestore

#: How many kinds of unplaced candidacy to name in the closing report. Enough
#: to act on, short enough to read - the same trade `UNMAPPED_COMMITTEES_REPORTED`
#: makes in `analysis/payloads/person.py`.
UNPLACED_REPORTED = 20


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


class Args:
    endpoint: str
    submit: bool
    type: typing.Literal["person", "company", "region", "score", "note", "extraction"]
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
        choices=[
            "person",
            "company",
            "region",
            "score",
            "note",
            "extraction",
            "computeNodes",
        ],
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
        help="For --type score and --type note: store them under this pipeline "
        "uid instead of the one the rows carry. The name must contain "
        "'pipeline', which is what marks a write as not made by a person.",
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

        if args.type in ["score", "note"]:
            # Same browser login as every other type, only the token goes to
            # Firestore rather than to an ingest endpoint. A local stack asks
            # for none of it, so the login is passed rather than performed.
            self.firestore = Firestore(
                args, login=lambda: authenticate_user(args.endpoint)
            )
        else:
            token = authenticate_user(args.endpoint)
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
        if args.type == "score":
            return ScoreUploader(args)
        if args.type == "note":
            return NoteUploader(args)
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
        partial = bool(self.args.limit or self.args.offset)
        written, retracted = self.firestore.replace_scores(
            model, rows, retract=not partial
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


class NoteUploader(Uploader):
    """Uploads the notes a pipeline wrote onto people's pages.

    The score path's shape, for the same reason: what to write can only be
    decided against what this uid wrote last time, so the whole run goes at
    once - see `Firestore.replace_notes`. The difference is what is at stake.
    A score is an opinion the site aggregates away; a note is a paragraph a
    reader reads on somebody's page, and the pipeline that wrote it is not
    there to answer for it. That is why `PeopleWikiNotes` refuses to write one
    unless the page already claims the article and the two dates of birth
    agree, and why this refuses to write one under anything but a pipeline uid.

    Notes go straight to Firestore rather than through an ingest endpoint
    because they are not facts about a person: nothing here becomes a revision,
    and nothing here is reviewed. Retracting one is a delete, which no ingest
    endpoint can express.
    """

    @typing.override
    def submit_results(self, entities):
        rows = [PersonNote(**e) for e in entities if e is not None]
        if not rows:
            print("No notes to upload.", file=sys.stderr)
            return

        model = self.model_of(rows)
        # Only part of the run reached us, so a person missing from it may
        # simply have been cut off rather than dropped by the pipeline.
        partial = bool(self.args.limit or self.args.offset)
        written, retracted = self.firestore.replace_notes(
            model, rows, retract=not partial
        )

        self.total = len(rows)
        self.success_count = len(rows)
        print(
            f"\nUpload complete. Uid: {model}, written: {written}, "
            f"retracted: {retracted}, unchanged: {len(rows) - written}",
            file=sys.stderr,
        )

    def model_of(self, rows: list[PersonNote]) -> str:
        """The uid to store this run under, and a check that it is a robot's.

        A note filed under a human-looking uid would be counted as somebody
        having written about that person - it would raise the node's
        `notesCount`, take the page out of the "nobody has looked at this yet"
        queue, and land in the admin triage list as an entry with no author to
        ask about it.
        """
        if self.args.model:
            model = self.args.model
        else:
            models = {row.model for row in rows}
            if len(models) != 1:
                raise ValueError(
                    f"Expected one uid per upload, got {sorted(models)}. "
                    "Upload each pipeline's notes separately, or pass --model."
                )
            model = models.pop()

        if not is_pipeline_uid(model):
            raise ValueError(
                f"Uid {model!r} does not contain 'pipeline', so the site would "
                "count its notes as somebody's."
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
