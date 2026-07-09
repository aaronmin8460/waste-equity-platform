"""FastAPI application factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from .routes import datasets, health, metadata


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Waste Equity Platform API",
        version="0.1.0",
        description=(
            "Policy decision-support API for waste-management equity analysis "
            "across Seoul, Incheon, and Gyeonggi-do. Every metric endpoint "
            "must expose source and reference-period metadata."
        ),
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
    return app


app = create_app()
