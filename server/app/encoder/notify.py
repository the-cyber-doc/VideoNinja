"""Telling the API that the catalogue changed (a video published, new thumbnails)."""

import logging
import urllib.request
import uuid

from ..core import settings
from ..domain import snapshot

log = logging.getLogger(__name__)


def catalog_changed() -> None:
    """A video published or new thumbnails: the catalogue must be rebuilt. In its own
    container the encoder has no catalogue: the API rebuilds it (an internal call).
    In the API: directly. At once, not debounced: the upload page fetches the
    catalogue as soon as it sees the video published."""
    api = settings.current().api_url
    if not api:
        snapshot.rebuild_now()
        return
    # An ID of its own, in both logs: the API's line of this call and this one.
    rid = uuid.uuid4().hex
    request = urllib.request.Request(f"{api}/internal/catalog-changed", method="POST",
                                     headers={"X-Request-ID": rid})
    try:
        urllib.request.urlopen(request, timeout=10).close()  # http(s) only (paths)  # nosec B310
        log.info("Catalogue rebuild requested from the API", extra={"request_id": rid})
    except OSError as e:  # the API rebuilds at its next start anyway
        log.warning("Catalogue rebuild not requested from the API: %s", e, extra={"request_id": rid})
