# Municipal-cost demo release — OCI runbook

Status: **NOT EXECUTED. Preparation only.** Nothing in this document has been
run against production, no production data has been written, and no production
infrastructure has been modified. Prepared on the integration baseline
`fa3b38f8481d5b57278cc4fbd3868efb4169be2a` (branch `ops/municipal-demo-release`).

This runbook drives the release through the repository's **existing, reviewed
tooling** — `scripts/deployment/*.sh`, the `waste-equity-prod` Compose project,
and the conventions in [`../OPERATIONS_RUNBOOK.md`](../OPERATIONS_RUNBOOK.md) and
[`../OCI_DEPLOYMENT_CHECKLIST.md`](../OCI_DEPLOYMENT_CHECKLIST.md). It introduces
no second deployment architecture. The four municipal-cost helpers it adds are
read-only verification, not deployment machinery.

Companion documents: [`GOLDEN_LOCAL_RESULT.md`](GOLDEN_LOCAL_RESULT.md),
[`STEP_4_PRODUCTION_RELEASE.md`](STEP_4_PRODUCTION_RELEASE.md) (the previous
executed release, and the model for this one),
[`2024_REFRESH_SOURCE_AUDIT.md`](2024_REFRESH_SOURCE_AUDIT.md),
[`METHODOLOGY.md`](METHODOLOGY.md), [`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md).

---

## 0. Preconditions this runbook does not own

| Owner | Must be complete before step 1 |
| --- | --- |
| Lane A | the two semantic blockers of [`2024_REFRESH_SOURCE_AUDIT.md`](2024_REFRESH_SOURCE_AUDIT.md) §5 — the five silently-lost limitations and the non-collection-and-transport contracts in the numerator |
| Lane B | Page 2 frontend |
| Lane C | API contract QA |
| Integration | one branch containing A+B+C+D, tests green, working tree clean |

**The provisional `45 / 7 / 14` distribution must not be treated as the expected
release outcome.** It was measured before the semantic corrections. The only
approved expectation is whatever the final integrated local dry run produces and
`check` accepts.

### 0.1 Superseded source files — RESOLVED at integration (option 1)

> **Status: resolved.** The integration took **option 1** below: the loader now
> reconciles superseded source files itself, inside the authoritative write
> transaction. `municipal-cost-verify-api.sh --golden` still fails loudly on a
> union, so the gate that would have caught the blocker stays in place as a
> regression check rather than as the decision point.
>
> The reviewed semantics, the scope limits, the dry-run guarantee and the
> historical-auditability argument are written up in
> [`METHODOLOGY.md` §10](METHODOLOGY.md). Ten regression tests pin the behaviour
> (`ingestion/tests/test_municipal_cost_ingestion.py`, "Authoritative source
> refresh"), and six of them fail if the retirement or either pre-commit gate is
> removed.
>
> Consequences for this runbook:
>
> - the production `--write` at step 32 retires the 64 superseded rows and their
>   contracts and quantities; the run report lists every one under
>   `retired_source_files`, and `writes.source_files_retired` must equal the
>   number of previously-stored workbooks that the refresh does not re-deliver;
> - the pre-write database backup (step 20) is what makes that reversible —
>   take it, verify it, and do not skip it;
> - the production **dry run** at step 31 still retires nothing, so the
>   pre-write and post-dry-run states must be identical;
> - `meta.source_coverage.discovered_file_count` after the write must equal the
>   delivered workbook count, not the union.
>
> The original analysis is kept below because it is what the decision was made
> against.

Production currently holds the **previous** 2024 delivery (64 workbooks,
20/5/41, ingestion runs 601/602). The refresh is a different delivery with
different bytes and different filenames.

`_upsert_source_files()` keys `municipal_cost_source_files` on the workbook
**SHA-256** and has **no delete path** for a stored file whose SHA is absent
from the new source tree. Contracts and quantities are delete-and-reinserted
*per processed source file*, so a workbook that is no longer delivered is never
processed and its children survive too. Indicator values are recomputed from the
in-memory parse and stay correct — but:

- `municipal_cost_source_files` ends holding both deliveries;
- `GET /api/v1/landfill/municipal-costs` selects **every** source file for the
  year (`municipal_costs.py:275`, `:388`), so `meta.source_coverage` and each
  row's `source_files[]` provenance would describe the union, not the release;
- `quantity_coverage` is read from the database and would mix both deliveries.

Decide **before** step 32, and record the decision:

1. Lane A adds a reviewed reconciliation that retires superseded source files
   (preferred — it makes the loader self-consistent); or
2. the release performs an explicit, reviewed, backed-up deletion of the
   superseded rows inside the release transaction; or
3. the release accepts the union and the golden result is built from a local
   database that starts in the **same** pre-write state as production (see step
   16.1) — in which case local and production remain comparable, but the served
   coverage no longer describes the delivery.

Option 3 is only defensible if step 16.1 proves the two pre-write states are
identical. `municipal-cost-verify-api.sh --golden` fails loudly on this exact
mismatch, so it cannot pass unnoticed.

---

## 1. Stage A — freeze the local result (steps 1–6)

**1. Verify the integration working tree is clean.**

```bash
git status --short && git rev-parse HEAD && git branch --show-current
```

Zero output from `git status --short`, or stop.

**2. Record the exact release SHA.**

```bash
RELEASE_SHA="$(git rev-parse HEAD)"; echo "$RELEASE_SHA"
```

**3. Confirm the relationship to `origin/main`.**

```bash
git fetch --all --tags
git merge-base --is-ancestor origin/main HEAD && echo "forward-only from origin/main"
git log --oneline origin/main..HEAD
```

Record whether the release SHA is on `origin/main` or is an integration branch
that must be pushed first — `deploy.sh --ref` fetches from the remote, so an
unpushed SHA cannot be deployed.

**4. Run the complete local validation.**

```bash
cd backend   && ./.venv/bin/python -m pytest -q && ./.venv/bin/ruff check . && ./.venv/bin/python -m mypy
cd ../ingestion && ./.venv/bin/python -m pytest -q && ./.venv/bin/ruff check .
cd ../frontend  && npm test -- --run && npx playwright test
python3 -m pytest ingestion/tests/test_municipal_cost_release_result.py -q   # release helpers
```

The backend suite carries ~11 pre-existing failures (head pinned to `0016` plus
missing test-DB seed rows). Prove no regression by comparing against a worktree
of `origin/main` with two identically-empty databases — do not accept "it was
already failing" without that comparison.

**5. Run the final LOCAL municipal-cost dry run.** Zero writes; the source tree
is Git-ignored and the report path is Git-ignored.

```bash
cd ingestion
DATABASE_URL="postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity" \
  ./.venv/bin/waste-equity-probe municipal-costs-ingest --dry-run \
    --source-dir ../data/import/municipal-costs/<final-tree> \
    --report-path ../artifacts/municipal-costs/final/dry_run.json
```

Prove the zero-write claim with a before/after fingerprint that includes
`max(id)` on every table, not just row counts — the pattern in
[`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md) §4 and
[`2024_REFRESH_SOURCE_AUDIT.md`](2024_REFRESH_SOURCE_AUDIT.md) §4.

