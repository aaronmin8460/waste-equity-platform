# CRITIC data-derived weights + weight-sensitivity stability (Phase 4/5)

**Status:** implemented on branch `feat/suitability-critic-stability`. Migration
`0016` created and tested against a disposable PostGIS database. **Not** deployed;
**no** production or OCI migration or suitability build has been run for this
feature (see [§20 Deployment status](#20-deployment-status)).

This document is the human-readable companion to the machine-readable registry in
`backend/src/waste_equity_backend/analysis/suitability/policy.py` and the CRITIC
module `backend/src/waste_equity_backend/analysis/suitability/critic.py`. It sits
alongside [SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md), which still
describes the unchanged screening rules (exclusions, review, component scores, the
four static profiles). Nothing here is a legal determination.

---

## 1. Purpose

Add, per analysis run:

1. A fifth **`critic`** weight profile whose weights are **derived from the data**
   of that run — the variation and non-redundancy of the four component scores
   among complete ELIGIBLE candidates — rather than assumed.
2. A **weight-sensitivity stability** classification: whether an ELIGIBLE
   candidate stays in the top 10% under the `baseline`, `equal`, and `critic`
   profiles.

CRITIC is **not** expert weighting, AHP, environmental-importance weighting, legal
priority, or an objectively-correct policy weighting. Citizen-facing description:
**CRITIC 데이터 기반 가중치**. It describes the structure of the selected data and
analysis scope in this fixed run — not the normative importance of zoning, road
access, equity, or demand.

Stability is a **sensitivity indicator**, not a legal, engineering,
environmental-review, or final siting determination. A "stable" candidate is never
"approved", "valid", "developable", "permitted", or "final".

---

## 2. Exact CRITIC population

CRITIC weights are computed **only** from candidates that meet **all** of:

- `status == ELIGIBLE`
- zoning score present
- road score present
- equity score present
- demand score present

Excluded from the population: `REVIEW_REQUIRED` candidates, `EXCLUDED` candidates,
any candidate missing a component, and provisional scores. Missing components are
**never** imputed or treated as zero — an incomplete candidate simply does not
enter the population (it is `REVIEW_REQUIRED` by the unchanged status rules).

The population and all inputs are **fixed by the analysis run**: reference year,
boundary vintage, structural dataset-version IDs, population/waste/facility
reference periods, policy version, derivation version, candidate-grid version, and
CRITIC method version. Browser filters, map viewports, and API query parameters
**never** change the CRITIC population — the weights are computed once at build
time and stored on the run. The exact count is persisted as
`weight_derivation.population_candidate_count`.

---

## 3. Exact CRITIC equations

Fixed criterion order: **zoning, road, equity, demand**.

For each ELIGIBLE candidate `i` and criterion `j` normalize (see §4):

```
x_ij = component_score_ij / 100
```

Population mean and **population** standard deviation (denominator `N`):

```
mean_j  = (1/N) · Σ_i x_ij
sigma_j = sqrt( (1/N) · Σ_i (x_ij − mean_j)^2 )
```

For each pair `(j, k)` with non-zero variance, Pearson correlation:

```
r_jk = Σ_i (x_ij − mean_j)(x_ik − mean_k)
       ---------------------------------------------------
       sqrt( Σ_i (x_ij − mean_j)^2 · Σ_i (x_ik − mean_k)^2 )
```

Only tiny numerical overshoots are clamped to `[-1, 1]`.

Information content of each non-constant criterion:

```
C_j = sigma_j · Σ_{k ≠ j, sigma_k > 0} (1 − r_jk)
```

Final weights:

```
w_j = C_j / Σ_j C_j
```

Every weight is in `[0, 1]` (since `sigma_j ≥ 0` and `1 − r_jk ∈ [0, 2]`) and the
weights sum to exactly `1`.

---

## 4. Normalization decision

The four component scores are already **beneficial-direction, dimensionless
scores on a policy-defined `[0, 100]` scale** (see SUITABILITY_POLICY_V1.md). We
normalize with `x_ij = component_score / 100` and deliberately **do not** apply a
second observed min-max transform. Reason: an observed min-max would make the
weights depend on the incidental spread of one run's scores in a way that is not
comparable across runs, and would distort a criterion whose scores happen to be
clustered. Dividing by the fixed policy maximum keeps the normalization tied to
the policy scale, not to sampling accident.

---

## 5. Zero-variance handling

A criterion whose `sigma_j == 0` (constant across the whole population) carries no
information:

- its information value `C_j = 0` and its final weight is `0`;
- it is listed explicitly in `weight_derivation.zero_variance_criteria`;
- it is excluded from every other criterion's correlation-conflict sum;
- its correlation-matrix entries are `null` (undefined, not `0`).

**Lone informative criterion.** If exactly one criterion varies, there is no other
varying criterion to correlate against; that lone criterion is maximally
non-redundant and receives the **full weight `1`** while the constants receive `0`.
(The literal `Σ_{k≠j}` conflict sum would be empty; the implementation treats an
absent conflict term as `1`, documented in `critic.py`.)

---

## 6. Precision and deterministic residual handling

- All intermediate arithmetic uses `Decimal` in a local context of precision 60
  (`Decimal.sqrt()` for square roots). No NumPy or other heavy dependency is added.
- Final weights are quantized to **8 decimal places** (`ROUND_HALF_EVEN`).
- Means, standard deviations, correlations, and information values are quantized
  to 10 decimal places.
- After quantization, any residual (`1 − Σ w_j`) is added to the criterion with
  the **largest information value** (tie-break by fixed criterion order), so the
  stored vector sums to **exactly `Decimal("1")`**.
- Values are serialized as fixed-point strings (e.g. `"0.00000000"`, never
  `"0E-8"`).
- Repeated execution with identical input produces **byte-equivalent** metadata
  (there are no timestamps inside the derivation object).

---

## 7. Missing-value policy

Missing component scores are **rejected before CRITIC, never zero-filled**. A
candidate missing any component is `REVIEW_REQUIRED` and is excluded from the
population. The CRITIC function itself raises `KeyError` if handed an incomplete
row (a programming-error guard), and the engine only ever hands it complete
ELIGIBLE rows.

---

## 8. Actual persisted metadata

`suitability_analysis_runs.weight_derivation` (JSONB) holds:

- `method` (`"CRITIC"`), `method_version` (`critic-weights-v1`)
- `criterion_order` (`["zoning","road","equity","demand"]`)
- `population_status` (`"ELIGIBLE"`), `population_candidate_count`
- `normalization`, `standard_deviation_definition`
- `means`, `standard_deviations`, `correlation_matrix`, `information_values`
- `weights` (the run-specific vector)
- `zero_variance_criteria`, `missing_value_policy`
- `reference_year`, `policy_version`, `derivation_version`
- `disclaimer`

`suitability_analysis_runs.weight_profiles` stores the **actual run weights** for
all five profiles, including `critic` (the run-specific vector). The static policy
snapshot (`policy_snapshot`) never presents `critic` as a fixed policy vector.

Disclaimer text (verbatim):

> CRITIC weights are derived from score variation and inter-criterion correlation
> among complete ELIGIBLE candidates in this analysis run. They describe this run's
> data structure and do not represent expert judgment, legal priority, or
> universally correct policy importance.

---

## 9. Stability profiles

Exactly three comparison profiles: **`baseline`**, **`equal`**, **`critic`**
(`policy.STABILITY_PROFILES`). Only ELIGIBLE candidates are ranked and classified.

---

## 10. Top-10% cutoff rule

```
STABILITY_TOP_FRACTION = Decimal("0.10")   # explicit analytical-policy assumption (v1)
top_cutoff_rank = max(1, ceil(N_eligible × STABILITY_TOP_FRACTION))
```

For each ELIGIBLE candidate and each stability profile, membership is
`profile_rank ≤ top_cutoff_rank`. Ranks follow the existing deterministic ordering
(descending profile total, tie-break ascending `candidate_key`).

---

## 11. Stability classes

```
stable_count = number of true memberships (0..3)

stable_count == 3        → STABLE
stable_count == 2        → CONDITIONALLY_STABLE
stable_count in {0, 1}   → WEIGHT_SENSITIVE
```

For `REVIEW_REQUIRED` and `EXCLUDED` candidates: `stable_count = null`,
`stability_class = null`, `stability_membership = {}` — they are **never** presented
as stable.

Run-level `stability_definition` (JSONB) persists: `method_version`
(`suitability-stability-v1`), `compared_profiles`, `top_fraction`,
`eligible_candidate_count`, `top_cutoff_rank`, `class_definitions`, the
applicability rule, and this disclaimer (verbatim):

> Stability means the candidate remains in the top 10% of complete ELIGIBLE
> candidates under baseline, equal, and CRITIC profiles. It is a sensitivity
> indicator, not a legal, engineering, environmental-review, or final siting
> determination.

---

## 12. Historical-run compatibility

Migration `0016` is purely additive. Pre-existing runs keep `weight_derivation =
{}`, `stability_definition = {}`, and their candidates keep `stable_count = null`,
`stability_class = null`, `stability_membership = {}`. Old runs are **never**
backfilled with invented CRITIC or stability results and stay historically
interpretable.

The read API distinguishes availability: static profiles are always available;
`critic` is available only when the selected run's `weight_profiles` include it.
An old run asked for `critic` returns a structured `400`:

```json
{ "error": "PROFILE_NOT_AVAILABLE_FOR_RUN",
  "detail": "Profile critic is not available for suitability run <id>." }
```

The frontend derives the offered profiles from the run's actual `weight_profiles`,
so an old run never shows an enabled CRITIC option and instead displays:

> 현재 분석 실행에는 CRITIC/안정성 결과가 없습니다. 새 버전의 분석 실행이 필요합니다.

---

## 13. Policy and derivation version changes

| Constant | Before | After |
| --- | --- | --- |
| `POLICY_VERSION` | `suitability-policy-v1` | `suitability-policy-v2` |
| `DERIVATION_VERSION` | `suitability-screening-v2` | `suitability-screening-v3` |
| `CANDIDATE_GRID_VERSION` | `capital-grid-500m-v1` | unchanged |
| `CRITIC_METHOD_VERSION` | — | `critic-weights-v1` |
| `STABILITY_METHOD_VERSION` | — | `suitability-stability-v1` |

The four static profiles' weights, the hard-exclusion/review rules, the
component-score formulas, the road-distance curve, and all thresholds are
**byte-for-byte unchanged**. The version bump reflects the new profile-derivation
and candidate-output surface.

**Analysis signature.** The signature now includes the CRITIC/stability method
versions, the stability top fraction, and the stability profile list, in addition
to the existing signed inputs. The derived CRITIC weight vector is **not** part of
the signature: it is a deterministic function of the already-signed inputs plus
`critic_method_version`, so signing those uniquely determines the vector. An
identical build reuses the existing succeeded run; a changed data version,
reference period, policy version, CRITIC/stability method version, or stability
threshold produces a distinct signature.

---

## 14. API fields

- `GET /policies` — adds `critic_method_version`, `stability_method_version`,
  `static_weight_profiles`, `data_derived_profiles` (catalog, no fixed weights),
  `supported_profiles`, `stability_profiles`, `stability_top_fraction`,
  `profile_methodology`, `default_profile`. `weight_profiles` remains the four
  static profiles only.
- `GET /runs`, `GET /runs/latest` — add `weight_profiles`, `weight_derivation`,
  `stability_definition`.
- `GET /summary` — adds `critic_weights`, `stability_top_fraction`,
  `stability_top_cutoff_rank`, `candidate_count_stable`,
  `candidate_count_conditionally_stable`, `candidate_count_weight_sensitive`,
  `top_stable_candidates`, `stability_definition`, `stability_available`; existing
  `top_candidates` entries now carry `stable_count`/`stability_class`/
  `stability_membership`. Accepts `profile=critic` when available (else `400`).
- `GET /candidates` — feature properties add `stable_count`, `stability_class`,
  `stability_membership`; new optional `stability_class` filter (`STABLE` /
  `CONDITIONALLY_STABLE` / `WEIGHT_SENSITIVE`; invalid → `422`). The `status`
  filter is unchanged.
- `GET /candidates/{id}` — adds `stable_count`, `stability_class`,
  `stability_membership`; `weights` are served from the run's actual
  `weight_profiles[profile]` (never `policy.WEIGHT_PROFILES` for `critic`).
- `GET /tiles/{run}/{profile}/{z}/{x}/{y}.mvt` — tile features add `stable_count`
  and `stability_class`; `critic` accepted when available (else `400`). Source
  layer name (`candidates`), immutable cache headers, and ETag behavior unchanged.

All decimal analytical values remain exact decimal strings.

---

## 15. Frontend interpretation

- The profile selector offers `critic` **only** when the selected run computed it,
  and shows each profile's method (baseline = operating default, not AHP; equal,
  equity, access = comparison assumptions; critic = data-derived). Weights are read
  from `run.weight_profiles[profile]`, never a fixed critic constant.
- A CRITIC methodology note shows the candidate population, method version, actual
  Z/R/E/D weights, any zero-variance criteria, and the disclaimer.
- A "가중치 민감도 안정성" summary shows the stable / conditionally-stable /
  weight-sensitive counts, the top-10% cutoff, the three compared profiles, and the
  sensitivity disclaimer. A stable-candidate list selects and moves the map via the
  existing candidate-selection flow.
- Text-first stability badges ("안정 후보 3/3", "조건부 안정 2/3", "가중치 민감
  0–1/3") appear on candidate rows, the detail panel, and the map popup — never
  color alone. Review/excluded candidates show no badge ("안정성 평가 대상 아님").
- The floating legend adds an accessible native "안정 후보만 보기" checkbox
  (`stableOnly`) and a stable-outline sample. `stableOnly` is a **separate** state
  from the canonical `statusVisibility`: it restricts ELIGIBLE cells to
  `stable_count = 3` while REVIEW/EXCLUDED remain governed by their status
  checkboxes. STABLE eligible cells get a distinct `candidates-stable-outline`
  layer; the selected-candidate highlight stays visually dominant. No CRITIC weight
  or stability is ever computed in the browser.

---

## 16. Prohibited terminology

Do not describe CRITIC as expert weighting, AHP, environmental importance, legal
priority, or objectively-correct policy weighting; do not claim it is value-free or
universally objective. Do not call ELIGIBLE "legally eligible". Do not call a
stable candidate approved, valid, developable, permitted, or final. Do not let a
browser filter affect stored weights or stability.

---

## 17. Migration and operational steps

Migration `0016` (`Revises: 0015`) adds, additively:

- `suitability_analysis_runs.weight_derivation` JSONB NOT NULL DEFAULT `'{}'`
- `suitability_analysis_runs.stability_definition` JSONB NOT NULL DEFAULT `'{}'`
- `suitability_candidates.stable_count` SMALLINT NULL
- `suitability_candidates.stability_class` VARCHAR(30) NULL
- `suitability_candidates.stability_membership` JSONB NOT NULL DEFAULT `'{}'`
- indexes `ix_suitability_candidates_run_stable (analysis_run_id, stable_count)`
  and `ix_suitability_candidates_run_stability_class (analysis_run_id,
  stability_class)`

Upgrade and downgrade were tested against a disposable PostGIS 16-3.4 container.

---

## 18. Reproduction procedure

1. Apply the migration chain to a database with the ingested structural datasets.
2. Run a suitability build (`suitability-build --write --profile baseline`).
3. The engine builds candidate facts, resolves status/component scores, collects
   complete ELIGIBLE rows, computes the run-specific CRITIC weights, assembles the
   five run profiles, computes totals + ranks for every profile, computes
   stability, and persists everything transactionally.
4. Because the derivation is deterministic given the signed inputs, re-running the
   same build reuses the existing run; the stored `weight_derivation` is
   byte-equivalent apart from run timestamps (which are not part of the derivation
   object).

**Deterministic fixture (hand-verified).** For the two-candidate population
`[(z=0, r=100, e=50, d=50), (z=100, r=0, e=50, d=50)]` — zoning and road perfectly
anti-correlated, equity/demand constant — CRITIC yields

```
zoning = 0.50000000, road = 0.50000000, equity = 0.00000000, demand = 0.00000000
```

with `equity`, `demand` listed as zero-variance criteria (see
`backend/tests/test_suitability_critic.py::test_known_matrix_hand_verified_weights`).

---

## 19. Limitations

- CRITIC is undefined for `N < 2` complete ELIGIBLE candidates, or when every
  varying criterion is perfectly redundant / all criteria are constant. The build
  then **fails** with a structured `CRITIC_UNDEFINED` error and never silently
  substitutes equal or baseline weights. (Real capital-region runs have ~10³
  eligible candidates, so this is a guard, not an expected path.)
- Stability at v1 uses a single fixed 10% cutoff; it is a coarse sensitivity
  screen, not a robustness proof.
- All non-goals from the phase brief remain out of scope (no user sliders, no
  parcel-level suitability, no site clustering, no land/compensation/operating/
  transport cost, etc.).

---

## 20. Deployment status

- **Local:** implemented; unit + SQLite route tests pass; migration `0016` and the
  PostGIS integration tests pass against a **disposable** test database.
- **Production / OCI:** **no** migration applied, **no** suitability build run, **no**
  deployment performed in this task. The exact post-deployment operator commands
  below are documented but **not executed**.

### Post-deployment operator steps (do not run as part of this task)

```bash
# 1. Apply the new Alembic migration on the target database.
cd backend && DATABASE_URL=<target> python -m alembic upgrade head   # 0015 -> 0016

# 2. Run a new suitability build (writes a new run with CRITIC + stability).
cd ingestion
python -m waste_equity_ingestion.cli suitability-build --write \
  --reference-year 2024 --policy-version suitability-policy-v2 --profile baseline

# 3. Verify the new run (counts, CRITIC weights, stability cutoff) in the report.

# 4. Verify the API:
curl -s <api>/api/v1/suitability/runs/latest | jq '.weight_profiles.critic, .stability_definition'
curl -s "<api>/api/v1/suitability/summary?profile=critic" | jq '.candidate_count_stable'

# 5. Only after the above verify cleanly, expose CRITIC/stability in production.
```

Do **not** run these against OCI, production, a persistent shared development
database, or any database whose safety cannot be proven.

---

## Not to be confused with: user-weight scenarios (Phase 6)

The **가중치 바꿔보기 (user-weight scenario lab)** lets a user temporarily re-weight the
four component scores of a fixed run on read. It is **completely separate** from
CRITIC and from stored stability:

- It is **not** included in CRITIC derivation and never overwrites the CRITIC vector.
- It is **not** part of stored stability classification. `stable_count` /
  `stability_class` / `stability_membership` shown in a scenario are the **stored
  run's** values, labelled as such — changing custom weights does **not** recalculate
  stability, `stable_count`, `stability_class`, or the top-10% definition.
- It creates no official run/profile and is never persisted.

See `docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md`.
