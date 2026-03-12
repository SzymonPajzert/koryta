import argparse
import ast
import http.server
import json
import os
import sys
import threading
import time
import typing
import urllib.parse
import webbrowser

import numpy as np
import requests

from analysis.payloads import CompanyPayloads, PeoplePayloads
from entities.company import Company as CompanyKRS  # TODO remove alias
from entities.person import Person
from conductor import _setup_context
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.stores import Context, Pipeline

PIPELINES = [
    CompanyPayloads,
    PeoplePayloads,
    PostalCodes,
    Regions,
]


class AuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        if "token" in params:
            self.server.token = params["token"][0]  # type: ignore
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"Authentication successful! You can close this window.")
        else:
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"No token found in response.")

    def do_POST(self):
        content_length = int(self.headers["Content-Length"])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode("utf-8"))
        if "token" in data:
            self.server.token = data["token"]  # type: ignore
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            self.send_response(400)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        return


def run_auth_server(port, stop_event):
    server = http.server.HTTPServer(("localhost", port), AuthHandler)
    server.token = None  # type: ignore
    while not stop_event.is_set():
        server.handle_request()
    return server.token  # type: ignore


def authenticate_user(endpoint_url: str) -> str:
    auth_port = 8085
    stop_event = threading.Event()
    server_thread = threading.Thread(
        target=run_auth_server, args=(auth_port, stop_event)
    )
    server_thread.start()

    auth_url = f"{endpoint_url}/auth/login?redirect=http://localhost:{auth_port}"
    print(f"Opening browser for authentication: {auth_url}")
    webbrowser.open(auth_url)

    print("Waiting for authentication...")
    while True:
        time.sleep(1)
        token = input(
            "Enter authentication token (or press Enter if browser succeeded): "
        )
        if token:
            stop_event.set()
            return token


def check_pipeline_files(ctx: Context):
    missing = []
    for p_type in PIPELINES:
        p = Pipeline.create(p_type)
        if p.filename:
            path = os.path.join("versioned", p.filename + "." + p.format)
            if not os.path.exists(path):
                missing.append(p_type.__name__)
    return missing


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.int64, np.int32, np.int16, np.int8)):
            return int(o)
        if isinstance(o, (np.float64, np.float32)):
            return float(o)
        return super().default(o)


def non_empty_query(query):
    if not query:
        return False
    return query.strip() != ""


def process_regions(df, db):
    # This is handled by bulk_create or similar
    pass


def parse_args():
    parser = argparse.ArgumentParser(description="Upload koryta data to Firestore.")
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint URL"
    )
    parser.add_argument("--submit", action="store_true", help="Submit data to the API")
    parser.add_argument(
        "--type",
        choices=["person", "company", "region"],
        default="person",
        help="Entity type to query",
    )
    parser.add_argument("--region", type=str, help="Filter by teryt prefix (e.g. 3061)")
    parser.add_argument("--krs", type=str, help="Filter by KRS and all its descendants")
    parser.add_argument(
        "--api",
        choices=["bulk_create", "bulk_update"],
        default="bulk_create",
        help="API endpoint to use",
    )
    return parser.parse_known_args()[0]


def register_table(ctx, pipeline_cls) -> bool:
    p = Pipeline.create(pipeline_cls)
    if not p.filename:
        return False
    df = p.read_or_process(ctx)
    if df is not None:
        table_name = p.filename.replace(".", "_")
        ctx.con.register(table_name, df)
        return True
    return False


def print_company(company):
    if company["created"]:
        print(
            f"\n  Created company with KRS: {company['krs']} node {company['nodeId']}",
            end=" ",
        )
    else:
        print(
            f"\n  Already existed KRS: {company['krs']} node {company['nodeId']}",
            end=" ",
        )


def submit_results(args, df):
    if not args.prod and args.endpoint.startswith("http://localhost"):
        token = "test-token"
    else:
        token = authenticate_user(args.endpoint)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }

    success_count = 0
    for idx, row in df.iterrows():
        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                try:
                    payload = ast.literal_eval(payload)
                except Exception as e:
                    e.add_note(f"payload: {payload}")
                    raise e

        if payload is None:
            print(f"[{idx + 1}/{len(df)}] Skipping invalid payload ...")
            continue

        name = payload.get("name")
        print(f"[{idx + 1}/{len(df)}] Uploading {name}...", end=" ")

        entity_type = row.get("entity_type", args.type)
        if entity_type == "company":
            current_target_url = f"{args.endpoint}/api/ingest/company"
        else:
            current_target_url = f"{args.endpoint}/api/person/{args.api}"

        resp = requests.post(
            current_target_url,
            data=json.dumps(payload, cls=NumpyEncoder),
            headers=headers,
        )
        j: dict[str, typing.Any] = resp.json()
        if "companies" in j:
            for company in j["companies"]:
                print_company(company)
        if resp.status_code in [200, 201]:
            print("  OK")
            success_count += 1
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}")
            raise Exception(
                f"API error: {resp.status_code} - {resp.text} for payload: {payload}"
            )

    failures = len(df) - success_count
    print(f"\nUpload complete. Success: {success_count}, Failed: {failures}")


def print_results(df, type):
    print("\n--- Query Results (First 20) ---")
    if not df.empty and "payload" in df.columns:
        print(df.drop(columns=["payload"]).head(20).to_string())
    else:
        print(df.head(20).to_string())
    print("\n--- Payload Preview (First 3) ---")
    if not df.empty and "payload" in df.columns:
        for i in range(3):
            preview_payload = df.iloc[i].get("payload")
            print(json.dumps(json.loads(preview_payload), indent=2))


def read_payloads(ctx, args) -> list[Person] | list[CompanyKRS]:
    if args.type == "person":
        p_payloads = Pipeline.create(PeoplePayloads)
    elif args.type == "company":
        p_payloads = Pipeline.create(CompanyPayloads)
    else:
        raise ValueError(f"Unknown entity type: {args.type}")

    df_payloads = p_payloads.read_or_process(ctx)  # Ensure upload payloads exist.
    if df_payloads is None:
        raise ValueError(f"df_payloads for {args.type} is None")
    return df_payloads


def read_payloads_filtered(ctx, args):
    print("Executing query...")
    # TODO make it a typed list
    payloads = read_payloads(ctx, args)
    entity_filters = []

    if args.type == "person":
        if args.region:
            entity_filters.append(lambda p: p.teryt == args.region)

    if args.type == "company":
        if args.krs:
            # TODO support it
            pass
        if args.region:
            entity_filters.append(lambda p: p.teryt == args.region)

    for entity_filter in entity_filters:
        payloads = filter(entity_filter, payloads)
    return list(payloads)


def main():
    args = parse_args()
    ctx, _ = _setup_context(False)

    entities = read_payloads_filtered(ctx, args)
    print(f"Query returned {len(entities)} rows.")

    if len(entities) == 0:
        print("No results.")
        sys.exit(0)

    if not args.submit:
        print_results(entities, args.type)
        print("\nUse --submit to upload.")
    else:
        submit_results(args, entities)


if __name__ == "__main__":
    main()
