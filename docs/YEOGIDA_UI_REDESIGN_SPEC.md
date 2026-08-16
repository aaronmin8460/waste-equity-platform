# 여기다 (Yeogida) UI Redesign — Specification

**Status:** APPROVED — this file is the source of truth for every phase of the
seven-phase autonomous redesign.

**Branch:** `feat/yeogida-figma-redesign`
**Based on:** `origin/main` @ `aece252f477b69b0dc1546ed184e666ed3f0841d`

**Target Figma:** <https://www.figma.com/design/hETmPv3N31IJeW8XdLwoiS/UI-UX?node-id=74-1991>
**Meeting-notes Figma:** <https://www.figma.com/design/bKV5JRRORPJCIliY2tFQrp/8-7-회의록?node-id=0-1>
**Production:** <https://waste-161-33-2-143.sslip.io/>

> **Figma access.** Both Figma files were unreachable when the phases below were
> written (HTTP 403 / login wall; no Figma MCP server is connected). The UI-UX
> file has since been read through the Figma REST API, which confirmed that every
> full-page frame is 1440px wide and that the file contains no phone composition
> for any of the six destinations — the evidence behind the desktop-required
> contract in `frontend/RESPONSIVE_LAYOUT.md`. Every phase
> therefore implements the APPROVED WRITTEN DECISIONS recorded below, plus the
> existing repository design documentation
> (`docs/UI_UX_DESKTOP_REDESIGN_PLAN.md`, `docs/ui-refresh/*`,
> `docs/CITIZEN_LANGUAGE_AND_UX.md`, `docs/ACCESSIBILITY.md`,
> `frontend/RESPONSIVE_LAYOUT.md`). No numeric value, threshold, label, or
> colour has been invented to stand in for something a Figma frame might have
> shown. See `YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md` for the running list of
> Figma-derived surfaces that could not be verified or truthfully implemented.

---

## 1. Brand

| Item | Value |
| --- | --- |
| Citizen-facing product name | **여기다** |
| Subtitle | **폐기물 처리시설 입지 추천 플랫폼** (was 쓰레기 매립지 입지 추천 플랫폼 — see the note below) |
| Visual motif | target / crosshair symbol |
| Key colour (primary) | `#111A56` |
| Application canvas | ≈ `#F9F9F9` |
| Surfaces | white (`#FFFFFF`) |
| Muted text | `#848A95`, only where contrast remains appropriate |
| Small body / supporting text | ≈ `#646676` (darker accessible gray) |
| Korean UI font | Noto Sans KR |

**Subtitle correction (six-page Figma forensic audit).** The original subtitle named
**매립지** — one disposal route — while the six destinations analyse 소각·재활용·매립
facilities alike, so the wording claimed a narrower product than the one that
shipped. **폐기물 처리시설** is the term that covers what the screens actually do. The
string lives once, in `lib/glossary.BRAND_SUBTITLE`, and is rendered by the app bar,
`ui/NarrowScreenGate`, and `app/layout.tsx`'s document title — the three cannot drift.

**Renaming boundary — deliberate and narrow.** Citizen-facing branding becomes
여기다. References to *"Waste Equity Platform"* are **NOT** globally replaced
where they describe:

- the historical project identity,
- data-processing attribution (e.g. the EGIS land-cover derived-statistics
  provenance sentence, which names the processing party in a licence context),
- technical documentation, backend module docstrings, API client comments,
- data provenance strings served to or rendered for citizens as attribution.

Changing those strings would rewrite a provenance claim, which
`AGENTS.md` forbids. Only the *product chrome* is rebranded.

**Below 1024px.** The product is desktop-required: the shell renders
`components/ui/NarrowScreenGate.tsx` instead of any dashboard, and the gate
carries the mark, "여기다", and the subtitle. The app bar itself therefore never
renders below 1024px, so its brand block has no narrow variant — the `<640px`
subtitle hide it used to carry is gone. See `frontend/RESPONSIVE_LAYOUT.md`.

---

## 2. Visible navigation — the six destinations

