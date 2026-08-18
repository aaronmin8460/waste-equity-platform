/**
 * 사용자 지정 가중치 순위 — turning a served scenario preview into the SAME row shape
 * ③ 종합 점수와 후보 순위 already renders, plus the two display rules that ranking
 * carries (the 시·군·구 display cap, and the scope note the preview endpoint forces).
 *
 * ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────────────────
 * Every value here is read verbatim off `POST /suitability/scenarios/preview`, which
 * recombines ONE fixed run's frozen Z/R/E/D component scores under the reader's own
 * weights and re-ranks the COMPLETE eligible population before it cuts to `top_n`.
 * Nothing in this module scores, re-ranks, re-rounds or interpolates: `custom_rank`
 * becomes `rank` and `custom_score` becomes `total_score`, as strings, unchanged.
 *
 * ── THE ONE THING THE ENDPOINT CANNOT DO, SAID OUT LOUD ──────────────────────────
 * `UserWeightScenarioRequest` has NO scope parameter (`schemas/scenario.py`): a
 * preview is always population-wide over the run's whole eligible set. ① 지역 선택
 * therefore cannot be pushed into the request the way it is for the profile ranking.
 *
 * Rather than pretend otherwise, {@link customWeightRankingRows} filters the SERVED
 * top-N to the active scope client-side and the caller prints
 * {@link customWeightScopeNote}, which states the derivation exactly: these are the
 * rows of the custom top-N that lie in the selected 범위 — not "the top N of that
 * 범위". The distinction matters: a 시·군·구 whose best cell ranks 120th nationally
 * has no row here, and the note is what stops that reading as "this 범위 has no
 * candidates". The served ranks are population-wide and are printed as such, exactly
 * as the profile ranking's own rows already are.
 *
 * ── THE 시·군·구 DISPLAY CAP ─────────────────────────────────────────────────────
 * `docs/research/SUITABILITY_V3_FINAL_POLICY.md` records a top-50 that was 49/50 one
 * 시·군·구, and assigns the PRESENTATIONAL fix here. {@link capRowsPerSigungu} is that
 * fix and nothing more: it is OFF by default, it drops no row from any export or
 * count, it never renumbers a rank, and the surface that turns it on must say how
 * many rows it is holding back. A ranking whose rows silently disappeared would be
 * worse than a concentrated one.
 */

import type {
  CandidateFeature,
  CandidateProperties,
  SuitabilityCandidateCollection,
  UserScenarioPreview,
  UserScenarioTopCandidate,
} from "./api";
import { isCandidateInScope, type SuitabilityScope } from "./suitabilityScope";

/**
 * How many rows the preview is asked for.
 *
 * 50 is the endpoint's own hard ceiling (`top_n: int = Field(default=10, ge=1,
 * le=50)`), so this is "as much as the server will give", not a choice. ③ shows the
 * first {@link CUSTOM_RANKING_DISPLAY_N} of them; the rest are what makes the scope
 * filter and the 시·군·구 cap useful instead of immediately empty.
 */
export const CUSTOM_SCENARIO_TOP_N = 50;

/**
 * The primary presentation cut for ③ 순위 보기.
 *
 * FIVE, per the page-4 기술 참고사항 ("[순위보기]는 TOP5개까지만") and the frame's own
 * modal footer (`표시된 순위 5개 · 범위 내 총 60개`). It is a DISPLAY cut over a
 * ranking that was computed for the whole population — never a claim that only five
 * candidates were ranked, which is why the count line beside it always states the
 * population figure too.
 */
export const CUSTOM_RANKING_DISPLAY_N = 5;

/** Default cap for {@link capRowsPerSigungu} when the reader turns it on. */
export const SIGUNGU_DISPLAY_CAP = 2;

/**
 * One served scenario candidate as the `CandidateProperties` ③ already renders.
 *
 * `status` is `ELIGIBLE` because the preview ranks ONLY eligible candidates
 * (`_PREVIEW_SQL` filters on it before `row_number()`), so this is a restatement of
 * the query's own precondition rather than an assumption about the row. The fields
 * the scenario endpoint genuinely does not serve — provisional score, road distance,
 * exclusion/review reasons, stability membership — are rendered as their explicit
 * empty values and are never back-filled from the profile ranking, which describes a
 * different weighting.
 */
