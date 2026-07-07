# Phase 0 Findings

Audit date: 2026-07-07.

Local validation date: 2026-07-07.

## Decision

The Waste Equity Platform is feasible as a real public-data decision-support platform for Seoul, Incheon, and Gyeonggi-do, but the originally implied waste-responsibility metric is not feasible without stronger official data.

The next implementation phase should build source metadata, credentialed live probes, and region-code crosswalks before any frontend, backend product API, production database, scheduler, or facility recommendation engine.

## Key Findings

1. SGIS and VWorld were live-verified locally with configured credentials.
2. AirKorea, KMA, and waste-statistics credentials were missing locally, so live probes were not attempted for those sources.
3. SGIS, AirKorea, KMA, and VWorld have documented official APIs that can support population, boundaries, real-time air quality, weather/wind context, parcels, zoning, and structural spatial screening.
4. The Resource Circulation Information System documents waste generation/treatment statistics and annual waste file data, but the public pages found in this audit do not expose enough field definitions to confirm district-level API coverage or treatment accounting basis.
5. No required-source documentation found in this audit provides waste origin-to-destination movement.
6. Real-time air-quality and weather data are useful current-context layers only. They must not be used as permanent facility-siting evidence without separate historical analysis sources.
7. VWorld structural data can support screening only where feature geometry, attributes, license, and reference dates are available. WMS-only visualization is not enough for reproducible analysis.
8. Incheon administrative changes are current and source-specific. AirKorea's 2026-06-30 notice says Incheon restructuring is reflected in relevant APIs.

## Phase 0.5 Validation Status

| Source | Credential status | Live probe status | Schema validation status | Geographic coverage | Latest reference period observed | Sample file | Remaining issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Waste statistics | CREDENTIAL_MISSING | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | RCIS endpoint contract, geographic granularity, units, and treatment accounting basis remain unverified. |
| SGIS | LIVE_VERIFIED | LIVE_VERIFIED | LIVE_VERIFIED | Seoul probe returned 25 district-level records for `adm_cd=11`; Incheon and Gyeonggi-do require separate code probes. | 2020 | `data/samples/sgis.live.json` | Boundary endpoint, Incheon, and Gyeonggi-do probes still need live validation. |
| AirKorea | CREDENTIAL_MISSING | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | Credential required before real-time observation and station schemas can be live-verified. |
| KMA | CREDENTIAL_MISSING | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | Credential required before weather/wind observation schemas can be live-verified. |
| VWorld | LIVE_VERIFIED | LIVE_VERIFIED | LIVE_VERIFIED | Small Seoul cadastral bounding-box probe returned one feature; broader Seoul/Incheon/Gyeonggi coverage requires tiled or download validation. | SCHEMA_UNVERIFIED | `data/samples/vworld.live.json` | Zoning, public-land ownership, protected-area, road, and sensitive-facility layers still require layer-specific validation. |

## Metric Finding

The metric `treatment quantity / generation quantity` must not be presented as a treatment responsibility or burden metric.

Approved substitute name:

`Reported Treatment-to-Generation Imbalance Ratio`

Allowed claim:

- The reported generation and reported treatment quantities for the same region, waste category, source, and reference period are imbalanced.

Disallowed claims unless explicit source data is obtained:

- A region avoids treatment responsibility.
- A region bears excess treatment burden.
- Waste moved from one region to another.
- Reported regional treatment equals physical facility throughput in that region.

## Implementation Gates For The Next Phase

- Obtain credentials for SGIS, data.go.kr services, VWorld, and RCIS if required.
- Run live probes and save sanitized `LIVE_VERIFIED` samples.
- Confirm waste API fields, units, reference periods, regional granularity, and treatment accounting definitions.
- Build a versioned region-code crosswalk before loading metrics.
- Document any unavailable or unverified input in the source registry.
- Keep all fixture data marked `FIXTURE_ONLY`.

## Current Validation Status

| Item | Status |
| --- | --- |
| Official documentation audit | Complete for Phase 0. |
| Live API probes | SGIS and VWorld LIVE_VERIFIED; remaining sources CREDENTIAL_MISSING. |
| Fixture contract tests | Passing. |
| Application frontend/backend | Not created. |
| Production database/Docker infrastructure | Not created. |
| Facility recommendation engine | Not created. |

## Phase 0.5 Recommendation

Recommendation: `CONDITIONAL_GO`.

Reason: SGIS, an essential geographic/population source, is live verified for a Seoul district-level population request, and VWorld is live verified for a cadastral feature request. However, the essential waste-statistics source is still `CREDENTIAL_MISSING`, so Phase 1 may proceed only for repository/tooling architecture that preserves data provenance and leaves waste metrics blocked until RCIS live validation is complete.
