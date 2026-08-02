# Land-Cover Licence, Public-Use Scope, and Deployment-Eligibility Decision

**Phase:** 1B-LC7 — EGIS licence, public-use scope, and deployment eligibility
**Document type:** operational evidence review and decision record. **This is not legal advice.**
**Review date:** 2026-08-02
**Verified starting commit:** `05be3b7df73ff69af67a9068940c84d1ffef6553` (local `main` == `origin/main` at review start)
**Branch:** `research/land-cover-lc7-licence-public-scope`

---

## 1. Executive decision

> ### `UNRESOLVED_PENDING_WRITTEN_RESPONSE`
>
> **Deployment eligibility: BLOCKED.** The land-cover feature set must remain local-only.
> **Lifecycle state is unchanged: `LOCAL_USE_ONLY_PENDING_CLARIFICATION`.**
> **Next phase: LC7A — submit the EGIS written inquiry and record the official response.**

This is a truthful outcome, not a failed phase. The review found a **complete and specific
official policy** governing EGIS materials — and that policy makes free use conditional on a
KOGL mark being attached to the specific work. **No KOGL mark is attached to the downloaded
vector 토지피복지도 product on any official page inspected.** A KOGL Type 1 designation *does*
exist for two neighbouring products (the WMS map service and the tabular area statistics), and
transferring it to the SHP download is precisely the inference this phase was required not to make.

Per the provider's own policy, material without an attached KOGL mark requires **prior
consultation with the responsible officer** (`담당자와 사전에 협의한 이후에 이용`). That is a
written-clarification instruction issued by the provider, so the correct next action is to follow
it rather than to infer a permission.

### Decision in one line per public surface

| Surface | Decision |
| --- | --- |
| Public browser map display | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — blocked |
| Public derived 500 m statistics | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — blocked |
| Public MVT vector tiles | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — blocked |
| Public JSON API | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — blocked |
| Bulk / CSV download of derived data | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — blocked (also not implemented) |
| Original SHP redistribution | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — additionally **prohibited by project policy regardless of the answer** |
| Transformed source-geometry redistribution | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — additionally **prohibited by project policy regardless of the answer** |
| Private OCI storage | `NOT_ADDRESSED` — no official statement either way |
| Commercial use | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — **must not be claimed** |

---

## 2. Dataset identity under review

| Attribute | Value |
| --- | --- |
| Provider | 환경부 환경공간정보서비스 (EGIS) — **now 기후에너지환경부**, see source O1 in §4 |
| Dataset | 세분류 [2025] 전국 토지피복지도 (Level-3 detailed land-cover map) |
| Geographic scope acquired | 서울특별시 · 인천광역시 · 경기도 |
| Acquired format | SHP vector data (online 자료신청 download) |
| Local dataset version | 212 |
| Reference period | 2025 (year only; no reference date is fabricated) |
| Transformation version | `land-cover-v1` |
| Derived statistics version | 1 |
| Candidate grid | `capital-grid-500m-v1` |
| Derived cell statistics | 47,893 cells |
| Derived class rows | 1,142,780 |
| Raw source features (canonical, loaded) | 6,901,309 |
| Current lifecycle state | `LOCAL_USE_ONLY_PENDING_CLARIFICATION` |
| Implementation state | **local only** — no OCI, no production, no scoring integration |

---

## 3. Evidence methodology

### 3.1 Hierarchy applied

Highest authority first. Lower-level evidence never overrides a more specific restriction, and a
general site policy is never treated as dataset-specific permission.

| Level | Description | Found in this review? |
| --- | --- | --- |
| 1 | Written response from EGIS / the responsible ministry department addressing **this dataset and these uses** | **NO — not obtained. This is the blocking gap.** |
| 2 | Dataset-specific licence attached to the exact dataset page / download application / receipt / downloaded product | **NO** for licence terms. One official product-family document found (offline provision guide, O4) — procedural only, silent on use rights |
| 3 | Terms explicitly accepted during the SHP download process | **NOT INSPECTABLE** — the online 자료신청 flow is behind authentication (O3, Appendix A-L3). Recorded as a limitation, not as an absence |
| 4 | Official EGIS copyright / data-use / service terms explicitly covering downloaded vector files | **PARTIAL** — an official copyright policy exists (O2) and covers "all materials provided on the site", but it is **conditional on a KOGL mark** and names no product |
| 5 | Dataset-specific KOGL designation with an identifiable type | **NO for the SHP download.** **YES (Type 1) for the WMS map service (O7) and for the tabular area statistics (O8)** — different products |
| 6 | General official KOGL policy | **YES** (O9) — definitions only |
| 7 | General official EGIS site policy | **YES** (O1, O5, O6) — licence-silent |

### 3.2 Claims deliberately not made

Consistent with the phase's evidence caution, **none** of the following was treated as proof of
any permission: the dataset being downloadable; the producer being a public institution; presence
on a government website; a generic "public data is open" statement; an unlinked KOGL logo;
assumptions about Korean government data; the EGIS WMS terms; a generic KOGL explanation not tied
to this dataset; third-party blogs; search-result snippets; cached summaries; or previous project
assumptions. Every source below was opened directly; **no search-results page is cited as final
evidence.**

### 3.3 Separation of evidence from inference

Sections §4 and §5 are **official evidence**. Section §8 is **project inference** and every item
in it is labelled `PROJECT RISK ASSESSMENT — NOT AN OFFICIAL LICENCE STATEMENT`.

---

## 4. Official-source register

All sources accessed **2026-08-02**. All were opened directly and, except where noted, the
governing text was additionally extracted from the raw HTML rather than relying on a summary.

### O1 — 환경공간정보서비스 (service home)

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 (Ministry of Climate, Energy and Environment) |
| URL | https://aid.mcee.go.kr/ |
| Accessed | 2026-08-02 |
| Publication/revision date | not shown |
| Evidence level | 7 (general site policy) |
| Dataset-specific? | No |

**Finding.** The historic EGIS host **`egis.me.go.kr` now issues a `301 Moved Permanently` to
`aid.mcee.go.kr`**, and the responsible ministry is named 기후에너지환경부 throughout. Footer
carries the address 세종특별자치시 도움6로 11 (어진동) 정부세종청사 6동 and the published number
**044-201-6472 (정보화담당관실)**. **No 공공누리/KOGL badge appears anywhere on the page.**

