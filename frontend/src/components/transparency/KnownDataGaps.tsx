"use client";

/**
 * 현재 제공되지 않는 자료 — the four gaps this application can state truthfully.
 *
 * They are four DIFFERENT kinds of gap and the section keeps them apart, because
 * collapsing them into one "missing data" list would suggest a single cause:
 *
 *   1. 아직 연계하지 못한 공식 자료 — the cost components whose official source is not
 *      integrated. Rendered FROM `MISSING_COMPONENT_META` so this list and the cost
 *      dashboard cannot drift into two wordings (they already had, once).
 *   2. 지도에 표시하지 못한 시설 — records that exist and are counted, but whose
 *      address could not be resolved to a coordinate.
 *   3. 기준 기간을 확인하지 못한 자료 — registered sources for which the freshness join
 *      served no reference period.
 *   4. 아직 분석에 넣지 못한 입지 요인 — the physical / environmental / legal
 *      conditions the regional screening does not evaluate yet. Rendered from
 *      `UnmodeledFactorsDisclosure`, the SAME component and the same shared glossary
 *      constants the suitability screens use, so this screen and those can never
 *      list different factors. Page 6 is where a reader comes to find out what the
 *      platform does not have; a coverage gap that only exists inside the analysis
 *      area is invisible to exactly that reader.
 *
 * None of the four is an error, and none of them means zero. The third is only ever
 * shown as a NUMBER once the freshness join has actually resolved: while it is in
 * flight, or after it fails, the count is unknown, and printing one would report an
 * unfetched value as a measured one.
 *
 * ── WHAT THIS BLOCK NO LONGER RESTATES ─────────────────────────────────────────
 * Each gap used to close with a sentence defining a GLOBAL rule — that a cost figure
 * is not a total project cost, that values on different reference periods are not
 * compared. Both are stated once in 공통 해석 기준 (`TransparencyDefinitions`). What
 * stays here is the part that is only true of this gap: the served count, and what
 * that particular count does and does not mean.
 */

import type { FacilityMappingTransparency } from "../../lib/api";
import type { SourceOverview } from "../../lib/dataSources";
import { MISSING_COMPONENT_META } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import UnmodeledFactorsDisclosure from "../suitability/UnmodeledFactorsDisclosure";
import type { FreshnessState } from "./shared";

export interface KnownDataGapsProps {
  overview: SourceOverview;
  freshnessState: FreshnessState;
  mapping: FacilityMappingTransparency | null;
  mappingFailed: boolean;
}

function GapHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-ink">{children}</h3>;
}

export default function KnownDataGaps({
  overview,
  freshnessState,
  mapping,
  mappingFailed,
}: KnownDataGapsProps) {
  const withoutPeriod = overview.total - overview.withReferencePeriod;

  return (
    // Four gaps: a 2×2 grid holds them evenly at desktop rather than leaving a
    // three-across row with one orphan under it.
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <div data-testid="transparency-cost">
        <GapHeading>비용 계산에 넣지 못한 항목</GapHeading>
        {/* What this list IS. The general rule it used to restate — an installation
            cost is not a total project cost — is stated once in 공통 해석 기준. */}
        <p className="mt-1 text-xs text-ink-subtle">
          아래 항목은 공식 자료를 확보하지 못해 설치비 계산에 넣지 못했습니다.
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-muted">
          {/* Rendered from the shared glossary so this list and the cost dashboard
              can never drift into two different wordings. */}
          {Object.values(MISSING_COMPONENT_META).map((component) => (
            <li key={component.code}>
              <span className="text-ink">{`${component.primary} (${component.short})`}</span>
              <span className="mt-0.5 block text-xs text-ink-subtle">{component.explanation}</span>
            </li>
          ))}
        </ul>
      </div>

      <div data-testid="transparency-gap-unmapped">
        <GapHeading>지도에 표시하지 못한 시설</GapHeading>
        {mappingFailed ? (
          <p className="mt-1 text-[13px] text-ink-muted">
            시설 지도 표시 현황을 불러오지 못해 개수를 표시할 수 없습니다.
          </p>
        ) : mapping ? (
          <>
            <p className="mt-1 text-[13px] text-ink-muted">
              전체 {formatCount(mapping.total)}개 시설 가운데{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatCount(mapping.without_map_location)}개
              </span>
              는 주소를 좌표로 바꾸지 못해 지도에 표시하지 못했습니다.
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              표시하지 못한 시설도 집계에는 그대로 포함됩니다. 아래 &lsquo;시설 지도 표시 현황&rsquo;
              에서 시설별 사유를 확인할 수 있습니다.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">시설 지도 표시 현황을 확인하는 중입니다.</p>
        )}
      </div>

      <div data-testid="transparency-gap-period">
        <GapHeading>기준 기간을 확인하지 못한 자료</GapHeading>
        {freshnessState === "ready" ? (
          <>
            <p className="mt-1 text-[13px] text-ink-muted">
              등록된 출처 {formatCount(overview.total)}건 가운데{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatCount(withoutPeriod)}건
              </span>
              은 기준 기간 정보가 제공되지 않았습니다.
            </p>
            {/* What the COUNT means. The rule about not comparing across reference
                periods is stated once in 공통 해석 기준. */}
            <p className="mt-1 text-xs text-ink-subtle">
              해당 기관이 자료를 내지 않았다는 뜻이 아니라, 이 서비스가 그 자료의 기준 기간을 함께
              받지 못했다는 뜻입니다.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">
            {freshnessState === "loading"
              ? "기준 기간 정보를 확인하는 중입니다."
              : "기준 기간 정보를 확인하지 못해 개수를 표시할 수 없습니다. 0건이라는 뜻이 아닙니다."}
          </p>
        )}
      </div>

      {/* The fourth gap: what the SCREENING cannot see. The factors and the closing
          note come from the shared glossary through the same component the
          suitability screens render, so this screen can never list a different set —
          and the reader who came here to find out what is missing is told about the
          analysis coverage gap, not only the dataset ones. */}
      <div data-testid="transparency-gap-unmodeled">
        <GapHeading>아직 분석에 넣지 못한 입지 요인</GapHeading>
        <p className="mt-1 text-xs text-ink-subtle">
          후보지 분석이 아직 평가하지 못하는 물리적·환경적·법적 조건입니다.
        </p>
        <div className="mt-2">
          <UnmodeledFactorsDisclosure testId="transparency-unmodeled-factors" />
        </div>
      </div>
    </div>
  );
}
