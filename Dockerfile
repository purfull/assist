# syntax=docker/dockerfile:1
# One image definition for every service in the workspace:
#   docker build --build-arg SERVICE=auth-service -t ai-search/auth-service .
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Manifests only, so dependency layers are cached until a package.json or the lockfile changes.
# npm ci needs every workspace manifest listed in the lockfile.
COPY package.json package-lock.json ./
COPY services/gateway/package.json services/gateway/
COPY services/auth-service/package.json services/auth-service/
COPY services/file-upload-service/package.json services/file-upload-service/
COPY services/shared-auth/package.json services/shared-auth/
COPY services/platform/package.json services/platform/
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Build with --build-arg SERVICE=<service directory>" && exit 1)
RUN npm ci --omit=dev --workspace "services/${SERVICE}" --no-audit --no-fund

FROM node:${NODE_VERSION}
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app ./
COPY --chown=node:node services/platform services/platform
COPY --chown=node:node services/shared-auth services/shared-auth
COPY --chown=node:node services/${SERVICE} services/${SERVICE}
# Writable data directory for the non-root user; a named volume mounted here inherits
# this ownership (file-upload-service stores uploads in /data/uploads)
RUN mkdir -p /data/uploads && chown -R node:node /data
WORKDIR /app/services/${SERVICE}
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Runs node directly (not npm) so SIGTERM reaches the process for graceful shutdown
CMD ["node", "index.js"]
