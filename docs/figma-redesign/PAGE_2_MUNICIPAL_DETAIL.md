# Page 2 — municipal detail and the two derived totals

Frame: Figma `125:5064` (1440 × 1870.5, body inset 20 px, content 1400 px).
Surface: `mode=flow` — 폐기물 처리 현황.

This note records what changed on Page 2, why each figure is allowed to be on
screen, and the joins the drill-down depends on. It supplements — and does not
replace — `docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md` (the official
inbound dataset) and `docs/municipal-costs/METHODOLOGY.md` (the contract-payment
dataset).

---

## 1. What changed

| | Before | After |
|---|---|---|
| Standing notices | Two coloured panels (`자료 범위` info + municipal `주의`) above the values | **None.** Every sentence relocated to the surface it governs |
| 총 폐기물 발생량 | `합산 공식값 없음` | **59,638,313 t · 2024** — exact sum of official rows, badged 계산값 |
| 총 시설 처리량 | `합산 공식값 없음` | **6,865,073 t · 2024** — exact sum of official rows, badged 계산값 |
| KPI period | One row-level `기준 기간` for all four cards | Per-card period; the row-level line names 수도권매립지 explicitly |
| 지역별 상세 현황 | 3 metropolitan rows, 4 landfill columns | 3 metropolitan rows expanding to **66 municipalities**, 11 leaf columns across 5 groups |
| 계약 지급액 | Only in the standalone section, 1,500 px below | Also on the municipality rows, as its own column group |
| `핵심 지표` label | Visible `<h2>` | `sr-only` — the region is still named, the line is off the fold |

Nothing was deleted. The relocated sentences are:

- 시·도-grain limitation → `landfill-region-grain-note` (beside the rows) **and**
  `근거와 한계 › 한계와 주의사항`;
- period / "absent is not zero" rule → `근거와 한계 › 한계와 주의사항`
  (`landfill-period-notice`);
- served contract-vs-inbound-fee distinction → the 계약 지급액 column group's
  footnote (`landfill-region-contract-distinction`), verbatim, **plus** the
  compact note that replaced the municipal section's banner.

Retained as banners: request failures (`role="alert"`), loading, empty, and the
served "no official record" panel. Those are transient and actionable.

---

## 2. The two derived totals

No publisher issues a capital-region total for either metric. Both are built in
`frontend/src/lib/capitalRegionWaste.ts` as an **exact** sum of served official
rows (`sumExactDecimals` adds the decimal strings through `BigInt` at a common
scale, so the total carries no floating-point drift), and each is:

- badged `계산값`, never `공식 보고값`;
- captioned with its own reference year and accounting basis;
- captioned with its coverage, including what was excluded.

| | Source | Grain | Period | Basis |
|---|---|---|---|---|
| 총 폐기물 발생량 | `/api/v1/waste-reporting/statistics` (`RegionalWasteStatistics` + the 7 city unions) | 66 reporting regions × 4 streams, 톤/년 | **2024** (annual) | `ORIGIN_BASED_TREATMENT_OUTCOME` |
| 총 시설 처리량 | `/api/v1/equity/facility-burden` | 79 SGIS 시군구, 톤/년 | **2024** (annual) | `FACILITY_LOCATION_BASED_THROUGHPUT` |
| 수도권매립지 반입량 / 반입수수료 | `/api/v1/landfill/summary` | 시·도, monthly | **2025** (latest complete; 2026 runs to 05 only) | `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` |
| 계약 지급액 | `/api/v1/landfill/municipal-costs` | 66 기초지자체 | **2024** (the only published vintage) | `MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT` |

The Figma mock's `2025년 전체 / 2,689,312 t` is a mock value **and** a mock year.
Four datasets, three periods; the cards state their own rather than sharing one.

**Declared coverage.** 3 of the 4 generation streams are 66/66;
`INDUSTRIAL_FACILITY` is 64/66 — 인천 옹진군 and 경기 연천군 are served in
`unavailable_regions` with `SOURCE_NOT_REPORTED` and are excluded from the sum,
not zero-filled. The throughput total excludes 99 facilities the inventory holds
with no region assignment; that under-count is stated on the card.

**The two totals may not be combined.** `CROSS_BASIS_NOTICE` sits under the KPI
row: generation is where waste arose, throughput is what facilities sited in the
region processed. A ratio between them is not a treatment rate, and the served
facility envelope forbids the combination in its own `assumptions`.

---

## 3. The municipal join