**Supports questions:** 20 (attribution target identity), contact channel (§10).
**Ambiguity:** the project's stored `official_source_url` is the pre-migration
`https://egis.me.go.kr` (see §7 change-impact).

### O2 — 저작권 정책 (copyright policy) — **primary governing document found**

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 환경공간정보서비스 |
| URL | https://aid.mcee.go.kr/bbs/copyright.do |
| Accessed | 2026-08-02 |
| Publication/revision date | **none shown** |
| Section | 게시판 > 저작권 정책 (entire page) |
| Evidence level | **4** |
| Dataset-specific? | **No** — applies to "모든 자료" but names no product |

**Verbatim (quoted only as far as necessary for the decision):**

> 기후에너지환경부 환경공간정보서비스 홈페이지에서 제공하는 모든 자료는 저작권법에 의하여
> 보호받는 저작물로서 이용자는 아래의 저작권 보호정책을 준수하여야 합니다.
>
> ① 저작권법 제24조의2에 따라 환경공간정보서비스에서 저작재산권의 전부를 보유한 저작물의
> 경우에는 별도의 이용허락 없이 무료로 자유이용이 가능합니다. 단, 자유이용이 가능한 저작물은
> "공공저작물 자유이용허락 표시(공공누리,KOGL) 제1유형"을 부착하여 개방하고 있으므로 공공누리
> 표시가 부착된 저작물인지 여부를 확인한 이후에 자유이용하시기 바랍니다. 자유이용의 경우에는
> 반드시 저작물의 출처를 구체적으로 표시하여야 합니다.
>
> ② … 공공누리가 부착되지 않은 자료들을 사용하고자 할 경우에는 담당자와 사전에 협의한 이후에
> 이용하여 주시기 바랍니다.
>
> ③ 다른 인터넷 사이트 상의 화면에서 … 저작물을 직접 링크시킬 경우에는 … 본 인터넷 저작권
> 정책도 함께 링크해 주시기 바랍니다.
>
> ④ 홈페이지에서 개방 중인 자료 중 기후에너지환경부가 저작권 전부를 갖고 있지 아니한 자료
> (다른 저작자와 저작권을 공유한 자료 등)의 경우에는 저작권 침해의 소지가 있으므로 단순 열람 외에
> 무단 변경, 복제·배포, 개작 등의 이용은 금지되며 이를 위반할 경우 관련법에 의거 법적 처벌을
> 받을 수 있음을 알려드립니다.

**Paraphrase.** All material on the service is copyright-protected. Free use without separate
permission exists **only** for works in which the service holds the entire economic copyright —
and such works are **opened with a KOGL Type 1 mark attached**, so the user is instructed to
**verify whether the mark is attached before relying on free use**. Free use always requires
specific source attribution. Where no KOGL mark is attached, the user must **consult the
responsible officer in advance**. For material the ministry does not wholly own, **anything beyond
simple viewing — modification, reproduction/distribution, adaptation — is prohibited.**

**Why this is decisive.** The policy is a *conditional* grant, not a blanket one. It converts the
entire decision into a single factual question: *is a KOGL mark attached to this product?* See O5/O6.

**Supports questions:** 3–20.
**Ambiguity:** the policy does not state whether the ministry holds the entire economic copyright
in the 세분류 토지피복지도 vector product, so it is unresolved whether clause ① or clause ④ governs it.

### O3 — 자료신청 안내 (data-request guide)

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 환경공간정보서비스 |
| URL | https://aid.mcee.go.kr/req/intro.do |
| Accessed | 2026-08-02 |
| Publication/revision date | not shown |
| Evidence level | 3 (partial — the terms surface itself is gated) |
| Dataset-specific? | Product-specific (names 토지피복지도 대/중/세분류 by production year) |

**Finding.** Confirms the acquisition route: online application is login-only
(`온라인 자료신청 서비스는 로그인 사용자 전용 서비스 입니다`), the user registers an application,
completes a survey on first download, and downloads via the RAON-K client. The page states the
survey data is used only for service-improvement statistics. **It states no copyright, KOGL,
redistribution, commercial-use, attribution, third-party-provision, or purpose-limitation term.**
Contains **no KOGL badge**.

**Supports questions:** 1, 2, 9 (acquisition model), and the §10 contact channel.
**Ambiguity:** whether an additional terms/pledge screen appears *inside* the authenticated
application form is **not determinable** without logging in — recorded as limitation Appendix A-L3.

### O4 — 환경공간정보서비스 오프라인 자료제공 안내 (official PDF, 3 pages)

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 환경공간정보서비스 |
| URL | https://aid.mcee.go.kr/files/offline_data_provided.pdf |
| Accessed | 2026-08-02 |
| Publication/revision date | not stated; the specimen official letter on p.3 is dated 2026-04-21 / 2026-04-22 |
| Evidence level | 2 (dataset-family-specific official document) |
| Dataset-specific? | Yes — it is about 토지피복지도 provision |

**Findings (page-cited).**

- **p.1** — 공간정보(토지피복지도) is provided through the **online** service and the user may
  "홈페이지에서 직접 벡터 파일 다운로드" by chosen region or map sheet. This is official
  confirmation that a **downloadable vector product exists and is distinct from the WMS service.**
- **p.1** — **공개제한 공간정보(접경지역 등) is *not* provided online**; it requires an official
  letter (문서24 or 기관공문), an in-person visit, and issuance of the data.
- **p.2** — the offline route requires a 수령증 and a **공개제한공간정보인수서**, and the named
  applicant/manager/user must attend in person.
- **p.2–3** — the specimen official letter asks the requester to state a **사용기간** (period of
  use) and a **사용기관/관리자/사용자**, and frames the purpose as e.g.
  "'○○○ 용역' 관련하여 토지이용현황 분석을 위한 토지피복지도 활용".
- **p.1** — offline enquiry telephone **044-201-6472**.

**Interpretation limits.** This document governs **procedure and access**, not downstream
publication rights. It contains **no** statement about redistribution, public services, commercial
use, caching, or attribution for the **online** product. The custody controls (인수서, named users,
fixed period) apply to the **restricted** offline product, and are **not** evidence about the
online product this project acquired.

**Supports questions:** 1, 2, 9.

