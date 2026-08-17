# Page 1 / Page 2 — frontend-only production deployment (2026-08-17)

**Production URL:** <https://waste-161-33-2-143.sslip.io/>
**Host:** `ubuntu@161.33.2.143` (OCI) · project dir `/home/ubuntu/waste-equity-platform` ·
compose project `waste-equity-prod`
**Result:** GREEN. Two frontend-only releases were deployed in sequence; no rollback was
required at any point.

---

## 1. Deployed branch and SHAs

`fix/frontend-page1-page2-figma-remediation-20260817`

| # | SHA | What | Deployed |
| --- | --- | --- | --- |
| 1 | `eb7849e5c573266df526c28f4ae2d719b62b2ffe` | the validated Page 1 / Page 2 Figma remediation | 2026-08-17, smoke GREEN |
| 2 | `f01d3bfed78f1e49f8ddf86f325d0c6288518c44` | owner-directed removal of nine Page-2 KPI caveat/provenance lines | 2026-08-17, smoke GREEN |

**CURRENT PRODUCTION FRONTEND BASELINE:**

```
fix/frontend-page1-page2-figma-remediation-20260817 @ f01d3bfed78f1e49f8ddf86f325d0c6288518c44
```

Production `git` HEAD is DETACHED at `f01d3bf`. `main` was **not** merged and is behind it.

---

## 2. Why there are two deployments

`eb7849e` was deployed and smoked GREEN across Pages 1–6. The owner then reviewed the live
Page 2 and directed that nine visible caveat / provenance lines be removed outright from the
KPI row. That collided with an explicit in-repo contract, so the decision was put to the
owner rather than resolved silently:

> `docs/YEOGIDA_UI_REDESIGN_SPEC.md` §9 — "Critical analytical / data-limitation notices
> **must remain visible** and must not be hidden by default."

The owner chose **완전히 삭제 + 스펙 개정** (delete outright, amend the spec) over relocation
and over `sr-only`. `f01d3bf` implements that and amends §9 as §9.1 so the removal is
recorded rather than read as drift.

---

## 3. Local release preflight

Worktree `/Volumes/WASTE_QA2/worktrees/frontend-page1-page2-figma-remediation`
(shell bootstrapped with `source /Volumes/WASTE_QA2/recovery-env.sh`).

- Branch `fix/frontend-page1-page2-figma-remediation-20260817`, tree clean, in sync with
  `origin` at each build.
- `docs/research/PAGE1_PAGE2_FIGMA_REMEDIATION_20260817.md` present and read before deploy.
- **Lineage:** production's then-current frontend `be93abb` is the direct parent of
  `eb7849e` (2 commits), and `eb7849e` is the direct parent of `f01d3bf` (1 commit). Linear,
  no merge, nothing unrelated pulled in.

### Scope of `be93abb` → `eb7849e` (12 files)

`docs/research/PAGE1_PAGE2_FIGMA_REMEDIATION_20260817.md`, `frontend/src/lib/metrics.ts`,
`frontend/src/app/page.equityDashboard.test.tsx`, `LandfillDashboard.tsx(+test)`,
`landfill/{LandfillFilterPanel,LandfillGenerationScatter,LandfillHeadlineResults(+test),
LandfillRegionTable,LandfillTrendSection,MunicipalCostSection}.tsx`.

### Scope of `eb7849e` → `f01d3bf` (6 files)

`docs/ANALYTICAL_METHODS.md`, `docs/YEOGIDA_UI_REDESIGN_SPEC.md`,
`frontend/src/components/LandfillDashboard.tsx(+test)`,
`frontend/src/components/landfill/LandfillHeadlineResults.tsx(+test)`.

**Verified NO changes under `backend/`, `migrations/`, `ingestion/`** for either release, and
no `package.json` / `package-lock.json` / Dockerfile / compose change. Re-verified on the
production host with `git diff --name-only` before each checkout.

---

## 4. Production read-only preflight (before the first deploy)

