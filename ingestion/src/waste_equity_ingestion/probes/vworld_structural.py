"""VWorld structural spatial-layer contract probes (Phase 2.5A).

Small live contract validation for officially documented VWorld WFS,
2D Data API, and NED land-ownership layers. This module performs the
smallest possible requests (one feature per region bounding box) and
summarizes the observed contract. It is audit tooling only: it must not
grow into production ingestion.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..config import ProbeSettings
from ..errors import (
    IngestionError,
    MissingCredentialsError,
    ProviderResultError,
    SchemaValidationError,
)
from ..http import get_json_response, get_text_response
from ..samples import build_envelope, save_sample

SOURCE = "vworld"
WFS_URL = "https://api.vworld.kr/req/wfs"
DATA_URL = "https://api.vworld.kr/req/data"
NED_POSSESSION_URL = "https://api.vworld.kr/ned/wfs/getPossessionWFS"
NED_LANDUSE_URL = "https://api.vworld.kr/ned/wfs/getLandUseWFS"

REQUESTED_CRS = "EPSG:4326"

CREDENTIAL_QUERY_PARAMS = {"key", "apikey", "servicekey", "domain"}

# Small probe bounding boxes as "min_lat,min_lon,max_lat,max_lon".
# Layer-specific boxes target areas where the officially documented zone type
# plausibly exists (a dense-urban box cannot contain greenbelt or wetland);
# a region without any known occurrence keeps an urban box and an honest
# zero-feature result is recorded rather than moving the box until it "works".
DEFAULT_BBOXES: dict[str, str] = {
    "seoul": "37.564,126.976,37.568,126.981",
    "incheon": "37.454,126.700,37.459,126.706",
    "gyeonggi": "37.392,127.108,37.398,127.115",
}


@dataclass(frozen=True)
class StructuralLayer:
    """One officially documented layer under audit."""

    wfs_typename: str
    data_id: str
    expected_geometry: str
    description: str
    bboxes: tuple[tuple[str, str], ...] | None = None

    def bbox_set(self) -> dict[str, str]:
        if self.bboxes is None:
            return dict(DEFAULT_BBOXES)
        return dict(self.bboxes)


STRUCTURAL_LAYERS: tuple[StructuralLayer, ...] = (
    StructuralLayer(
        "lt_c_uq111", "LT_C_UQ111", "MultiPolygon", "용도지역도 도시지역 (urban use areas)"
    ),
    StructuralLayer(
        "lt_c_uq112",
        "LT_C_UQ112",
        "MultiPolygon",
        "용도지역도 관리지역 (management areas)",
        bboxes=(
            ("seoul", "37.564,126.976,37.568,126.981"),
            ("incheon", "37.70,126.44,37.75,126.50"),
            ("gyeonggi", "37.48,127.48,37.53,127.55"),
        ),
    ),
    StructuralLayer(
        "lt_c_uq113",
        "LT_C_UQ113",
        "MultiPolygon",
        "용도지역도 농림지역 (agriculture-forestry areas)",
        bboxes=(
            ("seoul", "37.564,126.976,37.568,126.981"),
            ("incheon", "37.70,126.44,37.75,126.50"),
            ("gyeonggi", "37.48,127.48,37.53,127.55"),
        ),
    ),
    StructuralLayer(
        "lt_c_uq114",
        "LT_C_UQ114",
        "MultiPolygon",
        "용도지역도 자연환경보전지역 (natural-environment conservation areas)",
        bboxes=(
            ("seoul", "37.564,126.976,37.568,126.981"),
            ("incheon", "37.70,126.44,37.75,126.50"),
            ("gyeonggi", "37.80,127.35,37.95,127.55"),
        ),
    ),
    StructuralLayer(
        "lt_c_uq162",
        "LT_C_UQ162",
        "MultiPolygon",
        "용도구역도 도시자연공원구역 (urban natural-park zones)",
        bboxes=(
            ("seoul", "37.44,126.93,37.48,126.98"),
            ("incheon", "37.42,126.67,37.46,126.72"),
            ("gyeonggi", "37.27,127.02,37.32,127.08"),
        ),
    ),
    StructuralLayer(
        "lt_c_ud801",
        "LT_C_UD801",
        "MultiPolygon",
        "용도구역도 개발제한구역 (development-restricted greenbelt)",
        bboxes=(
            ("seoul", "37.44,127.03,37.47,127.07"),
            ("incheon", "37.54,126.70,37.58,126.75"),
            ("gyeonggi", "37.40,126.98,37.46,127.05"),
        ),
    ),
    StructuralLayer(
        "lt_c_um710",
        "LT_C_UM710",
        "MultiPolygon",
        "상수원보호구역 (water-source protection zones)",
        bboxes=(
            ("seoul", "37.52,127.08,37.55,127.12"),
            ("incheon", "37.454,126.700,37.459,126.706"),
            ("gyeonggi", "37.50,127.27,37.55,127.33"),
        ),
    ),
    StructuralLayer(
        "lt_c_um901",
        "LT_C_UM901",
        "MultiPolygon",
        "습지보호지역 (wetland protection areas)",
        bboxes=(
            ("seoul", "37.53,126.92,37.55,126.94"),
            ("incheon", "37.36,126.60,37.42,126.68"),
            ("gyeonggi", "37.60,126.55,37.70,126.68"),
        ),
    ),
    StructuralLayer(
        "lt_c_um221",
        "LT_C_UM221",
        "MultiPolygon",
        "야생생물보호구역 (wildlife protection areas)",
        bboxes=(
            ("seoul", "37.53,126.92,37.55,126.94"),
            ("incheon", "37.60,126.40,37.75,126.55"),
            ("gyeonggi", "37.45,127.40,37.60,127.60"),
        ),
    ),
    StructuralLayer(
        "lt_c_uf151",
        "LT_C_UF151",
        "MultiPolygon",
        "산림보호구역 (forest protection areas)",
        bboxes=(
            ("seoul", "37.63,126.96,37.68,127.01"),
            ("incheon", "37.54,126.70,37.58,126.75"),
            ("gyeonggi", "37.30,127.20,37.42,127.35"),
        ),
    ),
    StructuralLayer(
        "lt_c_uo101",
        "LT_C_UO101",
        "MultiPolygon",
        "교육환경보호구역 (school environment protection zones)",
    ),
    StructuralLayer(
        "lt_c_uo301",
        "LT_C_UO301",
        "MultiPolygon",
        "국가유산 지정/보호구역 (national heritage designation/protection areas)",
        bboxes=(
            ("seoul", "37.564,126.976,37.568,126.981"),
            ("incheon", "37.74,126.48,37.78,126.54"),
            ("gyeonggi", "37.27,127.00,37.30,127.03"),
        ),
    ),
    StructuralLayer(
        "lt_c_wgisnpgug",
        "LT_C_WGISNPGUG",
        "MultiPolygon",
        "국립자연공원 (national natural parks)",
        bboxes=(
            ("seoul", "37.63,126.96,37.68,127.01"),
            ("incheon", "37.454,126.700,37.459,126.706"),
            ("gyeonggi", "37.68,126.97,37.72,127.02"),
        ),
    ),
    StructuralLayer("lt_l_moctlink", "LT_L_MOCTLINK", "MultiLineString", "국가교통정보도 교통링크"),
    StructuralLayer(
        "lt_l_n3a0020000",
        "LT_L_N3A0020000",
        "MultiLineString",
        "국토지리정보원 연속수치지형도 도로중심선",
    ),
)

OWNERSHIP_TYPENAME = "dt_d160"
OWNERSHIP_EXPECTED_GEOMETRY = "MultiPolygon"
LANDUSE_TYPENAME = "dt_d154"
LANDUSE_EXPECTED_GEOMETRY = "MultiPolygon"

SUPPORTED_SERVICES = ("wfs", "data", "ownership", "landuse")


def sanitize_request_url(url: str) -> str:
    """Strip credential-bearing query parameters from a request URL."""

    parts = urlsplit(url)
    kept = [
        (name, value)
        for name, value in parse_qsl(parts.query, keep_blank_values=True)
        if name.lower() not in CREDENTIAL_QUERY_PARAMS
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


def sanitize_params(params: dict[str, Any]) -> dict[str, Any]:
    """Return request parameters with credential values redacted."""

    return {
        name: "[REDACTED]" if name.lower() in CREDENTIAL_QUERY_PARAMS else value
        for name, value in params.items()
    }


def summarize_wfs_feature_collection(
    payload: dict[str, Any], *, expected_geometry: str
) -> dict[str, Any]:
    """Validate and summarize a WFS GeoJSON FeatureCollection response."""

    if payload.get("type") != "FeatureCollection":
        raise SchemaValidationError(
            f"VWorld WFS response is not a GeoJSON FeatureCollection (type={payload.get('type')!r})"
        )
    features = payload.get("features")
    if not isinstance(features, list):
        raise SchemaValidationError("VWorld WFS FeatureCollection has no features list")
    total = payload.get("totalFeatures")
    number_matched = payload.get("numberMatched")
    number_returned = payload.get("numberReturned")
    if total is None and number_matched is None:
        raise SchemaValidationError("VWorld WFS response lacks total-count metadata")
    crs_name = None
    crs = payload.get("crs")
    if isinstance(crs, dict):
        crs_name = crs.get("properties", {}).get("name")
    if features and crs_name is None:
        raise SchemaValidationError("VWorld WFS non-empty response lacks CRS metadata")
    summary: dict[str, Any] = {
        "feature_count": len(features),
        "total_features": total,
        "number_matched": number_matched,
        "number_returned": number_returned,
        "returned_crs": crs_name,
        "geometry_type": None,
        "feature_id": None,
        "attribute_fields": [],
        "null_fields": [],
    }
    if features:
        feature = features[0]
        geometry = feature.get("geometry") or {}
        geometry_type = geometry.get("type")
        if geometry_type != expected_geometry:
            raise SchemaValidationError(
                f"VWorld WFS geometry type {geometry_type!r} does not match "
                f"expected {expected_geometry!r}"
            )
        feature_id = feature.get("id")
        if not feature_id:
            raise SchemaValidationError("VWorld WFS feature has no feature identifier")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise SchemaValidationError("VWorld WFS feature has no properties object")
        summary["geometry_type"] = geometry_type
        summary["feature_id"] = feature_id
        summary["attribute_fields"] = sorted(properties)
        summary["null_fields"] = sorted(name for name, value in properties.items() if value is None)
    return summary


def summarize_data_api_response(
    payload: dict[str, Any], *, expected_geometry: str
) -> dict[str, Any]:
    """Validate and summarize a VWorld 2D Data API GetFeature response.

    Provider semantics: ``response.status`` is ``OK`` (features), ``NOT_FOUND``
    (no feature for the filter — not an error), or ``ERROR`` with an
    ``response.error`` object.
    """

    response = payload.get("response")
    if not isinstance(response, dict):
        raise SchemaValidationError("VWorld 2D Data API payload has no response object")
    status = response.get("status")
    if status == "ERROR":
        error = response.get("error")
        raise ProviderResultError(f"VWorld 2D Data API provider error: {error!r}")
    if status not in {"OK", "NOT_FOUND"}:
        raise ProviderResultError(f"VWorld 2D Data API unexpected status: {status!r}")
    record = response.get("record")
    page = response.get("page")
    if not isinstance(record, dict) or not isinstance(page, dict):
        raise SchemaValidationError("VWorld 2D Data API response lacks record/page metadata")
    summary: dict[str, Any] = {
        "provider_status": status,
        "record": record,
        "page": page,
        "feature_count": 0,
        "geometry_type": None,
        "feature_id": None,
        "attribute_fields": [],
        "null_fields": [],
    }
    if status == "NOT_FOUND":
        return summary
    feature_collection = (response.get("result") or {}).get("featureCollection")
    if not isinstance(feature_collection, dict):
        raise SchemaValidationError("VWorld 2D Data API OK response lacks featureCollection")
    features = feature_collection.get("features")
    if not isinstance(features, list) or not features:
        raise SchemaValidationError("VWorld 2D Data API OK response has no features")
    feature = features[0]
    geometry_type = (feature.get("geometry") or {}).get("type")
    if geometry_type != expected_geometry:
        raise SchemaValidationError(
            f"VWorld 2D Data API geometry type {geometry_type!r} does not match "
            f"expected {expected_geometry!r}"
        )
    feature_id = feature.get("id")
    if not feature_id:
        raise SchemaValidationError("VWorld 2D Data API feature has no feature identifier")
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        raise SchemaValidationError("VWorld 2D Data API feature has no properties object")
    summary["feature_count"] = len(features)
    summary["geometry_type"] = geometry_type
    summary["feature_id"] = feature_id
    summary["attribute_fields"] = sorted(properties)
    summary["null_fields"] = sorted(name for name, value in properties.items() if value is None)
    return summary


def extract_data_api_error(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the provider error object from an ERROR-status 2D response."""

    response = payload.get("response")
    if not isinstance(response, dict) or response.get("status") != "ERROR":
        raise SchemaValidationError("Expected a VWorld 2D Data API ERROR response")
    error = response.get("error")
    if not isinstance(error, dict):
        raise SchemaValidationError("VWorld 2D Data API ERROR response lacks error object")
    return error


