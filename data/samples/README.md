# API Probe Samples

Live probe samples, when created in a later credentialed run, must be sanitized and marked `LIVE_VERIFIED`.

Fixture samples must be marked `FIXTURE_ONLY`.

No sample in this directory may contain credentials or be presented as official public data unless it is a sanitized live response with source and reference metadata.

Phase 0.5 created sanitized live samples for SGIS and VWorld:

- `sgis.live.json`
- `vworld.live.json`

These `.json` samples are ignored by Git through `.gitignore`.
