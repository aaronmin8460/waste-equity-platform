"use client";

/**
 * ① 분석 범위 — the first card of the Page-4 Figma hierarchy (136:8684), and now a
 * real control over what the ranking, the counts and the A/B/C bands describe.
 *
 * ── The one rule this card exists to enforce ─────────────────────────────────────
 * A 시·도 scope and a 시·군·구 scope are NEVER sent together. `suitability_candidates`
 * carries `sido_region_code` and `sigungu_region_code` from two INDEPENDENT
 * `ST_Covers` lookups against non-coincident boundary layers, so combining them
 * intersects two slightly different populations and silently drops the boundary
 * cells (run 47: 553 cells have no SIGUNGU at all, 137 carry a disagreeing pair, and
 * "서울" has three different totals depending on how it is expressed). The state this
 * card edits is a discriminated union (`lib/suitabilityScope.ts`), so picking a
 * 시·도 CLEARS the 시·군·구 selection and picking a 시·군·구 CLEARS the 시·도 — not as
 * a UI courtesy, but because the combined request is not representable.
 *
 * ── One city can be several codes ────────────────────────────────────────────────
 * The big Gyeonggi cities are stored at 일반구 granularity, so choosing 안산시 sends
 * `sigungu=KR-SGIS-31091&sigungu=KR-SGIS-31092`. The chip names the city a citizen
 * knows and states the 구 it expanded into, so the reader can see the whole city was
 * taken and nothing was silently narrowed. The relationship is read from the served
 * region registry, never hardcoded.
 *
 * ── What it does NOT claim ───────────────────────────────────────────────────────
 * Narrowing the scope filters WHICH 500 m candidate cells are ranked. It does not
 * roll cells up into a 시·군·구 entity: there is no best-cell-per-시군구, no mean
 * score, no eligible-count-as-score, and no area-weighted municipality ranking. The
 * ranked object is unchanged.
 */

