/**
 * SUCCESSOR V3 — the Page-4 component vocabulary, and the seam the real API wires into.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────
 * Page 4 currently renders the Z/R/E/D model (`lib/glossary.ts` — zoning, road,
 * equity, demand). Successor V3 replaces it with FOUR DIFFERENT components. The two
 * sets are not a rename and there is no honest 1:1 crosswalk between them:
 *
 *   V3 component        Figma ② label        nearest Z/R/E/D analogue
 *   ──────────────────  ───────────────────  ───────────────────────────────────────
 *   existing_burden     기존시설 부담지수      equity (E)  — a reframing, same idea
 *   air_impact_proxy    대기영향 지수          demand (D)  — a reframing of per-capita
 *                                                          generation as an air proxy
 *   land_conversion     용도변경 가능지수      NONE — distance-to-core, where zoning (Z)
 *                                                   was a legal land-use category
 *   resident_impact     주민영향 지수          NONE — population weighted by distance
 *   (road (R) has no V3 successor at all and disappears.)
 *
 * Because two of the four are genuinely NEW computations and one old component is
 * dropped, V3 component scores CANNOT be derived, mapped, or approximated from the
 * Z/R/E/D values the current API serves. Any such mapping would be a fabricated
 * score presented as a measurement. So this module carries the vocabulary and the
 * shape ONLY, and the values arrive from the backend or the UI shows nothing.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN ────────────────────────────────
 * No weights. No resident floor. No A/B/C thresholds. No model/policy/scenario
 * version. No normalization constants. No eligibility rule. Every one of those is
 * a POLICY decision owned by the backend, and three in-repo contracts forbid this
 * layer inventing one. They are read from the served policy at runtime; until the
 * backend handoff lands there is no default to fall back to, and the absence is
 * rendered as an explicit "not yet available" rather than a plausible number.
 *
 * The Korean labels and one-line descriptions below ARE safe to carry here: they are
 * transcribed from the Figma frame itself (136:8684 card ②, and the expanded example
 * 356:582), which is the design authority for wording. They describe what each index
 * means; they assert no value.
 *
 * NOTE ON THE FIGMA FORMULAS: frame 356:582 also prints a formula, a data list and a
 * 한계 line per component. Those are NOT reproduced here. They describe the original
 * research prototype — one of them states outright that its coordinates are "실제
 * 위경도가 아닌 SVG 캔버스 좌표" (SVG canvas coordinates, not real lat/lon) — so
 * printing them beside real served scores would mis-describe how those scores were
 * actually produced. The expandable slot the frame draws for them is preserved; its
 * content comes from the served policy's own method description.
 */

/** The four Successor-V3 score components. */
export type V3Component =
  | "existing_burden"
  | "air_impact_proxy"
  | "land_conversion"
  | "resident_impact";

/**
 * Display order, taken from the Figma frame's own top-to-bottom reading of card ②
 * (기존시설 부담 → 대기영향 → 용도변경 가능 → 주민영향).
 *
 * If the served policy enumerates its components in a different order, THE SERVED
 * ORDER WINS and this constant is only the fallback for rendering the empty shape —
 * a UI that reorders a policy's components is misreporting the policy.
 */
export const V3_COMPONENT_ORDER: readonly V3Component[] = [
  "existing_burden",
  "air_impact_proxy",
  "land_conversion",
  "resident_impact",
];

export interface V3ComponentMeta {
  /** Citizen-facing Korean name, transcribed from Figma card ②. */
  label: string;
  /** The one-line description the frame prints under the weight control. */
  description: string;
  /**
   * The card's accent, sampled from the Figma frame's own 1.6px card borders and the
   * matching segment of the weight bar. Colour is never the only signal: every card
   * also carries its full Korean name and its numeric score.
   */
  accent: string;
}

export const V3_COMPONENT_META: Record<V3Component, V3ComponentMeta> = {
  existing_burden: {
    label: "기존시설 부담지수",
    description: "시·도 내 1인당 기존 처리시설 부담을 반영한 형평성 지수",
    accent: "#C9433C",
  },
  air_impact_proxy: {
    label: "대기영향 지수",
    description: "1인당 폐기물 발생량으로 가늠한 대기영향 규모 지수",
    accent: "#188A52",
  },
  land_conversion: {
    label: "용도변경 가능지수",
    description: "도심과의 거리로 본 부지 재활용 적합도 지수",
    accent: "#D6A419",
  },
  resident_impact: {
    label: "주민영향 지수",
    description: "인근 인구를 거리로 가중합산한 주민 반대여론 예상 지수",
    accent: "#6E4FE0",
  },
};

/** True when `value` is one of the four V3 component keys. */
export function isV3Component(value: unknown): value is V3Component {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(V3_COMPONENT_META, value)
  );
}

/**
 * Whether a served payload is a Successor-V3 model at all.
 *
 * The check is POSITIVE and explicit — it looks for the V3 component vocabulary
 * rather than assuming V3 because something was served. A Z/R/E/D run must fall
 * through this to `false` so the UI keeps rendering the legacy model truthfully
 * instead of relabelling four old scores with four new names.
 */
export function looksLikeV3Components(components: unknown): boolean {
  if (components == null || typeof components !== "object") return false;
  const keys = Object.keys(components as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.some(isV3Component);
}
