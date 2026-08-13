/**
 * 후보지 심층 비교 — ONE candidate, seen under A안 and under B안 (Page 5C).
 *
 * Page 5A resolves the pair and re-previews both sides once
 * (`lib/scenarioComparison.ts`, docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §9).
 * This module is the layer above that: given the two already-loaded previews and the
 * two *candidate details* served for the selected cell, it lays out the per-factor
 * weighted contribution of each side and names the factor whose contribution moved
 * most. It resolves nothing, stores nothing, and issues no request.
 *
 * ── EVERY NUMBER HERE IS THE SERVER'S ────────────────────────────────────────────
 * `component_score`, `weight` and `weighted_contribution` all arrive per side from
 * `POST /api/v1/suitability/scenarios/candidates/{id}`, whose backend builds them as
 *
 *     weighted_contribution = component_score × canonical weight     (4 dp, HALF_EVEN)
 *
 * (`api/routes/suitability_scenarios.py::_contributions`), with
 * `Σ weighted_contribution == custom_score` pinned by
 * `tests/test_suitability_scenario_routes_integration.py::test_detail_eligible_with_contributions`.
 * This module therefore does NOT multiply anything: it reads the served product. No
 * scoring formula is defined, extended, or re-derived here.
 *
 * ── DELTAS ARE EXACT, NOT FLOATING ───────────────────────────────────────────────
 * The served decimals are fixed-point (4 dp), so every difference is taken in integer
 * 1/10000 units and formatted back. `30.8000 - 16.4000` is `14.4000`, not
 * `14.399999999999999`, and a true zero is a true zero rather than `-1.8e-15` —
 * which matters because a zero delta is rendered as 변화 없음 and gates the
 * major-impact statement.
 *
 * ── WHAT A CONTRIBUTION CHANGE IS, AND IS NOT ────────────────────────────────────
 * A scenario reweights ALREADY-COMPUTED Z/R/E/D component scores. The component
 * scores are a property of the run and are identical on both sides; only the weights
 * differ. So an A→B contribution change is arithmetic on the reader's own weights —
 * it is DESCRIPTIVE, never causal, and never a pass/fail. Screening
 * (ELIGIBLE / REVIEW_REQUIRED / EXCLUDED) is rule-based and does not move with the
 * weights, so nothing here reports a status change, a threshold, or a "newly passed"
 * candidate.
 *
 * React-free on purpose, matching `lib/scenarioComparison.ts`: `lib/` is the pure,
 * directly-testable layer.
 */

import type {
  UserScenarioCandidateDetail,
  UserScenarioPreview,
  UserScenarioTopCandidate,
} from "./api";
import { COMPONENT_META, COMPONENT_ORDER, type ScoreComponent } from "./glossary";

// --------------------------------------------------------------------------- //
// Exact fixed-point arithmetic on the served 4-dp decimals
// --------------------------------------------------------------------------- //

/** The served scale: the backend quantizes every score/contribution to 4 dp. */
const SCALE = 10_000;

/**
 * A served decimal string as an integer count of 1/10000, or `null` when nothing was
 * served. An unparseable value is `null` too — a number the client cannot read is not
 * a number it may print.
 */
function scaled(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * SCALE);
}

/** Back to the served spelling: a fixed 4-dp string, so `14.4` prints as `14.4000`. */
function unscaled(units: number): string {
  return (units / SCALE).toFixed(4);
}

// --------------------------------------------------------------------------- //
// Which candidate is being compared
// --------------------------------------------------------------------------- //

/**
 * The selected cell's identity.
 *
 * `candidateKey` is the STABLE public identity (the 500 m grid key) and is what a
 * reader is shown and what the export carries. `candidateId` is the surrogate the
 * API addresses a candidate by, and is the only thing a request can be made with.
 * Both are carried because neither substitutes for the other, and a display name
 * (시·군·구) is NEVER an identity — two cells in one 시흥시 are two different cells.
 */
export interface SelectedCandidateRef {
  candidateId: number;
  /** `null` only while the key has not yet been served by a preview row or a detail. */
  candidateKey: string | null;
}

/**
 * One offerable candidate in the picker.
 *
 * `inA` / `inB` record which side's BOUNDED preview list the row came from. A cell
 * present in only one side's top-N is a real and common situation (a reweighted
 * ranking reshuffles), and it is disclosed rather than hidden: the picker can say so,
 * and §"rank" below refuses to invent the missing side's rank.
 */
export interface CandidateChoice {
  candidateId: number;
  candidateKey: string;
  sidoRegionName: string | null;
  sigunguRegionName: string | null;
  inA: boolean;
  inB: boolean;
  /** Best (lowest) rank across the sides that served one; `null` if neither did. */
  bestRank: number | null;
}

