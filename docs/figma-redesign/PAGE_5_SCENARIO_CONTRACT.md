# Page 5 scenario contract (produced by Page 4D)

**Status:** frozen by Page 4D. Page 5A implements against this document; nothing in
it may change meaning without a version bump.

Page 4D (`④ 시나리오 저장`, `⑤ 비교할 시나리오 선택`) produces a *question*: two named
weight vectors and the run they were verified against. Page 5A produces the
*answer*. This document is the seam between them.

The single rule everything else follows from:

> **Storage is a bookmark, not evidence.** What Page 4D persists is weights and
> metadata. Every score, rank, band and candidate on Page 5 must be re-derived from
> `POST /api/v1/suitability/scenarios/preview` against the run currently on screen.

---

## 1. `SavedScenario`

Defined in `frontend/src/lib/savedScenarios.ts`. This is the whole persisted shape;
there is no other field, and no field is optional at rest.

```ts
interface SavedScenario {
  schemaVersion: number;            // === SAVED_SCENARIO_SCHEMA_VERSION (1)
  id: string;                       // matches SAVED_SCENARIO_ID_RE; stable forever
  name: string;                     // trimmed, 1..15 code points
  weights: UserScenarioWeights;     // canonical Z/R/E/D decimal strings
  runId: number;                    // positive integer; the verified run
  profileSource: string | null;     // provenance only (e.g. "baseline", "critic")
  createdAt: string;                // ISO 8601, frozen at creation
  updatedAt: string;                // ISO 8601, moves on rename
}
```

**`weights` is the repository's canonical weight type** — `UserScenarioWeights` from
`lib/api.ts`, the same type the preview API accepts and returns and the same one
`lib/urlState.ts` carries in `wz`/`wr`/`we`/`wd`. There is deliberately no second
weight model: integer percents belong to the editor (`lib/scenario.ts`), and
`percentsToCanonical` is the one bridge between them. The stored values are the
**server's** `canonical_weights` echo, not the client's copy.

**`id` never changes.** Not on rename, not on reselect, not on a weight edit (there
is no weight edit — a different weight vector is a different scenario). This is what
lets `cmpA`/`cmpB` survive in a link a reader already shared.

**`profileSource` is provenance, never a claim.** It records which stored profile the
weights were taken from so a row can say where its numbers came from. It does **not**
mean the saved scenario *is* that official profile, and Page 5 must not present it
as one. A scenario whose weights happen to equal `baseline` is still a user scenario
and carries the user-scenario disclaimer.

**What is deliberately absent:** no score, no rank, no `scenario_hash`, no candidate
list, no A/B/C band, no tile URL, no `total_matched`. Those describe one run at one
moment; a stored copy would go stale while still looking authoritative. See §6.

---

## 2. Storage

| | |
|---|---|
| Key | `waste-equity:suitability-saved-scenarios:v1` |
| Medium | `localStorage` (persists across reload and tab close) |
| Envelope | `{ schemaVersion: 1, scenarios: SavedScenario[] }` |
| Cap | 20 (`SAVED_SCENARIO_CAP`) |
| Name limit | 15 code points (`SAVED_SCENARIO_NAME_MAX_LENGTH`) |

This is **not** `waste-equity:suitability-scenario:v1` — that is the existing
single-draft **sessionStorage** key for the 후보지 심층 비교 weight editor
(`lib/scenario.ts`), with a different shape, a different lifetime and a live
consumer. The two never read or write each other, and the legacy editor flow is
untouched by Page 4D.

localStorage was chosen over backend persistence because there is no user-account or
ownership model in this product: a server-side scenario row would have no owner, no
access rule and no deletion story. The consequence is stated to the reader in the UI
(`SAVED_SCENARIO_STORAGE_NOTICE`), not implied.

### Storage API (the only module that touches storage)

```ts
readSavedScenarios(): { scenarios: SavedScenario[]; warnings: string[] }
saveScenario(input, options?): SavedScenarioWriteResult
renameSavedScenario(id, name, options?): SavedScenarioWriteResult
deleteSavedScenario(id): SavedScenarioWriteResult
clearSavedScenarios(): void
resolveComparisonPair(scenarios, aId, bId): ComparisonResolution
scenarioRunState(scenario, activeRunId): "CURRENT_RUN" | "OTHER_RUN"
isCanonicalWeights(value): value is UserScenarioWeights
scenarioNameProblem(raw): "INVALID_NAME_EMPTY" | "INVALID_NAME_TOO_LONG" | null
scenarioNameLength(raw): number   // code points, not UTF-16 units
```

`SavedScenarioWriteResult` is a discriminated union that **always** carries the new
list and its warnings, so a caller never has to guess what the store now holds
(another tab may have written in between):

