# Map & dashboard readability (Phase 3)

Readability improvements on top of the Phase 2 accessibility foundation. No
analytical calculation changed: every value shown is the backend-served value,
and a region/month with no served value shows its availability text, never a
fabricated 0.

## Regional map hover & tap (`components/MapView.tsx`)

- **Desktop hover** shows a lightweight tooltip (a close-button-less MapLibre
  popup) that follows the pointer over a region, rebuilt only when the pointer
  crosses into a different region.
- **Mobile tap** (and desktop click) pins a popup with the same content — mobile
  has no hover, so the tap popup is its path.
- Both share `regionPopupHtml(props)`, so they always show the same information:
  region name, selected metric label, the exact served value with unit (or the
  availability text — never a 0), the **metric reference period**, boundary
  provenance, and the derived-city reporting note where relevant.
- The map talks only to the backend; no government API is called from the browser.

## Legend (`app/page.tsx`, `components/MapLegendOverlay.tsx`)

Each choropleth class row shows a **class number (…급)**, the numeric
**lower–upper range** (from the active metric-scale breaks — never invented
thresholds), and the **unit**, plus an explicit **no-data category** (`—` /
데이터 없음). Combined with the exact-value tooltip, a region's class is readable
without relying on color.

**Phase 4 (desktop redesign).** The legend's primary heading is Korean-only —
`범례`, or `범례 — {unit}` when the metric has a unit. The former `범례 (Legend)`
duplication is gone from both the mobile `<summary>` and the equity `<h2>`.
Nothing analytical moved with it: the class rows, their order, the class numbers,
the numeric ranges, the unit, the scale-method note, and the explicit no-data row
including its `데이터 없음 (no served value)` wording are all unchanged. That
parenthetical is the no-data *wording*, not an English gloss on a primary label,
so it stays.

The palette, break values, class count, scale type, and no-data color remain the
single source of truth in `lib/metrics.ts`, which Phase 4 did not touch. The
legend is still a pure presentation component that receives already-computed rows
from the page, so map fill and legend can never diverge. Placement (floating
bottom-left inside the map, clear of the OSM attribution), the mobile disclosure,
and the desktop force-open behaviour are unchanged.

## Metric scanning (`app/page.tsx`)

The three metric fieldsets (`총량 지표` / `1인당 형평성 지표` / `시설 부담 지표`)
remain one logical radio group with a shared `name="metric"`, so arrow keys still
traverse all eleven options. Phase 4 put the **active** metric first: a card at the
top of the control column shows its plain-Korean name at `text-base font-semibold`,
its unit as muted secondary text, and its source and reference period as a caption.
That card is the existing `role="status"` `selected-metric-summary` live region, so
each metric change is still announced — and it reads the same `metric`/`unit` the
map fill and the legend read, so no second metric state was introduced. All eleven
radios stay visible on desktop; no metric family is hidden behind a closed
disclosure.

## Landfill charts (`components/LandfillDashboard.tsx`)

The monthly `MiniBars` charts now carry:

- a descriptive title and a caption stating the **y-axis unit** and the
  **reference period** (from the trend points), so the fee (억원) and quantity
  (톤) units are never confused;
- **x-axis endpoint month labels**;
- hover `<title>` tooltips with each month's exact value; and
- an **accessible table fallback** (`표로 보기`) listing every month's exact value
  as text, because the hover tooltips are unreachable by touch or screen readers.

Charts stay in responsive containers (the table scrolls inside its own
`overflow-y-auto` box); there is no page-level horizontal overflow.

## Metric scanning (`app/page.tsx`)

The three Phase 2 metric fieldsets are rendered as light group cards
(`총량 / 1인당 형평성 / 시설 부담`) for faster scanning; they remain one logical
radio group (shared `name="metric"`). The selected-metric summary (Phase 2)
still names the active metric.

## Tests

- `components/MapView.test.tsx` — `regionPopupHtml` content (value, reference
  period, no-data availability, derived note) and the hover/tap interaction via
  the fake MapLibre map.
- `components/LandfillDashboard.test.tsx` — chart axis unit/period captions and
  the table fallback values (fee vs quantity units distinct).
- `app/accessibility.test.tsx` — numbered legend ranges + unit + no-data row, and
  the metric group cards.
- e2e `responsive.spec.ts` / `accessibility.spec.ts` — layout/no-overflow and a11y
  regression at mobile + desktop. (The desktop hover tooltip is exercised by the
  fake-map component test rather than e2e, because the layout-only e2e mock serves
  empty official envelopes — it must not fabricate official region/landfill data.)
