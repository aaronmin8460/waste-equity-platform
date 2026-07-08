"""AirKorea real-time air-quality and station-information probes."""

from typing import Any

from ..config import ProbeSettings
from ..errors import MissingCredentialsError
from ..http import get_json
from ..result import ProbeResult
from ..validation import require_paths, require_result_code

SOURCE = "airkorea"
AIR_QUALITY_URL = "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
STATION_URL = "http://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList"


def _service_key(settings: ProbeSettings) -> str:
    key = settings.airkorea_key()
    if not key:
        raise MissingCredentialsError(["AIRKOREA_SERVICE_KEY or DATA_GO_KR_SERVICE_KEY"])
    return key


def probe(settings: ProbeSettings) -> ProbeResult:
    payload = get_json(
        AIR_QUALITY_URL,
        {
            "serviceKey": _service_key(settings),
            "returnType": "json",
            "numOfRows": "100",
            "pageNo": "1",
            "sidoName": "서울",
            "ver": "1.0",
        },
    )
    require_result_code(
        payload,
        path="response.header.resultCode",
        ok_values={"00"},
        provider="AirKorea",
    )
    require_paths(
        payload,
        ["response.body.items", "response.body.totalCount"],
        provider="AirKorea",
    )
    return {
        "source": SOURCE,
        "endpoint_identifier": "ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
        "payload": payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": (
            "sidoName=서울 probe; source also supports Incheon/Gyeonggi by sidoName"
        ),
        "latest_reference_period_observed": _latest_data_time(payload),
        "request_metadata": {
            "endpoint": "getCtprvnRltmMesureDnsty",
            "sidoName": "서울",
            "returnType": "json",
        },
    }


def probe_stations(settings: ProbeSettings) -> dict[str, Any]:
    payload = get_json(
        STATION_URL,
        {
            "serviceKey": _service_key(settings),
            "returnType": "json",
            "numOfRows": "10",
            "pageNo": "1",
            "addr": "서울",
        },
    )
    require_result_code(
        payload,
        path="response.header.resultCode",
        ok_values={"00"},
        provider="AirKorea",
    )
    return payload


def _latest_data_time(payload: dict[str, Any]) -> str:
    items = payload.get("response", {}).get("body", {}).get("items", [])
    times = [
        str(item.get("dataTime"))
        for item in items
        if isinstance(item, dict) and item.get("dataTime")
    ]
    return max(times) if times else "UNVERIFIED"