| # | Visible name | Icon direction |
| --- | --- | --- |
| 1 | 지역 지표 | chart / bar-metric |
| 2 | 지역별 폐기물 처리 현황 | flow / arrow-into-container |
| 3 | 후보지 분석 | crosshair + currency (siting + cost) |
| 4 | 후보지 심층 분석 | layered map / magnifier |
| 5 | 후보지 심층 비교 | two-column balance / compare |
| 6 | 데이터·출처 | document / database |

Design rules:

- a small, meaningful inline SVG icon per destination;
- a clear active state that is **not** colour-only;
- all six stay on **one row at 1024px** desktop width — compress spacing and
  padding rather than wrapping. 1024px is the desktop floor, i.e. the narrowest
  width this bar ever renders at (`frontend/RESPONSIVE_LAYOUT.md`), so this is
  the binding case rather than an edge case;
- **do not** create a new URL-state version for the six visible destinations.

### 2.1 Internal routing contract (the projection)

The six visible destinations are a **presentation projection** over the
existing `(mode, suitabilityView)` state. No new backend mode is introduced and
`URL_STATE_VERSION` stays `"1"`.

| Destination | `mode` | `view` | Canonical URL |
| --- | --- | --- | --- |
| 지역 지표 | `equity` | — | `?v=1&mode=equity` |
| 지역별 폐기물 처리 현황 | `flow` | — | `?v=1&mode=flow` |
| 후보지 분석 | `suitability` | `cost` | `?v=1&mode=suitability&view=cost` |
| 후보지 심층 분석 | `suitability` | `score` | `?v=1&mode=suitability&view=score` |
| 후보지 심층 비교 | `suitability` | `scenario` | `?v=1&mode=suitability&view=scenario` |
| 데이터·출처 | `transparency` | — | `?v=1&mode=transparency` |

Consequences that are **intentional**:

- The old suitability sub-view `SegmentedControl` (후보지 점수 / 가중치
  바꿔보기 / 비용 살펴보기) is **removed from the shell**. The six-destination
  navigation now selects that state directly. Keeping both would be two
  controls writing one piece of state — the "do not duplicate analytical
  state" rule. The `view` URL parameter, its decoder, its encoder, and the
  `suitabilityView` React state are all unchanged.
- `?v=1&mode=suitability` with no `view` still restores `view=score`
  (the existing decoder default), i.e. 후보지 심층 분석.
- Every previously shareable v=1 link resolves to exactly the destination it
  resolved to before.

### 2.2 Headings

Each visible destination's `<h1>` uses the **same Korean destination name**.
Detailed scope belongs in the subtitle / supporting copy under the `<h1>`.

| Destination | `<h1>` |
| --- | --- |
| 지역 지표 | 지역 지표 |
| 지역별 폐기물 처리 현황 | 지역별 폐기물 처리 현황 |
| 후보지 분석 | 후보지 분석 |
| 후보지 심층 분석 | 후보지 심층 분석 |
| 후보지 심층 비교 | 후보지 심층 비교 |
| 데이터·출처 | 데이터·출처 |

The brand block is **never** a heading — every view keeps exactly one `<h1>`.

---

## 3. Page 1 — 지역 지표

- Figma regional-indicator presentation.
- Resizable desktop left sidebar:
  - **min 300px, default 360px, max 520px**
  - width persisted in `localStorage`
  - pointer/mouse drag
  - keyboard Left/Right
  - Home → minimum, End → maximum
  - double-click the divider → reset to 360px default
  - the handle is present at every width the sidebar renders at; there is no
    longer a stacked layout in which resizing would be meaningless
- Preserve ranking / map / metric / share / export / report behaviour.
- Preserve missing-data semantics.
- **Reuse the existing MapLibre `ResizeObserver` / `map.resize` mechanism** in
  `components/MapView.tsx`; do not duplicate it and never remount the map on a
  width change.

---

## 4. Page 2 — 지역별 폐기물 처리 현황

