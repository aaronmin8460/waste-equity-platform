"use client";

/**
 * 데이터와 출처 — the citizen data-transparency centre.
 *
 * A full-width, map-free page that answers, in this order: which official datasets
 * the platform holds, what each one is about, who publishes it, which reference
 * period it covers, whether a displayed figure is reported directly or calculated
 * from official inputs, what is currently NOT available, and where the raw technical
 * provenance can be inspected.
 *
 * ── WHAT THE CIVIC-DASHBOARD REFRESH CHANGED (docs/ui-refresh/transparency-dashboard.md)
 * Presentation and information architecture only. No endpoint, request parameter,
 * response field, count, reference period, snapshot, availability rule, filter
 * option, ordering, link, or analytical value changed.
 *
 *   1. `PageHeader` now owns the `<h1>`, as in the other four refreshed areas, so
 *      "exactly one h1 per view" is enforced by the shared primitive. The string
 *      데이터와 출처 is unchanged and still compared exactly by three suites.
 *   2. This file's PRIVATE `SectionCard` copy is gone. It rendered a bare `<h2>` in
 *      a `.wep-card` with no `aria-labelledby`, so four of this page's sections were
 *      unnamed regions; they now use the shared `components/ui/SectionCard` and each
 *      one announces itself.
 *   3. A 현재 조건 summary states which search term and which filters are active. The
 *      previous screen said only `(검색·필터 적용)`, which told the reader that
 *      filtering was on but never what it was filtering by.
 *   4. `DataStatusBadge` replaced the two hand-rolled provenance pills, keeping the
 *      exact wording (`직접 보고값` / `공식 자료 기반 계산값`) as its `label`, and it
 *      now also marks an absent reference period (`missing`) and a switched-off
 *      registry row (`excluded`). Colour is never the only signal — every badge
 *      carries its text.
 *   5. 현재 제공되지 않는 자료 gained a third, genuinely distinct gap: how many
 *      registered sources served no reference period. It is a count of served
 *      records, shown only once the freshness join has resolved.
 *   6. The JSX moved into `components/transparency/`. This file kept the state and
 *      the composition; every component there is presentational.
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
  filterDisplaySources,
  summarizeSources,
  type SourceArea,
} from "../lib/dataSources";
import { plainError } from "../lib/glossary";
import LandCoverSourceNote from "./LandCoverSourceNote";
import FacilityMappingPanel from "./transparency/FacilityMappingPanel";
import DatasetPeriodTable from "./transparency/DatasetPeriodTable";
import KnownDataGaps from "./transparency/KnownDataGaps";
import SourceCatalog from "./transparency/SourceCatalog";
import SourceOverview from "./transparency/SourceOverview";
import TransparencyMethodology from "./transparency/TransparencyMethodology";
import TransparencyNotice from "./transparency/TransparencyNotice";
import {
  buildDatasetRows,
  HEADER_SUMMARY,
  UNMAPPED_PAGE_SIZE,
  type FreshnessState,
} from "./transparency/shared";
import PageHeader from "./ui/PageHeader";
import SectionCard from "./ui/SectionCard";
import WetlandSourceNote from "./WetlandSourceNote";
import type { LoadedData } from "../app/page";

export default function TransparencyDashboard({
  data,
  orientation,
  title,
}: {
  data: LoadedData;
  /**
   * The area's one-line orientation strip, supplied by the page. It renders inside
   * this view's header, directly BELOW the <h1> — the same position it occupies in
   * the other three areas (asserted by `shell.test.tsx` document-order check).
   */
  orientation?: React.ReactNode;
  /**
   * The view's single `<h1>`, supplied by the page so it always equals the visible
   * navigation destination name (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.2). Previously
   * the literal "데이터와 출처", which differed from the nav's "데이터·출처" — two
   * names for one place.
   */
  title: string;
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
    fetchFacilityMappingTransparency({ page, pageSize: UNMAPPED_PAGE_SIZE })
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
  const datasets = useMemo(() => buildDatasetRows(data), [data]);

  return (
    // The shared chrome (components/DashboardShell.tsx) owns the single
    // <main id="main-content"> skip-link target, so this is a plain content block.
    // No <aside> is introduced — `desktopNavigation.spec.ts` asserts this view has
    // none, and a sticky rail here would also narrow the full-width source section.
    <div className="w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8" data-testid="transparency-dashboard">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <PageHeader title={title} description={HEADER_SUMMARY}>
          {orientation}
        </PageHeader>

        {/* Standing explanation, so deliberately NOT role="alert" — an alert here
            would interrupt a screen reader on every render for information that is
            never new (components/ui/InfoBanner.tsx contract). */}
        <TransparencyNotice />

        {/* ── Overview ─────────────────────────────────────────────────────────
            Counts of served records only. No completeness percentage, freshness
            score, or quality grade — the redesign plan forbids all three and the
            registry carries nothing that could honestly support one. */}
        <SourceOverview overview={overview} freshnessState={freshnessState} />

        {/* ── Source catalog ───────────────────────────────────────────────────
            Keeps `transparency-sources` on a full-width top-level section:
            `desktopNavigation.spec.ts` asserts this element spans >90% of the
            viewport, and `citizenFlows.spec.ts` Task E reads the source name from
            inside it. */}
        <SectionCard
          title="출처 목록"
          testId="transparency-sources"
          description="이 서비스는 아래 공공기관 자료만 사용합니다. 브라우저에서 정부 API를 직접 호출하거나 개인정보를 저장하지 않습니다."
        >
          <SourceCatalog
            sources={sources}
            visibleSources={visibleSources}
            freshnessState={freshnessState}
            searchId={searchId}
            areaId={areaId}
            frequencyId={frequencyId}
            searchRef={searchRef}
            query={query}
            onQueryChange={setQuery}
            onClearQuery={clearQuery}
            onClearFilters={clearFilters}
            area={areaFilter}
            onAreaChange={setAreaFilter}
            areaOptions={areaOptions}
            frequency={frequencyFilter}
            onFrequencyChange={setFrequencyFilter}
            frequencyOptions={frequencyOptions}
            filtered={filtered}
          />

          {/* Inland-wetland inventory (Phase 1B-2) exposure disclosure: read-only
              API/map layer, no suitability score, distinct from the statutory
              UM901 protection area, verified locally only (not deployed). */}
          <WetlandSourceNote />

          {/* Land-cover candidate-cell statistics (Phase 1B-LC8) public disclosure:
              mandatory source attribution, the project-level government-partner
              authorization the publication rests on, the raw-data non-redistribution
              statement, scoring non-use, and the coverage limitations. */}
          <LandCoverSourceNote />
        </SectionCard>

        {/* ── Reference periods and served record counts ───────────────────────── */}
        <SectionCard
          title="자료별 기준 기간과 표시 개수"
          testId="transparency-datasets"
          description="화면에 실제로 표시되는 기록 수와 그 자료의 기준 기간입니다."
        >
          <DatasetPeriodTable rows={datasets} />
        </SectionCard>

        {/* ── What is currently unavailable ───────────────────────────────────── */}
        <SectionCard
          title="현재 제공되지 않는 자료"
          testId="transparency-gaps"
          description="공식 자료를 확보하지 못한 항목, 자료는 있으나 지도에 표시하지 못한 시설, 그리고 기준 기간을 확인하지 못한 자료입니다. 어느 쪽도 값이 0이라는 뜻이 아닙니다."
        >
          <KnownDataGaps
            overview={overview}
            freshnessState={freshnessState}
            mapping={mapping}
            mappingFailed={mappingError !== null}
          />
        </SectionCard>

        {/* ── Facility mapping transparency ───────────────────────────────────── */}
        <SectionCard
          title="시설 지도 표시 현황"
          testId="transparency-facility-mapping"
          description="시설 자료는 있으나 지도 위치를 확인하지 못한 시설을 그대로 공개합니다. 아래 개수는 모두 공식 시설 목록을 센 값입니다."
        >
          <FacilityMappingPanel
            mapping={mapping}
            error={mappingError}
            page={page}
            onPageChange={setPage}
            knownUnmappedTotal={knownUnmappedTotal}
          />
        </SectionCard>

        {/* ── Method, interpretation limits, and technical provenance ──────────── */}
        <SectionCard
          title="계산 방법과 기술 정보"
          testId="transparency-methodology"
          description="자세한 계산 방법, 화면에 쓰인 표시 용어, 기술 식별자를 아래에서 펼쳐 볼 수 있습니다."
        >
          <TransparencyMethodology policy={policy} run={run} costOptions={costOptions} />
        </SectionCard>
      </div>
    </div>
  );
}