def _require_key(settings: ProbeSettings) -> str:
    if not settings.vworld_api_key:
        raise MissingCredentialsError(["VWORLD_API_KEY"])
    return settings.vworld_api_key


def _wfs_params(
    settings: ProbeSettings, typename: str, bbox: str, max_features: int = 1
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "service": "wfs",
        "version": "1.1.0",
        "request": "GetFeature",
        "key": _require_key(settings),
        "typename": typename,
        "bbox": f"{bbox},{REQUESTED_CRS}",
        "srsname": REQUESTED_CRS,
        "output": "application/json",
        "maxFeatures": str(max_features),
        "exceptions": "text/xml",
    }
    if settings.vworld_api_domain:
        params["domain"] = settings.vworld_api_domain
    return params


def _data_params(settings: ProbeSettings, data_id: str, geom_filter: str | None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "service": "data",
        "version": "2.0",
        "request": "GetFeature",
        "key": _require_key(settings),
        "format": "json",
        "errorFormat": "json",
        "size": "1",
        "page": "1",
        "data": data_id,
        "crs": REQUESTED_CRS,
        "geometry": "true",
        "attribute": "true",
    }
    if geom_filter is not None:
        params["geomFilter"] = geom_filter
    if settings.vworld_api_domain:
        params["domain"] = settings.vworld_api_domain
    return params


