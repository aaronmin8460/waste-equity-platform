"""Fixture tests for RCIS PID discovery classification (Phase 0.7)."""

from typing import Any

from waste_equity_ingestion.probes.waste_statistics_discovery import (
    SAMPLE_RECORD_LIMIT,
    TARGET_PIDS,
    classify_response,
    observed_granularity,
    truncate_payload_records,
)


def _envelope(records: list[dict[str, Any]], *, err_code: str = "E000") -> dict[str, Any]:
    return {
        "data": records,
        "dataHeader": [],
        "result": [
            {
                "ERR_CODE": err_code,
                "RESULT": "메세지",
                "YEAR": "2023",
                "TITLE": "테스트 서식",
                "DUNIT": "톤/년",
            }
        ],
    }


def test_sigungu_generation_treatment_pid_is_classified() -> None:
    records = [
        {
            "CITY_JIDT_CD_NM": "서울",
            "CTS_JIDT_CD_NM": "중구",
            "WSTE_CODE_NM": "폐지류",
            "WSTE_QTY": "250.5",
            "TOT_RECY_QTY": "126",
            "TOT_INCI_QTY": "102.7",
            "TOT_FILL_QTY": "21.8",
            "TOT_ETC_QTY": "0",
        },
        {
            "CITY_JIDT_CD_NM": "경기",
            "CTS_JIDT_CD_NM": "수원시",
            "WSTE_CODE_NM": "폐지류",
            "WSTE_QTY": "300.1",
            "TOT_RECY_QTY": "150",
            "TOT_INCI_QTY": "120",
            "TOT_FILL_QTY": "30.1",
            "TOT_ETC_QTY": "0",
        },
    ]
    summary = classify_response("NTN007", "2023", _envelope(records))
    assert summary["status"] == "LIVE_VERIFIED"
    assert summary["region_granularity"] == "SIGUNGU"
    assert summary["quantity_fields"]["generation_quantity"] == ["WSTE_QTY"]
    assert summary["quantity_fields"]["incineration_quantity"] == ["TOT_INCI_QTY"]
    assert summary["quantity_fields"]["landfill_quantity"] == ["TOT_FILL_QTY"]
    assert summary["quantity_fields"]["recycling_quantity"] == ["TOT_RECY_QTY"]
    assert summary["seoul_metro_sido_observed"] == ["서울", "경기"]
    assert summary["sigungu_value_sample"] == ["중구", "수원시"]
    assert summary["unit_metadata"] == "톤/년"


def test_facility_pid_reports_facility_fields() -> None:
    records = [
        {
            "CITY_JIDT_CD_NM": "인천",
            "CTS_JIDT_CD_NM": "서구",
            "FAC_NM": "자원회수시설",
            "ADDR": "환경로 42",
            "FAC_CAP": "500",
            "DISP_QTY": "120000",
        }
    ]
    summary = classify_response("NTN031", "2023", _envelope(records))
    assert summary["status"] == "LIVE_VERIFIED"
    assert summary["facility_attribute_fields"] == ["FAC_NM", "ADDR"]
    assert summary["quantity_fields"]["facility_capacity"] == ["FAC_CAP"]
    assert summary["quantity_fields"]["facility_throughput"] == ["DISP_QTY"]


def test_no_data_provider_code_is_not_an_error() -> None:
    summary = classify_response("NTN007", "2024", _envelope([], err_code="E099"))
    assert summary["status"] == "NO_DATA_FOR_CONDITION"


def test_provider_failure_code_is_classified() -> None:
    summary = classify_response("NTN007", "2023", _envelope([], err_code="E003"))
    assert summary["status"] == "PROVIDER_ERROR"
    assert summary["provider_result_code"] == "E003"


def test_success_without_records_is_schema_unverified() -> None:
    summary = classify_response("NTN007", "2023", _envelope([]))
    assert summary["status"] == "SCHEMA_UNVERIFIED"
    assert summary["record_count"] == 0


def test_granularity_falls_back_to_sido_then_unknown() -> None:
    assert observed_granularity(["CITY_JIDT_CD_NM"]) == "SIDO"
    assert observed_granularity(["OTHER"]) == "UNKNOWN"


def test_truncate_payload_records_limits_long_lists() -> None:
    payload = _envelope([{"CITY_JIDT_CD_NM": "서울"}] * (SAMPLE_RECORD_LIMIT + 5))
    truncated = truncate_payload_records(payload)
    assert len(truncated["data"]) == SAMPLE_RECORD_LIMIT
    assert len(payload["data"]) == SAMPLE_RECORD_LIMIT + 5
    assert truncated["result"] == payload["result"]


def test_target_pids_document_expected_granularity() -> None:
    for pid, metadata in TARGET_PIDS.items():
        assert metadata["expected_granularity"] in {"SIGUNGU", "SIDO", "FACILITY"}, pid
        assert metadata["description"], pid
