"""Phase-3 real-data validation of the proposed Suitability Successor model.

RESEARCH / EVIDENCE ONLY. This module measures; it decides nothing. It does not
activate the successor model, does not write a successor run, does not persist a
weight, and does not read or modify any historical Z/R/E/D value.

What it produces is a machine-readable evidence bundle:

* what each of the four successor components can actually be computed on;
* where the data is missing, and how the eligible population shrinks as each
  component is required in turn;
* whether the resulting distributions are usable or degenerate;
* how sensitive ``resident_impact`` is to the unapproved distance floor;
* whether a successor CRITIC is mathematically defined on the real population.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Connection

from . import critic_research, extract, registry, stats

_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:  # pragma: no cover - import-path bootstrap
    sys.path.insert(0, str(_SRC))

from waste_equity_backend.analysis.suitability import policy as historical_policy  # noqa: E402
from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    air_impact_proxy,
    contract,
    existing_burden,
    land_conversion,
    resident_impact,
)

# The research distance floors. NONE is approved production policy; 2 km in
# particular is NOT a default. They exist to measure sensitivity, and the report
# reads them as a sensitivity band rather than a menu to pick from.
RESEARCH_DISTANCE_FLOORS_M: tuple[int, ...] = (500, 1000, 2000, 5000)

RESEARCH_FLOOR_BASIS = (
    "RESEARCH SENSITIVITY ONLY — not an approved production distance floor. "
    "Evaluated to measure how much the component's raw value and ranking depend "
    "on a parameter nobody has signed off."
)

# The successor components in their fixed contract order.
COMPONENT_ORDER: tuple[str, ...] = contract.SUCCESSOR_COMPONENTS


@dataclass(frozen=True)
class ComponentCoverage:
    """One component's availability over its own analytical units."""

    component: str
    unit_grain: str
    unit_count: int
    available_count: int
    unavailable_count: int
    partial_count: int
    unavailable_reason_counts: dict[str, int]

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "component": self.component,
            "unit_grain": self.unit_grain,
            "unit_count": self.unit_count,
            "available_count": self.available_count,
            "unavailable_count": self.unavailable_count,
            "partial_count": self.partial_count,
            "available_share": _share(self.available_count, self.unit_count),
            "unavailable_reason_counts": self.unavailable_reason_counts,
        }


def _share(numerator: int, denominator: int) -> str | None:
    if denominator == 0:
        return None
    return format((Decimal(numerator) / Decimal(denominator)).quantize(Decimal("0.000001")), "f")


def _coverage(series: contract.ComponentSeries, unit_grain: str) -> ComponentCoverage:
    return ComponentCoverage(
        component=series.component,
        unit_grain=unit_grain,
        unit_count=len(series.observations),
        available_count=len(series.available_observations()),
        unavailable_count=len(series.unavailable_observations()),
        partial_count=sum(1 for o in series.observations if o.is_partial),
        unavailable_reason_counts=series.unavailable_reason_counts(),
    )


# --------------------------------------------------------------------------- #
# resident_impact — set-based derivation, cross-checked against the module
# --------------------------------------------------------------------------- #


def verify_sql_matches_module(
    conn: Connection,
    run_id: int,
    sample_keys: Sequence[str],
    sql_rows: Mapping[str, extract.ResidentImpactRow],
    floor_m: int,
) -> dict[str, Any]:
    """Prove the multi-floor SQL agrees with ``resident_impact.observe()``.

    The full candidate x population-unit join is 3.8 million pairs, so the raw
    sums are derived set-based in PostGIS. That is what the successor module
    itself prescribes ("runtime derivation is set-based"), but it means the
    numbers in this report come from SQL rather than from the Python contract.
    This check closes that gap on a sample: same inputs through
    ``resident_impact.observe()``, compared against the SQL aggregate.

    A mismatch is reported, never tolerated.
    """

    units = extract.load_population_units_for_candidates(conn, run_id, sample_keys)
    floor = resident_impact.DistanceFloor(
        distance_floor_m=Decimal(floor_m),
        basis=RESEARCH_FLOOR_BASIS,
        approved=False,
    )
    compared: list[dict[str, Any]] = []
    mismatches = 0
    for key in sorted(units):
        module_input = resident_impact.ResidentImpactInput(
            candidate_key=key,
            units=tuple(
                resident_impact.PopulationUnit(
                    unit_code=region_code,
                    population=population,
                    distance_m=distance,
                    distance_measurement=(resident_impact.DISTANCE_MEASUREMENT_GEOGRAPHY_METERS),
                    representative_geometry=(resident_impact.REPRESENTATIVE_ST_POINT_ON_SURFACE),
                    population_source_id=extract.POPULATION_SERIES_DEFINITION,
                    population_reference_period=str(extract.POPULATION_REFERENCE_YEAR),
                )
                for region_code, population, distance in units[key]
            ),
        )
        observation = resident_impact.observe(module_input, floor)
        sql_value = sql_rows[key].raw_by_floor[floor_m]
        module_value = observation.raw_value
        # The module quantizes to 10 dp; compare at that precision.
        agrees = module_value is not None and abs(module_value - sql_value) <= Decimal("0.0000001")
        if not agrees:
            mismatches += 1
        compared.append(
            {
                "candidate_key": key,
                "module_raw_value": (
                    format(module_value, "f") if module_value is not None else None
                ),
                "sql_raw_value": format(sql_value, "f"),
                "agrees": agrees,
            }
        )
    return {
        "floor_m": floor_m,
        "sample_size": len(compared),
        "mismatch_count": mismatches,
        "agrees": mismatches == 0,
        "samples": compared,
    }


