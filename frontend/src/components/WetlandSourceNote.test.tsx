// @vitest-environment jsdom

/**
 * WetlandSourceNote tests — the data-sources (데이터·출처) exposure disclosure for
 * the inland-wetland inventory (Phase 1B-2): served count, lifecycle, scoring
 * 미반영, local-verification-not-deployment, and graceful loading/error states.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WetlandSourceNote from "./WetlandSourceNote";
import type { WetlandMetadata } from "../lib/api";

const META: WetlandMetadata = {
  layer_name: "wetland_inventory",
  korean_label: "내륙습지 목록",
  provider: "국립생태원 (National Institute of Ecology)",
  official_dataset_name: "국립생태원_내륙습지 공간데이터 및 속성정보",
  provider_dataset_identifier: "…",
  official_source_url: "https://www.data.go.kr/data/15086410/fileData.do",
  reference_date: "2022-07-20",
  source_crs: "EPSG:5186",
  storage_crs: "EPSG:4326",
  source_encoding: "UTF-8",
  transformation_version: "wetland-inventory-v1",
  declared_feature_count: 2704,
  served_feature_count: 2704,
  geometry_type: "MultiPolygon",
  lifecycle: {
    contract_verification: "LIVE_VERIFIED",
    database_ingestion: "IMPLEMENTED_AND_LOCALLY_VERIFIED",
    api_exposure: "IMPLEMENTED",
    frontend_map_exposure: "IMPLEMENTED",
    scoring_integration: "NOT_IMPLEMENTED",
    production_deployment: "NOT_RUN",
  },
  statutory_status_statement: "…",
  um901_distinction_statement: "…",
  license_note: null,
  provenance: {
    dataset_version_id: 1,
    provider: "국립생태원 (National Institute of Ecology)",
    official_dataset_name: "국립생태원_내륙습지 공간데이터 및 속성정보",
    provider_dataset_identifier: "…",
    official_source_url: "https://www.data.go.kr/data/15086410/fileData.do",
    reference_date: "2022-07-20",
    source_crs: "EPSG:5186",
    storage_crs: "EPSG:4326",
    source_encoding: "UTF-8",
    transformation_version: "wetland-inventory-v1",
    license_note: null,
  },
  last_ingestion: {
    run_id: 813,
    status: "SUCCEEDED",
    rows_inserted: 2704,
    reference_period: "2022-07-20",
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WetlandSourceNote", () => {
  it("renders the live served count, scoring 미반영, and deploy status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => META })) as unknown as typeof fetch,
    );
    render(<WetlandSourceNote />);
    await waitFor(() => expect(screen.getByTestId("wetland-source-note-body")).toBeInTheDocument());
    expect(screen.getByTestId("wetland-served-count")).toHaveTextContent("2,704건");
    expect(screen.getByTestId("wetland-scoring-status")).toHaveTextContent("미반영");
    expect(screen.getByTestId("wetland-deploy-status")).toHaveTextContent(
      "로컬 DB 적재 검증 완료 · 운영 배포 미실행",
    );
    // States the layer is separate from the statutory 습지보호지역.
    expect(screen.getByTestId("wetland-source-note")).toHaveTextContent("법정 습지보호지역(UM901)과 별개");
  });

  it("shows a graceful error state (never fabricated data) when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
    );
    render(<WetlandSourceNote />);
    await waitFor(() =>
      expect(screen.getByTestId("wetland-source-note-error")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("wetland-served-count")).not.toBeInTheDocument();
  });
});
