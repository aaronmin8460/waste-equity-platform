# API Probe Samples

Live probe samples, when created in a later credentialed run, must be sanitized and marked `LIVE_VERIFIED`.

Fixture samples must be marked `FIXTURE_ONLY`.

No sample in this directory may contain credentials or be presented as official public data unless it is a sanitized live response with source and reference metadata.

Phase 0.5 created sanitized live samples for SGIS and VWorld:

- `sgis.live.json`
- `vworld.live.json`

Phase 0.6 created a sanitized live RCIS waste-statistics sample:

- `waste-statistics.live.json`

The RCIS sample is `LIVE_VERIFIED` for `wss/JsonApi/NTN001`, `YEAR=2024`. It verifies the management-area table only; it does not provide waste generation or treatment quantities.

Phase 2.1 SGIS production ingestion does not add committed live response
samples. Successful production responses are sanitized and stored in the
database `raw_api_responses` table with source, endpoint, reference period,
response hash, transformation version, and ingestion-run provenance. SGIS
authentication tokens and credentials are not stored.

Phase 2.2 and Phase 2.3 RCIS production ingestion (regional waste statistics and
waste-treatment facilities) likewise store sanitized production responses in
`raw_api_responses` (source id `waste_statistics`), not in committed sample
files. The RCIS `KEY` and `USRID` request parameters are never part of a stored
response and are never printed. The truncated Phase 0.7 discovery samples
(`waste-statistics.<PID>.<YEAR>.live.json`, 20 records each) remain Git-ignored
and are the only committed-format RCIS samples; they are not used as a fallback
for production ingestion.

These `.json` samples are ignored by Git through `.gitignore`.
