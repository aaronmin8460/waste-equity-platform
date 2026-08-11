# Phase 1 — global navigation + Page 1 (지역 지표)

Two targets: the shared header/navigation, and the body of `?v=1&mode=equity`. Pages
2–6 keep their current bodies; only the header changes there, because
`ui/TopNavigation` is shared.

Branch `feat/figma-six-page-redesign`, worktree
`/Users/byeongilmin/dev/waste-equity-platform-figma`. Nothing was deployed.

Figma: file `hETmPv3N31IJeW8XdLwoiS`, page **design**, frame **74:1992** (`page-1`,
1440×1753), its modal **74:3250**, and the annotation frame **221:2872**
(`page-1 기술요청`).

## 1. What the annotation asked for, and where each item landed

`221:2872` is the client's written request beside the frame. Every line is
implemented; three of them needed a decision, recorded here.

| Annotation | Where it landed |
|---|---|
| 좌측 패널 순서 조정: 지역 선택 > 선택한 지역 | Aside reordered — §3 |
| 폐기물 처리시설 버튼 위치 수정 및 신규 아이콘 삽입 | Moved onto the map as its own card — §5 |
| 지도에서 지역 선택 시, 폐기물 발생량과 매립장 정보 한번에 뜨도록 수정 | One combined popup — §6 |
| 상단 메뉴창 [데이터/출처] 앞에 세로선 bar 삽입 | `.wep-nav-divider` — §2 |
| 가능하면 아이콘 변경 | All seven are now the exact Figma vectors — §2 |
| [값이 높은·낮은 지역]을 [지역 순위]로 명칭 변경 | Renamed — but see §8.1 |
| [지표 출처], [해석주의출처보기], [내륙습지목록] tap 삭제 | Relocated, not deleted — §7 |

## 2. Global header (commit `7cdb8f4`)

All seven hand-drawn `<path>` glyphs are gone, replaced by the Phase 0 exports through
`ui/FigmaIcon`: `logo-target-01` for the brand, and one vector per destination. The
mapping is the one Phase 0 read from layer visibility inside each Figma `Nav Button`
instance, not one inferred from the labels. Nothing was substituted from Lucide, Font
Awesome, Heroicons, Material, an emoji, a Unicode glyph, or the unrelated kit on the
file's `back up` page.

**The active state changed idiom because the design did.** It was a 2px bottom
indicator on a full-bleed tab; frame `74:2000` is a rounded 907×50 track holding 38px
pill tabs with the active one filled white. The obsolete indicator is removed rather
than kept beside the pill.

Measured at 1440×900 against the frame:

| Element | Figma | Built |
|---|---|---|
| Header | 1440×78 (+1px divider) | 1440×79 |
| Brandmark | 194×45 @(28,16) | 196×45 @(28,17) |
| Logo | 42×42 @(28,18) | 42×42 @(28,18) |
| Nav track | 907×50 @(505,14), r999 | 910×50 @(502,14), r999 |
| Active tab | 118×38 @(511,20), r40 | 118×38 @(508,20), r40 |
| Rule before 데이터·출처 | 1×20 @(1266,29) | 1×20 @(1266,29) |

The few px of drift are Korean text metrics, not layout.

## 3. Page 1 column order

Figma frame `74:2010`, confirmed in the browser at 1440×900 (all cards 320px wide):

```
지표 선택  →  지역 순위  →  지역 선택  →  선택한 지역  →  공유 및 내보내기
```

Previously: 지역 조회 → 지표 선택 → 선택한 지역 → 값이 높은·낮은 지역 → 공유 → 출처와
계산 방법 → 시설 위치 표시.

The aside takes Figma's 20px padding and 16px gap through a desktop-only `className`
passed from the equity branch, NOT by changing `ui/ResizableSidebar` — that component
is also the 후보지 심층 분석 / 비교 column, and those pages have not been redesigned.

## 4. What each card kept

Nothing analytical moved. `lib/metrics.ts`, `lib/ranking.ts`, `lib/urlState.ts`, every
API call, and the choropleth palette are untouched.

- **지표 선택** — the same eleven served metrics, three `<fieldset>`s (an asserted
  contract), one `name="metric"` radio group, and the 총량/1인당 switch inside the
  active row. Figma shows 사업장 폐기물 발생량 as ONE row; production serves two
  distinct official series (배출시설계 / 비배출시설계) and both are kept, because
  merging them would either hide a served metric or invent a combined one.
