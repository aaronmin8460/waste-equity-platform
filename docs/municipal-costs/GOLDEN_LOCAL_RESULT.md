# GOLDEN_LOCAL_RESULT — the municipal-cost release contract

Status: **specification only. No golden result exists yet.** It can only be
generated after Lanes A/B/C/D are integrated, from the final source snapshot and
the final code. Nothing in this document has been executed against production.

Companion documents: [`DEMO_RELEASE_RUNBOOK.md`](DEMO_RELEASE_RUNBOOK.md),
[`2024_REFRESH_SOURCE_AUDIT.md`](2024_REFRESH_SOURCE_AUDIT.md),
[`METHODOLOGY.md`](METHODOLOGY.md), [`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md),
[`STEP_4_PRODUCTION_RELEASE.md`](STEP_4_PRODUCTION_RELEASE.md).

Tooling: [`scripts/deployment/municipal_cost_release_result.py`](../../scripts/deployment/municipal_cost_release_result.py)
(`inventory` · `build` · `check` · `compare`), tested by
[`ingestion/tests/test_municipal_cost_release_result.py`](../../ingestion/tests/test_municipal_cost_release_result.py).

---

## 1. What it is

One JSON document that pins **everything a municipal-cost release asserts**, so
that the production run can be proved identical to the reviewed local run rather
than assumed identical. It is the single gate between "we ran a dry run" and "we
wrote to production".

It is **not** an approval of any particular number. The
`45 / 7 / 14` distribution measured on 2026-08-13 is explicitly **provisional
and not a production expectation** — the two semantic blockers in
[`2024_REFRESH_SOURCE_AUDIT.md`](2024_REFRESH_SOURCE_AUDIT.md) §5 are unresolved
and Lane A is correcting them. Only the final, semantics-corrected, integrated
local dry run may be frozen as the golden result.

A lower AVAILABLE count with truthful semantics is a better release than a
higher one with fabricated completeness. The count is never the gate; the
equivalence and the invariants are.

## 2. What it contains

| Requirement | Where it lives in the artifact |
| --- | --- |
| release code SHA | `comparable.release_sha` |
| source ZIP SHA | `comparable.source_inventory.archive_sha256` |
| source workbook SHA inventory | `comparable.source_inventory.files[].sha256` |
| deterministic aggregate over the source set | `comparable.source_inventory.digest` |
| source file count | `comparable.source_inventory.file_count` |
| accepted / rejected files | `comparable.source_files.{accepted,rejected}`, `comparable.rejected_files[]` |
| expected 66-municipality registry | `comparable.registry.{expected,built}` |
| metropolitan counts | `comparable.registry.by_metropolitan` (11/28/41) |
| final AVAILABLE / PARTIAL / UNAVAILABLE | `comparable.indicator.counts` |
| per-municipality status | `comparable.municipalities[].status` |
| per-municipality eligible numerator | `comparable.municipalities[].numerator_krw` |
| per-municipality per-capita value | `comparable.municipalities[].value` |
| reason codes | `comparable.municipalities[].reason_codes` |
| parser / ingestion version | `comparable.transformation_version` |
| methodology version | `comparable.methodology_version` |

Plus the denominator provenance that makes those values reproducible:
`municipalities[].population` and `population_method`, the derived-population
cities, the observation counts, and the deterministic `warnings`.

Structure:

```
{
  "artifact": "municipal-cost-golden-local-result",
  "artifact_version": "1",
  "comparable_sha256": "…",     # sha256 over canonical JSON of `comparable`
  "comparable": { … },          # the ONLY thing compared
  "provenance": { … }           # recorded, never compared
}
```

## 3. What is deliberately excluded from the comparison

| Field | Why it is provenance, not contract |
| --- | --- |
| `source_dir` | an absolute private path; it must never reach an artifact or a payload. Only its basename is kept. |
| `mode` / `status` | a dry run and a write legitimately differ (`DRY_RUN_OK` vs `SUCCEEDED`) |
| `ingestion_run_id` | a per-host run counter; production and local will never agree |
| `writes` / `idempotent_no_op` | describe the transition, not the result |

Everything else is compared **exactly**, including per-municipality values to the
last decimal place. `municipalities[]` is sorted by `municipality_key` and
`warnings[]` is sorted, so list order can never mask a difference or create a
false one.

## 4. Building it

```bash
# after the integrated local dry run, from the repository root
scripts/deployment/municipal_cost_release_result.py build \
  --report   artifacts/municipal-costs/final/dry_run.json \
  --release-sha "$(git rev-parse HEAD)" \
  --source-dir data/import/municipal-costs/<final-tree> \
  --archive    data/import/municipal-costs/incoming/2024/<delivery>.zip \
  --label 'integrated local dry run' \
  --out artifacts/municipal-costs/final/GOLDEN_LOCAL_RESULT.json
```

The tool **refuses** to write into a Git-tracked path. `artifacts/municipal-costs/`
is Git-ignored, which is where it belongs: the artifact names every source
workbook, and no municipal source artifact is ever committed. Publish only its
`comparable_sha256` and the aggregate counts in the release report.

## 5. Freezing it

```bash
scripts/deployment/municipal_cost_release_result.py check \
  --golden artifacts/municipal-costs/final/GOLDEN_LOCAL_RESULT.json \
  --expect-available   <A> --expect-partial <P> --expect-unavailable <U> \
  --require-status      '28-남동구=PARTIAL' \
  --require-reason-code '28-남동구=PARTIAL_WASTE_SCOPE' \
  --require-reason-code '28-부평구=PARTIAL_WASTE_SCOPE' \
  --require-reason-code '28-옹진군=PARTIAL_GEOGRAPHIC_SCOPE' \
  --require-reason-code '41-가평군=PARTIAL_PERIOD_COVERAGE' \
  --require-reason-code '28-계양구=PAYMENT_PERIOD_COVERAGE_INCOMPLETE'
```

`check` enforces, and exits non-zero on the first failure of:

1. reference year 2024 and the exact indicator code;
2. a non-empty release SHA;
3. `registry.expected == registry.built == 66` and `11/28/41 = 25/10/31`;
4. exactly 66 municipality rows, no duplicate key;
5. `AVAILABLE + PARTIAL + UNAVAILABLE == 66`, no unknown status bucket, and the
   bucket counts agreeing with the rows themselves;
6. **missing is never zero** — no row holds `0` in `value` or `numerator_krw`,
   every `UNAVAILABLE` row is `null` in both, and every `AVAILABLE`/`PARTIAL` row
   has a real value, a real numerator and a positive population;
7. `discovered == parsed`, `accepted + rejected == parsed`, and
   `len(rejected_files) == rejected`;
8. a present, self-consistent source inventory whose `file_count` equals
   `source_files.discovered` and whose digest recomputes;
9. no absolute filesystem path anywhere in the comparable core;
10. any `--expect-*` / `--require-*` expectation the operator supplies.

The `--require-reason-code` flags above are how the *five reviewed limitations*
(§5a of the refresh audit) are held in place: if Lane A's semantic work
reinstates them and a later change silently drops one again, `check` fails. The
exact set to require is Lane A's output — the five above are the ones the audit
identified, not an approved list.

## 6. Comparing production against it

On the production host, build the **same artifact** from the production dry-run
report and the production copy of the source, then compare:

```bash
scripts/deployment/municipal_cost_release_result.py build \
  --report /home/ubuntu/private/municipal-cost-reports/prod_dry_run.json \
  --release-sha "$(git rev-parse HEAD)" \
  --source-dir /home/ubuntu/private/municipal-costs/<final-tree> \
  --archive    /home/ubuntu/private/municipal-costs/<delivery>.zip \
  --label 'production dry run' \
  --out /home/ubuntu/private/municipal-cost-reports/PROD_DRY_RUN_RESULT.json

scripts/deployment/municipal_cost_release_result.py compare \
  --golden    GOLDEN_LOCAL_RESULT.json \
  --candidate PROD_DRY_RUN_RESULT.json
```

Any difference at all prints the exact JSON path and exits 1. **That is a full
stop, not a discussion.** The comparison covers the release SHA, so a host
running different code fails immediately; `--allow-release-sha-difference` exists
for diagnosis only and must never be used to wave a release through.

Both artifacts are verified against their own `comparable_sha256` before the
comparison, so an artifact edited after it was built is refused rather than
compared.

### What a difference actually means

| Difference | Cause |
| --- | --- |
| `release_sha` | the host is not running the reviewed code |
| `source_inventory.*` | the transferred workbooks are not the reviewed bytes |
| `municipalities[].population` | the SGIS denominator data differs between the two databases — reconcile before anything else; every per-capita value depends on it |
| `municipalities[].value` / `.numerator_krw` | a real accounting difference: stop |
| `municipalities[].reason_codes` | a limitation appeared or disappeared |
| `source_files.*` / `rejected_files` | the source tree is not the reviewed set |

## 7. Privacy rules the artifact obeys

- No workbook bytes, no cell contents — only SHA-256, size, and the path
  relative to the source root (the same provenance grain the public API already
  discloses).
- No absolute path: `build` drops `source_dir` and keeps only its basename;
  `check` fails the artifact if `/home/`, `/Users/`, `/srv/`, `/root/` or a
  Windows drive prefix appears anywhere in the comparable core.
- Never committed: the tool refuses any output path inside a Git working tree
  that is not Git-ignored.
- No credential is read, stored, or printed; the tool opens no socket and no
  database connection.

## 8. Known properties worth stating plainly

- The ingestion dry run **does** read the database for the denominator (the
  registry populations come from `regions` / `regional_population`), so the
  golden comparison implicitly asserts the two environments hold the same
  population inputs. That is intended.
- The dry run makes **zero writes**, so building the production artifact before
  the write is safe and fully reversible; the only preceding change is the code
  deployment, which rolls back cleanly.
- The artifact says nothing about whether the *numbers are right* — it says the
  production load is the load that was reviewed. Correct semantics are Lane A's
  responsibility and the reviewed methodology's.
