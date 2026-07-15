"""Synthetic SQLite persistence tests for MOIS population ingestion.

SQLite backs the non-spatial provenance and population tables. HTTP is never
called: the official download is monkeypatched with a deterministic fixture
shaped like the real CSV, so these tests do not depend on government
availability. All values are synthetic; nothing here represents official data.

``regions`` is created without its PostGIS geometry column (the same approach the
backend's SQLite tier uses) so the region join can be covered here; seeding uses
a core ``insert(Region)``.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator

import pytest
from sqlalchemy import MetaData, Table, create_engine, insert, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    IngestionRun,
    RawApiResponse,
    Region,
    RegionalPopulation,
)

from waste_equity_ingestion import mois_population_ingestion as mp
from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import IngestionError

NOW = datetime.datetime(2026, 7, 15, tzinfo=datetime.UTC)
MONTH_BLOCK = ["총인구수", "세대수", "세대당 인구", "남자 인구수", "여자 인구수", "남여 비율"]

_REGIONS_METADATA = MetaData()
REGIONS_NONSPATIAL = Table(
    "regions",
    _REGIONS_METADATA,
    *[c._copy() for c in Region.__table__.columns if c.name != "geometry"],
)

TABLES = [
    DataSource.__table__,
    IngestionRun.__table__,
    DatasetFreshness.__table__,
    RawApiResponse.__table__,
    RegionalPopulation.__table__,
]


def _header(months: list[str]) -> list[str]:
    columns = ["행정구역"]
    for month in months:
        year, mm = month.split("-")
        columns.extend(f"{year}년{mm}월_{s}" for s in MONTH_BLOCK)
    return columns


def _row(name: str, code: str, values: list[str]) -> list[str]:
    cells = [f"{name}  ({code})"]
    for value in values:
        cells.extend([value, "1,000", "          2.00", "500", "500", "          1.00"])
    return cells


def _csv(months: list[str], values: dict[str, list[str]] | None = None) -> bytes:
    values = values or {}
    default = ["1,000,000"] * len(months)
    rows = [
        _header(months),
        _row("서울특별시", "1100000000", values.get("1100000000", default)),
        _row("인천광역시", "2800000000", values.get("2800000000", default)),
        _row("경기도", "4100000000", values.get("4100000000", default)),
    ]
    return ("\r\n".join(",".join(f'"{c}"' for c in r) for r in rows) + "\r\n").encode("cp949")


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=TABLES)
    _REGIONS_METADATA.create_all(engine, tables=[REGIONS_NONSPATIAL])
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def patched(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> sessionmaker[Session]:
    monkeypatch.setattr(mp, "get_sessionmaker", lambda: session_factory)
    monkeypatch.setattr(mp, "fetch_latest_month", lambda: "2024-02")
    return session_factory


def _seed_regions(session: Session) -> None:
    for code, name in [
        ("KR-SGIS-11", "서울특별시"),
        ("KR-SGIS-23", "인천광역시"),
        ("KR-SGIS-31", "경기도"),
    ]:
        session.execute(
            insert(Region).values(
                region_code=code,
                region_name=name,
                region_level="SIDO",
                source_id=None,
                valid_from=datetime.date(2024, 1, 1),
            )
        )
    session.commit()


def _seed_sgis_population(session: Session) -> int:
    """An existing annual SGIS row that must survive untouched."""
    region_id = session.scalar(select(Region.id).where(Region.region_code == "KR-SGIS-11"))
    assert region_id is not None
    session.add(
        DataSource(
            source_id="sgis",
            source_name="SGIS",
            dataset_name="population",
            endpoint="https://sgis.kostat.go.kr",
            publication_frequency="ANNUAL",
            enabled=True,
            documentation_url=None,
        )
    )
    session.add(
        RegionalPopulation(
            region_id=region_id,
            reference_year=2024,
            reference_month=None,
            reference_period="2024",
            population=9_335_444,
            unit="persons",
            population_definition="SGIS_TOTAL_POPULATION",
            population_temporal_granularity="ANNUAL",
            source_id="sgis",
            source_administrative_code="11",
            source_geographic_level="SIDO",
            retrieved_at=NOW,
            transformation_version="sgis-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()
    return int(region_id)


def _run(
    monkeypatch: pytest.MonkeyPatch, payload: bytes, **kwargs: object
) -> mp.MoisPopulationReport:
    monkeypatch.setattr(mp, "download_csv", lambda *a, **k: payload)
    defaults: dict[str, object] = {
        "scope": "capital-region",
        "start_month": "2024-01",
        "end_month": "2024-02",
        "write": True,
    }
    defaults.update(kwargs)
    return mp.run_mois_population_ingestion(ProbeSettings.from_env(), **defaults)  # type: ignore[arg-type]


def test_write_inserts_one_row_per_region_month(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    report = _run(monkeypatch, _csv(["2024-01", "2024-02"]))
    assert report.status == "SUCCESS"
    assert (report.rows_inserted, report.rows_updated, report.rows_unchanged) == (6, 0, 0)
    with patched() as session:
        rows = session.scalars(
            select(RegionalPopulation).where(
                RegionalPopulation.source_id == "mois_resident_population"
            )
        ).all()
        assert len(rows) == 6
        for row in rows:
            assert row.population_temporal_granularity == "MONTHLY"
            assert row.population_definition == "MOIS_RESIDENT_REGISTRATION_TOTAL"
            assert row.reference_month in {"2024-01", "2024-02"}
            assert row.reference_year == 2024
            assert row.reference_period == row.reference_month
            assert row.unit == "persons"
            assert row.source_geographic_level == "SIDO"
            assert row.transformation_version == "mois-resident-population-v1"
            assert row.source_administrative_code in {"1100000000", "2800000000", "4100000000"}
            assert row.ingestion_run_id == report.ingestion_run_id
            assert row.raw_response_id is not None


def test_rerun_is_idempotent(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    payload = _csv(["2024-01", "2024-02"])
    first = _run(monkeypatch, payload)
    second = _run(monkeypatch, payload)
    assert (first.rows_inserted, first.rows_unchanged) == (6, 0)
    assert (second.rows_inserted, second.rows_updated, second.rows_unchanged) == (0, 0, 6)
    with patched() as session:
        assert (
            session.scalar(
                select(RegionalPopulation.id.distinct().label("n")).where(
                    RegionalPopulation.source_id == "mois_resident_population"
                )
            )
            is not None
        )
        rows = session.scalars(select(RegionalPopulation)).all()
        assert len([r for r in rows if r.source_id == "mois_resident_population"]) == 6


def test_dry_run_writes_nothing(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    report = _run(monkeypatch, _csv(["2024-01", "2024-02"]), write=False)
    assert report.status == "DRY_RUN_OK"
    assert report.expected_month_count == 2
    assert report.found_month_count == 2
    assert report.observations == 6
    assert report.source_sha256 is not None
    with patched() as session:
        assert session.scalars(select(RegionalPopulation)).all() == []
        assert session.scalars(select(IngestionRun)).all() == []
        assert session.scalars(select(RawApiResponse)).all() == []


def test_existing_sgis_rows_are_untouched(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
        _seed_sgis_population(session)
    _run(monkeypatch, _csv(["2024-01", "2024-02"]))
    with patched() as session:
        sgis = session.scalars(
            select(RegionalPopulation).where(RegionalPopulation.source_id == "sgis")
        ).all()
        assert len(sgis) == 1
        row = sgis[0]
        # Byte-for-byte identical to what was seeded.
        assert row.population == 9_335_444
        assert row.reference_year == 2024
        assert row.reference_month is None
        assert row.reference_period == "2024"
        assert row.population_definition == "SGIS_TOTAL_POPULATION"
        assert row.population_temporal_granularity == "ANNUAL"
        assert row.transformation_version == "sgis-v1"


def test_twelve_months_of_one_year_coexist_with_the_annual_sgis_row(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The old annual-only unique constraint could not express this.
    with patched() as session:
        _seed_regions(session)
        _seed_sgis_population(session)
    months = [f"2024-{m:02d}" for m in range(1, 13)]
    report = _run(monkeypatch, _csv(months), start_month="2024-01", end_month="2024-12")
    assert report.status == "SUCCESS"
    assert report.rows_inserted == 36  # 12 months x 3 regions
    with patched() as session:
        seoul_id = session.scalar(select(Region.id).where(Region.region_code == "KR-SGIS-11"))
        seoul_2024 = session.scalars(
            select(RegionalPopulation).where(
                RegionalPopulation.region_id == seoul_id,
                RegionalPopulation.reference_year == 2024,
            )
        ).all()
        # 12 MOIS months + 1 annual SGIS row, all for region/year 2024.
        assert len(seoul_2024) == 13
        assert len([r for r in seoul_2024 if r.population_temporal_granularity == "MONTHLY"]) == 12
        assert len([r for r in seoul_2024 if r.population_temporal_granularity == "ANNUAL"]) == 1


def test_source_metadata_and_provenance_are_recorded(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    payload = _csv(["2024-01", "2024-02"])
    report = _run(monkeypatch, payload)
    with patched() as session:
        source = session.get(DataSource, "mois_resident_population")
        assert source is not None
        assert source.dataset_name == "행정동별 주민등록 인구 및 세대현황"
        assert source.publication_frequency == "MONTHLY"
        assert source.documentation_url == "https://jumin.mois.go.kr/statMonth.do"

        raw = session.scalars(select(RawApiResponse)).all()
        assert len(raw) == 1
        envelope = raw[0].sanitized_response
        # The exact official digest is recorded so any row traces to the file.
        assert envelope["payload"]["source_sha256"] == report.source_sha256
        assert envelope["request_metadata"]["encoding"] == "cp949"
        # 전체 (거주자+거주불명자+재외국민) is what was requested.
        assert envelope["request_metadata"]["form_fields"]["sltUndefType"] == ""
        # No credential is involved in, or recorded for, this source.
        assert "serviceKey" not in str(envelope)
        assert "password" not in str(envelope).lower()

        run = session.scalars(select(IngestionRun)).all()[0]
        assert run.status == "SUCCESS"
        assert run.source_id == "mois_resident_population"
        assert run.transformation_version == "mois-resident-population-v1"

        freshness = session.get(DatasetFreshness, "mois_resident_population")
        assert freshness is not None
        assert freshness.latest_reference_period == "2024-02"
        assert freshness.freshness_status == "FRESH"


def test_definition_era_is_persisted_with_each_row(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    _run(monkeypatch, _csv(["2010-09", "2010-10"]), start_month="2010-09", end_month="2010-10")
    with patched() as session:
        rows = {
            (r.reference_month): r
            for r in session.scalars(
                select(RegionalPopulation).where(
                    RegionalPopulation.source_id == "mois_resident_population"
                )
            ).all()
            if r.source_administrative_code == "1100000000"
        }
        assert (
            rows["2010-09"].population_definition_version == "MOIS_TOTAL_PRE_UNREGISTERED_RESIDENT"
        )
        assert (
            rows["2010-10"].population_definition_version == "MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT"
        )
        assert "거주불명자" in (rows["2010-10"].population_comparability_note or "")


def test_incomplete_month_rejects_the_whole_run_without_writing(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    # Gyeonggi is zero (unpublished) for 2024-02.
    payload = _csv(["2024-01", "2024-02"], {"4100000000": ["13,000,000", "0"]})
    report = _run(monkeypatch, payload)
    assert report.status == "FAILED"
    assert report.missing_months == ["2024-02"]
    assert "2024-02" in report.error
    with patched() as session:
        # Nothing at all was written — not even the complete 2024-01 month.
        assert session.scalars(select(RegionalPopulation)).all() == []


def test_start_month_before_2008_is_refused(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(IngestionError, match="not authorized"):
        _run(monkeypatch, _csv(["2007-12"]), start_month="2007-12", end_month="2007-12")


def test_unsupported_scope_is_refused(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(IngestionError, match="capital-region"):
        _run(monkeypatch, _csv(["2024-01"]), scope="nationwide")


def test_missing_canonical_region_refuses_to_write(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    # No regions seeded: population must not be attached to nothing.
    with pytest.raises(IngestionError, match="No canonical SIDO region"):
        _run(monkeypatch, _csv(["2024-01", "2024-02"]))


def test_canonical_region_name_mismatch_refuses_to_write(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        # A renamed/recoded canonical region must not silently receive Incheon's
        # population just because the crosswalk points at its code.
        session.execute(
            insert(Region).values(
                region_code="KR-SGIS-11",
                region_name="서울특별시",
                region_level="SIDO",
                valid_from=datetime.date(2024, 1, 1),
            )
        )
        session.execute(
            insert(Region).values(
                region_code="KR-SGIS-23",
                region_name="다른광역시",
                region_level="SIDO",
                valid_from=datetime.date(2024, 1, 1),
            )
        )
        session.execute(
            insert(Region).values(
                region_code="KR-SGIS-31",
                region_name="경기도",
                region_level="SIDO",
                valid_from=datetime.date(2024, 1, 1),
            )
        )
        session.commit()
    with pytest.raises(IngestionError, match="refusing to attach"):
        _run(monkeypatch, _csv(["2024-01", "2024-02"]))


def test_end_month_defaults_to_the_officially_discovered_latest(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with patched() as session:
        _seed_regions(session)
    report = _run(monkeypatch, _csv(["2024-01", "2024-02"]), start_month="2024-01", end_month=None)
    # The patched official page reports 2024-02 as its latest published month.
    assert report.discovered_latest_month == "2024-02"
    assert report.requested_end_month == "2024-02"
    assert report.status == "SUCCESS"


def test_source_file_mode_reads_the_official_file_without_network(
    patched: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, tmp_path: object
) -> None:
    with patched() as session:
        _seed_regions(session)

    def _fail(*_a: object, **_k: object) -> bytes:
        raise AssertionError("download_csv must not be called in --source-file mode")

    monkeypatch.setattr(mp, "download_csv", _fail)
    path = tmp_path / "mois.csv"  # type: ignore[operator]
    payload = _csv(["2024-01", "2024-02"])
    path.write_bytes(payload)
    report = mp.run_mois_population_ingestion(
        ProbeSettings.from_env(),
        scope="capital-region",
        start_month="2024-01",
        end_month="2024-02",
        write=True,
        source_file=str(path),
    )
    assert report.status == "SUCCESS"
    assert report.acquisition_method.startswith("OFFICIAL_FILE:")
    assert report.source_sha256 is not None
    assert report.rows_inserted == 6
