"use client";

/**
 * 후보지 점수 — the score sub-view's analysis sidebar.
 *
 * The former `SuitabilityPanel` from `app/page.tsx`, now a composition of the
 * sections in this folder, in the numbered order Figma 136:8684 reads:
 *
 *   LEFT   ① 분석 범위 → ② 계산 모델 가중치 설정 → 후보 상태 요약 →
 *          자료 공백 → 계산 방법과 가정
 *   RIGHT  ③ 종합 점수와 후보 순위 (상대 점수 구간 + 순위 보기) →
 *          ④ 시나리오 저장 → ⑤ 비교할 시나리오 선택 →
 *          안정 후보 목록 → 선택한 후보 구역 → 제외 / 검토 사유
 *
 * ④ 시나리오 저장 and ⑤ 비교할 시나리오 선택 WORK (Page 4D) and close the
 * numbering: they are injected as ready-made nodes (`scenarioSavePanel` /
 * `scenarioComparePanel`) the way `relativeGradePanel` already is, because the page
 * owns the localStorage list, the preview re-validation and the A/B state — this
 * column stays pure presentation with no storage access of its own.
 *
 * They follow ③ DIRECTLY. Figma 136:8684's right column is ③④⑤ and nothing else,
 * so in the frame "우측 맨 하단" (the page-4 기술요청 annotation 225:443) and
 * "directly after ③" are the same place. In production they are not: the four
 * supporting cards between them pushed ④ and ⑤ far below the fold, which broke the
 * numbered sequence the screen asks a reader to follow. The frame's ORDER wins and
 * the supporting cards move below ⑤.
 *
 * (The screening disclaimer is rendered ABOVE this by the page, so it heads both
 * map sub-views; the page's `<h1>` and orientation line precede that.)
 *
 * It is PURE PRESENTATION. Every value it renders was already fetched and derived
 * by `page.tsx`, which keeps the one `profile`, `selected`, `statusVisibility`, and
 * `stableOnly` state. Nothing here computes a score, a rank, a weight, a status, or
 * a stability class, and there is no second copy of any of those states.
 */