| Item | Value |
| --- | --- |
| git HEAD | detached at `be93abb` |
| frontend | `waste-equity-prod-frontend:latest` = `7ded3a14d766`, healthy |
| backend | `waste-equity-prod-backend` = `89173f47a9ec`, healthy, up 2 days |
| database | `postgis/postgis:16-3.4` = `44126d872ac9`, healthy, up 4 weeks |
| caddy | `caddy:2.10-alpine` = `4c6e91c6ed0e`, up 2 weeks |
| Alembic | `0021 (head)` |
| disk | 160 G free of 193 G (18 % used) |
| memory | 8.0 G available of 11.9 G |
| HTTP | `/` 200, `/health` 200 (`/api/v1/health` is 404 — that route does not exist) |

Nothing was modified during this step.

---

## 5. Rollback points

| Tag | Image ID | Corresponds to |
| --- | --- | --- |
| `waste-equity-prod-frontend:rollback-be93abb` | `7ded3a14d766` | pre-deploy production |
| `waste-equity-prod-frontend:eb7849e` | `46592affceba` | release 1 (proven green) |
| `waste-equity-prod-frontend:f01d3bf` | `933b6efee8dc` | release 2 = current `:latest` |
| `waste-equity-prod-frontend:rollback-5148caa` | `73f009e0abf6` | pre-existing, untouched |

No old image was removed. Rollback for the current baseline is a one-liner that touches only
the frontend service:

```bash
docker tag waste-equity-prod-frontend:eb7849e waste-equity-prod-frontend:latest && docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production up -d --no-deps --force-recreate frontend
```

No database backup was taken: no migration was permitted or performed.

---

## 6. Build and replacement

For each release, on the host: `git fetch` the branch → `git checkout --detach <SHA>` →
confirm clean tree and that `backend/alembic/versions/` still tops out at `0021` →

```bash
docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production build frontend
docker tag waste-equity-prod-frontend:latest waste-equity-prod-frontend:<SHA>
docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production up -d --no-deps --force-recreate frontend
```

Both builds compiled successfully (4/4 static pages). `deploy.sh` was deliberately **not**
used: it rebuilds the backend and runs migrations, both forbidden here.

`docker compose down` was never run. Postgres was never restarted, recreated or migrated. No
volume was deleted. Caddy was not restarted.

---

## 7. Backend / DB / Caddy unchanged — proof

After the final deployment:

| Service | Image (running) | Status |
| --- | --- | --- |
| frontend | `sha256:933b6efee8dc…` | **changed** (intended), healthy |
| backend | `sha256:89173f47a9ec…` | unchanged, **up 2 days** (uptime unbroken) |
| database | `sha256:44126d872ac9…` | unchanged, **up 4 weeks** (uptime unbroken) |
| caddy | `sha256:4c6e91c6ed0e…` | unchanged, **up 2 weeks** (uptime unbroken) |

- **Alembic before: `0021 (head)`. Alembic after: `0021 (head)`.**
- No `alembic upgrade` / `downgrade` was invoked. No migration file exists on either SHA
  beyond `20260805_0021_municipal_waste_costs.py`.
- No backend environment variable was changed. The default suitability model was not
  switched and Successor V3 was **not** activated or deployed.
- No Page 4 / Page 5 / Page 6 branch was merged.

---

## 8. Local validation gate for `f01d3bf`

Run on node 22.22.0 (vitest cannot start on node 20 — `std-env` is ESM-only):

| Gate | Result |
| --- | --- |
| unit suite | **88 files passed, 1 skipped; 2164 passed, 7 skipped, 0 failed** |
| typecheck | clean |
| lint | **0 errors**, 1 warning (`page.phase0.test.tsx` unused `SUITABILITY_SCREENING_DISCLAIMER` — pre-existing on the base, see remediation report §24) |
| production build | green, compiled in 26.6 s, 4/4 static pages |

Ten tests went stale on the intentional removal. **None was weakened** — each was re-pointed
at the surface that still makes the claim:

