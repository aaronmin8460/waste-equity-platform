# Step 3 — Frontend Implementation Report

Branch: `feature/municipal-waste-costs-frontend` (based on `origin/main` @ `b03ac55`)
Date of the recorded execution: **2026-08-09**
Status: **implemented, validated, and verified against the live local backend.
Not deployed.**

Companion documents: [`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md)
(the API this consumes), [`METHODOLOGY.md`](METHODOLOGY.md) (semantics),
[`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md) (source audit).

Every figure below was measured. Nothing is projected. No backend file, migration,
served value, or methodology was changed by this step.

---

## 1. Placement

The section lives inside the existing **매립지 현황** area (`mode=flow`,
`components/LandfillDashboard.tsx`) as its **last region**, rendered *outside* the
official-landfill data branch.

```text
매립지 현황 workspace
├── PageHeader            수도권매립지 반입 현황
├── 알림 · 자료 범위       InfoBanner tone="info"          (official — unchanged)
├── 조건 선택              4 landfill filters              (official — unchanged)
├── (error | no-data | loading)                            (official — unchanged)
├── when official data:   핵심 지표 / 월별 추이 / 반입 구성 /
│                         지역별 정확한 값 / 근거와 한계    (official — unchanged)
└── 시·군·구별 생활폐기물 수집·운반 계약 지급액 — 2024년   ← NEW, separate <section>
    ├── 주의 banner        the SERVED difference statement, verbatim
    ├── filters           지역 / 자료 상태 / 정렬  + 대상 범위 summary
    ├── (error | loading | empty-filter)
    ├── comparison        table (md+) / card list (< md), 66 rows
    └── 산출 방법과 한계    4 collapsed disclosures
```

