/**
 * Shared formatting for a region's choropleth metric value, used by BOTH the map
 * (popup + feature properties in MapView) and the accessible DOM alternatives
 * (the region picker + selected-region summary in page.tsx), so the two paths can
 * never diverge. A region with no served value shows its availability text, never
 * a fabricated 0.
 */

// Precise availability reasons the reporting endpoints attach to a region with no
// value for a stream, so nothing ever shows a bare "no data".
export const REGION_UNAVAILABLE_REASON_LABELS: Record<string, string> = {
  SOURCE_NOT_REPORTED: "출처에서 해당 지역·항목을 보고하지 않음 (source did not report)",
  COARSER_REPORTING_GEOGRAPHY: "상위 보고 단위로 보고됨 (reported at a coarser geography)",
  SOURCE_ROW_REJECTED: "출처 행이 검증에서 제외됨 (source row rejected)",
  UNMATCHED_REGION_LABEL: "지역 라벨 미매칭 (unmatched region label)",
  AMBIGUOUS_REGION_LABEL: "지역 라벨 모호 (ambiguous region label)",
};

export function regionUnavailableReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REGION_UNAVAILABLE_REASON_LABELS[reason] ?? reason;
}

/**
 * The display string for a region's metric value: the served value with its unit,
 * or the availability text for a region with no served value. Never returns a
 * fabricated zero.
 */
export function formatRegionMetricDisplay(
  display: string | undefined,
  unit: string,
  reason: string | null | undefined,
): string {
  if (display !== undefined) return unit ? `${display} ${unit}` : display;
  const label = regionUnavailableReasonLabel(reason);
  return label ? `데이터 없음 — ${label}` : "데이터 없음 (no served value)";
}