```ts
type SavedScenarioWriteResult =
  | ({ ok: true;  scenario: SavedScenario } & { scenarios; warnings })
  | ({ ok: false; reason: SavedScenarioWriteFailure; message: string } & { scenarios; warnings })

type SavedScenarioWriteFailure =
  | "STORAGE_UNAVAILABLE" | "QUOTA_EXCEEDED"
  | "INVALID_NAME_EMPTY"  | "INVALID_NAME_TOO_LONG"
  | "INVALID_WEIGHTS"     | "INVALID_RUN"
  | "CAP_REACHED"         | "NOT_FOUND"
```

`message` is citizen-facing Korean and is safe to render directly.

### Guarantees Page 5A may rely on

1. **`readSavedScenarios` never throws and never returns `null`.** Malformed JSON, a
   wrong schema version, a bad id, invalid weights, a missing `runId` or a duplicated
   id are dropped **per entry** with a plain-Korean warning; the surviving scenarios
   are returned. Bad stored data must not take a page down.
2. **Duplicate ids: first occurrence wins.** A duplicate would make rename and delete
   ambiguous and would let one `cmpA` resolve to two different weight vectors.
3. **Nothing is ever evicted.** At the cap, a new save is *refused* with
   `CAP_REACHED`. A stored list already over the cap is displayed in full — the cap
   gates new saves only.
4. **A refused write leaves the store byte-identical.** Including a quota rejection.
5. **`weights` is rebuilt key by key on read**, so an extra property on a
   hand-edited stored object cannot ride along into a request body.

---

## 3. `cmpA` / `cmpB`

Added to `lib/urlState.ts` as `AppUrlState.cmpA` / `.cmpB`, both `string | null`.

```
?v=1&mode=suitability&view=scenario&cmpA=<saved id>&cmpB=<saved id>
```

* **Values are saved-scenario ids, not weights.** The legacy `wz`/`wr`/`we`/`wd` +
  `cmpProfile` keys still carry one ad-hoc scenario's weights and are completely
  unaffected; both spellings coexist in one link without either changing the other's
  meaning (§5).
* **Written only in `mode=suitability`**, and in **both** sub-views — the pair is
  chosen on `view=score` (Page 4) and consumed on `view=scenario` (Page 5).
  Restricting it to the destination view would make a half-made selection
  unshareable.
* **The slots are independent.** A lone `cmpB` is legal and is written: the reader
  can pick both and then clear A, and suppressing B would make the link disagree
  with the screen.
* **A and B must differ.** The encoder refuses to write `cmpB === cmpA`; the decoder
  keeps A and drops B with a warning. A scenario compared with itself is not a
  comparison.
* **Only the shape is validated here** (`SAVED_SCENARIO_ID_RE`). A malformed id is
  dropped with a warning. A **well-formed id that this browser does not hold is
  KEPT** — a link shared from another device is not malformed, and dropping it would
  look like the reader had simply not chosen anything.
* `suitScope`, `suitSort`, and every Page 1/2/3 key are unchanged.

### Resolution

```ts
resolveComparisonPair(scenarios, cmpA, cmpB): {
  a: ComparisonSlotResolution;      // { slot, id, scenario, state }
  b: ComparisonSlotResolution;
  selectedCount: number;            // the (선택 N/2개) counter
  complete: boolean;                // two distinct RESOLVED scenarios
}

type ComparisonSlotState = "EMPTY" | "RESOLVED" | "MISSING";
```

`MISSING` — an id **was** requested and nothing in storage matches it — is an
explicit, renderable state and **must** be shown as such. Page 4D's wording:

> 이 링크가 가리키는 시나리오를 이 브라우저에서 찾을 수 없습니다. 시나리오는 저장한
> 브라우저에만 남아 있습니다.

A blank slot in its place would read as "you have not chosen yet", which is a
different and false statement.

`complete` is the only signal that a comparison is even askable. It is **not**
sufficient — see §4.

---

## 4. Run validation

`runId` exists so a stored scenario can be *checked* rather than assumed.

```ts
scenarioRunState(scenario, activeRunId)
//  "CURRENT_RUN"  → the scenario was verified against the run on screen
//  "OTHER_RUN"    → it was not (including activeRunId === null)
```

Rules Page 5A must keep:

1. **Never present an `OTHER_RUN` scenario's comparison as current.** Its weights
   were verified against a different frozen set of component scores, so the two
   sides of the comparison would not be measuring the same thing.
2. **`activeRunId === null` is `OTHER_RUN`, never a match by default.** An unknown
   run is not a matching run.
3. Page 4D refuses the CTA when either slot is `OTHER_RUN` and shows:
   > 다른 분석 실행에서 저장된 시나리오입니다. 현재 실행 기준으로 다시 확인해야 합니다.
4. **Page 5A must repeat the check.** A pair can reach it as `OTHER_RUN` through a
   shared link, a run change between Page 4 and Page 5, or a hand-edited URL. Page
   4D's refusal is a courtesy, not a guarantee.

An `OTHER_RUN` scenario is still shown in the saved list in full — the weights are
the reader's. It is the *comparison* that is withheld, not the record.

---

## 5. Legacy Page-5 links

The pre-4D scenario link keeps working unchanged:

