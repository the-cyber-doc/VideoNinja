"""Throttling of credential failures (brute force), per client address.

Only failed credentials count: a wrong password or TOTP code at login, a wrong
current password in the profile, a wrong setup or invitation token. Expired
sessions and missing accesses (other 401/403 answers) never do.

Over MAX_FAILURES within WINDOW_S, the address gets 429 with Retry-After on
those endpoints, before the credential is even checked, until its oldest
failure leaves the window. A success does not reset the count.

The client's address: request.client.host. uvicorn takes it from nginx's
X-Forwarded-For (trusted from 127.0.0.1, its default), and nginx sets it from
the real client (real_ip). IPv6 addresses count per /64: one host usually owns
a whole /64. Users sharing one address (club Wi-Fi) share its counter.

In memory (one process): a restart resets the counters.
"""

import ipaddress
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Iterator

from fastapi import HTTPException, Request

from . import audit
from ..core.errors import ApiError


MAX_FAILURES = 10
WINDOW_S = 15 * 60
MAX_KEYS = 10_000  # memory bound under a flood of addresses: the oldest are dropped

_lock = threading.Lock()
_failures: OrderedDict[str, deque[float]] = OrderedDict()  # key → failure times, oldest first
_now = time.monotonic


def client_key(request: Request) -> str:
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host  # not an address (test client)
    if address.version == 6:
        if address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def _recent(key: str, now: float) -> deque[float] | None:
    """The key's failures still in the window (caller holds the lock)."""
    times = _failures.get(key)
    if times is None:
        return None
    while times and times[0] <= now - WINDOW_S:
        times.popleft()
    if not times:
        del _failures[key]
        return None
    return times


def retry_after(key: str) -> int:
    """Seconds until `key` may try again; 0 if not throttled."""
    now = _now()
    with _lock:
        times = _recent(key, now)
        if times is None or len(times) < MAX_FAILURES:
            return 0
        return max(1, int(times[-MAX_FAILURES] + WINDOW_S - now) + 1)


def failed(key: str) -> None:
    now = _now()
    with _lock:
        times = _recent(key, now)
        if times is None:
            times = _failures[key] = deque()
            while len(_failures) > MAX_KEYS:
                _failures.popitem(last=False)
        times.append(now)
        _failures.move_to_end(key)
        if len(times) == MAX_FAILURES:
            audit.event("credentials.throttled", client=key, failures=MAX_FAILURES, minutes=WINDOW_S // 60)


def reset() -> None:
    with _lock:
        _failures.clear()


def credential_guard(*failure_statuses: int):
    """Dependency factory for an endpoint that checks a credential: 429 while the
    client is throttled; an answer with one of `failure_statuses` counts as a failure."""

    def guard(request: Request) -> Iterator[None]:
        key = client_key(request)
        wait = retry_after(key)
        if wait:
            raise ApiError("throttled", headers={"Retry-After": str(wait)}, minutes=-(-wait // 60))
        try:
            yield
        except HTTPException as e:
            if e.status_code in failure_statuses:
                failed(key)
            raise

    return guard
