"""The successor run write path — scoring and persistence.

**The successor re-scores; it never re-screens.** A successor run is derived from
an existing historical run and inherits that run's candidate grid, region
assignment, and constraint-screening status *by copy*, not by recomputation. That
is what makes the ranking-population rule structural rather than aspirational:
there is no code path here that could admit a candidate the zoning/protected-area/
road screening excluded, because this module never evaluates a constraint at all.

Ranking population = source-run ``ELIGIBLE`` INTERSECT strict complete case over
all four successor components (``policy.RANKING_POPULATION_RULE``). Everything
else is persisted with whatever components it has and **no** composite, rank, or
stability class. Missing is never zero and eligibility is never a score.

Storage follows the applied additive schema: successor rows write
``component_scores`` and leave the four legacy ``*_score`` columns NULL, so a
successor number can never be read under a historical label.
"""

from __future__ import annotations

import datetime
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import component_model
from . import (
    air_impact_proxy,
    contract,
    existing_burden,
    land_conversion,
    policy,
    resident_impact,
)
from . import (
    inputs as successor_inputs,
)
from . import (
    stability as successor_stability,
)


class SuccessorBuildError(RuntimeError):
    """Raised when a successor run cannot be produced from the given source run."""


@dataclass
class SuccessorBuildReport:
    """What a successor build did, in numbers that can be checked against the data."""

    run_id: int
    source_run_id: int
    candidate_count_total: int
    candidate_count_ranked: int
    complete_case_count: int
    complete_case_by_screening_status: dict[str, int]
    source_status_totals: dict[str, int]
    component_available_counts: dict[str, int]
    component_unavailable_reasons: dict[str, dict[str, int]]
    regions_represented: int
    residents_represented: int
    stability_tally: dict[str, int]
    top_cutoff_rank: int
    score_summary: dict[str, str]

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "source_run_id": self.source_run_id,
            "component_model_version": policy.COMPONENT_MODEL_VERSION_SUCCESSOR,
            "policy_version": policy.SUCCESSOR_POLICY_VERSION,
            "derivation_version": policy.SUCCESSOR_DERIVATION_VERSION,
            "candidate_count_total": self.candidate_count_total,
            "candidate_count_ranked": self.candidate_count_ranked,
            "complete_case_count": self.complete_case_count,
            "complete_case_by_screening_status": dict(self.complete_case_by_screening_status),
            "source_status_totals": dict(self.source_status_totals),
            "component_available_counts": dict(self.component_available_counts),
            "component_unavailable_reasons": {
                component: dict(reasons)
                for component, reasons in self.component_unavailable_reasons.items()
            },
            "regions_represented": self.regions_represented,
            "residents_represented": self.residents_represented,
            "stability_tally": dict(self.stability_tally),
            "top_cutoff_rank": self.top_cutoff_rank,
            "score_summary": dict(self.score_summary),
            "ranking_population_rule": policy.RANKING_POPULATION_RULE,
            "disclaimer": policy.DISCLAIMER,
        }


@dataclass
class ScoredCandidate:
    """One candidate's successor result. ``total_score``/``rank`` only if ranked."""

    candidate_key: str
    status: str
    component_scores: dict[str, Decimal]
    missing_components: tuple[str, ...]
    total_score: Decimal | None = None
    rank: int | None = None
    stable_count: int | None = None
    stability_class: str | None = None
    stability_membership: dict[str, bool] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Scoring — pure, no database
# --------------------------------------------------------------------------- #


