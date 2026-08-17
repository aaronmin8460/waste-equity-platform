"""Successor component C — ``resident_impact`` (deterministic foundation).

Concept::

    resident_impact_raw(candidate) =
        SUM over regional population units r:
            population_r / max( distance(candidate, representative_r), distance_floor )

Direction: **lower raw impact → higher score**. A candidate with many residents
close by exposes more people; that is the worse screening outcome.

Three properties of this foundation are deliberate and enforced, not assumed:

**1. Distances are meter-correct, and the code refuses anything else.**
Every :class:`PopulationUnit` must declare how its distance was measured. Only
:data:`DISTANCE_MEASUREMENT_GEOGRAPHY_METERS` — PostGIS
``ST_Distance(geography, geography)``, i.e. geodesic metres on the spheroid — and
:data:`DISTANCE_MEASUREMENT_PROJECTED_METERS` (a projected metre CRS such as
EPSG:5179/5186) are accepted. Degrees, screen/SVG coordinates, and prototype x/y
values are rejected with ``INCOMPATIBLE_DISTANCE_MEASUREMENT``. The Python layer
therefore performs the exact ``Decimal`` weighting, while the *measurement* stays
in PostGIS where the geometry already lives.

**2. The distance floor is an explicit input with no production default.**
No approved production value exists yet, so :class:`DistanceFloor` must be
constructed by the caller with a positive value and a stated basis. There is no
module-level default constant to accidentally inherit, and
:mod:`.policy` lists the missing approval as an activation blocker. Tests use
explicit synthetic floors.

**3. The candidate's own containing region is NOT dropped.**
The old prototype's ``j != i`` self-exclusion belonged to a region-to-region
matrix. Candidates and population units are different analytical sets, so a
candidate inside a populated region genuinely exposes that region's residents.
The containing region participates like any other unit, at whatever distance the
geometry gives — commonly ``0``, which is exactly what the floor exists to bound.
See :data:`SELF_UNIT_EXCLUSION`.

For runtime derivation at scale, :func:`population_weighted_impact_sql` returns a
set-based PostGIS statement (one aggregate over the candidate × region join),
rather than a Python candidate-by-region nested loop.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from typing import Any

from . import contract
from .contract import ComponentObservation, ComponentSeries

METHOD_VERSION = "successor-resident-impact-v1"
COMPONENT = contract.COMPONENT_RESIDENT_IMPACT
DIRECTION = contract.LOWER_RAW_IS_BETTER
RAW_UNIT = "persons/m"

# Accepted distance measurements. Both are metre-correct; nothing else is.
DISTANCE_MEASUREMENT_GEOGRAPHY_METERS = "POSTGIS_GEOGRAPHY_METERS"
DISTANCE_MEASUREMENT_PROJECTED_METERS = "PROJECTED_CRS_METERS"

ACCEPTED_DISTANCE_MEASUREMENTS: frozenset[str] = frozenset(
    {DISTANCE_MEASUREMENT_GEOGRAPHY_METERS, DISTANCE_MEASUREMENT_PROJECTED_METERS}
)

# The containing population unit is never removed; see the module docstring.
SELF_UNIT_EXCLUSION = False
SELF_UNIT_NOTE = (
    "The population unit containing the candidate is included. Candidates and population "
    "units are different analytical sets, so a candidate inside a populated region does "
    "expose that region's residents; the distance floor — not an exclusion rule — bounds "
    "the zero-distance term."
)

# Exact-Decimal working precision and output quantization.
_WORKING_PRECISION = 60
_RAW_QUANT = Decimal("0.0000000001")  # 10 dp

METHOD_NOTE = (
    "Population-weighted inverse-distance exposure: SUM(population_r / max(distance_r, "
    "distance_floor)). Distances are metre-correct (geodesic geography metres or a projected "
    "metre CRS); the distance floor is an explicit, caller-supplied parameter."
)


class ResidentImpactConfigurationError(ValueError):
    """Raised when the resident-impact configuration is unusable as given."""


# --------------------------------------------------------------------------- #
# Representative geometry
# --------------------------------------------------------------------------- #

# Project-native conventions only. No external or invented coordinate source is
# permitted: a representative point must be derived from a boundary already stored
# in ``regions.geometry``.
REPRESENTATIVE_ST_POINT_ON_SURFACE = "ST_PointOnSurface"
REPRESENTATIVE_ST_CENTROID = "ST_Centroid"

REPRESENTATIVE_GEOMETRY_CONVENTIONS: dict[str, str] = {
    REPRESENTATIVE_ST_POINT_ON_SURFACE: (
        "A point guaranteed to lie inside the region polygon. Robust for concave and "
        "multipart administrative boundaries (coastal SIGUNGU, island annexes), where a "
        "centroid can fall outside the region entirely. Not currently used elsewhere in "
        "this repository."
    ),
    REPRESENTATIVE_ST_CENTROID: (
        "The area centroid. This is the convention the existing suitability grid already "
        "uses for *candidate cell* representative points and for region assignment "
        "(engine._build_grid). It may fall outside a concave or multipart region, which "
        "matters more for a whole SIGUNGU boundary than for a 500 m square cell."
    ),
}

# Neither convention is pre-selected for production: the choice changes every
# distance and therefore belongs to the same approval as the distance floor.
REPRESENTATIVE_GEOMETRY_SELECTION_NOTE = (
    "The representative-geometry convention is an explicit caller input. The historical "
    "grid uses ST_Centroid for 500 m cells; ST_PointOnSurface is the safer choice for "
    "irregular administrative boundaries. Selecting one for production is an analytical "
    "decision, not an implementation detail."
)


@dataclass(frozen=True)
class RepresentativeGeometry:
    """The project-native representative-point convention for population units."""

    convention: str
    geometry_column: str = "geometry"

    def __post_init__(self) -> None:
        if self.convention not in REPRESENTATIVE_GEOMETRY_CONVENTIONS:
            raise ResidentImpactConfigurationError(
                f"unknown representative-geometry convention {self.convention!r}; "
                f"expected one of {sorted(REPRESENTATIVE_GEOMETRY_CONVENTIONS)}"
            )
        if not self.geometry_column.isidentifier():
            raise ResidentImpactConfigurationError(
                f"geometry_column {self.geometry_column!r} must be a plain column identifier"
            )

    def sql_expression(self, table_alias: str) -> str:
        """The SQL expression producing this unit's representative point."""

        if not table_alias.isidentifier():
            raise ResidentImpactConfigurationError(
                f"table_alias {table_alias!r} must be a plain SQL identifier"
            )
        return f"{self.convention}({table_alias}.{self.geometry_column})"

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "convention": self.convention,
            "geometry_column": self.geometry_column,
            "rationale": REPRESENTATIVE_GEOMETRY_CONVENTIONS[self.convention],
            "selection_note": REPRESENTATIVE_GEOMETRY_SELECTION_NOTE,
        }


