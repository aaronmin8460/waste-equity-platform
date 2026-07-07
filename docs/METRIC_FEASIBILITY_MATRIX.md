# Metric Feasibility Matrix

Classification definitions:

- `CONFIRMED_DIRECT`: directly available from an official source.
- `CONFIRMED_DERIVED`: calculable by combining official fields.
- `PROXY_ONLY`: only a defensible proxy is available.
- `UNVERIFIED`: official documentation is insufficient or live validation is still required.
- `UNAVAILABLE`: the necessary data is not publicly documented as available.

Classifications distinguish source feasibility from live validation. Phase 0.5 live-verified SGIS population and VWorld cadastral feature probes only; waste statistics, AirKorea, and KMA were not live-probed because credentials were missing.

| Platform input | Classification | Primary source family | Notes |
| --- | --- | --- | --- |
| Regional waste generation | UNVERIFIED | Resource Circulation Information System | Waste generation is documented at the statistics family level, but API field granularity, units, and Seoul/Incheon/Gyeonggi subregional coverage must be live-validated. |
| Regional waste treatment | UNVERIFIED | Resource Circulation Information System | Treatment statistics are documented, but accounting basis is not confirmed. |
| Incineration quantity | UNVERIFIED | Resource Circulation Information System | Treatment method detail is documented in annual file description; API field names and regional granularity remain unverified. |
| Landfill quantity | UNVERIFIED | Resource Circulation Information System | Same status as incineration. |
| Recycling quantity | UNVERIFIED | Resource Circulation Information System | Recycling performance is documented, but API fields and regional granularity remain unverified. |
| Treatment-facility locations | UNVERIFIED | Resource Circulation Information System | Annual file documentation mentions treatment-company status; exact location fields are not confirmed for the required API. |
| Treatment-facility capacity | UNVERIFIED | Resource Circulation Information System | Capacity fields are not confirmed in the required-source API documentation found. |
| Waste origin-to-destination movement | UNAVAILABLE | Resource Circulation Information System | No required-source documentation found for origin-to-destination flow. Do not infer movement. |
| Regional population | CONFIRMED_DIRECT | SGIS | Population endpoint exists by administrative code and reference year. Phase 0.5 live probe returned 25 Seoul district-level records for 2020. |
| Administrative boundaries | CONFIRMED_DIRECT | SGIS, VWorld | SGIS boundary GeoJSON endpoint exists; VWorld also provides boundary layers. Boundary endpoint remains live-unverified. |
| Population grids | UNVERIFIED | SGIS | SGIS provides population/geostatistical services, but the exact grid endpoint for this platform must be selected and validated. |
| Air-quality observations | CONFIRMED_DIRECT | AirKorea | Real-time station and city/province observations are documented. |
| Weather observations | CONFIRMED_DIRECT | KMA | Ultra-short observation endpoint is documented. |
| Wind speed | CONFIRMED_DIRECT | KMA | `WSD` is documented for ultra-short observations. |
| Wind direction | CONFIRMED_DERIVED | KMA | Wind vector components are documented; direct wind-direction category must be confirmed per endpoint or derived with documented formula. |
| Zoning | CONFIRMED_DIRECT | VWorld | Zoning/land-use district services and downloads are documented. Must verify feature-layer availability for each layer before screening use. |
| Cadastral parcels | CONFIRMED_DIRECT | VWorld | Continuous cadastral map API and SHP downloads are documented. Phase 0.5 live probe returned one Seoul cadastral feature. Not surveying-grade. |
| Public land ownership | CONFIRMED_DIRECT | VWorld | Land-ownership WMS/WFS/attribute service is officially listed through data.go.kr/VWorld; access and fields need live validation. |
| Protected areas | PROXY_ONLY | VWorld | VWorld lists park/protection-like layers. A legally complete protected-area model requires explicit layer selection and legal review. |
| Sensitive facilities such as schools and hospitals | UNVERIFIED | VWorld | VWorld lists some school-related layers, but schools/hospitals as sensitive facility points are not confirmed from the required sources. |
| Road accessibility | CONFIRMED_DERIVED | VWorld | Road centerline/road-name layers can support proximity or network proxies; true travel-time accessibility requires additional routing data or assumptions. |

## Proposed Initial Metrics

| Metric | Feasibility | Required warning |
| --- | --- | --- |
| Reported Treatment-to-Generation Imbalance Ratio | PROXY_ONLY | Does not prove waste movement, treatment responsibility, or facility burden. |
| Waste generation per capita | CONFIRMED_DERIVED after waste regional fields are verified | Requires aligned waste reference period, population reference year, and geography. |
| Existing treatment-facility proximity | UNVERIFIED | Requires verified facility locations and coordinate precision. |
| Air-quality current context | CONFIRMED_DIRECT | Real-time context only; not permanent siting evidence. |
| Wind-aware current context | CONFIRMED_DERIVED | Current/forecast context only; not permanent siting evidence. |
| Parcel/zoning exclusion screen | CONFIRMED_DERIVED | Requires explicit legal layers, dates, and geometry validity checks. |

## Metric Not Approved

`Treatment responsibility ratio = regional treatment quantity / regional generation quantity`

Status: not approved.

Reason: official documentation found in this audit does not establish that regional treatment quantity represents treatment of waste generated by the same region, physical facility throughput, or cross-region responsibility. Use `Reported Treatment-to-Generation Imbalance Ratio` with the warning above unless explicit source definitions or origin-to-destination flows are obtained.
