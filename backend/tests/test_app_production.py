"""The FastAPI app disables interactive docs/OpenAPI in production (Phase 5.5)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from waste_equity_backend.api.app import create_app
from waste_equity_backend.config import get_settings


@pytest.fixture
def restore_env() -> Iterator[None]:
    previous = os.environ.get("APP_ENV")
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("APP_ENV", None)
        else:
            os.environ["APP_ENV"] = previous
        get_settings.cache_clear()


def test_docs_enabled_in_development(restore_env: None) -> None:
    os.environ["APP_ENV"] = "development"
    get_settings.cache_clear()
    app = create_app()
    assert app.docs_url == "/docs"
    assert app.openapi_url == "/openapi.json"


def test_docs_disabled_in_production(restore_env: None) -> None:
    os.environ["APP_ENV"] = "production"
    get_settings.cache_clear()
    app = create_app()
    # No interactive docs or OpenAPI schema surface in production.
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None
    # The functional routers are still mounted (app remains usable).
    assert len(app.routes) > 0
