"""SQLAlchemy models for the core metadata schema."""

from .base import Base
from .environmental import (
    EnvironmentalDatasetVersion,
    EnvironmentalLandCoverCellClassArea,
    EnvironmentalLandCoverCellStatistic,
    EnvironmentalLandCoverCellStatVersion,
    EnvironmentalLandCoverFeature,
    EnvironmentalLandCoverMapSheet,
    EnvironmentalLayerRegistry,
    EnvironmentalWetlandInventoryFeature,
)
from .facilities import WasteTreatmentFacility
from .facility_cost import FacilityStandardCost
from .landfill_inbound import LandfillInboundMonthly
from .metadata import DatasetFreshness, DataSource, IngestionRun, RawApiResponse, RegionalPopulation
from .municipal_cost import (
    MunicipalCostGeography,
    MunicipalCostGeographyComponent,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteContract,
    MunicipalWasteQuantity,
)
from .regions import Region, RegionCodeMap
from .reporting_geography import (
    ReportingRegionWasteStatistics,
    WasteReportingRegion,
    WasteReportingRegionMember,
)
from .structural import (
    StructuralDatasetVersion,
    StructuralFeature,
    StructuralLineFeature,
    StructuralProtectedFeature,
)
from .suitability import SuitabilityAnalysisRun, SuitabilityCandidate
from .waste import RegionalWasteStatistics

__all__ = [
    "Base",
    "DataSource",
    "DatasetFreshness",
    "EnvironmentalDatasetVersion",
    "EnvironmentalLandCoverCellClassArea",
    "EnvironmentalLandCoverCellStatVersion",
    "EnvironmentalLandCoverCellStatistic",
    "EnvironmentalLandCoverFeature",
    "EnvironmentalLandCoverMapSheet",
    "EnvironmentalLayerRegistry",
    "EnvironmentalWetlandInventoryFeature",
    "FacilityStandardCost",
    "IngestionRun",
    "LandfillInboundMonthly",
    "MunicipalCostGeography",
    "MunicipalCostGeographyComponent",
    "MunicipalCostIndicatorValue",
    "MunicipalCostSourceFile",
    "MunicipalWasteContract",
    "MunicipalWasteQuantity",
    "RawApiResponse",
    "Region",
    "RegionCodeMap",
    "RegionalPopulation",
    "RegionalWasteStatistics",
    "ReportingRegionWasteStatistics",
    "StructuralDatasetVersion",
    "StructuralFeature",
    "StructuralLineFeature",
    "StructuralProtectedFeature",
    "SuitabilityAnalysisRun",
    "SuitabilityCandidate",
    "WasteReportingRegion",
    "WasteReportingRegionMember",
    "WasteTreatmentFacility",
]