- **지역 순위** — `rankRegions` is unchanged. The card now shows ONE list with a
  ↑/↓ direction toggle instead of two side-by-side columns; the toggle selects between
  the `high` and `low` lists that function ALREADY returns. No comparator, tie-break,
  exclusion rule, or rank numbering changed. The list keeps `rank-high` / `rank-low`
  as its test id for the end it is showing.
- **표시 개수 (top-N) is kept** although the frame has no such control: it is working
  behaviour, and the design's own 전체보기 is the escape from the cut rather than a
  replacement for choosing it.
- **지역 선택** — still a native `<select>` with the contracted accessible name. The
  `<label>` is now visually hidden because it would otherwise repeat the card heading
  verbatim.
- **선택한 지역** — same live region, same test ids, same "a missing value shows its
  served reason, never a 0" rule.
- **공유 및 내보내기** — 링크 복사 / 순위 CSV / 보고서 보기 all preserved, restyled to
  the design's three-button row.

## 5. Facility layer + type legend (`EquityFacilityLayerCard`)

The Chrome audit found facility markers colour-coded with no legend anywhere. The new
card carries the toggle AND the type legend, and reads the same
`FACILITY_CATEGORY_LABELS` / `FACILITY_CATEGORY_COLORS` constants the MapLibre circle
layer paints from, so a swatch cannot drift from the dot it explains.

Two deliberate departures from the frame's legend, both to keep it truthful:

- Figma paints all three 공공 rows one green and both 민간 rows one pink, and omits
  민간 최종처분 entirely. Production distinguishes SIX categories by six colours on the
  map. Adopting the two-colour scheme would make the legend disagree with the marks it
  explains; dropping a category would hide facilities that are drawn. All six are
  listed, in their real colours.
- Figma's swatch carries a white Korean initial (소 / 매 / 기 / 재). The map draws plain
  4.5px circles with no glyph, and enlarging every marker enough to hold a character
  would bury the choropleth under several hundred labelled discs. The swatch is a plain
  dot, exactly like the mark.

Colour is never the only signal: every row names its category, and the popup a marker
opens names the category in words too.

## 6. The facility click-through defect — fixed

**Symptom.** A facility marker is drawn on top of the region fill, so one click
reached BOTH layer handlers: the facility opened its popup, the region opened a second
one over it, and the region selection changed even though the reader had aimed at a
4.5px dot.

**Cause.** Two `map.on("click", "<layer>", …)` bindings. MapLibre delivers a click to
every layer under the pointer, and there is no propagation to stop between layer
handlers.

**Fix.** One map-level handler that queries the layers in priority order and acts on
the winner: facility → wetland → region. Hidden layers drop out automatically, because
`queryRenderedFeatures` returns nothing for a layer whose visibility is `none`.

- Clicking a marker opens ONE popup carrying the region's active-metric value AND the
  facility's details — exactly the combined popup frame `223:449` specifies and the
  annotation asks for — and does NOT change the selected region.
- Clicking a region still selects it and opens the region popup with no facility block.
- A wetland click is left to the wetland handler alone, which was the same defect class.

Regression coverage: four tests in `MapView.test.tsx` under "a facility marker does not
fall through to the region beneath it", asserting no region selection, exactly one
popup constructed, both halves of its content, and that a deliberate region click still
selects.

## 7. Analytical-integrity content the annotation asked to remove

The annotation deletes three entries from the panel. None is deleted; each moved to
where its subject is, as a progressive disclosure:

| Entry | New home |
|---|---|
| 지표 출처 (출처와 계산 방법: derivation, numerator/denominator sources, boundaries, caveat) | A closed `<details>` at the foot of the 선택한 지역 card — the card whose value it justifies |
| 해석·주의·출처 보기 | Unchanged: still the collapsed insight overlay at the map's bottom-right |
| 내륙습지 목록 | Unchanged: still the collapsed layer control at the map's top-left, off by default |

Deleting the first would have taken the derivation method, the source registry entries,
the boundary provenance, and the metric caveat with it — everything a displayed value
needs to be justifiable.

## 8. Discrepancies and deliberate differences

### 8.1 The Figma file disagrees with itself on the ranking label

The rendered frame labels the card **지표 순위** (`74:2025`) and its modal **지표 순위
전체보기** (`74:3253`). The `page-1 기술요청` annotation beside it asks in writing for
"[값이 높은·낮은 지역]을 **지역 순위**로 명칭 변경".

**지역 순위 is used**, because the annotation is the written instruction, it agrees
with the section's long-standing `aria-label`, and it is the accurate description — the
card ranks REGIONS by the selected indicator, it does not rank indicators. This is a
change to two constants (`RANKING_SECTION_LABEL`, `RANKING_FULL_VIEW_LABEL` in
`lib/ranking.ts`) and nothing else if the frame's wording is preferred.