function rowsOf(preview: UserScenarioPreview | null): UserScenarioTopCandidate[] {
  return preview?.top_candidates ?? [];
}

/**
 * The candidates a reader may select, drawn from BOTH sides' already-loaded previews.
 *
 * The union, not the intersection: a cell that only B안 ranks in its top-N is exactly
 * the kind of cell a reader wants to inspect, and offering only the intersection
 * would quietly hide the biggest movers. Ordered by best served rank, then by
 * `candidate_key`, so the list is deterministic and does not reshuffle between
 * renders.
 */
export function candidateChoices(
  a: UserScenarioPreview | null,
  b: UserScenarioPreview | null,
): CandidateChoice[] {
  const byId = new Map<number, CandidateChoice>();

  const absorb = (row: UserScenarioTopCandidate, side: "A" | "B") => {
    const existing = byId.get(row.candidate_id);
    const rank = row.custom_rank;
    if (existing) {
      if (side === "A") existing.inA = true;
      else existing.inB = true;
      existing.bestRank =
        existing.bestRank === null ? rank : rank === null ? existing.bestRank : Math.min(existing.bestRank, rank);
      return;
    }
    byId.set(row.candidate_id, {
      candidateId: row.candidate_id,
      candidateKey: row.candidate_key,
      sidoRegionName: row.sido_region_name,
      sigunguRegionName: row.sigungu_region_name,
      inA: side === "A",
      inB: side === "B",
      bestRank: rank,
    });
  };

  for (const row of rowsOf(a)) absorb(row, "A");
  for (const row of rowsOf(b)) absorb(row, "B");

  return [...byId.values()].sort((x, y) => {
    // A served rank always precedes an unserved one; ties fall back to the stable key.
    if (x.bestRank !== y.bestRank) {
      if (x.bestRank === null) return 1;
      if (y.bestRank === null) return -1;
      return x.bestRank - y.bestRank;
    }
    return x.candidateKey.localeCompare(y.candidateKey);
  });
}

/** The picker row for an id, or `null` when neither side's preview carries it. */
export function findChoice(
  choices: readonly CandidateChoice[],
  candidateId: number | null,
): CandidateChoice | null {
  if (candidateId === null) return null;
  return choices.find((choice) => choice.candidateId === candidateId) ?? null;
}

/**
 * One side's served rank/score for the selected cell — **from the bounded preview**.
 *
 * `null` means the cell is NOT in that side's top-N, which is an absence of
 * information, not a bad rank. It must render as 미제공 / 순위 없음 and must never be
 * replaced by a number, by the other side's rank, or by `top_n + 1`. The candidate
 * DETAIL is a separate contract with its own `custom_rank`; see
 * {@link CandidateSideResult}.
 */
export interface PreviewPlacement {
  rank: number | null;
  score: string | null;
  /** Whether the candidate appeared in this side's bounded list at all. */
  inPreview: boolean;
}

export function previewPlacement(
  preview: UserScenarioPreview | null,
  candidateId: number | null,
): PreviewPlacement {
  if (preview === null || candidateId === null) {
    return { rank: null, score: null, inPreview: false };
  }
  const row = preview.top_candidates.find((item) => item.candidate_id === candidateId);
  if (!row) return { rank: null, score: null, inPreview: false };
  return { rank: row.custom_rank, score: row.custom_score, inPreview: true };
}

// --------------------------------------------------------------------------- //
// Per-side candidate detail
// --------------------------------------------------------------------------- //

/** Why one side's candidate detail is, or is not, available. */
export type CandidateDetailState = "READY" | "LOADING" | "IDLE" | "BLOCKED" | "ERROR";

/**
 * One side's answer for the selected cell.
 *
 * `BLOCKED` is the state a side carries when the *comparison* side itself was never
 * `READY` (missing scenario, other run, preview error). The detail was never
 * requested, so reporting an error would blame a request that was never made.
 */
export interface CandidateSideResult {
  slot: "A" | "B";
  state: CandidateDetailState;
  detail: UserScenarioCandidateDetail | null;
  errorMessage: string | null;
}

/**
 * The candidate key both sides agree on, or `null`.
 *
 * The two details describe the SAME `candidate_id` in the SAME run, so their keys are
 * necessarily equal; this returns whichever side served one. A disagreement would
 * mean the two sides are describing different cells, which
 * {@link candidateIdentityConflict} reports rather than silently picking a winner.
 */
export function resolvedCandidateKey(
  a: CandidateSideResult,
  b: CandidateSideResult,
  fallback: string | null = null,
): string | null {
  return a.detail?.candidate_key ?? b.detail?.candidate_key ?? fallback;
}

