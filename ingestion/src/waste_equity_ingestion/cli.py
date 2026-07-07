"""Command-line entrypoint for Phase 0 source probes."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Callable

from .config import ProbeSettings
from .errors import MissingCredentialsError, ProbeError
from .probes import airkorea, kma, sgis, vworld, waste_statistics
from .result import ProbeResult
from .samples import build_envelope, save_sample

ProbeFunc = Callable[[ProbeSettings], ProbeResult]

PROBES: dict[str, ProbeFunc] = {
    "airkorea": airkorea.probe,
    "kma": kma.probe,
    "sgis": sgis.probe,
    "vworld": vworld.probe,
    "waste-statistics": waste_statistics.probe,
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Phase 0 API feasibility probe.")
    parser.add_argument("source", choices=sorted(PROBES))
    parser.add_argument("--save-sample", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    settings = ProbeSettings.from_env()
    try:
        payload = PROBES[args.source](settings)
    except MissingCredentialsError as exc:
        print(str(exc), file=sys.stderr)
        return 2
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
        )
        save_sample(settings.sample_dir, f"{args.source}.live.json", envelope)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