# --------------------------------------------------------------------------- #
# Distance floor
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DistanceFloor:
    """The explicit lower bound on the distance denominator, in metres.

    There is intentionally **no default**. The floor determines how much a
    zero-distance or near-zero-distance population unit contributes, so it changes
    every raw value and every rank. ``approved`` stays ``False`` until an approved
    production value exists; a caller that sets it to ``True`` is asserting a
    reviewed decision, and :mod:`.policy` still gates activation separately.
    """

    distance_floor_m: Decimal
    basis: str
    approved: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.distance_floor_m, Decimal):
            raise ResidentImpactConfigurationError(
                "distance_floor_m must be an exact Decimal, never a binary float"
            )
        if self.distance_floor_m.is_nan() or self.distance_floor_m.is_infinite():
            raise ResidentImpactConfigurationError("distance_floor_m must be finite")
        if self.distance_floor_m <= 0:
            raise ResidentImpactConfigurationError(
                f"distance_floor_m must be strictly positive (got {self.distance_floor_m})"
            )
        if not self.basis.strip():
            raise ResidentImpactConfigurationError(
                "distance floor requires an explicit stated basis (where the value comes from)"
            )

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "distance_floor_m": format(self.distance_floor_m, "f"),
            "basis": self.basis,
            "approved": self.approved,
        }


