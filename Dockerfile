# syntax=docker/dockerfile:1
# One image definition for every service in the workspace:
#   docker build --build-arg SERVICE=auth-service -t ai-search/auth-service .
ARG NODE_VERSION=22-alpine

# ── Manifests only, so dependency layers stay cached until a package.json or the lockfile
#    changes. npm ci needs every workspace manifest listed in the lockfile.
FROM node:${NODE_VERSION} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/gateway/package.json services/gateway/
COPY services/auth-service/package.json services/auth-service/
COPY services/file-upload-service/package.json services/file-upload-service/
COPY services/shared-auth/package.json services/shared-auth/
COPY services/platform/package.json services/platform/

# ── Compile TypeScript (needs dev dependencies: typescript, @types/*)
FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json ./
COPY services/platform services/platform
COPY services/shared-auth services/shared-auth
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Build with --build-arg SERVICE=<service directory>" && exit 1)
COPY services/${SERVICE} services/${SERVICE}
# Always build both shared packages (the runtime stage copies both), then the service
RUN npx tsc -b services/platform services/shared-auth "services/${SERVICE}"

# ── Production dependencies only
FROM manifests AS deps
ARG SERVICE
RUN npm ci --omit=dev --workspace "services/${SERVICE}" --no-audit --no-fund

# ── Runtime: compiled JavaScript + production dependencies, non-root
FROM node:${NODE_VERSION}
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/services/platform/dist services/platform/dist
COPY --from=build --chown=node:node /app/services/shared-auth/dist services/shared-auth/dist
COPY --from=build --chown=node:node /app/services/${SERVICE}/dist services/${SERVICE}/dist
# Writable data directory for the non-root user; a named volume mounted here inherits
# this ownership (file-upload-service stores uploads in /data/uploads)
RUN mkdir -p /data/uploads && chown -R node:node /data
WORKDIR /app/services/${SERVICE}
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Runs node directly (not npm) so SIGTERM reaches the process for graceful shutdown
CMD ["node", "dist/index.js"]