def _ned_params(
    settings: ProbeSettings, typename: str, bbox: str, max_features: int = 1
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "key": _require_key(settings),
        "typename": typename,
        "bbox": f"{bbox},{REQUESTED_CRS}",
        "srsName": REQUESTED_CRS,
        "output": "application/json",
        "maxFeatures": str(max_features),
    }
    if settings.vworld_api_domain:
        params["domain"] = settings.vworld_api_domain
    return params


def bbox_to_geom_filter(bbox: str) -> str:
    """Convert a lat-first bbox string to a 2D Data API lon-first BOX filter."""

    min_lat, min_lon, max_lat, max_lon = (part.strip() for part in bbox.split(","))
    return f"BOX({min_lon},{min_lat},{max_lon},{max_lat})"


def probe_wfs_layer(settings: ProbeSettings, layer: StructuralLayer) -> dict[str, Any]:
    """Probe one WFS layer across the three region bounding boxes."""

    regional_probes: list[dict[str, Any]] = []
    attribute_fields: list[str] = []
    null_fields: list[str] = []
    observed_feature = False
    for region, bbox in layer.bbox_set().items():
        response = get_json_response(WFS_URL, _wfs_params(settings, layer.wfs_typename, bbox))
        summary = summarize_wfs_feature_collection(
            response.payload, expected_geometry=layer.expected_geometry
        )
        if summary["feature_count"]:
            observed_feature = True
            attribute_fields = summary["attribute_fields"]
            null_fields = sorted(set(null_fields) | set(summary["null_fields"]))
        regional_probes.append(
            {
                "region": region,
                "bbox": bbox,
                "requested_crs": REQUESTED_CRS,
                "http_status": response.status,
                "content_type": response.content_type,
                "provider_status": "FEATURE_COLLECTION_NO_SEPARATE_STATUS_FIELD",
                "summary": summary,
                "payload": response.payload,
            }
        )
    return {
        "layer_identifier": layer.wfs_typename,
        "service": "WFS",
        "request": "GetFeature",
        "requested_crs": REQUESTED_CRS,
        "expected_geometry_type": layer.expected_geometry,
        "observed_attribute_fields": attribute_fields,
        "observed_null_fields": null_fields,
        "schema_validation_status": "LIVE_VERIFIED" if observed_feature else "SCHEMA_UNVERIFIED",
        "regional_probes": regional_probes,
    }


