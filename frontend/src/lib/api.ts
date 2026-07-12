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
