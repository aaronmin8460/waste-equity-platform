# MOIS Monthly Resident-Registration Population (2008-01 → 2026-06)

The official monthly population series that denominates the landfill indicator
**주민 1인당 환산 반입수수료** (`LANDFILL_INBOUND_FEE_PER_CAPITA`,
`landfill-fee-per-capita-v2`). Scope is the capital region only: 서울특별시 /
인천광역시 / 경기도.

Source validated and ingested live on **2026-07-15**. KOSIS is not used. Nothing
before 2008-01 is fetched or stored.

---

## 1. Official source

| Field | Value |
| --- | --- |
| Publisher | 행정안전부 (Ministry of the Interior and Safety) |
| Statistic | 주민등록 인구통계 |
| **Dataset** | **행정동별 주민등록 인구 및 세대현황** (verified page title) |
| Official page | https://jumin.mois.go.kr/statMonth.do |
| Update frequency | Monthly (month-end values) |
| Responsible division | 주민과 (044-205-3158) |

### Why the site's CSV endpoint, and not an API

The preferred route is a documented OpenAPI. MOIS links two data.go.kr OpenAPIs
from its own site, but **neither is this dataset**:

- `15108092` — 행정안전부_**도로명별** 주민등록 인구 및 세대현황 (road-name based);
- `15108093` — 행정안전부_**지역별 인구이동 현황** (migration).

No documented API publishes the 행정동별 monthly series with history back to 2008,
so acquisition falls to preference #2: the official site's own CSV download.

### Acquisition endpoint (official but undocumented — isolated behind an adapter)

```
POST https://jumin.mois.go.kr/downloadCsv.do?searchYearMonth=month&xlsStats=1
Referer: https://jumin.mois.go.kr/statMonth.do
Content-Type: application/x-www-form-urlencoded
```

