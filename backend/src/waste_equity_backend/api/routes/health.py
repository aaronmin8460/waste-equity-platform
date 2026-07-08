"""Liveness and dependency health."""

import datetime
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...config import get_settings
from ...db import get_session
from ...schemas import HealthOut

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health", response_model=HealthOut)
def health(session: Annotated[Session, Depends(get_session)]) -> HealthOut:
    database = "ok"
    try:
        session.execute(text("SELECT 1"))
    except Exception:
        # Never leak connection strings; log the exception server-side only.
        logger.exception("Database health check failed")
        database = "unavailable"
    return HealthOut(
        status="ok" if database == "ok" else "degraded",
        database=database,
        app_env=get_settings().app_env,
        checked_at=datetime.datetime.now(datetime.UTC),
    )
