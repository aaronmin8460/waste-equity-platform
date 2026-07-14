# KONEPS Waste-Contract Search Report (V2 Phase 0 research)

Research date: **2026-07-14**. Dataset: **15129427 — 조달청 나라장터 계약정보서비스**
(Korea Public Procurement Service, "Nara-jangeo Contract Information Service").
Status: **endpoint and request contract confirmed; live search BLOCKED at HTTP
403 (key not authorized for this service).** No contract rows were retrieved,
so no real classification or feasibility numbers exist yet.

---

## 1. API endpoint and parameters (confirmed by probing)

**Confirmed base:** `https://apis.data.go.kr/1230000/ao/CntrctInfoService/`

Endpoint discovery was decisive:

| Operation probed | HTTP | Interpretation |
| --- | --- | --- |
| `…/ao/CntrctInfoService/getCntrctInfoListServcPPSSrch` (용역) | **403** | Exists, not authorized |
| `…/ao/CntrctInfoService/getCntrctInfoListThngPPSSrch` (물품) | **403** | Exists, not authorized |
| `…/ao/CntrctInfoService/getCntrctInfoListCnstwkPPSSrch` (공사) | **403** | Exists, not authorized |
| `…/ao/CntrctInfoService/getTotallyFakeOperationXYZ` | **404** | Confirms 404 ≠ 403 (real ops exist) |
| `…/ad/…`, `…/as/…` prefixes | 404 | Wrong prefix |
| `…/CntrctInfoService/…` (no prefix) | 500 | Wrong path |

Because real operations return **403** while a fabricated operation returns
**404**, the service and its operations are proven to exist and the 403 is an
**authorization** result, not a malformed-request result.

**Operation to use for waste service contracts:** `getCntrctInfoListServcPPSSrch`
(용역 = service contracts; municipal waste collection/transport/treatment are
procured as 용역).

**Request parameters** (per the official page; business divisions 물품/외자/공사/용역
each have list + detail ops):

| Param | Required | Meaning |
| --- | --- | --- |
| `serviceKey` | yes | data.go.kr key (from `DATA_GO_KR_SERVICE_KEY`) |
| `pageNo` | yes | Page index |
| `numOfRows` | yes | Page size |
| `type` | opt | `json` or `xml` |
| `inqryDiv` | yes | Inquiry mode: `1` = 계약체결일자(contract date), `2` = 확정계약번호 |
| `inqryBgnDt` / `inqryEndDt` | conditional | `YYYYMMDDHHMM` range when `inqryDiv=1` |
| institution / keyword filters | opt | 계약기관/수요기관 name, 품명 (item/title) keyword, etc. |

Documented search keys: 계약체결일자, 확정계약번호, 요청번호, 공고번호, 기관명(계약기관,
수요기관), 품명, 계약방법, 계약참조번호. Format: JSON + XML. Update: 실시간. Dev quota:
**1,000 requests/day**. License: 이용허락범위 제한 없음.

---

## 2. Secure credential usage (no value ever exposed)

- The key is read **only** from the environment variable `DATA_GO_KR_SERVICE_KEY`
  (loaded from `.env` via python-dotenv), consistent with
  `ingestion/.../config.py` (`ProbeSettings.data_go_kr_service_key`).
- It is **never** printed, logged, committed, or placed in a URL that is echoed.
  All probe scripts redact the key from every response body before printing.
- The frontend must never call KONEPS directly (AGENTS.md); a backend/ingestion
  job must proxy it.
- **Key validity was proven** with an unrelated control call (AirKorea B552584 →
  HTTP 200 `NORMAL_CODE`). The KONEPS 403 is therefore a **per-service
  authorization gap**, not a bad key.

### Unblock step (account owner, one-time, free)

On `https://www.data.go.kr/data/15129427/openapi.do` click **활용신청** for the
service (normally auto-approved). The same key then works — no new secret, no code
change. Expected env var is already the correct one (`DATA_GO_KR_SERVICE_KEY`).

