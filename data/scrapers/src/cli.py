import argparse
import http.server
import json
import sys
import threading
import webbrowser

import firebase_admin
import numpy as np
import pandas as pd
import requests
from firebase_admin import firestore

from main import PIPELINES, CompaniesMerged, _setup_context
from scrapers.krs.graph import CompanyGraph
from scrapers.stores import Pipeline

# Global variable to store the token received securely
RECEIVED_TOKEN: str | None = None
COMPANY_LOOKUP: dict[str, str] = {}


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


def map_to_payload(row, type: str):
    """
    Maps a result row (dict) to the API payload format.
    """

    if type == "company":
        if not row.get("krs") or not row.get("name"):
            print("Skipping invalid company payload ...")
            return
        return {
            "krs": row.get("krs"),
            "name": row.get("name"),
            "city": row.get("city"),
            "owns": row.get("children") or [],
            "teryt": str(row.get("teryt_code")).removesuffix(".0")
            if pd.notna(row.get("teryt_code"))
            else None,
        }

    def get_scalar(key):
        val = row.get(key)
        if isinstance(val, (list, np.ndarray)):
            if len(val) > 0:
                return val[0]
            return None
        return val

    def get(key):
        return row.get(key)

    name = (
        get_scalar("name")
        or get_scalar("full_name")
        or get_scalar("fullname")
        or get_scalar("krs_name")
        or get_scalar("base_full_name")
        or "Unknown Payload"
    )

    companies = []
    company_list = get("companies") or get("employment")

    if isinstance(company_list, (list, np.ndarray)):
        for c in company_list:
            if isinstance(c, dict):
                c_name = c.get("name")
                c_krs = c.get("krs") or c.get("employed_krs")

                if not c_name and c_krs:
                    c_name = COMPANY_LOOKUP.get(c_krs)

                # If we still don't have a name but have a KRS, we must fail
                if not c_name and c_krs:
                    # TODO raise an exception here
                    print(f"Cannot resolve company name for KRS: {c_krs}")
                    return None

                companies.append(
                    {
                        # Fallback only if no KRS either (e.g. unknown entity type)
                        "name": c_name or "Unknown Company",
                        "krs": c_krs,
                        "role": c.get("role") or c.get("function"),
                        "start": c.get("start") or c.get("employed_start"),
                        "end": c.get("end") or c.get("employed_end"),
                    }
                )

    articles = []
    arts = get("articles")
    if isinstance(arts, list):
        for a in arts:
            if isinstance(a, dict) and a.get("url"):
                articles.append({"url": a.get("url")})
            elif isinstance(a, str):
                articles.append({"url": a})

    wiki_name = get_scalar("wiki_name")
    wikipedia_url = get_scalar("wikipedia") or get_scalar("wiki_url")
    if not wikipedia_url and wiki_name:
        wikipedia_url = f"https://pl.wikipedia.org/wiki/{wiki_name.replace(' ', '_')}"

    rejestr_io_url = get_scalar("rejestrIo")
    rejestr_id = get_scalar("rejestrio_id")
    if not rejestr_io_url and rejestr_id:
        rejestr_io_url = f"https://rejestr.io/osoby/{rejestr_id}"

    return {
        "name": name,
        "content": get("content") or get("history"),
        "wikipedia": wikipedia_url,
        "rejestrIo": rejestr_io_url,
        "birthDate": get_scalar("birth_date") or get_scalar("birthDate"),
        "companies": companies,
        "articles": articles,
    }


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
    # Sort by ID length to Ensure parents created first
    # Convert to string just in case
    df["id_str"] = df["id"].astype(str)
    df["id_len"] = df["id"].astype(str).str.len()
    df = df.sort_values("id_len")

    success = 0
    total = len(df)

    for idx, row in enumerate(df.itertuples()):
        name = row.name
        if len(row.id) == 2:
            name = f"Województwo {name}"
        elif len(row.id) == 4 and name.lower() == name:
            name = f"Powiat {name}"
        elif len(row.id) == 7:
            name = f"Gmina {name}"
        print(f"[{idx + 1}/{total}] Processing '{name}' ({row.id})...", end=" ")

        if non_empty_query(db.collection("nodes").where("teryt", "==", str(row.id))):
            print(f"Already done {row.id}")
            continue
        if len(row.id) > 4:
            print("Skipping detailed region")
            continue

        node_id = f"teryt{row.id}"
        node_ref = db.collection("nodes").document(node_id)

        payload = {
            "type": "region",
            "name": name,
            "teryt": str(row.id),
            "revision_id": f"teryt{row.id}",
        }

        try:
            node_ref.set(payload, merge=True)
            success += 1

            # Create Edge if parent exists
            parent_id = getattr(row, "parent_id", None)
            if (
                parent_id
                and parent_id is not None
                and str(parent_id) != "nan"
                and str(parent_id) != "None"
            ):
                parent_id = str(parent_id)
                parent_node_id = f"teryt{parent_id}"

                edge_id = f"edge_{parent_node_id}_{node_id}_owns"
                edge_ref = db.collection("edges").document(edge_id)

                edge_payload = {
                    "source": parent_node_id,
                    "target": node_id,
                    "type": "owns",
                    "revision_id": f"rev_{edge_id}",
                }
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

    if not args.script and not args.query and args.type != "company":
        print("Error: Must provide either --script or --query")
        sys.exit(1)

    query = args.query
    if args.script:
        with open(args.script, "r") as f:
            query = f.read()
    return args, query


