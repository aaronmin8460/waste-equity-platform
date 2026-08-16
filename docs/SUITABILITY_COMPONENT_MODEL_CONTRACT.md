# Suitability Component-Model Contract (backend)

> **Status: the backend is version-aware; no successor model is activated.** Two
> component models can now coexist safely in storage, in the API, in scenarios, and
> in tests. Nothing here scores, persists, or serves a successor analysis run — none
> can be produced, and `successor.policy.assert_activated()` still fails.
>
> Everything described is analytical decision support. Nothing is a legal,
> permitting, engineering, environmental-review, or final siting determination.

Companion documents: [SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md) (the
historical model), [SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md](SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md)
(the successor components), [SUITABILITY_USER_WEIGHT_SCENARIOS.md](SUITABILITY_USER_WEIGHT_SCENARIOS.md),
[SUITABILITY_VECTOR_TILES.md](SUITABILITY_VECTOR_TILES.md).

---

## 1. The problem this solves

The historical screen scores four components — `zoning` / `road` / `equity` /
`demand` — and a successor model is being prepared over four different ones:
`existing_burden` / `air_impact_proxy` / `resident_impact` / `land_conversion`.

Before this work, a stored run could not answer **"which component model produced
me?"**. `policy_version` cannot: it has already moved once (v1 → v2) for a reason
unrelated to component identity, while the component-score formulas stayed
byte-for-byte unchanged. `derivation_version` is overloaded the same way, and
`candidate_grid_version` describes geometry. The component *order* was not
recoverable from any stored artifact at all — it existed only as a tuple literal in
source, and a JSON object does not preserve key order.

Two consequences followed, both of which are now closed:

* a second model's numbers could be served under the first model's field names; and
* the first successful run of a second model would silently redefine every default
  view and every un-pinned shared link, because default-run resolution took the
  latest succeeded run regardless of model.

**Historical semantics are immutable.** No stored score, rank, status, reason,
weight, classification, or signature was read, rewritten, or recomputed by this
work.

---

## 2. Component-model identity

One backend source of truth:
`backend/src/waste_equity_backend/analysis/suitability/component_model.py`.

| Model | Identifier | Component order | Candidate storage |
| --- | --- | --- | --- |
| Historical | `suitability-components-zred-v1` | `zoning`, `road`, `equity`, `demand` | the four legacy `*_score` columns |
| Successor | `suitability-components-successor-v1` | `existing_burden`, `air_impact_proxy`, `resident_impact`, `land_conversion` | the `component_scores` JSON map |

The identifiers are written out in `component_model.py` rather than imported from
`successor.policy`, because that module imports `scenario` and `component_model` must
be importable from both `models` and `scenario` — the same cycle constraint that
keeps `critic.CRITERION_ORDER` a literal. `test_suitability_component_model.py`
asserts the registry, the successor foundation, and migration `0022`'s literals are
all equal.

**Both the version and the order are validated together** on every read
(`validate_run_model_identity`). A version alone could be written on a run whose
components are something else; because the successor order is not the historical
order, a mislabelled run fails loudly instead of being served as history.

---

## 3. Persistence

Three additive columns. Nothing is altered, renamed, dropped, or backfilled.

### Run level — `suitability_analysis_runs` (migration `0022`)

| Column | Type | Default |
| --- | --- | --- |
| `component_model_version` | `String(50)`, `NOT NULL` | `'suitability-components-zred-v1'` |
| `component_order` | `JsonVariant`, `NOT NULL` | `'["zoning", "road", "equity", "demand"]'` |

### Candidate level — `suitability_candidates` (migration `0023`)

| Column | Type | Default |
| --- | --- | --- |
| `component_scores` | `JsonVariant`, `NOT NULL` | `'{}'` |

### Write rules

* **Historical runs: nothing is written and nothing is backfilled.** The four legacy
  columns remain the sole authoritative storage, and `component_scores` stays `{}`.
