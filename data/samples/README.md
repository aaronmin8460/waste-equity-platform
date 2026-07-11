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

Phase 2.5A (2026-07-11) created sanitized live samples for the VWorld
structural-layer contract probes, regenerable with:

```bash
PYTHONPATH=backend/src:ingestion/src \
  python -m waste_equity_ingestion.cli vworld-structural-audit --save-sample
```

- `vworld-wfs-<layer>.live.json` — `req/wfs` GetFeature (version 1.1.0,
  GeoJSON, EPSG:4326, `maxFeatures=1`) for the 14 audited layers
  (`lt_c_uq111`–`uq114`, `lt_c_uq162`, `lt_c_ud801`, `lt_c_um710`,
  `lt_c_um901`, `lt_c_um221`, `lt_c_uf151`, `lt_c_uo101`, `lt_c_uo301`,
  `lt_c_wgisnpgug`, `lt_l_moctlink`, `lt_l_n3a0020000`).
- `vworld-2d-<layer>.live.json` — `req/data` GetFeature (version 2.0,
  `size=1`, EPSG:4326) for the same layers; the `lt_c_uq111` sample also
  records the pagination probe and the deliberate provider-error probe
  (including the observed malformed-JSON error body).
- `vworld-ownership-dt_d160.live.json` / `vworld-landuse-dt_d154.live.json`
  — NED `getPossessionWFS` / `getLandUseWFS` probes.

Each sample records retrieval timestamp, layer identifier, requested CRS,
per-region bounding boxes (Seoul, Incheon, Gyeonggi-do), HTTP and provider
status, observed geometry type, observed attribute and null fields, and the
sanitized payload. No API key or credential-bearing request URL is stored.
Zero-feature regional results are recorded honestly (for example, no national
park polygon exists in the probed mainland Incheon box).

These `.json` samples are ignored by Git through `.gitignore`.
