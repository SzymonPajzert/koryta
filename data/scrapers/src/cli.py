import argparse
import json
import sys
import typing

import numpy as np
import requests
from requests import JSONDecodeError

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
        choices=["person", "company", "region"],
        help="Entity type to query",
    )
    parser.add_argument("--region", type=str, help="Filter by teryt prefix (e.g. 3061)")
    parser.add_argument("--krs", type=str, help="Filter by KRS and all its descendants")
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


def get_headers(args):
    if not args.prod and args.endpoint.startswith("http://localhost"):
        token = "test-token"
    else:
        token = authenticate_user(args.endpoint)

    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }


def submit_results(args, entities, headers):
    success_count = 0
    total = len(entities)
    for idx, payload in enumerate(entities):
        name = payload.get("name", None) if payload is not None else None
        if payload is None or name is None:
            print(f"[{idx + 1}/{total}] Skipping invalid payload ...", file=sys.stderr)
            continue

        mapped_payload = dict(payload)
        if args.type == "company":
            current_target_url = f"{args.endpoint}/api/ingest/company"
            # TODO move it somewhere else
            owners = []
            for parent in mapped_payload.get("parents", []):
                if isinstance(parent, dict) and parent.get("krs"):
                    owners.append(parent["krs"])
            mapped_payload["owners"] = owners
            if "teryt_code" in mapped_payload and mapped_payload["teryt_code"]:
                mapped_payload["teryt"] = mapped_payload["teryt_code"]
        else:
            current_target_url = f"{args.endpoint}/api/ingest/person"
        print(
            f"[{idx + 1}/{total}] Uploading {name}... to {current_target_url}",
            end=" ",
            file=sys.stderr,
        )

        resp = requests.post(
            current_target_url,
            data=json.dumps(mapped_payload, cls=NumpyEncoder),
            headers=headers,
        )
        j: dict[str, typing.Any] = resp.json()
        if "companies" in j:
            for company in j["companies"]:
                print_company(company)

        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
            success_count += 1
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            raise Exception(
                f"API error: {resp.status_code} - {resp.text} for: {mapped_payload}"
            )

    failures = total - success_count
    print(
        f"\nUpload complete. Success: {success_count}, Failed: {failures}",
        file=sys.stderr,
    )


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

    if not args.submit:
        print_results(entities, args.type)
        print("\nUse --submit to upload.", file=sys.stderr)
    else:
        submit_results(args, entities, get_headers(args))


if __name__ == "__main__":
    main()
