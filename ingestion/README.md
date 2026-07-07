# Waste Equity Ingestion Probes

This directory contains a minimal API-probe package for Phase 0 data feasibility validation. It is not the production ingestion system.

Current constraints:

- Use only the lightweight Phase 0.5 dependencies declared in `pyproject.toml`.
- Do not create fake official datasets.
- Do not silently fall back to fixtures after live API failure.
- Do not print or save credentials.
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

The package loads `.env` with `python-dotenv` when the file exists. Credential values are never printed or saved.

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
```

Run tests after dependencies are installed:

```bash
pytest ingestion/tests
```

Phase 0.5 live result:

- SGIS: LIVE_VERIFIED, sample saved to `data/samples/sgis.live.json`.
- VWorld: LIVE_VERIFIED, sample saved to `data/samples/vworld.live.json`.
- Waste statistics, AirKorea, KMA: CREDENTIAL_MISSING.
