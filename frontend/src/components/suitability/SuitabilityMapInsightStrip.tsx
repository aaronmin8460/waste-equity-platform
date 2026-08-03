"use client";

/**
 * 후보지 분석 map insight strip — 해석 · 주의 · 현재 기준·출처, over the map.
 *
 * The suitability counterpart of `equity/EquityMapInsightStrip`, and it floats for
 * exactly the same reason: the map pane is contracted to reach the viewport bottom
 * with nothing beneath it at desktop (docs/ui-refresh/regression-contract.md §4;
 * `e2e/responsive`, `e2e/civicShell`, `e2e/desktopNavigation` all assert it), so an
 * in-flow band under the map would shorten the canvas and break every one of those.
 *
 * It is the second child of the map's bottom-anchored overlay COLUMN (`page.tsx`),
 * directly under the floating legend, so the two can never collide however tall
 * either becomes — non-collision is structural, not a hand-tuned offset. Below the
 * 1024px minimum supported width it is not rendered at all: nothing here is
 * mandatory-only-here (the profile, the run context, the status visibility, and the
 * disclaimers all appear in the sidebar too), so hiding it narrow removes no
 * required disclosure (repo AGENTS.md).
 *
 * ── Content rules ───────────────────────────────────────────────────────────────
 * Every string is either passed in from already-served state (the profile label, the
 * applied weights, the run id, the version strings, the reference year) or is a
 * standing limitation this application already documents. It renders NO score, NO
 * rank, and NO count, so it cannot show a missing value as a zero. It never claims a
 * candidate is legally suitable, environmentally safe, constructible, approved, or
 * recommended — the 주의 column says the opposite in as many words.
 *
 * `role` is deliberately absent: this is standing explanatory content, not an
 * actionable error, so it must not be `role="alert"` (components/ui/InfoBanner.tsx).
 */

import type { SuitabilityProfile, SuitabilityStatus } from "../../lib/api";
import { profileLabel } from "../../lib/glossary";
import InfoBanner from "../ui/InfoBanner";
import { STATUS_LABELS } from "./shared";

export interface SuitabilityMapInsightStripProps {
  /** `score` = the stored run + profile; `scenario` = the 가중치 바꿔보기 view. */
  variant: "score" | "scenario";
  /** Active stored profile (the score view's basis, and the scenario's comparison). */
  profile: SuitabilityProfile;
  /** Applied user-scenario weights, already formatted as percents. Scenario only. */
  scenarioWeights: { label: string; percent: string }[] | null;
  /** Statuses currently drawn on the candidate layer. */
  visibleStatuses: SuitabilityStatus[];
  /** Whether the stable-only restriction is active. */
  stableOnly: boolean;
  /** Served run identifier + reference year for the diagnostic line. */
  runId: number;
  referenceYear: number;
  /** Served version strings (diagnostic layer — never a primary citizen label). */
  policyVersion: string;
  derivationVersion: string;
  candidateGridVersion: string;
  /** Opens the existing 데이터·출처 area. */
  onOpenSources: () => void;
}

