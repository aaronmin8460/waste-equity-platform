import pytest

from waste_equity_ingestion.errors import ProviderResultError
from waste_equity_ingestion.validation import require_result_code, require_vworld_ok


def test_data_go_kr_success_result_code_fixture() -> None:
    payload = {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"}}}

    require_result_code(
        payload,
        path="response.header.resultCode",
        ok_values={"00"},
        provider="fixture",
    )


def test_sgis_success_result_code_fixture() -> None:
    payload = {"errCd": 0, "errMsg": "Success"}

    require_result_code(payload, path="errCd", ok_values={0, "0"}, provider="sgis_fixture")


def test_provider_failure_fixture_raises() -> None:
    payload = {
        "response": {"header": {"resultCode": "30", "resultMsg": "SERVICE KEY IS NOT REGISTERED"}}
    }

    with pytest.raises(ProviderResultError):
        require_result_code(
            payload,
            path="response.header.resultCode",
            ok_values={"00"},
            provider="fixture",
        )


def test_vworld_status_ok_fixture() -> None:
    require_vworld_ok({"response": {"status": "OK"}})
