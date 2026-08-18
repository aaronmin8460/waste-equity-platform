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
from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from typing import Any

from . import component_model, policy

# --------------------------------------------------------------------------- #
# Method version (independent of stored-run derivation versions)
# --------------------------------------------------------------------------- #

# A user scenario reweights *frozen stored scores* on read. It changes no stored
# run derivation or candidate classification, so it carries its own, separate
# method version and never increments the run/policy/critic/stability/grid
# versions. Bumping this only signals a change to the *scenario recombination
# contract itself* (weight model, hashing payload, or scoring/quantization).
#
# Deliberately NOT bumped by making weight validation run-model-relative. For every
# run that can exist today the rule resolves to exactly the historical four keys, so
# no producible scenario's weight model, hash payload, or quantization has changed,
# and every stored scenario hash stays byte-identical. The bump to
# ``user-weight-scenario-v2`` — together with adding the component model to
# :func:`canonical_hash_payload` so a successor scenario hash can never collide with
# a historical one — is required at the moment successor scenarios become
# producible, i.e. when the successor run write path and an approved successor
# weight vector land. Until then a bump would change every existing hash for a
# contract change that has not actually happened.
USER_WEIGHT_SCENARIO_METHOD_VERSION = "user-weight-scenario-v1"

# Fixed criterion order for the *historical* scenario weight vector, hash payload,
# and serialization (identical to policy.COMPONENTS / critic.CRITERION_ORDER). It is
# the default for every function below; a run of another component model supplies
# its own ``component_order``, which is why none of them read this constant when an
# order is passed in.
COMPONENT_ORDER: tuple[str, ...] = policy.COMPONENTS

# Canonical scenario-weight precision: 8 decimal places (matches the CRITIC
# vector precision so a CRITIC preset round-trips exactly).
WEIGHT_QUANT = Decimal("0.00000001")  # 8 dp
_ZERO = Decimal("0")
_ONE = Decimal("1")
_CANONICAL_ONE = Decimal("1.00000000")

# Structured error code surfaced as a 422 by the API layer.
INVALID_SCENARIO_WEIGHTS = "INVALID_SCENARIO_WEIGHTS"

# A weight vector that is well-formed for a *different* component model gets its own
# code, deliberately distinct from INVALID_SCENARIO_WEIGHTS, because the remedy is
# completely different: malformed weights are a correctable input error, whereas a
# model mismatch means this scenario cannot be applied to this run at all. Collapsing
# the two would push a client toward "fix your weights", which is the wrong
# instruction and nudges precisely toward remapping one model's weights onto
# another's components.
COMPONENT_MODEL_MISMATCH = component_model.COMPONENT_MODEL_MISMATCH

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


class ScenarioComponentModelMismatchError(ScenarioWeightError):
    """Well-formed weights for one component model, submitted against another's run.

    A subclass of :class:`ScenarioWeightError` so every existing ``except`` clause
    still catches it and still produces a 422, but with its own stable ``error``
    code so a client can present "this scenario belongs to a different analytical
    model" instead of "your weights are wrong". The scenario is not broken — it is
    valid for a different model, and remains fully usable against a run of that
    model.
    """

    error = COMPONENT_MODEL_MISMATCH


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


