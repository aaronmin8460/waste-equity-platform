"use client";

/**
 * 데이터와 출처 — the citizen data-transparency centre (redesign plan §9 Phase 6).
 *
 * A full-width, map-free page that answers, in this order: which official datasets
 * the platform holds, what each one is about, who publishes it, which reference
 * period it covers, whether a displayed figure is reported directly or calculated
 * from official inputs, what is currently NOT available, and where the raw technical
 * provenance can be inspected.
 *
 * ── WHAT PHASE 6 CHANGED ────────────────────────────────────────────────────────
 * Presentation and interaction only. No endpoint, response field, count, reference
 * period, snapshot, availability rule, or analytical value changed.
 *
 *   1. The two dense 4-column tables became a searchable, filterable SOURCE CATALOG
 *      of cards plus one compact reference-period table. The Phase 0 audit found
 *      this area's density (D1) and its lack of status hierarchy (D3) to be the
 *      problems; a nine-record registry is small enough to read as cards and large
 *      enough that search earns its place.
 *   2. The registry's English/bilingual `source_name` / `dataset_name` are rendered
 *      through `lib/dataSources.ts`, which holds a Korean rendering per exact
 *      `source_id` and ALWAYS keeps the served strings reachable in the technical
 *      disclosure. An unknown `source_id` falls back to the served text verbatim —
 *      it never acquires an invented Korean name (§5 rule 1).
 *   3. `freshness_status` is no longer rendered as `최신`. Nothing in this repository
 *      ever demotes it from `FRESH`, so it records "the last ingestion succeeded",
 *      not "this data is current". The primary surface now shows the served
 *      기준 기간; the raw status stays in a diagnostic line (see lib/dataSources.ts).
 *   4. The version identifiers (`suitability-policy-v2`, `capital-grid-500m-v1`,
 *      `suitability-screening-v3`, `capex-standard-v2022dec`) moved out of the
 *      primary surface into the 기술 정보 disclosure, where they carry
 *      `data-diagnostic` — Phase 6 AC4, and they are on `FORBIDDEN_PRIMARY_TOKENS`.
 *   5. The cost-exclusion list is now rendered FROM `MISSING_COMPONENT_META` instead
 *      of four hardcoded `<li>`s. Those had already drifted from the glossary
 *      (`매립지 잔여 비용` here vs `잔여 매립비용` there) with no test to catch it.
 *
 * ── DATA-INTEGRITY CONTRACTS (repo AGENTS.md; redesign plan §5) ──────────────────
 *   - Nothing is fabricated: no source, owner, period, snapshot date, coverage area,
 *     completeness figure, or URL. Links are only ever a served `documentation_url`
 *     that parses as an absolute http(s) URL; anything else renders as 링크 없음.
 *   - An unavailable value never becomes zero. A served count of `0` (e.g.
 *     `without_address: 0`) is an official measurement and renders as `0`; an absent
 *     reference period renders `기준 기간 정보 없음`. The two are never merged.
 *   - Five outcomes are kept distinct and only ONE of them is an alert:
 *       loading · catalog · registry served no sources · search matched nothing ·
 *       a genuine request failure (`role="alert"`).
 *   - A facility with no map location shows `지도 위치 없음`, never zero, and its
 *     missing-location reason only when one was recorded (else 실패 사유 기록 없음).
 *   - No live region is placed inside a collapsed disclosure (§5 rule 9).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  ApiError,
  fetchDataFreshness,
  fetchFacilityCostOptions,
  fetchFacilityMappingTransparency,
  fetchSuitabilityLatestRun,
  fetchSuitabilityPolicy,
  type DataFreshnessItem,
  type FacilityCostOptions,
  type FacilityMappingTransparency,
  type SuitabilityPolicy,
  type SuitabilityRun,
} from "../lib/api";
import {
  availableAreas,
  availableFrequencies,
  buildDisplaySources,
  collectionDate,
  filterDisplaySources,
  organizationLabel,
  summarizeSources,
  COLLECTION_DATE_SUFFIX,
  NO_COLLECTION_DATE_LABEL,
  NO_REFERENCE_PERIOD_LABEL,
  SOURCE_AREA_LABELS,
  type DisplaySource,
  type SourceArea,
} from "../lib/dataSources";
import { MISSING_COMPONENT_META, plainError } from "../lib/glossary";
import { FACILITY_CATEGORY_LABELS, formatCount } from "../lib/metrics";
import Accordion from "./ui/Accordion";
import EmptyState from "./ui/EmptyState";
import InfoBanner from "./ui/InfoBanner";
import KpiCard from "./ui/KpiCard";
import Skeleton from "./ui/Skeleton";
import type { LoadedData } from "../app/page";

/** One line under the <h1>, stating exactly what this page documents. */
const HEADER_SUMMARY =
  "이 서비스가 사용하는 공식 자료와 제공 기관, 자료의 기준 기간, 직접 보고값과 계산값의 구분, " +
  "그리고 현재 제공되지 않는 자료를 정리한 화면입니다.";