```
?v=1&mode=suitability&view=scenario&wz=..&wr=..&we=..&wd=..&cmpProfile=..&cand=..
```

* `wz`/`wr`/`we`/`wd` still decode into `AppUrlState.weights`, still auto-apply
  through the preview API on mount, and still take precedence over the
  sessionStorage draft in `SuitabilityScenarioLab`.
* `cmpProfile` still selects the stored comparison profile.
* `cand` still restores the selected candidate.
* Such a link produces `cmpA === cmpB === undefined` and no warning.
* A link may legally carry **both** spellings; neither changes the other's meaning.

Regression coverage: `lib/urlState.test.ts` ("does not disturb the legacy Page-5
scenario link", "carries the legacy weights and the new pair in one link") and
`app/page.page4d.test.tsx` ("legacy Page-5 links").

---

## 6. Required revalidation flow

Page 5A **must** follow this order. Each arrow is a step that can fail, and each
failure has a distinct, nameable state.

```
1. resolve      resolveComparisonPair(readSavedScenarios().scenarios, cmpA, cmpB)
                  → EMPTY   : the reader has not chosen. Say so; offer Page 4.
                  → MISSING : the id is not in THIS browser. Say so (§3).
                  → RESOLVED: continue.

2. verify run   scenarioRunState(scenario, activeRunId)
                  → OTHER_RUN: do NOT compare. Offer re-verification (§4).
                  → CURRENT_RUN: continue.

3. revalidate   POST /api/v1/suitability/scenarios/preview
                  { run_id, weights, compare_profile, top_n }
                  once PER SIDE.
                  → 422 INVALID_SCENARIO_WEIGHTS: render the backend's own
                    `detail` (it names the offending value). Compare nothing.
                  → 200: use `canonical_weights`, `run_id`, and the scores/ranks
                    from THIS response.

4. display      Everything shown comes from step 3. Nothing comes from storage
                except the name, and the run/weight metadata already verified.
```

**Do not persist step 3's output.** Not to `localStorage`, not into the
`SavedScenario`, not into the URL. If a result needs to survive a reload, it is
recomputed — that is the entire reason the run id is stored.

Page 4D already applies steps 2–3 at **save** time (`app/page.tsx`
`handleSaveScenario`): the weights are previewed with `top_n: 1` before anything is
written, and the persisted `weights`/`runId` are the response's `canonical_weights`
and `run_id`. So every stored scenario is one the analysis engine accepted for that
run at least once. That is a floor, not a substitute for step 3.

---

## 7. Extension point: official profiles as a comparison side

The planning audit asks that Page 5 eventually compare an **official stored profile**
against a saved user scenario. Page 4D deliberately does **not** implement this — the
phase is scoped to saved user scenarios — but the contract is shaped so it can be
added without a breaking change:

* `SAVED_SCENARIO_ID_RE` is `/^[A-Za-z0-9_-]{1,64}$/`. **`:` is excluded**, so a
  reserved `profile:<key>` prefix can never collide with an id this module has ever
  minted.
* The current decoder therefore **drops** `cmpA=profile:critic` with a warning
  (a `:` fails the shape screen). That is the correct behaviour today: the feature
  does not exist, and a link claiming it must not half-work.
* When it is implemented, widen the slot type rather than overloading the id:

  ```ts
  type ComparisonSide =
    | { kind: "saved";   id: string }
    | { kind: "profile"; profile: SuitabilityProfile };   // reserved
  ```

  `resolveComparisonPair` then resolves a `saved` side against storage and a
  `profile` side against `run.weight_profiles` — which is already the authority ②
  계산 모델 가중치 설정 reads. Both sides still go through step 3; an official
  profile's weights are canonicalised by the same endpoint.
* `profileSource` on a `SavedScenario` is **not** this feature. It is provenance on a
  user scenario and must never be rendered as "this is the official profile".

---

## 8. Test coverage that pins this contract

| Concern | File |
|---|---|
| Storage: save/list/rename/delete, id stability, name rules, schema version, corrupt JSON, invalid weights, duplicate ids, quota, cap, A/B resolution | `frontend/src/lib/savedScenarios.test.ts` (49) |
| `cmpA`/`cmpB` encode/decode, distinctness, invalid ids, legacy link compatibility | `frontend/src/lib/urlState.test.ts` |
| ④ card: empty state, save gating, rename, delete, browser-only disclosure, run mismatch | `frontend/src/components/suitability/SuitabilityScenarioSaveCard.test.tsx` |
| ⑤ card: no defaults, N/2 counter, CTA gating, MISSING slot, cross-run refusal | `frontend/src/components/suitability/SuitabilityScenarioComparePicker.test.tsx` |
| Page integration: preview revalidation, "no result is persisted", delete clears A/B, rename keeps the id, URL round-trip, legacy links, hostile storage | `frontend/src/app/page.page4d.test.tsx` (27) |
| Real browser: persistence across reload, rename across reload, A/B → URL, dangling-selection clearing, corrupt blob | `frontend/e2e/page4dScenarios.spec.ts` (8) |