def register_table(ctx, pipeline_cls):
    try:
        p = Pipeline.create(pipeline_cls)
        if not p.filename:
            return False

        table_name = p.filename

        # Robust method: Use pipeline's own reader
        # Check existence first to avoid re-processing accidentally if missing
        if p.output_time(ctx) is not None:
            # read_or_process will read cached file if exists
            df = p.read_or_process(ctx)
            if df is not None:
                ctx.con.register(table_name, df)
                return True
    except Exception:
        # Skip pipelines that fail to initialize
        return False
    return False


def submit_results(args, df):
    if args.type == "region":
        options = {
            "projectId": "koryta-pl",
            # "databaseURL": "http://localhost:8080",
        }
        app = firebase_admin.initialize_app(options=options)
        db = firestore.client(app, "koryta-pl")
        print("Processing regions...")
        process_regions(df, db)
        sys.exit(0)

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
        payload = map_to_payload(row, args.type)
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
    print(df.head(20).to_string())
    print("\n--- Payload Preview (First 1) ---")
    if not df.empty:
        preview_payload = map_to_payload(df.iloc[0], type)
        print(
            json.dumps(preview_payload, indent=2, ensure_ascii=False, cls=NumpyEncoder)
        )


def main():
    args, query = parse_args()
    ctx, _ = _setup_context(False)

    missing = check_pipeline_files(ctx)
    if missing:
        # Just warn, don't exit, user might know what they are querying
        print("Warning: The following pipelines have no output files:")
        for m in missing:
            print(f" - {m}")

    print("Loading company lookup...")
    global COMPANY_LOOKUP
    try:
        p_comp = Pipeline.create(CompaniesMerged)
        if p_comp.output_time(ctx):
            df_comp = p_comp.read_or_process(ctx)
            # df_comp should have 'krs' and 'name'
            # Drop NAs in key columns
            df_comp = df_comp.dropna(subset=["krs", "name"])
            COMPANY_LOOKUP = dict(zip(df_comp["krs"], df_comp["name"]))
            print(f"Loaded {len(COMPANY_LOOKUP)} companies for lookup.")
    except Exception as e:
        print(f"Warning: Failed to load company lookup: {e}")

    print("Registering tables...")
    registered_count = 0
    for pipeline_cls in PIPELINES:
        if register_table(ctx, pipeline_cls):
            registered_count += 1
    print(f"Registered {registered_count} tables.")

    print("Executing query...")
    try:
        if args.type == "company":
            print("Loading companies...")
            p_comp = Pipeline.create(CompaniesMerged)
            df = p_comp.read_or_process(ctx)

            if args.krs:
                print(f"Building graph to find descendants of {args.krs}...")
                graph = CompanyGraph.from_dataframe(df)
                relevant_companies = graph.all_descendants([args.krs])
                print(f"Found {len(relevant_companies)} relevant companies.")
                df = df[df["krs"].isin(relevant_companies)]

            if args.region:
                print(f"Filtering companies by region starting with {args.region}...")
                # Ensure teryt-code is string and handle NaNs
                # The column in dataframe should be 'teryt_code' as exported by InterestingEntity
                if "teryt_code" in df.columns:
                    df = df[
                        df["teryt_code"]
                        .astype(str)
                        .str.startswith(args.region, na=False)
                    ]
                    print(f"Found {len(df)} companies in region {args.region}.")
                else:
                    print(
                        "Warning: 'teryt_code' column not found in dataframe. Region filtering skipped."
                    )
        else:
            df = ctx.con.execute(query).df()
    except Exception as e:
        print(f"Query execution failed: {e}")
        sys.exit(1)

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
