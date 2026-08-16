"""Phase-4 gate driver: re-measure the real dataset after the correctness fixes.

Read-only. Produces the evidence bundle the Phase-4 policy decisions cite. It
never writes to the database, never reaches production, and never activates the
successor model.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Connection

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suitability_v3_phase3 import critic_research, extract, registry, stats  # noqa: E402

from suitability_v3_phase4 import extract4, gate  # noqa: E402
from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    air_impact_proxy,
    contract,
    existing_burden,
    land_conversion,
    resident_impact,
)

RESEARCH_DISTANCE_FLOORS_M: tuple[int, ...] = (500, 1000, 2000, 5000)
COMPONENT_ORDER = contract.SUCCESSOR_COMPONENTS


def _ranked_scores(raw: Mapping[str, Decimal], direction: str) -> dict[str, Decimal]:
    """Percentile-rank normalization via the proven-equivalent fast path."""

    return {
        key: contract.score_from_percentile(rank, direction)
        for key, rank in stats.fast_percentile_ranks(dict(raw)).items()
    }


def run_gate(conn: Connection, run_id: int) -> dict[str, Any]:
    extract.prepare_session(conn)
    snapshot = extract.load_snapshot(conn, run_id)
    regions = extract.load_sigungu_regions(conn)
    population = extract.load_population(conn)
    candidates = extract.load_candidates(conn, run_id)
    facility_year = snapshot.facility_reference_year or extract.POPULATION_REFERENCE_YEAR
    waste_year = snapshot.waste_statistics_reference_year or extract.POPULATION_REFERENCE_YEAR

    report: dict[str, Any] = {
        "phase": "phase-4-explicit-policy-gate",
        "status": "RESEARCH ONLY — successor model NOT ACTIVATED",
        "component_contract_version": contract.COMPONENT_CONTRACT_VERSION,
        "component_order": list(COMPONENT_ORDER),
        "dataset_snapshot": snapshot.sanitized_summary(),
    }

    # ---------------------------------------------------------------- B17 ---
    unmapped_groups = extract4.load_unmapped_facility_groups(conn, facility_year)
    evidence = extract4.unmapped_evidence_by_region(unmapped_groups)
    burden_inputs = extract4.load_existing_burden_inputs_with_evidence(
        conn, regions, population, facility_year, evidence
    )
    burden_series = existing_burden.build_series(burden_inputs)
    report["b17_existing_burden"] = {
        "unmapped_facility_groups": [g.sanitized_summary() for g in unmapped_groups],
        "unmapped_facility_rows": sum(g.facility_count for g in unmapped_groups),
        "unmapped_throughput_tons_per_year": format(
            sum(
                (
                    g.throughput_tons_per_year
                    for g in unmapped_groups
                    if g.throughput_tons_per_year is not None
                ),
                start=Decimal("0"),
            ),
            "f",
        ),
        "coverage_basis": extract4.COVERAGE_BASIS_DERIVED_NAME,
        **gate.existing_burden_before_after(burden_series),
    }

    # ---------------------------------------------------------------- B16 ---
    land_registry = registry.research_registry()
    land_inputs = extract.load_land_conversion_inputs(conn, class_level=land_registry.class_level)
    land_series = land_conversion.build_series(land_inputs, land_registry)
    report["b16_land_conversion"] = {
        "registry_id": land_registry.registry_id,
        "registry_approved": land_registry.approved,
        "relative_tolerance": format(
            land_conversion.AREA_RECONCILIATION_RELATIVE_TOLERANCE, "f"
        ),
        "area_unit": land_conversion.AREA_UNIT,
        **gate.land_conversion_before_after(land_series),
    }

    # ----------------------------------------------------------- air impact ---
    air_inputs = extract.load_air_impact_inputs(conn, regions, population, waste_year)
    air_series = air_impact_proxy.build_series(air_inputs)
    city_units = extract4.load_city_grain_units(conn, waste_year, population)
    report["b6_air_impact_grain"] = _air_grain_options(
        air_series, city_units, regions, population, candidates
    )

    # ------------------------------------------------------- resident impact ---
    impact_rows = extract.load_resident_impact(conn, run_id, extract.POPULATION_REFERENCE_YEAR)
    floor_scores: dict[int, dict[str, Decimal]] = {}
    for floor_m in RESEARCH_DISTANCE_FLOORS_M:
        raw = {row.candidate_key: row.raw_by_floor[floor_m] for row in impact_rows}
        floor_scores[floor_m] = _ranked_scores(raw, resident_impact.DIRECTION)

    # ---------------------------------------------------------- eligibility ---
    region_of = {
        c.candidate_key: c.sigungu_region_code
        for c in candidates
        if c.sigungu_region_code is not None
    }
    candidate_keys = [c.candidate_key for c in candidates]
    report["b19_candidate_region_mapping"] = {
        "candidate_count": len(candidates),
        "with_sigungu_code": len(region_of),
        "without_sigungu_code": len(candidates) - len(region_of),
        "note": (
            "Traced in the report: all unmapped centroids fall inside their SIDO polygon but "
            "outside every SIGUNGU polygon — an inter-layer boundary gap, already flagged by "
            "the historical engine as AMBIGUOUS_OR_MISSING_SIGUNGU. No code is fabricated."
        ),
    }

    report["eligibility"] = {}
    report["weight_sensitivity"] = {}
    report["critic"] = {}
    report["normalization"] = {}

    for floor_m in RESEARCH_DISTANCE_FLOORS_M:
        component_scores = _project(
            candidates, burden_series, air_series, floor_scores[floor_m], land_series
        )
        eligibility = gate.eligibility_by_policy(
            candidate_keys, component_scores, population, region_of
        )
        report["eligibility"][str(floor_m)] = eligibility

        strict_keys = sorted(
            key
            for key in candidate_keys
            if all(key in component_scores[c] for c in COMPONENT_ORDER)
        )
        if floor_m != RESEARCH_DISTANCE_FLOORS_M[0]:
            continue

        report["partial_scoring_comparability"] = {
            optional: gate.partial_scoring_comparability(
                strict_keys,
                [
                    key
                    for key in candidate_keys
                    if all(
                        key in component_scores[c] for c in COMPONENT_ORDER if c != optional
                    )
                ],
                component_scores,
                optional,
            )
            for optional in COMPONENT_ORDER
        }
        report["critic"] = _critic(strict_keys, component_scores)
        report["weight_sensitivity"] = _weight_sensitivity(
            strict_keys, component_scores, report["critic"], region_of
        )
        report["normalization"] = _normalization(land_series, impact_rows, strict_keys)

    report["floor_sensitivity"] = _floor_sensitivity(
        candidates, burden_series, air_series, floor_scores, land_series, region_of
    )
    return report


# --------------------------------------------------------------------------- #


def _project(
    candidates: Any,
    burden_series: contract.ComponentSeries,
    air_series: contract.ComponentSeries,
    resident_scores: Mapping[str, Decimal],
    land_series: contract.ComponentSeries,
) -> dict[str, dict[str, Decimal]]:
    burden = burden_series.normalized_scores()
    air = air_series.normalized_scores()
    scores: dict[str, dict[str, Decimal]] = {
        contract.COMPONENT_EXISTING_BURDEN: {},
        contract.COMPONENT_AIR_IMPACT_PROXY: {},
        contract.COMPONENT_RESIDENT_IMPACT: dict(resident_scores),
        contract.COMPONENT_LAND_CONVERSION: dict(land_series.normalized_scores()),
    }
    for candidate in candidates:
        code = candidate.sigungu_region_code
        if code is None:
            continue
        if code in burden:
            scores[contract.COMPONENT_EXISTING_BURDEN][candidate.candidate_key] = burden[code]
        if code in air:
            scores[contract.COMPONENT_AIR_IMPACT_PROXY][candidate.candidate_key] = air[code]
    return scores


def _air_grain_options(
    air_series: contract.ComponentSeries,
    city_units: tuple[extract4.CityGrainUnit, ...],
    regions: Any,
    population: Mapping[str, int],
    candidates: Any,
) -> dict[str, Any]:
    """Cost each B6 option in regions, candidates, and residents."""

    available = set(air_series.normalized_scores())
    all_codes = {r.region_code for r in regions}
    missing = sorted(all_codes - available)

    city_covered: set[str] = set()
    projectable: list[dict[str, Any]] = []
    for unit in city_units:
        city_covered.update(unit.covered_region_codes)
        total = unit.total_generation_tons
        per_capita = None
        if total is not None and unit.covered_population:
            per_capita = format(
                (total * Decimal("1000") / Decimal(unit.covered_population)).quantize(
                    Decimal("0.0001")
                ),
                "f",
            )
        projectable.append(
            {
                **unit.sanitized_summary(),
                "derived_city_per_capita_kg_per_year": per_capita,
                "all_four_streams_present": total is not None,
            }
        )

    candidates_by_region: dict[str, int] = {}
    for candidate in candidates:
        code = candidate.sigungu_region_code
        if code is not None:
            candidates_by_region[code] = candidates_by_region.get(code, 0) + 1

    def _cost(codes: list[str]) -> dict[str, Any]:
        return {
            "regions": len(codes),
            "candidates": sum(candidates_by_region.get(c, 0) for c in codes),
            "residents": sum(population.get(c, 0) for c in codes),
        }

    other_missing = [c for c in missing if c not in city_covered]
    return {
        "regions_total": len(all_codes),
        "regions_with_component": len(available),
        "regions_without_component": missing,
        "option_a_strict_sigungu_only": {
            "excluded": _cost(missing),
            "note": "no derived value; the 22 regions simply lose the component",
        },
        "option_b_city_grain_projection": {
            "city_units": projectable,
            "recoverable": _cost([c for c in missing if c in city_covered]),
            "still_excluded": _cost(other_missing),
            "still_excluded_regions": other_missing,
            "assumption": (
                "projecting a CITY per-capita generation rate onto its child districts asserts "
                "that per-capita generation is uniform within the city; the value is a "
                "coarser-geography derivation, not a child-district observation"
            ),
        },
        "regions_missing_for_other_reasons": other_missing,
    }


def _critic(
    strict_keys: list[str], component_scores: Mapping[str, Mapping[str, Decimal]]
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "label": critic_research.RESEARCH_ONLY_LABEL,
        "complete_case_population": len(strict_keys),
    }
    if len(strict_keys) < 2:
        result["viable"] = False
        result["reason"] = "fewer than two complete units"
        return result
    rows = [{c: component_scores[c][key] for c in COMPONENT_ORDER} for key in strict_keys]
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
    result.update(critic.sanitized_summary())
    return result


def _weight_sensitivity(
    strict_keys: list[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    critic_result: Mapping[str, Any],
    region_of: Mapping[str, str],
) -> dict[str, Any]:
    neutral = gate.NEUTRAL_REFERENCE_WEIGHTS
    baseline = gate.composite_scores(strict_keys, component_scores, neutral)
    comparisons: list[dict[str, Any]] = []

    critic_weights = critic_result.get("weights")
    if isinstance(critic_weights, Mapping):
        weights = {c: Decimal(str(critic_weights[c])) for c in COMPONENT_ORDER}
        comparisons.append(
            gate.compare_rankings(
                baseline,
                gate.composite_scores(strict_keys, component_scores, weights),
                label="equal-weights vs research CRITIC",
                region_of=region_of,
            )
        )

    for component in COMPONENT_ORDER:
        for delta in (Decimal("0.05"), Decimal("0.15")):
            weights = gate.perturb(neutral, component, delta)
            comparisons.append(
                gate.compare_rankings(
                    baseline,
                    gate.composite_scores(strict_keys, component_scores, weights),
                    label=f"+{delta} onto {component}",
                )
            )
    return {
        "neutral_reference_weights": {c: format(v, "f") for c, v in neutral.items()},
        "complete_case_population": len(strict_keys),
        "baseline_top_50_regions": gate._region_counts(baseline, 50, region_of),
        "comparisons": comparisons,
    }


def _normalization(
    land_series: contract.ComponentSeries, impact_rows: Any, strict_keys: list[str]
) -> dict[str, Any]:
    """Bounded-ratio vs percentile-rank on the one component that supports both."""

    strict = set(strict_keys)
    raw = {
        k: v for k, v in land_series.raw_values().items() if k in strict
    }
    bounded = {
        k: contract.score_from_bounded_ratio(v, land_conversion.DIRECTION) for k, v in raw.items()
    }
    ranked = _ranked_scores(raw, land_conversion.DIRECTION)
    return {
        "component": contract.COMPONENT_LAND_CONVERSION,
        "population": len(raw),
        "bounded_ratio": stats.describe(sorted(bounded.values())).sanitized_summary(),
        "percentile_rank": stats.describe(sorted(ranked.values())).sanitized_summary(),
        "spearman_between_strategies": gate._fmt(stats.spearman(bounded, ranked)),
        "top_50_overlap": stats.top_k_overlap(bounded, ranked, 50, higher_is_better=True),
    }


def _floor_sensitivity(
    candidates: Any,
    burden_series: contract.ComponentSeries,
    air_series: contract.ComponentSeries,
    floor_scores: Mapping[int, Mapping[str, Decimal]],
    land_series: contract.ComponentSeries,
    region_of: Mapping[str, str],
) -> dict[str, Any]:
    base_floor = RESEARCH_DISTANCE_FLOORS_M[0]
    results: list[dict[str, Any]] = []
    base_scores = _project(
        candidates, burden_series, air_series, floor_scores[base_floor], land_series
    )
    base_keys = sorted(
        key
        for key in base_scores[contract.COMPONENT_RESIDENT_IMPACT]
        if all(key in base_scores[c] for c in COMPONENT_ORDER)
    )
    baseline = gate.composite_scores(base_keys, base_scores, gate.NEUTRAL_REFERENCE_WEIGHTS)

    for floor_m in RESEARCH_DISTANCE_FLOORS_M[1:]:
        scores = _project(
            candidates, burden_series, air_series, floor_scores[floor_m], land_series
        )
        variant = gate.composite_scores(base_keys, scores, gate.NEUTRAL_REFERENCE_WEIGHTS)
        results.append(
            gate.compare_rankings(
                baseline,
                variant,
                label=f"{base_floor}m vs {floor_m}m floor (equal weights)",
                region_of=region_of,
            )
        )
    return {
        "baseline_floor_m": base_floor,
        "complete_case_population": len(base_keys),
        "comparisons": results,
    }