### O5 — 시스템소개 > 토지피복지도 (the dataset's own official page)

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 환경공간정보서비스 |
| URL | https://aid.mcee.go.kr/intro/land.do |
| Accessed | 2026-08-02 |
| Publication/revision date | not shown |
| Evidence level | 7 (dataset-specific page, but licence-silent) |
| Dataset-specific? | Yes |

**Finding.** Describes 대분류 (7 classes) / 중분류 (22) / 세분류 (41), production history 1998–2025,
and links 온라인 자료신청. **It publishes no licence, no use conditions, and — verified against the
raw HTML — no 공공누리/KOGL mark or image.** The only footer link is the general 저작권 정책 (O2).

**This is the single most important negative finding in the review**: the dataset's own page is
silent, so O2 clause ② (consult the officer first) is the operative instruction.

**Supports questions:** 3–20 (as an absence of dataset-specific permission).

### O6 — OPEN API > 토지피복지도 맵 서비스 (the WMS product)

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 환경공간정보서비스 |
| URL | https://aid.mcee.go.kr/api/land.do |
| Accessed | 2026-08-02 |
| Evidence level | 7 |
| Dataset-specific? | **WMS product only** |

**Finding.** Publishes WMS layer names at `http://api.mcee.go.kr/geoserver/wms?`, **including
`lv3_2025y` = "세분류 토지피복지도 2025년 전국 현행화"** — i.e. the WMS service exposes the *same
classification level and reference year* as the SHP product this project downloaded, through a
different delivery channel. The page also **recommends caching**:
"지도 표출 속도를 위해 캐쉬(Cache) 서비스를 사용할것을 권장합니다."

**Explicit non-transfer.** That cache recommendation, and the KOGL Type 1 designation recorded at
O7, attach to the **WMS service**. Under this review's rules they are **not** applied to the
downloaded SHP product or to tiles derived from it. The shared level/year makes the two products
easy to conflate and is exactly why they are kept separate here.

**Supports questions:** 12 (as a WMS-only datum), and the SHP-vs-WMS finding (§6).

### O7 — data.go.kr: 기후에너지환경부_환경공간정보_토지피복지도 맵 서비스

| Field | Value |
| --- | --- |
| Organization | 기후에너지환경부 (listing on 공공데이터포털) |
| URL | https://www.data.go.kr/data/3045398/openapi.do |
| Accessed | 2026-08-02 |
| Publication/revision date | 등록일 2017-03-07 · 수정일 2026-04-07 |
| Section | 이용허락범위 |
| Evidence level | **5 — but for the WMS product, not this dataset** |
| Dataset-specific? | **No — different product** |

**Verbatim 이용허락범위:** `공공저작물 : 출처표시 (제 1유형)`
**제공형태:** OPEN API / **WMS map service — not a downloadable vector SHP.**

**Finding.** A confirmed **KOGL Type 1** designation exists in the EGIS land-cover family — attached
to the **WMS map service**. **This does not designate the downloaded SHP product**, and applying it
to the SHP product would be the exact prohibited inference (WMS terms → SHP download).

### O8 — data.go.kr: 지역별 세분류 토지피복 면적 현황 (tabular statistics)

| Field | Value |
| --- | --- |
| URL | https://www.data.go.kr/data/15124209/fileData.do |
| Accessed | 2026-08-02 |
| Publication/revision date | 등록일 2025-09-22 · 수정일 2025-11-06 |
| 이용허락범위 (verbatim) | `공공저작물 : 출처표시 (제 1유형)` |
| Content | **tabular** area statistics by region and class (㎢) — **not vector geometry** |
| Evidence level | 5 — different product |

**Finding.** The ministry's own **derived area statistics** are published as KOGL Type 1 open data.

**Why this is recorded but not relied on.** It is suggestive that the ministry treats *aggregate
land-cover area statistics* as freely reusable, which is the same *kind* of output this platform
derives. But it is a **different dataset**, at a **different geography** (시군구, not a 500 m grid),
**produced by the ministry itself**, and it says nothing about statistics a third party derives from
the SHP product. It is therefore **not** treated as permission — see §8-R6.

### O9 — 공공누리 이용허락범위 안내 (KOGL type definitions)

| Field | Value |
| --- | --- |
| URL | https://www.kogl.or.kr/info/license.do |
| Accessed | 2026-08-02 |
| Evidence level | 6 (general official KOGL policy) |
| Dataset-specific? | No |

**Finding.** Type 1 = 출처표시 (commercial use and derivative works permitted). Type 2 adds
상업적 이용금지. Type 3 adds 변경금지. Type 4 adds both. **The page gives no rule for what applies
when no KOGL mark is attached** — that gap is filled, for this provider, by O2 clause ② (consult the
officer in advance).

### O10 — EGIS 질문과 답변 board (contact-channel evidence)

| Field | Value |
| --- | --- |
| URL | https://aid.mcee.go.kr/bbs/list.do?section=1 · thread example `…/bbs/view.do?section=1&mngrBbsDataSeq=5061` and its official reply `…5063` |
| Accessed | 2026-08-02 |
| Evidence level | n/a — establishes the written-response channel, not licence terms |

**Finding.** The board carries public questions with official replies signed
"환경공간정보서비스", including a 2026-06-24 thread about a downloaded 토지피복도 map sheet answered
by staff who direct the user to the **데이터 담당자 044-201-6472**. Poster identities are masked
(`***`). **Confirms a working written-reply channel with a public thread record.**

### O11 — 토지피복지도작성지침 (administrative rule) — **NOT ACCESSIBLE**

| Field | Value |
| --- | --- |
| URL | https://law.go.kr/행정규칙/토지피복지도작성지침/ (linked from the EGIS footer) |
| Accessed | 2026-08-02 |
| Outcome | **Content not retrievable** — the page is dynamically rendered and returned only its title |

**No content from this rule is asserted anywhere in this document.** Recorded as an unread source
(§9-L4). It is a production guideline and is not expected to grant use rights, but that expectation
is **not** treated as a finding.

### Sources deliberately excluded

`data.go.kr` keyword-search result pages were used **only for navigation** to the underlying
listings (O7, O8) and are not cited as evidence. A search for `토지피복지도` on 공공데이터포털
returned the WMS service, the 면적 현황 statistics tables, and the 구축 현황 status table —
**no downloadable vector SHP listing of the map itself.** That negative result is recorded as
context in §6, not as a licence term.

