"""Phase-4 explicit policy gate for the suitability Successor V3 model.

Read-only research package. It re-measures the real capital-region dataset after
the Phase-4 correctness fixes (B16 land-conversion area reconciliation, B17
unmapped facility evidence, B18 percentile-rank complexity) and produces the
evidence the Phase-4 policy decisions rest on.

Nothing here activates the successor model, writes a run, persists a weight, or
touches a historical value. The Phase-3 research package is left frozen so its
committed evidence bundle remains a usable BEFORE baseline.
"""

from __future__ import annotations

PHASE = "phase-4-explicit-policy-gate"

__all__ = ["PHASE"]
