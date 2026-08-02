# Land-Cover Publication-Surface Matrix

**Phase:** 1B-LC7 · **Review date:** 2026-08-02 · **Starting commit:** `05be3b7d`
**Companion to:** [LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md)
**Governing decision:** `UNRESOLVED_PENDING_WRITTEN_RESPONSE` — **every public status below is
`BLOCKED` pending LC7A.**

This document enumerates exactly what the platform *could* expose from the acquired
세분류 [2025] 토지피복지도, so that no surface is activated by accident and each one has a named
evidence requirement and a named owning phase.

> **Risk columns are project judgement.**
> `PROJECT RISK ASSESSMENT — NOT AN OFFICIAL LICENCE STATEMENT`
> The **Required evidence** and **Proposed status** columns are policy positions of this project,
> not statements by the provider.

---

## 0. Verified architectural facts these ratings rest on

Confirmed by reading the implementation during LC7 (no code was changed):

- The API reads only the three persisted LC3 statistics tables plus the platform's **own**
  candidate-grid geometry. **No land-cover source geometry, source feature id, or raw source
  attribute is returned by any endpoint.**
- Vector tiles carry `suitability_candidates.geometry` (`capital-grid-500m-v1`, produced
  independently of the land-cover data), with LC3 statistics attached as attributes:
  `candidate_key`, `statistics_version_id`, `coverage_status`, `coverage_ratio`,
  `dominant_l1/l2/l3_code`, `dominant_l1/l2/l3_name`, `sido_region_code`, `sigungu_region_code`.
- Tiles are served `Cache-Control: public, max-age=31536000, immutable` with an `ETag`, z0–22.
- The cell list is offset-paginated: `DEFAULT_PAGE_SIZE = 50`, `MAX_PAGE_SIZE = 500`, over 47,893 cells.
- `/cells/{candidate_key}/classes` returns a cell's whole distribution unpaginated (≤70 rows/cell).
- **No CSV endpoint, no bulk export, and no download endpoint exists anywhere in the codebase.**
- Every response envelope carries structured disclosures including
  `license_status = LOCAL_USE_ONLY_PENDING_CLARIFICATION` and
  `used_in_suitability_scoring = false`.

**Route prefix:** `/api/v1/environment/land-cover/cell-statistics`
`GET /release` · `GET /summary` · `GET /cells` · `GET /cells/{key}` · `GET /cells/{key}/classes` ·
`GET /tiles/{statistics_version_id}/{z}/{x}/{y}.mvt`

---

## A. Original source data

| Surface | Implemented? | Local only? | Reproduces source geometry? | Exposes source attributes? | Reversible to source? | Could be redistribution? | Required evidence | Proposed public status | Deployment control | Owning phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Raw SHP files | **No** — never exposed | n/a | Yes (is the source) | Yes | Is the source | **Yes, unambiguously** | Explicit written redistribution permission | **NEVER PUBLISH** — permanent project prohibition, independent of LC7A | No endpoint exists; source tree is Git-ignored and was not accessed | permanent |
| A2 Raw source geometry | **No** | n/a | Yes | Yes | Yes | **Yes** | Explicit written permission | **NEVER PUBLISH** | No endpoint reads the feature table | permanent |
| A3 Raw source attributes (per-feature records) | **No** | n/a | No | Yes | Partially | **Yes** | Explicit written permission | **NEVER PUBLISH** | `RAW_FEATURE_STATEMENT` states this contractually | permanent |
| A4 Original map-sheet structure (2,013 sheets, sheet ids) | **No** | n/a | No | Partially (sheet index) | Aids reconstruction | Likely | Explicit written permission | **NEVER PUBLISH** | Not modelled in any response | permanent |

**Group A is out of scope for every future phase.** Even a `DERIVED_PUBLICATION_ONLY` or a fully
permissive LC7A answer does not cause these to be built.

---

## B. Normalized source data

| Surface | Implemented? | Local only? | Reproduces source geometry? | Exposes source attributes? | Reversible to source? | Could be redistribution? | Required evidence | Proposed public status | Deployment control | Owning phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 Transformed geometries (EPSG:5186 → 4326, `MakeValid`) | Stored in local dev DB | **Yes** | **Yes** — a reprojected copy is still the source geometry | Yes | **Yes** | **Yes** | Explicit written redistribution permission | **NEVER PUBLISH** — permanent project prohibition | No endpoint queries this table | permanent |
| B2 Normalized class attributes (per feature) | Stored locally | **Yes** | No | Yes | Partially | Yes | Explicit written permission | **NEVER PUBLISH** | Not exposed | permanent |
| B3 Source-level PostGIS features (6,901,309 rows, dataset_version 212) | Stored locally | **Yes** | Yes | Yes | Yes | **Yes** | Explicit written permission | **NEVER PUBLISH**; **private OCI storage separately gated** (decision Q1 = `NOT_ADDRESSED`) | Table exists only in the local dev DB; OCI load `NOT_RUN` | LC8+ for private storage only |

