"""Component-model identity for suitability runs — the version-aware boundary.

A stored suitability run must be able to answer, without consulting the source
code that happens to be deployed, **"which component model produced this run?"**.
Neither ``policy_version`` nor ``derivation_version`` can answer it: both have
already moved for reasons unrelated to component identity (the v1 → v2 policy bump
was the CRITIC/stability output surface, while the component-score formulas stayed
byte-for-byte unchanged), and ``candidate_grid_version`` describes geometry. So
component identity gets its own identifier, and component **order** travels with
it — order is load-bearing for the CRITIC correlation matrix, the scenario hash
payload, and every export column sequence, and it is *not* recoverable from a JSON
object's key order.

This module is the single backend source of truth for that boundary:

* which component models exist, and in which order their components are enumerated;
* which storage representation is authoritative for each model;
* the guards that make it impossible to serve one model's numbers under another
  model's names, or to attach one model's CRITIC/stability output to another's run.

**Two representations, never merged.**

===================  ==========================================  ===================
model                authoritative candidate storage             ``component_scores``
===================  ==========================================  ===================
``zred-v1``          the four legacy ``*_score`` columns          ``{}``
successor (+future)  the ``component_scores`` JSON map            the scores
===================  ==========================================  ===================

A historical candidate row is never rewritten, never copied into
``component_scores``, and never re-derived: a second copy of an authoritative
analytical value can drift from the first, and the wire contract mirrors storage
exactly so "``component_scores`` is populated" means "this is not the legacy
model" rather than "someone duplicated the legacy columns for symmetry".

Nothing here activates the successor model. ``successor.policy.assert_activated``
still fails, no successor policy version exists, and no successor run can be
produced by this module. See ``docs/SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md``
and ``docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from . import policy

# --------------------------------------------------------------------------- #
# Identity
# --------------------------------------------------------------------------- #

# The successor identifiers are written out here rather than imported from
# ``successor.policy``, for the same reason ``critic.CRITERION_ORDER`` is a literal:
# this module has to be importable from ``models`` and from ``scenario``, and
# ``successor.policy`` imports ``scenario``, so the reverse import is a cycle.
# ``test_suitability_component_model.py`` asserts these are equal to the successor
# foundation's constants (and to the migration's literals), which catches the drift
# without restructuring the foundation.
COMPONENT_MODEL_HISTORICAL: str = "suitability-components-zred-v1"
COMPONENT_MODEL_SUCCESSOR: str = "suitability-components-successor-v1"

COMPONENT_ORDER_HISTORICAL: tuple[str, ...] = tuple(policy.COMPONENTS)
COMPONENT_ORDER_SUCCESSOR: tuple[str, ...] = (
    "existing_burden",
    "air_impact_proxy",
    "resident_impact",
    "land_conversion",
)

# Every component model the backend can persist, serve, or validate against.
COMPONENT_ORDERS: dict[str, tuple[str, ...]] = {
    COMPONENT_MODEL_HISTORICAL: COMPONENT_ORDER_HISTORICAL,
    COMPONENT_MODEL_SUCCESSOR: COMPONENT_ORDER_SUCCESSOR,
}

KNOWN_COMPONENT_MODELS: tuple[str, ...] = (
    COMPONENT_MODEL_HISTORICAL,
    COMPONENT_MODEL_SUCCESSOR,
)

# The candidate storage representation each model's component scores live in.
STORAGE_LEGACY_COLUMNS = "LEGACY_SCORE_COLUMNS"
STORAGE_COMPONENT_SCORES = "COMPONENT_SCORES_MAP"

COMPONENT_STORAGE: dict[str, str] = {
    COMPONENT_MODEL_HISTORICAL: STORAGE_LEGACY_COLUMNS,
    COMPONENT_MODEL_SUCCESSOR: STORAGE_COMPONENT_SCORES,
}

# --------------------------------------------------------------------------- #
# Default-run resolution
# --------------------------------------------------------------------------- #

# Which component model an unpinned request resolves against.
#
# This is deliberately the *historical* model, and it is a status-quo lock rather
# than a product default for the successor model. Before this constant existed,
# ``_resolve_run_id`` returned the latest succeeded run regardless of component
# model, so the first successful successor run would silently switch every default
# view and every un-pinned shared link to a different analytical model with no
# user-visible signal. Pinning the default to the model every existing run already
# uses preserves today's behaviour byte-for-byte while making the switchover a
# single, explicit, reviewable change.
#
# Changing this value IS the rollout decision recorded as
# ``SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED``; it is owned by the product owner
# and must not be flipped as a side effect of any other work.
DEFAULT_COMPONENT_MODEL: str = COMPONENT_MODEL_HISTORICAL

# --------------------------------------------------------------------------- #
# Structured error codes (surfaced by the API layer)
# --------------------------------------------------------------------------- #

# The caller named a component model the backend does not know.
UNKNOWN_COMPONENT_MODEL = "UNKNOWN_COMPONENT_MODEL"
# The caller's request mixes two component models (e.g. historical weights against
# a successor run). Deliberately DISTINCT from INVALID_SCENARIO_WEIGHTS: malformed
# weights are a correctable input error, whereas a model mismatch means this
# artifact cannot be applied to this run at all, and telling the user to "fix your
# weights" would nudge them toward remapping across models.
COMPONENT_MODEL_MISMATCH = "COMPONENT_MODEL_MISMATCH"
# A stored row's own model identity is internally inconsistent (integrity failure).
COMPONENT_MODEL_INCONSISTENT_RUN = "COMPONENT_MODEL_INCONSISTENT_RUN"


# Rows reach these accessors as SQLAlchemy ``RowMapping`` objects, whose key type is
# not narrowed to ``str`` (a row can also be keyed by Column or label objects), as
# plain dicts in tests, or as an ORM object's attribute mapping. Every access below
# uses a string literal, so the wide key type costs nothing and avoids forcing a cast
# at each of the eight call sites.
RowLike = Mapping[Any, Any]


class UnknownComponentModelError(ValueError):
    """A component-model identifier that is not in the registry."""

    error = UNKNOWN_COMPONENT_MODEL

    def __init__(self, received: Any) -> None:
        super().__init__(
            f"Unknown component model {received!r}; known models: {list(KNOWN_COMPONENT_MODELS)}."
        )
        self.detail = str(self)
        self.fields: dict[str, Any] = {
            "received": received,
            "known": list(KNOWN_COMPONENT_MODELS),
        }

    def as_envelope(self) -> dict[str, Any]:
        return {"error": self.error, "detail": self.detail, "fields": self.fields}


class ComponentModelMismatchError(ValueError):
    """An artifact of one component model was applied to another model's run.

    Never repaired, renormalized, or positionally remapped: there is no defensible
    mapping from one component model's named quantities onto another's.
    """

    error = COMPONENT_MODEL_MISMATCH

    def __init__(self, detail: str, fields: Mapping[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.fields = dict(fields or {})

    def as_envelope(self) -> dict[str, Any]:
        return {"error": self.error, "detail": self.detail, "fields": self.fields}


# --------------------------------------------------------------------------- #
# Registry lookups
# --------------------------------------------------------------------------- #


def is_known_component_model(version: Any) -> bool:
    """True when ``version`` is a registered component-model identifier."""

    return isinstance(version, str) and version in COMPONENT_ORDERS


def component_order_for(version: str) -> tuple[str, ...]:
    """The registered component order for a component model.

    Raises :class:`UnknownComponentModelError` rather than guessing an order — an
    unknown model has no defensible component sequence, and inventing one is how a
    successor score ends up under a historical label.
    """

    try:
        return COMPONENT_ORDERS[version]
    except (KeyError, TypeError) as exc:
        raise UnknownComponentModelError(version) from exc


def storage_for(version: str) -> str:
    """Which candidate storage representation is authoritative for this model."""

    if version not in COMPONENT_STORAGE:
        raise UnknownComponentModelError(version)
    return COMPONENT_STORAGE[version]


def uses_legacy_score_columns(version: str) -> bool:
    """True when this model's component scores live in the four legacy columns."""

    return storage_for(version) == STORAGE_LEGACY_COLUMNS


