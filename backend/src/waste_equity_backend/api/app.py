"""FastAPI application factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from .routes import datasets, equity, health, landfill, metadata, reporting, suitability


def create_app() -> FastAPI:
    settings = get_settings()
    # In production the interactive API docs and OpenAPI schema are disabled
    # (defense in depth: the reverse proxy also does not route /docs, /redoc, or
    # /openapi.json to the public origin). They remain available in development.
    is_production = settings.app_env == "production"
    app = FastAPI(
        title="Waste Equity Platform API",
        version="0.1.0",
        description=(
            "Policy decision-support API for waste-management equity analysis "
            "across Seoul, Incheon, and Gyeonggi-do. Every metric endpoint "
            "must expose source and reference-period metadata."
        ),
        docs_url=None if is_production else "/docs",
        redoc_url=None if is_production else "/redoc",
        openapi_url=None if is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins(),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(metadata.router)
    app.include_router(datasets.router)
    app.include_router(equity.router)
    app.include_router(reporting.router)
    app.include_router(suitability.router)
    app.include_router(landfill.router)
    return app


app = create_app()