**6. Build, check, and freeze GOLDEN_LOCAL_RESULT.**

See [`GOLDEN_LOCAL_RESULT.md`](GOLDEN_LOCAL_RESULT.md) §4–5 for the exact
`build` and `check` invocations. Record `comparable_sha256`. From this point the
artifact is immutable: any later change means a new local dry run and a new
freeze, not an edit.

---

## 2. Stage B — production preflight and backup (steps 7–19)

All of Stage B is read-only except the backup, which only adds a file.

> The SSH key is passphrase-protected. Put `ssh-add --apple-load-keychain` inline
> in **every** ssh invocation, not once per shell.

**7–11. Host preflight, disk, memory, container health, expected services.**

```bash
alias dcp='docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production'
./scripts/deployment/municipal-cost-preflight.sh --min-disk-gb 10 \
  | tee ~/release-baselines/preflight-pre.txt
./scripts/deployment/check-production-env.sh .env.production
```

`municipal-cost-preflight.sh` covers steps 7–13 in one read-only pass and fails
on: a dirty worktree, more than one Alembic head in code, fewer than
`--min-disk-gb` free, any required service not running or not healthy, any
non-zero restart count, `alembic_version` holding other than exactly one row, a
stored indicator `0`, and any `UNAVAILABLE` row carrying a value. `caddy`
defines no healthcheck in this repository — an empty health value is expected,
not a failure.

