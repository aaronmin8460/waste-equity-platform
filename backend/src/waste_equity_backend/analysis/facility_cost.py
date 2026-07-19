"""Official-standard facility installation-cost analytical model (Phase 4 V1).

Pure, independently testable ``Decimal`` arithmetic that derives a **standard
construction cost** for a new incineration or automated-sorting facility from the
government standard-cost (표준공사비) table, plus a straight-line annualization, a
simplified subsidy/local-share split, and a per-capita local share.

This is decision-support analysis, NOT any of the following, and the API/UI must
never present it as such:
  * an actual project budget or actual total project cost (실제 총사업비 아님),
  * an approved national subsidy decision (승인된 국고보조금 아님),
  * an actual transport-cost model (실제 운송비 아님 — see the guardrail below),
  * a complete annual operating-cost model (운영비 미포함),
  * a cheapest-candidate ranking.

All monetary values are exact ``Decimal`` (never binary float); the unit for the
construction-cost figures is 억원 (hundred-million KRW), matching the source
table's 억원/(톤·일) unit. The per-capita local share is in 원 (KRW).

Terminology (fixed, mirrored in the API/UI):
  * standard_construction_cost_bn  = 표준공사비 기반 설치비 산정액
  * annualized_construction_cost_bn = 연간 환산 설치비
  * per_capita_local_share_won      = 주민 1인당 환산 지방비
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal

# --------------------------------------------------------------------------- #
# Versioned reference metadata (the active seeded standard-cost table version).
# --------------------------------------------------------------------------- #

DERIVATION_VERSION = "facility-cost-v1"

ACTIVE_COST_VERSION = "capex-standard-v2022dec"
PRICE_BASE_DATE = datetime.date(2022, 12, 1)
SOURCE_DOCUMENT = "2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2"
SOURCE_PAGE = "p.211"
SOURCE_NOTE = (
    "표준공사비 단가(억원/(톤·일))는 국고보조금 업무처리지침의 시설 규모별 표준공사비 표를 "
    "그대로 옮긴 값입니다. 물가·설계 변경, 부지 여건, 실제 계약단가는 반영되지 않습니다."
)

FACILITY_TYPE_INCINERATION = "incineration_new"
FACILITY_TYPE_SORTING = "sorting_auto"
SUPPORTED_FACILITY_TYPES: frozenset[str] = frozenset(
    {FACILITY_TYPE_INCINERATION, FACILITY_TYPE_SORTING}
)

FACILITY_TYPE_LABELS: dict[str, str] = {
    FACILITY_TYPE_INCINERATION: "신규 소각시설 (new incineration)",
    FACILITY_TYPE_SORTING: "자동선별 재활용시설 (automated sorting/recycling)",
}

DEFAULT_OPERATING_DAYS = 300
_MAX_OPERATING_DAYS = 366

# Underground (지하화) scenario multiplier. Never a boolean and never presented as
# a guaranteed/approved construction multiplier or amount.
UNDERGROUND_MULTIPLIER_MIN = Decimal("1.00")
UNDERGROUND_MULTIPLIER_MAX = Decimal("1.40")
DEFAULT_UNDERGROUND_MULTIPLIER = Decimal("1.00")
UNDERGROUND_MULTIPLIER_NOTE = (
    "1.00은 지상형 기준, 1.00 초과는 지하화 분석 시나리오이며 1.40은 국고지원 협의 상한 시나리오"
    "입니다. 실제 보장된 공사비 배수나 승인 금액이 아닙니다."
)

# Nominal subsidy rates by explicit scenario choice. Joint-regional eligibility is
# NEVER inferred merely because several regions were selected — it is an explicit
# scheme the caller chooses.
SUBSIDY_SCHEMES: dict[str, Decimal] = {
    "seoul_special_city": Decimal("0.30"),
    "metropolitan_city": Decimal("0.40"),
    "city_or_county": Decimal("0.30"),
    "joint_regional_facility": Decimal("0.50"),
}
SUBSIDY_SCHEME_LABELS: dict[str, str] = {
    "seoul_special_city": "서울특별시 (30%)",
    "metropolitan_city": "광역시 (40%)",
    "city_or_county": "시·군 (30%)",
    "joint_regional_facility": "광역(공동) 시설 (50%)",
}

# The nominal national-subsidy rates by local-government type are policy rates from
# the same 국고보조금 업무처리지침 as the standard-cost table. They are used here as
# ANALYTICAL ASSUMPTIONS (a scenario), never as an approved grant. Named so the API
# can carry the rate's source/basis (AGENTS.md: every displayed metric needs a
# source and reference period).
SUBSIDY_RATE_SOURCE = (
    "2025년 폐기물처리시설 국고보조금 업무처리지침 (지방자치단체 유형별 명목 국고보조율)"
)
SUBSIDY_RATE_BASIS = "명목 국고보조율(분석용 가정) — 실제 승인된 국고보조금이 아님"
SUBSIDY_RATE_REFERENCE_PERIOD = "2025 (업무처리지침 기준)"

# Exact-decimal precisions. 톤/일 and 억원 keep six decimals (the storage scale of
# the source quantities/costs); the per-capita local share is 원 to two decimals.
_QUANTITY_PRECISION = Decimal("0.000001")
_COST_BN_PRECISION = Decimal("0.000001")
_WON_PRECISION = Decimal("0.01")


# --------------------------------------------------------------------------- #
# Structured errors (each carries a machine code the API returns as a 4xx body).
# --------------------------------------------------------------------------- #


class FacilityCostError(ValueError):
    """Base for all facility-cost model errors; ``code`` is the API error code."""

    code = "FACILITY_COST_ERROR"


class UnsupportedFacilityTypeError(FacilityCostError):
    code = "UNSUPPORTED_FACILITY_TYPE"

    def __init__(self, facility_type: str) -> None:
        super().__init__(
            f"Unsupported facility_type {facility_type!r}; "
            f"supported: {sorted(SUPPORTED_FACILITY_TYPES)}."
        )
        self.facility_type = facility_type


class UnknownCostVersionError(FacilityCostError):
    code = "UNKNOWN_COST_VERSION"

    def __init__(self, cost_version: str) -> None:
        super().__init__(f"Unknown cost_version {cost_version!r}; no seeded standard-cost rows.")
        self.cost_version = cost_version


class NoMatchingCostBandError(FacilityCostError):
    code = "NO_MATCHING_COST_BAND"

    def __init__(self, facility_type: str, capacity: Decimal) -> None:
        super().__init__(
            f"No standard-cost band matches {facility_type!r} at capacity {capacity} 톤/일."
        )
        self.facility_type = facility_type
        self.capacity = capacity


class OverlappingCostBandError(FacilityCostError):
    code = "OVERLAPPING_COST_BAND"

    def __init__(self, facility_type: str, capacity: Decimal, count: int) -> None:
        super().__init__(
            f"{count} standard-cost bands match {facility_type!r} at capacity {capacity} 톤/일; "
            "the reference table must define exactly one band per capacity."
        )
        self.facility_type = facility_type
        self.capacity = capacity
        self.count = count


class InvalidProcessingShareError(FacilityCostError):
    code = "INVALID_PROCESSING_SHARE"


class InvalidOperatingDaysError(FacilityCostError):
    code = "INVALID_OPERATING_DAYS"


class InvalidUndergroundMultiplierError(FacilityCostError):
    code = "INVALID_UNDERGROUND_MULTIPLIER"


class UnknownSubsidySchemeError(FacilityCostError):
    code = "UNKNOWN_SUBSIDY_SCHEME"

    def __init__(self, scheme: str) -> None:
        super().__init__(f"Unknown subsidy_scheme {scheme!r}; known: {sorted(SUBSIDY_SCHEMES)}.")
        self.scheme = scheme


class MissingServicePopulationError(FacilityCostError):
    """Raised when a per-capita local share cannot be computed honestly."""

    code = "MISSING_SERVICE_POPULATION"

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


# --------------------------------------------------------------------------- #
# Standard-cost reference bands (interval semantics + canonical seed).
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class StandardCostBand:
    """One capacity band of the standard-cost table (억원 per 톤/일).

    Interval semantics: ``capacity_min``/``capacity_max`` are ``None`` for an
    unbounded side. The first band is ``[0, 30]`` (min unbounded, upper
    inclusive); middle bands are ``(lower, upper]`` (lower-exclusive,
    upper-inclusive); the last band is ``(lower, +inf)``. Bands are contiguous and
    non-overlapping so exactly one matches any positive capacity.
    """

    facility_type: str
    capacity_min_ton_per_day: Decimal | None
    capacity_min_inclusive: bool
    capacity_max_ton_per_day: Decimal | None
    capacity_max_inclusive: bool
    cost_per_capacity_bn: Decimal

    def matches(self, capacity: Decimal) -> bool:
        lo = self.capacity_min_ton_per_day
        hi = self.capacity_max_ton_per_day
        lower_ok = lo is None or (capacity >= lo if self.capacity_min_inclusive else capacity > lo)
        upper_ok = hi is None or (capacity <= hi if self.capacity_max_inclusive else capacity < hi)
        return lower_ok and upper_ok


def _band(
    facility_type: str,
    lo: str | None,
    hi: str | None,
    cost: str,
) -> StandardCostBand:
    # Helper for the canonical seed: first band (lo None) has an inclusive upper;
    # bounded bands are (lower-exclusive, upper-inclusive]; last band (hi None) has
    # no upper. Lower is inclusive only when unbounded (irrelevant) — modelled as
    # inclusive=True there for a stable, documented value.
    return StandardCostBand(
        facility_type=facility_type,
        capacity_min_ton_per_day=None if lo is None else Decimal(lo),
        capacity_min_inclusive=lo is None,
        capacity_max_ton_per_day=None if hi is None else Decimal(hi),
        capacity_max_inclusive=hi is not None,
        cost_per_capacity_bn=Decimal(cost),
    )


# Canonical v2022dec seed (억원 per 톤/일). Mirrored, self-contained, in the Alembic
# migration; a consistency test asserts the two never diverge.
STANDARD_COST_SEED: tuple[StandardCostBand, ...] = (
    # INCINERATION_NEW
    _band(FACILITY_TYPE_INCINERATION, None, "30", "6.24"),
    _band(FACILITY_TYPE_INCINERATION, "30", "50", "5.90"),
    _band(FACILITY_TYPE_INCINERATION, "50", "100", "5.23"),
    _band(FACILITY_TYPE_INCINERATION, "100", "200", "4.98"),
    _band(FACILITY_TYPE_INCINERATION, "200", None, "4.57"),
    # SORTING_AUTO
    _band(FACILITY_TYPE_SORTING, None, "10", "5.97"),
    _band(FACILITY_TYPE_SORTING, "10", "20", "4.63"),
    _band(FACILITY_TYPE_SORTING, "20", "30", "3.60"),
    _band(FACILITY_TYPE_SORTING, "30", "40", "3.45"),
    _band(FACILITY_TYPE_SORTING, "40", "50", "3.31"),
    _band(FACILITY_TYPE_SORTING, "50", "60", "3.23"),
    _band(FACILITY_TYPE_SORTING, "60", "70", "2.98"),
    _band(FACILITY_TYPE_SORTING, "70", "80", "2.94"),
    _band(FACILITY_TYPE_SORTING, "80", "90", "2.92"),
    _band(FACILITY_TYPE_SORTING, "90", None, "2.90"),
)


def seed_bands_for(facility_type: str) -> list[StandardCostBand]:
    return [b for b in STANDARD_COST_SEED if b.facility_type == facility_type]


# --------------------------------------------------------------------------- #
# Pure calculation functions.
# --------------------------------------------------------------------------- #


def _as_decimal(value: Decimal | int | str) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def processing_share_from_percent(percent: Decimal | int | str) -> Decimal:
    """Validate a 0–100 percent and return the 0–1 fraction (exact)."""
    p = _as_decimal(percent)
    if p < 0 or p > 100:
        raise InvalidProcessingShareError(
            f"processing_share_percent {p} is out of range; expected 0–100."
        )
    return p / Decimal(100)


def validate_processing_share(share: Decimal) -> Decimal:
    if share < 0 or share > 1:
        raise InvalidProcessingShareError(
            f"processing_share {share} is out of range; expected 0–1."
        )
    return share


def annual_service_quantity_ton(
    official_annual_quantity_ton: Decimal, processing_share: Decimal
) -> Decimal:
    """The scenario's annual quantity handled by the local facility (톤/년)."""
    share = validate_processing_share(processing_share)
    quantity = _as_decimal(official_annual_quantity_ton)
    if quantity < 0:
        raise FacilityCostError("official_annual_quantity_ton must be non-negative.")
    return (quantity * share).quantize(_QUANTITY_PRECISION, rounding=ROUND_HALF_EVEN)


