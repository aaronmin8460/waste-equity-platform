"use client";

/**
 * The compact 시·군·구 계약 지급액 summary that sits beside the KPI region, with the
 * `시·군·구별 상세 보기 →` affordance the Figma frame (125:5064) asks for.
 *
 * ── What this is allowed to say, and what it may not ───────────────────────────
 * The Figma card summarises the municipal dataset with 총 지급액 (합계) 5,812.6 억원
 * and a 톤당/1인당 pair derived from it. This platform does NOT publish that total,
 * and the omission is deliberate rather than an oversight: only a subset of the 66
 * 기초지자체 disclosed an amount, so a "total" would be a partial sum wearing a
 * complete label — the same rule `LandfillRegionTable` already enforces by showing a
 * coverage count on a metropolitan row instead of a rolled-up figure. A 톤당 지급액
 * is refused for a second reason: the tonnage on this screen is landfill INBOUND at
 * 시·도 grain, and dividing a municipal contract payment by it would combine two
 * accounting bases the whole page exists to keep apart.
 *
 * So this card summarises the dataset's SCOPE — reference year and how many
 * municipalities fall in each served status — and hands the reader to the section
 * that holds the values. Every count comes from `meta`, which the backend computes
 * over the published scope; none is counted from rendered rows, and before a response
 * arrives the card states that rather than showing a 0.
 *
 * ── Independence ──────────────────────────────────────────────────────────────
 * Rendered OUTSIDE the official-landfill branch, exactly like the detail section it
 * points at. An official 404 (what a fresh database returns) leaves this card and the
 * section below fully operable, and a failure here changes nothing about the official
 * values above.
 *
 * ── The affordance ────────────────────────────────────────────────────────────
 * A same-page `<a>` rather than a scripted scroll: it works with keyboard, with
 * middle-click, and with JavaScript off, and because the target heading carries
 * `tabIndex={-1}` the browser moves FOCUS there too rather than only the viewport.
 * It reveals nothing — the section is always rendered — so no data is hidden behind
 * it (`MunicipalCostSection.tsx`).
 */

import type { MunicipalCostResponse } from "../../lib/api";
import type { MunicipalCostErrorState } from "../../lib/municipalCost";
import { MUNICIPAL_COST_STATUSES, statusChoiceCount, statusLabel } from "../../lib/municipalCost";
import SectionCard from "../ui/SectionCard";
import {
  MUNICIPAL_COST_DETAIL_LINK_LABEL,
  MUNICIPAL_COST_DETAIL_TARGET_ID,
  MUNICIPAL_COST_DISTINCTION_TITLE,
  MUNICIPAL_COST_SUMMARY_TITLE,
  MUNICIPAL_COST_YEAR_CHIP_SUFFIX,
} from "./municipalCostShared";
import { PAGE2_CARD_CLASS } from "./shared";

export interface MunicipalCostSummaryProps {
  /** The UNFILTERED served response — the same one the drill-down table joins. */
  data: MunicipalCostResponse | null;
  /** A genuine request failure. The detail section below owns the `role="alert"`. */
  error: MunicipalCostErrorState | null;
}

export default function MunicipalCostSummary({ data, error }: MunicipalCostSummaryProps) {
  const meta = data?.meta ?? null;
  return (
    <SectionCard
      title={MUNICIPAL_COST_SUMMARY_TITLE}
      // One line, and it is the distinction — this card's whole risk is that it sits
      // a few pixels under 공식 반입수수료 and gets read as more of the same money.
      description={MUNICIPAL_COST_DISTINCTION_TITLE}
      headerAside={
        meta ? (
          <span className="wep-chip" data-testid="municipal-cost-summary-year">
            {meta.reference_year}
            {MUNICIPAL_COST_YEAR_CHIP_SUFFIX}
          </span>
        ) : null
      }
      className={PAGE2_CARD_CLASS}
      testId="municipal-cost-kpi-summary"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {meta === null ? (
          <p className="text-xs text-ink-subtle" data-testid="municipal-cost-kpi-summary-state">
            {/* Never a 0 and never a dash that could be read as one. The no-error
                wording covers a request still in flight AND one that failed quietly
                (the unfiltered fetch this card counts from is deliberately silent —
                `app/page.tsx` — because the section below reports the failure with
                its own retryable message). Both are "not yet known", which is what
                it says; the section below is where a reader finds out which. */}
            {error
              ? "지급액 자료를 불러오지 못했습니다. 아래 상세 섹션에서 다시 확인할 수 있습니다."
              : "집계 범위를 아직 불러오지 못했습니다. 값이 0이라는 뜻이 아닙니다."}
          </p>
        ) : (
          <dl
            className="flex flex-wrap gap-x-6 gap-y-2 text-xs"
            data-testid="municipal-cost-kpi-coverage"
          >
            <Count term="대상 지자체" value={statusChoiceCount(meta, null)} />
            {MUNICIPAL_COST_STATUSES.map((status) => (
              <Count
                key={status}
                term={statusLabel(status)}
                value={statusChoiceCount(meta, status)}
                testId={`municipal-cost-kpi-count-${status.toLowerCase()}`}
              />
            ))}
          </dl>
        )}

        {/* Always offered, even while the dataset is loading or failed: the section
            it points at is always rendered, and its own states are the honest place
            to meet a loading or a failed request. */}
        <a
          className="wep-btn-quiet flex-none"
          href={`#${MUNICIPAL_COST_DETAIL_TARGET_ID}`}
          data-testid="municipal-cost-detail-link"
        >
          {MUNICIPAL_COST_DETAIL_LINK_LABEL}
        </a>
      </div>
    </SectionCard>
  );
}

/** One served count. Renders nothing at all rather than a 0 it has not been given. */
function Count({
  term,
  value,
  testId,
}: {
  term: string;
  value: number | null;
  testId?: string;
}) {
  if (value === null) return null;
  return (
    <div>
      <dt className="text-ink-subtle">{term}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink" data-testid={testId}>
        {value}곳
      </dd>
    </div>
  );
}
