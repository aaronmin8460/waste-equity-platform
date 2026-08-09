"use client";

/**
 * 후보지 점수 — the score sub-view's analysis sidebar.
 *
 * The former `SuitabilityPanel` from `app/page.tsx`, now a composition of the
 * sections in this folder, in the order the screen's workflow reads:
 *
 *   scoring basis → status totals → stability → candidate list →
 *   selected candidate → exclusion / review reasons → coverage gaps → method
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
  SuitabilityPolicy,
  SuitabilityProfile,
  SuitabilityRun,
  SuitabilityStatus,
  SuitabilitySummary,
} from "../../lib/api";
import type { StatusVisibility } from "../MapView";
import { profileLabel, statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";
import SuitabilityCandidateList from "./SuitabilityCandidateList";
import SuitabilityCandidateSummary from "./SuitabilityCandidateSummary";
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

      {showLeft && (
      <SuitabilityScoringBasis
        policy={suit.policy}
        run={suit.run}
        profile={profile}
        onSelectProfile={setProfile}
        runProfiles={runProfiles}
        stabilityAvailable={stabilityAvailable}
      />
      )}

      {showLeft && (
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

      {showRight && relativeGradePanel}

      {showRight && (
      <SuitabilityStabilitySummary summary={summary} available={stabilityAvailable} />
      )}

      {showRight && (
      <SuitabilityCandidateList
        summary={summary}
        profile={profile}
        selected={selected}
        onSelect={onSelect}
        stabilityAvailable={stabilityAvailable}
      />
      )}

      {showRight && (
      <SuitabilityCandidateSummary detail={selected} clearSelected={clearSelected} />
      )}

      {showRight && (
      <ReasonSummary
        title="현재 기준에서 제외된 사유"
        counts={summary.exclusion_reason_counts}
        testId="exclusion-reason-summary"
      />
      )}
      {showRight && (
      <ReasonSummary
        title="추가 확인이 필요한 사유"
        counts={summary.review_reason_counts}
        testId="review-reason-summary"
      />
      )}

      {showLeft && summary.coverage_notes.length > 0 && (
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

      {showLeft && (
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
