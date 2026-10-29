"""One ID and one log line per request.

The ID: nginx's ($request_id, sent as X-Request-ID, also in its access log and in
its answer's X-Request-ID header), else one made here (development, no nginx;
then this answer carries it). A received value that is not 1-64 letters, digits
or dashes is replaced, never logged as is. Every record logged while the request
runs carries it (logs.bind), and the user's ID once the session is checked
(auth.current_user: logs.add).

The line, at the end ("app.middleware"): method, route (its template, e.g.
/api/videos/{video_id}/annotations: no IDs or tokens from the path), status and
duration. INFO; DEBUG for a healthy /health (the healthcheck, every 30 s).

A pure ASGI middleware: streamed answers (the setup's progress, files) pass as
they are.
"""

import logging
import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import logs

log = logging.getLogger("app.middleware")  # a fixed name, as documented (README: Logs)
HEADER = b"x-request-id"
VALID_ID = re.compile(rb"[A-Za-z0-9-]{1,64}")


def request_id(scope: Scope) -> tuple[str, bool]:
    """The request's ID, and whether it came with the request."""
    for name, value in scope.get("headers", ()):
        if name == HEADER and VALID_ID.fullmatch(value):
            return value.decode("ascii"), True
    return uuid.uuid4().hex, False


class RequestLog:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        rid, received = request_id(scope)
        status = 500  # unless an answer starts
        started = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                if not received:  # else nginx adds it to the answer
                    message["headers"] = [*message.get("headers", ()), (HEADER, rid.encode("ascii"))]
            await send(message)

        # Not ended here: uvicorn logs an unhandled exception's traceback after this
        # returns, in this request's own task, and it carries the ID too.
        logs.start(request_id=rid)
        try:
            await self.app(scope, receive, send_with_id)
        finally:
            route = scope.get("route")
            path = getattr(route, "path", None) or "(no route)"
            duration_ms = round((time.perf_counter() - started) * 1000)
            quiet = path == "/health" and status == 200
            log.log(
                logging.DEBUG if quiet else logging.INFO,
                "%s %s %s %d ms",
                scope["method"],
                path,
                status,
                duration_ms,
                extra={"method": scope["method"], "route": path, "status": status, "duration_ms": duration_ms},
            )
