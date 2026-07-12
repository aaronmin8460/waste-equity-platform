"""Tests for the structural source-manifest parser and layer resolution.

Uses only synthetic in-memory manifest dicts — never official data.
"""

from __future__ import annotations

import datetime

import pytest

from waste_equity_ingestion.structural_manifest import (
    NATIONWIDE,
    REGIONAL,
    ManifestError,
    parse_manifest,
)

_PROTECTED = {
    "family": "protected",
    "datasets": [
        {
            "dataset_key": "lsmd_202606",
            "provider": "국토교통부",
            "official_dataset_name": "LSMD",
            "provider_dataset_identifier": "LSMD (202606)",
            "coverage_type": "regional",
            "reference_date": "2026-06-01",
            "source_crs": "EPSG:5186",
            "layers": [
                {
                    "layer_code": "UD801",
                    "layer_identifier": "LT_C_UD801",
                    "category": "DEVELOPMENT_RESTRICTION",
                    "official_layer_name": "개발제한구역",
                    "geometry_family": "POLYGON",
                    "filename_aliases": ["UD801"],
                }
            ],
        },
        {
            "dataset_key": "knps_2023",
            "provider": "국립공원공단",
            "official_dataset_name": "국립공원 공원경계",
            "provider_dataset_identifier": "국립공원 (2023)",
            "coverage_type": "nationwide",
            "reference_date": "2023-12-31",
            "source_crs": "EPSG:5179",
            "layers": [
                {
                    "layer_code": "WGISNPGUG",
                    "layer_identifier": "LT_C_WGISNPGUG",
                    "category": "NATIONAL_PARK",
                    "official_layer_name": "국립자연공원",
                    "geometry_family": "POLYGON",
                    "filename_aliases": ["BSI_NPK_BBNDR"],
                    "provider_feature_id_fields": ["NPK_CD"],
                }
            ],
        },
    ],
    "official_source_unavailable": [
        {"region": "seoul", "layer": "UM901", "evidence": "not published"},
    ],
}

_ROADS = {
    "family": "roads",
    "datasets": [
        {
            "dataset_key": "n3a",
            "provider": "국토지리정보원",
            "official_dataset_name": "도로중심선",
            "provider_dataset_identifier": "N3A",
            "coverage_type": "regional",
            "reference_date": "2024-04-18",
            "source_crs": "EPSG:5179",
            "layers": [
                {
                    "layer_code": "N3A0020000",
                    "layer_identifier": "LT_L_N3A0020000",
                    "category": "ROAD_CENTERLINE",
                    "official_layer_name": "도로중심선",
                    "geometry_family": "LINE",
                    "filename_aliases": ["N3L_A0020000", "A0020000"],
                }
            ],
        },
        {
            "dataset_key": "stdlink",
            "provider": "ITS",
            "official_dataset_name": "표준노드링크",
            "provider_dataset_identifier": "STDLINK",
            "coverage_type": "nationwide",
            "reference_date": "2026-07-01",
            "source_crs": "EPSG:5186",
            "layers": [
                {
                    "layer_code": "STDLINK",
                    "layer_identifier": "STD_NODE_LINK",
                    "category": "STANDARD_LINK",
                    "official_layer_name": "표준노드링크",
                    "geometry_family": "LINE",
                    "filename_aliases": ["MOCT_LINK"],
                    "exclude_aliases": ["MOCT_NODE", "MULTILINK", "TURNINFO"],
                }
            ],
        },
    ],
}


def test_parse_protected_manifest() -> None:
    manifest = parse_manifest(_PROTECTED, family="protected")
    assert len(manifest.datasets) == 2
    lsmd = manifest.datasets[0]
    assert lsmd.coverage_type == REGIONAL
    assert lsmd.reference_date == datetime.date(2026, 6, 1)
    knps = manifest.datasets[1]
    assert knps.coverage_type == NATIONWIDE
    assert knps.is_nationwide is True
    assert knps.reference_date == datetime.date(2023, 12, 31)


def test_official_source_unavailable_status() -> None:
    manifest = parse_manifest(_PROTECTED, family="protected")
    assert manifest.unavailable_evidence("seoul", "UM901") == "not published"
    assert manifest.unavailable_evidence("incheon", "UM901") is None


def test_family_mismatch_rejected() -> None:
    with pytest.raises(ManifestError):
        parse_manifest(_PROTECTED, family="roads")


def test_national_park_layer_mapping_not_from_filename() -> None:
    manifest = parse_manifest(_PROTECTED, family="protected")
    # The archive is named 국립공원 공원경계; the internal shapefile is BSI_NPK_BBNDR
    # and must resolve to WGISNPGUG/NATIONAL_PARK via the alias, not the filename.
    match = manifest.match("BSI_NPK_BBNDR")
    assert match is not None
    dataset, layer = match
    assert dataset.dataset_key == "knps_2023"
    assert layer.layer_code == "WGISNPGUG"
    assert layer.category == "NATIONAL_PARK"
    assert layer.official_layer_name == "국립자연공원"


def test_road_centerline_alias_matches_internal_name() -> None:
    manifest = parse_manifest(_ROADS, family="roads")
    # Outer ZIP name has no layer code; the internal N3L_A0020000_11 must map.
    match = manifest.match("N3L_A0020000_11")
    assert match is not None
    _, layer = match
    assert layer.layer_code == "N3A0020000"
    assert layer.category == "ROAD_CENTERLINE"


def test_stdlink_link_selected_and_node_rejected() -> None:
    manifest = parse_manifest(_ROADS, family="roads")
    link = manifest.match("MOCT_LINK")
    assert link is not None and link[1].layer_code == "STDLINK"
    # The NODE point file must NOT match the LINK layer.
    assert manifest.match("MOCT_NODE") is None
    assert manifest.match("MULTILINK") is None
    assert manifest.match("TURNINFO") is None


def test_longer_alias_wins() -> None:
    manifest = parse_manifest(_ROADS, family="roads")
    # Both "N3L_A0020000" and "A0020000" match; the longer, more specific alias wins.
    match = manifest.match("N3L_A0020000_28")
    assert match is not None
    _, layer = match
    assert layer.longest_alias_len("N3L_A0020000_28") == len("N3LA0020000")


def test_bad_geometry_family_rejected() -> None:
    bad = {
        "family": "roads",
        "datasets": [
            {
                "dataset_key": "x",
                "coverage_type": "regional",
                "reference_date": "2024-01-01",
                "layers": [
                    {
                        "layer_code": "X",
                        "category": "C",
                        "geometry_family": "POINT",
                        "filename_aliases": ["X"],
                    }
                ],
            }
        ],
    }
    with pytest.raises(ManifestError):
        parse_manifest(bad, family="roads")
