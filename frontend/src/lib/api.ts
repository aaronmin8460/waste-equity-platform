/**
 * Typed client for the Waste Equity Platform backend.
 *
 * The frontend requests data exclusively from the platform backend and never
 * calls Korean government APIs or holds credentials. Quantities arrive as
 * exact decimal strings and are kept as strings here; numeric coercion
 * happens only for presentation (color scales), never for storage.
 */

export interface DatasetEnvelope<T> {
  reference_year: number;
  count: number;
  items: T[];
}

export interface UnavailableDataDetail {
  error: string;
  detail: string;
  requested_year: number | null;
  available_years: number[];
}

export interface RegionBoundaryProperties {
  region_code: string;
  region_name: string;
  region_level: string;
  parent_region_code: string | null;
  source_id: string;
  boundary_reference_period: string;
  // Present only on RCIS waste reporting-geography features (adapted client-side
  // from the reporting boundaries for the waste and per-capita metrics). Native
  // SGIS boundaries omit them.
  reporting_geography_type?: string;
  geometry_kind?: string;
  derived_geometry_method?: string | null;
  child_region_names?: string[] | null;
  source_reporting_level?: string;
  // Precise availability reason for a reporting region with no value for the
  // selected stream (e.g. SOURCE_NOT_REPORTED), replacing a bare NO_DATA.
  unavailable_reason?: string | null;
}

export interface RegionBoundaryFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: RegionBoundaryProperties;
}

export interface RegionBoundaryCollection {
  type: "FeatureCollection";
  reference_year: number;
  count: number;
  features: RegionBoundaryFeature[];
}

export interface PopulationItem {
  region_code: string;
  region_name: string;
  region_level: string;
  population: number;
  unit: string;
  population_definition: string;
  source_id: string;
  reference_year: number;
  reference_period: string;
}

export interface WasteStatisticsItem {
  region_code: string;
  region_name: string;
  waste_stream: string;
  waste_category_name: string;
  generation_quantity: string;
  recycling_quantity: string;
  incineration_quantity: string;
  landfill_quantity: string;
  other_treatment_quantity: string;
  total_treatment_quantity: string;
  total_treatment_is_derived: boolean;
  quantity_unit: string;
  accounting_basis: string;
  source_id: string;
  source_pid: string;
  official_dataset_name: string;
  reference_year: number;
  reference_period: string;
}

export interface FacilityItem {
  id: number;
  facility_name: string;
  operator_name: string | null;
  address: string;
  facility_category: string;
  facility_kind: string;
  ownership: string;
  region_code: string | null;
  region_name: string | null;
  region_mapping_status: string;
  rcis_sido_name: string;
  rcis_sigungu_name: string;
  longitude: number | null;
  latitude: number | null;
  geocode_status: string | null;
  capacity_quantity: string | null;
  capacity_unit: string | null;
  throughput_quantity: string | null;
  throughput_unit: string | null;
  remaining_fill_capacity_m3: string | null;
  accounting_basis: string;
  source_id: string;
  source_pid: string;
  official_dataset_name: string;
  reference_year: number;
  reference_period: string;
}

export interface WastePerCapitaItem {
  region_code: string;
  region_name: string;
  region_level: string;
  waste_stream: string;
  per_capita_kg_per_year: string;
  per_capita_unit: string;
  generation_quantity: string;
  quantity_unit: string;
  accounting_basis: string;
  waste_source_id: string;
  waste_source_pid: string;
  waste_official_dataset_name: string;
  waste_reference_period: string;
  population: number;
  population_definition: string;
  population_source_id: string;
  population_reference_period: string;
  reference_year: number;
}

export interface ExcludedRegion {
  region_code: string;
  region_name: string;
  waste_stream: string;
  reason: string;
}

/**
 * Envelope for backend-derived indicators. The derivation happens entirely
 * server-side; this client renders the served values, formula, assumptions,
 * and exclusions as-is and never computes its own aggregates.
 */
