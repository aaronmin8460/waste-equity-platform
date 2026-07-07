# API Contract: Waste Statistics

Source: Korea Environment Corporation Resource Circulation Information System.

Official references:

- https://www.data.go.kr/data/15106003/openapi.do
- https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401
- https://www.data.go.kr/data/3070174/fileData.do

Live validation status: CREDENTIAL_MISSING.

## Authentication

Expected credentials:

- `RCIS_API_ID`
- `RCIS_API_KEY`

The RCIS page documents API application confirmation and management with an API ID and authentication key. Exact request credential placement must be confirmed from official endpoint documentation or live account materials.

## Known Official Coverage

- National waste generation and treatment status.
- Recycling performance and company status.
- Volume-based waste bag statistics.
- Other waste-statistics categories listed on the RCIS API page.

## Required Contract Validation

Before implementation, validate:

- Endpoint URLs and methods.
- Required parameters for year, region, waste category, and result format.
- City/county/district granularity.
- Seoul autonomous district availability.
- Incheon county/district availability.
- Gyeonggi city/county availability.
- Units.
- Treatment accounting definition.
- Facility/company fields.
- Provider-level result-code field and success value.

## Provider Result Validation

Provider-level result-code validation is UNVERIFIED until a real endpoint response is obtained.

## Phase 0.5 Result

No live request was attempted because `RCIS_API_ID` and `RCIS_API_KEY` were missing. All waste-statistics questions about geographic level, units, generation/treatment fields, treatment accounting basis, facility-level records, and origin-to-destination movement remain SCHEMA_UNVERIFIED or UNAVAILABLE as documented in the audit.

## Sample Policy

- If credentials are absent, connector status is `UNVERIFIED`.
- Fixture tests may validate local parser behavior only.
- No fixture may be labeled as official public data.