def resolve_requested_component_model(requested: str | None) -> str:
    """Resolve an optional caller-supplied component-model selector.

    ``None`` → :data:`DEFAULT_COMPONENT_MODEL`, which preserves today's behaviour
    for every existing client. An unknown value raises rather than falling back to
    the default: silently serving the default model for a model the caller asked
    for by name would answer a different question than the one asked.
    """

    if requested is None:
        return DEFAULT_COMPONENT_MODEL
    if not is_known_component_model(requested):
        raise UnknownComponentModelError(requested)
    return requested


# --------------------------------------------------------------------------- #
# Stored-run identity
# --------------------------------------------------------------------------- #


def decode_json_value(value: Any) -> Any:
    """Decode a JSON document that arrived as raw text, otherwise pass it through.

    A ``text()`` SELECT carries no type information, so a JSON/JSONB column comes
    back already decoded on PostgreSQL (psycopg adapts ``jsonb``) but as raw text on
    SQLite, where the generic ``JSON`` variant is stored as ``TEXT``. Both dialects
    are supported test tiers, so a reader accepts either rather than letting the
    stored contract become dialect-dependent. Text that is not valid JSON is passed
    through untouched so it fails the ordinary shape check with a useful message
    instead of a decoding one.
    """

    if isinstance(value, str | bytes):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


