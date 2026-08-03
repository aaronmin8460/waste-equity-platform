"use client";

/**
 * 자료 현황 요약 — four counts of SERVED registry records, and one live region.
 *
 * Every figure is a count of records the registry actually served. There is no
 * completeness percentage, freshness score, or quality grade anywhere on this
 * screen: the redesign plan forbids all three, and the registry carries nothing that
 * could honestly support one. A unit test asserts this section contains no `%`, no
 * 점수, and no 등급.
 *
 * Before the refresh the section's only heading was `sr-only`, so it was the one
 * block on the page a sighted reader could not name. It now carries a visible `h2`
 * and names itself as a region through `aria-labelledby`.
 */

import { useId } from "react";

import { formatCount } from "../../lib/metrics";
import type { SourceOverview as SourceOverviewCounts } from "../../lib/dataSources";
import KpiCard from "../ui/KpiCard";
import type { FreshnessState } from "./shared";

export interface SourceOverviewProps {
  overview: SourceOverviewCounts;
  freshnessState: FreshnessState;
}

export default function SourceOverview({ overview, freshnessState }: SourceOverviewProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="transparency-overview">
      <h2 id={headingId} className="text-sm font-semibold text-ink">
        자료 현황 요약
      </h2>
      <p className="mt-0.5 text-xs text-ink-subtle">
        이 서비스에 등록된 출처 기록을 센 값입니다. 자료의 완전성이나 품질을 평가한 값이 아닙니다.
      </p>
      {/* Four across from 1024 up: at the minimum supported desktop width a 2×2
          grid cost ~145px of the first viewport and pushed the catalog's first card
          below the fold for no informational gain. */}
      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="등록된 공식 자료"
          value={`${formatCount(overview.total)}건`}
          caption="이 서비스에 등록된 출처 기록 수입니다."
          testId="transparency-overview-total"
        />
        <KpiCard
          label="자료 분야"
          value={`${formatCount(overview.areaCount)}개`}
          caption="등록된 자료가 다루는 주제의 수입니다."
          testId="transparency-overview-areas"
        />
        <KpiCard
          label="기준 기간이 표시된 자료"
          // Only a COUNTED figure. While the freshness join is loading, and
          // permanently after it fails, no source has a period *yet* — printing
          // `0건` there would report an unfetched value as a measured zero
          // (§5 rule 2), and it would not self-correct.
          {...(freshnessState === "ready"
            ? { value: `${formatCount(overview.withReferencePeriod)}건` }
            : {
                unavailableReason: freshnessState === "loading" ? "확인 중" : "확인하지 못했습니다",
              })}
          caption={
            freshnessState === "ready"
              ? "나머지는 기준 기간이 제공되지 않은 자료이며, 자료가 없다는 뜻은 아닙니다."
              : "기준 기간 정보를 아직 확인하지 못했습니다. 0건이라는 뜻이 아닙니다."
          }
          testId="transparency-overview-period"
        />
        <KpiCard
          label="원문 링크가 있는 자료"
          value={`${formatCount(overview.withLink)}건`}
          caption="기관이 제공한 안내 주소가 등록된 자료입니다."
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