function scenarioRowProperties(
  row: UserScenarioTopCandidate,
  profileLabel: string,
): CandidateProperties {
  return {
    candidate_id: row.candidate_id,
    candidate_key: row.candidate_key,
    status: "ELIGIBLE",
    profile: profileLabel,
    is_excluded: false,
    rank: row.custom_rank,
    total_score: row.custom_score,
    provisional_score: null,
    zoning_score: row.zoning_score,
    road_score: row.road_score,
    equity_score: row.equity_score,
    demand_score: row.demand_score,
    sido_region_code: row.sido_region_code,
    sido_region_name: row.sido_region_name,
    sigungu_region_code: row.sigungu_region_code,
    sigungu_region_name: row.sigungu_region_name,
    nearest_road_distance_m: null,
    // The RUN's frozen stability, served identically by the preview. It is a
    // property of the run, not of the reader's weights, so carrying it through is
    // the same statement the profile ranking's rows make.
    stable_count: row.stable_count,
    stability_class: row.stability_class,
    stability_membership: {},
    exclusion_reasons: [],
    review_reasons: [],
  };
}

/**
 * The candidate's geometry as the preview serves it: its CENTROID, as a Point.
 *
 * The scenario endpoint serves `centroid_lon` / `centroid_lat` and no cell polygon.
 * A Point at the served centroid is a true statement about the cell; substituting a
 * square, or borrowing the polygon from a different request, would not be. `null` is
 * returned when either coordinate is missing, and the feature then carries an empty
 * `GeometryCollection` — the GeoJSON spelling of "no geometry", not a point at 0,0.
 */
function scenarioRowGeometry(row: UserScenarioTopCandidate): GeoJSON.Geometry {
  if (row.centroid_lon === null || row.centroid_lat === null) {
    return { type: "GeometryCollection", geometries: [] };
  }
  return { type: "Point", coordinates: [row.centroid_lon, row.centroid_lat] };
}

/**
 * The rows of a custom-weight preview that lie in the active scope, in served rank
 * order, with the totals needed to describe them honestly.
 *
 * `servedCount` is how many rows the endpoint returned (the top-N cut);
 * `inScopeCount` how many of those lie in the scope; `rankingPopulation` the
 * complete ranked population the server reports. All three are printed, because a
 * reader shown five rows out of a filtered fifty out of a ranked seventeen thousand
 * needs all three numbers to know what the five are.
 */
export interface CustomWeightRanking {
  features: CandidateFeature[];
  servedCount: number;
  inScopeCount: number;
  rankingPopulation: number;
}

export function customWeightRankingRows(
  preview: UserScenarioPreview,
  scope: SuitabilityScope,
  profileLabel: string,
): CustomWeightRanking {
  const served = preview.top_candidates;
  const features: CandidateFeature[] = served.map((row) => ({
    type: "Feature",
    geometry: scenarioRowGeometry(row),
    properties: scenarioRowProperties(row, profileLabel),
  }));
  // THE SAME scope predicate the profile ranking's selection check uses, so a cell
  // is judged in or out of a 범위 identically on both sides of the page.
  const inScope = features.filter((feature) => isCandidateInScope(scope, feature.properties));
  return {
    features: inScope,
    servedCount: served.length,
    inScopeCount: inScope.length,
    rankingPopulation: preview.ranking_population,
  };
}

/**
 * Wrap the rows in the collection shape ③ renders, so the custom ranking and the
 * profile ranking go through ONE list component rather than two that could drift.
 *
 * `total_matched` is the count of rows THIS list is drawn from — the in-scope subset
 * of the served cut — and never the ranked population, which is carried separately
 * and printed beside it. Calling the population `total_matched` would make the count
 * line claim a filter the endpoint never applied.
 */
export function customWeightRankingCollection(
  preview: UserScenarioPreview,
  ranking: CustomWeightRanking,
  displayN: number = CUSTOM_RANKING_DISPLAY_N,
): SuitabilityCandidateCollection {
  const shown = ranking.features.slice(0, displayN);
  return {
    type: "FeatureCollection",
    component_model_version: preview.component_model_version,
    component_order: preview.component_order,
    indicator: "suitability_total_score",
    derivation_version: preview.derivation_version,
    policy_version: preview.policy_version,
    candidate_grid_version: preview.candidate_grid_version,
    // NOT one of the five stored profiles — the scenario's own identity, so nothing
    // downstream can mistake these rows for a served profile ranking.
    weight_profile: `user-scenario:${preview.scenario_hash_short}`,
    reference_year: preview.reference_year,
    run_id: preview.run_id,
    count: shown.length,
    total_matched: ranking.inScopeCount,
    limit: displayN,
    offset: 0,
    // The scope echo the candidates endpoint uses to confirm what it filtered on.
    // The scenario endpoint applies NO scope — the filter above is this client's —
    // so both are the honest empty values rather than a claim the server made.
    sido: null,
    sigungu: [],
    // A scenario ranking is score-descending by construction (`custom_rank` ASC), and
    // there is no sort parameter to echo, so this states what the rows actually are.
    sort: "score_desc",
    features: shown,
    // The scenario response carries its own assumptions and disclaimer, verbatim.
    assumptions: preview.assumptions,
    disclaimer: preview.screening_disclaimer,
  };
}

