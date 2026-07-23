"""Empty environmental-layer ingestion framework (Suitability Phase 1A).

Scaffolding only. This package holds the env-backed configuration and the
abstract ingestion-job base that a future Phase 1B environmental-layer loader
will subclass. It performs **no** ingestion, reads **no** source files, and is
**not** wired into the runnable CLI in Phase 1A — importing it has no side
effects and running nothing here touches the database.

The actual per-layer loaders (DEM/slope, land cover, geology, …), their
``TRANSFORMATION_VERSION`` constants, and their CLI subcommands are Phase 1B.
See ``docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md`` and
``docs/SUITABILITY_ENVIRONMENTAL_ROADMAP.md``.
"""

from .base import EnvironmentalIngestionConfig, EnvironmentalIngestionJob

__all__ = [
    "EnvironmentalIngestionConfig",
    "EnvironmentalIngestionJob",
]
