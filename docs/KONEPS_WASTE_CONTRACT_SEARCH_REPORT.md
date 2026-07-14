# KONEPS Waste-Contract Search Report (V2 Phase 0)

Research date: **2026-07-14**. Dataset: **15129427 — 조달청 나라장터 계약정보서비스**
(Korea Public Procurement Service).

**Status: ACCESS CONFIRMED, but DEFERRED from the V2 MVP by decision.** KONEPS is
not part of the initial capital-region V2. This report preserves the verified
access contract so a future, capital-region-scoped phase is turnkey; it does not
present a completed municipal search (none is included in the MVP).

---

## 1. Access — CONFIRMED (HTTP 200)

After the account owner's 활용신청 propagated to the 조달청 gateway, the previously
403-Forbidden service returned **HTTP 200 `resultCode 00 정상`** with real
contracts.

- **Working endpoint:** `apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListServcPPSSrch`
  (용역 = service contracts; municipal waste collection/transport/treatment are 용역).
- **Required parameters (verified):** `serviceKey`, `pageNo`, `numOfRows` (≤ 999),
  `type` (`json`/`xml`), `inqryDiv=1` (계약체결일자 mode), and **`inqryBgnDate` /
  `inqryEndDate` in `YYYYMMDD`** — note the parameter names are `…Date`, **not**
  `inqryBgnDt/EndDt` (the latter returns `resultCode 08 필수값 입력 에러`).
- **Filtering behaviour (verified):** `cntrctNm` (contract-name keyword) **filters
  server-side**; `dminsttNm` (demand-institution name) is **ignored** — the
  municipality must be **client-filtered** from the `dminsttList` field, which
  carries the 수요기관 full name (e.g. `서울특별시 강남구`). `cntrctInsttNm` is
  usually a 조달청 regional office acting as procurement agent, not the municipality.

## 2. Response fields (verified)

`untyCntrctNo` (통합계약번호), `bsnsDivNm` (업무구분, e.g. 일반용역), `dcsnCntrctNo`
(확정계약번호), `cntrctRefNo`, `cntrctNm` (계약명 / title), `cntrctCnclsDate`
(계약체결일자), `cntrctPrd` (계약기간), `totCntrctAmt` (총계약금액), `thtmCntrctAmt`
(금차계약금액), `cntrctInsttNm` (계약기관), `dminsttList` (수요기관 목록 — the
municipality), `corpList` (계약업체 / contractor), `cntrctInfoUrl`,
`cntrctDtlInfoUrl`. Format JSON+XML; update 실시간; dev quota 1,000 req/day;
license 이용허락범위 제한 없음.

## 3. Secure credential usage (no value ever exposed)

Read only from `DATA_GO_KR_SERVICE_KEY` (env, via python-dotenv), matching
`ingestion/.../config.py`. Never printed/logged/committed; redacted from every
response body before printing. The frontend must never call KONEPS directly
(AGENTS.md); a backend/ingestion job must proxy it.

## 4. Why DEFERRED (not in the MVP)

- Municipality is not server-filterable, so a complete municipal search requires
  paging **nationwide** result sets per keyword/year and client-filtering — heavy
  and easy to run out of MVP scope.
- Contract totals are **bundled** (`totCntrctAmt`) and cannot be decomposed into
  collection vs transport vs treatment.
- Municipal waste service is often procured directly by the municipality and may
  not appear in 나라장터 at all, so coverage is partial and needs manual review.
- The V2 MVP is fully served by the landfill inbound + fee datasets; KONEPS adds
  procurement context that is valuable later but not required now.

## 5. If revisited (future phase) — capital-region-only

- **Municipalities restricted to Seoul / Gyeonggi / Incheon** only (e.g.
  서울특별시 강남구, 경기도 수원시, 인천광역시 서구, 경기도 고양시, 인천광역시 연수구),
  matched from `dminsttList`. **No non-capital-region municipalities.**
- Years 2023–2025; keyword set (server-side `cntrctNm`): 생활폐기물, 음식물,
  재활용, 대형폐기물, 폐기물 수집, 폐기물 운반, 소각, 매립 (dedupe by `untyCntrctNo`).
- Classify into COLLECTION / TRANSPORT / COLLECTION_AND_TRANSPORT / TREATMENT /
  COLLECTION_TRANSPORT_TREATMENT / FOOD_WASTE / RECYCLING_SORTING / INCINERATION /
  LANDFILL / OTHER / FALSE_POSITIVE / REVIEW_REQUIRED. Preserve the original
  title; record matched keywords.
- Data-integrity guardrails: a contract total is a `PUBLIC_CONTRACT_TOTAL`, never
  transport-only cost; a contract never proves a destination facility unless it
  names one; exclude construction/demolition (건설/해체/철거/석면) jobs; separate
  annual municipal service contracts from one-off disposal jobs.

## 6. Feasibility

API mechanics are **feasible** (real-time REST, JSON/XML, date-range + keyword
filters, idempotent by contract number). The only real work is client-side
municipality filtering and classification review. Deferred purely by MVP scope
decision, not by any technical blocker.