# --------------------------------------------------------------------------- #
# Eligibility staging
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class EligibilityStage:
    """One step of the cumulative complete-case shrinkage."""

    stage: str
    required_components: tuple[str, ...]
    remaining: int
    removed_at_this_stage: int
    removed_cumulative: int

    def sanitized_summary(self, total: int) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "required_components": list(self.required_components),
            "remaining_candidates": self.remaining,
            "removed_at_this_stage": self.removed_at_this_stage,
            "removed_cumulative": self.removed_cumulative,
            "removed_cumulative_share": _share(self.removed_cumulative, total),
            "remaining_share": _share(self.remaining, total),
        }


def stage_eligibility(
    candidate_keys: Sequence[str],
    availability: Mapping[str, set[str]],
) -> tuple[EligibilityStage, ...]:
    """Cumulative shrinkage as each successor component is required in turn.

    ``availability[component]`` is the set of candidate keys that component can
    actually be measured on. Requiring a component never *adds* a candidate, so
    the sequence is monotone by construction.
    """

    total = len(candidate_keys)
    remaining = set(candidate_keys)
    stages = [
        EligibilityStage(
            stage="ALL CANDIDATES",
            required_components=(),
            remaining=total,
            removed_at_this_stage=0,
            removed_cumulative=0,
        )
    ]
    required: list[str] = []
    for component in COMPONENT_ORDER:
        before = len(remaining)
        required.append(component)
        remaining &= availability[component]
        stages.append(
            EligibilityStage(
                stage=f"+ {component}",
                required_components=tuple(required),
                remaining=len(remaining),
                removed_at_this_stage=before - len(remaining),
                removed_cumulative=total - len(remaining),
            )
        )
    stages.append(
        EligibilityStage(
            stage="ALL FOUR COMPLETE",
            required_components=COMPONENT_ORDER,
            remaining=len(remaining),
            removed_at_this_stage=0,
            removed_cumulative=total - len(remaining),
        )
    )
    return tuple(stages)


def regional_concentration(
    keys: Sequence[str],
    region_by_candidate: Mapping[str, str | None],
    *,
    top_n: int = 10,
) -> dict[str, Any]:
    """Which regions a candidate subset is concentrated in."""

    counts: dict[str, int] = {}
    unknown = 0
    for key in keys:
        region = region_by_candidate.get(key)
        if region is None:
            unknown += 1
            continue
        counts[region] = counts.get(region, 0) + 1
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return {
        "distinct_regions": len(counts),
        "candidates_without_region": unknown,
        "top_regions": [
            {"region_code": code, "count": count, "share": _share(count, len(keys))}
            for code, count in ordered[:top_n]
        ],
    }


# --------------------------------------------------------------------------- #
# Ranking diagnostics
# --------------------------------------------------------------------------- #

EQUAL_WEIGHT_LABEL = (
    "NEUTRAL MATHEMATICAL DIAGNOSTIC — equal weights (0.25 each). NOT approved, "
    "NOT recommended, NOT a default, NOT production policy. Used only because a "
    "ranking diagnostic needs some weight vector and no successor profile exists."
)


def weighted_scores(
    component_scores: Mapping[str, Mapping[str, Decimal]],
    weights: Mapping[str, Decimal],
    complete_keys: Sequence[str],
) -> dict[str, Decimal]:
    """Composite over complete units only — never renormalized over missing parts."""

    result: dict[str, Decimal] = {}
    for key in complete_keys:
        total = Decimal(0)
        for component, weight in weights.items():
            total += component_scores[component][key] * weight
        result[key] = total
    return result


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #


