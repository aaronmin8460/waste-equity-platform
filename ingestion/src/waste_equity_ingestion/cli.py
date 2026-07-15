"""Command-line entrypoint for Phase 0 source probes."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable

from .config import ProbeSettings
from .errors import IngestionError, MissingConfigurationError, MissingCredentialsError, ProbeError
from .landfill_inbound import run_landfill_inbound
from .mois_population_contract import EARLIEST_SUPPORTED_MONTH
from .mois_population_ingestion import run_mois_population_ingestion
from .probes import (
    airkorea,
    kma,
    sgis,
    vworld,
    vworld_structural,
    waste_statistics,
    waste_statistics_discovery,
)
from .rcis_facility_contract import PID_SPECS as FACILITY_PID_SPECS
from .rcis_facility_contract import TARGET_PIDS as FACILITY_TARGET_PIDS
from .rcis_facility_ingestion import run_rcis_facility_ingestion
from .rcis_reporting_geography import run_reporting_geography
from .rcis_waste_contract import PID_SPECS, TARGET_PIDS
from .rcis_waste_ingestion import DEFAULT_REQUEST_DELAY_SECONDS, run_rcis_waste_ingestion
from .result import ProbeResult
from .samples import build_envelope, save_sample
from .sgis_ingestion import run_sgis_ingestion
from .structural_layer_ingestion import run_structural_ingestion
from .suitability_build import run_suitability_build
from .vworld_geocoding_ingestion import run_vworld_geocoding
from .vworld_zoning_ingestion import run_zoning_ingestion

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
RCIS_WASTE_INGEST = "rcis-waste-ingest"
RCIS_REPORTING_GEOGRAPHY = "rcis-reporting-geography"
LANDFILL_INBOUND_INGEST = "landfill-inbound"
MOIS_POPULATION_INGEST = "mois-population-ingest"
RCIS_FACILITY_INGEST = "rcis-facility-ingest"
VWORLD_GEOCODE = "vworld-geocode"
VWORLD_STRUCTURAL_AUDIT = "vworld-structural-audit"
VWORLD_ZONING_INGEST = "vworld-zoning-ingest"
VWORLD_PROTECTED_INGEST = "vworld-protected-ingest"
VWORLD_ROADS_INGEST = "vworld-roads-ingest"
SUITABILITY_BUILD = "suitability-build"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Phase 0 API feasibility probe.")
    parser.add_argument(
        "source",
        choices=sorted(
            [
                *PROBES,
                DISCOVERY_SOURCE,
                SGIS_INGEST,
                RCIS_WASTE_INGEST,
                RCIS_REPORTING_GEOGRAPHY,
                LANDFILL_INBOUND_INGEST,
                MOIS_POPULATION_INGEST,
                RCIS_FACILITY_INGEST,
                VWORLD_GEOCODE,
                VWORLD_STRUCTURAL_AUDIT,
                VWORLD_ZONING_INGEST,
                VWORLD_PROTECTED_INGEST,
                VWORLD_ROADS_INGEST,
                SUITABILITY_BUILD,
            ]
        ),
    )
    parser.add_argument("--save-sample", action="store_true")
    parser.add_argument(
        "--pids",
        help="Comma-separated RCIS PIDs to discover (default: documented target PIDs).",
    )
    parser.add_argument(
        "--pid",
        help=(
            "Comma-separated RCIS PID allowlist. rcis-waste-ingest defaults to "
            "NTN007,NTN008,NTN018,NTN022; rcis-facility-ingest defaults to "
            "NTN031,NTN032,NTN033,NTN040,NTN043,NTN046."
        ),
    )
    parser.add_argument(
        "--year",
        help=(
            "Reference year. Required for sgis-ingest and rcis-waste-ingest; defaults to "
            "the RCIS discovery year for waste-statistics-discovery."
        ),
    )
    parser.add_argument(
        "--scope",
        default="capital-region",
        choices=["capital-region"],
        help="Production ingestion geographic scope.",
    )
    parser.add_argument(
        "--request-delay",
        type=float,
        default=DEFAULT_REQUEST_DELAY_SECONDS,
        help="Seconds between RCIS PID requests (respects the 100 calls/minute quota).",
    )
    parser.add_argument(
        "--fail-on-unmatched",
        action="store_true",
        help="Fail the run if any in-scope RCIS record is unmatched or ambiguous.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="vworld-geocode: geocode at most N pending facilities this run.",
    )
    parser.add_argument(
        "--service",
        help=(
            "vworld-structural-audit: comma-separated probe services "
            "(wfs, data, ownership, landuse; default: all)."
        ),
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="vworld-geocode: re-attempt facilities whose previous geocode failed.",
    )
    parser.add_argument(
        "--source-path",
        help=(
            "vworld-zoning-ingest: local root directory containing the official "
            "seoul/incheon/gyeonggi zoning bulk files (Git-ignored; defaults to "
            "data/raw/vworld/zoning)."
        ),
    )
    parser.add_argument(
        "--reference-date",
        help="vworld-zoning-ingest: official dataset reference date (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--source-encoding",
        default=None,
        help="vworld-zoning-ingest: source DBF attribute encoding (default cp949).",
    )
    parser.add_argument(
        "--reference-year",
        type=int,
        help="suitability-build: analysis reference year (default 2024).",
    )
    parser.add_argument(
        "--policy-version",
        default="suitability-policy-v1",
        help="suitability-build: screening policy version (default suitability-policy-v1).",
    )
    parser.add_argument(
        "--profile",
        default="baseline",
        help=(
            "suitability-build: active weight profile "
            "(baseline, equal, equity_focused, access_focused; default baseline)."
        ),
    )
    parser.add_argument(
        "--start-month",
        help=(
            "First YYYY-MM to ingest (mois-population-ingest). "
            f"Must not precede {EARLIEST_SUPPORTED_MONTH}."
        ),
    )
    parser.add_argument(
        "--end-month",
        help=(
            "Last YYYY-MM to ingest (mois-population-ingest). Defaults to the latest "
            "month the official MOIS page reports as published."
        ),
    )
    parser.add_argument(
        "--source-file",
        help=(
            "Path to an officially downloaded MOIS CSV, used instead of the live "
            "download (mois-population-ingest). The file is never committed."
        ),
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true", help="Validate live data without DB writes."
    )
    mode.add_argument(
        "--write", action="store_true", help="Write validated live data to DATABASE_URL."
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Alias for --write (landfill-inbound): write validated live data to DATABASE_URL.",
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


def run_rcis_waste(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.year:
        raise IngestionError("rcis-waste-ingest requires --year YYYY")
    if not args.dry_run and not args.write:
        raise IngestionError("rcis-waste-ingest requires either --dry-run or --write")
    if args.pid:
        requested = tuple(pid.strip().upper() for pid in args.pid.split(",") if pid.strip())
        unsupported = [pid for pid in requested if pid not in PID_SPECS]
        if unsupported:
            raise IngestionError(
                "Unsupported RCIS waste PID(s): "
                + ", ".join(unsupported)
                + f". Allowed: {', '.join(TARGET_PIDS)}"
            )
        pids = requested
    else:
        pids = TARGET_PIDS
    report = run_rcis_waste_ingestion(
        settings,
        year=int(args.year),
        scope=args.scope,
        write=bool(args.write),
        pids=pids,
        request_delay=float(args.request_delay),
        fail_on_unmatched=bool(args.fail_on_unmatched),
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_reporting_geography_cli(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.year:
        raise IngestionError("rcis-reporting-geography requires --year YYYY")
    if not args.dry_run and not args.write:
        raise IngestionError("rcis-reporting-geography requires either --dry-run or --write")
    report = run_reporting_geography(
        settings,
        year=int(args.year),
        scope=args.scope,
        write=bool(args.write),
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_landfill_inbound_cli(settings: ProbeSettings, args: argparse.Namespace) -> int:
    write = bool(args.write or args.apply)
    if not args.dry_run and not write:
        raise IngestionError("landfill-inbound requires either --dry-run or --apply/--write")
    report = run_landfill_inbound(settings, scope=args.scope, write=write)
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_mois_population_cli(settings: ProbeSettings, args: argparse.Namespace) -> int:
    write = bool(args.write or args.apply)
    if not args.dry_run and not write:
        raise IngestionError("mois-population-ingest requires either --dry-run or --write/--apply")
    report = run_mois_population_ingestion(
        settings,
        scope=args.scope,
        start_month=args.start_month or EARLIEST_SUPPORTED_MONTH,
        end_month=args.end_month,
        write=write,
        source_file=args.source_file,
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    # A dry run that could not validate the requested coverage is a failure the
    # operator must see in the exit code, not only in the JSON.
    return 0 if report.status in {"SUCCESS", "DRY_RUN_OK"} else 5


def run_rcis_facility(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.year:
        raise IngestionError("rcis-facility-ingest requires --year YYYY")
    if not args.dry_run and not args.write:
        raise IngestionError("rcis-facility-ingest requires either --dry-run or --write")
    if args.pid:
        requested = tuple(pid.strip().upper() for pid in args.pid.split(",") if pid.strip())
        unsupported = [pid for pid in requested if pid not in FACILITY_PID_SPECS]
        if unsupported:
            raise IngestionError(
                "Unsupported RCIS facility PID(s): "
                + ", ".join(unsupported)
                + f". Allowed: {', '.join(FACILITY_TARGET_PIDS)}"
            )
        pids = requested
    else:
        pids = FACILITY_TARGET_PIDS
    report = run_rcis_facility_ingestion(
        settings,
        year=int(args.year),
        scope=args.scope,
        write=bool(args.write),
        pids=pids,
        request_delay=float(args.request_delay),
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_vworld_structural_audit(settings: ProbeSettings, args: argparse.Namespace) -> int:
    services = (
        tuple(service.strip().lower() for service in args.service.split(",") if service.strip())
        if args.service
        else vworld_structural.SUPPORTED_SERVICES
    )
    summaries = vworld_structural.run_structural_audit(
        settings,
        save_samples=bool(args.save_sample),
        services=services,
        request_delay=float(args.request_delay),
    )
    for summary in summaries:
        print(json.dumps(summary, ensure_ascii=False))
    return 0


def run_vworld_zoning(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.dry_run and not args.write:
        raise IngestionError("vworld-zoning-ingest requires either --dry-run or --write")
    if not args.reference_date:
        raise IngestionError("vworld-zoning-ingest requires --reference-date YYYY-MM-DD")
    source_path = args.source_path or "data/raw/vworld/zoning"
    kwargs: dict[str, str] = {}
    if args.source_encoding:
        kwargs["encoding"] = args.source_encoding
    report = run_zoning_ingestion(
        settings,
        source_path=source_path,
        reference_date=args.reference_date,
        scope=args.scope,
        write=bool(args.write),
        **kwargs,
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    # A run that found no official source files is honest, not a crash: exit 0
    # but never claim success.
    return 0


def run_vworld_structural(settings: ProbeSettings, args: argparse.Namespace, family: str) -> int:
    if not args.dry_run and not args.write:
        raise IngestionError(f"vworld-{family}-ingest requires either --dry-run or --write")
    # Reference dates are now per-dataset from the Git-ignored source_manifest.json
    # (protected and road sources have different official reference periods), so
    # --reference-date is optional and no longer forced family-wide.
    source_path = args.source_path or f"data/raw/vworld/{family}"
    report = run_structural_ingestion(
        settings,
        family=family,
        source_path=source_path,
        reference_date=args.reference_date,
        scope=args.scope,
        write=bool(args.write),
        encoding=args.source_encoding or "cp949",
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_vworld_geocode(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.dry_run and not args.write:
        raise IngestionError("vworld-geocode requires either --dry-run or --write")
    report = run_vworld_geocoding(
        settings,
        write=bool(args.write),
        request_delay=float(args.request_delay),
        limit=args.limit,
        retry_failed=bool(args.retry_failed),
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
    return 0


def run_suitability(settings: ProbeSettings, args: argparse.Namespace) -> int:
    if not args.dry_run and not args.write:
        raise IngestionError("suitability-build requires either --dry-run or --write")
    report = run_suitability_build(
        settings,
        reference_year=int(args.reference_year) if args.reference_year else 2024,
        policy_version=args.policy_version,
        profile=args.profile,
        scope=args.scope,
        write=bool(args.write),
    )
    print(json.dumps(report.sanitized_summary(), ensure_ascii=False))
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
        if args.source == RCIS_WASTE_INGEST:
            return run_rcis_waste(settings, args)
        if args.source == RCIS_REPORTING_GEOGRAPHY:
            return run_reporting_geography_cli(settings, args)
        if args.source == LANDFILL_INBOUND_INGEST:
            return run_landfill_inbound_cli(settings, args)
        if args.source == MOIS_POPULATION_INGEST:
            return run_mois_population_cli(settings, args)
        if args.source == RCIS_FACILITY_INGEST:
            return run_rcis_facility(settings, args)
        if args.source == VWORLD_GEOCODE:
            return run_vworld_geocode(settings, args)
        if args.source == VWORLD_STRUCTURAL_AUDIT:
            return run_vworld_structural_audit(settings, args)
        if args.source == VWORLD_ZONING_INGEST:
            return run_vworld_zoning(settings, args)
        if args.source == VWORLD_PROTECTED_INGEST:
            return run_vworld_structural(settings, args, "protected")
        if args.source == VWORLD_ROADS_INGEST:
            return run_vworld_structural(settings, args, "roads")
        if args.source == SUITABILITY_BUILD:
            return run_suitability(settings, args)
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
