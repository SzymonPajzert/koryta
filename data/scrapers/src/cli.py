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

from analysis.payloads import UploadPayloads
from main import _setup_context
from scrapers.krs.graph import CompanyGraph
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.stores import Context, LocalFile, Pipeline

PIPELINES = [
    UploadPayloads,
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
    parser.add_argument(
        "--query", type=str, help="SQL query to filter data from upload_payloads"
    )
    parser.add_argument("--region", type=str, help="Filter by teryt prefix (e.g. 3061)")
    parser.add_argument("--krs", type=str, help="Filter by KRS and all its descendants")
    parser.add_argument(
        "--api",
        choices=["bulk_create", "bulk_update"],
        default="bulk_create",
        help="API endpoint to use",
    )
    parser.add_argument("--token", type=str, help="Optional auth token")
    return parser.parse_known_args()


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
    token = args.token
    if not token:
        # Check environment
        token = os.environ.get("KORYTA_TOKEN")
    if not token:
        # Try local storage or similar? For now dummy
        token = "test-token"

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

        try:
            entity_type = row.get("entity_type", args.type)
            if entity_type == "company":
                current_target_url = f"{args.endpoint}/api/ingest/company"
            else:
                current_target_url = f"{args.endpoint}/api/person/{args.api}"

            # Use data=json.dumps(..., cls=NumpyEncoder) to handle numpy types
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
        except Exception as e:
            print(f"ERROR: {e}")

    failures = len(df) - success_count
    print(f"\nUpload complete. Success: {success_count}, Failed: {failures}")


def print_results(df, type):
    print("\n--- Query Results (First 20) ---")
    if not df.empty and "payload" in df.columns:
        print(df.drop(columns=["payload"]).head(20).to_string())
    else:
        print(df.head(20).to_string())
    print("\n--- Payload Preview (First 1) ---")
    if not df.empty and "payload" in df.columns:
        preview_payload = df.iloc[0].get("payload")
        print(
            json.dumps(preview_payload, indent=2, ensure_ascii=False, cls=NumpyEncoder)
        )


def execute_query(ctx, args, query):
    print("Executing query...")
    try:
        p_payloads = Pipeline.create(UploadPayloads)
        df_payloads = p_payloads.read_or_process(ctx)  # Ensure upload payloads exist.
        if df_payloads is not None:
            ctx.con.register("upload_payloads", df_payloads)

        if args.type == "person":
            if not query and args.region:
                # pipeline already filtered people by region,
                # so we just take all 'person' entities
                query = "SELECT * FROM upload_payloads WHERE entity_type='person'"
            elif not query:
                query = "SELECT * FROM upload_payloads WHERE entity_type='person'"

        if args.type == "company":
            if args.krs:
                print(f"Building graph to find descendants of {args.krs}...")
                graph = CompanyGraph.from_dataframe(
                    ctx.io.read_data(
                        LocalFile(
                            "companies_merged/companies_merged.jsonl", "versioned"
                        )
                    ).read_dataframe("jsonl")
                )
                relevant_companies = graph.all_descendants([args.krs])
                print(f"Found {len(relevant_companies)} relevant companies.")
                id_list = ", ".join([f"'{k}'" for k in relevant_companies])
                if id_list:
                    query = f"""SELECT * FROM upload_payloads
                    WHERE entity_type='company' AND entity_id IN ({id_list})"""
                else:
                    query = (
                        "SELECT * FROM upload_payloads WHERE head=false"  # return empty
                    )
            elif args.region:
                query = f"""
                SELECT * FROM upload_payloads
                WHERE entity_type='company'
                    AND json_extract_string(payload, '$.teryt') LIKE '{args.region}%'"""

            if getattr(args, "script", None) or getattr(args, "query", None):
                # if script/query provided, fallback
                pass
            elif not args.krs and not args.region:
                query = "SELECT * FROM upload_payloads WHERE entity_type='company'"

        if not query:
            query = f"SELECT * FROM upload_payloads WHERE entity_type='{args.type}'"

        print(f"Executing query: {query}")
        df = ctx.con.execute(query).df()
    except Exception as e:
        print(f"Query execution failed: {e}")
        sys.exit(1)

    return df


def main():
    args, query = parse_args()
    ctx, _ = _setup_context(False)

    df = execute_query(ctx, args, query)
    print(f"Query returned {len(df)} rows.")

    if df.empty:
        print("No results.")
        sys.exit(0)

    if not args.submit:
        print_results(df, args.type)
        print("\nUse --submit to upload.")
    else:
        submit_results(args, df)


if __name__ == "__main__":
    main()