Placing it outside the official branch is load-bearing: the two datasets come from
different providers and **fail independently**. A database with no landfill rows
answers the official endpoints with `404 NO_DATA_AVAILABLE`; that must not take this
section down, and a failure here must not blank the official values. Two tests pin
this (`LandfillDashboard.test.tsx`, "still renders when the official landfill
request found no record" / "…failed outright").

There is deliberately **no map**. The Step 2 registry stores no geometry, and the
seven Gyeonggi cities held only as 일반구 have `direct_region_code = null` — drawing
them would mean fabricating city polygons.

---

## 2. Files

### Created

| Path | Purpose |
| --- | --- |
| `frontend/src/lib/municipalCost.ts` | Pure helpers: status vocabulary, money formatting, population provenance, reason pairing, error classification |
| `frontend/src/lib/municipalCost.test.ts` | 14 tests over the above |
| `frontend/src/components/landfill/MunicipalCostSection.tsx` | Section shell, distinction banner, state routing |
| `frontend/src/components/landfill/MunicipalCostFilters.tsx` | 3 native selects + the served scope summary |
| `frontend/src/components/landfill/MunicipalCostTable.tsx` | Desktop table + mobile card list |
| `frontend/src/components/landfill/MunicipalCostRowDetail.tsx` | Per-row progressive disclosure, shared by both forms |
| `frontend/src/components/landfill/MunicipalCostMethodology.tsx` | 4 collapsed methodology disclosures |
| `frontend/src/components/landfill/MunicipalCostStates.tsx` | loading / error / empty-filter states |
| `frontend/src/components/landfill/municipalCostShared.ts` | Fixed product copy |
| `frontend/src/components/landfill/MunicipalCostSection.test.tsx` | 46 tests |
| `docs/municipal-costs/STEP_3_FRONTEND_IMPLEMENTATION.md` | this file |

### Modified

| Path | Change |
| --- | --- |
| `frontend/src/lib/api.ts` | `MunicipalCost*` types + `fetchMunicipalCosts()`. No existing type or fetcher touched. |
| `frontend/src/lib/urlState.ts` | Three whitelisted keys `mcSido` / `mcStatus` / `mcSort`, encoded only in `mode=flow` |
| `frontend/src/app/page.tsx` | Three filter states, one keyed fetch effect, URL mirror + restore, prop wiring |
| `frontend/src/components/LandfillDashboard.tsx` | One required `municipalCost` prop; the section mounted after the official body |
| `frontend/src/app/homeApiMock.ts` | `fetchMunicipalCosts` stub (see §8) |
| `frontend/src/lib/urlState.test.ts` | 3 fields added to 2 existing fixtures; 7 new tests |
| `frontend/src/components/LandfillDashboard.test.tsx` | `municipalCost` added to 2 render sites; 2 counting assertions scoped; 5 new boundary tests |

No backend, ingestion, migration, or deployment file was modified.

---

## 3. API consumed

`GET /api/v1/landfill/municipal-costs` — read-only, exactly as Step 2 implemented it.

| Parameter | Values sent | Default |
| --- | --- | --- |
| `year` | `2024` | always sent |
| `sido` | `11` \| `28` \| `41` | omitted (전체) |
| `status` | `AVAILABLE` \| `PARTIAL` \| `UNAVAILABLE` | omitted (전체) |
| `sort` | `payment_per_capita_desc` \| `total_payment_desc` \| `region_name_asc` | `payment_per_capita_desc` |

**Filtering and ordering are backend operations.** The served array is rendered in
served order and is never re-sorted or re-filtered client-side: the server places
nulls last on both value sorts, so a client re-sort would let an unavailable
municipality be ordered as if it were the cheapest. The indicator is never
recomputed in the browser.

The request is a **separate effect** from the official landfill
`Promise.allSettled` set, for the independence reason in §1.

---

## 4. Filters, sorting, and URL state

| Control | Options (visible Korean) | Sent as |
| --- | --- | --- |
| 지역 | 전체 / 서울 / 인천 / 경기 | `sido` = `""`→omitted, `11`, `28`, `41` |
| 자료 상태 | 전체 / 계산 가능 / 일부 제한 / 자료 없음 | `status` = omitted, `AVAILABLE`, `PARTIAL`, `UNAVAILABLE` |
| 정렬 | 1인당 지급액 많은 순 / 총 지급액 많은 순 / 지역 이름순 | `sort` |

Raw enums survive only as `<option value>`; no enum is citizen-facing text.

Filters persist in the URL following the existing convention (`lib/urlState.ts`
whitelist, `history.replaceState` mirror, one-time restore on mount). Keys are
`mc`-prefixed so they cannot collide with the landfill `origin` key — both datasets
use SGIS sido codes in the same area. Defaults write no parameter, so a default link
stays short and a pre-Step-3 link decodes with no warning. No state-management
library was introduced.

State is deterministic: results are **keyed** by the filter combination
(`mcKey = JSON.stringify([sido, status, sort])`) exactly as the official landfill
results are, so a filter change makes the previous rows disappear in the same render
that requests the new ones, and a late response from an abandoned filter state is
unrenderable.

---

## 5. Status, unavailable, and derived-population UX

### Status

| Served | Visible label | Badge kind | Why |
| --- | --- | --- | --- |
| `AVAILABLE` | 계산 가능 | `derived` | The value exists but is this platform's arithmetic, not a published official figure |
| `PARTIAL` | 일부 제한 | `caveat` (amber) | A value WAS served; amber correctly qualifies a number that exists |
| `UNAVAILABLE` | 자료 없음 | `missing` (neutral gray) | No value was served — never amber, never a pale ramp step |

Every badge carries a **text** label, so status never depends on colour. PARTIAL and
AVAILABLE differ in both wording and badge kind, and a PARTIAL row's served
limitation is shown **in the row itself**, not only behind the disclosure — a
partial value that looks ordinary until expanded is a value shown without its
qualifier.

`MISSING_QUANTITY` never downgrades a municipality: tonnage is reported in the
disclosure and stated there as not being an input to the payment indicator.

### Unavailable

`formatPayment` / `formatPaymentPerCapita` return `null` for a null input rather than
a formatted string, so a call site **cannot** render ₩0 from an absent value — it has
to branch. Unavailable rows keep their place in the list, show `자료 없음` in both
money cells, and carry the served reason sentence. A measured `"0.00"` still formats
as `0억원`, because a measured zero is a real value and a different claim.

### Derived population

The seven Gyeonggi cities (수원·성남·안양·부천·안산·고양·용인) carry
`population_method = DERIVED_SUM_OF_CONSTITUENT_WARDS`. They show
**`인구: 구성 일반구 인구 합산`** directly under the municipality name in both the
table and the cards, and the disclosure itemises every constituent 일반구 with its
population (`경기도 부천시 원미구 401,522명 + …`). Nothing implies the figure was
reported at city level. No geometry is fabricated for them.

---

## 6. Distinction from the official landfill dataset

The section's own `tone="warning"` banner renders
`meta.difference_from_official_landfill_fee` **verbatim**, plus the fixed line
"회계 기준·제공기관·공간 단위가 모두 달라 두 값을 더하거나 같은 비용으로 비교할 수
없습니다." It is not inside a disclosure — the one sentence that stops a reader adding
these values to the landfill fee must be visible on arrival — and it is not
`role="alert"`, because a standing caveat that interrupts on every render stops being
read.

The heading names the unit and the year (`시·군·구별 … — 2024년`), which is what
distinguishes it at a glance from the 시·도-level 수도권매립지 반입 현황 above.

The section never uses 반입수수료 / 공식 매립지 수수료 / 폐기물 총관리비 / 처리비 as
its own label (asserted). `MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE`
is absent — the deferred estimate remains deferred.

Methodology disclosures expose the indicator name, `KRW/인`,
`MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA`,
`LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE`, the numerator definition, the
geography and population policies, the served caveats, the source coverage
(64 / 62 / 2), and both rejected workbooks with their reasons. Every technical
identifier sits in a `[data-diagnostic]` line.

---

## 7. Responsive and accessibility behaviour

### Responsive

| Width | Form |
| --- | --- |
| ≥ `md` (768px) | `<table>` — 지자체 / 광역 / 1인당 지급액 / 총 지급액 / 자료 상태 / 데이터 참고, with a per-row disclosure |
| < `md` | `<ul>` of cards — the same five primary fields, same disclosure |

Both trees are in the DOM; Tailwind's `hidden` / `md:hidden` is `display: none`,
which removes the inactive subtree from the accessibility tree, so exactly one is
ever announced and nothing is read twice. (`aria-hidden` would be the wrong tool —
it cannot follow a media query.) Both forms share `MunicipalCostRowDetail`, so they
cannot drift apart in what they disclose. Measured at 390×844: the table is hidden,
the cards render, and `document.scrollWidth <= clientWidth` — no horizontal overflow.

The desktop table owns its own `overflow-x-auto`; the page body never scrolls
sideways because of it.

### Accessibility

- Real table markup: `<caption>`, six `<th scope="col">`, one `<th scope="row">` per
  municipality (asserted).
- `SectionCard` makes the section a `<section>` named by its `<h2>`; the methodology
  card nests as an `<h3>`.
- All three controls are native `<select>`s wrapped by their `<label>`, so the
  accessible name is the visible Korean text and keyboard/type-ahead/touch pickers
  are the platform's. Minimum control height 2.25rem.
- No icon-only control; the disclosure chevron is `aria-hidden` beside a real label.
- Status is carried by text as well as colour.
- Disclosures are native `<details>`, so `aria-expanded` is correct for free.
- Loading is a `role="status"` line with an `aria-hidden` skeleton; the empty-filter
  state has a polite `sr-only` `role="status"`; the row live region sits **outside**
  every `<details>`.
- Only a genuine failure is `role="alert"`.

---

## 8. States

| State | Presentation | Distinct from |
| --- | --- | --- |
| loading | `role="status"` sentence + decorative skeleton; no digits, no zero cells | — |
| error | `role="alert"` banner, plain Korean via `plainError`, bare code in one `[data-diagnostic]` line | Everything below |
| empty filter | `EmptyState` "선택한 조건에 해당하는 지자체가 없습니다." + "…지급액이 0이라는 뜻이 아닙니다" | A municipality's own 자료 없음 |
| municipality unavailable | `자료 없음` in the row, with the served reason | The error state — never routed through it |

The endpoint has **no** "no record" path (it always returns all 66 rows for the
published year), so an unavailable municipality can never reach the error branch.
Fetch failures are caught and classified; none is swallowed.

`homeApiMock.ts` stubs `fetchMunicipalCosts` with a rejection rather than a
synthetic 66-row payload. A fabricated response would invent payments and
populations under this dataset's `LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE`
evidence label, which repo-root `AGENTS.md` forbids; it also cannot use the 404 the
landfill fetchers use, because this endpoint has no such path. Rows and metadata are
exercised for real in `MunicipalCostSection.test.tsx`.

---

## 9. Validation

All commands were actually run in this session and the results are as printed.

### Static checks

| Check | Command | Result |
| --- | --- | --- |
| Frontend lint | `npm run lint` (eslint) | **passed, no output** |
| Frontend types | `npm run typecheck` (`tsc --noEmit`) | **passed, no errors** |
| Formatter | — | The frontend workspace has **no** formatter configured (no `prettier` dependency, config, or script in `frontend/package.json`). Nothing was run and nothing was reformatted. |

### Tests

| Suite | Result |
| --- | --- |
| `src/lib/municipalCost.test.ts` | **14 passed** |
| `src/components/landfill/MunicipalCostSection.test.tsx` | **46 passed** |
| `src/lib/urlState.test.ts` (7 new) | **35 passed** |
| `src/components/LandfillDashboard.test.tsx` (existing landfill regression, +5 new) | **80 passed** |
| Full frontend suite (`npm test`) | **1189 passed, 7 skipped, 51 files passed / 1 skipped** |
| Production build (`npm run build`) | **compiled successfully**, static pages generated |

Baseline comparison, measured rather than assumed: an isolated `git worktree` of
`origin/main` @ `b03ac55` was installed and run, and produced **1117 passed, 7
skipped (49 files passed, 1 skipped)**. This branch produces **1189 passed, 7
skipped (51 files passed, 1 skipped)** — the same skips, **+72 tests**, **+2 files**,
and **zero failures on either side**. There is no regression to attribute.

Two pre-existing assertions in `LandfillDashboard.test.tsx` counted `.wep-banner`
and `<select>` across the whole dashboard container. They were **scoped**, not
loosened: they now exclude the `municipal-cost-section` subtree and still assert the
official landfill view has exactly one banner and exactly four selects.

### No backend changes

Step 3 changed no backend, ingestion, or migration file, so no backend suite was
re-run and the 64-workbook ingestion was **not** re-run. The API was verified live
instead (below).

### Live verification (local dev stack, real ingested Step 2 data)

Local `database` + `backend` containers (compose project `waste-equity-platform`),
dev database already at alembic `0021` with the Step 2 ingestion loaded. The backend
image was rebuilt from `origin/main` source because the cached image predated Step 2.
No production host was contacted.

API, measured directly:

| Check | Result |
| --- | --- |
| Full scope row count | **66** |
| `expected_count` / available / partial / unavailable | **66 / 20 / 5 / 41** |
| `sido=11 / 28 / 41` | **25 / 10 / 31** |
| `status=AVAILABLE / PARTIAL / UNAVAILABLE` | **20 / 5 / 41** |
| `meta.is_official_landfill_fee` | **false** |
| Rejected source files | **2** — `양천구.xlsx`, `서해구xlsx.xlsx` |
| Source coverage | **64 discovered / 62 accepted / 2 rejected** |
| UNAVAILABLE payment + per-capita | **all null; no zeros** |
| Deferred landfill-associated estimate | **absent** |

UI, measured in Chrome at 1440×900 and 390×844:

| Check | Result |
| --- | --- |
| Rows rendered, unfiltered | **66** |
| Summary counts shown | **66 / 20 / 5 / 41** (read from `meta`) |
| `자료 없음` per-capita labels | **41** |
| Derived-population markers | **7** |
| Cells rendering a bare zero amount (`0억원`, `0원/인`, `₩0`) | **none** |
| UNAVAILABLE rows showing 자료 없음 in both money cells | **41 / 41** |
| Nulls last | first `이천시 213,906원/인`, last `하남시 자료 없음` |
| 지역 = 인천 | **10 rows**, summary scope moves to 10 |
| 인천 + 일부 제한 | **4 rows** |
| 서울 + 일부 제한 | empty-filter state, not an error |
| URL after filtering | `?v=1&mode=flow&metric=population&mcSido=28&mcStatus=PARTIAL` |
| 390px | table hidden, cards shown, no horizontal overflow |
| Console / page errors | **none** |

---

## 10. Known limitations

1. **No end-to-end (Playwright) spec was added.** The repository's e2e suite needs a
   running backend and browser binaries the environment does not install; the live
   verification above was performed with a one-off script against the real stack and
   then removed rather than committed as a spec that could not run in CI (the repo
   has no CI). Component coverage is in `MunicipalCostSection.test.tsx`.
2. **Responsive behaviour is asserted at the class/DOM level** in vitest (jsdom
   computes no CSS), matching the convention in `app/responsive.test.tsx`. The pixel
   behaviour was measured manually at 390×844 and is recorded above.
3. **Only 2024 is available.** The year is not a user control and is not in the URL;
   the backend rejects any other year with a 422.
4. **Seoul is entirely `UNAVAILABLE`** (25/25) in the published data. The UI states
   this as 자료 없음 with the served reason on every row; it is a property of the
   disclosures, not of this implementation.
5. **No map layer.** Deliberate — see §1.
6. `homeApiMock` holds the section at its error state for the page-level tests
   (§8), so those tests exercise the official landfill dashboard only.

---

## 11. Next step

**OCI deployment.** Not performed in this session and explicitly out of scope: no
host was contacted, no production migration was run, no production ingestion was
run, and no production container was touched.

Deploying this release still requires what Step 2 recorded: applying migration
`0021` on the target and running `municipal-costs-ingest --write` there, which
depends on the Git-ignored raw workbooks being available on that host, plus the
unresolved licensing/publication question for the disclosure workbooks. Until the
municipal tables are populated on the target, this section will render its error
state there — it will not fabricate values.
