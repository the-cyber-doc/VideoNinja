"""The catalogue file (GET /api/catalog: nginx sends it, X-Accel-Redirect), and the
encoder's call after a change (POST /internal/catalog-changed). The snapshots
themselves: snapshot.py."""

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import FileResponse

from .. import i18n, settings, snapshot
from ..errors import ApiError
from ..queries.users import User
from .deps import current_user

router = APIRouter(prefix="/api", tags=["catalog"])

# Called by the encoder's container (no catalogue there). Never forwarded by nginx;
# a call from elsewhere only costs a rebuild (one at a time, no new version if nothing changed).
internal_router = APIRouter(prefix="/internal", tags=["internal"])


@router.get("/catalog")
def get_catalog(
    _: User = Depends(current_user),
    lang: str = Depends(i18n.language),
) -> Response:
    """The catalogue file of the request's language. Behind nginx: an empty answer
    with X-Accel-Redirect; nginx serves the file, its .br/.gz variant, ETag and
    Cache-Control (the app sends none)."""
    version, manifest = snapshot.current() or snapshot.rebuild()
    name = manifest["catalog"][lang]
    if settings.current().x_accel:
        return Response(headers={"X-Accel-Redirect": f"{snapshot.INTERNAL_PREFIX}/{version}/{name}"})
    path = snapshot.catalog_dir() / "versions" / version / name
    if not path.is_file():
        raise ApiError("catalog.unavailable")
    return FileResponse(
        path,
        media_type="application/json",
        headers={"Cache-Control": "private, no-cache", "Vary": "Accept-Language"},
    )


@internal_router.post("/catalog-changed", status_code=status.HTTP_204_NO_CONTENT)
def catalog_changed() -> None:
    """The encoder published a video or made thumbnails: rebuild the catalogue now
    (not debounced: publishing is rare, and the upload page fetches it at once)."""
    snapshot.rebuild_now()
