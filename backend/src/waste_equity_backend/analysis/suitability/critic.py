"""CRITIC data-derived weight computation (Phase 4/5).

CRITIC (CRiteria Importance Through Intercriteria Correlation) derives one weight
per criterion from the **variation** and **non-redundancy** of the four component
scores among the *complete ELIGIBLE candidates of one fixed analysis run*. The
result describes the structure of the selected data and analysis scope for that
run — it is **not** expert judgment, AHP, legal priority, environmental
importance, or a universally correct policy weighting.

The math is deterministic and Decimal-based (no NumPy): identical input produces
byte-equivalent metadata (there are no timestamps here). Missing component values
are never imputed or zero-filled — the caller must pass only complete rows. See
``docs/SUITABILITY_CRITIC_STABILITY.md``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from typing import Any

# Fixed criterion order for every CRITIC vector, matrix, and serialization.
CRITERION_ORDER: tuple[str, ...] = ("zoning", "road", "equity", "demand")

CRITIC_METHOD = "CRITIC"

# Component scores are policy-defined dimensionless [0, 100] beneficial-direction
# values; CRITIC normalizes them to [0, 1] by dividing by 100 (no second observed
# min-max transform — the scale is already policy-fixed).
NORMALIZATION = "x_ij = component_score / 100 (policy-fixed [0,100] scale; no observed min-max)"
STANDARD_DEVIATION_DEFINITION = "population standard deviation (denominator N)"

# Deterministic output precision.
_WEIGHT_QUANT = Decimal("0.00000001")  # 8 decimal places
_STAT_QUANT = Decimal("0.0000000001")  # 10 decimal places for means/std/corr/info
_ONE = Decimal("1")
_ZERO = Decimal("0")
_HUNDRED = Decimal("100")

DISCLAIMER = (
    "CRITIC weights are derived from score variation and inter-criterion correlation "
    "among complete ELIGIBLE candidates in this analysis run. They describe this run's "
    "data structure and do not represent expert judgment, legal priority, or universally "
    "correct policy importance."
)


def _fmt(value: Decimal) -> str:
    """Fixed-point decimal string (e.g. ``0.00000000``, never ``0E-8``).

    Exact-zero quantized Decimals stringify to exponent form; fixed-point notation
    keeps the serialized weights/stats consistent and deterministic.
    """

    return format(value, "f")


class CriticUndefinedError(RuntimeError):
    """Raised when CRITIC weights cannot be defined for the given population.

    ``category`` is a stable machine-readable label (``CRITIC_UNDEFINED``) the
    engine records as the failed-run error category.
    """

    category = "CRITIC_UNDEFINED"

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class CriticResult:
    """Deterministic CRITIC output plus the transparent derivation metadata."""

    method: str
    criterion_order: tuple[str, ...]
    population_candidate_count: int
    normalization: str
    standard_deviation_definition: str
    means: dict[str, Decimal]
    standard_deviations: dict[str, Decimal]
    correlation_matrix: dict[str, dict[str, Decimal | None]]
    information_values: dict[str, Decimal]
    weights: dict[str, Decimal]
    zero_variance_criteria: list[str]

    def weights_as_strings(self) -> dict[str, str]:
        return {c: _fmt(self.weights[c]) for c in self.criterion_order}

    def metadata(self, *, method_version: str) -> dict[str, Any]:
        """Transparent run-level metadata (no timestamps → equality-stable)."""

        return {
            "method": self.method,
            "method_version": method_version,
            "criterion_order": list(self.criterion_order),
            "population_status": "ELIGIBLE",
            "population_candidate_count": self.population_candidate_count,
            "normalization": self.normalization,
            "standard_deviation_definition": self.standard_deviation_definition,
            "means": {c: _fmt(self.means[c]) for c in self.criterion_order},
            "standard_deviations": {
                c: _fmt(self.standard_deviations[c]) for c in self.criterion_order
            },
            "correlation_matrix": {
                j: {
                    k: (_fmt(v) if v is not None else None)
                    for k, v in self.correlation_matrix[j].items()
                }
                for j in self.criterion_order
            },
            "information_values": {
                c: _fmt(self.information_values[c]) for c in self.criterion_order
            },
            "weights": self.weights_as_strings(),
            "zero_variance_criteria": list(self.zero_variance_criteria),
            "missing_value_policy": (
                "Only complete ELIGIBLE candidates (all four component scores present) enter "
                "the CRITIC population; missing components are never imputed or zero-filled."
            ),
            "disclaimer": DISCLAIMER,
        }


def compute_critic_weights(rows: list[dict[str, Decimal]]) -> CriticResult:
    """Compute run-specific CRITIC weights from complete ELIGIBLE component rows.

    ``rows`` is a list of ``{criterion: Decimal}`` maps, each holding all four
    beneficial-direction component scores on the [0, 100] scale. Order does not
    affect the result. Raises :class:`CriticUndefinedError` when the population is
    too small (``N < 2``) or carries no information (every criterion constant).
    """

    n = len(rows)
    if n < 2:
        raise CriticUndefinedError(
            f"CRITIC is undefined for N={n}; at least 2 complete ELIGIBLE candidates are required."
        )

    with localcontext() as ctx:
        ctx.prec = 60
        # Normalize to [0, 1] per the fixed criterion order (no imputation).
        normalized: dict[str, list[Decimal]] = {c: [] for c in CRITERION_ORDER}
        for row in rows:
            for c in CRITERION_ORDER:
                normalized[c].append(Decimal(row[c]) / _HUNDRED)

        n_dec = Decimal(n)
        means: dict[str, Decimal] = {}
        deviations: dict[str, list[Decimal]] = {}
        ss: dict[str, Decimal] = {}  # sum of squared deviations
        sigma: dict[str, Decimal] = {}
        for c in CRITERION_ORDER:
            mean_c = sum(normalized[c], start=_ZERO) / n_dec
            means[c] = mean_c
            devs = [x - mean_c for x in normalized[c]]
            deviations[c] = devs
            ss_c = sum((d * d for d in devs), start=_ZERO)
            ss[c] = ss_c
            sigma[c] = (ss_c / n_dec).sqrt()

        non_constant = [c for c in CRITERION_ORDER if sigma[c] > _ZERO]
        zero_variance = [c for c in CRITERION_ORDER if sigma[c] == _ZERO]

        # Pearson correlation for every pair of non-constant criteria; a pair
        # involving a zero-variance criterion is undefined (None).
        corr: dict[str, dict[str, Decimal | None]] = {
            j: {k: None for k in CRITERION_ORDER} for j in CRITERION_ORDER
        }
        for j in CRITERION_ORDER:
            if sigma[j] > _ZERO:
                corr[j][j] = _ONE
        for a_idx, j in enumerate(CRITERION_ORDER):
            for k in CRITERION_ORDER[a_idx + 1 :]:
                if sigma[j] == _ZERO or sigma[k] == _ZERO:
                    continue
                cov = sum(
                    (dj * dk for dj, dk in zip(deviations[j], deviations[k], strict=True)),
                    start=_ZERO,
                )
                denom = (ss[j] * ss[k]).sqrt()
                r = cov / denom if denom > _ZERO else _ZERO
                # Clamp only tiny numerical overshoots to [-1, 1].
                if r > _ONE:
                    r = _ONE
                elif r < -_ONE:
                    r = -_ONE
                corr[j][k] = r
                corr[k][j] = r

        # Information content C_j = sigma_j * sum_{k != j, sigma_k > 0} (1 - r_jk).
        # A zero-variance criterion contributes no information and is excluded from
        # every conflict sum. A single non-constant criterion has no other varying
        # criterion to correlate against, so it is maximally non-redundant: its
        # conflict term defaults to 1 and it carries all the weight (constants → 0).
        information: dict[str, Decimal] = {}
        for c in CRITERION_ORDER:
            if sigma[c] == _ZERO:
                information[c] = _ZERO
                continue
            others = [k for k in non_constant if k != c]
            if not others:
                # Lone informative criterion: no inter-criterion correlation exists.
                information[c] = sigma[c]
                continue
            conflict = _ZERO
            for k in others:
                r_ck = corr[c][k]
                assert r_ck is not None
                conflict += _ONE - r_ck
            information[c] = sigma[c] * conflict

        info_total = sum(information.values(), start=_ZERO)
        if info_total <= _ZERO:
            # No variation anywhere, or several varying criteria are perfectly
            # redundant (all pairwise r = 1). Never silently substitute equal/baseline.
            raise CriticUndefinedError(
                "CRITIC is undefined: every criterion has zero information "
                "(no variation and/or perfectly redundant criteria)."
            )

        raw_weights = {c: information[c] / info_total for c in CRITERION_ORDER}

    # Quantize deterministically and repair any residual so the vector sums to
    # exactly Decimal("1"), assigning the residual to the largest-information
    # criterion (tie-break by fixed criterion order).
    weights = {
        c: raw_weights[c].quantize(_WEIGHT_QUANT, rounding=ROUND_HALF_EVEN) for c in CRITERION_ORDER
    }
    residual = _ONE - sum(weights.values(), start=_ZERO)
    if residual != _ZERO:
        anchor = max(CRITERION_ORDER, key=lambda c: (information[c], -CRITERION_ORDER.index(c)))
        weights[anchor] = weights[anchor] + residual

    result = CriticResult(
        method=CRITIC_METHOD,
        criterion_order=CRITERION_ORDER,
        population_candidate_count=n,
        normalization=NORMALIZATION,
        standard_deviation_definition=STANDARD_DEVIATION_DEFINITION,
        means={
            c: means[c].quantize(_STAT_QUANT, rounding=ROUND_HALF_EVEN) for c in CRITERION_ORDER
        },
        standard_deviations={
            c: sigma[c].quantize(_STAT_QUANT, rounding=ROUND_HALF_EVEN) for c in CRITERION_ORDER
        },
        correlation_matrix={
            j: {
                k: (
                    _cell.quantize(_STAT_QUANT, rounding=ROUND_HALF_EVEN)
                    if (_cell := corr[j][k]) is not None
                    else None
                )
                for k in CRITERION_ORDER
            }
            for j in CRITERION_ORDER
        },
        information_values={
            c: information[c].quantize(_STAT_QUANT, rounding=ROUND_HALF_EVEN)
            for c in CRITERION_ORDER
        },
        weights=weights,
        zero_variance_criteria=zero_variance,
    )

    # Invariants: bounded, exact unit sum.
    assert sum(result.weights.values(), start=_ZERO) == _ONE
    for c in CRITERION_ORDER:
        assert _ZERO <= result.weights[c] <= _ONE
    return result
