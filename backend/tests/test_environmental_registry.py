"""Environmental-layer catalogue: registry integrity + migration-seed consistency.

Runs on SQLite (the catalogue table is non-spatial). Verifies the Phase 1A
registry is internally consistent, that it presents no planned layer as
implemented, and that the self-contained Alembic 0017 seed snapshot never
diverges from the canonical ``registry_seed_rows()``.

This is a foundation-only guard: it asserts the catalogue *metadata* is honest.
It does not (and must not) exercise any scoring, calculation, or ingestion —
none exists in Phase 1A.
"""

import importlib.util
from pathlib import Path

from waste_equity_backend.environment import (
    ENVIRONMENTAL_LAYER_REGISTRY,
    LayerLifecycle,
    LayerModality,
    ReadinessRecommendation,
    VerificationStatus,
    get_layer,
    layer_names,
    layers_by_lifecycle,
    registry_seed_rows,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260723_0017_environmental_layer_registry.py"
)

# The four datasets that already exist in the platform and are only reused.
_IMPLEMENTED_REUSE = {"admin_boundary", "zoning", "road_centerline", "protected_area"}


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("_env_registry_migration_0017", _MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_registry_has_fifteen_unique_layers() -> None:
    names = layer_names()
    assert len(names) == 15
    assert len(set(names)) == 15  # no duplicate machine names


def test_every_field_uses_a_valid_enum_value() -> None:
    for spec in ENVIRONMENTAL_LAYER_REGISTRY:
        assert isinstance(spec.modality, LayerModality)
        assert isinstance(spec.lifecycle, LayerLifecycle)
        assert isinstance(spec.recommendation, ReadinessRecommendation)
        assert isinstance(spec.verification, VerificationStatus)
        assert spec.storage_crs == "EPSG:4326"
        assert spec.target_phase in {"reuse", "1B", "1C"}


def test_only_the_reuse_layers_are_implemented() -> None:
    # A planned/future/experimental layer must never be presented as implemented.
    implemented = {s.layer_name for s in layers_by_lifecycle(LayerLifecycle.IMPLEMENTED)}
    assert implemented == _IMPLEMENTED_REUSE
    for spec in ENVIRONMENTAL_LAYER_REGISTRY:
        if spec.lifecycle is LayerLifecycle.IMPLEMENTED:
            assert spec.target_phase == "reuse"
        else:
            assert spec.target_phase in {"1B", "1C"}


def test_experimental_layers_are_not_go() -> None:
    # Flood hazard and faults are licence/availability-blocked → never a GO.
    for spec in layers_by_lifecycle(LayerLifecycle.EXPERIMENTAL):
        assert spec.recommendation is ReadinessRecommendation.NO_GO


def test_no_layer_is_a_bare_go_unless_already_verified() -> None:
    # A plain GO recommendation is reserved for the live-verified reuse layers;
    # every newly-planned layer is CONDITIONAL_GO or NO_GO (honest readiness).
    for spec in ENVIRONMENTAL_LAYER_REGISTRY:
        if spec.recommendation is ReadinessRecommendation.GO:
            assert spec.verification is VerificationStatus.LIVE_VERIFIED
            assert spec.lifecycle is LayerLifecycle.IMPLEMENTED


def test_get_layer_resolves_and_rejects() -> None:
    spec = get_layer("dem_slope")
    assert spec.korean_label == "수치표고·경사"
    assert spec.lifecycle is LayerLifecycle.PLANNED
    try:
        get_layer("does_not_exist")
    except KeyError:
        pass
    else:  # pragma: no cover - the call above must raise
        raise AssertionError("get_layer should raise KeyError for an unknown layer")


def test_migration_seed_matches_registry_seed_rows() -> None:
    migration = _load_migration()
    columns: tuple[str, ...] = migration._SEED_COLUMNS  # type: ignore[attr-defined]
    raw_rows: tuple[tuple[str, ...], ...] = migration._SEED_ROWS  # type: ignore[attr-defined]
    migration_rows = [dict(zip(columns, values, strict=True)) for values in raw_rows]
    assert migration_rows == registry_seed_rows()


def test_migration_seed_helper_stamps_created_at() -> None:
    migration = _load_migration()
    rows = migration._seed_rows()  # type: ignore[attr-defined]
    assert len(rows) == 15
    for row in rows:
        assert "created_at" in row
        # Every catalogue column is present (created_at is added on top).
        assert set(row) == set(registry_seed_rows()[0]) | {"created_at"}
