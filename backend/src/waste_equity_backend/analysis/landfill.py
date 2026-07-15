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
# Inbound fee per resident (landfill-fee-per-capita-v2) — MOIS monthly alignment
# --------------------------------------------------------------------------- #
#
# v2 supersedes v1 in both denominator source and temporal alignment:
#
#   v1: official fee ÷ SGIS *annual* total population of the same reference YEAR.
#   v2: official fee ÷ MOIS *monthly* resident-registration population for the
#       exact denominator MONTH the selected period requires.
#
# The SGIS annual series is never used as a landfill denominator or fallback
# under v2 — it remains the denominator for the Equity indicators, untouched.

# Bump when the formula, denominator rule, unit handling, or precision changes.
PER_CAPITA_DERIVATION_VERSION = "landfill-fee-per-capita-v2"
PER_CAPITA_INDICATOR = "LANDFILL_INBOUND_FEE_PER_CAPITA"
# KRW per person. Rendered Korean-first to match EFFECTIVE_FEE_UNIT ("KRW/톤").
PER_CAPITA_FEE_UNIT = "KRW/인"
PER_CAPITA_DERIVATION_FORMULA = (
    "inbound_fee_krw(선택 기간) ÷ population[persons]"
    "(동일 기간 기준 월말 주민등록 인구 · 동일 광역지자체)"
)

# The only population series v2 accepts as a denominator. A row from any other
# source, definition, or temporal grain is never silently substituted.
EXPECTED_POPULATION_SOURCE_ID = "mois_resident_population"
EXPECTED_POPULATION_DEFINITION = "MOIS_RESIDENT_REGISTRATION_TOTAL"
EXPECTED_POPULATION_GRANULARITY = "MONTHLY"
# The landfill source is metropolitan-only, so the denominator must be a
# 광역지자체 (SIDO) population.
EXPECTED_POPULATION_REGION_LEVEL = "SIDO"

# Unavailability vocabulary. ZERO_POPULATION and AMBIGUOUS_POPULATION_DEFINITION
# are reused verbatim from the existing equity exclusion vocabulary (see
# api/routes/equity.py). v2 reports a missing exact month as
# NO_MATCHING_POPULATION_PERIOD — never as a missing *year*, which would
# misdescribe a monthly denominator.
REASON_NO_MATCHING_POPULATION_PERIOD = "NO_MATCHING_POPULATION_PERIOD"
REASON_NO_METROPOLITAN_POPULATION = "NO_METROPOLITAN_POPULATION"
REASON_ZERO_POPULATION = "ZERO_POPULATION"
REASON_AMBIGUOUS_POPULATION_DEFINITION = "AMBIGUOUS_POPULATION_DEFINITION"
REASON_INCOMPLETE_POPULATION_COVERAGE = "INCOMPLETE_POPULATION_COVERAGE"

PER_CAPITA_CAVEAT = (
    "선택 기간의 공식 반입수수료를 동일 기간 기준의 해당 지역 인구로 나눈 분석용 환산값입니다. "
    "개인의 실제 납부액이 아닙니다."
)


@dataclass(frozen=True)
class MetropolitanPopulation:
    """One candidate monthly population denominator for a landfill origin.

    ``origin_region_code`` is the landfill fact table's origin code; the
    canonical SGIS region it was resolved through is carried alongside so served
    provenance names the actual denominator row, not the origin label.
    """

    origin_region_code: str
    canonical_region_code: str
    region_name: str
    region_level: str
    reference_month: str  # YYYY-MM (month-end)
    reference_year: int
    reference_period: str
    population: int
    population_definition: str
    population_definition_version: str | None
    population_comparability_note: str | None
    temporal_granularity: str
    source_id: str
    source_administrative_code: str | None
    unit: str


@dataclass(frozen=True)
class PerCapitaFee:
    """A served per-capita fee, or an explicit reason it could not be derived.

    ``fee_per_capita_krw`` and ``reason`` are mutually exclusive: exactly one is
    ever set. A value is never zero-filled, estimated, or borrowed from another
    period.
    """

    fee_per_capita_krw: Decimal | None
    reason: str | None
    population: int | None
    population_reference_month: str | None
    population_reference_year: int | None
    population_reference_period: str | None
    population_definition: str | None
    population_definition_version: str | None
    population_comparability_note: str | None
    population_temporal_granularity: str | None
    population_source_id: str | None
    population_source_administrative_code: str | None
    population_region_level: str | None
    population_unit: str | None
    required_population_month: str | None
    included_origin_region_codes: tuple[str, ...]