_decode_json_sequence = decode_json_value
_decode_json_mapping = decode_json_value


def validate_run_model_identity(version: Any, order: Any) -> tuple[str, list[str]]:
    """Validate a run row's ``(component_model_version, component_order)`` pair.

    Both are stored explicitly, and both are checked: the version alone could be
    written on a run whose components are something else, and the order alone
    cannot say which model it belongs to. Requiring them to agree with the registry
    makes it structurally impossible to label a successor run historical — the
    successor order is not the historical order, so a mislabelled run fails here
    instead of being served as history.

    Returns the validated ``(version, order)``. Raises
    :class:`UnknownComponentModelError` or :class:`ComponentModelMismatchError`.
    """

    if not is_known_component_model(version):
        raise UnknownComponentModelError(version)
    expected = list(COMPONENT_ORDERS[version])
    if order is None:
        raise ComponentModelMismatchError(
            f"Run carries component model {version!r} but no component order.",
            {"component_model_version": version, "expected_component_order": expected},
        )
    order = _decode_json_sequence(order)
    if not isinstance(order, Sequence) or isinstance(order, str | bytes):
        raise ComponentModelMismatchError(
            "Component order must be an ordered list of component names, got "
            f"{type(order).__name__}.",
            {"component_model_version": version, "expected_component_order": expected},
        )
    received = [str(name) for name in order]
    if received != expected:
        raise ComponentModelMismatchError(
            f"Stored component order {received} does not match component model "
            f"{version!r}, whose components are {expected}.",
            {
                "component_model_version": version,
                "expected_component_order": expected,
                "stored_component_order": received,
            },
        )
    return version, expected


def run_model_identity(row: RowLike) -> tuple[str, list[str]]:
    """Read and validate a run row's component-model identity.

    ``row`` is any mapping carrying ``component_model_version`` and
    ``component_order`` — a SQLAlchemy ``RowMapping``, an ORM object's ``__dict__``,
    or a plain dict in a test.
    """

    return validate_run_model_identity(
        row["component_model_version"], row["component_order"]
    )


# --------------------------------------------------------------------------- #
# Candidate component scores
# --------------------------------------------------------------------------- #


def _score_string(value: Any) -> str | None:
    """Exact decimal string, or ``None`` for an absent component. Never zero-filled."""

    if value is None:
        return None
    return str(value)


def legacy_score_fields(version: str, row: RowLike) -> dict[str, str | None]:
    """The four legacy ``*_score`` wire fields for a candidate row.

    For the historical model these are populated exactly as they always were — they
    remain the sole authoritative storage for those runs. For every other model they
    are **present and explicitly ``None``**, never omitted and never reused: an
    omitted key invites a client to fall back to a default, whereas an explicit null
    renders through the null handling each of these fields already has, and a reused
    key would put a successor quantity under a historical name.
    """

    if uses_legacy_score_columns(version):
        return {f"{c}_score": _score_string(row[f"{c}_score"]) for c in COMPONENT_ORDER_HISTORICAL}
    return {f"{c}_score": None for c in COMPONENT_ORDER_HISTORICAL}


def component_scores_field(version: str, row: RowLike) -> dict[str, str | None]:
    """The generic ``component_scores`` wire field for a candidate row.

    Mirrors storage exactly rather than dual-emitting:

    * historical model → ``{}``. The legacy columns are the authoritative
      representation and are already on the wire; copying them here would create a
      second representation of the same number that can drift from the first, and
      would make a populated ``component_scores`` stop meaning "this run's scores
      live in the version-aware map".
    * every other model → the stored map, projected onto the model's component
      order with an explicit ``None`` for any component the run did not measure.
      A missing component is never zero-filled.
    """

    if uses_legacy_score_columns(version):
        return {}
    stored = _decode_json_mapping(row.get("component_scores")) or {}
    if not isinstance(stored, Mapping):
        raise ComponentModelMismatchError(
            "component_scores must be an object of {component: decimal string}, got "
            f"{type(stored).__name__}.",
            {"component_model_version": version},
        )
    order = component_order_for(version)
    unknown = sorted(set(stored) - set(order))
    if unknown:
        raise ComponentModelMismatchError(
            f"component_scores carries components {unknown} that are not part of "
            f"component model {version!r}.",
            {"component_model_version": version, "unknown_components": unknown},
        )
    return {c: _score_string(stored.get(c)) for c in order}


