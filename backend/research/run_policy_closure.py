"""CLI entrypoint for the Successor-V3 policy-closure measurement.

Read-only. Point ``--database-url`` at a LOCAL PostGIS instance holding the
project's development dataset. This script never writes to the database, never
reaches production, and never activates the successor model.

It measures the **approved** production policy objects (the approved L2
land-cover registry and the candidate distance floors, scored under the approved
weight vector) plus every alternative each decision was chosen over.

Usage::

    python research/run_policy_closure.py \
        --database-url postgresql+psycopg://user:pass@localhost:5432/waste_equity \
        --run-id 47 \
        --output ../docs/research/v3_final_policy_evidence.json
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from suitability_v3_phase3 import extract, stats, validate  # noqa: E402
from suitability_v3_phase4 import extract4, gate  # noqa: E402
from suitability_v3_policy import closure  # noqa: E402

from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    air_impact_proxy,
    contract,
    existing_burden,
    land_conversion,
    resident_impact,
)

CANDIDATE_FLOORS_M: tuple[int, ...] = (500, 1000, 2000, 5000)
COMPONENT_ORDER = contract.SUCCESSOR_COMPONENTS

# The vector under evaluation. Equal weighting is a governance-neutral baseline,
# not an empirical optimum; see docs/research/SUITABILITY_V3_FINAL_POLICY.md.
APPROVED_WEIGHTS: dict[str, Decimal] = {c: Decimal("0.25") for c in COMPONENT_ORDER}

# Floors carried through the expensive per-variant analyses. Both serious
# candidates are measured so the weight and class findings can be shown not to
# depend on which floor is approved.
DEEP_FLOORS_M: tuple[int, ...] = (500, 2000)


def _ranked(raw: Mapping[str, Decimal], direction: str) -> dict[str, Decimal]:
    return {
        key: contract.score_from_percentile(rank, direction)
        for key, rank in stats.fast_percentile_ranks(dict(raw)).items()
    }


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


def _strict_keys(
    candidate_keys: list[str], scores: Mapping[str, Mapping[str, Decimal]]
) -> list[str]:
    """Complete-case keys: every successor component observed. NOT a ranking population."""

    return sorted(k for k in candidate_keys if all(k in scores[c] for c in COMPONENT_ORDER))


# The historical constraint screening is authoritative and is never re-litigated by
# the successor model. Measured on run 47: only ELIGIBLE candidates carry a rank or
# a score at all (17,501 ranked; REVIEW_REQUIRED and EXCLUDED carry neither). The
# successor model therefore ranks the SAME population the historical engine ranks,
# intersected with its own complete-case requirement. Ranking a candidate the
# constraint screening excluded would present burden/impact indicators as siting
# suitability, which docs/ANALYTICAL_METHODS.md "Weighting Policy" item 2 forbids.
SCREENING_STATUS_RANKABLE = "ELIGIBLE"


def _rankable_keys(
    candidates: Any, strict_keys: list[str]
) -> list[str]:
    """Complete-case keys that also pass the historical constraint screening."""

    eligible = {
        c.candidate_key for c in candidates if c.status == SCREENING_STATUS_RANKABLE
    }
    return sorted(set(strict_keys) & eligible)


def _status_breakdown(candidates: Any, strict_keys: list[str]) -> dict[str, Any]:
    """How the successor complete case distributes across historical screening status."""

    status_of = {c.candidate_key: c.status for c in candidates}
    counts: dict[str, int] = {}
    for key in strict_keys:
        status = status_of.get(key, "UNKNOWN")
        counts[status] = counts.get(status, 0) + 1
    totals: dict[str, int] = {}
    for candidate in candidates:
        totals[candidate.status] = totals.get(candidate.status, 0) + 1
    return {
        "complete_case_total": len(strict_keys),
        "complete_case_by_screening_status": dict(sorted(counts.items())),
        "run_total_by_screening_status": dict(sorted(totals.items())),
        "rankable_population": counts.get(SCREENING_STATUS_RANKABLE, 0),
        "note": (
            "The complete case is a component-AVAILABILITY set. Only ELIGIBLE candidates are "
            "ranked or scored by the historical constraint screening, so the successor ranking "
            "population is the intersection. The difference is the share of the complete case "
            "that the constraint screening had already set aside."
        ),
    }


def run_closure(conn: Any, run_id: int) -> dict[str, Any]:
    extract.prepare_session(conn)
    snapshot = extract.load_snapshot(conn, run_id)
    regions = extract.load_sigungu_regions(conn)
    population = extract.load_population(conn)
    candidates = extract.load_candidates(conn, run_id)
    facility_year = snapshot.facility_reference_year or extract.POPULATION_REFERENCE_YEAR
    waste_year = snapshot.waste_statistics_reference_year or extract.POPULATION_REFERENCE_YEAR

    approved_registry = land_conversion.PRODUCTION_REGISTRY
    assert approved_registry is not None

    report: dict[str, Any] = {
        "phase": "v3-policy-closure",
        "status": "RESEARCH MEASUREMENT of the approved policy — model NOT ACTIVATED here",
        "component_order": list(COMPONENT_ORDER),
        "dataset_snapshot": snapshot.sanitized_summary(),
        "approved_weights": {c: format(APPROVED_WEIGHTS[c], "f") for c in COMPONENT_ORDER},
        "approved_registry": approved_registry.sanitized_summary(),
    }

    # --- region-level components (floor- and registry-independent) -----------
    unmapped = extract4.load_unmapped_facility_groups(conn, facility_year)
    evidence = extract4.unmapped_evidence_by_region(unmapped)
    burden_series = existing_burden.build_series(
        extract4.load_existing_burden_inputs_with_evidence(
            conn, regions, population, facility_year, evidence
        )
    )
    air_series = air_impact_proxy.build_series(
        extract.load_air_impact_inputs(conn, regions, population, waste_year)
    )

    # --- land conversion, once per registry variant --------------------------
    land_inputs = extract.load_land_conversion_inputs(
        conn, class_level=approved_registry.class_level
    )
    variants = closure.registry_variants()
    land_series_by_variant = {
        name: land_conversion.build_series(land_inputs, reg) for name, reg in variants.items()
    }
    report["registry_variants"] = {
        name: {
            **variants[name].sanitized_summary(),
            "available_cells": len(land_series_by_variant[name].normalized_scores()),
            "score_distribution": closure.score_distribution(
                land_series_by_variant[name].normalized_scores()
            ),
        }
        for name in variants
    }

    # --- resident impact, once per floor -------------------------------------
    impact_rows = extract.load_resident_impact(conn, run_id, extract.POPULATION_REFERENCE_YEAR)
    resident_by_floor = {
        floor: _ranked(
            {row.candidate_key: row.raw_by_floor[floor] for row in impact_rows},
            resident_impact.DIRECTION,
        )
        for floor in CANDIDATE_FLOORS_M
    }

    region_of = {
        c.candidate_key: c.sigungu_region_code
        for c in candidates
        if c.sigungu_region_code is not None
    }
    candidate_keys = [c.candidate_key for c in candidates]

    # --- per-floor evidence under the approved registry + weights ------------
    approved_land = land_series_by_variant["approved"]
    floor_composites: dict[int, dict[str, Decimal]] = {}
    report["floors"] = {}
    for floor in CANDIDATE_FLOORS_M:
        scores = _project(
            candidates, burden_series, air_series, resident_by_floor[floor], approved_land
        )
        complete_case = _strict_keys(candidate_keys, scores)
        keys = _rankable_keys(candidates, complete_case)
        composite = gate.composite_scores(keys, scores, APPROVED_WEIGHTS)
        floor_composites[floor] = composite
        # Kept for direct comparability with the Phase-4 report, which ranked the
        # whole complete case without intersecting the constraint screening.
        unfiltered = gate.composite_scores(complete_case, scores, APPROVED_WEIGHTS)
        report["floors"][str(floor)] = {
            "eligibility": gate.eligibility_by_policy(
                candidate_keys, scores, population, region_of
            ),
            "screening_status": _status_breakdown(candidates, complete_case),
            "composite_distribution": closure.score_distribution(composite),
            "resident_component_distribution": closure.score_distribution(
                {k: scores[contract.COMPONENT_RESIDENT_IMPACT][k] for k in keys}
            ),
            "top_10_regions": gate._region_counts(composite, 10, region_of),
            "top_50_regions": gate._region_counts(composite, 50, region_of),
            "phase4_comparable_unfiltered_top_50_regions": gate._region_counts(
                unfiltered, 50, region_of
            ),
            "within_region_placement_artifact": closure.within_region_placement_artifact(
                {k: scores[contract.COMPONENT_RESIDENT_IMPACT][k] for k in keys}, region_of
            ),
        }

    # --- floor comparisons ---------------------------------------------------
    base = CANDIDATE_FLOORS_M[0]
    report["floor_sensitivity"] = {
        "against_base": [
            gate.compare_rankings(
                floor_composites[base],
                floor_composites[floor],
                label=f"{base}m vs {floor}m floor (approved weights)",
                region_of=region_of,
            )
            for floor in CANDIDATE_FLOORS_M[1:]
        ],
        "adjacent": closure.adjacent_floor_sensitivity(floor_composites, region_of),
    }

    # --- weight and class sensitivity at each deep floor ---------------------
    report["weight_sensitivity"] = {}
    report["class_sensitivity"] = {}
    for floor in DEEP_FLOORS_M:
        scores = _project(
            candidates, burden_series, air_series, resident_by_floor[floor], approved_land
        )
        keys = _rankable_keys(candidates, _strict_keys(candidate_keys, scores))
        report["weight_sensitivity"][str(floor)] = closure.weight_perturbations(
            keys, scores, APPROVED_WEIGHTS, region_of
        )

        baseline_composite = floor_composites[floor]
        per_variant: list[dict[str, Any]] = []
        for name, land in land_series_by_variant.items():
            if name == "approved":
                continue
            variant_scores = _project(
                candidates, burden_series, air_series, resident_by_floor[floor], land
            )
            variant_keys = _rankable_keys(
                candidates, _strict_keys(candidate_keys, variant_scores)
            )
            shared = sorted(set(variant_keys) & set(keys))
            variant_composite = gate.composite_scores(
                variant_keys, variant_scores, APPROVED_WEIGHTS
            )
            comparison = gate.compare_rankings(
                {k: baseline_composite[k] for k in shared},
                {k: variant_composite[k] for k in shared},
                label=f"approved registry vs {name}",
                region_of=region_of,
            )
            comparison["variant"] = name
            comparison["eligible_under_approved"] = len(keys)
            comparison["eligible_under_variant"] = len(variant_keys)
            comparison["eligible_delta"] = len(variant_keys) - len(keys)
            comparison["compared_on_shared_units"] = len(shared)
            per_variant.append(comparison)
        report["class_sensitivity"][str(floor)] = per_variant

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    engine = extract.open_engine(args.database_url)
    with engine.connect() as conn:
        report = run_closure(conn, args.run_id)
    validate.write_report(report, args.output)

    print(f"run {report['dataset_snapshot']['run_id']}")
    for floor in CANDIDATE_FLOORS_M:
        block = report["floors"][str(floor)]
        strict = block["eligibility"]["strict_all_components_required"]
        status = block["screening_status"]
        artifact = block["within_region_placement_artifact"]
        print(
            f"  floor {floor:>4}m  complete_case={strict['eligible']:>6} "
            f"rankable={status['rankable_population']:>6} "
            f"artifact_mean={artifact.get('mean_within_region_score_range')} "
            f"top50={list(block['top_50_regions'].items())[:3]}"
        )
    by_status = report["floors"]["500"]["screening_status"]["complete_case_by_screening_status"]
    print(f"  complete case by status: {by_status}")
    for comparison in report["floor_sensitivity"]["adjacent"]:
        print(
            f"  ADJ {comparison['label']}: spearman={comparison['spearman']} "
            f"top50={comparison['top_50_overlap']}"
        )
    for floor, variants in report["class_sensitivity"].items():
        for comparison in variants:
            print(
                f"  CLASS floor={floor} {comparison['variant']}: "
                f"spearman={comparison['spearman']} top50={comparison['top_50_overlap']} "
                f"eligible_delta={comparison['eligible_delta']}"
            )
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