# --------------------------------------------------------------------------- #
# The approved production floor
# --------------------------------------------------------------------------- #

# 500 m, adopted by the project-owner delegated policy closure of 2026-08-17.
#
# Basis — the model's own spatial resolution. The candidate grid is
# ``capital-grid-500m-v1`` with ``GRID_CELL_METERS = 500``, so 500 m is exactly one
# cell. The floor says: this model does not resolve distance below the size of the
# thing it is scoring. That is a reproducible, in-repo fact rather than a tuned
# value, and it is the smallest floor with a coherent interpretation.
#
# Measured basis for preferring the smallest option (run 47, approved weights, on
# the ranking population): the floor is nearly inert in the composite. Adjacent
# steps retain 50/50, 50/50 and 49/50 of the top 50, at Spearman 0.99996, 0.99966
# and 0.99886. No floor is materially more stable than its neighbour, so the tie
# is broken toward the simplest local interpretation.
#
# LIMITATION, carried in writing rather than solved. The floor does NOT fix the
# component's underlying geography defect. Population is one value per SIGUNGU held
# at a single representative point, and every candidate floor is smaller than the
# average region's own equivalent-circle radius. The within-region score range —
# an upper bound on the placement artifact — only falls from 46.71 to 40.55 across
# a tenfold increase in the floor, so no available floor controls that artifact.
# Choosing 500 m does not claim otherwise; see
# RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED in the accepted-limitation
# register.
PRODUCTION_DISTANCE_FLOOR_M = Decimal("500")

PRODUCTION_DISTANCE_FLOOR = DistanceFloor(
    distance_floor_m=PRODUCTION_DISTANCE_FLOOR_M,
    basis=(
        "One candidate grid cell: capital-grid-500m-v1 has GRID_CELL_METERS = 500, so the "
        "model does not resolve distance below its own spatial resolution. Approved by "
        "project-owner delegated policy closure 2026-08-17 "
        "(docs/research/SUITABILITY_V3_FINAL_POLICY.md). Does not resolve the SIGUNGU-grain "
        "population geography limitation, which no available floor controls."
    ),
    approved=True,
)


# --------------------------------------------------------------------------- #
# Inputs
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class PopulationUnit:
    """One regional population unit and its measured distance to the candidate."""

    unit_code: str
    population: int | None
    distance_m: Decimal | None
    distance_measurement: str
    representative_geometry: str | None = None
    population_source_id: str | None = None
    population_reference_period: str | None = None


@dataclass(frozen=True)
class ResidentImpactInput:
    """The source facts for one candidate's resident-impact observation."""

    candidate_key: str
    units: tuple[PopulationUnit, ...] = ()
    extra_provenance: dict[str, Any] = field(default_factory=dict)


def _provenance(inp: ResidentImpactInput, floor: DistanceFloor) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "component": COMPONENT,
        "method_version": METHOD_VERSION,
        "raw_unit": RAW_UNIT,
        "distance_floor": floor.sanitized_summary(),
        "accepted_distance_measurements": sorted(ACCEPTED_DISTANCE_MEASUREMENTS),
        "self_unit_exclusion": SELF_UNIT_EXCLUSION,
        "self_unit_note": SELF_UNIT_NOTE,
        "population_resolution_disclosure": POPULATION_RESOLUTION_DISCLOSURE,
        "normalization": contract.NORMALIZATION,
        "direction": DIRECTION,
        "note": METHOD_NOTE,
    }
    provenance.update(inp.extra_provenance)
    return provenance


