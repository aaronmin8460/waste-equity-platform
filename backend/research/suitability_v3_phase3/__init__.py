"""Phase-3 real-data validation research for the Suitability Successor model.

RESEARCH / EVIDENCE ONLY. Nothing in this package is production runtime source:
it is not imported by the API, the analysis engine, or any migration, and it
neither activates the successor model nor writes any successor value.

It exists to answer one question with measurements rather than assumptions —
*what do the four proposed successor components actually do on the real capital
region dataset?* — so that a later, explicit policy gate has evidence to decide
against.
"""

from __future__ import annotations

__all__ = [
    "critic_research",
    "extract",
    "registry",
    "stats",
    "validate",
]
