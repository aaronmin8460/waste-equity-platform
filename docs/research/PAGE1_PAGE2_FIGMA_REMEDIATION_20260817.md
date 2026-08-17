# Page 1 / Page 2 — Figma fidelity remediation (2026-08-17)

## 1. Branch

`fix/frontend-page1-page2-figma-remediation-20260817`

## 2. Base SHA

`be93abb8ed61fabb7997f64a07f95d5ab356530c` — `origin/integration/frontend-fidelity-20260817`, verified with
`git rev-parse` before any edit. The branch and its worktree did not previously exist, so nothing was reset,
cleaned, stashed, or overwritten.

## 3. Final SHA

See `git log -1` on the branch (recorded in the lane summary; the push target is
`origin/fix/frontend-page1-page2-figma-remediation-20260817`).

## 4. Figma MCP connection status

**AVAILABLE AND USED.** Not a fallback and not a reconstruction from memory.

- `whoami` → authenticated.
- `get_metadata` returned the full node tree for both target frames.
- `get_screenshot` returned rendered PNGs of both frames, which were downloaded and inspected at full size.

File `hETmPv3N31IJeW8XdLwoiS` (UI-UX).

## 5. Page 1 Figma frame inspected

`74:1992` — `1. 지역 지표 (Regional Indicators)`, 1440 × 1782.

Left column: one 지표 선택 card holding all three metric groups, then 지표 순위, 지역 선택, 선택한 지역,
공유 및 내보내기. Map fills the remainder, flush to the header at y=79. Overlays: 인구 범례 - 7분위 and
폐기물 처리시설.

## 6. Page 2 Figma frame inspected

`125:5064` — `2. 지역별 폐기물 처리 현황`, 1440 × 2113. Content width 1400, gutter 20.

| y (abs) | h | block |
|---|---|---|
| 99 | 139 | 조회 조건 — 20px title + 4 controls in one row, each 315×60 |
| 254 | 356 | KPI row — 3 × 261 + 561, gap 20 |
| 626 | 517 | 발생·처리 비교 (760) ‖ 반입 구조 (624) |
| 1159 | 460 | 반입 폐기물 구성 (628) ‖ 월별 반입 추이 |
| 1635 | 381 | 지역별 상세 현황 — 2-level grouped header, 3 expandable rows |
| 2032 | ~60 | 공유 및 내보내기 |

The frame carries **no page title and no subtitle**: the body opens on the 조회 조건 card.

## 7. Page 1 — exact copy removed

All four lines the brief named, removed at source in `frontend/src/lib/metrics.ts`:

1. `선택 지역의 총 인구를 확인합니다.`
2. `생활(가정) 폐기물. 사업장 비배출시설계는 아래에서 따로 봅니다.`
3. `선택 지역 내 시설의 처리량`
4. `선택 지역 5km 이내 시설의 처리량`

Verified absent from the live 1440×900 render and from the DOM text dump.

**A deliberate, user-directed divergence from Figma.** The Figma frame *does contain* lines 1, 3 and 4
(nodes `123:344`, `123:404`, `123:421`). The brief orders them removed, and an explicit instruction outranks
the frame's copy. Line 2 is the opposite case: Figma carries the short `생활 + 비배출계` where the
implementation carried the long sentence, so removing it moved the page *toward* Figma.

Nothing else was lost. The distinctions those sentences spelled out (생활계 vs 비배출시설계, 소재 시설 vs
인근 5km) are carried by the row labels standing beside each other, and the test now asserts them as
selectable radios rather than as prose.

## 8. Page 1 — structural changes

None beyond the copy removal. The panel structure already matched the frame (one 지표 선택 card holding all
three groups, then ranking / region picker / selection / export), so no restructuring was warranted. Density
improved as a direct consequence of the removals: the metric list lost six lines of helper prose.

## 9. Page 2 — old vs new structure

| Block | Before | After | Figma |
|---|---|---|---|
| h1 + subtitle | 48px, both visible | h1 kept compact, subtitle removed (sr-only) | absent |
| 조회 조건 | 176px, incl. a `현재 선택` echo strip | 172px, echo removed, served outcome kept | 139px |
| KPI row | 4 plain white cards, 302px, 291/291/291/466 | navy hero + 3, 381px, **260/260/260/559** | 356px, 261/261/261/561 |
| 기준 기간 strip | visible line above the row | sr-only (period is stated by 조회 조건) | absent |
| 계약 지급액 summary | separate 132px card below the row | right-hand **column of the cost card** | inside card 4 |
| Row 2 / Row 3 / table | present, Figma order | unchanged order | same |
| 시·군·구 계약 지급액 section | **4349px**, 59% of the page | **916px**, table behind a disclosure | absent |
| **Page height** | **7324px** | **3775px** | 2113px body |

