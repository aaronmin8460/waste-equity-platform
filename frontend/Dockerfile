# Multi-stage production image for the Next.js frontend.
#
# Same-origin production: NEXT_PUBLIC_API_BASE_URL is baked at build time as an
# empty string, so the browser calls relative /api/v1/... paths and the reverse
# proxy (Caddy) routes them to the backend. No internal Docker hostname
# (e.g. backend:8000) ever reaches browser JavaScript. Local development keeps
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 via `npm run dev` (unaffected by
# this image). No credentials and no raw data are copied into the image.

# ---- deps: install exactly the locked dependencies ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# @playwright/test is a dev dependency used only for local e2e; do not download
# its browsers into the image (not needed to build or serve the app).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: produce the standalone production output ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Empty base URL => same-origin relative API calls in the browser. Overridable
# via --build-arg for other deployments, but never an internal container host.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal non-root runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root runtime user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server + its traced node_modules, then the static assets and public
# files that standalone output does not copy automatically.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Liveness: the standalone server answers on / (Node 22 has global fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
