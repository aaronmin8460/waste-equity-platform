"""PostGIS migration tests for the candidate-cell statistics schema (0020).

Requires ``TEST_DATABASE_URL``. Verifies that migration 0020:

* is purely **additive** — it creates exactly three new tables and alters no
  existing table, column, constraint, or row;
* carries the identity and index design the derivation depends on (the
  ``input_signature`` unique constraint, the *partial* one-active-release unique
  index, and the per-cell / per-class uniqueness);
* adds **no** score, weight, rank, exclusion, candidate-status, or policy column,
  and **no** geometry column or spatial index (the cell geometry stays on
  ``suitability_candidates``);
* is reversible (upgrade → downgrade → upgrade) leaving every pre-existing
  land-cover, wetland, and suitability row untouched.

Never point this at the loaded development database: it downgrades and re-upgrades.
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

_STAT_VERSIONS = "environmental_land_cover_cell_stat_versions"
_CELL_STATS = "environmental_land_cover_cell_statistics"
_CLASS_AREAS = "environmental_land_cover_cell_class_areas"
_NEW_TABLES = {_STAT_VERSIONS, _CELL_STATS, _CLASS_AREAS}

#: Tables whose rows must survive the migration round-trip untouched.
_PRESERVED_TABLES = (
    "environmental_land_cover_features",
    "environmental_land_cover_map_sheets",
    "environmental_wetland_inventory_features",
    "environmental_dataset_versions",
    "suitability_analysis_runs",
    "suitability_candidates",
    "structural_features",
    "structural_dataset_versions",
)

#: No derived-statistics column may name a scoring concept.
_FORBIDDEN_COLUMN_TOKENS = ("score", "weight", "rank", "exclusion", "penalt", "policy", "eligib")


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


def _table_snapshot(engine: Engine) -> dict[str, int]:
    counts: dict[str, int] = {}
    with engine.connect() as connection:
        existing = set(inspect(engine).get_table_names())
        for table in _PRESERVED_TABLES:
            if table in existing:
                counts[table] = int(
                    connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()  # noqa: S608
                )
    return counts


def test_head_is_single_and_includes_0020() -> None:
    _upgrade()
    script = ScriptDirectory.from_config(_config())
    assert script.get_current_head() == "0020"
    revisions = {s.revision for s in script.walk_revisions()}
    assert {"0020", "0019", "0018"}.issubset(revisions)


def test_cell_statistics_schema_is_created(engine: Engine) -> None:
    _upgrade()
    inspector = inspect(engine)
    assert _NEW_TABLES.issubset(set(inspector.get_table_names()))

    with engine.connect() as connection:
        # --- release identity ------------------------------------------------
        version_constraints = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE conrelid = "
                    f"'{_STAT_VERSIONS}'::regclass AND contype = 'u'"
                )
            ).scalars()
        )
        assert version_constraints == {"uq_land_cover_cell_stat_versions_signature"}

        # The one-active-release guard must be PARTIAL, so superseded and failed
        # releases are preserved rather than blocked or deleted.
        active_index = connection.execute(
            text(
                "SELECT indexdef FROM pg_indexes WHERE indexname = "
                "'uq_land_cover_cell_stat_versions_active'"
            )
        ).scalar_one()
        assert "UNIQUE" in active_index
        assert "WHERE is_active" in active_index

        # --- per-cell and per-class identity ---------------------------------
        cell_constraints = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE conrelid = "
                    f"'{_CELL_STATS}'::regclass AND contype = 'u'"
                )
            ).scalars()
        )
        assert cell_constraints == {"uq_land_cover_cell_statistics_version_key"}
        class_constraints = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE conrelid = "
                    f"'{_CLASS_AREAS}'::regclass AND contype = 'u'"
                )
            ).scalars()
        )
        assert class_constraints == {"uq_land_cover_cell_class_areas_cell_level_code"}

        # --- lookup indexes the derivation and later reads depend on ----------
        cell_indexes = set(
            connection.execute(
                text(f"SELECT indexname FROM pg_indexes WHERE tablename = '{_CELL_STATS}'")
            ).scalars()
        )
        assert {
            "ix_land_cover_cell_statistics_candidate_key",
            "ix_land_cover_cell_statistics_grid_version",
            "ix_land_cover_cell_statistics_sido",
            "ix_land_cover_cell_statistics_version_status",
            "ix_land_cover_cell_statistics_version_dominant_l1",
        }.issubset(cell_indexes)

        # --- no geometry stored → no spatial index anywhere -------------------
        for table in _NEW_TABLES:
            geometry_columns = connection.execute(
                text("SELECT count(*) FROM geometry_columns WHERE f_table_name = :t"),
                {"t": table},
            ).scalar_one()
            assert geometry_columns == 0, table
            spatial = connection.execute(
                text(
                    "SELECT count(*) FROM pg_indexes WHERE tablename = :t "
                    "AND indexdef ILIKE '%gist%'"
                ),
                {"t": table},
            ).scalar_one()
            assert spatial == 0, table

        # --- no scoring surface ----------------------------------------------
        for table in _NEW_TABLES:
            columns = [
                str(row[0])
                for row in connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
                    ),
                    {"t": table},
                ).all()
            ]
            assert columns
            for column in columns:
                # ``coverage_status`` is a land-cover coverage label, never a
                # candidate status.
                if column == "coverage_status":
                    continue
                assert not any(token in column for token in _FORBIDDEN_COLUMN_TOKENS), (
                    f"{table}.{column}"
                )

        # --- the derived release must not be tied to one analysis run ---------
        foreign_keys = set(
            connection.execute(
                text(
                    "SELECT confrelid::regclass::text FROM pg_constraint "
                    f"WHERE conrelid = '{_STAT_VERSIONS}'::regclass AND contype = 'f'"
                )
            ).scalars()
        )
        assert "suitability_analysis_runs" not in foreign_keys
        assert "suitability_candidates" not in foreign_keys


def test_migration_is_additive_only(engine: Engine) -> None:
    """0019 → 0020 adds three tables and changes nothing that already existed."""

    _upgrade()
    _downgrade("0019")
    before_tables = set(inspect(engine).get_table_names())
    before_columns = _column_map(engine, before_tables)

    _upgrade("0020")
    after_tables = set(inspect(engine).get_table_names())
    assert after_tables - before_tables == _NEW_TABLES
    assert before_tables - after_tables == set()

    after_columns = _column_map(engine, before_tables)
    assert after_columns == before_columns


def _column_map(engine: Engine, tables: set[str]) -> dict[str, list[tuple[str, str, str]]]:
    result: dict[str, list[tuple[str, str, str]]] = {}
    with engine.connect() as connection:
        for table in sorted(tables):
            rows = connection.execute(
                text(
                    "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                    "WHERE table_name = :t ORDER BY column_name"
                ),
                {"t": table},
            ).all()
            result[table] = [(str(r[0]), str(r[1]), str(r[2])) for r in rows]
    return result


def test_upgrade_downgrade_upgrade_round_trip_preserves_existing_rows(engine: Engine) -> None:
    _upgrade()
    before = _table_snapshot(engine)

    _downgrade("0019")
    inspector = inspect(engine)
    assert _NEW_TABLES.isdisjoint(set(inspector.get_table_names()))
    # Downgrade removes ONLY this phase's objects.
    assert _table_snapshot(engine) == before

    _upgrade("0020")
    assert _NEW_TABLES.issubset(set(inspect(engine).get_table_names()))
    assert _table_snapshot(engine) == before

    # The migration seeds nothing: every derived row comes from the CLI.
    with engine.connect() as connection:
        for table in _NEW_TABLES:
            assert (
                connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0  # noqa: S608
            )
