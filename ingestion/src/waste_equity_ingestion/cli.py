"""Command-line entrypoint for Phase 0 source probes."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable

from .config import ProbeSettings
from .errors import IngestionError, MissingConfigurationError, MissingCredentialsError, ProbeError
from .probes import airkorea, kma, sgis, vworld, waste_statistics, waste_statistics_discovery
from .result import ProbeResult
from .samples import build_envelope, save_sample
from .sgis_ingestion import run_sgis_ingestion

ProbeFunc = Callable[[ProbeSettings], ProbeResult]

PROBES: dict[str, ProbeFunc] = {
    "airkorea": airkorea.probe,
    "kma": kma.probe,
    "sgis": sgis.probe,
    "vworld": vworld.probe,
    "waste-statistics": waste_statistics.probe,
}

DISCOVERY_SOURCE = "waste-statistics-discovery"
SGIS_INGEST = "sgis-ingest"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Phase 0 API feasibility probe.")
    parser.add_argument("source", choices=sorted([*PROBES, DISCOVERY_SOURCE, SGIS_INGEST]))
    parser.add_argument("--save-sample", action="store_true")
    parser.add_argument(
        "--pids",
        help="Comma-separated RCIS PIDs to discover (default: documented target PIDs).",
    )
    parser.add_argument(
        "--year",
        help=(
            "Reference year. Required for sgis-ingest; defaults to the RCIS discovery "
            "year for waste-statistics-discovery."
        ),
    )
    parser.add_argument(
        "--scope",
        default="capital-region",
        choices=["capital-region"],
        help="Production ingestion geographic scope.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true", help="Validate live data without DB writes."
    )
    mode.add_argument(
        "--write", action="store_true", help="Write validated live data to DATABASE_URL."
    )
    return parser.parse_args(argv)


def run_discovery(settings: ProbeSettings, args: argparse.Namespace) -> int:
    year = args.year or waste_statistics_discovery.DEFAULT_DISCOVERY_YEAR
    pids = (
        [pid.strip() for pid in args.pids.split(",") if pid.strip()]
        if args.pids
        else sorted(waste_statistics_discovery.TARGET_PIDS)
    )
    summaries = waste_statistics_discovery.discover(settings, pids, year)
    for summary in summaries:
        payload = summary.pop("payload", None)
        print(json.dumps(summary, ensure_ascii=False))
        if args.save_sample and summary.get("status") == "LIVE_VERIFIED" and payload:
            truncated = waste_statistics_discovery.truncate_payload_records(payload)
            envelope = build_envelope(
                source=waste_statistics.SOURCE,
                endpoint=f"wss/JsonApi/{summary['pid']}",
                payload=truncated,
                verification_status="LIVE_VERIFIED",
                schema_validation_status="LIVE_VERIFIED",
                request_metadata={
                    "pid": summary["pid"],
                    "year": summary["year"],
                    "pid_description": summary["description"],
                    "record_count": summary.get("record_count"),
                    "records_truncated_to": waste_statistics_discovery.SAMPLE_RECORD_LIMIT,
                },
            )
            save_sample(
                settings.sample_dir,
                f"waste-statistics.{summary['pid']}.{summary['year']}.live.json",
                envelope,
            )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    settings = ProbeSettings.from_env()
    try:
        if args.source == DISCOVERY_SOURCE:
            return run_discovery(settings, args)
        if args.source == SGIS_INGEST:
            if not args.year:
                raise IngestionError("sgis-ingest requires --year YYYY")
            if not args.dry_run and not args.write:
                raise IngestionError("sgis-ingest requires either --dry-run or --write")
            report = run_sgis_ingestion(
                settings,
                year=int(args.year),
                scope=args.scope,
                write=bool(args.write),
            )
            print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
            return 0
        payload = PROBES[args.source](settings)
    except MissingCredentialsError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except MissingConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        return 4
    except ProbeError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except Exception as exc:
        print(f"Live API probe failed: {exc}", file=sys.stderr)
        return 1

    safe_summary = {"source": args.source, "status": "LIVE_VERIFIED"}
    print(json.dumps(safe_summary, ensure_ascii=False))

    if args.save_sample:
        envelope = build_envelope(
            source=payload["source"],
            endpoint=payload["endpoint_identifier"],
            payload=payload["payload"],
            verification_status="LIVE_VERIFIED",
            schema_validation_status=payload["schema_validation_status"],
            request_metadata=payload["request_metadata"],
        )
        save_sample(settings.sample_dir, f"{args.source}.live.json", envelope)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
