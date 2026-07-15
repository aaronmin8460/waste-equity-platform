"""Capital-region Sudokwon Landfill inbound-flow derivations (V2 Phase 1/2).

Pure, exact-``Decimal`` helpers over the official ``landfill_inbound_monthly``
fact table. Two official reported values (inbound quantity in kg, inbound fee in
KRW) are aggregated; two indicators are derived, both
``OFFICIAL_INPUTS_DERIVED_VALUE``:

* **effective fee per tonne** (``inbound_fee_krw ÷ (quantity_kg ÷ 1000)``),
  ``None`` when quantity is zero (``landfill-effective-fee-v1``);
* **inbound fee per resident** (``inbound_fee_krw ÷ population``),
  ``None`` with a served reason whenever a valid *same-reference-year*
  metropolitan population is not available (``landfill-fee-per-capita-v1``).

All arithmetic is exact ``Decimal`` quantized to a documented precision; nothing
rounds through binary floating point and nothing is estimated or zero-filled.

Period completeness is derived from the stored months only, never hardcoded: the
latest complete year (12 present months) is the default reporting period; the
current partial year is labelled as such.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
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


# --------------------------------------------------------------------------- #
# Inbound fee per resident (landfill-fee-per-capita-v1) — V2 Phase 2
# --------------------------------------------------------------------------- #

# Bump when the formula, denominator rule, unit handling, or precision changes.
PER_CAPITA_DERIVATION_VERSION = "landfill-fee-per-capita-v1"
PER_CAPITA_INDICATOR = "LANDFILL_INBOUND_FEE_PER_CAPITA"
# KRW per person. Rendered Korean-first to match EFFECTIVE_FEE_UNIT ("KRW/톤").
PER_CAPITA_FEE_UNIT = "KRW/인"
PER_CAPITA_DERIVATION_FORMULA = (
    "inbound_fee_krw(선택 조건) ÷ population[persons](동일 기준연도 · 동일 광역지자체)"
)

# The only population definition this derivation accepts as a denominator. A row
# carrying any other definition is not silently used.
EXPECTED_POPULATION_DEFINITION = "SGIS_TOTAL_POPULATION"
# The only region level this derivation accepts: the landfill source is
# metropolitan-only, so the denominator must be a 광역지자체 (SIDO) population.
EXPECTED_POPULATION_REGION_LEVEL = "SIDO"

# Unavailability vocabulary. ZERO_POPULATION and AMBIGUOUS_POPULATION_DEFINITION
# are reused verbatim from the existing per-capita/facility-burden exclusion
# vocabulary (see api/routes/equity.py); the three others are specific to the
# same-reference-year rule this derivation enforces.
REASON_NO_MATCHING_POPULATION_YEAR = "NO_MATCHING_POPULATION_YEAR"
REASON_NO_METROPOLITAN_POPULATION = "NO_METROPOLITAN_POPULATION"
REASON_ZERO_POPULATION = "ZERO_POPULATION"
REASON_AMBIGUOUS_POPULATION_DEFINITION = "AMBIGUOUS_POPULATION_DEFINITION"
REASON_INCOMPLETE_POPULATION_COVERAGE = "INCOMPLETE_POPULATION_COVERAGE"

PER_CAPITA_CAVEAT = (
    "선택 기간의 공식 반입수수료를 동일 연도의 해당 지역 인구로 나눈 분석용 환산값입니다. "
    "개인의 실제 납부액이 아닙니다."
)


@dataclass(frozen=True)
class MetropolitanPopulation:
    """One candidate population denominator for a metropolitan landfill origin.

    ``origin_region_code`` is the landfill fact table's origin code; the
    canonical SGIS region it was resolved through is carried alongside so the
    served provenance names the actual denominator row, not the origin label.
    """

    origin_region_code: str
    canonical_region_code: str
    region_name: str
    region_level: str
    reference_year: int
    reference_period: str
    population: int
    population_definition: str
    source_id: str
    unit: str


@dataclass(frozen=True)
class PerCapitaFee:
    """A served per-capita fee, or an explicit reason it could not be derived.

    ``fee_per_capita_krw`` and ``reason`` are mutually exclusive: exactly one is
    ever set. A value is never zero-filled, estimated, or carried over from a
    different reference year.
    """

    fee_per_capita_krw: Decimal | None
    reason: str | None
    population: int | None
    population_reference_year: int | None
    population_reference_period: str | None
    population_definition: str | None
    population_source_id: str | None
    population_region_level: str | None
    population_unit: str | None
    included_origin_region_codes: tuple[str, ...]


def fee_per_capita(inbound_fee_krw: Decimal, population: int) -> Decimal | None:
    """Official fee ÷ residents, quantized to two decimals; None at zero/negative.

    Exact ``Decimal`` throughout — the population is converted with
    ``Decimal(int)``, so no binary float ever touches a served value.
    """
    if population <= 0:
        return None
    return (inbound_fee_krw / Decimal(population)).quantize(
        _FEE_PRECISION, rounding=ROUND_HALF_EVEN
    )


def resolve_population(
    candidates: Sequence[MetropolitanPopulation],
    *,
    origin_region_code: str,
    fee_reference_year: int,
) -> tuple[MetropolitanPopulation | None, str | None]:
    """Pick the one valid denominator for an origin, or say why there is none.

    ``candidates`` may hold rows for any origin and any reference year; the
    same-year rule is enforced here, so a nearest/latest/previous year is never
    substituted. Returns ``(row, None)`` or ``(None, reason)``.
    """
    for_origin = [c for c in candidates if c.origin_region_code == origin_region_code]
    if not for_origin:
        return None, REASON_NO_METROPOLITAN_POPULATION
    # Same reference year only. A different year is never a fallback.
    same_year = [c for c in for_origin if c.reference_year == fee_reference_year]
    if not same_year:
        return None, REASON_NO_MATCHING_POPULATION_YEAR
    # A denominator that is not an accepted metropolitan total population is not
    # silently used; neither is one of several competing definitions.
    accepted = [
        c
        for c in same_year
        if c.population_definition == EXPECTED_POPULATION_DEFINITION
        and c.region_level == EXPECTED_POPULATION_REGION_LEVEL
    ]
    if not accepted:
        return None, REASON_AMBIGUOUS_POPULATION_DEFINITION
    # Regions are versioned by boundary vintage, so one metropolitan region can
    # legitimately yield several *identical* population rows for a year. Identical
    # denominators are not ambiguous; competing ones are, and refusing beats
    # silently picking one.
    distinct = {
        (c.population, c.population_definition, c.source_id, c.reference_period) for c in accepted
    }
    if len(distinct) > 1:
        return None, REASON_AMBIGUOUS_POPULATION_DEFINITION
    resolved = accepted[0]
    if resolved.population <= 0:
        return None, REASON_ZERO_POPULATION
    return resolved, None


def _unavailable(reason: str, origins: Sequence[str]) -> PerCapitaFee:
    return PerCapitaFee(
        fee_per_capita_krw=None,
        reason=reason,
        population=None,
        population_reference_year=None,
        population_reference_period=None,
        population_definition=None,
        population_source_id=None,
        population_region_level=None,
        population_unit=None,
        included_origin_region_codes=tuple(origins),
    )


def origin_fee_per_capita(
    inbound_fee_krw: Decimal,
    candidates: Sequence[MetropolitanPopulation],
    *,
    origin_region_code: str,
    fee_reference_year: int,
) -> PerCapitaFee:
    """Per-capita fee for a single metropolitan origin (one row of the table)."""
    resolved, reason = resolve_population(
        candidates,
        origin_region_code=origin_region_code,
        fee_reference_year=fee_reference_year,
    )
    if resolved is None:
        assert reason is not None
        return _unavailable(reason, [origin_region_code])
    value = fee_per_capita(inbound_fee_krw, resolved.population)
    if value is None:  # Defensive: resolve_population already rejects <= 0.
        return _unavailable(REASON_ZERO_POPULATION, [origin_region_code])
    return PerCapitaFee(
        fee_per_capita_krw=value,
        reason=None,
        population=resolved.population,
        population_reference_year=resolved.reference_year,
        population_reference_period=resolved.reference_period,
        population_definition=resolved.population_definition,
        population_source_id=resolved.source_id,
        population_region_level=resolved.region_level,
        population_unit=resolved.unit,
        included_origin_region_codes=(origin_region_code,),
    )


def aggregate_fee_per_capita(
    inbound_fee_krw: Decimal,
    candidates: Sequence[MetropolitanPopulation],
    *,
    origin_region_codes: Sequence[str],
    fee_reference_year: int,
) -> PerCapitaFee:
    """Per-capita fee across several origins: Σ fee ÷ Σ same-year population.

    The per-origin values are **never averaged** — a mean would silently reweight
    the metropolitan regions as if they were equal in size. Coverage must be
    complete: if any included origin lacks a valid same-year population the
    aggregate is ``None`` with ``INCOMPLETE_POPULATION_COVERAGE`` rather than a
    partially-covered number. When *every* origin fails for the same reason the
    aggregate reports that reason instead, which is both more precise and more
    useful than calling total absence "incomplete coverage".
    """
    origins = sorted(set(origin_region_codes))
    if not origins:
        return _unavailable(REASON_NO_METROPOLITAN_POPULATION, origins)
    resolved: list[MetropolitanPopulation] = []
    failures: list[str] = []
    for code in origins:
        row, reason = resolve_population(
            candidates, origin_region_code=code, fee_reference_year=fee_reference_year
        )
        if row is None:
            assert reason is not None
            failures.append(reason)
            continue
        resolved.append(row)
    if failures:
        # One uncovered origin makes the whole aggregate unpublishable; the
        # specific per-origin reason stays visible on that origin's own row.
        shared = set(failures)
        if not resolved and len(shared) == 1:
            return _unavailable(failures[0], origins)
        return _unavailable(REASON_INCOMPLETE_POPULATION_COVERAGE, origins)
    # Summing across origins requires one shared denominator definition.
    if len({(r.population_definition, r.source_id, r.reference_year) for r in resolved}) > 1:
        return _unavailable(REASON_AMBIGUOUS_POPULATION_DEFINITION, origins)
    total_population = sum(r.population for r in resolved)
    value = fee_per_capita(inbound_fee_krw, total_population)
    if value is None:
        return _unavailable(REASON_ZERO_POPULATION, origins)
    first = resolved[0]
    return PerCapitaFee(
        fee_per_capita_krw=value,
        reason=None,
        population=total_population,
        population_reference_year=first.reference_year,
        population_reference_period=first.reference_period,
        population_definition=first.population_definition,
        population_source_id=first.source_id,
        population_region_level=first.region_level,
        population_unit=first.unit,
        included_origin_region_codes=tuple(origins),
    )


__all__ = [
    "DERIVATION_FORMULA",
    "DERIVATION_VERSION",
    "EFFECTIVE_FEE_UNIT",
    "EVIDENCE_OFFICIAL_DERIVED",
    "EVIDENCE_OFFICIAL_REPORTED",
    "EXPECTED_POPULATION_DEFINITION",
    "EXPECTED_POPULATION_REGION_LEVEL",
    "PER_CAPITA_CAVEAT",
    "PER_CAPITA_DERIVATION_FORMULA",
    "PER_CAPITA_DERIVATION_VERSION",
    "PER_CAPITA_FEE_UNIT",
    "PER_CAPITA_INDICATOR",
    "REASON_AMBIGUOUS_POPULATION_DEFINITION",
    "REASON_INCOMPLETE_POPULATION_COVERAGE",
    "REASON_NO_MATCHING_POPULATION_YEAR",
    "REASON_NO_METROPOLITAN_POPULATION",
    "REASON_ZERO_POPULATION",
    "MetropolitanPopulation",
    "PerCapitaFee",
    "aggregate_fee_per_capita",
    "available_through_month",
    "effective_fee_per_ton",
    "fee_per_capita",
    "is_complete_year",
    "latest_available_month",
    "latest_complete_year",
    "origin_fee_per_capita",
    "resolve_population",
    "share",
    "to_tons",
]
