"""Environmental-layer foundation (Suitability Phase 1A).

This package is the **inert foundation** for a future environmental suitability
phase. It declares the catalogue of environmental/physical layers the 후보지 분석
screen may later incorporate, and the abstract pipeline interfaces a future
Phase 1B ingestor/preprocessor would implement.

Phase 1A adds **no** scoring, **no** calculation, and **no** dataset import. The
registry here is a *catalogue* (metadata about future datasets), not data; every
layer carries an explicit :class:`LayerLifecycle` so a planned layer is never
presented as implemented. See ``docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md``
and ``docs/SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md``.
"""

from .interfaces import (
    EnvironmentalLayerPipeline,
    EnvironmentalLayerReport,
    PreprocessingPlan,
)
from .layers import (
    ENVIRONMENTAL_LAYER_REGISTRY,
    EnvironmentalLayerSpec,
    LayerLifecycle,
    LayerModality,
    ReadinessRecommendation,
    VerificationStatus,
    get_layer,
    layer_names,
    layers_by_lifecycle,
    registry_seed_rows,
)

__all__ = [
    "ENVIRONMENTAL_LAYER_REGISTRY",
    "EnvironmentalLayerPipeline",
    "EnvironmentalLayerReport",
    "EnvironmentalLayerSpec",
    "LayerLifecycle",
    "LayerModality",
    "PreprocessingPlan",
    "ReadinessRecommendation",
    "VerificationStatus",
    "get_layer",
    "layer_names",
    "layers_by_lifecycle",
    "registry_seed_rows",
]
