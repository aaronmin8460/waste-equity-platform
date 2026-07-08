# Data Requirements

This project must use real Korean public data for all public-facing analysis. Mock, generated, estimated, fallback, sample, or placeholder data must never be presented as official public data.

## Geographic Coverage

The first implementation scope must cover the full Seoul Metropolitan Area:

- Seoul
- Incheon
- Gyeonggi-do

Datasets should be evaluated for consistent coverage across all three areas before they are used for comparative analysis.

## Required Metadata For Every Source

Each source must record:

- Source name
- Publishing organization
- Access method, such as API endpoint, download URL, or file portal identifier
- License, terms of use, or usage note where available
- Retrieval timestamp
- Reference period
- Update cadence: annual, monthly, periodically updated, or real-time
- Geographic coverage
- Administrative boundary version or spatial reference where applicable
- Coordinate reference system for spatial data
- Transformation version
- Known limitations
- Verification status

## Required Metadata For Displayed Metrics

Every displayed analytical metric must include:

- Metric name
- Source
- Reference period
- Update cadence
- Retrieval or processing timestamp where relevant
- Geographic unit
- Any documented assumptions or caveats

## Data Cadence Categories

### Annual

Annual data represents a full calendar year or another clearly documented yearly reporting period. It may be appropriate for stable policy indicators, long-term trends, and historical comparison.

### Monthly

Monthly data represents a specific month or monthly reporting period. It may be used for recent trends when the source provides comparable monthly coverage.

### Periodically Updated

Periodically updated data changes on a source-defined schedule that is not strictly annual or monthly. Facility lists, land-use layers, zoning information, and administrative boundaries may fall into this category.

### Real-Time

Real-time data represents current or near-current readings, such as air quality, weather, wind direction, and wind speed. Real-time readings must be labeled clearly and must not be directly treated as permanent facility-siting evidence.

## Planned Data Categories

### Waste Generation And Treatment Statistics

Expected use:

- Compare waste generation and treatment patterns across administrative areas
- Support equity analysis using documented reference periods
- Provide historical or periodic context where available

Requirements:

- Must include source and reference period
- Must distinguish generation, treatment, recycling, disposal, and other categories according to source definitions
- Must not infer waste origin-to-destination movement unless explicitly provided

### Waste-Treatment Facilities

Expected use:

- Map existing waste-treatment infrastructure
- Analyze proximity, distribution, and potential burden
- Support facility-type filtering

Requirements:

- Must include facility type, location precision, operating status where available, and source
- Must preserve source definitions for facility categories
- Must identify whether coordinates are exact, parcel-based, address-geocoded, centroid-based, or otherwise derived

### Population And Administrative Boundaries

Expected use:

- Normalize indicators by population
- Aggregate metrics to administrative units
- Support spatial joins and regional comparison

Requirements:

- Must include boundary version or publication date
- Must include coordinate reference system
- Must cover Seoul, Incheon, and Gyeonggi-do consistently for comparative analysis

### Land-Use And Zoning Information

Expected use:

- Identify exclusion zones, constraints, and suitability factors
- Support documented facility-siting analysis

Requirements:

- Must include legal or administrative source where available
- Must record publication date or update cadence
- Must distinguish source-provided zoning categories from platform-derived simplifications

### Real-Time Air Quality

Expected use:

- Provide current environmental context
- Support exploratory overlays with clear real-time labeling

Requirements:

- Must include station or grid metadata where available
- Must include measurement timestamp and pollutant definitions
- Must not be treated as permanent facility-siting evidence without a separate historical analysis source

### Weather, Wind Direction, And Wind Speed

Expected use:

- Provide current or recent meteorological context
- Support exploratory overlays and future historical analysis where sourced

Requirements:

- Must include measurement timestamp, station or grid metadata, and units
- Must distinguish current readings from historical climate or weather summaries
- Must not be treated as permanent facility-siting evidence without appropriate historical reference data

## Raw Data Preservation

Ingestion jobs must preserve sanitized raw API responses or source files for reproducibility. Sanitization must remove credentials, request signatures, tokens, and other sensitive values before storage.

Raw data storage must be separate from normalized tables and derived analytical outputs.

## Ingestion Rules

- Every ingestion job must be idempotent.
- Ingestion must fail visibly when official data is unavailable.
- No ingestion path may silently substitute sample data for official data.
- Each run must record retrieval metadata and transformation version.
- Data quality checks should identify missing reference periods, unexpected geography gaps, duplicate records, invalid geometries, and coordinate reference system mismatches.

## Unverified Assumptions

These assumptions must be verified during source discovery:

- Suitable official datasets exist for all planned categories across Seoul, Incheon, and Gyeonggi-do.
- Waste-treatment facility records include enough location precision for spatial analysis.
- Waste statistics are comparable across the three administrative areas.
- Land-use and zoning data can be obtained with sufficient spatial resolution and licensing clarity.
- Real-time air-quality and weather APIs provide reliable timestamps and documented update intervals.

