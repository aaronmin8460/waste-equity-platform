"""2024 municipal analytical geography registry + payment-per-capita computation.

Everything here is shared by the ingestion loader (which writes the registry, the
observations and the indicator rows) and the read-only API (which serves them),
so the 66-municipality expectation, the reviewed file mappings, and the Decimal
arithmetic have exactly one definition.

Three things this module deliberately does **not** do:

- It never reads the MOIS monthly resident-registration series. That series is
  metropolitan-only and cannot denominate a municipal indicator.
- It never borrows another reference year, interpolates a population, or falls
  back to a parent metropolitan population.
- It never touches ``landfill_inbound_monthly`` or the official
  ``LANDFILL_INBOUND_FEE_PER_CAPITA`` indicator, which measure a different thing
  on a different accounting basis.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, Decimal

from ..models.municipal_cost import (
    BOUNDARY_VINTAGE,
    EVIDENCE_OFFICIAL_DERIVED,
    EVIDENCE_OFFICIAL_REPORTED,
    PARTIAL_REASONS,
    POPULATION_DERIVED_WARD_SUM,
    POPULATION_DIRECT,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_AMBIGUOUS_SOURCE_MEANING,
    REASON_BOUNDARY_MISMATCH,
    REASON_DUPLICATE_SOURCE_RECORD,
    REASON_INCONSISTENT_TOTAL,
    REASON_MALFORMED_FILENAME_RESOLVED,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_POPULATION,
    REASON_MISSING_QUANTITY,
    REASON_MIXED_REFERENCE_YEARS,
    REASON_NO_SOURCE_FILE,
    REASON_NO_VERIFIED_LANDFILL_QUANTITY,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
    REASON_POST_2024_FILENAME_RESOLVED,
    REASON_UNSUPPORTED_SOURCE_LAYOUT,
    REASON_UNSUPPORTED_UNIT,
    REASON_ZERO_TOTAL_QUANTITY,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
)

REFERENCE_YEAR = 2024

# Metropolitan codes as the landfill dashboard names them (11/28/41) and the
# canonical ``regions`` parent codes SGIS actually uses (11/23/31). Only Seoul
# coincides. Joining the two systems directly would resolve Seoul and silently
# report Incheon and Gyeonggi as having no data, so every lookup goes through
# this reviewed crosswalk.
METROPOLITAN_SEOUL = "11"
METROPOLITAN_INCHEON = "28"
METROPOLITAN_GYEONGGI = "41"
METROPOLITAN_CODES = (METROPOLITAN_SEOUL, METROPOLITAN_INCHEON, METROPOLITAN_GYEONGGI)
METROPOLITAN_NAMES: dict[str, str] = {
    METROPOLITAN_SEOUL: "서울특별시",
    METROPOLITAN_INCHEON: "인천광역시",
    METROPOLITAN_GYEONGGI: "경기도",
}
METROPOLITAN_TO_CANONICAL_PARENT: dict[str, str] = {
    METROPOLITAN_SEOUL: "KR-SGIS-11",
    METROPOLITAN_INCHEON: "KR-SGIS-23",
    METROPOLITAN_GYEONGGI: "KR-SGIS-31",
}

# 2026 Incheon units. They are not 2024 geography and must never be created,
# displayed, or inferred as a 2024 observation.
POST_2024_INCHEON_UNITS = ("제물포구", "영종구", "서해구", "검단구")


def nfc(value: str) -> str:
    """Normalize to Unicode NFC.

    macOS hands back Korean path and filename components in NFD; a comparison
    that skips this silently fails to match every Korean name.
    """

    return unicodedata.normalize("NFC", value)


@dataclass(frozen=True)
class MunicipalityDefinition:
    """One expected 2024 analytical municipality (reviewed registry entry)."""

    metropolitan_code: str
    display_name: str
    # Canonical ``regions.region_code`` when the municipality exists at the
    # required grain; None for the seven Gyeonggi cities stored only as 일반구.
    canonical_region_code: str | None
    # Constituent 일반구 codes, in official code order, for a derived city.
    ward_region_codes: tuple[str, ...] = ()

    @property
    def municipality_key(self) -> str:
        return f"{self.metropolitan_code}-{self.display_name}"

    @property
    def metropolitan_name(self) -> str:
        return METROPOLITAN_NAMES[self.metropolitan_code]

    @property
    def population_method(self) -> str:
        return POPULATION_DIRECT if self.canonical_region_code else POPULATION_DERIVED_WARD_SUM

    @property
    def evidence_status(self) -> str:
        # A ward-summed city population is derived from official SGIS inputs; it
        # is never presented as a source-reported SGIS region row.
        return (
            EVIDENCE_OFFICIAL_REPORTED if self.canonical_region_code else EVIDENCE_OFFICIAL_DERIVED
        )


def _seoul(name: str, code: str) -> MunicipalityDefinition:
    return MunicipalityDefinition(METROPOLITAN_SEOUL, name, f"KR-SGIS-{code}")


def _incheon(name: str, code: str) -> MunicipalityDefinition:
    return MunicipalityDefinition(METROPOLITAN_INCHEON, name, f"KR-SGIS-{code}")


def _gyeonggi(name: str, code: str) -> MunicipalityDefinition:
    return MunicipalityDefinition(METROPOLITAN_GYEONGGI, name, f"KR-SGIS-{code}")


def _gyeonggi_derived(name: str, *ward_codes: str) -> MunicipalityDefinition:
    return MunicipalityDefinition(
        METROPOLITAN_GYEONGGI,
        name,
        None,
        tuple(f"KR-SGIS-{code}" for code in ward_codes),
    )


# --- Seoul: 25 자치구 -------------------------------------------------------
SEOUL_MUNICIPALITIES: tuple[MunicipalityDefinition, ...] = (
    _seoul("종로구", "11010"),
    _seoul("중구", "11020"),
    _seoul("용산구", "11030"),
    _seoul("성동구", "11040"),
    _seoul("광진구", "11050"),
    _seoul("동대문구", "11060"),
    _seoul("중랑구", "11070"),
    _seoul("성북구", "11080"),
    _seoul("강북구", "11090"),
    _seoul("도봉구", "11100"),
    _seoul("노원구", "11110"),
    _seoul("은평구", "11120"),
    _seoul("서대문구", "11130"),
    _seoul("마포구", "11140"),
    _seoul("양천구", "11150"),
    _seoul("강서구", "11160"),
    _seoul("구로구", "11170"),
    _seoul("금천구", "11180"),
    _seoul("영등포구", "11190"),
    _seoul("동작구", "11200"),
    _seoul("관악구", "11210"),
    _seoul("서초구", "11220"),
    _seoul("강남구", "11230"),
    _seoul("송파구", "11240"),
    _seoul("강동구", "11250"),
)

# --- Incheon: the 10 units of **2024** geography ----------------------------
# The 2026 restructuring is not applied: 제물포구/영종구/서해구/검단구 are never
# created, and the 2024 values of 중구/동구/서구 are never redistributed.
INCHEON_MUNICIPALITIES: tuple[MunicipalityDefinition, ...] = (
    _incheon("중구", "23010"),
    _incheon("동구", "23020"),
    _incheon("미추홀구", "23090"),
    _incheon("연수구", "23040"),
    _incheon("남동구", "23050"),
    _incheon("부평구", "23060"),
    _incheon("계양구", "23070"),
    _incheon("서구", "23080"),
    _incheon("강화군", "23510"),
    _incheon("옹진군", "23520"),
)

# --- Gyeonggi: 31 시·군, city/county grain only -----------------------------
# The seven ward-split cities get one analytical city-level entry each. The
# existing 일반구 ``regions`` rows are referenced, never modified, deleted,
# renamed, or invalidated, and no ordinary ward is exposed as its own
# observation.
GYEONGGI_MUNICIPALITIES: tuple[MunicipalityDefinition, ...] = (
    _gyeonggi_derived("수원시", "31011", "31012", "31013", "31014"),
    _gyeonggi_derived("성남시", "31021", "31022", "31023"),
    _gyeonggi("의정부시", "31030"),
    _gyeonggi_derived("안양시", "31041", "31042"),
    _gyeonggi_derived("부천시", "31051", "31052", "31053"),
    _gyeonggi("광명시", "31060"),
    _gyeonggi("평택시", "31070"),
    _gyeonggi("동두천시", "31080"),
    _gyeonggi_derived("안산시", "31091", "31092"),
    _gyeonggi_derived("고양시", "31101", "31103", "31104"),
    _gyeonggi("과천시", "31110"),
    _gyeonggi("구리시", "31120"),
    _gyeonggi("남양주시", "31130"),
    _gyeonggi("오산시", "31140"),
    _gyeonggi("시흥시", "31150"),
    _gyeonggi("군포시", "31160"),
    _gyeonggi("의왕시", "31170"),
    _gyeonggi("하남시", "31180"),
    _gyeonggi_derived("용인시", "31191", "31192", "31193"),
    _gyeonggi("파주시", "31200"),
    _gyeonggi("이천시", "31210"),
    _gyeonggi("안성시", "31220"),
    _gyeonggi("김포시", "31230"),
    _gyeonggi("화성시", "31240"),
    _gyeonggi("광주시", "31250"),
    _gyeonggi("양주시", "31260"),
    _gyeonggi("포천시", "31270"),
    _gyeonggi("여주시", "31280"),
    _gyeonggi("연천군", "31550"),
    _gyeonggi("가평군", "31570"),
    _gyeonggi("양평군", "31580"),
)

EXPECTED_MUNICIPALITIES: tuple[MunicipalityDefinition, ...] = (
    SEOUL_MUNICIPALITIES + INCHEON_MUNICIPALITIES + GYEONGGI_MUNICIPALITIES
)
EXPECTED_MUNICIPALITY_COUNT = 66
EXPECTED_COUNT_BY_METROPOLITAN: dict[str, int] = {
    METROPOLITAN_SEOUL: 25,
    METROPOLITAN_INCHEON: 10,
    METROPOLITAN_GYEONGGI: 31,
}
DERIVED_POPULATION_CITIES: tuple[str, ...] = tuple(
    definition.display_name
    for definition in GYEONGGI_MUNICIPALITIES
    if definition.canonical_region_code is None
)

MUNICIPALITIES_BY_KEY: dict[str, MunicipalityDefinition] = {
    definition.municipality_key: definition for definition in EXPECTED_MUNICIPALITIES
}
# (metropolitan_code, display_name) → definition, for name resolution scoped to
# the folder's metropolitan. 중구 exists in both Seoul and Incheon, so an
# unscoped name lookup would be ambiguous.
MUNICIPALITIES_BY_METRO_NAME: dict[tuple[str, str], MunicipalityDefinition] = {
    (definition.metropolitan_code, definition.display_name): definition
    for definition in EXPECTED_MUNICIPALITIES
}


@dataclass(frozen=True)
class ReviewedFileMapping:
    """A reviewed, evidence-backed mapping of a defectively-named workbook."""

    dataset_role: str
    metropolitan_code: str
    filename: str
    display_name: str
    evidence: str
    # Why the filename could not be trusted. Carried per entry because the two
    # cases are genuinely different: a post-2024 *rename* (제물포구/서해구) versus a
    # merely *malformed* filename whose 2024 unit was already correct
    # (남동구xlsx.xlsx). Reporting a rename for the latter would state something
    # untrue about the municipality's boundary history.
    reason: str


# Approved reviewed mappings (Step 2 §4). Each is a documented, reproducible
# conversion stated by the workbook itself, so each is informational rather than
# a boundary defect — see REVIEWED_RESOLUTION_REASONS.
REVIEWED_FILE_MAPPINGS: tuple[ReviewedFileMapping, ...] = (
    ReviewedFileMapping(
        "DATA_A",
        METROPOLITAN_INCHEON,
        "제물포구.xlsx",
        "동구",
        "워크북 기관명 셀이 '인천광역시 동구청'으로 2024년 행정구역을 명시함",
        REASON_POST_2024_FILENAME_RESOLVED,
    ),
    ReviewedFileMapping(
        "DATA_A",
        METROPOLITAN_INCHEON,
        "서해구.xlsx",
        "서구",
        "워크북 기관명 셀이 '인천광역시 서구'로 2024년 행정구역을 명시함",
        REASON_POST_2024_FILENAME_RESOLVED,
    ),
    ReviewedFileMapping(
        "DATA_B",
        METROPOLITAN_INCHEON,
        "남동구xlsx.xlsx",
        "남동구",
        "워크북 비고행이 '남동구 자료로 확인(사용자 확인 완료)'로 명시함",
        # 남동구 is a 2024 unit and was never renamed; only the filename is
        # malformed (a doubled extension).
        REASON_MALFORMED_FILENAME_RESOLVED,
    ),
)


@dataclass(frozen=True)
class RejectedFileRule:
    """A workbook that must be recorded but must produce no observation."""

    dataset_role: str
    metropolitan_folder_code: str
    filename: str
    reasons: tuple[str, ...]
    explanation: str


# Rejected workbooks (Step 2 §4 and §5). Their file metadata and rejection status
# are persisted; neither contributes a contract or a quantity observation, and
# the ingestion summary lists both explicitly.
REJECTED_FILE_RULES: tuple[RejectedFileRule, ...] = (
    RejectedFileRule(
        "DATA_B",
        METROPOLITAN_INCHEON,
        "서해구xlsx.xlsx",
        (
            REASON_BOUNDARY_MISMATCH,
            REASON_AMBIGUOUS_REGION_MAPPING,
            REASON_DUPLICATE_SOURCE_RECORD,
            REASON_ZERO_TOTAL_QUANTITY,
        ),
        "2024년 행정구역으로 되돌릴 문서화된 근거가 없는 2026년 명칭 파일이며, 음식물 "
        "계열이 미추홀구 자료와 동일하고 일반·재활용 연간 합계 0은 12개월 '-'에 대한 "
        "SUM 결과입니다.",
    ),
    RejectedFileRule(
        "DATA_B",
        METROPOLITAN_GYEONGGI,
        "양천구.xlsx",
        (REASON_AMBIGUOUS_REGION_MAPPING,),
        "양천구는 서울특별시 자치구이며 경기도에는 존재하지 않습니다. DATA_B에는 "
        "기관명 열이 없어 파일명과 폴더가 충돌하며 이를 판별할 제3의 근거가 없습니다. "
        "서울 또는 경기 어느 쪽으로도 임의 매핑하지 않습니다.",
    ),
)


def find_reviewed_mapping(
    dataset_role: str, metropolitan_code: str, filename: str
) -> ReviewedFileMapping | None:
    normalized = nfc(filename)
    for mapping in REVIEWED_FILE_MAPPINGS:
        if (
            mapping.dataset_role == dataset_role
            and mapping.metropolitan_code == metropolitan_code
            and nfc(mapping.filename) == normalized
        ):
            return mapping
    return None


def find_rejection_rule(
    dataset_role: str, metropolitan_code: str, filename: str
) -> RejectedFileRule | None:
    normalized = nfc(filename)
    for rule in REJECTED_FILE_RULES:
        if (
            rule.dataset_role == dataset_role
            and rule.metropolitan_folder_code == metropolitan_code
            and nfc(rule.filename) == normalized
        ):
            return rule
    return None


def match_municipality_name(
    metropolitan_code: str, candidate: str
) -> MunicipalityDefinition | None:
    """Resolve a municipality name **within one metropolitan**, longest match first.

    Source filenames carry trailing operator annotations
    ("군포시 - 월 별 쓰레기 양 x.xlsx"), so a prefix match is used; the longest
    registry name wins to keep 안산시/안성시-style prefixes unambiguous.
    """

    normalized = nfc(candidate).strip()
    if not normalized:
        return None
    exact = MUNICIPALITIES_BY_METRO_NAME.get((metropolitan_code, normalized))
    if exact is not None:
        return exact
    best: MunicipalityDefinition | None = None
    for (metro, name), definition in MUNICIPALITIES_BY_METRO_NAME.items():
        if metro != metropolitan_code:
            continue
        if normalized.startswith(name) and (best is None or len(name) > len(best.display_name)):
            best = definition
    return best


# Human-readable Korean labels for every reason code, so the API can serve the
# reason alongside the (possibly null) value instead of an unexplained blank.
REASON_LABELS_KO: dict[str, str] = {
    REASON_NO_SOURCE_FILE: "해당 지자체의 2024년 원자료 파일이 없습니다.",
    REASON_MISSING_PAYMENT: "지급액 자료가 없습니다(수량 자료만 있거나 금액 칸이 비어 있음).",
    REASON_MISSING_QUANTITY: "반출량(톤) 자료가 없습니다. 지급액 지표 계산에는 영향이 없습니다.",
    REASON_MISSING_POPULATION: "동일 행정구역 단위의 2024년 인구가 없습니다.",
    REASON_PARTIAL_WASTE_SCOPE: "계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다.",
    REASON_NO_VERIFIED_LANDFILL_QUANTITY: "매립 전용 반출량이 분리되어 있지 않습니다.",
    REASON_ZERO_TOTAL_QUANTITY: "합계 0이 '-' 셀에 대한 SUM 결과이며 실측 0이 아닙니다.",
    REASON_BOUNDARY_MISMATCH: "2024년 행정구역으로 되돌릴 근거가 없는 다른 시점의 행정구역입니다.",
    REASON_AMBIGUOUS_REGION_MAPPING: "행정구역 판별 신호가 충돌하며 이를 해소할 근거가 없습니다.",
    REASON_AMBIGUOUS_SOURCE_MEANING: "원자료 항목의 의미를 확정할 수 없습니다.",
    REASON_DUPLICATE_SOURCE_RECORD: "독립적인 값이 필요한 위치에 동일한 값이 반복되어 있습니다.",
    REASON_UNSUPPORTED_SOURCE_LAYOUT: "확인된 7개 레이아웃 계열에 해당하지 않는 서식입니다.",
    REASON_INCONSISTENT_TOTAL: "원자료의 합계가 구성 항목의 재계산 합계와 일치하지 않습니다.",
    REASON_UNSUPPORTED_UNIT: "단위가 없거나 변환할 수 없습니다.",
    REASON_MIXED_REFERENCE_YEARS: "수량 자료의 기준 기간이 여러 연도에 걸쳐 있습니다.",
    REASON_PARTIAL_GEOGRAPHIC_SCOPE: "계약이 지자체 전체가 아닌 일부 읍·면만 포함합니다.",
    REASON_PARTIAL_PERIOD_COVERAGE: "계약 기간이 2024년 전체가 아닌 일부 기간입니다.",
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE: (
        "지급 기록이 없는 월이 있어 연간 지급액이 불완전합니다."
    ),
    REASON_POST_2024_FILENAME_RESOLVED: (
        "파일명은 2024년 이후 행정구역명이지만 워크북이 2024년 행정구역을 명시하여 "
        "문서화된 근거로 환원했습니다."
    ),
    REASON_MALFORMED_FILENAME_RESOLVED: (
        "파일명 형식이 손상되어 있으나 워크북이 2024년 행정구역을 명시하여 "
        "문서화된 근거로 확인했습니다. 행정구역 변경과는 무관합니다."
    ),
}

# Deterministic display order for reason codes on an API row.
REASON_ORDER: tuple[str, ...] = (
    REASON_NO_SOURCE_FILE,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_POPULATION,
    REASON_BOUNDARY_MISMATCH,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_AMBIGUOUS_SOURCE_MEANING,
    REASON_UNSUPPORTED_SOURCE_LAYOUT,
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
    REASON_MIXED_REFERENCE_YEARS,
    REASON_INCONSISTENT_TOTAL,
    REASON_DUPLICATE_SOURCE_RECORD,
    REASON_NO_VERIFIED_LANDFILL_QUANTITY,
    REASON_ZERO_TOTAL_QUANTITY,
    REASON_UNSUPPORTED_UNIT,
    REASON_MISSING_QUANTITY,
    REASON_POST_2024_FILENAME_RESOLVED,
    REASON_MALFORMED_FILENAME_RESOLVED,
)


def order_reasons(reasons: Iterable[str]) -> list[str]:
    unique = set(reasons)
    ordered = [code for code in REASON_ORDER if code in unique]
    ordered.extend(sorted(unique.difference(REASON_ORDER)))
    return ordered


def describe_reasons(reasons: Sequence[str]) -> list[str]:
    return [REASON_LABELS_KO[code] for code in reasons if code in REASON_LABELS_KO]


# Quantized to four decimals — enough to keep a KRW/인 value exact to a hundredth
# of a won without ever implying more precision than the inputs carry.
INDICATOR_QUANTUM = Decimal("0.0001")


def payment_per_capita(numerator_krw: Decimal, population: int) -> Decimal:
    """Exact-decimal KRW per resident, banker's-rounded to four decimals.

    ``ROUND_HALF_EVEN`` is used so a half-way value does not bias the whole
    series upward. Float arithmetic is never used for a monetary calculation.
    """

    if population <= 0:
        raise ValueError("population must be positive to serve a per-capita value")
    if numerator_krw < 0:
        raise ValueError("numerator must be nonnegative")
    return (numerator_krw / Decimal(population)).quantize(
        INDICATOR_QUANTUM, rounding=ROUND_HALF_EVEN
    )


@dataclass
class IndicatorOutcome:
    """The computed indicator for one municipality, with its reasons."""

    status: str
    value: Decimal | None
    numerator_krw: Decimal | None
    denominator_population: int | None
    contract_count: int
    reason_codes: list[str] = field(default_factory=list)

    @property
    def limitations(self) -> list[str]:
        return describe_reasons(self.reason_codes)


def evaluate_indicator(
    *,
    population: int | None,
    numerator_krw: Decimal | None,
    contract_count: int,
    has_source_file: bool,
    reason_codes: Iterable[str],
) -> IndicatorOutcome:
    """Decide AVAILABLE / PARTIAL / UNAVAILABLE and compute the value.

    The primary indicator depends **only** on an eligible payment, a matching
    2024 municipal population, and the payment's period/geographic/waste scope
    and mapping. Quantity completeness is deliberately not an input: a valid
    payment with no tonnage still yields a value, and ``MISSING_QUANTITY`` never
    degrades it. An unavailable value is NULL, never 0.
    """

    reasons = set(reason_codes)
    if not has_source_file:
        reasons.add(REASON_NO_SOURCE_FILE)
    if numerator_krw is None or contract_count == 0:
        reasons.add(REASON_MISSING_PAYMENT)
    if population is None:
        reasons.add(REASON_MISSING_POPULATION)

    blocking = {
        REASON_NO_SOURCE_FILE,
        REASON_MISSING_PAYMENT,
        REASON_MISSING_POPULATION,
        REASON_BOUNDARY_MISMATCH,
        REASON_AMBIGUOUS_REGION_MAPPING,
        REASON_AMBIGUOUS_SOURCE_MEANING,
        REASON_UNSUPPORTED_SOURCE_LAYOUT,
    }
    if reasons & blocking:
        return IndicatorOutcome(
            status=STATUS_UNAVAILABLE,
            value=None,
            numerator_krw=None,
            denominator_population=None,
            contract_count=contract_count,
            reason_codes=order_reasons(reasons),
        )

    assert numerator_krw is not None and population is not None  # narrowed above
    value = payment_per_capita(numerator_krw, population)
    status = STATUS_PARTIAL if reasons & set(PARTIAL_REASONS) else STATUS_AVAILABLE
    return IndicatorOutcome(
        status=status,
        value=value,
        numerator_krw=numerator_krw,
        denominator_population=population,
        contract_count=contract_count,
        reason_codes=order_reasons(reasons),
    )


GEOGRAPHY_POLICY_KO = (
    "2024년 행정구역 기준입니다. 서울 25개 자치구, 인천 10개 군·구(2024년 기준), "
    "경기 31개 시·군으로 총 66개입니다. 인천의 2026년 신설 구(제물포구·영종구·서해구·"
    "검단구)는 2024년 관측치로 생성하거나 표시하지 않습니다. 경기 일반구는 별도 관측치로 "
    "노출하지 않으며, 기존 일반구 지역 행은 변경하지 않습니다."
)
POPULATION_POLICY_KO = (
    "분모는 2024년 SGIS 연간 인구(SGIS_TOTAL_POPULATION)입니다. 59개 지자체는 해당 "
    "행정구역의 인구를 그대로 사용하고(DIRECT_REGION_POPULATION), 일반구로만 존재하는 "
    "경기 7개 시(수원·성남·안양·부천·안산·고양·용인)는 구성 일반구의 2024년 인구를 정확히 "
    "합산해 산출합니다(DERIVED_SUM_OF_CONSTITUENT_WARDS). 행정안전부 월별 주민등록 인구는 "
    "광역 단위여서 사용하지 않으며, 다른 연도 차용·보간·광역 인구 대체는 하지 않습니다."
)

__all__ = [
    "BOUNDARY_VINTAGE",
    "DERIVED_POPULATION_CITIES",
    "EXPECTED_COUNT_BY_METROPOLITAN",
    "EXPECTED_MUNICIPALITIES",
    "EXPECTED_MUNICIPALITY_COUNT",
    "GEOGRAPHY_POLICY_KO",
    "INDICATOR_QUANTUM",
    "METROPOLITAN_CODES",
    "METROPOLITAN_NAMES",
    "METROPOLITAN_TO_CANONICAL_PARENT",
    "MUNICIPALITIES_BY_KEY",
    "MUNICIPALITIES_BY_METRO_NAME",
    "POPULATION_POLICY_KO",
    "POST_2024_INCHEON_UNITS",
    "REASON_LABELS_KO",
    "REJECTED_FILE_RULES",
    "REVIEWED_FILE_MAPPINGS",
    "IndicatorOutcome",
    "MunicipalityDefinition",
    "RejectedFileRule",
    "ReviewedFileMapping",
    "describe_reasons",
    "evaluate_indicator",
    "find_rejection_rule",
    "find_reviewed_mapping",
    "match_municipality_name",
    "nfc",
    "order_reasons",
    "payment_per_capita",
    "REFERENCE_YEAR",
    "STATUS_AVAILABLE",
    "STATUS_PARTIAL",
    "STATUS_UNAVAILABLE",
]