- Use the Figma 지역별 폐기물 처리 현황 information architecture.
- Include the actually-supported waste-generation / treatment / landfill /
  composition / trend / regional / cost information.
- **The official Sudokwon Landfill inbound fee and the municipal
  collection/transport contract payment are DIFFERENT indicators.**
  - keep them in clearly separate semantic sections
  - never sum, average, merge, or relabel them as one cost
  - never present a combined "total cost"
  - missing stays missing, never ₩0
- Real `.xlsx` export is **required** for the appropriate Page 2 table/data.

---

## 5. Page 3 — 후보지 분석

- Visible name stays **후보지 분석**.
- Figma candidate-analysis / facility-cost presentation.
- The map supports **administrative-region selection only**.
- The map must **NOT** imply candidate-grid-specific construction cost, a
  land-price surface, or a suitability score.
- Facility capacity / cost stays backend-authoritative.

---

## 6. Page 4 — 후보지 심층 분석

Layout: **left collapsible panel + central map + right collapsible panel.**

- Left: region / analysis settings / weights / filters / contextual layer
  controls / critical notices.
- Right: candidate ranking / selected-candidate detail / status / stability.
- Both panels collapse independently, reopen easily, and give freed space to
  the map — with correct MapLibre resize and **no remount**.

### 6.1 The real scored factors — absolute

| Code | Korean name |
| --- | --- |
| Z | 용도지역 호환성 |
| R | 도로 근접성 대리지표 |
| E | 기존 지역 부담 |
| D | 폐기물 처리 수요 |

- **Do NOT** pretend land cover is a scored suitability component.
- **Do NOT** invent a resident-reaction score.
- Land cover and wetland stay **contextual / unmodeled** layers and must never
  visually imply they alter the official composite score.

### 6.2 Official status

`ELIGIBLE` / `REVIEW_REQUIRED` / `EXCLUDED` remain authoritative, keep their
backend reasons, are never derived from score thresholds, and are never
replaced by A/B/C.

### 6.3 Stable candidate

The existing backend definition is preserved: baseline + equal + critic all
satisfy the current top-10% stability rule (3/3). No fourth formula.

Visual accent: use the explicit Figma stable-candidate colour **if it can be
verified**. It could not be (Figma inaccessible), so the existing `#d81b60`
distinction is retained and the fallback is recorded in
`YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md`.

### 6.4 A/B/C relative display grade

A **separate relative display grade**, for `ELIGIBLE` candidates only, that
never replaces or alters official status.

- Population: the **complete authoritative ELIGIBLE score population** for the
  active run/profile — never the viewport, never top-N, never the filtered
  subset, never Figma mock numbers.
- Rule: `A = score ≥ P75`, `B = P25 ≤ score < P75`, `C = score < P25`.
- Use a deterministic, documented percentile method; record the method, the
  exact thresholds, the eligible population size, and the A/B/C counts.
- Citizen wording: **상대 점수 구간 / 상대 등급**, explained as based on the
  current ELIGIBLE score distribution.
- Never say `A = 적격` or `C = 부적격`.
- If a complete authoritative population cannot be obtained safely: **omit**
  A/B/C rather than fabricate it, and record the limitation.

---

## 7. Page 5 — 후보지 심층 비교

- **A안** = a selected existing official comparison profile.
- **B안** = the user-adjusted temporary weight scenario.
- Only metrics the existing data can truthfully support.

Suitable: score comparison, rank movement, top-N, selected-candidate detail,
Z/R/E/D contribution, TOP10 retention when correctly derivable, clearly scoped
top-N statistics.

**Forbidden:** "신규 통과 후보" and "통과 → 제외" counts. A user-weight scenario
does **not** change official screening status, so those metrics do not exist —
and a fake `0` is equally forbidden. Replace those Figma slots with truthful
metrics; record the substitution.

Do not label a top-N statistic as if it describes the full population.

Real `.xlsx` export is **required** for the Page 5 comparison data that is
actually displayed/supported. If the export is necessarily top-N scoped, the
file/sheet/UI label must say so.

---