export interface EquityEnvelope {
  indicator: string;
  derivation_version: string;
  derivation_formula: string;
  unit: string;
  assumptions: string[];
  reference_year: number;
  count: number;
  items: WastePerCapitaItem[];
  excluded_regions: ExcludedRegion[];
}

export interface FacilityBurdenItem {
  region_code: string;
  region_name: string;
  region_level: string;
  facility_count_located: number;
  throughput_located_tons_per_year: string;
  throughput_located_kg_per_capita: string;
  located_missing_throughput_count: number;
  located_throughput_is_partial: boolean;
  facility_count_within_buffer: number;
  throughput_within_buffer_tons_per_year: string;
  throughput_within_buffer_kg_per_capita: string;
  buffer_missing_throughput_count: number;
  buffer_throughput_is_partial: boolean;
  quantity_unit: string;
  accounting_basis: string;
  facility_source_id: string;
  facility_reference_period: string;
  population: number;
  population_definition: string;
  population_source_id: string;
  population_reference_period: string;
  reference_year: number;
}

export interface ExcludedBurdenRegion {
  region_code: string;
  region_name: string;
  reason: string;
}

export interface FacilityBurdenEnvelope {
  indicator: string;
  derivation_version: string;
  derivation_formula: string;
  buffer_meters: number;
  unit: string;
  assumptions: string[];
  reference_year: number;
  count: number;
  items: FacilityBurdenItem[];
  excluded_regions: ExcludedBurdenRegion[];
  facilities_without_coordinates: number;
  facilities_without_region: number;
}

// --------------------------------------------------------------------------- //
// RCIS waste reporting geography — the source-compatible geometry the waste and
// per-capita metrics render on (native SGIS regions + seven derived Gyeonggi
// cities). A city-level value never carries a child district name or code.
// --------------------------------------------------------------------------- //

export interface ReportingBoundaryProperties {
  reporting_region_code: string;
  reporting_region_name: string;
  reporting_geography_type: string; // NATIVE_SGIS | DERIVED_CITY_UNION
  geometry_kind: string; // NATIVE | DERIVED
  derived_geometry_method: string | null;
  source_reporting_level: string;
  native_region_code: string | null;
  child_region_codes: string[] | null;
  child_region_names: string[] | null;
  source_id: string;
  boundary_reference_period: string;
}

export interface ReportingBoundaryFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: ReportingBoundaryProperties;
}

export interface ReportingBoundaryCollection {
  type: "FeatureCollection";
  reference_year: number;
  count: number;
  features: ReportingBoundaryFeature[];
}

export interface ReportingWasteStatisticsItem {
  reporting_region_code: string;
  reporting_region_name: string;
  reporting_geography_type: string;
  geometry_kind: string;
  source_reporting_level: string;
  waste_stream: string;
  waste_category_name: string;
  generation_quantity: string;
  recycling_quantity: string;
  incineration_quantity: string;
  landfill_quantity: string;
  other_treatment_quantity: string;
  total_treatment_quantity: string;
  total_treatment_is_derived: boolean;
  quantity_unit: string;
  accounting_basis: string;
  source_id: string;
  source_pid: string;
  official_dataset_name: string;
  reference_year: number;
  reference_period: string;
  child_region_codes: string[] | null;
}

export interface ReportingUnavailableRegion {
  reporting_region_code: string;
  reporting_region_name: string;
  waste_stream: string;
  reason: string;
}

export interface ReportingWasteStatisticsEnvelope {
  reference_year: number;
  count: number;
  items: ReportingWasteStatisticsItem[];
  unavailable_regions: ReportingUnavailableRegion[];
}

