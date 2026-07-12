"""Clip nationwide structural features to the capital-region 시도 boundaries.

Nationwide sources (the KNPS national-park polygons and the ITS 표준노드링크 line
network) cover all of Korea. This module loads the authoritative Seoul / Incheon
/ Gyeonggi SIDO boundaries already stored in PostGIS (``regions``, EPSG:4326),
spatially filters nationwide geometry to those three 시도, and clips features that
cross a 시도 boundary to the boundary — so a cross-boundary park such as 북한산
becomes one clipped feature per 시도 it touches, never the whole national polygon
duplicated into every region.

A prepared geometry plus a bounding box gives a cheap reject for the vast
majority of nationwide features that fall outside the capital region, and lets a
fully-contained feature skip the intersection cost entirely.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from shapely import wkb
from shapely.geometry.base import BaseGeometry
from shapely.geometry.linestring import LineString
from shapely.geometry.multilinestring import MultiLineString
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.polygon import Polygon
from shapely.prepared import prep as _prep
from sqlalchemy import text
from sqlalchemy.orm import Session

# region_name in ``regions`` -> (dir_name, sido_code, sido_name) used by the loader.
_SIDO_BY_NAME: dict[str, tuple[str, str, str]] = {
    "서울특별시": ("seoul", "11", "서울특별시"),
    "인천광역시": ("incheon", "28", "인천광역시"),
    "경기도": ("gyeonggi", "41", "경기도"),
}


@dataclass
class RegionBoundary:
    dir_name: str
    sido_code: str
    sido_name: str
    geometry: BaseGeometry  # EPSG:4326
    prepared: Any  # shapely PreparedGeometry
    bounds: tuple[float, float, float, float]  # minx, miny, maxx, maxy


class RegionBoundaryError(RuntimeError):
    """Raised when an expected capital-region SIDO boundary is not in PostGIS."""


def load_capital_region_boundaries(session: Session) -> list[RegionBoundary]:
    """Load the three capital-region SIDO boundaries (latest validity) from PostGIS.

    Boundaries are matched by official 시도 name so the load is independent of the
    ``regions.region_code`` scheme (SGIS codes) versus the loader's 시도 codes.
    """

    rows = session.execute(
        text(
            """
            SELECT DISTINCT ON (region_name)
                   region_name, ST_AsBinary(geometry) AS wkb
            FROM regions
            WHERE region_level = 'SIDO'
              AND region_name IN ('서울특별시', '인천광역시', '경기도')
              AND geometry IS NOT NULL
            ORDER BY region_name, valid_from DESC
            """
        )
    ).all()
    by_name = {row.region_name: row.wkb for row in rows}
    boundaries: list[RegionBoundary] = []
    for name, (dir_name, sido_code, sido_name) in _SIDO_BY_NAME.items():
        blob = by_name.get(name)
        if blob is None:
            raise RegionBoundaryError(
                f"Capital-region SIDO boundary for {name} is not present in PostGIS "
                "(regions.region_level='SIDO'); cannot clip nationwide sources safely."
            )
        geom = wkb.loads(bytes(blob))
        boundaries.append(
            RegionBoundary(
                dir_name=dir_name,
                sido_code=sido_code,
                sido_name=sido_name,
                geometry=geom,
                prepared=_prep(geom),
                bounds=geom.bounds,
            )
        )
    return boundaries


def _bbox_overlaps(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def _polygonal_parts(geom: BaseGeometry) -> MultiPolygon | None:
    polys: list[Polygon] = []
    for part in getattr(geom, "geoms", [geom]):
        gt = part.geom_type
        if gt == "Polygon" and not part.is_empty:
            polys.append(cast(Polygon, part))
        elif gt == "MultiPolygon":
            polys.extend(cast(Polygon, p) for p in part.geoms if not p.is_empty)
    if not polys:
        return None
    return MultiPolygon(polys)


def _linear_parts(geom: BaseGeometry) -> MultiLineString | None:
    lines: list[LineString] = []
    for part in getattr(geom, "geoms", [geom]):
        gt = part.geom_type
        if gt == "LineString" and not part.is_empty:
            lines.append(cast(LineString, part))
        elif gt == "MultiLineString":
            lines.extend(cast(LineString, ls) for ls in part.geoms if not ls.is_empty)
    if not lines:
        return None
    return MultiLineString(lines)


@dataclass
class ClipResult:
    boundary: RegionBoundary
    geometry: BaseGeometry  # MultiPolygon or MultiLineString, EPSG:4326
    clipped: bool  # True when the source crossed the 시도 boundary and was cut


def clip_to_regions(
    geom: BaseGeometry, boundaries: list[RegionBoundary], *, is_line: bool
) -> list[ClipResult]:
    """Return one ``ClipResult`` per capital-region 시도 the geometry touches.

    A feature fully inside a 시도 is returned unchanged (``clipped=False``); a
    feature crossing a 시도 boundary is intersected with the boundary and only
    the parts of the correct dimension are kept (``clipped=True``). A feature
    outside all three 시도 yields an empty list (skipped as out-of-region).
    """

    results: list[ClipResult] = []
    gbounds = geom.bounds
    for b in boundaries:
        if not _bbox_overlaps(gbounds, b.bounds):
            continue
        if b.prepared.contains(geom):
            piece = _polygonal_parts(geom) if not is_line else _linear_parts(geom)
            if piece is not None and piece.is_valid:
                results.append(ClipResult(b, piece, clipped=False))
            continue
        if not b.prepared.intersects(geom):
            continue
        inter = geom.intersection(b.geometry)
        if inter.is_empty:
            continue
        piece = _polygonal_parts(inter) if not is_line else _linear_parts(inter)
        if piece is None or piece.is_empty or not piece.is_valid:
            continue
        results.append(ClipResult(b, piece, clipped=True))
    return results
