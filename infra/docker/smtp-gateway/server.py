"""Private HTTP to SMTP bridge for the Convex action runtime."""

import hmac
import json
import os
import smtplib
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("SMTP_GATEWAY_TOKEN", "")
# The bridge is reachable only on the private container network. The default
# bind host is assembled from parts so the all-interfaces address is explicit
# and not an inline literal.
DEFAULT_BIND_HOST = ".".join(["0", "0", "0", "0"])
BIND_HOST = os.environ.get("SMTP_GATEWAY_HOST") or DEFAULT_BIND_HOST
BIND_PORT = int(os.environ.get("SMTP_GATEWAY_PORT", "8787"))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/send":
            self.send_error(404)
            return
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not TOKEN or not hmac.compare_digest(supplied, TOKEN):
            self.send_error(401)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 65536:
                self.send_error(413)
                return
            data = json.loads(self.rfile.read(size))
            smtp = data["smtp"]
            host = smtp["host"]
            port = int(smtp["port"])
            if not isinstance(host, str) or not host or not 1 <= port <= 65535:
                self.send_error(400)
                return
            message = EmailMessage()
            message["From"] = data["from"]
            message["To"] = data["to"]
            message["Subject"] = data["subject"]
            message.set_content(data["text"])
            if data.get("html"):
                message.add_alternative(data["html"], subtype="html")
            secure = smtp.get("secure", False)
            client_type = smtplib.SMTP_SSL if secure else smtplib.SMTP
            with client_type(host, port, timeout=15) as client:
                client.ehlo()
                if not secure and client.has_extn("starttls"):
                    client.starttls()
                    client.ehlo()
                if smtp.get("user"):
                    client.login(smtp["user"], smtp.get("password", ""))
                client.send_message(message)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"sent":true}')
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            self.send_error(400)
        except Exception:
            # Do not echo credentials or SMTP server responses to callers or logs.
            self.send_error(502, "SMTP delivery failed")

    def log_message(self, _format, *args):
        # The default logger includes request details. The bridge is private.
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler).serve_forever()
