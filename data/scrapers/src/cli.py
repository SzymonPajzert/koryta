import argparse
import http.server
import json
import sys
import threading
import webbrowser

import numpy as np
import requests

from main import PIPELINES, CompaniesMerged, _setup_context
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


def map_to_payload(row):
    """
    Maps a result row (dict) to the API payload format.
    """

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

    return {
        "name": name,
        "content": get("content") or get("history"),
        "wikipedia": get("wikipedia") or get("wiki_url"),
        "rejestrIo": get("rejestrIo"),
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


def main():
    parser = argparse.ArgumentParser(description="Koryta Uploader CLI")
    parser.add_argument("--script", help="SQL script file to execute")
    parser.add_argument("--query", help="SQL query string to execute")
    parser.add_argument("--submit", action="store_true", help="Upload results to API")
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint base URL"
    )
    parser.add_argument("--api", default="bulk_create", help="API endpoint path")
    parser.add_argument(
        "--prod", action="store_true", help="Use production default endpoint"
    )

    args = parser.parse_args()

    if args.prod and args.endpoint == "http://localhost:3000":
        args.endpoint = "https://koryta.pl"

    if not args.script and not args.query:
        print("Error: Must provide either --script or --query")
        sys.exit(1)

    query = args.query
    if args.script:
        with open(args.script, "r") as f:
            query = f.read()

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
        try:
            p = Pipeline.create(pipeline_cls)
            if not p.filename:
                continue

            table_name = p.filename

            # Robust method: Use pipeline's own reader
            # Check existence first to avoid re-processing accidentally if missing
            if p.output_time(ctx) is not None:
                # read_or_process will read cached file if exists
                df = p.read_or_process(ctx)
                if df is not None:
                    ctx.con.register(table_name, df)
                    registered_count += 1
        except Exception as e:
            # Skip pipelines that fail to initialize
            continue

    print(f"Registered {registered_count} tables.")

    print("Executing query...")
    try:
        df = ctx.con.execute(query).df()
    except Exception as e:
        print(f"Query execution failed: {e}")
        sys.exit(1)

    print(f"Query returned {len(df)} rows.")

    if df.empty:
        print("No results.")
        sys.exit(0)

    if not args.submit:
        print("\n--- Query Results (First 20) ---")
        print(df.head(20).to_string())
        print("\n--- Payload Preview (First 1) ---")
        if not df.empty:
            preview_payload = map_to_payload(df.iloc[0])

            print(
                json.dumps(
                    preview_payload, indent=2, ensure_ascii=False, cls=NumpyEncoder
                )
            )
        print("\nUse --submit to upload.")
    else:
        token = authenticate_user(args.endpoint)
        target_url = f"{args.endpoint}/api/person/{args.api}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        }

        success_count = 0
        for idx, row in df.iterrows():
            payload = map_to_payload(row)
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

        print(
            f"\nUpload complete. Success: {success_count}, Failed: {len(df) - success_count}"
        )


if __name__ == "__main__":
    main()
