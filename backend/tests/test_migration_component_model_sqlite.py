"""Migrations 0022/0023 applied to a seeded pre-migration database (SQLite).

The proof obligation is narrow and specific: adding component-model identity and
the version-aware component-score map must **label** existing rows and change
nothing else. Every stored analytical value — score, rank, status, profile totals
and ranks, stability class, reasons — is captured before the upgrade and compared
byte-for-byte after it, and again after the downgrade.

SQLite is used because it is the tier that always runs; the PostGIS equivalent
lives in ``test_migration_component_model_integration.py`` and additionally proves
the JSONB server defaults. Both migrations are pure ``ADD COLUMN`` / ``DROP
COLUMN`` with constant defaults, which SQLite ≥ 3.35 supports natively, so the same
operations are exercised here that run in production.

Nothing in this module touches a production database: every table is created in a
throwaway in-memory SQLite database.
"""

from __future__ import annotations

import datetime
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from geoalchemy2 import Geometry
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.pool import StaticPool

from waste_equity_backend.analysis.suitability import component_model
from waste_equity_backend.models.suitability import (
    SuitabilityAnalysisRun,
    SuitabilityCandidate,
)

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_0022 = VERSIONS_DIR / "20260816_0022_suitability_component_model_identity.py"
MIGRATION_0023 = VERSIONS_DIR / "20260816_0023_suitability_candidate_component_scores.py"

# The columns this work adds; everything else must be present before and after.
ADDED_RUN_COLUMNS = ("component_model_version", "component_order")
ADDED_CANDIDATE_COLUMNS = ("component_scores",)

NOW = datetime.datetime(2026, 3, 1, tzinfo=datetime.UTC)


