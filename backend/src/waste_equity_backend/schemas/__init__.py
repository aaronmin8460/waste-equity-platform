"""Pydantic response schemas."""

from .datasets import (
    DatasetEnvelope,
    FacilityOut,
    PopulationOut,
    RegionBoundaryCollection,
    RegionBoundaryFeature,
    RegionBoundaryProperties,
    RegionOut,
    UnavailableDataError,
    WasteStatisticsOut,
)
from .equity import (
    EquityEnvelope,
    ExcludedBurdenRegion,
    ExcludedRegion,
    FacilityBurdenEnvelope,
    FacilityBurdenOut,
    WastePerCapitaOut,
)
from .metadata import DataFreshnessOut, DataSourceOut, HealthOut, IngestionRunOut
from .suitability import (
    CandidateDetailOut,
    CandidateFeature,
    CandidateProperties,
    SuitabilityCandidateCollection,
    SuitabilityPolicyOut,
    SuitabilityRunListEnvelope,
    SuitabilityRunOut,
    SuitabilitySummaryOut,
)

__all__ = [
    "CandidateDetailOut",
    "CandidateFeature",
    "CandidateProperties",
    "DataFreshnessOut",
    "DataSourceOut",
    "DatasetEnvelope",
    "EquityEnvelope",
    "ExcludedBurdenRegion",
    "ExcludedRegion",
    "FacilityBurdenEnvelope",
    "FacilityBurdenOut",
    "FacilityOut",
    "HealthOut",
    "IngestionRunOut",
    "PopulationOut",
    "RegionBoundaryCollection",
    "RegionBoundaryFeature",
    "RegionBoundaryProperties",
    "RegionOut",
    "SuitabilityCandidateCollection",
    "SuitabilityPolicyOut",
    "SuitabilityRunListEnvelope",
    "SuitabilityRunOut",
    "SuitabilitySummaryOut",
    "UnavailableDataError",
    "WastePerCapitaOut",
    "WasteStatisticsOut",
]
