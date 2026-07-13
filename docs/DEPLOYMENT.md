# Production Deployment — AWS Lightsail (Phase 5.5)

A stable, single-server demonstration deployment of the completed Phase 5
platform. One public HTTPS origin serves the frontend and backend; PostgreSQL is
never exposed to the Internet.

> The user performs the AWS account, Lightsail instance, DNS, and billing steps
> manually. This document is the exact runbook; nothing here creates chargeable
> AWS resources or changes DNS automatically.

## Target architecture

```
                    Internet (443/tcp, 443/udp, 80→443)
                               │
                        ┌──────▼───────┐
                        │    caddy     │  publishes 80/443 only; automatic HTTPS
                        │ reverse proxy│  /api/*, /health → backend ; else → frontend
                        └──┬───────┬───┘
              internal :3000       :8000 internal
                    ┌───▼────┐  ┌───▼─────┐
                    │frontend│  │ backend │  (no host ports)
                    │Next.js │  │ FastAPI │
                    └────────┘  └───┬─────┘
                                    │ internal :5432 (never published)
                               ┌────▼─────┐
                               │ database │  PostGIS 16, named volume
                               └──────────┘
```

- **Instance:** AWS Lightsail, **ap-northeast-2 (Seoul)**, Ubuntu LTS,
  **8 GB RAM / 2 vCPU / 160 GB SSD** (recommended).
- **Compose:** `docker-compose.prod.yml` (database, backend, frontend, caddy;
  optional `ingestion` profile).
- **Public origin:** `https://${PUBLIC_DOMAIN}` (placeholder
  `waste.thedayshiny.com`). The browser calls relative `/api/v1/...` paths
  (same-origin) — no internal container host reaches browser JavaScript.
- **Ports published to the host:** only Caddy's `80`, `443`, `443/udp`.
  **`3000`, `8000`, `5432` are never published.**

## Prerequisites (manual, by the user)

- An AWS account with billing configured.
- Control of the DNS zone for the chosen domain (placeholder
  `waste.thedayshiny.com`).

---

## Step 1 — Create the Lightsail instance (manual)

In the Lightsail console: **Create instance** → Region **Seoul
(ap-northeast-2)** → Platform **Linux/Unix** → Blueprint **Ubuntu** (LTS) →
Plan **8 GB RAM, 2 vCPU, 160 GB SSD**. Create.

## Step 2 — Attach a static IP (manual)

Lightsail → **Networking** → **Create static IP** → attach it to the instance.
Record the static IP (call it `SERVER_IP`).

## Step 3 — Firewall (Lightsail networking)

On the instance's **Networking → IPv4 Firewall**, allow only:

| Application | Protocol | Port | Source |
| --- | --- | --- | --- |
| SSH | TCP | 22 | your IP / office range (restrict where possible) |
| HTTP | TCP | 80 | Anywhere |
| HTTPS | TCP | 443 | Anywhere |
| HTTPS (HTTP/3) | UDP | 443 | Anywhere |

**Do NOT open 3000, 5432, or 8000.** Those stay inside the Docker network.

## Step 4 — Install Docker Engine + Compose plugin

SSH in (`ssh ubuntu@SERVER_IP`) and follow Docker's official instructions:

```bash
# Docker's convenience script (official).
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu    # log out/in so the group applies
docker --version
docker compose version            # the Compose v2 plugin ships with Docker Engine
```

## Step 5 — Clone the repository

```bash
git clone https://github.com/aaronmin8460/waste-equity-platform.git
cd waste-equity-platform
git checkout main                 # or the specific release SHA/tag to deploy
```

## Step 6 — Create the production env file

```bash
cp .env.production.example .env.production
```

## Step 7 — Generate strong credentials

```bash
openssl rand -base64 36           # copy into POSTGRES_PASSWORD in .env.production
```

Edit `.env.production`: set `PUBLIC_DOMAIN`, `CADDY_ACME_EMAIL`, a dedicated
`POSTGRES_USER`, the generated `POSTGRES_PASSWORD`, and keep
`NEXT_PUBLIC_API_BASE_URL` empty. Then validate:

```bash
./scripts/deployment/check-production-env.sh .env.production   # must print "passed"
```

The guard rejects empty/short/default/placeholder passwords, a non-production
`APP_ENV`, and any non-same-origin frontend API base.

## Step 8 — DNS A record (manual)

In your DNS provider, create an **A record**: `waste.thedayshiny.com → SERVER_IP`
(TTL ~300). Do this only after Step 2. **Do not proceed to HTTPS until DNS
resolves** — Caddy needs the domain to point at the server to obtain a
certificate.