export interface ReportingPerCapitaItem {
  reporting_region_code: string;
  reporting_region_name: string;
  reporting_geography_type: string;
  source_reporting_level: string;
  waste_stream: string;
  per_capita_kg_per_year: string;
  per_capita_unit: string;
  generation_quantity: string;
  quantity_unit: string;
  accounting_basis: string;
  numerator_reporting_level: string;
  waste_source_id: string;
  waste_source_pid: string;
  waste_official_dataset_name: string;
  waste_reference_period: string;
  population: number;
  population_definition: string;
  population_source_id: string;
  population_reference_period: string;
  population_is_derived: boolean;
  population_derivation: string | null;
  child_region_codes: string[] | null;
  reference_year: number;
}

export interface ReportingExcludedRegion {
  reporting_region_code: string;
  reporting_region_name: string;
  waste_stream: string;
  reason: string;
}

export interface ReportingPerCapitaEnvelope {
  indicator: string;
  derivation_version: string;
  derivation_formula: string;
  unit: string;
  assumptions: string[];
  reference_year: number;
  count: number;
  items: ReportingPerCapitaItem[];
  excluded_regions: ReportingExcludedRegion[];
}

export interface DataSourceItem {
  source_id: string;
  source_name: string;
  dataset_name: string;
  endpoint: string;
  publication_frequency: string;
  enabled: boolean;
  documentation_url: string | null;
}

