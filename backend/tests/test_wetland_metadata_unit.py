"""Pure-unit guards for the inland-wetland API (no database required).

These assert the *invariants* of Phase 1B-2 that must hold regardless of what is
loaded: the canonical Korean disclosures, the lifecycle values (scoring stays
NOT_IMPLEMENTED, production NOT_RUN), that every wetland route is read-only, and
that the router's SQL / imports never reach the UM901 / suitability tables. The
data-path behaviour is covered by ``test_wetland_routes_integration.py`` (PostGIS).
"""

from __future__ import annotations

from waste_equity_backend.api.app import create_app
from waste_equity_backend.api.routes import wetlands
from waste_equity_backend.api.routes.wetlands import _TILE_SQL, LIFECYCLE, TILE_SOURCE_LAYER
from waste_equity_backend.schemas.wetland import (
    WETLAND_DETAIL_STATUTORY_WARNING,
    WETLAND_INVENTORY_DISCLAIMER,
    WETLAND_KOREAN_LABEL,
    WETLAND_LAYER_NAME,
    WETLAND_UM901_DISTINCTION,
)

WETLANDS_PREFIX = "/api/v1/environment/wetlands"


def _wetland_paths() -> dict[str, dict[str, object]]:
    """Wetland paths from the OpenAPI schema, keyed by path → {method: op}.

    (Newer FastAPI wraps ``include_router`` results, so iterating ``app.routes``
    no longer flattens to APIRoutes; the OpenAPI schema is the reliable view.)
    """
    schema = create_app().openapi()
    return {p: ops for p, ops in schema["paths"].items() if p.startswith(WETLANDS_PREFIX)}


def test_layer_identity_constants() -> None:
    assert WETLAND_LAYER_NAME == "wetland_inventory"
    assert WETLAND_KOREAN_LABEL == "내륙습지 목록"
    assert TILE_SOURCE_LAYER == "wetlands"


def test_disclosures_are_the_canonical_korean_text() -> None:
    # These strings are load-bearing: the frontend and tests assert the same text.
    assert WETLAND_INVENTORY_DISCLAIMER == (
        "내륙습지 목록은 국립생태원의 조사·목록 데이터이며, "
        "모든 습지가 법정 습지보호지역을 의미하지 않습니다."
    )
    assert WETLAND_UM901_DISTINCTION == (
        "법정 습지보호지역은 기존 UM901 보호구역 레이어에서 별도로 확인할 수 있습니다."
    )
    assert WETLAND_DETAIL_STATUTORY_WARNING == (
        "이 레이어는 조사된 내륙습지 목록입니다. 모든 항목이 법정 습지보호지역을 뜻하지 않습니다."
    )


def test_lifecycle_scoring_not_implemented_and_production_not_run() -> None:
    assert LIFECYCLE.contract_verification == "LIVE_VERIFIED"
    assert LIFECYCLE.database_ingestion == "IMPLEMENTED_AND_LOCALLY_VERIFIED"
    assert LIFECYCLE.api_exposure == "IMPLEMENTED"
    assert LIFECYCLE.frontend_map_exposure == "IMPLEMENTED"
    # The two hard boundaries of this phase.
    assert LIFECYCLE.scoring_integration == "NOT_IMPLEMENTED"
    assert LIFECYCLE.production_deployment == "NOT_RUN"


def test_all_wetland_routes_are_read_only() -> None:
    paths = _wetland_paths()
    assert paths, "no wetland routes registered"
    for path, ops in paths.items():
        methods = {m.lower() for m in ops}
        # Only GET — never a write verb (POST/PUT/PATCH/DELETE).
        assert methods <= {"get"}, (path, methods)


def test_expected_wetland_endpoints_exist() -> None:
    paths = set(_wetland_paths())
    assert WETLANDS_PREFIX in paths  # list
    assert f"{WETLANDS_PREFIX}/metadata" in paths
    assert f"{WETLANDS_PREFIX}/tiles/{{z}}/{{x}}/{{y}}.mvt" in paths
    assert f"{WETLANDS_PREFIX}/{{feature_id}}" in paths


def test_tile_sql_touches_only_the_wetland_table_and_never_writes() -> None:
    """The only raw SQL in the router (the tile query) reads exactly one table —
    the wetland inventory — and issues no write and no join to UM901/suitability."""
    sql = _TILE_SQL.lower()
    assert "environmental_wetland_inventory_features" in sql
    for foreign in (
        "structural_protected_features",
        "suitability_candidates",
        "suitability_analysis",
    ):
        assert foreign not in sql
    for verb in ("insert into", "update ", "delete from"):
        assert verb not in sql


def test_router_namespace_never_imports_um901_or_suitability_models() -> None:
    """Code-level separation: the wetland router pulls in no structural/suitability
    model, so it cannot query or mutate them."""
    for banned in (
        "SuitabilityCandidate",
        "SuitabilityAnalysisRun",
        "StructuralProtectedFeature",
        "StructuralFeature",
    ):
        assert not hasattr(wetlands, banned), f"wetland router imported {banned}"
