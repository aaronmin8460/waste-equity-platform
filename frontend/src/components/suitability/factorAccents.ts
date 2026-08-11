/**
 * The four factor accent colours used by the weight bar and the factor cards.
 *
 * A SINGLE-HUE NAVY RAMP, ON PURPOSE. The Figma frame tints its four factor cards
 * red / green / amber / violet, which in this application's palette are the
 * warning, success, caution, and no-data roles — a traffic light that would read as
 * "this factor is good / this factor is bad". A weight is neither. Four steps of the
 * brand navy keep the four cards visually distinguishable while carrying no valence,
 * and every card still states its full Korean name, its code, and its numeric
 * weight, so the colour is never the only signal (docs/ui-refresh/design-tokens.md).
 *
 * These are CHROME accents, not an analytical scale: they are never used to encode a
 * score, a rank, a status, or a map value. The map's palettes stay in lib/metrics.ts.
 */

import type { ScoreComponent } from "../../lib/glossary";

export const COMPONENT_ACCENT: Record<ScoreComponent, string> = {
  zoning: "#111a56",
  road: "#3b4a95",
  equity: "#6b79bd",
  demand: "#9aa4d4",
};