import type {
  CandidateDetail,
  SuitabilityCandidateCollection,
  SuitabilityPolicy,
  SuitabilityProfile,
  SuitabilityRun,
  SuitabilitySort,
  SuitabilityStatus,
  SuitabilitySummary,
} from "../../lib/api";
import type { ScopeRegionOption, SuitabilityScope } from "../../lib/suitabilityScope";
import type { StatusVisibility } from "../MapView";
import { profileLabel, statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";
import SuitabilityCandidateList from "./SuitabilityCandidateList";
import SuitabilityCandidateSummary from "./SuitabilityCandidateSummary";
import SuitabilityScopeCard from "./SuitabilityScopeCard";
import SuitabilityScoringBasis from "./SuitabilityScoringBasis";
import SuitabilityStabilitySummary from "./SuitabilityStabilitySummary";
import SuitabilityStatusSummary from "./SuitabilityStatusSummary";
import UnmodeledFactorsDisclosure from "./UnmodeledFactorsDisclosure";

export interface SuitabilityMeta {
  policy: SuitabilityPolicy;
  run: SuitabilityRun;
  summary: SuitabilitySummary;
}

export interface SuitabilitySidebarProps {
  suit: SuitabilityMeta | null;
  suitError: string | null;
  profile: SuitabilityProfile;
  setProfile: (profile: SuitabilityProfile) => void;
  runProfiles: SuitabilityProfile[];
  stabilityAvailable: boolean;
  selected: CandidateDetail | null;
  clearSelected: () => void;
  onSelect: (candidateId: number) => void;
  /** Canonical map-display state, reported (not owned) by this column. */
  statusVisibility: StatusVisibility;
  stableOnly: boolean;
  /** Status swatch colors from the page's candidate constants. */
  statusColors: Record<SuitabilityStatus, string>;
  /**
   * Which column of the three-column 후보지 심층 분석 workspace to render
   * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §6).
   *
   *   "left"  — what you ASK: scoring basis, weights, status/stability context,
   *             method and limitations.
   *   "right" — what you GET: ranking, relative band, selected candidate, and the
   *             served exclusion/review reasons.
   *   "all"   — the original single column, still used by the stacked mobile
   *             layout and by 후보지 심층 비교, which has no third column.
   *
   * Splitting by prop rather than into two components keeps ONE definition of the
   * loading, error, and live-region behaviour; two components would be two places
   * for those to drift apart.
   */
  part?: "left" | "right" | "all";
  /** The A/B/C panel, injected by the page (it owns the distribution fetch). */
  relativeGradePanel?: React.ReactNode;
  /**
   * ④ 시나리오 저장 and ⑤ 비교할 시나리오 선택, injected by the page for the same
   * reason the A/B/C panel is: their state (the browser's saved-scenario list, the
   * preview re-validation, the A/B pair mirrored into `cmpA`/`cmpB`) belongs to the
   * one page, and a second copy of it in this column could disagree with the URL.
   * Rendered only in the three-column workspace (`part="right"`), which is the only
   * shape Figma 136:8684 places them in.
   */
  scenarioSavePanel?: React.ReactNode;
  scenarioComparePanel?: React.ReactNode;
  /**
   * ① 분석 범위 and ③ 순위 방향. Owned by the page — this column reports them, and
   * the ONE scope drives the ranking read, the A/B/C population, the map filter and
   * the selected-candidate check together, so no two surfaces can disagree.
   */
  scope: SuitabilityScope;
  onScopeChange: (scope: SuitabilityScope) => void;
  regionOptions: readonly ScopeRegionOption[];
  scopeName: string;
  mapFollowsScope: boolean;
  ranking: SuitabilityCandidateCollection | null;
  rankingError: string | null;
  sort: SuitabilitySort;
  onSortChange: (sort: SuitabilitySort) => void;
  /**
   * Open 순위 전체보기. Passed straight through to the ranking block — this column
   * neither owns the dialog nor knows what it renders, it only reports the intent.
   */
  onOpenFullRanking?: () => void;
}

export default function SuitabilitySidebar({
  suit,
  suitError,
  profile,
  setProfile,
  runProfiles,
  stabilityAvailable,
  selected,
  clearSelected,
  onSelect,
  statusVisibility,
  stableOnly,
  statusColors,
  part = "all",
  relativeGradePanel,
  scenarioSavePanel,
  scenarioComparePanel,
  scope,
  onScopeChange,
  regionOptions,
  scopeName,
  mapFollowsScope,
  ranking,
  rankingError,
  sort,
  onSortChange,
  onOpenFullRanking,
}: SuitabilitySidebarProps) {
  // The error and loading states belong to ONE column. Rendering them in both
  // would duplicate a single failure into two identical messages on one screen.
  if (suitError) {
    if (part === "right") return null;
    return (
      <SectionCard title="후보지 점수" testId="suitability-error">
        {/* A genuine, actionable failure — the one place `role="alert"` is correct
            on this screen. The standing screening disclaimer above is not. */}
        <InfoBanner tone="error" role="alert">
          <p>{suitError}</p>
        </InfoBanner>
      </SectionCard>
    );
  }
  if (suit === null) {
    if (part === "right") return null;
    return (
      <p className="text-sm text-ink-muted" role="status" data-testid="suitability-loading">
        후보지 분석을 불러오는 중…
      </p>
    );
  }

  const summary = suit.summary;
  const showLeft = part === "left" || part === "all";
  const showRight = part === "right" || part === "all";
  /**
   * The Page-4 three-column workspace versus the single-column shape 후보지 심층 비교
   * still renders. The page-4 기술 참고사항 list (Figma 225:440) strikes the
   * supporting cards from THIS screen only, so the strikes are scoped rather than
   * applied unconditionally — removing them from `part="all"` would regress a screen
   * no annotation asks to change.
   */
  const workspace = part === "left" || part === "right";
  const singleColumn = part === "all";
  // The scope/sort props every SuitabilityCandidateList below shares. One object so
  // the ranking cannot be rendered with a different scope from the one ① is showing.
  const rankingProps = {
    ranking,
    rankingError,
    sort,
    onSortChange,
    scopeName,
    scopeActive: scope.kind !== "all",
    mapFollowsScope,
    // Only the ranking block renders the trigger; the stability short-list is a
    // different population and `showRanking` already gates it out there.
    onOpenFullRanking,
  };
  return (
    <>
      {/* Screen-reader status: announced when the score basis changes and when the
          candidate summary updates (both change this text). Kept concise; the same
          counts are shown visibly below. Unchanged wording. */}
      {showLeft && (
      <p role="status" className="sr-only" data-testid="suitability-live">
        점수 반영 기준 {profileLabel(profile)}. {statusLabel("ELIGIBLE")}{" "}
        {formatCount(summary.candidate_count_eligible)}개, {statusLabel("REVIEW_REQUIRED")}{" "}
        {formatCount(summary.candidate_count_review)}개.
      </p>
      )}

      {/* ① 분석 범위 — the real scope control. Its state is the ONE thing that
          narrows the ranking, the counts and the A/B/C population together. */}
      {showLeft && (
        <SuitabilityScopeCard
          summary={summary}
          scope={scope}
          onScopeChange={onScopeChange}
          regionOptions={regionOptions}
        />
      )}

      {/* ── THE READINESS SENTINEL ──────────────────────────────────────────────
          `suitability-summary` is the "후보지 심층 분석 has loaded" gate for nine e2e
          specs across five OTHER pages (publicRelease, transparencyDashboard,
          responsive, scenario, desktopNavigation, facilityCost, suitabilityDashboard).
          It used to live on 후보 상태 요약 — a card the 기술 참고사항 list strikes from
          this workspace — so the strike would have deleted the sentinel everywhere.

          It is MIGRATED here rather than dropped: a transparent wrapper around card ②,
          which is present and visible for the whole life of the view. The specs gate on
          visibility, which this satisfies, and the id now marks "the analysis column is
          up" rather than "one particular supporting card exists".

          Exactly ONE element carries the id in any shape: the wrapper is workspace-only
          and 후보 상태 요약 (which still carries it) is single-column-only, so
          transparencyDashboard's count-of-1 assertion holds either way.

          NOT `display: contents` — that leaves the wrapper with no bounding box, and
          Playwright's toBeVisible() requires one. A plain div is a single flex child
          of .wep-panel-body exactly as the bare card was, so the column's 20px
          rhythm is unchanged. */}
      {workspace && showLeft && (
        <div data-testid="suitability-summary">
          <SuitabilityScoringBasis
            policy={suit.policy}
            run={suit.run}
            profile={profile}
            onSelectProfile={setProfile}
            runProfiles={runProfiles}
            stabilityAvailable={stabilityAvailable}
            selected={selected}
            stableOnly={stableOnly}
            /* The workspace strikes 자료 공백 안내 and 계산 방법과 가정 as standing
               cards, so card ② takes custody of what they said via its
               점수 기준 자세히 보기 disclosure. Passed only in this shape — the
               single-column layout still renders both as their own cards below. */
            summary={summary}
          />
        </div>
      )}

      {singleColumn && (
      <SuitabilityScoringBasis
        policy={suit.policy}
        run={suit.run}
        profile={profile}
        onSelectProfile={setProfile}
        runProfiles={runProfiles}
        stabilityAvailable={stabilityAvailable}
        selected={selected}
        stableOnly={stableOnly}
      />
      )}

      {/* 후보 상태 요약 — STRUCK from the workspace (기술 참고사항: "좌측 패널에
          [후보 상태 요약] … 삭제"). The status breakdown it carried is still on the
          map's own 스크리닝 내역 legend, which is where the annotation says it
          suffices. Its readiness sentinel moved to card ② above. */}
      {singleColumn && (
      <SuitabilityStatusSummary
        summary={summary}
        policy={suit.policy}
        run={suit.run}
        statusVisibility={statusVisibility}
        stableOnly={stableOnly}
        stabilityAvailable={stabilityAvailable}
        statusColors={statusColors}
      />
      )}

      {/* ③ 종합 점수와 후보 순위 — ONE card holding the relative band legend and the
          ranking, the way Figma 136:8684 groups them. The band explains how to read
          a score; the ranking is that score applied. Splitting them into two cards
          (as before) put a full card of caveats between a reader and the list.

          In the single-column shapes (`part="all"` — the stacked phone layout and
          후보지 심층 비교) the two stay separate cards: the grouping is a
          three-column desktop idea, and nesting them in a narrow stack would add a
          heading level for nothing. */}
      {showRight && part === "right" ? (
        <SectionCard
          title="③ 종합 점수와 후보 순위"
          description="설정한 점수 반영 기준으로 합산한 점수와 그 순위입니다."
          testId="suitability-results"
          className="wep-figma-card wep-numbered-card"
        >
          <div className="flex flex-col gap-3">
            {relativeGradePanel}
            <SuitabilityCandidateList
              summary={summary}
              profile={profile}
              selected={selected}
              onSelect={onSelect}
              stabilityAvailable={stabilityAvailable}
              {...rankingProps}
              nested
              section="ranking"
            />
            {/* 선택한 후보 구역, relocated INTO ③ from its own struck card. It renders
                nothing until a row is selected, so the closed state of ③ is exactly
                the frame's three-card right column; selecting a rank row then reveals
                that candidate's detail directly beneath the row that produced it. */}
            <SuitabilityCandidateSummary detail={selected} clearSelected={clearSelected} nested />
          </div>
        </SectionCard>
      ) : (
        showRight && (
          <>
            {relativeGradePanel}
            <SuitabilityCandidateList
              summary={summary}
              profile={profile}
              selected={selected}
              onSelect={onSelect}
              stabilityAvailable={stabilityAvailable}
              {...rankingProps}
            />
          </>
        )
      )}

      {/* ④ → ⑤ IMMEDIATELY AFTER ③, which is the whole right column in Figma
          136:8684 (340×535, 340×230, 340×429 and nothing else).
          They used to sit at the very foot, below six unnumbered cards, on the
          strength of the page-4 기술요청 annotation (225:443) reading "우측 맨 하단
          [두 시나리오 비교하기]". In the frame those two things are the same
          position; in production they are not — the extra cards pushed ④ and ⑤ some
          1800px down, so the numbered sequence a reader is asked to follow was
          broken by a scroll neither the frame nor the annotation has. The frame
          wins: ③④⑤ read in order, and the supporting cards follow them.
          ⑤ still follows ④ because you cannot select a scenario you have not
          saved. */}
      {showRight && part === "right" && scenarioSavePanel}
      {showRight && part === "right" && scenarioComparePanel}

      {/* ── THE RIGHT-COLUMN STRIKE LIST (기술 참고사항 225:440) ──────────────────
          "우측 패널에 [기준을 바꿔도 상위권인 후보지], [선택한 후보 구역],
           [기준을 바꿔도 상위권을 유지하는 정도], [현재 기준에서 제외된 사유],
           [추가 확인이 필요한 사유] 삭제"

          Four of the five are struck outright here — they are reporting surfaces
          whose signal survives elsewhere: every ranking row still carries its own
          안정 후보 badge, and the map legend still draws the stable outline.

          The fifth, 선택한 후보 구역, is NOT deleted. It is the only surface showing a
          selected candidate's per-component detail, so deleting the card would delete
          working functionality rather than a duplicate label. It MOVES INSIDE ③,
          directly under the ranking that produces it — which keeps the frame's
          right column at exactly three cards (③④⑤) while selecting a rank row still
          shows its candidate. */}

      {singleColumn && (
      <SuitabilityCandidateSummary detail={selected} clearSelected={clearSelected} />
      )}

      {singleColumn && (
      <SuitabilityStabilitySummary summary={summary} available={stabilityAvailable} />
      )}

      {singleColumn && (
      <ReasonSummary
        title="현재 기준에서 제외된 사유"
        counts={summary.exclusion_reason_counts}
        testId="exclusion-reason-summary"
      />
      )}
      {singleColumn && (
      <ReasonSummary
        title="추가 확인이 필요한 사유"
        counts={summary.review_reason_counts}
        testId="review-reason-summary"
      />
      )}

      {singleColumn && summary.coverage_notes.length > 0 && (
        <SectionCard title="자료 공백 안내" testId="coverage-warnings">
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-muted">
            {summary.coverage_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-subtle">
            자료가 없는 항목은 공백이며 &quot;해당 없음&quot;을 확인한 것이 아닙니다.
          </p>
        </SectionCard>
      )}

      {/* 계산 방법과 가정 — struck from the workspace (기술 참고사항 225:440). Its
          assumptions, its disclaimer and the unmodeled-factor disclosure all moved
          into card ②'s 점수 기준 자세히 보기, so nothing left the product. */}
      {singleColumn && (
      <SectionCard title="계산 방법과 가정" testId="suitability-methodology">
        <ul className="list-disc space-y-1 pl-4 text-xs text-ink-muted">
          {summary.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs font-medium text-warn" data-testid="suitability-disclaimer">
          {summary.disclaimer}
        </p>
        <div className="mt-2">
          <UnmodeledFactorsDisclosure testId="suitability-unmodeled-factors" />
        </div>
      </SectionCard>
      )}
    </>
  );
}

/**
 * A served reason → count breakdown, in descending count order. Renders nothing
 * when the run served no reasons — an empty object is not a zero to display.
 */
function ReasonSummary({
  title,
  counts,
  testId,
}: {
  title: string;
  counts: Record<string, number>;
  testId: string;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <SectionCard title={title} testId={testId}>
      <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
        {entries.map(([reason, count]) => (
          <li key={reason} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{reason}</span>
            <span className="flex-none tabular-nums text-ink-subtle">{formatCount(count)}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