def facility_capacity_ton_per_day(
    annual_service_quantity_ton: Decimal, operating_days_per_year: int
) -> Decimal:
    """Required daily capacity (톤/일) from the annual service quantity.

    Starts from an ANNUAL quantity (the official waste statistics are annual), so
    it only divides by operating days. The equivalent daily-input formula
    (daily × 365 / operating_days) is never applied on top of this — the two
    conversions are mutually exclusive.
    """
    if operating_days_per_year <= 0 or operating_days_per_year > _MAX_OPERATING_DAYS:
        raise InvalidOperatingDaysError(
            f"operating_days_per_year {operating_days_per_year} is out of range; "
            f"expected 1–{_MAX_OPERATING_DAYS}."
        )
    return (_as_decimal(annual_service_quantity_ton) / Decimal(operating_days_per_year)).quantize(
        _QUANTITY_PRECISION, rounding=ROUND_HALF_EVEN
    )


def lookup_unit_cost(
    bands: list[StandardCostBand], facility_type: str, capacity_ton_per_day: Decimal
) -> StandardCostBand:
    """Return the single matching band, or raise a structured error.

    ``bands`` are the reference rows for one cost version. Exactly one band must
    match: zero → :class:`NoMatchingCostBandError`; more than one →
    :class:`OverlappingCostBandError`; unsupported type →
    :class:`UnsupportedFacilityTypeError`.
    """
    if facility_type not in SUPPORTED_FACILITY_TYPES:
        raise UnsupportedFacilityTypeError(facility_type)
    capacity = _as_decimal(capacity_ton_per_day)
    matching = [b for b in bands if b.facility_type == facility_type and b.matches(capacity)]
    if not matching:
        raise NoMatchingCostBandError(facility_type, capacity)
    if len(matching) > 1:
        raise OverlappingCostBandError(facility_type, capacity, len(matching))
    return matching[0]