def probe_wfs_pagination(settings: ProbeSettings, layer: StructuralLayer) -> list[dict[str, Any]]:
    """Probe WFS startindex paging on one layer's Seoul bounding box."""

    bbox = layer.bbox_set()["seoul"]
    pages: list[dict[str, Any]] = []
    for startindex in (0, 1):
        params = _wfs_params(settings, layer.wfs_typename, bbox)
        params["startindex"] = str(startindex)
        response = get_json_response(WFS_URL, params)
        summary = summarize_wfs_feature_collection(
            response.payload, expected_geometry=layer.expected_geometry
        )
        pages.append(
            {
                "startindex": startindex,
                "http_status": response.status,
                "content_type": response.content_type,
                "summary": summary,
                "payload": response.payload,
            }
        )
    return pages


def probe_data_layer(settings: ProbeSettings, layer: StructuralLayer) -> dict[str, Any]:
    """Probe one 2D Data API layer across the three region bounding boxes."""

    regional_probes: list[dict[str, Any]] = []
    attribute_fields: list[str] = []
    null_fields: list[str] = []
    observed_geometry_types: list[str] = []
    observed_feature = False
    for region, bbox in layer.bbox_set().items():
        geom_filter = bbox_to_geom_filter(bbox)
        response = get_json_response(DATA_URL, _data_params(settings, layer.data_id, geom_filter))
        summary = summarize_data_api_response(
            response.payload, expected_geometry=layer.expected_geometry
        )
        if summary["feature_count"]:
            observed_feature = True
            attribute_fields = summary["attribute_fields"]
            null_fields = sorted(set(null_fields) | set(summary["null_fields"]))
            if summary["geometry_type"] not in observed_geometry_types:
                observed_geometry_types.append(summary["geometry_type"])
        regional_probes.append(
            {
                "region": region,
                "geom_filter": geom_filter,
                "requested_crs": REQUESTED_CRS,
                "returned_crs_metadata": None,
                "http_status": response.status,
                "content_type": response.content_type,
                "provider_status": summary["provider_status"],
                "summary": {key: value for key, value in summary.items() if key != "payload"},
                "payload": response.payload,
            }
        )
    return {
        "layer_identifier": layer.data_id,
        "service": "2D Data API",
        "request": "GetFeature",
        "requested_crs": REQUESTED_CRS,
        "returned_crs_metadata": None,
        "observed_geometry_types": observed_geometry_types,
        "observed_attribute_fields": attribute_fields,
        "observed_null_fields": null_fields,
        "schema_validation_status": "LIVE_VERIFIED" if observed_feature else "SCHEMA_UNVERIFIED",
        "regional_probes": regional_probes,
    }


