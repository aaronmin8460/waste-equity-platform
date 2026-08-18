/**
 * Shared formatting for a region's choropleth metric value, used by BOTH the map
 * (popup + feature properties in MapView) and the accessible DOM alternatives
 * (the region picker + selected-region summary in page.tsx), so the two paths can
 * never diverge. A region with no served value shows its availability text, never
 * a fabricated 0.
 *
 * It also owns the region's human-readable NAME (see `regionDisplayName` below),
 * used by the facility-cost setup picker so a citizen never has to read a raw
 * region code to tell 서울 중구 from 인천 중구.
 */

import { approximatePersonsAsManMyeong } from "./displayNumber";
import { regionScope, SCOPE_LABELS, type RegionScope } from "./ranking";
import { formatWithUnit } from "./units";

// Precise availability reasons the reporting endpoints attach to a region with no
// value for a stream, so nothing ever shows a bare "no data".
//
// EVERY REASON IS KEPT. Only the English restatement in each parenthesis is gone:
// it translated the Korean immediately to its left and told a Korean reader nothing
// the Korean did not. The served REASON CODE is still what selects the line, so a
// region with no value still explains itself instead of showing a bare 데이터 없음 —
// and never a fabricated 0.
export const REGION_UNAVAILABLE_REASON_LABELS: Record<string, string> = {
  SOURCE_NOT_REPORTED: "출처에서 해당 지역·항목을 보고하지 않음",
  COARSER_REPORTING_GEOGRAPHY: "상위 보고 단위로 보고됨",
  SOURCE_ROW_REJECTED: "출처 행이 검증에서 제외됨",
  UNMATCHED_REGION_LABEL: "지역 라벨 미매칭",
  AMBIGUOUS_REGION_LABEL: "지역 라벨 모호",
};

export function regionUnavailableReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REGION_UNAVAILABLE_REASON_LABELS[reason] ?? reason;
}

/**
 * The display string for a region's metric value: the served value with its unit,
 * or the availability text for a region with no served value. Never returns a
 * fabricated zero.
 *
 * The unit goes through `lib/units.ts` so this string and the map legend print the
 * same population unit (`142,000 명`, not `142,000 persons`). The served unit is
 * unchanged — only its rendering is.
 *
 * ── THE 만 명 OVERRIDE LIVES HERE, AND ONLY HERE ─────────────────────────────────
 * The owner asked for person counts to be human-readable in 만 명. This function is
 * the ONE formatter behind both surfaces where a reader meets a single region's value
 * as a headline — the 선택한 지역 card and the map's region popup — and it is called
 * from exactly two places (`app/page.tsx` builds the accessible selection,
 * `components/MapView.tsx` builds the feature property the popup prints), so applying
 * it here converts both and cannot let the two disagree.
 *
 * DELIBERATELY NOT CONVERTED, because these are not headline values:
 *   - the choropleth legend's class rows. Their edges are exact quantile boundaries
 *     (`151,306 – 240,865 명`); rounding them to 만 makes ADJACENT BINS PRINT THE SAME
 *     NUMBER, which is a correctness bug rather than a formatting choice. They are
 *     built from the active scale's breaks in `app/page.tsx` and never pass here.
 *   - 지역 순위, 지역 순위 전체보기, and the 순위 CSV. Those are comparison surfaces:
 *     the reader is ordering regions against each other, so they keep the served
 *     integer at full precision, and they are also where the exact figure this card
 *     approximates remains available. They format through `lib/ranking.ts`, not here.
 *
 * Nothing numeric changes: `approximatePersonsAsManMyeong` is presentation-only,
 * labels itself with 약 whenever it discarded anything, and returns null on anything
 * it cannot parse — in which case the exact string is printed unchanged.
 */
export function formatRegionMetricDisplay(
  display: string | undefined,
  unit: string,
  reason: string | null | undefined,
): string {
  if (display !== undefined) {
    if (unit === "persons") {
      const readable = approximatePersonsAsManMyeong(display);
      if (readable !== null) return readable.text;
    }
    return formatWithUnit(display, unit);
  }
  const label = regionUnavailableReasonLabel(reason);
  // With a served reason the reason IS the disclosure; with none, the bare
  // 데이터 없음 stands alone. The old `(no served value)` gloss said the same thing
  // in English for a Korean-only surface.
  return label ? `데이터 없음 — ${label}` : "데이터 없음";
}

// --------------------------------------------------------------------------- //
// Region display names (facility-cost setup picker)
// --------------------------------------------------------------------------- //

/**
 * A region's visible name, prefixed with its metropolitan area.
 *
 * The sigungu names served by the API are NOT unique across the capital region:
 * 중구 exists in both Seoul (KR-SGIS-11140) and Incheon (KR-SGIS-23010), and the
 * old cost picker disambiguated them by appending the raw code ("중구 (KR-SGIS-11140)").
 * Codes are internal identifiers, not something a citizen should have to decode,
 * so the visible label carries the metropolitan prefix instead: "서울 중구",
 * "인천 중구". The code stays the option's VALUE and the API payload field.
 *
 * Classification reuses `regionScope` (lib/ranking.ts) — the one place SGIS sido
 * digits (11/23/31) and the RCIS derived-city codes are mapped — rather than
 * introducing a second, divergent classification of the same codes.
 *
 * A code outside the capital-region set is left unclassified: its name is returned
 * unchanged rather than being given an invented prefix.
 */
export function regionDisplayName(code: string, name: string): string {
  const scope = regionScope(code);
  if (scope === null) return name;
  // A name that already leads with its metropolitan word ("인천광역시 중구" from
  // the crosswalk tables) must not become "인천 인천광역시 중구".
  const prefix = SCOPE_LABELS[scope];
  if (name.startsWith(prefix)) return name;
  return `${prefix} ${name}`;
}

/**
 * Deterministic capital-region ordering for a region list: 서울 → 인천 → 경기 →
 * unclassified, then by name within each group, then by code so two regions that
 * share a name still have a stable, reproducible position.
 */
const SCOPE_SORT_RANK: Record<RegionScope, number> = { "11": 0, "23": 1, "31": 2 };

export function compareRegionsForDisplay(
  a: { code: string; name: string },
  b: { code: string; name: string },
): number {
  const sa = regionScope(a.code);
  const sb = regionScope(b.code);
  // Unclassified codes sort after every classified group, never interleaved.
  const ra = sa === null ? 3 : SCOPE_SORT_RANK[sa];
  const rb = sb === null ? 3 : SCOPE_SORT_RANK[sb];
  if (ra !== rb) return ra - rb;
  const byName = a.name.localeCompare(b.name, "ko");
  if (byName !== 0) return byName;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}
