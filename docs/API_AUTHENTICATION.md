# API Authentication

Credentials must only be loaded from environment variables. They must never be committed, printed, logged, or saved in response samples.

Phase 0.5 local handling: the probe package loads `.env` through `python-dotenv` when the file exists, then reads credentials from environment variables. The local `.env` file is ignored by Git.

## Environment Variables

| Variable | Source | Required for live probe | Notes |
| --- | --- | --- | --- |
| `RCIS_API_ID` | Resource Circulation Information System | Yes | API account identifier if issued by the RCIS application process. |
| `RCIS_API_KEY` | Resource Circulation Information System | Yes | API key delivered after application. |
| `RCIS_API_BASE_URL` | Resource Circulation Information System | No | Optional override for future confirmed endpoint base URL. |
| `SGIS_CONSUMER_KEY` | SGIS | Yes | Service ID used to request an access token. |
| `SGIS_CONSUMER_SECRET` | SGIS | Yes | Service Secret used to request an access token. |
| `DATA_GO_KR_SERVICE_KEY` | Public Data Portal | Yes for AirKorea and KMA | Shared service key for data.go.kr APIs when approved for each service. |
| `AIRKOREA_SERVICE_KEY` | AirKorea through data.go.kr | Optional | Source-specific override if separate key management is preferred. |
| `KMA_SERVICE_KEY` | KMA through data.go.kr | Optional | Source-specific override if separate key management is preferred. |
| `VWORLD_API_KEY` | VWorld | Yes | VWorld OpenAPI key. |
| `VWORLD_API_DOMAIN` | VWorld | Sometimes | Required by VWorld for some browser/webview request patterns and domain-bound keys. |

## Phase 0.5 Credential Status

| Source | Credential status | Notes |
| --- | --- | --- |
| Waste statistics | CREDENTIAL_MISSING | `RCIS_API_ID` and `RCIS_API_KEY` were not configured. |
| SGIS | LIVE_VERIFIED | Required credentials were configured; values were not printed. |
| AirKorea | CREDENTIAL_MISSING | Neither source-specific nor shared data.go.kr key was configured. |
| KMA | CREDENTIAL_MISSING | Neither source-specific nor shared data.go.kr key was configured. |
| VWorld | LIVE_VERIFIED | Required key was configured; value was not printed. |

## Source Processes

### Resource Circulation Information System

The RCIS API page links to API application confirmation and management. The page text says API ID and an authentication key delivered to the registered email are used for API application confirmation and management.

Live validation status: UNVERIFIED until an API ID/key is issued and an official endpoint schema is inspected.

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
