"""Local preview server that answers addresses the way Cloudflare Pages does.

- Clean addresses: Cloudflare serves night-lamp.html at /night-lamp; Python's plain file server only
  knows the file name, so the product addresses (/mantra-box, /mini-chanting-box, /night-lamp)
  would 404 locally. This serves <path>.html for an address with no file of its own.
- Not found: an address the site doesn't have gets 404.html, with a 404 status.

    python tools/serve.py [port] [folder]     (defaults: 8080, the project folder)
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
root = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), ".."))


class LikeCloudflare(SimpleHTTPRequestHandler):
    def send_head(self):
        path, _, query = self.path.partition("?")
        local = self.translate_path(path)
        if path != "/" and not path.endswith("/") and not os.path.exists(local) and os.path.isfile(local + ".html"):
            self.path = path + ".html" + ("?" + query if query else "")
        return super().send_head()

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(root, "404.html")
        if code != 404 or not os.path.isfile(page):
            return super().send_error(code, message, explain)
        body = open(page, "rb").read()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


ThreadingHTTPServer(("", port), partial(LikeCloudflare, directory=root)).serve_forever()
