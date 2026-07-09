"""VWorld geocoder contract for facility geocoding (Phase 2.4).

Live-verified 2026-07-09 (see docs/API_CONTRACTS/vworld.md, "Geocoder"):
``/req/address`` with ``request=getcoord`` returns ``response.status`` in
{OK, NOT_FOUND, ERROR}; only OK carries ``result.point`` (x=longitude,
y=latitude, strings) in the requested CRS plus a refined address whose
``structure.level4AC`` legal-dong code prefix identifies the sido
(서울 11, 인천 28, 경기 41).

RCIS facility addresses mix three shapes (all live-verified):

- road addresses already carrying city/district ("고양시 일산동구 ...")
- parcel (지번) addresses ("... 남사읍 완장리 498-1,2")
- bare road addresses needing the RCIS sido/sigungu prefix ("고잔로 61")

The attempt ladder is deterministic: ROAD then PARCEL on the built address,
then ROAD/PARCEL on a simplified form (parentheticals and trailing comma
alternatives removed). Coordinates are never fabricated: an exhausted ladder
is a FAILED geocode and the caller must keep geometry NULL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .rcis_region_crosswalk import SIDO_ALIASES, normalize_name

VWORLD_SOURCE_ID = "vworld"
GEOCODER_URL = "https://api.vworld.kr/req/address"
GEOCODER_ENDPOINT_IDENTIFIER = "req/address/getcoord"
TRANSFORMATION_VERSION = "vworld-facility-geocode-v1"
TARGET_CRS = "EPSG:4326"

PROVIDER_OK = "OK"
PROVIDER_NOT_FOUND = "NOT_FOUND"

ROAD = "ROAD"
PARCEL = "PARCEL"

# Standard administrative-code sido prefixes (행정표준코드). These are NOT SGIS
# region codes; they cross-check the geocoder's level4AC legal-dong code.
SIDO_CODE_PREFIXES: dict[str, str] = {
    "서울특별시": "11",
    "인천광역시": "28",
    "경기도": "41",
}

_PARENTHETICAL = re.compile(r"\([^)]*\)")
_TRAILING_ALTERNATIVES = re.compile(r"(\d+(?:-\d+)?),[\d,\-]+\s*$")


@dataclass(frozen=True)
class GeocodeAttempt:
    address: str
    address_type: str  # ROAD | PARCEL


@dataclass(frozen=True)
class ParsedGeocode:
    provider_status: str
    x: str | None
    y: str | None
    refined_address: str | None
    level4ac: str | None
    crs: str | None
    error_detail: str | None


def canonical_sido(rcis_sido_name: str) -> str | None:
    return SIDO_ALIASES.get(normalize_name(rcis_sido_name))


def expected_sido_prefix(rcis_sido_name: str) -> str | None:
    canonical = canonical_sido(rcis_sido_name)
    if canonical is None:
        return None
    return SIDO_CODE_PREFIXES.get(canonical)


def level4ac_matches_sido(level4ac: str | None, rcis_sido_name: str) -> bool | None:
    """True/False when both sides are known; None when the code is absent."""
    if not level4ac:
        return None
    expected = expected_sido_prefix(rcis_sido_name)
    if expected is None:
        return None
    return level4ac.startswith(expected)


def build_request_address(rcis_sido_name: str, rcis_sigungu_name: str, address: str) -> str:
    """Prefix the RCIS address with sido/sigungu names unless already present.

    RCIS ``ADDR`` values range from fully qualified ("경기도 용인시 처인구 ...")
    to bare road addresses ("고잔로 61"). The query address must locate the
    facility inside the correct city, so missing context is prepended from the
    RCIS name pair; already-qualified addresses are used verbatim.
    """
    normalized = normalize_name(address)
    sido = normalize_name(rcis_sido_name)
    sigungu = normalize_name(rcis_sigungu_name)

    sido_forms = {alias for alias, target in SIDO_ALIASES.items() if target == canonical_sido(sido)}
    first_token = normalized.split(" ", 1)[0] if normalized else ""
    if first_token in sido_forms:
        return normalized
    if normalized.startswith(sigungu):
        return f"{sido} {normalized}"
    return f"{sido} {sigungu} {normalized}"


def simplify_address(address: str) -> str | None:
    """Remove parentheticals and trailing lot alternatives; None if unchanged.

    ``"수정구 탄천로 687(태평동)"`` -> ``"수정구 탄천로 687"``;
    ``"... 완장리 498-1,2"`` -> ``"... 완장리 498-1"``.
    """
    simplified = _PARENTHETICAL.sub(" ", address)
    simplified = _TRAILING_ALTERNATIVES.sub(r"\1", simplified)
    simplified = normalize_name(simplified)
    if simplified == normalize_name(address) or not simplified:
        return None
    return simplified


def build_attempts(request_address: str) -> list[GeocodeAttempt]:
    attempts = [
        GeocodeAttempt(address=request_address, address_type=ROAD),
        GeocodeAttempt(address=request_address, address_type=PARCEL),
    ]
    simplified = simplify_address(request_address)
    if simplified is not None:
        attempts.append(GeocodeAttempt(address=simplified, address_type=ROAD))
        attempts.append(GeocodeAttempt(address=simplified, address_type=PARCEL))
    return attempts


def build_geocoder_params(api_key: str, attempt: GeocodeAttempt) -> dict[str, str]:
    return {
        "service": "address",
        "request": "getcoord",
        "version": "2.0",
        "crs": TARGET_CRS.lower(),
        "address": attempt.address,
        "type": attempt.address_type,
        "refine": "true",
        "simple": "false",
        "format": "json",
        "key": api_key,
    }


def parse_geocoder_response(payload: dict[str, Any]) -> ParsedGeocode:
    response = payload.get("response")
    if not isinstance(response, dict):
        return ParsedGeocode(
            provider_status="MALFORMED",
            x=None,
            y=None,
            refined_address=None,
            level4ac=None,
            crs=None,
            error_detail="geocoder payload is missing the response object",
        )
    status = str(response.get("status", "MISSING"))
    if status != PROVIDER_OK:
        error = response.get("error")
        detail = None
        if isinstance(error, dict):
            detail = str(error.get("text") or error.get("code") or error)
        return ParsedGeocode(
            provider_status=status,
            x=None,
            y=None,
            refined_address=None,
            level4ac=None,
            crs=None,
            error_detail=detail,
        )

    result = response.get("result")
    point = result.get("point") if isinstance(result, dict) else None
    x = point.get("x") if isinstance(point, dict) else None
    y = point.get("y") if isinstance(point, dict) else None
    if not x or not y:
        return ParsedGeocode(
            provider_status=status,
            x=None,
            y=None,
            refined_address=None,
            level4ac=None,
            crs=None,
            error_detail="geocoder returned OK without a coordinate point",
        )

    refined = response.get("refined")
    refined_text = refined.get("text") if isinstance(refined, dict) else None
    structure = refined.get("structure") if isinstance(refined, dict) else None
    level4ac = structure.get("level4AC") if isinstance(structure, dict) else None
    crs = result.get("crs") if isinstance(result, dict) else None
    return ParsedGeocode(
        provider_status=status,
        x=str(x),
        y=str(y),
        refined_address=str(refined_text) if refined_text else None,
        level4ac=str(level4ac) if level4ac else None,
        crs=str(crs) if crs else None,
        error_detail=None,
    )
