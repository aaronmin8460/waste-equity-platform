"""Versioned, idempotent suitability build engine (Phase 5.4).

Generates a deterministic 500 m candidate grid over the capital region, applies
hard-screening exclusions and review rules, computes four dimensionless component
scores server-side with set-based PostGIS (zoning compatibility, road proximity,
equity burden avoidance, waste demand context), computes profile-specific totals
and ranks, and persists one reproducible ``SuitabilityAnalysisRun`` plus its
``SuitabilityCandidate`` rows in a single transaction. An identical build (same
``analysis_signature``) is idempotent — it reuses the existing run and writes zero
new candidates. All output is analytical screening, never a legal determination.

The heavy spatial work stays in PostGIS; only the exact-`Decimal` scoring and
status logic run in Python, and geometry never round-trips out of the database.
See ``docs/SUITABILITY_POLICY_V1.md``.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import get_sessionmaker
from ...models.facilities import ACCOUNTING_BASIS_FACILITY_THROUGHPUT
from ..facility_burden import (
    FacilityThroughput,
    aggregate_throughput,
)
from ..per_capita import (
    EXPECTED_QUANTITY_UNIT,
    PER_CAPITA_UNIT,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)
from . import policy

ACCOUNTING_BASIS_ORIGIN_TREATMENT = "ORIGIN_BASED_TREATMENT_OUTCOME"
DEMAND_WASTE_STREAM = "HOUSEHOLD"

ProgressFn = Callable[[str, str], None]


class SuitabilityBuildError(RuntimeError):
    """Raised when a suitability build cannot safely complete."""


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


@dataclass
class SuitabilityBuildReport:
    job: str = "suitability-build"
    mode: str = "write"
    status: str = "SUCCEEDED"
    policy_version: str = policy.POLICY_VERSION
    derivation_version: str = policy.DERIVATION_VERSION
    candidate_grid_version: str = policy.CANDIDATE_GRID_VERSION
    reference_year: int | None = None
    boundary_vintage: str | None = None
    weight_profile: str = policy.DEFAULT_PROFILE
    analysis_signature: str | None = None
    analysis_run_id: int | None = None
    created: bool = True
    candidate_count_total: int = 0
    candidate_count_eligible: int = 0
    candidate_count_review: int = 0
    candidate_count_excluded: int = 0
    candidates_inserted: int = 0
    exclusion_reason_counts: dict[str, int] = field(default_factory=dict)
    review_reason_counts: dict[str, int] = field(default_factory=dict)
    input_dataset_version_ids: list[int] = field(default_factory=list)
    input_provenance: dict[str, Any] = field(default_factory=dict)
    top_candidates: list[dict[str, Any]] = field(default_factory=list)
    message: str = ""

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "job": self.job,
            "mode": self.mode,
            "status": self.status,
            "policy_version": self.policy_version,
            "derivation_version": self.derivation_version,
            "candidate_grid_version": self.candidate_grid_version,
            "reference_year": self.reference_year,
            "boundary_vintage": self.boundary_vintage,
            "weight_profile": self.weight_profile,
            "analysis_signature": self.analysis_signature,
            "analysis_run_id": self.analysis_run_id,
            "created": self.created,
            "candidate_count_total": self.candidate_count_total,
            "candidate_count_eligible": self.candidate_count_eligible,
            "candidate_count_review": self.candidate_count_review,
            "candidate_count_excluded": self.candidate_count_excluded,
            "candidates_inserted": self.candidates_inserted,
            "exclusion_reason_counts": self.exclusion_reason_counts,
            "review_reason_counts": self.review_reason_counts,
            "input_dataset_version_ids": self.input_dataset_version_ids,
            "input_provenance": self.input_provenance,
            "top_candidates": self.top_candidates,
            "message": self.message,
        }


# --------------------------------------------------------------------------- #
# Input resolution + signature
# --------------------------------------------------------------------------- #


@dataclass
class ResolvedInputs:
    reference_year: int
    boundary_vintage: str
    structural_version_ids: list[int]
    structural_versions: list[dict[str, Any]]
    population_reference_period: str
    waste_reference_period: str
    facility_reference_period: str


def _resolve_inputs(session: Session, reference_year: int) -> ResolvedInputs:
    versions = (
        session.execute(
            text(
                """
            SELECT id, layer_family, provider_dataset_identifier,
                   reference_date::text AS reference_date, source_id
            FROM structural_dataset_versions
            ORDER BY layer_family, id
            """
            )
        )
        .mappings()
        .all()
    )
    if not versions:
        raise SuitabilityBuildError("no structural dataset versions ingested; cannot screen")
    families = {v["layer_family"] for v in versions}
    for required in ("zoning", "protected", "roads"):
        if required not in families:
            raise SuitabilityBuildError(f"structural family '{required}' not ingested")

    def _one(table: str, where: str) -> dict[str, Any]:
        row = (
            session.execute(
                text(
                    f"SELECT source_id, reference_period FROM {table} "
                    f"WHERE reference_year = :year AND {where} LIMIT 1"
                ),
                {"year": reference_year},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise SuitabilityBuildError(
                f"no {table} rows for reference year {reference_year}; refusing to screen"
            )
        return dict(row)

    population = _one("regional_population", "1=1")
    waste = _one("regional_waste_statistics", "waste_stream = 'HOUSEHOLD'")
    facility = _one("waste_treatment_facilities", "1=1")

    vintage = session.execute(
        text(
            "SELECT DISTINCT extract(year FROM valid_from)::int AS y FROM regions "
            "WHERE region_level = 'SIDO'"
        )
    ).scalar_one()

    return ResolvedInputs(
        reference_year=reference_year,
        boundary_vintage=str(vintage),
        structural_version_ids=[int(v["id"]) for v in versions],
        structural_versions=[dict(v) for v in versions],
        population_reference_period=str(population["reference_period"]),
        waste_reference_period=str(waste["reference_period"]),
        facility_reference_period=str(facility["reference_period"]),
    )


def _analysis_signature(inputs: ResolvedInputs, profile: str) -> str:
    payload = {
        "policy_version": policy.POLICY_VERSION,
        "derivation_version": policy.DERIVATION_VERSION,
        "candidate_grid_version": policy.CANDIDATE_GRID_VERSION,
        "reference_year": inputs.reference_year,
        "boundary_vintage": inputs.boundary_vintage,
        "structural_version_ids": sorted(inputs.structural_version_ids),
        "population_reference_period": inputs.population_reference_period,
        "waste_reference_period": inputs.waste_reference_period,
        "facility_reference_period": inputs.facility_reference_period,
        "weight_profile": profile,
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# --------------------------------------------------------------------------- #
# Grid + spatial enrichment
# --------------------------------------------------------------------------- #


def _build_grid(session: Session) -> int:
    """Create the ``_sc_grid`` temp table of retained, clipped candidate cells."""

    session.execute(text("DROP TABLE IF EXISTS _sc_grid"))
    session.execute(
        text(
            """
            CREATE TEMP TABLE _sc_grid AS
            WITH u5179 AS (
                SELECT ST_Union(ST_Transform(geometry, 5179)) AS g
                FROM regions
                WHERE region_level = 'SIDO' AND geometry IS NOT NULL
            ),
            cells AS (
                SELECT c.geom AS cell_5179,
                       c.i, c.j,
                       ST_Centroid(c.geom) AS cen_5179
                FROM u5179 u, ST_SquareGrid(:size, u.g) AS c
                WHERE ST_Covers(u.g, ST_Centroid(c.geom))
            ),
            clipped AS (
                -- ST_MakeValid + polygonal extraction: intersecting a square with
                -- a complex coastal boundary can yield a self-intersecting ring,
                -- so every stored candidate geometry is repaired to a valid
                -- MultiPolygon (a valid input is returned unchanged).
                SELECT cells.i, cells.j, cells.cell_5179, cells.cen_5179,
                       ST_CollectionExtract(
                           ST_MakeValid(ST_Intersection(cells.cell_5179, u.g)), 3
                       ) AS clip_5179
                FROM cells, u5179 u
            )
            SELECT
                row_number() OVER (ORDER BY i, j) AS gid,
                (:grid_ver || ':' || i || '_' || j) AS candidate_key,
                ST_Multi(ST_Transform(clip_5179, 4326))::geometry(MultiPolygon, 4326) AS geom,
                ST_Transform(cen_5179, 4326)::geometry(Point, 4326) AS centroid,
                round(ST_Area(cell_5179)::numeric, 2) AS original_area_m2,
                round(ST_Area(clip_5179)::numeric, 2) AS clipped_area_m2,
                CAST(NULL AS varchar) AS sido_code,
                CAST(NULL AS varchar) AS sido_name,
                CAST(NULL AS varchar) AS sigungu_code,
                CAST(NULL AS varchar) AS sigungu_name,
                0 AS sigungu_count
            FROM clipped
            """
        ),
        {"size": policy.GRID_CELL_METERS, "grid_ver": policy.CANDIDATE_GRID_VERSION},
    )
    session.execute(text("CREATE INDEX _sc_grid_geom ON _sc_grid USING gist (geom)"))
    session.execute(text("CREATE INDEX _sc_grid_cen ON _sc_grid USING gist (centroid)"))
    session.execute(text("ANALYZE _sc_grid"))
    # Region assignment (SIDO + SIGUNGU) by centroid, deterministic tie-break.
    session.execute(
        text(
            """
            UPDATE _sc_grid g SET
                sido_code = (
                    SELECT region_code FROM regions
                    WHERE region_level = 'SIDO' AND ST_Covers(geometry, g.centroid)
                    ORDER BY region_code LIMIT 1),
                sido_name = (
                    SELECT region_name FROM regions
                    WHERE region_level = 'SIDO' AND ST_Covers(geometry, g.centroid)
                    ORDER BY region_code LIMIT 1),
                sigungu_code = (
                    SELECT region_code FROM regions
                    WHERE region_level = 'SIGUNGU' AND ST_Covers(geometry, g.centroid)
                    ORDER BY region_code LIMIT 1),
                sigungu_name = (
                    SELECT region_name FROM regions
                    WHERE region_level = 'SIGUNGU' AND ST_Covers(geometry, g.centroid)
                    ORDER BY region_code LIMIT 1),
                sigungu_count = (
                    SELECT count(*) FROM regions
                    WHERE region_level = 'SIGUNGU' AND ST_Covers(geometry, g.centroid))
            """
        )
    )
    return int(session.execute(text("SELECT count(*) FROM _sc_grid")).scalar_one())


def _enrich(session: Session) -> list[dict[str, Any]]:
    """Per-candidate spatial facts (exclusions, review layers, zoning, road)."""

    hard_protected = list(policy.PROTECTED_HARD_CODES)
    zoning_hard = list(policy.ZONING_HARD_CODES)
    rows = (
        session.execute(
            text(
                """
            SELECT
                g.gid, g.candidate_key,
                g.sido_code, g.sido_name, g.sigungu_code, g.sigungu_name, g.sigungu_count,
                g.original_area_m2, g.clipped_area_m2,
                (
                    SELECT array_agg(DISTINCT p.official_layer_code)
                    FROM structural_protected_features p
                    WHERE p.official_layer_code = ANY(:hard_protected)
                      AND ST_Intersects(p.geometry, g.geom)
                      AND ST_Area(ST_Intersection(p.geometry, g.geom)) > 0
                ) AS hard_protected_hits,
                EXISTS (
                    SELECT 1 FROM structural_features z
                    WHERE z.official_zoning_code = ANY(:zoning_hard)
                      AND ST_Intersects(z.geometry, g.geom)
                      AND ST_Area(ST_Intersection(z.geometry, g.geom)) > 0
                ) AS zoning_hard_hit,
                EXISTS (
                    SELECT 1 FROM structural_protected_features p
                    WHERE p.official_layer_code = 'UO101' AND ST_Intersects(p.geometry, g.geom)
                ) AS uo101_hit,
                EXISTS (
                    SELECT 1 FROM structural_protected_features p
                    WHERE p.official_layer_code = 'UO301' AND ST_Intersects(p.geometry, g.geom)
                ) AS uo301_hit,
                (
                    SELECT z.official_zoning_code FROM structural_features z
                    WHERE ST_Covers(z.geometry, g.centroid)
                    ORDER BY z.official_zoning_code LIMIT 1
                ) AS zoning_code,
                road.dist_m, road.layer AS road_layer, road.dsv AS road_version_id
            FROM _sc_grid g
            LEFT JOIN LATERAL (
                SELECT ST_Distance(g.centroid::geography, k.geometry::geography) AS dist_m,
                       k.official_layer_code AS layer, k.dataset_version_id AS dsv
                FROM (
                    SELECT geometry, official_layer_code, dataset_version_id
                    FROM structural_line_features
                    ORDER BY geometry <-> g.centroid
                    LIMIT 5
                ) k
                ORDER BY ST_Distance(g.centroid::geography, k.geometry::geography)
                LIMIT 1
            ) road ON TRUE
            ORDER BY g.gid
            """
            ),
            {"hard_protected": hard_protected, "zoning_hard": zoning_hard},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def _coverage_gaps(session: Session) -> dict[str, set[str]]:
    """Map SIDO name -> set of hard-exclusion codes that are OFFICIAL_SOURCE_UNAVAILABLE."""

    rows = (
        session.execute(
            text(
                "SELECT coverage_matrix FROM structural_dataset_versions "
                "WHERE layer_family = 'protected' AND coverage_matrix IS NOT NULL"
            )
        )
        .scalars()
        .all()
    )
    # region dir_name (seoul/incheon/gyeonggi) -> official SIDO region name
    dir_to_name = {"seoul": "서울특별시", "incheon": "인천광역시", "gyeonggi": "경기도"}
    gaps: dict[str, set[str]] = {}
    for matrix in rows:
        if not isinstance(matrix, dict):
            continue
        for dir_name, layers in matrix.items():
            sido = dir_to_name.get(dir_name)
            if sido is None or not isinstance(layers, dict):
                continue
            for code, info in layers.items():
                if (
                    code in policy.COVERAGE_SENSITIVE_HARD_CODES
                    and isinstance(info, dict)
                    and info.get("status") == "OFFICIAL_SOURCE_UNAVAILABLE"
                ):
                    gaps.setdefault(sido, set()).add(code)
    return gaps


# --------------------------------------------------------------------------- #
# Equity + demand per SIGUNGU (reusing 5.1/5.2 derivations)
# --------------------------------------------------------------------------- #


@dataclass
class RegionComponents:
    equity_scores: dict[str, Decimal]  # sigungu_code -> [0,100]
    demand_scores: dict[str, Decimal]
    equity_raw: dict[str, dict[str, Any]]  # sigungu_code -> raw burden provenance
    demand_raw: dict[str, dict[str, Any]]
    equity_provenance: dict[str, Any]
    demand_provenance: dict[str, Any]


def _region_components(session: Session, reference_year: int) -> RegionComponents:
    sigungu = (
        session.execute(
            text(
                """
            SELECT r.id, r.region_code, p.population, p.source_id AS pop_source,
                   p.reference_period AS pop_period, p.population_definition AS pop_def
            FROM regions r
            LEFT JOIN regional_population p
                ON p.region_id = r.id AND p.reference_year = :year
            WHERE r.region_level = 'SIGUNGU'
              AND extract(year FROM r.valid_from)::int = :year
            """
            ),
            {"year": reference_year},
        )
        .mappings()
        .all()
    )

    burden: dict[str, Decimal] = {}
    demand: dict[str, Decimal] = {}
    equity_raw: dict[str, dict[str, Any]] = {}
    demand_raw: dict[str, dict[str, Any]] = {}
    equity_prov: dict[str, Any] = {}
    demand_prov: dict[str, Any] = {}

    for reg in sigungu:
        code = reg["region_code"]
        population = reg["population"]
        if population is None or int(population) <= 0:
            continue  # missing/zero denominator -> component absent (review)

        # Equity: located facility throughput -> per-capita burden.
        facilities = (
            session.execute(
                text(
                    """
                SELECT throughput_quantity, throughput_unit, source_id, reference_period,
                       accounting_basis
                FROM waste_treatment_facilities
                WHERE region_id = :rid AND reference_year = :year
                """
                ),
                {"rid": reg["id"], "year": reference_year},
            )
            .mappings()
            .all()
        )
        agg = aggregate_throughput(
            [FacilityThroughput(f["throughput_quantity"], f["throughput_unit"]) for f in facilities]
        )
        try:
            burden_pc = per_capita_kg_per_year(
                agg.total_tons_per_year, EXPECTED_QUANTITY_UNIT, int(population)
            )
        except (ZeroPopulationError, UnexpectedQuantityUnitError):
            burden_pc = None
        if burden_pc is not None:
            burden[code] = burden_pc
            fac0 = facilities[0] if facilities else None
            equity_raw[code] = {
                "located_burden_kg_per_capita": str(burden_pc),
                "located_throughput_tons_per_year": str(agg.total_tons_per_year),
                "unit": PER_CAPITA_UNIT,
                "accounting_basis": ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
                "facility_count_located": agg.facility_count,
                "missing_throughput_count": agg.missing_throughput_count,
                "is_partial": agg.is_partial,
                "population": int(population),
                "source_id": (fac0["source_id"] if fac0 else "waste_statistics"),
                "reference_period": (fac0["reference_period"] if fac0 else str(reference_year)),
                "population_source_id": reg["pop_source"],
                "population_reference_period": reg["pop_period"],
            }
            if not equity_prov:
                equity_prov = {
                    "derivation_version": "facility-burden-v1",
                    "metric": "located_facility_burden_per_capita",
                    "unit": PER_CAPITA_UNIT,
                    "accounting_basis": ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
                    "source_id": (fac0["source_id"] if fac0 else "waste_statistics"),
                    "reference_period": (fac0["reference_period"] if fac0 else str(reference_year)),
                    "population_source_id": reg["pop_source"],
                    "population_reference_period": reg["pop_period"],
                    "normalization": "percentile rank over SIGUNGU; lower burden -> higher score",
                }

        # Demand: HOUSEHOLD origin-based generation -> per-capita.
        household = (
            session.execute(
                text(
                    """
                SELECT generation_quantity, quantity_unit, source_id, reference_period,
                       accounting_basis
                FROM regional_waste_statistics
                WHERE region_id = :rid AND reference_year = :year AND waste_stream = :stream
                LIMIT 1
                """
                ),
                {"rid": reg["id"], "year": reference_year, "stream": DEMAND_WASTE_STREAM},
            )
            .mappings()
            .first()
        )
        if household is not None:
            try:
                demand_pc = per_capita_kg_per_year(
                    household["generation_quantity"], household["quantity_unit"], int(population)
                )
            except (ZeroPopulationError, UnexpectedQuantityUnitError):
                demand_pc = None
            if demand_pc is not None:
                demand[code] = demand_pc
                demand_raw[code] = {
                    "household_per_capita_kg_per_year": str(demand_pc),
                    "generation_quantity_tons_per_year": str(household["generation_quantity"]),
                    "unit": PER_CAPITA_UNIT,
                    "waste_stream": DEMAND_WASTE_STREAM,
                    "accounting_basis": ACCOUNTING_BASIS_ORIGIN_TREATMENT,
                    "population": int(population),
                    "source_id": household["source_id"],
                    "reference_period": household["reference_period"],
                }
                if not demand_prov:
                    demand_prov = {
                        "derivation_version": "per-capita-v1",
                        "metric": "household_per_capita_waste_generation",
                        "unit": PER_CAPITA_UNIT,
                        "waste_stream": DEMAND_WASTE_STREAM,
                        "accounting_basis": ACCOUNTING_BASIS_ORIGIN_TREATMENT,
                        "source_id": household["source_id"],
                        "reference_period": household["reference_period"],
                        "normalization": "SIGUNGU percentile rank; higher demand -> higher score",
                    }

    equity_pct = policy.percentile_ranks(burden)
    demand_pct = policy.percentile_ranks(demand)
    equity_scores = {c: policy.equity_score_from_rank(p) for c, p in equity_pct.items()}
    demand_scores = {c: policy.demand_score_from_rank(p) for c, p in demand_pct.items()}
    return RegionComponents(
        equity_scores=equity_scores,
        demand_scores=demand_scores,
        equity_raw=equity_raw,
        demand_raw=demand_raw,
        equity_provenance=equity_prov,
        demand_provenance=demand_prov,
    )


# --------------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------------- #


def _score_candidates(
    facts: list[dict[str, Any]],
    region: RegionComponents,
    coverage_gaps: dict[str, set[str]],
    active_profile: str,
) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
    """Compute per-candidate status, component scores, reasons, and provenance."""

    scored: list[dict[str, Any]] = []
    exclusion_counts: dict[str, int] = {}
    review_counts: dict[str, int] = {}

    for f in facts:
        exclusion_reasons: list[str] = []
        review_reasons: list[str] = []
        penalties: list[str] = []
        component_scores: dict[str, Decimal] = {}
        raw: dict[str, Any] = {}

        # --- Hard exclusions (record all) ---
        for code in sorted(f["hard_protected_hits"] or []):
            exclusion_reasons.append(f"{policy.EXCLUSION_LABEL}:{code}")
        if f["zoning_hard_hit"]:
            exclusion_reasons.append(f"{policy.EXCLUSION_LABEL}:UQ114")

        # --- Road score (always available) ---
        dist = f["dist_m"]
        road_score_val: Decimal | None = None
        if dist is not None:
            road_score_val = policy.road_score(Decimal(str(dist)))
            component_scores["road"] = road_score_val
        nearest_road = {
            "distance_m": (round(float(dist), 3) if dist is not None else None),
            "official_layer_code": f["road_layer"],
            "dataset_version_id": f["road_version_id"],
            "source_id": "vworld_structural",
            "note": "distance-to-road access proxy; not proof of truck accessibility",
        }
        raw["nearest_road"] = nearest_road

        # --- Zoning ---
        zoning_code = f["zoning_code"]
        raw["zoning_code"] = zoning_code
        if zoning_code is None:
            review_reasons.append(policy.NO_ZONING_COVERAGE_REASON)
        else:
            rule = policy.ZONING_REGISTRY.get(zoning_code)
            if rule is None:
                review_reasons.append(policy.UNMAPPED_ZONING_REASON)
            elif rule.status_effect == "REVIEW_REQUIRED":
                if rule.review_reason:
                    review_reasons.append(rule.review_reason)
            elif rule.status_effect == "ELIGIBLE_WITH_PENALTY" and rule.score is not None:
                component_scores["zoning"] = policy.quantize_score(rule.score)
                if rule.penalty:
                    penalties.append(f"zoning:{rule.penalty}")
            # HARD_EXCLUSION zoning at centroid is already caught by zoning_hard_hit.

        # --- Review protected layers ---
        if f["uo101_hit"]:
            review_reasons.append(policy.REVIEW_PROTECTED_CODES["UO101"])
        if f["uo301_hit"]:
            review_reasons.append(policy.REVIEW_PROTECTED_CODES["UO301"])

        # --- Coverage gaps (OFFICIAL_SOURCE_UNAVAILABLE hard layer in the SIDO) ---
        for code in sorted(coverage_gaps.get(f["sido_name"] or "", set())):
            review_reasons.append(f"COVERAGE_GAP_{code}")

        # --- Region assignment ---
        sigungu_code = f["sigungu_code"]
        if f["sigungu_count"] != 1 or sigungu_code is None:
            review_reasons.append("AMBIGUOUS_OR_MISSING_SIGUNGU")

        # --- Equity + demand (per SIGUNGU) ---
        if sigungu_code is not None and sigungu_code in region.equity_scores:
            component_scores["equity"] = region.equity_scores[sigungu_code]
            raw["equity"] = region.equity_raw.get(sigungu_code)
        else:
            review_reasons.append("MISSING_EQUITY_COMPONENT")
        if sigungu_code is not None and sigungu_code in region.demand_scores:
            component_scores["demand"] = region.demand_scores[sigungu_code]
            raw["demand"] = region.demand_raw.get(sigungu_code)
        else:
            review_reasons.append("MISSING_DEMAND_COMPONENT")

        # --- Status resolution ---
        if exclusion_reasons:
            status = policy.STATUS_EXCLUDED
        elif review_reasons or set(component_scores) != set(policy.COMPONENTS):
            status = policy.STATUS_REVIEW
        else:
            status = policy.STATUS_ELIGIBLE

        if status == policy.STATUS_EXCLUDED:
            # An excluded candidate carries only its exclusion reasons: no scores,
            # no rank, no review reasons, no penalties (hard screening removes it).
            review_reasons = []
            penalties = []
            component_scores = {}
            road_score_val = None

        # --- Composite / provisional per profile ---
        profile_totals: dict[str, str | None] = {}
        total_score: Decimal | None = None
        provisional_score: Decimal | None = None
        zoning_score = component_scores.get("zoning")
        equity_score = component_scores.get("equity")
        demand_score = component_scores.get("demand")
        if status == policy.STATUS_ELIGIBLE:
            for prof in policy.WEIGHT_PROFILES:
                profile_totals[prof] = str(policy.composite(component_scores, prof))
            total_score = Decimal(profile_totals[active_profile])  # type: ignore[arg-type]
        elif status == policy.STATUS_REVIEW:
            for prof in policy.WEIGHT_PROFILES:
                pv = policy.provisional_composite(component_scores, prof)
                profile_totals[prof] = str(pv) if pv is not None else None
            pv_active = policy.provisional_composite(component_scores, active_profile)
            provisional_score = pv_active

        for r in exclusion_reasons:
            exclusion_counts[r] = exclusion_counts.get(r, 0) + 1
        for r in review_reasons:
            review_counts[r] = review_counts.get(r, 0) + 1

        component_provenance: dict[str, Any] = {
            "zoning": {
                "source_id": "vworld_structural",
                "dataset": "용도지역지구도 (LSMD/NA_24)",
                "reference_period": "2026-06-01",
                "note": "top-level 용도지역 only; no residential/industrial subclass",
            },
            "road": nearest_road,
            "equity": region.equity_provenance,
            "demand": region.demand_provenance,
        }

        scored.append(
            {
                "gid": f["gid"],
                "candidate_key": f["candidate_key"],
                "status": status,
                "rank": None,
                "provisional_score": (
                    str(provisional_score) if provisional_score is not None else None
                ),
                "total_score": (str(total_score) if total_score is not None else None),
                "zoning_score": (str(zoning_score) if zoning_score is not None else None),
                "road_score": (str(road_score_val) if road_score_val is not None else None),
                "equity_score": (str(equity_score) if equity_score is not None else None),
                "demand_score": (str(demand_score) if demand_score is not None else None),
                "profile_totals": profile_totals,
                "profile_ranks": {},
                "raw_components": raw,
                "exclusion_reasons": exclusion_reasons,
                "review_reasons": review_reasons,
                "penalties": penalties,
                "nearest_road_distance_m": (round(float(dist), 3) if dist is not None else None),
                "nearest_road_provenance": nearest_road,
                "component_provenance": component_provenance,
            }
        )

    _assign_ranks(scored, active_profile)
    return scored, exclusion_counts, review_counts


def _assign_ranks(scored: list[dict[str, Any]], active_profile: str) -> None:
    """Rank ELIGIBLE candidates per profile (desc score, tie-break asc candidate_key)."""

    eligible = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE]
    for prof in policy.WEIGHT_PROFILES:
        ordered = sorted(
            eligible,
            key=lambda s: (-Decimal(s["profile_totals"][prof]), s["candidate_key"]),
        )
        for idx, s in enumerate(ordered, start=1):
            s["profile_ranks"][prof] = idx
    for s in eligible:
        s["rank"] = s["profile_ranks"].get(active_profile)


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #


def _persist(
    session: Session, run_id: int, scored: list[dict[str, Any]], now: datetime.datetime
) -> int:
    session.execute(text("DROP TABLE IF EXISTS _sc_scores"))
    session.execute(
        text(
            """
            CREATE TEMP TABLE _sc_scores (
                gid bigint PRIMARY KEY,
                status varchar,
                rank integer,
                provisional_score numeric(7,4),
                total_score numeric(7,4),
                zoning_score numeric(7,4),
                road_score numeric(7,4),
                equity_score numeric(7,4),
                demand_score numeric(7,4),
                profile_totals jsonb,
                profile_ranks jsonb,
                raw_components jsonb,
                exclusion_reasons jsonb,
                review_reasons jsonb,
                penalties jsonb,
                nearest_road_distance_m numeric(12,3),
                nearest_road_provenance jsonb,
                component_provenance jsonb
            )
            """
        )
    )
    insert_sql = text(
        """
        INSERT INTO _sc_scores VALUES (
            :gid, :status, :rank, :provisional_score, :total_score, :zoning_score,
            :road_score, :equity_score, :demand_score,
            CAST(:profile_totals AS jsonb), CAST(:profile_ranks AS jsonb),
            CAST(:raw_components AS jsonb), CAST(:exclusion_reasons AS jsonb),
            CAST(:review_reasons AS jsonb), CAST(:penalties AS jsonb),
            :nearest_road_distance_m, CAST(:nearest_road_provenance AS jsonb),
            CAST(:component_provenance AS jsonb)
        )
        """
    )
    params = [
        {
            "gid": s["gid"],
            "status": s["status"],
            "rank": s["rank"],
            "provisional_score": s["provisional_score"],
            "total_score": s["total_score"],
            "zoning_score": s["zoning_score"],
            "road_score": s["road_score"],
            "equity_score": s["equity_score"],
            "demand_score": s["demand_score"],
            "profile_totals": json.dumps(s["profile_totals"], ensure_ascii=False),
            "profile_ranks": json.dumps(s["profile_ranks"], ensure_ascii=False),
            "raw_components": json.dumps(s["raw_components"], ensure_ascii=False),
            "exclusion_reasons": json.dumps(s["exclusion_reasons"], ensure_ascii=False),
            "review_reasons": json.dumps(s["review_reasons"], ensure_ascii=False),
            "penalties": json.dumps(s["penalties"], ensure_ascii=False),
            "nearest_road_distance_m": s["nearest_road_distance_m"],
            "nearest_road_provenance": json.dumps(s["nearest_road_provenance"], ensure_ascii=False),
            "component_provenance": json.dumps(s["component_provenance"], ensure_ascii=False),
        }
        for s in scored
    ]
    for i in range(0, len(params), 2000):
        session.execute(insert_sql, params[i : i + 2000])

    result = session.execute(
        text(
            """
            INSERT INTO suitability_candidates (
                analysis_run_id, candidate_key, sido_region_code, sido_region_name,
                sigungu_region_code, sigungu_region_name, status, rank, provisional_score,
                total_score, zoning_score, road_score, equity_score, demand_score,
                profile_totals, profile_ranks, raw_components, exclusion_reasons,
                review_reasons, penalties, nearest_road_distance_m, nearest_road_provenance,
                component_provenance, original_area_m2, clipped_area_m2, clipped_area_ratio,
                centroid, geometry, created_at
            )
            SELECT
                :run_id, g.candidate_key, g.sido_code, g.sido_name,
                g.sigungu_code, g.sigungu_name, s.status, s.rank, s.provisional_score,
                s.total_score, s.zoning_score, s.road_score, s.equity_score, s.demand_score,
                s.profile_totals, s.profile_ranks, s.raw_components, s.exclusion_reasons,
                s.review_reasons, s.penalties, s.nearest_road_distance_m, s.nearest_road_provenance,
                s.component_provenance, g.original_area_m2, g.clipped_area_m2,
                CASE WHEN g.original_area_m2 > 0
                     THEN round((g.clipped_area_m2 / g.original_area_m2)::numeric, 5)
                     ELSE 0 END,
                g.centroid, g.geom, :now
            FROM _sc_grid g JOIN _sc_scores s ON g.gid = s.gid
            ON CONFLICT ON CONSTRAINT uq_suitability_candidates_run_key DO NOTHING
            RETURNING id
            """
        ),
        {"run_id": run_id, "now": now},
    )
    return sum(1 for _ in result)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def _default_progress(stage: str, detail: str) -> None:
    import sys

    print(f"[suitability-build] {stage}: {detail}", file=sys.stderr, flush=True)


def run_suitability_build(
    *,
    reference_year: int = 2024,
    policy_version: str = policy.POLICY_VERSION,
    profile: str = policy.DEFAULT_PROFILE,
    scope: str = "capital-region",
    write: bool = False,
    progress: ProgressFn | None = None,
) -> SuitabilityBuildReport:
    """Build (or reuse) one reproducible suitability analysis run."""

    emit = progress or _default_progress
    start = time.monotonic()

    if scope != "capital-region":
        raise SuitabilityBuildError("only --scope capital-region is implemented")
    if profile not in policy.WEIGHT_PROFILES:
        raise SuitabilityBuildError(
            f"unknown profile '{profile}'; allowed: {', '.join(policy.WEIGHT_PROFILES)}"
        )
    if policy_version != policy.POLICY_VERSION:
        raise SuitabilityBuildError(
            f"policy version '{policy_version}' != implemented {policy.POLICY_VERSION}"
        )
    policy.validate_policy()

    report = SuitabilityBuildReport(
        mode="write" if write else "dry-run",
        reference_year=reference_year,
        weight_profile=profile,
    )
    session = get_sessionmaker()()
    run_id: int | None = None
    try:
        emit("VALIDATING_INPUTS", f"resolving inputs for {reference_year}")
        inputs = _resolve_inputs(session, reference_year)
        signature = _analysis_signature(inputs, profile)
        report.analysis_signature = signature
        report.boundary_vintage = inputs.boundary_vintage
        report.input_dataset_version_ids = inputs.structural_version_ids
        report.input_provenance = {
            "structural_versions": inputs.structural_versions,
            "population_reference_period": inputs.population_reference_period,
            "waste_reference_period": inputs.waste_reference_period,
            "facility_reference_period": inputs.facility_reference_period,
        }

        existing = session.execute(
            text(
                "SELECT id FROM suitability_analysis_runs "
                "WHERE analysis_signature = :sig AND status = 'SUCCEEDED' "
                "ORDER BY id DESC LIMIT 1"
            ),
            {"sig": signature},
        ).scalar()
        if existing is not None and write:
            report.analysis_run_id = int(existing)
            report.created = False
            counts = (
                session.execute(
                    text(
                        "SELECT candidate_count_total, candidate_count_eligible, "
                        "candidate_count_review, candidate_count_excluded "
                        "FROM suitability_analysis_runs WHERE id = :id"
                    ),
                    {"id": existing},
                )
                .mappings()
                .first()
            )
            if counts:
                report.candidate_count_total = counts["candidate_count_total"]
                report.candidate_count_eligible = counts["candidate_count_eligible"]
                report.candidate_count_review = counts["candidate_count_review"]
                report.candidate_count_excluded = counts["candidate_count_excluded"]
            report.message = (
                f"suitability run already present for signature (idempotent); reused run {existing}"
            )
            emit("VERIFYING_WRITE", report.message)
            return report

        now = _utcnow()
        if write:
            run = _new_run_row(inputs, signature, profile, now)
            session.add(run)
            session.commit()
            session.refresh(run)
            run_id = int(run.id)
            report.analysis_run_id = run_id

        emit("GENERATING_GRID", f"{int(time.monotonic() - start)}s elapsed")
        grid_count = _build_grid(session)
        emit("GENERATING_GRID", f"{grid_count} candidate cells retained")

        emit("APPLYING_HARD_EXCLUSIONS", "spatial enrichment (exclusions, review, zoning, road)")
        facts = _enrich(session)
        emit("CALCULATING_ROAD_DISTANCE", f"{len(facts)} candidates enriched")

        emit("JOINING_EQUITY_CONTEXT", "per-SIGUNGU burden + demand")
        region = _region_components(session, reference_year)
        coverage_gaps = _coverage_gaps(session)

        emit("CALCULATING_SCORES", f"scoring {len(facts)} candidates")
        scored, exclusion_counts, review_counts = _score_candidates(
            facts, region, coverage_gaps, profile
        )
        report.candidate_count_total = len(scored)
        report.candidate_count_eligible = sum(
            1 for s in scored if s["status"] == policy.STATUS_ELIGIBLE
        )
        report.candidate_count_review = sum(
            1 for s in scored if s["status"] == policy.STATUS_REVIEW
        )
        report.candidate_count_excluded = sum(
            1 for s in scored if s["status"] == policy.STATUS_EXCLUDED
        )
        report.exclusion_reason_counts = exclusion_counts
        report.review_reason_counts = review_counts
        report.top_candidates = _top_candidates(session, scored, facts, profile)

        emit("RANKING", f"{report.candidate_count_eligible} eligible ranked")

        if write:
            assert run_id is not None
            emit("WRITING_RESULTS", f"persisting {len(scored)} candidates")
            inserted = _persist(session, run_id, scored, now)
            report.candidates_inserted = inserted
            _finalize_run(session, run_id, report, now)
            session.commit()
            emit("VERIFYING_WRITE", f"{inserted} candidate rows written")
            report.message = f"suitability build succeeded (run {run_id}, {inserted} candidates)"
        else:
            report.message = (
                f"dry-run: {report.candidate_count_total} candidates "
                f"({report.candidate_count_eligible} eligible, "
                f"{report.candidate_count_review} review, "
                f"{report.candidate_count_excluded} excluded); no rows written"
            )
        return report
    except Exception as exc:
        session.rollback()
        if write and run_id is not None:
            _mark_run_failed(session, run_id, exc)
        if isinstance(exc, SuitabilityBuildError):
            raise
        raise SuitabilityBuildError(f"suitability build failed and was rolled back: {exc}") from exc
    finally:
        session.execute(text("DROP TABLE IF EXISTS _sc_scores"))
        session.execute(text("DROP TABLE IF EXISTS _sc_grid"))
        session.commit()
        session.close()


def _new_run_row(
    inputs: ResolvedInputs, signature: str, profile: str, now: datetime.datetime
) -> Any:
    from ...models import SuitabilityAnalysisRun

    return SuitabilityAnalysisRun(
        derivation_version=policy.DERIVATION_VERSION,
        policy_version=policy.POLICY_VERSION,
        candidate_grid_version=policy.CANDIDATE_GRID_VERSION,
        reference_year=inputs.reference_year,
        boundary_vintage=inputs.boundary_vintage,
        weight_profile=profile,
        analysis_signature=signature,
        status="RUNNING",
        input_dataset_version_ids=inputs.structural_version_ids,
        input_provenance={
            "structural_versions": inputs.structural_versions,
            "population_reference_period": inputs.population_reference_period,
            "waste_reference_period": inputs.waste_reference_period,
            "facility_reference_period": inputs.facility_reference_period,
        },
        policy_snapshot=policy.policy_snapshot(),
        weight_profiles={
            p: {c: str(w) for c, w in weights.items()}
            for p, weights in policy.WEIGHT_PROFILES.items()
        },
        started_at=now,
        created_at=now,
    )


def _finalize_run(
    session: Session, run_id: int, report: SuitabilityBuildReport, now: datetime.datetime
) -> None:
    session.execute(
        text(
            """
            UPDATE suitability_analysis_runs SET
                status = 'SUCCEEDED', completed_at = :now,
                candidate_count_total = :total, candidate_count_eligible = :elig,
                candidate_count_review = :rev, candidate_count_excluded = :exc
            WHERE id = :id
            """
        ),
        {
            "now": now,
            "total": report.candidate_count_total,
            "elig": report.candidate_count_eligible,
            "rev": report.candidate_count_review,
            "exc": report.candidate_count_excluded,
            "id": run_id,
        },
    )


def _mark_run_failed(session: Session, run_id: int, exc: Exception) -> None:
    try:
        session.execute(
            text(
                "UPDATE suitability_analysis_runs SET status='FAILED', completed_at=:now, "
                "error_category=:cat, error_message=:msg WHERE id=:id"
            ),
            {
                "now": _utcnow(),
                "cat": exc.__class__.__name__[:50],
                "msg": str(exc)[:1000],
                "id": run_id,
            },
        )
        session.commit()
    except Exception:
        session.rollback()


def _top_candidates(
    session: Session,
    scored: list[dict[str, Any]],
    facts: list[dict[str, Any]],
    profile: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    key_by_gid = {f["gid"]: f["candidate_key"] for f in facts}
    sigungu_by_gid = {f["gid"]: f["sigungu_name"] for f in facts}
    eligible = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE]
    eligible.sort(key=lambda s: s["profile_ranks"].get(profile, 10**9))
    return [
        {
            "rank": s["profile_ranks"].get(profile),
            "candidate_key": key_by_gid.get(s["gid"]),
            "sigungu": sigungu_by_gid.get(s["gid"]),
            "total_score": s["profile_totals"].get(profile),
            "zoning_score": s["zoning_score"],
            "road_score": s["road_score"],
            "equity_score": s["equity_score"],
            "demand_score": s["demand_score"],
        }
        for s in eligible[:limit]
    ]
