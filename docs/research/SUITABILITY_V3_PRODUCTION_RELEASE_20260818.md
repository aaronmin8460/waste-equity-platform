# Suitability Successor V3 — production release

**Production URL:** https://waste-161-33-2-143.sslip.io/
**Deployed branch:** `release/v3-final-rc-20260817`
**Deployed RC SHA:** **`0d541e3`**
**Deployed:** 2026-08-18 ~04:15–04:22 UTC
**Verdict:** PRODUCTION GREEN

---

## 1. What was deployed, and what it does not do

The full integrated RC — **not** the isolated backend handoff `b93393a`. The RC
carries integration-only fixes that exist in no component branch: successor
rank/score serving, `top_candidates`, `top_stable`, MVT tile score/rank,
candidate list and detail, and model-aware stability semantics.

**This release ships the V3 capability, not a V3 user experience.** No successor
run exists in production, and `DEFAULT_COMPONENT_MODEL` remains historical, so
nothing a user sees has changed. That is the intended rollout gate.

### Handoffs contained in `0d541e3`

| handoff | SHA |
| --- | --- |
| backend | `b93393a` |
| Page 1 / Page 2 code | `f01d3bf` |
| Page 4 | `36cdb33` |
| Page 5 | `4910cc5` |
| Page 6 | `49be6e5` |

---

## 2. Before / after

| | before | after |
| --- | --- | --- |
| repo SHA | `f01d3bf` | **`0d541e3`** |
| alembic | `0021` | **`0023`** |
| frontend image | `933b6efee8dc` (`:f01d3bf`) | **`6296f80d4057`** (`:0d541e3`) |
| backend image | `89173f47a9ec` | **`59cfd8e14d02`** (`:0d541e3`) |
| runs' `component_model_version` | column absent | all three = `suitability-components-zred-v1` |
| containers | 4 healthy | 4 healthy |

Caddy and PostgreSQL were **not** touched. No `docker compose down`, no volume
removed, no database recreated.

---

## 3. Backup (retained)

| | |
| --- | --- |
| path | `/home/ubuntu/backups/pre_v3_0021_20260818T041458Z.dump` |
| size | 23,923,809 bytes |
| format | `pg_dump -Fc`, tables `suitability_analysis_runs` + `suitability_candidates` |
| verification | `pg_restore -l` → 4 entries (TABLE + TABLE DATA for both) |
| SHA256 | `362dd5cc5c55af5ce4fb4faec05bc6d666c9a008a8bf3b6ebc8fb9e9aeb66abd` |

**Retained after deployment.**

---

## 4. Migration `0021 → 0022 → 0023`

Run **explicitly** via `compose run --rm backend alembic upgrade head` *before* any
container was restarted. That ordering was deliberate: the production backend's own
command is `alembic upgrade head && uvicorn …`, so `up -d backend` would otherwise
have migrated as a side effect, with the schema change and the traffic switch
happening together and unverifiable in between.

Both revisions are pure `add_column` with constant `server_default` — metadata-only
in PostgreSQL 11+, no table rewrite, no data migration (verified: three
`add_column` calls, zero `execute`/`alter_column`/`bulk_insert`).

### Integrity, before vs after — identical

| measure | pre-migration | post-migration |
| --- | --- | --- |
| candidate rows | 143,679 | **143,679** |
| scored | 36,101 | **36,101** |
| ranked | 36,101 | **36,101** |
| runs | 1, 47, 48 all SUCCEEDED | unchanged, all labelled `zred-v1` |
| `candidate_count_eligible` | 1,099 / 17,501 / 17,501 | unchanged |
| `component_scores` populated | n/a | **0** — all 143,679 rows `{}`, nothing backfilled |

---

## 5. Post-deploy verification

### Backend
`/health` **200** (`status ok`, `database ok`, `app_env production`), alembic stable
at `0023`, all runs now report their component model, and
`/api/v1/suitability/summary` resolves to **run 48, `suitability-components-zred-v1`**
— the historical default.

