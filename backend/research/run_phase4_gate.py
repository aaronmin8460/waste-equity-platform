"""CLI entrypoint for the Phase-4 successor policy gate.

Read-only. Point ``--database-url`` at a LOCAL PostGIS instance holding the
project's development dataset. This script never writes to the database, never
reaches production, and never activates the successor model.

Usage::

    python research/run_phase4_gate.py \
        --database-url postgresql+psycopg://user:pass@localhost:55432/waste_equity \
        --run-id 47 \
        --output ../docs/research/phase4_evidence.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from suitability_v3_phase3 import extract, validate  # noqa: E402
from suitability_v3_phase4 import run_gate  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    engine = extract.open_engine(args.database_url)
    with engine.connect() as conn:
        report = run_gate.run_gate(conn, args.run_id)
    validate.write_report(report, args.output)

    snapshot = report["dataset_snapshot"]
    print(f"run {snapshot['run_id']} ({snapshot['derivation_version']})")
    land = report["b16_land_conversion"]
    print(
        f"B16 land_conversion: {land['before_available']} -> {land['after_available']} "
        f"(+{land['recovered_candidates']})"
    )
    burden = report["b17_existing_burden"]
    print(
        f"B17 existing_burden: {burden['before_available_regions']} -> "
        f"{burden['after_available_regions']} regions"
    )
    for floor, eligibility in sorted(report["eligibility"].items(), key=lambda kv: int(kv[0])):
        strict = eligibility["strict_all_components_required"]
        print(
            f"  floor {floor:>4}m  strict eligible={strict['eligible']:>6} "
            f"({strict['eligible_share_pct']}%)"
        )
    print(f"CRITIC viable: {report['critic'].get('viable')}")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
