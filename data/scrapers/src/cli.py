import argparse
import http.server
import json
import os
import sys
import threading
import webbrowser

import firebase_admin
import numpy as np
import requests
from firebase_admin import firestore

from analysis.payloads import UploadPayloads
from main import PIPELINES, _setup_context
from scrapers.krs.graph import CompanyGraph
from scrapers.stores import LocalFile, Pipeline

# Global variable to store the token received securely
RECEIVED_TOKEN: str | None = None


class AuthHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        global RECEIVED_TOKEN
        content_length = int(self.headers["Content-Length"])
        post_data = self.rfile.read(content_length).decode("utf-8")

        try:
            data = json.loads(post_data)
            token = data.get("token")
        except json.JSONDecodeError:
            token = post_data

        if token:
            RECEIVED_TOKEN = token
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(b"Token received")
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No token provided")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        return


def run_auth_server(port, stop_event):
    server = http.server.HTTPServer(("localhost", port), AuthHandler)
    server.timeout = 1
    while not stop_event.is_set():
        server.handle_request()


def authenticate_user(endpoint_url: str) -> str:
    port = 8085
    callback_url = f"http://localhost:{port}"
    login_url = f"{endpoint_url}/cli-login?callback={callback_url}"

    print(f"Opening browser to login: {login_url}")
    webbrowser.open(login_url)

    stop_event = threading.Event()
    server_thread = threading.Thread(target=run_auth_server, args=(port, stop_event))
    server_thread.start()

    print("Waiting for authentication...", end="", flush=True)
    try:
        while RECEIVED_TOKEN is None:
            sys.stdout.write(".")
            sys.stdout.flush()
            server_thread.join(timeout=0.5)
            if not server_thread.is_alive():
                if RECEIVED_TOKEN:
                    break
    except KeyboardInterrupt:
        print("\nAuthentication cancelled.")
        stop_event.set()
        server_thread.join()
        sys.exit(1)

    print("\nAuthenticated successfully!")
    stop_event.set()
    server_thread.join()

    if not RECEIVED_TOKEN:
        print("Failed to retrieve token.")
        sys.exit(1)

    return RECEIVED_TOKEN


def check_pipeline_files(ctx):
    """
    Checks if output files for all pipelines exist. Returns missing pipelines.
    """
    missing = []
    # Only check key pipelines or all? sticking to PIPELINES
    for pipeline_cls in PIPELINES:
        try:
            p = Pipeline.create(pipeline_cls)
            if p.filename:
                # Check existence using output_time (checks get_mtime)
                if p.output_time(ctx) is None:
                    missing.append(p.pipeline_name)
        except Exception:
            # Skip pipelines that fail to initialize (e.g. need args)
            continue
    return missing


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super(NumpyEncoder, self).default(o)


def non_empty_query(query):
    for doc in query.stream():
        return True
    return False


def process_regions(df, db):
    success = 0
    total = len(df)

    for idx, row in enumerate(df.itertuples()):
        payload = row.payload
        node_id = payload["node_id"]

        print(
            f"[{idx + 1}/{total}] Processing '{payload['name']}' ({payload['teryt']})",
            end=" ",
        )

        if non_empty_query(
            db.collection("nodes").where("teryt", "==", str(payload["teryt"]))
        ):
            print(f"Already done {payload['teryt']}")
            continue

        node_ref = db.collection("nodes").document(node_id)

        # Remove edge and node_id from node payload
        node_payload = dict(payload)
        edge_payload = node_payload.pop("edge", None)
        node_payload.pop("node_id", None)

        try:
            node_ref.set(node_payload, merge=True)
            success += 1

            if edge_payload:
                edge_id = edge_payload.pop("edge_id")
                edge_ref = db.collection("edges").document(edge_id)
                edge_ref.set(edge_payload, merge=True)
                print("(Edge OK)")
            else:
                print("")

        except Exception as e:
            print(f"ERROR: {e}")

    print(f"\nDone. Processed {success}/{total} regions.")


