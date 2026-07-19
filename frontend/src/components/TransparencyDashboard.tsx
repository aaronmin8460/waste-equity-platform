"use client";

/**
 * 데이터·출처 — the citizen data-transparency center.
 *
 * A full-width, map-free page that shows ONLY grounded information: which public
 * sources are used, their reference periods and freshness, how many records are
 * currently served, the current 후보지 분석 versions, the cost-model inputs and the
 * components it deliberately omits, and a facility map-location transparency panel
 * with a paginated list of the facilities that could not be placed on the map.
 *
 * Every value comes from the backend; nothing is fabricated. A facility without a
 * map location is shown as "지도 위치 없음", never as zero, and its missing-location
 * reason is shown only when one was recorded (else "실패 사유 기록 없음"). No
 * secrets, environment values, or raw errors are ever displayed.
 */

import { useEffect, useState } from "react";

import {
  ApiError,
  fetchDataFreshness,
  fetchFacilityCostOptions,
  fetchFacilityMappingTransparency,
  fetchSuitabilityLatestRun,
  fetchSuitabilityPolicy,
  type DataFreshnessItem,
  type FacilityCostOptions,
  type FacilityMappingTransparency,
  type SuitabilityPolicy,
  type SuitabilityRun,
} from "../lib/api";
import { plainError } from "../lib/glossary";
import { FACILITY_CATEGORY_LABELS, formatCount, frequencyLabel } from "../lib/metrics";
import type { LoadedData } from "../app/page";

interface DatasetRow {
  name: string;
  count: number;
  referencePeriod: string;
  coverage: string;
}

/** Plain names for the region-mapping status codes (only shown in the detail table). */
const REGION_MAPPING_LABELS: Record<string, string> = {
  EXACT_MATCH: "이름 정확히 일치",
  GEOCODED_MATCH: "좌표 변환 후 일치",
  REQUIRES_GEOCODE: "좌표 변환 필요",
  UNMATCHED: "지역 미배정",
  AMBIGUOUS: "지역 판단 불가",
};

const OWNERSHIP_LABELS: Record<string, string> = { PUBLIC: "공공", PRIVATE: "민간" };

const FRESHNESS_LABELS: Record<string, string> = {
  FRESH: "최신",
  STALE: "갱신 필요",
  FAILED: "수집 실패",
  UNKNOWN: "정보 없음",
};