**12. Record the production deployed SHA before any change.**

```bash
git rev-parse HEAD; git status --short; git log --oneline -3
```

Set `ROLLBACK_COMMIT` to this value. **Read it from the host — never assume it
equals `main`.** Production has repeatedly run a *detached* HEAD ahead of
`main`.

**13. Record the current migration head.** Captured by the preflight as
`alembic.db_revision` (expected `0021`) and `alembic.db_rows` (must be `1`).

**14. Capture the baseline production API results.**

```bash
./scripts/deployment/smoke-test.sh --base-url https://<origin> --expect-data
curl -fsS "https://<origin>/api/v1/landfill/municipal-costs?year=2024" \
  > ~/release-baselines/municipal-pre.json
```

`/ready` returns 404 — this repository defines no such route and `/health` is the
readiness probe. Pre-existing, not a defect.

**15. Capture the official landfill regression baseline.**

```bash
./scripts/qa/municipal-cost-landfill-regression.sh capture \
  --base-url https://<origin> --out ~/release-baselines/landfill-pre
```

**16. Create the production PostgreSQL backup** using the repository convention
(`OPERATIONS_RUNBOOK.md` → *Backups*), into the Git-ignored `backups/`:

```bash
mkdir -p backups
set -o noclobber
dcp exec -T database pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  > backups/prod_pre_municipal_refresh_$(date +%Y%m%d_%H%M%S).dump
```

**16.1. Record the pre-write municipal fingerprint** (needed for step 33 and for
the §0.1 decision):

```bash
dcp exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "
SET default_transaction_read_only = on;
SELECT (SELECT count(*) FROM municipal_cost_geographies)
  ||'|'|| (SELECT count(*) FROM municipal_cost_source_files)
  ||'|'|| (SELECT count(*) FROM municipal_waste_contracts)
  ||'|'|| (SELECT count(*) FROM municipal_waste_quantities)
  ||'|'|| (SELECT count(*) FROM municipal_cost_indicator_values)
  ||'|'|| (SELECT coalesce(sum(value)::text,'-') FROM municipal_cost_indicator_values)
  ||'|'|| (SELECT md5(string_agg(reason_codes::text, ',' ORDER BY id))
             FROM municipal_cost_indicator_values);"
```

**17. Verify the backup is a real, readable archive.** `pg_restore` must be able
to **seek the file** — piping the dump into a container's `pg_restore` fails on
the header seek and is not evidence of corruption. Mount `backups/` **read-only**
into a throwaway container, exactly as the previous release did:

```bash
docker run --rm -v "$PWD/backups:/b:ro" postgis/postgis:16-3.4 \
  pg_restore -l /b/<dump> | head -5
```

Record: exit 0, the TOC entry count, that `landfill_inbound_monthly` is present,
and the Alembic revision the snapshot represents.

**18. Verify the backup SHA-256** and record size and hash:

```bash
sha256sum backups/<dump>; stat -c '%s' backups/<dump>
```

**19. Prepare the rollback reference.** Write down `ROLLBACK_COMMIT`, the backup
path, its SHA-256, and the revision it represents. Confirm the rollback target
is fetchable (`git cat-file -e "$ROLLBACK_COMMIT^{commit}"`). See §6.

---

## 3. Stage C — private source transfer (steps 20–22)