`top_stable_candidates` returns **10** on production run 48. This is the first real
validation of the RC's class-based STABLE query against a run that actually carries
stability data — the local snapshot had none.

### Successor capability (no run exists)

| request | result |
| --- | --- |
| `runs?component_model_version=…successor-v1` | **200** `{"count":0,"runs":[]}` |
| `summary?component_model_version=…successor-v1` | **404** `NO_ANALYSIS_AVAILABLE`, naming the model |
| `summary?component_model_version=bogus-model-v9` | **422** `UNKNOWN_COMPONENT_MODEL`, listing known models |

No 500, no fabricated ranking, no fabricated zeros, and an unknown model is refused
rather than silently defaulted.

**NO PRODUCTION SUCCESSOR RANKING EXISTS YET.** None was manufactured for validation.

### Pages 1–6 smoke, real browser at 1440×900

| page | result |
| --- | --- |
| 1 지역 지표 | six-item nav; **all four removed helper lines absent**; six facility categories; 명 unit; 데이터 없음; overflow 0 |
| 2 지역별 폐기물 처리 현황 | hero = **총 폐기물 발생량** (30px) vs 반입량 (24px); **line chart, 12 points**; 3 region rows; **forbidden ratios absent**; summary = period only; overflow 0 |
| 3 후보지 분석 | loads; missing≠zero legend ("0이 아님 · 계산 제외"); overflow 0 |
| 4 후보지 심층 분석 | **historical default**, Z/R/E/D truthful (Z 35%, R 25%); ranking populated with real scores; map styled; stability badge **"조건부 안정 2/3"** — historical denominator; no V3 cards; legal disclaimer present; overflow 0 |
| 5 후보지 심층 비교 | full Z/R/E/D scenario contract; **no fabricated successor components**; no false 민감도 분석 claim; overflow 0 |
| 6 데이터·출처 | h1 `데이터·출처`; four successor components at **25%** each; successor limit list present; **한눈에 보기 heading absent**; overflow 0 |

No 500 / 502 / 503 on any page or API path. `docker ps`: 4 containers healthy.

---

## 6. Observations, not defects

1. **Raw enums in the technical assumptions block.** `REVIEW_REQUIRED` /
   `OFFICIAL_SOURCE_UNAVAILABLE` appear in the English methodology strings served in
   `summary.assumptions` and rendered under `score-basis-assumptions`. **Pre-existing
   and unchanged by this release** — the same string is present at `f01d3bf`. User-facing
   status labels correctly read 스크리닝 통과 / 추가 검토 필요 / 프로젝트 스크리닝 제외.
2. **`CRITIC` on Page 6** appears only inside collapsed technical disclosures, stating
   "진단 전용, 점수 계산·저장·제공에 사용하지 않음". The two uncollapsed hits belong to
   Page 5's scenario lab, which stays mounted in the DOM.
3. **`최신 완결연도` on Page 2** is an `<option>` label in the year select, not restored
   caveat prose.

---

## 7. Rollback (retained, unused)

| artifact | value |
| --- | --- |
| frontend | `waste-equity-prod-frontend:f01d3bf` = `933b6efee8dc` |
| backend | `waste-equity-prod-backend:rollback-pre-v3` = `89173f47a9ec` |
| database | backup above, verified restorable |

Schema rollback would be `alembic downgrade 0021`; it is safe here because **no
successor run exists**, so no row depends on `component_scores`. Not required — the
0022/0023 columns are additive and the previous backend ignores them.

---

## 8. Default model — unchanged, deliberately

`DEFAULT_COMPONENT_MODEL` remains `suitability-components-zred-v1`. No product-owner
approval to switch the production default exists. Verified live: the unpinned
`/summary` resolves to run 48, historical.

Page 4's V3 factor cards are implemented and tested but **unreachable through the
UI** — the frontend never sends `component_model_version`. Making V3 visible requires
a separate, explicit rollout decision: flip the default, or ship a model selector.

**Expected. Not a deployment failure.**
