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
  // Structured context for validation errors (e.g. INVALID_SCENARIO_WEIGHTS
  // carries `{ sum }` / `{ missing }`). Absent on most errors.
  fields?: Record<string, unknown> | null;
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
    fields: candidate.fields ?? null,
  };
}

/**
 * POST variant of {@link fetchJsonSignal}: a stateless read-only computation
 * (the scenario endpoints compute over frozen stored scores and never write).
 * Preserves the structured error body (including `fields`) as an {@link ApiError}.
 */
export async function postJsonSignal<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
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

export interface DataFreshnessItem {
  source_id: string;
  source_name: string;
  publication_frequency: string;
  latest_reference_period: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_success_at: string | null;
  next_scheduled_at: string | null;
  freshness_status: string;
}

export function fetchDataFreshness(): Promise<DataFreshnessItem[]> {
  return fetchJson<DataFreshnessItem[]>("/api/v1/data-freshness");
}

// --------------------------------------------------------------------------- //
// Facility mapping transparency (데이터·출처) — how many facilities have a usable
// map location vs not, with a bounded, paginated list of the un-mapped ones and
// the RECORDED reason for a missing location (never fabricated).
// --------------------------------------------------------------------------- //

export interface FacilityCategoryBreakdownRow {
  category: string;
  total: number;
  with_map_location: number;
  without_map_location: number;
}

export interface FacilityOwnershipBreakdownRow {
  ownership: string;
  total: number;
}

export interface FacilityRegionMappingBreakdownRow {
  region_mapping_status: string;
  total: number;
}

export interface FacilitySourceBreakdownRow {
  source_id: string;
  official_dataset_name: string;
  total: number;
}

export interface UnmappedFacilityRow {
  id: number;
  facility_name: string;
  facility_category: string;
  ownership: string;
  rcis_sido_name: string;
  rcis_sigungu_name: string;
  region_code: string | null;
  region_name: string | null;
  region_mapping_status: string;
  geocode_status: string | null;
  /** Recorded geocode annotation, or null → the UI shows "실패 사유 기록 없음". */
  missing_location_reason: string | null;
}

export interface PaginatedUnmappedFacilities {
  page: number;
  page_size: number;
  total: number;
  items: UnmappedFacilityRow[];
}

export interface FacilityMappingTransparency {
  reference_year: number;
  reference_period: string;
  total: number;
  with_map_location: number;
  without_map_location: number;
  without_address: number;
  category_breakdown: FacilityCategoryBreakdownRow[];
  ownership_breakdown: FacilityOwnershipBreakdownRow[];
  region_mapping_breakdown: FacilityRegionMappingBreakdownRow[];
  source_breakdown: FacilitySourceBreakdownRow[];
  unmapped: PaginatedUnmappedFacilities;
  disclaimer: string;
}

export interface FacilityMappingTransparencyQuery {
  year?: number | null;
  page?: number;
  pageSize?: number;
}

export function fetchFacilityMappingTransparency(
  query: FacilityMappingTransparencyQuery = {},
): Promise<FacilityMappingTransparency> {
  const params = new URLSearchParams();
  if (query.year != null) params.set("year", String(query.year));
  if (query.page != null) params.set("page", String(query.page));
  if (query.pageSize != null) params.set("page_size", String(query.pageSize));
  const qs = params.toString();
  return fetchJson<FacilityMappingTransparency>(
    `/api/v1/facilities/mapping-transparency${qs ? `?${qs}` : ""}`,
  );
}

// --------------------------------------------------------------------------- //
// Suitability screening (Phase 5.4) — analytical screening only, never legal.
// --------------------------------------------------------------------------- //

export type SuitabilityProfile =
  | "baseline"
  | "equal"
  | "equity_focused"
  | "access_focused"
  | "critic";
export type SuitabilityStatus = "ELIGIBLE" | "REVIEW_REQUIRED" | "EXCLUDED";
export type StabilityClass = "STABLE" | "CONDITIONALLY_STABLE" | "WEIGHT_SENSITIVE";

