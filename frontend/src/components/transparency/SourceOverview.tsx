"use client";

/**
 * 한눈에 보기 — four counts of SERVED registry records, and one live region.
 *
 * ── EVERY FIGURE IS COMPUTED, NEVER COPIED FROM THE DESIGN ─────────────────────
 * Figma frame 156:470 shows 9 / 6 / 5 / 2 in these four tiles. Those are prototype
 * placeholders and they contradict the production registry, so none of them appears
 * anywhere in this file. The values come from `summarizeSources()` over the records
 * the registry actually served, which is why the tile count moves on its own when a
 * source is registered, reclassified, given a documentation URL, or joined to a
 * reference period. `dataSources.test.ts` and this feature's suite both assert the
 * counters against fabricated registries of a DIFFERENT size, so a hardcoded number
 * could not pass.
 *
 * There is no completeness percentage, freshness score, or quality grade anywhere on
 * this screen: the redesign plan forbids all three, and the registry carries nothing
 * that could honestly support one. A unit test asserts this section contains no `%`,
 * no 점수, and no 등급.
 *
 * ── THE FIGMA TILE, AND THE ONE ADDITION ───────────────────────────────────────
 * The tile is Figma's: a filled (not bordered) surface, 17.5px radius, the label
 * above the figure, and the unit as a smaller muted suffix so the digits stay
 * dominant. The one thing kept that Figma drops is each tile's caption — the period
 * tile's caption is the only place that says an unresolved lookup is NOT `0건`, and
 * removing it to match a prototype would trade a data-integrity statement for
 * spacing.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { formatCount } from "../../lib/metrics";
import type { SourceOverview as SourceOverviewCounts } from "../../lib/dataSources";
import { OVERVIEW_SUMMARY, OVERVIEW_TITLE, type FreshnessState } from "./shared";

export interface SourceOverviewProps {
  overview: SourceOverviewCounts;
  freshnessState: FreshnessState;
}

/**
 * One counter tile.
 *
 * `value`/`unit` and `unavailableReason` are mutually exclusive: when a reason is
 * present it replaces BOTH, so an unavailable counter can never render as a number
 * and can never keep a dangling unit that would imply a quantity (repo AGENTS.md;
 * redesign plan §5 rules 1–3).
 */
function OverviewTile({
  label,
  value,
  unit,
  unavailableReason,
  caption,
  testId,
}: {
  label: string;
  value?: string;
  unit?: string;
  unavailableReason?: string;
  /**
   * Optional, and deliberately so. Figma's tile is label + figure and nothing else,
   * and three of the four captions only restated their own label (등록된 공식 자료 →
   * "이 서비스에 등록된 출처 기록 수입니다."). Those are gone. The one that survives
   * is the period tile's, which is the only place on the screen that can tell a
   * reader an UNRESOLVED lookup is not `0건` — there is no badge and no definition
   * that says it, and `TransparencyDashboard.test.tsx` asserts the sentence.
   */
  caption?: ReactNode;
  testId: string;
}) {
  const unavailable = unavailableReason !== undefined;
  return (
    // 14px radius, 14px/16px padding — the frame's tile, normalised off its 1.354808
    // scale (see TransparencySection for how that factor was established).
    <div className="rounded-[14px] bg-surface-muted px-4 py-3.5" data-testid={testId}>
      <dt className="text-xs text-ink-secondary">{label}</dt>
      {/* The caption is a SIBLING of the value, never a child of it: several tests
          read `dd.textContent` to prove an unresolved counter renders no digit, and
          the caption legitimately contains "0건이라는 뜻이 아닙니다". */}
      <dd
        className={
          unavailable ? "mt-2 text-sm font-medium text-ink-muted" : "mt-2 whitespace-nowrap"
        }
      >
        {unavailable ? (
          unavailableReason
        ) : (
          <>
            <span className="text-[22px] font-bold leading-tight tabular-nums text-ink">
              {value}
            </span>
            <span className="ml-[3px] text-xs text-ink-subtle">{unit}</span>
          </>
        )}
      </dd>
      {caption ? <p className="mt-1.5 text-xs text-ink-subtle">{caption}</p> : null}
    </div>
  );
}

