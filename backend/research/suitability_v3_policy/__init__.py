"""Policy-closure measurement for the Successor V3 baseline policy.

Read-only. Measures the *approved* production policy objects — the approved L2
land-cover registry, the candidate distance floors, and the approved weight
vector — against the real capital-region dataset, plus the alternatives each
decision was chosen over.

Unlike the Phase-3 and Phase-4 packages, this one deliberately imports the
**production** registry from
:mod:`waste_equity_backend.analysis.suitability.successor.land_conversion`
rather than a research stand-in, so what is measured is exactly what would run.
"""

from . import closure

__all__ = ["closure"]