**20. Transfer the source OUTSIDE the Git checkout.** The `ingestion` service in
`docker-compose.prod.yml` bind-mounts **no** repository directory, so an ad-hoc
mount is required regardless; the source therefore has no reason to be inside
the working tree and must not be.

```bash
rsync -rlt --exclude '.DS_Store' \
  <local-final-tree>/ ubuntu@<host>:/home/ubuntu/private/municipal-costs/<final-tree>/
```

No `--delete` (never let a transfer remove anything). Do not open, resave, OCR,
or rewrite a workbook at any point.

**21. Verify the private directory permissions.**

```bash
chmod 700 /home/ubuntu/private /home/ubuntu/private/municipal-costs
find /home/ubuntu/private/municipal-costs -type d -exec chmod 700 {} +
find /home/ubuntu/private/municipal-costs -type f -exec chmod 600 {} +
./scripts/deployment/municipal-cost-source-privacy-check.sh \
  --private-dir /home/ubuntu/private/municipal-costs/<final-tree> \
  --base-url https://<origin>
```

**22. Verify the source SHA inventory against GOLDEN_LOCAL_RESULT.**

```bash
scripts/deployment/municipal_cost_release_result.py inventory \
  --source-dir /home/ubuntu/private/municipal-costs/<final-tree> \
  --archive    /home/ubuntu/private/municipal-costs/<delivery>.zip \
  --out /home/ubuntu/private/municipal-cost-reports/prod_inventory.json
```

Compare `file_count`, `digest`, and `archive_sha256` against the golden result's
`comparable.source_inventory`. Compare NFC-normalised paths — macOS emits NFD and
every Korean filename will appear to differ if this is skipped. Any mismatch is
a hard stop; the full comparison happens again automatically at step 30.

---

## 4. Stage D — deploy the code (steps 23–27)

**23. Deploy the exact final SHA** through the reviewed script:

```bash
./scripts/deployment/deploy.sh --ref "$RELEASE_SHA" --env-file .env.production \
  --base-url https://<origin> --expect-data
```

It validates the env, builds, starts the database, starts backend (which runs
`alembic upgrade head`), frontend and caddy, waits for health, smoke-tests, and
prints the deployed SHA. It never ingests and never restores.

**23.1. Build the ingestion image.** `deploy.sh` does **not** build the
`ingestion` profile:

```bash
dcp --profile ingestion build ingestion
```

**24. Verify the deployed SHA.**

```bash
./scripts/deployment/municipal-cost-preflight.sh --expect-sha "$RELEASE_SHA"
```

**25. Verify a single expected Alembic head** — `alembic.db_rows = 1` and
`alembic.code_head_count = 1` in the preflight output. More than one head, or a
revision the release did not intend, is a hard stop.

**26. Apply only reviewed migrations, if any.** If the integrated release adds
no migration (the likely case — `0021` is already live), the revision must be
**unchanged** at `0021` after the deploy. If it does add one, it is applied
automatically by the backend start command; confirm from the backend log that
exactly one upgrade ran and that it is the reviewed revision.

**27. Verify the official landfill table is unchanged.** Compare
`landfill.rows`, `landfill.accounting_bases`, `landfill.sum_quantity_kg`,
`landfill.sum_inbound_fee_krw` and `landfill.non_metropolitan_rows` in the
step-24 preflight output against the step-7 baseline. They must be identical.

---

## 5. Stage E — the equivalence gate (steps 28–31)

**28. Run the production dry run.** Zero writes.

```bash
dcp --profile ingestion run --rm -T --user 1001:1001 \
  -v /home/ubuntu/private/municipal-costs/<final-tree>:/srv/municipal-costs:ro \
  -v /home/ubuntu/private/municipal-cost-reports:/reports \
  ingestion municipal-costs-ingest --dry-run \
    --source-dir /srv/municipal-costs \
    --report-path /reports/prod_dry_run.json </dev/null
```

Four things here are not optional and are easy to get wrong:

