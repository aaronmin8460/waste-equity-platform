"""Reusable registry of structural spatial layers beyond zoning.

Defines the mandatory (and already live-verified optional) protected/restricted
polygon layers and road/transport line layers from the Phase 2.5A audit, plus
the line-geometry normalization used by the generalized structural loader. The
polygon layers reuse ``structural_features``; the line layers use
``structural_line_features`` (they must not be forced into the polygon table).

Official basis: ``docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`` and
``docs/SUITABILITY_DATA_REQUIREMENTS.md``. No new research is performed here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry
from shapely.geometry.linestring import LineString
from shapely.geometry.multilinestring import MultiLineString

from .vworld_zoning_contract import GeometryValidationError

POLYGON = "POLYGON"
LINE = "LINE"

NORMALIZED_LINE_GEOMETRY_TYPE = "MultiLineString"


@dataclass(frozen=True)
class StructuralLayerSpec:
    """One official structural layer: code, geometry family, and semantics."""

    layer_code: str
    layer_identifier: str
    family: str  # "protected" | "roads"
    geometry_family: str  # POLYGON | LINE
    category: str
    korean_name: str
    mandatory: bool


# Mandatory protected/restricted polygon layers plus the two live-verified
# optional layers (kept clearly flagged mandatory=False).
PROTECTED_LAYERS: tuple[StructuralLayerSpec, ...] = (
    StructuralLayerSpec(
        "UD801", "LT_C_UD801", "protected", POLYGON, "DEVELOPMENT_RESTRICTION", "개발제한구역", True
    ),
    StructuralLayerSpec(
        "UM710",
        "LT_C_UM710",
        "protected",
        POLYGON,
        "WATER_SOURCE_PROTECTION",
        "상수원보호구역",
        True,
    ),
    StructuralLayerSpec(
        "UM901", "LT_C_UM901", "protected", POLYGON, "WETLAND_PROTECTION", "습지보호지역", True
    ),
    StructuralLayerSpec(
        "UF151", "LT_C_UF151", "protected", POLYGON, "FOREST_PROTECTION", "산림보호구역", True
    ),
    StructuralLayerSpec(
        "WGISNPGUG",
        "LT_C_WGISNPGUG",
        "protected",
        POLYGON,
        "NATIONAL_PARK",
        "국립자연공원",
        True,
    ),
    StructuralLayerSpec(
        "UO101",
        "LT_C_UO101",
        "protected",
        POLYGON,
        "EDUCATION_PROTECTION",
        "교육환경보호구역",
        True,
    ),
    StructuralLayerSpec(
        "UO301",
        "LT_C_UO301",
        "protected",
        POLYGON,
        "HERITAGE_PROTECTION",
        "국가유산 지정/보호구역",
        True,
    ),
    StructuralLayerSpec(
        "UM221",
        "LT_C_UM221",
        "protected",
        POLYGON,
        "WILDLIFE_PROTECTION",
        "야생생물보호구역",
        False,
    ),
    StructuralLayerSpec(
        "UQ162",
        "LT_C_UQ162",
        "protected",
        POLYGON,
        "URBAN_NATURE_PARK",
        "도시자연공원/공원·녹지",
        False,
    ),
)

# Road/transport line layers. STDLINK (ITS 표준노드링크) is the preferred bulk
# backbone; N3A0020000 (NGII road centerline) carries road width; MOCTLINK is an
# API cross-check only. Geometric proximity never proves truck accessibility.
ROAD_LAYERS: tuple[StructuralLayerSpec, ...] = (
    StructuralLayerSpec(
        "STDLINK", "STD_NODE_LINK", "roads", LINE, "STANDARD_LINK", "표준노드링크", True
    ),
    StructuralLayerSpec(
        "N3A0020000", "LT_L_N3A0020000", "roads", LINE, "ROAD_CENTERLINE", "도로중심선", False
    ),
    StructuralLayerSpec(
        "MOCTLINK", "LT_L_MOCTLINK", "roads", LINE, "ROAD_LINK", "국가교통정보 교통링크", False
    ),
)

FAMILY_LAYERS: dict[str, tuple[StructuralLayerSpec, ...]] = {
    "protected": PROTECTED_LAYERS,
    "roads": ROAD_LAYERS,
}

# Provider dataset identifier recorded per family (国土交通部 / ITS 국가교통정보센터).
FAMILY_PROVIDER: dict[str, tuple[str, str]] = {
    "protected": ("국토교통부", "용도구역도/보호구역 계열 (LSMD/NA_24)"),
    "roads": ("국토교통부 국가교통정보센터/국토지리정보원", "표준노드링크 / 도로중심선 bulk"),
}

_UPPER_ALNUM = re.compile(r"[^A-Z0-9]")


def layer_for_name(family: str, name: str) -> StructuralLayerSpec | None:
    """Resolve a layer in ``family`` from a shapefile/archive base name."""

    token = _UPPER_ALNUM.sub("", name.upper())
    # Match longer codes first so N3A0020000 wins before any short prefix.
    for spec in sorted(FAMILY_LAYERS.get(family, ()), key=lambda s: -len(s.layer_code)):
        if spec.layer_code in token:
            return spec
    return None


def normalize_line_geometry(geom: BaseGeometry) -> tuple[MultiLineString, bool]:
    """Normalize a line geometry to MultiLineString in EPSG:4326 space.

    Returns ``(multilinestring, promoted)`` where ``promoted`` is True when a
    single LineString was wrapped. Rejects empty, invalid, and non-line
    geometry rather than guessing.
    """

    if geom.is_empty:
        raise GeometryValidationError("Empty geometry")
    geom_type = geom.geom_type
    if geom_type not in ("LineString", "MultiLineString"):
        raise GeometryValidationError(f"Unexpected geometry type {geom_type}; expected line")
    if not geom.is_valid:
        raise GeometryValidationError("Invalid line geometry")
    if isinstance(geom, LineString):
        return MultiLineString([geom]), True
    assert isinstance(geom, MultiLineString)
    return geom, False