66 municipalities: **서울 25 자치구 · 인천 10 군·구 · 경기 31 시·군**. The tier
noun is per-metropolitan and is never generalised to 시·군·구 on a single row.

Two code spaces are in play and only Seoul's digits agree:

```
SGIS analytical   KR-SGIS-11xxx (서울) / 23xxx (인천) / 31xxx (경기)
administrative    11 (서울)        / 28 (인천)      / 41 (경기)
crosswalk         11→11, 28→23, 41→31   (scopeOfLandfillOrigin)
```

The landfill 출발 지역 filter and `municipal_cost.metropolitan_code` speak the
administrative codes; regions, population, waste statistics and facility burden
speak SGIS. Joining on raw digits silently empties 인천 and 경기.

Row-level keys:

| Municipalities | Key |
|---|---|
| 59 direct | `municipal_cost.direct_region_code` == `reporting_region_code` == `facility_burden.region_code` |
| 7 composite Gyeonggi cities (수원·성남·안양·부천·안산·고양·용인) | `direct_region_code` is **null**; joined on the SET of `population_components[].region_code` == the reporting region's `child_region_codes` == the 일반구 rows of facility burden |

Verified against the deployed backend: **0 unmatched records** in either
direction. Population is identical across all four streams of a region, equals
`facility_burden.population` for every native region, and equals the exact sum of
its children for every composite city — so one denominator per municipality is
safe. `buildCapitalRegionWaste` still returns anything unmatched in `unmatched`
rather than dropping it.

---

## 4. Rules the drill-down enforces

1. **계약 지급액 is never summed to a metropolitan total.** Only 46 of 66
   municipalities published an amount, so a metropolitan sum would be a partial
   sum wearing a complete label. The metropolitan row shows a coverage COUNT
   (`n곳 중 m곳 공개 · 합계는 표시하지 않습니다`); the amounts stay on the
   municipality rows.
2. **계약 지급액 is never blended with 반입수수료.** Separate column groups,
   separate headers, separate years, separate units, and the served distinction
   sentence beneath. No cell holds both.
3. **A null payment is never ₩0.** It renders the served status label plus the
   backend's own limitation sentence.
4. **The landfill columns are `시·도 단위 보고` on a municipality row** — not
   `자료 없음`. The value was not measured and withheld; the concept does not
   exist at that grain, and apportioning a sido total down would fabricate the
   municipal origin the source explicitly declines to publish.
5. **A group's per-resident value goes absent if any member's population is.**
   A partial denominator silently inflates the result.
6. **The drill-down joins the UNFILTERED municipal response.** The standalone
   section defaults to `status=AVAILABLE` (38 of 66 rows); joining against that
   would have printed 자료 없음 on every PARTIAL municipality and made 서울 read
   13/25 instead of 17/25. `page.tsx` therefore issues a second, filter-free
   request (`mcAll`) for the table. A filter on one surface must never look like
   an absence on another.

---

## 5. Verified numbers (2024, read-only against the deployed backend)

| scope | units | 발생량 (t/yr) | 처리량 (t/yr) | population | 계약 지급액 공개 |
|---|---|---|---|---|---|
| 서울 | 25 자치구 | 13,979,904.032 | 1,374,690.200 | 9,335,444 | 17 / 25 |
| 인천 | 10 군·구 | 9,548,771.898 | 2,463,858.000 | 3,058,033 | 7 / 10 |
| 경기 | 31 시·군 | 36,109,636.572 | 3,026,525.100 | 13,914,479 | 22 / 31 |
| **수도권** | **66** | **59,638,312.502** | **6,865,073.300** | **26,307,956** | **46 / 66** |

---

## 6. Deliberate differences from the Figma frame

- **The 출발 지역 filter is kept** (the frame shows three controls). It scopes
  every value on the screen, including the two derived totals; deleting it would
  remove the only way to ask a per-origin question.
- **근거와 한계 remains** after 공유 및 내보내기. The frame ends at the export
  row, but with the standing banners gone this disclosure group is the home of
  the provenance, and it is collapsed by default.
- **The standalone 시·군·구 수집·운반 계약 지급액 section remains** below. The
  frame does not contain it, but it owns the dataset's three filters, its
  source-file inventory, its rejected-file list and its methodology — none of
  which belongs in a table cell. Its coloured banner is gone; the table above now
  carries the values themselves.
- **The KPI figures are not sized equally.** The frame sizes all four headline
  numbers the same; 반입량 stays the single hero, because it is what every
  section below decomposes.
