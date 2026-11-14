# Metabolic AI web app — production image (Next.js standalone output).
#   docker build -t metabolic-web --build-arg PUBLIC_WEB_URL=https://metabolic.example frontend
#   docker run --env-file frontend/.env.production -p 3000:3000 metabolic-web
#
# Set DATABASE_URL (PostgreSQL) at runtime in production; without it the app
# falls back to an embedded PGlite database at /app/.data (mount a volume there).
# Provider keys and the NEAR receipt signer key are runtime-only — never pass
# them as build args. PUBLIC_WEB_URL and the LEGAL_* details are read at build
# time because the legal pages and sitemap are prerendered.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# The .npmrc store-dir is a local dev setting; use the image's default store.
RUN sed -i '/^store-dir/d' .npmrc && pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG PUBLIC_WEB_URL=""
ARG LEGAL_ENTITY_NAME=""
ARG LEGAL_ADDRESS=""
ARG LEGAL_JURISDICTION=""
ARG SUPPORT_EMAIL=""
ENV PUBLIC_WEB_URL=$PUBLIC_WEB_URL \
    LEGAL_ENTITY_NAME=$LEGAL_ENTITY_NAME \
    LEGAL_ADDRESS=$LEGAL_ADDRESS \
    LEGAL_JURISDICTION=$LEGAL_JURISDICTION \
    SUPPORT_EMAIL=$SUPPORT_EMAIL \
    WORKER_INLINE=false \
    NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/.data && chown app:app /app/.data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/server/db/migrations ./server/db/migrations
USER app
EXPOSE 3000
VOLUME ["/app/.data"]
CMD ["node", "server.js"]
