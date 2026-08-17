"use client";

/**
 * One source record in the catalog. Every card on this screen is a record the
 * registry actually served — the list is `sources.map(...)`, so a card cannot exist
 * without a record behind it, and no card from Figma frame 156:470 was reproduced.
 *
 * ── THE FIGMA CARD ─────────────────────────────────────────────────────────────
 * Frame 156:470 gives the card five bands, and this is now that card:
 *
 *   1. the plain-Korean dataset name (16.9px / 700);
 *   2. the providing organisation;
 *   3. two chips — subject area, then update cadence — which is where 자료 분야 and
 *      갱신 주기 moved from the definition list;
 *   4. a hairline, then two label-left / value-right rows: 기준 기간 and 원문 링크;
 *   5. the 기술 정보 보기 disclosure.
 *
 * 수집 시점 and 사용 상태 moved INTO that disclosure. Nothing was dropped: the card
 * face now answers "what is this and when is it from", and the provenance detail is
 * one keystroke away (brief §11, progressive disclosure). The one exception is a
 * registry row that is switched OFF, which stays on the face — a card whose data is
 * not in use must say so where it is read, not behind a summary.
 *
 * A search CAN match on the technical identifiers — the reader may have arrived with
 * one — but matching never promotes an identifier to the title. The first `<p>` in
 * this card is therefore always the dataset name, and both suites read it that way.
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
 *     enabled row keeps the plain 사용 중 text inside the disclosure — the badge
 *     marks the exceptional state rather than decorating both.
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

/** One label-left / value-right row of the card's face. */
function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="flex-none text-ink-subtle">{term}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * One quiet chip. Not `ui/Chip` — that one is a pill-shaped selection token.
 *
 * 11px / 700, 8px radius, 4×9 padding: the frame's chip, normalised off its
 * 1.354808 scale (see `TransparencySection` for how that factor was established).
 */
function CardChip({ label, tone }: { label: string; tone: "subject" | "cadence" }) {
  return (
    <span
      className={
        tone === "subject"
          ? "rounded-lg bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary"
          : "rounded-lg bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-secondary"
      }
    >
      {label}
    </span>
  );
}

/** One row of the technical disclosure. */
function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-medium">{term}: </dt>
      <dd className="inline break-all">{children}</dd>
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
      className="flex flex-col rounded-[14px] border border-hairline bg-surface p-3.5"
      data-testid="transparency-source-card"
    >
      {/* The first <p> is the citizen-facing dataset name, always. */}
      <p className="text-sm font-bold text-ink">{source.datasetName}</p>
      <p className="mt-2 text-xs text-ink-secondary">{source.organization}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <CardChip label={source.areaLabel} tone="subject" />
        <CardChip label={source.frequencyLabel} tone="cadence" />
      </div>

      {!source.enabled && (
        <p className="mt-2">
          <DataStatusBadge
            status="excluded"
            label="사용 안 함"
            reason="등록되어 있으나 현재 이 서비스에서 사용하지 않는 출처입니다."
            testId="transparency-source-disabled"
          />
        </p>
      )}

      <hr className="mt-2 border-t border-hairline" />

      <dl className="mt-2 flex flex-col gap-1">
        <Row term="기준 기간">
          {freshnessState === "loading" ? (
            <span className="font-normal text-ink-subtle">{REFERENCE_PERIOD_LOADING_LABEL}</span>
          ) : freshnessState === "error" ? (
            // A failed request is NOT "this source has no period". Kept as its own
            // sentence so the two can never be read as the same fact.
            <span className="font-normal text-ink-subtle">{REFERENCE_PERIOD_ERROR_LABEL}</span>
          ) : source.referencePeriod !== null ? (
            <span className="tabular-nums">{source.referencePeriod}</span>
          ) : (
            <DataStatusBadge
              status="missing"
              label={NO_REFERENCE_PERIOD_LABEL}
              reason="이 출처의 기준 기간이 제공되지 않았습니다. 자료가 없다는 뜻이 아닙니다."
              testId="transparency-source-noperiod"
            />
          )}
        </Row>
        <Row term="원문 링크">
          {source.documentationUrl ? (
            <a
              href={source.documentationUrl}
              target="_blank"
              // These are the first external links in the app, so there is no prior
              // convention to follow. `noreferrer` implies `noopener` in every current
              // engine; both are named so an older engine still cannot hand the opened
              // government page a live `window.opener` handle back into this tab.
              rel="noopener noreferrer"
              // Figma prints the same three words on every card, which would give a
              // screen reader a dozen identically-named links with no way to tell
              // them apart. The visible text is Figma's; the accessible name names
              // the dataset and says the link leaves this tab.
              aria-label={`${source.datasetName} 기관 안내 페이지 (새 창)`}
              className="text-primary underline"
              data-testid="transparency-source-link"
            >
              공식 안내 페이지
            </a>
          ) : (
            // A served `documentation_url` of null is VALID registry data, not a
            // failure — `municipal_waste_cost_disclosure` is one such row in
            // production today. It renders as a plain absence, and a URL is never
            // guessed, completed, or constructed from a dataset id or an endpoint.
            <span className="font-normal text-ink-subtle" data-testid="transparency-source-nolink">
              링크 없음
            </span>
          )}
        </Row>
      </dl>

      {/* Pushed to the card's bottom edge so a row of cards aligns on its
          disclosures even when one card's name wraps to an extra line. */}
      <details className="mt-auto pt-2 text-[11px] text-ink-subtle" data-diagnostic>
        {/* Figma draws this control with a ▽ text glyph rather than an icon asset,
            so the glyph is reproduced literally and the engine's own marker is
            suppressed. It is `aria-hidden`: the open/closed state is already
            conveyed by the `<details>` element itself, and a screen reader reading
            "white down-pointing triangle" before every summary is noise. */}
        {/* The engine's own marker is suppressed locally rather than through a new
            global rule, so nothing outside this card is affected. */}
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="mr-1 inline-block">
            ▽
          </span>
          기술 정보 보기
        </summary>
        <dl className="mt-1.5 flex flex-col gap-0.5">
          <Detail term="자료 번호">{source.sourceId}</Detail>
          <Detail term="등록된 기관명">{source.servedSourceName}</Detail>
          <Detail term="등록된 자료명">{source.servedDatasetName}</Detail>
          <Detail term="갱신 주기 코드">{source.frequency}</Detail>
          <Detail term="등록된 접근 주소">{source.endpoint}</Detail>
          {/* `last_success_at` records when the last ingestion SUCCEEDED. It is not
              a claim about the dataset's own currency, so it is labelled as a
              collection time rather than as an update date, and it carries the
              timezone the backend recorded it in. */}
          <Detail term="수집 시점">
            {collected ? `${collected} ${COLLECTION_DATE_SUFFIX}` : NO_COLLECTION_DATE_LABEL}
          </Detail>
          <Detail term="사용 상태">{source.enabled ? "사용 중" : "사용 안 함"}</Detail>
          {source.freshnessStatus && (
            <Detail term="수집 상태 코드">{source.freshnessStatus}</Detail>
          )}
        </dl>
      </details>
    </li>
  );
}
