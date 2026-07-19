"""User-defined weight *scenario* domain logic (Phase 6).

A user-weight scenario is a **temporary decision-support experiment**: it takes
the four frozen component scores (zoning / road / equity / demand) of one fixed,
already-succeeded :class:`SuitabilityAnalysisRun` and *recombines* them under a
user-supplied weight vector, on read, without ever writing to the database.

It is emphatically **not**:

* an official suitability profile (``baseline``/``equal``/``equity_focused``/
  ``access_focused``/``critic`` are the only stored profiles),
* an analytical run (nothing is persisted to ``suitability_analysis_runs`` or
  ``suitability_candidates``),
* part of CRITIC derivation or stored stability classification,
* a legal, engineering, environmental-review, permitting, or final-siting result.

Because it only *reweights frozen stored scores*, it introduces **no new stored
derivation** and therefore its own method version — :data:`USER_WEIGHT_SCENARIO_METHOD_VERSION`
— is independent of and does **not** bump ``suitability-policy-v2``,
``suitability-screening-v3``, ``critic-weights-v1``, ``suitability-stability-v1``,
or ``capital-grid-500m-v1``.

Everything here is pure and independently testable: parsing, validation,
quantization, canonical serialization, the exact score/provisional formulas, the
deterministic scenario hash, and the rank-delta convention. The scoring math
reuses :mod:`policy` (``composite`` / ``provisional_composite`` /
``quantize_score``) so the Python helper, the preview SQL, the candidate-detail
SQL, and the MVT SQL all agree byte-for-byte on the same 0–100, 4-dp, ROUND_HALF_EVEN
scale. See ``docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from typing import Any

from . import policy

# --------------------------------------------------------------------------- #
# Method version (independent of stored-run derivation versions)
# --------------------------------------------------------------------------- #

# A user scenario reweights *frozen stored scores* on read. It changes no stored
# run derivation or candidate classification, so it carries its own, separate
# method version and never increments the run/policy/critic/stability/grid
# versions. Bumping this only signals a change to the *scenario recombination
# contract itself* (weight model, hashing payload, or scoring/quantization).
USER_WEIGHT_SCENARIO_METHOD_VERSION = "user-weight-scenario-v1"

# Fixed criterion order for every scenario weight vector, hash payload, and
# serialization (identical to policy.COMPONENTS / critic.CRITERION_ORDER).
COMPONENT_ORDER: tuple[str, ...] = policy.COMPONENTS

# Canonical scenario-weight precision: 8 decimal places (matches the CRITIC
# vector precision so a CRITIC preset round-trips exactly).
WEIGHT_QUANT = Decimal("0.00000001")  # 8 dp
_ZERO = Decimal("0")
_ONE = Decimal("1")
_CANONICAL_ONE = Decimal("1.00000000")

# Structured error code surfaced as a 422 by the API layer.
INVALID_SCENARIO_WEIGHTS = "INVALID_SCENARIO_WEIGHTS"

# Citizen-facing scenario label + disclaimer (kept here so backend responses and
# the docs share one source of truth; the frontend mirrors these strings).
SCENARIO_LABEL_KO = "사용자 가정 기반 시나리오"
SCENARIO_DISCLAIMER_KO = (
    "사용자가 입력한 가중치로 기존 분석 실행의 Z/R/E/D 구성점수를 재결합한 임시 비교 "
    "결과입니다. 공식 분석 실행, 전문가 판단, 법적 적격성, 인허가 가능성 또는 최종 입지 "
    "결정을 의미하지 않습니다."
)


class ScenarioWeightError(ValueError):
    """Invalid user scenario weights.

    ``error`` is a stable machine code (``INVALID_SCENARIO_WEIGHTS``); ``detail``
    is a human-readable message; ``fields`` carries structured context (e.g. the
    offending canonical ``sum``). The API layer maps this to a 422 body::

        {"error": ..., "detail": ..., "fields": {...}}

    Invalid weights are **never** silently normalized, replaced with equal
    weights, or have a remainder redistributed — the caller is always informed.
    """

    error = INVALID_SCENARIO_WEIGHTS

    def __init__(self, detail: str, fields: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.fields = fields or {}

    def as_envelope(self) -> dict[str, Any]:
        return {"error": self.error, "detail": self.detail, "fields": self.fields}


def _parse_one(component: str, raw: Any) -> Decimal:
    """Parse a single weight to an exact finite Decimal (never binary float).

    Strings are preferred and parsed with :class:`Decimal` directly. A ``float``
    is rejected: JSON binary floating-point must not silently enter the canonical
    weight math. NaN / Infinity / malformed input raise
    :class:`ScenarioWeightError`.
    """

    if isinstance(raw, bool):  # bool is an int subclass; never a weight
        raise ScenarioWeightError(
            f"Weight '{component}' must be a decimal string, not a boolean.",
            {"component": component},
        )
    if isinstance(raw, float):
        raise ScenarioWeightError(
            f"Weight '{component}' must be a decimal string, not a binary float "
            "(floating-point values are not accepted for canonical weights).",
            {"component": component},
        )
    if isinstance(raw, Decimal):
        value = raw
    elif isinstance(raw, int):
        value = Decimal(raw)
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            raise ScenarioWeightError(f"Weight '{component}' is empty.", {"component": component})
        try:
            value = Decimal(text)
        except InvalidOperation as exc:
            raise ScenarioWeightError(
                f"Weight '{component}' is not a valid decimal: {raw!r}.",
                {"component": component},
            ) from exc
    else:
        raise ScenarioWeightError(
            f"Weight '{component}' must be a decimal string.", {"component": component}
        )
    if value.is_nan() or value.is_infinite():
        raise ScenarioWeightError(
            f"Weight '{component}' must be finite (got {raw!r}).", {"component": component}
        )
    return value


def parse_and_validate_weights(raw: Mapping[str, Any]) -> dict[str, Decimal]:
    """Validate a raw weight mapping and return canonical 8-dp Decimal weights.

    Enforces, with no silent repair:

    * exactly the four required keys (``zoning``/``road``/``equity``/``demand``),
      no unknown keys;
    * each value a finite decimal in ``[0, 1]`` inclusive (zero allowed);
    * not all zero;
    * the canonical (8-dp-quantized) sum equals exactly ``Decimal("1.00000000")``.

    Raises :class:`ScenarioWeightError` (→ 422) otherwise. Prefer passing decimal
    strings; floats are rejected upstream in :func:`_parse_one`.
    """

    if not isinstance(raw, Mapping):
        raise ScenarioWeightError("Scenario weights must be an object of four components.")
    keys = set(raw)
    expected = set(COMPONENT_ORDER)
    missing = expected - keys
    unknown = keys - expected
    if missing:
        raise ScenarioWeightError(
            "Scenario weights must include exactly zoning, road, equity, demand.",
            {"missing": sorted(missing)},
        )
    if unknown:
        raise ScenarioWeightError(
            "Scenario weights contain unknown components.",
            {"unknown": sorted(unknown)},
        )

    parsed = {c: _parse_one(c, raw[c]) for c in COMPONENT_ORDER}
    for c, value in parsed.items():
        if value < _ZERO or value > _ONE:
            raise ScenarioWeightError(
                f"Weight '{c}' must be between 0 and 1 inclusive (got {value}).",
                {"component": c, "value": format(value, "f")},
            )

    canonical = {
        c: parsed[c].quantize(WEIGHT_QUANT, rounding=ROUND_HALF_EVEN) for c in COMPONENT_ORDER
    }

    if all(v == _ZERO for v in canonical.values()):
        raise ScenarioWeightError(
            "Scenario weights cannot all be zero.",
            {"sum": format(_ZERO.quantize(WEIGHT_QUANT), "f")},
        )

    total = sum(canonical.values(), start=_ZERO)
    if total != _CANONICAL_ONE:
        raise ScenarioWeightError(
            "Scenario weights must sum exactly to 1.00000000.",
            {"sum": format(total, "f")},
        )
    return canonical


def canonical_weight_strings(weights: Mapping[str, Decimal]) -> dict[str, str]:
    """Fixed-point 8-dp strings in fixed criterion order (never exponent form)."""

    return {
        c: format(weights[c].quantize(WEIGHT_QUANT, rounding=ROUND_HALF_EVEN), "f")
        for c in COMPONENT_ORDER
    }


def scenario_score(
    component_scores: Mapping[str, Decimal], weights: Mapping[str, Decimal]
) -> Decimal:
    """Exact custom composite for an ELIGIBLE candidate (all four components present).

    ``custom_score = Σ component_score · weight``, on the 0–100 scale, quantized to
    4 dp with ROUND_HALF_EVEN — identical to :func:`policy.composite`, so it matches
    every stored-composite score and the SQL scoring paths exactly.
    """

    return policy.composite(dict(component_scores), dict(weights))


def scenario_provisional_score(
    component_scores: Mapping[str, Decimal], weights: Mapping[str, Decimal]
) -> Decimal | None:
    """Provisional custom composite for a REVIEW_REQUIRED candidate.

    Renormalizes over the components actually present (missing components are
    never zero-filled). Returns ``None`` when no component is present or the total
    weight of the present components is zero. Identical semantics to
    :func:`policy.provisional_composite`.
    """

    return policy.provisional_composite(dict(component_scores), dict(weights))


# --------------------------------------------------------------------------- #
# Deterministic scenario identity
# --------------------------------------------------------------------------- #


def canonical_hash_payload(run_id: int, weights: Mapping[str, Decimal]) -> str:
    """The exact UTF-8 string that is SHA-256'd for the scenario hash.

    Fixed key order (``method_version``, ``run_id``, ``weights`` in criterion
    order), compact separators, no whitespace. Excludes selected candidate,
    top_n, viewport, comparison profile, timestamps, and any frontend label — so
    only ``(method_version, run_id, canonical weights)`` determine the identity.
    """

    payload = {
        "method_version": USER_WEIGHT_SCENARIO_METHOD_VERSION,
        "run_id": int(run_id),
        "weights": canonical_weight_strings(weights),
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def scenario_hash(run_id: int, weights: Mapping[str, Decimal]) -> str:
    """Deterministic SHA-256 (full 64-hex) identity of a scenario.

    Same run + same canonical weights → same hash; a different run id or any
    different weight → a different hash. The comparison profile never affects it.
    This is a *temporary analytical identity*, not a database id.
    """

    return hashlib.sha256(canonical_hash_payload(run_id, weights).encode("utf-8")).hexdigest()


def short_scenario_hash(full_hash: str, length: int = 12) -> str:
    """A documented collision-resistant display prefix of the full hash.

    12 hex chars = 48 bits; used only for compact display. The full hash remains
    available and is what the MVT endpoint validates against.
    """

    return full_hash[:length]


# --------------------------------------------------------------------------- #
# Rank-delta convention
# --------------------------------------------------------------------------- #

RANK_UP = "up"
RANK_DOWN = "down"
RANK_SAME = "same"


def rank_delta(comparison_rank: int | None, custom_rank: int | None) -> int | None:
    """``rank_delta = comparison_profile_rank − custom_rank``.

    Positive → the candidate moved *up* under the custom scenario (better/lower
    rank number); zero → unchanged; negative → moved *down*. ``None`` when either
    rank is unavailable (e.g. a REVIEW_REQUIRED/EXCLUDED candidate has no rank).
    """

    if comparison_rank is None or custom_rank is None:
        return None
    return comparison_rank - custom_rank


def rank_change_direction(delta: int | None) -> str | None:
    """Text direction for a rank delta (never color-only): up / same / down."""

    if delta is None:
        return None
    if delta > 0:
        return RANK_UP
    if delta < 0:
        return RANK_DOWN
    return RANK_SAME