## 10. Page 2 — KPI changes

- Card 1 `총 폐기물 발생량` is now the **filled navy hero** with the row's single `text-3xl` value, matching
  the frame. The one-hero rule is preserved — the row has exactly one dominant value — but *which* card holds
  it moved from 반입량 to 발생량, per the frame.
- Cards share one skeleton (label + badge → value → change pill → rule → bottom slot pinned with `mt-auto`),
  which is what removes the "content at the top of a stretched box" emptiness of the old row.
- Card 4 `폐기물 관리비용` is one surface with two columns — official inbound fee and municipal
  collection/transport payment — with `시·군·구별 상세 보기 →` inside it, as the frame draws it.
- An unavailable derived total never takes the hero fill: emphasis is for a number, not for an absence.
- The hero's provenance chip carries `data-status="derived"`, so the fill is a tone change and not a downgrade
  in what the card declares.

## 11. Page 2 — chart changes

- **월별 반입 추이 converted from a BAR chart to a LINE chart**, as the frame specifies: a `polyline` over the
  served points, one marker per served month, dashed leaders and on-chart 최고/최저 annotations. A month with
  no record still gets no marker — a gap stays a gap.
- **Scatter** gained axis tick labels, horizontal gridlines and the frame's four quadrant callouts. Tick labels
  are rounded whole numbers; that rounding is confined to the ruler (`aria-hidden`, derived from the axis
  maximum) and no region's figure is ever read from it.
- 반입 구조 and 반입 폐기물 구성 were already close to the frame and were left alone.

## 12. Page 2 — table changes

Geometry, grouped header, expandable metropolitan rows, sort control and 엑셀 다운로드 are unchanged — they
already matched the frame. The 엑셀 scope footnote was shortened; the grain footnote and the served contract
distinction are unchanged and still verbatim.

## 13. Page 2 — copy removed

- the page subtitle `수도권매립지 반입량과 지역별 흐름을 확인합니다.` (visible → sr-only);
- the `현재 선택` label and the four-value echo under the filters;
- the `수도권매립지 기준 기간: …` strip above the KPI row (visible → sr-only);
- one clause of the 엑셀 scope footnote.

**Deliberately NOT removed** — each is load-bearing and several are the reason the earlier over-trim was
reverted mid-pass: `FEE_CAVEAT`, `POPULATION_BASIS_NOTE`, the per-capita served caveat, both per-capita
reference periods, the partial-year warning, `CROSS_BASIS_NOTICE`, the grain footnote, and the served
contract-vs-fee distinction.

## 14. Page 1 — Figma mismatches remaining

| Item | Class | Note |
|---|---|---|
| Group/row helper prose absent where Figma shows it | A→**user-directed** | §7 |
| 4 waste rows vs Figma's 3 | **B** | 사업장 is two official series (비배출/배출시설계) |
| 6 facility glyphs vs Figma's 5 | **B** | six-category product contract |
| Ranking shows Top 10 of 79 vs Figma's 6 of 32 | **B** | real data + compact-max-10 contract |
| Ranking card titled 지역 순위, Figma 지표 순위 | A (not taken) | the list ranks regions; renaming would be less accurate |
| Legend title split over two lines | A (cosmetic, not taken) | |

## 15. Page 2 — Pass-1 mismatches

17 recorded (full table in `/Volumes/WASTE_QA2/reports/page1-page2-figma-remediation-state.md` §6): page
title/subtitle, the `현재 선택` strip, the stray period line, no hero card, dead space in cards 1–3, paragraph
captions, the split cost card, an axis-less scatter, a bar chart where the frame draws a line, the short
반입 구조 card, three table footnotes, the orphan 근거와 한계 block, and the 4349px municipal section.

## 16. Pass-1 fixes