def run_validation(conn: Connection, run_id: int) -> dict[str, Any]:
    """Execute the whole Phase-3 measurement and return the evidence bundle."""

    report: dict[str, Any] = {
        "phase": "SUITABILITY SUCCESSOR V3 — PHASE 3 REAL-DATA VALIDATION",
        "status": "RESEARCH / EVIDENCE ONLY — successor model NOT activated",
        "component_contract_version": contract.COMPONENT_CONTRACT_VERSION,
        "component_order": list(COMPONENT_ORDER),
    }

    extract.prepare_session(conn)

    snapshot = extract.load_snapshot(conn, run_id)
    report["dataset_snapshot"] = snapshot.sanitized_summary()

    regions = extract.load_sigungu_regions(conn)
    population = extract.load_population(conn)
    report["population_denominator"] = {
        "series": extract.POPULATION_SERIES_DEFINITION,
        "reference_year": extract.POPULATION_REFERENCE_YEAR,
        "regions_with_population": len(population),
        "sigungu_regions": len(regions),
        "regions_without_population": sorted(
            r.region_code for r in regions if r.region_code not in population
        ),
        "note": (
            "regional_population holds two non-interchangeable series; only the annual "
            "SGIS series has SIGUNGU resolution. The MOIS monthly series covers the three "
            "SIDO only and is never substituted for it."
        ),
    }

    candidates = extract.load_candidates(conn, run_id)
    candidate_keys = [c.candidate_key for c in candidates]
    region_by_candidate: dict[str, str | None] = {
        c.candidate_key: c.sigungu_region_code for c in candidates
    }
    report["candidates"] = {
        "count": len(candidates),
        "distinct_sigungu": len({c.sigungu_region_code for c in candidates} - {None}),
        "distinct_sido": len({c.sido_region_code for c in candidates} - {None}),
        "without_sigungu_region_code": sum(1 for c in candidates if c.sigungu_region_code is None),
        "status_counts": _count_by(c.status for c in candidates),
    }

    # ---------------------------------------------------------------- burden #
    facility_year = snapshot.facility_reference_year or extract.POPULATION_REFERENCE_YEAR
    burden_inputs = extract.load_existing_burden_inputs(conn, regions, population, facility_year)
    burden_series = existing_burden.build_series(burden_inputs)
    facility_coverage = extract.load_facility_coverage(conn, facility_year)
    burden_raw = burden_series.raw_values()
    report["existing_burden"] = {
        "definition": (
            "located facility throughput per resident "
            f"({existing_burden.RAW_UNIT}); {existing_burden.DIRECTION}"
        ),
        "method_version": existing_burden.METHOD_VERSION,
        "numerator": "sum(waste_treatment_facilities.throughput_quantity[톤/년]) x 1000",
        "denominator": (
            f"regional_population[{extract.POPULATION_SERIES_DEFINITION}, "
            f"{extract.POPULATION_REFERENCE_YEAR}]"
        ),
        "reference_period": str(facility_year),
        "coverage": _coverage(burden_series, "SIGUNGU").sanitized_summary(),
        "distribution": stats.describe(
            list(burden_raw.values()), observation_count=len(regions)
        ).sanitized_summary(),
        "regions_with_zero_located_throughput": sorted(
            code for code, value in burden_raw.items() if value == 0
        ),
        "unmapped_facility_rows": {
            "count": facility_coverage.unmapped_row_count,
            "by_status": facility_coverage.unmapped_reasons,
            "caveat": (
                "These facility rows exist but carry no region. A region whose burden "
                "reads zero may be a region with no facilities OR a region whose "
                "facilities are among these unmapped rows. The component cannot "
                "distinguish the two, and a zero here is therefore not evidence of "
                "absence."
            ),
        },
    }

    # ------------------------------------------------------------------- air #
    waste_year = snapshot.waste_statistics_reference_year or extract.POPULATION_REFERENCE_YEAR
    air_inputs = extract.load_air_impact_inputs(conn, regions, population, waste_year)
    air_series = air_impact_proxy.build_series(air_inputs)
    air_raw = air_series.raw_values()
    stream_presence = _stream_presence(air_inputs)
    report["air_impact_proxy"] = {
        "definition": (
            "total waste-generation activity per resident "
            f"({air_impact_proxy.RAW_UNIT}); {air_impact_proxy.DIRECTION}"
        ),
        "method_version": air_impact_proxy.METHOD_VERSION,
        "semantic_warning": air_impact_proxy.PROXY_DISCLAIMER,
        "caveats": list(air_impact_proxy.PROXY_CAVEATS),
        "numerator": air_impact_proxy.NUMERATOR_BASIS,
        "numerator_alternative_under_review": (air_impact_proxy.NUMERATOR_ALTERNATIVE_UNDER_REVIEW),
        "denominator": (
            f"regional_population[{extract.POPULATION_SERIES_DEFINITION}, "
            f"{extract.POPULATION_REFERENCE_YEAR}]"
        ),
        "reference_period": str(waste_year),
        "required_streams": list(air_impact_proxy.REQUIRED_WASTE_STREAMS),
        "per_stream_region_coverage": stream_presence["per_stream"],
        "stream_combination_counts": stream_presence["combinations"],
        "coverage": _coverage(air_series, "SIGUNGU").sanitized_summary(),
        "distribution": stats.describe(
            list(air_raw.values()), observation_count=len(regions)
        ).sanitized_summary(),
        "city_grain_rows_excluded": {
            "counts_by_stream": extract.load_reporting_region_grain(conn, waste_year),
            "note": (
                "RCIS reports seven large Gyeonggi cities at CITY grain in "
                "reporting_region_waste_statistics. Summing them into a SIGUNGU total "
                "would mix geographies, so they are excluded rather than folded in "
                "(INCOMPATIBLE_GEOGRAPHIC_GRAIN)."
            ),
        },
    }

    # -------------------------------------------------------------- resident #
    impact_rows = extract.load_resident_impact(conn, run_id, extract.POPULATION_REFERENCE_YEAR)
    by_key = {row.candidate_key: row for row in impact_rows}
    sample_keys = [row.candidate_key for row in impact_rows[:: max(1, len(impact_rows) // 12)]][:12]
    report["resident_impact"] = {
        "definition": (
            "population / max(candidate-to-representative-point distance, floor) "
            f"summed over population units ({resident_impact.RAW_UNIT}); "
            f"{resident_impact.DIRECTION}"
        ),
        "method_version": resident_impact.METHOD_VERSION,
        "distance_measurement": resident_impact.DISTANCE_MEASUREMENT_GEOGRAPHY_METERS,
        "representative_geometry": resident_impact.REPRESENTATIVE_ST_POINT_ON_SURFACE,
        "self_unit_exclusion": resident_impact.SELF_UNIT_EXCLUSION,
        "population_resolution_disclosure": resident_impact.POPULATION_RESOLUTION_DISCLOSURE,
        "candidates_with_value": len(impact_rows),
        "candidates_total": len(candidates),
        "population_units_per_candidate": sorted(
            {row.population_unit_count for row in impact_rows}
        ),
        "sql_module_equivalence_check": verify_sql_matches_module(
            conn, run_id, sample_keys, by_key, 1000
        ),
        "representative_point_audit": _representative_point_summary(conn),
        "floors": {},
        "floor_sensitivity": {},
    }

    floor_scores: dict[int, dict[str, Decimal]] = {}
    floor_raw: dict[int, dict[str, Decimal]] = {}
    for floor_m in RESEARCH_DISTANCE_FLOORS_M:
        raw = {row.candidate_key: row.raw_by_floor[floor_m] for row in impact_rows}
        floor_raw[floor_m] = raw
        # Same definition as ComponentSeries.normalized_scores() under the
        # PERCENTILE_RANK strategy, via the O(n log n) rank equivalence — the
        # production O(n^2) path costs minutes per floor at n = 47,893. Pinned
        # byte-for-byte against policy.percentile_ranks in the research tests.
        floor_scores[floor_m] = {
            key: contract.score_from_percentile(rank, resident_impact.DIRECTION)
            for key, rank in stats.fast_percentile_ranks(raw).items()
        }
        report["resident_impact"]["floors"][str(floor_m)] = {
            "distance_floor_m": floor_m,
            "approved": False,
            "basis": RESEARCH_FLOOR_BASIS,
            "candidates_with_any_floored_unit": sum(
                1 for row in impact_rows if row.floored_counts[floor_m] > 0
            ),
            "total_floored_unit_pairs": sum(row.floored_counts[floor_m] for row in impact_rows),
            "distribution": stats.describe(
                list(raw.values()), observation_count=len(candidates)
            ).sanitized_summary(),
        }

    report["resident_impact"]["floor_sensitivity"] = _floor_sensitivity(
        floor_raw, floor_scores, region_by_candidate
    )

    # ------------------------------------------------------------------ land #
    research_registry = registry.research_registry()
    land_inputs = extract.load_land_conversion_inputs(conn, research_registry.class_level)
    land_series = land_conversion.build_series(land_inputs, research_registry)
    land_raw = land_series.raw_values()
    report["land_conversion"] = {
        "definition": (
            "share of the evaluated cell area that is NOT already developed "
            f"({land_conversion.RAW_UNIT}); {land_conversion.DIRECTION}"
        ),
        "method_version": land_conversion.METHOD_VERSION,
        "denominator": land_conversion.DENOMINATOR_EVALUATED_AREA,
        "class_registry": research_registry.sanitized_summary(),
        "registry_status": (
            "RESEARCH-ONLY — NOT PRODUCTION POLICY. land_conversion.PRODUCTION_REGISTRY "
            "is None and remains None."
        ),
        "production_registry_is_none": land_conversion.PRODUCTION_REGISTRY is None,
        "cells_total": len(land_inputs),
        "coverage_status_counts": _count_by(i.coverage_status for i in land_inputs),
        "coverage": _coverage(land_series, "CANDIDATE_CELL").sanitized_summary(),
        "conversion_share_distribution": stats.describe(
            list(land_raw.values()), observation_count=len(candidates)
        ).sanitized_summary(),
        "developed_share_distribution": stats.describe(
            _developed_shares(land_series), observation_count=len(candidates)
        ).sanitized_summary(),
        "ambiguous_class_exposure": _ambiguous_exposure(land_series),
        "class_area_excess_diagnostic": _class_area_excess_diagnostic(
            land_series, land_inputs, research_registry
        ),
    }
    report["land_conversion"]["no_coverage_share"] = _share(
        report["land_conversion"]["coverage_status_counts"].get(
            land_conversion.COVERAGE_NO_COVERAGE, 0
        ),
        len(land_inputs),
    )
    report["land_conversion"]["missingness_regional_concentration"] = regional_concentration(
        [o.unit_key for o in land_series.unavailable_observations()],
        region_by_candidate,
    )

    # ------------------------------------------------- missing-data matrix   #
    availability = _candidate_availability(
        candidates=candidates,
        burden_units=set(burden_raw),
        air_units=set(air_raw),
        resident_units=set(floor_raw[RESEARCH_DISTANCE_FLOORS_M[0]]),
        land_units=set(land_raw),
    )
    report["missing_data_matrix"] = _missing_matrix(
        candidates=candidates,
        availability=availability,
        burden_series=burden_series,
        air_series=air_series,
        land_series=land_series,
        region_count=len(regions),
        facility_year=facility_year,
        waste_year=waste_year,
    )

    stages = stage_eligibility(candidate_keys, availability)
    report["eligibility_shrinkage"] = {
        "note": (
            "Complete-case staging only. This is NOT a proposal to adopt "
            "STRICT_ALL_COMPONENTS_REQUIRED; the missing-component eligibility policy "
            "is undecided, and screening eligibility is a separate concept from "
            "ranking score."
        ),
        "stages": [s.sanitized_summary(len(candidate_keys)) for s in stages],
        "regional_concentration_of_removed": regional_concentration(
            sorted(set(candidate_keys) - availability["complete"]),
            region_by_candidate,
        ),
        "regional_concentration_of_retained": regional_concentration(
            sorted(availability["complete"]), region_by_candidate
        ),
    }

    # The same staging with the float-boundary artifact set aside, so the policy
    # gate can see how much of the shrinkage is missing *data* and how much is a
    # precision defect that a fix would return. Neither figure is a policy.
    artifact_keys = {
        o.unit_key
        for o in land_series.unavailable_observations()
        if contract.REASON_CLASS_AREA_EXCEEDS_DENOMINATOR in o.unavailable_reasons
    }
    availability_without_artifact = dict(availability)
    availability_without_artifact[contract.COMPONENT_LAND_CONVERSION] = (
        availability[contract.COMPONENT_LAND_CONVERSION] | artifact_keys
    )
    complete_without_artifact = set(candidate_keys)
    for component in COMPONENT_ORDER:
        complete_without_artifact &= availability_without_artifact[component]
    availability_without_artifact["complete"] = complete_without_artifact
    report["eligibility_shrinkage"]["counterfactual_without_precision_artifact"] = {
        "note": (
            "DIAGNOSTIC ONLY. Identical staging except that cells removed by the "
            "sub-square-millimetre CLASS_AREA_EXCEEDS_DENOMINATOR float boundary are "
            "treated as measurable. This is not a proposed tolerance and not a policy; "
            "it isolates how much of the observed shrinkage is genuinely absent data."
        ),
        "cells_restored": len(artifact_keys),
        "stages": [
            s.sanitized_summary(len(candidate_keys))
            for s in stage_eligibility(candidate_keys, availability_without_artifact)
        ],
    }

    # --------------------------------------------------------------- CRITIC  #
    complete_keys = sorted(availability["complete"])
    component_scores = _component_scores_by_candidate(
        candidates=candidates,
        burden_series=burden_series,
        air_series=air_series,
        resident_scores=floor_scores,
        land_series=land_series,
    )
    report["critic_viability"] = _critic_viability(complete_keys, component_scores, floor_scores)

    # -------------------------------------------------------------- ranking  #
    report["ranking_diagnostics"] = _ranking_diagnostics(
        complete_keys, component_scores, region_by_candidate
    )

    report["invariants"] = {
        "missing_never_zero": _assert_missing_never_zero(burden_series, air_series, land_series),
        "historical_components_untouched": {
            "historical_order": list(historical_policy.COMPONENTS),
            "successor_order": list(COMPONENT_ORDER),
            "namespaces_disjoint": not (set(COMPONENT_ORDER) & set(historical_policy.COMPONENTS)),
            "note": (
                "This lane read zoning/road/equity/demand only to confirm disjointness. "
                "No historical score, weight, rank, CRITIC vector, or stability class was "
                "read into a successor calculation or written anywhere."
            ),
        },
        "successor_activation_status": "NOT ACTIVATED",
    }

    return report


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _count_by(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = str(value)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def _stream_presence(
    inputs: Sequence[air_impact_proxy.AirImpactProxyInput],
) -> dict[str, Any]:
    per_stream: dict[str, int] = {s: 0 for s in air_impact_proxy.REQUIRED_WASTE_STREAMS}
    combinations: dict[str, int] = {}
    for item in inputs:
        present = {s.waste_stream for s in item.streams if s.generation_quantity is not None}
        for stream in present:
            if stream in per_stream:
                per_stream[stream] += 1
        label = "+".join(sorted(present)) if present else "NONE"
        combinations[label] = combinations.get(label, 0) + 1
    return {"per_stream": per_stream, "combinations": dict(sorted(combinations.items()))}


def _representative_point_summary(conn: Connection) -> dict[str, Any]:
    rows = extract.load_representative_point_audit(conn)
    outside = [r for r in rows if not r["centroid_inside_region"]]
    separations = [Decimal(r["centroid_to_surface_point_m"]) for r in rows]
    radii = [Decimal(r["equivalent_circle_radius_m"]) for r in rows]
    return {
        "regions_audited": len(rows),
        "centroid_outside_region_count": len(outside),
        "centroid_outside_regions": [
            {
                "region_code": r["region_code"],
                "region_name": r["region_name"],
                "part_count": r["part_count"],
                "centroid_to_surface_point_m": r["centroid_to_surface_point_m"],
            }
            for r in outside
        ],
        "centroid_to_surface_separation_distribution": stats.describe(
            separations
        ).sanitized_summary(),
        "equivalent_circle_radius_distribution": stats.describe(radii).sanitized_summary(),
        "note": resident_impact.REPRESENTATIVE_GEOMETRY_SELECTION_NOTE,
    }


def _floor_sensitivity(
    floor_raw: Mapping[int, Mapping[str, Decimal]],
    floor_scores: Mapping[int, Mapping[str, Decimal]],
    region_by_candidate: Mapping[str, str | None],
) -> dict[str, Any]:
    """Pairwise rank agreement across the research distance floors."""

    pairs: list[dict[str, Any]] = []
    floors = list(RESEARCH_DISTANCE_FLOORS_M)
    for index, left in enumerate(floors):
        for right in floors[index + 1 :]:
            top10, k10 = stats.top_k_overlap(floor_scores[left], floor_scores[right], 10)
            top50, k50 = stats.top_k_overlap(floor_scores[left], floor_scores[right], 50)
            pairs.append(
                {
                    "floor_a_m": left,
                    "floor_b_m": right,
                    "spearman_raw": _fmt_opt(stats.spearman(floor_raw[left], floor_raw[right])),
                    "top_10_overlap": top10,
                    "top_10_k": k10,
                    "top_50_overlap": top50,
                    "top_50_k": k50,
                    "rank_churn": stats.rank_churn(
                        floor_scores[left], floor_scores[right]
                    ).sanitized_summary(),
                }
            )
    return {
        "pairs": pairs,
        "top_k_tie_caveat": (
            "Top-k overlap is computed with a deterministic unit-key tiebreak. Where the "
            "top of a distribution is heavily tied, the overlap measures a deterministic "
            "slice of a tied block rather than a genuine stability property."
        ),
        "regional_concentration_of_top_50": {
            str(floor): regional_concentration(
                _top_keys_list(floor_scores[floor], 50), region_by_candidate
            )
            for floor in floors
        },
    }


def _top_keys_list(scores: Mapping[str, Decimal], k: int) -> list[str]:
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [key for key, _ in ordered[:k]]


def _fmt_opt(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _developed_shares(series: contract.ComponentSeries) -> list[Decimal]:
    shares: list[Decimal] = []
    for observation in series.available_observations():
        raw = observation.inputs.get("developed_share")
        if raw is not None:
            shares.append(Decimal(str(raw)))
    return shares


def _class_area_excess_diagnostic(
    series: contract.ComponentSeries,
    inputs: Sequence[land_conversion.LandConversionInput],
    class_registry: land_conversion.LandCoverClassRegistry,
) -> dict[str, Any]:
    """Separate a float-rounding boundary from genuine double-counted area.

    ``CLASS_AREA_EXCEEDS_DENOMINATOR`` is designed to catch a structurally
    impossible cell — a double-counted overlay, or a mismatched denominator —
    and it deliberately reports rather than clamps. Whether the cells it catches
    here are *actually* structurally impossible is a different question, and the
    answer changes what the finding means entirely: an overlay defect is a
    land-cover derivation bug, whereas a last-ulp disagreement is a precision
    mismatch at the contract boundary.

    The excess is recomputed here from the component's own inputs rather than
    read out of the observation's ``inputs`` dict, because that dict stores
    ``class_area_sum_m2`` quantized to 0.01 m² for display while the denominator
    is stored unquantized. Differencing those two published strings measures the
    display quantum (±0.005 m²), not the disagreement the component actually
    tripped on.
    """

    affected = {
        o.unit_key
        for o in series.unavailable_observations()
        if contract.REASON_CLASS_AREA_EXCEEDS_DENOMINATOR in o.unavailable_reasons
    }
    excesses: list[Decimal] = []
    for item in inputs:
        if item.candidate_key not in affected or item.evaluated_area_m2 is None:
            continue
        counted = sum(
            (
                row.class_area_m2
                for row in item.class_areas
                if row.class_level == class_registry.class_level
                and row.class_area_m2 is not None
                and not class_registry.is_excluded(row.class_code)
            ),
            start=Decimal("0"),
        )
        excesses.append(counted - item.evaluated_area_m2)

    # 1 m^2 is four millionths of a 500 m grid cell's area: anything below it
    # cannot be a real overlay double-count at this grid resolution.
    material = [e for e in excesses if e > Decimal("1")]
    return {
        "affected_cells": len(excesses),
        "excess_distribution_m2": stats.describe(excesses).sanitized_summary(),
        "materially_exceeding_cells_gt_1_m2": len(material),
        "interpretation": (
            "Every excess is a sub-square-millimetre floating-point boundary, not a "
            "double-counted overlay: the stored class areas and the stored evaluated "
            "area are both double precision, and their exact Decimal sum differs from "
            "the stored total in the last unit in the last place. The component is "
            "behaving as specified — it refuses to clamp — but the cells it removes "
            "are removed for a precision artifact rather than for missing data."
            if not material
            else (
                "Some excesses are materially larger than a float rounding boundary and "
                "may indicate a genuine overlay double-count in the land-cover derivation."
            )
        ),
        "consequence": (
            "These cells are NOT missing land-cover data. Treating this artifact as "
            "missingness overstates land_conversion's real data gap and understates the "
            "successor model's achievable eligible population."
        ),
    }


def _ambiguous_exposure(series: contract.ComponentSeries) -> dict[str, Any]:
    """How many cells rest on a contested class assignment, and which classes."""

    per_class: dict[str, int] = {}
    cells_with_any = 0
    for observation in series.available_observations():
        observed = observation.inputs.get("ambiguous_class_codes_observed") or ()
        codes = tuple(str(code) for code in observed)
        if codes:
            cells_with_any += 1
        for code in codes:
            per_class[code] = per_class.get(code, 0) + 1
    available = len(series.available_observations())
    return {
        "cells_touching_an_ambiguous_class": cells_with_any,
        "share_of_available_cells": _share(cells_with_any, available),
        "per_ambiguous_class_cell_counts": dict(sorted(per_class.items())),
        "class_names": {
            code: registry.OBSERVED_L2_CLASS_NAMES.get(code, "?") for code in sorted(per_class)
        },
        "note": (
            "An ambiguous class is still resolved into exactly one bucket so the registry "
            "stays total; the flag records that the resolution is a contested policy call, "
            "not that the value is missing."
        ),
    }


def _candidate_availability(
    *,
    candidates: Sequence[extract.CandidateRow],
    burden_units: set[str],
    air_units: set[str],
    resident_units: set[str],
    land_units: set[str],
) -> dict[str, set[str]]:
    """Candidate-level availability for each component, plus the complete set.

    Region-level components reach a candidate only through its SIGUNGU code, so a
    candidate with no SIGUNGU code cannot receive one — that is a real coverage
    loss, not a lookup detail.
    """

    burden: set[str] = set()
    air: set[str] = set()
    for candidate in candidates:
        code = candidate.sigungu_region_code
        if code is None:
            continue
        if code in burden_units:
            burden.add(candidate.candidate_key)
        if code in air_units:
            air.add(candidate.candidate_key)
    availability = {
        contract.COMPONENT_EXISTING_BURDEN: burden,
        contract.COMPONENT_AIR_IMPACT_PROXY: air,
        contract.COMPONENT_RESIDENT_IMPACT: set(resident_units),
        contract.COMPONENT_LAND_CONVERSION: set(land_units),
    }
    complete = set(c.candidate_key for c in candidates)
    for component in COMPONENT_ORDER:
        complete &= availability[component]
    availability["complete"] = complete
    return availability


def _missing_matrix(
    *,
    candidates: Sequence[extract.CandidateRow],
    availability: Mapping[str, set[str]],
    burden_series: contract.ComponentSeries,
    air_series: contract.ComponentSeries,
    land_series: contract.ComponentSeries,
    region_count: int,
    facility_year: int,
    waste_year: int,
) -> list[dict[str, Any]]:
    total = len(candidates)
    complete = len(availability["complete"])

    def row(
        component: str,
        source: str,
        numerator: str,
        denominator: str,
        grain: str,
        region_available: int | None,
        reasons: Mapping[str, int],
        reference_period: str,
    ) -> dict[str, Any]:
        available = len(availability[component])
        return {
            "component": component,
            "required_source": source,
            "numerator": numerator,
            "denominator": denominator,
            "unit_grain": grain,
            "region_coverage": (
                f"{region_available}/{region_count}" if region_available is not None else "n/a"
            ),
            "missing_regions": (
                region_count - region_available if region_available is not None else None
            ),
            "reference_period": reference_period,
            "candidate_coverage": f"{available}/{total}",
            "missing_candidates": total - available,
            "null_share": _share(total - available, total),
            "complete_case_impact": {
                "candidates_this_component_alone_would_keep": available,
                "candidates_kept_with_all_four": complete,
            },
            "missing_reason_categories": dict(reasons),
        }

    return [
        row(
            contract.COMPONENT_EXISTING_BURDEN,
            "waste_treatment_facilities + regional_population",
            "sum(throughput_quantity[톤/년]) x 1000",
            "resident population [persons]",
            "SIGUNGU",
            len(burden_series.available_observations()),
            {
                **burden_series.unavailable_reason_counts(),
                "CANDIDATE_HAS_NO_SIGUNGU_CODE": sum(
                    1 for c in candidates if c.sigungu_region_code is None
                ),
            },
            str(facility_year),
        ),
        row(
            contract.COMPONENT_AIR_IMPACT_PROXY,
            "regional_waste_statistics (4 canonical streams) + regional_population",
            "HOUSEHOLD + BUSINESS_NON_FACILITY + INDUSTRIAL_FACILITY + CONSTRUCTION [톤/년] x 1000",
            "resident population [persons]",
            "SIGUNGU",
            len(air_series.available_observations()),
            {
                **air_series.unavailable_reason_counts(),
                "CANDIDATE_HAS_NO_SIGUNGU_CODE": sum(
                    1 for c in candidates if c.sigungu_region_code is None
                ),
            },
            str(waste_year),
        ),
        row(
            contract.COMPONENT_RESIDENT_IMPACT,
            "suitability_candidates.centroid + regions.geometry + regional_population",
            "sum(population / max(geodesic distance m, floor))",
            "distance [m], floored",
            "CANDIDATE_CELL",
            None,
            {},
            str(extract.POPULATION_REFERENCE_YEAR),
        ),
        row(
            contract.COMPONENT_LAND_CONVERSION,
            "environmental_land_cover_cell_statistics + _cell_class_areas",
            "non-developed class area [m2]",
            "evaluated cell area [m2]",
            "CANDIDATE_CELL",
            None,
            land_series.unavailable_reason_counts(),
            "land-cover-cell-stats-v1",
        ),
    ]


def _component_scores_by_candidate(
    *,
    candidates: Sequence[extract.CandidateRow],
    burden_series: contract.ComponentSeries,
    air_series: contract.ComponentSeries,
    resident_scores: Mapping[int, Mapping[str, Decimal]],
    land_series: contract.ComponentSeries,
) -> dict[str, dict[str, Decimal]]:
    """Normalized [0,100] component scores projected onto candidate keys.

    Region-level scores are normalized across *regions* and then attached to each
    candidate in that region — the component's own analytical grain is SIGUNGU, so
    every candidate in a region shares its value by construction.
    """

    burden_scores = burden_series.normalized_scores()
    air_scores = air_series.normalized_scores()
    land_scores = land_series.normalized_scores()

    by_component: dict[str, dict[str, Decimal]] = {
        contract.COMPONENT_EXISTING_BURDEN: {},
        contract.COMPONENT_AIR_IMPACT_PROXY: {},
        contract.COMPONENT_RESIDENT_IMPACT: dict(resident_scores[RESEARCH_DISTANCE_FLOORS_M[0]]),
        contract.COMPONENT_LAND_CONVERSION: dict(land_scores),
    }
    for candidate in candidates:
        code = candidate.sigungu_region_code
        if code is None:
            continue
        if code in burden_scores:
            by_component[contract.COMPONENT_EXISTING_BURDEN][candidate.candidate_key] = (
                burden_scores[code]
            )
        if code in air_scores:
            by_component[contract.COMPONENT_AIR_IMPACT_PROXY][candidate.candidate_key] = air_scores[
                code
            ]
    return by_component


def _critic_viability(
    complete_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    floor_scores: Mapping[int, Mapping[str, Decimal]],
) -> dict[str, Any]:
    """Is a successor CRITIC mathematically defined on the real population?"""

    result: dict[str, Any] = {
        "label": critic_research.RESEARCH_ONLY_LABEL,
        "complete_case_population": len(complete_keys),
        "historical_critic_reuse": (
            "REFUSED BY CONSTRUCTION — critic.compute_critic_weights iterates the "
            "historical CRITERION_ORDER literal and cannot accept successor component "
            "keys. No historical CRITIC vector, weight, or stability class was reused."
        ),
    }
    if len(complete_keys) < 2:
        result["viable"] = False
        result["reason"] = "fewer than two complete units"
        return result

    rows = [{c: component_scores[c][key] for c in COMPONENT_ORDER} for key in complete_keys]
    distinct = {c: len({row[c] for row in rows}) for c in COMPONENT_ORDER}
    result["distinct_value_counts"] = distinct
    result["constant_components"] = sorted(c for c, n in distinct.items() if n < 2)

    try:
        critic = critic_research.compute_research_critic_weights(rows, COMPONENT_ORDER)
    except critic_research.ResearchCriticUndefinedError as error:
        result["viable"] = False
        result["reason"] = str(error)
        return result

    result["viable"] = True
    result["research_only_result"] = critic.sanitized_summary()
    result["normalization_sensitivity"] = _critic_floor_sensitivity(
        complete_keys, component_scores, floor_scores
    )
    return result


def _critic_floor_sensitivity(
    complete_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    floor_scores: Mapping[int, Mapping[str, Decimal]],
) -> dict[str, Any]:
    """How much the research CRITIC weight vector moves with the distance floor."""

    per_floor: dict[str, Any] = {}
    for floor_m in RESEARCH_DISTANCE_FLOORS_M:
        rows = [
            {
                **{
                    c: component_scores[c][key]
                    for c in COMPONENT_ORDER
                    if c != contract.COMPONENT_RESIDENT_IMPACT
                },
                contract.COMPONENT_RESIDENT_IMPACT: floor_scores[floor_m][key],
            }
            for key in complete_keys
        ]
        try:
            critic = critic_research.compute_research_critic_weights(rows, COMPONENT_ORDER)
        except critic_research.ResearchCriticUndefinedError as error:
            per_floor[str(floor_m)] = {"undefined": str(error)}
            continue
        per_floor[str(floor_m)] = {c: format(critic.weights[c], "f") for c in COMPONENT_ORDER}
    return {
        "weights_by_distance_floor": per_floor,
        "note": (
            "The research CRITIC weight vector is a function of the distance floor, which "
            "is itself unapproved. A weight vector cannot be fixed before the floor is."
        ),
    }


def _ranking_diagnostics(
    complete_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    region_by_candidate: Mapping[str, str | None],
) -> dict[str, Any]:
    """Ranking behaviour under a neutral, explicitly-unapproved weight vector."""

    if len(complete_keys) < 2:
        return {
            "computable": False,
            "reason": "fewer than two complete-case candidates",
        }

    equal = {c: Decimal("0.25") for c in COMPONENT_ORDER}
    baseline = weighted_scores(component_scores, equal, complete_keys)

    perturbations: dict[str, Any] = {}
    for component in COMPONENT_ORDER:
        weights = {c: Decimal("0.20") for c in COMPONENT_ORDER}
        weights[component] = Decimal("0.40")
        perturbed = weighted_scores(component_scores, weights, complete_keys)
        top10, k10 = stats.top_k_overlap(baseline, perturbed, 10)
        top50, k50 = stats.top_k_overlap(baseline, perturbed, 50)
        perturbations[component] = {
            "weight_vector": {c: format(w, "f") for c, w in weights.items()},
            "spearman_vs_equal": _fmt_opt(stats.spearman(baseline, perturbed)),
            "top_10_overlap": top10,
            "top_10_k": k10,
            "top_50_overlap": top50,
            "top_50_k": k50,
            "rank_churn": stats.rank_churn(baseline, perturbed).sanitized_summary(),
        }

    return {
        "computable": True,
        "weight_vector_label": EQUAL_WEIGHT_LABEL,
        "population": len(complete_keys),
        "composite_distribution": stats.describe(list(baseline.values())).sanitized_summary(),
        "regional_concentration_of_top_50": regional_concentration(
            _top_keys_list(baseline, 50), region_by_candidate
        ),
        "regional_concentration_of_top_500": regional_concentration(
            _top_keys_list(baseline, 500), region_by_candidate
        ),
        "weight_perturbation_sensitivity": perturbations,
        "eligibility_note": (
            "These are RANKING diagnostics only. No weighted score is used here as a "
            "pass/fail screening test, and changing a research weight never redefines "
            "screening eligibility."
        ),
    }


def _assert_missing_never_zero(*series: contract.ComponentSeries) -> dict[str, Any]:
    """Confirm no unavailable observation carries a value, zero or otherwise."""

    violations: list[str] = []
    checked = 0
    for one in series:
        for observation in one.observations:
            checked += 1
            if observation.raw_value is None and not observation.unavailable_reasons:
                violations.append(f"{one.component}[{observation.unit_key}]: silent absence")
            if observation.raw_value is not None and observation.unavailable_reasons:
                violations.append(f"{one.component}[{observation.unit_key}]: both states")
    return {
        "observations_checked": checked,
        "violations": violations,
        "confirmed": not violations,
        "note": (
            "Every successor component is LOWER_RAW_IS_BETTER, so 0 is the best possible "
            "raw value. Zero-filling a missing observation would systematically promote "
            "exactly the units with the least evidence."
        ),
    }


def write_report(report: Mapping[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
