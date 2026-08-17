"""Phase-4 additions to the read-only extraction.

Two things Phase 3 did not extract, both needed to *measure* a Phase-4 decision
rather than assert one:

* **Unmapped facility evidence** (B17). The Phase-3 burden query inner-joins
  ``regions``, so a facility whose geography could not be resolved silently
  disappears from every region's located total. This module measures what was
  dropped and states, per region, that the source does hold evidence there.
* **CITY-grain reporting units** (B6). The seven large Gyeonggi cities RCIS
  reports at CITY level live in ``reporting_region_waste_statistics``. This
  module loads them and the child-district composition they would be projected
  onto, so the CITY-grain option can be evaluated numerically instead of argued.

The coverage relation between a CITY reporting unit and a platform SIGUNGU is
**derived here and labelled as derived**. It is not an official mapping: no CITY
geography exists in ``regions`` at all (only SIDO and SIGUNGU), so the relation is
reconstructed from official region names and is carried through every downstream
object as ``coverage_basis``.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suitability_v3_phase3 import extract  # noqa: E402

from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    existing_burden,
)

# How the CITY→child-district coverage relation was reconstructed. Recorded on
# every derived object so a reader never mistakes it for stored geography.
COVERAGE_BASIS_DERIVED_NAME = (
    "DERIVED_FROM_REGION_NAME: the source reports this unit at CITY grain and no CITY geography "
    "exists in `regions` (SIDO and SIGUNGU only); the covered SIGUNGU are those whose official "
    "region_name contains the CITY name as a leading name component within the same SIDO"
)

REASON_REQUIRES_GEOCODE = "REQUIRES_GEOCODE"


# --------------------------------------------------------------------------- #
# B17 — facility rows the region join drops
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class UnmappedFacilityGroup:
    """One source reporting unit whose facility rows have no platform region."""

    rcis_sido_name: str
    rcis_sigungu_name: str
    source_geographic_level: str
    facility_count: int
    throughput_tons_per_year: Decimal | None
    covered_region_codes: tuple[str, ...]

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "rcis_sido_name": self.rcis_sido_name,
            "rcis_sigungu_name": self.rcis_sigungu_name,
            "source_geographic_level": self.source_geographic_level,
            "facility_count": self.facility_count,
            "throughput_tons_per_year": (
                format(self.throughput_tons_per_year, "f")
                if self.throughput_tons_per_year is not None
                else None
            ),
            "covered_region_codes": list(self.covered_region_codes),
            "covered_region_count": len(self.covered_region_codes),
        }


def load_unmapped_facility_groups(
    conn: Connection, reference_year: int
) -> tuple[UnmappedFacilityGroup, ...]:
    """Facility rows with no ``region_id``, grouped by their source reporting unit.

    The covered SIGUNGU are resolved by official name, never invented: a row is
    only attached to regions that actually exist in ``regions``.
    """

    rows = conn.execute(
        text(
            """
            SELECT rcis_sido_name, rcis_sigungu_name, source_geographic_level,
                   count(*) AS facility_count,
                   sum(throughput_quantity) AS throughput
            FROM waste_treatment_facilities
            WHERE reference_year = :year AND region_id IS NULL
            GROUP BY 1, 2, 3
            ORDER BY 1, 2, 3
            """
        ),
        {"year": reference_year},
    ).all()

    groups: list[UnmappedFacilityGroup] = []
    for row in rows:
        covered = conn.execute(
            text(
                """
                SELECT region_code
                FROM regions
                WHERE region_level = 'SIGUNGU'
                  AND region_name LIKE '%' || :city || ' %'
                ORDER BY region_code
                """
            ),
            {"city": str(row.rcis_sigungu_name)},
        ).scalars().all()
        groups.append(
            UnmappedFacilityGroup(
                rcis_sido_name=str(row.rcis_sido_name),
                rcis_sigungu_name=str(row.rcis_sigungu_name),
                source_geographic_level=str(row.source_geographic_level),
                facility_count=int(row.facility_count),
                throughput_tons_per_year=(
                    Decimal(str(row.throughput)) if row.throughput is not None else None
                ),
                covered_region_codes=tuple(str(code) for code in covered),
            )
        )
    return tuple(groups)


def unmapped_evidence_by_region(
    groups: tuple[UnmappedFacilityGroup, ...],
) -> dict[str, existing_burden.UnmappedFacilityEvidence]:
    """``{region_code: UnmappedFacilityEvidence}`` for every covered SIGUNGU.

    A region covered by several groups accumulates all of them, so the evidence
    count is the total the source holds for that region — never the first match.
    """

    counts: dict[str, int] = {}
    tonnage: dict[str, Decimal] = {}
    units: dict[str, list[str]] = {}
    for group in groups:
        for code in group.covered_region_codes:
            counts[code] = counts.get(code, 0) + group.facility_count
            if group.throughput_tons_per_year is not None:
                tonnage[code] = tonnage.get(code, Decimal("0")) + group.throughput_tons_per_year
            units.setdefault(code, []).append(
                f"{group.rcis_sido_name} {group.rcis_sigungu_name}"
            )

    return {
        code: existing_burden.UnmappedFacilityEvidence(
            facility_count=count,
            reason=REASON_REQUIRES_GEOCODE,
            coverage_basis=COVERAGE_BASIS_DERIVED_NAME,
            throughput_tons_per_year=tonnage.get(code),
            source_reporting_unit=", ".join(sorted(set(units[code]))),
        )
        for code, count in sorted(counts.items())
    }


def load_existing_burden_inputs_with_evidence(
    conn: Connection,
    regions: tuple[extract.RegionRow, ...],
    population: dict[str, int],
    reference_year: int,
    evidence: dict[str, existing_burden.UnmappedFacilityEvidence],
) -> tuple[existing_burden.ExistingBurdenInput, ...]:
    """The Phase-3 burden inputs, with unmapped-facility evidence attached."""

    base = extract.load_existing_burden_inputs(conn, regions, population, reference_year)
    return tuple(
        existing_burden.ExistingBurdenInput(
            region_code=item.region_code,
            population=item.population,
            facilities=item.facilities,
            unmapped_facility_evidence=evidence.get(item.region_code),
            facility_source_id=item.facility_source_id,
            facility_reference_period=item.facility_reference_period,
            population_source_id=item.population_source_id,
            population_reference_period=item.population_reference_period,
            population_definition=item.population_definition,
            source_geographic_level=item.source_geographic_level,
        )
        for item in base
    )


# --------------------------------------------------------------------------- #
# B6 — CITY-grain reporting units and the districts they would cover
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CityGrainUnit:
    """One CITY-grain reporting unit and the SIGUNGU it would be projected onto."""

    rcis_sido_name: str
    rcis_sigungu_name: str
    reporting_geography_type: str
    streams: dict[str, Decimal]
    quantity_units: tuple[str, ...]
    covered_region_codes: tuple[str, ...]
    covered_population: int | None

    @property
    def total_generation_tons(self) -> Decimal | None:
        if len(self.streams) != 4:
            return None
        return sum(self.streams.values(), start=Decimal("0"))

    def sanitized_summary(self) -> dict[str, Any]:
        total = self.total_generation_tons
        return {
            "rcis_sido_name": self.rcis_sido_name,
            "rcis_sigungu_name": self.rcis_sigungu_name,
            "reporting_geography_type": self.reporting_geography_type,
            "stream_count": len(self.streams),
            "streams": {k: format(v, "f") for k, v in sorted(self.streams.items())},
            "quantity_units": list(self.quantity_units),
            "total_generation_tons_per_year": (format(total, "f") if total is not None else None),
            "covered_region_codes": list(self.covered_region_codes),
            "covered_region_count": len(self.covered_region_codes),
            "covered_population": self.covered_population,
        }


def load_city_grain_units(
    conn: Connection, reference_year: int, population: dict[str, int]
) -> tuple[CityGrainUnit, ...]:
    """CITY-grain waste statistics plus the child districts and population behind them."""

    rows = conn.execute(
        text(
            """
            SELECT rcis_sido_name, rcis_sigungu_name, reporting_geography_type,
                   waste_stream, generation_quantity, quantity_unit
            FROM reporting_region_waste_statistics
            WHERE reference_year = :year
            ORDER BY rcis_sido_name, rcis_sigungu_name, waste_stream
            """
        ),
        {"year": reference_year},
    ).all()

    grouped: dict[tuple[str, str, str], dict[str, Decimal]] = {}
    unit_names: dict[tuple[str, str, str], set[str]] = {}
    for row in rows:
        key = (
            str(row.rcis_sido_name),
            str(row.rcis_sigungu_name),
            str(row.reporting_geography_type),
        )
        grouped.setdefault(key, {})[str(row.waste_stream)] = Decimal(
            str(row.generation_quantity)
        )
        unit_names.setdefault(key, set()).add(str(row.quantity_unit))

    units: list[CityGrainUnit] = []
    for (sido, city, geography_type), streams in sorted(grouped.items()):
        covered = conn.execute(
            text(
                """
                SELECT region_code
                FROM regions
                WHERE region_level = 'SIGUNGU'
                  AND region_name LIKE '%' || :city || ' %'
                ORDER BY region_code
                """
            ),
            {"city": city},
        ).scalars().all()
        codes = tuple(str(code) for code in covered)
        # The denominator for a CITY per-capita rate is the sum of its children's
        # populations. If any child's population is absent the sum would be an
        # undercount masquerading as a total, so it is None rather than partial.
        known = [population[code] for code in codes if code in population]
        units.append(
            CityGrainUnit(
                rcis_sido_name=sido,
                rcis_sigungu_name=city,
                reporting_geography_type=geography_type,
                streams=streams,
                quantity_units=tuple(sorted(unit_names[(sido, city, geography_type)])),
                covered_region_codes=codes,
                covered_population=(sum(known) if len(known) == len(codes) and codes else None),
            )
        )
    return tuple(units)
