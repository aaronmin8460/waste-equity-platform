"""The scenario ANALYSIS SCOPE — the predicate, and where it lands in each query.

── WHAT THIS PINS ──────────────────────────────────────────────────────────────
후보지 심층 분석 lets a reader narrow the analysis to one 시·도 or a set of 시·군·구.
The scenario endpoints used to ignore that: every preview ranked the complete
capital-region ELIGIBLE population, so 후보지 심층 비교 compared two weight vectors
over a universe the reader had already narrowed away from. A/B is a comparison of
WEIGHTS; it must never also be a comparison of geographies.

These are pure tests — no database — because what they check is structural:

  * the predicate is built from the SAME canonical region-code space the
    ``/suitability/candidates`` route uses, so one 범위 means one set of rows on both;
  * an EMPTY scope produces no SQL at all, so 수도권 전체 is byte-for-byte the query
    this endpoint has always run;
  * the predicate sits INSIDE ``raw`` — before ``row_number()`` and before
    ``count(*) OVER ()`` — which is what makes ``custom_rank`` a rank within the 범위
    and ``ranking_population`` that 범위's size. Filtering after the window would
    produce capital-region ranks wearing a regional label, i.e. the original defect
    with extra steps;
  * every region code is a BOUND parameter. Only generated placeholder NAMES are
    interpolated.

The end-to-end behaviour against real PostGIS is covered by the integration tier in
``test_suitability_scenario_routes_integration.py``.
"""

from __future__ import annotations

from waste_equity_backend.analysis.suitability import component_model
from waste_equity_backend.api.routes.suitability_scenarios import (
    _candidate_rank_sql,
    _preview_sql,
    _score_expressions,
    _scope_predicate,
    _tile_sql,
)
from waste_equity_backend.schemas.scenario import (
    UserScenarioCandidateDetailRequest,
    UserWeightScenarioRequest,
)

# The historical model's own score expressions, so these scope tests exercise the
# builders exactly as the historical path calls them.
HIST = component_model.COMPONENT_MODEL_HISTORICAL
SCORE, PROV_NUM, PROV_DEN, PRESENT = _score_expressions(
    HIST, list(component_model.COMPONENT_ORDER_HISTORICAL)
)


def preview_sql(scope_sql: str) -> str:
    return _preview_sql(scope_sql, SCORE, PRESENT)


def rank_sql(scope_sql: str) -> str:
    return _candidate_rank_sql(scope_sql, SCORE, PRESENT)


def tile_sql(scope_sql: str) -> str:
    return _tile_sql(scope_sql, SCORE, PROV_NUM, PROV_DEN)


EQUAL_WEIGHTS = {
    "zoning": "0.25000000",
    "road": "0.25000000",
    "equity": "0.25000000",
    "demand": "0.25000000",
}


# --------------------------------------------------------------------------- #
# The predicate
# --------------------------------------------------------------------------- #


def test_empty_scope_emits_no_sql_and_no_params() -> None:
    """수도권 전체 must stay EXACTLY the query this endpoint has always run."""

    assert _scope_predicate(None, None) == ("", {})
    assert _scope_predicate(None, []) == ("", {})
    assert _scope_predicate("", []) == ("", {})


def test_sido_scope_binds_the_canonical_code() -> None:
    sql, params = _scope_predicate("KR-SGIS-31", [])
    assert sql == "AND c.sido_region_code = :scope_sido"
    assert params == {"scope_sido": "KR-SGIS-31"}


def test_bare_sgis_digits_are_normalized_to_the_canonical_code() -> None:
    """The frontend's ``ScopeSelection`` space ("31") is an accepted alias."""

    _, params = _scope_predicate("31", [])
    assert params == {"scope_sido": "KR-SGIS-31"}


def test_a_code_from_another_space_is_not_coerced_into_a_valid_one() -> None:
    """MOIS/landfill 시·도 codes differ from SGIS for 인천/경기.

    Such a code normalizes to a canonical code that exists nowhere and therefore
    matches NO rows — which is the safe failure. Silently rewriting it to a
    neighbouring space would return a DIFFERENT region's candidates under the
    reader's label, which is the one outcome worse than an empty ranking.
    """

    _, params = _scope_predicate("28", [])
    assert params == {"scope_sido": "KR-SGIS-28"}


def test_sigungu_scope_is_an_in_list_of_bound_placeholders() -> None:
    sql, params = _scope_predicate(None, ["KR-SGIS-23510", "KR-SGIS-23520"])
    assert sql == "AND c.sigungu_region_code IN (:scope_sigungu_0, :scope_sigungu_1)"
    assert params == {
        "scope_sigungu_0": "KR-SGIS-23510",
        "scope_sigungu_1": "KR-SGIS-23520",
    }
    # No region code is ever interpolated into the SQL — only placeholder names.
    for code in params.values():
        assert code not in sql