function Card({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="wep-card" data-testid={testId}>
      <h2 className="mb-2 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function TransparencyDashboard({ data }: { data: LoadedData }) {
  const [freshness, setFreshness] = useState<DataFreshnessItem[] | null>(null);
  const [policy, setPolicy] = useState<SuitabilityPolicy | null>(null);
  const [run, setRun] = useState<SuitabilityRun | null>(null);
  const [costOptions, setCostOptions] = useState<FacilityCostOptions | null>(null);
  const [mapping, setMapping] = useState<FacilityMappingTransparency | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Load the grounded transparency facts once. Suitability may legitimately have
  // no run yet — that is surfaced, not treated as an error.
  useEffect(() => {
    fetchDataFreshness()
      .then(setFreshness)
      .catch(() => setFreshness([]));
    fetchSuitabilityPolicy()
      .then(setPolicy)
      .catch(() => undefined);
    fetchSuitabilityLatestRun()
      .then(setRun)
      .catch(() => undefined);
    fetchFacilityCostOptions()
      .then(setCostOptions)
      .catch(() => undefined);
  }, []);

  // Facility mapping transparency is paginated; refetch when the page changes.
  useEffect(() => {
    let cancelled = false;
    fetchFacilityMappingTransparency({ page, pageSize })
      .then((result) => {
        if (cancelled) return;
        setMapping(result);
        setMappingError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setMapping(null);
        setMappingError(
          cause instanceof ApiError
            ? plainError(cause.detail?.error ?? cause.message).primary
            : "시설 지도화 자료를 불러올 수 없습니다.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  // Record counts for the datasets already loaded by the app (accurate, served).
  const datasets: DatasetRow[] = [
    {
      name: "인구 (SGIS)",
      count: data.population.count,
      referencePeriod: data.population.items[0]?.reference_period ?? String(data.population.reference_year),
      coverage: "서울·인천·경기 시군구",
    },
    {
      name: "폐기물 발생량 (RCIS)",
      count: data.reportingStats.count,
      referencePeriod:
        data.reportingStats.items[0]?.reference_period ?? String(data.reportingStats.reference_year),
      coverage: "수도권 보고 지역",
    },
    {
      name: "1인당 발생량 (파생)",
      count: data.reportingPerCapita.count,
      referencePeriod: String(data.reportingPerCapita.reference_year),
      coverage: "수도권 보고 지역",
    },
    {
      name: "처리시설",
      count: data.facilities.count,
      referencePeriod:
        data.facilities.items[0]?.reference_period ?? String(data.facilities.reference_year),
      coverage: "수도권 처리시설",
    },
  ];

  const totalPages = mapping ? Math.max(1, Math.ceil(mapping.unmapped.total / pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Data sources */}
      <Card title="사용한 공공자료" testId="transparency-sources">
        <p className="mb-2 text-xs text-slate-500">
          이 서비스는 아래 공공기관 자료만 사용합니다. 정부 API를 직접 호출하거나 개인정보를 저장하지
          않습니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <caption className="sr-only">공공자료 출처 목록</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-2 font-medium">자료</th>
                <th className="py-1 pr-2 font-medium">제공 기관</th>
                <th className="py-1 pr-2 font-medium">갱신 주기</th>
                <th className="py-1 pr-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((source) => {
                const fresh = freshness?.find((f) => f.source_id === source.source_id);
                return (
                  <tr key={source.source_id} className="border-b border-slate-100">
                    <td className="py-1 pr-2 text-slate-800">{source.dataset_name}</td>
                    <td className="py-1 pr-2 text-slate-600">{source.source_name}</td>
                    <td className="py-1 pr-2 text-slate-600">
                      {frequencyLabel(source.publication_frequency)}
                    </td>
                    <td className="py-1 pr-2 text-slate-600">
                      {source.enabled ? "사용 중" : "사용 안 함"}
                      {fresh ? ` · ${FRESHNESS_LABELS[fresh.freshness_status] ?? fresh.freshness_status}` : ""}
                      {fresh?.latest_reference_period ? ` · 최신 ${fresh.latest_reference_period}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dataset record counts + reference periods */}
      <Card title="자료별 기준 시점과 표시 개수" testId="transparency-datasets">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <caption className="sr-only">자료별 기준 시점과 표시 개수</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-2 font-medium">자료</th>
                <th className="py-1 pr-2 font-medium">자료 기준 시점</th>
                <th className="py-1 pr-2 font-medium">표시 지역/시설 수</th>
                <th className="py-1 pr-2 font-medium">범위</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.name} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-800">{d.name}</td>
                  <td className="py-1 pr-2 text-slate-600">{d.referencePeriod}</td>
                  <td className="py-1 pr-2 tabular-nums text-slate-600">{formatCount(d.count)}</td>
                  <td className="py-1 pr-2 text-slate-600">{d.coverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.
        </p>
      </Card>

      {/* Suitability analysis versions */}
      {run && policy ? (
        <Card title="후보지 분석 정보" testId="transparency-suitability">
          <dl className="grid grid-cols-1 gap-1 text-xs text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="inline font-medium">분석 실행: </dt>
              <dd className="inline">
                #{run.id} · 기준연도 {run.reference_year}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">분석 규칙 버전: </dt>
              <dd className="inline">{policy.policy_version}</dd>
            </div>
            <div>
              <dt className="inline font-medium">계산 방식 버전: </dt>
              <dd className="inline">{policy.derivation_version}</dd>
            </div>
            <div>
              <dt className="inline font-medium">분석 구역 버전: </dt>
              <dd className="inline">{policy.candidate_grid_version}</dd>
            </div>
            <div>
              <dt className="inline font-medium">후보 구역 수: </dt>
              <dd className="inline">{formatCount(run.candidate_count_total)}</dd>
            </div>
          </dl>
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">
              점수 반영 기준과 안정성 자세히 보기
            </summary>
            <p className="mt-1">
              점수 반영 기준(가중치)은 여러 가지를 제공하며, &apos;데이터 분포 기준&apos;은 값의 차이와
              중복 정도로 자동 계산됩니다. 안정성은 기본·균등·데이터 분포 기준의 상위 10% 포함 여부로
              판단하며, 최종 입지·허가·법적 적격성을 의미하지 않습니다.
            </p>
          </details>
        </Card>
      ) : (
        <Card title="후보지 분석 정보" testId="transparency-suitability">
          <p className="text-xs text-slate-500">아직 표시할 후보지 분석 결과가 없습니다.</p>
        </Card>
      )}

      {/* Cost model inputs + missing components */}
      {costOptions && (
        <Card title="비용 계산에 포함된 항목과 빠진 항목" testId="transparency-cost">
          <p className="mb-2 text-xs text-slate-500">
            비용은 표준공사비 기준의 참고용 설치비 계산이며, 실제 총사업비가 아닙니다.
          </p>
          <p className="text-xs text-slate-700">
            <span className="font-medium">기준 자료:</span> 표준공사비 {costOptions.active_cost_version}
          </p>
          <p className="mt-2 text-xs font-medium text-amber-800">아직 포함하지 못한 비용</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
            <li>운영비 (공식 자료 미연계)</li>
            <li>실제 운반비 (실 경로·계약 단가 미확보)</li>
            <li>토지·보상비 (필지별 비용 미확보)</li>
            <li>매립지 잔여 비용 (시설 물질수지 미확립)</li>
          </ul>
        </Card>
      )}

      {/* Facility mapping transparency */}
      <Card title="시설 지도 표시 현황" testId="transparency-facility-mapping">
        {mappingError ? (
          <p className="text-xs text-amber-800" role="alert">
            {mappingError}
          </p>
        ) : !mapping ? (
          <p className="text-xs text-slate-500" role="status">
            시설 지도화 자료를 불러오는 중…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facility-mapping-counts">
              <Stat label="전체 시설" value={formatCount(mapping.total)} />
              <Stat label="지도 표시" value={formatCount(mapping.with_map_location)} />
              <Stat label="지도 위치 없음" value={formatCount(mapping.without_map_location)} accent />
              <Stat label="주소 없음" value={formatCount(mapping.without_address)} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{mapping.disclaimer}</p>

            {/* Category breakdown */}
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-600">
                시설 종류별 지도 표시 현황
              </summary>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left">
                  <caption className="sr-only">시설 종류별 지도 표시 현황</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1 pr-2 font-medium">종류</th>
                      <th className="py-1 pr-2 font-medium">전체</th>
                      <th className="py-1 pr-2 font-medium">지도 표시</th>
                      <th className="py-1 pr-2 font-medium">위치 없음</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.category_breakdown.map((row) => (
                      <tr key={row.category} className="border-b border-slate-100">
                        <td className="py-1 pr-2 text-slate-700">
                          {FACILITY_CATEGORY_LABELS[row.category] ?? row.category}
                        </td>
                        <td className="py-1 pr-2 tabular-nums">{formatCount(row.total)}</td>
                        <td className="py-1 pr-2 tabular-nums">{formatCount(row.with_map_location)}</td>
                        <td className="py-1 pr-2 tabular-nums">{formatCount(row.without_map_location)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {/* Unmapped facility table (paginated) */}
            <h3 className="mt-3 mb-1 text-sm font-semibold text-slate-800">
              지도에 표시하지 못한 시설
            </h3>
            {mapping.unmapped.items.length === 0 ? (
              <p className="text-xs text-slate-500">지도에 표시하지 못한 시설이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full min-w-[640px] text-left text-xs"
                  data-testid="unmapped-facility-table"
                >
                  <caption className="sr-only">지도에 표시하지 못한 시설 목록</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1 pr-2 font-medium">시설명</th>
                      <th className="py-1 pr-2 font-medium">종류</th>
                      <th className="py-1 pr-2 font-medium">지역</th>
                      <th className="py-1 pr-2 font-medium">지역 배정</th>
                      <th className="py-1 pr-2 font-medium">위치 없는 이유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.unmapped.items.map((f) => (
                      <tr key={f.id} className="border-b border-slate-100">
                        <td className="py-1 pr-2 text-slate-800">{f.facility_name}</td>
                        <td className="py-1 pr-2 text-slate-600">
                          {FACILITY_CATEGORY_LABELS[f.facility_category] ?? f.facility_category}
                          {" · "}
                          {OWNERSHIP_LABELS[f.ownership] ?? f.ownership}
                        </td>
                        <td className="py-1 pr-2 text-slate-600">
                          {f.rcis_sido_name} {f.rcis_sigungu_name}
                        </td>
                        <td className="py-1 pr-2 text-slate-600">
                          {REGION_MAPPING_LABELS[f.region_mapping_status] ?? f.region_mapping_status}
                        </td>
                        <td className="py-1 pr-2 text-slate-600">
                          {f.missing_location_reason ?? (
                            <span className="text-slate-400">실패 사유 기록 없음</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Pagination */}
            {mapping.unmapped.total > pageSize && (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {page} / {totalPages} 페이지 · 총 {formatCount(mapping.unmapped.total)}개
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="wep-btn-quiet"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    이전
                  </button>
                  <button
                    type="button"
                    className="wep-btn-quiet"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    다음
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Scenario non-persistence note */}
      <Card title="가중치 바꿔보기 안내" testId="transparency-scenario">
        <p className="text-xs text-slate-600">
          &apos;가중치 바꿔보기&apos;에서 만든 결과는 화면에서만 계산하는 임시 결과이며 저장되지
          않습니다. 공식 분석 실행이나 저장된 점수를 바꾸지 않습니다.
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${accent ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent ? "text-amber-800" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