**Note on B1.** Reprojection and validity repair are mechanical transformations. This project does
**not** treat a transformed copy as a new work for redistribution purposes.

---

## C. Derived data

| Surface | Implemented? | Local only? | Reproduces source geometry? | Exposes source attributes? | Reversible to source? | Could be redistribution? | Risk | Required evidence | Proposed public status | Deployment control | Owning phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 500 m cell coverage status | Yes | **Yes** | No — project grid | No | No | Unlikely | Low | Written confirmation that derived publication is permitted | **BLOCKED** pending LC7A | Endpoint not deployed | LC8 / LC8A |
| C2 Coverage ratio | Yes | **Yes** | No | No | No | Unlikely | Low | as C1 | **BLOCKED** | not deployed | LC8 / LC8A |
| C3 Evaluated / uncovered area | Yes | **Yes** | No | No | No | Unlikely | Low | as C1 | **BLOCKED** | not deployed | LC8 / LC8A |
| C4 Dominant L1/L2/L3 class code + Korean name | Yes | **Yes** | No | **Official taxonomy reproduced verbatim** | No | Possible for the taxonomy | **Medium** | Written confirmation that reproducing official class codes/names publicly is permitted (decision Q11) | **BLOCKED** | not deployed | LC8 / LC8A |
| C5 Full class-area distribution (1,142,780 rows) | Yes | **Yes** | No | Taxonomy + areal content | **Partially at scale** — a 500 m areal decomposition of the whole source over the capital region | **Plausibly, in aggregate** | **Medium-High** | Written confirmation covering derived statistics **at full resolution**, explicitly (decision Q4) | **BLOCKED** — first surface to restrict if the answer is narrow | not deployed | LC8 / LC8A |
| C6 Regional summary tables (`/summary`) | Yes | **Yes** | No | Taxonomy | No | Unlikely | Low-Medium | as C1. The ministry publishes its own 시군구 area statistics as KOGL Type 1, which is **suggestive but confers nothing** | **BLOCKED** | not deployed | LC8 / LC8A |

---

## D. Rendered service outputs

| Surface | Implemented? | Local only? | Reproduces source geometry? | Exposes source attributes? | Reversible to source? | Could be redistribution? | Risk | Required evidence | Proposed public status | Deployment control | Owning phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 MVT tiles (`/tiles/{version}/{z}/{x}/{y}.mvt`) | Yes | **Yes** | No — candidate grid | Taxonomy as attributes | No per-tile; **whole layer by enumeration** | **Plausibly, in aggregate** | **Medium** | Written confirmation covering public tile delivery (Q5, Q8) | **BLOCKED** | not deployed | LC8 / LC8A |
| D2 Browser map layer | Yes | **Yes** | No | Displayed only | No | Unlikely | Low-Medium | Written confirmation for public map display (Q3) | **BLOCKED** | Layer defaults **OFF**; disclaimer states the pending condition | LC8 / LC8A |
| D3 Legend | Yes | **Yes** | No | **Official class names** | No | Unlikely | Low-Medium | as C4 | **BLOCKED** | not deployed | LC8 / LC8A |
| D4 Candidate-detail panel | Yes | **Yes** | No | Taxonomy + per-cell stats | No | Unlikely | Medium | as C4/C5 | **BLOCKED** | Renders served `license_status` verbatim | LC8 / LC8A |
| D5 Screenshots / exported images | Ad hoc | **Yes** | No | Visually | No | Possible (reproduction) | Low-Medium | Written confirmation for publication of images (Q13) | **BLOCKED for external publication**; internal QA use continues | Manual discipline + attribution template §9 | LC8 / LC7A |
| D6 Long-term caching of D1 (1 y immutable) | Yes | **Yes** | No | Attributes | No | Creates durable third-party copies | **Medium** | Written confirmation on caching (Q12) | **BLOCKED** with D1 | `TILE_CACHE_CONTROL` may need shortening if the answer is narrow | LC8 / LC8A |

---

## E. Machine-readable access

