"use client";

/**
 * Data-sources page (데이터·출처) disclosure block for the land-cover candidate-cell
 * statistics (Phase 1B-LC8).
 *
 * States, in one place, exactly what the platform publishes and on what basis:
 *
 *  - the mandatory source attribution (provider, official dataset title, reference
 *    period 2025, official source link), rendered verbatim from what the API served;
 *  - the public-deployment status and its BASIS — a project-level authorization from
 *    the cooperating government institution. It is never presented as an EGIS licence
 *    confirmation, an EGIS written reply, or a KOGL type;
 *  - that only DERIVED 500 m candidate-grid statistics are published, and that the
 *    original SHP files and raw source polygons are not provided;
 *  - that the statistics are descriptive and are not used in suitability scoring;
 *  - the coverage limitations that LC3–LC6 established, which publication does not
 *    erase: coverage can be incomplete, `NO_COVERAGE` never means the real world has
 *    no land cover, and dominant L1/L2/L3 are computed independently per level.
 *
 * Loading and error states never substitute fabricated values. Attribution is
 * mandatory, so it renders from the canonical project constants even when the release
 * request fails — but nothing else is invented when the release is unavailable.
 */

import { useEffect, useState } from "react";

import { fetchLandCoverActiveRelease, type LandCoverActiveRelease } from "../lib/api";
import {
  LAND_COVER_AUTHORIZATION_STATUS,
  LAND_COVER_DATASET_TITLE,
  LAND_COVER_PROVIDER,
  LAND_COVER_REFERENCE_PERIOD,
  landCoverAttributionText,
  landCoverAuthorizationBasis,
  landCoverOfficialSourceUrl,
  landCoverPublicStatement,
  validateActiveRelease,
} from "../lib/landCover";

type LoadState = "loading" | "ready" | "error";

export default function LandCoverSourceNote() {
  const [state, setState] = useState<LoadState>("loading");
  const [release, setRelease] = useState<LandCoverActiveRelease | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchLandCoverActiveRelease(controller.signal)
      .then((raw) => {
        if (!active) return;
        // The same validator the map uses: a release that is not verifiably complete
        // is treated as unavailable rather than described as if it were.
        const validated = validateActiveRelease(raw);
        setRelease(validated);
        setState(validated ? "ready" : "error");
      })
      .catch(() => {
        if (!active) return;
        setState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const disclosures = release?.disclosures;

  return (
    <section
      className="mt-4 rounded-card border border-hairline bg-surface-muted p-3"
      data-testid="land-cover-source-note"
      aria-label="토지피복 격자 통계 공개 상태"
    >
      <p className="text-sm font-semibold text-ink">토지피복 격자 통계 (환경 레이어)</p>

      {/* Mandatory attribution: always rendered, whatever the request did. */}
      <p className="mt-1 text-xs text-ink-muted" data-testid="land-cover-source-note-attribution">
        {landCoverAttributionText(disclosures)}
      </p>
      <p className="mt-1 text-xs text-ink-muted" data-testid="land-cover-source-note-public">
        {landCoverPublicStatement(disclosures)}
      </p>

      {state === "loading" && (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="land-cover-source-note-loading">
          공개 상태를 불러오는 중입니다…
        </p>
      )}

      {state === "error" && (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="land-cover-source-note-error">
          공개 상태를 불러오지 못했습니다. 자료가 없다는 뜻은 아닙니다.
        </p>
      )}

      {state === "ready" && release && (
        <dl
          className="mt-2 flex flex-col gap-1 text-xs text-ink-muted"
          data-testid="land-cover-source-note-body"
        >
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">제공기관</dt>
            <dd>{release.source_release?.provider ?? LAND_COVER_PROVIDER}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">공식 자료명</dt>
            <dd>{release.source_release?.official_dataset_name ?? LAND_COVER_DATASET_TITLE}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">기준 시점</dt>
            <dd className="tabular-nums">
              {release.disclosures.reference_period || LAND_COVER_REFERENCE_PERIOD}
            </dd>
          </div>
          {/* Raw version identifiers are technical tokens: the project keeps them out
              of primary content and inside a `data-diagnostic` line (Phase 6 AC4).
              They stay VISIBLE and complete here — only their classification changes. */}
          <div className="flex gap-2" data-diagnostic>
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">가공 단위</dt>
            <dd>
              500 m 후보격자 ({release.candidate_grid_version})
              {release.source_release?.transformation_version
                ? ` · ${release.source_release.transformation_version}`
                : ""}
              {release.derivation_version ? ` · ${release.derivation_version}` : ""}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">공개 격자 수</dt>
            <dd className="tabular-nums" data-testid="land-cover-source-note-cells">
              {release.processed_cell_count.toLocaleString("ko-KR")}개 (통계 릴리스 #
              {release.statistics_version_id})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">공개 운영 상태</dt>
            <dd data-testid="land-cover-source-note-status">
              {release.disclosures.license_status || LAND_COVER_AUTHORIZATION_STATUS}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">공개 근거</dt>
            <dd data-testid="land-cover-source-note-basis">
              {landCoverAuthorizationBasis(disclosures)} — 협력 정부기관의 프로젝트 차원 확인.
              EGIS의 자료별 서면 회신이나 공공누리(KOGL) 유형 지정이 아닙니다.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">원본 제공</dt>
            <dd data-testid="land-cover-source-note-raw">
              제공하지 않음 — 원본 SHP 파일, 원본 토지피복 도형, 개별 피처 레코드 및 원본 도엽
              다운로드는 공개하지 않습니다.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">점수 반영</dt>
            <dd data-testid="land-cover-source-note-scoring">
              미반영 (used_in_suitability_scoring:{" "}
              {String(release.disclosures.used_in_suitability_scoring)}) — 설명용 자료이며 적합성
              점수·순위·적격 상태·제외 사유에 사용되지 않고, 법적 허용·금지 판단도 아닙니다.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">범위 한계</dt>
            <dd data-testid="land-cover-source-note-limits">
              해안·도서 지역은 자료 범위가 불완전할 수 있습니다. ‘미평가(NO_COVERAGE)’는 확보된
              자료가 해당 격자를 평가하지 않았다는 뜻이며, 실제로 토지피복이 없다는 의미가
              아닙니다. 대·중·세분류 우세 분류는 각 단계별로 따로 계산되므로 상위·하위가 서로
              포함 관계를 이루지 않을 수 있습니다.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">출처</dt>
            <dd>
              <a
                href={landCoverOfficialSourceUrl(disclosures)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
                data-testid="land-cover-source-note-link"
              >
                EGIS 토지피복지도 안내 페이지 (새 창)
              </a>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