/** Backend error with the structured detail body preserved. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: UnavailableDataDetail | null;

  constructor(status: number, detail: UnavailableDataDetail | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

function parseStructuredDetail(body: unknown): UnavailableDataDetail | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return null;
  const candidate = detail as Partial<UnavailableDataDetail>;
  if (typeof candidate.error !== "string" || typeof candidate.detail !== "string") return null;
  return {
    error: candidate.error,
    detail: candidate.detail,
    requested_year: candidate.requested_year ?? null,
    available_years: candidate.available_years ?? [],
  };
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  if (!response.ok) {
    let detail: UnavailableDataDetail | null = null;
    try {
      detail = parseStructuredDetail(await response.json());
    } catch {
      detail = null;
    }
    const message = detail
      ? `${detail.error}: ${detail.detail}`
      : `Backend request failed with status ${response.status}`;
    throw new ApiError(response.status, detail, message);
  }
  return (await response.json()) as T;
}

export function fetchBoundaries(): Promise<RegionBoundaryCollection> {
  return fetchJson<RegionBoundaryCollection>("/api/v1/regions/boundaries?level=SIGUNGU");
}

export function fetchPopulation(): Promise<DatasetEnvelope<PopulationItem>> {
  return fetchJson<DatasetEnvelope<PopulationItem>>("/api/v1/population");
}

export function fetchWasteStatistics(): Promise<DatasetEnvelope<WasteStatisticsItem>> {
  return fetchJson<DatasetEnvelope<WasteStatisticsItem>>("/api/v1/waste-statistics");
}

export function fetchFacilities(): Promise<DatasetEnvelope<FacilityItem>> {
  return fetchJson<DatasetEnvelope<FacilityItem>>("/api/v1/facilities");
}

export function fetchWastePerCapita(): Promise<EquityEnvelope> {
  return fetchJson<EquityEnvelope>("/api/v1/equity/waste-per-capita");
}

export function fetchFacilityBurden(): Promise<FacilityBurdenEnvelope> {
  return fetchJson<FacilityBurdenEnvelope>("/api/v1/equity/facility-burden");
}

export function fetchReportingBoundaries(): Promise<ReportingBoundaryCollection> {
  return fetchJson<ReportingBoundaryCollection>("/api/v1/waste-reporting/boundaries");
}

export function fetchReportingStatistics(): Promise<ReportingWasteStatisticsEnvelope> {
  return fetchJson<ReportingWasteStatisticsEnvelope>("/api/v1/waste-reporting/statistics");
}

export function fetchReportingPerCapita(): Promise<ReportingPerCapitaEnvelope> {
  return fetchJson<ReportingPerCapitaEnvelope>("/api/v1/waste-reporting/per-capita");
}

export function fetchDataSources(): Promise<DataSourceItem[]> {
  return fetchJson<DataSourceItem[]>("/api/v1/data-sources");
}

// --------------------------------------------------------------------------- //
// Suitability screening (Phase 5.4) — analytical screening only, never legal.
// --------------------------------------------------------------------------- //

export type SuitabilityProfile = "baseline" | "equal" | "equity_focused" | "access_focused";
export type SuitabilityStatus = "ELIGIBLE" | "REVIEW_REQUIRED" | "EXCLUDED";

export interface SuitabilityPolicy {
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  statuses: string[];
  weight_profiles: Record<string, Record<string, string>>;
  weight_rationale: Record<string, string>;
  hard_exclusion_codes: Record<string, string>;
  review_codes: Record<string, string>;
  zoning_registry: Record<string, unknown>;
  road_distance_curve: string[][];
  grid: Record<string, unknown>;
  disclaimer: string;
}

export interface SuitabilityRun {
  id: number;
  derivation_version: string;
  policy_version: string;
  candidate_grid_version: string;
  reference_year: number;
  boundary_vintage: string;
  weight_profile: string;
  analysis_signature: string;
  status: string;
  candidate_count_total: number;
  candidate_count_eligible: number;
  candidate_count_review: number;
  candidate_count_excluded: number;
  input_dataset_version_ids: number[];
  input_provenance: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface SuitabilitySummary {
  run_id: number;
  reference_year: number;
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  weight_profile: string;
  candidate_count_total: number;
  candidate_count_eligible: number;
  candidate_count_review: number;
  candidate_count_excluded: number;
  exclusion_reason_counts: Record<string, number>;
  review_reason_counts: Record<string, number>;
  sido_distribution: Record<string, Record<string, number>>;
  top_candidates: Array<Record<string, unknown>>;
  coverage_notes: string[];
  assumptions: string[];
  disclaimer: string;
}

export interface CandidateProperties {
  candidate_id: number;
  candidate_key: string;
  status: SuitabilityStatus;
  profile: string;
  is_excluded: boolean;
  rank: number | null;
  total_score: string | null;
  provisional_score: string | null;
  zoning_score: string | null;
  road_score: string | null;
  equity_score: string | null;
  demand_score: string | null;
  sido_region_code: string | null;
  sido_region_name: string | null;
  sigungu_region_code: string | null;
  sigungu_region_name: string | null;
  nearest_road_distance_m: string | null;
  exclusion_reasons: string[];
  review_reasons: string[];
}

export interface CandidateFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: CandidateProperties;
}

export interface SuitabilityCandidateCollection {
  type: "FeatureCollection";
  indicator: string;
  derivation_version: string;
  policy_version: string;
  candidate_grid_version: string;
  weight_profile: string;
  reference_year: number;
  run_id: number;
  count: number;
  total_matched: number;
  limit: number;
  offset: number;
  features: CandidateFeature[];
  assumptions: string[];
  disclaimer: string;
}

export interface CandidateDetail extends CandidateProperties {
  run_id: number;
  profile_totals: Record<string, string | null>;
  profile_ranks: Record<string, number | null>;
  penalties: string[];
  raw_components: Record<string, unknown>;
  nearest_road_provenance: Record<string, unknown>;
  component_provenance: Record<string, unknown>;
  original_area_m2: string;
  clipped_area_m2: string;
  clipped_area_ratio: string;
  geometry: GeoJSON.Geometry;
  reference_year: number;
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  weights: Record<string, string>;
  disclaimer: string;
}

/** fetchJson variant that supports cancellation via an AbortSignal. */
export async function fetchJsonSignal<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", signal });
  if (!response.ok) {
    let detail: UnavailableDataDetail | null = null;
    try {
      detail = parseStructuredDetail(await response.json());
    } catch {
      detail = null;
    }
    const message = detail
      ? `${detail.error}: ${detail.detail}`
      : `Backend request failed with status ${response.status}`;
    throw new ApiError(response.status, detail, message);
  }
  return (await response.json()) as T;
}