export default function SuitabilityMapInsightStrip({
  variant,
  profile,
  scenarioWeights,
  visibleStatuses,
  stableOnly,
  runId,
  referenceYear,
  policyVersion,
  derivationVersion,
  candidateGridVersion,
  onOpenSources,
}: SuitabilityMapInsightStripProps) {
  const scenario = variant === "scenario";
  const appliedWeights = scenario && scenarioWeights && scenarioWeights.length > 0 ? scenarioWeights : null;
  return (
    // Positioning belongs to the page's bottom overlay stack (see page.tsx); this
    // wrapper only decides at which widths the strip participates.
    <div
      className="pointer-events-none hidden w-full lg:block"
      data-testid="suitability-insight-strip-wrapper"
    >
      <section
        aria-label="지도 해석 안내"
        data-testid="suitability-insight-strip"
        className="pointer-events-auto grid grid-cols-1 gap-x-4 gap-y-3 rounded-card border border-hairline bg-surface/95 p-3 text-xs text-ink-muted shadow-float backdrop-blur-sm lg:grid-cols-3"
      >
        {/* 해석 — what the shading means under the CURRENT basis. Neutral by design:
            a relative screening score, never a recommendation. */}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">해석</h2>
          <p className="mt-1 leading-snug text-ink" data-testid="suitability-insight-interpretation">
            {scenario ? (
              appliedWeights ? (
                <>
                  이 지도는 <span className="font-semibold">사용자가 조정한 가중치</span>로 다시
                  계산한 후보 구역의 상대적 스크리닝 점수를 보여줍니다. 점수가 높을수록 색이
                  진해집니다.
                </>
              ) : (
                <>
                  아직 시나리오를 적용하지 않아, 지도는 저장된 분석 실행의 후보 상태를 그대로
                  보여줍니다. 왼쪽에서 가중치를 조정한 뒤 「시나리오 적용」을 누르세요.
                </>
              )
            ) : (
              <>
                이 지도는 <span className="font-semibold">{profileLabel(profile)}</span>{" "}
                기준에 따른 후보 구역의 상대적 스크리닝 점수를 보여줍니다. 점수가 높을수록 색이
                진해집니다.
              </>
            )}
          </p>
        </div>

        {/* 주의 — standing limitations only. The banner supplies this column's own
            visible label ("주의 · …") as TEXT, so it carries no second heading. */}
        <div className="min-w-0">
          <InfoBanner
            tone="warning"
            title={scenario ? "비교용 시나리오" : "결과 해석 한계"}
            testId="suitability-insight-caution"
          >
            <p className="leading-snug">
              {scenario
                ? "사용자 설정에 따른 비교용 시나리오이며 공식 분석 실행이 아닙니다. 구역 상태·제외 사유·안정성은 다시 계산되지 않습니다."
                : "점수와 순위는 현재 확보된 공공자료와 분석 규칙에 따른 1차 비교 결과이며 법적·공학적 적합 판정이 아닙니다."}
            </p>
          </InfoBanner>
        </div>

        {/* 현재 기준·출처 — the served basis, what the map is currently drawing, and
            the existing route to the 데이터·출처 area. Version strings are paired
            with plain-Korean labels and kept in a diagnostic detail line. */}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            현재 기준·출처
          </h2>
          <dl className="mt-1 space-y-0.5 leading-snug" data-testid="suitability-insight-basis">
            <div>
              <dt className="inline font-medium">{scenario ? "비교 기준" : "점수 반영 기준"}: </dt>
              <dd className="inline text-ink">{profileLabel(profile)}</dd>
            </div>
            {appliedWeights && (
              <div>
                <dt className="inline font-medium">적용 가중치: </dt>
                <dd className="inline tabular-nums text-ink">
                  {appliedWeights.map((w) => `${w.label} ${w.percent}`).join(" · ")}
                </dd>
              </div>
            )}
            <div>
              <dt className="inline font-medium">자료 기준 시점: </dt>
              <dd className="inline tabular-nums text-ink">{referenceYear}</dd>
            </div>
            <div>
              <dt className="inline font-medium">지도 표시: </dt>
              <dd className="inline text-ink" data-testid="suitability-insight-visibility">
                {visibleStatuses.length === 0
                  ? "표시 중인 상태 없음"
                  : visibleStatuses.map((status) => STATUS_LABELS[status]).join(" · ")}
                {stableOnly ? " · 안정 후보만" : ""}
              </dd>
            </div>
          </dl>
          <details className="mt-1" data-testid="suitability-insight-technical">
            <summary className="cursor-pointer text-[11px] text-ink-subtle">기술 정보</summary>
            <p className="mt-1 text-[11px] break-all text-ink-subtle" data-diagnostic>
              분석 실행 #{runId} · 분석 규칙 버전 {policyVersion} · 계산 방식 버전{" "}
              {derivationVersion} · 분석 구역 버전 {candidateGridVersion}
            </p>
          </details>
          {/* Deliberately NOT labelled "데이터·출처": that exact string is the
              navigation tab's frozen label (regression-contract §1), and several
              specs locate that tab by accessible name without `exact`, so a second
              control CONTAINING it makes those locators ambiguous. This one names
              the action instead of the destination. */}
          <button
            type="button"
            className="wep-btn-quiet mt-2"
            onClick={onOpenSources}
            data-testid="suitability-insight-open-sources"
          >
            출처 자세히 보기
          </button>
        </div>
      </section>
    </div>
  );
}