def validate_underground_multiplier(multiplier: Decimal) -> Decimal:
    m = _as_decimal(multiplier)
    if m < UNDERGROUND_MULTIPLIER_MIN or m > UNDERGROUND_MULTIPLIER_MAX:
        raise InvalidUndergroundMultiplierError(
            f"underground_multiplier {m} is out of range; expected "
            f"{UNDERGROUND_MULTIPLIER_MIN}–{UNDERGROUND_MULTIPLIER_MAX}."
        )
    return m


def standard_construction_cost_bn(
    unit_cost_bn_per_tpd: Decimal, capacity_ton_per_day: Decimal, underground_multiplier: Decimal
) -> Decimal:
    """표준공사비 기반 설치비 산정액 (억원) = 단가 × 규모 × 지하화 배수."""
    um = validate_underground_multiplier(underground_multiplier)
    value = _as_decimal(unit_cost_bn_per_tpd) * _as_decimal(capacity_ton_per_day) * um
    return value.quantize(_COST_BN_PRECISION, rounding=ROUND_HALF_EVEN)


def facility_lifetime_years(facility_type: str, capacity_ton_per_day: Decimal) -> int:
    """Analytical straight-line lifetime (years) for annualization."""
    capacity = _as_decimal(capacity_ton_per_day)
    if facility_type == FACILITY_TYPE_INCINERATION:
        return 15 if capacity <= Decimal("50") else 20
    if facility_type == FACILITY_TYPE_SORTING:
        return 15
    raise UnsupportedFacilityTypeError(facility_type)


