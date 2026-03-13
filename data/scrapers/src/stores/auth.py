import http.server
import json
import sys
import threading
import time
import urllib.parse
import webbrowser


def authenticate_user(endpoint_url: str) -> str:
    auth_port = 8085
    stop_event = threading.Event()
    server_thread = threading.Thread(
        target=run_auth_server, args=(auth_port, stop_event)
    )
    server_thread.start()

    auth_url = f"{endpoint_url}/auth/login?redirect=http://localhost:{auth_port}"
    print(f"Opening browser for authentication: {auth_url}", file=sys.stderr)
    webbrowser.open(auth_url)

    print("Waiting for authentication...", file=sys.stderr)
    while True:
        time.sleep(1)
        token = input(
            "Enter authentication token (or press Enter if browser succeeded): "
        )
        if token:
            stop_event.set()
            return token


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