| Surface | Implemented? | Local only? | Reproduces source geometry? | Exposes source attributes? | Reversible to source? | Could be redistribution? | Risk | Required evidence | Proposed public status | Deployment control | Owning phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 `GET /release` (metadata + disclosures) | Yes | **Yes** | No | No | No | No | **Lowest** | Minimal — carries the pending status itself | **BLOCKED with the feature**; the first candidate to expose if a display-only answer arrives, since it publishes the *limits* | not deployed | LC8 / LC8A |
| E2 `GET /summary` | Yes | **Yes** | No | Taxonomy | No | Unlikely | Low-Medium | as C6 | **BLOCKED** | not deployed | LC8 / LC8A |
| E3 `GET /cells` (offset pagination, ≤500/page) | Yes | **Yes** | No | Taxonomy + stats | **Yes at scale** — ≈96 requests retrieves all 47,893 cells | **Plausibly — a complete public API is a de-facto bulk channel** | **Medium-High** | Written confirmation covering a public data API, not merely display (Q6) | **BLOCKED**; if the answer is display-only, requires pagination caps, rate limiting, or removal | not deployed | LC8 / LC8A |
| E4 `GET /cells/{key}` | Yes | **Yes** | No | Taxonomy + stats | Only per cell | Unlikely alone | Medium | as C4/C5 | **BLOCKED** | not deployed | LC8 / LC8A |
| E5 `GET /cells/{key}/classes` | Yes | **Yes** | No | Taxonomy + areas | **Yes at scale** — combined with E3 retrieves all 1,142,780 rows | **Plausibly, in aggregate** | **Medium-High** | as C5 | **BLOCKED** | not deployed | LC8 / LC8A |
| E6 Direct MVT access (scriptable z/x/y) | Yes | **Yes** | No | Attributes | **Yes at scale** | Plausibly | **Medium** | as D1 | **BLOCKED** | not deployed | LC8 / LC8A |
| E7 CSV export | **DOES NOT EXIST** | n/a | No | would expose taxonomy + stats | Yes at scale | **Yes** | **High** | Explicit written confirmation for derived-data download (Q7) | **MUST NOT BE BUILT** before LC7A resolves | No code exists — keep it that way | LC8 only, and only if permitted |
| E8 Bulk download / archive | **DOES NOT EXIST** | n/a | No | would expose all | **Yes** | **Yes** | **High** | Explicit written confirmation (Q7, Q8) | **MUST NOT BE BUILT** before LC7A resolves | No code exists | LC8 only, and only if permitted |
| E9 Documentation samples (example payloads in `docs/`) | Yes | Committed to the repo | No | A handful of class codes/names | No | Very unlikely | **Low** | none beyond attribution | **Already public in the repository** — accepted as de-minimis illustrative use | Keep samples small and illustrative; never paste bulk extracts into docs | ongoing |

**E9 is the only land-cover-derived content already outside the local environment**, in the form of
short illustrative response snippets in the LC3–LC6 documents. It is a handful of rows, is
inherently non-substitutive for the dataset, and is recorded here for completeness rather than as an
exposure needing remediation.

---

## Summary by decision outcome

What each possible LC7A answer would unlock. **Nothing is unlocked today.**

| LC7A outcome | A (source) | B (normalized) | C (derived) | D (rendered) | E (machine-readable) |
| --- | --- | --- | --- | --- | --- |
| `PUBLIC_DERIVED_USE_ELIGIBLE_WITH_CONDITIONS` | still never | still never | publish with attribution | publish with attribution | publish; E7/E8 buildable only if the answer names downloads |
| `DERIVED_PUBLICATION_ONLY` | still never | still never | publish | publish | publish C-derived endpoints; **E7/E8 remain forbidden** |
| `DISPLAY_ONLY_NO_PUBLIC_DATA_API` | never | never | display only | D2–D4 with restricted tiles; shorten D6 | **E3/E5/E6 restricted or removed; E7/E8 forbidden** |
| `NONCOMMERCIAL_PUBLIC_USE_ONLY` | never | never | publish, noncommercial notice | publish, noncommercial notice | publish, noncommercial notice — operating model must be verified first |
| `LOCAL_ANALYSIS_ONLY_PUBLICATION_PROHIBITED` | never | never | remove from public build | remove layer, legend, panel | remove all endpoints; keep the local pipeline |
| **`UNRESOLVED` (current)** | **never** | **never** | **BLOCKED** | **BLOCKED** | **BLOCKED** |

---

## Standing controls

1. Every surface in C, D and E exists **only against the local development database**; OCI load is
   `NOT_RUN` and no deployment step for land cover exists in `docs/DEPLOYMENT.md` or
   `docs/OCI_DEPLOYMENT_CHECKLIST.md`.
2. The map layer defaults **OFF** and carries a disclaimer stating the licence is unconfirmed.
3. Every response carries `license_status = LOCAL_USE_ONLY_PENDING_CLARIFICATION` and
   `used_in_suitability_scoring = false`; tests assert both strings.
4. **Groups A and B are permanently out of scope for publication**, whatever LC7A returns.
5. **E7 and E8 must not be implemented** while the decision is `UNRESOLVED`.
6. No attribution block is published yet — doing so would imply a resolved licence
   (see decision record §9).
