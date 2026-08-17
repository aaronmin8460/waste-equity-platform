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
 * ── WHAT THE FIGMA REDESIGN CHANGED (frame 156:470, page 6) ─────────────────────
 * Presentation only, again. No endpoint, request parameter, response field, count,
 * reference period, snapshot, availability rule, filter option, ordering, link, or
 * analytical value changed.
 *
 *   1. Sections lost their card chrome (`ui/SectionCard` → `TransparencySection`).
 *      Figma renders them bare on the modal surface and reserves a filled/bordered
 *      surface for the four overview tiles and the source cards. The `<section>` +
 *      visible `<h2>` + `aria-labelledby` contract is reproduced exactly.
 *   2. The embedded form no longer repeats `HEADER_SUMMARY`: the dialog head
 *      already carries a title and a supporting line, and Figma shows one.
 *   3. 자료 현황 요약 → 한눈에 보기, with Figma's supporting copy and tile geometry.
 *   4. The catalog controls became one row and gained a persistent
 *      검색 조건 지우기; the no-match state's duplicate of that button is gone.
 *   5. The source card is Figma's: chips for 자료 분야 / 갱신 주기, a rule, then
 *      기준 기간 and 원문 링크 as label-left / value-right rows. 수집 시점 and
 *      사용 상태 moved into the existing technical disclosure.
 *   6. The modal ends with Figma's closing note and a primary 닫기 button.
 *
 * NOTHING NUMERIC came from the frame. Its 9 / 6 / 5 / 2 tiles, its `9건 표시`, its
 * `32개 지역` column, and its `처리시설 → 자료 없음` row are prototype placeholders
 * that contradict the served responses, and every one of them is ignored.
 *
 * ── WHAT THE PROVENANCE CLEANUP CHANGED ────────────────────────────────────────
 * Presentation and information architecture only, a third time. No endpoint, request
 * parameter, response field, count, reference period, snapshot, availability rule,
 * filter option, ordering, link, or analytical value changed.
 *
 * This screen is the platform's canonical home for anything true of MORE THAN ONE
 * area — Pages 1–3 are removing the repeated copies from their primary surfaces, and
 * a rule they drop has to be findable here. An audit found the opposite problem as
 * well: six of those rules were written out three or four times on THIS screen, in
 * the standing banner and an overview caption and a gap block and a methodology
 * disclosure at once. A permanent caveat repeated five times stops being read.
 *
 *   1. 공통 해석 기준 (`TransparencyDefinitions`) is new, and is the ONE home for
 *      every cross-screen rule: what a blank means, reported versus derived, a
 *      failed lookup versus an absent period, differing reference periods, differing
 *      accounting bases, per-capita as a conversion, the ranking denominator, map
 *      classes as relative bands, weights not moving a screening verdict, and
 *      screening not being a siting decision. `TransparencyDashboard.test.tsx`
 *      asserts each is present AND that none of them is stated twice.
 *   2. The banner, the overview period tile, both gap blocks and the methodology
 *      section gave up their copies of those rules and kept only what is theirs: a
 *      served count, and what that particular count does not mean.
 *   3. 계산 방법과 기술 정보 lost three disclosures to (1) and now holds only the
 *      analysis run and the version identifiers.
 *   4. 현재 제공되지 않는 자료 gained a FOURTH gap — the suitability factors the
 *      screening does not evaluate — rendered from the same shared component and
 *      glossary constants the suitability screens use, so the two can never drift.
 *   5. A structural slot for the NEXT screening methodology says only that it is not
 *      settled. It publishes no weight, threshold, distance, numerator, direction or
 *      stability rule, because none has been decided.
 *
 * The dataset-card system is untouched: Page 6's Figma frame is bordered and
 * shadowless, so the shared `.wep-figma-card` elevation the other five areas use is
 * deliberately NOT adopted here, and a unit test asserts this view renders none.
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
import TransparencyDefinitions from "./transparency/TransparencyDefinitions";
import TransparencyMethodology from "./transparency/TransparencyMethodology";
import TransparencyNotice from "./transparency/TransparencyNotice";
import TransparencySection from "./transparency/TransparencySection";
import {
  buildDatasetRows,
  CATALOG_PRESERVATION_NOTE,
  CATALOG_SUMMARY,
  HEADER_SUMMARY,
  UNMAPPED_PAGE_SIZE,
  type FreshnessState,
} from "./transparency/shared";
import PageHeader from "./ui/PageHeader";
import WetlandSourceNote from "./WetlandSourceNote";
import type { LoadedData } from "../app/page";

