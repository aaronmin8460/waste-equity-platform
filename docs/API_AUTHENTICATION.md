# API Authentication

Credentials must only be loaded from environment variables. They must never be committed, printed, logged, or saved in response samples.

Local handling: the probe package loads `.env` through `python-dotenv` from the current directory or a parent project directory when the file exists, then reads credentials and request configuration from environment variables. The local `.env` file is ignored by Git.

## Environment Variables

| Variable | Source | Required for live probe | Notes |
| --- | --- | --- | --- |
| `RCIS_API_KEY` | Resource Circulation Information System | Yes | API authentication key issued by the RCIS account management page. |
| `RCIS_USER_ID` | Resource Circulation Information System | Yes for RCIS request configuration | Non-secret `USRID` request parameter documented as `아이디` / user ID in the official utilization guide. Do not print it. |
| `RCIS_API_BASE_URL` | Resource Circulation Information System | No | Optional override for future confirmed endpoint base URL. |
| `SGIS_CONSUMER_KEY` | SGIS | Yes | Service ID used to request an access token. |
| `SGIS_CONSUMER_SECRET` | SGIS | Yes | Service Secret used to request an access token. |
| `DATA_GO_KR_SERVICE_KEY` | Public Data Portal | Yes for AirKorea and KMA | Shared service key for data.go.kr APIs when approved for each service. |
| `AIRKOREA_SERVICE_KEY` | AirKorea through data.go.kr | Optional | Source-specific override if separate key management is preferred. |
| `KMA_SERVICE_KEY` | KMA through data.go.kr | Optional | Source-specific override if separate key management is preferred. |
| `VWORLD_API_KEY` | VWorld | Yes | VWorld OpenAPI key. |
| `VWORLD_API_DOMAIN` | VWorld | Sometimes | Required by VWorld for some browser/webview request patterns and domain-bound keys. |

## Current Credential And Configuration Status

| Source | Credential status | Notes |
| --- | --- | --- |
| Waste statistics | LIVE_VERIFIED | `RCIS_API_KEY` and `RCIS_USER_ID` were configured locally; values were not printed. |
| SGIS | LIVE_VERIFIED | Required credentials were configured; values were not printed. |
| AirKorea | CREDENTIAL_MISSING | Neither source-specific nor shared data.go.kr key was configured. |
| KMA | CREDENTIAL_MISSING | Neither source-specific nor shared data.go.kr key was configured. |
| VWorld | LIVE_VERIFIED | Required key was configured; value was not printed. |

## Source Processes

### Resource Circulation Information System

The RCIS API page links to the official utilization guide and states that the service is a REST JSON OpenAPI. The RCIS API application confirmation and management page has fields for an ID and an authentication key, but this is documented for application confirmation and management, not as proof that a separate API ID secret is required for requests.

Use `RCIS_API_KEY` as the only required RCIS secret unless the official RCIS OpenAPI utilization guide documents an additional request credential. A fixed endpoint service code, statistics table identifier, operation name, or user/request identifier must be modeled as endpoint metadata or normal configuration, not as a secret.

Live validation status: LIVE_VERIFIED for `wss/JsonApi/NTN001` with `YEAR=2024`. Do not use the user's RCIS website login ID as an API credential.

Official evidence used:

- The RCIS OpenAPI page documents the service as JSON REST and links the official `폐기물통계 OpenAPI 활용가이드`.
- The RCIS management page says its ID/key fields are for OpenAPI application confirmation and management.
- The official utilization guide's service-authentication section shows requests using `USRID={아이디}` and `KEY={API인증키}`.
- The official utilization guide's request-message table lists `KEY`, `USRID`, `PID`, and `YEAR`.
- The user's current RCIS account management page issued only one API credential: an API key.

Parameter classification:

- `KEY`: authentication credential; load from `RCIS_API_KEY` only.
- `USRID`: documented request parameter named "아이디" / user ID; load from `RCIS_USER_ID`, treat as non-secret request configuration, and do not print its value.
- `PID`: endpoint-specific waste-statistics form code; model as endpoint metadata.
- `YEAR`: normal query parameter for reference year.

Remaining uncertainty: the official guide documents `USRID` as required but does not prove from the inspected pages whether it is always the normal RCIS website login ID or a separate OpenAPI account identifier. The configured `RCIS_USER_ID` worked for the live request and must still be treated as non-secret request configuration whose value is not printed.

### SGIS

SGIS authentication endpoint:

`https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json`

Required parameters:

- `consumer_key`
- `consumer_secret`

Successful responses include:

- `errCd` equal to `0`
- `accessToken`
- `accessTimeout`

The access token must be used only in backend or probe requests and must not be stored in samples.

### AirKorea

AirKorea APIs are exposed through data.go.kr and require `serviceKey`. Development-stage approval is documented as automatic, with a development traffic allowance of 500 requests. Production-stage use requires review.

Probe variables:

- Prefer `AIRKOREA_SERVICE_KEY` if set.
- Otherwise use `DATA_GO_KR_SERVICE_KEY`.

### Korea Meteorological Administration

KMA short-term forecast APIs are exposed through data.go.kr and require `ServiceKey`. Development and production approval are documented as automatic. Development traffic is documented as 10,000 requests.

Probe variables:

- Prefer `KMA_SERVICE_KEY` if set.
- Otherwise use `DATA_GO_KR_SERVICE_KEY`.

### VWorld

VWorld uses an issued API key. WMS/WFS and 2D Data API requests include `key=...`. Some request contexts require a registered `domain` parameter.

Probe variables:

- `VWORLD_API_KEY`
- `VWORLD_API_DOMAIN` when needed

## Probe Failure Semantics

- Missing credentials must return a missing-credentials status and must not attempt a live request.
- Remote HTTP failures must return nonzero exit codes.
- Provider-level result-code failures must return nonzero exit codes even if HTTP status is 200.
- Fixture data must never be used after a failed live request.
- Sanitized samples must redact all credential-like fields before writing under `data/samples/`.