/**
 * Whether a displayed figure is reported directly by the source, or calculated by
 * this platform from official inputs. These are the plain-Korean names for a
 * distinction the data model already makes — the reporting per-capita response
 * carries BOTH input sources (`waste_source_id`, `population_source_id`) and BOTH
 * reference periods, which is exactly what makes it a derived value.
 */
const VALUE_KIND_LABELS = {
  reported: "직접 보고값",
  derived: "공식 자료 기반 계산값",
} as const;

type ValueKind = keyof typeof VALUE_KIND_LABELS;

interface DatasetRow {
  name: string;
  count: number;
  referencePeriod: string;
  coverage: string;
  valueKind: ValueKind;
  /**
   * Where the displayed figures come from — the organisation behind the served
   * `source_id`. Required, not decorative: repo AGENTS.md and §5 rule 9 both say a
   * displayed metric keeps its source, and a derived metric keeps BOTH inputs.
   * `null` only when the response carried no `source_id` at all.
   */
  sources: (string | null)[];
  /** Shown under a derived row: what it was calculated from. */
  note?: string;
}

/**
 * Own-property lookup for a registry keyed by a SERVER-SUPPLIED string.
 *
 * Without this, a `region_mapping_status` of `constructor` (or an `ownership` of
 * `toString`) resolves an inherited `Object.prototype` FUNCTION, which is not
 * nullish — so the `?? raw` fallback never runs and React throws
 * "Functions are not valid as a React child". Mirrors `lib/dataSources.ts`.
 */
function labelFor(registry: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : key;
}

/** Plain names for the region-mapping status codes (detail table only). */
const REGION_MAPPING_LABELS: Record<string, string> = {
  EXACT_MATCH: "이름 정확히 일치",
  GEOCODED_MATCH: "좌표 변환 후 일치",
  REQUIRES_GEOCODE: "좌표 변환 필요",
  UNMATCHED: "지역 미배정",
  AMBIGUOUS: "지역 판단 불가",
};

const OWNERSHIP_LABELS: Record<string, string> = {
  PUBLIC: "공공",
  PRIVATE: "민간",
};

/** How the freshness join resolved. Loading, failure, and "not served" are distinct. */
type FreshnessState = "loading" | "ready" | "error";

/** Reference-period text for one source, never collapsing the three states above. */
function referencePeriodLabel(source: DisplaySource, state: FreshnessState): string {
  if (state === "loading") return "기준 기간 확인 중";
  if (state === "error") return "기준 기간을 불러오지 못했습니다";
  return source.referencePeriod ?? NO_REFERENCE_PERIOD_LABEL;
}