---

## 5. Local-evidence register

### 5.1 Tracked repository documentation reviewed

| Document | Licence-relevant content found |
| --- | --- |
| `docs/LAND_COVER_DATA_CONTRACT.md` | Licence row: "KOGL / EGIS terms … the **exact licence receipt is not committed** and must be reconfirmed before ingestion (§16). This is *not* the WMS-only display product." Lifecycle: `LOCAL_USE_ONLY_PENDING_CLARIFICATION`. §16 carries "licence reconfirmation" as condition 1 |
| `docs/LAND_COVER_VALIDATION_REPORT.md` | Open item 4: "Licence receipt not committed — terms not reconfirmed". Open item 2: the **137-vs-130** Seoul gap is `UNRESOLVED`. No standalone licence receipt is committed |
| `docs/LAND_COVER_INGESTION_FOUNDATION.md` | "The EGIS/KOGL vector-download licence for the 토지피복지도 is **not yet** [reconfirmed]"; carried as a pre-official-write condition |
| `docs/LAND_COVER_FULL_LOCAL_INGESTION_REPORT.md` | Full local load complete; licence `LOCAL_USE_ONLY_PENDING_CLARIFICATION`; local dev DB only |
| `docs/LAND_COVER_CANDIDATE_CELL_STATISTICS.md` | "no confirmed KOGL type is claimed for the vector product"; licence note carried onto the derived release |
| `docs/LAND_COVER_CELL_STATISTICS_API.md` | API preserves the status; "**KOGL Type 1 is not claimed. Commercial-use** [permission is not claimed]" |
| `docs/LAND_COVER_CANDIDATE_DETAIL_FRONTEND.md` | Frontend preserves the served status; explicitly does not claim KOGL Type 1, commercial use, production availability, or completed OCI deployment |
| `docs/LAND_COVER_MAP_LAYER_LEGEND_FILTERS.md` | Layer disclosure restates the pending status; "KOGL Type 1 is not claimed; commercial use is not" claimed |
| `docs/LAND_COVER_INTEGRATED_LOCAL_QA.md` | LC6 integrated QA — local only |
| `docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md`, `docs/SUITABILITY_ENVIRONMENTAL_ROADMAP.md` | Environmental-layer architecture and phase sequence |
| `docs/SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md` (Phase 1A) | Land-cover licence recorded as **`DOCUMENTED_NOT_TESTED`**: "KOGL (SHP download) vs WMS-only for some layers — **verify vector availability**"; Phase 1B recommendation `CONDITIONAL GO` with "reconfirm the EGIS/KOGL licence in writing" as condition 1 |
| `docs/DEVELOPMENT_PHASES.md` | Phase entry records licence still `LOCAL_USE_ONLY_PENDING_CLARIFICATION` |

**Consistency check:** every tracked document already states the licence as unconfirmed. **No
tracked document claims KOGL Type 1, commercial-use permission, redistribution rights, or completed
deployment.** LC7 therefore contradicts nothing in the existing record; it identifies *why* the
question stayed open and *what specifically* must be asked.

### 5.2 Runtime licence strings (recorded, not modified)

| Location | Value / role | Classification |
| --- | --- | --- |
| `ingestion/.../land_cover_ingestion.py:101` `LICENSE_NOTE` | `"EGIS/KOGL 벡터 토지피복지도 다운로드 약관 — 서면 재확인 필요 (적재 전 조건, WMS 표시전용 제품 아님)"` | ingestion constant → **written to DB** |
| `ingestion/.../land_cover_ingestion.py:98` `OFFICIAL_SOURCE_URL` | `"https://egis.me.go.kr"` — **now a 301 redirect** (O1) | ingestion constant → **written to DB** |
| `environmental_dataset_versions.license_note` (dataset_version 212) | stores the note above | **database metadata** |
| `backend/.../schemas/land_cover_cells.py:83` `LICENSE_STATUS` | `"LOCAL_USE_ONLY_PENDING_CLARIFICATION"` | **backend response** |
| `backend/.../schemas/land_cover_cells.py` `LICENSE_STATEMENT` | "…still pending written confirmation from the provider. KOGL Type 1 is NOT claimed and commercial-use permission is NOT claimed. Local analytical use only." | **backend response** |
| `backend/.../schemas/land_cover_cells.py` `RAW_FEATURE_STATEMENT` | "…exposes only aggregated per-cell statistics. Raw land-cover feature geometry and per-feature records are never returned." | **backend response** |
| `backend/.../schemas/land_cover_cells.py` `AVAILABILITY_STATEMENT` | "Implemented and verified against a local development database only. Production/OCI availability has not been established…" | **backend response** |
| `frontend/.../LandCoverCellPanel.tsx:487` | renders `공공이용/라이선스 상태: {license_status}` + statement | **frontend disclosure** |
| `frontend/.../LandCoverLayerControl.tsx` `LAND_COVER_LAYER_DISCLAIMER` | "확보된 토지피복 자료의 공개·이용 조건은 아직 서면 확인 전이며…" | **frontend disclosure** |
| `backend/tests/test_land_cover_cell_routes.py:331`, `…_integration.py:331`, `frontend/src/lib/landCover*.test.ts`, `LandCoverCellPanel.test.tsx:952` | assert the exact status string | **test assertions** |
| `docs/*` (table in §5.1) | phase/lifecycle statements | **documentation** |
| `docs/DEPLOYMENT.md`, `docs/OCI_DEPLOYMENT_CHECKLIST.md` | no land-cover deployment step exists | **deployment documentation** |

**Nothing in this list was modified by LC7.** See §7.

### 5.3 Non-repository evidence — **UNAVAILABLE**

The four previously identified evidence PDFs were **not accessible during this review**:

| Expected file | Status |
| --- | --- |
| `EGIS_KOGL_or_copyright_policy.pdf` | **UNAVAILABLE** |
| `EGIS_land_cover_2025_dataset_detail.pdf` | **UNAVAILABLE** |
| `EGIS_land_cover_2025_download_history.pdf` | **UNAVAILABLE** |
| `EGIS_land_cover_2025_WMS_service.pdf` | **UNAVAILABLE** |