export function fetchSuitabilityPolicy(): Promise<SuitabilityPolicy> {
  return fetchJson<SuitabilityPolicy>("/api/v1/suitability/policies");
}

export function fetchSuitabilityLatestRun(): Promise<SuitabilityRun> {
  return fetchJson<SuitabilityRun>("/api/v1/suitability/runs/latest");
}

export function fetchSuitabilitySummary(profile: SuitabilityProfile): Promise<SuitabilitySummary> {
  return fetchJson<SuitabilitySummary>(`/api/v1/suitability/summary?profile=${profile}`);
}

export interface CandidateQuery {
  profile: SuitabilityProfile;
  bbox?: string;
  status?: SuitabilityStatus;
  sido?: string;
  top?: number;
  limit?: number;
}

export function fetchSuitabilityCandidates(
  query: CandidateQuery,
  signal: AbortSignal,
): Promise<SuitabilityCandidateCollection> {
  const params = new URLSearchParams({ profile: query.profile });
  if (query.bbox) params.set("bbox", query.bbox);
  if (query.status) params.set("status", query.status);
  if (query.sido) params.set("sido", query.sido);
  if (query.top !== undefined) params.set("top", String(query.top));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return fetchJsonSignal<SuitabilityCandidateCollection>(
    `/api/v1/suitability/candidates?${params.toString()}`,
    signal,
  );
}

export function fetchSuitabilityCandidateDetail(
  candidateId: number,
  profile: SuitabilityProfile,
): Promise<CandidateDetail> {
  return fetchJson<CandidateDetail>(
    `/api/v1/suitability/candidates/${candidateId}?profile=${profile}`,
  );
}

/**
 * MapLibre vector-tile URL template for a suitability run + weight profile.
 *
 * The whole candidate grid is served as PostGIS Mapbox Vector Tiles, so the map
 * no longer fetches a bbox-limited GeoJSON slice. The run id and profile are in
 * the path, so each tile URL is immutable and cacheable forever.
 *
 * Same-origin by construction: in production `apiBaseUrl()` is "" and the tiles
 * resolve against the page origin (the reverse proxy). We resolve that empty
 * base to `window.location.origin` because MapLibre fetches tiles from a Web
 * Worker whose base URL is a blob: URL — a bare relative path would not resolve
 * there. No host, IP, or domain is ever hardcoded.
 */
