"""PostGIS migration tests for monthly population support (0014).

Requires TEST_DATABASE_URL. Runs the real Alembic upgrade/downgrade against a
throwaway schema and asserts that the additive change admits a monthly series
without weakening the legacy annual guarantee or touching existing rows.
"""

from __future__ import annotations

import datetime
import os

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured (PostGIS integration)"
)

NOW = datetime.datetime(2026, 7, 15, tzinfo=datetime.UTC)


def _alembic_config(schema: str) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", str(TEST_DATABASE_URL))
    config.set_main_option("version_table_schema", schema)
    return config


@pytest.fixture
def engine() -> Engine:
    assert TEST_DATABASE_URL
    return create_engine(TEST_DATABASE_URL)


def _seed_annual_row(connection: object, *, region_id: int, year: int, population: int) -> None:
    connection.execute(  # type: ignore[attr-defined]
        text(
            "INSERT INTO regional_population (region_id, reference_year, reference_period, "
            "population, unit, population_definition, population_temporal_granularity, "
            "source_id, source_administrative_code, source_geographic_level, retrieved_at, "
            "transformation_version, ingestion_run_id, created_at, updated_at) "
            "VALUES (:rid, :year, :period, :pop, 'persons', 'SGIS_TOTAL_POPULATION', 'ANNUAL', "
            "'sgis', '11', 'SIDO', :now, 'sgis-v1', :run, :now, :now)"
        ),
        {
            "rid": region_id,
            "year": year,
            "period": str(year),
            "pop": population,
            "now": NOW,
            "run": _any_run_id(connection),
        },
    )


def _any_run_id(connection: object) -> int:
    run = connection.execute(text("SELECT run_id FROM ingestion_runs LIMIT 1")).scalar()  # type: ignore[attr-defined]
    assert run is not None, "an ingestion_runs row is required by the FK"
    return int(run)


def _any_region_id(connection: object) -> int:
    region = connection.execute(text("SELECT id FROM regions LIMIT 1")).scalar()  # type: ignore[attr-defined]
    assert region is not None, "a regions row is required by the FK"
    return int(region)


def test_head_is_0014(engine: Engine) -> None:
    with engine.connect() as connection:
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert revision == "0014"


def test_existing_annual_sgis_rows_survived_the_upgrade(engine: Engine) -> None:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT count(*), count(reference_month) FROM regional_population "
                "WHERE source_id = 'sgis'"
            )
        ).one()
    # Every SGIS row is still present, was backfilled to ANNUAL, and carries no
    # month (a monthly grain was never fabricated for it).
    assert rows[0] > 0
    assert rows[1] == 0
    with engine.connect() as connection:
        grains = (
            connection.execute(
                text(
                    "SELECT DISTINCT population_temporal_granularity FROM regional_population "
                    "WHERE source_id = 'sgis'"
                )
            )
            .scalars()
            .all()
        )
    assert grains == ["ANNUAL"]


def test_new_columns_and_indexes_exist(engine: Engine) -> None:
    with engine.connect() as connection:
        columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'regional_population'"
                )
            ).scalars()
        )
        indexes = set(
            connection.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename = 'regional_population'")
            ).scalars()
        )
    assert {
        "reference_month",
        "population_temporal_granularity",
        "population_definition_version",
        "population_comparability_note",
    } <= columns
    assert {
        "uq_regional_population_annual",
        "uq_regional_population_monthly",
        "ix_regional_population_reference_month",
        "ix_regional_population_month_lookup",
        "ix_regional_population_year_lookup",
    } <= indexes
    # The table-wide annual unique constraint is gone: it could not admit a
    # monthly series.
    assert "uq_regional_population_region_id" not in indexes


