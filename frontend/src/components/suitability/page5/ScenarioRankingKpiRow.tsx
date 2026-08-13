"use client";

/**
 * The Page-5B KPI row (Figma 167:10554 `ResultKPIRow`).
 *
 * ── EVERY TITLE CARRIES ITS OWN SCOPE ────────────────────────────────────────────
 * Each figure below is computed over a BOUNDED population — the two previews' top-N
 * cuts — not over the ranked population. So the scope is in the title or the caption
 * of every card, never left to be inferred: "상위 50 공통 후보 중 순위 상승" is a
 * true sentence, "전체 후보 순위 상승" would not be.
 *
 * ── THREE OF THE FRAME'S FIVE KPIs DO NOT EXIST ──────────────────────────────────
 * The Figma row reads 통과 지역 수 304개 → 328개 / 신규 통과 지역 32개 / 순위 변동
 * 지역 42개 (전체의 18.5%). The first two are screening findings: a scenario
 * reweights the RANKING, and screening is a rule-based verdict that does not move
 * with the weights, so "B안에서 새롭게 통과" describes something that cannot happen.
 * The third is real but its "전체의" denominator is not — the comparison sees a
 * top-N cut, not the whole population. They are replaced here by 순위 상승 / 순위
 * 하락 / 공통 후보 수, each stated over the population it actually has.
 */

import KpiCard from "../../ui/KpiCard";
import type { ScenarioRankingComparison } from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankingKpiRowProps {
  model: ScenarioRankingComparison;
}

/** "경기도 시흥시 · c-31390-0042" — the cell, and where it is. Never just the city. */
function cellIdentity(row: { locationLabel: string | null; candidateKey: string }): string {
  return row.locationLabel !== null ? `${row.locationLabel} · ${row.candidateKey}` : row.candidateKey;
}

export default function ScenarioRankingKpiRow({ model }: ScenarioRankingKpiRowProps) {
  const { topCandidate, topNRetention, comparableRows, roseCount, fellCount } = model;

  // The denominator every movement KPI is measured against, named once so the four
  // cards cannot drift into quoting different populations.
  const commonCount = comparableRows.length;
  const commonScope = `A안·B안 양쪽 상위 목록에 모두 있는 ${commonCount.toLocaleString("ko-KR")}개 후보 구역 기준`;

  const retentionLabel = topNRetention.reduced
    ? `상위 ${topNRetention.denominator} 유지 후보 구역`
    : `TOP ${topNRetention.n} 유지 후보 구역`;

  return (
    <dl
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      data-testid="scenario-ranking-kpis"
    >
      {/* ── 1위 후보 구역 ─────────────────────────────────────────────────────── */}
      <KpiCard
        label="1위 후보 구역"
        testId="scenario-ranking-kpi-top1"
        valueTestId="scenario-ranking-kpi-top1-value"
        {...(topCandidate.state === "UNAVAILABLE"
          ? { unavailableReason: "1위 후보를 양쪽에서 확인할 수 없습니다" }
          : { value: topCandidate.state === "UNCHANGED" ? "변화 없음" : "순위 변경" })}
        caption={
          topCandidate.a !== null && topCandidate.b !== null ? (
            <span data-testid="scenario-ranking-kpi-top1-caption">
              A안 {cellIdentity(topCandidate.a)}
              <br />
              {/* An arrow between two DIFFERENT cells; "변화 없음" above already says
                  when they are the same one, so the arrow never implies a move. */}
              <span aria-hidden="true">→ </span>B안 {cellIdentity(topCandidate.b)}
            </span>
          ) : (
            "양쪽 상위 목록에 1위 후보가 모두 있어야 비교할 수 있습니다."
          )
        }
      />

      {/* ── TOP-N 유지 ────────────────────────────────────────────────────────── */}
      <KpiCard
        label={retentionLabel}
        testId="scenario-ranking-kpi-retention"
        valueTestId="scenario-ranking-kpi-retention-value"
        {...(topNRetention.denominator === 0
          ? { unavailableReason: "비교할 상위 후보가 없습니다" }
          : { value: `${topNRetention.retained} / ${topNRetention.denominator}개` })}
        caption={
          topNRetention.percent === null ? null : (
            <span data-testid="scenario-ranking-kpi-retention-caption">
              {topNRetention.percent}% 유지 ·{" "}
              {topNRetention.reduced
                ? // The shortfall is stated, not silently absorbed into the ratio.
                  `양쪽에서 확인된 상위 후보가 ${topNRetention.denominator}개뿐이라 ${topNRetention.denominator}개 기준으로 계산했습니다`
                : // What the ratio counts, said plainly. "집합 일치" would read as
                  // "the two sets match", which is what a 10/10 means, not a 5/10.
                  `A안 상위 ${topNRetention.n}개와 B안 상위 ${topNRetention.n}개에 함께 든 후보 구역 수`}
            </span>
          )
        }
      />

      {/* ── 순위 상승 / 하락 (공통 후보 한정) ─────────────────────────────────── */}
      <KpiCard
        label="순위 상승 후보 구역"
        testId="scenario-ranking-kpi-rose"
        valueTestId="scenario-ranking-kpi-rose-value"
        {...(commonCount === 0
          ? { unavailableReason: "양쪽에 모두 있는 후보가 없습니다" }
          : { value: `${roseCount.toLocaleString("ko-KR")}개` })}
        caption={commonCount === 0 ? null : `B안에서 순위가 앞당겨진 후보 · ${commonScope}`}
      />

      <KpiCard
        label="순위 하락 후보 구역"
        testId="scenario-ranking-kpi-fell"
        valueTestId="scenario-ranking-kpi-fell-value"
        {...(commonCount === 0
          ? { unavailableReason: "양쪽에 모두 있는 후보가 없습니다" }
          : { value: `${fellCount.toLocaleString("ko-KR")}개` })}
        caption={commonCount === 0 ? null : `B안에서 순위가 밀린 후보 · ${commonScope}`}
      />

      {/* ── 공통 후보 수 ──────────────────────────────────────────────────────── */}
      <KpiCard
        label="양쪽에서 순위를 확인한 후보 구역"
        testId="scenario-ranking-kpi-common"
        valueTestId="scenario-ranking-kpi-common-value"
        value={`${commonCount.toLocaleString("ko-KR")}개`}
        caption={
          model.rankingPopulation === null
            ? "A안과 B안 상위 목록 양쪽에 모두 나타난 후보 구역입니다."
            : // The served ranked population, so the reader can see how small the
              // compared slice is rather than reading the counts above as totals.
              `현재 분석 실행의 순위 대상 후보 구역 ${model.rankingPopulation.toLocaleString("ko-KR")}개 중 비교된 구역입니다.`
        }
      />
    </dl>
  );
}