def test_sigungu_duplicates_and_blanks_collapse() -> None:
    """Repeating a code cannot change the result set, and a blank is not a filter."""

    sql, params = _scope_predicate(None, ["31011", "KR-SGIS-31011", "   ", ""])
    assert sql == "AND c.sigungu_region_code IN (:scope_sigungu_0)"
    assert params == {"scope_sigungu_0": "KR-SGIS-31011"}


def test_an_all_blank_sigungu_list_applies_NO_restriction() -> None:
    """A cleared multi-select returns to 수도권 전체, never to "match nothing"."""

    assert _scope_predicate(None, ["", "  "]) == ("", {})


def test_sido_and_sigungu_compose_with_AND() -> None:
    sql, params = _scope_predicate("KR-SGIS-31", ["31011"])
    assert "AND c.sido_region_code = :scope_sido" in sql
    assert "AND c.sigungu_region_code IN (:scope_sigungu_0)" in sql
    assert params == {"scope_sido": "KR-SGIS-31", "scope_sigungu_0": "KR-SGIS-31011"}


# --------------------------------------------------------------------------- #
# Where the predicate lands
# --------------------------------------------------------------------------- #


def test_preview_scope_precedes_the_ranking_window() -> None:
    """The rank must be computed WITHIN the 범위, not filtered after the fact."""

    scope_sql, _ = _scope_predicate("KR-SGIS-31", [])
    sql = preview_sql(scope_sql)
    assert sql.index(":scope_sido") < sql.index("row_number() OVER")


def test_preview_scope_precedes_the_population_count() -> None:
    """``ranking_population`` must be the 범위's size, not the capital region's."""

    scope_sql, _ = _scope_predicate("KR-SGIS-31", [])
    sql = preview_sql(scope_sql)
    assert sql.index(":scope_sido") < sql.index("count(*) OVER ()")


def test_preview_scope_is_inside_the_eligible_filter_block() -> None:
    """It ANDs onto the existing WHERE rather than replacing any of its conditions."""

    scope_sql, _ = _scope_predicate("KR-SGIS-31", [])
    sql = preview_sql(scope_sql)
    assert "c.status = 'ELIGIBLE'" in sql
    assert sql.index("c.status = 'ELIGIBLE'") < sql.index(":scope_sido")


def test_unscoped_queries_contain_no_scope_artefacts() -> None:
    """No stray placeholder, no empty AND — the query is unchanged for 수도권 전체."""

    for sql in (preview_sql(""), rank_sql(""), tile_sql("")):
        assert "scope_" not in sql
        assert "AND \n" not in sql


def test_candidate_rank_is_counted_within_the_scope() -> None:
    """A detail's rank must agree with the row the reader opened it from."""

    scope_sql, _ = _scope_predicate(None, ["KR-SGIS-23510"])
    sql = rank_sql(scope_sql)
    assert ":scope_sigungu_0" in sql
    # Inside the ranked set, before the count that produces the rank.
    assert sql.index(":scope_sigungu_0") < sql.index("SELECT count(*) + 1")


def test_tiles_are_scoped_so_the_map_matches_the_ranking() -> None:
    scope_sql, _ = _scope_predicate("KR-SGIS-23", [])
    sql = tile_sql(scope_sql)
    assert ":scope_sido" in sql
    # Inside `base`, alongside the tile-envelope predicate, so only in-scope cells
    # are transformed at all.
    assert sql.index(":scope_sido") < sql.index("ST_AsMVT(")


# --------------------------------------------------------------------------- #
# The request schemas
# --------------------------------------------------------------------------- #


def test_scope_is_optional_on_both_requests_and_defaults_to_the_whole_region() -> None:
    """Every existing caller keeps the population it had."""

    preview = UserWeightScenarioRequest(weights=EQUAL_WEIGHTS)
    assert preview.sido is None
    assert preview.sigungu == []

    detail = UserScenarioCandidateDetailRequest(weights=EQUAL_WEIGHTS)
    assert detail.sido is None
    assert detail.sigungu == []


def test_scope_round_trips_through_the_request_models() -> None:
    preview = UserWeightScenarioRequest(
        weights=EQUAL_WEIGHTS, sido="KR-SGIS-31", sigungu=["KR-SGIS-31011"]
    )
    assert preview.sido == "KR-SGIS-31"
    assert preview.sigungu == ["KR-SGIS-31011"]
