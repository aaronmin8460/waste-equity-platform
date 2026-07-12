# Production Security Baseline (Phase 5.5)

Every control below is either implemented in the repository (with the file
noted) or a documented operational procedure. The deployment adds no
authentication — the demonstration is intentionally public — but a proxy-level
demo password can be enabled if desired (bottom of this doc).

## Network & exposure

| Control | Status | Where |
| --- | --- | --- |
| PostgreSQL not reachable from the Internet | ✅ implemented | `docker-compose.prod.yml` — `database` has no `ports:`; internal network only |
| Backend/frontend ports internal only | ✅ implemented | `docker-compose.prod.yml` — no `ports:` on `backend`/`frontend` |
| Only the reverse proxy is public | ✅ implemented | `caddy` publishes `80`, `443`, `443/udp` only |
| Verify no port leak | ✅ | `docker compose -f docker-compose.prod.yml config` shows no 5432/8000/3000 |

## Transport

| Control | Status | Where |
| --- | --- | --- |
| HTTPS-only public access, automatic certs | ✅ implemented | `deploy/Caddyfile` — automatic Let's Encrypt for `${PUBLIC_DOMAIN}` |
| HTTP → HTTPS redirect | ✅ implemented | Caddy default for a domain site |
| HSTS + `nosniff` + `SAMEORIGIN` + referrer policy | ✅ implemented | `deploy/Caddyfile` `header` block |
| CSP | ⚠️ intentionally omitted | would break MapLibre blob workers + OSM tiles; documented in `deploy/Caddyfile` |
| Request body ceiling | ✅ implemented | `deploy/Caddyfile` `request_body { max_size 2MB }` |

## Application & data

| Control | Status | Where |
| --- | --- | --- |
| Same-origin frontend API (no internal host, no creds in browser) | ✅ implemented | `frontend/Dockerfile` bakes `NEXT_PUBLIC_API_BASE_URL=""`; `apiBaseUrl()` returns `""` |
| No public-data API credentials in the frontend | ✅ implemented | frontend calls only the backend; no keys in browser JS |
| No credentials/raw data in images | ✅ implemented | `frontend/.dockerignore`, `backend/Dockerfile` copy source only |
| Non-root application containers | ✅ implemented | backend `appuser`; frontend `nextjs` (uid 1001) |
| Strong production DB credentials | ✅ enforced | `scripts/deployment/check-production-env.sh` rejects empty/short/default/placeholder |
| `.env.production` never committed | ✅ implemented | `.gitignore` (`.env.*`, only `*.example` un-ignored) |
| CORS restricted to the public origin | ✅ implemented | `docker-compose.prod.yml` `CORS_ALLOW_ORIGINS=https://${PUBLIC_DOMAIN}` |
| Trusted-proxy handling (correct scheme/IP) | ✅ implemented | backend `uvicorn --proxy-headers --forwarded-allow-ips='*'` (only Caddy can reach it) |
| Safe errors (no stack traces / connection strings leaked) | ✅ implemented | FastAPI default 4xx/5xx JSON; `/health` never echoes the DB URL (`api/routes/health.py`) |
| Interactive docs / OpenAPI off in production | ✅ implemented | `api/app.py` disables `docs_url`/`redoc_url`/`openapi_url` when `APP_ENV=production`; Caddy does not route them |
| No mock/fallback data | ✅ | app serves only real DB data; unreachable backend → explicit error, never fake data |

## Operations & resilience

| Control | Status | Where |
| --- | --- | --- |
| Container restart policy | ✅ implemented | `restart: unless-stopped` on all services |
| Health checks | ✅ implemented | database `pg_isready`; backend `/health`; frontend HTTP probe |
| Docker log size limits (rotation) | ✅ implemented | `docker-compose.prod.yml` `json-file` `max-size=10m max-file=5` |
| Backups + off-instance storage + encryption guidance | ✅ documented | `docs/OPERATIONS_RUNBOOK.md` (pg_dump custom, Lightsail snapshots, encrypt at rest) |
| Security update procedure | ✅ documented | `docs/OPERATIONS_RUNBOOK.md` (OS + base images + app rebuild; password rotation) |
| No automated public-data ingestion this phase | ✅ | `ingestion` is an opt-in profile, never run by default; Phase 6 scheduler not started |
| Firewall (SSH restricted, only 80/443 public) | ✅ documented | `docs/DEPLOYMENT.md` Step 3 |

## Optional: demo-access password (disabled by default)

The public demo runs without authentication. To gate it during a private review,
add HTTP basic auth **at the reverse proxy** (not in the app), configured through
a secret and disabled by default. Generate a hash and add a matcher to
`deploy/Caddyfile` inside the site block:

```bash
# Generate a bcrypt hash for the chosen password (never commit the plaintext):
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'YOUR_DEMO_PASSWORD'
```

```caddyfile
# Optional — enable only for a gated demo; keep the frontend/API behind it.
basic_auth {
    demo <PASTE_BCRYPT_HASH_HERE>
}
```

Do not commit the plaintext or the hash of a real password; source them from a
secret at deploy time. Leave this block out for the open public demonstration.

## Verification

Run before/after deploy:

```bash
./scripts/deployment/check-production-env.sh .env.production   # env + password + port guard
docker compose -f docker-compose.prod.yml config | grep -E "published|5432|8000|3000"  # only 80/443
./scripts/deployment/smoke-test.sh --base-url https://${PUBLIC_DOMAIN} --expect-data
```