def _resident_impact_series(
    rows: Sequence[successor_inputs.ResidentImpactRow],
    floor: resident_impact.DistanceFloor,
) -> contract.ComponentSeries:
    """Assemble the ``resident_impact`` series from the set-based aggregate.

    The SQL computes exactly the sum ``observe()`` computes — Phase 3 cross-checked
    the two on sampled candidates — but does it in the database, because
    materializing the full candidate x region pair set in Python would be
    arithmetically identical and orders of magnitude slower. Each observation still
    carries the inputs its raw value came from.
    """

    observations = tuple(
        contract.ComponentObservation(
            component=contract.COMPONENT_RESIDENT_IMPACT,
            unit_key=row.candidate_key,
            raw_value=row.raw_value,
            raw_unit=resident_impact.RAW_UNIT,
            inputs={
                "population_unit_count": row.population_unit_count,
                "total_population": row.total_population,
                "min_distance_m": format(row.min_distance_m, "f"),
                "units_at_or_below_floor": row.floored_units,
                "distance_floor_m": format(floor.distance_floor_m, "f"),
            },
            provenance={
                "component": contract.COMPONENT_RESIDENT_IMPACT,
                "method_version": resident_impact.METHOD_VERSION,
                "raw_unit": resident_impact.RAW_UNIT,
                "distance_floor": floor.sanitized_summary(),
                "population_series": successor_inputs.POPULATION_SERIES_DEFINITION,
                "population_reference_period": str(successor_inputs.POPULATION_REFERENCE_YEAR),
                "aggregation": "set-based; equivalent to resident_impact.observe()",
            },
        )
        for row in rows
    )
    return contract.ComponentSeries(
        component=contract.COMPONENT_RESIDENT_IMPACT,
        method_version=resident_impact.METHOD_VERSION,
        direction=resident_impact.DIRECTION,
        raw_unit=resident_impact.RAW_UNIT,
        observations=observations,
        normalization_strategy=contract.NORMALIZATION_PERCENTILE_RANK,
        provenance={"distance_floor": floor.sanitized_summary()},
    )


def project_component_scores(
    candidates: Sequence[successor_inputs.CandidateRow],
    burden: contract.ComponentSeries,
    air: contract.ComponentSeries,
    resident: contract.ComponentSeries,
    land: contract.ComponentSeries,
) -> dict[str, dict[str, Decimal]]:
    """Per-component ``{candidate_key: score}``.

    The two region-grain components are attached to every candidate of the region
    that carries them. A candidate with no SIGUNGU code receives neither — it is
    not assigned to a neighbouring region, and its absence is a missing component
    rather than a zero.
    """

    burden_scores = burden.normalized_scores()
    air_scores = air.normalized_scores()
    scores: dict[str, dict[str, Decimal]] = {
        contract.COMPONENT_EXISTING_BURDEN: {},
        contract.COMPONENT_AIR_IMPACT_PROXY: {},
        contract.COMPONENT_RESIDENT_IMPACT: dict(resident.normalized_scores()),
        contract.COMPONENT_LAND_CONVERSION: dict(land.normalized_scores()),
    }
    for candidate in candidates:
        code = candidate.sigungu_region_code
        if code is None:
            continue
        if code in burden_scores:
            scores[contract.COMPONENT_EXISTING_BURDEN][candidate.candidate_key] = burden_scores[
                code
            ]
        if code in air_scores:
            scores[contract.COMPONENT_AIR_IMPACT_PROXY][candidate.candidate_key] = air_scores[code]
    return scores


def approved_weights() -> dict[str, Decimal]:
    """The approved baseline vector, as exact Decimals."""

    profile = policy.SUCCESSOR_WEIGHT_PROFILES[policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE]
    return {component: Decimal(profile[component]) for component in policy.COMPONENTS}


def score_candidates(
    candidates: Sequence[successor_inputs.CandidateRow],
    component_scores: Mapping[str, Mapping[str, Decimal]],
) -> tuple[list[ScoredCandidate], dict[str, Any]]:
    """Score, rank, and classify. Returns the rows plus the stability detail.

    Ranking is restricted to the approved population and the composite is computed
    only there, so no unranked candidate ever carries a score that could be read as
    one.
    """

    weights = approved_weights()

    complete_case = [
        candidate.candidate_key
        for candidate in candidates
        if all(candidate.candidate_key in component_scores[c] for c in policy.COMPONENTS)
    ]
    complete_set = set(complete_case)
    rankable = sorted(
        candidate.candidate_key
        for candidate in candidates
        if candidate.candidate_key in complete_set
        and candidate.status == policy.SCREENING_STATUS_RANKABLE
    )

    totals = {
        key: sum(
            (component_scores[c][key] * weights[c] for c in policy.COMPONENTS),
            start=Decimal("0"),
        )
        for key in rankable
    }
    # Deterministic: the candidate key is the final sort term, so equal scores
    # always resolve the same way regardless of input ordering.
    ordered = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ranks = {key: index + 1 for index, (key, _) in enumerate(ordered)}

    stability = successor_stability.evaluate(rankable, component_scores)

    rows: list[ScoredCandidate] = []
    for candidate in candidates:
        key = candidate.candidate_key
        present = {
            component: component_scores[component][key]
            for component in policy.COMPONENTS
            if key in component_scores[component]
        }
        missing = tuple(c for c in policy.COMPONENTS if c not in present)
        row = ScoredCandidate(
            candidate_key=key,
            status=candidate.status,
            component_scores=present,
            missing_components=missing,
        )
        if key in ranks:
            row.total_score = totals[key].quantize(Decimal("0.0001"))
            row.rank = ranks[key]
            row.stable_count = stability["stable_counts"][key]
            row.stability_class = stability["classes"][key]
            row.stability_membership = stability["membership"][key]
        rows.append(row)
    return rows, stability


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #


def _score_summary(rows: Sequence[ScoredCandidate]) -> dict[str, str]:
    values = [row.total_score for row in rows if row.total_score is not None]
    if not values:
        return {"count": "0"}
    mean = sum(values, start=Decimal("0")) / Decimal(len(values))
    return {
        "count": str(len(values)),
        "mean": format(mean.quantize(Decimal("0.0001")), "f"),
        "min": format(min(values), "f"),
        "max": format(max(values), "f"),
        "distinct": str(len({v for v in values})),
    }


def _assert_source_run(session: Session, source_run_id: int) -> dict[str, Any]:
    row = (
        session.execute(
            text(
                "SELECT id, status, component_model_version, reference_year, boundary_vintage, "
                "candidate_grid_version FROM suitability_analysis_runs WHERE id = :id"
            ),
            {"id": source_run_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise SuccessorBuildError(f"source run {source_run_id} does not exist")
    if row["status"] != "SUCCEEDED":
        raise SuccessorBuildError(
            f"source run {source_run_id} is {row['status']}, not SUCCEEDED; a successor run "
            "must inherit a completed screening"
        )
    if row["component_model_version"] != component_model.COMPONENT_MODEL_HISTORICAL:
        raise SuccessorBuildError(
            f"source run {source_run_id} was produced by "
            f"{row['component_model_version']!r}; a successor run is derived from a historical "
            "run so that it inherits the constraint screening rather than re-deriving it"
        )
    return dict(row)


def build_successor_run(
    session: Session,
    *,
    source_run_id: int,
    now: datetime.datetime | None = None,
) -> SuccessorBuildReport:
    """Produce and persist one successor run derived from a historical run.

    The successor model must be *approved* — a policy version and a registered
    weight profile — but need not be *activated*: activation additionally governs
    whether the model is the default any user sees, and that stays a separate,
    explicit decision. Writing a run reachable only by explicit id is step 2 of the
    approved switchover sequence.
    """

    if policy.SUCCESSOR_POLICY_VERSION is None or policy.SUCCESSOR_DERIVATION_VERSION is None:
        raise SuccessorBuildError(
            "no approved successor policy identity; refusing to write a run that could not "
            "state which policy produced it"
        )
    if not policy.SUCCESSOR_WEIGHT_PROFILES:
        raise SuccessorBuildError("no approved successor weight profile; refusing to score")
    registry = land_conversion.PRODUCTION_REGISTRY
    if registry is None or not registry.approved:
        raise SuccessorBuildError("no approved land-cover class registry; refusing to score")
    floor = resident_impact.PRODUCTION_DISTANCE_FLOOR
    if not floor.approved:
        raise SuccessorBuildError("no approved resident distance floor; refusing to score")
    policy.validate_successor_policy()

    now = now or datetime.datetime.now(datetime.UTC)
    source = _assert_source_run(session, source_run_id)
    reference_year = int(source["reference_year"])

    regions = successor_inputs.load_sigungu_regions(session)
    population = successor_inputs.load_population(session)
    candidates = successor_inputs.load_candidates(session, source_run_id)
    if not candidates:
        raise SuccessorBuildError(f"source run {source_run_id} has no candidates")

    burden = existing_burden.build_series(
        successor_inputs.load_existing_burden_inputs(session, regions, population, reference_year)
    )
    air = air_impact_proxy.build_series(
        successor_inputs.load_air_impact_inputs(session, regions, population, reference_year)
    )
    resident = _resident_impact_series(
        successor_inputs.load_resident_impact(session, source_run_id, floor.distance_floor_m),
        floor,
    )
    land = land_conversion.build_series(
        successor_inputs.load_land_conversion_inputs(session, registry.class_level), registry
    )

    component_scores = project_component_scores(candidates, burden, air, resident, land)
    rows, stability = score_candidates(candidates, component_scores)

    run_id = _insert_run_row(session, source, now)
    _persist_candidates(session, run_id, source_run_id, rows, now)

    report = _report(
        run_id, source_run_id, candidates, rows, component_scores, population, stability,
        {"existing_burden": burden, "air_impact_proxy": air, "resident_impact": resident,
         "land_conversion": land},
    )
    _finalize_run(session, run_id, report, stability, floor, registry, now)
    return report


def _report(
    run_id: int,
    source_run_id: int,
    candidates: Sequence[successor_inputs.CandidateRow],
    rows: Sequence[ScoredCandidate],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    population: Mapping[str, int],
    stability: Mapping[str, Any],
    series: Mapping[str, contract.ComponentSeries],
) -> SuccessorBuildReport:
    status_of = {c.candidate_key: c.status for c in candidates}
    region_of = {
        c.candidate_key: c.sigungu_region_code
        for c in candidates
        if c.sigungu_region_code is not None
    }

    complete_case = [row.candidate_key for row in rows if not row.missing_components]
    by_status: dict[str, int] = {}
    for key in complete_case:
        status = status_of.get(key, "UNKNOWN")
        by_status[status] = by_status.get(status, 0) + 1
    totals: dict[str, int] = {}
    for candidate in candidates:
        totals[candidate.status] = totals.get(candidate.status, 0) + 1

    ranked = [row for row in rows if row.rank is not None]
    ranked_regions = {region_of[r.candidate_key] for r in ranked if r.candidate_key in region_of}

    return SuccessorBuildReport(
        run_id=run_id,
        source_run_id=source_run_id,
        candidate_count_total=len(rows),
        candidate_count_ranked=len(ranked),
        complete_case_count=len(complete_case),
        complete_case_by_screening_status=dict(sorted(by_status.items())),
        source_status_totals=dict(sorted(totals.items())),
        component_available_counts={
            component: len(component_scores[component]) for component in policy.COMPONENTS
        },
        component_unavailable_reasons={
            component: series[component].unavailable_reason_counts()
            for component in policy.COMPONENTS
        },
        regions_represented=len(ranked_regions),
        residents_represented=sum(population.get(code, 0) for code in ranked_regions),
        stability_tally=dict(stability["tally"]),
        top_cutoff_rank=int(stability["top_cutoff_rank"]),
        score_summary=_score_summary(rows),
    )


def _insert_run_row(session: Session, source: Mapping[str, Any], now: datetime.datetime) -> int:
    """Insert the RUNNING successor run row, asserting its own model identity."""

    model_version, order = component_model.validate_run_model_identity(
        component_model.COMPONENT_MODEL_SUCCESSOR,
        list(component_model.COMPONENT_ORDER_SUCCESSOR),
    )
    snapshot = policy.successor_snapshot()
    snapshot["source_run_id"] = source["id"]
    snapshot["source_component_model_version"] = source["component_model_version"]

    result = session.execute(
        text(
            """
            INSERT INTO suitability_analysis_runs (
                derivation_version, policy_version, candidate_grid_version,
                component_model_version, component_order, reference_year, boundary_vintage,
                weight_profile, analysis_signature, status, input_dataset_version_ids,
                input_provenance, policy_snapshot, weight_profiles, weight_derivation,
                stability_definition, started_at, created_at
            ) VALUES (
                :derivation_version, :policy_version, :candidate_grid_version,
                :component_model_version, CAST(:component_order AS jsonb), :reference_year,
                :boundary_vintage, :weight_profile, :analysis_signature, 'RUNNING',
                CAST(:input_dataset_version_ids AS jsonb), CAST(:input_provenance AS jsonb),
                CAST(:policy_snapshot AS jsonb), CAST(:weight_profiles AS jsonb),
                CAST(:weight_derivation AS jsonb), CAST(:stability_definition AS jsonb),
                :now, :now
            ) RETURNING id
            """
        ),
        {
            "derivation_version": policy.SUCCESSOR_DERIVATION_VERSION,
            "policy_version": policy.SUCCESSOR_POLICY_VERSION,
            "candidate_grid_version": source["candidate_grid_version"],
            "component_model_version": model_version,
            "component_order": json.dumps(order),
            "reference_year": source["reference_year"],
            "boundary_vintage": source["boundary_vintage"],
            "weight_profile": policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE,
            "analysis_signature": _analysis_signature(source, now),
            "input_dataset_version_ids": json.dumps([]),
            "input_provenance": json.dumps(
                {
                    "source_run_id": source["id"],
                    "screening_inherited_from": source["id"],
                    "screening_note": (
                        "Candidate grid, region assignment, and constraint-screening status are "
                        "copied from the source run. The successor model re-scores and never "
                        "re-screens."
                    ),
                },
                ensure_ascii=False,
            ),
            "policy_snapshot": json.dumps(snapshot, ensure_ascii=False),
            "weight_profiles": json.dumps(
                dict(policy.SUCCESSOR_WEIGHT_PROFILES), ensure_ascii=False
            ),
            "weight_derivation": json.dumps(
                {
                    "method": "APPROVED_POLICY_ASSERTION",
                    "derived_from_data": False,
                    "critic_used": False,
                    "approval": policy.POLICY_CLOSURE_APPROVAL,
                    "rationale": dict(policy.SUCCESSOR_WEIGHT_RATIONALE),
                },
                ensure_ascii=False,
            ),
            "stability_definition": json.dumps({}, ensure_ascii=False),
            "now": now,
        },
    )
    return int(result.scalar_one())


def _analysis_signature(source: Mapping[str, Any], now: datetime.datetime) -> str:
    """A signature that includes the component model, per the persistence design."""

    import hashlib

    payload = json.dumps(
        {
            "component_model_version": component_model.COMPONENT_MODEL_SUCCESSOR,
            "component_order": list(component_model.COMPONENT_ORDER_SUCCESSOR),
            "policy_version": policy.SUCCESSOR_POLICY_VERSION,
            "derivation_version": policy.SUCCESSOR_DERIVATION_VERSION,
            "weight_profiles": dict(policy.SUCCESSOR_WEIGHT_PROFILES),
            "distance_floor_m": format(
                resident_impact.PRODUCTION_DISTANCE_FLOOR.distance_floor_m, "f"
            ),
            "land_cover_registry_id": (
                land_conversion.PRODUCTION_REGISTRY.registry_id
                if land_conversion.PRODUCTION_REGISTRY
                else None
            ),
            "missing_component_policy": policy.SELECTED_MISSING_COMPONENT_POLICY,
            "ranking_population_rule": policy.RANKING_POPULATION_RULE,
            "source_run_id": source["id"],
            "candidate_grid_version": source["candidate_grid_version"],
            "reference_year": source["reference_year"],
            "built_at": now.isoformat(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _persist_candidates(
    session: Session,
    run_id: int,
    source_run_id: int,
    rows: Sequence[ScoredCandidate],
    now: datetime.datetime,
) -> int:
    """Write successor candidate rows, copying screening and geometry from the source.

    The four legacy ``*_score`` columns are written NULL and are never reused for a
    successor quantity; ``component_scores`` is the authoritative storage. Status,
    exclusion/review reasons, and geometry come from the source run unchanged.
    """

    session.execute(text("DROP TABLE IF EXISTS _successor_scores"))
    session.execute(
        text(
            """
            CREATE TEMP TABLE _successor_scores (
                candidate_key varchar PRIMARY KEY,
                rank integer,
                total_score numeric(7,4),
                component_scores jsonb,
                stable_count smallint,
                stability_class varchar,
                stability_membership jsonb,
                raw_components jsonb
            )
            """
        )
    )
    insert_sql = text(
        """
        INSERT INTO _successor_scores VALUES (
            :candidate_key, :rank, :total_score, CAST(:component_scores AS jsonb),
            :stable_count, :stability_class, CAST(:stability_membership AS jsonb),
            CAST(:raw_components AS jsonb)
        )
        """
    )
    params = [
        {
            "candidate_key": row.candidate_key,
            "rank": row.rank,
            "total_score": row.total_score,
            "component_scores": json.dumps(
                {c: format(v, "f") for c, v in sorted(row.component_scores.items())},
                ensure_ascii=False,
            ),
            "stable_count": row.stable_count,
            "stability_class": row.stability_class,
            "stability_membership": json.dumps(row.stability_membership, ensure_ascii=False),
            "raw_components": json.dumps(
                {
                    "missing_components": list(row.missing_components),
                    "ranked": row.rank is not None,
                    "not_ranked_reason": _not_ranked_reason(row),
                },
                ensure_ascii=False,
            ),
        }
        for row in rows
    ]
    for start in range(0, len(params), 2000):
        session.execute(insert_sql, params[start : start + 2000])

    result = session.execute(
        text(
            """
            INSERT INTO suitability_candidates (
                analysis_run_id, candidate_key, sido_region_code, sido_region_name,
                sigungu_region_code, sigungu_region_name, status, rank, provisional_score,
                total_score, zoning_score, road_score, equity_score, demand_score,
                profile_totals, profile_ranks, stable_count, stability_class,
                stability_membership, component_scores, raw_components, exclusion_reasons,
                review_reasons, penalties, nearest_road_distance_m, nearest_road_provenance,
                component_provenance, original_area_m2, clipped_area_m2, clipped_area_ratio,
                centroid, geometry, created_at
            )
            SELECT
                :run_id, src.candidate_key, src.sido_region_code, src.sido_region_name,
                src.sigungu_region_code, src.sigungu_region_name, src.status, s.rank, NULL,
                s.total_score, NULL, NULL, NULL, NULL,
                '{}'::jsonb, '{}'::jsonb, s.stable_count, s.stability_class,
                s.stability_membership, s.component_scores, s.raw_components,
                src.exclusion_reasons, src.review_reasons, '{}'::jsonb,
                src.nearest_road_distance_m, src.nearest_road_provenance,
                src.component_provenance, src.original_area_m2, src.clipped_area_m2,
                src.clipped_area_ratio, src.centroid, src.geometry, :now
            FROM suitability_candidates src
            JOIN _successor_scores s ON s.candidate_key = src.candidate_key
            WHERE src.analysis_run_id = :source_run_id
            ON CONFLICT ON CONSTRAINT uq_suitability_candidates_run_key DO NOTHING
            RETURNING id
            """
        ),
        {"run_id": run_id, "source_run_id": source_run_id, "now": now},
    )
    return sum(1 for _ in result)


def _not_ranked_reason(row: ScoredCandidate) -> str | None:
    if row.rank is not None:
        return None
    if row.missing_components:
        if row.status != policy.SCREENING_STATUS_RANKABLE:
            return "SCREENING_NOT_ELIGIBLE_AND_INCOMPLETE_COMPONENTS"
        return "INCOMPLETE_COMPONENTS"
    return "SCREENING_NOT_ELIGIBLE"


def _finalize_run(
    session: Session,
    run_id: int,
    report: SuccessorBuildReport,
    stability: Mapping[str, Any],
    floor: resident_impact.DistanceFloor,
    registry: land_conversion.LandCoverClassRegistry,
    now: datetime.datetime,
) -> None:
    definition = dict(stability["definition"])
    definition["distance_floor"] = floor.sanitized_summary()
    definition["land_cover_registry"] = registry.sanitized_summary()

    session.execute(
        text(
            """
            UPDATE suitability_analysis_runs SET
                status = 'SUCCEEDED', completed_at = :now,
                candidate_count_total = :total, candidate_count_eligible = :elig,
                candidate_count_review = :rev, candidate_count_excluded = :exc,
                stability_definition = CAST(:stability_definition AS jsonb)
            WHERE id = :id
            """
        ),
        {
            "now": now,
            "total": report.candidate_count_total,
            # For a successor run "eligible" means the ranking population: the
            # candidates that are both screened ELIGIBLE and completely observed.
            # The source run's own ELIGIBLE count is unchanged and still readable
            # on that run.
            "elig": report.candidate_count_ranked,
            "rev": report.source_status_totals.get("REVIEW_REQUIRED", 0),
            "exc": report.source_status_totals.get("EXCLUDED", 0),
            "stability_definition": json.dumps(definition, ensure_ascii=False),
            "id": run_id,
        },
    )


__all__ = [
    "ScoredCandidate",
    "SuccessorBuildError",
    "SuccessorBuildReport",
    "approved_weights",
    "build_successor_run",
    "project_component_scores",
    "score_candidates",
]