export default function SourceOverview({ overview, freshnessState }: SourceOverviewProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="transparency-overview">
      <h2 id={headingId} className="text-base font-bold text-ink">
        {OVERVIEW_TITLE}
      </h2>
      <p className="mt-2 text-[13px] text-ink-subtle">{OVERVIEW_SUMMARY}</p>
      {/* Four across from 1024 up, as in Figma, at the frame's 14px gutter. At the
          minimum supported desktop width a 2×2 grid cost ~145px of the first
          viewport and pushed the catalog's first card below the fold for no
          informational gain. */}
      <dl className="mt-2.5 grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {/* No caption: the label already says it, and Figma's tile carries none. */}
        <OverviewTile
          label="등록된 공식 자료"
          value={formatCount(overview.total)}
          unit="건"
          testId="transparency-overview-total"
        />
        <OverviewTile
          label="자료 분야"
          value={formatCount(overview.areaCount)}
          unit="개"
          testId="transparency-overview-areas"
        />
        <OverviewTile
          label="기준 기간이 표시된 자료"
          // Only a COUNTED figure. While the freshness join is loading, and
          // permanently after it fails, no source has a period *yet* — printing
          // `0건` there would report an unfetched value as a measured zero
          // (§5 rule 2), and it would not self-correct.
          {...(freshnessState === "ready"
            ? { value: formatCount(overview.withReferencePeriod), unit: "건" }
            : {
                unavailableReason: freshnessState === "loading" ? "확인 중" : "확인하지 못했습니다",
              })}
          // The RESOLVED state carries NO caption. "나머지는 기준 기간이 제공되지 않은
          // 자료입니다" was arithmetic the reader can do from the two figures already
          // on screen, and what an absent reference period MEANS — not "no data", not
          // zero — is defined once in 공통 해석 기준 and carried by the card badge
          // where it applies.
          //
          // The UNRESOLVED state keeps its correction, and is the only caption left in
          // this section: there is no badge and no definition that can tell a reader an
          // un-fetched count is not a zero, so the tile has to say so itself.
          caption={
            freshnessState === "ready"
              ? undefined
              : "기준 기간 정보를 아직 확인하지 못했습니다. 0건이라는 뜻이 아닙니다."
          }
          testId="transparency-overview-period"
        />
        <OverviewTile
          label="원문 링크가 있는 자료"
          value={formatCount(overview.withLink)}
          unit="건"
          testId="transparency-overview-link"
        />
      </dl>
      {/* ONE persistent live region whose TEXT changes as the state resolves.
          An earlier version rendered the "loading" message conditionally and
          removed it on success — but a live region that already holds its text
          when it is inserted is generally not announced, and removing it
          announces nothing either, so the resolution was silent while the KPI
          and every card's 기준 기간 changed underneath. Keeping the node mounted
          and swapping its content is what actually gets announced. Never an
          alert: nothing here is something the reader must act on. */}
      <p role="status" className="sr-only" data-testid="transparency-freshness-status">
        {freshnessState === "loading"
          ? "자료 기준 기간을 불러오는 중입니다."
          : freshnessState === "error"
            ? "자료 기준 기간을 불러오지 못했습니다."
            : `자료 기준 기간 확인을 마쳤습니다. 전체 ${formatCount(overview.total)}건 중 ${formatCount(overview.withReferencePeriod)}건에 기준 기간이 있습니다.`}
      </p>
      {freshnessState === "error" && (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="transparency-freshness-error">
          자료 기준 기간을 불러오지 못했습니다. 기준 기간이 없는 것이 아니라 확인하지 못한 상태이며,
          출처 목록의 다른 정보는 그대로 표시됩니다.
        </p>
      )}
    </section>
  );
}