export default function TransparencyDashboard({
  data,
  orientation,
  title,
  embedded = false,
  onClose,
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
  /**
   * Rendered inside the 데이터·출처 dialog rather than as a page.
   *
   * The dialog supplies its own heading, padding, and scroll container, so the
   * embedded form drops this component's page gutters and its `PageHeader` —
   * otherwise the reader would meet the title twice and scroll two boxes.
   */
  embedded?: boolean;
  /**
   * Closes the surrounding dialog. Supplied only in the embedded form, where Figma
   * frame 156:470 ends the modal with a closing note and a primary 닫기 button — a
   * long, internally-scrolling modal otherwise makes the reader scroll all the way
   * back up to the ✕ to leave. It is additive: the dialog's own ✕, Escape, and
   * backdrop click are untouched, and omitting this renders no footer at all.
   */
  onClose?: () => void;
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
    <div
      // Embedded: 32px side gutters, the frame's, and the same value the scoped
      // `.wep-dialog-head` rule uses so the dialog title and the sections below it
      // share one left edge (globals.css, 데이터·출처 block).
      className={
        embedded ? "w-full px-8 pt-5 pb-6" : "w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8"
      }
      data-testid="transparency-dashboard"
    >
      {/* Figma's inter-section rhythm is 22px — the frame reports 29.8, but frame
          156:470 is scaled by 1.354808 (see `transparency/TransparencySection.tsx`
          for how that factor was established against the unscaled sibling
          artboards). Tightening from 24 keeps 현재 조건 above the fold at 1024×768,
          which `phase6DataSourcesDashboard.spec.ts` enforces. */}
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-[22px]">
        {embedded ? (
          // Nothing: the dialog head already carries the title AND a supporting
          // line, and Figma frame 156:470 shows exactly one such line. Repeating
          // HEADER_SUMMARY here gave the reader two consecutive descriptions of the
          // same screen before any content.
          null
        ) : (
          <PageHeader title={title} description={HEADER_SUMMARY}>
            {orientation}
          </PageHeader>
        )}

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
        <TransparencySection
          title="출처 목록"
          testId="transparency-sources"
          description={CATALOG_SUMMARY}
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
        </TransparencySection>

        {/* ── Reference periods and served record counts ───────────────────────── */}
        <TransparencySection
          title="자료별 기준 기간과 표시 개수"
          testId="transparency-datasets"
          description="화면에 실제로 표시되는 기록 수와 그 자료의 기준 기간입니다."
        >
          <DatasetPeriodTable rows={datasets} />
        </TransparencySection>

        {/* ── The global interpretation rules ───────────────────────────────────
            Page 6 is the platform's canonical home for anything true of MORE THAN
            ONE screen, so Pages 1–3 can stop repeating it on their primary
            surfaces. Placed directly after the dataset table because that table is
            where a reader first meets 값 구분 and 자료 기준 시점 side by side, and
            before the gap section, which uses the same vocabulary. */}
        <TransparencySection
          title="공통 해석 기준"
          testId="transparency-definitions"
          description="이 서비스의 모든 화면에 함께 적용되는 표시·비교·해석 기준입니다. 각 화면에서 반복하지 않고 여기에 한 번만 정리합니다."
        >
          <TransparencyDefinitions />
        </TransparencySection>

        {/* ── What is currently unavailable ─────────────────────────────────────
            Figma frame 156:470 stops after the table. This section, the facility
            mapping panel, and the methodology disclosure are kept: the frame is a
            visual prototype of the top of the modal, and dropping the three blocks
            that state what the platform does NOT have would make the screen a
            catalogue of strengths (brief §10, §11). They follow the frame's section
            rhythm so they do not read as a different screen. */}
        <TransparencySection
          title="현재 제공되지 않는 자료"
          testId="transparency-gaps"
          description="공식 자료를 확보하지 못한 항목, 자료는 있으나 지도에 표시하지 못한 시설, 기준 기간을 확인하지 못한 자료, 그리고 후보지 분석이 아직 평가하지 못하는 입지 요인입니다."
        >
          <KnownDataGaps
            overview={overview}
            freshnessState={freshnessState}
            mapping={mapping}
            mappingFailed={mappingError !== null}
          />
        </TransparencySection>

        {/* ── Facility mapping transparency ───────────────────────────────────── */}
        <TransparencySection
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
        </TransparencySection>

        {/* ── Technical provenance ─────────────────────────────────────────────
            The interpretation limits and the label glossary that used to share this
            section now live once, in 공통 해석 기준 above. What is left is what is
            genuinely specific to the served run: which analysis version produced the
            figures. */}
        <TransparencySection
          title="계산 방법과 기술 정보"
          testId="transparency-methodology"
          description="이 화면의 수치를 만들어 낸 분석 실행과 기술 식별자를 아래에서 펼쳐 볼 수 있습니다."
        >
          <TransparencyMethodology policy={policy} run={run} costOptions={costOptions} />
        </TransparencySection>

        {/* ── The closing band ─────────────────────────────────────────────────
            Figma rules the modal off and pairs the preservation statement with a
            primary 닫기. Rendered here rather than in `ui/Dialog` so the shared
            primitive (also used by 지표 순위 전체보기) is untouched.

            The STATEMENT is unconditional; only the BUTTON is embedded-only. It used
            to be conditional on both, which was safe while it was also duplicated in
            the catalog's search caption — now that the caption states only how to
            search, a conditional closing band would have left the standalone form
            with no preservation claim at all. */}
        <div className="flex flex-col gap-3 border-t border-hairline pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-subtle">{CATALOG_PRESERVATION_NOTE}</p>
          {embedded && onClose ? (
            <button
              type="button"
              className="wep-btn-primary flex-none rounded-xl"
              onClick={onClose}
              data-testid="transparency-close"
            >
              닫기
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
