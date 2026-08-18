/**
 * MODEL-AWARE SCENARIO WEIGHTS — one weight vector always belongs to one component
 * model, and the type system says so.
 *
 * ── WHY A DISCRIMINATED UNION AND NOT ONE WIDE OBJECT ────────────────────────────
 * The historical and successor component namespaces are DISJOINT by construction
 * (`component_model.py` asserts it at import time), and a weight vector is only
 * meaningful over the namespace it was authored for. Before this module the
 * frontend had a single `UserScenarioWeights = {zoning, road, equity, demand}`, so
 * "a scenario's weights" and "the historical model's weights" were the same type —
 * which made a V3 request that carried Z/R/E/D keys a *type-correct* mistake.
 *
 * A single permissive `Record<string, string>` would have the same defect in a
 * different shape: it would accept `{zoning: …}` for a successor request and only
 * fail at the backend, as a 422 the reader has to interpret.
 *
 * So the two vectors are two TYPES, and {@link ModelWeights} pairs each with its
 * model version. `weightsFor(model)` cannot return the wrong namespace, and
 * `assertWeightsMatchModel` refuses a mismatch loudly at the boundary where a
 * stored or restored vector enters the app.
 *
 * ── THE ONE TRANSLATION THAT IS NEVER OFFERED ────────────────────────────────────
 * There is deliberately NO function here that converts a historical vector into a
 * successor one. Doing it by array position would silently rename `road` to
 * `resident_impact`; the backend's own `translate_weights_by_position` exists to
 * REFUSE that, not to enable it, and this module takes the same position. A reader
 * who wants a V3 scenario authors a V3 vector.
 */

import {
  COMPONENT_MODEL_HISTORICAL,
  COMPONENT_MODEL_SUCCESSOR,
  type V3Component,
} from "./suitabilityV3";

export { COMPONENT_MODEL_HISTORICAL, COMPONENT_MODEL_SUCCESSOR };

/** The two component models this frontend can author a scenario for. */
export type ComponentModelVersion =
  | typeof COMPONENT_MODEL_HISTORICAL
  | typeof COMPONENT_MODEL_SUCCESSOR;

/** The historical Z/R/E/D components, in the order every surface lists them. */
export const HISTORICAL_COMPONENT_ORDER = ["zoning", "road", "equity", "demand"] as const;
export type HistoricalComponent = (typeof HISTORICAL_COMPONENT_ORDER)[number];

/**
 * The successor components in the BACKEND REGISTRY order.
 *
 * ⚠️ Deliberately NOT `V3_COMPONENT_ORDER`, which is the order Figma card ② lays the
 * four factor cards out in (`… land_conversion, resident_impact`). Both orders are
 * correct for their own job and they are NOT interchangeable:
 *
 *   - the REGISTRY order is `component_model.COMPONENT_ORDER_SUCCESSOR`, and it is
 *     load-bearing — the backend's correlation matrix, the scenario hash payload and
 *     every export column sequence are built in it;
 *   - the DISPLAY order is a layout decision and may change with the design.
 *
 * A weight vector is validated and serialized against the REGISTRY order, so it is
 * the one this module uses. Conflating them would send a correctly-named vector that
 * hashes differently from the one the engine computed.
 */
export const SUCCESSOR_COMPONENT_ORDER = [
  "existing_burden",
  "air_impact_proxy",
  "resident_impact",
  "land_conversion",
] as const satisfies readonly V3Component[];
export type SuccessorComponent = V3Component;

/** Canonical 8-dp decimal strings over the HISTORICAL components. */
export type HistoricalScenarioWeights = Record<HistoricalComponent, string>;
/** Canonical 8-dp decimal strings over the SUCCESSOR components. */
export type SuccessorScenarioWeights = Record<SuccessorComponent, string>;

/**
 * A weight vector together with the model it is defined over.
 *
 * The discriminant is the model version, so narrowing on it narrows the weights to
 * the right namespace — which is what makes a cross-model submission a compile
 * error rather than a runtime 422.
 */
export type ModelWeights =
  | { componentModelVersion: typeof COMPONENT_MODEL_HISTORICAL; weights: HistoricalScenarioWeights }
  | { componentModelVersion: typeof COMPONENT_MODEL_SUCCESSOR; weights: SuccessorScenarioWeights };

/** The component keys a model's weight vector must have — exactly these, no others. */
export function componentsFor(model: ComponentModelVersion): readonly string[] {
  return model === COMPONENT_MODEL_SUCCESSOR
    ? SUCCESSOR_COMPONENT_ORDER
    : HISTORICAL_COMPONENT_ORDER;
}

export function isComponentModelVersion(value: unknown): value is ComponentModelVersion {
  return value === COMPONENT_MODEL_HISTORICAL || value === COMPONENT_MODEL_SUCCESSOR;
}

/** A canonical weight string: a plain decimal in [0,1], as the backend emits them. */
const CANONICAL_WEIGHT_RE = /^\d(?:\.\d{1,8})?$/;
/** The canonical vector sums to 1; the backend quantizes to 8 dp before comparing. */
const WEIGHT_SUM_TOLERANCE = 1e-8;

/**
 * Whether `value` is a canonical weight vector over this model's components.
 *
 * Three rules, each load-bearing:
 *
 * 1. EVERY component of the model must be present and canonical. A vector missing
 *    one is not a vector for this model.
 * 2. NO key from the OTHER model's namespace may appear. That is what stops an
 *    ambiguous record — one carrying both namespaces — from validating as either,
 *    which is the only way a cross-model read could slip through a presence check.
 * 3. Any other stray key is tolerated here and STRIPPED by {@link modelWeightsFrom},
 *    which rebuilds the vector component by component. Rejecting the whole row
 *    would cost a reader their saved scenario over one junk property, while the
 *    rebuild already guarantees nothing extra reaches a request body.
 */
