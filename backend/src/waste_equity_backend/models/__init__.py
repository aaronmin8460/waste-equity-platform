"""SQLAlchemy models for the core metadata schema."""

from .base import Base
from .facilities import WasteTreatmentFacility
from .metadata import DatasetFreshness, DataSource, IngestionRun, RawApiResponse, RegionalPopulation
from .regions import Region, RegionCodeMap
from .structural import (
    StructuralDatasetVersion,
    StructuralFeature,
    StructuralLineFeature,
    StructuralProtectedFeature,
)
from .waste import RegionalWasteStatistics

__all__ = [
    "Base",
    "DataSource",
    "DatasetFreshness",
    "IngestionRun",
    "RawApiResponse",
    "Region",
    "RegionCodeMap",
    "RegionalPopulation",
    "RegionalWasteStatistics",
    "StructuralDatasetVersion",
    "StructuralFeature",
    "StructuralLineFeature",
    "StructuralProtectedFeature",
    "WasteTreatmentFacility",
]