* **Any other component model:** `component_scores` is populated; the four legacy
  columns are written `NULL` and are never reused to carry another quantity.
* **No historical component score is ever copied into `component_scores`.** A second
  copy of an authoritative analytical value can drift from the first, and it would
  stop "`component_scores` is populated" from meaning "this run's scores live in the
  version-aware map".

The load-bearing property is that a successor quantity has **no column to be
cross-wired into**. Eight adjacent `Numeric(7,4)` columns are one careless edit away
from each other; a `NULL` legacy column and a separate versioned map are not.

### Labelling, not backfill

The constant server defaults state what every pre-existing row already is: the
candidate table physically cannot hold any other component model at this revision.
No score, rank, weight, classification, status, reason, or geometry is read or
written to establish the label — the same discipline migration `0016` used when it
defaulted `weight_derivation` / `stability_definition` to `{}` rather than inventing
CRITIC results for pre-CRITIC runs.

### Rollback

`0022`'s downgrade is inert: nothing references the columns and no stored analytical
value depends on them. `0023`'s downgrade is safe **only before the first run of a
non-historical component model is written** — after that, those rows' legacy columns
are `NULL` and hold nothing to fall back on, so the drop would destroy their scores.
Historical runs are unaffected by either downgrade under all conditions. Deploy order
is migrate-then-app; roll back app-then-migrate.

### Analysis signature

`component_model_version` joins the signature payload **only when it is not the
historical value**. The signature is a run's idempotency key: adding a key
unconditionally would change the signature of an identical historical rebuild, so the
engine would stop reusing the existing succeeded run and write a duplicate instead —
a change to historical verification behaviour, not just to a label. Omitting it for
the historical model means "the model that had no explicit identifier when these
signatures were computed", which is exactly what every stored signature already
encodes. Stored signatures are never recomputed.

---

## 4. API contract

### Model identity on every run-scoped response

`component_model_version` and `component_order` are emitted by:

`GET /policies` · `GET /runs` · `GET /runs/latest` · `GET /summary` ·
`GET /candidates` · `GET /candidates/{id}` · `POST /scenarios/preview` ·
`POST /scenarios/candidates/{id}`

Every one of them reports the **stored run's own** identity, read from the run row.
`GET /policies` is the single exception by design: it describes the currently
implemented policy rather than a stored run, so it reports the module's constants.

### Per-candidate score representation

The wire mirrors storage exactly. Nothing is dual-emitted.

| Run's model | `zoning_score` … `demand_score` | `component_scores` |
| --- | --- | --- |
| historical | populated, byte-identical to before | `{}` |
| any other | **present and explicitly `null`** | the run's scores, keyed by its own component names, in `component_order` |

An omitted legacy key would invite a client to fall back to a default; an explicit
`null` renders through the null handling each of these fields already has. A legacy
key never carries a successor meaning under any circumstance.

A missing component is `null`, never `0`. On a beneficial `[0,100]` scale zero is the
*best* possible score, so a zero-fill would systematically promote exactly the cells
with the least evidence.

### What a client should do

```
switch (run.component_model_version) {
  case "suitability-components-zred-v1":
    // read zoning_score / road_score / equity_score / demand_score
  default:
    // read component_scores, iterating run.component_order
}
```

Never infer the component set from which keys happen to be non-null, and never
iterate `component_scores`' key order — iterate `component_order`.

### Vector tiles

Source layer stays `candidates`. A historical run's tile is **byte-identical** to what
the map already caches: the same four component properties under the same names. A
run of any other model expands `component_scores` into properties named after its own
components (`existing_burden`, …), never a `*_score` name.

This is safe to vary per run because the tile URL already embeds an immutable run and
a run belongs to exactly one component model, so cache semantics are unchanged. The
map styles only on `score` / `status` / `stable_count` / `sigungu_region_code`, never
on a component score, so component properties are inspection payload.

### Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `UNKNOWN_COMPONENT_MODEL` | 422 | The caller named a component model the backend does not know. Never silently defaulted. |
| `COMPONENT_MODEL_MISMATCH` | 422 | The request mixes two models — a pinned run of one model plus a selector for another, or scenario weights defined over another model's components. |
| `COMPONENT_MODEL_SCENARIOS_UNAVAILABLE` | 422 | The run's component model has no scenario contract yet (see §6). |
| `COMPONENT_MODEL_INCONSISTENT_RUN` | 500 | A **stored** run's model-scoped artifacts disagree with its own identity. A data-integrity failure, never repaired on read. |

`COMPONENT_MODEL_MISMATCH` is deliberately distinct from the existing
`INVALID_SCENARIO_WEIGHTS`: malformed weights are a correctable input error, whereas
a model mismatch means the artifact cannot be applied to this run at all. Collapsing
them would push a client toward "fix your weights", which is the wrong instruction and
nudges toward exactly the remapping this boundary forbids.

---

## 5. Default-run resolution

An **unpinned** request (no `run_id`) resolves to the latest succeeded run *of one
component model*. That model is `component_model.DEFAULT_COMPONENT_MODEL`, currently
the historical one.

* Existing clients see **exactly today's behaviour**: every stored run is historical,
  so the answer is unchanged.
* A future successful run of another model **cannot** silently redefine every default
  view and every un-pinned shared link.
* A caller can scope explicitly with `?component_model_version=…` on `/runs`,
  `/runs/latest`, `/summary`, `/candidates`, or via `component_model_version` in a
  scenario request body.
* An explicitly pinned `run_id` still resolves to that run whatever model it belongs
  to, so any stored run stays inspectable. Naming a model as well asserts which model
  the caller believes it is, and a disagreement is refused rather than served.
* No run of the requested model → `404 NO_ANALYSIS_AVAILABLE`, naming the model.

**Changing `DEFAULT_COMPONENT_MODEL` is the rollout decision**, recorded as
`SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED` and owned by the product owner. It must
not be flipped as a side effect of any other work. No product default for a successor
model is invented here.

---

## 6. Scenario compatibility

Scenarios are computed on read; nothing is persisted server-side.

| Scenario weights | Run's model | Result |
| --- | --- | --- |
| historical | historical | **valid** — unchanged behaviour |
| historical | successor | `422 COMPONENT_MODEL_MISMATCH` |
| successor | historical | `422 COMPONENT_MODEL_MISMATCH` |
| successor | successor | `422 COMPONENT_MODEL_SCENARIOS_UNAVAILABLE` |
| anything else | any | `422 INVALID_SCENARIO_WEIGHTS` (unchanged) |

Weight validation is now **run-model-relative** rather than relative to a module
constant: `scenario.parse_and_validate_weights(raw, run.component_order)`. Its
strictness — rejecting both missing and unknown keys, with no repair, renormalization,
or positional remapping — is the load-bearing safety property of the entire scenario
path. It must never be loosened to "accept any subset and renormalize"; if it were,
every rejection above would become a silent cross-model recombination.

**Successor scenario creation is disabled**, not approximated. A successor
recombination would need an approved successor weight vector and normalization
strategy, and neither exists. Producing one anyway would present a fabricated
analytical result as the user's scenario.

**Nothing is ever auto-translated.** `Z → existing_burden`, `R → air_impact_proxy`,
`E → resident_impact`, `D → land_conversion` is not a mapping, positionally or by
name-similarity — the components are different measured quantities with different
derivations, resolutions, and directions. The `equity` / `existing_burden` pair is the
sharpest trap: `equity_score` is an *avoidance* score (`(1 − burden_percentile) × 100`,
so **lower** measured burden earns a **higher** score) while `existing_burden` names
the burden itself, and the citizen-facing UI already labels `equity` 「기존 지역 부담」.
The label similarity is a trap, not evidence of equivalence.