/** True when the two served details name DIFFERENT cells — a contract violation. */
export function candidateIdentityConflict(
  a: CandidateSideResult,
  b: CandidateSideResult,
): boolean {
  const ka = a.detail?.candidate_key ?? null;
  const kb = b.detail?.candidate_key ?? null;
  return ka !== null && kb !== null && ka !== kb;
}

// --------------------------------------------------------------------------- //
// Z/R/E/D contribution rows
// --------------------------------------------------------------------------- //

/**
 * One factor's A/B weighted contribution for the selected cell.
 *
 * Every string field is the SERVED spelling, passed through untouched — this is the
 * repo's convention for a score (`SuitabilityScenarioLab` prints the same 4-dp
 * decimals) and it keeps the exported workbook byte-comparable with the API.
 */
export interface CandidateContributionRow {
  component: ScoreComponent;
  /** "용도지역 호환성", from the central glossary — never a Figma mock label. */
  label: string;
  /** "Z" | "R" | "E" | "D". Only ever rendered next to `label`. */
  code: string;

  /**
   * The component score, which is a property of the RUN and so is the same under both
   * scenarios. Taken from whichever side served it.
   */
  componentScore: string | null;
  /** The two sides' served component scores, kept separate so a disagreement is visible. */
  aComponentScore: string | null;
  bComponentScore: string | null;
  /**
   * True when the sides served DIFFERENT component scores for one factor. Reweighting
   * cannot do that, so it means the two details are not the same run/cell and the row
   * must not be presented as a like-for-like comparison.
   */
  componentScoreConflict: boolean;

  /** Exact served canonical weights (8 dp decimals), and their whole-percent display. */
  aWeight: string | null;
  bWeight: string | null;
  aWeightPercent: number | null;
  bWeightPercent: number | null;

  /** The SERVED `weighted_contribution` per side — never recomputed here. */
  aContribution: string | null;
  bContribution: string | null;

  /** `b − a`, exact, as a 4-dp string; `null` unless BOTH sides served one. */
  deltaContribution: string | null;
  /** The same delta in 1/10000 units — the sort key for the major-impact factor. */
  deltaUnits: number | null;
}

