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

## Legend (`app/page.tsx`)

Each choropleth class row shows a **class number (…급)**, the numeric
**lower–upper range** (from the active metric-scale breaks — never invented
thresholds), and the **unit**, plus an explicit **no-data category** (`—` /
데이터 없음). Combined with the exact-value tooltip, a region's class is readable
without relying on color.

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
