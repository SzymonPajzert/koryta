import argparse
import json
import os
import sys
import time

import firebase_admin
import numpy as np
import requests
from firebase_admin import firestore

from analysis.interesting import Companies
from conductor import setup_context
from entities.composite import PersonScore
from scrapers.stores import iterate_pipeline_dict
from stores.auth import authenticate_user


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Upload koryta data to Firestore from stdin."
    )
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint URL"
    )
    parser.add_argument("--submit", action="store_true", help="Submit data to the API")
    parser.add_argument(
        "--type",
        choices=["person", "company", "region", "score"],
        help="Entity type to query",
    )
    parser.add_argument("--region", type=str, help="Filter by teryt prefix (e.g. 3061)")
    parser.add_argument("--krs", type=str, help="Filter by KRS and all its descendants")
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
    return parser.parse_known_args()[0]


def clean_payload(payload):
    if isinstance(payload, dict):
        return {k: clean_payload(v) for k, v in payload.items() if v is not None}
    elif isinstance(payload, list):
        return [clean_payload(v) for v in payload if v is not None]
    else:
        return payload


def print_company(company):
    if company["created"]:
        print(
            f"\n  Created company with KRS: {company['krs']} node {company['nodeId']}",
            end=" ",
            file=sys.stderr,
        )
    else:
        print(
            f"\n  Already existed KRS: {company['krs']} node {company['nodeId']}",
            end=" ",
            file=sys.stderr,
        )


def company_payloads():
    # TODO this looks like an ugly pattern but I don't know how to do it better
    print("Loading company payloads from Companies pipeline")
    df = Companies().read_or_process(setup_context(False)[0])
    return {c["krs"]: c for c in iterate_pipeline_dict(df)}


class Firestore:
    def __init__(self, args):
        project_id = getattr(args, "project", None)
        if not args.prod or args.endpoint.startswith("http://localhost"):
            os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"
            if not project_id:
                try:
                    resp = requests.get("http://127.0.0.1:4000/api/config", timeout=2)
                    if resp.status_code == 200:
                        project_id = resp.json().get("projectId")
                except Exception as e:
                    print(
                        f"Warning: Could not detect emulator project ID: {e}",
                        file=sys.stderr,
                    )
                if not project_id:
                    project_id = "demo-koryta-pl"

        options = {}
        if project_id:
            options["projectId"] = project_id

        try:
            app = firebase_admin.get_app("uploader")
        except ValueError:
            app = firebase_admin.initialize_app(options=options, name="uploader")

        database_id = getattr(args, "database", "koryta-pl")
        self.db = firestore.client(app=app, database_id=database_id)
        self.user_id = "pipeline"

    def submit_score(self, p: dict | PersonScore):
        if isinstance(p, dict):
            p = PersonScore(**p)

        print(
            f"Uploading score {p.score} for {p.name} (nodeId: {p.node_id})...",
            end=" ",
            file=sys.stderr,
        )

        doc_ref = self.db.collection("votes").document(f"{p.node_id}_{self.user_id}")
        doc_ref.set(
            {
                "nodeId": p.node_id,
                "userUid": self.user_id,
                "categoryVotes": {"interesting": p.score},
            },
            merge=True,
        )
        print(f"  OK: {doc_ref.id}", file=sys.stderr)


class Uploader:
    def __init__(self, args, companies=None):
        self.args = args

        if args.type in ["score"]:
            self.firestore = Firestore(args)
        else:
            if companies is None:
                self.company_payloads = company_payloads()
            else:
                self.company_payloads = companies

            token = authenticate_user(args.endpoint)
            self.headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            }

    def submit_payload(self, url, payload, fail=True, verbose=False):
        print(
            f"Uploading {payload['name']}... to {url}",
            end=" ",
            file=sys.stderr,
        )
        cleaned_payload = clean_payload(payload)
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
            if fail:
                raise Exception(
                    f"API error: {resp.status_code} - {resp.text} for: {payload}"
                )

        return resp

    def submit_company(self, krs: str, payload: dict | None):
        current_target_url = f"{self.args.endpoint}/api/ingest/company"
        if payload is None:
            payload = self.company_payloads.get(krs, None)
            if payload is None:
                raise ValueError(f"Couldn't look up {krs} in Companies pipeline")

        assert payload is not None

        # TODO move it somewhere else - Companies pipeline?
        owners = []
        for parent in payload.get("parents", []):
            if isinstance(parent, dict) and parent.get("krs"):
                owners.append(parent["krs"])
        payload["owners"] = owners
        if "teryt_code" in payload and payload["teryt_code"]:
            payload["teryt"] = payload["teryt_code"]
        return self.submit_payload(
            current_target_url,
            payload,
        )

    def submit_results(self, entities):
        self.success_count = 0
        self.total = len(entities)
        for idx, payload in enumerate(entities):
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

            mapped_payload = dict(payload)
            if self.args.type == "company":
                self.check_success(
                    self.submit_company(mapped_payload["krs"], mapped_payload)
                )
            elif self.args.type == "score":
                self.firestore.submit_score(payload)
                self.success_count += 1
            else:
                current_target_url = f"{self.args.endpoint}/api/ingest/person"
                resp = self.check_success(
                    self.submit_payload(
                        current_target_url,
                        payload,
                        fail=False,
                    )
                )
                if resp.status_code == 404:
                    for krs in resp.json()["data"]:
                        self.submit_company(krs, None)
                    # Try submitting again
                    self.check_success(
                        self.submit_payload(
                            current_target_url,
                            payload,
                        )
                    )

        failures = self.total - self.success_count
        print(
            f"\nUpload complete. Success: {self.success_count}, Failed: {failures}",
            file=sys.stderr,
        )

    def check_success(self, resp):
        if resp.status_code == 200:
            self.success_count += 1
        return resp


def print_results(entities, type):
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

        # Optional filtering
        if args.type == "company" and args.krs:
            if payload.get("krs") != args.krs:
                pass

        if args.region:
            if args.type == "person":
                if payload.get("teryt") != args.region:
                    continue
            elif args.type == "company":
                if payload.get("teryt_code") != args.region:
                    continue

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

    if args.type == "person":
        missing_krs = set()
        # Check that each referred KRS company has name
        companies = company_payloads()
        for e in entities:
            for c in e["companies"]:
                company = companies.get(c["krs"], None)
                if company is None:
                    missing_krs.add(c["krs"])
                    continue
                if company["name"] is None:
                    missing_krs.add(c["krs"])

        if len(missing_krs) > 0:
            print(list(missing_krs))
            raise ValueError("Some companies don't have required information")

    if not args.submit:
        print_results(entities, args.type)
        print("\nUse --submit to upload.", file=sys.stderr)
    else:
        uploader = Uploader(args)
        uploader.submit_results(entities)


if __name__ == "__main__":
    main()