- the three population-denominator tests now assert the exact month in `근거와 한계`
  (`landfill-population-period`), so the denominator contract is still enforced;
- "never implies an actual payment" keeps its `세금` / `납부액입니다` prohibitions;
- the served-caveat-list assertion (`landfill-caveats`) is untouched;
- the distinction test now asserts the wording in `municipal-cost-section`, where the
  amounts actually are;
- the KPI value-vs-explanation hierarchy test asserts that the cost card now has **no**
  caption, so its absence is an intentional state rather than a coverage gap.

---

## 9. Page 1 smoke — PASS

Verified at 1440×900 with Playwright/Chromium against production.

| Check | Result |
| --- | --- |
| loads | PASS, `<h1>` = `지역 지표` |
| navigation label correct | PASS (`지역 지표` … `데이터·출처`, 6 destinations) |
| six facility categories | PASS — 6/6 |
| four waste metrics | PASS — 4/4 (생활계 / 사업장 비배출 / 사업장 배출 / 건설) |
| Korean unit `명` | PASS (`단위 명`, legend `명`, `< 151,306명`) |
| rankings work | PASS — Top 10 of **79개 지역**, 경기도 화성시 1,004,079 first |
| map works | PASS — hover over a region yields `cursor: pointer`; click selects **서울특별시 용산구 · 203,401명** |
| the four helper lines absent | PASS — 0 of 4 present |
| missing data not shown as zero | PASS — legend carries `— 데이터 없음`; no `0명` |

**Note on the in-app browser pane:** it reported a permanently-stuck `지도를 불러오는 중…`
and no choropleth. That was an artifact of the pane, disproved by Playwright (pointer cursor
and a real region selection). The map is fine. Consistent with the known "stale screenshot
frames" behaviour of that pane.

---

## 10. Page 2 smoke — PASS

| Check | Result |
| --- | --- |
| loads | PASS, `<h1>` = `지역별 폐기물 처리 현황` |
| dense KPI composition | PASS — navy hero + 3, widths 260/260/260/559 |
| 총 폐기물 발생량 card | PASS — `59,638,313 t`, badged 계산값 |
| 총 시설 처리량 card | PASS — `6,865,073 t`, badged 계산값 |
| 수도권매립지 반입량 card | PASS — `1,058,911 t`, 공식 값, YoY −1.2 %, 최대 지역 경기도 45.6 % |
| 폐기물 관리비용 card | PASS — 1,055.2억원 공식 값, 99,654 원/t, 4,046원/인, 수집·운반 지급액 66/38/8/20곳 |
| monthly LINE chart | PASS — exactly 1 `<polyline>` with **12 vertices** (one per served month) |
| regional scatter | PASS — 83 points |
| regional detail table | PASS |
| Excel export available | PASS |
| missing values remain missing | PASS — no `0 t` anywhere in the KPI row; 자료 없음 20곳 stated as a count, not a zero |
| municipal cost semantics intact | PASS — no `합계` total, no `원/t` or `원/인` on the contract column |
| page height | 3,623 px (was 3,775 before the removal) · no horizontal overflow |
| console errors / HTTP 5xx | **none** |

### The two forbidden ratios — ABSENT

`발생량 대비 처리 규모` and `발생량 대비 반입 비율` do **not** appear as analytical figures
anywhere on Pages 1–6. They occur only as source-code comments explaining why they are
refused.

### The ten owner-removed lines — ABSENT

All ten exact strings the owner quoted are absent from the **entire page**, not merely from
the KPI row:

```
exactStringsStillAnywhereOnPage: []
exactStringsStillInKpiRow:       []
```

Three *fragments* legitimately survive elsewhere, by design and documented in §9.1:

| Fragment | Where it survives | Why |
| --- | --- | --- |
| `발생지 기준` | scatter x-axis caption | it labels an axis, not a KPI card |
| `시설 소재지 기준` | scatter y-axis caption | same |
| `위 수도권매립지 반입수수료와 다른 자료입니다` | `시·군·구별 상세 보기` section | the distinction is still made where the amounts are |

