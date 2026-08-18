"""``sigungu_representatives`` — one representative CANDIDATE per 시·군·구.

Page 5 compares REGIONS, but the real V3 successor run is extremely concentrated:
under the baseline weights the capital region's top FORTY-ONE candidates are all
경기도 양평군, and its top 2,189 span only nine 시·군·구. A plain ``top_n`` cut
therefore renders a "10 municipality" comparison that shows one municipality.

The flag moves the LIMIT from candidates to distinct 시·군·구. What it must NOT do
is become an aggregation, and that is what this module pins:

  * the ranking, the scope predicate and ``ranking_population`` are untouched;
  * the row kept per group is a REAL candidate — the group's highest-ranked one —
    still carrying its own ``custom_rank`` and ``custom_score``;
  * no 시·군·구 score and no 시·군·구 rank is computed anywhere;
  * the flag is OFF by default, so Page 4 and every other caller are unaffected.

These are SQL-shape assertions rather than round-trips: the query text is what the
route hands to the database, and the real-data behaviour is covered by the Page-5
QA pass against the local PostGIS run.
"""

from __future__ import annotations

from waste_equity_backend.api.routes import suitability_scenarios as routes
from waste_equity_backend.schemas.scenario import UserWeightScenarioRequest


def _plain() -> str:
    return routes._preview_sql("", "RAW_SCORE", "")


def _representatives() -> str:
    return routes._preview_sql("", "RAW_SCORE", "", representatives=True)


class TestDefaultIsUnchanged:
    def test_flag_defaults_to_off(self) -> None:
        request = UserWeightScenarioRequest(weights={"zoning": "0.25"})
        assert request.sigungu_representatives is False

    def test_plain_query_is_the_candidate_cut_it_always_was(self) -> None:
        sql = _plain()
        assert "DISTINCT ON" not in sql
        assert "representatives AS" not in sql
        assert sql.rstrip().endswith("SELECT * FROM ranked ORDER BY custom_rank ASC LIMIT :top_n")

    def test_the_two_modes_differ_ONLY_in_the_final_cut(self) -> None:
        # Everything before the tail — the scope, the scoring, the window — is
        # character-for-character identical, so turning the flag on cannot change
        # which candidates are ranked or how.
        marker = "SELECT * FROM ranked ORDER BY custom_rank ASC LIMIT :top_n"
        shared = _plain()[: _plain().index(marker)]
        assert _representatives().startswith(shared)


class TestRepresentativeCut:
    def test_keeps_one_row_per_sigungu(self) -> None:
        sql = _representatives()
        assert "DISTINCT ON" in sql
        assert sql.rstrip().endswith(
            "SELECT * FROM representatives ORDER BY custom_rank ASC LIMIT :top_n"
        )

    def test_the_kept_row_is_the_groups_BEST_RANKED_candidate(self) -> None:
        # DISTINCT ON keeps the first row under its own ORDER BY, so that ORDER BY
        # must lead with the group key and then ascend by rank. Ascending rank is
        # what makes the survivor the best-ranked cell rather than an arbitrary one.
        sql = _representatives()
        distinct_body = sql[sql.index(", representatives AS") :]
        assert "ranked.custom_rank ASC" in distinct_body

    def test_groups_by_sigungu_then_sido_then_one_unassigned_bucket(self) -> None:
        # The SAME identity the frontend's `sigunguGroupKeyOf` builds: the 시·군·구
        # name, the 시·도 as the fallback for a partly located cell, and a single
        # bucket for a cell with neither.
        sql = _representatives()
        assert "nullif(btrim(ranked.sigungu_region_name), '')" in sql
        assert "nullif(btrim(ranked.sido_region_name), '')" in sql

    def test_population_still_counts_the_WHOLE_scoped_population(self) -> None:
        # `count(*) OVER ()` is stamped on every row inside `ranked`, i.e. BEFORE the
        # dedupe, so thinning the rows afterwards cannot shrink it. A representative
        # response must still be able to say "순위 대상 13,734개".
        sql = _representatives()
        ranked_block = sql[sql.index("ranked AS (") : sql.index(", representatives AS")]
        assert "count(*) OVER () AS ranking_population" in ranked_block

    def test_the_scope_predicate_still_precedes_the_window(self) -> None:
        # The scoped-ranking guarantee: filtering happens in `raw`, so `custom_rank`
        # is the rank WITHIN the 범위 in representative mode too.
        sql = routes._preview_sql(
            "AND c.sido_region_code = :sido", "RAW_SCORE", "", representatives=True
        )
        assert sql.index("AND c.sido_region_code = :sido") < sql.index("row_number() OVER")


class TestNoAggregateIsIntroduced:
    def test_no_average_median_sum_or_synthetic_group_rank_anywhere(self) -> None:
        sql = _representatives().lower()
        for banned in ("avg(", "percentile_cont", "percentile_disc", "sum(", "stddev"):
            assert banned not in sql, f"{banned} would make the 시·군·구 a scored object"

    def test_the_only_window_function_is_the_candidate_ranking(self) -> None:
        # `row_number()` over the candidate ranking and `count(*)` for the population,
        # and nothing partitioned BY 시·군·구 — a per-group window would be the first
        # step toward a municipality rank.
        sql = _representatives().lower()
        assert "partition by" not in sql
        # Exactly two windows: the ranking itself, and the unpartitioned population
        # count. ("over (" would also match "over ()", so they are counted apart.)
        assert sql.count("over (order by") == 1
        assert sql.count("over ()") == 1