def required_population_month(
    *,
    reference_year: int,
    selected_month: str | None,
    is_complete_year: bool,
    available_through_month: str | None,
) -> str | None:
    """The one month whose population may serve as this period's denominator.

    * A selected month uses **that exact month** — never a neighbour, December,
      the latest month, or another year.
    * A complete landfill year uses that year's **December** month-end.
    * An incomplete landfill year uses the **final month actually included in the
      fee numerator**, so the denominator never post-dates the fee. (MOIS may
      publish a later month than the landfill fee data covers; borrowing it would
      divide a partial-year fee by a population from outside that period.)

    Returns ``None`` when a partial year has no available month at all.
    """
    if selected_month is not None:
        return selected_month
    if is_complete_year:
        return f"{reference_year:04d}-12"
    return available_through_month


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
    required_month: str | None,
) -> tuple[MetropolitanPopulation | None, str | None]:
    """Pick the one valid denominator for an origin, or say why there is none.

    ``candidates`` may hold rows for any origin and any month; the exact-month
    rule is enforced here, so an adjacent/latest/December-of-another-year value
    is never substituted. Returns ``(row, None)`` or ``(None, reason)``.
    """
    if required_month is None:
        return None, REASON_NO_MATCHING_POPULATION_PERIOD
    for_origin = [c for c in candidates if c.origin_region_code == origin_region_code]
    if not for_origin:
        return None, REASON_NO_METROPOLITAN_POPULATION
    exact = [c for c in for_origin if c.reference_month == required_month]
    if not exact:
        # The origin has population, but not for the month this period requires.
        return None, REASON_NO_MATCHING_POPULATION_PERIOD
    accepted = [
        c
        for c in exact
        if c.population_definition == EXPECTED_POPULATION_DEFINITION
        and c.source_id == EXPECTED_POPULATION_SOURCE_ID
        and c.temporal_granularity == EXPECTED_POPULATION_GRANULARITY
        and c.region_level == EXPECTED_POPULATION_REGION_LEVEL
    ]
    if not accepted:
        return None, REASON_AMBIGUOUS_POPULATION_DEFINITION
    # Regions are versioned by boundary vintage, so one metropolitan region can
    # legitimately yield several *identical* denominators. Identical values are
    # not ambiguous; competing ones are, and refusing beats picking one.
    distinct = {
        (c.population, c.population_definition, c.source_id, c.reference_period) for c in accepted
    }
    if len(distinct) > 1:
        return None, REASON_AMBIGUOUS_POPULATION_DEFINITION
    resolved = accepted[0]
    if resolved.population <= 0:
        return None, REASON_ZERO_POPULATION
    return resolved, None


def _unavailable(
    reason: str, origins: Sequence[str], required_month: str | None = None
) -> PerCapitaFee:
    return PerCapitaFee(
        fee_per_capita_krw=None,
        reason=reason,
        population=None,
        population_reference_month=None,
        population_reference_year=None,
        population_reference_period=None,
        population_definition=None,
        population_definition_version=None,
        population_comparability_note=None,
        population_temporal_granularity=None,
        population_source_id=None,
        population_source_administrative_code=None,
        population_region_level=None,
        population_unit=None,
        required_population_month=required_month,
        included_origin_region_codes=tuple(origins),
    )


def _from_resolved(
    value: Decimal,
    resolved: MetropolitanPopulation,
    *,
    population: int,
    origins: Sequence[str],
    required_month: str,
) -> PerCapitaFee:
    return PerCapitaFee(
        fee_per_capita_krw=value,
        reason=None,
        population=population,
        population_reference_month=resolved.reference_month,
        population_reference_year=resolved.reference_year,
        population_reference_period=resolved.reference_period,
        population_definition=resolved.population_definition,
        population_definition_version=resolved.population_definition_version,
        population_comparability_note=resolved.population_comparability_note,
        population_temporal_granularity=resolved.temporal_granularity,
        population_source_id=resolved.source_id,
        population_source_administrative_code=resolved.source_administrative_code,
        population_region_level=resolved.region_level,
        population_unit=resolved.unit,
        required_population_month=required_month,
        included_origin_region_codes=tuple(origins),
    )


