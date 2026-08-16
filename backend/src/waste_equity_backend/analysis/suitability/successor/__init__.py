"""Successor suitability model — backend foundation (additive, version-aware).

The historical screen scores ``zoning`` / ``road`` / ``equity`` / ``demand`` and
keeps every one of those meanings, columns, weights, profiles, ranks, CRITIC
vectors, stability classes, and stored runs exactly as they are. This package adds
a **separate, disjoint** component namespace for a successor model:

``existing_burden`` · ``air_impact_proxy`` · ``resident_impact`` · ``land_conversion``

Status: **foundation only.** Every component is implemented, typed, and tested,
but the model is not activated — there is no successor policy version, no approved
weight vector, no persisted successor score, and no API surface. See
:func:`.policy.assert_activated` and :data:`.policy.ACTIVATION_BLOCKERS` for the
open dependencies and who owns them.

See ``docs/SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md``.
"""

from .contract import (
    COMPONENT_AIR_IMPACT_PROXY,
    COMPONENT_CONTRACT_VERSION,
    COMPONENT_EXISTING_BURDEN,
    COMPONENT_LAND_CONVERSION,
    COMPONENT_RESIDENT_IMPACT,
    HIGHER_RAW_IS_BETTER,
    LOWER_RAW_IS_BETTER,
    SUCCESSOR_COMPONENTS,
    ComponentObservation,
    ComponentSeries,
)
from .policy import (
    ACTIVATION_BLOCKERS,
    SUCCESSOR_MODEL_ID,
    CrossModelReuseError,
    SuccessorActivationBlockedError,
    assert_activated,
    classify_component_set,
    is_activated,
    successor_snapshot,
)

__all__ = [
    "ACTIVATION_BLOCKERS",
    "COMPONENT_AIR_IMPACT_PROXY",
    "COMPONENT_CONTRACT_VERSION",
    "COMPONENT_EXISTING_BURDEN",
    "COMPONENT_LAND_CONVERSION",
    "COMPONENT_RESIDENT_IMPACT",
    "HIGHER_RAW_IS_BETTER",
    "LOWER_RAW_IS_BETTER",
    "SUCCESSOR_COMPONENTS",
    "SUCCESSOR_MODEL_ID",
    "ComponentObservation",
    "ComponentSeries",
    "CrossModelReuseError",
    "SuccessorActivationBlockedError",
    "assert_activated",
    "classify_component_set",
    "is_activated",
    "successor_snapshot",
]
