import http.server
import json
import sys
import threading
import time
import urllib.parse
import webbrowser


class AuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        if "token" in params:
            self.server.token = params["token"][0]  # type: ignore
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"Authentication successful! You can close this window.")
        else:
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"No token found in response.")

    def do_POST(self):
        content_length = int(self.headers["Content-Length"])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode("utf-8"))
        if "token" in data:
            self.server.token = data["token"]  # type: ignore
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            self.send_response(400)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        return


def authenticate_user(endpoint_url: str) -> str:
    auth_port = 8085

    # In case of previous bind error, allow reuse
    class DualStackServer(http.server.HTTPServer):
        token: str | None = None

        def server_bind(self):
            self.allow_reuse_address = True
            super().server_bind()

    server = DualStackServer(("localhost", auth_port), AuthHandler)

    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()

    auth_url = f"{endpoint_url}/cli-login?callback=http://localhost:{auth_port}"
    print(f"Opening browser for authentication: {auth_url}", file=sys.stderr)
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    print(
        "Waiting for authentication via browser... [Click 'Authorize CLI']",
        file=sys.stderr,
    )

    def manual_input_thread():
        try:
            if sys.stdin.isatty():
                f = sys.stdin
            else:
                try:
                    f = open("/dev/tty")
                except Exception:
                    return
            print(
                "Enter authentication token manually: ",
                file=sys.stderr,
                end="",
                flush=True,
            )
            token = f.readline().strip()
            if token and server.token is None:
                server.token = token
        except Exception:
            pass

    input_thread = threading.Thread(target=manual_input_thread)
    input_thread.daemon = True
    input_thread.start()

    try:
        while server.token is None:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass

    server.shutdown()
    server.server_close()

    if server.token:
        return server.token
    raise Exception("Authentication failed or was cancelled.")
