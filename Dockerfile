# C7NTAX — single image for the API and the web application (PLAN-016).
#
# One image serves both: the API on PORT (default 4000) and the built SPA from the same
# origin, because the CSP, the WebSocket path and the session handling all assume one
# origin. Development and production run the same image with different configuration, so
# what is verified in dev is what runs in prod.
#
# The workspace packages publish TypeScript sources (`main: ./src/index.ts`), so the
# process is started with tsx rather than a compiled `dist`. That is why `tsx` and `prisma`
# are runtime dependencies in apps/api rather than devDependencies.

# ── Build stage: install the whole workspace, then build the web app ──
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /repo

# Manifests first so the dependency layer is cached independently of the sources.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/billing/package.json packages/billing/
COPY packages/email/package.json packages/email/
COPY packages/integrations/package.json packages/integrations/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/shared packages/shared
COPY tsconfig.json turbo.json ./
RUN pnpm --filter @C7NTAX/web build

# ── Runtime stage: production dependencies plus the sources the API runs from ──
FROM node:22-bookworm-slim AS runtime
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production SERVE_WEB=true WEB_DIST=/repo/web PORT=4000
# Prisma's query engine links against the system OpenSSL; without it the client fails at
# the first query with "cannot find libssl". Install it before generating the client so the
# engine for this platform is the one downloaded.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/billing/package.json packages/billing/
COPY packages/email/package.json packages/email/
COPY packages/integrations/package.json packages/integrations/
COPY packages/shared/package.json packages/shared/
# --filter keeps the desktop toolchain (electron, electron-builder) out of the image.
RUN pnpm install --frozen-lockfile --prod --filter @C7NTAX/api... \
 && pnpm store prune \
 && rm -rf /root/.cache /root/.local/share/pnpm/store

COPY apps/api/src apps/api/src
COPY apps/api/prisma apps/api/prisma
COPY apps/api/tsconfig.json apps/api/
COPY packages/shared/src packages/shared/src
COPY packages/email/src packages/email/src
COPY packages/billing/src packages/billing/src
COPY packages/integrations/src packages/integrations/src
COPY --from=build /repo/apps/web/dist /repo/web

# The Prisma client is generated against the copied schema, not shipped from the build stage.
RUN cd apps/api && npx prisma generate

# Never run as root: the container only needs to read its own files.
RUN chown -R node:node /repo
USER node

# Start from the API workspace: with a filtered install the dependencies (including the
# runtime tsx and the workspace links) live in apps/api/node_modules.
WORKDIR /repo/apps/api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are applied by the deploy job (same image, overridden command) before the
# new revision takes traffic — never by the app on boot, so a rollback cannot run them.
CMD ["node", "--import", "tsx", "src/index.ts"]