Subtitle → sr-only; `현재 선택` echo removed; period strip → sr-only; navy hero introduced; card skeleton with
pinned foot; municipal summary folded into card 4; municipal comparison table put behind a disclosure; bar
chart converted to a line chart; footnotes trimmed. Page height 7324 → 3646; KPI widths → 260/260/260/559.

## 17. Page 2 — Pass-2 mismatches

1. `톤당 환산 수수료` / `주민 1인당 환산 반입수수료` truncating to `톤당 환…` / `주민 1인…`.
2. Scatter still had no tick labels or quadrant callouts.
3. Restoring the integrity provenance pushed the KPI row to 409px, over the frame's 356.
4. Tick labels, once added, printed raw floats (`2,824.105692`) and collided with the axis title.

## 18. Pass-2 fixes

Labels wrap instead of truncating and badges moved back beside them (which also keeps an unavailable `<dd>`
reading as exactly its served reason); axis ticks, gridlines and quadrant callouts added; tick labels rounded
and the y gutter widened 46 → 62; the cost card's contract column narrowed 17rem → 15rem and the provenance
leading tightened, bringing the row to 381px.

## 19. Page 2 — Pass-3 result

Final at 1440×900: page 3775px (was 7324). KPI row 335→716 with cards 260/260/260/559 against the frame's
261/261/261/561. Row 2 begins at 757 against the frame's 626. No substantial avoidable mismatch remains; what
remains is listed in §20–21 and §27.

## 20. Analytical differences from Figma (Class C)

1. **`발생량 대비 처리 규모 75.9%` — NOT implemented.** Divides origin-based generation by
   facility-location-based throughput. The served facility envelope forbids the combination in its own
   `assumptions`. No valid same-basis ratio exists for that card, so its bottom slot carries the coverage
   statement instead of a percentage.
2. **`발생량 대비 반입 비율 39.4%` — NOT implemented**, same reason. The frame's percentage + progress-bar slot
   on that card is instead filled with the **largest origin's share of the inbound total** (경기도 45.6%) —
   served, and numerator and denominator are the same series on the same basis.
3. **No `총 지급액 (합계)` in the cost card**, where the frame shows 5,812.6 억원. Only a subset of the 66
   기초지자체 disclosed an amount, so a "합계" would be a partial sum wearing a complete label. No 톤당 지급액
   either: the only tonnage on the screen is landfill inbound at 시·도 grain.
4. **No `2024 → 2025` comparison on card 1.** The platform does not fetch a prior-year RCIS sum; the frame's
   comparison is mock content.
5. **Per-card periods, not one row period.** The RCIS and facility series are annual and a year behind the
   monthly landfill series; the frame puts one year on all four cards.
6. `CROSS_BASIS_NOTICE` is retained under the row although the frame has no such line.

## 21. Accessibility differences from Figma (Class D)

1. **The `<h1>` is kept** although the frame has no page title — a view without a heading would break the rule
   that the visible title equals the navigation destination name (YEOGIDA_UI_REDESIGN_SPEC §2.2).
2. The removed subtitle and period strip are `sr-only`, not deleted, so assistive tech still gets them.
3. The sr-only `핵심 지표` heading is retained so the KPI region stays enumerable and named.
4. Scatter points remain real buttons; chart markers stay decorative with transparent full-height hit targets
   carrying the accessible names.
5. The municipal disclosure keeps its filters, scope, counts, reference year and methodology **outside** the
   `<details>`, and the `role="status"` live region is never inside a collapsed disclosure.

## 22. Tests

`npx vitest run --maxWorkers=2` → **88 files passed, 1 skipped; 2163 tests passed, 7 skipped, 0 failed.**

Tests updated to the surviving contract (never weakened):
- `page.equityDashboard.test.tsx` — the removed Page-1 prose is now asserted absent, and the distinctions it
  carried are asserted as selectable radios.
- `LandfillDashboard.test.tsx` — the filter strip asserts the served outcome and no echo; the hero test asserts
  that an uncomputable total never takes the hero treatment; the trend test asserts line points and that the
  polyline has exactly one vertex per served month; the municipal summary is asserted as a labelled column with
  its link rather than as a tenth `<h2>`.
- `LandfillHeadlineResults.test.tsx` — two tests ADDED for the Figma emphasis hierarchy and for the hero's
  machine-identifiable provenance.

Mid-pass, four failures correctly caught an over-trim: `FEE_CAVEAT`, `POPULATION_BASIS_NOTE`, the per-capita
reference periods and the partial-year warning had been moved to a tooltip or dropped. All were **restored to
visible text** rather than having their assertions relaxed.