### 8.2 Figma values NOT adopted, and why

| Figma | Kept instead | Reason |
|---|---|---|
| Brand subtitle `#848A95` @11px | `--color-ink-subtle` | 3.47:1 — under the 4.5:1 the palette is held to |
| Select field border `1.5px #F9F9F9` | `--color-hairline-strong` | 1.02:1 on white: no visible control boundary (WCAG 1.4.11 wants 3:1) |
| Popup provenance @9px | 11px | 9px is below a usable reading size; the popup has room |
| Active nav pill, no shadow | + `0 1px 2px` | White on the #F9F9F9 track is a ~1.02:1 edge; the shadow restores the boundary without changing a colour, radius, or metric |
| 사업장 폐기물 발생량 as one row | Two rows | Two distinct official series — §4 |
| Facility legend: 2 colours, 5 rows | 6 colours, 6 rows | Must match the marks the map paints — §5 |
| Rank-row decorative bullets | Omitted | They are absolutely positioned BEHIND the rank number in the frame, and the modal's cycle through four colours implies a category that does not exist |

### 8.3 Layout differences

- **Sidebar 360 + a 10px drag handle + map 1070**, against Figma's 360 / 1080. The
  handle is existing keyboard-operable functionality (`equitySidebarResize.spec.ts`);
  Figma does not draw it.
- **The 지표 선택 card is ~758px tall against Figma's 678** — production has four waste
  rows to Figma's three, and both facility rows carry a description.
- **지역 선택 is now below the fold** at every supported height, a consequence of the
  design's order. It stays reachable by scrolling the column, and the map and the
  ranking rows are two other ways to make the same selection.

## 9. Responsive

Figma is a single 1440px desktop frame. The existing responsive rules are preserved:

- Header: the Figma metrics apply from **1280px up**, which is where they fit (brand
  194 + nav 907 + 2×28 = 1157). Below that the same SHAPE is kept — pill track, pill
  active tab — at compact metrics, so no width gets a different active-state idiom.
- The nav track still scrolls horizontally rather than the page, and the tab keeps its
  44px touch target below 1280; Figma's 38px applies only where the pointer is the input.
- Every navigation item stays reachable at every width. No hamburger was introduced.
- The map overlay stack (legend + facility card + insight) is bounded at BOTH ends, so
  at a short viewport the cards shrink and scroll internally instead of growing off the
  top of the map over the environmental-layer controls.

## 10. Two bugs fixed beyond the brief

1. **Facility click-through** — §6, the one the audit reported.
2. **The page gained a vertical scrollbar.** `sr-only` is `position: absolute`, and
   `overflow` only clips descendants whose containing-block chain passes through the
   scroller. The `<aside>` was `position: static`, so an `sr-only` label resolved
   against the initial containing block instead, escaped `md:overflow-y-auto`, and
   extended the DOCUMENT's scroll height to its own static position (1295px at
   1440×900) — breaking the fixed-height map shell. Page 1 surfaced it because the
   지역 선택 label now sits ~1300px down the column, but any visually-hidden text low in
   that column would have done the same. Fixed by making the aside a containing block.

## 11. Verification

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | 1344 passed / 7 skipped (baseline 1337/7; +7 new tests, no failures) |
| six-mode e2e (`figmaPhase0Baseline`) | 9/9 |
| Page 1 + shell e2e sweep | green — see §12 |
| Visual comparison at 1440×900 vs frame 74:1992 | performed; §2 and §3 record the measurements |

Backend untouched: the diff is `frontend/` and `docs/` only.

## 12. e2e assertions updated (never deleted)

Six assertions encoded the OLD visual structure. Each was rewritten to keep its
original intent under the new design:

| Spec | Was | Now |
|---|---|---|
| `civicShell` | app bar 56–72px | ≤80 (Figma is 78) + the tab is vertically centred rather than flush with the bar's bottom border |
| `desktopNavigation` | nav height < one button × 1.8 | the TRACK's height < one button × 1.8 |
| `desktopNavigation` | active tab has a ≥2px bottom indicator | active tab has a filled pill, a shadow, and a heavier weight |
| `correctionPass` | `region-select` sits under the app bar | `equity-metric-selector` does (the design's first control) |
| `correctionPass` | trigger reads 지표 순위 전체보기 | reads 전체보기 ↗ |
| `equityDashboard` | `region-select` above the fold | `equity-metric-selector` above the fold; `region-select` attached |