def _load_migration(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pre_migration_table(
    table: sa.Table, metadata: sa.MetaData, exclude: tuple[str, ...]
) -> sa.Table:
    """A copy of a mapped table as it stood before this work's migrations.

    Drops the columns the migrations add, and substitutes plain text for the
    PostGIS geometry columns so the pre-migration shape is creatable on SQLite. The
    geometry substitution is irrelevant to what is being proved: neither migration
    reads, writes, or references a geometry column.
    """

    columns = []
    for column in table.columns:
        if column.name in exclude:
            continue
        copied = column._copy()
        if isinstance(column.type, Geometry):
            copied.type = sa.Text()
        columns.append(copied)
    return sa.Table(table.name, metadata, *columns)


@pytest.fixture
def pre_migration_engine() -> Any:
    """An in-memory SQLite database holding the pre-0022 suitability schema."""

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    metadata = sa.MetaData()
    _pre_migration_table(SuitabilityAnalysisRun.__table__, metadata, ADDED_RUN_COLUMNS)
    _pre_migration_table(SuitabilityCandidate.__table__, metadata, ADDED_CANDIDATE_COLUMNS)
    metadata.create_all(engine)
    with engine.begin() as connection:
        _seed(connection)
    yield engine
    engine.dispose()


def _seed(connection: Connection) -> None:
    """One succeeded run and three candidates with distinct analytical outcomes."""

    connection.execute(
        text(
            """
            INSERT INTO suitability_analysis_runs (
                id, derivation_version, policy_version, candidate_grid_version,
                reference_year, boundary_vintage, weight_profile, analysis_signature,
                status, candidate_count_total, candidate_count_eligible,
                candidate_count_review, candidate_count_excluded,
                input_dataset_version_ids, input_provenance, policy_snapshot,
                weight_profiles, weight_derivation, stability_definition,
                started_at, completed_at, created_at
            ) VALUES (
                1, 'suitability-screening-v3', 'suitability-policy-v2',
                'capital-grid-500m-v1', 2024, '2024', 'baseline', 'seeded-signature',
                'SUCCEEDED', 3, 1, 1, 1,
                '[7]', '{}', '{}', '{"baseline": {"zoning": "0.35"}}', '{}', '{}',
                :now, :now, :now
            )
            """
        ),
        {"now": NOW},
    )
    rows = [
        {
            "id": 10,
            "candidate_key": "capital-grid-500m-v1:100_200",
            "status": "ELIGIBLE",
            "rank": 1,
            "provisional_score": None,
            "total_score": "70.2500",
            "zoning_score": "55.0000",
            "road_score": "100.0000",
            "equity_score": "80.0000",
            "demand_score": "40.0000",
            "profile_totals": '{"baseline": "70.2500"}',
            "profile_ranks": '{"baseline": 1}',
            "stable_count": 3,
            "stability_class": "STABLE",
            "exclusion_reasons": "[]",
            "review_reasons": "[]",
        },
        {
            "id": 11,
            "candidate_key": "capital-grid-500m-v1:100_201",
            "status": "REVIEW_REQUIRED",
            "rank": None,
            "provisional_score": "73.7500",
            "total_score": None,
            "zoning_score": "55.0000",
            "road_score": "100.0000",
            "equity_score": None,
            "demand_score": None,
            "profile_totals": '{"baseline": "73.7500"}',
            "profile_ranks": "{}",
            "stable_count": None,
            "stability_class": None,
            "exclusion_reasons": "[]",
            "review_reasons": '["MISSING_EQUITY_COMPONENT"]',
        },
        {
            "id": 12,
            "candidate_key": "capital-grid-500m-v1:100_202",
            "status": "EXCLUDED",
            "rank": None,
            "provisional_score": None,
            "total_score": None,
            "zoning_score": None,
            "road_score": None,
            "equity_score": None,
            "demand_score": None,
            "profile_totals": "{}",
            "profile_ranks": "{}",
            "stable_count": None,
            "stability_class": None,
            "exclusion_reasons": '["UD801"]',
            "review_reasons": "[]",
        },
    ]
    for row in rows:
        connection.execute(
            text(
                """
                INSERT INTO suitability_candidates (
                    id, analysis_run_id, candidate_key, sido_region_code, sido_region_name,
                    sigungu_region_code, sigungu_region_name, status, rank,
                    provisional_score, total_score, zoning_score, road_score, equity_score,
                    demand_score, profile_totals, profile_ranks, stable_count,
                    stability_class, stability_membership, raw_components,
                    exclusion_reasons, review_reasons, penalties, nearest_road_distance_m,
                    nearest_road_provenance, component_provenance, original_area_m2,
                    clipped_area_m2, clipped_area_ratio, centroid, geometry, created_at
                ) VALUES (
                    :id, 1, :candidate_key, 'KR-SGIS-11', '서울특별시',
                    'KR-SGIS-11010', '종로구', :status, :rank,
                    :provisional_score, :total_score, :zoning_score, :road_score,
                    :equity_score, :demand_score, :profile_totals, :profile_ranks,
                    :stable_count, :stability_class, '{}', '{}',
                    :exclusion_reasons, :review_reasons, '[]', '250.000',
                    '{}', '{}', '250000.00', '250000.00', '1.00000',
                    'POINT', 'MULTIPOLYGON', :now
                )
                """
            ),
            {**row, "now": NOW},
        )


_ANALYTICAL_COLUMNS = (
    "id, analysis_run_id, candidate_key, status, rank, provisional_score, total_score, "
    "zoning_score, road_score, equity_score, demand_score, profile_totals, profile_ranks, "
    "stable_count, stability_class, exclusion_reasons, review_reasons, "
    "original_area_m2, clipped_area_m2, clipped_area_ratio"
)


def _analytical_snapshot(connection: Connection) -> list[dict[str, Any]]:
    """Every stored analytical value, in a stable order, for exact comparison."""

    return [
        dict(row)
        for row in connection.execute(
            text(f"SELECT {_ANALYTICAL_COLUMNS} FROM suitability_candidates ORDER BY id")
        ).mappings()
    ]


def _run_snapshot(connection: Connection) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                "SELECT id, derivation_version, policy_version, candidate_grid_version, "
                "reference_year, weight_profile, analysis_signature, status, "
                "candidate_count_total, candidate_count_eligible, candidate_count_review, "
                "candidate_count_excluded, weight_profiles, weight_derivation, "
                "stability_definition FROM suitability_analysis_runs ORDER BY id"
            )
        ).mappings()
    ]


def _apply(connection: Connection, module: Any, direction: str) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(module, direction)()


def _column_names(connection: Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(text(f"PRAGMA table_info({table})"))}


# --------------------------------------------------------------------------- #
# Upgrade
# --------------------------------------------------------------------------- #


def test_upgrade_adds_only_the_three_columns(pre_migration_engine: Any) -> None:
    with pre_migration_engine.begin() as connection:
        before_run_columns = _column_names(connection, "suitability_analysis_runs")
        before_candidate_columns = _column_names(connection, "suitability_candidates")
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        after_run_columns = _column_names(connection, "suitability_analysis_runs")
        after_candidate_columns = _column_names(connection, "suitability_candidates")

    assert after_run_columns - before_run_columns == set(ADDED_RUN_COLUMNS)
    assert after_candidate_columns - before_candidate_columns == set(ADDED_CANDIDATE_COLUMNS)
    # Nothing was renamed or dropped — the four legacy score columns above all.
    assert before_run_columns <= after_run_columns
    assert before_candidate_columns <= after_candidate_columns


