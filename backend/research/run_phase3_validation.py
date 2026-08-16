"""CLI entrypoint for the Phase-3 successor real-data validation.

Read-only. Point ``--database-url`` at a LOCAL PostGIS instance holding the
project's development dataset. This script never writes to the database, never
reaches production, and never activates the successor model.

Usage::

    python research/run_phase3_validation.py \
        --database-url postgresql+psycopg://user:pass@localhost:55432/waste_equity \
        --run-id 47 \
        --output ../docs/research/phase3_evidence.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from suitability_v3_phase3 import extract, validate  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        required=True,
        help="SQLAlchemy URL for a LOCAL PostGIS database (read-only use).",
    )
    parser.add_argument(
        "--run-id",
        type=int,
        required=True,
        help="suitability_analysis_runs.id whose candidate grid is measured.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Where to write the machine-readable evidence bundle (JSON).",
    )
    args = parser.parse_args(argv)

    engine = extract.open_engine(args.database_url)
    with engine.connect() as conn:
        report = validate.run_validation(conn, args.run_id)
    validate.write_report(report, args.output)

    snapshot = report["dataset_snapshot"]
    print(f"run {snapshot['run_id']} ({snapshot['derivation_version']})")
    print(f"candidates: {snapshot['candidate_count']}  sigungu: {snapshot['sigungu_count']}")
    for stage in report["eligibility_shrinkage"]["stages"]:
        print(
            f"  {stage['stage']:<24} remaining={stage['remaining_candidates']:>6} "
            f"removed_cum={stage['removed_cumulative']:>6}"
        )
    print(f"CRITIC viable: {report['critic_viability'].get('viable')}")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