def observe(inp: ResidentImpactInput, floor: DistanceFloor) -> ComponentObservation:
    """Derive one candidate's ``resident_impact`` observation.

    Any unusable population unit makes the whole observation unavailable: dropping
    the unit would silently understate exposure, which is the same failure as
    zero-filling it. A population of exactly ``0`` is a valid measured value and
    contributes ``0`` — it is not "missing".
    """

    inputs: dict[str, Any] = {
        "population_unit_count": len(inp.units),
        "distance_floor_m": format(floor.distance_floor_m, "f"),
        "self_unit_exclusion": SELF_UNIT_EXCLUSION,
    }
    provenance = _provenance(inp, floor)

    if not inp.units:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.candidate_key,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=(contract.REASON_NO_POPULATION_UNITS,),
            inputs=inputs,
            provenance=provenance,
        )

    reasons: list[str] = []
    invalid_population: list[str] = []
    missing_distance: list[str] = []
    invalid_distance: list[str] = []
    bad_measurement: list[str] = []

    for unit in inp.units:
        if unit.population is None or unit.population < 0:
            invalid_population.append(unit.unit_code)
        if unit.distance_m is None:
            missing_distance.append(unit.unit_code)
        elif unit.distance_m.is_nan() or unit.distance_m.is_infinite() or unit.distance_m < 0:
            invalid_distance.append(unit.unit_code)
        if unit.distance_measurement not in ACCEPTED_DISTANCE_MEASUREMENTS:
            bad_measurement.append(unit.unit_code)

    if invalid_population:
        reasons.append(contract.REASON_INVALID_POPULATION)
        inputs["invalid_population_units"] = contract.sorted_unique(invalid_population)
    if missing_distance:
        reasons.append(contract.REASON_MISSING_DISTANCE)
        inputs["missing_distance_units"] = contract.sorted_unique(missing_distance)
    if invalid_distance:
        reasons.append(contract.REASON_INVALID_DISTANCE)
        inputs["invalid_distance_units"] = contract.sorted_unique(invalid_distance)
    if bad_measurement:
        reasons.append(contract.REASON_INCOMPATIBLE_DISTANCE_MEASUREMENT)
        inputs["incompatible_distance_measurement_units"] = contract.sorted_unique(bad_measurement)
        inputs["accepted_distance_measurements"] = sorted(ACCEPTED_DISTANCE_MEASUREMENTS)

    if reasons:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.candidate_key,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=contract.sorted_unique(reasons),
            inputs=inputs,
            provenance=provenance,
        )

    floored_unit_codes: list[str] = []
    total_population = 0
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        accumulated = Decimal("0")
        # Deterministic accumulation order: exact Decimal addition is associative
        # here, and sorting keeps the intermediate context independent of caller
        # ordering.
        for unit in sorted(inp.units, key=lambda u: u.unit_code):
            assert unit.population is not None and unit.distance_m is not None
            total_population += unit.population
            effective = unit.distance_m
            if effective < floor.distance_floor_m:
                effective = floor.distance_floor_m
                floored_unit_codes.append(unit.unit_code)
            accumulated += Decimal(unit.population) / effective
        raw = accumulated

    inputs["total_population"] = total_population
    inputs["floored_unit_count"] = len(floored_unit_codes)
    inputs["floored_units"] = contract.sorted_unique(floored_unit_codes)
    inputs["units"] = [
        {
            "unit_code": unit.unit_code,
            "population": unit.population,
            "distance_m": format(unit.distance_m, "f") if unit.distance_m is not None else None,
            "distance_measurement": unit.distance_measurement,
            "representative_geometry": unit.representative_geometry,
            "population_source_id": unit.population_source_id,
            "population_reference_period": unit.population_reference_period,
        }
        for unit in sorted(inp.units, key=lambda u: u.unit_code)
    ]

    return ComponentObservation(
        component=COMPONENT,
        unit_key=inp.candidate_key,
        raw_value=raw.quantize(_RAW_QUANT, rounding=ROUND_HALF_EVEN),
        raw_unit=RAW_UNIT,
        inputs=inputs,
        provenance=provenance,
    )


