"""Capital-region Sudokwon Landfill inbound-flow derivations (V2 Phase 1).

Pure, exact-``Decimal`` helpers over the official ``landfill_inbound_monthly``
fact table. Two official reported values (inbound quantity in kg, inbound fee in
KRW) are aggregated; the only derived indicator is the **effective fee per
tonne** (``inbound_fee_krw ÷ (quantity_kg ÷ 1000)``), an
``OFFICIAL_INPUTS_DERIVED_VALUE`` that is ``None`` when quantity is zero. All
arithmetic is exact ``Decimal`` quantized to a documented precision; nothing
rounds through binary floating point and nothing is estimated or zero-filled.

Period completeness is derived from the stored months only, never hardcoded: the
latest complete year (12 present months) is the default reporting period; the
current partial year is labelled as such.
"""

from collections.abc import Iterable
from decimal import ROUND_HALF_EVEN, Decimal

# Bump when the formula, unit handling, or precision changes.
DERIVATION_VERSION = "landfill-effective-fee-v1"
DERIVATION_FORMULA = "inbound_fee_krw ÷ (quantity_kg ÷ 1000)"
EFFECTIVE_FEE_UNIT = "KRW/톤"

EVIDENCE_OFFICIAL_REPORTED = "OFFICIAL_REPORTED_VALUE"
EVIDENCE_OFFICIAL_DERIVED = "OFFICIAL_INPUTS_DERIVED_VALUE"

KG_PER_TON = Decimal("1000")
_TON_PRECISION = Decimal("0.000001")
_FEE_PRECISION = Decimal("0.01")
_SHARE_PRECISION = Decimal("0.000001")


def to_tons(quantity_kg: Decimal) -> Decimal:
    """Exact tonnes from kilograms, quantized to six decimals."""
    return (quantity_kg / KG_PER_TON).quantize(_TON_PRECISION, rounding=ROUND_HALF_EVEN)


def effective_fee_per_ton(inbound_fee_krw: Decimal, quantity_kg: Decimal) -> Decimal | None:
    """Official fee ÷ official tonnes, quantized to two decimals; None at zero qty."""
    if quantity_kg <= 0:
        return None
    tons = quantity_kg / KG_PER_TON
    return (inbound_fee_krw / tons).quantize(_FEE_PRECISION, rounding=ROUND_HALF_EVEN)


def share(part_kg: Decimal, total_kg: Decimal) -> Decimal | None:
    """Fractional share in ``[0, 1]`` quantized to six decimals; None at zero total."""
    if total_kg <= 0:
        return None
    return (part_kg / total_kg).quantize(_SHARE_PRECISION, rounding=ROUND_HALF_EVEN)


def _months_in_year(months: Iterable[str], year: int) -> set[str]:
    prefix = f"{year:04d}-"
    return {month for month in months if month.startswith(prefix)}


def is_complete_year(months: Iterable[str], year: int) -> bool:
    """True when all twelve calendar months of ``year`` are present."""
    return len(_months_in_year(months, year)) == 12


def available_through_month(months: Iterable[str], year: int) -> str | None:
    """The latest present ``YYYY-MM`` within ``year``, or None if none present."""
    in_year = sorted(_months_in_year(months, year))
    return in_year[-1] if in_year else None


def latest_available_month(months: Iterable[str]) -> str | None:
    present = sorted(months)
    return present[-1] if present else None


def latest_complete_year(months: Iterable[str]) -> int | None:
    """The most recent year with twelve present months.

    Falls back to the latest present year when no year is complete, so the API
    always serves the freshest available period rather than nothing.
    """
    present = list(months)
    if not present:
        return None
    years = {int(month[:4]) for month in present}
    complete = [year for year in years if is_complete_year(present, year)]
    return max(complete) if complete else max(years)


__all__ = [
    "DERIVATION_FORMULA",
    "DERIVATION_VERSION",
    "EFFECTIVE_FEE_UNIT",
    "EVIDENCE_OFFICIAL_DERIVED",
    "EVIDENCE_OFFICIAL_REPORTED",
    "available_through_month",
    "effective_fee_per_ton",
    "is_complete_year",
    "latest_available_month",
    "latest_complete_year",
    "share",
    "to_tons",
]
