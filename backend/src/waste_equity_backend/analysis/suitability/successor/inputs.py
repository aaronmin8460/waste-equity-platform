"""Production input loading for the successor components.

The Phase-3/Phase-4 research packages proved these queries against the real
capital-region dataset; this module is their production counterpart. Two
deliberate differences:

* **One floor, not four.** Research recomputed ``resident_impact`` at 500 m, 1 km,
  2 km and 5 km to compare them. Exactly one floor is approved, so production
  computes exactly that one — a quarter of the work on the most expensive query in
  the model.
* **The corrected loaders only.** ``existing_burden`` always carries the B17
  unmapped-facility evidence, because a region whose facility rows the source
  cannot attribute is *unavailable*, never a zero burden. There is no uncorrected
  path to reach by accident.

Nothing here classifies, scores, or decides anything: every value is read from
storage and handed to the component modules verbatim.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...facility_burden import FacilityThroughput
from . import air_impact_proxy, existing_burden, land_conversion, resident_impact

# The population series the successor components are defined against. Recorded as
# constants so a stored provenance record names the series rather than implying it.
POPULATION_SERIES_DEFINITION = "SGIS_TOTAL_POPULATION"
POPULATION_REFERENCE_YEAR = 2024

# B17: a facility row the source holds for a region but cannot attribute to it.
REASON_REQUIRES_GEOCODE = "REQUIRES_GEOCODE"
COVERAGE_BASIS_DERIVED_NAME = (
    "Region coverage derived by official SIGUNGU name match against the source reporting unit; "
    "no facility is attributed to a region the source does not name."
)


@dataclass(frozen=True)
class RegionRow:
    region_code: str
    region_name: str


@dataclass(frozen=True)
class CandidateRow:
    """One candidate of the source run, with the screening status it already has."""

    candidate_key: str
    sigungu_region_code: str | None
    status: str


def load_sigungu_regions(session: Session) -> tuple[RegionRow, ...]:
    rows = session.execute(
        text(
            "SELECT region_code, region_name FROM regions "
            "WHERE region_level = 'SIGUNGU' ORDER BY region_code"
        )
    ).all()
    return tuple(RegionRow(str(r.region_code), str(r.region_name)) for r in rows)


def load_population(session: Session) -> dict[str, int]:
    rows = session.execute(
        text(
            """
            SELECT r.region_code, p.population
            FROM regions r
            JOIN regional_population p
              ON p.region_id = r.id
             AND p.reference_year = :year
             AND p.reference_month IS NULL
            WHERE r.region_level = 'SIGUNGU'
            """
        ),
        {"year": POPULATION_REFERENCE_YEAR},
    ).all()
    return {str(r.region_code): int(r.population) for r in rows if r.population is not None}


def load_candidates(session: Session, run_id: int) -> tuple[CandidateRow, ...]:
    rows = session.execute(
        text(
            "SELECT candidate_key, sigungu_region_code, status FROM suitability_candidates "
            "WHERE analysis_run_id = :run_id ORDER BY candidate_key"
        ),
        {"run_id": run_id},
    ).all()
    return tuple(
        CandidateRow(
            candidate_key=str(r.candidate_key),
            sigungu_region_code=(
                str(r.sigungu_region_code) if r.sigungu_region_code is not None else None
            ),
            status=str(r.status),
        )
        for r in rows
    )


# --------------------------------------------------------------------------- #
# existing_burden (B17-corrected)
# --------------------------------------------------------------------------- #


def _unmapped_facility_evidence(
    session: Session, reference_year: int
) -> dict[str, existing_burden.UnmappedFacilityEvidence]:
    """Evidence the source holds for a region but cannot attribute to it.

    Regions are resolved by official name and never invented: a group is only
    attached to SIGUNGU that actually exist in ``regions``.
    """

    groups = session.execute(
        text(
            """
            SELECT rcis_sido_name, rcis_sigungu_name,
                   count(*) AS facility_count,
                   sum(throughput_quantity) AS throughput
            FROM waste_treatment_facilities
            WHERE reference_year = :year AND region_id IS NULL
            GROUP BY 1, 2
            ORDER BY 1, 2
            """
        ),
        {"year": reference_year},
    ).all()

    counts: dict[str, int] = {}
    tonnage: dict[str, Decimal] = {}
    units: dict[str, list[str]] = {}
    for group in groups:
        covered = (
            session.execute(
                text(
                    "SELECT region_code FROM regions WHERE region_level = 'SIGUNGU' "
                    "AND region_name LIKE '%' || :city || ' %' ORDER BY region_code"
                ),
                {"city": str(group.rcis_sigungu_name)},
            )
            .scalars()
            .all()
        )
        throughput = (
            Decimal(str(group.throughput)) if group.throughput is not None else None
        )
        for code in (str(c) for c in covered):
            counts[code] = counts.get(code, 0) + int(group.facility_count)
            if throughput is not None:
                tonnage[code] = tonnage.get(code, Decimal("0")) + throughput
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


def load_existing_burden_inputs(
    session: Session,
    regions: Sequence[RegionRow],
    population: dict[str, int],
    reference_year: int,
) -> tuple[existing_burden.ExistingBurdenInput, ...]:
    rows = session.execute(
        text(
            """
            SELECT r.region_code, f.throughput_quantity, f.throughput_unit,
                   f.source_id, f.reference_period
            FROM waste_treatment_facilities f
            JOIN regions r ON r.id = f.region_id AND r.region_level = 'SIGUNGU'
            WHERE f.reference_year = :year
            ORDER BY r.region_code, f.id
            """
        ),
        {"year": reference_year},
    ).all()

    by_region: dict[str, list[FacilityThroughput]] = {}
    source_ids: dict[str, str] = {}
    periods: dict[str, str] = {}
    for row in rows:
        code = str(row.region_code)
        by_region.setdefault(code, []).append(
            FacilityThroughput(
                throughput_quantity=(
                    Decimal(str(row.throughput_quantity))
                    if row.throughput_quantity is not None
                    else None
                ),
                throughput_unit=(
                    str(row.throughput_unit) if row.throughput_unit is not None else None
                ),
            )
        )
        if row.source_id is not None:
            source_ids.setdefault(code, str(row.source_id))
        if row.reference_period is not None:
            periods.setdefault(code, str(row.reference_period))

    evidence = _unmapped_facility_evidence(session, reference_year)
    return tuple(
        existing_burden.ExistingBurdenInput(
            region_code=region.region_code,
            population=population.get(region.region_code),
            facilities=tuple(by_region.get(region.region_code, ())),
            unmapped_facility_evidence=evidence.get(region.region_code),
            facility_source_id=source_ids.get(region.region_code),
            facility_reference_period=periods.get(region.region_code, str(reference_year)),
            population_source_id=POPULATION_SERIES_DEFINITION,
            population_reference_period=str(POPULATION_REFERENCE_YEAR),
            population_definition=POPULATION_SERIES_DEFINITION,
        )
        for region in regions
    )


# --------------------------------------------------------------------------- #
# air_impact_proxy
# --------------------------------------------------------------------------- #


def load_air_impact_inputs(
    session: Session,
    regions: Sequence[RegionRow],
    population: dict[str, int],
    reference_year: int,
) -> tuple[air_impact_proxy.AirImpactProxyInput, ...]:
    """One input per SIGUNGU, carrying whichever canonical streams exist.

    An unreported stream is simply absent, and the component then refuses the
    region. Nothing substitutes zero, and no CITY-grain reporting row is folded
    into a SIGUNGU total — that is the rejected projection, not a fallback.
    """

    rows = session.execute(
        text(
            """
            SELECT r.region_code, s.waste_stream, s.generation_quantity, s.quantity_unit,
                   s.reference_period, s.source_geographic_level, s.source_id, s.source_pid,
                   s.accounting_basis
            FROM regional_waste_statistics s
            JOIN regions r ON r.id = s.region_id AND r.region_level = 'SIGUNGU'
            WHERE s.reference_year = :year
            ORDER BY r.region_code, s.waste_stream
            """
        ),
        {"year": reference_year},
    ).all()

    by_region: dict[str, list[air_impact_proxy.StreamObservation]] = {}
    for row in rows:
        by_region.setdefault(str(row.region_code), []).append(
            air_impact_proxy.StreamObservation(
                waste_stream=str(row.waste_stream),
                generation_quantity=(
                    Decimal(str(row.generation_quantity))
                    if row.generation_quantity is not None
                    else None
                ),
                quantity_unit=(str(row.quantity_unit) if row.quantity_unit is not None else None),
                reference_period=(
                    str(row.reference_period) if row.reference_period is not None else None
                ),
                source_geographic_level=(
                    str(row.source_geographic_level)
                    if row.source_geographic_level is not None
                    else None
                ),
                source_id=(str(row.source_id) if row.source_id is not None else None),
                source_pid=(str(row.source_pid) if row.source_pid is not None else None),
                accounting_basis=(
                    str(row.accounting_basis) if row.accounting_basis is not None else None
                ),
            )
        )

    return tuple(
        air_impact_proxy.AirImpactProxyInput(
            region_code=region.region_code,
            population=population.get(region.region_code),
            streams=tuple(by_region.get(region.region_code, ())),
            population_source_id=POPULATION_SERIES_DEFINITION,
            population_reference_period=str(POPULATION_REFERENCE_YEAR),
        )
        for region in regions
    )


# --------------------------------------------------------------------------- #
# resident_impact — the approved floor only
# --------------------------------------------------------------------------- #

# One representative point per population unit, derived ONCE. Inlining
# ST_PointOnSurface into the pair join re-derives it for every candidate x region
# pair — millions of times, including on a 74-part archipelago — and is the
# difference between minutes and hours.
_RESIDENT_IMPACT_SQL = """
    WITH units AS MATERIALIZED (
        SELECT
            p.population::numeric AS population,
            ST_PointOnSurface(r.geometry)::geography AS representative_point
        FROM regions r
        JOIN regional_population p
          ON p.region_id = r.id
         AND p.reference_year = :reference_year
         AND p.reference_month IS NULL
        WHERE r.region_level = 'SIGUNGU'
          AND r.geometry IS NOT NULL
    ),
    pairs AS (
        SELECT
            c.candidate_key,
            u.population,
            ST_Distance(c.centroid::geography, u.representative_point)::numeric AS distance_m
        FROM suitability_candidates c
        CROSS JOIN units u
        WHERE c.analysis_run_id = :run_id
    )
    SELECT
        candidate_key,
        count(*) AS population_unit_count,
        sum(population) AS total_population,
        min(distance_m) AS min_distance_m,
        count(*) FILTER (WHERE distance_m < :floor_m) AS floored_units,
        sum(population / GREATEST(distance_m, :floor_m)) AS raw_value
    FROM pairs
    GROUP BY candidate_key
    ORDER BY candidate_key
