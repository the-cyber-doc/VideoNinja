"""The HTTP layer: one router per module, in the order main.py includes them. The
rules and the storage they call live outside (app/…): nothing here is imported by them."""

from . import (
    about, auth, catalog, comments, health, media, performers, profile, register, setup, tags, upload_hooks, users,
    video_mgmt, videos,
)

ROUTERS = (
    setup.router, about.router, auth.router, profile.router, register.router, users.router, catalog.router,
    comments.router, media.router, performers.router, tags.router, videos.router, video_mgmt.router,
    upload_hooks.router, catalog.internal_router, health.router,
)
