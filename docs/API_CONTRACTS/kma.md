# API Contract: Korea Meteorological Administration

Source: KMA short-term forecast service through data.go.kr.

Official references:

- https://www.data.go.kr/data/15084084/openapi.do
- https://data.kma.go.kr/community/nuriLovePopup.do

Live validation status: CREDENTIAL_MISSING.

## Authentication

Required environment variable:

- `KMA_SERVICE_KEY`, or fallback `DATA_GO_KR_SERVICE_KEY`

Request parameter:

- `ServiceKey`

## Service URL

`http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0`

## Endpoints

- `getUltraSrtNcst`: ultra-short observation.
- `getUltraSrtFcst`: ultra-short forecast.
- `getVilageFcst`: short-term forecast.
- `getFcstVersion`: forecast version.

## Common Parameters

- `ServiceKey`
- `pageNo`
- `numOfRows`
- `dataType`, with `JSON` preferred for probes
- `base_date`
- `base_time`
- `nx`
- `ny`

## Wind Fields

Official documentation for ultra-short observations includes:

- `WSD`: wind speed.
- `UUU`: east-west wind component.
- `VVV`: north-south wind component.

Wind direction must be either confirmed as a direct category for the selected endpoint or derived from vector components with a documented and tested formula.

## Grid Handling

KMA uses a 5 km by 5 km grid. Candidate sites must be converted to `nx`, `ny` before requesting observations or forecasts. Multiple sites in the same grid and base time should share one request.

Success criteria:

- HTTP status 200.
- Header result code is `00`.

## Open Contract Items

- Exact publication schedule and safe delay after `base_time`.
- Direct wind-direction category availability by endpoint.
- Production grid-conversion implementation verified against official KMA guidance.

## Phase 0.5 Result

No live request was attempted because neither `KMA_SERVICE_KEY` nor `DATA_GO_KR_SERVICE_KEY` was configured. Weather observation, wind-speed, wind-direction, and grid-coordinate behavior remain SCHEMA_UNVERIFIED locally.