def annualized_construction_cost_bn(standard_bn: Decimal, lifetime_years: int) -> Decimal:
    """연간 환산 설치비 (억원). Straight-line annualization, NOT a payment schedule."""
    if lifetime_years <= 0:
        raise FacilityCostError("lifetime_years must be positive.")
    return (_as_decimal(standard_bn) / Decimal(lifetime_years)).quantize(
        _COST_BN_PRECISION, rounding=ROUND_HALF_EVEN
    )


def subsidy_rate(scheme: str) -> Decimal:
    try:
        return SUBSIDY_SCHEMES[scheme]
    except KeyError as exc:
        raise UnknownSubsidySchemeError(scheme) from exc


def estimated_national_subsidy_bn(standard_bn: Decimal, rate: Decimal) -> Decimal:
    """Analytical estimate at a NOMINAL rate — not an approved grant amount."""
    return (_as_decimal(standard_bn) * _as_decimal(rate)).quantize(
        _COST_BN_PRECISION, rounding=ROUND_HALF_EVEN
    )


def simplified_local_government_share_bn(standard_bn: Decimal, subsidy_bn: Decimal) -> Decimal:
    """Analytical estimate = 표준공사비 − 국비 추정. Not an actual local budget."""
    return (_as_decimal(standard_bn) - _as_decimal(subsidy_bn)).quantize(
        _COST_BN_PRECISION, rounding=ROUND_HALF_EVEN
    )


