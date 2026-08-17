"""Build one successor run against a LOCAL database and report what it produced.

This is the Phase-5 real-data validation entrypoint. Unlike the Phase-3/Phase-4
research harnesses, it does **not** re-implement the model: it calls the actual
production write path (``successor.runtime.build_successor_run``) so what is
validated is what would run.

It writes to the database it is pointed at. Point it at a local development
database only; it must never be aimed at production.

Usage::

    python research/run_successor_build.py \
        --database-url postgresql+psycopg://user:pass@localhost:5432/waste_equity \
        --source-run-id 47 \
        --output ../docs/research/v3_phase5_runtime_evidence.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.suitability.successor import runtime


def _verify_stored(session: Session, run_id: int, source_run_id: int) -> dict[str, Any]:
    """Read the run back out of storage and check the invariants that matter."""

    run = (
        session.execute(
            text(
                "SELECT component_model_version, component_order, policy_version, "
                "derivation_version, weight_profile, status, candidate_count_total, "
                "candidate_count_eligible FROM suitability_analysis_runs WHERE id = :id"
            ),
            {"id": run_id},
        )
        .mappings()
        .one()
    )
    counts = (
        session.execute(
            text(
                """
                SELECT
                    count(*) AS total,
                    count(*) FILTER (WHERE rank IS NOT NULL) AS ranked,
                    count(*) FILTER (WHERE component_scores <> '{}'::jsonb) AS with_components,
                    count(*) FILTER (WHERE zoning_score IS NOT NULL
                                        OR road_score IS NOT NULL
                                        OR equity_score IS NOT NULL
                                        OR demand_score IS NOT NULL) AS legacy_columns_written,
                    count(*) FILTER (WHERE stability_class IS NOT NULL) AS classified
                FROM suitability_candidates WHERE analysis_run_id = :id
                """
            ),
            {"id": run_id},
        )
        .mappings()
        .one()
    )
    # The screening must be carried over verbatim: same key set, same status.
    screening = (
        session.execute(
            text(
                """
                SELECT count(*) AS compared,
                       count(*) FILTER (WHERE a.status <> b.status) AS status_differs
                FROM suitability_candidates a
                JOIN suitability_candidates b ON b.candidate_key = a.candidate_key
                WHERE a.analysis_run_id = :run_id AND b.analysis_run_id = :source_run_id
                """
            ),
            {"run_id": run_id, "source_run_id": source_run_id},
        )
        .mappings()
        .one()
    )
    # No ranked candidate may be anything other than ELIGIBLE.
    leak = session.execute(
        text(
            "SELECT count(*) FROM suitability_candidates "
            "WHERE analysis_run_id = :id AND rank IS NOT NULL AND status <> 'ELIGIBLE'"
        ),
        {"id": run_id},
    ).scalar_one()
    # The historical source run must be untouched.
    source_still_scored = session.execute(
        text(
            "SELECT count(*) FROM suitability_candidates "
            "WHERE analysis_run_id = :id AND total_score IS NOT NULL"
        ),
        {"id": source_run_id},
    ).scalar_one()

    top = session.execute(
        text(
            "SELECT sigungu_region_name, count(*) AS n FROM ("
            "  SELECT sigungu_region_name FROM suitability_candidates "
            "  WHERE analysis_run_id = :id AND rank IS NOT NULL ORDER BY rank LIMIT 50"
            ") t GROUP BY 1 ORDER BY 2 DESC"
        ),
        {"id": run_id},
    ).all()

    return {
        "run": {k: run[k] for k in run.keys()},
        "candidate_counts": {k: int(counts[k]) for k in counts.keys()},
        "screening_carryover": {
            "compared": int(screening["compared"]),
            "status_differs": int(screening["status_differs"]),
        },
        "ranked_but_not_eligible": int(leak),
        "source_run_still_scored": int(source_still_scored),
        "top_50_regions": {str(r.sigungu_region_name): int(r.n) for r in top},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--source-run-id", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    engine = create_engine(args.database_url, future=True)
    with Session(engine) as session:
        report = runtime.build_successor_run(session, source_run_id=args.source_run_id)
        session.commit()
        stored = _verify_stored(session, report.run_id, args.source_run_id)

    payload: dict[str, Any] = {
        "phase": "v3-phase5-runtime-validation",
        "build_report": report.sanitized_summary(),
        "stored_verification": stored,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8"
    )

    print(f"successor run {report.run_id} from source {report.source_run_id}")
    print(f"  candidates        {report.candidate_count_total}")
    print(
        f"  complete case     {report.complete_case_count} "
        f"{report.complete_case_by_screening_status}"
    )
    print(f"  ranked            {report.candidate_count_ranked}")
    print(f"  regions/residents {report.regions_represented} / {report.residents_represented}")
    print(f"  components        {report.component_available_counts}")
    print(f"  stability         {report.stability_tally} cutoff={report.top_cutoff_rank}")
    print(f"  scores            {report.score_summary}")
    print(f"  stored            {stored['candidate_counts']}")
    print(
        f"  screening         differs={stored['screening_carryover']['status_differs']} "
        f"ranked_not_eligible={stored['ranked_but_not_eligible']}"
    )
    print(f"  top50 regions     {stored['top_50_regions']}")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
