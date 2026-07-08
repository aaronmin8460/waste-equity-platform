"""SGIS contract parsing and geometry normalization for production ingestion."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from typing import Any, Literal

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform
from shapely.validation import make_valid

from .errors import ProviderResultError, SchemaValidationError

SGIS_SOURCE_ID = "sgis"
SGIS_SOURCE_CRS = "EPSG:5179"
TARGET_CRS = "EPSG:4326"
TRANSFORMATION_VERSION = "sgis-capital-region-v1"
POPULATION_DEFINITION = "SGIS_TOTAL_POPULATION"
POPULATION_UNIT = "persons"

RegionLevel = Literal["SIDO", "SIGUNGU"]


@dataclass(frozen=True)
class SgisScopeItem:
    code: str
    name: str


CAPITAL_REGION_SIDOS: tuple[SgisScopeItem, ...] = (
    SgisScopeItem(code="11", name="Seoul"),
    SgisScopeItem(code="23", name="Incheon"),
    SgisScopeItem(code="31", name="Gyeonggi-do"),
)


@dataclass(frozen=True)
class PopulationRecord:
    source_administrative_code: str
    source_administrative_name: str
    source_parent_administrative_code: str | None
    source_geographic_level: RegionLevel
    reference_year: int
    population: int


@dataclass(frozen=True)
class BoundaryRecord:
    source_administrative_code: str
    source_administrative_name: str
    source_parent_administrative_code: str | None
    source_geographic_level: RegionLevel
    reference_year: int
    geometry: MultiPolygon
    geometry_hash: str
    repair_method: str


def canonical_region_code(sgis_code: str) -> str:
    return f"KR-SGIS-{sgis_code}"


def sgis_level(adm_cd: str) -> RegionLevel:
    if len(adm_cd) == 2:
        return "SIDO"
    if len(adm_cd) == 5:
        return "SIGUNGU"
    raise SchemaValidationError(f"Unexpected SGIS administrative code depth: {adm_cd!r}")


def require_provider_success(payload: dict[str, Any], provider: str = "SGIS") -> None:
    code = payload.get("errCd")
    if code not in {0, "0"}:
        raise ProviderResultError(f"{provider} provider result code failure: {code!r}")


def parse_population_response(
    payload: dict[str, Any],
    *,
    reference_year: int,
    parent_administrative_code: str | None,
    expected_level: RegionLevel,
) -> list[PopulationRecord]:
    require_provider_success(payload)
    rows = payload.get("result")
    if not isinstance(rows, list):
        raise SchemaValidationError("SGIS population response missing result list")

    records: list[PopulationRecord] = []
    for row in rows:
        if not isinstance(row, dict):
            raise SchemaValidationError("SGIS population row is not an object")
        adm_cd = _required_text(row, "adm_cd", "SGIS population")
        adm_nm = _required_text(row, "adm_nm", "SGIS population")
        level = sgis_level(adm_cd)
        if level != expected_level:
            raise SchemaValidationError(
                f"Unexpected SGIS population level for {adm_cd}: {level}, expected {expected_level}"
            )
        records.append(
            PopulationRecord(
                source_administrative_code=adm_cd,
                source_administrative_name=adm_nm,
                source_parent_administrative_code=parent_administrative_code,
                source_geographic_level=level,
                reference_year=reference_year,
                population=_parse_population(row.get("tot_ppltn"), adm_cd),
            )
        )
    _reject_duplicate_codes([record.source_administrative_code for record in records], "population")
    return records


def parse_boundary_response(
    payload: dict[str, Any],
    *,
    reference_year: int,
    parent_administrative_code: str | None,
    expected_level: RegionLevel,
    source_crs: str = SGIS_SOURCE_CRS,
    target_crs: str = TARGET_CRS,
) -> list[BoundaryRecord]:
    require_provider_success(payload)
    if payload.get("type") != "FeatureCollection":
        raise SchemaValidationError("SGIS boundary response is not a GeoJSON FeatureCollection")
    crs = payload.get("crs")
    if crs is not None and source_crs not in json.dumps(crs, ensure_ascii=False):
        raise SchemaValidationError(
            "SGIS boundary response CRS does not match configured source CRS"
        )
    features = payload.get("features")
    if not isinstance(features, list):
        raise SchemaValidationError("SGIS boundary response missing features list")

    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    records: list[BoundaryRecord] = []
    for feature in features:
        if not isinstance(feature, dict):
            raise SchemaValidationError("SGIS boundary feature is not an object")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise SchemaValidationError("SGIS boundary feature missing properties")
        adm_cd = _required_text(properties, "adm_cd", "SGIS boundary")
        adm_nm = _required_text(properties, "adm_nm", "SGIS boundary")
        level = sgis_level(adm_cd)
        if level != expected_level:
            raise SchemaValidationError(
                f"Unexpected SGIS boundary level for {adm_cd}: {level}, expected {expected_level}"
            )
        geometry_obj = feature.get("geometry")
        if not isinstance(geometry_obj, dict):
            raise SchemaValidationError(f"SGIS boundary feature {adm_cd} missing geometry")
        source_geometry = shape(geometry_obj)
        multipolygon, repair_method = normalize_geometry(
            transform(transformer.transform, source_geometry)
        )
        records.append(
            BoundaryRecord(
                source_administrative_code=adm_cd,
                source_administrative_name=adm_nm,
                source_parent_administrative_code=parent_administrative_code,
                source_geographic_level=level,
                reference_year=reference_year,
                geometry=multipolygon,
                geometry_hash=hash_geometry(multipolygon),
                repair_method=repair_method,
            )
        )
    _reject_duplicate_codes([record.source_administrative_code for record in records], "boundary")
    return records


def normalize_geometry(geometry: BaseGeometry) -> tuple[MultiPolygon, str]:
    if geometry.is_empty:
        raise SchemaValidationError("SGIS boundary geometry is empty")
    repair_method = "none"
    if not geometry.is_valid:
        geometry = make_valid(geometry)
        repair_method = "shapely.make_valid_polygonal"
    multipolygon = _to_multipolygon(geometry)
    if multipolygon.is_empty:
        raise SchemaValidationError("SGIS boundary geometry became empty after normalization")
    if not multipolygon.is_valid:
        raise SchemaValidationError("SGIS boundary geometry is invalid after deterministic repair")
    return multipolygon, repair_method


def hash_geometry(geometry: BaseGeometry) -> str:
    return hashlib.sha256(geometry.wkb).hexdigest()


def _to_multipolygon(geometry: BaseGeometry) -> MultiPolygon:
    if isinstance(geometry, MultiPolygon):
        return geometry
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    if geometry.geom_type == "GeometryCollection":
        polygons: list[Polygon] = []
        for part in getattr(geometry, "geoms", []):
            if isinstance(part, Polygon):
                polygons.append(part)
            elif isinstance(part, MultiPolygon):
                polygons.extend(list(part.geoms))
        if polygons:
            return MultiPolygon(polygons)
    raise SchemaValidationError(f"SGIS boundary geometry is not polygonal: {geometry.geom_type}")


def _required_text(row: dict[str, Any], field: str, context: str) -> str:
    value = row.get(field)
    if value is None:
        raise SchemaValidationError(f"{context} missing required field {field}")
    text = str(value).strip()
    if not text or text.upper() in {"N/A", "NULL", "NONE"}:
        raise SchemaValidationError(f"{context} has null-like value for {field}")
    return text


def _parse_population(value: Any, adm_cd: str) -> int:
    if value is None:
        raise SchemaValidationError(f"SGIS population {adm_cd} has null population")
    text = str(value).replace(",", "").strip()
    if not text or text.upper() in {"N/A", "NULL", "NONE"}:
        raise SchemaValidationError(f"SGIS population {adm_cd} has null-like population")
    try:
        population = int(text)
    except ValueError as exc:
        raise SchemaValidationError(f"SGIS population {adm_cd} has non-integer population") from exc
    if population < 0:
        raise SchemaValidationError(f"SGIS population {adm_cd} is negative")
    return population


def _reject_duplicate_codes(codes: list[str], context: str) -> None:
    duplicates = sorted(code for code, count in Counter(codes).items() if count > 1)
    if duplicates:
        raise SchemaValidationError(
            f"SGIS {context} response contains duplicate administrative code(s): "
            + ", ".join(duplicates)
        )