Expected location `download_receipts/land_cover/2025_lv3` does not exist in the repository, and the
external USB that may hold it **was not mounted** (`/Volumes` contained only the system disk). Per
the phase rules the volume was **not mounted, not scanned, and not searched**, and the raw SHP
source directory was **not accessed** in any way. **No PDF page citations appear in this document**,
because no evidence PDF was read.

**Impact.** The download-history PDF would establish the acquisition date and the exact application
scope, and the dataset-detail PDF might carry an on-page condition not present on the current live
page. Their absence is a **material limitation** but is **not** decision-changing: even a download
receipt proves acquisition, not publication rights (§9-L1), and the live dataset page — which is the
authoritative current statement — was inspected directly and is licence-silent (O5).

---

## 6. SHP versus WMS — explicit finding

**These are two distinct products and this review keeps them separate.**

| | Downloaded SHP vector product (**this project's source**) | WMS map service |
| --- | --- | --- |
| Access route | login → 온라인 자료신청 → RAON-K download (O3, O4 p.1) | public WMS endpoint `api.mcee.go.kr/geoserver/wms` (O6) |
| Published on 공공데이터포털? | **No listing found** | **Yes** — id 3045398 (O7) |
| KOGL designation | **NONE FOUND** | **제1유형 (출처표시)** — confirmed verbatim (O7) |
| Caching guidance | none | provider **recommends** caching (O6) |
| Same content? | 세분류, 2025 | `lv3_2025y` — **same level and year** |

The two products describe the same underlying map at the same level and year, which makes
conflation easy and consequential. **The WMS product's KOGL Type 1 designation and its caching
recommendation are recorded as WMS-only facts and are not extended to the SHP product, to
statistics derived from it, or to this platform's tiles.** Equally, nothing about the SHP
download's access controls is asserted about the WMS service.

## 6.1 KOGL-type finding

> **The KOGL type applicable to the downloaded 세분류 [2025] 토지피복지도 SHP product is
> `NOT CONFIRMED`.** No KOGL mark was found on the service home, the dataset's own page, the
> data-request guide, the map viewer, the OPEN API page, or the offline provision PDF — verified by
> direct inspection of the raw HTML of each page (zero occurrences of `공공누리`/`KOGL`).
> A KOGL Type 1 designation is confirmed **only** for the WMS map service (O7) and the tabular area
> statistics (O8). **This project must not publish or imply a KOGL type for its land-cover source.**

---

## 7. Change-impact inventory (no changes made in LC7)

What would eventually have to change, per possible decision. **LC7 changed none of it**; runtime
status changes are deferred to the implementation phase, and no database write occurred.

| Artefact | If `PUBLIC_DERIVED_USE_ELIGIBLE` / `DERIVED_PUBLICATION_ONLY` | If `DISPLAY_ONLY` | If `NONCOMMERCIAL_ONLY` | If `PUBLICATION_PROHIBITED` | Current decision (`UNRESOLVED`) |
| --- | --- | --- | --- | --- | --- |
| DB `license_note` (dataset_version 212) | rewrite to the confirmed terms + KOGL type | same | same + noncommercial condition | keep, add prohibition note | **unchanged** |
| DB `official_source_url` | update `egis.me.go.kr` → `aid.mcee.go.kr` | same | same | same | **unchanged** (recorded as a defect to fix in the next write phase) |
| Backend `LICENSE_STATUS` | new status constant | new status constant | new status constant | new status constant | **unchanged** |
| Backend `LICENSE_STATEMENT` | state the granted scope + attribution | state display-only limits | state the noncommercial limit | state prohibition | **unchanged** |
| Attribution block (API + UI) | add per §9 template | add | add | n/a | **not added** — would imply a resolved licence |
| Tile `Cache-Control` (1 y immutable) | keep if caching permitted | may need shortening | keep | endpoint removed | **unchanged** |
| List endpoint `MAX_PAGE_SIZE=500` | keep or bound | bound / gate | keep | endpoint removed | **unchanged** |
| MVT endpoint | ship | restrict / no direct access | ship | remove | **unchanged, local only** |
| CSV/bulk export | may build | must not build | may build | must not build | **does not exist** |
| Frontend layer disclaimer | replace with confirmed terms | add restriction notice | add noncommercial notice | remove layer | **unchanged** |
| Test assertions on the status string | update in the same commit | update | update | delete with the feature | **unchanged** |
| `docs/DEPLOYMENT.md`, `docs/OCI_DEPLOYMENT_CHECKLIST.md` | add the land-cover migration + ingest step | add restricted variant | add condition gate | record exclusion | **unchanged** |

---

## 8. Derivative-output risk assessment

> **`PROJECT RISK ASSESSMENT — NOT AN OFFICIAL LICENCE STATEMENT`**
> Everything in §8 is this project's own reasoning. None of it is a permission, and none of it may
> be cited as provider guidance. It exists to rank what to ask about and what to gate first.

**Architectural facts these assessments rest on** (verified in code this phase):

- The API's SQL reads only the three persisted LC3 statistic tables plus the **platform's own**
  candidate-grid geometry. **No land-cover source geometry, source feature id, or raw source
  attribute is returned by any endpoint.**
- MVT tiles carry `suitability_candidates.geometry` — the project's independently produced
  `capital-grid-500m-v1` grid — with LC3 statistics as attributes: `candidate_key`,
  `statistics_version_id`, `coverage_status`, `coverage_ratio`, `dominant_l1/l2/l3_code`,
  `dominant_l1/l2/l3_name`, `sido_region_code`, `sigungu_region_code`.
- Tiles are served `public, max-age=31536000, immutable` at z0–22.
- The cell list is offset-paginated with `MAX_PAGE_SIZE = 500` over 47,893 cells.
- `/cells/{key}/classes` returns a cell's full distribution unpaginated (≤70 rows/cell;
  1,142,780 rows across the release).
- **No CSV, no bulk-export, and no download endpoint exists.**