export function isCanonicalWeightsFor(
  model: ComponentModelVersion,
  value: unknown,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const components = componentsFor(model);
  const foreign =
    model === COMPONENT_MODEL_SUCCESSOR ? HISTORICAL_COMPONENT_ORDER : SUCCESSOR_COMPONENT_ORDER;
  for (const key of foreign) {
    if (key in record) return false;
  }
  let sum = 0;
  for (const key of components) {
    const raw = record[key];
    if (typeof raw !== "string" || !CANONICAL_WEIGHT_RE.test(raw)) return false;
    sum += Number(raw);
  }
  return Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE;
}

export function isHistoricalWeights(value: unknown): value is HistoricalScenarioWeights {
  return isCanonicalWeightsFor(COMPONENT_MODEL_HISTORICAL, value);
}

export function isSuccessorWeights(value: unknown): value is SuccessorScenarioWeights {
  return isCanonicalWeightsFor(COMPONENT_MODEL_SUCCESSOR, value);
}

/**
 * Rebuild a vector KEY BY KEY over the model's own components, or `null`.
 *
 * Rebuilding rather than passing the parsed object through is what stops a stored
 * object's extra properties reaching the request body, and it is also what makes
 * "these weights belong to this model" a checked fact rather than an assumption.
 */
export function modelWeightsFrom(
  model: ComponentModelVersion,
  value: unknown,
): ModelWeights | null {
  if (!isCanonicalWeightsFor(model, value)) return null;
  const record = value as Record<string, string>;
  if (model === COMPONENT_MODEL_SUCCESSOR) {
    return {
      componentModelVersion: COMPONENT_MODEL_SUCCESSOR,
      weights: {
        existing_burden: record.existing_burden,
        air_impact_proxy: record.air_impact_proxy,
        resident_impact: record.resident_impact,
        land_conversion: record.land_conversion,
      },
    };
  }
  return {
    componentModelVersion: COMPONENT_MODEL_HISTORICAL,
    weights: {
      zoning: record.zoning,
      road: record.road,
      equity: record.equity,
      demand: record.demand,
    },
  };
}

/**
 * The model a bare, UNTAGGED weight vector must be read as — or `null`.
 *
 * Used ONLY when reading state written before model tagging existed. It infers the
 * model from the vector's own key set, which is unambiguous because the two
 * namespaces are disjoint. It is NOT a translation: a Z/R/E/D vector resolves to the
 * historical model and stays historical forever.
 */
export function inferUntaggedModel(value: unknown): ComponentModelVersion | null {
  if (isHistoricalWeights(value)) return COMPONENT_MODEL_HISTORICAL;
  if (isSuccessorWeights(value)) return COMPONENT_MODEL_SUCCESSOR;
  return null;
}

/** Citizen-facing name of a component model, for a surface that must say which. */
export const COMPONENT_MODEL_LABELS: Record<ComponentModelVersion, string> = {
  [COMPONENT_MODEL_SUCCESSOR]: "후속 모델",
  [COMPONENT_MODEL_HISTORICAL]: "기존 모델",
};

export function componentModelLabel(model: string | null | undefined): string {
  return isComponentModelVersion(model) ? COMPONENT_MODEL_LABELS[model] : "알 수 없는 모델";
}

/**
 * The one sentence a legacy scenario carries, so a reader knows why it cannot enter
 * a V3 comparison rather than finding it silently missing.
 */
export const LEGACY_MODEL_NOTICE =
  "이 시나리오는 기존 모델(Z·R·E·D) 가중치로 저장되었습니다. 후속 모델의 평가 요소는 서로 다른 " +
  "값이라 그대로 옮겨 쓸 수 없으므로, 후속 모델로 비교하려면 새로 저장해 주세요.";

/**
 * "기존시설 부담지수 40% · 대기영향 지수 20% · …" — a weight vector as one line,
 * over WHICHEVER model it belongs to.
 *
 * The historical formatter (`namedWeights`) walks the Z/R/E/D glossary, so a
 * successor vector rendered through it prints four historical names with "-" values
 * — the reader's own weights, labelled as measurements they never chose. This picks
 * the right namespace from the vector itself.
 */
export function namedWeightsForModel(
  model: ComponentModelVersion,
  weights: Record<string, string> | null | undefined,
  labels: { historical: (c: string) => string; successor: (c: string) => string },
): string {
  const w = weights ?? {};
  const label = model === COMPONENT_MODEL_SUCCESSOR ? labels.successor : labels.historical;
  return componentsFor(model)
    .map((component) => {
      const raw = w[component];
      const percent =
        raw === undefined || raw === "" || !Number.isFinite(Number(raw))
          ? "-"
          : `${Math.round(Number(raw) * 100)}%`;
      return `${label(component)} ${percent}`;
    })
    .join(" · ");
}

/**
 * What a user-weight scenario does, stated without naming a component namespace.
 *
 * It used to read "이미 계산된 Z·R·E·D 점수를 다시 가중해" — true of a historical
 * comparison and FALSE of a successor one, where the re-weighted scores are
 * `existing_burden` / `air_impact_proxy` / `resident_impact` / `land_conversion`.
 * The mechanism is identical in both models, so the sentence describes the mechanism
 * and lets the factor table name the components.
 */
export const SCENARIO_REWEIGHT_NOTE =
  "시나리오는 이미 계산된 평가 요소 점수를 다시 가중해 순위를 바꿉니다. " +
  "배제·검토 판정(스크리닝)은 규칙 기반이며 가중치를 바꿔도 달라지지 않습니다.";