function SectionCard({
  title,
  children,
  testId,
  description,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
  description?: React.ReactNode;
}) {
  return (
    <section className="wep-card" data-testid={testId}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function TransparencyDashboard({
  data,
  orientation,
}: {
  data: LoadedData;
  /**
   * The area's one-line orientation strip, supplied by the page. It renders inside
   * this view's header, directly BELOW the <h1> — the same position it occupies in
   * the other three areas (asserted by `shell.test.tsx` document-order check).
   */
  orientation?: React.ReactNode;
}) {
  const [freshness, setFreshness] = useState<DataFreshnessItem[] | null>(null);
  const [freshnessState, setFreshnessState] = useState<FreshnessState>("loading");
  const [policy, setPolicy] = useState<SuitabilityPolicy | null>(null);
  const [run, setRun] = useState<SuitabilityRun | null>(null);
  const [costOptions, setCostOptions] = useState<FacilityCostOptions | null>(null);
  const [mapping, setMapping] = useState<FacilityMappingTransparency | null>(null);
  const [mappingError, setMappingError] = useState<{
    message: string;
    detail: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  /**
   * The last served `unmapped.total`. Kept OUTSIDE `mapping` so it survives a failed
   * page request: without it, a failure on page 2 unmounts the pagination controls
   * along with the table and strands the reader on a page they cannot leave.
   */
  const [knownUnmappedTotal, setKnownUnmappedTotal] = useState<number | null>(null);

  // Catalog controls. Deliberately NOT written to the URL in this phase.
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState<SourceArea | "all">("all");
  const [frequencyFilter, setFrequencyFilter] = useState<string>("all");

  const searchId = useId();
  const areaId = useId();
  const frequencyId = useId();
  // Both clear controls unmount themselves on activation (the button is only
  // rendered while a query exists; the empty-state action disappears with the empty
  // state). Focus would then fall to <body>, dropping a keyboard or screen-reader
  // user back to the top of the document. Returning focus to the search field keeps
  // them where they were working.
  const searchRef = useRef<HTMLInputElement>(null);

  // Load the grounded transparency facts once. Suitability may legitimately have no
  // run yet — that is surfaced, not treated as an error.
  useEffect(() => {
    let cancelled = false;
    fetchDataFreshness()
      .then((items) => {
        if (cancelled) return;
        setFreshness(items);
        setFreshnessState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        // A failed freshness request is NOT "no reference periods exist". Keeping the
        // list null and flagging the failure stops an unfetched period from being
        // reported as an absent one.
        setFreshness(null);
        setFreshnessState("error");
      });
    fetchSuitabilityPolicy()
      .then((value) => !cancelled && setPolicy(value))
      .catch(() => undefined);
    fetchSuitabilityLatestRun()
      .then((value) => !cancelled && setRun(value))
      .catch(() => undefined);
    fetchFacilityCostOptions()
      .then((value) => !cancelled && setCostOptions(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Facility mapping transparency is paginated; refetch when the page changes.
  useEffect(() => {
    let cancelled = false;
    fetchFacilityMappingTransparency({ page, pageSize })
      .then((result) => {
        if (cancelled) return;
        setMapping(result);
        // Survives a later failure, so the pagination controls stay operable and the
        // reader is not stranded on a page they cannot navigate away from.
        setKnownUnmappedTotal(result.unmapped.total);
        setMappingError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setMapping(null);
        const raw = cause instanceof ApiError ? (cause.detail?.error ?? cause.message) : "";
        const plain = plainError(raw);
        setMappingError({
          message: raw ? plain.primary : "시설 지도화 자료를 불러올 수 없습니다.",
          detail: raw,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  // ── Source catalog ──────────────────────────────────────────────────────────
  // Built from the served registry only. `buildDisplaySources` fixes the ordering;
  // `filterDisplaySources` preserves it, so filtering never reshuffles the list.
  const sources = useMemo(
    () => buildDisplaySources(data.sources, freshness),
    [data.sources, freshness],
  );
  const areaOptions = useMemo(() => availableAreas(sources), [sources]);
  const frequencyOptions = useMemo(() => availableFrequencies(sources), [sources]);
  const visibleSources = useMemo(
    () =>
      filterDisplaySources(sources, {
        query,
        area: areaFilter,
        frequency: frequencyFilter,
      }),
    [sources, query, areaFilter, frequencyFilter],
  );
  const overview = useMemo(() => summarizeSources(sources), [sources]);

  const filtered = query.trim() !== "" || areaFilter !== "all" || frequencyFilter !== "all";

  function clearFilters() {
    setQuery("");
    setAreaFilter("all");
    setFrequencyFilter("all");
    searchRef.current?.focus();
  }

  function clearQuery() {
    setQuery("");
    searchRef.current?.focus();
  }

  // Record counts for the datasets already loaded by the app (accurate, served).
  // Reference periods and coverage strings are UNCHANGED from before Phase 6.
  /**
   * Row-level source attribution reads the FIRST served item of each dataset.
   *
   * `/population` is query-scoped to a single `source_id` on the backend, so that row
   * cannot borrow. `/facilities` and the reporting endpoints apply no such filter —
   * they are single-sourced today only because the current ingestion writers share
   * one constant. If a second facility or waste-statistics source were ingested,
   * these rows would attribute every record to whichever item came first. Fixing that
   * properly means the READ path declaring its sources, which is a backend change and
   * outside Phase 6; it is recorded in the plan's Phase 6 delivery notes.
   */
  const perCapitaItem = data.reportingPerCapita.items[0];
  const datasets: DatasetRow[] = [
    {
      name: "인구",
      count: data.population.count,
      referencePeriod:
        data.population.items[0]?.reference_period ?? String(data.population.reference_year),
      coverage: "서울·인천·경기 시군구",
      valueKind: "reported",
      // Read off the served row rather than hardcoded, so the attribution cannot
      // drift from the data (the two population series are not interchangeable).
      sources: [organizationLabel(data.population.items[0]?.source_id)],
    },
    {
      name: "폐기물 발생량",
      count: data.reportingStats.count,
      referencePeriod:
        data.reportingStats.items[0]?.reference_period ??
        String(data.reportingStats.reference_year),
      coverage: "수도권 보고 지역",
      valueKind: "reported",
      sources: [organizationLabel(data.reportingStats.items[0]?.source_id)],
    },
    {
      name: "1인당 발생량",
      count: data.reportingPerCapita.count,
      referencePeriod: String(data.reportingPerCapita.reference_year),
      coverage: "수도권 보고 지역",
      valueKind: "derived",
      // A derived metric keeps BOTH inputs (§5 rule 9) — the response names them.
      sources: [
        organizationLabel(perCapitaItem?.waste_source_id),
        organizationLabel(perCapitaItem?.population_source_id),
      ],
      note: "공식 폐기물 발생량을 같은 기준의 공식 인구로 나눈 값입니다. 기관이 직접 보고한 수치가 아닙니다.",
    },
    {
      name: "처리시설",
      count: data.facilities.count,
      referencePeriod:
        data.facilities.items[0]?.reference_period ?? String(data.facilities.reference_year),
      coverage: "수도권 처리시설",
      valueKind: "reported",
      sources: [organizationLabel(data.facilities.items[0]?.source_id)],
    },
  ];

  const totalPages =
    knownUnmappedTotal !== null ? Math.max(1, Math.ceil(knownUnmappedTotal / pageSize)) : 1;
  /**
   * Whether the rows in hand actually describe the page that is currently selected.
   *
   * `page` changes synchronously on click while the refetch is still in flight, so
   * without this gate the previous page's facilities render under the new page's
   * label — the same "stale outcome under a changed request" defect Phase 5 fixed by
   * keying the landfill result to its filters. The served `unmapped.page` is the
   * authority, so the label and the rows can never disagree.
   */
  const rowsAreCurrent = mapping !== null && mapping.unmapped.page === page;

  return (
    // The shared chrome (components/DashboardShell.tsx) owns the single
    // <main id="main-content"> skip-link target, so this is a plain content block.
    // No <aside> is introduced — `desktopNavigation.spec.ts` asserts this view has
    // none, and a sticky rail here would also narrow the full-width source section.
    <div className="w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8" data-testid="transparency-dashboard">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <header>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">데이터와 출처</h1>
          <p className="mt-1 text-sm text-ink-muted">{HEADER_SUMMARY}</p>
          {orientation}
        </header>

        {/* Standing explanation, so deliberately NOT role="alert" — an alert here
            would interrupt a screen reader on every render for information that is
            never new (components/ui/InfoBanner.tsx contract). */}
        <InfoBanner tone="info" title="이 화면을 읽는 방법" testId="transparency-notice">
          <p>
            분석 결과는 아래에 적힌 공식 자료와 그 기준 기간에 따라 달라집니다. 자료마다 기준 기간이
            서로 다르므로 서로 다른 기간의 값을 그대로 비교할 수 없습니다.
          </p>
          <p className="mt-1 text-xs">
            제공되지 않는 값은 0이 아니라 &lsquo;자료 없음&rsquo;으로 표시하며, 기관이 직접 보고한
            값과 이 서비스가 공식 자료로 계산한 값을 구분해 표시합니다.
          </p>
        </InfoBanner>

        {/* ── Overview ─────────────────────────────────────────────────────────
            Counts of served records only. No completeness percentage, freshness
            score, or quality grade — the redesign plan forbids all three and the
            registry carries nothing that could honestly support one. */}
        <section data-testid="transparency-overview">
          <h2 className="sr-only">자료 개요</h2>
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
                    unavailableReason:
                      freshnessState === "loading" ? "확인 중" : "확인하지 못했습니다",
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
              자료 기준 기간을 불러오지 못했습니다. 기준 기간이 없는 것이 아니라 확인하지 못한
              상태이며, 출처 목록의 다른 정보는 그대로 표시됩니다.
            </p>
          )}
        </section>

        {/* ── Source catalog ───────────────────────────────────────────────────
            Keeps `transparency-sources` on a full-width top-level section:
            `desktopNavigation.spec.ts` asserts this element spans >90% of the
            viewport, and `citizenFlows.spec.ts` Task E reads the source name from
            inside it. */}
        <section className="wep-card" data-testid="transparency-sources">
          <h2 className="text-base font-semibold text-ink">출처 목록</h2>
          <p className="mt-1 text-sm text-ink-muted">
            이 서비스는 아래 공공기관 자료만 사용합니다. 브라우저에서 정부 API를 직접 호출하거나
            개인정보를 저장하지 않습니다.
          </p>

          {sources.length === 0 ? (
            // The registry answered with no records. That is an answer, not a
            // failure, so it is not an alert and shows no invented rows.
            <div className="mt-3">
              <EmptyState
                testId="transparency-sources-empty"
                title="등록된 출처 기록이 없습니다."
                description="현재 출처 목록을 제공받지 못했습니다. 없는 출처를 임의로 만들어 표시하지 않습니다."
              />
            </div>
          ) : (
            <>
              {/* Native input + native selects: no combobox library, no third-party
                  table, and the platform's own keyboard behaviour is preserved. */}
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="flex-1">
                  <label htmlFor={searchId} className="block text-xs font-medium text-ink-muted">
                    출처 검색
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      id={searchId}
                      ref={searchRef}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="자료 이름, 제공 기관, 자료 번호"
                      className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
                      data-testid="transparency-search"
                    />
                    {query !== "" && (
                      <button
                        type="button"
                        className="wep-btn-quiet"
                        onClick={clearQuery}
                        data-testid="transparency-search-clear"
                      >
                        검색어 지우기
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div>
                    <label htmlFor={areaId} className="block text-xs font-medium text-ink-muted">
                      자료 분야
                    </label>
                    <select
                      id={areaId}
                      value={areaFilter}
                      onChange={(event) => setAreaFilter(event.target.value as SourceArea | "all")}
                      className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink sm:w-auto"
                      data-testid="transparency-filter-category"
                    >
                      <option value="all">전체</option>
                      {/* Options come from the served records only, so a filter can
                          never offer a category that would always return nothing. */}
                      {areaOptions.map((area) => (
                        <option key={area} value={area}>
                          {SOURCE_AREA_LABELS[area]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor={frequencyId}
                      className="block text-xs font-medium text-ink-muted"
                    >
                      갱신 주기
                    </label>
                    <select
                      id={frequencyId}
                      value={frequencyFilter}
                      onChange={(event) => setFrequencyFilter(event.target.value)}
                      className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink sm:w-auto"
                      data-testid="transparency-filter-frequency"
                    >
                      <option value="all">전체</option>
                      {frequencyOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Polite result count. Lives directly in the section — never inside a
                  disclosure, which would hide it from AT while collapsed. */}
              <p
                role="status"
                className="mt-3 text-xs text-ink-subtle"
                data-testid="transparency-result-count"
              >
                {`전체 ${formatCount(sources.length)}건 중 ${formatCount(visibleSources.length)}건 표시`}
                {filtered ? " (검색·필터 적용)" : ""}
              </p>

              {visibleSources.length === 0 ? (
                // A local search matched nothing. Distinct from "the registry served
                // no sources" and from a request failure; not an alert either.
                <div className="mt-3">
                  <EmptyState
                    testId="transparency-empty-results"
                    title="검색 조건에 맞는 출처가 없습니다."
                    description="검색어나 분야를 바꾸면 다시 찾을 수 있습니다. 조건에 맞는 출처가 없다고 해서 자료가 없는 것은 아닙니다."
                    action={
                      <button type="button" className="wep-btn-quiet" onClick={clearFilters}>
                        검색 조건 지우기
                      </button>
                    }
                  />
                </div>
              ) : (
                <ul
                  className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
                  data-testid="transparency-source-list"
                >
                  {visibleSources.map((source) => (
                    <SourceCard
                      key={source.sourceId}
                      source={source}
                      freshnessState={freshnessState}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ── Reference periods and served record counts ───────────────────────── */}
        <SectionCard
          title="자료별 기준 기간과 표시 개수"
          testId="transparency-datasets"
          description="화면에 실제로 표시되는 기록 수와 그 자료의 기준 기간입니다."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">자료별 기준 기간과 표시 개수</caption>
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-subtle">
                  <th className="py-1 pr-3 font-medium">자료</th>
                  <th className="py-1 pr-3 font-medium">출처</th>
                  <th className="py-1 pr-3 font-medium">값 구분</th>
                  <th className="py-1 pr-3 font-medium">자료 기준 시점</th>
                  <th className="py-1 pr-3 font-medium">표시 지역·시설 수</th>
                  <th className="py-1 pr-3 font-medium">범위</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((row) => (
                  <tr key={row.name} className="border-b border-hairline/60 align-top">
                    <td className="py-2 pr-3 text-ink">
                      {row.name}
                      {row.note ? (
                        <span className="mt-0.5 block text-xs text-ink-subtle">{row.note}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {/* A displayed metric always names its source; a derived one
                          names both inputs. `자료 출처 미표기` is only reachable when
                          the response itself carried no source id — never a guess. */}
                      {row.sources.every((source) => source === null) ? (
                        <span className="text-ink-subtle">자료 출처 미표기</span>
                      ) : (
                        row.sources
                          .filter((source): source is string => source !== null)
                          .map((source) => (
                            <span key={source} className="block">
                              {source}
                            </span>
                          ))
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {/* Text carries the meaning; the tint is secondary only. */}
                      <span
                        className={`inline-block rounded-pill px-2 py-0.5 text-xs ${
                          row.valueKind === "derived"
                            ? "bg-primary-soft text-primary-hover"
                            : "bg-surface-muted text-ink-muted"
                        }`}
                      >
                        {VALUE_KIND_LABELS[row.valueKind]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-ink-muted">{row.referencePeriod}</td>
                    <td className="py-2 pr-3 tabular-nums text-ink-muted">
                      {formatCount(row.count)}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{row.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.
          </p>
        </SectionCard>

        {/* ── What is currently unavailable ───────────────────────────────────── */}
        <SectionCard
          title="현재 제공되지 않는 자료"
          testId="transparency-gaps"
          description="공식 자료를 확보하지 못한 항목과, 자료는 있으나 지도에 표시하지 못한 시설입니다. 어느 쪽도 값이 0이라는 뜻이 아닙니다."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div data-testid="transparency-cost">
              <h3 className="text-sm font-semibold text-ink">비용 계산에 넣지 못한 항목</h3>
              <p className="mt-1 text-xs text-ink-subtle">
                비용은 표준공사비 기준의 참고용 설치비 계산이며, 실제 총사업비가 아닙니다.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
                {/* Rendered from the shared glossary so this list and the cost
                    dashboard can never drift into two different wordings. */}
                {Object.values(MISSING_COMPONENT_META).map((component) => (
                  <li key={component.code}>
                    <span className="text-ink">{`${component.primary} (${component.short})`}</span>
                    <span className="mt-0.5 block text-xs text-ink-subtle">
                      {component.explanation}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink">지도에 표시하지 못한 시설</h3>
              {mappingError ? (
                <p className="mt-1 text-sm text-ink-muted">
                  시설 지도 표시 현황을 불러오지 못해 개수를 표시할 수 없습니다.
                </p>
              ) : mapping ? (
                <>
                  <p className="mt-1 text-sm text-ink-muted">
                    전체 {formatCount(mapping.total)}개 시설 가운데{" "}
                    <span className="font-semibold text-ink tabular-nums">
                      {formatCount(mapping.without_map_location)}개
                    </span>
                    는 주소를 좌표로 바꾸지 못해 지도에 표시하지 못했습니다.
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    표시하지 못한 시설도 집계에는 그대로 포함됩니다. 아래 &lsquo;시설 지도 표시
                    현황&rsquo;에서 시설별 사유를 확인할 수 있습니다.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-muted">
                  시설 지도 표시 현황을 확인하는 중입니다.
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Facility mapping transparency ───────────────────────────────────── */}
        <SectionCard
          title="시설 지도 표시 현황"
          testId="transparency-facility-mapping"
          description="시설 자료는 있으나 지도 위치를 확인하지 못한 시설을 그대로 공개합니다."
        >
          {mappingError ? (
            // A genuine request failure the reader can retry — the only alert here.
            <InfoBanner
              tone="error"
              role="alert"
              title="자료를 불러오지 못했습니다"
              testId="transparency-mapping-error"
            >
              <p className="font-medium text-ink">{mappingError.message}</p>
              <p className="mt-1 text-xs">
                불러오지 못한 값은 표시하지 않습니다. 0으로 채우거나 이전 값을 그대로 두지 않습니다.
              </p>
              {mappingError.detail && (
                <p
                  className="mt-1 text-xs text-ink-subtle"
                  data-diagnostic
                  data-testid="transparency-mapping-error-detail"
                >
                  기술 정보: {mappingError.detail}
                </p>
              )}
              {/* The reader may have failed while paging. Keeping the controls
                  operable lets them go back instead of being stranded on a page
                  whose contents will never load. */}
              {knownUnmappedTotal !== null && knownUnmappedTotal > pageSize && (
                <UnmappedPagination
                  page={page}
                  totalPages={totalPages}
                  total={knownUnmappedTotal}
                  onChange={setPage}
                />
              )}
            </InfoBanner>
          ) : !mapping ? (
            <>
              {/* The announcement and the decorative placeholder are separate: the
                  Skeleton is aria-hidden, this line is the only thing AT reads. */}
              <p
                className="text-sm text-ink-muted"
                data-testid="transparency-mapping-loading"
                role="status"
              >
                시설 지도 표시 현황을 불러오는 중입니다.
              </p>
              <div
                aria-hidden
                className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
                data-testid="transparency-mapping-skeleton"
              >
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="wep-card">
                    <Skeleton lines={2} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <dl
                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                data-testid="facility-mapping-counts"
              >
                <KpiCard label="전체 시설" value={formatCount(mapping.total)} />
                <KpiCard label="지도 표시" value={formatCount(mapping.with_map_location)} />
                <KpiCard label="지도 위치 없음" value={formatCount(mapping.without_map_location)} />
                <KpiCard label="주소 없음" value={formatCount(mapping.without_address)} />
              </dl>
              <p className="mt-2 text-xs text-ink-subtle">{mapping.disclaimer}</p>

              <div className="mt-3 flex flex-col gap-3">
                <Accordion
                  label="시설 종류별 지도 표시 현황"
                  testId="transparency-mapping-category"
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <caption className="sr-only">시설 종류별 지도 표시 현황</caption>
                      <thead>
                        <tr className="border-b border-hairline text-xs text-ink-subtle">
                          <th className="py-1 pr-3 font-medium">종류</th>
                          <th className="py-1 pr-3 font-medium">전체</th>
                          <th className="py-1 pr-3 font-medium">지도 표시</th>
                          <th className="py-1 pr-3 font-medium">위치 없음</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapping.category_breakdown.map((row) => (
                          <tr key={row.category} className="border-b border-hairline/60">
                            <td className="py-1 pr-3 text-ink-muted">
                              {labelFor(FACILITY_CATEGORY_LABELS, row.category)}
                            </td>
                            <td className="py-1 pr-3 tabular-nums">{formatCount(row.total)}</td>
                            <td className="py-1 pr-3 tabular-nums">
                              {formatCount(row.with_map_location)}
                            </td>
                            <td className="py-1 pr-3 tabular-nums">
                              {formatCount(row.without_map_location)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Accordion>

                <div>
                  <h3 className="mb-1 text-sm font-semibold text-ink">지도에 표시하지 못한 시설</h3>
                  {!rowsAreCurrent ? (
                    // The rows in hand describe a DIFFERENT page than the one now
                    // selected. Rendering them under the new page's label would
                    // misattribute facilities to a page they are not on, so nothing
                    // is shown until the matching response arrives.
                    <p
                      className="text-sm text-ink-muted"
                      role="status"
                      data-testid="transparency-unmapped-paging"
                    >
                      선택한 페이지를 불러오는 중입니다.
                    </p>
                  ) : mapping.unmapped.items.length === 0 ? (
                    <EmptyState
                      testId="transparency-unmapped-empty"
                      title="지도에 표시하지 못한 시설이 없습니다."
                      description="현재 기준으로 모든 시설의 지도 위치를 확인했습니다."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        className="w-full min-w-[680px] text-left text-sm"
                        data-testid="unmapped-facility-table"
                      >
                        <caption className="sr-only">지도에 표시하지 못한 시설 목록</caption>
                        <thead>
                          <tr className="border-b border-hairline text-xs text-ink-subtle">
                            <th className="py-1 pr-3 font-medium">시설명</th>
                            <th className="py-1 pr-3 font-medium">종류</th>
                            <th className="py-1 pr-3 font-medium">지역</th>
                            <th className="py-1 pr-3 font-medium">지역 배정</th>
                            <th className="py-1 pr-3 font-medium">위치 없는 이유</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapping.unmapped.items.map((facility) => (
                            <tr key={facility.id} className="border-b border-hairline/60">
                              <td className="py-1 pr-3 text-ink">{facility.facility_name}</td>
                              <td className="py-1 pr-3 text-ink-muted">
                                {labelFor(FACILITY_CATEGORY_LABELS, facility.facility_category)}
                                {" · "}
                                {labelFor(OWNERSHIP_LABELS, facility.ownership)}
                              </td>
                              <td className="py-1 pr-3 text-ink-muted">
                                {facility.rcis_sido_name} {facility.rcis_sigungu_name}
                              </td>
                              <td className="py-1 pr-3 text-ink-muted">
                                {labelFor(REGION_MAPPING_LABELS, facility.region_mapping_status)}
                              </td>
                              <td className="py-1 pr-3 text-ink-muted">
                                {/* Only ever the RECORDED reason; never a fabricated one. */}
                                {facility.missing_location_reason ?? (
                                  <span className="text-ink-subtle">실패 사유 기록 없음</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {knownUnmappedTotal !== null && knownUnmappedTotal > pageSize && (
                    <UnmappedPagination
                      page={page}
                      totalPages={totalPages}
                      total={knownUnmappedTotal}
                      onChange={setPage}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Method, interpretation limits, and technical provenance ──────────── */}
        <SectionCard
          title="계산 방법과 기술 정보"
          testId="transparency-methodology"
          description="자세한 계산 방법과 기술 식별자는 아래에서 펼쳐 볼 수 있습니다."
        >
          <div className="flex flex-col gap-3">
            <Accordion label="이 자료로 말할 수 있는 것과 없는 것" testId="transparency-limits">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
                <li>
                  후보지 분석은 공공자료를 이용한 1차 비교이며, 실제 입지 결정·허가·법적 적격성을
                  의미하지 않습니다.
                </li>
                <li>
                  비용은 표준공사비 기준의 참고용 설치비 계산이며, 실제 총사업비나 확정 사업비가
                  아닙니다.
                </li>
                <li>
                  1인당 값은 공식 자료로 계산한 비교용 값이며, 개인이 실제로 내는 금액이 아닙니다.
                </li>
                <li>
                  매립지 반입 자료는 광역지자체 단위이며, 시·군·구별 이동 경로나 실제 운송 경로를
                  의미하지 않습니다.
                </li>
                <li>
                  자료마다 기준 기간과 집계 기준이 다르므로, 서로 다른 기준의 값을 하나로 합치지
                  않습니다.
                </li>
              </ul>
            </Accordion>

            <Accordion label="가중치 바꿔보기 결과의 저장 여부" testId="transparency-scenario">
              <p className="text-sm text-ink-muted">
                &lsquo;가중치 바꿔보기&rsquo;에서 만든 결과는 화면에서만 계산하는 임시 결과이며
                저장되지 않습니다. 공식 분석 실행이나 저장된 점수를 바꾸지 않습니다.
              </p>
            </Accordion>

            {/* Phase 6 AC4: the raw version identifiers live here, behind a
                disclosure and marked `data-diagnostic`, instead of on the primary
                surface. They are NOT deleted (§5 rule 12). */}
            <Accordion label="기술 정보 (분석 버전과 식별자)" testId="transparency-technical">
              {run && policy ? (
                <dl
                  className="grid grid-cols-1 gap-2 text-sm text-ink-muted sm:grid-cols-2"
                  data-testid="transparency-suitability"
                >
                  <div>
                    <dt className="inline font-medium text-ink">분석 실행: </dt>
                    <dd className="inline tabular-nums">
                      #{run.id} · 기준연도 {run.reference_year}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">후보 구역 수: </dt>
                    <dd className="inline tabular-nums">
                      {formatCount(run.candidate_count_total)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">분석 규칙 버전: </dt>
                    {/* `break-all` so a long identifier wraps inside its cell instead
                        of widening the page (no horizontal overflow at any width). */}
                    <dd className="inline break-all" data-diagnostic>
                      {policy.policy_version}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">계산 방식 버전: </dt>
                    <dd className="inline break-all" data-diagnostic>
                      {policy.derivation_version}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">분석 구역 버전: </dt>
                    <dd className="inline break-all" data-diagnostic>
                      {policy.candidate_grid_version}
                    </dd>
                  </div>
                  {costOptions && (
                    <div>
                      <dt className="inline font-medium text-ink">표준공사비 기준 자료: </dt>
                      <dd
                        className="inline break-all"
                        data-diagnostic
                        data-testid="transparency-cost-version"
                      >
                        {costOptions.active_cost_version}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-ink-muted" data-testid="transparency-suitability">
                  아직 표시할 후보지 분석 결과가 없습니다.
                </p>
              )}
              <p className="mt-2 text-xs text-ink-subtle">
                점수 반영 기준(가중치)은 여러 가지를 제공하며, &lsquo;데이터 분포 기준&rsquo;은 값의
                차이와 중복 정도로 자동 계산됩니다. 안정성은 기본·균등·데이터 분포 기준의 상위 10%
                포함 여부로 판단하며, 최종 입지·허가·법적 적격성을 의미하지 않습니다.
              </p>
            </Accordion>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

/**
 * Pagination for the unmapped-facility list.
 *
 * Rendered from `knownUnmappedTotal` rather than from the in-hand response, so a
 * failed page request leaves the controls operable instead of unmounting them and
 * stranding the reader on a page they cannot navigate away from.
 */
function UnmappedPagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div
      className="mt-2 flex items-center justify-between text-xs text-ink-muted"
      data-testid="transparency-unmapped-pagination"
    >
      <span className="tabular-nums">
        {page} / {totalPages} 페이지 · 총 {formatCount(total)}개
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          className="wep-btn-quiet"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(1, page - 1))}
          data-testid="transparency-unmapped-prev"
        >
          이전
        </button>
        <button
          type="button"
          className="wep-btn-quiet"
          disabled={page >= totalPages}
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          data-testid="transparency-unmapped-next"
        >
          다음
        </button>
      </div>
    </div>
  );
}

/**
 * One source record.
 *
 * Leads with the plain-Korean dataset name; the technical identifiers (`source_id`,
 * the served English strings, the endpoint, the raw freshness status) are demoted to
 * a disclosure. A search CAN match on those identifiers — the reader may have
 * arrived with one — but matching never promotes an identifier to the title.
 */
function SourceCard({
  source,
  freshnessState,
}: {
  source: DisplaySource;
  freshnessState: FreshnessState;
}) {
  const collected = collectionDate(source.lastSuccessAt);
  return (
    <li
      className="rounded-card border border-hairline bg-surface-muted p-3"
      data-testid="transparency-source-card"
    >
      <p className="text-sm font-semibold text-ink">{source.datasetName}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{source.organization}</p>

      <dl className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
        <div className="flex gap-2">
          <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">자료 분야</dt>
          <dd>{source.areaLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">갱신 주기</dt>
          <dd>{source.frequencyLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">기준 기간</dt>
          <dd className="tabular-nums">{referencePeriodLabel(source, freshnessState)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">수집 시점</dt>
          {/* `last_success_at` records when the last ingestion SUCCEEDED. It is not
              a claim that the dataset itself is current, so it is labelled as a
              collection time rather than a freshness date. */}
          <dd className="tabular-nums">
            {collected ? `${collected} ${COLLECTION_DATE_SUFFIX}` : NO_COLLECTION_DATE_LABEL}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">사용 상태</dt>
          <dd>{source.enabled ? "사용 중" : "사용 안 함"}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs">
        {source.documentationUrl ? (
          <a
            href={source.documentationUrl}
            target="_blank"
            // These are the first external links in the app, so there is no prior
            // convention to follow. `noreferrer` implies `noopener` in every current
            // engine; both are named so an older engine still cannot hand the opened
            // government page a live `window.opener` handle back into this tab.
            rel="noopener noreferrer"
            className="text-primary underline"
            data-testid="transparency-source-link"
          >
            {`${source.datasetName} 기관 안내 페이지 (새 창)`}
          </a>
        ) : (
          // No served URL — and one is never guessed from a dataset id or endpoint.
          <span className="text-ink-subtle" data-testid="transparency-source-nolink">
            기관 안내 주소 없음
          </span>
        )}
      </p>

      <details className="mt-2 text-xs text-ink-subtle" data-diagnostic>
        <summary className="cursor-pointer">기술 정보 보기</summary>
        <dl className="mt-1 flex flex-col gap-0.5">
          <div>
            <dt className="inline font-medium">자료 번호: </dt>
            <dd className="inline break-all">{source.sourceId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 기관명: </dt>
            <dd className="inline break-all">{source.servedSourceName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 자료명: </dt>
            <dd className="inline break-all">{source.servedDatasetName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">갱신 주기 코드: </dt>
            <dd className="inline break-all">{source.frequency}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 접근 주소: </dt>
            <dd className="inline break-all">{source.endpoint}</dd>
          </div>
          {source.freshnessStatus && (
            <div>
              <dt className="inline font-medium">수집 상태 코드: </dt>
              <dd className="inline break-all">{source.freshnessStatus}</dd>
            </div>
          )}
        </dl>
      </details>
    </li>
  );
}