export interface SuitabilityPolicy {
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  critic_method_version: string;
  stability_method_version: string;
  /**
   * Which component model this POLICY describes, and the order it enumerates its
   * components in (Successor-V3 contract, `schemas/suitability.py`).
   *
   * OPTIONAL on purpose. The contract itself is now authoritative (the release and
   * preview branches are the same commit, `b93393a`), but the field stays `?`:
   *   1. the deployed backend still serves the pre-V3 shape, and a response without
   *      this field must render nothing rather than make this screen throw;
   *   2. `/policies` describes the currently implemented policy rather than a stored
   *      run, and the route hardcodes the HISTORICAL model — so when this field is
   *      present it reads `suitability-components-zred-v1`, not the successor.
   *
   * Never render a component NAME from a client-side glossary against a run whose
   * model you have not checked: that is exactly what this field exists to prevent.
   */
  component_model_version?: string;
  component_order?: string[];
  statuses: string[];
  // Static policy-assumption profiles only (critic is NOT here — it is
  // data-derived per run and lives on the run's weight_profiles).
  weight_profiles: Record<string, Record<string, string>>;
  static_weight_profiles: Record<string, Record<string, string>>;
  data_derived_profiles: Record<string, Record<string, unknown>>;
  supported_profiles: string[];
  stability_profiles: string[];
  stability_top_fraction: string;
  profile_methodology: Record<string, string>;
  default_profile: string;
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
  /**
   * THE RUN'S OWN component-model identity (backend contract:
   * docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md).
   *
   * Reported per RUN, never taken from the client's own constants, so a reader can
   * never see one model's numbers under another model's labels. Two values exist
   * today: `suitability-components-zred-v1` (historical Z/R/E/D) and
   * `suitability-components-successor-v1` (Successor V3).
   *
   * A run whose model is `suitability-components-zred-v1` carries its scores in the
   * four legacy `*_score` fields; any other model carries them in `component_scores`
   * with the legacy fields explicitly null. The two are never dual-emitted.
   *
   * OPTIONAL on this type because a response served by a pre-contract backend
   * carries neither field; `undefined` therefore means "this backend does not
   * report a model", which is treated as historical rather than as successor.
   */
  component_model_version?: string;
  component_order?: string[];
  // Actual run weight profiles (static + run-specific critic), {} on old runs.
  weight_profiles: Record<string, Record<string, string>>;
  weight_derivation: Record<string, unknown>;
  stability_definition: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface SuitabilitySummary {
  run_id: number;
  /**
   * THE RUN'S own component-model identity, served on this shape too. Optional for a
   * pre-contract backend; `undefined` is treated as historical, never as successor.
   * Needed here because the stability class's denominator depends on the model (3
   * compared profiles historically, 4 perturbations under the successor model).
   */
  component_model_version?: string;
  component_order?: string[];
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
  // Weight-sensitivity stability (baseline/equal/critic). Counts are 0 and the
  // weights/definition empty for runs without CRITIC/stability data.
  critic_weights: Record<string, string> | null;
  stability_top_fraction: string | null;
  stability_top_cutoff_rank: number | null;
  candidate_count_stable: number;
  candidate_count_conditionally_stable: number;
  candidate_count_weight_sensitive: number;
  top_stable_candidates: Array<Record<string, unknown>>;
  stability_definition: Record<string, unknown>;
  stability_available: boolean;
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
  // Weight-sensitivity stability (ELIGIBLE only; null/{} otherwise).
  stable_count: number | null;
  stability_class: StabilityClass | null;
  stability_membership: Record<string, boolean>;
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
  /**
   * THE RUN'S own component-model identity, served on this shape too. Optional for a
   * pre-contract backend; `undefined` is treated as historical, never as successor.
   * Needed here because the stability class's denominator depends on the model (3
   * compared profiles historically, 4 perturbations under the successor model).
   */
  component_model_version?: string;
  component_order?: string[];
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
  /**
   * The scope and ordering the server ACTUALLY applied, after normalizing the bare
   * SGIS spelling and de-duplicating (Page-4B). Echoed so a caller can confirm the
   * scope was read the way it meant it, instead of inferring that from an empty
   * result — a real 0 and a mis-sent filter look identical otherwise.
   */
  sido: string | null;
  sigungu: string[];
  sort: SuitabilitySort;
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
  /** This candidate's run's own component-model identity. See `SuitabilityRun`. */
  component_model_version?: string;
  component_order?: string[];
  /**
   * VERSION-AWARE component scores, keyed by the run's own component names.
   *
   * The backend contract is strict and this type mirrors it exactly:
   *   - historical runs populate `zoning_score`/`road_score`/`equity_score`/
   *     `demand_score` and emit `component_scores` as `{}`;
   *   - every other model emits its scores HERE and the four legacy fields as
   *     explicit `null` — present, never omitted, never reused for another quantity.
   *
   * Nothing is dual-emitted, so there is exactly one authoritative copy of any
   * component score and the two representations can never drift apart. A `null`
   * VALUE inside the map is a served missing score and stays missing — never 0.
   */
  component_scores?: Record<string, string | null>;
}

/**
 * fetchJson variant that supports cancellation via an AbortSignal.
 *
 * The signal is optional: the relative-grade threshold reads are four tiny,
 * idempotent lookups whose results are cached per run+profile, so there is no
 * in-flight request worth cancelling and no stale-response hazard.
 */
export async function fetchJsonSignal<T>(path: string, signal?: AbortSignal): Promise<T> {
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

/**
 * Ranking DIRECTION over the screening's own rank ordering — deliberately not a
 * sort-field selector, so no caller can reorder the screening by a column the
 * methodology never ranked on. Unscored REVIEW_REQUIRED / EXCLUDED cells stay last
 * in BOTH directions: an unscored cell is not "the lowest-scoring one".
 */
export type SuitabilitySort = "score_desc" | "score_asc";

export const SUITABILITY_DEFAULT_SORT: SuitabilitySort = "score_desc";

export interface CandidateQuery {
  profile: SuitabilityProfile;
  bbox?: string;
  status?: SuitabilityStatus;
  stability_class?: StabilityClass;
  /**
   * SIDO scope, canonical `KR-SGIS-11 | 23 | 31`.
   *
   * MUST NOT be combined with {@link CandidateQuery.sigungu}: the two codes come
   * from independent point-in-polygon lookups against non-coincident layers, so
   * sending both intersects them and silently drops the boundary cells. Build both
   * fields through `lib/suitabilityScope.ts::scopeToQuery`, whose scope type makes
   * the illegal pair unrepresentable.
   */
  sido?: string;
  /**
   * SIGUNGU scope, repeatable with OR semantics — one citizen-facing city can be
   * several codes (안산시 is its two 일반구). An empty/absent list means NO
   * restriction, never "match none".
   */
  sigungu?: string[];
  /** Ranking direction. Omitted ⇒ the server default, `score_desc`. */
  sort?: SuitabilitySort;
  top?: number;
  limit?: number;
  /**
   * Pin the query to a specific analysis run instead of the latest. The
   * relative-grade thresholds MUST be read from the same run the map is showing,
   * or a run published mid-session would silently mix two populations.
   */
  runId?: number;
  /**
   * Page offset. With `top` set the endpoint orders by the profile's rank
   * ASCENDING, so `limit=1&offset=k-1` addresses the k-th ranked candidate —
   * which is how `lib/relativeGrade.ts` reads an exact order statistic without
   * downloading the whole population.
   */
  offset?: number;
  /** Inclusive score floor. `limit=1` + `total_matched` gives an exact band count. */
  minScore?: number;
  /** Inclusive score ceiling. */
  maxScore?: number;
}

export function fetchSuitabilityCandidates(
  query: CandidateQuery,
  signal?: AbortSignal,
): Promise<SuitabilityCandidateCollection> {
  const params = new URLSearchParams({ profile: query.profile });
  if (query.bbox) params.set("bbox", query.bbox);
  if (query.status) params.set("status", query.status);
  if (query.stability_class) params.set("stability_class", query.stability_class);
  if (query.sido) params.set("sido", query.sido);
  // Repeatable, one `sigungu=` per code — NOT a comma-joined value, which the
  // backend would read as a single unknown code and answer with an empty result.
  // Empty strings are dropped here so a cleared multi-select sends no restriction.
  for (const code of query.sigungu ?? []) {
    if (code !== "") params.append("sigungu", code);
  }
  if (query.sort) params.set("sort", query.sort);
  if (query.top !== undefined) params.set("top", String(query.top));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.runId !== undefined) params.set("run_id", String(query.runId));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.minScore !== undefined) params.set("min_score", String(query.minScore));
  if (query.maxScore !== undefined) params.set("max_score", String(query.maxScore));
  return fetchJsonSignal<SuitabilityCandidateCollection>(
    `/api/v1/suitability/candidates?${params.toString()}`,
    signal,
  );
}