def resolve_component_values(version: str, row: RowLike) -> dict[str, str | None]:
    """The candidate's component scores, read from whichever storage owns them.

    This is the one accessor every reader that needs *values* (rather than the wire
    shape) should use — an export writer, an analytics helper, a future report
    generator — so no call site has to know which model stores where, and none of
    them can drift from the others. Keys are in the model's component order.
    """

    if uses_legacy_score_columns(version):
        return {c: _score_string(row[f"{c}_score"]) for c in component_order_for(version)}
    return component_scores_field(version, row)


# --------------------------------------------------------------------------- #
# Cross-model guards for weights, CRITIC, and stability
# --------------------------------------------------------------------------- #


def assert_weight_vector_matches_model(
    version: str, weights: Mapping[str, Any], *, context: str
) -> None:
    """Refuse a weight vector whose components are not this model's components.

    Applies to static profiles, a run's stored ``weight_profiles``, and the CRITIC
    vector alike. CRITIC weights are a function of the variance and inter-criterion
    correlation of *those* criteria in *that* run's population, so a vector derived
    over one component matrix has no defined meaning over another — the correlation
    matrix that produced it does not exist for the other criteria.
    """

    expected = set(component_order_for(version))
    received = set(weights)
    if received != expected:
        raise ComponentModelMismatchError(
            f"{context}: weight vector components {sorted(received)} do not match "
            f"component model {version!r}, whose components are "
            f"{list(component_order_for(version))}.",
            {
                "component_model_version": version,
                "expected_components": list(component_order_for(version)),
                "received_components": sorted(received),
            },
        )


def assert_criterion_order_matches_model(
    version: str, criterion_order: Any, *, context: str
) -> None:
    """Refuse a CRITIC ``criterion_order`` that is not this model's component order.

    ``weight_derivation.criterion_order`` is what makes a stored CRITIC vector
    self-describing. If it disagrees with the run's component order, the stored
    vector describes a different criteria matrix than the run's scores do, and
    serving the two together would present one model's sensitivity finding as
    another's.
    """

    expected = list(component_order_for(version))
    received = [str(c) for c in criterion_order] if criterion_order is not None else None
    if received != expected:
        raise ComponentModelMismatchError(
            f"{context}: CRITIC criterion order {received} does not match component "
            f"model {version!r}, whose component order is {expected}.",
            {
                "component_model_version": version,
                "expected_component_order": expected,
                "received_criterion_order": received,
            },
        )


def classify_weight_components(weights: Mapping[str, Any]) -> str | None:
    """Which component model a weight vector's key set belongs to, if any.

    Returns the model identifier when the keys are *exactly* one known model's
    components, otherwise ``None`` (malformed input — a different failure with a
    different remedy). Used to tell "you sent another model's scenario" apart from
    "you sent nonsense".
    """

    received = set(weights)
    for version, order in COMPONENT_ORDERS.items():
        if received == set(order):
            return version
    return None


# --------------------------------------------------------------------------- #
# Export serialization contract (contract + tests only; generation stays dormant)
# --------------------------------------------------------------------------- #

# There is no backend export endpoint today: CSV/XLSX are assembled client-side
# from these API responses. The backend's obligation is therefore to expose enough
# model identity that an export layer can build model-correct headers — which is
# what ``component_model_version`` + ``component_order`` + ``component_scores`` do.
#
# The rule an export writer must follow, and which these helpers enforce:
#
#   * component columns come from the RUN's ``component_order``, never from a
#     module-level constant, so a historical export stays reproducible with its
#     original headers no matter which model the deployed code prefers;
#   * a successor value is never written under a legacy header;
#   * the two models' column sets are disjoint, so a recipient holding a file can
#     always tell which layout it is.
EXPORT_CONTRACT_VERSION = "suitability-export-contract-v1"


def export_component_columns(version: str) -> list[str]:
    """Ordered component column keys for an export of a run of this model.

    Historical exports keep their original ``*_score`` headers exactly; every other
    model exports under its own component names, which are disjoint from the legacy
    ones by construction (asserted in :func:`assert_export_columns_disjoint`).
    """

    order = component_order_for(version)
    if uses_legacy_score_columns(version):
        return [f"{c}_score" for c in order]
    return list(order)


