#!/usr/bin/env python3
"""Build, check, and compare the municipal-cost GOLDEN_LOCAL_RESULT.

The golden result is the deterministic release artifact that proves a LOCAL
municipal-cost dry run and a PRODUCTION municipal-cost dry run describe exactly
the same load. It is built from three inputs that are all already produced by
the reviewed pipeline:

  1. the ``--report-path`` JSON written by ``waste-equity-probe
     municipal-costs-ingest`` (``MunicipalCostReport.sanitized_summary()``);
  2. a SHA-256 inventory of the private source workbooks, walked from disk;
  3. the release Git SHA the code was built from.

Design constraints (see docs/municipal-costs/GOLDEN_LOCAL_RESULT.md):

  * **Read-only.** Nothing here touches a database, a container, or the network.
    Source workbooks are opened read-only, streamed for hashing, and never
    written, resaved, parsed, or printed.
  * **No private absolute paths.** The ingestion report records ``source_dir``
    as an absolute local path; it is deliberately dropped from the comparable
    core and only its basename is kept as provenance. A local path must never
    reach a released artifact or a citizen-facing payload.
  * **No workbook contents.** Only per-file SHA-256, byte size, and the path
    relative to the source root are recorded — the same provenance grain the
    public API already discloses.
  * **Environment-independent comparison.** ``mode``, ``status``,
    ``ingestion_run_id``, ``writes`` and ``idempotent_no_op`` differ legitimately
    between a dry run and a write, and between hosts; they are recorded as
    provenance and never compared.
  * **Fails loudly.** Every subcommand exits non-zero on the first real
    mismatch and prints the exact JSON path that differs.

Usage:

  # 1. inventory the private source tree (read-only)
  municipal_cost_release_result.py inventory --source-dir DIR [--archive ZIP] [--out FILE]

  # 2. freeze the golden result after A/B/C/D integration
  municipal_cost_release_result.py build --report REPORT.json --release-sha SHA \\
      --source-dir DIR [--archive ZIP] [--label TEXT] [--out FILE]

  # 3. gate it against the reviewed invariants
  municipal_cost_release_result.py check --golden GOLDEN.json \\
      [--expect-available N] [--expect-partial N] [--expect-unavailable N] \\
      [--require-status KEY=STATUS] [--require-reason-code KEY=CODE]

  # 4. on the production host, build the same artifact and compare
  municipal_cost_release_result.py compare --golden GOLDEN.json --candidate PROD.json

Exit codes: 0 pass, 1 mismatch/invariant failure, 2 usage or input error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import unicodedata
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ARTIFACT_NAME = "municipal-cost-golden-local-result"
ARTIFACT_VERSION = "1"

EXPECTED_INDICATOR_CODE = "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA"
EXPECTED_REFERENCE_YEAR = 2024
EXPECTED_MUNICIPALITY_COUNT = 66
EXPECTED_COUNT_BY_METROPOLITAN = {"11": 25, "28": 10, "41": 31}
STATUS_AVAILABLE = "AVAILABLE"
STATUS_PARTIAL = "PARTIAL"
STATUS_UNAVAILABLE = "UNAVAILABLE"
ALL_STATUSES = (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE)

WORKBOOK_SUFFIX = ".xlsx"
MAX_REPORTED_DIFFERENCES = 40


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


class ToolError(Exception):
    """A usage or input error — exit code 2, never a silent fallback."""


def nfc(value: str) -> str:
    """macOS hands back NFD Korean filenames; every stored path is NFC."""

    return unicodedata.normalize("NFC", value)


def canonical_json(payload: Any) -> str:
    """Byte-stable JSON: sorted keys, no incidental whitespace, real UTF-8."""

    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ToolError(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ToolError(f"not valid JSON: {path} ({exc})") from exc


def refuse_tracked_output(path: Path) -> None:
    """Refuse to write a release artifact into a Git-TRACKED location.

    The golden result names every source workbook. That grain is already public
    through the API, but the repository rule is that no municipal source
    artifact is committed, so the tool refuses rather than trusting the operator
    to remember. A path outside any Git repository is fine.
    """

    parent = path.parent if path.parent != Path("") else Path(".")
    try:
        inside = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=parent if parent.exists() else Path.cwd(),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return  # no git available: nothing to protect against
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", str(path)],
        cwd=parent if parent.exists() else Path.cwd(),
        capture_output=True,
        text=True,
        check=False,
    )
    if ignored.returncode != 0:
        raise ToolError(
            f"refusing to write {path}: it is inside a Git working tree and is NOT "
            "Git-ignored. Write the golden result to the Git-ignored "
            "artifacts/municipal-costs/ tree or to a path outside the checkout."
        )


def write_output(payload: Any, out: Path | None) -> None:
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    if out is None:
        sys.stdout.write(text)
        return
    refuse_tracked_output(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out}")


# ---------------------------------------------------------------------------
# source inventory
# ---------------------------------------------------------------------------


def build_inventory(source_dir: Path, archive: Path | None = None) -> dict[str, Any]:
    """Walk the private source tree and record one SHA-256 per workbook.

    Contents are never read into memory as text and never emitted. Hidden files,
    AppleDouble sidecars and non-workbook files are excluded so a stray
    ``.DS_Store`` cannot change the digest.
    """

    if not source_dir.is_dir():
        raise ToolError(f"source directory not found: {source_dir}")

    entries: list[dict[str, Any]] = []
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file():
            continue
        name = path.name
        if name.startswith(".") or name.startswith("._"):
            continue
        if path.suffix.lower() != WORKBOOK_SUFFIX:
            continue
        relative = nfc(str(path.relative_to(source_dir)))
        entries.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "size_bytes": path.stat().st_size,
            }
        )
    entries.sort(key=lambda item: item["path"])

    paths = [item["path"] for item in entries]
    if len(set(paths)) != len(paths):
        raise ToolError("source inventory contains duplicate normalised paths")

    inventory: dict[str, Any] = {
        "file_count": len(entries),
        "digest": inventory_digest(entries),
        "files": entries,
        "archive_sha256": None,
        "archive_member_count": None,
    }
    if archive is not None:
        if not archive.is_file():
            raise ToolError(f"archive not found: {archive}")
        inventory["archive_sha256"] = sha256_file(archive)
        with zipfile.ZipFile(archive) as zf:
            inventory["archive_member_count"] = len(zf.namelist())
    return inventory


def inventory_digest(entries: list[dict[str, Any]]) -> str:
    """One deterministic aggregate over the whole source set.

    ``sha256sum``-shaped lines, sorted by path, so the digest can be reproduced
    by hand on any host without this tool.
    """

    lines = "".join(f"{item['sha256']}  {item['path']}\n" for item in entries)
    return "sha256:" + sha256_text(lines)


def verify_inventory(inventory: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    files = inventory.get("files")
    if not isinstance(files, list):
        return ["source_inventory.files is missing or not a list"]
    if inventory.get("file_count") != len(files):
        problems.append(
            f"source_inventory.file_count {inventory.get('file_count')} != {len(files)} entries"
        )
    paths = [item.get("path") for item in files]
    if paths != sorted(paths):
        problems.append("source_inventory.files is not sorted by path")
    if len(set(paths)) != len(paths):
        problems.append("source_inventory.files contains duplicate paths")
    recomputed = inventory_digest(files)
    if inventory.get("digest") != recomputed:
        problems.append(
            f"source_inventory.digest {inventory.get('digest')} != recomputed {recomputed}"
        )
    for item in files:
        sha = item.get("sha256", "")
        if not isinstance(sha, str) or len(sha) != 64:
            problems.append(f"source_inventory entry {item.get('path')!r} has no valid sha256")
    return problems


# ---------------------------------------------------------------------------
# golden result
# ---------------------------------------------------------------------------


def build_golden(
    report: dict[str, Any],
    release_sha: str,
    inventory: dict[str, Any] | None,
    label: str | None,
) -> dict[str, Any]:
    """Project an ingestion report into the comparable release artifact."""

    for key in ("source", "reference_year", "indicator_code", "registry", "municipalities"):
        if key not in report:
            raise ToolError(
                f"report is missing {key!r} — is it a municipal-costs "
                "--report-path JSON produced by this release?"
            )
    if report.get("source") != "municipal-waste-costs":
        raise ToolError(f"report is for source {report.get('source')!r}, not municipal-waste-costs")

    municipalities = [_municipality(entry) for entry in report["municipalities"]]
    municipalities.sort(key=lambda item: item["municipality_key"])

    rejected = sorted(
        (dict(item) for item in report.get("rejected_files", [])),
        key=lambda item: (str(item.get("relative_path")), str(item.get("filename"))),
    )

    comparable: dict[str, Any] = {
        "release_sha": release_sha,
        "reference_year": report["reference_year"],
        "indicator_code": report["indicator_code"],
        "indicator_unit": report.get("indicator", {}).get("unit"),
        "methodology_version": report.get("methodology_version"),
        "transformation_version": report.get("transformation_version"),
        "source_files": report.get("source_files", {}),
        "rejected_files": rejected,
        "duplicate_source_series": report.get("duplicate_source_series", []),
        "registry": report.get("registry", {}),
        "observations": report.get("observations", {}),
        "indicator": {
            "unit": report.get("indicator", {}).get("unit"),
            "numerator_total_krw": report.get("indicator", {}).get("numerator_total_krw"),
            "counts": report.get("indicator", {}).get("counts", {}),
        },
        "municipalities": municipalities,
        "warnings": sorted(report.get("warnings", [])),
        "source_inventory": inventory,
    }

    document = {
        "artifact": ARTIFACT_NAME,
        "artifact_version": ARTIFACT_VERSION,
        "comparable_sha256": sha256_text(canonical_json(comparable)),
        "comparable": comparable,
        # Recorded for the audit trail; deliberately NOT part of the comparison.
        "provenance": {
            "label": label,
            "report_mode": report.get("mode"),
            "report_status": report.get("status"),
            "ingestion_run_id": report.get("ingestion_run_id"),
            "writes": report.get("writes", {}),
            "idempotent_no_op": report.get("idempotent_no_op"),
            # basename only — an absolute private path never enters an artifact
            "source_dir_basename": Path(str(report.get("source_dir", ""))).name,
        },
    }
    return document


def _municipality(entry: dict[str, Any]) -> dict[str, Any]:
    """Keep exactly the fields the release contract is written against."""

    return {
        "municipality_key": entry.get("municipality_key"),
        "display_name": entry.get("display_name"),
        "metropolitan_code": entry.get("metropolitan_code"),
        "population": entry.get("population"),
        "population_method": entry.get("population_method"),
        "status": entry.get("status"),
        "value": entry.get("value"),
        "numerator_krw": entry.get("numerator_krw"),
        "eligible_contract_count": entry.get("eligible_contract_count"),
        "reason_codes": entry.get("reason_codes", []),
        "source_file_count": entry.get("source_file_count"),
        "has_data_a": entry.get("has_data_a"),
        "has_data_b": entry.get("has_data_b"),
    }


def comparable_of(document: dict[str, Any], origin: str) -> dict[str, Any]:
    if document.get("artifact") != ARTIFACT_NAME:
        raise ToolError(
            f"{origin} is not a {ARTIFACT_NAME} document (artifact={document.get('artifact')!r}). "
            "Run `build` on the host first, then compare two built artifacts."
        )
    comparable = document.get("comparable")
    if not isinstance(comparable, dict):
        raise ToolError(f"{origin} has no 'comparable' object")
    recorded = document.get("comparable_sha256")
    recomputed = sha256_text(canonical_json(comparable))
    if recorded != recomputed:
        raise ToolError(
            f"{origin} has been edited after it was built: comparable_sha256 {recorded} "
            f"!= recomputed {recomputed}"
        )
    return comparable


# ---------------------------------------------------------------------------
# invariants
# ---------------------------------------------------------------------------


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def check_invariants(
    comparable: dict[str, Any],
    expect_counts: dict[str, int | None],
    require_status: dict[str, str],
    require_reason: list[tuple[str, str]],
) -> list[str]:
    """The reviewed release invariants. Every failure is a hard no-go."""

    problems: list[str] = []

    if comparable.get("reference_year") != EXPECTED_REFERENCE_YEAR:
        problems.append(
            f"reference_year is {comparable.get('reference_year')}, "
            f"expected {EXPECTED_REFERENCE_YEAR}"
        )
    if comparable.get("indicator_code") != EXPECTED_INDICATOR_CODE:
        problems.append(
            f"indicator_code is {comparable.get('indicator_code')!r}, "
            f"expected {EXPECTED_INDICATOR_CODE!r}"
        )
    if not comparable.get("release_sha"):
        problems.append("release_sha is empty — the artifact must name the code it came from")

    # --- registry is exactly the reviewed 2024 scope -------------------------
    registry = comparable.get("registry", {})
    if registry.get("expected") != EXPECTED_MUNICIPALITY_COUNT:
        problems.append(
            f"registry.expected is {registry.get('expected')}, "
            f"expected {EXPECTED_MUNICIPALITY_COUNT}"
        )
    if registry.get("built") != EXPECTED_MUNICIPALITY_COUNT:
        problems.append(
            f"registry.built is {registry.get('built')}, expected {EXPECTED_MUNICIPALITY_COUNT}"
        )
    for code, want in EXPECTED_COUNT_BY_METROPOLITAN.items():
        got = registry.get("by_metropolitan", {}).get(code)
        if got != want:
            problems.append(f"registry.by_metropolitan[{code}] is {got}, expected {want}")

    # --- one row per municipality, no duplicates, no strays ------------------
    municipalities = comparable.get("municipalities", [])
    if len(municipalities) != EXPECTED_MUNICIPALITY_COUNT:
        problems.append(
            f"{len(municipalities)} municipalities present, expected {EXPECTED_MUNICIPALITY_COUNT}"
        )
    keys = [item.get("municipality_key") for item in municipalities]
    if len(set(keys)) != len(keys):
        problems.append("duplicate municipality_key values")
    by_key = {item.get("municipality_key"): item for item in municipalities}

    # --- status distribution -------------------------------------------------
    counts = comparable.get("indicator", {}).get("counts", {})
    unknown = sorted(set(counts) - set(ALL_STATUSES))
    if unknown:
        problems.append(f"unexpected status bucket(s) in indicator.counts: {unknown}")
    total = sum(int(counts.get(status, 0)) for status in ALL_STATUSES)
    if total != EXPECTED_MUNICIPALITY_COUNT:
        problems.append(
            f"AVAILABLE+PARTIAL+UNAVAILABLE is {total}, expected {EXPECTED_MUNICIPALITY_COUNT}"
        )
    observed = {status: 0 for status in ALL_STATUSES}
    for item in municipalities:
        status = item.get("status")
        if status not in observed:
            problems.append(f"{item.get('municipality_key')}: unknown status {status!r}")
            continue
        observed[status] += 1
    for status in ALL_STATUSES:
        if int(counts.get(status, 0)) != observed[status]:
            problems.append(
                f"indicator.counts[{status}]={counts.get(status)} disagrees with "
                f"{observed[status]} municipality rows"
            )
    for status in ALL_STATUSES:
        want = expect_counts.get(status)
        if want is not None and observed[status] != want:
            problems.append(f"{status} count is {observed[status]}, expected {want}")

    # --- missing is never zero ----------------------------------------------
    for item in municipalities:
        key = item.get("municipality_key")
        status = item.get("status")
        value = _decimal(item.get("value"))
        numerator = _decimal(item.get("numerator_krw"))
        if status == STATUS_UNAVAILABLE:
            if item.get("value") is not None:
                problems.append(f"{key}: UNAVAILABLE but value is {item.get('value')!r}, not null")
            if item.get("numerator_krw") is not None:
                problems.append(
                    f"{key}: UNAVAILABLE but numerator_krw is "
                    f"{item.get('numerator_krw')!r}, not null"
                )
        elif status in (STATUS_AVAILABLE, STATUS_PARTIAL):
            if value is None:
                problems.append(f"{key}: {status} but value is null or unparseable")
            if numerator is None:
                problems.append(f"{key}: {status} but numerator_krw is null or unparseable")
            population = item.get("population")
            if not isinstance(population, int) or population <= 0:
                problems.append(f"{key}: {status} but population is {population!r}")
        if value is not None and value == 0:
            problems.append(f"{key}: value is 0 — missing must never be represented as zero")
        if numerator is not None and numerator == 0:
            problems.append(f"{key}: numerator_krw is 0 — missing must never be zero")

    # --- source accounting adds up ------------------------------------------
    source_files = comparable.get("source_files", {})
    discovered = source_files.get("discovered")
    parsed = source_files.get("parsed")
    accepted = source_files.get("accepted")
    rejected = source_files.get("rejected")
    if discovered != parsed:
        problems.append(f"source_files.discovered {discovered} != parsed {parsed}")
    if None not in (accepted, rejected, parsed) and accepted + rejected != parsed:
        problems.append(f"accepted {accepted} + rejected {rejected} != parsed {parsed}")
    if len(comparable.get("rejected_files", [])) != (rejected or 0):
        problems.append(
            f"rejected_files lists {len(comparable.get('rejected_files', []))} entries "
            f"but source_files.rejected is {rejected}"
        )

    # --- source inventory ----------------------------------------------------
    inventory = comparable.get("source_inventory")
    if inventory is None:
        problems.append("source_inventory is absent — the golden result must pin the source set")
    else:
        problems.extend(verify_inventory(inventory))
        if inventory.get("file_count") != discovered:
            problems.append(
                f"source_inventory.file_count {inventory.get('file_count')} != "
                f"source_files.discovered {discovered}"
            )

    # --- explicitly required per-municipality expectations -------------------
    for key, status in require_status.items():
        item = by_key.get(key)
        if item is None:
            problems.append(f"--require-status {key}: municipality is not in the registry")
        elif item.get("status") != status:
            problems.append(
                f"--require-status {key}: status is {item.get('status')!r}, expected {status!r}"
            )
    for key, code in require_reason:
        item = by_key.get(key)
        if item is None:
            problems.append(f"--require-reason-code {key}: municipality is not in the registry")
        elif code not in (item.get("reason_codes") or []):
            problems.append(
                f"--require-reason-code {key}: {code} is absent "
                f"(reason_codes={item.get('reason_codes')})"
            )

    # --- no private absolute path anywhere in the comparable core ------------
    problems.extend(scan_for_absolute_paths(comparable))
    return problems


ABSOLUTE_PATH_MARKERS = ("/home/", "/Users/", "/srv/", "/root/", "C:\\")


def scan_for_absolute_paths(payload: Any, path: str = "$") -> list[str]:
    """Refuse to ship an artifact that leaks a private filesystem location."""

    problems: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            problems.extend(scan_for_absolute_paths(value, f"{path}.{key}"))
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            problems.extend(scan_for_absolute_paths(value, f"{path}[{index}]"))
    elif isinstance(payload, str):
        for marker in ABSOLUTE_PATH_MARKERS:
            if marker in payload:
                problems.append(f"{path} contains an absolute private path fragment {marker!r}")
                break
    return problems


# ---------------------------------------------------------------------------
# diff
# ---------------------------------------------------------------------------


def diff_values(expected: Any, actual: Any, path: str = "$") -> list[str]:
    """Recursive, path-addressed diff. Order matters for lists by design."""

    if isinstance(expected, dict) and isinstance(actual, dict):
        out: list[str] = []
        for key in sorted(set(expected) | set(actual)):
            if key not in expected:
                out.append(f"{path}.{key}: only in candidate ({actual[key]!r})")
            elif key not in actual:
                out.append(f"{path}.{key}: only in golden ({expected[key]!r})")
            else:
                out.extend(diff_values(expected[key], actual[key], f"{path}.{key}"))
        return out
    if isinstance(expected, list) and isinstance(actual, list):
        out = []
        if len(expected) != len(actual):
            out.append(f"{path}: length {len(expected)} (golden) != {len(actual)} (candidate)")
        for index in range(min(len(expected), len(actual))):
            out.extend(diff_values(expected[index], actual[index], f"{path}[{index}]"))
        return out
    if expected != actual:
        return [f"{path}: golden={expected!r} candidate={actual!r}"]
    return []


# ---------------------------------------------------------------------------
# subcommands
# ---------------------------------------------------------------------------


def cmd_inventory(args: argparse.Namespace) -> int:
    inventory = build_inventory(Path(args.source_dir), _optional_path(args.archive))
    write_output(inventory, _optional_path(args.out))
    print(
        f"inventory: {inventory['file_count']} workbook(s), digest {inventory['digest']}",
        file=sys.stderr,
    )
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    report = load_json(Path(args.report))
    if args.inventory:
        inventory = load_json(Path(args.inventory))
    elif args.source_dir:
        inventory = build_inventory(Path(args.source_dir), _optional_path(args.archive))
    else:
        raise ToolError("build requires --source-dir or --inventory")
    document = build_golden(report, args.release_sha, inventory, args.label)
    write_output(document, _optional_path(args.out))
    comparable = document["comparable"]
    counts = comparable["indicator"]["counts"]
    print(
        "golden: release_sha={sha} files={files} registry={reg} "
        "A/P/U={a}/{p}/{u} comparable_sha256={digest}".format(
            sha=args.release_sha,
            files=comparable["source_files"].get("discovered"),
            reg=comparable["registry"].get("built"),
            a=counts.get(STATUS_AVAILABLE),
            p=counts.get(STATUS_PARTIAL),
            u=counts.get(STATUS_UNAVAILABLE),
            digest=document["comparable_sha256"],
        ),
        file=sys.stderr,
    )
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    document = load_json(Path(args.golden))
    comparable = comparable_of(document, str(args.golden))
    problems = check_invariants(
        comparable,
        {
            STATUS_AVAILABLE: args.expect_available,
            STATUS_PARTIAL: args.expect_partial,
            STATUS_UNAVAILABLE: args.expect_unavailable,
        },
        dict(_pairs(args.require_status, "--require-status")),
        _pairs(args.require_reason_code, "--require-reason-code"),
    )
    if problems:
        print(f"✗ {len(problems)} invariant failure(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    counts = comparable["indicator"]["counts"]
    print(
        "✓ golden result passes every reviewed invariant "
        f"({counts.get(STATUS_AVAILABLE)} AVAILABLE / {counts.get(STATUS_PARTIAL)} PARTIAL / "
        f"{counts.get(STATUS_UNAVAILABLE)} UNAVAILABLE, comparable_sha256 "
        f"{document['comparable_sha256']})"
    )
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    golden_doc = load_json(Path(args.golden))
    candidate_doc = load_json(Path(args.candidate))
    golden = comparable_of(golden_doc, str(args.golden))
    candidate = comparable_of(candidate_doc, str(args.candidate))

    if args.allow_release_sha_difference:
        golden = dict(golden)
        candidate = dict(candidate)
        golden.pop("release_sha", None)
        candidate.pop("release_sha", None)

    differences = diff_values(golden, candidate)
    if differences:
        print(
            f"✗ production result differs from GOLDEN_LOCAL_RESULT in "
            f"{len(differences)} place(s):",
            file=sys.stderr,
        )
        for line in differences[:MAX_REPORTED_DIFFERENCES]:
            print(f"  - {line}", file=sys.stderr)
        if len(differences) > MAX_REPORTED_DIFFERENCES:
            suppressed = len(differences) - MAX_REPORTED_DIFFERENCES
            print(f"  … {suppressed} more difference(s) suppressed", file=sys.stderr)
        print("STOP — do not run --write.", file=sys.stderr)
        return 1
    print(
        "✓ production result is identical to GOLDEN_LOCAL_RESULT "
        f"(comparable_sha256 {golden_doc['comparable_sha256']})"
    )
    return 0


def _optional_path(value: str | None) -> Path | None:
    return Path(value) if value else None


def _pairs(values: list[str] | None, flag: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw in values or []:
        if "=" not in raw:
            raise ToolError(f"{flag} expects KEY=VALUE, got {raw!r}")
        key, _, value = raw.partition("=")
        out.append((nfc(key.strip()), value.strip()))
    return out


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="municipal_cost_release_result.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    inv = sub.add_parser("inventory", help="SHA-256 inventory of the private source workbooks")
    inv.add_argument("--source-dir", required=True)
    inv.add_argument("--archive", help="the delivered source ZIP, hashed as a whole")
    inv.add_argument("--out")
    inv.set_defaults(func=cmd_inventory)

    build = sub.add_parser("build", help="freeze a GOLDEN_LOCAL_RESULT from a dry-run report")
    build.add_argument("--report", required=True, help="municipal-costs-ingest --report-path JSON")
    build.add_argument("--release-sha", required=True, help="the exact code SHA that produced it")
    build.add_argument("--source-dir")
    build.add_argument("--inventory", help="a previously built inventory JSON instead of walking")
    build.add_argument("--archive")
    build.add_argument("--label", help="free-text note, e.g. 'local integration dry run'")
    build.add_argument("--out")
    build.set_defaults(func=cmd_build)

    check = sub.add_parser("check", help="gate a golden result against the reviewed invariants")
    check.add_argument("--golden", required=True)
    check.add_argument("--expect-available", type=int)
    check.add_argument("--expect-partial", type=int)
    check.add_argument("--expect-unavailable", type=int)
    check.add_argument("--require-status", action="append", metavar="KEY=STATUS")
    check.add_argument("--require-reason-code", action="append", metavar="KEY=CODE")
    check.set_defaults(func=cmd_check)

    compare = sub.add_parser("compare", help="compare a production result against the golden one")
    compare.add_argument("--golden", required=True)
    compare.add_argument("--candidate", required=True)
    compare.add_argument(
        "--allow-release-sha-difference",
        action="store_true",
        help="diagnostic only; a real release must deploy the exact golden SHA",
    )
    compare.set_defaults(func=cmd_compare)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except ToolError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