- `-p waste-equity-prod` (via `dcp`) — it is not derivable from the compose file
  or the env file, and omitting it silently targets a different project with
  separate volumes;
- `--user 1001:1001` — the host `ubuntu` uid; the image's `appuser` is uid 1000
  and cannot read a `700` host directory;
- `-v` mounts — the compose `ingestion` service mounts no repository directory;
- `-T … </dev/null` — `docker compose run` otherwise waits on a TTY.

`--source-dir` is a per-invocation argument and is **not** persisted anywhere;
pass it every time.

**29. Capture the production dry-run result** as a golden-shaped artifact
(commands in [`GOLDEN_LOCAL_RESULT.md`](GOLDEN_LOCAL_RESULT.md) §6). Confirm
`status = DRY_RUN_OK`, `ingestion_run_id = null`, `writes = {}`, and prove zero
writes with a before/after fingerprint including `max(id)` per table.

**30. Compare production against GOLDEN_LOCAL_RESULT.**

```bash
scripts/deployment/municipal_cost_release_result.py compare \
  --golden GOLDEN_LOCAL_RESULT.json --candidate PROD_DRY_RUN_RESULT.json
```

**31. STOP if any difference exists.** Not "investigate and continue" — stop,
roll the application back (rollback class A: nothing has been written, so this is
free), and resolve the difference locally. A `population` difference means the
two databases hold different SGIS denominators and must be reconciled before
anything else.

---

## 6. Stage F — the write (steps 32–35)

**32. Only after exact accepted equivalence, run `--write`.**

```bash
dcp --profile ingestion run --rm -T --user 1001:1001 \
  -v /home/ubuntu/private/municipal-costs/<final-tree>:/srv/municipal-costs:ro \
  -v /home/ubuntu/private/municipal-cost-reports:/reports \
  ingestion municipal-costs-ingest --write \
    --source-dir /srv/municipal-costs \
    --report-path /reports/prod_write_1.json </dev/null
```

The whole load runs in **one transaction**; an interrupt rolls back cleanly.

> **This is a re-load, not a first load.** Production already holds the previous
> delivery, so the first write will legitimately report `*_updated` and
> `*_deleted` counters and `idempotent_no_op = false`. Do not expect the insert
> counts of a virgin load. The authority for correctness is the **end state**
> (step 33), not the delta.

**33. Verify the resulting rows, statuses, values and reasons.**

```bash
./scripts/deployment/municipal-cost-verify-api.sh --base-url https://<origin> \
  --golden GOLDEN_LOCAL_RESULT.json \
  --expect-available <A> --expect-partial <P> --expect-unavailable <U>
```

