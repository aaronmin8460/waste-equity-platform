"""Scope/ordering integration tests for GET /api/v1/suitability/candidates (Page 4B).

Runs only when TEST_DATABASE_URL is set. A synthetic run with candidates spread
across the three capital-region SIDOs and several SIGUNGUs is seeded with
remote-ocean geometry inside a rolled-back outer transaction, so the real analysis
data is never touched.

The seed deliberately mirrors two facts about the *real* region code space that the
filter contract depends on (see docs/SUITABILITY_SCOPE_FILTER_API.md):

* codes are canonical ``KR-SGIS-<adm_cd>`` values (SIDO 11 서울 / 23 인천 / 31 경기),
  NOT the landfill administrative space 11/28/41 and not the bare frontend scope
  code; and
* the large Gyeonggi cities are stored at 일반구 granularity, so one city on the
  Figma (안산시) is *two* SIGUNGU codes — which is exactly why the parameter has to
  be repeatable and OR-ed.

Nothing here computes or asserts a score, weight, status, or rank *value*: these
tests only fix which stored rows a filter selects and in what order.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import SuitabilityAnalysisRun, SuitabilityCandidate

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

BASE = "/api/v1/suitability/candidates"
NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
STATIC_PROFILES = ["baseline", "equal", "equity_focused", "access_focused"]
ALL_PROFILES = [*STATIC_PROFILES, "critic"]
RUN_WEIGHT_PROFILES = {
    "baseline": {"zoning": "0.35", "road": "0.25", "equity": "0.25", "demand": "0.15"},
    "equal": {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"},
    "equity_focused": {"zoning": "0.30", "road": "0.15", "equity": "0.40", "demand": "0.15"},
    "access_focused": {"zoning": "0.25", "road": "0.40", "equity": "0.20", "demand": "0.15"},
    "critic": {"zoning": "0.30", "road": "0.20", "equity": "0.35", "demand": "0.15"},
}

SEOUL = "KR-SGIS-11"
INCHEON = "KR-SGIS-23"
GYEONGGI = "KR-SGIS-31"
JONGNO = "KR-SGIS-11010"
JUNG = "KR-SGIS-11020"
GANGHWA = "KR-SGIS-23310"
# 안산시 is stored as its two 일반구 — the multi-value case the Figma city implies.
ANSAN_SANGNOK = "KR-SGIS-31091"
ANSAN_DANWON = "KR-SGIS-31092"
SIHEUNG = "KR-SGIS-31150"


@pytest.fixture
def pg_session() -> Iterator[Session]:
    engine = create_engine(str(TEST_DATABASE_URL))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def pg_client(pg_session: Session) -> Iterator[TestClient]:
    app = create_app()

    def override() -> Iterator[Session]:
        yield pg_session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as test_client:
        yield test_client


def _poly(x: float) -> WKTElement:
    return WKTElement(
        f"MULTIPOLYGON((({x} 30, {x + 0.1} 30, {x + 0.1} 30.1, {x} 30.1, {x} 30)))", srid=4326
    )


def _pt(x: float) -> WKTElement:
    return WKTElement(f"POINT({x + 0.05} 30.05)", srid=4326)


def _eligible(
    run_id: int,
    key: str,
    x: float,
    *,
    sido: str,
    sigungu: str | None,
    baseline_rank: int,
    critic_rank: int,
    stability_class: str,
) -> SuitabilityCandidate:
    """An ELIGIBLE candidate whose baseline and critic ranks are set independently.

    The first-class ``rank`` column is the *active* profile's rank (baseline for this
    run), which is what the unbounded listing orders by; ``profile_ranks`` carries every
    profile, which is what ``top`` orders by. Giving critic the reverse order makes the
    difference between the two observable.
    """
    return _candidate(
        run_id,
        key,
        x,
        sido=sido,
        sigungu=sigungu,
        status="ELIGIBLE",
        rank=baseline_rank,
        total_score=Decimal("90.0000") - baseline_rank,
        profile_totals={
            **{p: f"{90 - baseline_rank}.0000" for p in STATIC_PROFILES},
            "critic": f"{90 - critic_rank}.0000",
        },
        profile_ranks={
            **dict.fromkeys(STATIC_PROFILES, baseline_rank),
            "critic": critic_rank,
        },
        stable_count={"STABLE": 3, "CONDITIONALLY_STABLE": 2, "WEIGHT_SENSITIVE": 1}[
            stability_class
        ],
        stability_class=stability_class,
    )


def _candidate(
    run_id: int,
    key: str,
    x: float,
    *,
    sido: str,
    sigungu: str | None,
    **over: Any,
) -> SuitabilityCandidate:
    base: dict[str, Any] = {
        "analysis_run_id": run_id,
        "candidate_key": key,
        "sido_region_code": sido,
        "sido_region_name": sido,
        "sigungu_region_code": sigungu,
        "sigungu_region_name": sigungu,
        "status": "ELIGIBLE",
        "rank": None,
        "provisional_score": None,
        "total_score": None,
        "zoning_score": Decimal("55.0000"),
        "road_score": Decimal("100.0000"),
        "equity_score": Decimal("100.0000"),
        "demand_score": Decimal("50.0000"),
        "profile_totals": {},
        "profile_ranks": {},
        "raw_components": {},
        "exclusion_reasons": [],
        "review_reasons": [],
        "penalties": [],
        "nearest_road_distance_m": None,
        "nearest_road_provenance": {},
        "component_provenance": {},
        "original_area_m2": Decimal("250000.00"),
        "clipped_area_m2": Decimal("250000.00"),
        "clipped_area_ratio": Decimal("1.00000"),
        "centroid": _pt(x),
        "geometry": _poly(x),
        "created_at": NOW,
    }
    base.update(over)
    return SuitabilityCandidate(**base)


@pytest.fixture
def scoped(pg_session: Session) -> dict[str, Any]:
    """Seven candidates: five ELIGIBLE (ranked 1..5), one REVIEW, one EXCLUDED.

    ``baseline`` ranks run 1..5 across 서울/인천/경기; ``critic`` ranks run 5..1, i.e.
    exactly reversed, so a profile switch is visible in ``top`` ordering. The EXCLUDED
    cell carries a NULL SIGUNGU, mirroring the 553 real cells whose centroid falls
    outside every SIGUNGU polygon.
    """
    run = SuitabilityAnalysisRun(
        derivation_version="suitability-screening-v3",
        policy_version="suitability-policy-v2",
        candidate_grid_version="capital-grid-500m-v1",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="baseline",
        analysis_signature="scope-filter-test-sig",
        status="SUCCEEDED",
        candidate_count_total=7,
        candidate_count_eligible=5,
        candidate_count_review=1,
        candidate_count_excluded=1,
        input_dataset_version_ids=[1],
        input_provenance={},
        policy_snapshot={},
        weight_profiles=RUN_WEIGHT_PROFILES,
        weight_derivation={},
        stability_definition={"top_fraction": "0.10", "top_cutoff_rank": 1},
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
    )
    pg_session.add(run)
    pg_session.flush()

    spec = [
        # key, x, sido, sigungu, baseline rank, critic rank, stability
        ("a", 30.0, SEOUL, JONGNO, 1, 5, "STABLE"),
        ("b", 30.3, SEOUL, JUNG, 2, 4, "WEIGHT_SENSITIVE"),
        ("c", 30.6, INCHEON, GANGHWA, 3, 3, "STABLE"),
        ("d", 30.9, GYEONGGI, ANSAN_SANGNOK, 4, 2, "CONDITIONALLY_STABLE"),
        ("e", 31.2, GYEONGGI, ANSAN_DANWON, 5, 1, "STABLE"),
    ]
    rows = {
        name: _eligible(
            run.id,
            f"capital-grid-500m-v1:{name}",
            x,
            sido=sido,
            sigungu=sigungu,
            baseline_rank=b,
            critic_rank=cr,
            stability_class=stab,
        )
        for name, x, sido, sigungu, b, cr, stab in spec
    }
    rows["f"] = _candidate(
        run.id,
        "capital-grid-500m-v1:f",
        31.5,
        sido=GYEONGGI,
        sigungu=SIHEUNG,
        status="REVIEW_REQUIRED",
        provisional_score=Decimal("50.0000"),
        profile_totals=dict.fromkeys(ALL_PROFILES, "50.0000"),
        review_reasons=["MISSING_DEMAND_COMPONENT"],
    )
    rows["g"] = _candidate(
        run.id,
        "capital-grid-500m-v1:g",
        31.8,
        sido=GYEONGGI,
        sigungu=None,
        status="EXCLUDED",
        exclusion_reasons=["PROJECT_SCREENING_EXCLUSION:UD801"],
    )
    pg_session.add_all(list(rows.values()))
    pg_session.flush()
    return {"run": run.id, **{name: row.id for name, row in rows.items()}}


def _get(client: TestClient, run: int, query: str = "") -> dict[str, Any]:
    response = client.get(f"{BASE}?run_id={run}{query}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _keys(body: dict[str, Any]) -> list[str]:
    return [f["properties"]["candidate_key"] for f in body["features"]]


# --------------------------------------------------------------------------- #
# Region code space
# --------------------------------------------------------------------------- #


def test_canonical_and_bare_sido_select_the_same_rows(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """``KR-SGIS-11`` and the bare frontend scope code ``11`` are the same filter."""
    run = scoped["run"]
    canonical = _get(pg_client, run, f"&sido={SEOUL}")
    bare = _get(pg_client, run, "&sido=11")
    assert canonical["total_matched"] == 2
    assert _keys(canonical) == _keys(bare)
    # The applied scope is echoed in canonical form either way, so a caller can see
    # which code space the server actually queried.
    assert canonical["sido"] == bare["sido"] == SEOUL


def test_landfill_administrative_sido_code_matches_nothing(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """28/41 are the landfill space, not this one: they must not silently return 인천/경기.

    An empty result is the honest answer — normalizing ``28`` to ``KR-SGIS-28`` yields a
    code that does not exist in this table, so the caller sees zero rather than Incheon's
    candidates under a wrong code.
    """
    run = scoped["run"]
    for wrong in ("28", "41", "KR-SGIS-28", "KR-SGIS-41"):
        body = _get(pg_client, run, f"&sido={wrong}")
        assert body["total_matched"] == 0, wrong
        assert body["features"] == []


def test_unknown_sigungu_is_empty_not_error(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    for unknown in ("KR-SGIS-99999", "99999", "not-a-code"):
        body = _get(pg_client, run, f"&sigungu={unknown}")
        assert body["total_matched"] == 0, unknown
        assert body["count"] == 0


# --------------------------------------------------------------------------- #
# Multi-SIGUNGU
# --------------------------------------------------------------------------- #


def test_zero_sigungu_values_do_not_restrict(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    """An absent or blank repeated parameter means "no restriction", never "match none"."""
    run = scoped["run"]
    unscoped = _get(pg_client, run)
    assert unscoped["total_matched"] == 7
    assert unscoped["sigungu"] == []
    blank = _get(pg_client, run, "&sigungu=&sigungu=")
    assert blank["total_matched"] == 7
    assert blank["sigungu"] == []


def test_single_sigungu(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    body = _get(pg_client, scoped["run"], f"&sigungu={JONGNO}")
    assert body["total_matched"] == 1
    assert _keys(body) == ["capital-grid-500m-v1:a"]
    assert body["sigungu"] == [JONGNO]


def test_multiple_sigungu_is_or_not_and(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    """안산시 = 상록구 OR 단원구. An AND would return nothing; a union returns both."""
    body = _get(pg_client, scoped["run"], f"&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}")
    assert body["total_matched"] == 2
    assert _keys(body) == ["capital-grid-500m-v1:d", "capital-grid-500m-v1:e"]


def test_three_sigungu_across_sidos(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    body = _get(pg_client, scoped["run"], f"&sigungu={JONGNO}&sigungu={GANGHWA}&sigungu={SIHEUNG}")
    assert body["total_matched"] == 3
    assert set(_keys(body)) == {
        "capital-grid-500m-v1:a",
        "capital-grid-500m-v1:c",
        "capital-grid-500m-v1:f",
    }


def test_duplicate_sigungu_does_not_change_the_result(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    run = scoped["run"]
    once = _get(pg_client, run, f"&sigungu={JONGNO}&sigungu={JUNG}")
    twice = _get(pg_client, run, f"&sigungu={JONGNO}&sigungu={JUNG}&sigungu={JONGNO}&sigungu=11020")
    assert once["total_matched"] == twice["total_matched"] == 2
    assert _keys(once) == _keys(twice)
    # De-duplication is visible in the echo, so a caller can tell the repeat collapsed.
    assert twice["sigungu"] == [JONGNO, JUNG]


def test_bare_and_canonical_sigungu_mix(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    body = _get(pg_client, scoped["run"], f"&sigungu=11010&sigungu={JUNG}")
    assert body["total_matched"] == 2
    assert body["sigungu"] == [JONGNO, JUNG]


def test_sigungu_filter_excludes_null_sigungu_cells(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """A cell with no SIGUNGU can never satisfy a SIGUNGU filter — including via NOT IN."""
    run = scoped["run"]
    all_sigungu = "".join(
        f"&sigungu={code}" for code in (JONGNO, JUNG, GANGHWA, ANSAN_SANGNOK, ANSAN_DANWON, SIHEUNG)
    )
    body = _get(pg_client, run, all_sigungu)
    # 6 of the 7 seeded rows; the NULL-SIGUNGU EXCLUDED cell is not among them.
    assert body["total_matched"] == 6
    assert "capital-grid-500m-v1:g" not in _keys(body)


# --------------------------------------------------------------------------- #
# Combination matrix
# --------------------------------------------------------------------------- #


def test_sido_and_sigungu_combine_with_and(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    """The two scope filters intersect: a SIGUNGU outside the SIDO yields nothing."""
    run = scoped["run"]
    consistent = _get(pg_client, run, f"&sido={SEOUL}&sigungu={JONGNO}")
    assert consistent["total_matched"] == 1
    contradictory = _get(pg_client, run, f"&sido={SEOUL}&sigungu={GANGHWA}")
    assert contradictory["total_matched"] == 0


def test_status_and_sigungu(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    review = _get(pg_client, run, f"&status=REVIEW_REQUIRED&sigungu={SIHEUNG}")
    assert review["total_matched"] == 1
    assert _keys(review) == ["capital-grid-500m-v1:f"]
    # Same SIGUNGU, different status -> empty, not the review row.
    assert _get(pg_client, run, f"&status=ELIGIBLE&sigungu={SIHEUNG}")["total_matched"] == 0


def test_stability_class_and_sigungu(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    stable_ansan = _get(
        pg_client,
        run,
        f"&stability_class=STABLE&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}",
    )
    # 상록구 is CONDITIONALLY_STABLE, 단원구 is STABLE.
    assert stable_ansan["total_matched"] == 1
    assert _keys(stable_ansan) == ["capital-grid-500m-v1:e"]


def test_profile_and_sido(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    """A profile switch changes the served rank, not which rows the scope selects."""
    run = scoped["run"]
    baseline = _get(pg_client, run, f"&sido={GYEONGGI}&profile=baseline")
    critic = _get(pg_client, run, f"&sido={GYEONGGI}&profile=critic")
    # 경기: two ELIGIBLE (d, e) plus the REVIEW and the EXCLUDED cell.
    assert baseline["total_matched"] == critic["total_matched"] == 4
    ranks = {f["properties"]["candidate_key"]: f["properties"]["rank"] for f in critic["features"]}
    assert ranks["capital-grid-500m-v1:d"] == 2
    assert ranks["capital-grid-500m-v1:e"] == 1


def test_profile_and_sigungu_reorders_top(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    """``top`` orders by the *requested* profile's rank, so critic reverses the order."""
    run = scoped["run"]
    baseline = _get(pg_client, run, "&top=5&profile=baseline")
    critic = _get(pg_client, run, "&top=5&profile=critic")
    assert _keys(baseline) == [f"capital-grid-500m-v1:{n}" for n in "abcde"]
    assert _keys(critic) == [f"capital-grid-500m-v1:{n}" for n in "edcba"]