"""


@dataclass(frozen=True)
class ResidentImpactRow:
    candidate_key: str
    population_unit_count: int
    total_population: int
    min_distance_m: Decimal
    floored_units: int
    raw_value: Decimal


def load_resident_impact(
    session: Session, run_id: int, floor_m: Decimal
) -> tuple[ResidentImpactRow, ...]:
    """Population-weighted inverse-distance exposure at the approved floor."""

    rows = session.execute(
        text(_RESIDENT_IMPACT_SQL),
        {
            "run_id": run_id,
            "reference_year": POPULATION_REFERENCE_YEAR,
            "floor_m": floor_m,
        },
    ).all()
    return tuple(
        ResidentImpactRow(
            candidate_key=str(r.candidate_key),
            population_unit_count=int(r.population_unit_count),
            total_population=int(r.total_population),
            min_distance_m=Decimal(str(r.min_distance_m)),
            floored_units=int(r.floored_units),
            raw_value=Decimal(str(r.raw_value)),
        )
        for r in rows
    )


# --------------------------------------------------------------------------- #
# land_conversion
# --------------------------------------------------------------------------- #


def load_land_conversion_inputs(
    session: Session, class_level: int
) -> tuple[land_conversion.LandConversionInput, ...]:
    """One input per candidate cell, with its stored class areas at ``class_level``."""

    stats = session.execute(
        text(
            """
            SELECT candidate_key, coverage_status, cell_area_m2, evaluated_area_m2,
                   coverage_ratio, statistics_version_id, land_cover_dataset_version_id,
                   derivation_version, area_crs
            FROM environmental_land_cover_cell_statistics
            ORDER BY candidate_key
            """
        )
    ).all()

    class_rows = session.execute(
        text(
            """
            SELECT candidate_key, class_level, class_code, class_name, class_area_m2
            FROM environmental_land_cover_cell_class_areas
            WHERE class_level = :level
            ORDER BY candidate_key, class_code
            """
        ),
        {"level": class_level},
    ).all()

    by_candidate: dict[str, list[land_conversion.ClassArea]] = {}
    for row in class_rows:
        by_candidate.setdefault(str(row.candidate_key), []).append(
            land_conversion.ClassArea(
                class_level=int(row.class_level),
                class_code=str(row.class_code),
                class_name=str(row.class_name),
                class_area_m2=(
                    Decimal(str(row.class_area_m2)) if row.class_area_m2 is not None else None
                ),
            )
        )

    def _decimal(value: Any) -> Decimal | None:
        return Decimal(str(value)) if value is not None else None

    return tuple(
        land_conversion.LandConversionInput(
            candidate_key=str(row.candidate_key),
            coverage_status=str(row.coverage_status),
            cell_area_m2=_decimal(row.cell_area_m2),
            evaluated_area_m2=_decimal(row.evaluated_area_m2),
            class_areas=tuple(by_candidate.get(str(row.candidate_key), ())),
            coverage_ratio=_decimal(row.coverage_ratio),
            statistics_version_id=(
                int(row.statistics_version_id) if row.statistics_version_id is not None else None
            ),
            land_cover_dataset_version_id=(
                int(row.land_cover_dataset_version_id)
                if row.land_cover_dataset_version_id is not None
                else None
            ),
            land_cover_derivation_version=(
                str(row.derivation_version) if row.derivation_version is not None else None
            ),
            area_crs=(str(row.area_crs) if row.area_crs is not None else None),
        )
        for row in stats
    )


def resident_impact_inputs(
    rows: Sequence[ResidentImpactRow], floor: resident_impact.DistanceFloor
) -> dict[str, Decimal]:
    """Raw ``resident_impact`` values keyed by candidate, at the approved floor.

    The set-based SQL computes the same sum the component's ``observe()`` computes
    per candidate; materializing the full candidate x region pair set in Python
    would be arithmetically identical and enormously slower. The floor is passed
    through so the caller cannot silently score against a different one than the
    query used.
    """

    if floor.distance_floor_m <= 0:  # pragma: no cover - DistanceFloor already refuses this
        raise ValueError("distance floor must be strictly positive")
    return {row.candidate_key: row.raw_value for row in rows}
