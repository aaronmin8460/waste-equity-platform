"""PostGIS migration tests for monthly population support (0014).

Requires TEST_DATABASE_URL pointing at a database migrated to head. Asserts that
the additive change admits a monthly series without weakening the legacy annual
guarantee or touching existing rows.

Data prerequisites
------------------
Everything here runs on a **schema-only** database. The constraint tests supply
their own foreign-key parents through the ``fk_parents`` fixture rather than
borrowing whatever rows happen to be present, so they are deterministic and never
depend on ambient ingested data.

The single exception is
``test_the_ingested_sgis_series_survived_the_upgrade``, which asserts that a real
pre-0014 SGIS series came through the upgrade intact. That claim is about data
which existed *before* the migration ran and cannot be reconstructed by seeding
rows afterwards, so it skips with a precise reason when no SGIS series is loaded —
the same convention ``test_migration_municipal_cost_integration.py`` uses for its
registry count. The part of that claim which *is* checkable everywhere — that no
SGIS row was ever given a monthly grain — is asserted unconditionally, next to it.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
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


# Deliberately un-ingestable identifiers: no official SGIS boundary uses them, so
# these rows cannot collide with real data even on a fully loaded database.
SYNTHETIC_REGION_CODE = "MIG0014TESTRG"
# 'sgis' is seeded into data_sources by migration 0001, so the ingestion_runs FK
# resolves without this fixture having to invent a data source too.
SYNTHETIC_RUN_SOURCE = "sgis"


@pytest.fixture
def fk_parents(engine: Engine) -> Iterator[tuple[int, int]]:
    """A synthetic ``(region_id, run_id)`` pair for the FK columns these tests fill.

    What the tests below actually exercise is *constraint* behaviour — the two
    granularity-scoped partial unique indexes and the granularity/month check. That
    behaviour is indifferent to which region or ingestion run a row points at; the
    foreign keys merely have to resolve.

    These used to be resolved with ``SELECT id FROM regions LIMIT 1``, which made
    five tests fail outright on a schema-only database ("a regions row is required
    by the FK") — reported as a product regression when nothing was wrong — and,
    when rows *were* present, quietly bound the assertions to an arbitrary piece of
    ambient ingested data. Creating the parents here fixes both.

    Only the NOT NULL columns are populated: a region needs a code, a name, a level
    and a validity start; ``geometry`` is nullable and no spatial behaviour is under
    test here.
    """

    with engine.begin() as connection:
        region_id = connection.execute(
            text(
                "INSERT INTO regions (region_code, region_name, region_level, valid_from) "
                "VALUES (:code, '0014 마이그레이션 시험구', 'SIGUNGU', :valid_from) "
                "RETURNING id"
            ),
            {"code": SYNTHETIC_REGION_CODE, "valid_from": datetime.date(1999, 1, 1)},
        ).scalar_one()
        run_id = connection.execute(
            text(
                "INSERT INTO ingestion_runs (source_id, started_at, completed_at, status, "
                "rows_received, rows_inserted, rows_updated, rows_rejected) "
                "VALUES (:source, :now, :now, 'SUCCEEDED', 0, 0, 0, 0) RETURNING run_id"
            ),
            {"source": SYNTHETIC_RUN_SOURCE, "now": NOW},
        ).scalar_one()

    try:
        yield int(region_id), int(run_id)
    finally:
        # Ordered by dependency, and unconditional: a test that fails part-way
        # through must not leave rows behind for the next file in the run.
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM regional_population WHERE region_id = :rid"),
                {"rid": region_id},
            )
            connection.execute(text("DELETE FROM regions WHERE id = :rid"), {"rid": region_id})
            connection.execute(
                text("DELETE FROM ingestion_runs WHERE run_id = :run"), {"run": run_id}
            )


def test_head_matches_the_alembic_script_head(engine: Engine) -> None:
    # The DB must be at the CURRENT script head — computed from the Alembic script
    # directory rather than hard-coded, so a later additive migration (e.g. 0015
    # facility standard costs) never re-breaks this assertion. The monthly-population
    # migration (0014) remains part of that chain.
    with engine.connect() as connection:
        db_revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    script_head = ScriptDirectory.from_config(_alembic_config("public")).get_current_head()
    assert db_revision == script_head
    revisions = {
        script.revision
        for script in ScriptDirectory.from_config(_alembic_config("public")).walk_revisions()
    }
    assert "0014" in revisions


def test_no_sgis_row_was_given_a_monthly_grain(engine: Engine) -> None:
    """The annual SGIS series is never labelled MONTHLY and never carries a month.

    This is the half of the 0014 backfill guarantee that is checkable on any
    database, loaded or not, so it is asserted unconditionally. It is also the half
    that carries the analytical weight: a SGIS row that acquired a
    ``reference_month`` would be readable as a monthly observation, which is exactly
    the blurring of grains that migration 0014's check constraint exists to prevent.

    On a schema-only database this is vacuously true over zero rows — honest, and
    not a claim that anything was verified. The companion test below is the one that
    asserts a real series is present, and it says so by skipping when it is not.
    """

    with engine.connect() as connection:
        offending = connection.execute(
            text(
                "SELECT count(*) FROM regional_population "
                "WHERE source_id = 'sgis' "
                "AND (reference_month IS NOT NULL "
                "OR population_temporal_granularity <> 'ANNUAL')"
            )
        ).scalar_one()
    assert offending == 0, f"{offending} SGIS rows carry a month or a non-ANNUAL grain"


def test_the_ingested_sgis_series_survived_the_upgrade(engine: Engine) -> None:
    """Skips cleanly before the first ingestion; asserts the series once loaded.

    Unlike every other test in this file, this one cannot construct its own subject.
    It asserts that rows which existed *before* migration 0014 ran came through the
    upgrade intact and were backfilled to ANNUAL — seeding rows now would produce
    post-upgrade rows and prove nothing about the backfill. So the prerequisite is
    stated explicitly instead of being assumed: on a schema-only database this skips
    with a reason naming what is missing, rather than failing as though the
    application had regressed.
    """

    with engine.connect() as connection:
        total, with_month = connection.execute(
            text(
                "SELECT count(*), count(reference_month) FROM regional_population "
                "WHERE source_id = 'sgis'"
            )
        ).one()
    if not total:
        pytest.skip("no SGIS population series has been ingested into the test database")

    # Every SGIS row is still present, was backfilled to ANNUAL, and carries no
    # month (a monthly grain was never fabricated for it).
    assert with_month == 0
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


def test_twelve_monthly_rows_in_one_year_are_accepted(
    engine: Engine, fk_parents: tuple[int, int]
) -> None:
    region_id, run_id = fk_parents
    with engine.begin() as connection:
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


def test_duplicate_region_month_source_definition_is_rejected(
    engine: Engine, fk_parents: tuple[int, int]
) -> None:
    from sqlalchemy.exc import IntegrityError

    region_id, run_id = fk_parents
    with engine.begin() as connection:
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


def test_annual_legacy_uniqueness_still_holds(engine: Engine, fk_parents: tuple[int, int]) -> None:
    from sqlalchemy.exc import IntegrityError

    region_id, run_id = fk_parents
    with engine.begin() as connection:
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
    engine: Engine, fk_parents: tuple[int, int], granularity: str, month: str | None
) -> None:
    """A MONTHLY row must name its month and an ANNUAL row must not.

    This is what stops a monthly observation from ever being read as an annual
    denominator (or vice versa) — the two grains cannot blur.
    """
    from sqlalchemy.exc import IntegrityError

    region_id, run_id = fk_parents
    # The insert gets its own transaction: a failed statement poisons the current
    # one, so it cannot share with the fixture's.
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
