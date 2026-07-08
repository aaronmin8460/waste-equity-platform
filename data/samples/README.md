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

These `.json` samples are ignored by Git through `.gitignore`.