plus, in the database, the reviewed SQL of
[`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md) §7: the 66-row registry and its
25/10/31 split, the status distribution with **zero** rows holding `0`, the seven
derived populations exactly equal to their component sums, the `value_state`
distribution, and `landfill_inbound_monthly` still holding one accounting basis.
Compare the municipal fingerprint against step 16.1 and account for **every**
row that moved.

**34. Re-run the identical `--write`** (`--report-path …/prod_write_2.json`).

**35. Require a deterministic idempotent no-op.** `idempotent_no_op = true`,
every counter reported as `*_unchanged`, and **no** `*_inserted`, `*_updated` or
`*_deleted` key present at all. The loader reconciles by stored content, so this
is a genuine no-op and not "the unique constraints rejected the duplicates". The
fingerprint before and after must be identical in every field; only
`ingestion_runs` advances — that is the audit log, not a data change.

---

## 7. Stage G — post-write verification (steps 36–47)

| # | Check | How |
| --- | --- | --- |
| 36 | municipal API smoke | `municipal-cost-verify-api.sh --golden …` (registry, A/P/U, null-not-zero, official-fee separation, 422s, scoped queries, per-municipality equality) |
| 37 | Page 2 browser checks | load `https://<origin>/?v=1&…`; no console error, no page error, no horizontal overflow at 1440×900 and 390×844 |
| 38 | AVAILABLE default behaviour | default view renders real `원/인` values for every AVAILABLE row; the default sort places `null` **last**, never as "cheapest" |
| 39 | PARTIAL rendering | every PARTIAL row renders a real value **and** its served limitation text in the row itself |
| 40 | UNAVAILABLE rendering | every UNAVAILABLE row renders `자료 없음` in **both** money cells plus the served reason; **zero** cells render `0원/인`, `0억원` or `₩0` |
| 41 | official landfill fee stays separate | the served `difference_from_official_landfill_fee` is rendered verbatim and names `LANDFILL_INBOUND_FEE_PER_CAPITA`; the section never labels itself 반입수수료 / 공식 매립지 수수료 / 폐기물 총관리비 |
| 42 | official landfill regression | `municipal-cost-landfill-regression.sh compare --baseline ~/release-baselines/landfill-pre` — all four endpoints byte-identical and free of municipal content |
| 43 | equity regression | `verify-production-data.sh --allow-drift` — every strict integrity metric (`dup_city_stats`, `city_stats_on_child`, `invalid_derived_geom`, `child_in_two_cities`) must be `0`; `--allow-drift` is required on this host for the pre-existing population/protected/suitability drift and must not hide a strict failure |
| 44 | suitability regression | same script's suitability counts, plus `smoke-test.sh --expect-data` |
| 45 | health / readiness | `smoke-test.sh --base-url … --expect-data` (7/7); `/health` reports `database: ok`; `/ready` 404 is pre-existing |
| 46 | private source not web-accessible | `municipal-cost-source-privacy-check.sh --private-dir … --base-url …` |
| 47 | private source still untracked | the same script's Git checks, run **on the production checkout** |

**48. Final go/no-go.** Record: release SHA, Alembic revision, ingestion run ids,
the golden `comparable_sha256`, the backup path and hash, the A/P/U outcome, and
every no-go condition explicitly evaluated. A release is "go" only when every
gate above passed on the live host — not when it is expected to.

---

## 8. Hard no-go conditions

Any one of these stops the release. There is no "proceed with a note".

**Source integrity**

1. source ZIP SHA-256 mismatch against the golden result
2. any workbook SHA-256 mismatch
3. unexpected source file count
4. a private ZIP/XLSX tracked by Git, or present inside the checkout
5. the private source reachable over HTTP, or served with a file content-type
6. an unexpected source rejection (a file rejected that the golden result accepts, or vice versa)

**Semantic integrity**

7. local/production dry-run mismatch in **any** field
8. the municipality registry is not exactly the reviewed 2024 scope (66; 25/10/31)
9. a missing value represented as `0` anywhere — database, API, or UI
10. an unexpected AVAILABLE/PARTIAL/UNAVAILABLE change relative to the frozen golden result
11. one of the five reviewed limitations disappears unexpectedly (enforced by `check --require-reason-code`)
12. an official Sudokwon Landfill inbound fee enters the municipal numerator
13. a treatment-only payment (반입수수료 / 처리 / 소각 / 선별) enters the municipal numerator
14. the wrong accounting basis is served (`accounting_basis` ≠ `MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT`, or `is_official_landfill_fee` ≠ `false`)

**Schema and platform**

15. wrong migration head, or a revision the release did not intend
16. multiple unexpected Alembic heads (in code or in `alembic_version`)
17. official landfill regression — any of the four endpoints changed, or municipal content inside one
18. municipal API regression against the golden result
19. frontend fake or fallback numbers (a placeholder, a zero, or an interpolated value standing in for missing data)
20. Page 2 wording implying a resident-paid garbage fee, an official landfill fee, or total waste-management expenditure
21. a critical service unhealthy, or any container restart loop
22. an invalid or unreadable backup
23. the rollback target unavailable or not fetchable
24. `meta.source_coverage` disagreeing with the golden source-file accounting (see §0.1)

**Explicitly NOT a blocker:** the AVAILABLE count itself. A lower count with
truthful semantics is preferable to fabricated completeness. Blockers 9–14 exist
precisely to make the truthful-but-smaller outcome the safe one.

---

## 9. Rollback plan

All rollbacks use the repository's existing mechanisms. `alembic downgrade` is
**not** part of any of them and must not be run unless a disaster-recovery
decision explicitly calls for it.

| Class | Failure | Restore prior code SHA | Rebuild/recreate images | Restore DB backup | Roll back migration | Restore previous private source |
| --- | --- | --- | --- | --- | --- | --- |
| A | code deployment failure (build, health, smoke) | **yes** | yes (by the script) | no | no | no |
| B | migration failure | yes, after the restore | yes | **yes** | never | no |
| C | ingestion failure before commit | no | no | **no** | no | no |
| D | ingestion / post-write regression | only if the code is also wrong | no | **yes** (deliberate) | never | only if the source itself was wrong |
| E | frontend-only regression | **yes** | yes | no | no | no |
| F | API semantic regression | **yes**, if a prior SHA is compatible; otherwise fix forward | yes | no | no | no |

**A — code deployment failure.** Nothing has been written. Roll the application
back; the database is untouched.

```bash
./scripts/deployment/rollback-app.sh --ref "$ROLLBACK_COMMIT" --env-file .env.production
```

The script refuses if the target ref does not contain the migration file for the
live revision — that guard is the point. If it stops, the target predates a live
migration and the correct action is to fix forward or restore the backup, never
to downgrade the schema. Note that rollback to the pre-`0021` production SHA
(`272b5b4`) is already permanently guard-blocked, and will stay so.

**B — migration failure.** The backend will not become healthy. Stop; do not
retry the deploy. Capture `dcp logs backend` first, then restore:

```bash
./scripts/deployment/restore-production-database.sh \
  --dump backups/<pre-change dump> --confirm-production --env-file .env.production
./scripts/deployment/rollback-app.sh --ref "$ROLLBACK_COMMIT" --env-file .env.production
./scripts/deployment/verify-production-data.sh --env-file .env.production --allow-drift
```

The restore takes its own safety backup first and uses
`pg_restore --clean --if-exists`, never a `psql` replay into a populated database.

**C — ingestion failure before commit.** The load is a single transaction: it has
already rolled itself back. Nothing to restore. Confirm with the step-16.1
fingerprint and the `ingestion_runs` row (which is expected to exist, recording
the failure). Fix and re-run.

**D — ingestion / post-write regression.** Data was written and is wrong. This is
the only class that restores the database on purpose:

```bash
./scripts/deployment/restore-production-database.sh \
  --dump backups/<pre-change dump> --confirm-production --env-file .env.production
./scripts/deployment/verify-production-data.sh --env-file .env.production --allow-drift
./scripts/qa/municipal-cost-landfill-regression.sh compare \
  --base-url https://<origin> --baseline ~/release-baselines/landfill-pre
```

If the release also added a migration, restoring a pre-migration dump removes
that schema, so the application must be rolled back to a ref without it in the
same maintenance window. Decide deliberately.

**E — frontend-only regression.** The API and the data are correct; only Page 2
renders wrongly. Roll the application back to `ROLLBACK_COMMIT`; the schema
revision is unchanged so the guard permits it, and the municipal data stays.

**F — API semantic regression.** The stored data is correct but the served
payload is not. Prefer an application rollback; if the previous SHA does not
contain the live revision the guard stops it, and the correct action is to fix
forward with a new release. Do not restore the database — it is not the problem.

**Private source rollback.** The previous delivery is retained at its own path
(`data/import/municipal-costs/2024/` locally, and its own directory on the
server); the transfer never uses `--delete`, so re-pointing `--source-dir` at the
previous tree is the whole rollback. Nothing is overwritten and nothing is
deleted.

---

## 10. Security and privacy invariants

The procedure keeps the private source:

- **outside Git tracking** — `data/import/municipal-costs/`,
  `data/raw/municipal-costs/`, `artifacts/municipal-costs/` and `backups/` are
  all Git-ignored; `municipal-cost-source-privacy-check.sh` asserts the ignore
  rules still exist and that no workbook, archive or dump is tracked;
- **outside public/static frontend directories** — Caddy reverse-proxies
  `backend:8000` and `frontend:3000` only, runs no `file_server`, has no `root`,
  and mounts no host data directory; the check asserts this from the Caddyfile
  and by probing the live origin;
- **outside the Docker build context** — the source lives under
  `/home/ubuntu/private/…`, never in the checkout, so it is not in any build
  context; the check fails if a workbook appears anywhere inside the repository;
- **protected by filesystem permissions** — directories `700`, files `600`,
  owned by the deployment user; mounted **read-only** into an ephemeral `--rm`
  ingestion container and nowhere else; the check reports any file or directory
  that deviates, and fails if a long-lived container still holds the mount;
- **not returned through APIs** — workbook *filenames* are intentional
  provenance (Step 2/3), but no absolute path and no file bytes are served; both
  `municipal-cost-verify-api.sh` and the golden `check` fail on `/home/`,
  `/Users/`, `/srv/` or `/root/` appearing in a payload or artifact;
- **not exposed through Caddy or a static route** — the check probes `/data/`,
  `/municipal-costs/`, `/private/municipal-costs/…`, `/backups/` and
  `/artifacts/municipal-costs/` and requires 404/403 with no file content-type
  and no directory listing.

No helper contains a credential, a private key path, a workbook cell value, or a
server-specific absolute path. Database backups may contain the full dataset:
treat them as sensitive, copy them off the instance, never commit one.

---

## 11. Helper reference

| Helper | What it does | Writes anything? |
| --- | --- | --- |
| [`municipal_cost_release_result.py`](../../scripts/deployment/municipal_cost_release_result.py) | `inventory` / `build` / `check` / `compare` for GOLDEN_LOCAL_RESULT | only its own output file, and refuses a Git-tracked path |
| [`municipal-cost-preflight.sh`](../../scripts/deployment/municipal-cost-preflight.sh) | read-only host, service, schema and landfill-baseline preflight; `--expect-sha` doubles as the post-deploy SHA verification | no |
| [`municipal-cost-verify-api.sh`](../../scripts/deployment/municipal-cost-verify-api.sh) | read-only municipal API verification against the golden result | no |
| [`municipal-cost-landfill-regression.sh`](../../scripts/qa/municipal-cost-landfill-regression.sh) | canonical capture/compare of the four official landfill endpoints | only the baseline directory, and refuses a Git-tracked path |
| [`municipal-cost-source-privacy-check.sh`](../../scripts/deployment/municipal-cost-source-privacy-check.sh) | Git-tracking, checkout, permission, mount and public-reachability checks | no |

Existing tooling this runbook reuses unchanged: `deploy.sh`,
`check-production-env.sh`, `smoke-test.sh`, `verify-production-data.sh`,
`rollback-app.sh`, `restore-production-database.sh`,
`backup-local-database.sh`.

---

## 12. Operational notes carried forward

- Compose is always `-p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production`.
- Never `docker compose down -v`; never delete or recreate `pgdata`,
  `caddy_data` or `caddy_config`; never modify `.env.production`.
- `verify-production-data.sh` needs `--allow-drift` on this host for the
  pre-existing population/protected/suitability drift. Every strict integrity
  check must still pass exactly.
- `/ready` returns 404 and the `ELIGIBLE` disclaimer wording are pre-existing
  non-defects.
- A `deploy/Caddyfile` change needs a container **recreate**, not a reload — the
  single-file bind mount pins the old inode.
- The raw workbooks have **no retention policy** in this repository. The previous
  release kept them deliberately; destroying reproducibility inputs without a
  policy is the riskier choice.
- This release asserts **no** right to redistribute the source workbooks. Only
  the derived indicator, statuses, reason codes, population provenance and
  source-coverage counts are published.
