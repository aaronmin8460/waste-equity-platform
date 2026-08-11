"use client";

/**
 * 이 계산이 무엇을 포함하고 무엇을 포함하지 않는가 — the standing scope statement.
 *
 * ── Where it went, and why nothing was deleted ───────────────────────────────────
 * The Figma technical note (221:3443) asks for the bottom 알림 banner and the
 * 「분석에 포함되지 않은 항목 8가지」 tab to be removed from the screen. They are
 * removed from the PRIMARY WORKFLOW — the three-step column no longer opens or
 * closes with a block of caveat — and the content itself is preserved here, in full,
 * inside the 계산 방법과 한계 disclosure (`FacilityCostDetails`).
 *
 * Nothing is softened, renamed, regrouped, or dropped: the same three disclaimers,
 * the same eight items under the same two headings, in the same order, from the same
 * `COMPLETENESS_NOTICES` concatenation — so the count in the heading still cannot
 * drift from the items beneath it. `facility-cost-completeness` still marks the
 * element that holds the full list.
 *
 * What a reader keeps WITHOUT opening anything is the compact restatement under the
 * result figures (`RESULT_FOOTNOTE` plus the per-capita non-claim), which carries
 * the three claims that must never be misread.
 */

import { SUITABILITY_SCREENING_DISCLAIMER } from "../../lib/glossary";
import {
  COMPLETENESS_NOTICES,
  EXCLUDED_ITEM_NOTICES,
  NON_CLAIM_NOTICES,
  PAGE_DISCLAIMER,
  SETUP_NON_CLAIMS,
} from "./shared";

function NoticeGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
        {items.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
    </div>
  );
}

export default function FacilityCostNotice() {
  return (
    <div data-testid="facility-cost-notice">
      {/* The same shared string card ③ keeps VISIBLE on the screen; restated here
          in full context. It carries no test id, because the visible one is the
          single element the sub-view contract addresses — two would make
          `getByTestId` ambiguous. */}
      <p className="text-sm font-medium text-ink">{SUITABILITY_SCREENING_DISCLAIMER}</p>
      <p className="mt-2 text-sm text-ink-muted" data-testid="facility-cost-disclaimer">
        {PAGE_DISCLAIMER}
      </p>
      <p className="mt-2 text-sm font-medium text-ink-muted">{SETUP_NON_CLAIMS}</p>

      <div className="mt-4" data-testid="facility-cost-completeness">
        <p className="text-sm font-semibold text-ink">
          분석에 포함되지 않은 항목 {COMPLETENESS_NOTICES.length}가지
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          현재 결과는 표준공사비 기반 설치비 분석입니다. 아래 항목은 포함되지 않았습니다.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NoticeGroup title="이 계산에 포함되지 않은 비용" items={EXCLUDED_ITEM_NOTICES} />
          <NoticeGroup title="이 값이 아닌 것" items={NON_CLAIM_NOTICES} />
        </div>
      </div>
    </div>
  );
}
