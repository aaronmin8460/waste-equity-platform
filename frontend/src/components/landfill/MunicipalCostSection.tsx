"use client";

/**
 * 시·군·구별 생활폐기물 수집·운반 계약 지급액 — the 2024 municipal payment comparison.
 *
 * ── What this section is, and what it is emphatically not ──────────────────────
 * It shows what each 기초지자체 disclosed paying its collection/transport contractors
 * in 2024, divided by the same area's 2024 population. It is NOT the official
 * Sudokwon Landfill inbound fee that the rest of this screen reports:
 *
 *   | | 수도권매립지 반입수수료 | 이 섹션 |
 *   | provider  | 수도권매립지관리공사 (one corporation) | each 기초지자체, separately |
 *   | geography | 시·도 (3 rows)                       | 시·군·구 (66 rows)         |
 *   | basis     | inbound fee at the landfill gate      | collection/transport contract payment |
 *
 * The two must never be added, differenced, or read as comparable costs. The
 * backend states this in `meta.difference_from_official_landfill_fee` and sets
 * `meta.is_official_landfill_fee` to false; this section renders that served
 * sentence VERBATIM rather than paraphrasing it away.
 *
 * ── Where the distinction is stated, after the Page-2 remediation ──────────────
 * It used to be a full-width coloured `tone="warning"` banner carrying two
 * paragraphs at the top of this section — the second such panel on the screen. The
 * SENTENCES are unchanged and are still rendered verbatim; what changed is that
 * they are now a compact note attached to the heading rather than a coloured panel,
 * and the served sentence ALSO appears in the 지역별 상세 현황 table above, directly
 * under the 계약 지급액 column group. That is the surface where the two datasets sit
 * closest together, so it is where the reader most needs to be told they are not
 * the same thing — a warning at the top of a section 1,500px below is not where the
 * confusion happens.
 *
 * It is deliberately a table/comparison feature with NO map. The Step 2 registry
 * stores no geometry on purpose, and seven of the 66 rows (the Gyeonggi cities held
 * only as 일반구) have no `direct_region_code` at all — drawing them would mean
 * fabricating city polygons.
 *
 * ── Ownership ──────────────────────────────────────────────────────────────────
 * This component holds NO state and issues NO request. `app/page.tsx` owns the
 * three filters, the request lifecycle, and the URL mirroring, exactly as it does
 * for the four official landfill filters. There is no second copy of the filter
 * state anywhere in this directory.
 *
 * ── Layout ─────────────────────────────────────────────────────────────────────
 * Three sub-cards under one named section, matching the Page 2 design language:
 * 조건 (filters + served scope + reference year) → 비교표 (the comparison, with its
 * unit line in the card header) → 산출 방법과 한계. The distinction banner sits above
 * all three because it qualifies every one of them.
 *
 * ── Placement ──────────────────────────────────────────────────────────────────
 * Rendered by `LandfillDashboard` as the LAST region of 매립지 현황, outside the
 * official-data branch: the two datasets fail independently, so an official 404
 * must not take this section down with it, and vice versa.
 */

import type {
  MunicipalCostResponse,
  MunicipalCostSido,
  MunicipalCostSort,
  MunicipalCostStatus,
} from "../../lib/api";
import type { MunicipalCostErrorState } from "../../lib/municipalCost";
import SectionCard from "../ui/SectionCard";
import MunicipalCostFilters from "./MunicipalCostFilters";
import MunicipalCostMethodology from "./MunicipalCostMethodology";
import {
  MunicipalCostError,
  MunicipalCostLoading,
  MunicipalCostNoMatch,
} from "./MunicipalCostStates";
import MunicipalCostTable from "./MunicipalCostTable";
import {
  MUNICIPAL_COST_DISTINCTION_NOTE,
  MUNICIPAL_COST_DISTINCTION_TITLE,
  MUNICIPAL_COST_SECTION_DESCRIPTION,
  MUNICIPAL_COST_SECTION_TITLE,
} from "./municipalCostShared";

export interface MunicipalCostSectionProps {
  /** The served response, or null while loading / after a failure. */
  data: MunicipalCostResponse | null;
  /** A genuine request failure. Never used for a municipality's own missing value. */
  error: MunicipalCostErrorState | null;
  sido: MunicipalCostSido | null;
  setSido: (value: MunicipalCostSido | null) => void;
  status: MunicipalCostStatus | null;
  setStatus: (value: MunicipalCostStatus | null) => void;
  sort: MunicipalCostSort;
  setSort: (value: MunicipalCostSort) => void;
}

export default function MunicipalCostSection({
  data,
  error,
  sido,
  setSido,
  status,
  setStatus,
  sort,
  setSort,
}: MunicipalCostSectionProps) {
  const meta = data?.meta ?? null;
  const rows = data?.municipalities ?? null;
  return (
    <SectionCard
      title={MUNICIPAL_COST_SECTION_TITLE}
      description={MUNICIPAL_COST_SECTION_DESCRIPTION}
      testId="municipal-cost-section"
    >
      <div className="flex flex-col gap-3">
        {/* A compact note, not a coloured panel. It carries the SAME two statements
            it always did — the served difference sentence verbatim, then what the
            indicator positively is — and it still sits above everything it
            qualifies, visible without expanding anything and with no role="alert"
            (a permanent caveat that interrupts a screen reader on every render
            stops being read). The left rule keeps it visually attached to the
            section without claiming the emphasis of an alert. */}
        <div
          className="border-l-2 border-hairline-strong pl-3 text-xs leading-relaxed text-ink-subtle"
          data-testid="municipal-cost-distinction"
        >
          <p className="font-medium text-ink-muted">{MUNICIPAL_COST_DISTINCTION_TITLE}</p>
          {/* Served verbatim. Paraphrasing the backend's own statement of the
              difference is exactly what Step 2 §9 rule 1 forbids. */}
          <p className="mt-0.5" data-testid="municipal-cost-distinction-served">
            {meta?.difference_from_official_landfill_fee ??
              "이 자료는 수도권매립지 공식 반입수수료와 다른 회계 기준의 지자체 계약 지급액입니다."}
          </p>
          <p className="mt-0.5">{MUNICIPAL_COST_DISTINCTION_NOTE}</p>
        </div>

        <MunicipalCostFilters
          sido={sido}
          setSido={setSido}
          status={status}
          setStatus={setStatus}
          sort={sort}
          setSort={setSort}
          meta={meta}
          returnedCount={rows?.length ?? null}
        />

        {/* A genuine failure the reader can retry — the only role="alert" here. */}
        {error && <MunicipalCostError state={error} />}

        {data === null && error === null && <MunicipalCostLoading />}

        {rows !== null && rows.length === 0 && <MunicipalCostNoMatch />}

        {rows !== null && rows.length > 0 && (
          <>
            {/* Announced when a filter change replaces the comparison. It sits
                OUTSIDE every disclosure: a collapsed <details> is hidden from the
                accessibility tree and must not be the only home for a live region. */}
            <p role="status" className="sr-only" data-testid="municipal-cost-live">
              시·군·구별 수집·운반 계약 지급액 {rows.length}곳을 표시합니다.
            </p>
            <MunicipalCostTable rows={rows} />
          </>
        )}

        {meta && <MunicipalCostMethodology meta={meta} />}
      </div>
    </SectionCard>
  );
}