## Step 9 — Confirm DNS resolution

```bash
dig +short waste.thedayshiny.com      # must return SERVER_IP
```

## Step 10 — Start the database only

```bash
docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production up -d database
docker compose -p waste-equity-prod -f docker-compose.prod.yml ps database   # wait for "healthy"
```

## Step 11 — Transfer the local database dump securely

On your **local machine** (where the Phase 5 data lives), create a custom-format
dump and copy it to the server over SSH:

```bash
# local
./scripts/deployment/backup-local-database.sh          # writes backups/waste_equity_local_*.dump
scp backups/waste_equity_local_*.dump ubuntu@SERVER_IP:~/waste-equity-platform/backups/
```

The dump is Git-ignored and its contents are never printed or committed.

## Step 12 — Restore the database

```bash
# server
./scripts/deployment/restore-production-database.sh \
  --dump backups/waste_equity_local_YYYYMMDD_HHMMSS.dump \
  --confirm-production \
  --env-file .env.production
```

The restore is destructive by design; it takes a safety backup first if the
target already holds data, and never deletes the source dump.

## Step 13 — Start the application stack

```bash
./scripts/deployment/deploy.sh --env-file .env.production
```

`deploy.sh` validates the env, builds images, starts the database (waits
healthy), starts the backend (which runs `alembic upgrade head`), frontend, and
Caddy, waits for health, runs the smoke test, and prints the deployed Git SHA.
It never ingests data and never restores a dump.

## Step 14 — Verify automatic HTTPS

```bash
curl -I https://waste.thedayshiny.com/           # 200; valid Let's Encrypt cert
curl -I http://waste.thedayshiny.com/            # redirects to https
```

Or open the domain in a browser and confirm the padlock.

## Step 15 — Run the production smoke test

```bash
./scripts/deployment/smoke-test.sh --base-url https://waste.thedayshiny.com --expect-data
```

## Step 16 — Verify the expected production counts

```bash
./scripts/deployment/verify-production-data.sh --env-file .env.production
```

Expected initial deployment counts (a future refresh legitimately changes some —
use `--allow-drift` then):

| metric | expected |
| --- | --- |
| regions | 82 |
| population | 82 |
| waste_statistics | 234 |
| facilities | 651 |
| zoning | 88,252 |
| protected | 20,892 |
| roads | 2,971,494 |
| suitability_candidates | 47,893 |
| eligible | 1,099 |
| review | 34,534 |
| excluded | 12,260 |
| suitability_runs | ≥ 1 |
| reporting_regions | 7 |
| reporting_members | 20 |
| reporting_waste | 28 |
| reporting_ntn007 / ntn008 / ntn018 / ntn022 | 7 each |
| ntn018_native_omissions | 2 (인천 옹진군, 경기 연천군) |
| dup_city_stats / city_stats_on_child / invalid_derived_geom / child_in_two_cities | 0 (integrity — exact even with `--allow-drift`) |

The reporting-geography rows are additive (migration 0012); the native, waste,
and suitability counts above are unchanged by that migration. See
`docs/RCIS_REPORTING_GEOGRAPHY_DEPLOYMENT.md` for the reporting-geography deploy.

## Step 17 — Verify Suitability mode manually

Open `https://waste.thedayshiny.com`, switch to **적합성 (Suitability)** mode, and
confirm the analysis summary, candidate cells on the map, profile switching, a
candidate evidence panel (component scores + sources + reference periods), and
the analytical-screening disclaimer. Confirm in the browser devtools Network tab
that requests go only to the domain (same-origin) — never `localhost:8000` and
never a Korean government API.

## Step 18 — Configure backups (snapshots)

Enable **Lightsail automatic snapshots** on the instance (Snapshots tab), and/or
schedule `scripts/deployment/backup-local-database.sh`-style `pg_dump` backups on
the server with off-instance copies. See `docs/OPERATIONS_RUNBOOK.md`.

## Step 19 — Record the deployment

Record the **deployment date** and the **deployed Git SHA** (printed by
`deploy.sh`, or `git rev-parse HEAD`) in your operations log / PR / snapshot
description.

---

## Notes and safety

- Only Caddy publishes host ports (80/443). `docker compose -f
  docker-compose.prod.yml config` shows no `5432`, `8000`, or `3000` published.
- `.env.production` is Git-ignored and must never be committed. No credentials
  or raw data are baked into any image.
- The interactive API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled in
  production and are not routed by Caddy.
- This phase does not run public-data ingestion and does not start the Phase 6
  scheduler.
