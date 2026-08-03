"use client";

/**
 * One source record in the catalog.
 *
 * Leads with the plain-Korean dataset name; the technical identifiers (`source_id`,
 * the served English strings, the endpoint, the raw freshness status) are demoted to
 * a `[data-diagnostic]` disclosure. A search CAN match on those identifiers — the
 * reader may have arrived with one — but matching never promotes an identifier to
 * the title. The first `<p>` in this card is therefore always the dataset name, and
 * both suites read it that way.
 *
 * ── THE TWO PLACES A BADGE IS USED, AND WHY ─────────────────────────────────────
 * `DataStatusBadge` states how a value came to be, so it is used only where a value
 * genuinely is or is not there:
 *
 *   - 기준 기간 with no served period → `missing`. The neutral no-data gray with its
 *     text label, because "no period was served" is an absence, not a caution and
 *     not a zero. A period that WAS served is a value and needs no badge; a freshness
 *     request that is in flight or that failed is neither — those keep their own
 *     sentences, because they are statements about the REQUEST, not about the data.
 *   - `enabled: false` → `excluded`, whose documented meaning is "deliberately
 *     outside the analysis". A registry row that is registered but switched off is
 *     exactly that. Its label stays the served-state wording 사용 안 함, and an
 *     enabled row keeps the plain 사용 중 text — the badge marks the exceptional
 *     state rather than decorating both.
 *
 * Nothing else on this card is badged. A source is not graded, scored, or ranked.
 */

import {
  collectionDate,
  COLLECTION_DATE_SUFFIX,
  NO_COLLECTION_DATE_LABEL,
  NO_REFERENCE_PERIOD_LABEL,
  type DisplaySource,
} from "../../lib/dataSources";
import DataStatusBadge from "../ui/DataStatusBadge";
import {
  REFERENCE_PERIOD_ERROR_LABEL,
  REFERENCE_PERIOD_LOADING_LABEL,
  type FreshnessState,
} from "./shared";

/** One label/value row of the card's definition list. */
function Field({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="min-w-[4.5rem] shrink-0 text-ink-subtle">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default function SourceCatalogItem({
  source,
  freshnessState,
}: {
  source: DisplaySource;
  freshnessState: FreshnessState;
}) {
  const collected = collectionDate(source.lastSuccessAt);
  return (
    <li
      className="flex flex-col rounded-card border border-hairline bg-surface-muted p-3"
      data-testid="transparency-source-card"
    >
      {/* The first <p> is the citizen-facing dataset name, always. */}
      <p className="text-sm font-semibold text-ink">{source.datasetName}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{source.organization}</p>

      <dl className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
        <Field term="자료 분야">{source.areaLabel}</Field>
        <Field term="갱신 주기">{source.frequencyLabel}</Field>
        <Field term="기준 기간">
          {freshnessState === "loading" ? (
            <span>{REFERENCE_PERIOD_LOADING_LABEL}</span>
          ) : freshnessState === "error" ? (
            // A failed request is NOT "this source has no period". Kept as its own
            // sentence so the two can never be read as the same fact.
            <span>{REFERENCE_PERIOD_ERROR_LABEL}</span>
          ) : source.referencePeriod !== null ? (
            <span className="tabular-nums text-ink">{source.referencePeriod}</span>
          ) : (
            <DataStatusBadge
              status="missing"
              label={NO_REFERENCE_PERIOD_LABEL}
              reason="이 출처의 기준 기간이 제공되지 않았습니다. 자료가 없다는 뜻이 아닙니다."
              testId="transparency-source-noperiod"
            />
          )}
        </Field>
        <Field term="수집 시점">
          {/* `last_success_at` records when the last ingestion SUCCEEDED. It is not
              a claim about the dataset's own currency, so it is labelled as a
              collection time rather than as an update date. */}
          {collected ? (
            <span className="tabular-nums">{`${collected} ${COLLECTION_DATE_SUFFIX}`}</span>
          ) : (
            <span className="text-ink-subtle">{NO_COLLECTION_DATE_LABEL}</span>
          )}
        </Field>
        <Field term="사용 상태">
          {source.enabled ? (
            <span>사용 중</span>
          ) : (
            <DataStatusBadge
              status="excluded"
              label="사용 안 함"
              reason="등록되어 있으나 현재 이 서비스에서 사용하지 않는 출처입니다."
              testId="transparency-source-disabled"
            />
          )}
        </Field>
      </dl>

      {/* Pushed to the card's bottom edge so a row of cards aligns on its links
          even when one card's metadata wraps to an extra line. */}
      <p className="mt-auto pt-2 text-xs">
        {source.documentationUrl ? (
          <a
            href={source.documentationUrl}
            target="_blank"
            // These are the first external links in the app, so there is no prior
            // convention to follow. `noreferrer` implies `noopener` in every current
            // engine; both are named so an older engine still cannot hand the opened
            // government page a live `window.opener` handle back into this tab.
            rel="noopener noreferrer"
            className="text-primary underline"
            data-testid="transparency-source-link"
          >
            {`${source.datasetName} 기관 안내 페이지 (새 창)`}
          </a>
        ) : (
          // No served URL — and one is never guessed from a dataset id or endpoint.
          <span className="text-ink-subtle" data-testid="transparency-source-nolink">
            기관 안내 주소 없음
          </span>
        )}
      </p>

      <details className="mt-2 text-xs text-ink-subtle" data-diagnostic>
        <summary className="cursor-pointer">기술 정보 보기</summary>
        <dl className="mt-1 flex flex-col gap-0.5">
          <div>
            <dt className="inline font-medium">자료 번호: </dt>
            <dd className="inline break-all">{source.sourceId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 기관명: </dt>
            <dd className="inline break-all">{source.servedSourceName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 자료명: </dt>
            <dd className="inline break-all">{source.servedDatasetName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">갱신 주기 코드: </dt>
            <dd className="inline break-all">{source.frequency}</dd>
          </div>
          <div>
            <dt className="inline font-medium">등록된 접근 주소: </dt>
            <dd className="inline break-all">{source.endpoint}</dd>
          </div>
          {source.freshnessStatus && (
            <div>
              <dt className="inline font-medium">수집 상태 코드: </dt>
              <dd className="inline break-all">{source.freshnessStatus}</dd>
            </div>
          )}
        </dl>
      </details>
    </li>
  );
}