def per_capita_local_share_won(
    local_share_bn: Decimal, official_service_population: int
) -> Decimal:
    """주민 1인당 환산 지방비 (원). NOT a personal tax bill.

    Only valid with an exact official population denominator; the caller supplies
    a population compatible with the selected geography/period. A missing or
    non-positive population raises :class:`MissingServicePopulationError` so the
    caller returns null + reason rather than a fabricated number.
    """
    if official_service_population is None or official_service_population <= 0:
        raise MissingServicePopulationError("NO_OFFICIAL_SERVICE_POPULATION")
    won = _as_decimal(local_share_bn) * Decimal(100_000_000)
    return (won / Decimal(official_service_population)).quantize(
        _WON_PRECISION, rounding=ROUND_HALF_EVEN
    )


# --------------------------------------------------------------------------- #
# Transport-cost guardrail (dimensional audit only — NOT an actual transport cost).
# --------------------------------------------------------------------------- #


def transport_cost_bn_from_ton_km(price_won_per_ton_km: Decimal, ton_km_10k: Decimal) -> Decimal:
    """Dimensional conversion of a stored ``만 t·km`` load × 원/t·km price to 억원.

    억원 = 원/t·km × (만 t·km × 10_000 t·km) ÷ 100_000_000 원/억원
         = price_won_per_ton_km × ton_km_10k × 0.0001.

    This exists ONLY to document the correct unit algebra. It is NOT exposed as an
    actual transport cost in V1: real routes, origins, distances, and contract
    rates are not integrated, and any round-trip/utilization factor must be a
    SEPARATE explicit parameter — never folded into this conversion.
    """
    return (
        _as_decimal(price_won_per_ton_km) * _as_decimal(ton_km_10k) * Decimal("0.0001")
    ).quantize(_COST_BN_PRECISION, rounding=ROUND_HALF_EVEN)


# --------------------------------------------------------------------------- #
# Completeness metadata (which components are / are not in the partial result).
# --------------------------------------------------------------------------- #

INCLUDED_COMPONENTS: tuple[str, ...] = (
    "STANDARD_CONSTRUCTION_COST",
    "ANNUALIZED_CONSTRUCTION_COST",
    "SIMPLIFIED_SUBSIDY",
    "SIMPLIFIED_LOCAL_GOVERNMENT_SHARE",
)

MISSING_COMPONENTS: tuple[dict[str, str], ...] = (
    {"component": "OPERATING_COST", "reason": "OFFICIAL_SOURCE_NOT_INTEGRATED"},
    {"component": "ACTUAL_TRANSPORT_COST", "reason": "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE"},
    {"component": "LAND_AND_COMPENSATION", "reason": "PARCEL_SPECIFIC_COST_UNAVAILABLE"},
    {"component": "REMAINING_LANDFILL_COST", "reason": "FACILITY_MASS_BALANCE_NOT_ESTABLISHED"},
)


def completeness() -> dict[str, object]:
    """The partial-result completeness metadata (never a '총비용' / total cost)."""
    return {
        "is_partial": True,
        "included_components": list(INCLUDED_COMPONENTS),
        "missing_components": [dict(component) for component in MISSING_COMPONENTS],
    }


