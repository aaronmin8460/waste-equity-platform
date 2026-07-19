# Facility Cost Model V1 (Phase 4)

An official-standard **facility installation-cost** analytical model: it derives a
standard construction cost for a new incineration or automated-sorting facility
from the government 표준공사비 (standard-cost) table, plus a straight-line
annualization, a simplified subsidy / local-share split, and a per-capita local
share.

Backend only (Phase 4): a versioned reference table + migration, a pure Decimal
calculation engine, and a read-only GET API. The citizen-facing UI is Phase 5.

## Purpose and non-purpose

**Purpose.** Decision-support: "for a facility of this size, what does the
government standard-cost table imply, and how would a nominal subsidy split it?"

**It is NOT** (and the API/UI must never present it as):

- an actual project budget or **actual total project cost** (실제 총사업비 아님);
- an **approved** national subsidy decision (승인된 국고보조금 아님);
- an **actual transport-cost** model (실제 운송비 아님 — see the guardrail);
- a complete annual **operating-cost** model (운영비 미포함);
- a **personal tax bill** (주민 개인의 세금 청구액 아님);
- a cheapest-candidate ranking.

The result is explicitly PARTIAL: it carries completeness metadata and a
disclaimer, and no field is ever named 총비용 / total cost.

## Terminology

| field | Korean | unit |
| --- | --- | --- |
| `standard_construction_cost_bn` | 표준공사비 기반 설치비 산정액 | 억원 |
| `annualized_construction_cost_bn` | 연간 환산 설치비 | 억원/년 |
| `per_capita_local_share_won` | 주민 1인당 환산 지방비 | 원 |

## Units

- Standard **unit cost**: 억원/(톤·일) (from the source table).
- Capacity: 톤/일. Annual quantity: 톤/년.
- Construction-cost figures: 억원 (hundred-million KRW). Per-capita share: 원.
- All monetary values are exact `Decimal` (never binary float), quantized with
  `ROUND_HALF_EVEN` (억원/톤 to 6 decimals, 원 to 2).

## Interval semantics (capacity bands)

Bands are contiguous and non-overlapping so exactly one matches any positive
capacity:

- first band: `[0, upper]` — unbounded lower, **inclusive** upper;
- middle bands: `(lower, upper]` — lower-**exclusive**, upper-**inclusive**;
- last band: `(lower, +∞)` — unbounded upper.

`capacity_min_ton_per_day` / `capacity_max_ton_per_day` are `NULL` for an
unbounded side. `capacity_min_inclusive` is `true` only for the (unbounded) first
band; `capacity_max_inclusive` is `true` for every bounded upper. Matching:
`(min IS NULL OR cap {>|>=} min) AND (max IS NULL OR cap {<|<=} max)`.

Boundary behaviour: at an edge value (e.g. incineration 30, 50, 100, 200; sorting
every 10) the value belongs to the **lower** band (inclusive upper); one unit
above moves to the next band.

## Standard-cost rows (`capex-standard-v2022dec`)

- **Price base date:** 2022-12-01
- **Source:** 2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2, p.211
- Unit: 억원/(톤·일)

`incineration_new`:

| capacity (톤/일) | 억원/(톤·일) |
| --- | --- |
| ≤ 30 | 6.24 |
| 30 < c ≤ 50 | 5.90 |
| 50 < c ≤ 100 | 5.23 |
| 100 < c ≤ 200 | 4.98 |
| > 200 | 4.57 |

`sorting_auto`:

| capacity (톤/일) | 억원/(톤·일) |
| --- | --- |
| ≤ 10 | 5.97 |
| 10 < c ≤ 20 | 4.63 |
| 20 < c ≤ 30 | 3.60 |
| 30 < c ≤ 40 | 3.45 |
| 40 < c ≤ 50 | 3.31 |
| 50 < c ≤ 60 | 3.23 |
| 60 < c ≤ 70 | 2.98 |
| 70 < c ≤ 80 | 2.94 |
| 80 < c ≤ 90 | 2.92 |
| > 90 | 2.90 |

Historical versions are retained: a new price base date is a new `cost_version`
with its own migration. The migration seeds a self-contained snapshot; a unit test
asserts it never diverges from the engine's canonical `STANDARD_COST_SEED`, and
the seed is idempotent (re-running inserts nothing).

Band uniqueness is **NULL-safe**: a plain unique constraint treats NULL bounds as
distinct, so duplicate first bands `(NULL, upper)` or last bands `(lower, NULL)`
could slip in and make the lookup find overlapping matches. The unique index
`COALESCE`s each unbounded bound to `-1` (never a real, nonnegative value) so a
duplicate band is rejected on both SQLite and PostgreSQL.

## Formulas

1. `annual_service_quantity_ton = official_annual_quantity_ton × processing_share`
   (share validated 0–1; the API takes `processing_share_percent` 0–100).
2. `facility_capacity_ton_per_day = annual_service_quantity_ton ÷ operating_days_per_year`
   (default **300**). Starting from an annual quantity, so it only divides by
   operating days — the daily-input variant (`daily × 365 ÷ operating_days`) is
   never applied on top of this (no double conversion).
3. `standard_unit_cost_bn_per_tpd = lookup(facility_type, capacity, cost_version)`
   (exactly one band matches, else a structured error).
4. `standard_construction_cost_bn = unit_cost × capacity × underground_multiplier`.
5. `facility_lifetime_years`: incineration ≤ 50 t/day → 15; incineration > 50 →
   20; sorting_auto → 15.
