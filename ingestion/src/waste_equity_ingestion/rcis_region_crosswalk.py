"""Deterministic RCIS region-name to SGIS canonical-region crosswalk.

RCIS regional waste responses identify regions by Korean names only
(``CITY_JIDT_CD_NM`` sido, ``CTS_JIDT_CD_NM`` sigungu); no numeric code is
provided. This module maps those name pairs to the SGIS 2024 canonical regions
loaded in Phase 2.1, using exact deterministic rules only. There is no fuzzy
matching. Ambiguous, unmatched, and city-versus-city-district cases are reported
and excluded from canonical writes rather than guessed.

Known structural mismatch (Phase 0.7 / REGION_CODE_STRATEGY): SGIS represents
seven large Gyeonggi cities at the administrative-district (구) level
(고양·부천·성남·수원·안산·안양·용인 → 20 child regions), while RCIS reports
these at the city level. A city-level RCIS record is at a coarser reporting
geography than SGIS, so it is classified ``COARSER_REPORTING_GEOGRAPHY`` (it has
no single native SGIS region to attach to). The RCIS city value itself is never
split across districts; it is served through the explicit reporting geography
(see ``docs/RCIS_REPORTING_GEOGRAPHY_AUDIT.md``).
"""

from __future__ import annotations

import datetime
import re
from collections import defaultdict
from dataclasses import dataclass

# Match status values.
EXACT_MATCH = "EXACT_MATCH"
OUT_OF_SCOPE = "OUT_OF_SCOPE"
# RCIS reports the region at a coarser geography than SGIS (city vs 구 districts).
# No aggregation of the RCIS value happens: the city total is served verbatim
# through the reporting geography; only the display geometry and the per-capita
# denominator are derived.
COARSER_REPORTING_GEOGRAPHY = "COARSER_REPORTING_GEOGRAPHY"
AMBIGUOUS = "AMBIGUOUS"
UNMATCHED = "UNMATCHED"

# Canonical SGIS sido names keyed by every accepted RCIS spelling. Normalization
# is for candidate matching only; the original RCIS name is always preserved.
SIDO_ALIASES: dict[str, str] = {
    "서울": "서울특별시",
    "서울시": "서울특별시",
    "서울특별시": "서울특별시",
    "인천": "인천광역시",
    "인천시": "인천광역시",
    "인천광역시": "인천광역시",
    "경기": "경기도",
    "경기도": "경기도",
}

CAPITAL_REGION_SIDO_NAMES = ("서울특별시", "인천광역시", "경기도")


@dataclass(frozen=True)
class SgisRegion:
    region_id: int
    region_code: str
    region_name: str
    region_level: str
    valid_from: datetime.date
    parent_region_code: str | None


@dataclass(frozen=True)
class MappingResolution:
    status: str
    rcis_sido_name: str
    rcis_sigungu_name: str
    region: SgisRegion | None
    detail: str


def normalize_name(value: str) -> str:
    """Collapse whitespace for candidate matching; never mutates stored names."""
    return re.sub(r"\s+", " ", value.strip())


def _local_name(region_name: str, sido_name: str) -> str:
    """Return the SGIS region name with its sido prefix removed.

    ``"서울특별시 종로구"`` -> ``"종로구"``;
    ``"경기도 수원시 권선구"`` -> ``"수원시 권선구"``.
    """
    normalized = normalize_name(region_name)
    prefix = f"{sido_name} "
    if normalized.startswith(prefix):
        return normalized[len(prefix) :].strip()
    return normalized


