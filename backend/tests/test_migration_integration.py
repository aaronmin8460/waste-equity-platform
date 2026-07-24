"""Migration integration test against a real PostGIS database.

Runs only when TEST_DATABASE_URL is set (for example the docker compose
database). Applies the migration chain and verifies the schema and seeds.
"""

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

EXPECTED_TABLES = {
    "regions",
    "region_code_map",
    "data_sources",
    "ingestion_runs",
    "dataset_freshness",
    "raw_api_responses",
    "regional_population",
    "regional_waste_statistics",
    "waste_treatment_facilities",
    "structural_dataset_versions",
    "structural_features",
    "structural_line_features",
    "structural_protected_features",
    "suitability_analysis_runs",
    "suitability_candidates",
    "environmental_layer_registry",
    "environmental_dataset_versions",
    "environmental_wetland_inventory_features",
}
EXPECTED_SOURCE_IDS = {"waste_statistics", "sgis", "airkorea", "kma", "vworld"}


def _run_alembic_upgrade() -> None:
    from alembic.config import Config

    from alembic import command

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    # Settings are cached per process; reset so alembic env sees the URL.
    from waste_equity_backend.config import get_settings

    get_settings.cache_clear()
    command.upgrade(config, "head")


def test_migration_creates_schema_and_seeds() -> None:
    _run_alembic_upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert EXPECTED_TABLES.issubset(tables)

        with engine.connect() as connection:
            postgis = connection.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
            ).scalar()
            assert postgis == "postgis"

            source_ids = set(
                connection.execute(text("SELECT source_id FROM data_sources")).scalars()
            )
            assert EXPECTED_SOURCE_IDS.issubset(source_ids)

            geometry_type = connection.execute(
                text(
                    "SELECT type FROM geometry_columns "
                    "WHERE f_table_name = 'regions' AND f_geometry_column = 'geometry'"
                )
            ).scalar()
            assert geometry_type == "MULTIPOLYGON"

            # Migration 0014 replaced the table-wide annual unique constraint
            # with two granularity-scoped partial unique indexes: the annual
            # guarantee is unchanged in strength, while a monthly series (twelve
            # rows sharing a reference_year) is now representable.
            population_unique = set(
                connection.execute(
                    text(
                        "SELECT indexname FROM pg_indexes "
                        "WHERE tablename = 'regional_population' AND indexname IN "
                        "('uq_regional_population_annual', 'uq_regional_population_monthly')"
                    )
                ).scalars()
            )
            assert population_unique == {
                "uq_regional_population_annual",
                "uq_regional_population_monthly",
            }
            legacy_unique = connection.execute(
                text(
                    "SELECT 1 FROM pg_constraint WHERE conname = 'uq_regional_population_region_id'"
                )
            ).scalar()
            assert legacy_unique is None

            # Migration 0016 added CRITIC/stability metadata columns + indexes.
            run_cols = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'suitability_analysis_runs'"
                    )
                ).scalars()
            )
            assert {"weight_derivation", "stability_definition"}.issubset(run_cols)
            cand_cols = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'suitability_candidates'"
                    )
                ).scalars()
            )
            assert {"stable_count", "stability_class", "stability_membership"}.issubset(cand_cols)
            stability_indexes = set(
                connection.execute(
                    text(
                        "SELECT indexname FROM pg_indexes "
                        "WHERE tablename = 'suitability_candidates' AND indexname IN "
                        "('ix_suitability_candidates_run_stable', "
                        "'ix_suitability_candidates_run_stability_class')"
                    )
                ).scalars()
            )
            assert stability_indexes == {
                "ix_suitability_candidates_run_stable",
                "ix_suitability_candidates_run_stability_class",
            }
    finally:
        engine.dispose()


def test_migration_creates_wetland_inventory_schema() -> None:
    """Migration 0018 adds the wetland tables, their constraints and indexes."""

    _run_alembic_upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            geometry_type = connection.execute(
                text(
                    "SELECT type FROM geometry_columns WHERE "
                    "f_table_name = 'environmental_wetland_inventory_features' "
                    "AND f_geometry_column = 'geometry'"
                )
            ).scalar()
            assert geometry_type == "MULTIPOLYGON"
            srid = connection.execute(
                text(
                    "SELECT srid FROM geometry_columns WHERE "
                    "f_table_name = 'environmental_wetland_inventory_features'"
                )
            ).scalar()
            assert srid == 4326

            constraints = set(
                connection.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid = "
                        "'environmental_wetland_inventory_features'::regclass "
                        "AND contype = 'u'"
                    )
                ).scalars()
            )
            assert constraints == {
                "uq_wetland_inventory_features_version_source_id",
                "uq_wetland_inventory_features_version_fingerprint",
            }

            indexes = set(
                connection.execute(
                    text(
                        "SELECT indexname FROM pg_indexes WHERE tablename = "
                        "'environmental_wetland_inventory_features'"
                    )
                ).scalars()
            )
            # Ordinary lookup indexes plus the automatic GIST spatial index.
            assert {
                "ix_environmental_wetland_inventory_features_source_feature_id",
                "ix_environmental_wetland_inventory_features_wetland_code",
                "ix_environmental_wetland_inventory_features_dataset_version_id",
                "ix_wetland_inventory_features_source_sido",
                "ix_wetland_inventory_features_source_sigungu",
            }.issubset(indexes)
            spatial = connection.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE tablename = "
                    "'environmental_wetland_inventory_features' "
                    "AND indexdef LIKE '%gist%'"
                )
            ).scalar()
            assert spatial is not None

            # The release table is reachable and carries no score column.
            version_cols = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'environmental_dataset_versions'"
                    )
                ).scalars()
            )
            assert {"source_checksum", "transformation_version", "reference_date"}.issubset(
                version_cols
            )
            feature_cols = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'environmental_wetland_inventory_features'"
                    )
                ).scalars()
            )
            assert not any("score" in column for column in feature_cols)

            # The inventory must not be wired to the statutory UM901 layer.
            cross_links = connection.execute(
                text(
                    """
                    SELECT count(*) FROM information_schema.table_constraints tc
                    JOIN information_schema.constraint_column_usage ccu
                      ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_name = 'environmental_wetland_inventory_features'
                      AND ccu.table_name LIKE 'structural%'
                    """
                )
            ).scalar()
            assert cross_links == 0
    finally:
        engine.dispose()


def test_migration_is_idempotent_at_head() -> None:
    # Upgrading an already-migrated database must be a no-op, not an error.
    _run_alembic_upgrade()
    _run_alembic_upgrade()