6. `annualized_construction_cost_bn = standard_construction_cost_bn ÷ lifetime`
   (straight-line analytical annualization, **not** a payment schedule).
7. `estimated_national_subsidy_bn = standard_construction_cost_bn × subsidy_rate`.
8. `simplified_local_government_share_bn = standard − subsidy`.
9. `per_capita_local_share_won = local_share_bn × 100,000,000 ÷ official_service_population`
   (only with an exact same-year official denominator; otherwise **null + reason**).

### Underground multiplier

Range **1.00–1.40**, default **1.00** — a scalar scenario, never a boolean:
1.00 = 지상형 기준; > 1.00 = 지하화 분석 시나리오; 1.40 = 국고지원 협의 상한
시나리오. It is **not** a guaranteed construction multiplier or an approved amount.

### Subsidy assumptions (nominal rates)

| scheme | rate |
| --- | --- |
| `seoul_special_city` | 0.30 |
| `metropolitan_city` | 0.40 |
| `city_or_county` | 0.30 |
| `joint_regional_facility` | 0.50 |

Subsidy and local share are **analytical estimates at nominal rates**, not an
approved grant. Joint-regional eligibility is never inferred merely because
several regions were selected — it is an explicit scheme the caller chooses. The
rate carries its own provenance in the response (`subsidy.rate_source`,
`rate_reference_period`, `rate_basis`, and `provenance.subsidy_rate_source`): the
nominal rates are policy rates from the 국고보조금 업무처리지침, used here as an
analytical assumption.

## Completeness / unavailable components

The result is `is_partial: true` with:

- **included:** `STANDARD_CONSTRUCTION_COST`, `ANNUALIZED_CONSTRUCTION_COST`,
  `SIMPLIFIED_SUBSIDY`, `SIMPLIFIED_LOCAL_GOVERNMENT_SHARE`.
- **missing** (never computed, never zero-filled):
  - `OPERATING_COST` — `OFFICIAL_SOURCE_NOT_INTEGRATED`
  - `ACTUAL_TRANSPORT_COST` — `ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE`
  - `LAND_AND_COMPENSATION` — `PARCEL_SPECIFIC_COST_UNAVAILABLE`
  - `REMAINING_LANDFILL_COST` — `FACILITY_MASS_BALANCE_NOT_ESTABLISHED`

## Transport-unit audit (guardrail)

No actual transport cost is exposed in V1 (no verified route, origin, distance, or
contract rate). The engine documents only the dimensional algebra, for a value
stored in **만 t·km** and a price in **원/t·km**:

```
억원 = price_won_per_ton_km × ton_km_10k × 0.0001
```

Round-trip / utilization factors must be **separate explicit parameters** — never
folded into this conversion. The earlier "× 0.5" factor was undefined and is not
used.

## API contract (read-only, GET)

- `GET /api/v1/facility-cost/standards` — all seeded versions and their bands.
- `GET /api/v1/facility-cost/options` — facility types, subsidy schemes,
  underground-multiplier bounds/default, default operating days, cost versions.
- `GET /api/v1/facility-cost/calculate` — inputs: `facility_type`, `waste_stream`,
  `subsidy_scheme`, `region_codes` (comma-separated SIGUNGU), `reference_year?`,
  `processing_share_percent` (0–100, default 100), `operating_days` (default 300),
  `underground_multiplier` (1.00–1.40, default 1.00), `cost_version?`,
  `candidate_id?`. Response sections: `scenario`, `official_input`, `capacity`,
  `standard_cost`, `annualization`, `subsidy`, `per_capita`, `candidate_context`,
  `completeness`, `provenance`, `assumptions`, `disclaimer`.

Official data aggregation (`official_input`): waste generation and population are
joined by `region_code` (vintage-safe) over **SIGUNGU (leaf)** regions only — a
SIDO code is rejected to avoid double counting. Every region must have exactly one
same-year waste row (else `OFFICIAL_WASTE_UNAVAILABLE` / `AMBIGUOUS_WASTE_ROWS` —
never a 0-fill). Population is same-year only (never borrowed); a missing/ambiguous
denominator makes `per_capita` null with a reason while the cost part still runs.
`candidate_id` adds analytical context only — the standard cost never varies by
candidate cell, and suitability status is never reinterpreted as legal eligibility.

Money serializes as exact decimal strings.

## Test examples (validated)

- sorting_auto, capacity 35: `3.45 × 35 = 120.75` 억원.
- sorting_auto, capacity 50: `3.31 × 50 = 165.50` 억원.
- incineration_new, capacity 1000, underground 1.4: `4.57 × 1000 × 1.4 = 6398.00` 억원.
- transport algebra: `50 원/t·km × 100 만t·km × 0.0001 = 0.5` 억원.

Boundary tests cover below/at/above 30, 50, 100, 200 (incineration) and every
10-ton edge 10–90 (sorting); lifetime at exactly 50 and just above; all subsidy
schemes; missing population → null; overlapping/empty band protection; invalid
processing share / operating days / underground multiplier; seed idempotency and
migration/engine consistency.

## Limitations & future data needs

- Standard unit costs are the guideline table — not물가·설계 변경, site conditions,
  or actual contract rates.
- No operating cost, actual transport cost, land/compensation, site-specific civil
  works, financing, contingency, or remaining-landfill cost.
- Per-capita denominator is the same-year SGIS SIGUNGU population; district-level
  waste for the seven RCIS city-level regions is not resolvable here.
- Future: integrate official operating-cost norms, verified transport routes and
  contract rates, parcel land/compensation data, and approved-subsidy records to
  move beyond a standard-cost analysis.