## 8. 데이터·출처

- User-facing interaction is a **large accessible modal/dialog**, not a
  dedicated visible full-page destination.
- The navigation still visibly contains 데이터·출처.
- Preserve `?v=1&mode=transparency` compatibility: a direct legacy transparency
  URL restores/opens the data-and-sources dialog.
- Closing the dialog safely returns to the prior non-transparency destination,
  with no infinite history loop and sensible Back/Forward.
- Preserve all existing source-catalog / search / filter / period / gaps /
  facility-mapping / methodology functionality.
- Internal search/filter state does **not** need to be serialised into the URL.

Dialog accessibility: dialog semantics, accessible title 데이터·출처, focus
enters and is contained, Escape closes when safe, an explicit close control,
focus restored to the triggering control, background not keyboard-interactive,
internal scrolling. It is a desktop dialog: the `<640px` full-screen variant it
used to carry was removed with the phone layout.

---

## 9. Info / disclosure UX

- Supporting informational panels **may** be collapsible.
- Critical analytical / data-limitation notices **must remain visible** and must
  not be hidden by default.

---

## 10. Export scope

- Retain existing Page 1 CSV / report behaviour.
- Implement real XLSX for **Page 2** and **Page 5**.
- Do not add meaningless Excel buttons to every screen.

---

## 11. Absolute data-integrity rules

1. Figma sample numbers are visual mock values only — **never** hard-code them
   as production data.
2. Missing / unavailable is **never** converted to zero.
3. Backend / API values remain the source of truth.
4. Do not fabricate unavailable metrics.
5. Do not silently change analytical methodology.
6. Do not silently add database migrations for this UI redesign.
7. Do not rename official source semantics to make the design look closer to
   Figma.

---

## 12. Design tokens

The repository already has one semantic token system in
`frontend/src/app/globals.css` (`@theme`), used ~450 times across components
and documented in `docs/ui-refresh/design-tokens.md`. The redesign
**re-points those token values** and adds the roles that did not exist. It does
**not** rename tokens or introduce a second parallel system.

| Role | Token | Yeogida value | Was |
| --- | --- | --- | --- |
| Canvas | `--color-canvas` | `#f9f9f9` | `#f4f6fb` |
| Surface | `--color-surface` | `#ffffff` | `#ffffff` |
| Primary / action | `--color-primary` | `#111a56` | `#2663eb` |
| Primary hover | `--color-primary-hover` | `#0b1240` | `#1f4fa8` |
| Primary soft | `--color-primary-soft` | `#eef0f8` | `#eaf0fe` |
| Primary border | `--color-primary-border` | `#c5cbe4` | `#c3d4f7` |
| Brand (identity) | `--color-brand` | `#111a56` | `#17786c` |
| Ink | `--color-ink` | `#1b1d26` | `#171c29` |
| Ink muted | `--color-ink-muted` | `#4a4d5c` | `#4d5466` |
| Ink subtle | `--color-ink-subtle` | `#646676` | `#687083` |
| Focus ring | `--focus-ring` | `#111a56` | `#2663eb` |
| Card radius | `--radius-card` | `1.25rem` (20px) | `0.625rem` |
| Control radius | `--radius-control` | `0.625rem` (10px) | `0.5rem` |

`#848A95` is registered as `--color-ink-faint` for **large/decorative** text
only. It is 3.24:1 on white — below 4.5:1 — so it is **not** permitted for
small body text. Small supporting text uses `--color-ink-subtle` (`#646676`,
6.31:1 on white, 6.03:1 on the `#f9f9f9` canvas).

The analytical map/legend palette stays the single source of truth in
`lib/metrics.ts` and is deliberately **not** tokenised here.

---

## 13. Accessibility principles preserved

- Native `<button>` elements.
- Meaningful `aria` state (`aria-pressed` / `aria-current`), never colour alone.
- Exactly one logical `<h1>` per view; the brand is not a second `<h1>`.
- The skip link and its single `#main-content` target survive in every branch.
- Every status, grade, and provenance carries a text label.