### What deliberately survived

- `CROSS_BASIS_NOTICE` still renders **visibly** under the KPI row —
  "발생량은 발생지 기준, 시설 처리량은 시설 소재지 기준입니다. 서로 나누거나 빼서 처리율로
  읽을 수 없습니다." The prohibition on dividing the two adjacent tonnages is intact.
- Provenance badges intact: 6 × `data-status="reported"`, 44 × `data-status="derived"`.
- `근거와 한계` still carries both reference periods (`수수료 기준 2025`,
  `인구 기준 2025-12`) and the MOIS population source, so the per-resident conversion is
  still reproducible from the page.

---

## 11. Pages 3–6 regression smoke — PASS

Historical production behaviour, **not** Successor V3, as required.

| Page | `<h1>` | Result |
| --- | --- | --- |
| 3 | `후보지 분석` | loads, not blank, no crash |
| 4 | `후보지 심층 분석` | loads, 5,980 chars, no crash — current historical behaviour |
| 5 | `후보지 심층 비교` | loads, 2,173 chars, no crash — current historical behaviour |
| 6 | `데이터·출처` | loads, 9,298 chars, no crash |

No 500 / 502 / 503 on any page. No console errors. Navigation works across all six
destinations. Backend, database and Caddy all healthy.

---

## 12. REQUIRED FUTURE V3 INTEGRATION NOTE

**The final Successor-V3 release candidate MUST preserve `f01d3bf`, not merely `eb7849e`.**

`f01d3bf` is now the production frontend baseline. It contains:

1. the Page 1 / Page 2 Figma remediation (`7d1fdda`, `eb7849e`), **and**
2. the owner-directed Page-2 KPI removals plus the `YEOGIDA_UI_REDESIGN_SPEC` §9.1
   amendment.

Risks the Backend Master / Final Release Coordinator must handle:

- Every `page4*` / `page5*` / `page6*` / V3 branch forks from an **older** frontend. Starting
  the V3 RC from any of them silently reverts both (1) and (2) — reinstating text the owner
  explicitly ordered deleted, on a public site.
- Verify containment by `git merge-base --is-ancestor f01d3bf <rc>`. If the RC was built by
  cherry-pick, `--is-ancestor` will fail by design; prove containment by patch-id instead.
- The §9.1 spec amendment must survive the merge. If a V3 branch reintroduces the removed
  lines because it predates this change, that is a **conflict to resolve in favour of
  `f01d3bf`**, not a spec violation to "fix".
- `f01d3bf` requires no migration. Production is at Alembic `0021`; any V3 RC that ships
  `0022` / `0023` owns that migration decision separately — it is out of scope here and was
  not applied.

---

## 13. Deployment record

| Field | Value |
| --- | --- |
| Deployment date | 2026-08-17 |
| Production URL | <https://waste-161-33-2-143.sslip.io/> |
| Branch | `fix/frontend-page1-page2-figma-remediation-20260817` |
| Deployed SHA (final) | `f01d3bfed78f1e49f8ddf86f325d0c6288518c44` |
| Previous frontend image | `waste-equity-prod-frontend:eb7849e` = `46592affceba` (before that, `rollback-be93abb` = `7ded3a14d766`) |
| New frontend image | `waste-equity-prod-frontend:f01d3bf` = `933b6efee8dc` (= `:latest`) |
| Backend image | `89173f47a9ec` — **unchanged** |
| Database | `44126d872ac9` — **unchanged**, up 4 weeks |
| Alembic | `0021 (head)` — **unchanged**, no migration run |
| Caddy | `4c6e91c6ed0e` — **unchanged**, not restarted |
| Successor V3 | **not** deployed, **not** activated |
| Pages 4/5 behaviour | historical, **unchanged** |
| Rollback required | **no** |

---

PAGE 1/2 FRONTEND PRODUCTION DEPLOYMENT GREEN
