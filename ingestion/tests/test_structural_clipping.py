"""Tests for nationwide → capital-region spatial clipping (pure shapely).

Uses synthetic square SIDO boundaries and synthetic geometry — never official
data and never the database.
"""

from __future__ import annotations

from shapely.geometry.linestring import LineString
from shapely.geometry.polygon import Polygon
from shapely.prepared import prep

from waste_equity_ingestion.structural_clipping import RegionBoundary, clip_to_regions


def _boundary(
    dir_name: str, code: str, x0: float, y0: float, x1: float, y1: float
) -> RegionBoundary:
    geom = Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    return RegionBoundary(
        dir_name=dir_name,
        sido_code=code,
        sido_name=dir_name,
        geometry=geom,
        prepared=prep(geom),
        bounds=geom.bounds,
    )


# Two adjacent unit squares sharing the x=1 edge (like two adjacent 시도).
_WEST = _boundary("west", "11", 0.0, 0.0, 1.0, 1.0)
_EAST = _boundary("east", "41", 1.0, 0.0, 2.0, 1.0)
_BOUNDARIES = [_WEST, _EAST]


def test_polygon_fully_inside_one_region_not_clipped() -> None:
    poly = Polygon([(0.1, 0.1), (0.4, 0.1), (0.4, 0.4), (0.1, 0.4)])
    results = clip_to_regions(poly, _BOUNDARIES, is_line=False)
    assert len(results) == 1
    assert results[0].boundary.dir_name == "west"
    assert results[0].clipped is False
    assert results[0].geometry.geom_type == "MultiPolygon"


def test_polygon_crossing_boundary_is_clipped_per_region() -> None:
    # A polygon straddling x=1 belongs to both regions, clipped to each.
    poly = Polygon([(0.5, 0.2), (1.5, 0.2), (1.5, 0.8), (0.5, 0.8)])
    results = clip_to_regions(poly, _BOUNDARIES, is_line=False)
    assert {r.boundary.dir_name for r in results} == {"west", "east"}
    assert all(r.clipped for r in results)
    # Each clipped piece has half the area, and together they equal the original.
    total = sum(r.geometry.area for r in results)
    assert abs(total - poly.area) < 1e-9
    for r in results:
        assert abs(r.geometry.area - poly.area / 2) < 1e-9


def test_polygon_outside_all_regions_skipped() -> None:
    poly = Polygon([(5.0, 5.0), (6.0, 5.0), (6.0, 6.0), (5.0, 6.0)])
    assert clip_to_regions(poly, _BOUNDARIES, is_line=False) == []


def test_line_crossing_boundary_is_clipped() -> None:
    line = LineString([(0.5, 0.5), (1.5, 0.5)])
    results = clip_to_regions(line, _BOUNDARIES, is_line=True)
    assert {r.boundary.dir_name for r in results} == {"west", "east"}
    assert all(r.geometry.geom_type == "MultiLineString" for r in results)
    total = sum(r.geometry.length for r in results)
    assert abs(total - line.length) < 1e-9


def test_line_fully_inside_not_clipped() -> None:
    line = LineString([(1.1, 0.5), (1.9, 0.5)])
    results = clip_to_regions(line, _BOUNDARIES, is_line=True)
    assert len(results) == 1
    assert results[0].boundary.dir_name == "east"
    assert results[0].clipped is False


def test_line_outside_all_regions_skipped() -> None:
    line = LineString([(5.0, 5.0), (6.0, 6.0)])
    assert clip_to_regions(line, _BOUNDARIES, is_line=True) == []