### Method version and scenario hash: deliberately unchanged

`USER_WEIGHT_SCENARIO_METHOD_VERSION` stays `user-weight-scenario-v1` and
`canonical_hash_payload` is untouched, so **every existing scenario hash is
byte-identical**. For every run that can exist today the run-relative rule resolves to
exactly the historical four keys, so no producible scenario's weight model, hash
payload, or quantization has changed.

**Required at successor-scenario enablement:** bump to `user-weight-scenario-v2` *and*
add the component model to the hash payload, so a successor scenario hash can never
collide with a historical one.

---

## 7. What the frontend will need (backend contract only)

The frontend is not modified by this work. This section states what the backend now
guarantees so a later frontend change can be a safe schema migration rather than a
guess.

1. **Model identity is available wherever weights or component scores are.** Every
   run-scoped response carries `component_model_version` and `component_order`. A
   saved scenario, a URL weight vector, and a session draft can each be stamped with
   the model they were created against, read from the run they were created against.

2. **Saved-scenario schema migration must be upgrade-in-place, not discard.** The
   current parser rejects any entry whose `schemaVersion` is not exactly the current
   constant, so a naive bump silently deletes every scenario a user has saved. The
   parser must first accept the older version and upgrade it in place by stamping
   `componentModel: "suitability-components-zred-v1"`.

   This is **labelling, not migration**: the old writer could only ever emit the four
   historical keys and the old validator could only ever admit them, so an old entry
   *cannot* represent any other model. Recording the model a record demonstrably used
   is a fact. Translating its weights onto different components would invent a user
   preference and attribute it to a real person, and is forbidden.

3. **Compatibility is decided by component model, not by run id.** The predicate is
   `saved.componentModel === activeRun.component_model_version`; run-id equality stays
   the softer secondary signal it is today. A third state is needed — same model /
   same run, same model / different run, **different model** — and the different-model
   state must not offer a "re-verify against the current run" affordance at all.
   Offering it and then failing with a 422 teaches the user that their scenario is
   *broken*, when it is in fact *valid for a different model*.

4. **Storage keys must not be bumped, only payload versions.** Changing a storage key
   orphans the old blob instead of reading and upgrading it, guaranteeing the data loss
   in point 2 and leaving dead bytes in the user's browser forever.

5. **URL weight parameters must become component-named.** `wz` / `wr` / `we` / `wd` are
   positional abbreviations whose letters are meaningless outside the historical model,
   and `we` — currently *equity* — is the natural abbreviation for `existing_burden`.
   Use explicit component-named keys so a parameter name can never be reinterpreted;
   do not mint new single letters. The backend deliberately did **not** extend the
   `wz/wr/we/wd` scenario-tile parameters to another model for the same reason.

6. **Component labels must be model-keyed.** A glossary entry, an export header, and a
   factor card must be selected by the run's `component_model_version` and ordered by
   its `component_order`, never by a module-level constant. Historical labels must stay
   byte-identical.

---

## 8. Export contract

There is **no backend export endpoint**: CSV/XLSX are assembled client-side from these
API responses. The backend's obligation is therefore to expose enough model identity
for an export layer to build model-correct headers, and to pin the rules that layer
must follow. `component_model.export_component_columns(version)` is that contract, and
generation stays dormant.

| Model | Export component columns |
| --- | --- |
| historical | `zoning_score`, `road_score`, `equity_score`, `demand_score` |
| successor | `existing_burden`, `air_impact_proxy`, `resident_impact`, `land_conversion` |

* Component columns come from the **run's** `component_order`, never from a
  module-level constant, so a historical export stays reproducible with its original
  headers and its original Z·R·E·D codes no matter which model the deployed code
  prefers.
* A successor value is never written under a legacy header.
* The two column sets are disjoint by construction, asserted by
  `assert_export_columns_disjoint()`. A shared header is how a successor number ends up
  read as a historical one by anything downstream of the file — a spreadsheet, a
  script, a citation.

