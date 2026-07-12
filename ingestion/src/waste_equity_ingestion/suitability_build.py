"""CLI adapter for the Phase 5.4 suitability build.

The engine itself lives in the backend (it reuses the backend models and the
Phase 5.1/5.2 analytical derivations). This thin adapter keeps the ingestion CLI
surface consistent (``ProbeSettings`` parity, ``IngestionError`` on failure so the
shared ``main()`` maps it to the documented exit code) while delegating all work
to ``waste_equity_backend.analysis.suitability.engine``.
"""

from __future__ import annotations

from typing import Any

from .config import ProbeSettings
from .errors import IngestionError


def run_suitability_build(
    settings: ProbeSettings,  # noqa: ARG001 - CLI signature parity; no API key needed
    *,
    reference_year: int,
    policy_version: str,
    profile: str,
    scope: str,
    write: bool,
) -> Any:
    """Run (or reuse) one reproducible suitability analysis run, returning a report."""

    from waste_equity_backend.analysis.suitability.engine import (
        SuitabilityBuildError,
    )
    from waste_equity_backend.analysis.suitability.engine import (
        run_suitability_build as _build,
    )

    try:
        return _build(
            reference_year=reference_year,
            policy_version=policy_version,
            profile=profile,
            scope=scope,
            write=write,
        )
    except SuitabilityBuildError as exc:
        raise IngestionError(str(exc)) from exc