def assert_export_columns_disjoint() -> None:
    """Fail fast if two component models would export under a shared column name.

    A shared header is how a successor number ends up read as a historical one by
    anything downstream of the file — a spreadsheet, a script, a citation.
    """

    seen: dict[str, str] = {}
    for version in KNOWN_COMPONENT_MODELS:
        for column in export_component_columns(version):
            if column in seen:
                raise ComponentModelMismatchError(
                    f"Export column {column!r} is claimed by both component model "
                    f"{seen[column]!r} and {version!r}.",
                    {"column": column, "models": [seen[column], version]},
                )
            seen[column] = version


# --------------------------------------------------------------------------- #
# Analysis-signature identity
# --------------------------------------------------------------------------- #


def signature_identity(version: str) -> dict[str, str]:
    """Component-model contribution to a run's analysis-signature payload.

    Returns ``{}`` for the historical model and ``{"component_model_version": ...}``
    for every other model. That asymmetry is deliberate and load-bearing:

    * the signature is the run's **idempotency key**, so unconditionally adding a
      key would change the signature of an identical historical rebuild, which
      would stop reusing the existing succeeded run and write a duplicate instead —
      a change to historical verification behaviour;
    * omitting the key for the historical model means "the model that had no
      explicit identifier when these signatures were computed", which is exactly
      what every stored signature already encodes;
    * for any other model the key is present, so model identity is a *signed* input
      rather than a convention that ``policy_version`` and the component model
      always move together.

    Stored signatures are never recomputed.
    """

    if version not in COMPONENT_ORDERS:
        raise UnknownComponentModelError(version)
    if version == COMPONENT_MODEL_HISTORICAL:
        return {}
    return {"component_model_version": version}


# --------------------------------------------------------------------------- #
# Vector-tile component properties
# --------------------------------------------------------------------------- #

# Component names reach SQL as identifiers/literals. They only ever come from this
# module's registry, never from a request, but the pattern is enforced anyway so a
# future registry edit cannot introduce an injection surface by accident.
_SAFE_COMPONENT_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


def tile_component_columns_sql(version: str, *, alias: str = "c") -> str:
    """SQL select-list fragment emitting this model's component tile properties.

    Historical runs keep the four legacy columns under their existing property
    names, so a historical tile stays byte-identical to what the map already
    caches. Other models expand their ``component_scores`` map into named
    properties under the component's own name — never a ``*_score`` name, so a
    legacy property can never carry a successor meaning.

    Component scores are inspection payload in the tile: the map styles on
    ``score`` / ``status`` / ``stable_count`` / ``sigungu_region_code`` only, so
    adding model-specific properties cannot change rendering.
    """

    order = component_order_for(version)
    for name in order:
        if not _SAFE_COMPONENT_NAME.match(name):
            raise ComponentModelMismatchError(
                f"Component name {name!r} is not a safe SQL identifier.",
                {"component_model_version": version, "component": name},
            )
    if uses_legacy_score_columns(version):
        return ",\n".join(
            f"        {alias}.{c}_score::double precision AS {c}_score" for c in order
        )
    return ",\n".join(
        f"        ({alias}.component_scores ->> '{c}')::double precision AS {c}" for c in order
    )


# --------------------------------------------------------------------------- #
# Self-check
# --------------------------------------------------------------------------- #


def validate_registry() -> None:
    """Fail fast if the component-model registry violates its own invariants."""

    if COMPONENT_ORDER_HISTORICAL != tuple(policy.COMPONENTS):
        raise ComponentModelMismatchError(
            "The historical component order must remain policy.COMPONENTS.",
            {
                "registry": list(COMPONENT_ORDER_HISTORICAL),
                "policy_components": list(policy.COMPONENTS),
            },
        )
    overlap = set(COMPONENT_ORDER_HISTORICAL) & set(COMPONENT_ORDER_SUCCESSOR)
    if overlap:
        raise ComponentModelMismatchError(
            "Component models must keep disjoint component namespaces; overlapping "
            f"names: {sorted(overlap)}.",
            {"overlap": sorted(overlap)},
        )
    if set(COMPONENT_ORDERS) != set(COMPONENT_STORAGE):
        raise ComponentModelMismatchError(
            "Every registered component model must declare a storage representation.",
            {
                "orders": sorted(COMPONENT_ORDERS),
                "storage": sorted(COMPONENT_STORAGE),
            },
        )
    if DEFAULT_COMPONENT_MODEL not in COMPONENT_ORDERS:
        raise UnknownComponentModelError(DEFAULT_COMPONENT_MODEL)
    assert_export_columns_disjoint()