Body (mirrors the official page's own `#formXlsDown` hidden inputs verbatim):

| Field | Value | Meaning |
| --- | --- | --- |
| `sltOrgType` | `1` | 행정기관 단위 |
| `sltOrgLvl1` | `A` | 전체 시도 |
| `sltOrgLvl2` | *(empty)* | no 시군구 narrowing |
| `sltUndefType` | *(empty)* | **전체** = 거주자 + 거주불명자 + 재외국민 |
| `searchYearStart` / `searchMonthStart` | e.g. `2008` / `01` | range start |
| `searchYearEnd` / `searchMonthEnd` | e.g. `2026` / `06` | range end |
| `gender`, `genderPer`, `generation` | as-is | official defaults |
| `sltOrderType` / `sltOrderValue` | `1` / `ASC` | official defaults |
| `category` | `month` | monthly grain |

**How it was discovered and validated (2026-07-15):** by reading the official
page's own download form and its `$("#csvDown")` handler — never by scraping a
rendered table, a screenshot, a search snippet, a mirror, a blog, or Wikipedia.
Because the endpoint is official but undocumented, the adapter
(`ingestion/src/waste_equity_ingestion/mois_population_contract.py`) revalidates
every response before any value is trusted: the header must carry the expected
Korean `<YYYY>년<MM>월_총인구수` columns, the first column must be `행정구역`, and
each required 시도 must appear with its exact official code **and** name.

### Response format

- `Content-Disposition: attachment; filename="202606_202606_주민등록인구및세대현황_월간.csv"`
- Encoding **cp949 (EUC-KR)**; CSV.
- **Wide**: one row per 행정구역, and a six-column block per month —
  `총인구수`, `세대수`, `세대당 인구`, `남자 인구수`, `여자 인구수`, `남여 비율`.
  Only `총인구수` is read.
- The `행정구역` value embeds the code: `"서울특별시  (1100000000)"`.
- Populations are comma-grouped integers (`"9,289,813"`), normalized exactly —
  never through a float.

> **Trap (handled):** a month MOIS has **not** published returns HTTP 200 with a
> well-formed CSV of **zeros**, not an error. A 2026-07 probe returned
> `"서울특별시  (1100000000)","0","0",…`. A non-positive 시도 population is
> therefore treated as *not published* and rejected — never stored as `0`.

### Licensing

The official pages publish **no 공공누리 badge** for this download; the footer
states `ⓒ Ministry of the Interior and Safety. All rights reserved.` Terms for
redistribution are therefore **not asserted here** — only that these are official
MOIS statistics retrieved from the official site. Confirm with the publisher
(주민과) before redistributing the raw data.

---

## 2. Population definition

```
전체 주민등록 인구 = 거주자 + 거주불명자 + 재외국민
외국인은 제외
```

**Verified arithmetically against the official source** (서울, 2026-06), by
requesting each `sltUndefType` separately:

| Component | `sltUndefType` | 2026-06 서울 |
| --- | --- | ---: |
| 거주자 | `Y` | 9,224,532 |
| 거주불명자 | `N` | 32,865 |
| 재외국민 | `O` | 32,416 |
| **Sum** | | **9,289,813** |
| **전체 (what we ingest)** | *(empty)* | **9,289,813** ✅ |

Foreign residents (외국인) are excluded throughout: this is a *resident
registration* (주민등록) statistic covering Korean nationals.

Values are **month-end** (the population as at the end of the selected month).

---

## 3. Definition eras — confirmed, not assumed

The meaning of the 전체 total changed twice inside the 2008–2026 window. Both
boundaries were **confirmed empirically against the official source** on
2026-07-15 rather than taken from the brief:

| Era | Definition | Confirming evidence (서울) |
| --- | --- | --- |
| **2008-01 → 2010-09** | Before 거주불명자 inclusion | `거주자` breakdown returns **0** at 2010-09 |
| **2010-10 → 2014-12** | 거주불명자 included | `거주자` = 10,160,549 at 2010-10; the 전체 total jumps **10,186,556 → 10,328,915 (+142,359)** across that one boundary — a definitional discontinuity, not migration |
| **2015-01 →** | 거주불명자 **and** 재외국민 included | `재외국민` = **0** at 2014-12, **750** at 2015-01 (5,116 by 2015-06) |

Stored per row so the limitation travels with the data:

| Column | Value |
| --- | --- |
| `population_definition` | `MOIS_RESIDENT_REGISTRATION_TOTAL` (constant across eras) |
| `population_definition_version` | `MOIS_TOTAL_PRE_UNREGISTERED_RESIDENT` / `MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT` / `MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS` |
| `population_comparability_note` | Korean caveat naming the era and what it cannot be compared with |

> **This series is NOT fully comparable end-to-end.** A 2008 value and a 2024
> value are not like-for-like. The platform serves the caveat with every derived
> value and shows it in the dashboard. The definition changes are a
> **comparability limitation, not a reason to discard official data**.

---

## 4. Coverage obtained

| Property | Value |
| --- | --- |
| Requested | 2008-01 → latest available |
| **Latest available (discovered)** | **2026-06** |
| Expected months | **222** |
| Found months (all three 시도) | **222** |
| **Missing months** | **none** |
| Observations | **666** (222 × 3) |
| Rejected records | **0** |
| Source SHA-256 | `6f5dd47c805b3e3c3cbf80251be2766651076b520d2c139c31f7f76bf2a2fa2e` (367,795 bytes) |

Latest-month discovery is dynamic: the official page pre-selects its most
recently published month in `searchMonthEnd`/`searchYearEnd`, which the adapter
reads (`latest_month_from_page`). The ingestion additionally refuses any month
whose values come back non-positive, so a stale page default cannot fabricate a
month.

Spot values (official CSV ↔ database):

| 서울 | Population |
| --- | ---: |
| 2008-01 | 10,201,656 |
| 2024-12 | 9,331,828 |
| 2026-05 | 9,295,082 |
| 2026-06 | 9,289,813 |

---

## 5. Region codes and crosswalks

Three code systems meet here. They are **never joined on numeric resemblance**;
every mapping is validated against the official region name.

| MOIS code | Official name | Canonical SGIS region | Landfill origin |
| --- | --- | --- | --- |
| `1100000000` | 서울특별시 | `KR-SGIS-11` | `KR-SGIS-11` |
| `2800000000` | 인천광역시 | **`KR-SGIS-23`** | **`KR-SGIS-28`** |
| `4100000000` | 경기도 | **`KR-SGIS-31`** | **`KR-SGIS-41`** |

Only **Seoul** is `11` in all three. MOIS and the landfill table use standard
administrative sido codes (11/28/41); the canonical `regions` rows ingested from
SGIS use SGIS's own codes (11/23/31). A record is rejected when its code is
unexpected, its name does not match, its level is not `SIDO`, or more than one
candidate exists for the same region and month.

---

## 6. Schema (migration `0014`)

Additive; every existing annual SGIS row is preserved byte-for-byte.

| Change | Detail |
| --- | --- |
| `reference_month` | `YYYY-MM`; NULL for annual rows |
| `population_temporal_granularity` | `ANNUAL` \| `MONTHLY`; existing rows backfilled to `ANNUAL`, then NOT NULL (model default `ANNUAL`, so every pre-existing annual writer keeps working) |
| `population_definition_version` | era identifier (§3) |
| `population_comparability_note` | served caveat (§3) |
| **Uniqueness** | the table-wide annual `UniqueConstraint` is **replaced** by two granularity-scoped **partial unique indexes**: `uq_regional_population_annual` `(region_id, reference_year, source_id, population_definition) WHERE granularity='ANNUAL'` and `uq_regional_population_monthly` `(region_id, reference_month, source_id, population_definition) WHERE granularity='MONTHLY'`. The annual guarantee is unchanged in strength; twelve monthly rows may now share a `reference_year`. |
| Checks | a `MONTHLY` row must carry a month and an `ANNUAL` row must not; `reference_month` must look like `YYYY-MM` |
| Indexes | `ix_regional_population_reference_month`, `ix_regional_population_month_lookup`, `ix_regional_population_year_lookup` |

**Downgrade** is explicit and safe: it **refuses** to run while monthly rows
exist, because the annual schema cannot represent them and converting them would
fabricate year-level observations the source never published. Delete the monthly
series deliberately first.

---

## 7. Ingestion

```bash
# from the repository root; DATABASE_URL must point at the target database
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  mois-population-ingest --scope capital-region --start-month 2008-01 --dry-run

PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  mois-population-ingest --scope capital-region --start-month 2008-01 --write
```

`--end-month` defaults to the latest month the official page reports as
published. `--source-file PATH` ingests an officially downloaded CSV instead of
the live download (for hosts that cannot reach jumin.mois.go.kr).

### Dry-run procedure (mandatory before any write)

The dry run performs **no database writes** and reports: requested range,
discovered official range, dataset name, acquisition method, expected vs. found
month counts, missing months, per-month three-region coverage, duplicates,
rejected records, MOIS codes and official names, definition-era counts, the
source SHA-256, and intended insert/update/unchanged counts.

**Do not proceed when** a requested month is missing, a 시도 is missing from any
month, a duplicate or ambiguous row exists, the definition is unclear, or the
response cannot be validated as official MOIS data. The command exits non-zero
in those cases.

### Guarantees

Idempotent upsert (a re-run reports `0 inserted / 0 updated / N unchanged`);
atomic transaction; provenance recorded (`source_id`, retrieval timestamp,
source SHA-256, transformation version, ingestion run id, sanitized raw-response
envelope); no credentials are involved, printed, or persisted (this source needs
none).

### Raw-data retention

Raw official CSVs belong in **`data/raw/mois_population/`**, which is
Git-ignored. **Raw MOIS files are never committed.** The database stores only the
file's SHA-256 and byte length in the raw-response envelope, so any stored row
can be traced back to the exact official bytes without republishing them.

---

## 8. Denominator policy (v1 → v2)

| | v1 (`landfill-fee-per-capita-v1`) | **v2 (`landfill-fee-per-capita-v2`)** |
| --- | --- | --- |
| Denominator source | SGIS annual total population | **MOIS monthly resident registration** |
| Alignment | same reference **year** | **exact required month** |
| Unit | KRW/인 | KRW/인 |
| Missing-denominator reason | `NO_MATCHING_POPULATION_YEAR` | **`NO_MATCHING_POPULATION_PERIOD`** |

```
주민 1인당 환산 반입수수료(v2)
  = 선택 기간의 공식 반입수수료 ÷ 필요한 기준월의 공식 주민등록 인구(동일 광역지자체)
```

Exact `Decimal`, `ROUND_HALF_EVEN`, 2 dp.

### The required denominator month

| Selection | Denominator month |
| --- | --- |
| **A month** | **that exact `YYYY-MM`** — never the previous/next month, December, the latest month, or another year |
| **A complete landfill year** | **`YYYY-12`** (December month-end of the same year) |
| **A partial landfill year** | **the final month actually included in the fee numerator** |

The partial-year rule is load-bearing: MOIS has published **2026-06** while
landfill fees run only through **2026-05**, so the 2026 value is
`2026-01…2026-05 fee ÷ 2026-05 population`. A population month is **never**
allowed to post-date the fee it denominates.

### All-origin aggregate

`Σ fee ÷ Σ same-month population` — a population-weighted ratio, **never the mean
of the three regional values**. Not published when partially covered: if any
included origin lacks the required denominator, the aggregate is `null` with
`INCOMPLETE_POPULATION_COVERAGE`.

### Unavailability

Always `null` + a served reason, **never zero**:
`NO_MATCHING_POPULATION_PERIOD`, `NO_METROPOLITAN_POPULATION`, `ZERO_POPULATION`,
`AMBIGUOUS_POPULATION_DEFINITION`, `INCOMPLETE_POPULATION_COVERAGE`.

The v2 resolver accepts a denominator only when `source_id =
mois_resident_population`, `population_definition =
MOIS_RESIDENT_REGISTRATION_TOTAL`, `population_temporal_granularity = MONTHLY`,
`region_level = SIDO`, the reviewed crosswalks match the official name, the month
is exactly the required one, the population is > 0, and the provenance is
unambiguous. **SGIS rows are excluded in SQL** and can never be a landfill
fallback. SGIS remains the Equity/reporting denominator, unchanged.

### Known coverage limit

Landfill data starts **1999-08**, MOIS population at **2008-01**. Landfill periods
before 2008 therefore serve `null` + `NO_MATCHING_POPULATION_PERIOD` — an honest
gap, never back-filled.

---

## 9. Refresh procedure

The source publishes monthly. To pick up a new month:

1. `... mois-population-ingest --scope capital-region --start-month 2008-01 --dry-run`
   and confirm `missing_months` is empty and `found_month_count ==
   expected_month_count`.
2. `... --write`.
3. Re-run `--dry-run` (or `--write`) and confirm idempotency
   (`0 inserted / 0 updated`).

No code change is needed for a new month: the latest month is discovered from the
official page. If MOIS revises a previously published month, the upsert updates
that row in place and refreshes its provenance; the change is visible as
`rows_updated > 0`.

---

## 10. Production verification

```bash
curl -fsS "$BASE/api/v1/landfill/summary?year=2008"   # population_reference_period 2008-12
curl -fsS "$BASE/api/v1/landfill/summary?year=2024"   # 2024-12
curl -fsS "$BASE/api/v1/landfill/summary?year=2025"   # 2025-12
curl -fsS "$BASE/api/v1/landfill/summary?year=2026"   # final landfill month (2026-05)
curl -fsS "$BASE/api/v1/landfill/summary?year=2024&month=7"  # exactly 2024-07
```

Expected on every served value: `derivation_version = landfill-fee-per-capita-v2`,
`population_source_id = mois_resident_population`,
`population_temporal_granularity = MONTHLY`, and the personal-payment caveat. The
browser must never contact `jumin.mois.go.kr` — ingestion is backend-only, and the
Playwright guard fails the suite if it does.