import { useId, useMemo, useState } from "react";
import type { SuitabilityStatus, SuitabilitySummary } from "../../lib/api";
import { statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import {
  SUITABILITY_SCOPE_ALL_LABEL,
  SUITABILITY_SIDO_OPTIONS,
  filterScopeOptions,
  isCompositeOption,
  isOptionSelected,
  selectedOptions,
  withOptionCleared,
  withOptionSelected,
  type ScopeRegionOption,
  type SuitabilityScope,
} from "../../lib/suitabilityScope";
import SectionCard from "../ui/SectionCard";
import { STATUS_ORDER } from "./shared";

/** The backend's fallback key for a candidate with no 시·도 name attached. */
const UNKNOWN_SIDO_KEY = "UNKNOWN";
const UNKNOWN_SIDO_LABEL = "(시·도 미배정)";

/** How many matches the search list shows before asking for a narrower term. */
const MAX_VISIBLE_MATCHES = 8;

export interface SuitabilityScopeCardProps {
  summary: SuitabilitySummary;
  scope: SuitabilityScope;
  onScopeChange: (scope: SuitabilityScope) => void;
  /** The selectable cities, built from the served region registry by the page. */
  regionOptions: readonly ScopeRegionOption[];
}

export default function SuitabilityScopeCard({
  summary,
  scope,
  onScopeChange,
  regionOptions,
}: SuitabilityScopeCardProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();

  // The served 시·도 breakdown, in the summary's own key order. Only the
  // (시·도, 상태) pairs the run actually counted appear: a pair the query returned no
  // row for is omitted, never rendered as a 0 this component invented.
  const rows = Object.entries(summary.sido_distribution ?? {}).map(([sido, counts]) => ({
    sido,
    label: sido === UNKNOWN_SIDO_KEY ? UNKNOWN_SIDO_LABEL : sido,
    served: STATUS_ORDER.filter((status) => counts[status] != null).map((status) => ({
      status: status as SuitabilityStatus,
      count: counts[status] as number,
    })),
  }));

  const matches = useMemo(
    () => filterScopeOptions(regionOptions, query),
    [regionOptions, query],
  );
  const { selected, unknownCodes } = useMemo(
    () => selectedOptions(scope, regionOptions),
    [scope, regionOptions],
  );
  const hasSelection = scope.kind !== "all";

  return (
    <SectionCard
      title="① 분석 범위"
      description="공식 폐기물 자료가 있는 지역만 선택할 수 있습니다."
      testId="suitability-scope"
      className="wep-figma-card wep-numbered-card"
    >
      {/* FIGMA ORDER: search field, then the 시·도 pills, then the chips, then the
          count line. The frame leads with the field because typing a city name is
          the direct route and the pills are the three shortcuts beside it; the
          shipped card had them the other way round.

          Still COMPACT BY CONTRACT: the controls column has to show the active
          scoring basis without scrolling at the 1024×768 minimum
          (e2e/suitabilityDashboard.spec.ts), so the per-시·도 counts stay in the
          disclosure at the foot. */}
      <div>
        <label className="sr-only" htmlFor={searchId}>
          시·군·구 검색
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="지역 이름 검색 (예: 안산, 부평)"
          className="h-9 w-full rounded-control border border-hairline-strong bg-surface px-3 text-xs text-ink placeholder:text-ink-subtle"
          data-testid="suitability-scope-search"
        />
      </div>

      <div
        className="mt-2 flex flex-wrap gap-1"
        role="group"
        aria-label="시·도 분석 범위"
        data-testid="suitability-scope-pills"
      >
        <ScopePill
          label={SUITABILITY_SCOPE_ALL_LABEL}
          active={scope.kind === "all"}
          onClick={() => onScopeChange({ kind: "all" })}
          testId="suitability-scope-pill-all"
        />
        {SUITABILITY_SIDO_OPTIONS.map((option) => (
          <ScopePill
            key={option.code}
            label={option.label}
            active={scope.kind === "sido" && scope.sido === option.code}
            // Selecting a 시·도 replaces the WHOLE scope, so any 시·군·구 selection
            // is dropped rather than intersected with it.
            onClick={() => onScopeChange({ kind: "sido", sido: option.code })}
            testId={`suitability-scope-pill-${option.scope}`}
          />
        ))}
      </div>

      {query.trim() !== "" && (
        <ul className="mt-2 flex flex-col gap-0.5" data-testid="suitability-scope-matches">
          {matches.length === 0 ? (
            <li className="px-1 py-1 text-[11px] text-ink-subtle" data-testid="suitability-scope-no-match">
              검색과 일치하는 시·군·구가 없습니다.
            </li>
          ) : (
            matches.slice(0, MAX_VISIBLE_MATCHES).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  aria-pressed={isOptionSelected(scope, option)}
                  // Selecting a city replaces any 시·도 scope and adds EVERY code the
                  // city expands into — a partially selected city is never sent.
                  onClick={() =>
                    onScopeChange(
                      isOptionSelected(scope, option)
                        ? withOptionCleared(scope, option)
                        : withOptionSelected(scope, option),
                    )
                  }
                  className={`flex w-full items-center justify-between gap-2 rounded-card border px-2 py-1 text-left text-xs ${
                    isOptionSelected(scope, option)
                      ? "border-primary-border bg-primary-soft font-semibold text-ink"
                      : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
                  }`}
                  data-testid="suitability-scope-match"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isCompositeOption(option) && (
                    // Stated up front: this one name is several stored regions, so a
                    // reader knows the request covers the whole city.
                    <span className="flex-none text-[10px] text-ink-subtle">
                      {option.codes.length}개 구
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
          {matches.length > MAX_VISIBLE_MATCHES && (
            <li className="px-1 text-[10px] text-ink-subtle" data-testid="suitability-scope-more">
              {matches.length}곳 중 {MAX_VISIBLE_MATCHES}곳을 표시했습니다. 검색어를 좁혀 주세요.
            </li>
          )}
        </ul>
      )}

      {hasSelection && (
        <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="suitability-scope-chips">
          {scope.kind === "sido" && (
            <span
              className="rounded-full border border-primary-border bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-ink"
              data-testid="suitability-scope-chip"
            >
              {SUITABILITY_SIDO_OPTIONS.find((option) => option.code === scope.sido)?.label ??
                scope.sido}
            </span>
          )}
          {selected.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onScopeChange(withOptionCleared(scope, option))}
              className="flex items-center gap-1 rounded-full border border-primary-border bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-muted"
              data-testid="suitability-scope-chip"
            >
              <span>{option.label}</span>
              {isCompositeOption(option) && (
                <span className="text-[10px] font-normal text-ink-subtle">
                  ({option.districtNames.join("·")})
                </span>
              )}
              <span aria-hidden="true">×</span>
              <span className="sr-only">{option.label} 선택 해제</span>
            </button>
          ))}
          {/* A shared link can carry a code this registry does not know. It is shown
              as-is rather than dropped: the request really does carry it, and the
              ranking's honest empty state is the answer. */}
          {unknownCodes.map((code) => (
            <span
              key={code}
              className="rounded-full border border-hairline bg-surface-muted px-2 py-0.5 text-[11px] text-ink-subtle"
              data-testid="suitability-scope-chip-unknown"
            >
              {code} (알 수 없는 지역)
            </span>
          ))}
          <button
            type="button"
            onClick={() => onScopeChange({ kind: "all" })}
            className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink-muted hover:bg-surface-muted"
            data-testid="suitability-scope-reset"
          >
            선택 초기화
          </button>
        </div>
      )}

      {/* "선택한 지역 N개" — the count line Figma closes ① with. It states what the
          chips above add up to, and names the whole-region case rather than
          printing "0개", which would read as an empty selection when it is in fact
          the widest one. */}
      <p className="mt-2 text-[11px] text-ink-subtle" data-testid="suitability-scope-count">
        {scope.kind === "all"
          ? `분석 범위 ${SUITABILITY_SCOPE_ALL_LABEL}`
          : scope.kind === "sido"
            ? "선택한 지역 1개 (시·도)"
            : `선택한 지역 ${selected.length + unknownCodes.length}개`}
      </p>

      {/* The standing limit, in ONE line. Everything else the card used to state up
          front — the 시·도 breakdown and why the two region filters are never
          combined — moved into the disclosure below when ① became a real control:
          the pills, the search and the chips have to fit above the 1024×768 fold
          alongside ② 계산 모델 가중치 설정 (e2e/suitabilityDashboard.spec.ts), and a
          card of prose ahead of them would push the scoring basis off screen. */}
      <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="suitability-scope-note">
        범위는 순위에 넣을 500m 후보 구역을 고를 뿐이며, 시·군·구 자체를 점수로 매기거나 하나로
        합치지 않습니다.
      </p>

      <details className="mt-0.5" data-testid="suitability-scope-detail">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
          분석 실행 범위와 시·도별 후보 구역 수 보기
        </summary>

        {rows.length === 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted" data-testid="suitability-scope-empty">
            이 분석 실행은 시·도별 후보 구역 분포를 제공하지 않았습니다. 분포를 알 수 없으므로 지역별
            내역을 표시하지 않습니다.
          </p>
        ) : (
          <p className="mt-1 text-[11px] leading-snug text-ink" data-testid="suitability-scope-summary">
            <span className="font-medium">{rows.map((row) => row.label).join(" · ")}</span>
            <span className="text-ink-muted">
              {" "}
              · 후보 구역 {formatCount(summary.candidate_count_total)}개
            </span>
          </p>
        )}

        {/* Why a 시·도 and a 시·군·구 selection replace each other instead of
            combining: the two codes come from independent boundary layers, so
            applying both intersects two different populations. */}
        <p className="mt-1 text-[10px] leading-snug text-ink-subtle" data-testid="suitability-scope-exclusivity-note">
          시·도와 시·군·구는 서로 다른 경계 자료로 매겨져 있어 함께 적용하지 않습니다. 시·도를 고르면
          시·군·구 선택이, 시·군·구를 고르면 시·도 선택이 해제됩니다.
        </p>

        {rows.length > 0 && (
          <dl className="mt-1 flex flex-col gap-1" data-testid="suitability-scope-rows">
            {rows.map((row) => (
              // Stacked, not a single row: the three Korean status names plus their
              // counts do not fit beside a 시·도 name at this column width, and a
              // truncated count is a number a reader cannot check.
              <div
                key={row.sido}
                className="rounded-card border border-hairline bg-surface-muted px-2 py-1.5"
                data-testid="suitability-scope-row"
              >
                <dt className="truncate text-xs font-medium text-ink">{row.label}</dt>
                <dd className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-ink-muted">
                  {row.served.map((entry) => (
                    <span key={entry.status} className="whitespace-nowrap">
                      {statusLabel(entry.status)} {formatCount(entry.count)}개
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {rows.length > 0 && (
          <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
            이 내역은 분석 실행 전체 기준이며, 위에서 고른 범위를 반영하지 않습니다.
          </p>
        )}
      </details>
    </SectionCard>
  );
}

function ScopePill({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      // Figma 136:8684 sizes the ① shortcuts as 35px rounded-rect buttons, not as
      // the hairline micro-pills the card shipped with.
      className={`h-9 rounded-control border px-3 text-xs whitespace-nowrap ${
        active
          ? "border-primary-border bg-primary-soft font-semibold text-ink"
          : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
      }`}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
