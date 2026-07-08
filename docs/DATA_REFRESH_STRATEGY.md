# Data Refresh Strategy

Refresh jobs must be idempotent, preserve sanitized raw responses, and fail visibly when official data is unavailable. They must never silently replace unavailable real data with fixture or sample data.

## Refresh Matrix

| Source/data | Check frequency | Expected publication frequency | Incremental-load key | Deduplication strategy | Freshness warning threshold | Retry policy | Failure behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Annual official waste statistics | Monthly check for new annual release | Annual | `source_id`, `reference_year`, `waste_category`, `region_code_or_label`, `metric_code` | Upsert by full natural key plus transformation version | Warn if latest reference year is more than 18 months behind current date or later than official expected registration date | 3 attempts with exponential backoff, then manual review | Mark source stale; do not substitute sample data. |
| Monthly or periodic waste records, if available | Weekly after source discovery | UNVERIFIED | `source_id`, `reference_period`, `region_code_or_label`, `record_type` | Upsert by source primary fields and retrieval metadata | Source-specific after endpoint validation | 3 attempts; stop on provider-level schema change | Mark UNVERIFIED/stale until real source recovers. |
| Population data | Quarterly check | Census or official statistical release cadence | `source_id`, `reference_year`, `sgis_adm_cd`, `population_type` | Replace partition by reference year and geography after validation | Warn if selected population year is not aligned with metric documentation | 3 attempts; no retry storm | Keep last verified version with stale warning. |
| Administrative boundaries | Quarterly check and before major analysis releases | Periodic/versioned | `source_id`, `boundary_year`, `adm_cd`, `geometry_hash` | Versioned insert; never overwrite prior boundary version | Warn if metric uses boundary older than selected population/waste period without note | 3 attempts; schema validation required | Block new spatial outputs if boundary version is unresolved. |
| Waste-facility information | Monthly check after source validation | UNVERIFIED | `source_id`, `facility_id_or_name`, `address`, `reference_date` | Match on official ID if available; otherwise reviewed composite key | Warn after 90 days without refreshed facility status unless annual source dictates otherwise | 3 attempts, then manual source review | Preserve previous verified data with stale warning; do not infer closures or capacities. |
| AirKorea real-time observations | Every 10-15 minutes for selected stations, respecting traffic limits | Real-time/hourly operational updates | `station_name_or_id`, `data_time`, `pollutant` | Ignore exact duplicate station/time/pollutant records | Warn when observations are older than 2 hours | Retry twice with short backoff; skip cycle on repeated provider failure | Display unavailable/stale status; do not use stale real-time values as current. |
| KMA weather observations and forecasts | Every 30-60 minutes by unique grid and base time | Real-time forecast cycle | `nx`, `ny`, `base_date`, `base_time`, `category`, `forecast_time` | Upsert by grid/base/forecast/category | Warn when current context is older than 2 hours or forecast base is superseded | Retry twice with provider-aware base-time fallback only if documented | Display unavailable/stale status; do not invent weather. |
| VWorld structural spatial datasets | Monthly metadata check; refresh on new dataset date | Change-based or monthly depending on dataset | `dataset_id`, `dataset_reference_date`, `feature_id_or_geometry_hash` | Versioned spatial loads; keep prior geometries | Warn if zoning/cadastral data are more than 90 days behind VWorld metadata or source-specific threshold | Retry download/API 3 times; checksum and schema validation | Block affected siting screens until layer status is clear. |

## Idempotency Rules

- Every run records a run ID, source, reference period, retrieval timestamp, request fingerprint, response fingerprint, and transformation version.
- Re-running a job with the same source payload and transformation version must not duplicate records.
- New transformations of the same raw payload must produce a new derived version, not overwrite old derived results.

## Raw Response Rules

- Store only sanitized raw responses or source files.
- Redact service keys, API IDs, access tokens, signatures, authorization headers, and credential-like query parameters.
- Store samples and probes under `data/samples/` only when marked `LIVE_VERIFIED` or `FIXTURE_ONLY`.
- Do not commit live response samples unless a later governance phase explicitly approves that storage pattern.

## Phase 0.6 Refresh Implications

- SGIS refresh planning can proceed for source-registry and code-crosswalk design, but boundary endpoint, Incheon, and Gyeonggi-do live probes must be added before metric publication.
- VWorld cadastral refresh planning can proceed for small-area probes; large-area Seoul/Incheon/Gyeonggi coverage should use official downloads or tiled requests that respect VWorld limits.
- Waste-statistics refresh can be planned for live-verified `NTN001` management-area records. Generation/treatment refresh remains blocked until the relevant PIDs are live-validated for fields, units, and accounting basis. Use `RCIS_API_KEY` as the only required RCIS secret; use `RCIS_USER_ID` only as non-secret `USRID` request configuration.
- AirKorea and KMA refresh schedules remain documented but not live-verified locally.
