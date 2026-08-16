"""Read-only extraction of the real capital-region dataset for Phase-3 research.

Every statement here is a ``SELECT``. The module opens its own engine, never
writes, never migrates, and never touches production: the connection URL is
supplied by the caller and the Phase-3 driver points it at a local PostGIS
instance only.

The loaders return the successor package's own input dataclasses wherever one
exists, so the Phase-3 measurements run through exactly the contract the model
defines rather than a research reimplementation of it.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection

_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:  # pragma: no cover - import-path bootstrap
    sys.path.insert(0, str(_SRC))

from waste_equity_backend.analysis.facility_burden import FacilityThroughput  # noqa: E402
from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    air_impact_proxy,
    existing_burden,
    land_conversion,
)

# The population series the SIGUNGU-grain components divide by. The table holds
# two non-interchangeable series and only this one has SIGUNGU resolution; the
# MOIS monthly series covers the three SIDO only. ``reference_month IS NULL`` is
# what distinguishes them, and it is the same predicate the successor model's own
# ``population_weighted_impact_sql`` uses.
POPULATION_SERIES_DEFINITION = "SGIS_TOTAL_POPULATION"
POPULATION_REFERENCE_YEAR = 2024


def open_engine(url: str) -> Engine:
    """Open a SQLAlchemy engine for read-only analysis."""

    return create_engine(url, future=True)


# The resident-impact aggregate groups 3.8 million candidate x population-unit
# pairs. Under the 4 MB default this spills to an external sort and the same
# query that finishes in about a second takes minutes; the parallel workers park
# in MessageQueueSend while the leader drains a disk sort. This is a
# session-scoped planner setting, not a database change: it touches no data, no
# schema, and no other connection.
ANALYSIS_WORK_MEM = "256MB"


def prepare_session(conn: Connection) -> None:
    """Apply session-scoped planner settings for the large aggregates."""

    conn.execute(text(f"SET work_mem = '{ANALYSIS_WORK_MEM}'"))


# --------------------------------------------------------------------------- #
# Snapshot metadata
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DatasetSnapshot:
    """What was actually read, so the report can name its own inputs exactly."""

    alembic_version: str
    run_id: int
    run_status: str
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    run_created_at: str
    candidate_count: int
    sigungu_count: int
    sido_count: int
    population_reference_year: int
    population_definition: str
    population_region_count: int
    facility_reference_year: int | None
    waste_statistics_reference_year: int | None
    land_cover_statistics_version_id: int | None
    land_cover_derivation_version: str | None
    land_cover_area_crs: str | None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "alembic_version": self.alembic_version,
            "run_id": self.run_id,
            "run_status": self.run_status,
            "policy_version": self.policy_version,
            "derivation_version": self.derivation_version,
            "candidate_grid_version": self.candidate_grid_version,
            "run_created_at": self.run_created_at,
            "candidate_count": self.candidate_count,
            "sigungu_count": self.sigungu_count,
            "sido_count": self.sido_count,
            "population_reference_year": self.population_reference_year,
            "population_definition": self.population_definition,
            "population_region_count": self.population_region_count,
            "facility_reference_year": self.facility_reference_year,
            "waste_statistics_reference_year": self.waste_statistics_reference_year,
            "land_cover_statistics_version_id": self.land_cover_statistics_version_id,
            "land_cover_derivation_version": self.land_cover_derivation_version,
            "land_cover_area_crs": self.land_cover_area_crs,
        }


def load_snapshot(conn: Connection, run_id: int) -> DatasetSnapshot:
    """Read the identity of every dataset this analysis depends on."""

    alembic = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    run = conn.execute(
        text(
            """
            SELECT status, policy_version, derivation_version, candidate_grid_version,
                   created_at
            FROM suitability_analysis_runs WHERE id = :run_id
            """
        ),
        {"run_id": run_id},
    ).one()
    candidate_count = conn.execute(
        text("SELECT count(*) FROM suitability_candidates WHERE analysis_run_id = :run_id"),
        {"run_id": run_id},
    ).scalar_one()
    sigungu_count = conn.execute(
        text("SELECT count(*) FROM regions WHERE region_level = 'SIGUNGU'")
    ).scalar_one()
    sido_count = conn.execute(
        text("SELECT count(*) FROM regions WHERE region_level = 'SIDO'")
    ).scalar_one()
    population_region_count = conn.execute(
        text(
            """
            SELECT count(*) FROM regional_population p
            JOIN regions r ON r.id = p.region_id AND r.region_level = 'SIGUNGU'
            WHERE p.reference_year = :year AND p.reference_month IS NULL
            """
        ),
        {"year": POPULATION_REFERENCE_YEAR},
    ).scalar_one()
    facility_year = conn.execute(
        text("SELECT max(reference_year) FROM waste_treatment_facilities")
    ).scalar()
    waste_year = conn.execute(
        text("SELECT max(reference_year) FROM regional_waste_statistics")
    ).scalar()
    land_cover = conn.execute(
        text(
            """
            SELECT statistics_version_id, derivation_version, area_crs
            FROM environmental_land_cover_cell_statistics
            LIMIT 1
            """
        )
    ).one_or_none()

    return DatasetSnapshot(
        alembic_version=str(alembic),
        run_id=run_id,
        run_status=str(run.status),
        policy_version=str(run.policy_version),
        derivation_version=str(run.derivation_version),
        candidate_grid_version=str(run.candidate_grid_version),
        run_created_at=run.created_at.isoformat(),
        candidate_count=int(candidate_count),
        sigungu_count=int(sigungu_count),
        sido_count=int(sido_count),
        population_reference_year=POPULATION_REFERENCE_YEAR,
        population_definition=POPULATION_SERIES_DEFINITION,
        population_region_count=int(population_region_count),
        facility_reference_year=int(facility_year) if facility_year is not None else None,
        waste_statistics_reference_year=int(waste_year) if waste_year is not None else None,
        land_cover_statistics_version_id=(
            int(land_cover.statistics_version_id) if land_cover is not None else None
        ),
        land_cover_derivation_version=(
            str(land_cover.derivation_version) if land_cover is not None else None
        ),
        land_cover_area_crs=(str(land_cover.area_crs) if land_cover is not None else None),
    )


# --------------------------------------------------------------------------- #
# Regions and population
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class RegionRow:
    region_code: str
    region_name: str
    parent_region_code: str | None


def load_sigungu_regions(conn: Connection) -> tuple[RegionRow, ...]:
    rows = conn.execute(
        text(
            """
            SELECT region_code, region_name, parent_region_code
            FROM regions WHERE region_level = 'SIGUNGU'
            ORDER BY region_code
            """
        )
    ).all()
    return tuple(
        RegionRow(
            region_code=str(row.region_code),
            region_name=str(row.region_name),
            parent_region_code=(
                str(row.parent_region_code) if row.parent_region_code is not None else None
            ),
        )
        for row in rows
    )


def load_population(conn: Connection) -> dict[str, int]:
    """SIGUNGU resident population for the annual series, keyed by region code."""

    rows = conn.execute(
        text(
            """
            SELECT r.region_code, p.population
            FROM regional_population p
            JOIN regions r ON r.id = p.region_id AND r.region_level = 'SIGUNGU'
            WHERE p.reference_year = :year
              AND p.reference_month IS NULL
              AND p.population_definition = :definition
            ORDER BY r.region_code
            """
        ),
        {"year": POPULATION_REFERENCE_YEAR, "definition": POPULATION_SERIES_DEFINITION},
    ).all()
    return {str(row.region_code): int(row.population) for row in rows}


# --------------------------------------------------------------------------- #
# existing_burden
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class FacilityCoverage:
    """Facility rows that could not be attributed to any region.

    An unmapped row is not a region with no facilities: it is a facility whose
    region is unknown. Counting them separately is what keeps a geocoding gap
    from reading as a measured absence of burden.
    """

    unmapped_row_count: int
    unmapped_reasons: dict[str, int]


def load_facility_coverage(conn: Connection, reference_year: int) -> FacilityCoverage:
    rows = conn.execute(
        text(
            """
            SELECT coalesce(region_mapping_status, 'NULL_STATUS') AS status, count(*) AS n
            FROM waste_treatment_facilities
            WHERE reference_year = :year AND region_id IS NULL
            GROUP BY 1 ORDER BY 1
            """
        ),
        {"year": reference_year},
    ).all()
    reasons = {str(row.status): int(row.n) for row in rows}
    return FacilityCoverage(
        unmapped_row_count=sum(reasons.values()),
        unmapped_reasons=reasons,
    )


def load_existing_burden_inputs(
    conn: Connection,
    regions: Sequence[RegionRow],
    population: dict[str, int],
    reference_year: int,
) -> tuple[existing_burden.ExistingBurdenInput, ...]:
    """One input per SIGUNGU, carrying its located facility rows verbatim."""

    rows = conn.execute(
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

    return tuple(
        existing_burden.ExistingBurdenInput(
            region_code=region.region_code,
            population=population.get(region.region_code),
            facilities=tuple(by_region.get(region.region_code, ())),
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
    conn: Connection,
    regions: Sequence[RegionRow],
    population: dict[str, int],
    reference_year: int,
) -> tuple[air_impact_proxy.AirImpactProxyInput, ...]:
    """One input per SIGUNGU, carrying whichever canonical streams exist.

    A stream with no row is simply absent from ``streams``; the component's own
    ``observe()`` then raises ``MISSING_WASTE_STREAM`` for it. Nothing here
    substitutes a zero quantity for an unreported stream, and nothing folds the
    CITY-grain reporting-region rows into a SIGUNGU total.
    """

    rows = conn.execute(
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
        code = str(row.region_code)
        by_region.setdefault(code, []).append(
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


def load_reporting_region_grain(conn: Connection, reference_year: int) -> dict[str, int]:
    """CITY-grain reporting-region stream rows, counted but never summed in.

    These are the seven large Gyeonggi cities RCIS reports at CITY level. Folding
    them into a SIGUNGU total would mix geographies, which the component refuses
    with ``INCOMPATIBLE_GEOGRAPHIC_GRAIN``; they are reported here so the size of
    the excluded population is visible rather than implied.
    """

    rows = conn.execute(
        text(
            """
            SELECT waste_stream, count(*) AS n
            FROM reporting_region_waste_statistics
            WHERE reference_year = :year
            GROUP BY 1 ORDER BY 1
            """
        ),
        {"year": reference_year},
    ).all()
    return {str(row.waste_stream): int(row.n) for row in rows}


# --------------------------------------------------------------------------- #
# Candidates
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CandidateRow:
    candidate_key: str
    sido_region_code: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    status: str


def load_candidates(conn: Connection, run_id: int) -> tuple[CandidateRow, ...]:
    rows = conn.execute(
        text(
            """
            SELECT candidate_key, sido_region_code, sigungu_region_code,
                   sigungu_region_name, status
            FROM suitability_candidates
            WHERE analysis_run_id = :run_id
            ORDER BY candidate_key
            """
        ),
        {"run_id": run_id},
    ).all()
    return tuple(
        CandidateRow(
            candidate_key=str(row.candidate_key),
            sido_region_code=(
                str(row.sido_region_code) if row.sido_region_code is not None else None
            ),
            sigungu_region_code=(
                str(row.sigungu_region_code) if row.sigungu_region_code is not None else None
            ),
            sigungu_region_name=(
                str(row.sigungu_region_name) if row.sigungu_region_name is not None else None
            ),
            status=str(row.status),
        )
        for row in rows
    )


# --------------------------------------------------------------------------- #
# resident_impact
# --------------------------------------------------------------------------- #

# One pass over the candidate x population-unit join, evaluating the geodesic
# distance once per pair and applying every research floor to it. This is exactly
# the aggregate ``resident_impact.population_weighted_impact_sql()`` defines,
# widened to four floors so the sensitivity comparison reads a single consistent
# distance matrix instead of four independently recomputed ones. Equivalence
# against the contract's own single-floor statement is asserted by the driver on
# a sample rather than assumed.
MULTI_FLOOR_IMPACT_SQL = """
    WITH units AS MATERIALIZED (
        -- One representative point per population unit, derived ONCE. Inlining
        -- ST_PointOnSurface into the pair join re-derives it for every
        -- candidate x region pair -- 3.8 million times, including on a 74-part
        -- archipelago. Materializing is arithmetically identical and the
        -- difference between minutes and hours.
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
        count(*) FILTER (WHERE distance_m < 500)  AS floored_500,
        count(*) FILTER (WHERE distance_m < 1000) AS floored_1000,
        count(*) FILTER (WHERE distance_m < 2000) AS floored_2000,
        count(*) FILTER (WHERE distance_m < 5000) AS floored_5000,
        sum(population / GREATEST(distance_m, 500))  AS raw_500,
        sum(population / GREATEST(distance_m, 1000)) AS raw_1000,
        sum(population / GREATEST(distance_m, 2000)) AS raw_2000,
        sum(population / GREATEST(distance_m, 5000)) AS raw_5000
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
    floored_counts: dict[int, int]
    raw_by_floor: dict[int, Decimal]


def load_resident_impact(
    conn: Connection, run_id: int, reference_year: int
) -> tuple[ResidentImpactRow, ...]:
    rows = conn.execute(
        text(MULTI_FLOOR_IMPACT_SQL),
        {"run_id": run_id, "reference_year": reference_year},
    ).all()
    return tuple(
        ResidentImpactRow(
            candidate_key=str(row.candidate_key),
            population_unit_count=int(row.population_unit_count),
            total_population=int(row.total_population),
            min_distance_m=Decimal(str(row.min_distance_m)),
            floored_counts={
                500: int(row.floored_500),
                1000: int(row.floored_1000),
                2000: int(row.floored_2000),
                5000: int(row.floored_5000),
            },
            raw_by_floor={
                500: Decimal(str(row.raw_500)),
                1000: Decimal(str(row.raw_1000)),
                2000: Decimal(str(row.raw_2000)),
                5000: Decimal(str(row.raw_5000)),
            },
        )
        for row in rows
    )


def load_population_units_for_candidates(
    conn: Connection, run_id: int, candidate_keys: Sequence[str]
) -> dict[str, list[tuple[str, int, Decimal]]]:
    """Per-candidate ``(region_code, population, distance_m)`` for a small sample.

    Used only to cross-check the set-based aggregate against the successor
    module's own Python ``observe()`` on a handful of candidates; materializing
    the full 3.8-million-pair join in Python would be pointless and enormous.
    """

    rows = conn.execute(
        text(
            """
            SELECT
                c.candidate_key,
                r.region_code,
                p.population,
                ST_Distance(
                    c.centroid::geography,
                    ST_PointOnSurface(r.geometry)::geography
                )::numeric AS distance_m
            FROM suitability_candidates c
            JOIN regions r
              ON r.region_level = 'SIGUNGU'
             AND r.geometry IS NOT NULL
            JOIN regional_population p
              ON p.region_id = r.id
             AND p.reference_year = :reference_year
             AND p.reference_month IS NULL
            WHERE c.analysis_run_id = :run_id
              AND c.candidate_key = ANY(:keys)
            ORDER BY c.candidate_key, r.region_code
            """
        ),
        {
            "run_id": run_id,
            "reference_year": POPULATION_REFERENCE_YEAR,
            "keys": list(candidate_keys),
        },
    ).all()
    grouped: dict[str, list[tuple[str, int, Decimal]]] = {}
    for row in rows:
        grouped.setdefault(str(row.candidate_key), []).append(
            (str(row.region_code), int(row.population), Decimal(str(row.distance_m)))
        )
    return grouped


def load_representative_point_audit(conn: Connection) -> tuple[dict[str, Any], ...]:
    """Both representative-point conventions per region, plus their disagreement."""

    rows = conn.execute(
        text(
            """
            SELECT
                r.region_code,
                r.region_name,
                ST_NumGeometries(r.geometry) AS part_count,
                ST_Contains(r.geometry, ST_Centroid(r.geometry)) AS centroid_inside_region,
                ST_Distance(
                    ST_Centroid(r.geometry)::geography,
                    ST_PointOnSurface(r.geometry)::geography
                ) AS centroid_to_surface_point_m,
                sqrt(ST_Area(r.geometry::geography) / pi()) AS equivalent_circle_radius_m
            FROM regions r
            WHERE r.region_level = 'SIGUNGU' AND r.geometry IS NOT NULL
            ORDER BY centroid_inside_region, centroid_to_surface_point_m DESC
            """
        )
    ).all()
    return tuple(
        {
            "region_code": str(row.region_code),
            "region_name": str(row.region_name),
            "part_count": int(row.part_count),
            "centroid_inside_region": bool(row.centroid_inside_region),
            "centroid_to_surface_point_m": format(
                Decimal(str(row.centroid_to_surface_point_m)).quantize(Decimal("0.1")), "f"
            ),
            "equivalent_circle_radius_m": format(
                Decimal(str(row.equivalent_circle_radius_m)).quantize(Decimal("0.1")), "f"
            ),
        }
        for row in rows
    )


# --------------------------------------------------------------------------- #
# land_conversion
# --------------------------------------------------------------------------- #


def load_land_conversion_inputs(
    conn: Connection, class_level: int
) -> tuple[land_conversion.LandConversionInput, ...]:
    """One input per candidate cell, with its stored class areas at ``class_level``."""

    stats = conn.execute(
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

    class_rows = conn.execute(
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

    return tuple(
        land_conversion.LandConversionInput(
            candidate_key=str(row.candidate_key),
            coverage_status=str(row.coverage_status),
            cell_area_m2=(Decimal(str(row.cell_area_m2)) if row.cell_area_m2 is not None else None),
            evaluated_area_m2=(
                Decimal(str(row.evaluated_area_m2)) if row.evaluated_area_m2 is not None else None
            ),
            class_areas=tuple(by_candidate.get(str(row.candidate_key), ())),
            coverage_ratio=(
                Decimal(str(row.coverage_ratio)) if row.coverage_ratio is not None else None
            ),
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