/**
 * Profiles actually available for a run, derived from its stored weight_profiles.
 *
 * The CRITIC profile is only offered when the selected run computed it (its key
 * is present in weight_profiles); an old run without CRITIC data never exposes an
 * enabled critic option. Ordered so the four static profiles precede critic.
 */
const STATIC_PROFILES: SuitabilityProfile[] = [
  "baseline",
  "equal",
  "equity_focused",
  "access_focused",
];

export function availableProfiles(run: SuitabilityRun | null | undefined): SuitabilityProfile[] {
  // The four static profiles are always available (policy constants). CRITIC is
  // offered only when the selected run actually computed it (present in its stored
  // weight_profiles), so an old run without CRITIC data never shows an enabled
  // critic option.
  return hasCriticStability(run) ? [...STATIC_PROFILES, "critic"] : [...STATIC_PROFILES];
}

/** True when the selected run carries run-specific CRITIC + stability results. */
export function hasCriticStability(run: SuitabilityRun | null | undefined): boolean {
  return !!run && "critic" in (run.weight_profiles ?? {});
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
// Inland-wetland inventory (Phase 1B-2) — read-only environmental map layer.
//
// A SEPARATE optional layer over the surveyed 국립생태원 내륙습지 목록. It is not a
// statutory protection area and carries no score/rank/exclusion — the API is
// strictly read-only. Kept distinct from the statutory UM901 layer.
// --------------------------------------------------------------------------- //

/** Vector-tile source-layer name the map binds its wetland layers to. */
export const WETLAND_TILE_SOURCE_LAYER = "wetlands";

/**
 * MapLibre vector-tile URL template for the active inland-wetland release. Same
 * origin-resolution as {@link suitabilityTileUrl} (MapLibre fetches tiles from a
 * Web Worker whose base URL is a blob:, so an empty base is resolved to the page
 * origin). The tile is pinned to an immutable dataset version server-side.
 */
export function wetlandTileUrl(): string {
  const base = apiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/api/v1/environment/wetlands/tiles/{z}/{x}/{y}.mvt`;
}

export interface WetlandLifecycle {
  contract_verification: string;
  database_ingestion: string;
  api_exposure: string;
  frontend_map_exposure: string;
  /** Always "NOT_IMPLEMENTED" in this phase — the layer carries no score. */
  scoring_integration: string;
  production_deployment: string;
}

export interface WetlandProvenance {
  dataset_version_id: number;
  provider: string;
  official_dataset_name: string;
  provider_dataset_identifier: string;
  official_source_url: string | null;
  reference_date: string;
  source_crs: string;
  storage_crs: string;
  source_encoding: string | null;
  transformation_version: string;
  license_note: string | null;
}

export interface WetlandMetadata {
  layer_name: string;
  korean_label: string;
  provider: string;
  official_dataset_name: string;
  provider_dataset_identifier: string;
  official_source_url: string | null;
  reference_date: string;
  source_crs: string;
  storage_crs: string;
  source_encoding: string | null;
  transformation_version: string;
  declared_feature_count: number | null;
  served_feature_count: number;
  geometry_type: string;
  lifecycle: WetlandLifecycle;
  statutory_status_statement: string;
  um901_distinction_statement: string;
  license_note: string | null;
  provenance: WetlandProvenance;
  last_ingestion: {
    run_id: number;
    status: string;
    rows_inserted: number;
    reference_period: string | null;
  } | null;
}

/**
 * One wetland feature's detail — the public-safe subset the click popup needs
 * (source names + address that never travel in the lightweight tile). Geometry
 * and the full provenance block are also served but not consumed by the popup.
 */
export interface WetlandFeatureDetail {
  id: number;
  wetland_code: string;
  wetland_name: string;
  wetland_type: string;
  reported_area_m2: number | null;
  source_address: string | null;
  source_sido_name: string | null;
  source_sigungu_name: string | null;
  source_eupmyeondong_name: string | null;
  designation_note: string | null;
  designation_note_label: string;
  source_reference_date: string;
  statutory_status_statement: string;
  um901_distinction_statement: string;
}

export function fetchWetlandMetadata(): Promise<WetlandMetadata> {
  return fetchJson<WetlandMetadata>("/api/v1/environment/wetlands/metadata");
}

export function fetchWetlandDetail(id: number): Promise<WetlandFeatureDetail> {
  return fetchJson<WetlandFeatureDetail>(`/api/v1/environment/wetlands/${id}`);
}

// --------------------------------------------------------------------------- //
// Land-cover candidate-cell statistics (Phase 1B-LC4/LC5A) — 토지피복 격자 통계.
//
// Per canonical 500 m candidate cell, the land-cover composition of the acquired
// 세분류 [2025] 토지피복지도 release, as derived and frozen by Phase 1B-LC3. Read-only
// and DESCRIPTIVE: nothing here feeds a suitability score, rank, status, exclusion,
// review reason, weight, policy, or derivation version — the served
// `used_in_suitability_scoring: false` is mirrored in the types so the UI can state
// it from the response rather than from a hardcoded assumption.
//
// Only the subset the candidate-detail panel consumes is typed here (the backend
// serves a larger schema); the fields that carry meaning the UI must not weaken —
// candidate key, coverage status/ratio, both share denominators, licence/lifecycle
// metadata, and the scoring flag — are all typed exactly.
// --------------------------------------------------------------------------- //

/**
 * Coverage of a candidate cell by the acquired land-cover extent.
 *
 * Decided by exact set-theoretic emptiness of the polygonal residual, NOT by an
 * area threshold, so a cell is never promoted to COMPLETE_EXACT for being close to
 * fully covered. `NO_COVERAGE` means ONLY that the acquired extent does not
 * evaluate the cell — never that no land cover exists, that the land is empty /
 * unused / vacant, or that the cell is safe or suitable.
 */
export type LandCoverCoverageStatus = "COMPLETE_EXACT" | "PARTIAL" | "NO_COVERAGE";

/**
 * The dominant class at each level of the official source hierarchy.
 *
 * Every field is null for a `NO_COVERAGE` cell (no class rows exist at all). Nulls
 * are preserved as nulls — never coerced to "" or to a zero class code, which would
 * fabricate a class the source never assigned.
 */
export interface LandCoverDominantClass {
  l1_code: string | null;
  l1_name: string | null;
  l2_code: string | null;
  l2_name: string | null;
  l3_code: string | null;
  l3_name: string | null;
}

/** Distinct class counts and per-level area sums (all zero for `NO_COVERAGE`). */
export interface LandCoverClassCounts {
  l1_class_count: number;
  l2_class_count: number;
  l3_class_count: number;
  l1_class_area_sum_m2: number;
  l2_class_area_sum_m2: number;
  l3_class_area_sum_m2: number;
}

/** Identity of the active LC3 statistics release the response was read from. */
export interface LandCoverStatisticsRelease {
  statistics_version_id: number;
  status: string;
  derivation_version: string;
  area_crs: string;
  candidate_grid_version: string;
  candidate_grid_fingerprint: string;
  land_cover_dataset_version_id: number;
  reference_period: string;
  expected_cell_count: number;
  processed_cell_count: number;
}

/** Lifecycle of the land-cover dataset's exposure. Served, never assumed. */
export interface LandCoverLifecycle {
  source_contract_validation: string;
  database_ingestion: string;
  cell_statistics_derivation: string;
  api_exposure: string;
  frontend_exposure: string;
  vector_tiles: string;
  scoring_integration: string;
  production_deployment: string;
}

/**
 * The load-bearing disclosures served with every land-cover statistics response.
 *
 * Rendered verbatim rather than restated, so the UI cannot drift from the backend's
 * own wording on licence state, scoring non-use, or coverage meaning.
 */
export interface LandCoverSourceAttribution {
  provider: string;
  official_dataset_name: string;
  reference_period: string;
  official_source_url: string;
  transformation_version: string;
  candidate_grid_version: string;
  statistics_derivation_version: string | null;
  statistics_version_id: number | null;
  /** The exact attribution string every public surface must display, verbatim. */
  attribution_ko: string;
  raw_source_not_returned_ko: string;
  authorization_status: string;
  authorization_basis: string;
}

export interface LandCoverDisclosures {
  reference_period: string;
  /**
   * Public state of the derived services — since Phase 1B-LC8,
   * "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER". The field keeps its
   * historic name; the value is a deployment status, not a licence grant.
   */
  license_status: string;
  license_statement: string;
  /** Why publication is permitted: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION". */
  authorization_basis: string;
  public_statement_ko: string;
  attribution: LandCoverSourceAttribution;
  license_note: string | null;
  /** Always false in this phase. Typed as boolean so the UI reads the served value. */
  used_in_suitability_scoring: boolean;
  scoring_statement: string;
  coverage_status_semantics: Record<LandCoverCoverageStatus, string>;
  no_coverage_warning_ko: string;
  uncovered_area_statement: string;
  class_label_statement: string;
  raw_feature_exposure_statement: string;
  availability_statement: string;
  lifecycle: LandCoverLifecycle;
}

/**
 * One candidate cell's land-cover statistics.
 *
 * `uncovered_area_m2` is a COVERAGE measurement on the cell, never a land-cover
 * class: no UNKNOWN/UNCLASSIFIED pseudo-class is synthesized from it anywhere.
 */
export interface LandCoverCellStatistics {
  candidate_grid_version: string;
  candidate_key: string;
  candidate_geometry_fingerprint: string;
  sido_region_code: string | null;
  sido_region_name: string | null;
  sigungu_region_code: string | null;
  sigungu_region_name: string | null;
  /** The cell's own area in the release's area CRS — not a nominal 500×500 m. */
  cell_area_m2: number;
  evaluated_area_m2: number;
  uncovered_area_m2: number;
  uncovered_residual_area_m2: number;
  coverage_ratio: number;
  coverage_status: LandCoverCoverageStatus;
  /** The backend's own plain-language meaning of `coverage_status`. */
  coverage_status_meaning: string;
  topological_cover_predicate: boolean;
  intersection_area_sum_m2: number;
  overlap_area_m2: number;
  matched_feature_count: number;
  dominant_class: LandCoverDominantClass;
  class_counts: LandCoverClassCounts;
  candidate_occurrence_count: number;
  representation_variant_count: number;
  guard_applied: boolean;
  derivation_version: string;
  area_crs: string;
  used_in_suitability_scoring: boolean;
  release: LandCoverStatisticsRelease;
  disclosures: LandCoverDisclosures;
}

/**
 * One class row of a cell's distribution, with BOTH share denominators.
 *
 * `share_of_evaluated_area` is the share of the part of the cell the release
 * actually evaluated; `share_of_cell_area` is the share of the whole cell. They
 * diverge exactly as much as the cell is uncovered, and are never conflated.
 * `share_of_evaluated_area` is null (never 0) when there is no evaluated area.
 */
export interface LandCoverClassShare {
  /** 1 = 대분류, 2 = 중분류, 3 = 세분류. */
  class_level: 1 | 2 | 3;
  /** Official source class code, preserved verbatim. */
  class_code: string;
  /** Official source Korean class name, preserved verbatim — never translated. */
  class_name: string;
  class_area_m2: number;
  share_of_evaluated_area: number | null;
  share_of_cell_area: number | null;
}

/**
 * A cell's complete class distribution across all three official levels.
 *
 * `items` is a single flat, deterministically ordered list (level ascending, then
 * area descending) exactly as served; it is EMPTY for a `NO_COVERAGE` cell.
 */
export interface LandCoverCellClassDistribution {
  candidate_grid_version: string;
  candidate_key: string;
  coverage_status: LandCoverCoverageStatus;
  coverage_status_meaning: string;
  cell_area_m2: number;
  evaluated_area_m2: number;
  uncovered_area_m2: number;
  coverage_ratio: number;
  class_level_filter: number | null;
  class_counts: LandCoverClassCounts;
  total: number;
  items: LandCoverClassShare[];
  used_in_suitability_scoring: boolean;
  release: LandCoverStatisticsRelease;
  disclosures: LandCoverDisclosures;
}

const LAND_COVER_CELL_STATISTICS_PATH = "/api/v1/environment/land-cover/cell-statistics";

/**
 * One candidate cell's land-cover statistics.
 *
 * `candidateKey` is the candidate's own stable identity as served by the
 * suitability API (`<grid version>:<i>_<j>`) — never derived from coordinates,
 * array order, rank, or display text. It is percent-encoded because the canonical
 * key contains a colon.
 */
export function fetchLandCoverCellStatistics(
  candidateKey: string,
  signal: AbortSignal,
): Promise<LandCoverCellStatistics> {
  return fetchJsonSignal<LandCoverCellStatistics>(
    `${LAND_COVER_CELL_STATISTICS_PATH}/cells/${encodeURIComponent(candidateKey)}`,
    signal,
  );
}

/** One candidate cell's complete L1/L2/L3 class distribution. */
export function fetchLandCoverCellClasses(
  candidateKey: string,
  signal: AbortSignal,
): Promise<LandCoverCellClassDistribution> {
  return fetchJsonSignal<LandCoverCellClassDistribution>(
    `${LAND_COVER_CELL_STATISTICS_PATH}/cells/${encodeURIComponent(candidateKey)}/classes`,
    signal,
  );
}

// --------------------------------------------------------------------------- //
// Land-cover candidate-cell vector tiles (Phase 1B-LC5B) — map-wide layer.
//
// The map draws the COMPLETE candidate-cell statistics layer as PostGIS vector
// tiles. It deliberately does NOT reuse the paginated `/cells` JSON endpoint: that
// caps at 500 rows and carries no geometry, so it cannot render 47,893 cells.
// --------------------------------------------------------------------------- //

/** Vector-tile source-layer name the map binds its land-cover layers to. */
export const LAND_COVER_CELL_TILE_SOURCE_LAYER = "land_cover_cells";

/**
 * The subset of `GET /cell-statistics/release` the MAP needs.
 *
 * Only the release identity, the counts the control reports, and the disclosures are
 * typed here — the backend serves a much larger schema (provenance, audits, derivation
 * metadata) that the candidate-detail panel already covers. `statistics_version_id` is
 * the load-bearing field: it is what pins the tile URL to an immutable release.
 */
/**
 * Provenance of the acquired source release the statistics derive from.
 *
 * Optional on the client type: the map only needs the identity fields above, and a
 * consumer must not crash if a response omits provenance. Nothing here is raw source
 * geometry — it is release-level metadata only.
 */
export interface LandCoverSourceRelease {
  dataset_version_id: number;
  provider: string;
  official_dataset_name: string;
  official_source_url: string | null;
  reference_period: string | null;
  transformation_version: string;
}

export interface LandCoverActiveRelease {
  statistics_version_id: number;
  status: string;
  candidate_grid_version: string;
  expected_cell_count: number;
  processed_cell_count: number;
  coverage_status_counts: Record<LandCoverCoverageStatus, number>;
  disclosures: LandCoverDisclosures;
  /** LC3 derivation version of this release. Absent only on a malformed response. */
  derivation_version?: string;
  source_release?: LandCoverSourceRelease;
}

/** The active statistics release, for resolving the version-pinned tile URL. */
export function fetchLandCoverActiveRelease(signal: AbortSignal): Promise<LandCoverActiveRelease> {
  return fetchJsonSignal<LandCoverActiveRelease>(`${LAND_COVER_CELL_STATISTICS_PATH}/release`, signal);
}

/**
 * MapLibre vector-tile URL template for one IMMUTABLE statistics version.
 *
 * The version id is in the path, never implied by "whichever release is active when
 * the tile is requested", so a tile URL means the same thing for as long as it is
 * cached. Same origin-resolution as {@link suitabilityTileUrl}: in production
 * `apiBaseUrl()` is "" and the tiles resolve against the page origin, which is
 * resolved explicitly because MapLibre fetches tiles from a Web Worker whose base URL
 * is a `blob:` URL. No host, IP, or domain is ever hardcoded.
 */
export function landCoverCellTileUrl(statisticsVersionId: number): string {
  const base = apiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${LAND_COVER_CELL_STATISTICS_PATH}/tiles/${statisticsVersionId}/{z}/{x}/{y}.mvt`;
}

// --------------------------------------------------------------------------- //
// User-weight scenario lab (Phase 6) — 사용자 가정 기반 시나리오.
//
// A TEMPORARY, on-read decision-support experiment: it recombines ONE fixed
// succeeded run's frozen Z/R/E/D component scores under user-supplied weights.
// It is NOT a stored profile — `SuitabilityProfile` still means only the five
// official/analytical profiles, and a user scenario is a SEPARATE type here.
// Nothing is persisted; no official run/CRITIC/stability is created or changed.
// --------------------------------------------------------------------------- //

/** Direction a candidate's rank moved under the scenario vs the comparison profile. */
export type UserScenarioRankDirection = "up" | "down" | "same";

/** Canonical Z/R/E/D weights as exact 8-dp decimal strings (e.g. "0.35000000"). */
export interface UserScenarioWeights {
  zoning: string;
  road: string;
  equity: string;
  demand: string;
}

/**
 * The component model a run was scored under.
 *
 * `suitability-components-zred-v1` is the historical Z/R/E/D model and is the
 * DEFAULT for every unpinned request. `suitability-components-successor-v1` is the
 * Successor-V3 model (existing_burden / air_impact_proxy / resident_impact /
 * land_conversion), which scores runs but — see
 * `COMPONENT_MODEL_SCENARIOS_UNAVAILABLE` — has no approved weight vector or
 * normalization strategy for user scenarios, so it serves none.
 */
export const COMPONENT_MODEL_HISTORICAL = "suitability-components-zred-v1";

export interface UserScenarioRequest {
  run_id?: number | null;
  /**
   * Optional component-model selector. Omitted → the default (historical) model,
   * which is the behaviour every existing caller relies on. When `run_id` is also
   * given the run must belong to this model, or the request fails with
   * `COMPONENT_MODEL_MISMATCH`.
   */
  component_model_version?: string | null;
  weights: UserScenarioWeights;
  compare_profile: SuitabilityProfile;
  top_n?: number;
  selected_candidate_id?: number | null;
  /**
   * THE ANALYSIS SCOPE the scenario is ranked WITHIN — the same ① 지역 선택 the
   * candidates endpoint takes, in the same SGIS code space and with the same
   * serializer (`scopeToQuery`).
   *
   * A scenario compares two WEIGHT VECTORS; it must never also compare two different
   * geographic universes. Omitting both is 수도권 전체, which is what every caller
   * sent before this existed, so the default is unchanged.
   */
  sido?: string | null;
  sigungu?: string[];
}

export interface UserScenarioContribution {
  component: string;
  component_score: string | null;
  weight: string;
  weighted_contribution: string | null;
}

export interface UserScenarioTopCandidate {
  candidate_id: number;
  candidate_key: string;
  sido_region_code: string | null;
  sido_region_name: string | null;
  sigungu_region_code: string | null;
  sigungu_region_name: string | null;
  custom_score: string;
  custom_rank: number;
  comparison_profile: string;
  comparison_score: string | null;
  comparison_rank: number | null;
  rank_delta: number | null;
  rank_change_direction: UserScenarioRankDirection | null;
  /** Legacy (zred-v1) component scores: populated for historical runs, null otherwise. */
  zoning_score: string | null;
  road_score: string | null;
  equity_score: string | null;
  demand_score: string | null;
  /**
   * Version-aware component scores keyed by the run's OWN component names.
   * `{}` for historical runs, whose scores are the four fields above.
   */
  component_scores: Record<string, string | null>;
  /**
   * The STORED RUN's weight-sensitivity stability — never recomputed under the
   * scenario, and therefore identical in both sides of an A/B comparison.
   */
  stable_count: number | null;
  stability_class: StabilityClass | null;
  centroid_lon: number | null;
  centroid_lat: number | null;
}

export interface UserScenarioCandidateDetail {
  candidate_id: number;
  run_id: number;
  candidate_key: string;
  status: SuitabilityStatus;
  is_excluded: boolean;
  method_version: string;
  scenario_hash: string;
  scenario_hash_short: string;
  canonical_weights: UserScenarioWeights;
  compare_profile: string;
  custom_score: string | null;
  custom_provisional_score: string | null;
  custom_rank: number | null;
  comparison_score: string | null;
  comparison_rank: number | null;
  rank_delta: number | null;
  rank_change_direction: UserScenarioRankDirection | null;
  /** Legacy (zred-v1) component scores: populated for historical runs, null otherwise. */
  zoning_score: string | null;
  road_score: string | null;
  equity_score: string | null;
  demand_score: string | null;
  /** Version-aware component scores keyed by the run's own names; `{}` for historical runs. */
  component_scores: Record<string, string | null>;
  /** `component_score × scenario weight`, ordered by the run's `component_order`. */
  contributions: UserScenarioContribution[];
  /** The STORED RUN's stability. Not recomputed under the scenario. */
  stable_count: number | null;
  stability_class: StabilityClass | null;
  stability_membership: Record<string, boolean>;
  profile_totals: Record<string, string | null>;
  profile_ranks: Record<string, number | null>;
  sido_region_code: string | null;
  sido_region_name: string | null;
  sigungu_region_code: string | null;
  sigungu_region_name: string | null;
  exclusion_reasons: string[];
  review_reasons: string[];
  penalties: string[];
  raw_components: Record<string, unknown>;
  nearest_road_distance_m: string | null;
  nearest_road_provenance: Record<string, unknown>;
  component_provenance: Record<string, unknown>;
  centroid_lon: number | null;
  centroid_lat: number | null;
  geometry: GeoJSON.Geometry;
  reference_year: number;
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  /**
   * The RUN's own component-model identity. A scenario is only ever valid against
   * a run of the component model its weights are defined over.
   */
  component_model_version: string;
  /** The run's components, in the order `contributions` and the weights follow. */
  component_order: string[];
  scenario_label: string;
  scenario_disclaimer: string;
  screening_disclaimer: string;
}

export interface UserScenarioPreview {
  scenario_hash: string;
  scenario_hash_short: string;
  method_version: string;
  run_id: number;
  reference_year: number;
  policy_version: string;
  derivation_version: string;
  candidate_grid_version: string;
  /**
   * The RUN's own component-model identity; `canonical_weights` below is defined
   * over exactly these components, in `component_order`.
   */
  component_model_version: string;
  component_order: string[];
  canonical_weights: UserScenarioWeights;
  compare_profile: string;
  candidate_count_total: number;
  candidate_count_eligible: number;
  candidate_count_review: number;
  candidate_count_excluded: number;
  ranking_population: number;
  top_candidates: UserScenarioTopCandidate[];
  selected_candidate: UserScenarioCandidateDetail | null;
  tile_url: string;
  assumptions: string[];
  scenario_label: string;
  scenario_disclaimer: string;
  screening_disclaimer: string;
}

/** Preview a user-weight scenario against a fixed run (one POST per explicit apply). */
export function previewUserWeightScenario(
  request: UserScenarioRequest,
  signal?: AbortSignal,
): Promise<UserScenarioPreview> {
  return postJsonSignal<UserScenarioPreview>(
    "/api/v1/suitability/scenarios/preview",
    request,
    signal,
  );
}

/** One candidate's full scenario result (custom score/rank, weighted contributions). */
export function fetchUserScenarioCandidateDetail(
  candidateId: number,
  request: UserScenarioRequest,
  signal?: AbortSignal,
): Promise<UserScenarioCandidateDetail> {
  return postJsonSignal<UserScenarioCandidateDetail>(
    `/api/v1/suitability/scenarios/candidates/${candidateId}`,
    request,
    signal,
  );
}

/**
 * MapLibre custom-scenario vector-tile URL. Canonical 8-dp weights + the scenario
 * hash are in the query so the tile is fully determined by its URL (bounded
 * one-day browser cache). Same origin-resolution as {@link suitabilityTileUrl}.
 */
export function userScenarioTileUrl(
  runId: number,
  weights: UserScenarioWeights,
  scenarioHash: string,
  /**
   * The analysis scope, so the MAP draws the same population the ranking beside it
   * describes. Omitted → 수도권 전체, the tile this function has always produced.
   * It goes in the URL like every other tile parameter, which is what keeps a tile
   * fully determined by its URL (and its cache entry per 범위).
   */
  scope?: { sido?: string; sigungu?: string[] },
): string {
  const base = apiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  const scopeQuery = [
    scope?.sido ? `&sido=${encodeURIComponent(scope.sido)}` : "",
    ...(scope?.sigungu ?? []).map((code) => `&sigungu=${encodeURIComponent(code)}`),
  ].join("");
  return (
    `${base}/api/v1/suitability/scenarios/tiles/${runId}/{z}/{x}/{y}.mvt` +
    `?wz=${weights.zoning}&wr=${weights.road}&we=${weights.equity}&wd=${weights.demand}` +
    `&scenario_hash=${scenarioHash}${scopeQuery}`
  );
}

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
  /**
   * The FIRST ingested month inside `year`, the mirror of
   * `available_through_month`. Optional because a backend older than this field
   * omits it entirely — callers must fall back rather than assume "01".
   */
  available_from_month?: string | null;
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
// 2024 municipal waste collection/transport contract payments (Step 2 backend).
//
// A SEPARATE analytical dataset from the official Sudokwon Landfill inbound fee
// above. Different accounting basis, different providers (each 기초지자체 publishes
// its own contract disclosure), and a different spatial grain (시·군·구, not 시·도).
// It is served under the `/api/v1/landfill` prefix for dashboard placement only —
// `meta.is_official_landfill_fee` is always `false`, and the two indicators must
// never be summed, differenced, or ratio'd against each other.
//
// Every money field is an exact decimal string kept as a string, and `null` always
// means "no defensible value exists" — never 0. How many of the 66 are null is a
// property of the current ingestion, not of this contract: read it from
// `meta.unavailable_count` rather than assuming a fixed number here.
// --------------------------------------------------------------------------- //

/** Metropolitan SGIS sido code: 11 서울, 28 인천, 41 경기. */
export type MunicipalCostSido = "11" | "28" | "41";
export type MunicipalCostStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type MunicipalCostSort =
  | "payment_per_capita_desc"
  | "total_payment_desc"
  | "region_name_asc";

/** One constituent 일반구 behind a derived city population. */
export interface MunicipalCostPopulationComponent {
  region_code: string;
  region_name: string;
  population: number;
}

/** One workbook that resolved to this municipality. */
export interface MunicipalCostSourceRef {
  filename: string;
  dataset_role: string; // DATA_A | DATA_B
  layout_family: string;
  primary_classification: string;
  resolution_basis: string;
  sha256: string;
}

/** Tonnage evidence — reported for transparency, never an input to the indicator. */
export interface MunicipalCostQuantityCoverage {
  observation_count: number;
  measured_count: number;
  measured_zero_count: number;
  missing_count: number;
  repeated_municipal_block_count: number;
  months_covered: number;
  waste_categories: string[];
}

export interface MunicipalCostRow {
  municipality_key: string;
  display_name: string;
  metropolitan_code: string;
  metropolitan_name: string;
  /** Canonical `regions` code, or null for the seven Gyeonggi cities stored only as 일반구. */
  direct_region_code: string | null;
  boundary_vintage: string;
  population: number | null;
  /** DIRECT_REGION_POPULATION | DERIVED_SUM_OF_CONSTITUENT_WARDS */
  population_method: string;
  population_definition: string | null;
  population_components: MunicipalCostPopulationComponent[];
  total_eligible_payment_krw: string | null;
  eligible_contract_count: number;
  payment_per_capita_krw: string | null;
  status: MunicipalCostStatus;
  evidence_status: string;
  reason_codes: string[];
  /** Plain-Korean explanation, served by the backend — one entry per reason code. */
  limitations: string[];
  source_files: MunicipalCostSourceRef[];
  has_data_a: boolean;
  has_data_b: boolean;
  quantity_coverage: MunicipalCostQuantityCoverage;
}

export interface MunicipalCostSourceCoverage {
  discovered_file_count: number;
  accepted_file_count: number;
  rejected_file_count: number;
  data_a_file_count: number;
  data_b_file_count: number;
  municipalities_with_data_a: number;
  municipalities_with_data_b: number;
  municipalities_with_no_source_file: number;
}

export interface MunicipalCostRejectedSource {
  filename: string;
  dataset_role: string;
  reason_codes: string[];
  explanation: string | null;
}

export interface MunicipalCostMeta {
  indicator_code: string;
  display_name: string;
  description: string;
  reference_year: number;
  unit: string; // KRW/인
  accounting_basis: string;
  methodology_version: string;
  geography_policy: string;
  population_policy: string;
  numerator_definition: string;
  /** The served statement of how this differs from the official landfill fee. */
  difference_from_official_landfill_fee: string;
  /** Always false. The UI surfaces this distinction; it never paraphrases it away. */
  is_official_landfill_fee: boolean;
  /**
   * Scope counts, computed over the selected metropolitan BEFORE the status filter,
   * so a filtered response still reports honest denominators.
   */
  expected_count: number;
  available_count: number;
  partial_count: number;
  unavailable_count: number;
  returned_count: number;
  rejected_source_file_count: number;
  rejected_source_files: MunicipalCostRejectedSource[];
  source_coverage: MunicipalCostSourceCoverage;
  caveats: string[];
}

export interface MunicipalCostResponse {
  meta: MunicipalCostMeta;
  sido_filter: string | null;
  status_filter: string | null;
  sort: string;
  municipalities: MunicipalCostRow[];
}

export interface MunicipalCostQuery {
  /** Only 2024 is published in this release; any other year is a 422. */
  year?: number;
  sido?: MunicipalCostSido | null;
  status?: MunicipalCostStatus | null;
  sort?: MunicipalCostSort;
}

/** The one reference year this release publishes. */
export const MUNICIPAL_COST_YEAR = 2024;

export function fetchMunicipalCosts(
  query: MunicipalCostQuery = {},
): Promise<MunicipalCostResponse> {
  const params = new URLSearchParams();
  params.set("year", String(query.year ?? MUNICIPAL_COST_YEAR));
  if (query.sido != null) params.set("sido", query.sido);
  if (query.status != null) params.set("status", query.status);
  if (query.sort != null) params.set("sort", query.sort);
  return fetchJson<MunicipalCostResponse>(`/api/v1/landfill/municipal-costs?${params.toString()}`);
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