def probe_data_pagination(settings: ProbeSettings, layer: StructuralLayer) -> list[dict[str, Any]]:
    """Probe 2D Data API page metadata on one layer's Seoul bounding box."""

    geom_filter = bbox_to_geom_filter(layer.bbox_set()["seoul"])
    pages: list[dict[str, Any]] = []
    for page in (1, 2):
        params = _data_params(settings, layer.data_id, geom_filter)
        params["page"] = str(page)
        response = get_json_response(DATA_URL, params)
        summary = summarize_data_api_response(
            response.payload, expected_geometry=layer.expected_geometry
        )
        pages.append(
            {
                "requested_page": page,
                "http_status": response.status,
                "content_type": response.content_type,
                "provider_status": summary["provider_status"],
                "record": summary["record"],
                "page": summary["page"],
                "feature_ids": [summary["feature_id"]] if summary["feature_id"] else [],
                "payload": response.payload,
            }
        )
    return pages


def parse_provider_error_text(text: str) -> dict[str, Any]:
    """Parse a 2D Data API ERROR body that may be malformed JSON.

    Live-observed contract defect: the provider's JSON error body can contain
    unescaped double quotes inside ``error.text`` (for example ``단일검색="Y"``),
    which makes the whole payload invalid JSON. Error handling must therefore
    never assume the ERROR body parses.
    """

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        code_match = re.search(r'"code"\s*:\s*"([A-Z_]+)"', text)
        level_match = re.search(r'"level"\s*:\s*"([^"]*)"', text)
        status_match = re.search(r'"status"\s*:\s*"([A-Z_]+)"', text)
        return {
            "json_parse_error": True,
            "json_parse_error_detail": str(exc),
            "provider_status": status_match.group(1) if status_match else None,
            "error_code": code_match.group(1) if code_match else None,
            "error_level": level_match.group(1) if level_match else None,
        }
    if not isinstance(payload, dict):
        raise SchemaValidationError("VWorld 2D Data API error body is not a JSON object")
    error = extract_data_api_error(payload)
    return {
        "json_parse_error": False,
        "provider_status": "ERROR",
        "error_code": error.get("code"),
        "error_level": error.get("level"),
        "error": error,
    }