---

## 3. Planned search matrix (turnkey once authorized)

### Pilot municipalities (5)

1. 서울특별시 강남구
2. 경기도 수원시
3. 인천광역시 서구
4. 경기도 고양시 *(added: large Gyeonggi city; one of the seven RCIS multi-district
   cities in `docs/RCIS_REPORTING_GEOGRAPHY_AUDIT.md`, high platform relevance)*
5. 인천광역시 연수구 *(added: Incheon district near the Sudokwon Landfill catchment)*

### Reference years

2023, 2024, 2025 (as `inqryBgnDt`/`inqryEndDt` `YYYYMMDD0000`–`YYYYMMDD2359`
windows; iterate months if a year exceeds `numOfRows`).

### Korean keyword combinations

생활폐기물 수집 운반 · 생활폐기물 수집·운반 · 폐기물 위탁처리 · 폐기물 처리 용역 ·
음식물류 폐기물 처리 · 재활용품 선별 · 소각 처리 · 매립 처리 · 대형폐기물 처리 ·
폐기물 운반.

### Fields to record per result

municipality, contract number, reference number, contract title (verbatim),
contracting institution (계약기관), demand institution (수요기관), contractor,
contract date, contract period, total contract amount, current contract amount,
source endpoint, official source URL / canonical lookup id.

Output file (once data exists): `koneps_waste_contract_candidates.csv`.

---

## 4. Classification rules (to apply to real results)

Each result → one of: `COLLECTION`, `TRANSPORT`, `COLLECTION_AND_TRANSPORT`,
`TREATMENT`, `COLLECTION_TRANSPORT_TREATMENT`, `FOOD_WASTE`, `RECYCLING_SORTING`,
`INCINERATION`, `LANDFILL`, `OTHER`, `FALSE_POSITIVE`, `REVIEW_REQUIRED`.

Rules:
- Preserve the original title; record matched keyword(s).
- Do **not** classify a full contract amount as transport-only cost.
- Do **not** infer a destination facility unless explicitly named in the contract.
- Exclude construction-waste removal / one-off building-demolition contracts
  unless clearly in platform scope.
- Separate **annual municipal service contracts** from **small one-time disposal
  jobs**.

Anticipated false-positive patterns (to verify against real data): 건설폐기물
운반/처리 (demolition), 폐기물 소각로 **시설 공사** (facility construction, not a
service), 정화조/분뇨 (septic), 의료폐기물 (regulated medical), 도로 청소 (street
cleaning mislabeled), consulting/용역 studies about waste (planning, not service).

---

## 5. Per-municipality reporting template (to fill once authorized)

For each municipality: total API results · relevant contract count · false-positive
count · total relevant contract amount · amount by contract class · contracts with
an explicit destination/treatment facility · contracts with downloadable public
attachments · contracts requiring manual browser review. **All currently
UNVERIFIED (0 results).**

---

## 6. Feasibility of automated recurring collection

- **API mechanics: feasible.** Real-time REST, JSON/XML, documented date-range and
  institution/keyword filters, 1,000 req/day dev quota (raisable). Idempotent
  ingestion by (contract number + reference number) is straightforward and fits
  the existing raw-response-preservation pattern.
- **Blocked on:** the one-time 활용신청 authorization.
- **Open risks (assessable only on real data):** keyword precision vs. recall
  (false positives above), whether `수요기관` reliably encodes the municipality,
  whether contract amounts can be decomposed into collection vs transport vs
  treatment (likely **not** — amounts are usually the bundled total), and whether
  attachments (규격서/과업지시서) are API-reachable or browser-only.

---

## 7. Data-integrity guardrails for any KONEPS feature

- A contract **total** is a `PUBLIC_CONTRACT_TOTAL`, never a transport-only cost.
- A contract does **not** prove a destination facility unless it names one
  (`CONTRACTUAL_DESTINATION` only when explicit).
- Contract data must never be joined to landfill throughput to imply
  origin→destination movement.