An export *schema* version identifier is still worth introducing on the client side,
where the file layout actually lives; no backend surface carries one today.

---

## 9. CRITIC and stability isolation

No successor CRITIC weight is derived, no historical CRITIC output is reused, and no
successor stability classification is generated. Structural isolation was already
strong — both are computed per run and stored per run, with no global vector, no
cache, and no cross-run reuse path — and this work adds explicit guards so the
boundary is enforced rather than merely unreachable:

* `weight_derivation` now records `component_model_version` alongside its existing
  `criterion_order`, and the engine refuses to stamp a vector whose criterion order is
  not the model's component order.
* `stability_definition` now records `component_model_version`. Definitions written
  before the field existed carry no identity and are accepted unchanged — an unstamped
  historical definition is a definition from before the field was added, not a
  mismatch.
* `/summary` refuses to serve a CRITIC vector whose components are not the run's.
* `/candidates/{id}` refuses the `policy.STATIC_WEIGHT_PROFILES` fallback for a run of
  another component model. That fallback exists for pre-CRITIC runs of the model the
  policy module implements; falling back across models would attach a weighting
  justified for one set of quantities to a different set.

All four failures are `500 COMPONENT_MODEL_INCONSISTENT_RUN`: a stored row that
disagrees with itself is an integrity failure, not a caller error, and must never be
repaired on read.

Neither `CRITIC_METHOD_VERSION` nor `STABILITY_METHOD_VERSION` is bumped. The CRITIC
mathematics is unchanged and the criteria are identified per run; stability still
compares the same three profiles at the same 0.10 fraction with the same thresholds.
Bumping unchanged mathematics would misrepresent an unchanged method. The successor
foundation's normalization strategies both land on the policy-fixed `[0,100]`
beneficial scale, so no direction-aware CRITIC normalization is implied.

`successor.policy.critic_preflight()` is unchanged and still has no approved minimum
population.

---

## 10. Testing

| Tier | Runs | Covers |
| --- | --- | --- |
| SQLite (always) | `test_suitability_component_model.py`, `test_migration_component_model_sqlite.py`, `test_suitability_routes.py`, `test_suitability_scenario.py` | registry and guards, migration up/down over seeded rows, run-level API identity, default-run scoping, model-relative weight validation, tile-SQL generation |
| PostGIS (`TEST_DATABASE_URL`) | `test_suitability_routes_integration.py`, `test_suitability_scenario_routes_integration.py`, `test_migration_integration.py` | candidate-level serialization for both shapes, successor-shaped tiles, cross-model scenario rejection, JSONB defaults |

Successor-shaped runs in tests are **synthetic fixtures**, explicitly labelled as
such. No successor analysis is built, scored, or persisted anywhere, and none can be.

---

## 11. What remains blocked

Unchanged by this work, and all still open — see
`successor.policy.ACTIVATION_BLOCKERS`:

missing-component eligibility policy · successor weight vector · per-component
normalization strategy · `resident_impact` distance floor · `resident_impact`
population resolution and representative point · developed/artificial land-cover class
registry · ambiguous land-cover treatment · `land_conversion` score direction ·
`air_impact_proxy` grain, coverage, and numerator basis · successor eligible-population
measurement · successor CRITIC and stability validation · production default-run
switchover.

One blocker was re-scoped rather than closed: `SUCCESSOR_PERSISTENCE_NOT_DESIGNED`
became **`SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED`**. The schema and the API contract
are applied; nothing writes a successor run, and doing so requires the eligibility
policy, an approved weight vector, and a normalization strategy first.

`SUCCESSOR_POLICY_VERSION` and `SUCCESSOR_DERIVATION_VERSION` remain `None`,
`SUCCESSOR_WEIGHT_PROFILES` remains empty, and `assert_activated()` still raises.