| # | Output | Retains source polygons? | Can reconstruct source geometry? | Copies official taxonomy? | Risk | Reasoning |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | 500 m cell geometry | **No** — project-produced grid | No | No | **Low** | The grid predates and exists independently of the land-cover data |
| R2 | Coverage status | No | No | No | **Low** | A three-value derived label about the project's own cell |
| R3 | Coverage ratio | No | No | No | **Low** | A scalar per cell |
| R4 | Dominant class code + Korean name | No | No | **Yes — official codes and official Korean labels are reproduced verbatim** | **Medium** | The taxonomy is published on the dataset's public page and fixed by the national 작성지침, so it reads as a standard rather than creative expression — but this project holds **no** written confirmation that reproducing the official labels in a public service is permitted |
| R5 | Full class-area distribution per cell | No | **Partially — at scale.** 47,893 cells × ≤70 classes is a 500 m-resolution areal decomposition of the source. It cannot recover polygon boundaries, but it is a systematic quantitative image of the whole source over the capital region | Yes | **Medium-High** | This is the surface where "derived statistics" comes closest to "a re-expression of the dataset" |
| R6 | Regional summary tables | No | No | Yes | **Low-Medium** | The ministry itself publishes 시군구 area statistics as KOGL Type 1 (O8), which is suggestive — **but that is a different dataset produced by the ministry and confers nothing here** |
| R7 | MVT tiles | No | No | Yes (as attributes) | **Medium** | Geometry is the project's own; risk is (a) the attribute payload = R4/R5 and (b) unrestricted enumeration — a public z-x-y endpoint is a complete, scriptable copy of the derived layer |
| R8 | Candidate-detail responses | No | No | Yes | **Medium** | Same payload as R4/R5, one cell at a time |
| R9 | Public API pagination | No | Partially at scale | Yes | **Medium-High** | 47,893 cells at 500/page ≈ 96 requests retrieves the entire derived layer; adding `/classes` per cell retrieves all 1,142,780 rows. **A complete, unthrottled public API is functionally a bulk transfer of the derived dataset, even though no single response is** |
| R10 | Bulk download (CSV/MVT archive) | No | Partially at scale | Yes | **High** | Highest-risk surface; **currently does not exist, and must not be built before the licence resolves** |
| R11 | Long-term caching (1 y immutable) | No | No | Yes | **Medium** | An immutable one-year `Cache-Control` deliberately creates durable copies in browsers, proxies and CDNs. Whether that constitutes 복제 by the operator is **unresolved**. The provider's caching recommendation at O6 is **WMS-only and not applicable** |
| R12 | Screenshots / exported images | No | No | Yes (visually) | **Low-Medium** | Closest to 단순 열람, but publishing an image is still a reproduction |

**Cross-cutting judgements.**

- **Is attribution alone sufficient?** *Unknown.* Attribution is a stated requirement of the free-use
  path (O2 ①), but the free-use path itself is unconfirmed for this product. **Attributing the source
  does not create the permission**, and publishing an attribution that implies a KOGL type would
  itself be a false claim.
- **Are the derived statistics an independent analytical work?** Partly. The grid, the intersection
  method, the coverage semantics and the versioning are the project's own. The **class taxonomy and
  the areal content** are the provider's. This project does **not** assert independence as a
  licence defence.
- **Would commercial restrictions transfer?** If the product turns out to be KOGL Type 2 or 4, a
  noncommercial condition would attach to the derived outputs as well. The platform must therefore
  **not** claim commercial permission and must not adopt a revenue model that depends on this layer
  until the type is confirmed.

---

## 9. Attribution requirements

**Official finding.** Attribution is required **on the free-use path**: O2 ① —
"자유이용의 경우에는 반드시 저작물의 출처를 구체적으로 표시하여야 합니다". O2 ③ additionally asks
that anyone directly linking EGIS works also link the copyright policy. **Whether the free-use path
applies to this product is unresolved**, so the attribution obligation is recorded as
**conditional and pending**, not as a satisfied checkbox.

**Draft attribution template — prepared, NOT deployed.** It deliberately contains **no KOGL type**
and **no permission claim**, and states the derived-work status explicitly. It must not be published
until LC7A returns an answer, because publishing an attribution block implies a settled licence.

```
출처: 기후에너지환경부 환경공간정보서비스(EGIS), 「세분류 [2025] 전국 토지피복지도」
      (기준연도 2025, 서울·인천·경기 벡터 자료)
가공: Waste Equity Platform이 위 자료를 500 m 후보격자(capital-grid-500m-v1) 단위로
      집계한 2차 통계입니다. 원자료의 도형·속성은 공개하지 않습니다.
이용조건: 공개·이용 조건 확인 중(서면 회신 대기). 공공누리 유형은 확인되지 않았습니다.
원본: https://aid.mcee.go.kr/intro/land.do
저작권 정책: https://aid.mcee.go.kr/bbs/copyright.do
```

| Placement | Required fields | Status |
| --- | --- | --- |
| Map layer control | provider · dataset · reference period · derived-statistics note · pending-condition note | **drafted, not deployed** |
| Candidate-detail panel | as above, condensed + link to the data/source page | **drafted, not deployed** |
| Data/source page | full block above, incl. acquisition date once confirmed from the download history | **drafted, not deployed** |
| API response metadata | machine-readable `attribution`, `source_url`, `copyright_policy_url` beside the existing `license_status` | **drafted, not deployed** |
| API documentation | full block + the "derived statistics, no raw geometry" statement | **drafted, not deployed** |
| Downloadable files | full block embedded in the file header | **n/a — no download exists** |
| Academic reports | full block + acquisition date + transformation version `land-cover-v1` | **drafted** |
| Screenshots | at minimum "출처: 기후에너지환경부 EGIS 세분류[2025] 토지피복지도 / Waste Equity Platform 가공" | **drafted** |

**Prohibited in every placement:** any 공공누리 badge or type number; the words 상업적 이용 가능;
any statement that redistribution is allowed; and the stale `egis.me.go.kr` URL.

---

## 10. Contact channel for written clarification

Verified **2026-08-02** from official pages only. **No email address was invented, and none is
published on the pages inspected** — so none is recorded.

