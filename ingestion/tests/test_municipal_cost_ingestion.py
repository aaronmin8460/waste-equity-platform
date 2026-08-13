"""Pipeline tests: resolution, geography registry, indicator, and idempotency.

Every workbook and every region row here is SYNTHETIC and built in ``tmp_path`` /
an in-memory SQLite database. The real disclosure workbooks and the development
database are never read or written by this suite.

``regions`` is created without its PostGIS geometry column (as the backend test
conftest does), which is enough for the column-scoped lookups the loader
performs: it reads ``region_code`` / ``region_name`` and never any geometry, and
it never writes to ``regions`` at all.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from municipal_cost_fixtures import (
    HEADERS_DATA_B,
    HEADERS_FAMILY_2,
    contract_row,
    data_b_rows,
    monthly_pairs,
    quantity_row,
    write_workbook,
)
from sqlalchemy import MetaData, Table, create_engine, func, insert, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from waste_equity_backend.analysis.municipal_cost import (
    EXPECTED_MUNICIPALITIES,
    METROPOLITAN_GYEONGGI,
    METROPOLITAN_INCHEON,
    METROPOLITAN_SEOUL,
    POST_2024_INCHEON_UNITS,
    REVIEWED_MUNICIPALITY_LIMITATIONS,
    evaluate_indicator,
    find_reviewed_limitations,
    payment_per_capita,
)
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    IngestionRun,
    LandfillInboundMonthly,
    MunicipalCostGeography,
    MunicipalCostGeographyComponent,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteContract,
    MunicipalWasteQuantity,
    RawApiResponse,
    Region,
    RegionalPopulation,
)
from waste_equity_backend.models.metadata import GRANULARITY_ANNUAL
from waste_equity_backend.models.municipal_cost import (
    ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
    INGESTION_DECISION_ACCEPTED,
    INGESTION_DECISION_REJECTED,
    PARTIAL_REASONS,
    POPULATION_DEFINITION_SGIS,
    POPULATION_DERIVED_WARD_SUM,
    POPULATION_DIRECT,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_BOUNDARY_MISMATCH,
    REASON_MALFORMED_FILENAME_RESOLVED,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_POPULATION,
    REASON_MISSING_QUANTITY,
    REASON_NO_SOURCE_FILE,
    REASON_NON_COLLECTION_TRANSPORT_BASIS,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
    REASON_POST_2024_FILENAME_RESOLVED,
    SOURCE_ID,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    TRANSFORMATION_VERSION,
)

from waste_equity_ingestion.municipal_cost_ingestion import (
    MunicipalCostReport,
    build_registry,
    discover_files,
    normalize_organisation_name,
    run_municipal_cost_ingestion,
)

YEAR = 2024
GYEONGGI_A_FOLDER = "경기도(31개 중 22개 완료 8.4 기준)"
GYEONGGI_B_FOLDER = "경기도(31개중 19개 완료 8.4기준)"

METADATA_TABLES = [
    DataSource.__table__,
    IngestionRun.__table__,
    DatasetFreshness.__table__,
    RawApiResponse.__table__,
    RegionalPopulation.__table__,
    LandfillInboundMonthly.__table__,
    MunicipalCostGeography.__table__,
    MunicipalCostGeographyComponent.__table__,
    MunicipalCostSourceFile.__table__,
    MunicipalWasteContract.__table__,
    MunicipalWasteQuantity.__table__,
    MunicipalCostIndicatorValue.__table__,
]

_REGIONS_METADATA = MetaData()
REGIONS_NONSPATIAL = Table(
    "regions",
    _REGIONS_METADATA,
    *[column._copy() for column in Region.__table__.columns if column.name != "geometry"],
)


def _synthetic_population(code: str) -> int:
    """A deterministic, obviously synthetic population for a test region."""

    return 10_000 + int(code.removeprefix("KR-SGIS-")) % 100_000


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=METADATA_TABLES)
    _REGIONS_METADATA.create_all(engine, tables=[REGIONS_NONSPATIAL])
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        session.execute(
            insert(DataSource).values(
                source_id=SOURCE_ID,
                source_name="테스트 지자체 (합성 데이터)",
                dataset_name="TEST ONLY",
                endpoint="local-file://test",
                publication_frequency="STRUCTURAL",
                enabled=True,
            )
        )
        seed_run = IngestionRun(
            source_id=SOURCE_ID,
            started_at=datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC),
            status="SUCCEEDED",
            transformation_version="test-seed",
        )
        session.add(seed_run)
        session.flush()
        _seed_regions(session, int(seed_run.run_id))
        session.commit()
    yield factory
    engine.dispose()


def _seed_regions(session: Session, seed_run_id: int) -> None:
    """Seed the 2024 SIGUNGU rows the registry expects, plus their populations.

    Gyeonggi's seven ward-split cities are seeded **only** as 일반구, exactly as
    the real ``regions`` table stores them.
    """

    rows: list[dict[str, object]] = []
    for definition in EXPECTED_MUNICIPALITIES:
        codes = (
            [definition.canonical_region_code]
            if definition.canonical_region_code
            else list(definition.ward_region_codes)
        )
        for code in codes:
            assert code is not None
            rows.append(
                {
                    "region_code": code,
                    "region_name": f"{definition.metropolitan_name} {definition.display_name}",
                    "region_level": "SIGUNGU",
                    "parent_region_code": None,
                    "boundary_reference_period": "2024",
                    "valid_from": datetime.date(2024, 1, 1),
                    "valid_to": datetime.date(2024, 12, 31),
                }
            )
    session.execute(insert(REGIONS_NONSPATIAL), rows)

    now = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)
    region_ids = dict(
        session.execute(select(REGIONS_NONSPATIAL.c.region_code, REGIONS_NONSPATIAL.c.id)).all()
    )
    session.execute(
        insert(RegionalPopulation),
        [
            {
                "region_id": region_id,
                "reference_year": YEAR,
                "reference_month": None,
                "reference_period": str(YEAR),
                "population": _synthetic_population(code),
                "unit": "명",
                "population_definition": POPULATION_DEFINITION_SGIS,
                "population_temporal_granularity": GRANULARITY_ANNUAL,
                "source_id": SOURCE_ID,
                "source_administrative_code": code,
                "source_geographic_level": "SIGUNGU",
                "retrieved_at": now,
                "transformation_version": "test",
                "ingestion_run_id": seed_run_id,
                "created_at": now,
                "updated_at": now,
            }
            for code, region_id in region_ids.items()
        ],
    )


# ---------------------------------------------------------------------------
# Synthetic source tree
# ---------------------------------------------------------------------------


def build_source_tree(root: Path) -> Path:
    """A miniature copy of the real folder shape, with synthetic content."""

    # Gyeonggi DATA_A with a city-wide block repeated under three contracts.
    series = [float(100 + month) for month in range(12)]
    rows: list[list[object]] = []
    for index in range(3):
        pairs = monthly_pairs("시 전체 수거량", series)
        rows.append(
            contract_row(
                organisation="광명시청",
                name=f"광명시 생활폐기물 수집·운반 용역({index + 1}구역)",
                payment=1_000_000 * (index + 1),
                pairs=pairs[0],
            )
        )
        rows.extend(quantity_row(pair) for pair in pairs[1:])
    rows.append([None, None, "합계", 6_000_000, None, None, None, None, None])
    write_workbook(root / "DATA_A" / GYEONGGI_A_FOLDER / "광명시.xlsx", HEADERS_FAMILY_2, rows)

    # Gyeonggi DATA_A with an explicit part-year range (가평군 shape).
    # The contract is a collection-and-transport one so this file isolates the
    # part-year rule: the real 가평군 wording is 외부 위탁처리, which is a
    # treatment contract, and its accounting-basis exclusion is proved separately
    # by test_treatment_only_workbook_yields_no_value_not_zero.
    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "가평군.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                year="2024.2.26.~4.5",
                organisation="가평군청",
                name="가평군 생활폐기물 수집·운반 대행용역 1차",
                payment=152_884_450,
                pairs=["A업체:", 950],
            )
        ],
    )

    # Gyeonggi DATA_A with a payment but no numeric quantity at all.
    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "군포시 - 월 별 쓰레기 양 x.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                organisation="군포시청",
                name="생활폐기물 수집운반 대행용역(1구역)",
                payment=3_782_344_860,
                pairs=["미제공", None],
            )
        ],
    )

    # Incheon DATA_A whose filename is a post-2024 unit but whose 기관명 states 2024.
    write_workbook(
        root / "DATA_A" / "인천" / "제물포구.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                organisation="인천광역시 동구청",
                name="2024년 생활쓰레기 수집·운반 대행용역(1구역)",
                payment=485_044_000,
                pairs=["생활쓰레기 반출량: 1월", 177.71],
            )
        ],
    )

    # Incheon DATA_A that is 일반-only per its filename annotation.
    write_workbook(
        root
        / "DATA_A"
        / "인천"
        / "부평구 - 생활(일반)수집운반만 있고 음식물류·재활용 데이터 없음.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                organisation="인천광역시 부평구청",
                name="2024년 생활폐기물 수집운반 대행계약(1권역)",
                payment=3_430_584_240,
                pairs=["반출량: 1월", 10.0],
            )
        ],
    )

    # Seoul DATA_B: tonnage only, so Seoul can never produce a payment value.
    write_workbook(
        root / "DATA_B" / "서울" / "종로구.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            [3076.21] * 12,
            ["-"] * 12,
            ["-"] * 12,
            (36914.52, "-", "-", 36914.52),
            combined=[3076.21] * 12,
        ),
        sheet_name="2024년",
    )

    # Incheon DATA_B resolved by a reviewed note-backed mapping.
    write_workbook(
        root / "DATA_B" / "인천" / "남동구xlsx.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            [3090.41] * 12,
            ["-"] * 12,
            [1350.88] * 12,
            (37084.92, "-", 16210.56, 53295.48),
            combined=[4441.29] * 12,
        ),
        sheet_name="2024년",
    )

    # Incheon DATA_B whose 음식물 series the rejected 서해구 workbook copies verbatim.
    write_workbook(
        root / "DATA_B" / "인천" / "미추홀구.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            [2000.0] * 12,
            [1819.01] * 12,
            ["-"] * 12,
            (24000.0, 21828.12, "-", 45828.12),
            combined=[3819.01] * 12,
        ),
        sheet_name="2024년",
    )

    # Rejected: post-2024 filename, no in-workbook unit, dash-sum zero totals.
    write_workbook(
        root / "DATA_B" / "인천" / "서해구xlsx.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            ["-"] * 12,
            [1819.01] * 12,
            ["-"] * 12,
            (0, 21828.12, 0, 21828.12),
            combined=[1819.01] * 12,
        ),
        sheet_name="2024년",
    )

    # Rejected: a Seoul 자치구 filed under the Gyeonggi folder.
    write_workbook(
        root / "DATA_B" / GYEONGGI_B_FOLDER / "양천구.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            [3077.1] * 12,
            [2309.21] * 12,
            [1156.5] * 12,
            (36925.2, 27710.52, 13878.0, 78513.72),
        ),
        sheet_name="2024년",
    )
    return root


@pytest.fixture
def source_tree(tmp_path: Path) -> Path:
    return build_source_tree(tmp_path / "2024")


def run(source_tree: Path, factory: sessionmaker[Session], *, write: bool):
    return run_municipal_cost_ingestion(
        source_dir=str(source_tree), year=YEAR, write=write, session_factory=factory
    )


# ---------------------------------------------------------------------------
# Discovery and resolution
# ---------------------------------------------------------------------------


def test_discovery_finds_every_workbook_with_stable_order(source_tree: Path) -> None:
    files = discover_files(source_tree)
    assert len(files) == 10
    assert [item.relative_path for item in files] == sorted(item.relative_path for item in files)
    assert {item.dataset_role for item in files} == {"DATA_A", "DATA_B"}


def test_progress_labelled_folder_names_are_not_treated_as_keys(source_tree: Path) -> None:
    """The Gyeonggi folders embed delivery counts and differ between DATA_A/DATA_B."""

    metros = {item.region_folder: item.metropolitan_code for item in discover_files(source_tree)}
    assert metros[GYEONGGI_A_FOLDER] == METROPOLITAN_GYEONGGI
    assert metros[GYEONGGI_B_FOLDER] == METROPOLITAN_GYEONGGI
    assert metros["서울"] == METROPOLITAN_SEOUL
    assert metros["인천"] == METROPOLITAN_INCHEON


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("인천광역시 동구청", "동구"),
        ("인천광역시 서구", "서구"),
        ("가평군청", "가평군"),
        ("광명시청", "광명시"),
        ("서울특별시 종로구", "종로구"),
    ],
)
def test_normalize_organisation_name(raw: str, expected: str) -> None:
    assert normalize_organisation_name(raw) == expected


def test_reviewed_incheon_mappings_resolve_to_2024_units(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=True)
    with session_factory() as session:
        rows = {row.filename: row for row in session.scalars(select(MunicipalCostSourceFile))}
    jemulpo = rows["제물포구.xlsx"]
    assert jemulpo.ingestion_decision == INGESTION_DECISION_ACCEPTED
    assert jemulpo.resolution_basis == "REVIEWED_MAPPING"
    namdong = rows["남동구xlsx.xlsx"]
    assert namdong.ingestion_decision == INGESTION_DECISION_ACCEPTED
    assert namdong.resolution_basis == "REVIEWED_MAPPING"
    assert report.status == "SUCCEEDED"

    with session_factory() as session:
        geography = session.get(MunicipalCostGeography, jemulpo.resolved_geography_id)
        assert geography is not None
        assert geography.display_name == "동구"


def test_rejected_workbooks_keep_provenance_and_produce_nothing(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=True)
    rejected = {entry["filename"]: entry for entry in report.rejected_files}
    assert set(rejected) == {"서해구xlsx.xlsx", "양천구.xlsx"}
    assert REASON_BOUNDARY_MISMATCH in rejected["서해구xlsx.xlsx"]["reason_codes"]
    assert REASON_AMBIGUOUS_REGION_MAPPING in rejected["양천구.xlsx"]["reason_codes"]

    with session_factory() as session:
        for filename in ("서해구xlsx.xlsx", "양천구.xlsx"):
            row = session.scalars(
                select(MunicipalCostSourceFile).where(MunicipalCostSourceFile.filename == filename)
            ).one()
            assert row.ingestion_decision == INGESTION_DECISION_REJECTED
            assert row.resolved_geography_id is None
            assert row.rejection_reasons
            assert (
                session.scalar(
                    select(func.count())
                    .select_from(MunicipalWasteQuantity)
                    .where(MunicipalWasteQuantity.source_file_id == row.id)
                )
                == 0
            )
            assert (
                session.scalar(
                    select(func.count())
                    .select_from(MunicipalWasteContract)
                    .where(MunicipalWasteContract.source_file_id == row.id)
                )
                == 0
            )


def test_misfiled_seoul_district_is_never_silently_mapped(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """양천구 has no Gyeonggi counterpart; it must not become Seoul or Gyeonggi."""

    report = run(source_tree, session_factory, write=True)
    yangcheon = next(row for row in report.municipalities if row["display_name"] == "양천구")
    assert yangcheon["metropolitan_code"] == METROPOLITAN_SEOUL
    assert yangcheon["source_file_count"] == 0
    assert REASON_NO_SOURCE_FILE in yangcheon["reason_codes"]


def test_cross_municipality_duplicate_series_is_detected(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    entries = {entry["relative_path"]: entry for entry in report.duplicate_series}
    seohae = next(path for path in entries if "서해구xlsx.xlsx" in path)
    assert any("미추홀구.xlsx" in other for other in entries[seohae]["identical_to"])
    assert "음식물" in entries[seohae]["series"]


# ---------------------------------------------------------------------------
# Geography registry
# ---------------------------------------------------------------------------


def test_registry_has_exactly_sixty_six_rows(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        registry = build_registry(session)
    assert len(registry) == 66
    counts: dict[str, int] = {}
    for entry in registry:
        counts[entry.definition.metropolitan_code] = (
            counts.get(entry.definition.metropolitan_code, 0) + 1
        )
    assert counts == {METROPOLITAN_SEOUL: 25, METROPOLITAN_INCHEON: 10, METROPOLITAN_GYEONGGI: 31}


def test_registry_uses_only_2024_incheon_geography(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        registry = build_registry(session)
    incheon = {
        entry.definition.display_name
        for entry in registry
        if entry.definition.metropolitan_code == METROPOLITAN_INCHEON
    }
    assert incheon == {
        "중구",
        "동구",
        "미추홀구",
        "연수구",
        "남동구",
        "부평구",
        "계양구",
        "서구",
        "강화군",
        "옹진군",
    }
    assert not incheon.intersection(POST_2024_INCHEON_UNITS)


def test_seven_gyeonggi_cities_use_the_derived_ward_sum(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        registry = build_registry(session)
    derived = {
        entry.definition.display_name: entry
        for entry in registry
        if entry.definition.population_method == POPULATION_DERIVED_WARD_SUM
    }
    assert set(derived) == {"수원시", "성남시", "안양시", "부천시", "안산시", "고양시", "용인시"}
    for entry in derived.values():
        assert entry.direct_region_id is None
        assert entry.components
        assert entry.population == sum(c.population for c in entry.components)
        assert entry.status == STATUS_AVAILABLE


def test_other_municipalities_use_the_direct_region_population(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        registry = build_registry(session)
    direct = [
        entry for entry in registry if entry.definition.population_method == POPULATION_DIRECT
    ]
    assert len(direct) == 59
    for entry in direct:
        assert entry.direct_region_id is not None
        assert entry.components == []


def test_component_sum_is_persisted_and_reproducible(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    run(source_tree, session_factory, write=True)
    with session_factory() as session:
        for geography in session.scalars(
            select(MunicipalCostGeography).where(
                MunicipalCostGeography.population_method == POPULATION_DERIVED_WARD_SUM
            )
        ):
            components = session.scalars(
                select(MunicipalCostGeographyComponent).where(
                    MunicipalCostGeographyComponent.geography_id == geography.id
                )
            ).all()
            assert components
            assert geography.population == sum(c.component_population for c in components)
            assert geography.direct_region_id is None


def test_existing_ward_region_rows_are_never_modified(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    with session_factory() as session:
        before = sorted(
            tuple(row)
            for row in session.execute(
                select(
                    REGIONS_NONSPATIAL.c.id,
                    REGIONS_NONSPATIAL.c.region_code,
                    REGIONS_NONSPATIAL.c.region_name,
                    REGIONS_NONSPATIAL.c.region_level,
                    REGIONS_NONSPATIAL.c.valid_from,
                    REGIONS_NONSPATIAL.c.valid_to,
                )
            ).all()
        )
    run(source_tree, session_factory, write=True)
    with session_factory() as session:
        after = sorted(
            tuple(row)
            for row in session.execute(
                select(
                    REGIONS_NONSPATIAL.c.id,
                    REGIONS_NONSPATIAL.c.region_code,
                    REGIONS_NONSPATIAL.c.region_name,
                    REGIONS_NONSPATIAL.c.region_level,
                    REGIONS_NONSPATIAL.c.valid_from,
                    REGIONS_NONSPATIAL.c.valid_to,
                )
            ).all()
        )
    assert before == after
    assert len(after) == 79  # 25 + 10 + 24 city/county + 20 ward rows


def test_missing_ward_population_blocks_the_whole_city(
    session_factory: sessionmaker[Session],
) -> None:
    """A partial ward sum is never published as a city population."""

    with session_factory() as session:
        suwon_ward = session.execute(
            select(REGIONS_NONSPATIAL.c.id).where(
                REGIONS_NONSPATIAL.c.region_code == "KR-SGIS-31011"
            )
        ).scalar_one()
        session.execute(
            RegionalPopulation.__table__.delete().where(RegionalPopulation.region_id == suwon_ward)
        )
        session.commit()
        registry = build_registry(session)
    suwon = next(entry for entry in registry if entry.definition.display_name == "수원시")
    assert suwon.status == STATUS_UNAVAILABLE
    assert suwon.population is None
    assert suwon.components == []
    assert REASON_MISSING_POPULATION in suwon.reasons


# ---------------------------------------------------------------------------
# Indicator
# ---------------------------------------------------------------------------


def test_payment_per_capita_uses_decimal_and_round_half_even() -> None:
    # 1.00005 → 1.0000 and 1.00015 → 1.0002 under banker's rounding.
    assert payment_per_capita(Decimal("100005"), 100_000) == Decimal("1.0000")
    assert payment_per_capita(Decimal("100015"), 100_000) == Decimal("1.0002")
    assert isinstance(payment_per_capita(Decimal(1), 3), Decimal)
    assert payment_per_capita(Decimal(1), 3) == Decimal("0.3333")


def test_payment_per_capita_refuses_a_zero_denominator() -> None:
    with pytest.raises(ValueError):
        payment_per_capita(Decimal(1), 0)


def test_quantity_absence_does_not_block_the_payment_indicator() -> None:
    outcome = evaluate_indicator(
        population=1000,
        numerator_krw=Decimal(500_000),
        contract_count=2,
        has_source_file=True,
        reason_codes=[REASON_MISSING_QUANTITY],
    )
    assert outcome.status == STATUS_AVAILABLE
    assert outcome.value == Decimal("500.0000")


def test_partial_reasons_degrade_but_still_produce_a_value() -> None:
    outcome = evaluate_indicator(
        population=1000,
        numerator_krw=Decimal(500_000),
        contract_count=1,
        has_source_file=True,
        reason_codes=[REASON_PARTIAL_WASTE_SCOPE],
    )
    assert outcome.status == STATUS_PARTIAL
    assert outcome.value == Decimal("500.0000")


@pytest.mark.parametrize(
    "reasons",
    [
        [REASON_MISSING_PAYMENT],
        [REASON_BOUNDARY_MISMATCH],
        [REASON_AMBIGUOUS_REGION_MAPPING],
    ],
)
def test_blocking_reasons_yield_null_never_zero(reasons: list[str]) -> None:
    outcome = evaluate_indicator(
        population=1000,
        numerator_krw=Decimal(500_000),
        contract_count=1,
        has_source_file=True,
        reason_codes=reasons,
    )
    assert outcome.status == STATUS_UNAVAILABLE
    assert outcome.value is None
    assert outcome.numerator_krw is None
    assert outcome.denominator_population is None


def test_missing_population_yields_null_never_zero() -> None:
    outcome = evaluate_indicator(
        population=None,
        numerator_krw=Decimal(500_000),
        contract_count=1,
        has_source_file=True,
        reason_codes=[],
    )
    assert outcome.status == STATUS_UNAVAILABLE
    assert outcome.value is None
    assert REASON_MISSING_POPULATION in outcome.reason_codes


def test_indicator_rows_exist_for_all_66_and_unavailable_ones_are_null(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    run(source_tree, session_factory, write=True)
    with session_factory() as session:
        rows = list(session.scalars(select(MunicipalCostIndicatorValue)))
    assert len(rows) == 66
    for row in rows:
        if row.status == STATUS_UNAVAILABLE:
            assert row.value is None
            assert row.numerator_amount_krw is None
            assert row.denominator_population is None
        else:
            assert row.value is not None
            assert row.numerator_amount_krw is not None
            assert (row.denominator_population or 0) > 0


def test_seoul_is_unavailable_because_there_is_no_payment_source(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    seoul = [row for row in report.municipalities if row["metropolitan_code"] == METROPOLITAN_SEOUL]
    assert len(seoul) == 25
    assert {row["status"] for row in seoul} == {STATUS_UNAVAILABLE}
    jongno = next(row for row in seoul if row["display_name"] == "종로구")
    # 종로구 has a DATA_B workbook, so the reason is a missing payment, not a
    # missing file — DATA_B carries tonnage only.
    assert jongno["has_data_b"] is True
    assert jongno["has_data_a"] is False
    assert REASON_MISSING_PAYMENT in jongno["reason_codes"]
    assert jongno["value"] is None


def test_data_b_never_contributes_to_the_numerator(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    run(source_tree, session_factory, write=True)
    with session_factory() as session:
        data_b_ids = session.scalars(
            select(MunicipalCostSourceFile.id).where(
                MunicipalCostSourceFile.dataset_role == "DATA_B"
            )
        ).all()
        assert data_b_ids
        contracts = session.scalar(
            select(func.count())
            .select_from(MunicipalWasteContract)
            .where(MunicipalWasteContract.source_file_id.in_(data_b_ids))
        )
    assert contracts == 0


def test_part_year_contract_is_partial(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    gapyeong = next(row for row in report.municipalities if row["display_name"] == "가평군")
    assert gapyeong["status"] == STATUS_PARTIAL
    assert REASON_PARTIAL_PERIOD_COVERAGE in gapyeong["reason_codes"]
    assert gapyeong["value"] is not None


def test_general_only_file_is_partial(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    bupyeong = next(row for row in report.municipalities if row["display_name"] == "부평구")
    assert bupyeong["status"] == STATUS_PARTIAL
    assert REASON_PARTIAL_WASTE_SCOPE in bupyeong["reason_codes"]


def test_payment_without_quantity_is_still_available(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    gunpo = next(row for row in report.municipalities if row["display_name"] == "군포시")
    assert gunpo["status"] == STATUS_AVAILABLE
    assert REASON_MISSING_QUANTITY in gunpo["reason_codes"]
    assert gunpo["value"] is not None


def test_post_2024_resolution_is_informational_not_degrading(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=False)
    dong = next(row for row in report.municipalities if row["display_name"] == "동구")
    assert REASON_POST_2024_FILENAME_RESOLVED in dong["reason_codes"]
    assert dong["status"] == STATUS_AVAILABLE


def test_malformed_filename_is_not_reported_as_a_post_2024_rename(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """남동구 was never renamed — only ``남동구xlsx.xlsx`` is malformed.

    Both files resolve through REVIEWED_MAPPING, but reporting the post-2024
    rename code here would tell a reader that 남동구's boundary changed in 2026,
    which is false. The two cases must stay distinguishable.
    """

    report = run(source_tree, session_factory, write=False)
    namdong = next(row for row in report.municipalities if row["display_name"] == "남동구")
    assert REASON_MALFORMED_FILENAME_RESOLVED in namdong["reason_codes"]
    assert REASON_POST_2024_FILENAME_RESOLVED not in namdong["reason_codes"]
    # 남동구 is a 2024 unit, so it is never one of the post-2024 names.
    assert "남동구" not in POST_2024_INCHEON_UNITS


def test_repeated_block_does_not_change_the_numerator(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=True)
    kwangmyeong = next(row for row in report.municipalities if row["display_name"] == "광명시")
    # Three contracts of 1M, 2M, 3M — the repeated tonnage block changes nothing.
    assert kwangmyeong["numerator_krw"] == "6000000"
    assert kwangmyeong["eligible_contract_count"] == 3
    with session_factory() as session:
        repeated = session.scalars(
            select(MunicipalWasteQuantity).where(
                MunicipalWasteQuantity.attribution == ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED
            )
        ).all()
    assert len(repeated) == 12
    assert all(len(row.source_repetition_rows) == 3 for row in repeated)


# ---------------------------------------------------------------------------
# Write behaviour and idempotency
# ---------------------------------------------------------------------------


def _row_counts(session: Session) -> dict[str, int]:
    return {
        model.__tablename__: session.scalar(select(func.count()).select_from(model)) or 0
        for model in (
            MunicipalCostGeography,
            MunicipalCostGeographyComponent,
            MunicipalCostSourceFile,
            MunicipalWasteContract,
            MunicipalWasteQuantity,
            MunicipalCostIndicatorValue,
        )
    }


def test_dry_run_writes_nothing(source_tree: Path, session_factory: sessionmaker[Session]) -> None:
    report = run(source_tree, session_factory, write=False)
    assert report.status == "DRY_RUN_OK"
    assert report.ingestion_run_id is None
    assert report.writes == {}
    with session_factory() as session:
        assert set(_row_counts(session).values()) == {0}
        # Only the fixture's seed run exists; the dry run recorded none of its own.
        assert (
            session.scalar(
                select(func.count())
                .select_from(IngestionRun)
                .where(IngestionRun.transformation_version == TRANSFORMATION_VERSION)
            )
            == 0
        )


def test_write_then_identical_write_is_a_no_op(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    first = run(source_tree, session_factory, write=True)
    assert first.status == "SUCCEEDED"
    with session_factory() as session:
        counts_after_first = _row_counts(session)
        stamps = {
            row.municipality_key: row.updated_at
            for row in session.scalars(select(MunicipalCostGeography))
        }
        values = {
            row.geography_id: (row.value, row.computed_at)
            for row in session.scalars(select(MunicipalCostIndicatorValue))
        }
    assert counts_after_first["municipal_cost_geographies"] == 66
    assert counts_after_first["municipal_cost_indicator_values"] == 66
    assert counts_after_first["municipal_cost_source_files"] == 10

    second = run(source_tree, session_factory, write=True)
    assert second.idempotent_no_op is True
    for key, value in second.writes.items():
        if key.endswith("_unchanged"):
            continue
        assert value == 0, f"{key} wrote {value} rows on an unchanged re-run"

    with session_factory() as session:
        assert _row_counts(session) == counts_after_first
        assert {
            row.municipality_key: row.updated_at
            for row in session.scalars(select(MunicipalCostGeography))
        } == stamps
        assert {
            row.geography_id: (row.value, row.computed_at)
            for row in session.scalars(select(MunicipalCostIndicatorValue))
        } == values


def test_write_never_touches_the_official_landfill_table(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    with session_factory() as session:
        before = session.scalar(select(func.count()).select_from(LandfillInboundMonthly))
    run(source_tree, session_factory, write=True)
    with session_factory() as session:
        after = session.scalar(select(func.count()).select_from(LandfillInboundMonthly))
    assert before == after == 0


def test_ingestion_run_is_recorded_for_a_write(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(source_tree, session_factory, write=True)
    with session_factory() as session:
        run_row = session.get(IngestionRun, report.ingestion_run_id)
        assert run_row is not None
        assert run_row.source_id == SOURCE_ID
        assert run_row.status == "SUCCEEDED"
        assert run_row.rows_rejected == 2
        freshness = session.get(DatasetFreshness, SOURCE_ID)
        assert freshness is not None
        assert freshness.latest_reference_period == "2024"


# ---------------------------------------------------------------------------
# Accounting basis at municipality level
# ---------------------------------------------------------------------------


def _accounting_basis_tree(root: Path) -> Path:
    """DATA_A for four municipalities, using the real 2024-refresh wording.

    - 연천군: two 위탁처리용역 rows — the whole numerator is on another basis
    - 하남시: three 수집·운반 구역 plus one 처리용역 — a partial exclusion
    - 광명시: seven 수집·운반 구역 plus one 민간소각 처리 용역
    - 군포시: 수집·운반 only — a control that must be untouched
    """

    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "연천군.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                organisation="연천군청",
                name="2024년 연천군 음식물폐기물 위탁처리용역(㈜그린환경)",
                payment=381_571_740,
                pairs=["A업체:", 10.0],
            ),
            contract_row(
                organisation="연천군청",
                name="연천군 대형폐기물 위탁처리용역(㈜화엔텍)",
                payment=423_990_000,
                pairs=["B업체:", 20.0],
            ),
        ],
    )
    hanam = [
        contract_row(
            organisation="하남시청",
            name=f"2024년 하남시 생활폐기물 수집·운반 대행용역 {index}구역",
            payment=1_000_000 * index,
            pairs=["반출량:", float(index)],
        )
        for index in range(1, 4)
    ]
    hanam.append(
        contract_row(
            organisation="하남시청",
            name="2024년 하남시 생활폐기물 처리용역",
            payment=1_275_847_930,
            pairs=["반출량:", 99.0],
        )
    )
    write_workbook(root / "DATA_A" / GYEONGGI_A_FOLDER / "하남시.xlsx", HEADERS_FAMILY_2, hanam)

    gwangmyeong = [
        contract_row(
            organisation="광명시청",
            name=f"2024년 광명시 생활폐기물 수집·운반 용역 {index}구역",
            payment=2_000_000 * index,
            pairs=["반출량:", float(index)],
        )
        for index in range(1, 8)
    ]
    gwangmyeong.append(
        contract_row(
            organisation="광명시청",
            name="2024년 광명시 생활폐기물 민간소각 처리 용역",
            payment=526_602_550,
            pairs=["반출량:", 99.0],
        )
    )
    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "광명시.xlsx", HEADERS_FAMILY_2, gwangmyeong
    )

    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "군포시.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                organisation="군포시청",
                name="2024년 군포시 생활폐기물 수집·운반 대행용역 1구역",
                payment=3_782_344_860,
                pairs=["반출량:", 5.0],
            )
        ],
    )
    return root


@pytest.fixture
def accounting_basis_tree(tmp_path: Path) -> Path:
    return _accounting_basis_tree(tmp_path / "basis")


def _row(report: MunicipalCostReport, name: str) -> dict[str, Any]:
    return next(row for row in report.municipalities if row["display_name"] == name)


def test_treatment_only_workbook_yields_no_value_not_zero(
    accounting_basis_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """Missing is never zero — the critical null semantic of this release.

    연천군 delivered a payment workbook, and every won in it is a 위탁처리
    payment. There is therefore no defensible collection-and-transport value, and
    the honest answer is UNAVAILABLE with a NULL — not 0 KRW and not 0 KRW/인,
    which would read as "this municipality spends nothing on collection".
    """

    report = run(accounting_basis_tree, session_factory, write=False)
    yeoncheon = _row(report, "연천군")

    assert yeoncheon["status"] == STATUS_UNAVAILABLE
    assert yeoncheon["value"] is None
    assert yeoncheon["numerator_krw"] is None
    assert yeoncheon["eligible_contract_count"] == 0
    # It says *why* there is no value, not merely that a payment is absent.
    assert REASON_NON_COLLECTION_TRANSPORT_BASIS in yeoncheon["reason_codes"]
    assert REASON_MISSING_PAYMENT in yeoncheon["reason_codes"]
    # The workbook was still accepted and its rows still exist.
    assert yeoncheon["source_file_count"] == 1


def test_unavailable_basis_row_is_written_as_null_never_zero(
    accounting_basis_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    run(accounting_basis_tree, session_factory, write=True)
    with session_factory() as session:
        geography = session.scalars(
            select(MunicipalCostGeography).where(
                MunicipalCostGeography.municipality_key == f"{METROPOLITAN_GYEONGGI}-연천군"
            )
        ).one()
        indicator = session.scalars(
            select(MunicipalCostIndicatorValue).where(
                MunicipalCostIndicatorValue.geography_id == geography.id
            )
        ).one()
    assert indicator.status == STATUS_UNAVAILABLE
    assert indicator.value is None
    assert indicator.numerator_amount_krw is None
    assert indicator.numerator_contract_count == 0


def test_mixed_municipality_sums_only_collection_transport_payment(
    accounting_basis_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(accounting_basis_tree, session_factory, write=False)
    hanam = _row(report, "하남시")

    assert hanam["status"] == STATUS_AVAILABLE
    # 1M + 2M + 3M, with the 1,275,847,930 처리용역 row left out.
    assert hanam["numerator_krw"] == "6000000"
    assert hanam["eligible_contract_count"] == 3
    assert REASON_NON_COLLECTION_TRANSPORT_BASIS in hanam["reason_codes"]


def test_excluded_contract_row_is_still_stored_with_its_amount(
    accounting_basis_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """Provenance survives exclusion, and none of it reaches the landfill table."""

    with session_factory() as session:
        landfill_before = session.scalar(select(func.count()).select_from(LandfillInboundMonthly))
    run(accounting_basis_tree, session_factory, write=True)
    with session_factory() as session:
        excluded = session.scalars(
            select(MunicipalWasteContract).where(
                MunicipalWasteContract.contract_name == "2024년 하남시 생활폐기물 처리용역"
            )
        ).one()
        stored = session.scalar(select(func.count()).select_from(MunicipalWasteContract))
        landfill_after = session.scalar(select(func.count()).select_from(LandfillInboundMonthly))

    assert excluded.payment_amount_krw == Decimal(1_275_847_930)
    assert excluded.is_primary_numerator_eligible is False
    assert REASON_NON_COLLECTION_TRANSPORT_BASIS in excluded.limitation_reasons
    # All 15 delivered contract rows are stored, the four excluded ones included
    # (연천군 2 + 하남시 4 + 광명시 8 + 군포시 1).
    assert stored == 15
    assert landfill_before == landfill_after == 0


def test_unaffected_municipality_keeps_its_full_numerator(
    accounting_basis_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    report = run(accounting_basis_tree, session_factory, write=False)
    gunpo = _row(report, "군포시")
    assert gunpo["status"] == STATUS_AVAILABLE
    assert gunpo["numerator_krw"] == "3782344860"
    assert REASON_NON_COLLECTION_TRANSPORT_BASIS not in gunpo["reason_codes"]


# ---------------------------------------------------------------------------
# Reviewed municipality limitations (the five the refresh stopped evidencing)
# ---------------------------------------------------------------------------


def _reviewed_limitation_tree(root: Path) -> Path:
    """DATA_A for the five reviewed municipalities, in 2024-refresh wording.

    Each file is written exactly as the refresh delivers it — no 지급월 ledger,
    no part-year 년도, no read-through scope annotation, no 읍·면 parenthetical —
    so nothing here can derive the limitation from the source. Whatever the five
    end up carrying therefore came from the reviewed table and nowhere else.

    군포시 is included as a control: an ordinary municipality with the same shape
    of workbook and no reviewed entry.
    """

    for filename, organisation, names in (
        (
            "남동구.xlsx",
            "남동구청",
            [f"2024년 남동구 생활폐기물 수집·운반 대행용역 {i}권역" for i in range(1, 4)],
        ),
        (
            "부평구.xlsx",
            "부평구청",
            [f"2024년 부평구 생활폐기물 수집·운반 대행계약 {i}권역" for i in range(1, 3)],
        ),
        (
            "옹진군.xlsx",
            "옹진군청",
            [
                "2024년 옹진군 생활쓰레기 수집·운반 용역",
                "2024년 옹진군 음식물쓰레기 수집·운반 용역",
            ],
        ),
        (
            "계양구.xlsx",
            "계양구청",
            [
                "2024년 계양구 생활폐기물 수집·운반 대행 용역 1권역",
                "2024년 계양구 음식물류폐기물 수집·운반 대행 용역 1권역",
                "2024년 계양구 재활용폐기물 수집·운반 대행 용역 1권역",
            ],
        ),
    ):
        write_workbook(
            root / "DATA_A" / "인천" / filename,
            HEADERS_FAMILY_2,
            [
                contract_row(year=2024, organisation=organisation, name=name, payment=1_000_000)
                for name in names
            ],
        )

    # 가평군 as delivered: bare 2024, and both contracts are 위탁처리.
    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "가평군.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                year=2024,
                organisation="가평군청",
                name=f"2024년 가평군 생활폐기물 외부 위탁처리 {index}차",
                payment=152_884_450,
            )
            for index in (1, 2)
        ],
    )
    write_workbook(
        root / "DATA_A" / GYEONGGI_A_FOLDER / "군포시.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                year=2024,
                organisation="군포시청",
                name="2024년 군포시 생활폐기물 수집·운반 대행용역 1구역",
                payment=3_782_344_860,
            )
        ],
    )
    return root


@pytest.fixture
def reviewed_limitation_tree(tmp_path: Path) -> Path:
    return _reviewed_limitation_tree(tmp_path / "reviewed")


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("남동구", REASON_PARTIAL_WASTE_SCOPE),
        ("부평구", REASON_PARTIAL_WASTE_SCOPE),
        ("옹진군", REASON_PARTIAL_GEOGRAPHIC_SCOPE),
        ("계양구", REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE),
    ],
)
def test_reviewed_limitation_degrades_the_five_to_partial(
    name: str,
    reason: str,
    reviewed_limitation_tree: Path,
    session_factory: sessionmaker[Session],
) -> None:
    """A workbook that stopped printing the evidence does not become complete."""

    report = run(reviewed_limitation_tree, session_factory, write=False)
    row = _row(report, name)
    assert row["status"] == STATUS_PARTIAL
    assert reason in row["reason_codes"]
    # PARTIAL, not blocked: the value is still served, with its caveat.
    assert row["value"] is not None


def test_reviewed_limitation_is_recorded_even_when_the_value_is_blocked(
    reviewed_limitation_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """가평군 is the fifth: its limitation stands, and a stronger one outranks it.

    Both of its 2024 contracts are 위탁처리, so there is no eligible payment to
    qualify — the period limitation is still reported, and the status is the
    stricter UNAVAILABLE rather than PARTIAL.
    """

    report = run(reviewed_limitation_tree, session_factory, write=False)
    gapyeong = _row(report, "가평군")
    assert REASON_PARTIAL_PERIOD_COVERAGE in gapyeong["reason_codes"]
    assert REASON_NON_COLLECTION_TRANSPORT_BASIS in gapyeong["reason_codes"]
    assert gapyeong["status"] == STATUS_UNAVAILABLE
    assert gapyeong["value"] is None


def test_reviewed_limitations_do_not_reach_other_municipalities(
    reviewed_limitation_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """Only the five named entries may carry a reviewed limitation."""

    report = run(reviewed_limitation_tree, session_factory, write=False)
    reviewed_keys = {
        limitation.municipality_key for limitation in REVIEWED_MUNICIPALITY_LIMITATIONS
    }
    reviewed_reasons = {limitation.reason for limitation in REVIEWED_MUNICIPALITY_LIMITATIONS}

    gunpo = _row(report, "군포시")
    assert gunpo["status"] == STATUS_AVAILABLE
    assert not reviewed_reasons.intersection(gunpo["reason_codes"])

    for row in report.municipalities:
        if row["municipality_key"] in reviewed_keys:
            continue
        # Every other municipality here has either no file or a clean one, so a
        # reviewed reason code appearing on one could only have leaked.
        assert not reviewed_reasons.intersection(row["reason_codes"]), row["municipality_key"]


def test_reviewed_limitation_needs_payment_evidence_to_qualify(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    """남동구 in the main tree has DATA_B tonnage only and no DATA_A payment.

    A limitation that qualifies *payment* evidence must not be attached where no
    payment workbook was delivered: the municipality is UNAVAILABLE for want of a
    payment, and claiming a partial waste scope on top would describe data that
    does not exist.
    """

    report = run(source_tree, session_factory, write=False)
    namdong = _row(report, "남동구")
    assert namdong["has_data_a"] is False
    assert namdong["status"] == STATUS_UNAVAILABLE
    assert REASON_PARTIAL_WASTE_SCOPE not in namdong["reason_codes"]


def test_every_reviewed_limitation_names_a_registry_municipality() -> None:
    """A typo in the reviewed table must not silently apply to nobody."""

    keys = {definition.municipality_key for definition in EXPECTED_MUNICIPALITIES}
    for limitation in REVIEWED_MUNICIPALITY_LIMITATIONS:
        assert limitation.municipality_key in keys
        assert limitation.reason in PARTIAL_REASONS
        assert limitation.evidence and limitation.omission_basis
        assert limitation.reference_year == YEAR


def test_reviewed_limitation_lookup_is_exact_not_a_prefix_match() -> None:
    assert find_reviewed_limitations(METROPOLITAN_INCHEON, "남동구", YEAR)
    # 남동구 must not be found from a longer or shorter name, from the wrong
    # metropolitan, or from another year.
    assert not find_reviewed_limitations(METROPOLITAN_INCHEON, "남동", YEAR)
    assert not find_reviewed_limitations(METROPOLITAN_INCHEON, "남동구청", YEAR)
    assert not find_reviewed_limitations(METROPOLITAN_SEOUL, "남동구", YEAR)
    assert not find_reviewed_limitations(METROPOLITAN_INCHEON, "남동구", 2023)


def test_unsupported_reference_year_is_refused(
    source_tree: Path, session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(Exception, match="2024"):
        run_municipal_cost_ingestion(
            source_dir=str(source_tree), year=2023, write=False, session_factory=session_factory
        )
