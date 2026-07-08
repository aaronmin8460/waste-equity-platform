"""SGIS authentication, boundary, and population client/probes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..config import ProbeSettings
from ..errors import MissingCredentialsError, SchemaValidationError
from ..http import JsonResponse, get_json_response
from ..result import ProbeResult
from ..validation import require_paths, require_result_code

SOURCE = "sgis"
AUTH_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json"
BOUNDARY_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/boundary/hadmarea.geojson"
POPULATION_URL = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json"


@dataclass(frozen=True)
class SgisAuthentication:
    access_token: str
    http_status: int
    content_type: str
    err_cd: object
    err_msg: str | None
    access_timeout: str | None


@dataclass(frozen=True)
class SgisClient:
    access_token: str

    def population(self, *, year: int, adm_cd: str, low_search: int) -> JsonResponse:
        return self._get(
            POPULATION_URL,
            {
                "year": str(year),
                "adm_cd": adm_cd,
                "low_search": str(low_search),
            },
        )

    def boundary(self, *, year: int, adm_cd: str, low_search: int) -> JsonResponse:
        return self._get(
            BOUNDARY_URL,
            {
                "year": str(year),
                "adm_cd": adm_cd,
                "low_search": str(low_search),
            },
        )

    def _get(self, url: str, params: dict[str, str]) -> JsonResponse:
        return get_json_response(url, {"accessToken": self.access_token, **params})


def authenticate(settings: ProbeSettings) -> SgisAuthentication:
    missing = settings.missing(["SGIS_CONSUMER_KEY", "SGIS_CONSUMER_SECRET"])
    if missing:
        raise MissingCredentialsError(missing)
    response = get_json_response(
        AUTH_URL,
        {
            "consumer_key": settings.sgis_consumer_key,
            "consumer_secret": settings.sgis_consumer_secret,
        },
    )
    payload = response.payload
    require_result_code(payload, path="errCd", ok_values={0, "0"}, provider="SGIS")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise SchemaValidationError("SGIS authentication response missing result object")
    token = result.get("accessToken")
    if not token:
        raise SchemaValidationError("SGIS authentication succeeded but accessToken is missing")
    access_timeout = result.get("accessTimeout")
    return SgisAuthentication(
        access_token=str(token),
        http_status=response.status,
        content_type=response.content_type,
        err_cd=payload.get("errCd"),
        err_msg=str(payload.get("errMsg")) if payload.get("errMsg") is not None else None,
        access_timeout=str(access_timeout) if access_timeout is not None else None,
    )


def client_from_settings(settings: ProbeSettings) -> SgisClient:
    auth = authenticate(settings)
    return SgisClient(access_token=auth.access_token)


def sanitized_auth_summary(auth: SgisAuthentication) -> dict[str, Any]:
    return {
        "http_status": auth.http_status,
        "content_type": auth.content_type,
        "errCd": auth.err_cd,
        "errMsg": auth.err_msg,
        "access_token_present": bool(auth.access_token),
        "accessTimeout_present": auth.access_timeout is not None,
    }


def probe(settings: ProbeSettings) -> ProbeResult:
    auth = authenticate(settings)
    client = SgisClient(access_token=auth.access_token)
    response = client.population(year=2020, adm_cd="11", low_search=1)
    payload = response.payload
    require_result_code(payload, path="errCd", ok_values={0, "0"}, provider="SGIS")
    require_paths(payload, ["result"], provider="SGIS")
    return {
        "source": SOURCE,
        "endpoint_identifier": "OpenAPI3/stats/population.json",
        "payload": payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": "adm_cd=11 Seoul probe; Incheon/Gyeonggi require separate adm_cd",
        "latest_reference_period_observed": "2020",
        "request_metadata": {
            "endpoint": "population.json",
            "year": "2020",
            "adm_cd": "11",
            "low_search": "1",
            "auth_http_status": auth.http_status,
            "auth_accessTimeout_present": auth.access_timeout is not None,
            "http_status": response.status,
            "content_type": response.content_type,
        },
    }