| Preference | Channel | Detail |
| --- | --- | --- |
| 1 (dataset-specific) | *none found* | Neither O5 nor O3 offers a per-dataset inquiry function |
| **2 (recommended)** | **EGIS 질문과 답변 board** | https://aid.mcee.go.kr/bbs/list.do?section=1 — public thread with an official written reply signed 환경공간정보서비스 (O10). Login required to post. **Provides a written, publicly recorded response**; no case number observed |
| 2b | EGIS 건의하기 (suggestions) | https://aid.mcee.go.kr/bbs/list.do?section=3 — secondary |
| 3 | 기후에너지환경부 기획조정실 **정보화담당관** | Named in O4 p.2 as the receiving department for official-letter data requests; address (우)30103 세종특별자치시 도움6로 11 (어진동), 정부세종청사 6동 |
| 4 | 공공데이터포털 listing contact | Only for the WMS/statistics products (O7, O8) — **wrong product**, use only if EGIS does not answer |
| 5 | Official email | **NOT PUBLISHED on any page inspected — none recorded** |
| 6 (last resort) | Telephone **044-201-6472** | Published in the EGIS footer, on O4 p.1, and in the official board reply O10 (기후에너지환경부 정보화담당관실 / 데이터 담당자). Telephone gives **no written record** — use only to prompt a written reply |

**Written-response suitability:** the Q&A board is the only channel that reliably produces a
**written, attributable, timestamped** answer, which is what the evidence hierarchy's level 1
requires. An official letter via 문서24 (the O4 route) would also produce a written record and is
the stronger option if the board answer is vague.

**No inquiry was sent in LC7.** The ready-to-submit Korean text is
[EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md](EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md).

---

## 11. Decision matrix — all 20 questions

Each question resolved independently. **No single general permission statement was used to answer
several questions.** "Evidence" names the highest-authority source actually bearing on that question.