# --------------------------------------------------------------------------- #
# Sort direction
# --------------------------------------------------------------------------- #


def test_default_sort_is_unchanged_by_the_new_parameter(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """Omitting ``sort`` and passing the default produce byte-identical bodies."""
    run = scoped["run"]
    implicit = pg_client.get(f"{BASE}?run_id={run}")
    explicit = pg_client.get(f"{BASE}?run_id={run}&sort=score_desc")
    assert implicit.json() == explicit.json()
    assert implicit.json()["sort"] == "score_desc"


def test_sort_asc_reverses_the_scored_order(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    desc = _get(pg_client, run, "&sort=score_desc")
    asc = _get(pg_client, run, "&sort=score_asc")
    # Only the five ELIGIBLE cells carry a rank; they reverse.
    assert _keys(desc)[:5] == [f"capital-grid-500m-v1:{n}" for n in "abcde"]
    assert _keys(asc)[:5] == [f"capital-grid-500m-v1:{n}" for n in "edcba"]
    assert desc["total_matched"] == asc["total_matched"] == 7


def test_unranked_candidates_stay_last_in_both_directions(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """REVIEW/EXCLUDED cells have no score, so ascending must not present them as lowest."""
    run = scoped["run"]
    for direction in ("score_desc", "score_asc"):
        keys = _keys(_get(pg_client, run, f"&sort={direction}"))
        assert set(keys[-2:]) == {"capital-grid-500m-v1:f", "capital-grid-500m-v1:g"}, direction


def test_sort_asc_with_top_selects_the_other_end(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """``top`` bounds the page; ``sort`` picks which end of the ranking it is drawn from."""
    run = scoped["run"]
    best = _get(pg_client, run, "&top=2&sort=score_desc")
    worst = _get(pg_client, run, "&top=2&sort=score_asc")
    assert _keys(best) == ["capital-grid-500m-v1:a", "capital-grid-500m-v1:b"]
    assert _keys(worst) == ["capital-grid-500m-v1:e", "capital-grid-500m-v1:d"]
    # `top` counts the whole eligible set it draws from, independent of direction.
    assert best["total_matched"] == worst["total_matched"] == 5


def test_sort_within_scope(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    scope = f"&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}&sigungu={JONGNO}"
    desc = _get(pg_client, run, f"{scope}&sort=score_desc")
    asc = _get(pg_client, run, f"{scope}&sort=score_asc")
    assert _keys(desc) == [
        "capital-grid-500m-v1:a",
        "capital-grid-500m-v1:d",
        "capital-grid-500m-v1:e",
    ]
    assert _keys(asc) == list(reversed(_keys(desc)))
    assert desc["total_matched"] == asc["total_matched"] == 3


def test_invalid_sort_is_422(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    assert pg_client.get(f"{BASE}?run_id={scoped['run']}&sort=asc").status_code == 422
    assert pg_client.get(f"{BASE}?run_id={scoped['run']}&sort=score_desc ").status_code == 422
    # No arbitrary sort-field selection exists.
    assert pg_client.get(f"{BASE}?run_id={scoped['run']}&sort=equity_score").status_code == 422


# --------------------------------------------------------------------------- #
# Pagination + total_matched
# --------------------------------------------------------------------------- #


def test_multi_sigungu_pagination_is_deterministic_and_complete(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    """Paging a multi-SIGUNGU scope one row at a time yields each candidate exactly once."""
    run = scoped["run"]
    scope = f"&sigungu={JONGNO}&sigungu={JUNG}&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}"
    seen: list[str] = []
    for offset in range(4):
        page = _get(pg_client, run, f"{scope}&limit=1&offset={offset}")
        assert page["total_matched"] == 4
        assert page["count"] == 1
        seen.extend(_keys(page))
    assert seen == [f"capital-grid-500m-v1:{n}" for n in "abde"]
    assert len(set(seen)) == 4


def test_pagination_is_deterministic_ascending_too(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    run = scoped["run"]
    scope = f"&sigungu={JONGNO}&sigungu={JUNG}&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}"
    seen: list[str] = []
    for offset in range(4):
        seen.extend(_keys(_get(pg_client, run, f"{scope}&sort=score_asc&limit=1&offset={offset}")))
    assert seen == [f"capital-grid-500m-v1:{n}" for n in "edba"]


def test_total_matched_is_the_filtered_count_not_the_page_length(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    run = scoped["run"]
    scope = f"&sigungu={JONGNO}&sigungu={JUNG}&sigungu={ANSAN_SANGNOK}&sigungu={ANSAN_DANWON}"
    page = _get(pg_client, run, f"{scope}&limit=2")
    assert page["count"] == 2
    assert page["total_matched"] == 4
    assert page["limit"] == 2
    assert page["offset"] == 0
    # An offset past the end still reports the same authoritative total.
    tail = _get(pg_client, run, f"{scope}&limit=2&offset=4")
    assert tail["count"] == 0
    assert tail["total_matched"] == 4


def test_total_matched_tracks_every_filter(pg_client: TestClient, scoped: dict[str, Any]) -> None:
    run = scoped["run"]
    assert _get(pg_client, run)["total_matched"] == 7
    assert _get(pg_client, run, f"&sido={GYEONGGI}")["total_matched"] == 4
    assert _get(pg_client, run, f"&sido={GYEONGGI}&status=ELIGIBLE")["total_matched"] == 2
    assert _get(pg_client, run, f"&sido={GYEONGGI}&stability_class=STABLE")["total_matched"] == 1
    assert _get(pg_client, run, f"&sigungu={ANSAN_SANGNOK}&sigungu={SIHEUNG}")["total_matched"] == 2


def test_bbox_still_composes_with_the_new_scope_filters(
    pg_client: TestClient, scoped: dict[str, Any]
) -> None:
    run = scoped["run"]
    # A viewport around candidates a and b only, intersected with a 종로구 scope.
    body = _get(pg_client, run, f"&bbox=29.9,29.9,30.25,30.2&sigungu={JONGNO}&sigungu={JUNG}")
    assert body["total_matched"] == 1
    assert _keys(body) == ["capital-grid-500m-v1:a"]