def parse_args():
    parser = argparse.ArgumentParser(description="Koryta Uploader CLI")
    parser.add_argument("--script", help="SQL script file to execute")
    parser.add_argument("--query", help="SQL query string to execute")
    parser.add_argument("--submit", action="store_true", help="Upload results to API")
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint base URL"
    )
    parser.add_argument(
        "--type",
        default="person",
        choices=["person", "region", "company"],
        help="Entity type to upload",
    )
    parser.add_argument("--api", default="bulk_create", help="API endpoint path")
    parser.add_argument(
        "--prod", action="store_true", help="Use production default endpoint"
    )
    parser.add_argument(
        "--krs",
        help="KRS of the company to export the data for (only for type=company)",
        default=None,
        required=False,
    )
    parser.add_argument(
        "--region",
        help="TERYT region code prefix to filter companies (e.g. 10 for Łódzkie)",
        default=None,
        required=False,
    )

    args = parser.parse_args()

    if args.prod and args.endpoint == "http://localhost:3000":
        args.endpoint = "https://koryta.pl"

    query = args.query
    if args.region and not query and not args.script:
        if args.type == "person":
            query = f"""SELECT * FROM upload_payloads WHERE entity_type='person'
            AND list_contains(teryt_powiat, '{args.region}')"""
        elif args.type == "region":
            query = f"""SELECT * FROM upload_payloads WHERE entity_type='region'
            AND entity_id = '{args.region}'"""

    if args.type == "region" and not query and not args.script:
        query = "SELECT * FROM upload_payloads WHERE entity_type='region'"

    if not args.script and not query and args.type != "company":
        print("Error: Must provide either --script or --query or --company")
        sys.exit(1)

    if args.script:
        with open(args.script, "r") as f:
            query = f.read()

    return args, query


def register_table(ctx, pipeline_cls) -> bool:
    try:
        p = Pipeline.create(pipeline_cls)
        if not p.filename:
            return False
        table_name = p.filename

        if p.output_time(ctx) is not None:
            df = p.read_or_process(ctx)
            if df is not None:
                ctx.con.register(table_name, df)
                return True
    except Exception:
        return False
    return False


def submit_results(args, df):
    if args.type == "region":
        if not args.prod:
            os.environ["FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8080"

        options = {
            "projectId": "koryta-pl",
            # "databaseURL": "http://localhost:8080",
        }
        app = firebase_admin.initialize_app(options=options)
        db = firestore.client(app, "koryta-pl")
        print("Processing regions...")
        process_regions(df, db)
        sys.exit(0)

    if not args.prod and args.endpoint.startswith("http://localhost"):
        token = "test-token"
    else:
        token = authenticate_user(args.endpoint)

    if args.type == "company":
        target_url = f"{args.endpoint}/api/ingest/company"
    else:
        target_url = f"{args.endpoint}/api/person/{args.api}"

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
            except Exception as e:
                e.add_note(f"payload: {payload}")
                raise e

        if payload is None:
            print(f"[{idx + 1}/{len(df)}] Skipping invalid payload ...")
            continue

        name = payload.get("name")
        print(f"[{idx + 1}/{len(df)}] Uploading {name}...", end=" ")

        try:
            # Use data=json.dumps(..., cls=NumpyEncoder) to handle numpy types
            resp = requests.post(
                target_url,
                data=json.dumps(payload, cls=NumpyEncoder),
                headers=headers,
            )
            if resp.status_code in [200, 201]:
                print("OK")
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
            ctx.con.register(p_payloads.filename, df_payloads)

        if args.type == "person":
            print(
                "Returning UploadPayloads output"
            )  # TODO this should be just a single table
            return df_payloads

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
                    AND payload ->> 'teryt' LIKE '{args.region}%'"""

            if getattr(args, "script", None) or getattr(args, "query", None):
                # if script/query provided, fallback
                pass
            elif not args.krs and not args.region:
                query = "SELECT * FROM upload_payloads WHERE entity_type='company'"

        if not query:
            query = f"SELECT * FROM upload_payloads WHERE entity_type='{args.type}'"

        df = ctx.con.execute(query).df()
    except Exception as e:
        print(f"Query execution failed: {e}")
        sys.exit(1)

    return df


def main():
    args, query = parse_args()
    ctx, _ = _setup_context(False)

    missing = check_pipeline_files(ctx)
    if missing:
        print("Warning: The following pipelines have no output files:")
        for m in missing:
            print(f" - {m}")

    print("Registering tables...")
    registered_count = 0
    for pipeline_cls in PIPELINES:
        if register_table(ctx, pipeline_cls):
            registered_count += 1
        else:
            print(f"Failed to register {pipeline_cls.__name__}.")
    print(f"Registered {registered_count} tables.")

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