A full run at `--maxWorkers=2` once showed 7 failures in Page-4/Page-5 files with 5–10s durations; all 7 pass
in isolation at `--maxWorkers=1`. Known worker-contention timeout flakes, not regressions.

## 23. Typecheck

`npm run typecheck` → clean.

## 24. Lint

`npm run lint` → 0 errors. One pre-existing warning in `page.phase0.test.tsx` (unused
`SUITABILITY_SCREENING_DISCLAIMER`), present on the base and untouched by this lane.

## 25. Production build

`npm run build` → compiled successfully in 21.8s, TypeScript clean, 4/4 static pages generated.

## 26. Browser validation

Rendered against a **real local backend** — the existing `waste-equity-platform-backend:latest` image run
read-only (uvicorn only, **alembic deliberately not run**) against the running dev database at alembic `0021`.
Every figure in the captures is served data. Verified at **1440×900** and at the **1024×768** desktop floor,
Page 1 and Page 2, full-page and in bands. At 1024 the KPI row reflows to 2×2 (474px cards) with no horizontal
overflow.

Environment notes worth carrying forward:
- Next 16 defaults to **Turbopack**, which never becomes ready on this volume — `next dev --webpack` is
  required (`next build` with Turbopack is fine).
- Next 16 blocks cross-origin dev requests: the browser must use **`http://localhost:3100`**, not `127.0.0.1`,
  or the app hangs on the loading gate having issued only `/health`.
- The in-app browser pane serves **stale screenshot frames** after JS-driven scrolling; a ~900px "whitespace
  band" it reported was an artifact, disproved by `elementFromPoint`. Playwright captures are the reliable path.
- Port 3000 belongs to another lane; this lane ran on 3100 with its own backend container's CORS widened.

## 27. Remaining limitations

- **Page height is 3775px against the frame's 2113px body (Class C/E).** The excess is the integrity apparatus
  the frame does not carry: `근거와 한계` (298px), the municipal section even collapsed (916px), the export card,
  and the per-card provenance. Removing any of it would trade a documented caveat for pixels.
- **KPI row 381px vs the frame's 356px (Class C)**, for the same reason — the frame's cards carry a delta and a
  ratio where these carry served provenance.
- **Cards 1–3 still have visible slack** between the change pill and the pinned foot. The frame fills that space
  with the two ratios §20 forbids; card 2 has no valid same-basis substitute.
- **The scatter labels only the selected point**, where the frame shows several statically labelled regions.
  Those are mock annotations; labelling by interaction avoids asserting that five particular regions matter.
- **Row 2's two cards are unequal** (scatter ~606, 반입 구조 ~340) where the frame pairs 517/517.
- Composition legend categories are the real served ones, not the frame's mock four.
- The Page-1 ranking card title stays 지역 순위 (frame: 지표 순위).

## 28. Backend untouched — confirmed

`git diff --name-only` matches no path under `backend/`, `ingestion/`, or `infra/`. No migration was created,
edited, or run **by this lane**: the rendering backend was started with an explicit `uvicorn` command that
overrode the image's default, so `alembic upgrade head` never executed, and the container was removed at the
end of the lane.

One correction, recorded because it would otherwise read as this lane's doing: the shared local dev database
was at alembic `0021` when the lane started and reported `0023` when it finished. That change is **not** from
here. `0022` (`suitability_component_model_identity`) and `0023` (`suitability_candidate_component_scores`)
are the Suitability V3 backend lanes' migrations, dated 2026-08-16, and neither file exists on this branch —
this worktree's `backend/alembic/versions/` still tops out at `0021`. A concurrent backend lane on the same
machine migrated the shared database. No production database was involved at any point.

`package.json` and `package-lock.json` are untouched.
Pages 3–6 have no source changes; the only shared file touched is `lib/metrics.ts`, whose edit is confined to
Page-1 metric descriptions, and the full suite covering every page is green.

## 29. No production deploy — confirmed

Nothing was deployed. No OCI or AWS host was contacted, no `deploy.sh` was invoked, no image was built or
pushed, and no production database was reached. The only container started was a local read-only backend on
this machine, and the only branch pushed is
`origin/fix/frontend-page1-page2-figma-remediation-20260817`. `main` was not merged.