def origin_fee_per_capita(
    inbound_fee_krw: Decimal,
    candidates: Sequence[MetropolitanPopulation],
    *,
    origin_region_code: str,
    required_month: str | None,
) -> PerCapitaFee:
    """Per-capita fee for a single metropolitan origin (one row of the table)."""
    resolved, reason = resolve_population(
        candidates, origin_region_code=origin_region_code, required_month=required_month
    )
    if resolved is None:
        assert reason is not None
        return _unavailable(reason, [origin_region_code], required_month)
    value = fee_per_capita(inbound_fee_krw, resolved.population)
    if value is None:  # Defensive: resolve_population already rejects <= 0.
        return _unavailable(REASON_ZERO_POPULATION, [origin_region_code], required_month)
    assert required_month is not None
    return _from_resolved(
        value,
        resolved,
        population=resolved.population,
        origins=(origin_region_code,),
        required_month=required_month,
    )


def aggregate_fee_per_capita(
    inbound_fee_krw: Decimal,
    candidates: Sequence[MetropolitanPopulation],
    *,
    origin_region_codes: Sequence[str],
    required_month: str | None,
) -> PerCapitaFee:
    """Per-capita fee across several origins: Σ fee ÷ Σ same-period population.

    The per-origin values are **never averaged** — a mean would silently reweight
    the metropolitan regions as if they were equal in size. Coverage must be
    complete: if any included origin lacks a valid denominator for the required
    month the aggregate is ``None`` with ``INCOMPLETE_POPULATION_COVERAGE``
    rather than a partially-covered number. When *every* origin fails for the
    same reason the aggregate reports that reason instead, which is both more
    precise and more useful than calling total absence "incomplete coverage".
    """
    origins = sorted(set(origin_region_codes))
    if not origins:
        return _unavailable(REASON_NO_METROPOLITAN_POPULATION, origins, required_month)
    resolved: list[MetropolitanPopulation] = []
    failures: list[str] = []
    for code in origins:
        row, reason = resolve_population(
            candidates, origin_region_code=code, required_month=required_month
        )
        if row is None:
            assert reason is not None
            failures.append(reason)
            continue
        resolved.append(row)
    if failures:
        shared = set(failures)
        if not resolved and len(shared) == 1:
            return _unavailable(failures[0], origins, required_month)
        return _unavailable(REASON_INCOMPLETE_POPULATION_COVERAGE, origins, required_month)
    # Summing across origins requires one shared denominator definition/period.
    if len({(r.population_definition, r.source_id, r.reference_month) for r in resolved}) > 1:
        return _unavailable(REASON_AMBIGUOUS_POPULATION_DEFINITION, origins, required_month)
    total_population = sum(r.population for r in resolved)
    value = fee_per_capita(inbound_fee_krw, total_population)
    if value is None:
        return _unavailable(REASON_ZERO_POPULATION, origins, required_month)
    assert required_month is not None
    return _from_resolved(
        value,
        resolved[0],
        population=total_population,
        origins=origins,
        required_month=required_month,
    )


__all__ = [
    "DERIVATION_FORMULA",
    "DERIVATION_VERSION",
    "EFFECTIVE_FEE_UNIT",
    "EVIDENCE_OFFICIAL_DERIVED",
    "EVIDENCE_OFFICIAL_REPORTED",
    "EXPECTED_POPULATION_DEFINITION",
    "EXPECTED_POPULATION_GRANULARITY",
    "EXPECTED_POPULATION_REGION_LEVEL",
    "EXPECTED_POPULATION_SOURCE_ID",
    "PER_CAPITA_CAVEAT",
    "PER_CAPITA_DERIVATION_FORMULA",
    "PER_CAPITA_DERIVATION_VERSION",
    "PER_CAPITA_FEE_UNIT",
    "PER_CAPITA_INDICATOR",
    "REASON_AMBIGUOUS_POPULATION_DEFINITION",
    "REASON_INCOMPLETE_POPULATION_COVERAGE",
    "REASON_NO_MATCHING_POPULATION_PERIOD",
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
    "required_population_month",
    "resolve_population",
    "share",
    "to_tons",
]