function weightPercent(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Index a detail's served contributions by component name. */
function contributionsOf(
  detail: UserScenarioCandidateDetail | null,
): Map<string, { component_score: string | null; weight: string; weighted_contribution: string | null }> {
  const map = new Map<
    string,
    { component_score: string | null; weight: string; weighted_contribution: string | null }
  >();
  for (const row of detail?.contributions ?? []) map.set(row.component, row);
  return map;
}

/**
 * The four contribution rows, in the shared Z/R/E/D order.
 *
 * A side with no served detail contributes `null`s and renders as unavailable — never
 * as `0`, which in a contribution column would read as "this factor contributed
 * nothing" rather than "this factor's contribution is unknown".
 */
export function candidateContributionRows(
  aDetail: UserScenarioCandidateDetail | null,
  bDetail: UserScenarioCandidateDetail | null,
): CandidateContributionRow[] {
  const a = contributionsOf(aDetail);
  const b = contributionsOf(bDetail);

  return COMPONENT_ORDER.map((component) => {
    const meta = COMPONENT_META[component];
    const ra = a.get(component) ?? null;
    const rb = b.get(component) ?? null;

    const aComponentScore = ra?.component_score ?? null;
    const bComponentScore = rb?.component_score ?? null;
    const aUnits = scaled(ra?.weighted_contribution ?? null);
    const bUnits = scaled(rb?.weighted_contribution ?? null);
    const deltaUnits = aUnits === null || bUnits === null ? null : bUnits - aUnits;

    const scoreA = scaled(aComponentScore);
    const scoreB = scaled(bComponentScore);

    return {
      component,
      label: meta.primary,
      code: meta.code,
      componentScore: aComponentScore ?? bComponentScore,
      aComponentScore,
      bComponentScore,
      componentScoreConflict: scoreA !== null && scoreB !== null && scoreA !== scoreB,
      aWeight: ra?.weight ?? null,
      bWeight: rb?.weight ?? null,
      aWeightPercent: weightPercent(ra?.weight ?? null),
      bWeightPercent: weightPercent(rb?.weight ?? null),
      aContribution: ra?.weighted_contribution ?? null,
      bContribution: rb?.weighted_contribution ?? null,
      deltaContribution: deltaUnits === null ? null : unscaled(deltaUnits),
      deltaUnits,
    };
  });
}

/** `+14.4000` / `−7.2000` / `변화 없음`; `null` when the delta is not computable. */
export function formatContributionDelta(delta: string | null): string | null {
  const units = scaled(delta);
  if (units === null) return null;
  if (units === 0) return "변화 없음";
  // U+2212 MINUS SIGN, matching `formatWeightDelta` in lib/scenarioComparison.ts.
  return `${units > 0 ? "+" : "−"}${unscaled(Math.abs(units))}`;
}

/** `b − a` for the two served total scores, exact; `null` unless both were served. */
export function totalScoreDelta(
  aScore: string | null,
  bScore: string | null,
): string | null {
  const a = scaled(aScore);
  const b = scaled(bScore);
  if (a === null || b === null) return null;
  return unscaled(b - a);
}

// --------------------------------------------------------------------------- //
// 주요 영향 요인 — the largest contribution change, stated as such
// --------------------------------------------------------------------------- //

/**
 * The factor whose weighted contribution moved most between A안 and B안.
 *
 * ── THE DEFINITION IS EXACTLY THIS, AND NOTHING MORE ─────────────────────────────
 *     argmax over Z/R/E/D of |contribution(B) − contribution(A)|
 *
 * It is DESCRIPTIVE. It says which factor's number moved most between two weightings
 * the reader themselves chose; it does not say the candidate passed, failed, rose or
 * fell "because of" that factor, and the UI wording must not either. Screening is
 * rule-based and unaffected by weights, so this can never be a pass/fail explanation.
 *
 * ── TIES ARE DETERMINISTIC AND DISCLOSED ─────────────────────────────────────────
 * Equal magnitudes are broken by `COMPONENT_ORDER` (Z → R → E → D) so the answer is
 * stable across renders and across machines, and every co-equal factor is listed in
 * `tiedWith` so the reader is never shown one factor as *the* largest when two moved
 * identically.
 *
 * Returns `null` when no factor has a computable delta (a side is unavailable) or when
 * the largest movement is exactly zero — "the biggest change is no change" is not a
 * finding, and naming a factor there would manufacture one.
 */
export interface MajorImpactFactor {
  component: ScoreComponent;
  label: string;
  code: string;
  /** The signed delta, as a 4-dp string. */
  deltaContribution: string;
  /** `|delta|` in 1/10000 units — the quantity that was maximised. */
  magnitudeUnits: number;
  /** Whether the contribution rose or fell from A안 to B안. */
  direction: "increase" | "decrease";
  /** Other factors that moved by the SAME magnitude. Empty when the maximum is unique. */
  tiedWith: ScoreComponent[];
}

export function majorImpactFactor(
  rows: readonly CandidateContributionRow[],
): MajorImpactFactor | null {
  const computable = rows.filter((row) => row.deltaUnits !== null);
  if (computable.length === 0) return null;

  const magnitude = (row: CandidateContributionRow) => Math.abs(row.deltaUnits as number);
  const peak = Math.max(...computable.map(magnitude));
  // Every factor unchanged is a real, sayable outcome — but it is not a "major impact
  // factor", and printing one would invent a driver out of an identical pair.
  if (peak === 0) return null;

  // COMPONENT_ORDER order is preserved by `rows`, so the first match is the
  // Z → R → E → D tie-break, with no comparator that could reorder equal magnitudes.
  const winners = computable.filter((row) => magnitude(row) === peak);
  const top = winners[0];

  return {
    component: top.component,
    label: top.label,
    code: top.code,
    deltaContribution: top.deltaContribution as string,
    magnitudeUnits: peak,
    direction: (top.deltaUnits as number) > 0 ? "increase" : "decrease",
    tiedWith: winners.slice(1).map((row) => row.component),
  };
}

/**
 * The 주요 영향 요인 sentence — descriptive, and never causal.
 *
 * Deliberately NOT "이 요인 때문에 후보지가 통과했습니다": a contribution change
 * explains an arithmetic difference between two of the reader's own weightings, not
 * an outcome. A tie names every co-equal factor rather than picking one silently.
 */
export function majorImpactSentence(factor: MajorImpactFactor | null): string {
  if (factor === null) {
    return "A안과 B안 사이에 가중 기여도가 달라진 평가 요소가 없습니다.";
  }
  const move = factor.direction === "increase" ? "커졌습니다" : "작아졌습니다";
  const head =
    `A안과 B안 사이에서 가중 기여도 변화가 가장 큰 요소는 ${factor.label}(${factor.code})이며, ` +
    `${formatContributionDelta(factor.deltaContribution)}만큼 ${move}.`;
  if (factor.tiedWith.length === 0) return head;
  const others = factor.tiedWith
    .map((component) => `${COMPONENT_META[component].primary}(${COMPONENT_META[component].code})`)
    .join(" · ");
  return `${head} 같은 크기로 변화한 요소가 함께 있습니다: ${others}.`;
}