class RegionCrosswalk:
    """Deterministic resolver built from the SGIS canonical SIGUNGU regions."""

    def __init__(self, regions: list[SgisRegion]) -> None:
        self._by_full: dict[tuple[str, str], list[SgisRegion]] = defaultdict(list)
        self._by_bare_district: dict[tuple[str, str], list[SgisRegion]] = defaultdict(list)
        self._multi_district_cities: dict[str, set[str]] = defaultdict(set)

        sido_name_by_code = {
            region.region_code: region.region_name
            for region in regions
            if region.region_level == "SIDO"
        }
        districts_per_city: dict[tuple[str, str], int] = defaultdict(int)

        sigungu = [region for region in regions if region.region_level == "SIGUNGU"]
        for region in sigungu:
            sido_name = sido_name_by_code.get(region.parent_region_code or "", "")
            canonical_sido = SIDO_ALIASES.get(normalize_name(sido_name), normalize_name(sido_name))
            local = _local_name(region.region_name, sido_name)
            self._by_full[(canonical_sido, local)].append(region)
            tokens = local.split(" ")
            if len(tokens) == 2:
                city, district = tokens
                districts_per_city[(canonical_sido, city)] += 1
                self._by_bare_district[(canonical_sido, district)].append(region)

        for (canonical_sido, city), count in districts_per_city.items():
            if count >= 1:
                # Any city SGIS splits into 구 records is a city-vs-district
                # mismatch when RCIS reports the city as a single record.
                self._multi_district_cities[canonical_sido].add(city)

    def resolve(self, rcis_sido: str, rcis_sigungu: str) -> MappingResolution:
        sido_key = normalize_name(rcis_sido)
        sigungu_key = normalize_name(rcis_sigungu)
        canonical_sido = SIDO_ALIASES.get(sido_key)
        if canonical_sido is None:
            return MappingResolution(
                status=OUT_OF_SCOPE,
                rcis_sido_name=rcis_sido,
                rcis_sigungu_name=rcis_sigungu,
                region=None,
                detail=f"sido {rcis_sido!r} is outside the capital-region scope",
            )

        # City-level RCIS record for a city SGIS splits into districts.
        if sigungu_key in self._multi_district_cities.get(canonical_sido, set()):
            return MappingResolution(
                status=COARSER_REPORTING_GEOGRAPHY,
                rcis_sido_name=rcis_sido,
                rcis_sigungu_name=rcis_sigungu,
                region=None,
                detail=(
                    f"{canonical_sido} {sigungu_key}: RCIS reports the city while SGIS represents "
                    "it as administrative districts; served via the reporting geography"
                ),
            )

        full = self._by_full.get((canonical_sido, sigungu_key), [])
        if len(full) == 1:
            return self._match(rcis_sido, rcis_sigungu, full[0])
        if len(full) > 1:
            return self._ambiguous(rcis_sido, rcis_sigungu, full)

        bare = self._by_bare_district.get((canonical_sido, sigungu_key), [])
        if len(bare) == 1:
            return self._match(rcis_sido, rcis_sigungu, bare[0])
        if len(bare) > 1:
            return self._ambiguous(rcis_sido, rcis_sigungu, bare)

        return MappingResolution(
            status=UNMATCHED,
            rcis_sido_name=rcis_sido,
            rcis_sigungu_name=rcis_sigungu,
            region=None,
            detail=f"no SGIS canonical region matches {canonical_sido} {sigungu_key!r}",
        )

    @staticmethod
    def _match(rcis_sido: str, rcis_sigungu: str, region: SgisRegion) -> MappingResolution:
        return MappingResolution(
            status=EXACT_MATCH,
            rcis_sido_name=rcis_sido,
            rcis_sigungu_name=rcis_sigungu,
            region=region,
            detail=f"exact name match to {region.region_code} ({region.region_name})",
        )

    @staticmethod
    def _ambiguous(
        rcis_sido: str, rcis_sigungu: str, candidates: list[SgisRegion]
    ) -> MappingResolution:
        codes = ", ".join(sorted(region.region_code for region in candidates))
        return MappingResolution(
            status=AMBIGUOUS,
            rcis_sido_name=rcis_sido,
            rcis_sigungu_name=rcis_sigungu,
            region=None,
            detail=f"ambiguous match to multiple SGIS regions: {codes}",
        )
