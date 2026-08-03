"use client";

/**
 * The Phase 0 standing analytical-screening disclaimer for the two map sub-views
 * (후보지 점수 / 가중치 바꿔보기). Moved out of `app/page.tsx` unchanged.
 *
 * It heads the suitability sidebar rather than sitting in a full-width header row,
 * because the map sub-views guarantee the map starts immediately below the sub-view
 * bar and fills the viewport (`e2e/desktopNavigation`, `e2e/responsive`); a
 * full-width band there would open a gap above the map and shrink it below its
 * dominant height. In the sidebar it is visible near the top of the view on both
 * desktop and mobile without obstructing the map.
 *
 * It is a neutral `InfoBanner` (tone `info`, never `role="alert"` — it is standing
 * explanatory content, not an actionable error) with a text severity label, inside
 * an aria-labelled landmark, and it is NEVER inside a disclosure: the limitation
 * must be readable without any user interaction. The 비용 살펴보기 sub-view has no
 * sidebar, so it renders the SAME shared string in its own top notice
 * (`FacilityCostDashboard`). It never appears on the equity map.
 */

import {
  SUITABILITY_SCREENING_DISCLAIMER,
  SUITABILITY_SCREENING_DISCLAIMER_TITLE,
} from "../../lib/glossary";
import InfoBanner from "../ui/InfoBanner";

export default function SuitabilityScreeningNotice() {
  return (
    <section aria-label="후보지 분석 안내" data-testid="suitability-screening-notice">
      <InfoBanner
        tone="info"
        title={SUITABILITY_SCREENING_DISCLAIMER_TITLE}
        testId="suitability-screening-disclaimer"
      >
        <p>{SUITABILITY_SCREENING_DISCLAIMER}</p>
      </InfoBanner>
    </section>
  );
}
