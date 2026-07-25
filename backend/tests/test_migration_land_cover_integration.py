"""PostGIS migration tests for the land-cover foundation (0019).

Requires TEST_DATABASE_URL. Verifies that migration 0019:

* adds the land-cover tables/constraints/indexes and the ``egis_land_cover``
  source, with no score column and no cross-link to a suitability table;
* relaxes ``environmental_dataset_versions.reference_date`` to NULLABLE, adds the
  NOT-NULL ``reference_period``, and re-keys the release identity onto
  ``reference_period`` — while preserving every existing (wetland) row's
  ``reference_date`` and backfilling its ``reference_period`` deterministically;
* is reversible (upgrade → downgrade → upgrade) with the existing rows intact.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

_LAND_COVER_TABLES = {
    "environmental_land_cover_map_sheets",
    "environmental_land_cover_features",
}


def _config() -> Config:
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    return config


def _run(command_fn: object, revision: str) -> None:

    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings

    get_settings.cache_clear()
    command_fn(_config(), revision)  # type: ignore[operator]


def _upgrade(revision: str = "head") -> None:
    from alembic import command

    _run(command.upgrade, revision)


def _downgrade(revision: str) -> None:
    from alembic import command

    _run(command.downgrade, revision)


@pytest.fixture
def engine() -> Engine:
    assert TEST_DATABASE_URL
    return create_engine(TEST_DATABASE_URL)


def test_head_is_single_and_includes_0019() -> None:
    _upgrade()
    script = ScriptDirectory.from_config(_config())
    assert script.get_current_head() == "0019"
    revisions = {s.revision for s in script.walk_revisions()}
    assert "0019" in revisions
    assert "0018" in revisions


def test_land_cover_schema_is_created(engine: Engine) -> None:
    _upgrade()
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert _LAND_COVER_TABLES.issubset(tables)

        with engine.connect() as connection:
            geometry_type = connection.execute(
                text(
                    "SELECT type FROM geometry_columns WHERE "
                    "f_table_name = 'environmental_land_cover_features' "
                    "AND f_geometry_column = 'geometry'"
                )
            ).scalar()
            assert geometry_type == "MULTIPOLYGON"
            srid = connection.execute(
                text(
                    "SELECT srid FROM geometry_columns WHERE "
                    "f_table_name = 'environmental_land_cover_features'"
                )
            ).scalar()
            assert srid == 4326

            constraints = set(
                connection.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid = "
                        "'environmental_land_cover_features'::regclass AND contype = 'u'"
                    )
                ).scalars()
            )
            assert constraints == {
                "uq_land_cover_features_version_sheet_record",
                "uq_land_cover_features_version_fingerprint",
            }

            sheet_constraints = set(
                connection.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid = "
                        "'environmental_land_cover_map_sheets'::regclass AND contype = 'u'"
                    )
                ).scalars()
            )
            assert sheet_constraints == {"uq_land_cover_map_sheets_version_sheet"}

            indexes = set(
                connection.execute(
                    text(
                        "SELECT indexname FROM pg_indexes WHERE tablename = "
                        "'environmental_land_cover_features'"
                    )
                ).scalars()
            )
            assert "ix_land_cover_features_l3_code" in indexes
            spatial = connection.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE tablename = "
                    "'environmental_land_cover_features' AND indexdef LIKE '%gist%'"
                )
            ).scalar()
            assert spatial is not None

            # No score column anywhere in the land-cover tables.
            for table in _LAND_COVER_TABLES:
                columns = set(
                    connection.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns "
                            "WHERE table_name = :t"
                        ),
                        {"t": table},
                    ).scalars()
                )
                assert not any("score" in column for column in columns)

            # No FK from land-cover features to any suitability/structural table.
            cross_links = connection.execute(
                text(
                    """
                    SELECT count(*) FROM information_schema.table_constraints tc
                    JOIN information_schema.constraint_column_usage ccu
                      ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_name = 'environmental_land_cover_features'
                      AND (ccu.table_name LIKE 'suitability%' OR ccu.table_name LIKE 'structural%')
                    """
                )
            ).scalar()
            assert cross_links == 0

            source = connection.execute(
                text("SELECT source_id FROM data_sources WHERE source_id = 'egis_land_cover'")
            ).scalar()
            assert source == "egis_land_cover"
    finally:
        engine.dispose()


def test_reference_period_column_and_nullable_reference_date(engine: Engine) -> None:
    _upgrade()
    try:
        with engine.connect() as connection:
            cols = dict(
                connection.execute(
                    text(
                        "SELECT column_name, is_nullable FROM information_schema.columns "
                        "WHERE table_name = 'environmental_dataset_versions' "
                        "AND column_name IN ('reference_period', 'reference_date')"
                    )
                ).all()
            )
            assert cols["reference_period"] == "NO"
            assert cols["reference_date"] == "YES"

            release_uq = connection.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conname = 'uq_environmental_dataset_versions_release'"
                )
            ).scalar()
            assert release_uq is not None
            assert "reference_period" in release_uq
            assert "reference_date" not in release_uq
    finally:
        engine.dispose()


def test_round_trip_preserves_and_backfills_existing_rows(engine: Engine) -> None:
    """downgrade → seed a wetland-style row → upgrade backfills reference_period.

    The existing row's reference_date is preserved exactly and its
    reference_period is backfilled from it; the round-trip leaves the DB at head.
    """

    _upgrade()
    _downgrade("0018")
    marker = "MIGTEST-LC-0019"
    try:
        with engine.begin() as connection:
            # At 0018 there is no reference_period column; reference_date is NOT NULL.
            connection.execute(
                text(
                    "INSERT INTO environmental_dataset_versions "
                    "(layer_name, source_id, provider, official_dataset_name, "
                    "provider_dataset_identifier, reference_date, source_checksum, source_crs, "
                    "target_crs, normalized_geometry_type, transformation_version, is_active, "
                    "created_at) VALUES ('wetland_inventory', 'nie_wetland_inventory', 'p', 'd', "
                    ":pid, DATE '2022-07-20', :ck, 'EPSG:5186', 'EPSG:4326', 'MultiPolygon', "
                    "'wetland-inventory-v1', true, now())"
                ),
                {"pid": marker, "ck": "migtest-lc-checksum"},
            )

        _upgrade()

        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT reference_period, reference_date::text AS d "
                    "FROM environmental_dataset_versions WHERE provider_dataset_identifier = :pid"
                ),
                {"pid": marker},
            ).one()
            assert row.reference_period == "2022-07-20"
            assert row.d == "2022-07-20"
    finally:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "DELETE FROM environmental_dataset_versions "
                    "WHERE provider_dataset_identifier = :pid"
                ),
                {"pid": marker},
            )
        _upgrade()
        engine.dispose()


def test_existing_wetland_features_survive_the_migration(engine: Engine) -> None:
    """The wetland feature/version tables are untouched by 0019 (additive)."""

    _upgrade()
    try:
        with engine.connect() as connection:
            # Tables still present and reachable after 0019.
            for table in (
                "environmental_wetland_inventory_features",
                "environmental_dataset_versions",
            ):
                exists = connection.execute(text("SELECT to_regclass(:t)"), {"t": table}).scalar()
                assert exists is not None
    finally:
        engine.dispose()


def test_migration_is_idempotent_at_head() -> None:
    _upgrade()
    _upgrade()