DISCLAIMER = (
    "표준공사비 기반 설치비 분석입니다. 실제 총사업비·승인된 국고보조금·주민 개인의 세금 청구액이 "
    "아니며, 운영비·실제 운송비·토지 및 보상비·후보지별 토목조건 등은 포함되지 않았습니다. "
    "(Standard-construction-cost analysis only — not an actual total project cost, an approved "
    "subsidy, or a personal tax bill; operating, actual transport, land/compensation, and "
    "site-specific civil costs are excluded.)"
)


# --------------------------------------------------------------------------- #
# Orchestrator.
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class FacilityCostCalculation:
    """The full cost calculation for one scenario (all amounts exact ``Decimal``)."""

    facility_type: str
    # scenario
    processing_share: Decimal
    operating_days_per_year: int
    underground_multiplier: Decimal
    subsidy_scheme: str
    subsidy_rate: Decimal
    # official input vs scenario quantity
    official_annual_quantity_ton: Decimal
    annual_service_quantity_ton: Decimal
    # capacity + matched band
    facility_capacity_ton_per_day: Decimal
    matched_band: StandardCostBand
    standard_unit_cost_bn_per_tpd: Decimal
    # standard cost + annualization
    standard_construction_cost_bn: Decimal
    facility_lifetime_years: int
    annualized_construction_cost_bn: Decimal
    # subsidy + local share
    estimated_national_subsidy_bn: Decimal
    simplified_local_government_share_bn: Decimal
    # per-capita (null + reason when no valid denominator)
    per_capita_local_share_won: Decimal | None
    per_capita_unavailable_reason: str | None
    official_service_population: int | None


def calculate_facility_cost(
    *,
    bands: list[StandardCostBand],
    facility_type: str,
    official_annual_quantity_ton: Decimal,
    processing_share: Decimal,
    operating_days_per_year: int,
    underground_multiplier: Decimal,
    subsidy_scheme: str,
    official_service_population: int | None,
) -> FacilityCostCalculation:
    """Compute the full standard-cost scenario. ``bands`` are the version's rows.

    Raises the structured :class:`FacilityCostError` subclasses on invalid input;
    the per-capita share degrades to ``None`` + a reason (never fabricated) when no
    valid population denominator is available.
    """
    if facility_type not in SUPPORTED_FACILITY_TYPES:
        raise UnsupportedFacilityTypeError(facility_type)
    share = validate_processing_share(processing_share)
    multiplier = validate_underground_multiplier(underground_multiplier)
    rate = subsidy_rate(subsidy_scheme)

    service_quantity = annual_service_quantity_ton(official_annual_quantity_ton, share)
    capacity = facility_capacity_ton_per_day(service_quantity, operating_days_per_year)
    band = lookup_unit_cost(bands, facility_type, capacity)
    unit_cost = band.cost_per_capacity_bn

    standard_bn = standard_construction_cost_bn(unit_cost, capacity, multiplier)
    lifetime = facility_lifetime_years(facility_type, capacity)
    annualized_bn = annualized_construction_cost_bn(standard_bn, lifetime)

    subsidy_bn = estimated_national_subsidy_bn(standard_bn, rate)
    local_share_bn = simplified_local_government_share_bn(standard_bn, subsidy_bn)

    per_capita: Decimal | None = None
    per_capita_reason: str | None = None
    try:
        per_capita = per_capita_local_share_won(local_share_bn, official_service_population or 0)
    except MissingServicePopulationError as exc:
        per_capita_reason = exc.reason

    return FacilityCostCalculation(
        facility_type=facility_type,
        processing_share=share,
        operating_days_per_year=operating_days_per_year,
        underground_multiplier=multiplier,
        subsidy_scheme=subsidy_scheme,
        subsidy_rate=rate,
        official_annual_quantity_ton=_as_decimal(official_annual_quantity_ton),
        annual_service_quantity_ton=service_quantity,
        facility_capacity_ton_per_day=capacity,
        matched_band=band,
        standard_unit_cost_bn_per_tpd=unit_cost,
        standard_construction_cost_bn=standard_bn,
        facility_lifetime_years=lifetime,
        annualized_construction_cost_bn=annualized_bn,
        estimated_national_subsidy_bn=subsidy_bn,
        simplified_local_government_share_bn=local_share_bn,
        per_capita_local_share_won=per_capita,
        per_capita_unavailable_reason=per_capita_reason,
        official_service_population=official_service_population,
    )
