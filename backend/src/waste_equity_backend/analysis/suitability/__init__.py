"""Phase 5.4 suitability screening: policy registry and build engine.

The screen is a versioned, reproducible weighted composite over a deterministic
500 m candidate grid for waste-facility siting decision support. It is analytical
screening only — never a legal permit, engineering, or statutory determination.
See ``docs/SUITABILITY_POLICY_V1.md``.
"""

from .policy import (
    CANDIDATE_GRID_VERSION,
    DERIVATION_VERSION,
    POLICY_VERSION,
    WEIGHT_PROFILES,
)

__all__ = [
    "CANDIDATE_GRID_VERSION",
    "DERIVATION_VERSION",
    "POLICY_VERSION",
    "WEIGHT_PROFILES",
]
