"""SGIS authentication, boundary, and population probes."""

from ..config import ProbeSettings
from ..errors import MissingCredentialsError
from ..http import get_json
from ..result import ProbeResult
from ..validation import require_paths, require_result_code

SOURCE = "sgis"
AUTH_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json"
BOUNDARY_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/boundary/hadmarea.geojson"
POPULATION_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json"


def authenticate(settings: ProbeSettings) -> str:
    missing = settings.missing(["SGIS_CONSUMER_KEY", "SGIS_CONSUMER_SECRET"])
    if missing:
        raise MissingCredentialsError(missing)
    payload = get_json(
        AUTH_URL,
        {
            "consumer_key": settings.sgis_consumer_key,
            "consumer_secret": settings.sgis_consumer_secret,
        },
    )
    require_result_code(payload, path="errCd", ok_values={0, "0"}, provider="SGIS")
    token = payload.get("result", {}).get("accessToken")
    if not token:
        raise RuntimeError("SGIS authentication succeeded but accessToken is missing")
    return str(token)


def probe(settings: ProbeSettings) -> ProbeResult:
    access_token = authenticate(settings)
    payload = get_json(
        POPULATION_URL,
        {
            "accessToken": access_token,
            "year": "2020",
            "adm_cd": "11",
            "low_search": "1",
        },
    )
    require_result_code(payload, path="errCd", ok_values={0, "0"}, provider="SGIS")
    require_paths(payload, ["result"], provider="SGIS")
    return {
        "source": SOURCE,
        "endpoint_identifier": "OpenAPI3/stats/population.json",
        "payload": payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": "adm_cd=11 Seoul probe; Incheon/Gyeonggi require separate adm_cd",
        "latest_reference_period_observed": "2020",
    }