def build_series(inputs: Sequence[ResidentImpactInput], floor: DistanceFloor) -> ComponentSeries:
    """Observe every candidate and assemble the deterministic component series."""

    observations = [observe(item, floor) for item in inputs]
    return contract.build_series(
        component=COMPONENT,
        method_version=METHOD_VERSION,
        direction=DIRECTION,
        raw_unit=RAW_UNIT,
        observations=observations,
        provenance={
            "method_version": METHOD_VERSION,
            "distance_floor": floor.sanitized_summary(),
            "self_unit_exclusion": SELF_UNIT_EXCLUSION,
            "self_unit_note": SELF_UNIT_NOTE,
            "population_resolution_disclosure": POPULATION_RESOLUTION_DISCLOSURE,
            "note": METHOD_NOTE,
        },
        disclaimer=(
            "Population-weighted proximity exposure. It is not a modelled nuisance, noise, "
            "odour, traffic, or health-impact estimate, and it does not account for "
            "topography, prevailing wind, land use, or actual facility design. "
            + POPULATION_RESOLUTION_DISCLOSURE
        ),
    )


def normalized_scores(
    inputs: Sequence[ResidentImpactInput], floor: DistanceFloor
) -> dict[str, Decimal]:
    """Convenience: dimensionless [0,100] scores keyed by candidate key."""

    return build_series(inputs, floor).normalized_scores()


# --------------------------------------------------------------------------- #
# Set-based runtime derivation (PostGIS)
# --------------------------------------------------------------------------- #


def population_weighted_impact_sql(
    representative: RepresentativeGeometry,
    *,
    distance_measurement: str = DISTANCE_MEASUREMENT_GEOGRAPHY_METERS,
) -> str:
    """Return the set-based PostGIS statement for the raw resident-impact sum.

    One aggregate over the candidate × population-unit join — never a Python
    candidate-by-region nested loop. The statement takes three bind parameters:

    ``:run_id``
        the ``suitability_candidates.analysis_run_id`` whose cells are scored;
    ``:reference_year``
        the population reference year (the population denominator's own vintage);
    ``:distance_floor_m``
        the explicit distance floor, in metres — there is no default.

    Distances are measured with ``::geography`` (geodesic metres on the spheroid),
    so the result is metre-correct regardless of the storage CRS. The join is
    deliberately unrestricted: the population unit containing a candidate is
    included like every other unit (see :data:`SELF_UNIT_EXCLUSION`).

    The statement is returned as text for review, logging, and execution by a
    caller that owns the session; this module executes nothing.
    """

    if distance_measurement not in ACCEPTED_DISTANCE_MEASUREMENTS:
        raise ResidentImpactConfigurationError(
            f"unsupported distance measurement {distance_measurement!r}; "
            f"expected one of {sorted(ACCEPTED_DISTANCE_MEASUREMENTS)}"
        )
    if distance_measurement != DISTANCE_MEASUREMENT_GEOGRAPHY_METERS:
        raise ResidentImpactConfigurationError(
            "the set-based statement measures distance with ST_Distance(::geography); "
            "a projected-metre variant must be written explicitly against its CRS"
        )
    representative_expression = representative.sql_expression("r")
    distance = f"ST_Distance(c.centroid::geography, {representative_expression}::geography)"
    return f"""
        -- resident_impact raw sum ({METHOD_VERSION})
        -- SUM(population / GREATEST(geodesic_distance_m, :distance_floor_m))
        -- Every population unit participates, including the one containing the
        -- candidate: candidates and population units are different analytical sets.
        SELECT
            c.candidate_key,
            count(*) AS population_unit_count,
            count(*) FILTER (WHERE {distance} < :distance_floor_m) AS floored_unit_count,
            sum(p.population) AS total_population,
            sum(
                p.population::numeric
                / GREATEST({distance}::numeric, :distance_floor_m::numeric)
            ) AS resident_impact_raw
        FROM suitability_candidates c
        JOIN regions r
          ON r.region_level = 'SIGUNGU'
         AND r.geometry IS NOT NULL
        JOIN regional_population p
          ON p.region_id = r.id
         AND p.reference_year = :reference_year
         AND p.reference_month IS NULL
        WHERE c.analysis_run_id = :run_id
        GROUP BY c.candidate_key
        HAVING count(*) FILTER (WHERE p.population IS NULL) = 0
        ORDER BY c.candidate_key
    """


