"""Opt-in PostGIS integration test for the RCIS reporting-geography build.

Requires TEST_DATABASE_URL pointing at the docker PostGIS database with the SGIS
2024 geography and the stored RCIS raw responses (the local development stack).
Runs the offline build (no live API) twice and asserts the reporting regions,
child lineage, derived geometry, and city waste rows, plus idempotency and that
the native tables are untouched.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

YEAR = 2024


def _run_build(write: bool) -> object:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()

    from waste_equity_ingestion.config import ProbeSettings
    from waste_equity_ingestion.rcis_reporting_geography import run_reporting_geography

    return run_reporting_geography(
        ProbeSettings.from_env(), year=YEAR, scope="capital-region", write=write
    )


def _counts(engine: object) -> dict[str, int]:
    tables = [
        "regions",
        "regional_population",
        "regional_waste_statistics",
        "waste_treatment_facilities",
        "suitability_candidates",
        "suitability_analysis_runs",
    ]
    result: dict[str, int] = {}
    with engine.connect() as connection:  # type: ignore[attr-defined]
        for table in tables:
            result[table] = connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
    return result


def test_reporting_build_is_idempotent_and_preserves_native() -> None:
    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        before = _counts(engine)

        first = _run_build(write=True)
        second = _run_build(write=True)

        assert first.status == "SUCCEEDED"  # type: ignore[attr-defined]
        assert first.regions_built == 7  # type: ignore[attr-defined]
        assert first.members_present == 20  # type: ignore[attr-defined]
        assert first.stats_rows_expected == 28  # type: ignore[attr-defined]
        # Second identical run writes nothing new.
        assert second.regions_inserted == 0  # type: ignore[attr-defined]
        assert second.regions_updated == 0  # type: ignore[attr-defined]
        assert second.stats_rows_inserted == 0  # type: ignore[attr-defined]
        assert second.stats_rows_updated == 0  # type: ignore[attr-defined]
        assert second.missing_city_records == []  # type: ignore[attr-defined]

        after = _counts(engine)
        # Native tables are untouched by the additive build.
        assert before == after

        with engine.connect() as connection:
            regions = connection.execute(
                text("SELECT count(*) FROM waste_reporting_regions")
            ).scalar_one()
            members = connection.execute(
                text("SELECT count(*) FROM waste_reporting_region_members")
            ).scalar_one()
            stats = connection.execute(
                text("SELECT count(*) FROM reporting_region_waste_statistics")
            ).scalar_one()
            # No child region belongs to more than one reporting city.
            dup_children = connection.execute(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT child_region_id FROM waste_reporting_region_members "
                    "GROUP BY child_region_id HAVING count(*) > 1) d"
                )
            ).scalar_one()
            # Every derived geometry is valid, non-empty, EPSG:4326 MULTIPOLYGON.
            bad_geom = connection.execute(
                text(
                    "SELECT count(*) FROM waste_reporting_regions "
                    "WHERE NOT ST_IsValid(geometry) OR ST_IsEmpty(geometry) "
                    "OR ST_SRID(geometry) <> 4326 "
                    "OR GeometryType(geometry) <> 'MULTIPOLYGON'"
                )
            ).scalar_one()
            # Derived geometry equals the union of its member children.
            not_union = connection.execute(
                text(
                    "SELECT count(*) FROM waste_reporting_regions wr "
                    "WHERE NOT ST_Equals(wr.geometry, ("
                    "SELECT ST_Multi(ST_Union(r.geometry)) "
                    "FROM waste_reporting_region_members m "
                    "JOIN regions r ON r.id = m.child_region_id "
                    "WHERE m.reporting_region_id = wr.id))"
                )
            ).scalar_one()
            # No reporting-geography code collides with a native region_code.
            code_collision = connection.execute(
                text(
                    "SELECT count(*) FROM waste_reporting_regions wr "
                    "JOIN regions r ON r.region_code = wr.reporting_region_code"
                )
            ).scalar_one()
            # No city value is attached to a child district in the native table.
            child_native_rows = connection.execute(
                text(
                    "SELECT count(*) FROM regional_waste_statistics s "
                    "WHERE s.region_id IN "
                    "(SELECT child_region_id FROM waste_reporting_region_members)"
                )
            ).scalar_one()

        assert regions == 7
        assert members == 20
        assert stats == 28
        assert dup_children == 0
        assert bad_geom == 0
        assert not_union == 0
        assert code_collision == 0
        assert child_native_rows == 0
    finally:
        engine.dispose()