def parse_and_validate_weights(
    raw: Mapping[str, Any], components: Sequence[str] | None = None
) -> dict[str, Decimal]:
    """Validate a raw weight mapping and return canonical 8-dp Decimal weights.

    ``components`` is the component order the weights must be defined over — pass
    the *resolved run's* ``component_order`` so validation is run-model-relative
    rather than relative to a module constant. It defaults to the historical
    :data:`COMPONENT_ORDER`, which is what every existing caller already meant.

    Enforces, with no silent repair:

    * exactly the model's component keys, no missing and no unknown keys;
    * each value a finite decimal in ``[0, 1]`` inclusive (zero allowed);
    * not all zero;
    * the canonical (8-dp-quantized) sum equals exactly ``Decimal("1.00000000")``.

    Strictness here is the load-bearing safety property of the whole scenario path:
    it is the only thing standing between a saved weight vector and a silent
    cross-model recombination. It must never be loosened to "accept any subset and
    renormalize".

    A key set that is *exactly another known component model's* components raises
    :class:`ScenarioComponentModelMismatchError` (a ``ScenarioWeightError`` subclass
    carrying the distinct ``COMPONENT_MODEL_MISMATCH`` code), so a client can tell
    "this scenario belongs to a different analytical model" apart from "your weights
    are malformed". Anything else raises :class:`ScenarioWeightError` (→ 422) as
    before. Prefer passing decimal strings; floats are rejected upstream in
    :func:`_parse_one`.
    """

    order = tuple(COMPONENT_ORDER if components is None else components)
    if not isinstance(raw, Mapping):
        raise ScenarioWeightError(
            f"Scenario weights must be an object of {len(order)} components."
        )
    keys = set(raw)
    expected = set(order)
    missing = expected - keys
    unknown = keys - expected
    if missing or unknown:
        # Well-formed weights for a different component model are refused with a
        # distinct code and are NEVER translated: the components are different
        # measured quantities with different derivations, resolutions, and
        # directions, and a positional or name-similarity mapping would carry a
        # justification written about one quantity onto another.
        submitted_model = component_model.classify_weight_components(raw)
        if submitted_model is not None:
            raise ScenarioComponentModelMismatchError(
                "These scenario weights are defined over the components of "
                f"{submitted_model!r} ({sorted(keys)}) and cannot be applied to a run "
                f"whose components are {list(order)}. A scenario is only valid against "
                "a run of its own component model; weights are never remapped between "
                "models.",
                {
                    "submitted_component_model": submitted_model,
                    "submitted_components": sorted(keys),
                    "run_component_order": list(order),
                },
            )
    if missing:
        raise ScenarioWeightError(
            "Scenario weights must include exactly " + ", ".join(order) + ".",
            {"missing": sorted(missing), "expected": list(order)},
        )
    if unknown:
        raise ScenarioWeightError(
            "Scenario weights contain unknown components.",
            {"unknown": sorted(unknown), "expected": list(order)},
        )

    parsed = {c: _parse_one(c, raw[c]) for c in order}
    for c, value in parsed.items():
        if value < _ZERO or value > _ONE:
            raise ScenarioWeightError(
                f"Weight '{c}' must be between 0 and 1 inclusive (got {value}).",
                {"component": c, "value": format(value, "f")},
            )

    canonical = {c: parsed[c].quantize(WEIGHT_QUANT, rounding=ROUND_HALF_EVEN) for c in order}

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


def canonical_weight_strings(
    weights: Mapping[str, Decimal], components: Sequence[str] | None = None
) -> dict[str, str]:
    """Fixed-point 8-dp strings in fixed criterion order (never exponent form).

    ``components`` defaults to the historical :data:`COMPONENT_ORDER`; pass the
    run's ``component_order`` for any other model. Order is explicit rather than
    taken from the mapping's key order, because key order is not a stable property
    of anything that round-trips through JSON.
    """

    order = COMPONENT_ORDER if components is None else components
    return {
        c: format(weights[c].quantize(WEIGHT_QUANT, rounding=ROUND_HALF_EVEN), "f") for c in order
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


def canonical_hash_payload(
    run_id: int, weights: Mapping[str, Decimal], components: Sequence[str] | None = None
) -> str:
    """The exact UTF-8 string that is SHA-256'd for the scenario hash.

    Fixed key order (``method_version``, ``run_id``, ``weights`` in criterion
    order), compact separators, no whitespace. Excludes selected candidate,
    top_n, viewport, comparison profile, timestamps, and any frontend label — so
    only ``(method_version, run_id, canonical weights)`` determine the identity.

    ``components`` defaults to the historical :data:`COMPONENT_ORDER`, exactly as
    :func:`canonical_weight_strings` does, so a historical scenario's payload — and
    therefore its hash — is byte-identical to what it has always been. Pass the
    run's ``component_order`` for any other model: without it a successor scenario's
    weights would be looked up under historical component names it does not carry.
    """

    payload = {
        "method_version": USER_WEIGHT_SCENARIO_METHOD_VERSION,
        "run_id": int(run_id),
        "weights": canonical_weight_strings(weights, components),
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def scenario_hash(
    run_id: int, weights: Mapping[str, Decimal], components: Sequence[str] | None = None
) -> str:
    """Deterministic SHA-256 (full 64-hex) identity of a scenario.

    Same run + same canonical weights → same hash; a different run id or any
    different weight → a different hash. The comparison profile never affects it.
    This is a *temporary analytical identity*, not a database id.

    ``components`` carries the run's component order for a non-historical model
    (see :func:`canonical_hash_payload`); omitted, the historical order is used and
    a historical scenario keeps the hash it has always had.
    """

    return hashlib.sha256(
        canonical_hash_payload(run_id, weights, components).encode("utf-8")
    ).hexdigest()


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
