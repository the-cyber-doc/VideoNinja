"""Security events: one line each on the logger "app.audit", named by a fixed
event (EVENTS: the only names used), for grep, jq or an alert:

    {"logger": "app.audit", "msg": "login.failed client=203.0.113.7", "event": "login.failed",
     "client": "203.0.113.7", "request_id": "…"}

Who: the request's user_id (bound once the session is checked, logs.add), or a
field when there is no session yet (a registration). What: the target's IDs
(target_user_id, video_id, comment_id…). Never a password, a token, a TOTP
secret or code, nor the username of a failed login (it may be a password typed
in the wrong field): the client's address instead (as throttle.py counts it).
"""

import logging
from typing import Any

log = logging.getLogger("app.audit")  # a fixed name, not the module's: alerts and the README filter on it
INFO, WARNING, ERROR = logging.INFO, logging.WARNING, logging.ERROR

EVENTS: dict[str, int] = {
    # Accounts
    "setup.completed": INFO,
    "login.succeeded": INFO,
    "login.failed": WARNING,
    "logout": INFO,
    "credentials.throttled": WARNING,
    "password.wrong": WARNING,  # the current one, on the profile page
    "password.changed": INFO,  # the user's other sessions ended
    "totp.replaced": INFO,  # the user's other sessions ended
    "totp.undecryptable": ERROR,  # wrong key, or a value copied from another row
    "user.invited": INFO,
    "user.reset": INFO,  # credentials and sessions removed, new invitation
    "user.registered": INFO,
    "invite.shown": INFO,  # an admin read an invitation link again
    # Refusals
    "access.denied": WARNING,
    "request.cross_site": WARNING,
    "comment.denied": WARNING,  # not its author
    "upload.denied": WARNING,
    # Content
    "upload.accepted": INFO,
    "video.submitted": INFO,
    "video.retried": INFO,
    "video.deleted": INFO,
    "annotations.saved": INFO,
    "comment.created": INFO,
    "comment.edited": INFO,
    "comment.deleted": INFO,
}


def event(name: str, **fields: Any) -> None:
    """Log the event `name` (KeyError if it is not in EVENTS: tests catch it), with
    `fields` as JSON keys and, for the text format, in the message."""
    level = EVENTS[name]
    message = " ".join([name, *(f"{key}={value}" for key, value in fields.items())])
    log.log(level, message, extra={"event": name, **fields})
