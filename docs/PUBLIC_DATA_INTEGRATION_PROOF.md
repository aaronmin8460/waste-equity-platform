# Public-Data Integration Proof (V2 Phase 0)

Research date: **2026-07-14**. Branch: `research/public-data-integration-proof`.
Scope: research and data-validation only — no schema, migration, ingestion,
production, or application-behavior change was made. All artifacts are preserved
under `backups/public_data_integration_proof_20260714T144735/` (git-ignored).

This report answers the three Phase-0 questions for internet-accessible official
data:

- **A.** Seoul / Gyeonggi / Incheon waste **inbound quantities → Sudokwon Landfill**
- **B.** Official Sudokwon Landfill **waste rates** (quantity × official rate)
- **C.** **KONEPS** public waste-related **contracts**

---

## 1. Executive conclusion

**Verdict: CONDITIONAL GO — blocked pending a free per-dataset authorization
(활용신청). This is explicitly NOT a GO.**

The three required datasets are **real, well-formed, openly licensed, and
programmatically reachable**, and the available `DATA_GO_KR_SERVICE_KEY` is a
**valid, registered data.go.kr key** (proven by a 200/`NORMAL_CODE` control call
to AirKorea). Their **schemas, geography resolution, reference periods, version
history, and licenses were verified from authoritative sources** (the official
data.go.kr dataset pages and the public odcloud OpenAPI/Swagger specs, neither of
which needs a key).

However, **not a single real data row, rate, or contract could be inspected**,
because all three target datasets are not yet 활용신청-authorized for the account
that owns the key:

- Landfill inbound (15064381) and rate (15064397) via odcloud → HTTP 401
  `code -4 "등록되지 않은 인증키 입니다"`.
- KONEPS contracts (15129427) via `apis.data.go.kr/1230000/ao/CntrctInfoService`
  → HTTP 403 Forbidden (real operations 403, a fake operation 404 — proving the
  service exists and the block is authorization, not a bad request).
- The direct CSV download on data.go.kr is login-session gated (returns a detail
  JSON envelope, not file bytes).

Per the project's data-integrity rules and the Phase-0 instruction — *"Do not
declare GO based only on dataset descriptions; the real downloaded files and API
responses must be inspected"* — GO **cannot** be declared. The GO criteria that
require real rows (verified quantity unit, ≥80% rate-join coverage, verified rate
unit/period, KONEPS results for ≥3 municipalities) are therefore **UNVERIFIED**,
not failed.

The blocker is a **genuine access blocker**, but a cheap and resolvable one: a
free, normally auto-approved 활용신청 on the three dataset pages by the account
that holds the key. No code, secret, or production change is required to unblock.

### One-line answers to the three questions

1. **Can official landfill inbound data be parsed and normalized reliably?**
   *Structurally yes* — the schema is trivial and clean (`마감년월, 광역지자체명,
   폐기물명, 반입량(kg)`), 9,212 rows, quarterly, openly licensed, with 17
   quarterly snapshots back to 2021. **But the real file was not obtained**, so
   row-grain, null/dup counts, exact period range, and the exact region tokens
   remain UNVERIFIED.
2. **Can inbound waste types be joined to official rates with verified units and
   periods?** **Partially, and with a hard caveat.** The join can only be by
   **waste name** (`폐기물명`) — the inbound table carries no waste code. The rate
   table has **no unit basis and no effective-date column**, and its price is
   **multi-component** (treatment + landfill-operation + environmental cost). So
   even once authorized, historical cost calculation is **not** cleanly supported
   and rate units are **unverifiable from the data alone**.
3. **Can relevant municipal waste contracts be found and classified via KONEPS?**
   *The API exists and the exact endpoint/parameters are confirmed*, but the key
   is **not authorized** (403), so **no contracts were retrieved or classified**.

---

## 2. Source inventory

Full machine-readable inventory (with SHA-256, license, period, cycle) is in
`backups/…/source_inventory.csv`. Summary:

| source_id | Title (KO) | Issuer | Format | Cycle | License | Live data obtained? |
| --- | --- | --- | --- | --- | --- | --- |
| 15064381 | 수도권매립지관리공사_통합반입관리_수도권폐기물 반입량 | 수도권매립지관리공사 | CSV / odcloud JSON | 분기 | 제한 없음 | **No** (odcloud -4; CSV login-gated) |
| 15064397 | 수도권매립지관리공사_통합반입관리_폐기물정보 (rates) | 수도권매립지관리공사 | CSV / odcloud JSON | 분기 | 제한 없음 | **No** (odcloud -4) |
| 15129427 | 조달청_나라장터 계약정보서비스 (KONEPS) | 조달청 | REST JSON/XML | 실시간 | 제한 없음 | **No** (403 not authorized) |

