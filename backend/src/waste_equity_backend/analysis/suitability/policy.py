"""The single machine-readable registry for suitability screening policy v1.

This module is the one source of truth the engine, API, and tests read; the
human-readable description is ``docs/SUITABILITY_POLICY_V1.md`` and the two must
agree. Any change to a classification, exclusion, review rule, penalty, weight,
profile, distance curve, normalization, or threshold requires bumping the
relevant version constant below.

Nothing here is a legal determination. ``ELIGIBLE`` means "passes the v1
analytical screening rules"; ``EXCLUDED`` is a ``PROJECT_SCREENING_EXCLUSION``,
not a statutory prohibition; a road-distance score never proves truck access.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

from . import critic

# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #

# policy-v2: adds the ``critic`` data-derived profile (run-specific CRITIC weights,
# NOT a fixed policy assumption) and per-candidate weight-sensitivity stability
# (top-10% membership across baseline/equal/critic). The four static profiles, the
# hard-exclusion/review rules, the component-score formulas, the distance curve,
# and every threshold are byte-for-byte unchanged; the version bump reflects the
# new profile-derivation and candidate-output surface.
POLICY_VERSION = "suitability-policy-v2"
# screening-v3: the scoring pipeline now also derives run-specific CRITIC weights
# and computes stability metadata. The four static-profile totals/ranks and all
# status resolution are unchanged.
DERIVATION_VERSION = "suitability-screening-v3"
CANDIDATE_GRID_VERSION = "capital-grid-500m-v1"

# Method versions for the two new analytical artifacts. CRITIC weights are a
# deterministic function of the signed inputs + this method version, so the
# analysis signature includes the method version but not the derived vector.
CRITIC_METHOD_VERSION = "critic-weights-v1"
STABILITY_METHOD_VERSION = "suitability-stability-v1"

# Stability compares a candidate's rank across three profiles; a candidate is
# "stable" when it stays in the top fraction under all three. This top fraction is
# an explicit analytical-policy assumption for stability v1 (not a legal or
# engineering threshold).
STABILITY_TOP_FRACTION = Decimal("0.10")

# Deterministic 500 m grid in EPSG:5179 (Korea 2000 / Unified, meters), tiled
# from the CRS origin (0, 0) so every edge falls on an integer multiple of 500 m.
GRID_CELL_METERS = 500
GRID_CRS = 5179
GRID_ORIGIN_DESCRIPTION = "EPSG:5179 coordinate origin (0, 0); cells aligned to 500 m multiples"

TARGET_CRS = 4326

# --------------------------------------------------------------------------- #
# Statuses (analytical workflow, not legal)
# --------------------------------------------------------------------------- #

STATUS_ELIGIBLE = "ELIGIBLE"
STATUS_REVIEW = "REVIEW_REQUIRED"
STATUS_EXCLUDED = "EXCLUDED"
EXCLUSION_LABEL = "PROJECT_SCREENING_EXCLUSION"

# --------------------------------------------------------------------------- #
# Components and weight profiles
# --------------------------------------------------------------------------- #

COMPONENTS = ("zoning", "road", "equity", "demand")

# Policy-assumption profiles with *fixed* weights. These are documented analytical
# assumptions (baseline is the operational default; the other three are sensitivity
# comparisons) — NOT expert AHP results, legal priorities, or objectively correct
# policy weights. Their exact weights are frozen across policy versions.
STATIC_WEIGHT_PROFILES: dict[str, dict[str, Decimal]] = {
    "baseline": {
        "zoning": Decimal("0.35"),
        "road": Decimal("0.25"),
        "equity": Decimal("0.25"),
        "demand": Decimal("0.15"),
    },
    "equal": {
        "zoning": Decimal("0.25"),
        "road": Decimal("0.25"),
        "equity": Decimal("0.25"),
        "demand": Decimal("0.25"),
    },
    "equity_focused": {
        "zoning": Decimal("0.30"),
        "road": Decimal("0.15"),
        "equity": Decimal("0.40"),
        "demand": Decimal("0.15"),
    },
    "access_focused": {
        "zoning": Decimal("0.25"),
        "road": Decimal("0.40"),
        "equity": Decimal("0.20"),
        "demand": Decimal("0.15"),
    },
}

# Backward-compatible alias: the static profiles ARE the fixed policy-weight
# registry. ``critic`` is deliberately absent — its weights are data-derived per
# run and never live in this static registry.
WEIGHT_PROFILES = STATIC_WEIGHT_PROFILES

# Data-derived profiles: computed per analysis run from the candidate score
# structure, with no fixed weight vector in this policy module.
DATA_DERIVED_PROFILES: tuple[str, ...] = ("critic",)

# Every profile the system supports (static + data-derived).
SUPPORTED_PROFILES: tuple[str, ...] = tuple(STATIC_WEIGHT_PROFILES) + DATA_DERIVED_PROFILES

# Profiles compared for weight-sensitivity stability (an operating assumption + a
# neutral comparison + the run's data-derived vector).
STABILITY_PROFILES: tuple[str, ...] = ("baseline", "equal", "critic")

# Stability classes (ELIGIBLE candidates only). These are sensitivity indicators,
# never a legal, engineering, environmental-review, or final siting determination.
STABILITY_CLASS_STABLE = "STABLE"
STABILITY_CLASS_CONDITIONAL = "CONDITIONALLY_STABLE"
STABILITY_CLASS_SENSITIVE = "WEIGHT_SENSITIVE"

STABILITY_DISCLAIMER = (
    "Stability means the candidate remains in the top 10% of complete ELIGIBLE "
    "candidates under baseline, equal, and CRITIC profiles. It is a sensitivity "
    "indicator, not a legal, engineering, environmental-review, or final siting "
    "determination."
)

DEFAULT_PROFILE = "baseline"

# Per-profile method description (citizen-facing, honest about what each is).
PROFILE_METHODOLOGY: dict[str, str] = {
    "baseline": "운영 기본 가정 — 전문가 AHP 산출값이 아님 (operating default assumption, not AHP)",
    "equal": "균등 비교 가정 (equal-weight comparison assumption)",
    "equity_focused": "형평성 민감도 비교 가정 (equity sensitivity comparison assumption)",
    "access_focused": "접근성 민감도 비교 가정 (access sensitivity comparison assumption)",
    "critic": (
        "CRITIC 데이터 기반 가중치 — 현재 실행의 완전한 ELIGIBLE 후보 네 구성 점수의 "
        "분산·비중복성으로 계산된 데이터 기반 가중치. 조닝/도로/형평성/수요의 규범적 중요도가 "
        "아니라 선택된 데이터와 분석 범위의 구조를 나타냄 (data-derived from score variation "
        "and non-redundancy among complete ELIGIBLE candidates in this run; describes the "
        "data/scope structure, not normative importance)."
    ),
}

WEIGHT_RATIONALE = {
    "zoning": "land-use context is fundamental to screening — largest weight",
    "road": "supports operational access; does not prove truck accessibility",
    "equity": "prevents already-burdened communities from being favored",
    "demand": "service-need context; must not dominate constraints or equity",
}

# --------------------------------------------------------------------------- #
# Hard-screening exclusions (PROJECT_SCREENING_EXCLUSION)
# --------------------------------------------------------------------------- #

# Protected/restricted layers screened out on any non-zero-area intersection.
PROTECTED_HARD_CODES: dict[str, str] = {
    "UD801": "개발제한구역 (development-restriction / greenbelt)",
    "UM710": "상수원보호구역 (water-source protection)",
    "UM901": "습지보호지역 (wetland protection)",
    "UF151": "산림보호구역 (forest protection)",
    "WGISNPGUG": "국립자연공원 (national natural park)",
}

# Zoning codes screened out as a hard exclusion.
ZONING_HARD_CODES: dict[str, str] = {
    "UQ114": "자연환경보전지역 (natural-environment conservation zoning)",
}

# Protected layers that trigger REVIEW_REQUIRED (never an automatic exclusion).
REVIEW_PROTECTED_CODES: dict[str, str] = {
    "UO101": "EDUCATION_PROTECTION_UO101",
    "UO301": "HERITAGE_PROTECTION_UO301",
}

# Hard-exclusion layers whose OFFICIAL_SOURCE_UNAVAILABLE coverage in a SIDO must
# raise a coverage-gap review (absence of data is never a confirmed clear).
COVERAGE_SENSITIVE_HARD_CODES = set(PROTECTED_HARD_CODES) | set(ZONING_HARD_CODES)

# --------------------------------------------------------------------------- #
# Zoning classification registry (top-level 용도지역 only, as ingested)
# --------------------------------------------------------------------------- #

# The ingested zoning resolves land use to UQ111-UQ114 only; no residential /
# industrial subclass is available, so urban land goes to review rather than
# being guessed eligible or excluded.


@dataclass(frozen=True)
class ZoningRule:
    code: str
    name: str
    classification: str
    score: Decimal | None  # dimensionless [0,100]; None when not scored (excluded/review)
    status_effect: str  # ELIGIBLE_WITH_PENALTY | HARD_EXCLUSION | REVIEW_REQUIRED
    review_reason: str | None
    penalty: str | None
    rationale: str
    unknown_behavior: str


ZONING_REGISTRY: dict[str, ZoningRule] = {
    "UQ114": ZoningRule(
        code="UQ114",
        name="자연환경보전지역",
        classification="HARD_EXCLUSION",
        score=None,
        status_effect="HARD_EXCLUSION",
        review_reason=None,
        penalty=None,
        rationale="conservation zoning; project screening exclusion",
        unknown_behavior="n/a",
    ),
    "UQ113": ZoningRule(
        code="UQ113",
        name="농림지역",
        classification="SOFT_PENALTY_STRONG",
        score=Decimal("25"),
        status_effect="ELIGIBLE_WITH_PENALTY",
        review_reason=None,
        penalty="strong zoning penalty (agricultural/forest land)",
        rationale="agricultural/forest land; strong penalty, not excluded",
        unknown_behavior="n/a",
    ),
    "UQ112": ZoningRule(
        code="UQ112",
        name="관리지역",
        classification="SOFT_PENALTY_MODERATE",
        score=Decimal("55"),
        status_effect="ELIGIBLE_WITH_PENALTY",
        review_reason=None,
        penalty="moderate zoning penalty; subtype (계획/생산/보전관리) unresolved",
        rationale="management zone (outside-urban buffer); some facilities permitted",
        unknown_behavior="subtype unresolved in ingested data → documented moderate penalty",
    ),
    "UQ111": ZoningRule(
        code="UQ111",
        name="도시지역",
        classification="URBAN_SUBCLASS_UNRESOLVED",
        score=None,
        status_effect="REVIEW_REQUIRED",
        review_reason="UNRESOLVED_URBAN_ZONING_SUBCLASS",
        penalty=None,
        rationale=(
            "urban land contains residential/commercial/industrial/green subclasses "
            "not distinguishable in the ingested NA_24 data; cannot be auto-excluded "
            "nor auto-eligible → review"
        ),
        unknown_behavior="review; never automatically eligible",
    ),
}

NO_ZONING_COVERAGE_REASON = "NO_ZONING_COVERAGE"
UNMAPPED_ZONING_REASON = "UNMAPPED_ZONING"

# The highest zoning score any candidate can earn in v1 (management level); no
# industrial high-compatibility class exists in the ingested data.
MAX_V1_ZONING_SCORE = Decimal("55")

# --------------------------------------------------------------------------- #
# Road-distance score curve
# --------------------------------------------------------------------------- #

# Piecewise-linear (distance_m, score) breakpoints; monotonically non-increasing.
ROAD_DISTANCE_CURVE: list[tuple[Decimal, Decimal]] = [
    (Decimal("0"), Decimal("100")),
    (Decimal("250"), Decimal("100")),
    (Decimal("1000"), Decimal("70")),
    (Decimal("3000"), Decimal("20")),
    (Decimal("5000"), Decimal("0")),
]

# --------------------------------------------------------------------------- #
# Scoring helpers (exact Decimal, deterministic)
# --------------------------------------------------------------------------- #

_QUANT = Decimal("0.0001")  # four decimals
_SCORE_MIN = Decimal("0")
_SCORE_MAX = Decimal("100")


def quantize_score(value: Decimal) -> Decimal:
    """Clamp to [0,100] and quantize to four decimals (ROUND_HALF_EVEN)."""

    clamped = min(_SCORE_MAX, max(_SCORE_MIN, value))
    return clamped.quantize(_QUANT, rounding=ROUND_HALF_EVEN)


def road_score(distance_m: Decimal) -> Decimal:
    """Piecewise-linear road-proximity score from centroid distance in meters."""

    if distance_m <= ROAD_DISTANCE_CURVE[0][0]:
        return quantize_score(ROAD_DISTANCE_CURVE[0][1])
    last_d, last_s = ROAD_DISTANCE_CURVE[-1]
    if distance_m >= last_d:
        return quantize_score(last_s)
    for (d0, s0), (d1, s1) in zip(ROAD_DISTANCE_CURVE, ROAD_DISTANCE_CURVE[1:], strict=False):
        if d0 <= distance_m <= d1:
            if d1 == d0:
                return quantize_score(s1)
            frac = (distance_m - d0) / (d1 - d0)
            return quantize_score(s0 + (s1 - s0) * frac)
    return quantize_score(last_s)


def percentile_ranks(values: dict[str, Decimal]) -> dict[str, Decimal]:
    """Deterministic percentile rank in [0,1] for each key's value.

    Rank = (number of values strictly less than v) / (n - 1), so the minimum
    value maps to 0 and the maximum to 1. Ties share the same rank. With a single
    value the rank is 0.5 (neutral). This is a documented, reproducible robust
    normalization; keys with no value are simply absent (never zero-filled).
    """

    n = len(values)
    if n == 0:
        return {}
    if n == 1:
        return {k: Decimal("0.5") for k in values}
    ordered = sorted(values.values())
    ranks: dict[str, Decimal] = {}
    denom = Decimal(n - 1)
    for key, v in values.items():
        less = sum(1 for other in ordered if other < v)
        ranks[key] = (Decimal(less) / denom).quantize(Decimal("0.000001"), rounding=ROUND_HALF_EVEN)
    return ranks


def equity_score_from_rank(percentile: Decimal) -> Decimal:
    """Lower burden (lower percentile) → higher avoidance score."""

    return quantize_score((Decimal("1") - percentile) * Decimal("100"))


def demand_score_from_rank(percentile: Decimal) -> Decimal:
    """Higher per-capita demand (higher percentile) → higher demand score."""

    return quantize_score(percentile * Decimal("100"))


def _resolve_weights(weights: str | dict[str, Decimal]) -> dict[str, Decimal]:
    """Accept either a static profile name or an explicit weight mapping.

    A string names a *static* profile in :data:`STATIC_WEIGHT_PROFILES`; a mapping
    is used directly (this is how the data-derived ``critic`` weights, which are
    never in the static registry, are applied). ``composite()`` therefore never
    assumes a selected profile is statically registered.
    """

    return STATIC_WEIGHT_PROFILES[weights] if isinstance(weights, str) else weights


def composite(component_scores: dict[str, Decimal], weights: str | dict[str, Decimal]) -> Decimal:
    """Weighted composite of four dimensionless component scores.

    ``weights`` is a static profile name or an explicit ``{component: weight}``
    mapping (e.g. run-specific CRITIC weights). All four components must be present
    (the caller marks REVIEW_REQUIRED and computes a provisional score otherwise).
    Exact Decimal, quantized to 4 dp.
    """

    w = _resolve_weights(weights)
    total = sum((component_scores[c] * w[c] for c in COMPONENTS), start=Decimal("0"))
    return quantize_score(total)


def provisional_composite(
    component_scores: dict[str, Decimal], weights: str | dict[str, Decimal]
) -> Decimal | None:
    """Provisional score for review candidates from the present components only.

    Renormalizes the weights over the components that are present so the
    provisional score is a documented partial estimate, never a zero-filled one.
    Returns None when no component is present. ``weights`` is a static profile name
    or an explicit mapping (see :func:`composite`).
    """

    w = _resolve_weights(weights)
    present = {c: component_scores[c] for c in COMPONENTS if c in component_scores}
    if not present:
        return None
    weight_sum = sum((w[c] for c in present), start=Decimal("0"))
    if weight_sum == 0:
        return None
    total = sum((present[c] * w[c] for c in present), start=Decimal("0")) / weight_sum
    return quantize_score(total)


# --------------------------------------------------------------------------- #
# Validation and snapshot
# --------------------------------------------------------------------------- #


class SuitabilityPolicyError(RuntimeError):
    """Raised when the policy registry is internally inconsistent."""


def validate_policy() -> None:
    """Fail fast if the registry violates its own invariants."""

    for profile, weights in STATIC_WEIGHT_PROFILES.items():
        if set(weights) != set(COMPONENTS):
            raise SuitabilityPolicyError(f"profile {profile} must weight exactly {COMPONENTS}")
        total = sum(weights.values(), start=Decimal("0"))
        if total != Decimal("1"):
            raise SuitabilityPolicyError(f"profile {profile} weights sum to {total}, not 1.0")
    # ``critic`` is data-derived and must never be given a fixed weight vector here.
    if set(DATA_DERIVED_PROFILES) & set(STATIC_WEIGHT_PROFILES):
        raise SuitabilityPolicyError("data-derived profiles must not be statically registered")
    if DEFAULT_PROFILE not in STATIC_WEIGHT_PROFILES:
        raise SuitabilityPolicyError(f"DEFAULT_PROFILE {DEFAULT_PROFILE} must be a static profile")
    for prof in STABILITY_PROFILES:
        if prof not in SUPPORTED_PROFILES:
            raise SuitabilityPolicyError(f"stability profile {prof} is not supported")
    for rule in ZONING_REGISTRY.values():
        if rule.status_effect == "ELIGIBLE_WITH_PENALTY" and rule.score is None:
            raise SuitabilityPolicyError(f"zoning {rule.code} scored class must have a score")
        if rule.score is not None and not (_SCORE_MIN <= rule.score <= _SCORE_MAX):
            raise SuitabilityPolicyError(f"zoning {rule.code} score out of [0,100]")
    # A code cannot be both a hard exclusion and a review layer.
    overlap = (set(PROTECTED_HARD_CODES) | set(ZONING_HARD_CODES)) & set(REVIEW_PROTECTED_CODES)
    if overlap:
        raise SuitabilityPolicyError(f"codes both hard and review: {overlap}")
    # Distance curve monotonic non-increasing in score, increasing in distance.
    for (d0, s0), (d1, s1) in zip(ROAD_DISTANCE_CURVE, ROAD_DISTANCE_CURVE[1:], strict=False):
        if d1 <= d0 or s1 > s0:
            raise SuitabilityPolicyError("road distance curve must rise in distance, fall in score")


def policy_snapshot() -> dict[str, Any]:
    """A JSON-serializable snapshot of the applied policy for a run record."""

    validate_policy()
    static_profiles = {
        p: {c: str(w) for c, w in weights.items()} for p, weights in STATIC_WEIGHT_PROFILES.items()
    }
    return {
        "policy_version": POLICY_VERSION,
        "derivation_version": DERIVATION_VERSION,
        "candidate_grid_version": CANDIDATE_GRID_VERSION,
        "critic_method_version": CRITIC_METHOD_VERSION,
        "stability_method_version": STABILITY_METHOD_VERSION,
        "grid": {
            "cell_meters": GRID_CELL_METERS,
            "crs": GRID_CRS,
            "origin": GRID_ORIGIN_DESCRIPTION,
            "target_crs": TARGET_CRS,
        },
        # Policy-assumption profiles with fixed weights. ``critic`` is intentionally
        # absent — its weights are derived per analysis run, not a policy constant.
        "weight_profiles": static_profiles,
        "static_weight_profiles": static_profiles,
        # Data-derived profile *catalog* (no fixed weights; the actual vector lives
        # on each analysis run's ``weight_profiles``/``weight_derivation``).
        "data_derived_profiles": {
            "critic": {
                "method": critic.CRITIC_METHOD,
                "method_version": CRITIC_METHOD_VERSION,
                "criterion_order": list(critic.CRITERION_ORDER),
                "normalization": critic.NORMALIZATION,
                "standard_deviation_definition": critic.STANDARD_DEVIATION_DEFINITION,
                "weights_source": "per-analysis-run (see run.weight_profiles.critic)",
                "description": PROFILE_METHODOLOGY["critic"],
                "disclaimer": critic.DISCLAIMER,
            }
        },
        "supported_profiles": list(SUPPORTED_PROFILES),
        "stability_profiles": list(STABILITY_PROFILES),
        "stability_top_fraction": str(STABILITY_TOP_FRACTION),
        "profile_methodology": PROFILE_METHODOLOGY,
        "default_profile": DEFAULT_PROFILE,
        "weight_rationale": WEIGHT_RATIONALE,
        "hard_exclusion_codes": {**PROTECTED_HARD_CODES, **ZONING_HARD_CODES},
        "review_codes": REVIEW_PROTECTED_CODES,
        "zoning_registry": {
            code: {
                "name": rule.name,
                "classification": rule.classification,
                "score": str(rule.score) if rule.score is not None else None,
                "status_effect": rule.status_effect,
                "review_reason": rule.review_reason,
                "penalty": rule.penalty,
                "rationale": rule.rationale,
                "unknown_behavior": rule.unknown_behavior,
            }
            for code, rule in ZONING_REGISTRY.items()
        },
        "road_distance_curve": [[str(d), str(s)] for d, s in ROAD_DISTANCE_CURVE],
        "disclaimer": (
            "Analytical screening only. ELIGIBLE is not legal eligibility; EXCLUDED is a "
            "PROJECT_SCREENING_EXCLUSION, not a statutory prohibition; road distance is an "
            "access proxy, not proof of truck accessibility."
        ),
    }
