"use client";

/**
 * 이 계산이 무엇을 포함하고 무엇을 포함하지 않는가 — the standing scope notice that
 * heads the setup screen.
 *
 * Two layers, unchanged in content from the pre-refresh version: one compact
 * neutral banner carrying the regional-screening disclaimer, the decision-support
 * disclaimer, and the three claims a citizen must not misread; and the full
 * eight-item list in a COLLAPSED disclosure whose summary states how many items it
 * holds. No wording is softened and nothing is removed — only its prominence and
 * its GROUPING changed.
 *
 * What the refresh changed: the eight items were one flat bullet list mixing two
 * different kinds of statement. They are now under two headings — 이 계산에 포함되지
 * 않은 비용 (5) and 이 값이 아닌 것 (3) — because "운영비 미포함" and "실제 총사업비가
 * 아님" answer different questions. The strings, their order, and the count in the
 * summary are unchanged (`COMPLETENESS_NOTICES` is still the concatenation).
 *
 * `facility-cost-completeness` stays on the element that holds the full list, so its
 * test contract is unchanged. The backend's structured `missing_components` are not
 * duplicated here: they have their own results section, which is the screen they
 * belong to.
 */

import { SUITABILITY_SCREENING_DISCLAIMER } from "../../lib/glossary";
import Accordion from "../ui/Accordion";
import InfoBanner from "../ui/InfoBanner";
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
    <>
      {/* Standing disclaimer: informational, never role="alert" — it must not
          interrupt a screen reader on every render. */}
      <InfoBanner tone="info" testId="facility-cost-notice">
        {/* Phase 0: the shared regional-screening disclaimer heads the cost sub-view
            too (the same string the score/scenario shell banner shows), so 후보지 분석
            carries one consistent scope statement across all three sub-views. */}
        <p className="font-medium" data-testid="suitability-screening-disclaimer">
          {SUITABILITY_SCREENING_DISCLAIMER}
        </p>
        <p className="mt-2" data-testid="facility-cost-disclaimer">{PAGE_DISCLAIMER}</p>
        <p className="mt-2 font-medium">{SETUP_NON_CLAIMS}</p>
      </InfoBanner>

      <div className="mt-3">
        <Accordion
          label={`분석에 포함되지 않은 항목 ${COMPLETENESS_NOTICES.length}가지`}
          testId="facility-cost-completeness"
        >
          <p className="text-sm text-ink-muted">
            현재 결과는 표준공사비 기반 설치비 분석입니다. 아래 항목은 포함되지 않았습니다.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NoticeGroup title="이 계산에 포함되지 않은 비용" items={EXCLUDED_ITEM_NOTICES} />
            <NoticeGroup title="이 값이 아닌 것" items={NON_CLAIM_NOTICES} />
          </div>
        </Accordion>
      </div>
    </>
  );
}