Preserved artifacts (hashed): `metadata/swagger_15064381.json`
(`08b6daeb…`), `metadata/swagger_15064397.json` (`42e804cb…`),
`original/GATED_selectFileDataDownload_15064381.json` (`c9805726…`, the gated
download response). URL-by-URL results in `backups/…/url_inventory.csv`; full
step log in `backups/…/logs/access_log.md`.

### Related SL-Corp datasets discovered (candidates, not yet inspected)

`15066518` (Seoul annual inbound by year, with 생활/사업장/건설 splits), `15066515`
(Gyeonggi annual inbound by year), `15064394` (폐기물반입수수료 / inbound fee),
`15064606` (지자체 **차량** 반입량 — vehicle-level inbound API), `15064389`
(하절기/동절기 반입기준), `15064374` (음폐수 inbound). These are all 광역-level or
finer-by-vehicle but still SL-Corp destination; worth inspecting once authorized.

---

## 3. Exact source schemas (verified from official Swagger — no key needed)

### A. Inbound 15064381 — data item fields

| Field (KO) | Type | Meaning |
| --- | --- | --- |
| `마감년월` | string | Closing/reference year-month |
| `광역지자체명` | string | **Metropolitan** local-government name (origin) |
| `폐기물명` | string | Waste name (no code) |
| `반입량(kg)` | integer | Inbound quantity, unit **kg** (in the field name) |

Envelope: `page, perPage, totalCount, currentCount, matchCount, data[]`.

### B. Rate 15064397 — data item fields

| Field (KO) | Type | Meaning |
| --- | --- | --- |
| `폐기물코드` | integer | Waste code |
| `폐기물명` | string | Waste name |
| `폐기물단가` | integer | Unit price, **KRW**; basis (per kg/ton/vehicle) **not stated** |

There is **no** `유효기간`/`적용일자` (effective-date) field and **no** unit-basis
field. The official description states the price reflects **multiple components**
(폐기물 처리비용 + 매립지 운영비 + 환경개선비 …).

### C. KONEPS 15129427

Base `apis.data.go.kr/1230000/ao/CntrctInfoService/`; 용역 list operation
`getCntrctInfoListServcPPSSrch`; params `serviceKey, pageNo, numOfRows, type,
inqryDiv, inqryBgnDt, inqryEndDt` (+ institution/keyword filters). See
`docs/KONEPS_WASTE_CONTRACT_SEARCH_REPORT.md`.

---

## 4. Geography resolution (the decisive finding for the platform)

The inbound origin field is **`광역지자체명` — metropolitan (광역) level only**. By
definition this field can only hold the three capital-region 광역 governments:

- Seoul available **only as 서울특별시** — **no autonomous districts (구)**.
- Gyeonggi available **only as 경기도** — **no Suwon/Seongnam/Goyang/Yongin/etc.**
- Incheon available **only as 인천광역시** — **no districts/counties**.

This is the exact granularity the existing RCIS pipeline could *not* provide for
origin→destination movement (see `docs/DATA_SOURCE_AUDIT.md`,
`docs/RCIS_REPORTING_GEOGRAPHY_AUDIT.md`). The landfill inbound dataset is
therefore the platform's **only** source of a true, source-declared
**origin→destination waste flow** — but strictly at **metropolitan** resolution.

> **Hard rule for V2:** never render or imply a Gyeonggi *city*, or a Seoul/Incheon
> *district*, sending waste to the landfill. The source says 경기도 / 서울특별시 /
> 인천광역시 and nothing finer. Any city/district-to-facility arrow is unsupported.

(The exact three region strings themselves remain UNVERIFIED against real rows;
the field *name* guarantees 광역 granularity, which is the load-bearing claim.)

---

## 5. Reference periods

- **Inbound (15064381):** monthly grain (`마감년월`); 17 quarterly file snapshots
  from **2021-09-27 → 2026-05-31**; next update 2026-09-12; cycle 분기. The exact
  first/last `마감년월` inside the file is UNVERIFIED (needs the real rows); the
  keyword "2020년부터 반입총량제 시행" suggests coverage at least from ~2020.
- **Rate (15064397):** 17 quarterly snapshots **2021-09-27 → 2026-06-11**. The
  table itself carries **no period** — each snapshot is the *current* rate table
  as of its publish date. Historical rate periods can only be reconstructed by
  **diffing consecutive snapshots** (a derived, labelled inference — not source).

---

## 6. Inbound-data quality

**UNVERIFIED — real file not obtained.** From schema/metadata only: 4 columns,
integer quantity in kg, 9,212 rows (latest), quarterly. Row-grain (expected: one
row per 마감년월 × 광역지자체명 × 폐기물명), null counts, duplicate counts at the
canonical grain, exact period span, and the unique 광역지자체명 / 폐기물명 value sets
**cannot be reported** until authorized. No data-quality GO criterion can be
certified now.

## 7. Landfill-rate quality

