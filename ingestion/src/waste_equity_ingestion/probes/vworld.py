"""VWorld 2D data API probe."""

from ..config import ProbeSettings
from ..errors import MissingCredentialsError
from ..http import get_json
from ..result import ProbeResult
from ..validation import require_paths, require_vworld_ok

SOURCE = "vworld"
DATA_URL = "https://api.vworld.kr/req/data"


def probe(settings: ProbeSettings) -> ProbeResult:
    if not settings.vworld_api_key:
        raise MissingCredentialsError(["VWORLD_API_KEY"])
    params = {
        "service": "data",
        "version": "2.0",
        "request": "GetFeature",
        "key": settings.vworld_api_key,
        "format": "json",
        "errorFormat": "json",
        "size": "1",
        "page": "1",
        "data": "LP_PA_CBND_BUBUN",
        "geomFilter": "BOX(126.978,37.565,126.979,37.566)",
        "crs": "EPSG:4326",
        "geometry": "true",
        "attribute": "true",
    }
    if settings.vworld_api_domain:
        params["domain"] = settings.vworld_api_domain
    payload = get_json(DATA_URL, params)
    require_vworld_ok(payload)
    require_paths(payload, ["response.result.featureCollection"], provider="VWorld")
    return {
        "source": SOURCE,
        "endpoint_identifier": "req/data GetFeature LP_PA_CBND_BUBUN",
        "payload": payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": (
            "small Seoul bbox probe; national cadastral layer by spatial query/download"
        ),
        "latest_reference_period_observed": "SCHEMA_UNVERIFIED",
    }
