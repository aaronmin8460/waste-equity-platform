"""RESEARCH DIAGNOSTIC ONLY — a CRITIC derivation over successor components.

**NOT PRODUCTION WEIGHTS. NOT ACTIVATED. NOT PERSISTED.**

``critic.compute_critic_weights`` cannot be pointed at the successor components:
it iterates the module-level historical ``CRITERION_ORDER`` literal
(``zoning``/``road``/``equity``/``demand``) and would raise ``KeyError`` on a
successor row. That refusal is the designed behaviour — a stored CRITIC vector is
a function of the variance and correlation of *those* criteria in *that* run's
population, and no translation exists (see ``policy.CrossModelReuseError``).

So this module re-implements the *documented method* against successor component
names, purely to answer the Phase-3 question "is a successor CRITIC
mathematically viable on real data?". It deliberately mirrors the historical
method exactly — population standard deviation, ``x = score / 100`` on the
policy-fixed beneficial [0,100] scale, information value
``σ_j · Σ_k (1 − r_jk)``, weights normalized to sum to 1 — so that any difference
in the result is attributable to the data rather than to a changed method.

Any weight vector produced here is a measurement of the current data, not a
recommendation, and must not be written to runtime configuration.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, localcontext
from typing import Any

RESEARCH_ONLY_LABEL = "RESEARCH DIAGNOSTIC ONLY — NOT PRODUCTION WEIGHTS — NOT ACTIVATED"

_WEIGHT_QUANT = Decimal("0.00000001")  # 8 dp, matching the historical convention
_STAT_QUANT = Decimal("0.0000000001")  # 10 dp
_ZERO = Decimal(0)
_ONE = Decimal(1)
_HUNDRED = Decimal(100)


class ResearchCriticUndefinedError(RuntimeError):
    """Raised when the research CRITIC has no defined answer for this population."""


def _quantize_optional(value: Decimal | None) -> Decimal | None:
    """Quantize a correlation that may be undefined, preserving ``None``.

    A correlation involving a zero-variance criterion has no value; it stays
    ``None`` rather than becoming a plausible-looking 0.
    """

    return value.quantize(_STAT_QUANT) if value is not None else None


@dataclass(frozen=True)
class ResearchCriticResult:
    """A research-only CRITIC derivation over an explicit component order."""

    criterion_order: tuple[str, ...]
    population_count: int
    means: dict[str, Decimal]
    standard_deviations: dict[str, Decimal]
    correlation_matrix: dict[str, dict[str, Decimal | None]]
    information_values: dict[str, Decimal]
    weights: dict[str, Decimal]
    zero_variance_criteria: tuple[str, ...]

    def sanitized_summary(self) -> dict[str, Any]:
        def fmt(value: Decimal | None) -> str | None:
            return format(value, "f") if value is not None else None

        return {
            "label": RESEARCH_ONLY_LABEL,
            "criterion_order": list(self.criterion_order),
            "population_count": self.population_count,
            "means": {c: fmt(self.means[c]) for c in self.criterion_order},
            "standard_deviations": {
                c: fmt(self.standard_deviations[c]) for c in self.criterion_order
            },
            "correlation_matrix": {
                j: {k: fmt(v) for k, v in self.correlation_matrix[j].items()}
                for j in self.criterion_order
            },
            "information_values": {
                c: fmt(self.information_values[c]) for c in self.criterion_order
            },
            "weights": {c: fmt(self.weights[c]) for c in self.criterion_order},
            "zero_variance_criteria": list(self.zero_variance_criteria),
            "activation_status": "NOT ACTIVATED — no successor weight vector is approved",
        }


def compute_research_critic_weights(
    rows: Sequence[Mapping[str, Decimal]],
    criterion_order: Sequence[str],
) -> ResearchCriticResult:
    """CRITIC weights over ``criterion_order`` for complete rows only.

    ``rows`` must each carry every criterion on the [0,100] beneficial scale.
    Incomplete rows are the caller's problem: nothing here imputes or zero-fills.
    """

    order = tuple(criterion_order)
    if len(order) < 2:
        raise ResearchCriticUndefinedError("CRITIC needs at least two criteria")
    n = len(rows)
    if n < 2:
        raise ResearchCriticUndefinedError(
            f"CRITIC is undefined for N={n}; at least 2 complete units are required"
        )
    for row in rows:
        missing = [c for c in order if c not in row]
        if missing:
            raise ResearchCriticUndefinedError(
                f"incomplete CRITIC row is never imputed; missing {missing}"
            )

    with localcontext() as ctx:
        ctx.prec = 60
        normalized: dict[str, list[Decimal]] = {c: [] for c in order}
        for row in rows:
            for c in order:
                normalized[c].append(Decimal(row[c]) / _HUNDRED)

        n_dec = Decimal(n)
        means: dict[str, Decimal] = {}
        deviations: dict[str, list[Decimal]] = {}
        sum_squares: dict[str, Decimal] = {}
        sigma: dict[str, Decimal] = {}
        for c in order:
            mean_c = sum(normalized[c], start=_ZERO) / n_dec
            means[c] = mean_c
            devs = [x - mean_c for x in normalized[c]]
            deviations[c] = devs
            ss = sum((d * d for d in devs), start=_ZERO)
            sum_squares[c] = ss
            sigma[c] = (ss / n_dec).sqrt()

        non_constant = [c for c in order if sigma[c] > _ZERO]
        zero_variance = tuple(c for c in order if sigma[c] == _ZERO)
        if not non_constant:
            raise ResearchCriticUndefinedError(
                "every criterion is constant across the population; CRITIC carries no "
                "information and its weights would describe the collapse, not the data"
            )

        corr: dict[str, dict[str, Decimal | None]] = {j: {k: None for k in order} for j in order}
        for j in order:
            if sigma[j] > _ZERO:
                corr[j][j] = _ONE
        for index, j in enumerate(order):
            for k in order[index + 1 :]:
                if sigma[j] == _ZERO or sigma[k] == _ZERO:
                    continue
                covariance = sum(
                    (a * b for a, b in zip(deviations[j], deviations[k], strict=True)),
                    start=_ZERO,
                )
                denominator = (sum_squares[j] * sum_squares[k]).sqrt()
                value = covariance / denominator
                corr[j][k] = value
                corr[k][j] = value

        information: dict[str, Decimal] = {}
        for j in order:
            if sigma[j] == _ZERO:
                information[j] = _ZERO
                continue
            conflict = _ZERO
            for k in non_constant:
                r = corr[j][k]
                assert r is not None
                conflict += _ONE - r
            information[j] = sigma[j] * conflict

        total_information = sum(information.values(), start=_ZERO)
        if total_information <= _ZERO:
            raise ResearchCriticUndefinedError(
                "total CRITIC information is non-positive; weights are undefined"
            )
        weights = {c: information[c] / total_information for c in order}

    return ResearchCriticResult(
        criterion_order=order,
        population_count=n,
        means={c: means[c].quantize(_STAT_QUANT) for c in order},
        standard_deviations={c: sigma[c].quantize(_STAT_QUANT) for c in order},
        correlation_matrix={j: {k: _quantize_optional(corr[j][k]) for k in order} for j in order},
        information_values={c: information[c].quantize(_STAT_QUANT) for c in order},
        weights={c: weights[c].quantize(_WEIGHT_QUANT) for c in order},
        zero_variance_criteria=zero_variance,
    )