def test_upgrade_changes_no_stored_analytical_value(pre_migration_engine: Any) -> None:
    """The migration is labelling. No score, rank, status, or reason may move."""

    with pre_migration_engine.begin() as connection:
        candidates_before = _analytical_snapshot(connection)
        runs_before = _run_snapshot(connection)
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        assert _analytical_snapshot(connection) == candidates_before
        assert _run_snapshot(connection) == runs_before


def test_existing_runs_are_labelled_with_the_historical_component_model(
    pre_migration_engine: Any,
) -> None:
    with pre_migration_engine.begin() as connection:
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        row = (
            connection.execute(
                text(
                    "SELECT component_model_version, component_order "
                    "FROM suitability_analysis_runs WHERE id = 1"
                )
            )
            .mappings()
            .first()
        )
    assert row is not None
    assert row["component_model_version"] == component_model.COMPONENT_MODEL_HISTORICAL
    # Order is stored explicitly, not inferred from a JSON object's key order.
    assert json.loads(row["component_order"]) == list(
        component_model.COMPONENT_ORDER_HISTORICAL
    )


def test_the_stored_label_validates_against_the_application_registry(
    pre_migration_engine: Any,
) -> None:
    """The DDL default and the running application must agree about what a row is."""

    with pre_migration_engine.begin() as connection:
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        row = (
            connection.execute(
                text(
                    "SELECT component_model_version, component_order "
                    "FROM suitability_analysis_runs WHERE id = 1"
                )
            )
            .mappings()
            .first()
        )
    assert row is not None
    version, order = component_model.run_model_identity(row)
    assert version == component_model.COMPONENT_MODEL_HISTORICAL
    assert order == list(component_model.COMPONENT_ORDER_HISTORICAL)


def test_existing_candidates_get_an_empty_component_score_map(
    pre_migration_engine: Any,
) -> None:
    """No historical score is copied in — a second copy of an authoritative value
    can drift from the first, and an empty map is what "not this model" means."""

    with pre_migration_engine.begin() as connection:
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        stored = connection.execute(
            text("SELECT component_scores FROM suitability_candidates ORDER BY id")
        ).scalars()
        assert [json.loads(value) for value in stored] == [{}, {}, {}]


def test_the_upgraded_schema_needs_no_further_migration(pre_migration_engine: Any) -> None:
    """After both upgrades the physical schema carries every mapped column.

    A missing column here would mean the application silently required another
    migration to be written before it could read its own tables.
    """

    with pre_migration_engine.begin() as connection:
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        run_columns = _column_names(connection, "suitability_analysis_runs")
        candidate_columns = _column_names(connection, "suitability_candidates")

    assert {c.name for c in SuitabilityAnalysisRun.__table__.columns} <= run_columns
    assert {c.name for c in SuitabilityCandidate.__table__.columns} <= candidate_columns


# --------------------------------------------------------------------------- #
# Downgrade
# --------------------------------------------------------------------------- #


def test_downgrade_removes_the_columns_and_restores_the_original_shape(
    pre_migration_engine: Any,
) -> None:
    with pre_migration_engine.begin() as connection:
        before_run_columns = _column_names(connection, "suitability_analysis_runs")
        before_candidate_columns = _column_names(connection, "suitability_candidates")
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "downgrade")
        _apply(connection, _load_migration(MIGRATION_0022), "downgrade")
        assert _column_names(connection, "suitability_analysis_runs") == before_run_columns
        assert _column_names(connection, "suitability_candidates") == before_candidate_columns


def test_downgrade_leaves_every_historical_value_intact(pre_migration_engine: Any) -> None:
    """Rolling back is inert for historical runs under all conditions.

    (It is only unsafe once a run of a non-historical component model exists, whose
    legacy columns are NULL and hold nothing to fall back on — the constraint stated
    in migration 0023's docstring. No such run can be produced today.)
    """

    with pre_migration_engine.begin() as connection:
        candidates_before = _analytical_snapshot(connection)
        runs_before = _run_snapshot(connection)
        _apply(connection, _load_migration(MIGRATION_0022), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "upgrade")
        _apply(connection, _load_migration(MIGRATION_0023), "downgrade")
        _apply(connection, _load_migration(MIGRATION_0022), "downgrade")
        assert _analytical_snapshot(connection) == candidates_before
        assert _run_snapshot(connection) == runs_before


def test_the_migrations_declare_a_linear_chain_from_the_previous_head() -> None:
    m22 = _load_migration(MIGRATION_0022)
    m23 = _load_migration(MIGRATION_0023)
    assert (m22.revision, m22.down_revision) == ("0022", "0021")
    assert (m23.revision, m23.down_revision) == ("0023", "0022")