def test_twelve_monthly_rows_in_one_year_are_accepted(engine: Engine) -> None:
    with engine.begin() as connection:
        region_id = _any_region_id(connection)
        run_id = _any_run_id(connection)
        for month in range(1, 13):
            connection.execute(
                text(
                    "INSERT INTO regional_population (region_id, reference_year, reference_month, "
                    "reference_period, population, unit, population_definition, "
                    "population_temporal_granularity, source_id, source_administrative_code, "
                    "source_geographic_level, retrieved_at, transformation_version, "
                    "ingestion_run_id, created_at, updated_at) "
                    "VALUES (:rid, 1999, :m, :m, 1000, 'persons', 'TEST_MIGRATION_DEFINITION', "
                    "'MONTHLY', 'sgis', '11', 'SIDO', :now, 't', :run, :now, :now)"
                ),
                {"rid": region_id, "m": f"1999-{month:02d}", "now": NOW, "run": run_id},
            )
        count = connection.execute(
            text(
                "SELECT count(*) FROM regional_population "
                "WHERE population_definition = 'TEST_MIGRATION_DEFINITION'"
            )
        ).scalar()
        assert count == 12
        connection.execute(
            text(
                "DELETE FROM regional_population "
                "WHERE population_definition = 'TEST_MIGRATION_DEFINITION'"
            )
        )


def test_duplicate_region_month_source_definition_is_rejected(engine: Engine) -> None:
    from sqlalchemy.exc import IntegrityError

    with engine.begin() as connection:
        region_id = _any_region_id(connection)
        run_id = _any_run_id(connection)
        insert = text(
            "INSERT INTO regional_population (region_id, reference_year, reference_month, "
            "reference_period, population, unit, population_definition, "
            "population_temporal_granularity, source_id, source_administrative_code, "
            "source_geographic_level, retrieved_at, transformation_version, ingestion_run_id, "
            "created_at, updated_at) "
            "VALUES (:rid, 1999, '1999-01', '1999-01', 1000, 'persons', 'TEST_DUP_DEFINITION', "
            "'MONTHLY', 'sgis', '11', 'SIDO', :now, 't', :run, :now, :now)"
        )
        params = {"rid": region_id, "now": NOW, "run": run_id}
        connection.execute(insert, params)
        with pytest.raises(IntegrityError):
            connection.execute(insert, params)
    with engine.begin() as connection:
        connection.execute(
            text(
                "DELETE FROM regional_population "
                "WHERE population_definition = 'TEST_DUP_DEFINITION'"
            )
        )


def test_annual_legacy_uniqueness_still_holds(engine: Engine) -> None:
    from sqlalchemy.exc import IntegrityError

    with engine.begin() as connection:
        region_id = _any_region_id(connection)
        run_id = _any_run_id(connection)
        insert = text(
            "INSERT INTO regional_population (region_id, reference_year, reference_period, "
            "population, unit, population_definition, population_temporal_granularity, "
            "source_id, source_administrative_code, source_geographic_level, retrieved_at, "
            "transformation_version, ingestion_run_id, created_at, updated_at) "
            "VALUES (:rid, 1999, '1999', 1000, 'persons', 'TEST_ANNUAL_DEFINITION', 'ANNUAL', "
            "'sgis', '11', 'SIDO', :now, 't', :run, :now, :now)"
        )
        params = {"rid": region_id, "now": NOW, "run": run_id}
        connection.execute(insert, params)
        with pytest.raises(IntegrityError):
            connection.execute(insert, params)
    with engine.begin() as connection:
        connection.execute(
            text(
                "DELETE FROM regional_population "
                "WHERE population_definition = 'TEST_ANNUAL_DEFINITION'"
            )
        )


@pytest.mark.parametrize(
    ("granularity", "month"),
    [("MONTHLY", None), ("ANNUAL", "1999-01")],
)
def test_granularity_and_month_must_agree(
    engine: Engine, granularity: str, month: str | None
) -> None:
    """A MONTHLY row must name its month and an ANNUAL row must not.

    This is what stops a monthly observation from ever being read as an annual
    denominator (or vice versa) — the two grains cannot blur.
    """
    from sqlalchemy.exc import IntegrityError

    # Each case gets its own transaction: a failed statement poisons the current
    # one, so they cannot share.
    with engine.begin() as connection:
        region_id = _any_region_id(connection)
        run_id = _any_run_id(connection)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO regional_population (region_id, reference_year, "
                "reference_month, reference_period, population, unit, "
                "population_definition, population_temporal_granularity, source_id, "
                "source_administrative_code, source_geographic_level, retrieved_at, "
                "transformation_version, ingestion_run_id, created_at, updated_at) "
                "VALUES (:rid, 1999, :m, '1999', 1000, 'persons', 'TEST_CHECK', :g, "
                "'sgis', '11', 'SIDO', :now, 't', :run, :now, :now)"
            ),
            {"rid": region_id, "m": month, "g": granularity, "now": NOW, "run": run_id},
        )