export function suitabilityTileUrl(runId: number, profile: SuitabilityProfile): string {
  const base = apiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/api/v1/suitability/tiles/${runId}/${profile}/{z}/{x}/{y}.mvt`;
}

/** Vector-tile source-layer name the map binds its candidate layers to. */
export const SUITABILITY_TILE_SOURCE_LAYER = "candidates";

// --------------------------------------------------------------------------- //
// Capital-region Sudokwon Landfill inbound flow (V2 Phase 1) — the only
// source-declared origin→destination waste flow. Strictly metropolitan: origins
// are Seoul/Incheon/Gyeonggi (SGIS 11/28/41) and the single destination is the
// Sudokwon Landfill. Municipal/district flow is never returned or drawn.
// --------------------------------------------------------------------------- //

export type LandfillOrigin = "11" | "28" | "41";

export interface LandfillSourceRef {
  dataset_id: string;
  official_dataset_name: string;
  snapshot_uuid: string | null;
  snapshot_date: string | null;
}

export interface LandfillEvidence {
  quantity_status: string;
  fee_status: string;
  derived_status: string;
  notes: string[];
}

export interface LandfillPeriod {
  year: number;
  month: string | null;
  is_complete_year: boolean;
  available_through_month: string | null;
  latest_available_month: string | null;
  available_years: number[];
}

/**
 * Derived inbound fee per resident (LANDFILL_INBOUND_FEE_PER_CAPITA, v2).
 *
 * `fee_per_capita_krw` and `unavailable_reason` are mutually exclusive: a value
 * is served only when the official MOIS monthly population exists for exactly
 * `required_population_month` (the selected month, December of a complete year,
 * or the final month included in a partial year's fee). Null is never rendered
 * as 0원 — show the reason instead. The value is an analytical conversion, never
 * an amount a resident actually paid.
 */
export interface LandfillFeePerCapita {
  indicator: string;
  fee_per_capita_krw: string | null;
  unit: string;
  derivation_version: string;
  derivation_formula: string;
  evidence_status: string;
  inbound_fee_krw: string;
  fee_reference_year: number;
  fee_reference_period: string;
  fee_period_complete: boolean;
  required_population_month: string | null;
  population: number | null;
  population_reference_month: string | null;
  population_reference_year: number | null;
  population_reference_period: string | null;
  population_temporal_granularity: string | null;
  population_definition: string | null;
  population_definition_version: string | null;
  population_comparability_note: string | null;
  population_source_id: string | null;
  population_source_dataset_id: string | null;
  population_source_administrative_code: string | null;
  population_region_level: string | null;
  population_unit: string | null;
  included_origin_region_codes: string[];
  unavailable_reason: string | null;
  interpretation_caveat: string;
  /** Retained v1 field; identical to `interpretation_caveat`. */
  caveat: string;
}

export interface LandfillOriginShare {
  origin_region_code: string;
  origin_sgis_code: string;
  origin_name: string;
  origin_name_en: string;
  quantity_kg: string;
  quantity_tons: string;
  inbound_fee_krw: string;
  quantity_share: string | null;
  effective_fee_per_ton: string | null;
  fee_per_capita: LandfillFeePerCapita;
}

export interface LandfillWasteShare {
  waste_name: string;
  quantity_kg: string;
  quantity_tons: string;
  inbound_fee_krw: string;
  quantity_share: string | null;
  effective_fee_per_ton: string | null;
}

export interface LandfillSummary {
  period: LandfillPeriod;
  origin_filter: string | null;
  waste_filter: string | null;
  accounting_basis: string;
  destination_code: string;
  destination_name: string;
  total_quantity_kg: string;
  total_quantity_tons: string;
  total_inbound_fee_krw: string;
  effective_fee_per_ton: string | null;
  /** Σ fee ÷ Σ same-year population over the origins in scope; never a mean. */
  fee_per_capita: LandfillFeePerCapita;
  largest_origin_share: LandfillOriginShare | null;
  largest_waste_share: LandfillWasteShare | null;
  origin_shares: LandfillOriginShare[];
  top_waste_types: LandfillWasteShare[];
  row_count: number;
  evidence: LandfillEvidence;
  sources: LandfillSourceRef[];
  derivation_version: string;
  caveats: string[];
}

export interface LandfillTrendPoint {
  reference_month: string;
  reference_year: number;
  quantity_kg: string;
  quantity_tons: string;
  inbound_fee_krw: string;
  effective_fee_per_ton: string | null;
}

export interface LandfillTrends {
  start_month: string;
  end_month: string;
  origin_filter: string | null;
  waste_filter: string | null;
  accounting_basis: string;
  points: LandfillTrendPoint[];
  evidence: LandfillEvidence;
  sources: LandfillSourceRef[];
  derivation_version: string;
  caveats: string[];
}

export interface LandfillComposition {
  period: LandfillPeriod;
  origin_filter: string | null;
  accounting_basis: string;
  total_quantity_kg: string;
  total_quantity_tons: string;
  total_inbound_fee_krw: string;
  waste_types: LandfillWasteShare[];
  evidence: LandfillEvidence;
  sources: LandfillSourceRef[];
  derivation_version: string;
  caveats: string[];
}

export interface LandfillQuery {
  year?: number | null;
  month?: number | null;
  origin?: LandfillOrigin | null;
  wasteName?: string | null;
}

function landfillParams(query: LandfillQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.year != null) params.set("year", String(query.year));
  if (query.month != null) params.set("month", String(query.month));
  if (query.origin != null) params.set("origin", query.origin);
  if (query.wasteName != null && query.wasteName !== "") params.set("waste_name", query.wasteName);
  return params;
}

export function fetchLandfillSummary(query: LandfillQuery = {}): Promise<LandfillSummary> {
  return fetchJson<LandfillSummary>(`/api/v1/landfill/summary?${landfillParams(query).toString()}`);
}

export function fetchLandfillComposition(query: LandfillQuery = {}): Promise<LandfillComposition> {
  const params = new URLSearchParams();
  if (query.year != null) params.set("year", String(query.year));
  if (query.origin != null) params.set("origin", query.origin);
  return fetchJson<LandfillComposition>(`/api/v1/landfill/composition?${params.toString()}`);
}

// NOTE: `GET /api/v1/landfill/flows` is still served (read-only) but has no
// client here. It returns schematic representative coordinates that existed only
// to draw the straight-line flow map, which V2 Phase 2 removed — the source
// declares no municipal origin and no route. Do not reintroduce a client for it
// to draw a map; see docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md §7.

export interface LandfillTrendsQuery {
  startMonth?: string | null;
  endMonth?: string | null;
  origin?: LandfillOrigin | null;
  wasteName?: string | null;
}

export function fetchLandfillTrends(query: LandfillTrendsQuery = {}): Promise<LandfillTrends> {
  const params = new URLSearchParams();
  if (query.startMonth) params.set("start_month", query.startMonth);
  if (query.endMonth) params.set("end_month", query.endMonth);
  if (query.origin != null) params.set("origin", query.origin);
  if (query.wasteName != null && query.wasteName !== "") params.set("waste_name", query.wasteName);
  return fetchJson<LandfillTrends>(`/api/v1/landfill/trends?${params.toString()}`);
}

// --------------------------------------------------------------------------- //
// Facility cost model (Phase 4 backend). Standard-construction-cost ANALYSIS —
// never an actual project budget, an approved subsidy, or a personal tax bill.
// All money values arrive as exact decimal strings and are kept as strings.
// --------------------------------------------------------------------------- //

export interface FacilityCostBand {
  facility_type: string;
  capacity_min_ton_per_day: string | null;
  capacity_min_inclusive: boolean;
  capacity_max_ton_per_day: string | null;
  capacity_max_inclusive: boolean;
  cost_per_capacity_bn: string;
  cost_per_capacity_unit: string;
}

export interface FacilityCostOptions {
  derivation_version: string;
  facility_types: { value: string; label: string }[];
  subsidy_schemes: { value: string; label: string; rate: string }[];
  underground_multiplier: { min: string; max: string; default: string; note: string };
  default_operating_days: number;
  cost_versions: string[];
  active_cost_version: string;
  disclaimer: string;
}

export interface FacilityCostScenario {
  facility_type: string;
  facility_type_label: string;
  processing_share: string;
  processing_share_percent: string;
  operating_days_per_year: number;
  underground_multiplier: string;
  underground_multiplier_note: string;
  subsidy_scheme: string;
  subsidy_scheme_label: string;
  subsidy_rate: string;
  cost_version: string;
}

export interface FacilityCostOfficialInputRegion {
  region_code: string;
  region_name: string;
  generation_quantity_ton: string;
  population: number | null;
}

export interface FacilityCostOfficialInput {
  waste_stream: string;
  reference_year: number;
  waste_reference_period: string;
  accounting_basis: string;
  waste_source_id: string;
  waste_official_dataset_name: string;
  quantity_unit: string;
  official_annual_quantity_ton: string;
  service_region_codes: string[];
  regions: FacilityCostOfficialInputRegion[];
  population_source_id: string | null;
  population_reference_period: string | null;
  population_definition: string | null;
  official_service_population: number | null;
}

export interface FacilityCostCapacity {
  annual_service_quantity_ton: string;
  operating_days_per_year: number;
  facility_capacity_ton_per_day: string;
  capacity_unit: string;
}

export interface FacilityCostStandardCost {
  term_ko: string;
  matched_band: FacilityCostBand;
  standard_unit_cost_bn_per_tpd: string;
  underground_multiplier: string;
  standard_construction_cost_bn: string;
  unit: string;
}

export interface FacilityCostAnnualization {
  term_ko: string;
  facility_lifetime_years: number;
  lifetime_basis: string;
  annualized_construction_cost_bn: string;
  unit: string;
  method: string;
}

export interface FacilityCostSubsidy {
  subsidy_scheme: string;
  subsidy_scheme_label: string;
  subsidy_rate: string;
  rate_source: string;
  rate_reference_period: string;
  rate_basis: string;
  estimated_national_subsidy_bn: string;
  simplified_local_government_share_bn: string;
  unit: string;
  note: string;
}

export interface FacilityCostPerCapita {
  term_ko: string;
  per_capita_local_share_won: string | null;
  official_service_population: number | null;
  unavailable_reason: string | null;
  unit: string;
  caveat: string;
}

export interface FacilityCostCandidateContext {
  candidate_id: number;
  candidate_key: string | null;
  sido_region_name: string | null;
  sigungu_region_name: string | null;
  suitability_status: string | null;
  run_id: number | null;
  profile: string | null;
  note: string;
  suitability_disclaimer: string;
}

export interface FacilityCostCompleteness {
  is_partial: boolean;
  included_components: string[];
  missing_components: { component: string; reason: string }[];
}

export interface FacilityCostProvenance {
  derivation_version: string;
  cost_version: string;
  price_base_date: string;
  source_document: string;
  source_page: string;
  subsidy_rate_source: string;
  subsidy_rate_reference_period: string;
}

export interface FacilityCostCalculate {
  scenario: FacilityCostScenario;
  official_input: FacilityCostOfficialInput;
  capacity: FacilityCostCapacity;
  standard_cost: FacilityCostStandardCost;
  annualization: FacilityCostAnnualization;
  subsidy: FacilityCostSubsidy;
  per_capita: FacilityCostPerCapita;
  candidate_context: FacilityCostCandidateContext | null;
  completeness: FacilityCostCompleteness;
  provenance: FacilityCostProvenance;
  assumptions: string[];
  disclaimer: string;
}

export interface FacilityCostCalculateQuery {
  facilityType: string;
  wasteStream: string;
  subsidyScheme: string;
  regionCodes: string[];
  referenceYear?: number | null;
  processingSharePercent?: string;
  operatingDays?: number;
  undergroundMultiplier?: string;
  costVersion?: string | null;
  candidateId?: number | null;
}

export function fetchFacilityCostOptions(): Promise<FacilityCostOptions> {
  return fetchJson<FacilityCostOptions>("/api/v1/facility-cost/options");
}

export function fetchFacilityCostCalculate(
  query: FacilityCostCalculateQuery,
): Promise<FacilityCostCalculate> {
  const params = new URLSearchParams({
    facility_type: query.facilityType,
    waste_stream: query.wasteStream,
    subsidy_scheme: query.subsidyScheme,
    region_codes: query.regionCodes.join(","),
  });
  if (query.referenceYear != null) params.set("reference_year", String(query.referenceYear));
  if (query.processingSharePercent != null)
    params.set("processing_share_percent", query.processingSharePercent);
  if (query.operatingDays != null) params.set("operating_days", String(query.operatingDays));
  if (query.undergroundMultiplier != null)
    params.set("underground_multiplier", query.undergroundMultiplier);
  if (query.costVersion) params.set("cost_version", query.costVersion);
  if (query.candidateId != null) params.set("candidate_id", String(query.candidateId));
  return fetchJson<FacilityCostCalculate>(
    `/api/v1/facility-cost/calculate?${params.toString()}`,
  );
}