/**
 * At most `cap` rows per 시·군·구, in the incoming rank order.
 *
 * PRESENTATION ONLY. No rank is renumbered, no row is scored, no 시·군·구 aggregate
 * of any kind is produced, and the held-back rows are counted and returned so the
 * caller can say how many it is not showing. Rows with no 시·군·구 are never capped
 * against one another — an unassigned cell shares no place with any other.
 */
export function capRowsPerSigungu(
  features: readonly CandidateFeature[],
  cap: number = SIGUNGU_DISPLAY_CAP,
): { features: CandidateFeature[]; heldBack: number } {
  if (cap <= 0) return { features: [...features], heldBack: 0 };
  const seen = new Map<string, number>();
  const kept: CandidateFeature[] = [];
  for (const feature of features) {
    const key = feature.properties.sigungu_region_code;
    if (key === null || key === "") {
      kept.push(feature);
      continue;
    }
    const used = seen.get(key) ?? 0;
    if (used >= cap) continue;
    seen.set(key, used + 1);
    kept.push(feature);
  }
  return { features: kept, heldBack: features.length - kept.length };
}

/**
 * How many rows the PROFILE ranking is fetched with while the 시·군·구 cap is on.
 *
 * The cap holds rows back, so a list fetched at exactly {@link CUSTOM_RANKING_DISPLAY_N}
 * would shrink below five the moment two candidates shared a 시·군·구. Fetching a
 * deeper pool and cutting to five AFTER the cap keeps the card at its stated size,
 * and costs one slightly larger request only while the reader has the cap on.
 */
export const SIGUNGU_CAP_POOL_N = 25;

/**
 * Apply the two DISPLAY rules — the 시·군·구 cap, then the top-N cut — to a ranking
 * collection, whichever endpoint it came from.
 *
 * Neither rule touches a served number: `total_matched` is left exactly as the server
 * sent it (it describes the whole filtered population, not this page of rows), no rank
 * is renumbered, and `heldBack` is returned so the surface can say how many rows the
 * cap is hiding. `count` follows the rows actually rendered, because that field IS
 * "how many are on screen".
 */
export function applyRankingDisplayRules(
  collection: SuitabilityCandidateCollection,
  options: { cap: boolean; displayN?: number; capSize?: number },
): { collection: SuitabilityCandidateCollection; heldBack: number } {
  const displayN = options.displayN ?? CUSTOM_RANKING_DISPLAY_N;
  const capped = options.cap
    ? capRowsPerSigungu(collection.features, options.capSize ?? SIGUNGU_DISPLAY_CAP)
    : { features: collection.features, heldBack: 0 };
  const shown = capped.features.slice(0, displayN);
  return {
    collection: { ...collection, features: shown, count: shown.length },
    // Only the rows the cap removed from WITHIN the displayed window are reported —
    // rows beyond the top-N cut were never going to be shown and are not "held back".
    heldBack: Math.min(capped.heldBack, Math.max(0, collection.features.length - shown.length)),
  };
}

/**
 * The sentence that must accompany a custom-weight ranking, naming the derivation the
 * endpoint's shape forces on it.
 */
export function customWeightScopeNote(
  ranking: CustomWeightRanking,
  scopeName: string,
  scopeActive: boolean,
): string {
  const population = ranking.rankingPopulation.toLocaleString("ko-KR");
  const where = scopeActive ? `${scopeName} 범위의` : "";
  return (
    `사용자 지정 가중치 순위는 ${where} 스크리닝 통과 후보 ${population}곳을 이 가중치로 ` +
    `다시 순위 매긴 결과이며, 순위는 그 안에서 매겨졌습니다.`
  ).replace("  ", " ");
}
