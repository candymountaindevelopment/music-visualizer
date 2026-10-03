"""A static server for the app, with the headers a browser wants.

    python serve.py [--port 8770]

Modules and the microphone both need an http origin, so this is the way to
run it locally; anything else that serves static files will do as well.
"""

from __future__ import annotations

import argparse
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent

HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=()",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".musicxml": "application/vnd.recordare.musicxml+xml",
        ".mxl": "application/vnd.recordare.musicxml",
        ".mid": "audio/midi",
    }

    def end_headers(self) -> None:
        for key, value in HEADERS.items():
            self.send_header(key, value)
        super().end_headers()

    def log_message(self, fmt, *args) -> None:
        if "200" not in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8770)
    args = ap.parse_args()
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"Danas Bouncing Ball at http://127.0.0.1:{args.port}/")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