def probe_data_error_structure(settings: ProbeSettings, layer: StructuralLayer) -> dict[str, Any]:
    """Capture the provider error structure with a filterless request."""

    response = get_text_response(DATA_URL, _data_params(settings, layer.data_id, None))
    parsed = parse_provider_error_text(response.text)
    return {
        "trigger": "GetFeature without geomFilter/attrFilter",
        "http_status": response.status,
        "content_type": response.content_type,
        **parsed,
    }


def _probe_ned_layer(
    settings: ProbeSettings,
    *,
    url: str,
    typename: str,
    request_name: str,
    expected_geometry: str,
) -> dict[str, Any]:
    """Probe one NED (National Core Data) WFS layer across the three regions."""

    regional_probes: list[dict[str, Any]] = []
    attribute_fields: list[str] = []
    null_fields: list[str] = []
    observed_feature = False
    for region, bbox in DEFAULT_BBOXES.items():
        response = get_json_response(url, _ned_params(settings, typename, bbox))
        summary = summarize_wfs_feature_collection(
            response.payload, expected_geometry=expected_geometry
        )
        if summary["feature_count"]:
            observed_feature = True
            attribute_fields = summary["attribute_fields"]
            null_fields = sorted(set(null_fields) | set(summary["null_fields"]))
        regional_probes.append(
            {
                "region": region,
                "bbox": bbox,
                "requested_crs": REQUESTED_CRS,
                "http_status": response.status,
                "content_type": response.content_type,
                "provider_status": "FEATURE_COLLECTION_NO_SEPARATE_STATUS_FIELD",
                "summary": summary,
                "payload": response.payload,
            }
        )
    return {
        "layer_identifier": typename,
        "service": "National Core Data WFS",
        "request": request_name,
        "requested_crs": REQUESTED_CRS,
        "expected_geometry_type": expected_geometry,
        "observed_attribute_fields": attribute_fields,
        "observed_null_fields": null_fields,
        "schema_validation_status": "LIVE_VERIFIED" if observed_feature else "SCHEMA_UNVERIFIED",
        "regional_probes": regional_probes,
    }


def probe_ownership(settings: ProbeSettings) -> dict[str, Any]:
    """Probe the NED land-ownership WFS across the three region bounding boxes."""

    return _probe_ned_layer(
        settings,
        url=NED_POSSESSION_URL,
        typename=OWNERSHIP_TYPENAME,
        request_name="getPossessionWFS",
        expected_geometry=OWNERSHIP_EXPECTED_GEOMETRY,
    )


def probe_landuse(settings: ProbeSettings) -> dict[str, Any]:
    """Probe the NED land-use-planning WFS across the three region bounding boxes."""

    return _probe_ned_layer(
        settings,
        url=NED_LANDUSE_URL,
        typename=LANDUSE_TYPENAME,
        request_name="getLandUseWFS",
        expected_geometry=LANDUSE_EXPECTED_GEOMETRY,
    )


PAGINATION_LAYER = STRUCTURAL_LAYERS[0]  # lt_c_uq111 / LT_C_UQ111


def _save_layer_sample(
    settings: ProbeSettings,
    *,
    filename: str,
    endpoint: str,
    payload: dict[str, Any],
    request_metadata: dict[str, Any],
) -> None:
    envelope = build_envelope(
        source=SOURCE,
        endpoint=endpoint,
        payload=payload,
        verification_status="LIVE_VERIFIED",
        schema_validation_status=payload["schema_validation_status"],
        request_metadata=request_metadata,
    )
    save_sample(settings.sample_dir, filename, envelope)


