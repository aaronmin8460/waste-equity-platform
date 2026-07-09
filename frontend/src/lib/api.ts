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

export function fetchDataSources(): Promise<DataSourceItem[]> {
  return fetchJson<DataSourceItem[]>("/api/v1/data-sources");
}
