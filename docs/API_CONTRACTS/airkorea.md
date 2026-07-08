# API Contract: AirKorea

Source: Korea Environment Corporation AirKorea APIs through data.go.kr.

Official references:

- https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15073861
- https://www.data.go.kr/data/15073877/openapi.do
- https://www.data.go.kr/bbs/ntc/selectNotice.do?originId=NOTICE_0000000004805

Live validation status: CREDENTIAL_MISSING.

## Authentication

Required environment variable:

- `AIRKOREA_SERVICE_KEY`, or fallback `DATA_GO_KR_SERVICE_KEY`

Request parameter:

- `serviceKey`

## Real-Time Observation Endpoints

Service URL:

`http://apis.data.go.kr/B552584/ArpltnInforInqireSvc`

Important operations:

- `getMsrstnAcctoRltmMesureDnsty`: station-level real-time measurement lookup.
- `getCtprvnRltmMesureDnsty`: city/province real-time measurement lookup.

Expected common parameters:

- `serviceKey`
- `returnType=json`
- `numOfRows`
- `pageNo`

Success criteria:

- HTTP status 200.
- Header result code is `00`.

## Station Information Endpoint

Service URL:

`http://apis.data.go.kr/B552584/MsrstnInfoInqireSvc`

Important operation:

- `getMsrstnList`

Expected station fields from official documentation:

- `stationName`
- `addr`
- `year`
- `mangName`
- `item`
- `dmX`
- `dmY`

## Observation Semantics

AirKorea observations are real-time or near-real-time. They must be displayed with measurement timestamp and source. They must not be directly treated as permanent facility-siting evidence.

## Open Contract Items

- Exact observation interval must be confirmed from the official technical document or live response cadence.
- Missing-value conventions must be confirmed before numeric parsing.
- Station identifier stability must be confirmed before designing durable database keys.

## Phase 0.5 Result

No live request was attempted because neither `AIRKOREA_SERVICE_KEY` nor `DATA_GO_KR_SERVICE_KEY` was configured. Real-time observation, station metadata, missing-value conventions, and Seoul/Incheon/Gyeonggi coverage remain SCHEMA_UNVERIFIED locally.
