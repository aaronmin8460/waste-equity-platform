"use client";

/**
 * 후보지 심층 비교 — the A/B comparison FOUNDATION (Page 5A, Figma frame 167:10554).
 *
 * This is the structural upper half of Page 5: who A안 and B안 are, which analysis
 * run they were revalidated against, and how their four weights differ. The
 * analytical sections below it in the Figma frame — the slope chart, the rank-change
 * top 10, the comparison table, the sensitivity scatter, the A/B map — belong to
 * later lanes and are deliberately ABSENT here rather than stubbed: an empty card
 * captioned "순위 변동" reads as "no candidate moved", which would be a fabricated
 * finding. Nothing is drawn until it can be drawn from served data.
 *
 * ── WHAT THE FIGMA FRAME ASKS FOR, AND WHERE THIS DEPARTS FROM IT ────────────────
 * The frame's weight table names its four rows 시설부담 정도 / 토지피복 기반 적합도 /
 * 장래 쓰레기 발생량 / 주민 반응, with mock percentages. Three of those four factors
 * DO NOT EXIST in this product's model, and the fourth is inverted:
 *
 *   - "시설부담 정도" would invert E — a HIGH E score means the area carries LESS
 *     existing facility burden, so naming the factor after the burden reverses its
 *     direction (components/suitability/shared.ts `COMPONENT_DIRECTION`);
 *   - "장래 쓰레기 발생량" would promise a forecast: D is PRESENT-DAY served demand
 *     for the run's reference year, and no future-generation model exists;
 *   - "토지피복 기반 적합도" is not a scoring component — land cover is a separate
 *     map layer and a candidate-cell statistic, not a term in Z/R/E/D;
 *   - "주민 반응" has no data source anywhere in this platform.
 *
 * So the LAYOUT is the frame's and the CONTENT is the model's: the four rows are
 * `COMPONENT_ORDER` with the glossary's own citizen labels, and every percentage is
 * the SERVER's canonical weight for that side. The frame's 기준일 slot likewise
 * becomes the scenario's real 저장 date and the run's real reference year, because a
 * date the product does not have is not a date it may print.
 *
 * ── STORAGE IS A BOOKMARK, NOT EVIDENCE ──────────────────────────────────────────
 * Everything numeric on this screen comes from `POST /suitability/scenarios/preview`,
 * re-run against the run currently on screen. The stored scenario supplies the name
 * and the *request*; it never supplies a displayed number. See
 * docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §6 and `useScenarioComparison`.
 *
 * ── NO NEW ANALYTICS ─────────────────────────────────────────────────────────────
 * No pass/fail, no 60점 threshold, no "newly passed" region, no sensitivity band. A
 * scenario reweights the RANKING; it does not re-run screening, which is rule-based
 * and independent of the weights. This file introduces no finding of any kind.
 */

import { useMemo, type ReactNode } from "react";

import type { SuitabilityRun } from "../../lib/api";
import {
  activeRunResolution,
  comparisonWeightRows,
  formatWeightDelta,
  type ComparisonSide,
  type ScenarioComparison,
} from "../../lib/scenarioComparison";
import {
  SAVED_SCENARIO_OTHER_RUN_NOTICE,
  type ComparisonResolution,
} from "../../lib/savedScenarios";
import InfoBanner from "../ui/InfoBanner";
import PageHeader from "../ui/PageHeader";
import SectionCard from "../ui/SectionCard";
import { useScenarioComparison } from "./useScenarioComparison";

export interface SuitabilityScenarioComparisonProps {
  /** ⑤'s resolved pair — step 1 of the contract flow, performed once by the page. */
  selection: ComparisonResolution;
  /** The run on screen. `null` while the suitability meta is still loading. */
  run: SuitabilityRun | null;
  /** Why the run could not be loaded, when it could not be. */
  runError: string | null;
  /** The view's `<h1>` — the destination label, as every other area titles itself. */
  title: string;
  /** The shared orientation strip, kept a sibling so it follows the `<h1>`. */
  orientation?: ReactNode;
  /** Back to 후보지 심층 분석, where scenarios are saved and the pair is chosen. */
  onBackToSelection: () => void;
}

const SLOT_LABEL = { A: "A안", B: "B안" } as const;

