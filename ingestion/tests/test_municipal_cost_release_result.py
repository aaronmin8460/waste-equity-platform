"""Tests for the release helper ``scripts/deployment/municipal_cost_release_result.py``.

The helper is the gate between a reviewed local dry run and a production write,
so its failure modes matter more than its happy path: it must refuse a zero
standing in for a missing value, a registry that is not exactly the 2024 scope,
an artifact edited after it was built, a leaked private path, and any difference
at all between the local and production results.

Pure standard library — the helper has no third-party dependency and these tests
run under the ingestion suite or a bare ``python3 -m pytest``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "deployment" / "municipal_cost_release_result.py"

_spec = importlib.util.spec_from_file_location("municipal_cost_release_result", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
mcr = importlib.util.module_from_spec(_spec)
sys.modules["municipal_cost_release_result"] = mcr
_spec.loader.exec_module(mcr)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

METRO_LAYOUT = (("11", 25), ("28", 10), ("41", 31))


def make_municipality(metro: str, index: int, status: str) -> dict[str, Any]:
    key = f"{metro}-테스트{index:02d}"
    row: dict[str, Any] = {
        "municipality_key": key,
        "display_name": f"테스트{index:02d}",
        "metropolitan_code": metro,
        "population": 100000 + index,
        "population_method": "DIRECT_REGION_POPULATION",
        "status": status,
        "value": None,
        "numerator_krw": None,
        "eligible_contract_count": 0,
        "reason_codes": [],
        "source_file_count": 0,
        "has_data_a": False,
        "has_data_b": False,
    }
    if status in ("AVAILABLE", "PARTIAL"):
        row["value"] = "12345.6789"
        row["numerator_krw"] = "1234567890"
        row["eligible_contract_count"] = 3
        row["source_file_count"] = 1
        row["has_data_a"] = True
    if status == "PARTIAL":
        row["reason_codes"] = ["PARTIAL_WASTE_SCOPE"]
    else:
        row["reason_codes"] = [] if status == "AVAILABLE" else ["NO_SOURCE_FILE"]
    return row


def make_report(
    *,
    available: int = 20,
    partial: int = 5,
    source_dir: str = "/Users/someone/private/municipal-costs/2024",
    discovered: int = 2,
) -> dict[str, Any]:
    """A synthetic ``sanitized_summary()`` with the real 66-row registry shape."""

    municipalities: list[dict[str, Any]] = []
    remaining_available, remaining_partial = available, partial
    counter = 0
    for metro, count in METRO_LAYOUT:
        for _ in range(count):
            counter += 1
            if remaining_available > 0:
                status = "AVAILABLE"
                remaining_available -= 1
            elif remaining_partial > 0:
                status = "PARTIAL"
                remaining_partial -= 1
            else:
                status = "UNAVAILABLE"
            municipalities.append(make_municipality(metro, counter, status))
    counts = {
        "AVAILABLE": sum(1 for m in municipalities if m["status"] == "AVAILABLE"),
        "PARTIAL": sum(1 for m in municipalities if m["status"] == "PARTIAL"),
        "UNAVAILABLE": sum(1 for m in municipalities if m["status"] == "UNAVAILABLE"),
    }
    # Reversed on purpose: `build` must sort, so input order cannot leak in.
    municipalities.reverse()
    return {
        "source": "municipal-waste-costs",
        "mode": "dry-run",
        "status": "DRY_RUN_OK",
        "reference_year": 2024,
        "source_dir": source_dir,
        "indicator_code": "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA",
        "methodology_version": "municipal-collection-transport-payment-per-capita-v1",
        "transformation_version": "municipal-cost-v1",
        "ingestion_run_id": None,
        "source_files": {
            "discovered": discovered,
            "parsed": discovered,
            "accepted": discovered,
            "rejected": 0,
            "by_dataset_role": {"DATA_A": discovered, "DATA_B": 0},
        },
        "rejected_files": [],
        "duplicate_source_series": [],
        "registry": {
            "expected": 66,
            "built": 66,
            "by_metropolitan": {"11": 25, "28": 10, "41": 31},
            "expected_by_metropolitan": {"11": 25, "28": 10, "41": 31},
            "derived_population_cities": [],
        },
        "observations": {
            "contracts": 205,
            "eligible_contracts": 196,
            "quantities": 2701,
            "files_with_repeated_quantity_blocks": 0,
            "logical_quantities_from_repeated_blocks": 0,
        },
        "indicator": {"unit": "KRW/인", "numerator_total_krw": "659366684767", "counts": counts},
        "municipalities": municipalities,
        "writes": {},
        "idempotent_no_op": None,
        "warnings": ["b warning", "a warning"],
    }


def make_source_dir(tmp_path: Path, count: int = 2) -> Path:
    source = tmp_path / "2024"
    (source / "DATA_A").mkdir(parents=True, exist_ok=True)
    for index in range(count):
        (source / "DATA_A" / f"지자체{index}.xlsx").write_bytes(b"workbook-%d" % index)
    return source


def build_golden(tmp_path: Path, report: dict[str, Any] | None = None, **kwargs: Any) -> dict:
    report = report if report is not None else make_report(**kwargs)
    inventory = mcr.build_inventory(make_source_dir(tmp_path))
    return mcr.build_golden(report, "a" * 40, inventory, "test")


def check(golden: dict[str, Any], **kwargs: Any) -> list[str]:
    return mcr.check_invariants(
        golden["comparable"],
        kwargs.pop("expect_counts", {}),
        kwargs.pop("require_status", {}),
        kwargs.pop("require_reason", []),
    )


# ---------------------------------------------------------------------------
# inventory
# ---------------------------------------------------------------------------


def test_inventory_hashes_only_workbooks_and_is_deterministic(tmp_path: Path) -> None:
    source = make_source_dir(tmp_path, count=3)
    (source / ".DS_Store").write_bytes(b"junk")
    (source / "DATA_A" / "._sidecar.xlsx").write_bytes(b"applesingle")
    (source / "비고.txt").write_text("supplier note", encoding="utf-8")

    first = mcr.build_inventory(source)
    second = mcr.build_inventory(source)

    assert first == second
    assert first["file_count"] == 3
    assert [item["path"] for item in first["files"]] == [
        "DATA_A/지자체0.xlsx",
        "DATA_A/지자체1.xlsx",
        "DATA_A/지자체2.xlsx",
    ]
    assert first["files"][0]["sha256"] == hashlib.sha256(b"workbook-0").hexdigest()
    assert first["archive_sha256"] is None


def test_inventory_digest_is_reproducible_by_hand(tmp_path: Path) -> None:
    inventory = mcr.build_inventory(make_source_dir(tmp_path, count=2))
    manual = "".join(f"{item['sha256']}  {item['path']}\n" for item in inventory["files"])
    assert inventory["digest"] == "sha256:" + hashlib.sha256(manual.encode()).hexdigest()


def test_inventory_records_the_archive_sha_and_member_count(tmp_path: Path) -> None:
    source = make_source_dir(tmp_path)
    archive = tmp_path / "DATA.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("a.xlsx", "x")
        zf.writestr("b.txt", "y")

    inventory = mcr.build_inventory(source, archive)

    assert inventory["archive_sha256"] == mcr.sha256_file(archive)
    assert inventory["archive_member_count"] == 2


def test_inventory_change_changes_the_digest(tmp_path: Path) -> None:
    source = make_source_dir(tmp_path)
    before = mcr.build_inventory(source)["digest"]
    (source / "DATA_A" / "지자체0.xlsx").write_bytes(b"tampered")
    assert mcr.build_inventory(source)["digest"] != before


def test_missing_source_directory_is_a_usage_error(tmp_path: Path) -> None:
    with pytest.raises(mcr.ToolError, match="source directory not found"):
        mcr.build_inventory(tmp_path / "absent")


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------


def test_build_drops_the_private_absolute_source_path(tmp_path: Path) -> None:
    golden = build_golden(tmp_path, source_dir="/Users/someone/private/municipal-costs/2024")

    assert "source_dir" not in golden["comparable"]
    assert golden["provenance"]["source_dir_basename"] == "2024"
    assert "/Users/" not in json.dumps(golden["comparable"], ensure_ascii=False)


def test_build_sorts_municipalities_and_is_byte_stable(tmp_path: Path) -> None:
    golden = build_golden(tmp_path)
    keys = [item["municipality_key"] for item in golden["comparable"]["municipalities"]]

    assert keys == sorted(keys)
    assert len(keys) == 66
    again = build_golden(tmp_path)
    assert again["comparable_sha256"] == golden["comparable_sha256"]


def test_build_keeps_run_identity_out_of_the_comparison(tmp_path: Path) -> None:
    dry = make_report()
    write = make_report()
    write.update(
        mode="write",
        status="SUCCEEDED",
        ingestion_run_id=601,
        writes={"geographies": 66},
        idempotent_no_op=False,
    )
    inventory = mcr.build_inventory(make_source_dir(tmp_path))

    dry_doc = mcr.build_golden(dry, "a" * 40, inventory, None)
    write_doc = mcr.build_golden(write, "a" * 40, inventory, None)

    assert dry_doc["comparable_sha256"] == write_doc["comparable_sha256"]
    assert write_doc["provenance"]["ingestion_run_id"] == 601


def test_build_rejects_a_report_from_another_source(tmp_path: Path) -> None:
    report = make_report()
    report["source"] = "landfill-inbound"
    with pytest.raises(mcr.ToolError, match="not municipal-waste-costs"):
        mcr.build_golden(report, "a" * 40, None, None)


def test_build_rejects_a_truncated_report() -> None:
    with pytest.raises(mcr.ToolError, match="missing 'reference_year'"):
        mcr.build_golden({"source": "municipal-waste-costs", "registry": {}}, "a" * 40, None, None)


# ---------------------------------------------------------------------------
# invariants
# ---------------------------------------------------------------------------


def test_a_well_formed_golden_result_passes(tmp_path: Path) -> None:
    assert check(build_golden(tmp_path)) == []


def test_zero_is_never_an_acceptable_value(tmp_path: Path) -> None:
    report = make_report()
    report["municipalities"][0]["status"] = "AVAILABLE"
    report["municipalities"][0]["value"] = "0"
    report["municipalities"][0]["numerator_krw"] = "0"
    golden = build_golden(tmp_path, report=report)

    problems = check(golden)

    assert any("value is 0" in problem for problem in problems)
    assert any("numerator_krw is 0" in problem for problem in problems)


def test_unavailable_must_be_null_not_zero(tmp_path: Path) -> None:
    report = make_report()
    unavailable = next(m for m in report["municipalities"] if m["status"] == "UNAVAILABLE")
    unavailable["value"] = "0"

    problems = check(build_golden(tmp_path, report=report))

    assert any("UNAVAILABLE but value is" in problem for problem in problems)


def test_registry_must_be_exactly_the_2024_scope(tmp_path: Path) -> None:
    report = make_report()
    report["registry"]["by_metropolitan"]["28"] = 9
    report["registry"]["built"] = 65

    problems = check(build_golden(tmp_path, report=report))

    assert any("registry.built is 65" in problem for problem in problems)
    assert any("by_metropolitan[28] is 9" in problem for problem in problems)


def test_status_counts_must_agree_with_the_rows(tmp_path: Path) -> None:
    report = make_report()
    report["indicator"]["counts"]["AVAILABLE"] += 1

    problems = check(build_golden(tmp_path, report=report))

    assert any("disagrees with" in problem for problem in problems)


def test_expected_counts_are_enforced_when_supplied(tmp_path: Path) -> None:
    golden = build_golden(tmp_path, available=20, partial=5)

    assert check(golden, expect_counts={"AVAILABLE": 20, "PARTIAL": 5, "UNAVAILABLE": 41}) == []
    problems = check(golden, expect_counts={"AVAILABLE": 45})
    assert any("AVAILABLE count is 20, expected 45" in problem for problem in problems)


def test_a_reviewed_limitation_that_silently_disappears_is_caught(tmp_path: Path) -> None:
    report = make_report()
    partial = next(m for m in report["municipalities"] if m["status"] == "PARTIAL")
    key = partial["municipality_key"]
    golden = build_golden(tmp_path, report=report)

    assert check(golden, require_reason=[(key, "PARTIAL_WASTE_SCOPE")]) == []

    partial["reason_codes"] = []
    partial["status"] = "AVAILABLE"
    report["indicator"]["counts"]["PARTIAL"] -= 1
    report["indicator"]["counts"]["AVAILABLE"] += 1
    weakened = build_golden(tmp_path, report=report)

    problems = check(
        weakened,
        require_status={key: "PARTIAL"},
        require_reason=[(key, "PARTIAL_WASTE_SCOPE")],
    )
    assert any("PARTIAL_WASTE_SCOPE is absent" in problem for problem in problems)
    assert any("status is 'AVAILABLE', expected 'PARTIAL'" in problem for problem in problems)


def test_source_file_accounting_must_add_up(tmp_path: Path) -> None:
    report = make_report()
    report["source_files"]["accepted"] = 1
    report["source_files"]["rejected"] = 0

    problems = check(build_golden(tmp_path, report=report))

    assert any("!= parsed" in problem for problem in problems)


def test_inventory_must_match_the_discovered_file_count(tmp_path: Path) -> None:
    problems = check(build_golden(tmp_path, discovered=99))
    assert any("source_inventory.file_count 2 != source_files.discovered 99" in p for p in problems)


def test_a_leaked_private_path_fails_the_check(tmp_path: Path) -> None:
    report = make_report()
    report["warnings"] = ["read from /home/ubuntu/private/municipal-costs/2024"]

    problems = check(build_golden(tmp_path, report=report))

    assert any("absolute private path fragment" in problem for problem in problems)


def test_an_absent_inventory_fails_the_check() -> None:
    golden = mcr.build_golden(make_report(), "a" * 40, None, None)
    problems = check(golden)
    assert any("source_inventory is absent" in problem for problem in problems)


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------


def test_identical_results_compare_equal(tmp_path: Path) -> None:
    golden = build_golden(tmp_path)
    candidate = build_golden(tmp_path)
    assert mcr.diff_values(golden["comparable"], candidate["comparable"]) == []


def test_a_single_changed_value_is_reported_with_its_path(tmp_path: Path) -> None:
    golden = build_golden(tmp_path)
    report = make_report()
    report["municipalities"][0]["value"] = "99999.0000"
    candidate = build_golden(tmp_path, report=report)

    differences = mcr.diff_values(golden["comparable"], candidate["comparable"])

    assert differences
    assert any(".municipalities[" in line and ".value" in line for line in differences)


def test_a_tampered_artifact_is_refused(tmp_path: Path) -> None:
    golden = build_golden(tmp_path)
    golden["comparable"]["indicator"]["counts"]["AVAILABLE"] = 45
    with pytest.raises(mcr.ToolError, match="edited after it was built"):
        mcr.comparable_of(golden, "golden.json")


def test_a_foreign_document_is_refused() -> None:
    with pytest.raises(mcr.ToolError, match="is not a municipal-cost-golden-local-result"):
        mcr.comparable_of({"artifact": "something-else"}, "candidate.json")


# ---------------------------------------------------------------------------
# CLI plumbing and the tracked-output guard
# ---------------------------------------------------------------------------


def test_compare_exits_non_zero_on_a_difference(tmp_path: Path) -> None:
    golden_path = tmp_path / "golden.json"
    candidate_path = tmp_path / "candidate.json"
    golden_path.write_text(json.dumps(build_golden(tmp_path)), encoding="utf-8")
    report = make_report(available=45, partial=7)
    candidate_path.write_text(json.dumps(build_golden(tmp_path, report=report)), encoding="utf-8")

    same = mcr.main(["compare", "--golden", str(golden_path), "--candidate", str(golden_path)])
    different = mcr.main(
        ["compare", "--golden", str(golden_path), "--candidate", str(candidate_path)]
    )

    assert same == 0
    assert different == 1


def test_check_exits_non_zero_on_an_invariant_failure(tmp_path: Path) -> None:
    golden_path = tmp_path / "golden.json"
    golden_path.write_text(json.dumps(build_golden(tmp_path)), encoding="utf-8")

    assert mcr.main(["check", "--golden", str(golden_path)]) == 0
    assert (
        mcr.main(["check", "--golden", str(golden_path), "--expect-available", "45"]) == 1
    )


def test_output_into_a_git_tracked_path_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "artifacts" / "municipal-costs").mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    (repo / ".gitignore").write_text("artifacts/municipal-costs/\n", encoding="utf-8")

    with pytest.raises(mcr.ToolError, match="NOT Git-ignored"):
        mcr.refuse_tracked_output(repo / "docs" / "golden.json")
    # the Git-ignored artifacts tree is the documented destination
    mcr.refuse_tracked_output(repo / "artifacts" / "municipal-costs" / "golden.json")