| # | Use | Status | Governing evidence | Note |
| --- | --- | --- | --- | --- |
| 1 | Storage in a private OCI database | `NOT_ADDRESSED` | O2, O3, O4 | No official text addresses where a lawful recipient may store the files. O4 p.2's custody controls (인수서, named users, fixed period) apply to the **restricted offline** product, not this online acquisition |
| 2 | Internal technical analysis | `NOT_ADDRESSED` | O4 pp.2–3 | The offline specimen letter frames 토지이용현황 분석 as a normal purpose, showing analysis is contemplated — but that is the offline route and is **not** a grant for the online product |
| 3 | Public browser map display | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④, O5 | Free use requires an attached KOGL mark; none exists for this product (§6.1), so O2 ② (consult first) governs |
| 4 | Public display of derived 500 m cell statistics | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④, O5 | O8 shows the ministry publishes its **own** area statistics openly, but that is a different dataset (§8-R6) |
| 5 | Public MVT vector-tile delivery | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④ | Tiles carry the project's own geometry, but the attribute payload is source-derived (§8-R7) |
| 6 | Public JSON API delivery of derived statistics | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④ | Complete pagination makes the API a de-facto bulk channel (§8-R9) |
| 7 | Public download of derived CSV or JSON | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④ | Not implemented; **must not be built** before resolution (§8-R10) |
| 8 | Public download of MVT tiles | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①②④ | Same as 5 plus unrestricted enumeration |
| 9 | Redistribution of original SHP files | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ④, O3, O4 p.1 | No permission exists; O2 ④ prohibits 복제·배포 for material the ministry does not wholly own, and ownership is unverified. **Project policy prohibits this permanently regardless of the answer** |
| 10 | Redistribution of transformed source geometries | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ④ | A reprojected/validated copy is still the source geometry. **Project policy prohibits this permanently regardless of the answer** |
| 11 | Display of official L1/L2/L3 codes and Korean class names | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ①, O5 | The taxonomy is published on O5 and fixed by national guideline, which lowers practical risk (§8-R4) — but no written permission covers reproducing it in a public service |
| 12 | Long-term browser / proxy / CDN / server caching | `NOT_ADDRESSED` | O6 (WMS only) | The provider **recommends** caching **for the WMS product**. Under the SHP-vs-WMS rule that statement is **not transferred** (§6), leaving the SHP-derived case unaddressed |
| 13 | Screenshots and exported map images | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ④ | 단순 열람 is permitted even for non-wholly-owned material; publishing an image exceeds viewing |
| 14 | Academic and nonprofit use | `NOT_ADDRESSED` | O2, O5 | No purpose-based distinction is published for this product. **A public-interest or academic character is not assumed to confer any right** |
| 15 | Commercial or revenue-generating use | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O7 vs O5, O9 | KOGL Type 1 (which would permit commercial use) is confirmed **only** for the WMS product. **Commercial permission must not be claimed** |
| 16 | Modification and creation of derivative works | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` | O2 ④, O9 | O2 ④ prohibits 개작 for material the ministry does not wholly own. If the product were Type 3/4, 변경금지 would bar the entire LC3 derivation from publication |
| 17 | Combination with suitability candidate geometry | `NOT_ADDRESSED` | — | No official text addresses combining with third-party geometry. Already performed locally; publication is gated by 4–8 |
| 18 | Use as descriptive context only | `NOT_ADDRESSED` | — | The current local use. Not separately permitted or prohibited by any inspected source |
| 19 | Use as input to suitability scoring or exclusions | `NOT_ADDRESSED` | — | Not addressed by the provider **and** independently `NOT_IMPLEMENTED` by project contract; requires a policy-version bump and justification irrespective of licence |
| 20 | Attribution and source-link requirements | `ALLOWED_WITH_CONDITIONS` | **O2 ① and ③** | **The clearest positive finding.** Attribution is mandatory on the free-use path ("반드시 … 출처를 구체적으로 표시"), and direct links should also link the copyright policy. Condition: the free-use path's applicability is itself unresolved, so the attribution must **not** assert a KOGL type (§9) |

**Tally:** 0 `EXPLICITLY_ALLOWED` · 1 `ALLOWED_WITH_CONDITIONS` · 0 `DERIVED_OUTPUT_ONLY` ·
0 `DISPLAY_ONLY` · 0 `EXPLICITLY_PROHIBITED` · 6 `NOT_ADDRESSED` · 0 `CONFLICTING_EVIDENCE` ·
13 `UNRESOLVED_PENDING_WRITTEN_RESPONSE`.

**Note on `CONFLICTING_EVIDENCE`:** none was assigned. The KOGL Type 1 designation at O7/O8 versus
the silence at O5 is **not** a conflict — they are **different products**. Recording it as a
conflict would smuggle in the WMS→SHP inference this phase forbids.

---

## 12. Publication-surface summary

Full matrix: [LAND_COVER_PUBLICATION_SURFACE_MATRIX.md](LAND_COVER_PUBLICATION_SURFACE_MATRIX.md).

| Group | Implemented? | Public status now |
| --- | --- | --- |
| A. Original source data (SHP, source geometry/attributes, map sheets) | not exposed anywhere | **never to be published** (project policy) |
| B. Normalized source data (transformed geometry, normalized attributes, PostGIS features) | in local DB | **blocked**; no endpoint exists |
| C. Derived data (coverage status/ratio, dominant classes, class areas, summaries) | implemented, local only | **blocked pending LC7A** |
| D. Rendered outputs (MVT, map, legend, detail panel, screenshots) | implemented, local only | **blocked pending LC7A** |
| E. Machine-readable access (JSON endpoints, CSV, direct MVT, bulk, docs samples) | JSON + MVT implemented locally; **CSV/bulk do not exist** | **blocked pending LC7A**; CSV/bulk must not be built |

---

## 13. Unresolved questions carried forward

| # | Question | Why it matters |
| --- | --- | --- |
| U1 | Does the ministry hold the **entire** economic copyright in the 세분류 토지피복지도 vector product? | Selects O2 clause ① (free use with attribution) vs clause ④ (viewing only) — the single highest-leverage fact |
| U2 | Is a **KOGL type** designated for the downloaded SHP product, and which one? | Types 2/4 would bar commercial use; types 3/4 would bar the LC3 derivation itself |
| U3 | Do the **online download** terms differ from the WMS terms? | The whole SHP-vs-WMS separation (§6) |
| U4 | Is a terms/pledge screen presented **inside** the authenticated 자료신청 form? | Level-3 evidence that could not be inspected (O3, Appendix A-L3) |
| U5 | Is publishing **derived 500 m statistics** permitted, and does that extend to a public API and MVT? | Questions 4–8 |
| U6 | Is **long-term immutable caching** of derived tiles acceptable? | Question 12 / §8-R11 |
| U7 | Is reproducing the **official class codes and Korean names** in a public service permitted? | Question 11 / §8-R4 |
| U8 | Required **attribution wording**, and may the platform state a KOGL type? | Question 20 / §9 |
| U9 | The **137-vs-130** Seoul discrepancy | **Still `UNRESOLVED`.** The application interface reportedly listed 137 items; the acquired Seoul SHP set holds 130. LC7 found a **possible contributing factor**, recorded as inference only: O4 p.1 states 공개제한 공간정보(접경지역 등) is not served online. **This is not an explanation** — Seoul is not a 접경지역 — and border-sheet redistribution remains the other candidate. **Neither is confirmed** |
| U10 | Acquisition date of the download | Needed for the attribution block; lives in the unavailable download-history PDF (§5.3) |

**None of these is converted into a permission anywhere in this document.**

---

## 14. Operational restrictions in force

Until LC7A returns a written answer:

1. **No OCI migration and no production deployment** of any land-cover table, endpoint, tile, or UI.
2. **No public activation** of `/api/v1/environment/land-cover/cell-statistics/*` or its tiles.
3. **No CSV, bulk-export, or download endpoint may be built.**
4. **No source geometry or raw source attribute endpoint may be built**, in any phase.
5. **No scoring, ranking, exclusion, or eligibility use** — independently gated by project contract.
6. **No runtime licence string may be upgraded**; `LOCAL_USE_ONLY_PENDING_CLARIFICATION` stands.
7. **No attribution block may be published**, since publishing one implies a resolved licence (§9).
8. **No KOGL type may be displayed, logged, or stored** for this product.
9. The local analytical pipeline **may continue** unchanged.

## 15. Prohibited claims

The project must **not** state, imply, or record any of the following — none is supported:

- that the downloaded 토지피복지도 SHP product is **KOGL Type 1** (or any type);
- that **commercial use** is permitted;
- that **redistribution** of the original SHP or of transformed source geometry is permitted;
- that **public deployment has occurred** — it has not; the feature set is local only;
- that a **written permission** has been obtained — none has;
- that the WMS terms, the 공공데이터포털 KOGL Type 1 listings, or the ministry's own published area
  statistics **govern this product**;
- that **availability for download** implies publication rights;
- that the project's **public-interest or academic character** confers any right.

---

## 16. Final status

| Field | Value |
| --- | --- |
| **Decision** | **`UNRESOLVED_PENDING_WRITTEN_RESPONSE`** |
| **Lifecycle state** | `LOCAL_USE_ONLY_PENDING_CLARIFICATION` — **unchanged** |
| **Deployment eligibility** | **BLOCKED** |
| Runtime status changed? | **No** |
| Database written? | **No** |
| Raw source data accessed? | **No** |
| Evidence PDFs committed? | **No** — none were available to read |
| OCI / production touched? | **No** |

### Exact next action

Submit the prepared Korean inquiry through the **EGIS 질문과 답변 board**
(https://aid.mcee.go.kr/bbs/list.do?section=1), using the web-form version in
[EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md](EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md), and record the
official reply verbatim in that document's response table. If the reply is vague, send the
follow-up version; if it remains vague, escalate to an official letter to
기후에너지환경부 기획조정실 정보화담당관 via 문서24.

### Exact next phase

> **LC7A — SUBMIT EGIS WRITTEN INQUIRY AND RECORD THE OFFICIAL RESPONSE**
>
> **Do not begin LC8, LC8A, LC8B, or LC8C.**

---

## Appendix A — evidence limitations

| # | Limitation |
| --- | --- |
| L1 | **No level-1 evidence exists.** No written provider response addresses this dataset and these uses. This alone determines the outcome |
| L2 | The four expected evidence PDFs were **unavailable** (§5.3); the external USB was **not mounted, not scanned, not searched** |
| L3 | The **authenticated** 자료신청 form could not be inspected, so any in-form terms acceptance (evidence level 3) is **unknown, not absent** (U4) |
| L4 | **토지피복지도작성지침** on law.go.kr could not be retrieved (O11); **no content from it is asserted** |
| L5 | Absence of a KOGL mark was established from the **rendered HTML** of six official pages. A mark delivered only inside the authenticated download package or a client-side widget would not have been detected |
| L6 | The **raw SHP source was not accessed** in any way, per phase rules, so no in-package licence file was checked |
| L7 | O2 carries **no revision date**, so its currency cannot be pinned beyond the 2026-08-02 access date |