def representative_point_audit_sql() -> str:
    """Return the audit statement comparing both representative-point conventions.

    A region's centroid and its point-on-surface are **not** interchangeable here.
    ``ST_Centroid`` of a multipart geometry is the area-weighted mean of its parts,
    which for an archipelago (인천 옹진군, 강화군) or a mainland-plus-island district
    (안산시 단원구) can fall in open water — outside every constituent polygon —
    placing a whole county's population where nobody lives.
    ``ST_PointOnSurface`` is guaranteed to land on the surface, but on a multipart
    geometry it lands on *one* part, which is a plausible-looking answer rather than
    a representative one.

    Neither point is correct; the choice determines *how* wrong the near field is.
    So this statement records both, the containment predicate, and their separation
    for every region, and the caller stores them in the component's provenance —
    the same discipline the land-cover derivation applies when it stores
    ``topological_cover_predicate`` beside the residual-based coverage status.

    Bind parameters: ``:boundary_vintage_year``.
    """

    return """
        -- resident_impact representative-point divergence audit
        -- Records BOTH conventions plus the disagreement; picks neither.
        SELECT
            r.region_code,
            r.region_name,
            ST_NumGeometries(r.geometry)                          AS part_count,
            ST_Contains(r.geometry, ST_Centroid(r.geometry))      AS centroid_inside_region,
            ST_Distance(
                ST_Centroid(r.geometry)::geography,
                ST_PointOnSurface(r.geometry)::geography
            )                                                     AS centroid_to_surface_point_m,
            ST_Area(r.geometry::geography)                        AS region_area_m2,
            sqrt(ST_Area(r.geometry::geography) / pi())           AS equivalent_circle_radius_m
        FROM regions r
        WHERE r.region_level = 'SIGUNGU'
          AND r.geometry IS NOT NULL
          AND extract(year FROM r.valid_from)::int = :boundary_vintage_year
        ORDER BY centroid_inside_region, centroid_to_surface_point_m DESC
    """


def representative_point_divergence_flags(
    *,
    centroid_inside_region: bool,
    centroid_to_surface_point_m: Decimal,
    equivalent_circle_radius_m: Decimal,
) -> tuple[str, ...]:
    """Flags for a region whose two representative points disagree materially.

    Returns stable codes rather than a boolean so the specific problem survives into
    provenance. Under the project's ``missing ≠ safe`` discipline these are surfaced
    as review-visible caveats; they are never a reason to silently drop the region
    from the sum, which would understate exposure.
    """

    flags: list[str] = []
    if not centroid_inside_region:
        flags.append("CENTROID_OUTSIDE_REGION")
    if centroid_to_surface_point_m > equivalent_circle_radius_m:
        flags.append("REPRESENTATIVE_POINTS_DIVERGE_BEYOND_REGION_RADIUS")
    return tuple(flags)


# Every representative point is one point mass standing in for a whole region's
# residents. No choice of point changes that, and no output may imply otherwise.
POPULATION_RESOLUTION_DISCLOSURE = (
    "Population is modelled at SIGUNGU resolution from a single representative point per "
    "region. This is not the location of that region's residents, and the component's "
    "apparent per-cell precision exceeds the resolution of the underlying population data."
)


def sql_contract_summary(representative: RepresentativeGeometry) -> dict[str, Any]:
    """Sanitized description of the set-based derivation (no credentials, no paths)."""

    return {
        "component": COMPONENT,
        "method_version": METHOD_VERSION,
        "execution": "set-based PostGIS aggregate over candidate x population-unit join",
        "distance_measurement": DISTANCE_MEASUREMENT_GEOGRAPHY_METERS,
        "representative_geometry": representative.sanitized_summary(),
        "bind_parameters": ["run_id", "reference_year", "distance_floor_m"],
        "self_unit_exclusion": SELF_UNIT_EXCLUSION,
        "self_unit_note": SELF_UNIT_NOTE,
        "representative_point_audit": "see representative_point_audit_sql()",
        "population_resolution_disclosure": POPULATION_RESOLUTION_DISCLOSURE,
        "missing_population_policy": (
            "A population unit with a NULL population disqualifies the candidate's sum "
            "(HAVING clause) rather than being dropped or zero-filled."
        ),
    }
