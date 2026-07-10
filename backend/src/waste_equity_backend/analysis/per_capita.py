"""Per-capita waste generation derivation (Phase 5.1).

Derives kilograms of generated waste per person per year from the RCIS
regional grand-total generation quantity (톤/년, accounting basis
``ORIGIN_BASED_TREATMENT_OUTCOME``) and the SGIS total population for the same
reference year. The derivation is exact ``Decimal`` arithmetic quantized to a
documented precision; it never rounds through binary floating point.

Assumption (documented, served in the API envelope): the denominator is the
SGIS total population of the region, not a service-population or household
count. Origin-based generation divided by resident population is an equity
burden proxy, not a facility-throughput measure.
"""

from decimal import ROUND_HALF_EVEN, Decimal

# Bump when the formula, unit handling, or precision changes.
DERIVATION_VERSION = "per-capita-v1"
DERIVATION_FORMULA = "generation_quantity[톤/년] × 1000 ÷ population[persons]"

# The only source unit this derivation converts. Any other unit refuses to
# convert (the row is excluded and reported) instead of guessing a factor.
EXPECTED_QUANTITY_UNIT = "톤/년"
KG_PER_TON = Decimal("1000")
PER_CAPITA_UNIT = "kg/인/년"

# Six decimal places matches the storage scale of the source quantities.
_PRECISION = Decimal("0.000001")


class ZeroPopulationError(ValueError):
    """Population of zero cannot serve as a per-capita denominator."""


class UnexpectedQuantityUnitError(ValueError):
    """The source quantity is not in the unit this derivation documents."""

    def __init__(self, quantity_unit: str) -> None:
        super().__init__(
            f"Refusing to convert quantity unit {quantity_unit!r}; "
            f"the derivation is documented for {EXPECTED_QUANTITY_UNIT!r} only."
        )
        self.quantity_unit = quantity_unit


def per_capita_kg_per_year(
    generation_quantity: Decimal, quantity_unit: str, population: int
) -> Decimal:
    """Exact per-capita generation in kg/인/년, quantized to six decimals."""
    if quantity_unit != EXPECTED_QUANTITY_UNIT:
        raise UnexpectedQuantityUnitError(quantity_unit)
    if population <= 0:
        raise ZeroPopulationError(f"Population {population} cannot be a per-capita denominator.")
    kilograms = generation_quantity * KG_PER_TON
    return (kilograms / Decimal(population)).quantize(_PRECISION, rounding=ROUND_HALF_EVEN)