def run_structural_audit(
    settings: ProbeSettings,
    *,
    save_samples: bool,
    services: tuple[str, ...] = SUPPORTED_SERVICES,
    request_delay: float = 0.5,
) -> list[dict[str, Any]]:
    """Run the Phase 2.5A structural-layer probes and return sanitized summaries."""

    unsupported = [service for service in services if service not in SUPPORTED_SERVICES]
    if unsupported:
        raise IngestionError(
            "Unsupported VWorld structural probe service type(s): "
            + ", ".join(sorted(unsupported))
            + f". Supported: {', '.join(SUPPORTED_SERVICES)}"
        )
    summaries: list[dict[str, Any]] = []
    if "wfs" in services:
        for layer in STRUCTURAL_LAYERS:
            result = probe_wfs_layer(settings, layer)
            if layer is PAGINATION_LAYER:
                result["pagination_probe"] = probe_wfs_pagination(settings, layer)
            if save_samples:
                _save_layer_sample(
                    settings,
                    filename=f"vworld-wfs-{layer.wfs_typename}.live.json",
                    endpoint=f"req/wfs GetFeature {layer.wfs_typename}",
                    payload=result,
                    request_metadata={
                        "layer_identifier": layer.wfs_typename,
                        "service": "WFS",
                        "request": "GetFeature",
                        "version": "1.1.0",
                        "requested_crs": REQUESTED_CRS,
                        "max_features": 1,
                        "bboxes": layer.bbox_set(),
                        "provider_status_semantics": (
                            "No explicit success field; reject exceptions and require "
                            "GeoJSON FeatureCollection"
                        ),
                    },
                )
            summaries.append(_sanitized_summary("wfs", layer.wfs_typename, result))
            time.sleep(request_delay)
    if "data" in services:
        for layer in STRUCTURAL_LAYERS:
            result = probe_data_layer(settings, layer)
            if layer is PAGINATION_LAYER:
                result["pagination_probe"] = probe_data_pagination(settings, layer)
                result["provider_error_probe"] = probe_data_error_structure(settings, layer)
            if save_samples:
                _save_layer_sample(
                    settings,
                    filename=f"vworld-2d-{layer.wfs_typename}.live.json",
                    endpoint=f"req/data GetFeature {layer.data_id}",
                    payload=result,
                    request_metadata={
                        "layer_identifier": layer.data_id,
                        "service": "data",
                        "version": "2.0",
                        "request": "GetFeature",
                        "size": 1,
                        "page": 1,
                        "requested_crs": REQUESTED_CRS,
                        "geometry": True,
                        "attribute": True,
                        "geom_filters": {
                            region: bbox_to_geom_filter(bbox)
                            for region, bbox in layer.bbox_set().items()
                        },
                        "credential_bearing_url_saved": False,
                    },
                )
            summaries.append(_sanitized_summary("data", layer.data_id, result))
            time.sleep(request_delay)
    ned_probes = {
        "ownership": (probe_ownership, OWNERSHIP_TYPENAME, "getPossessionWFS"),
        "landuse": (probe_landuse, LANDUSE_TYPENAME, "getLandUseWFS"),
    }
    for service, (probe_func, typename, request_name) in ned_probes.items():
        if service not in services:
            continue
        result = probe_func(settings)
        if save_samples:
            _save_layer_sample(
                settings,
                filename=f"vworld-{service}-{typename}.live.json",
                endpoint=f"ned/wfs/{request_name} {typename}",
                payload=result,
                request_metadata={
                    "layer_identifier": typename,
                    "service": "National Core Data WFS",
                    "request": request_name,
                    "requested_crs": REQUESTED_CRS,
                    "max_features": 1,
                    "bboxes": DEFAULT_BBOXES,
                    "provider_status_semantics": (
                        "No explicit success field; reject exceptions and require "
                        "GeoJSON FeatureCollection"
                    ),
                },
            )
        summaries.append(_sanitized_summary(service, typename, result))
        time.sleep(request_delay)
    return summaries


def _sanitized_summary(
    service: str, layer_identifier: str, result: dict[str, Any]
) -> dict[str, Any]:
    """Build a credential-free one-line summary for CLI output."""

    return {
        "service": service,
        "layer": layer_identifier,
        "schema_validation_status": result["schema_validation_status"],
        "regions": [
            {
                "region": probe["region"],
                "http_status": probe["http_status"],
                "provider_status": probe["provider_status"],
                "feature_count": probe["summary"]["feature_count"],
                "total": probe["summary"].get("total_features")
                or (probe["summary"].get("record") or {}).get("total"),
            }
            for probe in result["regional_probes"]
        ],
    }
