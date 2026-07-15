"""Official MOIS resident-registration population — source contract and parser.

Source: **행정안전부 주민등록 인구통계** (Ministry of the Interior and Safety),
dataset **행정동별 주민등록 인구 및 세대현황**, https://jumin.mois.go.kr/statMonth.do

Acquisition (adapter boundary)
------------------------------
MOIS publishes no documented OpenAPI for this dataset. The two data.go.kr
OpenAPIs linked from the MOIS site are *different* datasets — ``15108092`` is
도로명별 (road-name based) and ``15108093`` is 지역별 인구이동 현황 (migration) —
neither is the 행정동별 monthly series with history back to 2008. The remaining
official route is the site's own **CSV download endpoint**, which is what the
[CSV 다운로드] button on the official page submits:

    POST https://jumin.mois.go.kr/downloadCsv.do?searchYearMonth=month&xlsStats=1

Discovered and validated on 2026-07-15 by reading the official page's own
``#formXlsDown`` form (its hidden inputs are mirrored verbatim in
``download_form_fields``) — not by scraping rendered numbers, a screenshot, a
search snippet, or any mirror. Because the endpoint is official but
*undocumented*, every request and response is validated here before any value is
trusted: the response must be a CSV whose header carries the expected Korean
month columns, and the three required 시도 rows must appear with their exact
official codes and names.

Population definition
---------------------
``sltUndefType=`` (전체) selects the **total** resident-registration population:

    전체 = 거주자 + 거주불명자 + 재외국민          (외국인은 제외)

Verified arithmetically against the official source on 2026-07-15 for 서울 at
2026-06: 거주자 9,224,532 + 거주불명자 32,865 + 재외국민 32,416 = 9,289,813,
which equals the 전체 value this module ingests.

The series is monthly and each value is the population **at the end of** that
calendar month.

Definition eras (empirically confirmed, not assumed)
---------------------------------------------------
The meaning of the 전체 total changed twice inside the 2008–2026 window. Both
boundaries were confirmed against the official source rather than taken on
faith (서울 probes, 2026-07-15):

* ``거주자`` breakdown is 0 at 2010-09 and 10,160,549 at 2010-10, and the 전체
  total jumps 10,186,556 → 10,328,915 (+142,359) across that same boundary — a
  definitional discontinuity, not migration. → 거주불명자 included from
  **2010-10**.
* ``재외국민`` is 0 at 2014-12 and 750 at 2015-01 (5,116 by 2015-06). → 재외국민
  included from **2015-01**.

These are a comparability limitation carried with the data, never a reason to
discard official values.

Licensing
---------
The official pages publish no 공공누리 badge for this download; the footer states
``ⓒ Ministry of the Interior and Safety`` with 담당부서 주민과 (044-205-3158).
Terms for redistribution are therefore not asserted here — only that these are
official MOIS statistics retrieved from the official site.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date

SOURCE_ID = "mois_resident_population"
SOURCE_NAME = "행정안전부 주민등록 인구통계"
OFFICIAL_DATASET_NAME = "행정동별 주민등록 인구 및 세대현황"
DOCUMENTATION_URL = "https://jumin.mois.go.kr/statMonth.do"
DOWNLOAD_URL = "https://jumin.mois.go.kr/downloadCsv.do"
PUBLICATION_FREQUENCY = "MONTHLY"

POPULATION_DEFINITION = "MOIS_RESIDENT_REGISTRATION_TOTAL"
POPULATION_TEMPORAL_GRANULARITY = "MONTHLY"
POPULATION_UNIT = "persons"
SOURCE_GEOGRAPHIC_LEVEL = "SIDO"
TRANSFORMATION_VERSION = "mois-resident-population-v1"

# The official CSV is EUC-KR/CP949 encoded (verified against the live download).
SOURCE_ENCODING = "cp949"

# The earliest month this project is authorized to ingest, and the earliest the
# official site offers for this dataset (year select: 2008 … 2026).
EARLIEST_SUPPORTED_MONTH = "2008-01"


class MoisContractError(ValueError):
    """The response or file is not the official MOIS dataset we contracted for."""


@dataclass(frozen=True)
class MoisRegion:
    """One 시도 this project ingests, with its official MOIS code and name."""

    mois_code: str
    official_name: str
    canonical_region_code: str  # canonical SGIS region row
    landfill_origin_code: str  # landfill_inbound_monthly.origin_region_code


# Reviewed crosswalk. Three separate code systems meet here and are NEVER joined
# on numeric resemblance:
#   * MOIS 10-digit 행정구역 code (from the official CSV's 행정구역 field);
#   * canonical SGIS region rows, which use SGIS's own sido codes (11/23/31);
#   * landfill origin codes, which use standard administrative codes (11/28/41).
# Incheon is 28 in MOIS and in the landfill table, but 23 in the canonical SGIS
# regions; Gyeonggi is 41 and 41 but 31. Only Seoul is 11 everywhere. Every
# mapping is verified against the official region name before use.
CAPITAL_REGION: tuple[MoisRegion, ...] = (
    MoisRegion("1100000000", "서울특별시", "KR-SGIS-11", "KR-SGIS-11"),
    MoisRegion("2800000000", "인천광역시", "KR-SGIS-23", "KR-SGIS-28"),
    MoisRegion("4100000000", "경기도", "KR-SGIS-31", "KR-SGIS-41"),
)
REGIONS_BY_CODE: dict[str, MoisRegion] = {r.mois_code: r for r in CAPITAL_REGION}

# --------------------------------------------------------------------------- #
# Definition eras (see the module docstring for the confirming evidence)
# --------------------------------------------------------------------------- #

DEFINITION_VERSION_PRE_2010_10 = "MOIS_TOTAL_PRE_UNREGISTERED_RESIDENT"
DEFINITION_VERSION_2010_10 = "MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT"
DEFINITION_VERSION_2015_01 = "MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS"

_NOTE_PRE_2010_10 = (
    "2008-01~2010-09: 거주불명자가 포함되기 이전의 주민등록 총인구입니다. "
    "2010-10부터의 값과 직접 비교할 수 없습니다. (외국인 제외)"
)
_NOTE_2010_10 = (
    "2010-10~2014-12: 거주불명자가 포함된 주민등록 총인구입니다. "
    "2010-09 이전 및 2015-01 이후의 값과 직접 비교할 수 없습니다. (외국인 제외)"
)
_NOTE_2015_01 = (
    "2015-01 이후: 거주불명자와 재외국민이 포함된 주민등록 총인구입니다. "
    "2014-12 이전의 값과 직접 비교할 수 없습니다. (외국인 제외)"
)


def definition_version(reference_month: str) -> str:
    """The definition version in force for a ``YYYY-MM`` month."""
    if reference_month >= "2015-01":
        return DEFINITION_VERSION_2015_01
    if reference_month >= "2010-10":
        return DEFINITION_VERSION_2010_10
    return DEFINITION_VERSION_PRE_2010_10


def comparability_note(reference_month: str) -> str:
    """The served comparability caveat for a ``YYYY-MM`` month."""
    version = definition_version(reference_month)
    if version == DEFINITION_VERSION_2015_01:
        return _NOTE_2015_01
    if version == DEFINITION_VERSION_2010_10:
        return _NOTE_2010_10
    return _NOTE_PRE_2010_10


# --------------------------------------------------------------------------- #
# Request contract
# --------------------------------------------------------------------------- #


def download_form_fields(start_month: str, end_month: str) -> dict[str, str]:
    """The official ``#formXlsDown`` POST body for a ``YYYY-MM`` range.

    Mirrors the official page's own hidden inputs verbatim. ``sltUndefType=""``
    is 전체 (거주자 + 거주불명자 + 재외국민); ``sltOrgType=1`` / ``sltOrgLvl1=A``
    request every 시도.
    """
    validate_month(start_month)
    validate_month(end_month)
    if start_month > end_month:
        raise MoisContractError(f"start_month {start_month} is after end_month {end_month}.")
    return {
        "sltOrgType": "1",
        "sltOrgLvl1": "A",
        "sltOrgLvl2": "",
        "gender": "gender",
        "genderPer": "genderPer",
        "generation": "generation",
        "sltUndefType": "",  # 전체
        "searchYearStart": start_month[:4],
        "searchMonthStart": start_month[5:7],
        "searchYearEnd": end_month[:4],
        "searchMonthEnd": end_month[5:7],
        "sltOrderType": "1",
        "sltOrderValue": "ASC",
        "category": "month",
    }


DOWNLOAD_QUERY: dict[str, str] = {"searchYearMonth": "month", "xlsStats": "1"}

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_month(month: str) -> None:
    if not _MONTH_RE.match(month):
        raise MoisContractError(f"Month {month!r} is not a valid YYYY-MM value.")


def month_range(start_month: str, end_month: str) -> list[str]:
    """Every ``YYYY-MM`` from start to end inclusive."""
    validate_month(start_month)
    validate_month(end_month)
    months: list[str] = []
    year, month = int(start_month[:4]), int(start_month[5:7])
    while f"{year:04d}-{month:02d}" <= end_month:
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return months


def sha256_of(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


# --------------------------------------------------------------------------- #
# Response / file parsing
# --------------------------------------------------------------------------- #

# "서울특별시  (1100000000)" -> name, code
_REGION_FIELD_RE = re.compile(r"^(?P<name>.+?)\s*\((?P<code>\d{10})\)$")
# "2026년06월_총인구수" -> year, month
_TOTAL_COLUMN_RE = re.compile(r"^(?P<year>\d{4})년(?P<month>\d{2})월_총인구수$")


@dataclass(frozen=True)
class MoisObservation:
    """One validated official population value for one region in one month."""

    reference_month: str  # YYYY-MM
    mois_code: str
    official_name: str
    canonical_region_code: str
    landfill_origin_code: str
    population: int
    population_definition_version: str
    population_comparability_note: str


@dataclass(frozen=True)
class MoisParseResult:
    observations: list[MoisObservation]
    months_present: list[str]
    rejected: list[str]
    source_sha256: str


def _parse_population(raw: str) -> int:
    """A comma-grouped official integer. Never coerced from a float or blank."""
    text = raw.strip().strip('"').replace(",", "")
    if not text or not re.fullmatch(r"\d+", text):
        raise MoisContractError(f"Population value {raw!r} is not a plain integer.")
    return int(text)


def parse_csv(payload: bytes, *, encoding: str = SOURCE_ENCODING) -> MoisParseResult:
    """Parse the official wide CSV into validated per-region monthly observations.

    The official CSV is *wide*: one row per 행정구역 and a six-column block per
    month (``총인구수``/``세대수``/``세대당 인구``/``남자 인구수``/``여자 인구수``/
    ``남여 비율``). Only ``총인구수`` is read.

    Fails closed. In particular the official endpoint answers a request for a
    month it has not published with a well-formed CSV of **zeros** rather than an
    error, so a zero total is treated as "not published" and rejected — never
    stored as a population of 0.
    """
    try:
        text = payload.decode(encoding)
    except UnicodeDecodeError as exc:  # pragma: no cover - defensive
        raise MoisContractError(f"Response is not {encoding}-decodable official MOIS CSV.") from exc

    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise MoisContractError("Official MOIS CSV is empty.")
    header = [c.strip() for c in rows[0]]
    if not header or header[0] != "행정구역":
        raise MoisContractError(
            f"Unexpected header: first column is {header[:1]!r}, expected '행정구역'. "
            "The response is not the official 행정동별 주민등록 인구 및 세대현황 CSV."
        )

    # Column index -> YYYY-MM, taken only from the 총인구수 columns.
    total_columns: dict[int, str] = {}
    for index, column in enumerate(header):
        match = _TOTAL_COLUMN_RE.match(column)
        if match:
            total_columns[index] = f"{match['year']}-{match['month']}"
    if not total_columns:
        raise MoisContractError(
            "No '<YYYY>년<MM>월_총인구수' columns in the response header; "
            "the official CSV contract has changed."
        )

    observations: list[MoisObservation] = []
    rejected: list[str] = []
    seen: set[tuple[str, str]] = set()

    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        field = row[0].strip()
        match = _REGION_FIELD_RE.match(field)
        if not match:
            rejected.append(f"UNPARSEABLE_REGION_FIELD:{field}")
            continue
        code = match["code"]
        name = match["name"].strip()
        region = REGIONS_BY_CODE.get(code)
        if region is None:
            # 전국 and the other 시도 are official but out of this project's scope.
            continue
        if name != region.official_name:
            rejected.append(
                f"REGION_NAME_MISMATCH:{code}:expected={region.official_name}:actual={name}"
            )
            continue
        for index, month in total_columns.items():
            if index >= len(row):
                rejected.append(f"MISSING_COLUMN:{code}:{month}")
                continue
            try:
                population = _parse_population(row[index])
            except MoisContractError as exc:
                rejected.append(f"INVALID_POPULATION:{code}:{month}:{exc}")
                continue
            if population <= 0:
                # The official endpoint returns zeros for months it has not
                # published. A zero 시도 population is never a real observation.
                rejected.append(f"NON_POSITIVE_POPULATION:{code}:{month}:{population}")
                continue
            key = (code, month)
            if key in seen:
                rejected.append(f"DUPLICATE_REGION_MONTH:{code}:{month}")
                continue
            seen.add(key)
            observations.append(
                MoisObservation(
                    reference_month=month,
                    mois_code=code,
                    official_name=name,
                    canonical_region_code=region.canonical_region_code,
                    landfill_origin_code=region.landfill_origin_code,
                    population=population,
                    population_definition_version=definition_version(month),
                    population_comparability_note=comparability_note(month),
                )
            )

    return MoisParseResult(
        observations=observations,
        months_present=sorted({o.reference_month for o in observations}),
        rejected=rejected,
        source_sha256=sha256_of(payload),
    )


def complete_months(result: MoisParseResult) -> list[str]:
    """Months carrying all three required 시도 — the only ingestible months."""
    required = {r.mois_code for r in CAPITAL_REGION}
    by_month: dict[str, set[str]] = {}
    for observation in result.observations:
        by_month.setdefault(observation.reference_month, set()).add(observation.mois_code)
    return sorted(month for month, codes in by_month.items() if codes >= required)


def incomplete_months(result: MoisParseResult) -> dict[str, list[str]]:
    """Months missing one or more required 시도, with the missing official names."""
    required = {r.mois_code for r in CAPITAL_REGION}
    by_month: dict[str, set[str]] = {}
    for observation in result.observations:
        by_month.setdefault(observation.reference_month, set()).add(observation.mois_code)
    missing: dict[str, list[str]] = {}
    for month, codes in by_month.items():
        absent = required - codes
        if absent:
            missing[month] = sorted(REGIONS_BY_CODE[c].official_name for c in absent)
    return missing


def latest_month_from_page(html: str) -> str | None:
    """The latest published month, read from the official page's own default.

    The official page pre-selects its most recent published month in
    ``searchMonthEnd``/``searchYearEnd``. That is the site's own statement of
    coverage, so it is preferred over guessing — and the ingestion still refuses
    any month whose values come back non-positive.
    """
    year = _selected_option(html, "searchYearEnd")
    month = _selected_option(html, "searchMonthEnd")
    if not year or not month:
        return None
    candidate = f"{year}-{month}"
    try:
        validate_month(candidate)
    except MoisContractError:
        return None
    return candidate


def _selected_option(html: str, select_name: str) -> str | None:
    block = re.search(rf'<select[^>]*name="{select_name}"[^>]*>(.*?)</select>', html, re.S)
    if not block:
        return None
    option = re.search(r'<option[^>]*value="([^"]*)"[^>]*selected', block.group(1))
    return option.group(1) if option else None


def month_end_date(reference_month: str) -> date:
    """The month-end date the value represents (MOIS publishes month-end)."""
    validate_month(reference_month)
    year, month = int(reference_month[:4]), int(reference_month[5:7])
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1).fromordinal(date(year, month + 1, 1).toordinal() - 1)


__all__ = [
    "CAPITAL_REGION",
    "DEFINITION_VERSION_2010_10",
    "DEFINITION_VERSION_2015_01",
    "DEFINITION_VERSION_PRE_2010_10",
    "DOCUMENTATION_URL",
    "DOWNLOAD_QUERY",
    "DOWNLOAD_URL",
    "EARLIEST_SUPPORTED_MONTH",
    "OFFICIAL_DATASET_NAME",
    "POPULATION_DEFINITION",
    "POPULATION_TEMPORAL_GRANULARITY",
    "POPULATION_UNIT",
    "PUBLICATION_FREQUENCY",
    "REGIONS_BY_CODE",
    "SOURCE_ENCODING",
    "SOURCE_GEOGRAPHIC_LEVEL",
    "SOURCE_ID",
    "SOURCE_NAME",
    "TRANSFORMATION_VERSION",
    "MoisContractError",
    "MoisObservation",
    "MoisParseResult",
    "MoisRegion",
    "comparability_note",
    "complete_months",
    "definition_version",
    "download_form_fields",
    "incomplete_months",
    "latest_month_from_page",
    "month_end_date",
    "month_range",
    "parse_csv",
    "sha256_of",
    "validate_month",
]
