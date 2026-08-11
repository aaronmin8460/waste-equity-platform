# Suitability ranking scope filters (Page 4B API contract)

`GET /api/v1/suitability/candidates` gained a repeatable SIGUNGU scope and an explicit
ranking direction so Page 4 can offer 수도권 전체 / 서울 / 인천 / 경기, a multi-select of
시군구, and 높은 순 / 낮은 순 over a scoped total.

This phase is **query-layer only**. No score, weight, screening status, stability class,
rank methodology, CRITIC derivation, `policy_version`, or `derivation_version` changed,
and there is **no database migration**. The endpoint still ranks **500 m candidate
cells** — see [No SIGUNGU aggregation](#no-sigungu-aggregation).

---

## 1. The region code space (verify this before writing any query)

`suitability_candidates.sido_region_code` and `sigungu_region_code` are copied verbatim
from `regions.region_code` by the engine's centroid assignment
(`analysis/suitability/engine.py::_build_grid`), and `regions.region_code` is derived as
`KR-SGIS-{adm_cd}` (`docs/REGION_CODE_STRATEGY.md`). So the stored values are:

| Level | Stored form | Values |
| --- | --- | --- |
| SIDO | `KR-SGIS-<2 digits>` | `KR-SGIS-11` 서울 · `KR-SGIS-23` 인천 · `KR-SGIS-31` 경기 |
| SIGUNGU | `KR-SGIS-<5 digits>` | e.g. `KR-SGIS-11010` 종로구, `KR-SGIS-31091` 안산시 상록구 |

Verified against the local dev database, run 47 (47,893 cells):

| `sido_region_code` | name | cells |
| --- | --- | --- |
| `KR-SGIS-11` | 서울특별시 | 2,470 |
| `KR-SGIS-23` | 인천광역시 | 4,104 |
| `KR-SGIS-31` | 경기도 | 41,319 |

These match `docs/LAND_COVER_CANDIDATE_CELL_STATISTICS.md`, which measured the same grid
through a completely separate join.

### Two neighbouring code spaces that are NOT this one

* **Landfill / MOIS administrative sido codes `11 / 28 / 41`.** Incheon and Gyeonggi
  differ from SGIS (`28→23`, `41→31`). `ALLOWED_ORIGIN_REGION_CODES` and
  `/municipal-costs?sido=` use that space; the suitability API does not. Sending
  `sido=28` here returns **zero rows**, never Incheon's candidates.
* **The frontend `ScopeSelection` space** (`frontend/src/lib/ranking.ts`) is the *bare*
  2-digit SGIS code `"11" | "23" | "31"`. It is the right region, in an abbreviated
  spelling.

Because the canonical code is exactly `KR-SGIS-` + the source code, the bare SGIS form is
unambiguous, so the API **accepts both spellings and normalizes to canonical**:

```
sido=KR-SGIS-11   ≡   sido=11
sigungu=KR-SGIS-11010   ≡   sigungu=11010
```

Normalization only prepends the prefix to an all-digit value. A non-numeric,
non-canonical value is passed through untouched, so an unrecognized code stays
unrecognized and matches nothing rather than being coerced into something plausible.

### SGIS SIGUNGU codes are not 행정표준코드

SGIS numbers 시군구 with its own sequence. **종로구 is `KR-SGIS-11010`, not `…11110`**
(`KR-SGIS-11110` is 노원구). Do not derive these codes; read them from the API.

### Large Gyeonggi cities are stored at 일반구 granularity

The Figma ranks city names, but the stored geography splits the big cities:

| Figma city | Stored SIGUNGU codes |
| --- | --- |
| 안산시 | `KR-SGIS-31091` 상록구, `KR-SGIS-31092` 단원구 |
| 고양시 | `KR-SGIS-31101` 덕양구, `KR-SGIS-31103` 일산동구, `KR-SGIS-31104` 일산서구 |
| 수원시 | `KR-SGIS-31011` 장안구, `…31012` 권선구, `…31013` 팔달구, `…31014` 영통구 |
| 시흥시 | `KR-SGIS-31150` (single code) |

This is precisely why the parameter is repeatable and OR-ed: one Figma city can be
several codes.

### `sido` and `sigungu` are assigned independently — do not combine them

The engine resolves the two codes with two separate `ST_Covers` lookups against the SIDO
and SIGUNGU boundary layers. Those layers are not perfectly coincident, so in run 47:

* **553 cells have `sigungu_region_code = NULL`** (a SIDO covers the centroid, no SIGUNGU
  does). They can never satisfy a SIGUNGU filter.
* **137 cells carry a SIDO/SIGUNGU pair whose prefixes disagree** (e.g. `sido=KR-SGIS-11`
  with a `KR-SGIS-31…` sigungu, at the boundary).

So "서울" has three different totals depending on how it is expressed:

| Scope expression | cells |
| --- | --- |
| `sido=KR-SGIS-11` | **2,470** |
| union of every `KR-SGIS-11…` SIGUNGU code | 2,424 |
| both together (they AND) | 2,392 |

**Rule for Page 4:** use `sido` alone for 서울/인천/경기, and `sigungu` alone for a
시군구 multi-select. Sending both intersects them and silently drops the boundary cells.

---

## 2. Parameters

Everything below is additive; every previously valid request behaves exactly as before.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `run_id` | int | latest SUCCEEDED | unchanged |
| `profile` | `baseline` \| `equal` \| `equity_focused` \| `access_focused` \| `critic` | `baseline` | unchanged |
| `bbox` | `minLon,minLat,maxLon,maxLat` | — | unchanged |
| `sido` | string | — | **now normalizes** the bare form |
| `sigungu` | string, **repeatable** | — | **was single-valued**; repeat for OR |
| `status` | `ELIGIBLE` \| `REVIEW_REQUIRED` \| `EXCLUDED` | — | unchanged; ignored when `top` is set |
| `stability_class` | `STABLE` \| `CONDITIONALLY_STABLE` \| `WEIGHT_SENSITIVE` | — | unchanged |
| `min_score` / `max_score` | float 0–100 | — | unchanged |
| `top` | int 1–5000 | — | unchanged; restricts to ELIGIBLE with a rank |
| `limit` | int 1–5000 | 500 | unchanged |
| `offset` | int ≥ 0 | 0 | unchanged |
| `sort` | **`score_desc` \| `score_asc`** | `score_desc` | **new** |

### `sigungu` — repeated query parameter

```
?sigungu=KR-SGIS-31091&sigungu=KR-SGIS-31092
```

* **Zero values** (absent, or present only as empty strings) → **no SIGUNGU restriction**.
  A cleared multi-select must not blank the ranking, so it is never read as "match none".
* **One value** → equivalent to the previous single-valued behaviour.
* **Multiple values** → `IN (…)`, i.e. **OR**.
* **Duplicates** collapse; repeating a code cannot change the rows or the count. Mixed
  spellings of one region (`31091` and `KR-SGIS-31091`) collapse to one code.
* **Unknown or malformed codes** yield an **empty result, not an error** — no 500.
* Composes with `sido`, `status`, `stability_class`, `profile`, `bbox`, and the score
  band by **AND**.

### `sort` — ranking direction only

A closed two-value vocabulary, deliberately **not** a sort-field selector: no caller can
reorder the screening by a column the methodology did not rank on. Anything else is the
project's standard `422`.

* `score_desc` (**default**, byte-identical to the pre-existing ordering) — highest score
  first, i.e. rank 1 first.
* `score_asc` — lowest-**scored** first.

A better score is a numerically smaller rank, so this flips the direction of the same
rank ordering. **Candidates with no score for the profile (REVIEW_REQUIRED, EXCLUDED)
stay last in both directions** — an unscored cell is not "the lowest-scoring one".
`candidate_key` is the deterministic tie-break, so paging is stable in both directions.

With `top=N`, `sort` selects **which end** the N rows are drawn from: `top=10&sort=score_asc`
returns the 10 lowest-scored eligible cells, not the top 10 reversed.

Note that `sort` and `profile` act on different orderings, which is pre-existing
behaviour: `top` orders by the **requested profile's** rank, while the unbounded listing
orders by the indexed first-class `rank` column (the run's **active** profile). Use `top`
when the profile must drive the order.

---

## 3. Counting: `total_matched`

`total_matched` already existed and is preserved. It is counted by the database over the
**same `WHERE` clause the page is drawn from**, and is never inferred from the page
length, so Page 4's `표시 N개 · 범위 내 M개` reads directly:

* `count` → 표시 N개 (rows on this page)
* `total_matched` → 범위 내 M개 (rows matching every filter)

`total_matched` is unaffected by `sort`, and with `top` it counts the whole eligible set
the page is drawn from (existing behaviour).

### New echo fields

The response now also echoes the scope and ordering **actually applied**, after
normalization and de-duplication, so a caller can confirm the server read its scope the
way it meant it instead of inferring that from an empty result:

```jsonc
{
  "count": 100,
  "total_matched": 610,
  "limit": 100,
  "offset": 0,
  "sido": "KR-SGIS-31",                                  // canonical, or null
  "sigungu": ["KR-SGIS-31091", "KR-SGIS-31092"],         // canonical, deduped, [] if unscoped
  "sort": "score_desc"
}
```

All three are additive. Every pre-existing field keeps its name, type, and value.

---

## 4. Example requests

```
# 수도권 전체, 높은 순 (identical to the pre-existing default call)
/api/v1/suitability/candidates?profile=baseline&limit=100

# 서울 — either spelling
/api/v1/suitability/candidates?sido=KR-SGIS-11&limit=100
/api/v1/suitability/candidates?sido=11&limit=100

# 안산시 (= its two 일반구), ELIGIBLE only, 낮은 순
/api/v1/suitability/candidates?sigungu=KR-SGIS-31091&sigungu=KR-SGIS-31092
  &status=ELIGIBLE&sort=score_asc&limit=20

# Multi-select across sido boundaries, second page
/api/v1/suitability/candidates?sigungu=KR-SGIS-11010&sigungu=KR-SGIS-23510
  &sigungu=KR-SGIS-31150&limit=50&offset=50

# Top 10 of the ranking, critic profile
/api/v1/suitability/candidates?profile=critic&top=10&sort=score_desc
```

### An empty scoped ranking is a real answer

`안산시 + status=ELIGIBLE` returns `total_matched: 0` on run 47 — genuinely, because every
Ansan cell is REVIEW_REQUIRED or EXCLUDED under the documented v1 zoning assumption
(urban land is REVIEW_REQUIRED; there is no industrial high-compatibility score in v1).
Page 4 must render `범위 내 0개` honestly rather than treating it as an error or silently
falling back to an unscoped list.

---

## 5. No SIGUNGU aggregation

The Figma visually appears to rank entities like 안산시 / 시흥시 / 고양시. Production ranks
**500 m candidate cells**, and this phase does not change that. None of the following is
implemented, because each is a methodology decision, not a query concern:

* best cell per SIGUNGU
* mean score per SIGUNGU
* eligible-cell count per SIGUNGU
* area-weighted SIGUNGU score

`sigungu` filters *which cells* are listed. It does not roll cells up into a 시군구 entity.

---

## 6. Compatibility

* Every parameter, field name, type, and value that existed before is unchanged.
* Omitting `sort` produces byte-identical bodies to passing `sort=score_desc`.
* `sigungu` widening from a single string to a repeatable one is backward compatible: a
  single `?sigungu=X` still means `= X`.
* The OpenAPI schema now declares `sigungu` as an array of strings and `sort` as a
  two-value enum.
* Verified: across 21 responses covering all four static profiles (summary, default
  listing, `top`, every pre-existing filter, candidate detail, runs, policies), base and
  branch differ **only** by the three added echo keys — with those stripped, the payloads
  are byte-identical.