**UNVERIFIED — real file not obtained.** From schema/metadata only: 3 columns,
191 rows, integer KRW price, quarterly. Waste-code and waste-name uniqueness,
null/invalid rates, and duplicate codes cannot be measured. Two structural facts
*are* known and are unfavorable for cost work: **(i)** no unit basis, **(ii)** no
effective period, **(iii)** multi-component price (so it is not a clean
"disposal-only" tariff).

## 8. Waste-name join coverage

**UNVERIFIED (0 rows inspected).** Design constraints already known:

- Only join path is **exact `폐기물명`** (inbound has no `폐기물코드`; the rate table
  has the code but nothing to join it to on the inbound side).
- "Exact official waste code" join (the preferred path) is **impossible** with
  these two datasets.
- Fuzzy matching may only ever produce **review candidates**, never final joins.

Required metrics (unique-name match %, quantity-weighted match %, unit-verified %,
period-compatible %, cost-allowed %) are all **pending authorization**.

## 9. Rate-period compatibility & allowed cost calculations

Because the rate table has **no effective period** and a **current-only** value
per snapshot, and its **unit basis is unverified**, the only defensible
computation — even after authorization — is a **present-rate scenario**, clearly
labelled `OFFICIAL_INPUTS_DERIVED_COST`, and only for waste names that
exact-match, with the inbound quantity expressed in the same unit as the rate
basis (which must first be confirmed out-of-band, e.g. from the 반입수수료 dataset
15064394 or SL-Corp's fee schedule). **Historical cost (e.g. "2024 paid cost")
is NOT supported** and must never be presented. Disallowed-calculation rules
(unclear unit, unclear quantity unit, mismatched period, ambiguous mapping,
current-only rate on historical inbound) all currently apply.

## 10. KONEPS contract search results

**No contracts retrieved (403 not authorized).** The endpoint, parameters,
keyword set, pilot municipalities, and classification scheme are fully specified
and turnkey in `docs/KONEPS_WASTE_CONTRACT_SEARCH_REPORT.md`. Classification
reliability, false-positive rate, and whether transport-only cost is separable
**cannot be assessed** until real results exist.

---

## 11. Limitations

1. **No real rows/rates/contracts inspected** — the single most important
   limitation. Everything quantitative is UNVERIFIED.
2. Inbound origin is **metropolitan-only**; no municipal/district origin exists.
3. Rate has **no unit basis, no effective period**, and is **multi-component**.
4. Inbound↔rate join is **name-only** (no shared code).
5. The direct CSV path needs a **logged-in data.go.kr session** (cannot be
   automated headlessly); the odcloud path needs **활용신청** for each dataset.
6. KONEPS totals, once available, are **full contract amounts** — never pure
   transport cost, and never proof of a destination facility.
7. Autonomous unblocking was **not** attempted: 활용신청 modifies the user's
   data.go.kr account and requires their browser session; that is out of safe
   scope for this research task.

---

## 12. GO / CONDITIONAL GO / NO-GO decision

**CONDITIONAL GO (blocked pending authorization).**

Rationale against the Phase-0 decision gates:

- Not **GO**: real files were not inspected; quantity-unit verification, ≥80%
  rate-join coverage, rate-unit/period verification, and KONEPS-for-≥3-municipals
  are all UNVERIFIED (the instruction forbids GO on descriptions alone).
- Not **NO-GO**: the inbound file is not un-obtainable in principle (it exists,
  parses trivially by schema, is openly licensed, geography maps honestly at 광역
  level, and the key is valid) — the only obstacle is a free application.
- Therefore **CONDITIONAL GO**: proceed to build *only* the features that the
  metropolitan-level, openly-licensed inbound flow can support, **after** the
  authorization is completed and a short live-verification pass confirms unit,
  period span, region tokens, and (for any cost feature) the rate basis.

---

## 13. Recommended implementation scope

Detailed in `docs/PUBLIC_DATA_V2_RECOMMENDATION.md`. In brief, the smallest honest
V2 is a **metropolitan (서울/인천/경기) → Sudokwon Landfill inbound-flow view**
using 15064381, with monthly/annual aggregates and full source+period labels.
**Defer** official-rate-derived cost (rate basis/period unverified),
city/district-to-facility arrows (unsupported by geography), and KONEPS contract
totals (until authorized and classification is validated on real results).

## 14. Immediate unblock checklist (for the data.go.kr account owner)

1. Log in to data.go.kr with the account that owns `DATA_GO_KR_SERVICE_KEY`.
2. On each of `data/15064381`, `data/15064397`, `data/15129427` click **활용신청**
   (Open API / 파일데이터), accept the (unrestricted) terms — normally auto-approved.
3. Re-run the preserved probe scripts (see `backups/…/logs/access_log.md`); the
   **same key** will then return rows/rates/contracts.
4. Run the live-verification pass in §12; only then revisit GO.
