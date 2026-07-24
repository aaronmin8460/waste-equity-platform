"use client";

/**
 * Data-sources page (데이터·출처) disclosure block for the inland-wetland inventory
 * (Phase 1B-2).
 *
 * Fetches the read-only wetland layer metadata and states its exposure lifecycle
 * honestly: the layer is served through a read-only API and map layer, carries NO
 * suitability score/rank (미반영), is DISTINCT from the statutory 습지보호지역
 * (UM901), and is verified locally only — never presented as a production
 * deployment. Loading and error states never substitute fabricated values.
 */

import { useEffect, useState } from "react";

import { fetchWetlandMetadata, type WetlandMetadata } from "../lib/api";

type LoadState = "loading" | "ready" | "error";

function lifecycleLabel(value: string): string {
  switch (value) {
    case "IMPLEMENTED":
    case "IMPLEMENTED_AND_LOCALLY_VERIFIED":
      return "구현·로컬 검증 완료";
    case "LIVE_VERIFIED":
      return "검증 완료";
    case "NOT_IMPLEMENTED":
      return "미구현";
    case "NOT_RUN":
      return "미실행";
    default:
      return value;
  }
}

export default function WetlandSourceNote() {
  const [state, setState] = useState<LoadState>("loading");
  const [meta, setMeta] = useState<WetlandMetadata | null>(null);

  useEffect(() => {
    let active = true;
    fetchWetlandMetadata()
      .then((data) => {
        if (!active) return;
        setMeta(data);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      className="mt-4 rounded-card border border-hairline bg-surface-muted p-3"
      data-testid="wetland-source-note"
      aria-label="내륙습지 목록 노출 상태"
    >
      <p className="text-sm font-semibold text-ink">내륙습지 목록 (환경·생태 레이어)</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        국립생태원 조사·목록 데이터입니다. 법정 습지보호지역(UM901)과 별개이며, 모든 항목이 법정
        습지보호지역을 의미하지 않습니다.
      </p>

      {state === "loading" && (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="wetland-source-note-loading">
          노출 상태를 불러오는 중입니다…
        </p>
      )}

      {state === "error" && (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="wetland-source-note-error">
          노출 상태를 불러오지 못했습니다. 자료가 없다는 뜻은 아닙니다.
        </p>
      )}

      {state === "ready" && meta && (
        <dl className="mt-2 flex flex-col gap-1 text-xs text-ink-muted" data-testid="wetland-source-note-body">
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">제공기관</dt>
            <dd>{meta.provider}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">공식 자료명</dt>
            <dd>{meta.official_dataset_name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">기준일</dt>
            <dd className="tabular-nums">{meta.reference_date}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">제공 건수</dt>
            <dd className="tabular-nums" data-testid="wetland-served-count">
              {meta.served_feature_count.toLocaleString("ko-KR")}건
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">API·지도 노출</dt>
            <dd>
              {lifecycleLabel(meta.lifecycle.api_exposure)} ·{" "}
              {lifecycleLabel(meta.lifecycle.frontend_map_exposure)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">점수 반영</dt>
            <dd data-testid="wetland-scoring-status">
              미반영 ({lifecycleLabel(meta.lifecycle.scoring_integration)})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">적재/배포</dt>
            <dd data-testid="wetland-deploy-status">로컬 DB 적재 검증 완료 · 운영 배포 미실행</dd>
          </div>
          {meta.official_source_url && (
            <div className="flex gap-2">
              <dt className="min-w-[5.5rem] shrink-0 text-ink-subtle">출처</dt>
              <dd>
                <a
                  href={meta.official_source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                  data-testid="wetland-source-note-link"
                >
                  공공데이터포털 안내 페이지 (새 창)
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
