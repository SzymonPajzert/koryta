import argparse
import http.server
import json
import sys
import threading
import webbrowser

import requests

from main import KorytaPeople, _setup_context
from scrapers.stores import Pipeline

# Global variable to store the token received securely
RECEIVED_TOKEN: str | None = None


class AuthHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        global RECEIVED_TOKEN
        content_length = int(self.headers["Content-Length"])
        post_data = self.rfile.read(content_length).decode("utf-8")

        try:
            # Try parsing as JSON
            data = json.loads(post_data)
            token = data.get("token")
        except json.JSONDecodeError:
            # Fallback to just using the body as token if it's not JSON
            token = post_data

        if token:
            RECEIVED_TOKEN = token
            self.send_response(200)
            self.send_header(
                "Access-Control-Allow-Origin", "*"
            )  # Allow CORS for localhost
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
        # Silence server logs
        return


def run_auth_server(port, stop_event):
    server = http.server.HTTPServer(("localhost", port), AuthHandler)
    server.timeout = 1
    while not stop_event.is_set():
        server.handle_request()


def authenticate_user(endpoint_url: str) -> str:
    """
    Starts a local server, opens the browser to login, and waits for a token.
    """
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
                    break  # Got it
                # Restart listening if we just handled a non-token request.
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


# TODO this should be a general logic for pipeline processor in main.py
def check_pipeline_files(ctx):
    """
    Checks if output files for all pipelines exist. Returns missing pipelines.
    """
    missing = []
    for pipeline_cls in [KorytaPeople]:  # TODO add PIPELINES
        p = Pipeline.create(pipeline_cls)
        if p.filename:
            # checking p.output_time(ctx) returns None if file doesn't exist
            if p.output_time(ctx) is None:
                missing.append(p.pipeline_name)
    return missing


def map_to_payload(row):
    """
    Maps a result row (dict) to the API payload format.
    """

    # Helper to safe get
    def get(key):
        return row.get(key)

    # Basic fields
    name = get("name") or get("fullname") or get("krs_name") or "Unknown Payload"

    companies = []

    company_list = get("companies")
    if isinstance(company_list, list):
        # Assume it matches format or map it
        for c in company_list:
            # Try to adapt if it's from scrapers format
            # Scrapers 'employment' format: {'employed_krs': ..., 'employed_end': ...}
            # We need: name, krs, role, start, end
            if isinstance(c, dict):
                companies.append(
                    {
                        "name": c.get("name") or c.get("krs") or "Unknown Company",
                        "krs": c.get("krs") or c.get("employed_krs"),
                        "role": c.get("role") or c.get("function"),
                        "start": c.get("start") or c.get("employed_start"),
                        "end": c.get("end") or c.get("employed_end"),
                    }
                )

    # Same for articles
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


def setup():
    parser = argparse.ArgumentParser(description="Koryta Uploader CLI")
    parser.add_argument("--script", help="SQL script file to execute")
    parser.add_argument("--query", help="SQL query string to execute")
    parser.add_argument("--submit", action="store_true", help="Upload results to API")
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint base URL"
    )
    parser.add_argument("--api", default="bulk_create", help="API endpoint path")

    args = parser.parse_args()

    if not args.script and not args.query:
        print("Error: Must provide either --script or --query")
        sys.exit(1)

    query = args.query
    if args.script:
        with open(args.script, "r") as f:
            query = f.read()

    # 1. Dataset Check & Context Setup
    ctx, _ = _setup_context(False)

    missing = check_pipeline_files(ctx)
    if missing:
        print("Warning: The following pipelines have no output files:")
        for m in missing:
            print(f" - {m}")
        print("Queries leveraging these tables might fail.")
        print("Run `koryta <pipeline_name>` to generate data.")
        sys.exit(1)

    return args, query, ctx


def main():
    args, query, ctx = setup()

    print("Registering tables...")
    registered_count = 0
    for pipeline_cls in [KorytaPeople]:  # TODO add PIPELINES
        p = pipeline_cls()
        table_name = p.filename
        df = p.read_or_process(ctx)
        try:
            ctx.con.execute(
                f"""
                CREATE OR REPLACE VIEW {table_name} AS
                SELECT * FROM '{df}'"""
            )
            registered_count += 1
        except Exception as e:
            print(f"Failed to register {table_name}: {e}")

    print(f"Registered {registered_count} tables.")

    # 2. Execute Query
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

    # 3. Process Execution (Submit or Preview)
    if not args.submit:
        # Preview Mode
        print("\n--- Query Results (First 20) ---")
        print(df.head(20).to_string())
        print("\n--- Payload Preview (First 1) ---")
        if not df.empty:
            preview_payload = map_to_payload(df.iloc[0])
            print(json.dumps(preview_payload, indent=2, ensure_ascii=False))
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
            name = payload.get("name")
            print(f"[{idx}/{len(df)}] Uploading {name}...", end=" ")

            try:
                resp = requests.post(target_url, json=payload, headers=headers)
                if resp.status_code in [200, 201]:
                    print("OK")
                    success_count += 1
                else:
                    print(f"FAILED ({resp.status_code}): {resp.text}")
            except Exception as e:
                print(f"ERROR: {e}")

        print(
            f"\nUpload complete. Success: {success_count}, \
                Failed: {len(df) - success_count}".lstrip()
        )


if __name__ == "__main__":
    main()
