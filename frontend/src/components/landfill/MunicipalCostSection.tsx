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

import { useRef, useState } from "react";

import type {
  MunicipalCostResponse,
  MunicipalCostSido,
  MunicipalCostSort,
  MunicipalCostStatus,
} from "../../lib/api";
import type { MunicipalCostErrorState } from "../../lib/municipalCost";
import SectionCard from "../ui/SectionCard";
import MunicipalCostDetailDialog from "./MunicipalCostDetailDialog";
import MunicipalCostFilters from "./MunicipalCostFilters";
import MunicipalCostMethodology from "./MunicipalCostMethodology";
import {
  MunicipalCostError,
  MunicipalCostLoading,
  MunicipalCostNoMatch,
} from "./MunicipalCostStates";
import MunicipalCostTable from "./MunicipalCostTable";
import {
  MUNICIPAL_COST_DETAIL_TARGET_ID,
  MUNICIPAL_COST_DISTINCTION_NOTE,
  MUNICIPAL_COST_DISTINCTION_TITLE,
  MUNICIPAL_COST_SECTION_DESCRIPTION,
  MUNICIPAL_COST_SECTION_TITLE,
} from "./municipalCostShared";
import { PAGE2_CARD_CLASS } from "./shared";

export interface MunicipalCostSectionProps {
  /** The served response, or null while loading / after a failure. */
  data: MunicipalCostResponse | null;
  /**
   * The UNFILTERED served response — the whole published capital-region scope.
   *
   * The 시·군·구별 상세 popup describes the PUBLISHED dataset, not this section's
   * current selection, so it reads from here and never from `data` above. The two
   * must stay separate props: `data` is scoped by the three controls below (whose
   * released default is 서울 + 계산 가능, i.e. 13 of the 66 municipalities), and a
   * popup opened from the KPI card — which advertises the capital-region scope — must
   * not silently inherit a filter the reader set on a different surface 1,500px down
   * the page. Handing one response to both is exactly the defect this prop closes.
   *
   * Optional, and falls back to `data`, so the component still works standalone (its
   * own tests render it directly) and so the popup is never empty in the window
   * before the unfiltered request resolves.
   */
  dataAll?: MunicipalCostResponse | null;
  /** A genuine request failure. Never used for a municipality's own missing value. */
  error: MunicipalCostErrorState | null;
  sido: MunicipalCostSido | null;
  setSido: (value: MunicipalCostSido | null) => void;
  status: MunicipalCostStatus | null;
  setStatus: (value: MunicipalCostStatus | null) => void;
  sort: MunicipalCostSort;
  setSort: (value: MunicipalCostSort) => void;
  /**
   * The 시·군·구별 상세 modal's open state, CONTROLLED from `LandfillDashboard`.
   *
   * Lifted because three surfaces open the same popup — this section's own button, the
   * KPI row's 폐기물 관리비용 card (기술요청 #8), and a region name in 지역별 상세 현황
   * (기술요청 #21). Three independent copies of the state would let two of them be
   * open at once.
   *
   * Optional so the component still works uncontrolled in isolation (its own tests
   * render it directly).
   */
  detailOpen?: boolean;
  setDetailOpen?: (open: boolean) => void;
  /** A municipality to highlight in the ranking, when opened from a region name. */
  detailFocusRegionCode?: string | null;
}

export default function MunicipalCostSection({
  data,
  dataAll = null,
  error,
  sido,
  setSido,
  status,
  setStatus,
  sort,
  setSort,
  detailOpen,
  setDetailOpen,
  detailFocusRegionCode = null,
}: MunicipalCostSectionProps) {
  const meta = data?.meta ?? null;
  const rows = data?.municipalities ?? null;
  /**
   * Held only to make the heading a programmatic focus target: `SectionCard` gives a
   * heading `tabIndex={-1}` when it is handed a ref, which is what lets the KPI-region
   * `시·군·구별 상세 보기 →` link move FOCUS here and not merely the viewport. Nothing
   * in this component calls `.focus()` — the browser does, on following the anchor.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Local fallback for the uncontrolled case. When the dashboard supplies the pair
  // above, that one wins — see `open` / `setOpen` below. Presentation-only either
  // way: it changes no request and no filter, so the "holds no state" rule above
  // still holds for everything that touches data.
  const [localDetailOpen, setLocalDetailOpen] = useState(false);
  const open = detailOpen ?? localDetailOpen;
  const setOpen = setDetailOpen ?? setLocalDetailOpen;
  return (
    <SectionCard
      title={MUNICIPAL_COST_SECTION_TITLE}
      headingId={MUNICIPAL_COST_DETAIL_TARGET_ID}
      headingRef={headingRef}
      description={MUNICIPAL_COST_SECTION_DESCRIPTION}
      className={PAGE2_CARD_CLASS}
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
            {/* ── 기술요청 #8/#16 — 상세보기 버튼 + 팝업, replacing a <details> ─────
                The frame puts this comparison behind a 상세보기 button and draws the
                popup itself (`327:428`). Inline, the table plus its per-row detail
                rendered ~4,300px — 59% of the whole screen, and roughly twice the
                height of the ENTIRE Figma page-2 frame — directly below 지역별 상세
                현황, which already carries the 2024 계약 지급액 for these same
                municipalities as its own column group.

                Nothing is removed and nothing is summarised away: the filters, the
                served scope, the row count, the reference year and the methodology all
                stay OUTSIDE the modal, so what the dataset covers is still legible
                without opening anything, and the count is on the button.

                The full filterable table is kept below the ranking inside the modal —
                the modal is where the dataset lives now, so its per-row reasons and
                statuses had to travel with it rather than being dropped. */}
            <div>
              <button
                type="button"
                className="wep-btn-outline"
                onClick={() => setOpen(true)}
                data-testid="municipal-cost-detail-open"
              >
                시·군·구별 상세 보기 ({rows.length}곳)
              </button>
            </div>
          </>
        )}

        {meta && <MunicipalCostMethodology meta={meta} />}
      </div>

      {/* Figma `327:428`. Focus handling, Escape, the focus trap and the restore to
          the 상세 보기 button are all the shared `ui/Dialog` primitive's — reused, not
          reimplemented and not modified. */}
      <MunicipalCostDetailDialog
        open={open}
        onClose={() => setOpen(false)}
        /* The UNFILTERED response, which is what this dialog's own prop contract asks
           for. `data` here would scope the popup to the section's 시·도/자료 상태
           selection — with the released 서울 + 계산 가능 default that is 13 rows
           presented under a 수도권 heading. */
        data={dataAll ?? data}
        focusRegionCode={detailFocusRegionCode}
      >
        {/* The transparency table stays the SECTION'S filtered set: it is the one place
            the three controls above are legible as a result rather than as a count, and
            its own disclosure names the scope so the two are never read as one list. */}
        <MunicipalCostTable rows={rows ?? []} />
      </MunicipalCostDetailDialog>
    </SectionCard>
  );
}
