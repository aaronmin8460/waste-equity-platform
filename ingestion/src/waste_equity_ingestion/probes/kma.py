"""KMA ultra-short observation and forecast probes."""

from datetime import datetime, timedelta, timezone

from ..config import ProbeSettings
from ..errors import MissingCredentialsError
from ..http import get_json
from ..result import ProbeResult
from ..validation import require_paths, require_result_code

SOURCE = "kma"
ULTRA_SHORT_OBSERVATION_URL = (
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
)


def _service_key(settings: ProbeSettings) -> str:
    key = settings.kma_key()
    if not key:
        raise MissingCredentialsError(["KMA_SERVICE_KEY or DATA_GO_KR_SERVICE_KEY"])
    return key


def probe(settings: ProbeSettings) -> ProbeResult:
    base_date, base_time = _latest_ultra_short_observation_base()
    payload = get_json(
        ULTRA_SHORT_OBSERVATION_URL,
        {
            "ServiceKey": _service_key(settings),
            "pageNo": "1",
            "numOfRows": "1000",
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": "60",
            "ny": "127",
        },
    )
    require_result_code(
        payload, path="response.header.resultCode", ok_values={"00"}, provider="KMA"
    )
    require_paths(payload, ["response.body.items.item"], provider="KMA")
    return {
        "source": SOURCE,
        "endpoint_identifier": "VilageFcstInfoService_2.0/getUltraSrtNcst",
        "payload": payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": "KMA grid nx=60 ny=127 probe; nationwide by grid coordinate",
        "latest_reference_period_observed": f"{base_date} {base_time}",
    }


def _latest_ultra_short_observation_base() -> tuple[str, str]:
    kst = timezone(timedelta(hours=9))
    safe_time = datetime.now(tz=kst) - timedelta(minutes=70)
    rounded = safe_time.replace(minute=0, second=0, microsecond=0)
    return rounded.strftime("%Y%m%d"), rounded.strftime("%H%M")
