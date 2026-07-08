# Waste Equity Ingestion Probes

This directory contains a minimal API-probe package for Phase 0 data feasibility validation. It is not the production ingestion system.

Current constraints:

- Use only the lightweight Phase 0.5 dependencies declared in `pyproject.toml`.
- Do not create fake official datasets.
- Do not silently fall back to fixtures after live API failure.
- Do not print or save credentials.
- Do not print the RCIS `USRID` value configured as `RCIS_USER_ID`.
- Save only sanitized samples under `data/samples/`.

## Planned Lightweight Dependencies

The package metadata allows only lightweight validation tooling:

- httpx
- pydantic
- pydantic-settings
- pytest
- pytest-asyncio
- ruff
- mypy
- python-dotenv

Phase 0.5 creates a local `.venv` and installs these dependencies only for local validation.

## Environment Variables

See [API Authentication](../docs/API_AUTHENTICATION.md).

The package loads `.env` with `python-dotenv` from the current directory or a parent project directory when the file exists. Credential values are never printed or saved.

## Probe Semantics

- Missing credentials exit distinctly from remote API failure.
- HTTP status and provider-level result codes are both validated.
- Samples are marked `LIVE_VERIFIED` or `FIXTURE_ONLY`.
- Fixture tests validate response-shape handling only and must not be presented as real public data.

## Example Commands

After dependencies are installed in a later phase:

```bash
python -m waste_equity_ingestion.cli airkorea --save-sample
python -m waste_equity_ingestion.cli sgis --save-sample
python -m waste_equity_ingestion.cli kma --save-sample
python -m waste_equity_ingestion.cli vworld --save-sample
python -m waste_equity_ingestion.cli waste-statistics

# Phase 0.7 RCIS PID discovery: probe the documented target PIDs (default)
# or an explicit list, and save sanitized truncated samples per PID/year.
python -m waste_equity_ingestion.cli waste-statistics-discovery --year 2023 --save-sample
python -m waste_equity_ingestion.cli waste-statistics-discovery --pids NTN007,NTN018 --year 2024
```

Discovery respects the documented provider quota (100 calls/minute, 3,000 calls/day) with an inter-request delay, and classifies each PID as `LIVE_VERIFIED`, `NO_DATA_FOR_CONDITION` (`E099`), `PROVIDER_ERROR`, `SCHEMA_UNVERIFIED`, or `HTTP_ERROR`.

Run tests after dependencies are installed:

```bash
pytest ingestion/tests
```

Phase 0.5 live result:

- SGIS: LIVE_VERIFIED, sample saved to `data/samples/sgis.live.json`.
- VWorld: LIVE_VERIFIED, sample saved to `data/samples/vworld.live.json`.
- Waste statistics: LIVE_VERIFIED for `wss/JsonApi/NTN001`, `YEAR=2024`; sanitized sample saved to `data/samples/waste-statistics.live.json`. This PID verifies the management-area table only, not waste generation or treatment quantities.
- AirKorea, KMA: CREDENTIAL_MISSING.

Phase 0.7 live result (2026-07-08):

- RCIS generation/treatment PIDs (`NTN007`, `NTN008`, `NTN018`, `NTN022`) and facility PIDs (`NTN031`, `NTN032`, `NTN033`, `NTN040`, `NTN043`, `NTN046`): LIVE_VERIFIED at sigungu granularity for 2023 and 2024; sanitized truncated samples saved as `data/samples/waste-statistics.<PID>.<YEAR>.live.json`.
- `NTN044`: SCHEMA_UNVERIFIED (single placeholder-like record).
- See `docs/API_CONTRACTS/waste_statistics.md` for the full PID contract.
