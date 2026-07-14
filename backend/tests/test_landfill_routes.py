"""SQLite-tier tests for the capital-region landfill inbound-flow API.

Seeds synthetic ``landfill_inbound_monthly`` rows and asserts aggregation,
filtering, derived effective-fee math, period completeness, the three-origin
flow output (never municipal), and evidence labels. All values are synthetic.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from waste_equity_backend.models import DataSource, LandfillInboundMonthly

NOW = datetime.datetime(2026, 7, 14, tzinfo=datetime.UTC)
SNAP = datetime.date(2026, 5, 31)
ORIGIN_NAME = {"KR-SGIS-11": "서울시", "KR-SGIS-28": "인천시", "KR-SGIS-41": "경기도"}


def _row(month: str, origin: str, waste: str, qty: str, fee: str) -> LandfillInboundMonthly:
    return LandfillInboundMonthly(
        reference_month=month,
        reference_year=int(month[:4]),
        origin_region_code=origin,
        origin_source_name=ORIGIN_NAME[origin],
        origin_region_level="SIDO",
        destination_code="SUDOKWON_LANDFILL",
        waste_name=waste,
        quantity_kg=Decimal(qty),
        inbound_fee_krw=Decimal(fee),
        quantity_unit="kg",
        fee_currency="KRW",
        accounting_basis="VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
        quantity_source_dataset_id="15064381",
        quantity_source_snapshot_uuid="uddi-quantity",
        quantity_source_snapshot_date=SNAP,
        fee_source_dataset_id="15064394",
        fee_source_snapshot_uuid="uddi-fee",
        fee_source_snapshot_date=SNAP,
        quantity_evidence_status="OFFICIAL_REPORTED_VALUE",
        fee_evidence_status="OFFICIAL_REPORTED_VALUE",
        retrieved_at=NOW,
        transformation_version="landfill-inbound-v1",
        ingestion_run_id=1,
        created_at=NOW,
        updated_at=NOW,
    )


def _seed(session: Session) -> None:
    for source_id, name in (("15064381", "반입량"), ("15064394", "반입수수료")):
        session.add(
            DataSource(
                source_id=source_id,
                source_name="수도권매립지관리공사",
                dataset_name=name,
                endpoint="https://api.odcloud.kr/api",
                publication_frequency="MONTHLY",
                enabled=True,
                documentation_url=None,
            )
        )
    rows: list[LandfillInboundMonthly] = []
    # 2024 complete year: Seoul 생활 every month (1,000,000 kg / 50,000,000 KRW).
    for m in range(1, 13):
        rows.append(_row(f"2024-{m:02d}", "KR-SGIS-11", "생활", "1000000", "50000000"))
    # 2024-01 extra origins / wastes.
    rows.append(_row("2024-01", "KR-SGIS-41", "생활", "2000000", "180000000"))
    rows.append(_row("2024-01", "KR-SGIS-28", "생활", "500000", "45000000"))
    rows.append(_row("2024-01", "KR-SGIS-11", "건설", "3000000", "90000000"))
    rows.append(_row("2024-01", "KR-SGIS-11", "낙엽", "0", "0"))  # zero-quantity row
    # 2025 partial year (Jan–May), Seoul 생활 only.
    for m in range(1, 6):
        rows.append(_row(f"2025-{m:02d}", "KR-SGIS-11", "생활", "800000", "40000000"))
    session.add_all(rows)
    session.commit()


def test_summary_empty_database_returns_404(client: TestClient) -> None:
    response = client.get("/api/v1/landfill/summary")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_DATA_AVAILABLE"


def test_summary_defaults_to_latest_complete_year(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary").json()
    # 2024 is the latest complete year (2025 is partial), so it is the default.
    assert body["period"]["year"] == 2024
    assert body["period"]["is_complete_year"] is True
    assert body["period"]["latest_available_month"] == "2025-05"
    # Totals: Seoul 15,000,000 + Gyeonggi 2,000,000 + Incheon 500,000 = 17,500,000 kg.
    assert Decimal(body["total_quantity_kg"]) == Decimal("17500000")
    assert Decimal(body["total_quantity_tons"]) == Decimal("17500.000000")
    assert Decimal(body["total_inbound_fee_krw"]) == Decimal("915000000")
    # 915,000,000 / 17,500 t = 52,285.71 KRW/t (2 dp).
    assert Decimal(body["effective_fee_per_ton"]) == Decimal("52285.71")
    # Largest origin is Seoul; three origins present.
    assert body["largest_origin_share"]["origin_sgis_code"] == "11"
    assert Decimal(body["largest_origin_share"]["quantity_share"]) == Decimal("0.857143")
    assert {o["origin_sgis_code"] for o in body["origin_shares"]} == {"11", "28", "41"}
    assert body["largest_waste_share"]["waste_name"] == "생활"
    assert body["accounting_basis"] == "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"


def test_summary_evidence_and_sources(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    assert body["evidence"]["quantity_status"] == "OFFICIAL_REPORTED_VALUE"
    assert body["evidence"]["fee_status"] == "OFFICIAL_REPORTED_VALUE"
    assert body["evidence"]["derived_status"] == "OFFICIAL_INPUTS_DERIVED_VALUE"
    ids = {s["dataset_id"] for s in body["sources"]}
    assert ids == {"15064381", "15064394"}
    for source in body["sources"]:
        assert source["snapshot_date"] == "2026-05-31"
    # Both mandated caveats are present.
    joined = " ".join(body["caveats"])
    assert "시·군·구별 반입량을 의미하지 않습니다" in joined
    assert "순수 운송비 또는 전체 폐기물 관리비가 아닙니다" in joined


def test_summary_origin_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    incheon = client.get("/api/v1/landfill/summary?year=2024&origin=28").json()
    assert incheon["origin_filter"] == "28"
    assert Decimal(incheon["total_quantity_kg"]) == Decimal("500000")
    assert {o["origin_sgis_code"] for o in incheon["origin_shares"]} == {"28"}


def test_summary_waste_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024&waste_name=건설").json()
    assert Decimal(body["total_quantity_kg"]) == Decimal("3000000")
    assert {w["waste_name"] for w in body["top_waste_types"]} == {"건설"}


def test_summary_month_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024&month=2").json()
    assert body["period"]["month"] == "2024-02"
    # Only Seoul 생활 exists in 2024-02.
    assert Decimal(body["total_quantity_kg"]) == Decimal("1000000")


def test_summary_partial_year_metadata(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2025").json()
    assert body["period"]["is_complete_year"] is False
    assert body["period"]["available_through_month"] == "2025-05"


def test_summary_invalid_origin_returns_422(client: TestClient, session: Session) -> None:
    _seed(session)
    assert client.get("/api/v1/landfill/summary?origin=99").status_code == 422


def test_composition_zero_quantity_effective_fee_null(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/composition?year=2024").json()
    names = {w["waste_name"]: w for w in body["waste_types"]}
    assert names["낙엽"]["effective_fee_per_ton"] is None
    assert Decimal(names["낙엽"]["quantity_share"]) == Decimal("0.000000")
    assert names["생활"]["effective_fee_per_ton"] is not None


def test_trends_default_latest_complete_year(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/trends").json()
    assert body["start_month"] == "2024-01"
    assert body["end_month"] == "2024-12"
    assert len(body["points"]) == 12
    first = next(p for p in body["points"] if p["reference_month"] == "2024-01")
    # 2024-01 sums all seeded origins/wastes: 1,000,000 + 2,000,000 + 500,000 + 3,000,000 + 0.
    assert Decimal(first["quantity_kg"]) == Decimal("6500000")


def test_flows_three_origins_one_destination_no_municipal(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/flows?year=2024").json()
    assert body["origin_level"] == "SIDO"
    assert len(body["flows"]) == 3
    assert {f["origin_sgis_code"] for f in body["flows"]} == {"11", "28", "41"}
    for flow in body["flows"]:
        assert flow["destination_code"] == "SUDOKWON_LANDFILL"
        assert flow["evidence_status"] == "OFFICIAL_REPORTED_VALUE"
        assert "lon" in flow["origin_point"] and "lat" in flow["destination_point"]
    assert body["destination"]["code"] == "SUDOKWON_LANDFILL"
    assert body["destination"]["coordinate_provenance"]
    # Sorted by quantity desc → Seoul (15M) first.
    assert body["flows"][0]["origin_sgis_code"] == "11"


def test_flows_waste_filter_still_only_metropolitan(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/flows?year=2024&waste_name=생활").json()
    # 건설/낙엽 excluded; still only metropolitan origins, no municipal rows.
    assert {f["origin_sgis_code"] for f in body["flows"]} <= {"11", "28", "41"}
    seoul = next(f for f in body["flows"] if f["origin_sgis_code"] == "11")
    assert Decimal(seoul["quantity_kg"]) == Decimal("12000000")
