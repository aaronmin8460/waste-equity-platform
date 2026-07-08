# Waste Equity Platform Agent Rules

This repository supports a public-data platform for waste-management equity analysis and potential waste-facility location recommendations across the Seoul Metropolitan Area: Seoul, Incheon, and Gyeonggi-do.

These rules are mandatory for all agents and contributors.

## Data Integrity

- Never present mock, generated, estimated, sample, fallback, or placeholder data as official public data.
- Never silently replace unavailable real data with sample data.
- Clearly identify unverified assumptions in code, documentation, user-facing analysis, and review notes.
- Every displayed analytical metric must include its source and reference period.
- Distinguish annual, monthly, periodically updated, and real-time data in schemas, ingestion metadata, APIs, and UI labels.
- Do not infer waste origin-to-destination movement unless the source explicitly provides it.
- Real-time weather and air-quality readings must not be directly treated as permanent facility-siting evidence.

## API And Credential Handling

- The frontend must never call Korean government APIs directly.
- API credentials must only be loaded from environment variables.
- Do not commit secrets, API keys, downloaded credentials, tokens, or local `.env` files.
- Backend services and ingestion jobs must proxy, normalize, cache, and document public API access.

## Ingestion And Reproducibility

- Preserve sanitized raw API responses for reproducibility.
- Every ingestion job must be idempotent.
- Each ingestion run must record source, endpoint or file identifier, retrieval time, reference period, license or terms note where available, and transformation version.
- Failed ingestion must be visible in logs and job status; it must not degrade into hidden sample data.
- Raw data, intermediate normalized data, and derived analytical tables must be separable.

## Spatial And Analytical Caution

- Treat facility-siting recommendations as decision-support outputs, not final siting decisions.
- Document the assumptions behind scoring, weights, exclusion rules, buffers, joins, and spatial aggregation.
- Preserve administrative boundary versioning so analysis can be reproduced against the same geography.
- Validate coordinate reference systems before measuring distance, area, or proximity.

## Development Process

- Use small, reviewable development phases.
- Run formatting, linting, type checking, and tests before considering future implementation phases complete.
- Do not create application source code, install packages, create fake datasets, or start API integrations unless the current phase explicitly calls for it.
- Keep implementation work aligned with `docs/PROJECT_SPEC.md`, `docs/DEVELOPMENT_PHASES.md`, and `docs/DATA_REQUIREMENTS.md`.