/** `2026-01-01` in the reader's locale; empty for an unparseable stored value. */
function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function SuitabilityScenarioComparison({
  selection,
  run,
  runError,
  title,
  orientation,
  onBackToSelection,
}: SuitabilityScenarioComparisonProps) {
  // Memoised on the two primitives so the hook's dependency is stable across
  // renders in which the run did not actually change.
  const runResolution = useMemo(
    () => activeRunResolution(run?.id ?? null, runError),
    [run?.id, runError],
  );

  // THE single data load for Page 5. Later sections receive `comparison`; none of
  // them resolves the pair or calls the preview API again.
  const comparison = useScenarioComparison(selection, runResolution);
  const { sideA, sideB, status } = comparison;

  const rows = comparisonWeightRows(sideA.canonicalWeights, sideB.canonicalWeights);
  // One served side is enough to show the table: the other column renders as
  // explicitly unavailable, which is more informative than hiding both.
  const anyWeights = sideA.canonicalWeights !== null || sideB.canonicalWeights !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 md:px-6">
      <PageHeader
        title={title}
        description="저장한 두 시나리오의 가중치를 현재 분석 실행에 다시 적용해 나란히 비교합니다."
        meta={<RunMeta run={run} runError={runError} />}
      />
      {orientation}

      <StatusNotice
        status={status}
        sideA={sideA}
        sideB={sideB}
        runError={runError}
        onBackToSelection={onBackToSelection}
      />

      {/* ── A / B identity ──────────────────────────────────────────────────── */}
      <SectionCard
        title="비교 대상"
        testId="scenario-comparison-identity"
        className="wep-figma-card"
        description="A안과 B안은 이 브라우저에 저장된 시나리오이며, 공식 계산 기준이 아닙니다."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <SideIdentity side={sideA} />
          <SideIdentity side={sideB} />
        </div>
      </SectionCard>

      {/* ── Z/R/E/D weight comparison ───────────────────────────────────────── */}
      {anyWeights ? (
        <SectionCard
          title="가중치 비교"
          testId="scenario-comparison-weights"
          className="wep-figma-card"
          description="현재 분석 실행이 정규화해 돌려준 가중치입니다. 저장 당시의 값을 그대로 보여주지 않습니다."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline text-[11px] font-semibold text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    평가 요소
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    A안 가중치
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    B안 가중치
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    가중치 차이
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const delta = formatWeightDelta(row.deltaPercentPoints);
                  return (
                    <tr
                      key={row.component}
                      className="border-b border-hairline last:border-b-0"
                      data-testid={`scenario-comparison-weight-row-${row.component}`}
                    >
                      <th
                        scope="row"
                        className="py-2.5 pr-3 text-[13px] font-normal text-ink"
                      >
                        {/* A code is never shown bare — always beside its Korean name. */}
                        {row.label}
                        <span className="text-ink-subtle">（{row.code}）</span>
                      </th>
                      <td className="py-2.5 pr-3">
                        <WeightCell percent={row.aPercent} testId="scenario-comparison-weight-a" />
                      </td>
                      <td className="py-2.5 pr-3">
                        <WeightCell percent={row.bPercent} testId="scenario-comparison-weight-b" />
                      </td>
                      <td
                        className="py-2.5 text-[13px] font-semibold tabular-nums text-ink"
                        data-testid="scenario-comparison-weight-delta"
                      >
                        {/* An em dash, not 0: an uncomputable delta is not "no change". */}
                        {delta ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
            · 백분율은 소수점 이하를 반올림해 표시하며, 가중치 차이는 표시된 두 값의 차이(%p)입니다.
          </p>

          {/* The exact served decimals stay reachable, as everywhere else a rounded
              figure is shown. The rounding above is presentation; this is the value. */}
          <details className="mt-2" data-testid="scenario-comparison-weight-precise">
            <summary className="cursor-pointer text-[11px] text-ink-muted">정밀값 보기</summary>
            <dl className="mt-2 grid gap-1 text-[11px] text-ink-muted">
              {rows.map((row) => (
                <div key={row.component} className="flex flex-wrap gap-x-3">
                  <dt className="font-medium">
                    {row.label}（{row.code}）
                  </dt>
                  <dd className="tabular-nums">
                    {SLOT_LABEL.A} {row.aWeight ?? "자료 없음"} · {SLOT_LABEL.B}{" "}
                    {row.bWeight ?? "자료 없음"}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </SectionCard>
      ) : null}

      {/* The standing limit on what a scenario changes. Stated on the page that
          shows the reweighting, not only on the page that produced it. */}
      <p className="text-[11px] leading-snug text-ink-subtle" data-testid="scenario-comparison-method-note">
        시나리오는 이미 계산된 Z·R·E·D 점수를 다시 가중해 순위를 바꿉니다. 배제·검토 판정(스크리닝)은
        규칙 기반이며 가중치를 바꿔도 달라지지 않습니다.
      </p>
    </div>
  );
}

/** The run the comparison is validated against — never an assumed or stored one. */
function RunMeta({ run, runError }: { run: SuitabilityRun | null; runError: string | null }) {
  if (run === null) {
    return (
      <span data-testid="scenario-comparison-run-meta">
        {runError !== null ? "분석 실행 정보 없음" : "분석 실행 정보를 불러오는 중…"}
      </span>
    );
  }
  return (
    <span className="tabular-nums" data-testid="scenario-comparison-run-meta">
      분석 실행 #{run.id} · 기준연도 {run.reference_year}
    </span>
  );
}

function WeightCell({ percent, testId }: { percent: number | null; testId: string }) {
  if (percent === null) {
    return (
      <span className="text-[13px] text-ink-subtle" data-testid={testId}>
        자료 없음
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" data-testid={testId}>
      <span className="h-2.5 w-full max-w-[220px] flex-1 rounded-pill bg-surface-muted" aria-hidden="true">
        <span
          className="block h-2.5 rounded-pill bg-primary"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="flex-none text-[13px] font-semibold tabular-nums text-ink">{percent}%</span>
    </span>
  );
}

/**
 * One side's identity: slot, name, save date, provenance, and — when it is not
 * usable — the specific reason, in that side's own card. A reader must be able to
 * tell WHICH side is the problem without reading a page-level banner.
 */
function SideIdentity({ side }: { side: ComparisonSide }) {
  const { slot, state, savedScenario } = side;
  return (
    <div
      className="rounded-card border border-hairline bg-surface p-3"
      data-testid={`scenario-comparison-side-${slot.toLowerCase()}`}
      data-state={state}
    >
      <div className="flex items-center gap-2">
        <span className="flex-none rounded-full border border-primary-border bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-ink">
          {SLOT_LABEL[slot]}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink"
          data-testid="scenario-comparison-side-name"
        >
          {/* The placeholder is state-specific. A `MISSING` slot must NOT read
              "선택 없음" — an id WAS chosen, and calling it an empty selection is the
              exact conflation §3 of the contract forbids. */}
          {savedScenario?.name ?? (state === "MISSING" ? "찾을 수 없는 시나리오" : "선택 없음")}
        </span>
      </div>

      {savedScenario ? (
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="scenario-comparison-side-saved-at">
          저장 {formatSavedAt(savedScenario.createdAt)} · 저장 시 분석 실행 #{savedScenario.runId}
        </p>
      ) : null}

      {state === "READY" ? (
        <p className="mt-1 text-[11px] text-ink-muted" data-testid="scenario-comparison-side-ready">
          현재 분석 실행 #{side.runId} 기준으로 다시 계산했습니다.
        </p>
      ) : null}

      {state === "LOADING" ? (
        <p className="mt-1 text-[11px] text-ink-muted" role="status" data-testid="scenario-comparison-side-loading">
          현재 분석 실행 기준으로 다시 계산하는 중…
        </p>
      ) : null}

      {state === "EMPTY" ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-comparison-side-empty">
          {SLOT_LABEL[slot]}이 선택되지 않았습니다. 후보지 심층 분석에서 시나리오를 선택해 주세요.
        </p>
      ) : null}

      {/* An id that resolves to nothing is a REAL state — a link opened in a browser
          that never held the scenario. Page 4D's exact wording, so the two screens
          describe the same situation identically. */}
      {state === "MISSING" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-missing">
          이 링크가 가리키는 시나리오를 이 브라우저에서 찾을 수 없습니다. 시나리오는 저장한 브라우저에만
          남아 있습니다.
        </p>
      ) : null}

      {state === "OTHER_RUN" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-other-run">
          {SAVED_SCENARIO_OTHER_RUN_NOTICE}
        </p>
      ) : null}

      {state === "PREVIEW_ERROR" ? (
        <p className="mt-1 text-[11px] leading-snug text-danger" data-testid="scenario-comparison-side-error">
          {side.errorMessage}
        </p>
      ) : null}

      {/* The run itself failed to load, so this side was never checked against one.
          Saying "다른 분석 실행" here would blame the reader's scenario for a fault
          that is not theirs and is not even known to exist. */}
      {state === "RUN_UNKNOWN" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-run-unknown">
          현재 분석 실행을 확인할 수 없어 이 시나리오를 검증하지 못했습니다.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The page-level statement of what is wrong, when something is — plus the way back.
 *
 * It never replaces the per-side detail above; it names the situation once, in one
 * sentence, so a reader is not left to infer it from two cards. `READY` renders
 * nothing at all: a screen with nothing wrong says nothing.
 */
function StatusNotice({
  status,
  sideA,
  sideB,
  runError,
  onBackToSelection,
}: {
  status: ScenarioComparison["status"];
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  runError: string | null;
  onBackToSelection: () => void;
}) {
  if (status === "READY") return null;

  if (status === "LOADING") {
    return (
      <p className="text-sm text-ink-muted" role="status" data-testid="scenario-comparison-loading">
        저장한 시나리오를 현재 분석 실행 기준으로 다시 계산하는 중입니다…
      </p>
    );
  }

  const message = ((): { tone: "warning" | "error"; title: string; body: string } => {
    switch (status) {
      case "NO_RUN":
        return {
          tone: "error",
          title: "분석 실행을 확인할 수 없습니다",
          body:
            runError ??
            "현재 분석 실행을 불러오지 못해 두 시나리오를 검증할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        };
      case "DUPLICATE_SELECTION":
        return {
          tone: "warning",
          title: "같은 시나리오가 두 번 선택되었습니다",
          body: "서로 다른 시나리오 2개를 선택해야 비교할 수 있습니다.",
        };
      case "INCOMPLETE_SELECTION":
        return {
          tone: "warning",
          title: "비교할 시나리오가 2개가 아닙니다",
          body: "후보지 심층 분석에서 A안과 B안을 각각 선택하면 비교를 볼 수 있습니다.",
        };
      case "MISSING_A":
      case "MISSING_B":
      case "MISSING_BOTH":
        return {
          tone: "warning",
          title: "이 브라우저에 없는 시나리오입니다",
          body:
            "시나리오는 저장한 브라우저에만 남아 있어, 다른 기기나 브라우저에서 연 링크로는 불러올 수 " +
            "없습니다. 이 브라우저에서 다시 저장한 뒤 비교해 주세요.",
        };
      case "OTHER_RUN_A":
      case "OTHER_RUN_B":
      case "OTHER_RUN_BOTH":
        return {
          tone: "warning",
          title: "다른 분석 실행에서 저장된 시나리오입니다",
          body:
            "다른 분석 실행에서 저장된 시나리오입니다. 현재 분석 실행에서 다시 저장하거나 선택해 " +
            "주세요.",
        };
      case "PREVIEW_ERROR_A":
      case "PREVIEW_ERROR_B":
      case "PREVIEW_ERROR_BOTH":
        return {
          tone: "error",
          // The per-side cards carry the backend's own message, which names the
          // offending value; this only says which step failed.
          title: "가중치를 다시 적용하지 못했습니다",
          body: "현재 분석 실행에 시나리오를 다시 적용하는 중 오류가 발생했습니다.",
        };
      default:
        // MIXED — two different problems. Each side already states its own, so this
        // says only that there are two, rather than picking one and hiding the other.
        return {
          tone: "warning",
          title: "두 시나리오에 각각 다른 문제가 있습니다",
          body: "A안과 B안의 상태를 아래에서 각각 확인해 주세요.",
        };
    }
  })();

  const blocked = [sideA, sideB].filter((side) => side.state !== "READY").map((side) => side.slot);

  return (
    <InfoBanner
      tone={message.tone}
      title={message.title}
      role={message.tone === "error" ? "alert" : undefined}
      testId="scenario-comparison-status"
    >
      <p data-testid="scenario-comparison-status-body">{message.body}</p>
      {blocked.length > 0 ? (
        <p className="mt-1 text-[11px]" data-testid="scenario-comparison-status-sides">
          확인이 필요한 쪽: {blocked.map((slot) => SLOT_LABEL[slot]).join(" · ")}
        </p>
      ) : null}
      {/* RECOVERY: a link back to where scenarios are saved and chosen. Page 5 never
          creates a replacement scenario and never edits stored ones on the reader's
          behalf — the selection is theirs to make. */}
      <button
        type="button"
        onClick={onBackToSelection}
        className="wep-btn-primary mt-2 text-xs"
        data-testid="scenario-comparison-back"
      >
        후보지 심층 분석에서 시나리오 선택하기 <span aria-hidden="true">→</span>
      </button>
    </InfoBanner>
  );
}
