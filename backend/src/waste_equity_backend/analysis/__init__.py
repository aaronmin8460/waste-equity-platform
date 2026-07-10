"""Derived analytical indicators (Phase 5).

Modules here compute decision-support indicators from the normalized tables.
They never fabricate, estimate, or zero-fill values: an input that cannot be
converted honestly is rejected and reported, not coerced.
"""

from .per_capita import (
    DERIVATION_FORMULA,
    DERIVATION_VERSION,
    EXPECTED_QUANTITY_UNIT,
    PER_CAPITA_UNIT,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)

__all__ = [
    "DERIVATION_FORMULA",
    "DERIVATION_VERSION",
    "EXPECTED_QUANTITY_UNIT",
    "PER_CAPITA_UNIT",
    "UnexpectedQuantityUnitError",
    "ZeroPopulationError",
    "per_capita_kg_per_year",
]
